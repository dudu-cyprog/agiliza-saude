package br.gov.cidadeocidental.agiliza.controller;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.sql.SQLException;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import br.gov.cidadeocidental.agiliza.dao.SolicitacaoDAO;
import br.gov.cidadeocidental.agiliza.model.Anexo;
import br.gov.cidadeocidental.agiliza.model.Prioridade;
import br.gov.cidadeocidental.agiliza.model.Status;
import br.gov.cidadeocidental.agiliza.model.Usuario;
import br.gov.cidadeocidental.agiliza.util.Config;
import br.gov.cidadeocidental.agiliza.util.Json;

/**
 * Area do servidor (protegida pelo AuthFilter).
 *   GET  /api/painel/solicitacoes?status=&q=&prioridade=&minDias=   (ja na ordem da fila)
 *   GET  /api/painel/anexo?id=
 *   GET  /api/painel/status          (lista de status para o filtro)
 *   GET  /api/painel/prioridades     (lista de prioridades)
 *   POST /api/painel/solicitacoes/status      {id, status, mensagemPublica, observacao}
 *   POST /api/painel/solicitacoes/prioridade  {id, prioridade, motivo}   (interno)
 */
@WebServlet("/api/painel/*")
public class PainelServlet extends HttpServlet {
    private static final long serialVersionUID = 1L;
    private final SolicitacaoDAO dao = new SolicitacaoDAO();

    static class Mudanca {
        Long id;
        String status;
        String mensagemPublica;
        String observacao;
    }

    static class MudancaPrioridade {
        Long id;
        String prioridade;
        String motivo;
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        String caminho = req.getPathInfo() == null ? "" : req.getPathInfo();
        try {
            switch (caminho) {
                case "/solicitacoes":
                    listar(req, resp);
                    break;
                case "/anexo":
                    anexo(req, resp);
                    break;
                case "/status":
                    Map<String, String> mapa = new LinkedHashMap<>();
                    for (Status s : Status.values()) {
                        mapa.put(s.name(), s.getRotulo());
                    }
                    Json.escrever(resp, 200, mapa);
                    break;
                case "/prioridades":
                    Map<String, String> prios = new LinkedHashMap<>();
                    for (Prioridade p : Prioridade.values()) {
                        prios.put(p.name(), p.getRotulo());
                    }
                    Json.escrever(resp, 200, prios);
                    break;
                default:
                    Json.erro(resp, 404, "Não encontrado.");
            }
        } catch (SQLException e) {
            log("Erro no painel", e);
            Json.erro(resp, 500, "Erro interno. Tente novamente.");
        }
    }

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        if ("/solicitacoes/prioridade".equals(req.getPathInfo())) {
            mudarPrioridade(req, resp);
            return;
        }
        if (!"/solicitacoes/status".equals(req.getPathInfo())) {
            Json.erro(resp, 404, "Não encontrado.");
            return;
        }
        Mudanca m = Json.ler(req, Mudanca.class);
        if (m == null || m.id == null || m.status == null) {
            Json.erro(resp, 400, "Dados incompletos.");
            return;
        }
        Status novo;
        try {
            novo = Status.valueOf(m.status);
        } catch (IllegalArgumentException e) {
            Json.erro(resp, 400, "Status inválido.");
            return;
        }
        if ((m.mensagemPublica != null && m.mensagemPublica.length() > 500)
                || (m.observacao != null && m.observacao.length() > 500)) {
            Json.erro(resp, 400, "Texto muito longo (máximo 500 caracteres).");
            return;
        }
        Usuario u = (Usuario) req.getSession(false).getAttribute("usuario");
        if (novo.exigeRegulador() && !u.ehRegulador()) {
            Json.erro(resp, 403, "Apenas a regulação pode aplicar este status.");
            return;
        }
        try {
            boolean ok = dao.atualizarStatus(m.id, novo, m.mensagemPublica, m.observacao, u.id);
            if (!ok) {
                Json.erro(resp, 404, "Solicitação não encontrada.");
                return;
            }
            Json.escrever(resp, 200, Collections.singletonMap("ok", true));
        } catch (SQLException e) {
            log("Erro ao atualizar status", e);
            Json.erro(resp, 500, "Erro interno. Tente novamente.");
        }
    }

    /** Qualquer servidor logado (atendente, regulador ou admin) pode classificar a prioridade. */
    private void mudarPrioridade(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        MudancaPrioridade m = Json.ler(req, MudancaPrioridade.class);
        if (m == null || m.id == null || m.prioridade == null) {
            Json.erro(resp, 400, "Dados incompletos.");
            return;
        }
        Prioridade p;
        try {
            p = Prioridade.valueOf(m.prioridade);
        } catch (IllegalArgumentException e) {
            Json.erro(resp, 400, "Prioridade inválida.");
            return;
        }
        if (m.motivo != null && m.motivo.length() > 200) {
            Json.erro(resp, 400, "Motivo muito longo (máximo 200 caracteres).");
            return;
        }
        Usuario u = (Usuario) req.getSession(false).getAttribute("usuario");
        try {
            if (!dao.atualizarPrioridade(m.id, p, m.motivo, u.id)) {
                Json.erro(resp, 404, "Solicitação não encontrada.");
                return;
            }
            Json.escrever(resp, 200, Collections.singletonMap("ok", true));
        } catch (SQLException e) {
            log("Erro ao atualizar prioridade", e);
            Json.erro(resp, 500, "Erro interno. Tente novamente.");
        }
    }

    private void listar(HttpServletRequest req, HttpServletResponse resp) throws IOException, SQLException {
        String status = req.getParameter("status");
        String prioridade = req.getParameter("prioridade");
        String busca = req.getParameter("q");
        try {
            if (status != null && !status.isEmpty()) {
                Status.valueOf(status);
            }
            if (prioridade != null && !prioridade.isEmpty()) {
                Prioridade.valueOf(prioridade);
            }
        } catch (IllegalArgumentException e) {
            Json.erro(resp, 400, "Filtro inválido.");
            return;
        }
        int minDias = 0;
        try {
            String d = req.getParameter("minDias");
            minDias = d == null || d.isEmpty() ? 0 : Math.max(0, Math.min(3650, Integer.parseInt(d)));
        } catch (NumberFormatException e) {
            Json.erro(resp, 400, "Filtro de espera inválido.");
            return;
        }
        if (busca != null && busca.length() > 60) {
            busca = busca.substring(0, 60);
        }
        Json.escrever(resp, 200, Collections.singletonMap("solicitacoes",
                dao.listarPainel(status, busca == null ? null : busca.trim(), prioridade, minDias)));
    }

    private void anexo(HttpServletRequest req, HttpServletResponse resp) throws IOException, SQLException {
        long id;
        try {
            id = Long.parseLong(req.getParameter("id"));
        } catch (NumberFormatException e) {
            Json.erro(resp, 400, "Identificador inválido.");
            return;
        }
        Anexo a = dao.buscarAnexo(id);
        Path pasta = Paths.get(Config.get("upload.dir")).toAbsolutePath().normalize();
        Path arquivo = a == null ? null : pasta.resolve(a.arquivo).normalize();
        if (arquivo == null || !arquivo.startsWith(pasta) || !Files.isRegularFile(arquivo)) {
            Json.erro(resp, 404, "Anexo não encontrado.");
            return;
        }
        String ext = a.arquivo.substring(a.arquivo.lastIndexOf('.'));
        resp.setContentType(a.tipo);
        resp.setContentLengthLong(Files.size(arquivo));
        resp.setHeader("Content-Disposition", "inline; filename=\"anexo-" + id + ext + "\"");
        resp.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
        resp.setHeader("Cache-Control", "private, no-store");
        Files.copy(arquivo, resp.getOutputStream());
    }
}
