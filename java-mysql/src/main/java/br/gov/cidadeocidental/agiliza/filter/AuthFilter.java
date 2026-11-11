package br.gov.cidadeocidental.agiliza.filter;

import java.io.IOException;

import javax.servlet.Filter;
import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.ServletRequest;
import javax.servlet.ServletResponse;
import javax.servlet.annotation.WebFilter;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;

import br.gov.cidadeocidental.agiliza.util.Json;

/** Protege /api/painel/*: exige servidor autenticado e, nos POST, o cabecalho anti-CSRF. */
@WebFilter("/api/painel/*")
public class AuthFilter implements Filter {

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        HttpServletRequest req = (HttpServletRequest) request;
        HttpServletResponse resp = (HttpServletResponse) response;

        HttpSession sessao = req.getSession(false);
        if (sessao == null || sessao.getAttribute("usuario") == null) {
            Json.erro(resp, HttpServletResponse.SC_UNAUTHORIZED, "Sessão expirada. Faça login novamente.");
            return;
        }
        if ("POST".equals(req.getMethod()) && !"fetch".equals(req.getHeader("X-Requested-With"))) {
            Json.erro(resp, HttpServletResponse.SC_FORBIDDEN, "Requisição não autorizada.");
            return;
        }
        chain.doFilter(request, response);
    }
}
