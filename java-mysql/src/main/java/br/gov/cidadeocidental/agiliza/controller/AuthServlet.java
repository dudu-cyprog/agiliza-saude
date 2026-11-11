package br.gov.cidadeocidental.agiliza.controller;

import java.io.IOException;
import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.Map;

import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;

import br.gov.cidadeocidental.agiliza.dao.UsuarioDAO;
import br.gov.cidadeocidental.agiliza.model.Usuario;
import br.gov.cidadeocidental.agiliza.util.Json;
import br.gov.cidadeocidental.agiliza.util.RateLimiter;
import br.gov.cidadeocidental.agiliza.util.Senha;

/** POST /api/auth/login | POST /api/auth/logout | GET /api/auth/me */
@WebServlet("/api/auth/*")
public class AuthServlet extends HttpServlet {
    private static final long serialVersionUID = 1L;
    private static final RateLimiter LIMITE = new RateLimiter(8, 10 * 60 * 1000L);
    /** Usado para gastar o mesmo tempo quando o e-mail nao existe (evita enumeracao de usuarios). */
    private static final String HASH_FALSO = Senha.gerarHash("senha-falsa");
    private final UsuarioDAO dao = new UsuarioDAO();

    static class Login {
        String email;
        String senha;
    }

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        String caminho = req.getPathInfo() == null ? "" : req.getPathInfo();
        if ("/login".equals(caminho)) {
            login(req, resp);
        } else if ("/logout".equals(caminho)) {
            HttpSession s = req.getSession(false);
            if (s != null) {
                s.invalidate();
            }
            Json.escrever(resp, 200, new LinkedHashMap<String, Object>());
        } else {
            Json.erro(resp, 404, "Não encontrado.");
        }
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        if (!"/me".equals(req.getPathInfo())) {
            Json.erro(resp, 404, "Não encontrado.");
            return;
        }
        HttpSession s = req.getSession(false);
        Usuario u = s == null ? null : (Usuario) s.getAttribute("usuario");
        if (u == null) {
            Json.erro(resp, 401, "Não autenticado.");
            return;
        }
        Json.escrever(resp, 200, dadosPublicos(u));
    }

    private void login(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        if (!LIMITE.permitir(req.getRemoteAddr())) {
            Json.erro(resp, 429, "Muitas tentativas de login. Aguarde alguns minutos.");
            return;
        }
        Login l = Json.ler(req, Login.class);
        if (l == null || l.email == null || l.senha == null || l.email.trim().isEmpty() || l.senha.isEmpty()) {
            Json.erro(resp, 400, "Informe e-mail e senha.");
            return;
        }
        try {
            Usuario u = dao.buscarAtivoPorEmail(l.email.trim().toLowerCase());
            boolean ok = Senha.confere(l.senha, u != null ? u.senhaHash : HASH_FALSO) && u != null;
            if (!ok) {
                Json.erro(resp, 401, "E-mail/matrícula ou senha incorretos.");
                return;
            }
            dao.registrarLogin(u.id);
            u.senhaHash = null;

            HttpSession antiga = req.getSession(false);
            if (antiga != null) {
                antiga.invalidate(); // evita fixacao de sessao
            }
            HttpSession nova = req.getSession(true);
            nova.setMaxInactiveInterval(30 * 60);
            nova.setAttribute("usuario", u);
            Json.escrever(resp, 200, dadosPublicos(u));
        } catch (SQLException e) {
            log("Erro no login", e);
            Json.erro(resp, 500, "Erro interno. Tente novamente.");
        }
    }

    private static Map<String, Object> dadosPublicos(Usuario u) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("nome", u.nome);
        m.put("perfil", u.perfil);
        return m;
    }
}
