package br.gov.cidadeocidental.agiliza.controller;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.sql.SQLException;
import java.sql.SQLIntegrityConstraintViolationException;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.Collections;
import java.util.Map;
import java.util.UUID;

import javax.servlet.ServletException;
import javax.servlet.annotation.MultipartConfig;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.Part;

import br.gov.cidadeocidental.agiliza.dao.CatalogoDAO;
import br.gov.cidadeocidental.agiliza.dao.ConflitoException;
import br.gov.cidadeocidental.agiliza.dao.SolicitacaoDAO;
import br.gov.cidadeocidental.agiliza.model.NovaSolicitacao;
import br.gov.cidadeocidental.agiliza.model.Prioridade;
import br.gov.cidadeocidental.agiliza.model.Usuario;
import br.gov.cidadeocidental.agiliza.util.Config;
import br.gov.cidadeocidental.agiliza.util.Cpf;
import br.gov.cidadeocidental.agiliza.util.Json;

/**
 * Atendimento presencial (balcao) - protegido pelo AuthFilter (so servidor logado).
 *   GET  /api/painel/balcao/paciente?cpf=   dados basicos do paciente (ou 404 = cadastrar)
 *   GET  /api/painel/balcao/servicos        todos os servicos, inclusive "somente equipe" (cirurgia)
 *   POST /api/painel/balcao/pedido          multipart: cadastro (se preciso) + pedido + guia opcional
 *   POST /api/painel/balcao/preop           {id, exames, riscoCirurgico, termo, orientado}
 */
@WebServlet("/api/painel/balcao/*")
@MultipartConfig(fileSizeThreshold = 1024 * 1024, maxFileSize = 5L * 1024 * 1024, maxRequestSize = 6L * 1024 * 1024)
public class BalcaoServlet extends HttpServlet {
    private static final long serialVersionUID = 1L;
    private final SolicitacaoDAO dao = new SolicitacaoDAO();
    private final CatalogoDAO catalogo = new CatalogoDAO();

    static class PreOp {
        Long id;
        boolean exames;
        boolean riscoCirurgico;
        boolean termo;
        boolean orientado;
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        String caminho = req.getPathInfo() == null ? "" : req.getPathInfo();
        try {
            if ("/servicos".equals(caminho)) {
                Json.escrever(resp, 200, catalogo.listarServicos(true));
                return;
            }
            if ("/paciente".equals(caminho)) {
                String cpf = Cpf.digitos(req.getParameter("cpf"));
                if (!Cpf.valido(cpf)) {
                    Json.erro(resp, 400, "Digite os 11 números do CPF.");
                    return;
                }
                Map<String, Object> p = dao.buscarPacientePorCpf(cpf);
                if (p == null) {
                    Json.erro(resp, 404, "CPF sem cadastro.");
                    return;
                }
                Json.escrever(resp, 200, p);
                return;
            }
            Json.erro(resp, 404, "Não encontrado.");
        } catch (SQLException e) {
            log("Erro no balcao", e);
            Json.erro(resp, 500, "Erro interno. Tente novamente.");
        }
    }

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse resp) throws IOException, ServletException {
        Usuario u = (Usuario) req.getSession(false).getAttribute("usuario");
        if ("/preop".equals(req.getPathInfo())) {
            PreOp p = Json.ler(req, PreOp.class);
            if (p == null || p.id == null) {
                Json.erro(resp, 400, "Dados incompletos.");
                return;
            }
            try {
                if (!dao.atualizarPreOp(p.id, p.exames, p.riscoCirurgico, p.termo, p.orientado, u.id)) {
                    Json.erro(resp, 404, "Cirurgia não encontrada.");
                    return;
                }
                Json.escrever(resp, 200, Collections.singletonMap("ok", true));
            } catch (SQLException e) {
                log("Erro no pre-operatorio", e);
                Json.erro(resp, 500, "Erro interno. Tente novamente.");
            }
            return;
        }
        if (!"/pedido".equals(req.getPathInfo())) {
            Json.erro(resp, 404, "Não encontrado.");
            return;
        }
        registrarPedido(req, resp, u);
    }

    private void registrarPedido(HttpServletRequest req, HttpServletResponse resp, Usuario u) throws IOException, ServletException {
        Path arquivoSalvo = null;
        try {
            NovaSolicitacao n = new NovaSolicitacao();
            n.cpf = Cpf.digitos(req.getParameter("cpf"));
            if (!Cpf.valido(n.cpf)) {
                Json.erro(resp, 400, "Digite os 11 números do CPF.");
                return;
            }
            // dados do cadastro (so usados se o CPF ainda nao tem cadastro)
            n.nome = vazioParaNull(texto(req.getParameter("nome")).replaceAll("\\s+", " "));
            n.telefone = vazioParaNull(texto(req.getParameter("telefone")).replaceAll("\\D", ""));
            n.cartaoSus = vazioParaNull(texto(req.getParameter("sus")).replaceAll("\\D", ""));
            String nasc = texto(req.getParameter("nascimento"));
            if (!nasc.isEmpty()) {
                try {
                    n.nascimento = LocalDate.parse(nasc);
                } catch (DateTimeParseException e) {
                    Json.erro(resp, 400, "Data de nascimento inválida.");
                    return;
                }
            }
            if (n.telefone != null && (n.telefone.length() < 10 || n.telefone.length() > 11)) {
                Json.erro(resp, 400, "Telefone com DDD (ou deixe em branco).");
                return;
            }
            if (n.cartaoSus != null && n.cartaoSus.length() != 15) {
                Json.erro(resp, 400, "Cartão SUS com 15 números (ou deixe em branco).");
                return;
            }
            if (n.nome != null && !"true".equals(req.getParameter("lgpd"))) {
                Json.erro(resp, 400, "Marque a autorização (LGPD) depois de ler para a pessoa.");
                return;
            }
            try {
                n.ubsId = Integer.parseInt(texto(req.getParameter("ubsId")));
                n.servicoId = Integer.parseInt(texto(req.getParameter("servicoId")));
                n.prioridade = Prioridade.valueOf(texto(req.getParameter("prioridade")).isEmpty() ? "NORMAL" : req.getParameter("prioridade"));
            } catch (IllegalArgumentException e) {
                Json.erro(resp, 400, "Selecione a UBS, o serviço e a prioridade.");
                return;
            }
            n.prioridadeMotivo = limitar(vazioParaNull(texto(req.getParameter("motivo"))), 200);
            n.observacao = limitar(vazioParaNull(texto(req.getParameter("observacao"))), 300);
            n.cirurgiaProcedimento = limitar(vazioParaNull(texto(req.getParameter("procedimento"))), 160);
            n.cirurgiaHospital = limitar(vazioParaNull(texto(req.getParameter("hospital"))), 160);
            n.preopExames = "true".equals(req.getParameter("preopExames"));
            n.preopRisco = "true".equals(req.getParameter("preopRisco"));
            n.preopTermo = "true".equals(req.getParameter("preopTermo"));
            n.preopOrientado = "true".equals(req.getParameter("preopOrientado"));

            // guia opcional: validada pelo conteudo (mesma regra do site)
            Part guia = req.getPart("guia");
            if (guia != null && guia.getSize() > 0) {
                byte[] dados;
                try (InputStream in = guia.getInputStream()) {
                    dados = in.readAllBytes();
                }
                String[] tipo = SolicitacaoServlet.detectarTipo(dados);
                if (tipo == null) {
                    Json.erro(resp, 400, "Arquivo inválido. Envie JPG, PNG, WEBP ou PDF.");
                    return;
                }
                Path pasta = Paths.get(Config.get("upload.dir"));
                Files.createDirectories(pasta);
                String nomeSalvo = UUID.randomUUID() + tipo[1];
                arquivoSalvo = pasta.resolve(nomeSalvo);
                Files.write(arquivoSalvo, dados);
                n.anexoArquivo = nomeSalvo;
                n.anexoTipo = tipo[0];
                n.anexoNomeOriginal = "guia-balcao" + tipo[1];
            }

            String protocolo = dao.criarBalcao(n, u.id);
            Json.escrever(resp, 201, Collections.singletonMap("protocolo", protocolo));
        } catch (ConflitoException e) {
            apagar(arquivoSalvo);
            Json.erro(resp, 409, e.getMessage());
        } catch (SQLIntegrityConstraintViolationException e) {
            apagar(arquivoSalvo);
            Json.erro(resp, 400, "Dados em conflito (Cartão SUS de outra pessoa, UBS ou serviço inválido).");
        } catch (SQLException e) {
            apagar(arquivoSalvo);
            log("Erro ao registrar no balcao", e);
            Json.erro(resp, 500, "Erro interno. Tente novamente.");
        } catch (IllegalStateException e) {
            apagar(arquivoSalvo);
            Json.erro(resp, 413, "Arquivo muito grande (máximo 5 MB).");
        }
    }

    private static String texto(String s) {
        return s == null ? "" : s.trim();
    }

    private static String vazioParaNull(String s) {
        return s == null || s.isEmpty() ? null : s;
    }

    private static String limitar(String s, int max) {
        return s == null || s.length() <= max ? s : s.substring(0, max);
    }

    private static void apagar(Path p) {
        if (p != null) {
            try {
                Files.deleteIfExists(p);
            } catch (IOException ignored) {
                // melhor esforco
            }
        }
    }
}
