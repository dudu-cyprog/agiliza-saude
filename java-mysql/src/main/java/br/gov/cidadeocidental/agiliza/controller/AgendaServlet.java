package br.gov.cidadeocidental.agiliza.controller;

import java.io.IOException;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import br.gov.cidadeocidental.agiliza.dao.AgendaDAO;
import br.gov.cidadeocidental.agiliza.dao.ConflitoException;
import br.gov.cidadeocidental.agiliza.model.Agenda;
import br.gov.cidadeocidental.agiliza.model.Profissional;
import br.gov.cidadeocidental.agiliza.model.Usuario;
import br.gov.cidadeocidental.agiliza.util.Json;

/**
 * Agendas e medicos (protegido pelo AuthFilter; criar e marcar so Regulador/Admin).
 *   GET  /api/painel/agendas/profissionais
 *   GET  /api/painel/agendas/lista
 *   GET  /api/painel/agendas/detalhe?id=
 *   GET  /api/painel/agendas/sugestao?id=        ("Preencher com a fila": vagas livres x proximos da fila)
 *   POST /api/painel/agendas/profissionais       {nome, especialidade, registro, servicoId, local, diasSemana, horaInicio, horaFim, duracaoMin}
 *        (com "id" no corpo = editar o cadastro; feriasInicio/feriasFim/feriasMotivo opcionais)
 *   POST /api/painel/agendas/profissionais/ativo {id, ativo}  (desativar sem apagar / reativar)
 *   POST /api/painel/agendas/profissionais/limpar {id}       (apaga os dias de agenda nas ferias ou apos desativar)
 *   POST /api/painel/agendas/gerar              {id, semanas}
 *   POST /api/painel/agendas/avulsa              {servicoId, local, data, horaInicio, intervaloMin, vagas, orientacoes}
 *   POST /api/painel/agendas/apagar              {id}   (quem estava marcado volta para a fila)
 *   POST /api/painel/agendas/marcar              {agendaId, marcacoes:[{numero, solicitacaoId}]}  (tambem reagenda)
 *   POST /api/painel/agendas/liberar             {agendaId, numero}
 */
@WebServlet("/api/painel/agendas/*")
public class AgendaServlet extends HttpServlet {
    private static final long serialVersionUID = 1L;
    private static final String HORA = "^([01][0-9]|2[0-3]):[0-5][0-9]$";
    private final AgendaDAO dao = new AgendaDAO();

    static class Gerar {
        Integer id;
        Integer semanas;
    }

    static class Marcacao {
        Integer numero;
        Long solicitacaoId;
    }

    static class Marcar {
        Integer agendaId;
        List<Marcacao> marcacoes;
    }

    static class Ativo {
        Integer id;
        Boolean ativo;
    }

    static class Liberar {
        Integer agendaId;
        Integer numero;
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        String caminho = req.getPathInfo() == null ? "" : req.getPathInfo();
        try {
            switch (caminho) {
                case "/profissionais":
                    Json.escrever(resp, 200, Collections.singletonMap("profissionais", dao.listarProfissionais()));
                    break;
                case "/lista":
                    Json.escrever(resp, 200, Collections.singletonMap("agendas", dao.listarAgendas()));
                    break;
                case "/detalhe": {
                    Agenda a = dao.detalhar(idParam(req));
                    if (a == null) {
                        Json.erro(resp, 404, "Agenda não encontrada.");
                    } else {
                        Json.escrever(resp, 200, a);
                    }
                    break;
                }
                case "/sugestao":
                    sugestao(idParam(req), resp);
                    break;
                default:
                    Json.erro(resp, 404, "Não encontrado.");
            }
        } catch (NumberFormatException e) {
            Json.erro(resp, 400, "Identificador inválido.");
        } catch (SQLException e) {
            log("Erro nas agendas", e);
            Json.erro(resp, 500, "Erro interno. Tente novamente.");
        }
    }

    /** Casa as vagas livres (em ordem de horario) com os proximos da fila (prioridade + espera). */
    private void sugestao(int agendaId, HttpServletResponse resp) throws IOException, SQLException {
        Agenda a = dao.detalhar(agendaId);
        if (a == null) {
            Json.erro(resp, 404, "Agenda não encontrada.");
            return;
        }
        boolean[] ocupada = new boolean[a.vagas];
        a.vagasOcupadas.forEach(v -> ocupada[v.numero] = true);
        List<Integer> livres = new ArrayList<>();
        for (int n = 0; n < a.vagas; n++) {
            if (!ocupada[n]) {
                livres.add(n);
            }
        }
        List<Agenda.Candidato> fila = dao.candidatos(agendaId, Math.max(1, livres.size() + 20));
        List<Map<String, Object>> propostas = new ArrayList<>();
        for (int i = 0; i < livres.size() && i < fila.size(); i++) {
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("numero", livres.get(i));
            p.put("solicitacaoId", fila.get(i).solicitacaoId);
            propostas.add(p);
        }
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("livres", livres);
        r.put("candidatos", fila);
        r.put("propostas", propostas);
        Json.escrever(resp, 200, r);
    }

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        Usuario u = (Usuario) req.getSession(false).getAttribute("usuario");
        if (!u.ehRegulador()) {
            Json.erro(resp, 403, "Apenas a regulação (Regulador/Admin) pode criar agendas e marcar vagas.");
            return;
        }
        String caminho = req.getPathInfo() == null ? "" : req.getPathInfo();
        try {
            switch (caminho) {
                case "/profissionais":
                    criarProfissional(req, resp);
                    break;
                case "/profissionais/ativo": {
                    Ativo a = Json.ler(req, Ativo.class);
                    if (a == null || a.id == null || a.ativo == null) {
                        Json.erro(resp, 400, "Dados incompletos.");
                        return;
                    }
                    if (!dao.definirAtivo(a.id, a.ativo)) {
                        Json.erro(resp, 404, "Profissional não encontrado.");
                        return;
                    }
                    Json.escrever(resp, 200, Collections.singletonMap("afetadas", dao.agendasAfetadas(a.id).size()));
                    break;
                }
                case "/profissionais/limpar": {
                    // apaga os dias de agenda no periodo de ferias (ou todos os futuros, se desativado)
                    Gerar g = Json.ler(req, Gerar.class);
                    if (g == null || g.id == null) {
                        Json.erro(resp, 400, "Dados incompletos.");
                        return;
                    }
                    int dias = 0;
                    int pacientes = 0;
                    for (int agendaId : dao.agendasAfetadas(g.id)) {
                        int n = dao.apagarAgenda(agendaId, u.id);
                        if (n >= 0) {
                            dias++;
                            pacientes += n;
                        }
                    }
                    Map<String, Object> r = new LinkedHashMap<>();
                    r.put("dias", dias);
                    r.put("voltaramParaFila", pacientes);
                    Json.escrever(resp, 200, r);
                    break;
                }
                case "/gerar": {
                    Gerar g = Json.ler(req, Gerar.class);
                    if (g == null || g.id == null) {
                        Json.erro(resp, 400, "Dados incompletos.");
                        return;
                    }
                    int semanas = g.semanas == null ? 4 : Math.max(1, Math.min(12, g.semanas));
                    Json.escrever(resp, 200, Collections.singletonMap("criadas", dao.gerarAgendas(g.id, semanas, u.id)));
                    break;
                }
                case "/avulsa":
                    criarAvulsa(req, resp, u);
                    break;
                case "/apagar": {
                    Gerar g = Json.ler(req, Gerar.class);
                    if (g == null || g.id == null) {
                        Json.erro(resp, 400, "Dados incompletos.");
                        return;
                    }
                    int devolvidos = dao.apagarAgenda(g.id, u.id);
                    if (devolvidos < 0) {
                        Json.erro(resp, 404, "Agenda não encontrada.");
                        return;
                    }
                    Json.escrever(resp, 200, Collections.singletonMap("voltaramParaFila", devolvidos));
                    break;
                }
                case "/marcar":
                    marcar(req, resp, u);
                    break;
                case "/liberar": {
                    Liberar l = Json.ler(req, Liberar.class);
                    if (l == null || l.agendaId == null || l.numero == null) {
                        Json.erro(resp, 400, "Dados incompletos.");
                        return;
                    }
                    if (!dao.liberar(l.agendaId, l.numero, u.id)) {
                        Json.erro(resp, 404, "Vaga já está livre.");
                        return;
                    }
                    Json.escrever(resp, 200, Collections.singletonMap("ok", true));
                    break;
                }
                default:
                    Json.erro(resp, 404, "Não encontrado.");
            }
        } catch (SQLException e) {
            log("Erro nas agendas", e);
            Json.erro(resp, 500, "Erro interno. Tente novamente.");
        }
    }

    private void criarProfissional(HttpServletRequest req, HttpServletResponse resp) throws IOException, SQLException {
        Profissional p = Json.ler(req, Profissional.class);
        if (p == null || vazio(p.nome) || vazio(p.especialidade) || vazio(p.local) || p.servicoId <= 0
                || p.diasSemana == null || p.diasSemana.length == 0 || p.horaInicio == null || p.horaFim == null) {
            Json.erro(resp, 400, "Preencha nome, especialidade, serviço, local, dias e horários.");
            return;
        }
        if (!p.horaInicio.matches(HORA) || !p.horaFim.matches(HORA) || p.horaFim.compareTo(p.horaInicio) <= 0) {
            Json.erro(resp, 400, "Horário inválido (o fim deve ser depois do início).");
            return;
        }
        if (p.duracaoMin < 5 || p.duracaoMin > 240 || Arrays.stream(p.diasSemana).anyMatch(d -> d < 0 || d > 6)) {
            Json.erro(resp, 400, "Duração (5 a 240 min) ou dias da semana inválidos.");
            return;
        }
        if (p.nome.length() > 120 || p.especialidade.length() > 80 || p.local.length() > 160
                || (p.registro != null && p.registro.length() > 40)) {
            Json.erro(resp, 400, "Texto muito longo.");
            return;
        }
        p.diasSemana = Arrays.stream(p.diasSemana).distinct().sorted().toArray();
        p.registro = vazio(p.registro) ? null : p.registro.trim();
        // ferias/afastamento: as duas datas ou nenhuma
        p.feriasInicio = vazio(p.feriasInicio) ? null : p.feriasInicio;
        p.feriasFim = vazio(p.feriasFim) ? null : p.feriasFim;
        try {
            if ((p.feriasInicio == null) != (p.feriasFim == null)
                    || (p.feriasInicio != null && LocalDate.parse(p.feriasFim).isBefore(LocalDate.parse(p.feriasInicio)))) {
                Json.erro(resp, 400, "Férias: preencha \"de\" e \"até\" (a data final depois da inicial), ou deixe as duas vazias.");
                return;
            }
        } catch (DateTimeParseException e) {
            Json.erro(resp, 400, "Data de férias inválida.");
            return;
        }
        p.feriasMotivo = p.feriasInicio == null ? null : (vazio(p.feriasMotivo) ? "Férias" : p.feriasMotivo.trim());
        if (p.feriasMotivo != null && p.feriasMotivo.length() > 80) {
            Json.erro(resp, 400, "Motivo muito longo.");
            return;
        }
        if (p.id != null) {
            // editar: atualiza o cadastro e conta quantos dias de agenda caem nas ferias
            if (!dao.atualizarProfissional(p)) {
                Json.erro(resp, 404, "Profissional não encontrado.");
                return;
            }
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("id", p.id);
            r.put("afetadas", dao.agendasAfetadas(p.id).size());
            Json.escrever(resp, 200, r);
            return;
        }
        Json.escrever(resp, 201, Collections.singletonMap("id", dao.criarProfissional(p)));
    }

    private void criarAvulsa(HttpServletRequest req, HttpServletResponse resp, Usuario u) throws IOException, SQLException {
        Agenda a = Json.ler(req, Agenda.class);
        if (a == null || a.servicoId <= 0 || vazio(a.local) || a.data == null || a.horaInicio == null) {
            Json.erro(resp, 400, "Preencha serviço, local, data e horário.");
            return;
        }
        try {
            if (LocalDate.parse(a.data).isBefore(LocalDate.now())) {
                Json.erro(resp, 400, "A data já passou.");
                return;
            }
        } catch (DateTimeParseException e) {
            Json.erro(resp, 400, "Data inválida.");
            return;
        }
        if (!a.horaInicio.matches(HORA) || a.vagas < 1 || a.vagas > 200 || a.intervaloMin < 5 || a.intervaloMin > 240) {
            Json.erro(resp, 400, "Horário, vagas (1 a 200) ou intervalo (5 a 240 min) inválidos.");
            return;
        }
        if (a.local.length() > 160 || (a.orientacoes != null && a.orientacoes.length() > 500)) {
            Json.erro(resp, 400, "Texto muito longo.");
            return;
        }
        a.orientacoes = vazio(a.orientacoes) ? null : a.orientacoes.trim();
        Json.escrever(resp, 201, Collections.singletonMap("id", dao.criarAgendaAvulsa(a, u.id)));
    }

    /** Cada pessoa e marcada na sua propria transacao: um erro nao desfaz as outras. */
    private void marcar(HttpServletRequest req, HttpServletResponse resp, Usuario u) throws IOException, SQLException {
        Marcar m = Json.ler(req, Marcar.class);
        if (m == null || m.agendaId == null || m.marcacoes == null || m.marcacoes.isEmpty() || m.marcacoes.size() > 200) {
            Json.erro(resp, 400, "Nenhuma marcação enviada.");
            return;
        }
        int ok = 0;
        List<String> erros = new ArrayList<>();
        for (Marcacao mc : m.marcacoes) {
            if (mc == null || mc.numero == null || mc.solicitacaoId == null) {
                continue;
            }
            try {
                dao.marcar(m.agendaId, mc.numero, mc.solicitacaoId, u.id);
                ok++;
            } catch (ConflitoException e) {
                erros.add("Vaga " + (mc.numero + 1) + ": " + e.getMessage());
            }
        }
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("marcadas", ok);
        r.put("erros", erros);
        Json.escrever(resp, 200, r);
    }

    private static int idParam(HttpServletRequest req) {
        return Integer.parseInt(req.getParameter("id"));
    }

    private static boolean vazio(String s) {
        return s == null || s.trim().isEmpty();
    }
}
