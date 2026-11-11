package br.gov.cidadeocidental.agiliza.dao;

import java.sql.Connection;
import java.sql.Date;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.UUID;

import br.gov.cidadeocidental.agiliza.model.Anexo;
import br.gov.cidadeocidental.agiliza.model.NovaSolicitacao;
import br.gov.cidadeocidental.agiliza.model.Prioridade;
import br.gov.cidadeocidental.agiliza.model.Solicitacao;
import br.gov.cidadeocidental.agiliza.model.Status;
import br.gov.cidadeocidental.agiliza.util.ConnectionFactory;

public class SolicitacaoDAO {

    /** Pedido "em aberto" (ainda nao marcado nem finalizado). */
    private static final String EM_ABERTO = "s.status IN ('RECEBIDA','EM_TRIAGEM','EM_ANALISE_REGULACAO')";

    private static final String SELECT_BASE =
            "SELECT s.id, s.protocolo, s.status, s.mensagem_publica, s.anexo_arquivo, "
            + "s.criado_em, s.atualizado_em, "
            + "s.prioridade, s.prioridade_motivo, s.prioridade_em, us.nome AS prioridade_por, "
            + "s.canal, uc.nome AS criado_por, s.cirurgia_procedimento, s.cirurgia_hospital, "
            + "s.preop_exames, s.preop_risco, s.preop_termo, s.preop_orientado, "
            // tempo de espera calculado pelo proprio MySQL
            + "CASE WHEN " + EM_ABERTO + " THEN DATEDIFF(NOW(), s.criado_em) "
            + "     ELSE DATEDIFF(s.atualizado_em, s.criado_em) END AS dias_espera, "
            + "p.nome AS paciente, p.cpf, p.cartao_sus, p.telefone, p.data_nascimento, "
            + "TIMESTAMPDIFF(YEAR, p.data_nascimento, CURDATE()) AS idade, "
            + "sv.id AS servico_id, sv.nome AS servico, u.nome AS ubs, av.agenda_id, av.numero AS agenda_vaga, "
            // marcacao pela agenda (vaga ocupada): data, horario, local e profissional
            + "ag.data AS agenda_data, ag.local AS agenda_local, pr.nome AS agenda_profissional, ag.orientacoes AS agenda_orientacoes, "
            + "TIME_FORMAT(ADDTIME(ag.hora_inicio, SEC_TO_TIME(av.numero * ag.intervalo_min * 60)), '%H:%i') AS agenda_hora "
            + "FROM solicitacao s "
            + "JOIN paciente p  ON p.id  = s.paciente_id "
            + "JOIN servico sv  ON sv.id = s.servico_id "
            + "JOIN ubs u       ON u.id  = s.ubs_id "
            + "LEFT JOIN usuario us ON us.id = s.prioridade_por "
            + "LEFT JOIN usuario uc ON uc.id = s.criado_por "
            + "LEFT JOIN agenda_vaga av ON av.solicitacao_id = s.id "
            + "LEFT JOIN agenda ag ON ag.id = av.agenda_id "
            + "LEFT JOIN profissional pr ON pr.id = ag.profissional_id ";

    /** Fila: em aberto primeiro, por prioridade e, dentro dela, quem espera ha mais tempo. */
    private static final String ORDEM_FILA =
            "ORDER BY (" + EM_ABERTO + ") DESC, "
            + "CASE WHEN " + EM_ABERTO + " THEN FIELD(s.prioridade,'URGENTE','PRIORITARIO','NORMAL') ELSE 0 END, "
            + "CASE WHEN " + EM_ABERTO + " THEN s.criado_em END ASC, "
            + "s.atualizado_em DESC ";

    // ------------------------------------------------------------------
    // Criacao (municipe)
    // ------------------------------------------------------------------
    /** Cria paciente (se necessario) + solicitacao + historico numa unica transacao. */
    public String criar(NovaSolicitacao n) throws SQLException, ConflitoException {
        try (Connection c = ConnectionFactory.getConnection()) {
            c.setAutoCommit(false);
            try {
                if (servicoSomenteEquipe(c, n.servicoId)) {
                    throw new ConflitoException("Este serviço só pode ser solicitado no atendimento presencial da UBS.");
                }
                long pacienteId = obterOuCriarPaciente(c, n);
                long id = inserirSolicitacao(c, pacienteId, n);

                String protocolo = LocalDate.now().getYear() + "-" + String.format("%05d", id);
                try (PreparedStatement ps = c.prepareStatement(
                        "UPDATE solicitacao SET protocolo = ? WHERE id = ?")) {
                    ps.setString(1, protocolo);
                    ps.setLong(2, id);
                    ps.executeUpdate();
                }
                try (PreparedStatement ps = c.prepareStatement(
                        "INSERT INTO historico_solicitacao (solicitacao_id, usuario_id, status_novo, observacao) "
                        + "VALUES (?, NULL, 'RECEBIDA', 'Solicitação criada pelo munícipe')")) {
                    ps.setLong(1, id);
                    ps.executeUpdate();
                }
                c.commit();
                return protocolo;
            } catch (SQLException | ConflitoException | RuntimeException e) {
                c.rollback();
                throw e;
            }
        }
    }

    private boolean servicoSomenteEquipe(Connection c, int servicoId) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT somente_equipe FROM servico WHERE id = ?")) {
            ps.setInt(1, servicoId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() && rs.getBoolean(1);
            }
        }
    }

    // ------------------------------------------------------------------
    // Atendimento presencial (balcao): o servidor cadastra e faz o pedido
    // ------------------------------------------------------------------
    /** Dados basicos do paciente pelo CPF (para o passo 1 do balcao), ou null se nao existe. */
    public java.util.Map<String, Object> buscarPacientePorCpf(String cpf) throws SQLException {
        String sql = "SELECT p.id, p.nome, p.cartao_sus, p.data_nascimento, p.telefone, p.cadastro_presencial, "
                + "TIMESTAMPDIFF(YEAR, p.data_nascimento, CURDATE()) AS idade, "
                + "(SELECT COUNT(*) FROM solicitacao s WHERE s.paciente_id = p.id) AS pedidos, "
                + "(SELECT COUNT(*) FROM solicitacao s WHERE s.paciente_id = p.id AND " + EM_ABERTO + ") AS abertos "
                + "FROM paciente p WHERE p.cpf = ?";
        try (Connection c = ConnectionFactory.getConnection();
             PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, cpf);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    return null;
                }
                java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
                m.put("nome", rs.getString("nome"));
                m.put("nascimento", rs.getDate("data_nascimento").toLocalDate().toString());
                m.put("idade", rs.getInt("idade"));
                m.put("telefone", rs.getString("telefone"));
                m.put("cartaoSus", rs.getString("cartao_sus"));
                m.put("cadastroPresencial", rs.getBoolean("cadastro_presencial"));
                m.put("pedidos", rs.getInt("pedidos"));
                m.put("abertos", rs.getInt("abertos"));
                return m;
            }
        }
    }

    /**
     * Registra no balcao: usa o cadastro do CPF (se existir) ou cria um cadastro presencial,
     * e grava o pedido (canal BALCAO), a prioridade e o historico numa unica transacao.
     */
    public String criarBalcao(NovaSolicitacao n, int usuarioId) throws SQLException, ConflitoException {
        try (Connection c = ConnectionFactory.getConnection()) {
            c.setAutoCommit(false);
            try {
                boolean cirurgia = servicoSomenteEquipe(c, n.servicoId);
                if (cirurgia && (n.cirurgiaProcedimento == null || n.cirurgiaHospital == null)) {
                    throw new ConflitoException("Informe o procedimento e o hospital da cirurgia.");
                }
                long pacienteId;
                try (PreparedStatement ps = c.prepareStatement("SELECT id FROM paciente WHERE cpf = ? FOR UPDATE")) {
                    ps.setString(1, n.cpf);
                    try (ResultSet rs = ps.executeQuery()) {
                        pacienteId = rs.next() ? rs.getLong(1) : 0;
                    }
                }
                if (pacienteId == 0) {
                    if (n.nome == null || n.nascimento == null) {
                        throw new ConflitoException("CPF sem cadastro: informe nome e data de nascimento.");
                    }
                    try (PreparedStatement ps = c.prepareStatement(
                            "INSERT INTO paciente (nome, cpf, cartao_sus, data_nascimento, telefone, cadastro_presencial, cadastrado_por) "
                            + "VALUES (?,?,?,?,?,1,?)", Statement.RETURN_GENERATED_KEYS)) {
                        ps.setString(1, n.nome);
                        ps.setString(2, n.cpf);
                        ps.setString(3, n.cartaoSus);
                        ps.setDate(4, Date.valueOf(n.nascimento));
                        ps.setString(5, n.telefone);
                        ps.setInt(6, usuarioId);
                        ps.executeUpdate();
                        try (ResultSet rs = ps.getGeneratedKeys()) {
                            rs.next();
                            pacienteId = rs.getLong(1);
                        }
                    }
                }
                long id;
                String provisorio = "tmp" + UUID.randomUUID().toString().replace("-", "").substring(0, 16);
                try (PreparedStatement ps = c.prepareStatement(
                        "INSERT INTO solicitacao (protocolo, paciente_id, ubs_id, servico_id, status, mensagem_publica, "
                        + "anexo_arquivo, anexo_nome_original, anexo_tipo, canal, criado_por, "
                        + "prioridade, prioridade_motivo, prioridade_por, prioridade_em, "
                        + "cirurgia_procedimento, cirurgia_hospital, preop_exames, preop_risco, preop_termo, preop_orientado, "
                        + "consentimento_lgpd, data_consentimento) "
                        + "VALUES (?,?,?,?, 'RECEBIDA', ?, ?,?,?, 'BALCAO', ?, ?,?,?,?, ?,?,?,?,?,?, 1, NOW())",
                        Statement.RETURN_GENERATED_KEYS)) {
                    boolean temPrioridade = n.prioridade != Prioridade.NORMAL || n.prioridadeMotivo != null;
                    int i = 1;
                    ps.setString(i++, provisorio);
                    ps.setLong(i++, pacienteId);
                    ps.setInt(i++, n.ubsId);
                    ps.setInt(i++, n.servicoId);
                    ps.setString(i++, Status.RECEBIDA.getMensagemPadrao());
                    ps.setString(i++, n.anexoArquivo);
                    ps.setString(i++, n.anexoNomeOriginal);
                    ps.setString(i++, n.anexoTipo);
                    ps.setInt(i++, usuarioId);
                    ps.setString(i++, n.prioridade.name());
                    ps.setString(i++, n.prioridadeMotivo);
                    ps.setObject(i++, temPrioridade ? usuarioId : null);
                    ps.setTimestamp(i++, temPrioridade ? new Timestamp(System.currentTimeMillis()) : null);
                    ps.setString(i++, cirurgia ? n.cirurgiaProcedimento : null);
                    ps.setString(i++, cirurgia ? n.cirurgiaHospital : null);
                    ps.setBoolean(i++, cirurgia && n.preopExames);
                    ps.setBoolean(i++, cirurgia && n.preopRisco);
                    ps.setBoolean(i++, cirurgia && n.preopTermo);
                    ps.setBoolean(i++, cirurgia && n.preopOrientado);
                    ps.executeUpdate();
                    try (ResultSet rs = ps.getGeneratedKeys()) {
                        rs.next();
                        id = rs.getLong(1);
                    }
                }
                String protocolo = LocalDate.now().getYear() + "-" + String.format("%05d", id);
                try (PreparedStatement ps = c.prepareStatement("UPDATE solicitacao SET protocolo = ? WHERE id = ?")) {
                    ps.setString(1, protocolo);
                    ps.setLong(2, id);
                    ps.executeUpdate();
                }
                try (PreparedStatement ps = c.prepareStatement(
                        "INSERT INTO historico_solicitacao (solicitacao_id, usuario_id, status_novo, observacao) "
                        + "VALUES (?, ?, 'RECEBIDA', ?)")) {
                    ps.setLong(1, id);
                    ps.setInt(2, usuarioId);
                    String obs = "Atendimento presencial" + (n.observacao == null ? "" : " • " + n.observacao);
                    ps.setString(3, obs.length() > 500 ? obs.substring(0, 500) : obs);
                    ps.executeUpdate();
                }
                c.commit();
                return protocolo;
            } catch (SQLException | ConflitoException | RuntimeException e) {
                c.rollback();
                throw e;
            }
        }
    }

    /** Checklist do pre-operatorio da cirurgia eletiva (com historico). */
    public boolean atualizarPreOp(long id, boolean exames, boolean risco, boolean termo, boolean orientado, int usuarioId)
            throws SQLException {
        try (Connection c = ConnectionFactory.getConnection()) {
            c.setAutoCommit(false);
            try {
                String status;
                try (PreparedStatement ps = c.prepareStatement(
                        "SELECT status FROM solicitacao WHERE id = ? AND cirurgia_procedimento IS NOT NULL FOR UPDATE")) {
                    ps.setLong(1, id);
                    try (ResultSet rs = ps.executeQuery()) {
                        if (!rs.next()) {
                            c.rollback();
                            return false;
                        }
                        status = rs.getString(1);
                    }
                }
                try (PreparedStatement ps = c.prepareStatement(
                        "UPDATE solicitacao SET preop_exames = ?, preop_risco = ?, preop_termo = ?, preop_orientado = ? WHERE id = ?")) {
                    ps.setBoolean(1, exames);
                    ps.setBoolean(2, risco);
                    ps.setBoolean(3, termo);
                    ps.setBoolean(4, orientado);
                    ps.setLong(5, id);
                    ps.executeUpdate();
                }
                int feitos = (exames ? 1 : 0) + (risco ? 1 : 0) + (termo ? 1 : 0) + (orientado ? 1 : 0);
                try (PreparedStatement ps = c.prepareStatement(
                        "INSERT INTO historico_solicitacao (solicitacao_id, usuario_id, status_anterior, status_novo, observacao) "
                        + "VALUES (?,?,?,?,?)")) {
                    ps.setLong(1, id);
                    ps.setInt(2, usuarioId);
                    ps.setString(3, status);
                    ps.setString(4, status);
                    ps.setString(5, "Pré-operatório: " + feitos + " de 4");
                    ps.executeUpdate();
                }
                c.commit();
                return true;
            } catch (SQLException | RuntimeException e) {
                c.rollback();
                throw e;
            }
        }
    }

    /** O paciente e identificado pelo CPF (ou pelo Cartao SUS); os dois precisam bater com o cadastro. */
    private long obterOuCriarPaciente(Connection c, NovaSolicitacao n) throws SQLException, ConflitoException {
        try (PreparedStatement ps = c.prepareStatement(
                "SELECT id, cpf, cartao_sus, data_nascimento FROM paciente WHERE cpf = ? OR cartao_sus = ? FOR UPDATE")) {
            ps.setString(1, n.cpf);
            ps.setString(2, n.cartaoSus);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    long id = rs.getLong("id");
                    // cadastro feito no balcao pode estar sem Cartao SUS: aceita e completa
                    String susCadastro = rs.getString("cartao_sus");
                    boolean mesmaPessoa = n.cpf.equals(rs.getString("cpf"))
                            && (susCadastro == null || n.cartaoSus.equals(susCadastro))
                            && rs.getDate("data_nascimento").toLocalDate().equals(n.nascimento);
                    // rs.next() de novo: CPF de uma pessoa e Cartao SUS de outra
                    if (!mesmaPessoa || rs.next()) {
                        throw new ConflitoException(
                                "CPF, Cartão SUS ou data de nascimento não conferem com o cadastro existente. "
                                + "Procure sua UBS de referência.");
                    }
                    try (PreparedStatement up = c.prepareStatement(
                            "UPDATE paciente SET telefone = ?, cartao_sus = COALESCE(cartao_sus, ?) WHERE id = ?")) {
                        up.setString(1, n.telefone);
                        up.setString(2, n.cartaoSus);
                        up.setLong(3, id);
                        up.executeUpdate();
                    }
                    return id;
                }
            }
        }
        try (PreparedStatement ps = c.prepareStatement(
                "INSERT INTO paciente (nome, cpf, cartao_sus, data_nascimento, telefone) VALUES (?,?,?,?,?)",
                Statement.RETURN_GENERATED_KEYS)) {
            ps.setString(1, n.nome);
            ps.setString(2, n.cpf);
            ps.setString(3, n.cartaoSus);
            ps.setDate(4, Date.valueOf(n.nascimento));
            ps.setString(5, n.telefone);
            ps.executeUpdate();
            try (ResultSet rs = ps.getGeneratedKeys()) {
                rs.next();
                return rs.getLong(1);
            }
        }
    }

    private long inserirSolicitacao(Connection c, long pacienteId, NovaSolicitacao n) throws SQLException {
        String sql = "INSERT INTO solicitacao (protocolo, paciente_id, ubs_id, servico_id, status, mensagem_publica, "
                + "anexo_arquivo, anexo_nome_original, anexo_tipo, consentimento_lgpd, data_consentimento) "
                + "VALUES (?,?,?,?, 'RECEBIDA', ?, ?,?,?, 1, NOW())";
        // protocolo provisorio (substituido logo apos obtermos o id)
        String provisorio = "tmp" + UUID.randomUUID().toString().replace("-", "").substring(0, 16);
        try (PreparedStatement ps = c.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            ps.setString(1, provisorio);
            ps.setLong(2, pacienteId);
            ps.setInt(3, n.ubsId);
            ps.setInt(4, n.servicoId);
            ps.setString(5, Status.RECEBIDA.getMensagemPadrao());
            ps.setString(6, n.anexoArquivo);
            ps.setString(7, n.anexoNomeOriginal);
            ps.setString(8, n.anexoTipo);
            ps.executeUpdate();
            try (ResultSet rs = ps.getGeneratedKeys()) {
                rs.next();
                return rs.getLong(1);
            }
        }
    }

    // ------------------------------------------------------------------
    // Consulta publica (municipe): pelo CPF
    // ------------------------------------------------------------------
    public List<Solicitacao> buscarParaMunicipe(String cpf) throws SQLException {
        String sql = SELECT_BASE + "WHERE p.cpf = ? ORDER BY s.criado_em DESC LIMIT 20";
        List<Solicitacao> lista = new ArrayList<>();
        try (Connection c = ConnectionFactory.getConnection();
             PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, cpf);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    lista.add(mapear(rs));
                }
            }
        }
        return lista;
    }

    // ------------------------------------------------------------------
    // Painel do servidor
    // ------------------------------------------------------------------
    /**
     * Lista do painel, ja na ordem da fila.
     * @param minDias se > 0, so pedidos EM ABERTO esperando ha pelo menos esse numero de dias.
     */
    public List<Solicitacao> listarPainel(String status, String busca, String prioridade, int minDias)
            throws SQLException {
        StringBuilder sql = new StringBuilder(SELECT_BASE).append("WHERE 1=1 ");
        List<Object> params = new ArrayList<>();
        if (status != null && !status.isEmpty()) {
            sql.append("AND s.status = ? ");
            params.add(status);
        }
        if (prioridade != null && !prioridade.isEmpty()) {
            sql.append("AND s.prioridade = ? ");
            params.add(prioridade);
        }
        if (minDias > 0) {
            sql.append("AND ").append(EM_ABERTO).append(" AND DATEDIFF(NOW(), s.criado_em) >= ? ");
            params.add(minDias);
        }
        if (busca != null && !busca.isEmpty()) {
            sql.append("AND (s.protocolo LIKE ? OR p.nome LIKE ? OR p.cartao_sus LIKE ? OR p.cpf LIKE ?) ");
            String like = "%" + busca.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
            String likeDigitos = "%" + busca.replaceAll("\\D", "") + "%";
            params.add(like);
            params.add(like);
            params.add(likeDigitos.length() > 2 ? likeDigitos : like);
            params.add(likeDigitos.length() > 2 ? likeDigitos : like);
        }
        sql.append(ORDEM_FILA).append("LIMIT 300");

        List<Solicitacao> lista = new ArrayList<>();
        try (Connection c = ConnectionFactory.getConnection();
             PreparedStatement ps = c.prepareStatement(sql.toString())) {
            for (int i = 0; i < params.size(); i++) {
                ps.setObject(i + 1, params.get(i));
            }
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    lista.add(mapear(rs));
                }
            }
        }
        return lista;
    }

    /** @return false se a solicitacao nao existe. */
    public boolean atualizarStatus(long id, Status novo, String mensagemPublica, String obsInterna, int usuarioId)
            throws SQLException {
        try (Connection c = ConnectionFactory.getConnection()) {
            c.setAutoCommit(false);
            try {
                String anterior;
                try (PreparedStatement ps = c.prepareStatement(
                        "SELECT status FROM solicitacao WHERE id = ? FOR UPDATE")) {
                    ps.setLong(1, id);
                    try (ResultSet rs = ps.executeQuery()) {
                        if (!rs.next()) {
                            c.rollback();
                            return false;
                        }
                        anterior = rs.getString("status");
                    }
                }
                String msg = (mensagemPublica == null || mensagemPublica.trim().isEmpty())
                        ? novo.getMensagemPadrao() : mensagemPublica.trim();
                try (PreparedStatement ps = c.prepareStatement(
                        "UPDATE solicitacao SET status = ?, mensagem_publica = ? WHERE id = ?")) {
                    ps.setString(1, novo.name());
                    ps.setString(2, msg);
                    ps.setLong(3, id);
                    ps.executeUpdate();
                }
                // voltou para a fila, negado ou cancelado: libera a vaga da agenda para outra pessoa
                // (concluida/faltou mantem a vaga como registro do atendimento)
                if (EnumSet.of(Status.RECEBIDA, Status.EM_TRIAGEM, Status.EM_ANALISE_REGULACAO, Status.NEGADA, Status.CANCELADA).contains(novo)) {
                    try (PreparedStatement ps = c.prepareStatement("DELETE FROM agenda_vaga WHERE solicitacao_id = ?")) {
                        ps.setLong(1, id);
                        ps.executeUpdate();
                    }
                }
                try (PreparedStatement ps = c.prepareStatement(
                        "INSERT INTO historico_solicitacao "
                        + "(solicitacao_id, usuario_id, status_anterior, status_novo, observacao) VALUES (?,?,?,?,?)")) {
                    ps.setLong(1, id);
                    ps.setInt(2, usuarioId);
                    ps.setString(3, anterior);
                    ps.setString(4, novo.name());
                    ps.setString(5, obsInterna == null || obsInterna.trim().isEmpty() ? null : obsInterna.trim());
                    ps.executeUpdate();
                }
                c.commit();
                return true;
            } catch (SQLException | RuntimeException e) {
                c.rollback();
                throw e;
            }
        }
    }

    /**
     * Define a prioridade (interna) e registra no historico quem mudou e por que.
     * @return false se a solicitacao nao existe.
     */
    public boolean atualizarPrioridade(long id, Prioridade prioridade, String motivo, int usuarioId)
            throws SQLException {
        try (Connection c = ConnectionFactory.getConnection()) {
            c.setAutoCommit(false);
            try {
                String status;
                try (PreparedStatement ps = c.prepareStatement(
                        "SELECT status FROM solicitacao WHERE id = ? FOR UPDATE")) {
                    ps.setLong(1, id);
                    try (ResultSet rs = ps.executeQuery()) {
                        if (!rs.next()) {
                            c.rollback();
                            return false;
                        }
                        status = rs.getString("status");
                    }
                }
                String m = motivo == null || motivo.trim().isEmpty() ? null : motivo.trim();
                // atualizado_em = atualizado_em: mudar a prioridade nao conta como "atualizacao" para o municipe
                try (PreparedStatement ps = c.prepareStatement(
                        "UPDATE solicitacao SET prioridade = ?, prioridade_motivo = ?, prioridade_por = ?, "
                        + "prioridade_em = NOW(), atualizado_em = atualizado_em WHERE id = ?")) {
                    ps.setString(1, prioridade.name());
                    ps.setString(2, m);
                    ps.setInt(3, usuarioId);
                    ps.setLong(4, id);
                    ps.executeUpdate();
                }
                try (PreparedStatement ps = c.prepareStatement(
                        "INSERT INTO historico_solicitacao "
                        + "(solicitacao_id, usuario_id, status_anterior, status_novo, observacao) VALUES (?,?,?,?,?)")) {
                    ps.setLong(1, id);
                    ps.setInt(2, usuarioId);
                    ps.setString(3, status);
                    ps.setString(4, status);
                    ps.setString(5, "Prioridade: " + prioridade.getRotulo() + (m == null ? "" : " — " + m));
                    ps.executeUpdate();
                }
                c.commit();
                return true;
            } catch (SQLException | RuntimeException e) {
                c.rollback();
                throw e;
            }
        }
    }

    public Anexo buscarAnexo(long id) throws SQLException {
        String sql = "SELECT anexo_arquivo, anexo_nome_original, anexo_tipo FROM solicitacao "
                + "WHERE id = ? AND anexo_arquivo IS NOT NULL";
        try (Connection c = ConnectionFactory.getConnection();
             PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setLong(1, id);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    return null;
                }
                Anexo a = new Anexo();
                a.arquivo = rs.getString("anexo_arquivo");
                a.nomeOriginal = rs.getString("anexo_nome_original");
                a.tipo = rs.getString("anexo_tipo");
                return a;
            }
        }
    }

    // ------------------------------------------------------------------
    private Solicitacao mapear(ResultSet rs) throws SQLException {
        Solicitacao s = new Solicitacao();
        s.id = rs.getLong("id");
        s.protocolo = rs.getString("protocolo");
        s.status = rs.getString("status");
        s.statusRotulo = Status.valueOf(s.status).getRotulo();
        s.paciente = rs.getString("paciente");
        s.cpf = rs.getString("cpf");
        s.cartaoSus = rs.getString("cartao_sus");
        s.telefone = rs.getString("telefone");
        s.nascimento = rs.getDate("data_nascimento").toLocalDate().toString();
        s.idade = rs.getInt("idade");
        s.diasEspera = Math.max(0, rs.getInt("dias_espera"));
        s.prioridade = rs.getString("prioridade");
        s.prioridadeRotulo = Prioridade.valueOf(s.prioridade).getRotulo();
        s.prioridadeMotivo = rs.getString("prioridade_motivo");
        s.prioridadePor = rs.getString("prioridade_por");
        Timestamp prioEm = rs.getTimestamp("prioridade_em");
        s.prioridadeEm = prioEm == null ? null : prioEm.toLocalDateTime().toString();
        s.canal = rs.getString("canal");
        s.criadoPor = rs.getString("criado_por");
        s.cirurgiaProcedimento = rs.getString("cirurgia_procedimento");
        s.cirurgiaHospital = rs.getString("cirurgia_hospital");
        if (s.cirurgiaProcedimento != null) {
            s.preOp = new java.util.LinkedHashMap<>();
            s.preOp.put("exames", rs.getBoolean("preop_exames"));
            s.preOp.put("riscoCirurgico", rs.getBoolean("preop_risco"));
            s.preOp.put("termo", rs.getBoolean("preop_termo"));
            s.preOp.put("orientado", rs.getBoolean("preop_orientado"));
        }
        java.sql.Date agData = rs.getDate("agenda_data");
        if (agData != null) {
            s.agendaData = agData.toLocalDate().toString();
            s.agendaHora = rs.getString("agenda_hora");
            s.agendaLocal = rs.getString("agenda_local");
            s.agendaProfissional = rs.getString("agenda_profissional");
            s.agendaOrientacoes = rs.getString("agenda_orientacoes");
            s.agendaId = rs.getInt("agenda_id");
            s.agendaVaga = rs.getInt("agenda_vaga");
        }
        s.servicoId = rs.getInt("servico_id");
        s.servico = rs.getString("servico");
        s.ubs = rs.getString("ubs");
        s.mensagemPublica = rs.getString("mensagem_publica");
        s.temAnexo = rs.getString("anexo_arquivo") != null;
        Timestamp criado = rs.getTimestamp("criado_em");
        Timestamp atual = rs.getTimestamp("atualizado_em");
        s.criadoEm = criado == null ? null : criado.toLocalDateTime().toString();
        s.atualizadoEm = atual == null ? null : atual.toLocalDateTime().toString();
        return s;
    }
}
