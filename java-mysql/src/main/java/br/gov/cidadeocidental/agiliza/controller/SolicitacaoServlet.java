package br.gov.cidadeocidental.agiliza.controller;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.sql.SQLException;
import java.sql.SQLIntegrityConstraintViolationException;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.Collections;
import java.util.UUID;

import javax.servlet.ServletException;
import javax.servlet.annotation.MultipartConfig;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.Part;

import br.gov.cidadeocidental.agiliza.dao.ConflitoException;
import br.gov.cidadeocidental.agiliza.dao.SolicitacaoDAO;
import br.gov.cidadeocidental.agiliza.model.NovaSolicitacao;
import br.gov.cidadeocidental.agiliza.util.Config;
import br.gov.cidadeocidental.agiliza.util.Cpf;
import br.gov.cidadeocidental.agiliza.util.Json;
import br.gov.cidadeocidental.agiliza.util.RateLimiter;

/** POST /api/solicitacoes (multipart/form-data) - nova solicitacao do municipe. */
@WebServlet("/api/solicitacoes")
@MultipartConfig(fileSizeThreshold = 1024 * 1024, maxFileSize = 5L * 1024 * 1024, maxRequestSize = 6L * 1024 * 1024)
public class SolicitacaoServlet extends HttpServlet {
    private static final long serialVersionUID = 1L;
    private static final RateLimiter LIMITE = new RateLimiter(10, 10 * 60 * 1000L);
    private final SolicitacaoDAO dao = new SolicitacaoDAO();

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse resp) throws IOException, ServletException {
        if (!LIMITE.permitir(req.getRemoteAddr())) {
            Json.erro(resp, 429, "Muitas solicitações em pouco tempo. Tente novamente mais tarde.");
            return;
        }
        Path arquivoSalvo = null;
        try {
            NovaSolicitacao n = new NovaSolicitacao();
            n.nome = texto(req.getParameter("nome"));
            n.cpf = Cpf.digitos(req.getParameter("cpf"));
            n.cartaoSus = texto(req.getParameter("sus")).replaceAll("\\D", "");
            n.telefone = texto(req.getParameter("telefone")).replaceAll("\\D", "");

            String erro = null;
            if (n.nome.length() < 3 || n.nome.length() > 120) {
                erro = "Informe o nome completo.";
            } else if (!Cpf.valido(n.cpf)) {
                erro = "CPF inválido. Confira os 11 números.";
            } else if (n.cartaoSus.length() != 15) {
                erro = "O Cartão SUS deve ter 15 dígitos.";
            } else if (n.telefone.length() < 10 || n.telefone.length() > 11) {
                erro = "Informe um telefone com DDD.";
            } else if (!"true".equals(req.getParameter("lgpd"))) {
                erro = "É necessário aceitar o Termo de Consentimento (LGPD).";
            }
            try {
                n.nascimento = LocalDate.parse(texto(req.getParameter("nascimento")));
                if (n.nascimento.isAfter(LocalDate.now()) || n.nascimento.getYear() < 1900) {
                    erro = "Data de nascimento inválida.";
                }
            } catch (DateTimeParseException e) {
                erro = "Data de nascimento inválida.";
            }
            try {
                n.ubsId = Integer.parseInt(texto(req.getParameter("ubsId")));
                n.servicoId = Integer.parseInt(texto(req.getParameter("servicoId")));
            } catch (NumberFormatException e) {
                erro = "Selecione a UBS e o serviço.";
            }
            if (erro != null) {
                Json.erro(resp, 400, erro);
                return;
            }

            // ----- anexo OPCIONAL: se vier, valida pelo CONTEUDO (magic bytes), nao pelo nome informado -----
            Part guia = req.getPart("guia");
            if (guia != null && guia.getSize() > 0) {
                byte[] dados;
                try (InputStream in = guia.getInputStream()) {
                    dados = in.readAllBytes();
                }
                String[] tipo = detectarTipo(dados); // {mime, extensao}
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
                n.anexoNomeOriginal = limparNome(guia.getSubmittedFileName());
            }

            String protocolo = dao.criar(n);
            Json.escrever(resp, 201, Collections.singletonMap("protocolo", protocolo));

        } catch (ConflitoException e) {
            apagar(arquivoSalvo);
            Json.erro(resp, 409, e.getMessage());
        } catch (SQLIntegrityConstraintViolationException e) {
            apagar(arquivoSalvo);
            Json.erro(resp, 400, "UBS ou serviço inválido.");
        } catch (SQLException e) {
            apagar(arquivoSalvo);
            log("Erro ao gravar solicitacao", e);
            Json.erro(resp, 500, "Erro interno. Tente novamente.");
        } catch (IllegalStateException e) {
            // limite de tamanho do multipart excedido
            apagar(arquivoSalvo);
            Json.erro(resp, 413, "Arquivo muito grande (máximo 5 MB).");
        }
    }

    private static String texto(String s) {
        return s == null ? "" : s.trim();
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

    private static String limparNome(String original) {
        if (original == null) {
            return "anexo";
        }
        String nome = original.replace('\\', '/');
        nome = nome.substring(nome.lastIndexOf('/') + 1).replaceAll("[^\\w.\\- ]", "_");
        return nome.length() > 100 ? nome.substring(0, 100) : nome;
    }

    /** @return {mime, extensao} ou null se o tipo nao for permitido. */
    static String[] detectarTipo(byte[] b) {
        if (b.length >= 3 && (b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8 && (b[2] & 0xFF) == 0xFF) {
            return new String[] {"image/jpeg", ".jpg"};
        }
        if (b.length >= 4 && (b[0] & 0xFF) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G') {
            return new String[] {"image/png", ".png"};
        }
        if (b.length >= 4 && b[0] == '%' && b[1] == 'P' && b[2] == 'D' && b[3] == 'F') {
            return new String[] {"application/pdf", ".pdf"};
        }
        if (b.length >= 12 && new String(b, 0, 4, StandardCharsets.US_ASCII).equals("RIFF")
                && new String(b, 8, 4, StandardCharsets.US_ASCII).equals("WEBP")) {
            return new String[] {"image/webp", ".webp"};
        }
        return null;
    }
}
