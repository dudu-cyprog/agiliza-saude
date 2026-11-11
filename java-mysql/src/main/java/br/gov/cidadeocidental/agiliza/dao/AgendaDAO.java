package br.gov.cidadeocidental.agiliza.dao;

import java.sql.Connection;
import java.sql.Date;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.SQLIntegrityConstraintViolationException;
import java.sql.Statement;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.stream.Collectors;

import br.gov.cidadeocidental.agiliza.model.Agenda;
import br.gov.cidadeocidental.agiliza.model.Profissional;
import br.gov.cidadeocidental.agiliza.util.ConnectionFactory;

/**
 * Profissionais, agendas e vagas (oferta de atendimento) + "preencher com a fila".
 * A fila de sugestao e calculada no proprio SQL (prioridade e, dentro dela, quem espera ha mais tempo).
 */
public class AgendaDAO {

    private static final String EM_ABERTO = "s.status IN ('RECEBIDA','EM_TRIAGEM','EM_ANALISE_REGULACAO')";
    /** Horario da vaga: hora_inicio + numero * intervalo (calculado no MySQL). */
    private static final String HORA_VAGA =
            "TIME_FORMAT(ADDTIME(a.hora_inicio, SEC_TO_TIME(v.numero * a.intervalo_min * 60)), '%H:%i')";

    // ------------------------------------------------------------------ profissionais
    public List<Profissional> listarProfissionais() throws SQLException {
        String sql = "SELECT pr.*, sv.nome AS servico FROM profissional pr JOIN servico sv ON sv.id = pr.servico_id "
                + "ORDER BY pr.ativo DESC, pr.nome";
        List<Profissional> lista = new ArrayList<>();
        try (Connection c = ConnectionFactory.getConnection();
             PreparedStatement ps = c.prepareStatement(sql);
             ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                Profissional p = new Profissional();
                p.id = rs.getInt("id");
                p.nome = rs.getString("nome");
                p.especialidade = rs.getString("especialidade");
                p.registro = rs.getString("registro");
                p.servicoId = rs.getInt("servico_id");
                p.servico = rs.getString("servico");
                p.local = rs.getString("local");
                p.diasSemana = Arrays.stream(rs.getString("dias_semana").split(",")).mapToInt(Integer::parseInt).toArray();
                p.horaInicio = rs.getString("hora_inicio").substring(0, 5);
                p.horaFim = rs.getString("hora_fim").substring(0, 5);
                p.duracaoMin = rs.getInt("duracao_min");
                p.ativo = rs.getBoolean("ativo");
                p.inativoDesde = iso(rs.getDate("inativo_desde"));
                p.feriasInicio = iso(rs.getDate("ferias_inicio"));
                p.feriasFim = iso(rs.getDate("ferias_fim"));
                p.feriasMotivo = rs.getString("ferias_motivo");
                p.vagasPorDia = (minutos(p.horaFim) - minutos(p.horaInicio)) / p.duracaoMin;
                lista.add(p);
            }
        }
        return lista;
    }

    public int criarProfissional(Profissional p) throws SQLException {
        String sql = "INSERT INTO profissional (nome, especialidade, registro, servico_id, local, dias_semana, "
                + "hora_inicio, hora_fim, duracao_min, ferias_inicio, ferias_fim, ferias_motivo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)";
        try (Connection c = ConnectionFactory.getConnection();
             PreparedStatement ps = c.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            preencherProfissional(ps, p);
            ps.executeUpdate();
            try (ResultSet rs = ps.getGeneratedKeys()) {
                rs.next();
                return rs.getInt(1);
            }
        }
    }

    /** Atualiza o cadastro (local, dias, horarios, ferias...). Nao mexe nas agendas ja criadas. */
    public boolean atualizarProfissional(Profissional p) throws SQLException {
        String sql = "UPDATE profissional SET nome = ?, especialidade = ?, registro = ?, servico_id = ?, local = ?, dias_semana = ?, "
                + "hora_inicio = ?, hora_fim = ?, duracao_min = ?, ferias_inicio = ?, ferias_fim = ?, ferias_motivo = ? WHERE id = ?";
        try (Connection c = ConnectionFactory.getConnection();
             PreparedStatement ps = c.prepareStatement(sql)) {
            preencherProfissional(ps, p);
            ps.setInt(13, p.id);
            return ps.executeUpdate() > 0;
        }
    }

    /** Desativa ("nao trabalha mais", sem apagar nada) ou reativa o profissional. */
    public boolean definirAtivo(int id, boolean ativo) throws SQLException {
        try (Connection c = ConnectionFactory.getConnection();
             PreparedStatement ps = c.prepareStatement(
                     "UPDATE profissional SET ativo = ?, inativo_desde = " + (ativo ? "NULL" : "CURDATE()") + " WHERE id = ?")) {
            ps.setBoolean(1, ativo);
            ps.setInt(2, id);
            return ps.executeUpdate() > 0;
        }
    }

    /**
     * Agendas futuras afetadas: no periodo de ferias, ou todas se o profissional foi desativado.
     * Usado para apagar esses dias (quem estava marcado volta para a fila).
     */
    public List<Integer> agendasAfetadas(int profissionalId) throws SQLException {
        String sql = "SELECT a.id FROM agenda a JOIN profissional pr ON pr.id = a.profissional_id "
                + "WHERE pr.id = ? AND a.data >= CURDATE() "
                + "AND (pr.ativo = 0 OR (pr.ferias_inicio IS NOT NULL AND a.data BETWEEN pr.ferias_inicio AND pr.ferias_fim))";
        List<Integer> ids = new ArrayList<>();
        try (Connection c = ConnectionFactory.getConnection();
             PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setInt(1, profissionalId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    ids.add(rs.getInt(1));
                }
            }
        }
        return ids;
    }

    private static void preencherProfissional(PreparedStatement ps, Profissional p) throws SQLException {
        ps.setString(1, p.nome);
        ps.setString(2, p.especialidade);
        ps.setString(3, p.registro);
        ps.setInt(4, p.servicoId);
        ps.setString(5, p.local);
        ps.setString(6, Arrays.stream(p.diasSemana).mapToObj(String::valueOf).collect(Collectors.joining(",")));
        ps.setString(7, p.horaInicio);
        ps.setString(8, p.horaFim);
        ps.setInt(9, p.duracaoMin);
        ps.setDate(10, p.feriasInicio == null ? null : Date.valueOf(p.feriasInicio));
        ps.setDate(11, p.feriasFim == null ? null : Date.valueOf(p.feriasFim));
        ps.setString(12, p.feriasInicio == null ? null : p.feriasMotivo);
    }

    private static String iso(Date d) {
        return d == null ? null : d.toLocalDate().toString();
    }

    /**
     * Cria as agendas das proximas semanas nos dias do profissional (pula os dias de ferias).
     * INSERT IGNORE + UNIQUE (profissional_id, data): dias que ja tem agenda nao sao duplicados.
     * @return quantas agendas novas foram criadas
     */
    public int gerarAgendas(int profissionalId, int semanas, int usuarioId) throws SQLException {
        Profissional p = listarProfissionais().stream().filter(x -> x.id == profissionalId).findFirst().orElse(null);
        if (p == null || !p.ativo) {
            return 0;
        }
        String sql = "INSERT IGNORE INTO agenda (servico_id, profissional_id, local, data, hora_inicio, intervalo_min, vagas, criado_por) "
                + "VALUES (?,?,?,?,?,?,?,?)";
        int criadas = 0;
        try (Connection c = ConnectionFactory.getConnection();
             PreparedStatement ps = c.prepareStatement(sql)) {
            for (int i = 1; i <= semanas * 7; i++) {
                LocalDate dia = LocalDate.now().plusDays(i);
                int diaSemana = dia.getDayOfWeek().getValue() % 7; // Java: segunda=1..domingo=7 -> domingo=0
                if (Arrays.stream(p.diasSemana).noneMatch(d -> d == diaSemana)) {
                    continue;
                }
                String data = dia.toString();
                if (p.feriasInicio != null && data.compareTo(p.feriasInicio) >= 0 && data.compareTo(p.feriasFim) <= 0) {
                    continue; // ferias/afastamento: nao abre vagas
                }
                ps.setInt(1, p.servicoId);
                ps.setInt(2, p.id);
                ps.setString(3, p.local);
                ps.setDate(4, Date.valueOf(dia));
                ps.setString(5, p.horaInicio);
                ps.setInt(6, p.duracaoMin);
                ps.setInt(7, p.vagasPorDia);
                ps.setInt(8, usuarioId);
                criadas += ps.executeUpdate();
            }
        }
        return criadas;
    }

    // ------------------------------------------------------------------ agendas
    public int criarAgendaAvulsa(Agenda a, int usuarioId) throws SQLException {
        String sql = "INSERT INTO agenda (servico_id, local, data, hora_inicio, intervalo_min, vagas, orientacoes, criado_por) "
                + "VALUES (?,?,?,?,?,?,?,?)";
        try (Connection c = ConnectionFactory.getConnection();
             PreparedStatement ps = c.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            ps.setInt(1, a.servicoId);
            ps.setString(2, a.local);
            ps.setDate(3, Date.valueOf(a.data));
            ps.setString(4, a.horaInicio);
            ps.setInt(5, a.intervaloMin);
            ps.setInt(6, a.vagas);
            ps.setString(7, a.orientacoes);
            ps.setInt(8, usuarioId);
            ps.executeUpdate();
            try (ResultSet rs = ps.getGeneratedKeys()) {
                rs.next();
                return rs.getInt(1);
            }
        }
    }

    private static final String SELECT_AGENDA =
            "SELECT a.*, sv.nome AS servico, pr.nome AS profissional, pr.especialidade, "
            + "(SELECT COUNT(*) FROM agenda_vaga v WHERE v.agenda_id = a.id) AS ocupadas, "
            + "(SELECT GROUP_CONCAT(v.numero) FROM agenda_vaga v WHERE v.agenda_id = a.id) AS nums "
            + "FROM agenda a JOIN servico sv ON sv.id = a.servico_id LEFT JOIN profissional pr ON pr.id = a.profissional_id ";

    /** Agendas de hoje em diante (ate 120), com a ocupacao. */
    public List<Agenda> listarAgendas() throws SQLException {
        List<Agenda> lista = new ArrayList<>();
        try (Connection c = ConnectionFactory.getConnection();
             PreparedStatement ps = c.prepareStatement(SELECT_AGENDA + "WHERE a.data >= CURDATE() ORDER BY a.data, a.hora_inicio LIMIT 120");
             ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                lista.add(mapearAgenda(rs));
            }
        }
        return lista;
    }

    /** Uma agenda com as vagas ocupadas (paciente, prioridade, espera). */
    public Agenda detalhar(int agendaId) throws SQLException {
        try (Connection c = ConnectionFactory.getConnection()) {
            Agenda a;
            try (PreparedStatement ps = c.prepareStatement(SELECT_AGENDA + "WHERE a.id = ?")) {
                ps.setInt(1, agendaId);
                try (ResultSet rs = ps.executeQuery()) {
                    if (!rs.next()) {
                        return null;
                    }
                    a = mapearAgenda(rs);
                }
            }
            a.vagasOcupadas = new ArrayList<>();
            String sql = "SELECT v.numero, " + HORA_VAGA + " AS hora, s.id, s.protocolo, s.status, s.prioridade, "
                    + "DATEDIFF(NOW(), s.criado_em) AS dias, p.nome, p.cpf, p.telefone "
                    + "FROM agenda_vaga v JOIN agenda a ON a.id = v.agenda_id "
                    + "JOIN solicitacao s ON s.id = v.solicitacao_id JOIN paciente p ON p.id = s.paciente_id "
                    + "WHERE v.agenda_id = ? ORDER BY v.numero";
            try (PreparedStatement ps = c.prepareStatement(sql)) {
                ps.setInt(1, agendaId);
                try (ResultSet rs = ps.executeQuery()) {
                    while (rs.next()) {
                        Agenda.Vaga v = new Agenda.Vaga();
                        v.numero = rs.getInt("numero");
                        v.hora = rs.getString("hora");
                        v.solicitacaoId = rs.getLong("id");
                        v.protocolo = rs.getString("protocolo");
                        v.status = rs.getString("status");
                        v.prioridade = rs.getString("prioridade");
                        v.diasEspera = rs.getInt("dias");
                        v.paciente = rs.getString("nome");
                        v.cpf = rs.getString("cpf");
                        v.telefone = rs.getString("telefone");
                        a.vagasOcupadas.add(v);
                    }
                }
            }
            return a;
        }
    }

    /**
     * "Preencher com a fila": os proximos pedidos EM ABERTO do servico da agenda que ainda nao tem vaga,
     * na ordem da fila: Urgente -> Prioritario -> Normal e, dentro de cada um, o pedido mais antigo primeiro.
     */
    public List<Agenda.Candidato> candidatos(int agendaId, int limite) throws SQLException {
        String sql = "SELECT s.id, s.protocolo, p.nome, s.prioridade, s.prioridade_motivo, "
                + "DATEDIFF(NOW(), s.criado_em) AS dias, TIMESTAMPDIFF(YEAR, p.data_nascimento, CURDATE()) AS idade "
                + "FROM solicitacao s JOIN paciente p ON p.id = s.paciente_id "
                + "WHERE s.servico_id = (SELECT servico_id FROM agenda WHERE id = ?) AND " + EM_ABERTO + " "
                + "AND NOT EXISTS (SELECT 1 FROM agenda_vaga v WHERE v.solicitacao_id = s.id) "
                + "ORDER BY FIELD(s.prioridade, 'URGENTE', 'PRIORITARIO', 'NORMAL'), s.criado_em "
                + "LIMIT ?";
        List<Agenda.Candidato> lista = new ArrayList<>();
        try (Connection c = ConnectionFactory.getConnection();
             PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setInt(1, agendaId);
            ps.setInt(2, limite);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    Agenda.Candidato cd = new Agenda.Candidato();
                    cd.solicitacaoId = rs.getLong("id");
                    cd.protocolo = rs.getString("protocolo");
                    cd.paciente = rs.getString("nome");
                    cd.prioridade = rs.getString("prioridade");
                    cd.prioridadeMotivo = rs.getString("prioridade_motivo");
                    cd.diasEspera = rs.getInt("dias");
                    cd.idade = rs.getInt("idade");
                    lista.add(cd);
                }
            }
        }
        return lista;
    }

    /**
     * Marca o pedido na vaga (uma transacao): ocupa a vaga, pedido "Agendada" com a mensagem e historico.
     * A PRIMARY KEY (agenda, numero) impede duas pessoas na mesma vaga.
     */
    public void marcar(int agendaId, int numero, long solicitacaoId, int usuarioId) throws SQLException, ConflitoException {
        try (Connection c = ConnectionFactory.getConnection()) {
            c.setAutoCommit(false);
            try {
                String data;
                String hora;
                String local;
                String profissional;
                try (PreparedStatement ps = c.prepareStatement(
                        "SELECT a.vagas, a.data, a.local, a.orientacoes, pr.nome AS prof, pr.especialidade, "
                        + "TIME_FORMAT(ADDTIME(a.hora_inicio, SEC_TO_TIME(? * a.intervalo_min * 60)), '%H:%i') AS hora "
                        + "FROM agenda a LEFT JOIN profissional pr ON pr.id = a.profissional_id WHERE a.id = ? FOR UPDATE")) {
                    ps.setInt(1, numero);
                    ps.setInt(2, agendaId);
                    try (ResultSet rs = ps.executeQuery()) {
                        if (!rs.next()) {
                            throw new ConflitoException("Agenda não encontrada.");
                        }
                        if (numero < 0 || numero >= rs.getInt("vagas")) {
                            throw new ConflitoException("Vaga inexistente nesta agenda.");
                        }
                        LocalDate dia = rs.getDate("data").toLocalDate();
                        if (dia.isBefore(LocalDate.now())) {
                            throw new ConflitoException("Essa agenda já passou.");
                        }
                        // "terça-feira, 03/11/2026"
                        data = dia.format(DateTimeFormatter.ofPattern("EEEE, dd/MM/yyyy", new Locale("pt", "BR")));
                        hora = rs.getString("hora");
                        local = rs.getString("local");
                        profissional = rs.getString("prof") == null ? null : rs.getString("prof") + " (" + rs.getString("especialidade") + ")";
                    }
                }
                String anterior;
                // em aberto (marcar) ou ja agendado (reagendar para outro medico/dia/horario)
                try (PreparedStatement ps = c.prepareStatement("SELECT status FROM solicitacao s WHERE s.id = ? AND ("
                        + EM_ABERTO + " OR s.status = 'AGENDADA') FOR UPDATE")) {
                    ps.setLong(1, solicitacaoId);
                    try (ResultSet rs = ps.executeQuery()) {
                        if (!rs.next()) {
                            throw new ConflitoException("O pedido não está mais em aberto.");
                        }
                        anterior = rs.getString(1);
                    }
                }
                String antes = null;
                if ("AGENDADA".equals(anterior)) {
                    // reagendar: guarda a marcacao antiga para o historico e libera a vaga dela
                    try (PreparedStatement ps = c.prepareStatement("SELECT DATE_FORMAT(a.data, '%d/%m/%Y') AS d, " + HORA_VAGA + " AS h "
                            + "FROM agenda_vaga v JOIN agenda a ON a.id = v.agenda_id WHERE v.solicitacao_id = ?")) {
                        ps.setLong(1, solicitacaoId);
                        try (ResultSet rs = ps.executeQuery()) {
                            if (rs.next()) {
                                antes = rs.getString("d") + " " + rs.getString("h");
                            }
                        }
                    }
                    try (PreparedStatement ps = c.prepareStatement("DELETE FROM agenda_vaga WHERE solicitacao_id = ?")) {
                        ps.setLong(1, solicitacaoId);
                        ps.executeUpdate();
                    }
                }
                try (PreparedStatement ps = c.prepareStatement(
                        "INSERT INTO agenda_vaga (agenda_id, numero, solicitacao_id, marcado_por) VALUES (?,?,?,?)")) {
                    ps.setInt(1, agendaId);
                    ps.setInt(2, numero);
                    ps.setLong(3, solicitacaoId);
                    ps.setInt(4, usuarioId);
                    ps.executeUpdate();
                } catch (SQLIntegrityConstraintViolationException e) {
                    throw new ConflitoException("Essa vaga (ou esse pedido) já está ocupada.");
                }
                String texto = "Atendimento marcado: " + data + " às " + hora + " • " + local
                        + (profissional == null ? "" : " • " + profissional) + ".";
                try (PreparedStatement ps = c.prepareStatement(
                        "UPDATE solicitacao SET status = 'AGENDADA', mensagem_publica = ? WHERE id = ?")) {
                    ps.setString(1, texto.length() > 500 ? texto.substring(0, 500) : texto);
                    ps.setLong(2, solicitacaoId);
                    ps.executeUpdate();
                }
                historico(c, solicitacaoId, usuarioId, anterior, "AGENDADA", (antes != null ? "Reagendado" : "Marcado pela agenda")
                        + ": " + data + " " + hora + (profissional == null ? "" : " com " + profissional) + (antes != null ? " (antes: " + antes + ")" : ""));
                c.commit();
            } catch (SQLException | ConflitoException | RuntimeException e) {
                c.rollback();
                throw e;
            }
        }
    }

    /**
     * Apaga a agenda do dia. Quem estava marcado volta para a fila (sem perder o tempo de espera).
     * As vagas somem junto (ON DELETE CASCADE).
     * @return quantos pacientes voltaram para a fila, ou -1 se a agenda nao existe
     */
    public int apagarAgenda(int agendaId, int usuarioId) throws SQLException {
        try (Connection c = ConnectionFactory.getConnection()) {
            c.setAutoCommit(false);
            try {
                String data;
                try (PreparedStatement ps = c.prepareStatement("SELECT DATE_FORMAT(data, '%d/%m/%Y') FROM agenda WHERE id = ? FOR UPDATE")) {
                    ps.setInt(1, agendaId);
                    try (ResultSet rs = ps.executeQuery()) {
                        if (!rs.next()) {
                            c.rollback();
                            return -1;
                        }
                        data = rs.getString(1);
                    }
                }
                List<Long> marcados = new ArrayList<>();
                try (PreparedStatement ps = c.prepareStatement(
                        "SELECT v.solicitacao_id FROM agenda_vaga v JOIN solicitacao s ON s.id = v.solicitacao_id "
                        + "WHERE v.agenda_id = ? AND s.status = 'AGENDADA' FOR UPDATE")) {
                    ps.setInt(1, agendaId);
                    try (ResultSet rs = ps.executeQuery()) {
                        while (rs.next()) {
                            marcados.add(rs.getLong(1));
                        }
                    }
                }
                try (PreparedStatement ps = c.prepareStatement(
                        "UPDATE solicitacao SET status = 'EM_ANALISE_REGULACAO', mensagem_publica = ? WHERE id = ?")) {
                    for (long id : marcados) {
                        ps.setString(1, "O dia do seu atendimento foi cancelado pela Secretaria e o pedido voltou para a fila "
                                + "(sem perder o tempo de espera). Aguarde nova marcação.");
                        ps.setLong(2, id);
                        ps.executeUpdate();
                        historico(c, id, usuarioId, "AGENDADA", "EM_ANALISE_REGULACAO", "Agenda de " + data + " apagada; voltou para a fila");
                    }
                }
                try (PreparedStatement ps = c.prepareStatement("DELETE FROM agenda WHERE id = ?")) {
                    ps.setInt(1, agendaId);
                    ps.executeUpdate();
                }
                c.commit();
                return marcados.size();
            } catch (SQLException | RuntimeException e) {
                c.rollback();
                throw e;
            }
        }
    }

    /** Libera a vaga: o pedido volta para a fila (o tempo de espera continua contando desde o pedido). */
    public boolean liberar(int agendaId, int numero, int usuarioId) throws SQLException {
        try (Connection c = ConnectionFactory.getConnection()) {
            c.setAutoCommit(false);
            try {
                long solicitacaoId;
                try (PreparedStatement ps = c.prepareStatement(
                        "SELECT solicitacao_id FROM agenda_vaga WHERE agenda_id = ? AND numero = ? FOR UPDATE")) {
                    ps.setInt(1, agendaId);
                    ps.setInt(2, numero);
                    try (ResultSet rs = ps.executeQuery()) {
                        if (!rs.next()) {
                            c.rollback();
                            return false;
                        }
                        solicitacaoId = rs.getLong(1);
                    }
                }
                try (PreparedStatement ps = c.prepareStatement("DELETE FROM agenda_vaga WHERE agenda_id = ? AND numero = ?")) {
                    ps.setInt(1, agendaId);
                    ps.setInt(2, numero);
                    ps.executeUpdate();
                }
                try (PreparedStatement ps = c.prepareStatement(
                        "UPDATE solicitacao SET status = 'EM_ANALISE_REGULACAO', mensagem_publica = ? WHERE id = ? AND status = 'AGENDADA'")) {
                    ps.setString(1, "Seu atendimento foi desmarcado e o pedido voltou para a fila (sem perder o tempo de espera). Aguarde nova marcação.");
                    ps.setLong(2, solicitacaoId);
                    if (ps.executeUpdate() > 0) {
                        historico(c, solicitacaoId, usuarioId, "AGENDADA", "EM_ANALISE_REGULACAO", "Vaga liberada; voltou para a fila");
                    }
                }
                c.commit();
                return true;
            } catch (SQLException | RuntimeException e) {
                c.rollback();
                throw e;
            }
        }
    }

    // ------------------------------------------------------------------
    private static void historico(Connection c, long solicitacaoId, int usuarioId, String anterior, String novo, String obs)
            throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(
                "INSERT INTO historico_solicitacao (solicitacao_id, usuario_id, status_anterior, status_novo, observacao) VALUES (?,?,?,?,?)")) {
            ps.setLong(1, solicitacaoId);
            ps.setInt(2, usuarioId);
            ps.setString(3, anterior);
            ps.setString(4, novo);
            ps.setString(5, obs);
            ps.executeUpdate();
        }
    }

    private static Agenda mapearAgenda(ResultSet rs) throws SQLException {
        Agenda a = new Agenda();
        a.id = rs.getInt("id");
        a.servicoId = rs.getInt("servico_id");
        a.servico = rs.getString("servico");
        int prof = rs.getInt("profissional_id");
        a.profissionalId = rs.wasNull() ? null : prof;
        a.profissional = rs.getString("profissional");
        a.especialidade = rs.getString("especialidade");
        a.local = rs.getString("local");
        a.data = rs.getDate("data").toLocalDate().toString();
        a.horaInicio = rs.getString("hora_inicio").substring(0, 5);
        a.intervaloMin = rs.getInt("intervalo_min");
        a.vagas = rs.getInt("vagas");
        a.orientacoes = rs.getString("orientacoes");
        a.ocupadas = rs.getInt("ocupadas");
        String nums = rs.getString("nums");
        a.ocupadasNums = nums == null ? new ArrayList<>()
                : Arrays.stream(nums.split(",")).map(Integer::valueOf).collect(Collectors.toList());
        return a;
    }

    private static int minutos(String hhmm) {
        return Integer.parseInt(hhmm.substring(0, 2)) * 60 + Integer.parseInt(hhmm.substring(3, 5));
    }
}
