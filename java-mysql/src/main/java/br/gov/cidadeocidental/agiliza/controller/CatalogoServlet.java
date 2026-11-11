package br.gov.cidadeocidental.agiliza.controller;

import java.io.IOException;
import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.Map;

import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import br.gov.cidadeocidental.agiliza.dao.CatalogoDAO;
import br.gov.cidadeocidental.agiliza.util.Json;

/** GET /api/catalogo -> UBS e servicos para montar a tela. */
@WebServlet("/api/catalogo")
public class CatalogoServlet extends HttpServlet {
    private static final long serialVersionUID = 1L;
    private final CatalogoDAO dao = new CatalogoDAO();

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        try {
            Map<String, Object> corpo = new LinkedHashMap<>();
            corpo.put("ubs", dao.listarUbs());
            corpo.put("servicos", dao.listarServicos());
            Json.escrever(resp, 200, corpo);
        } catch (SQLException e) {
            log("Erro ao listar catalogo", e);
            Json.erro(resp, 500, "Erro interno. Tente novamente.");
        }
    }
}
