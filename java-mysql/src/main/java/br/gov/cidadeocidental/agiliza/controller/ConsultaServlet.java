package br.gov.cidadeocidental.agiliza.controller;

import java.io.IOException;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import br.gov.cidadeocidental.agiliza.dao.SolicitacaoDAO;
import br.gov.cidadeocidental.agiliza.model.Solicitacao;
import br.gov.cidadeocidental.agiliza.util.Cpf;
import br.gov.cidadeocidental.agiliza.util.Json;
import br.gov.cidadeocidental.agiliza.util.RateLimiter;

/** POST /api/consulta  {cpf}  (POST para nao expor o CPF na URL/logs). */
@WebServlet("/api/consulta")
public class ConsultaServlet extends HttpServlet {
    private static final long serialVersionUID = 1L;
    private static final RateLimiter LIMITE = new RateLimiter(15, 10 * 60 * 1000L);
    private final SolicitacaoDAO dao = new SolicitacaoDAO();

    static class Pedido {
        String cpf;
    }

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        if (!LIMITE.permitir(req.getRemoteAddr())) {
            Json.erro(resp, 429, "Muitas tentativas. Aguarde alguns minutos e tente novamente.");
            return;
        }
        Pedido p = Json.ler(req, Pedido.class);
        String cpf = Cpf.digitos(p == null ? null : p.cpf);
        if (!Cpf.valido(cpf)) {
            Json.erro(resp, 400, "CPF inválido. Confira os 11 números.");
            return;
        }

        try {
            List<Solicitacao> achadas = dao.buscarParaMunicipe(cpf);
            if (achadas.isEmpty()) {
                Json.erro(resp, 404, "Nenhuma solicitação encontrada para este CPF.");
                return;
            }
            // Visao publica: so o andamento. Nunca devolve telefone, Cartao SUS, id interno
            // nem a PRIORIDADE (que e interna da equipe).
            List<Map<String, Object>> saida = new ArrayList<>();
            for (Solicitacao s : achadas) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("protocolo", s.protocolo);
                m.put("status", s.status);
                m.put("statusRotulo", s.statusRotulo);
                m.put("paciente", s.paciente.split(" ")[0]);
                m.put("servico", s.servico);
                m.put("ubs", s.ubs);
                m.put("mensagem", s.mensagemPublica);
                if (s.agendaData != null && "AGENDADA".equals(s.status)) {
                    Map<String, Object> marc = new LinkedHashMap<>();
                    marc.put("data", s.agendaData);
                    marc.put("hora", s.agendaHora);
                    marc.put("local", s.agendaLocal);
                    marc.put("profissional", s.agendaProfissional);
                    marc.put("orientacoes", s.agendaOrientacoes);
                    m.put("agendamento", marc);
                }
                m.put("criadoEm", s.criadoEm);
                m.put("atualizadoEm", s.atualizadoEm);
                saida.add(m);
            }
            Json.escrever(resp, 200, Collections.singletonMap("solicitacoes", saida));
        } catch (SQLException e) {
            log("Erro na consulta", e);
            Json.erro(resp, 500, "Erro interno. Tente novamente.");
        }
    }
}
