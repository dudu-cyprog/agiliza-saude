package br.gov.cidadeocidental.agiliza.util;

import java.io.BufferedReader;
import java.io.IOException;
import java.util.Collections;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import com.google.gson.Gson;
import com.google.gson.JsonSyntaxException;

public final class Json {

    private static final Gson GSON = new Gson();

    private Json() {
    }

    public static void escrever(HttpServletResponse resp, int status, Object corpo) throws IOException {
        resp.setStatus(status);
        resp.setContentType("application/json");
        resp.setCharacterEncoding("UTF-8");
        resp.setHeader("Cache-Control", "no-store");
        resp.getWriter().write(GSON.toJson(corpo));
    }

    public static void erro(HttpServletResponse resp, int status, String mensagem) throws IOException {
        escrever(resp, status, Collections.singletonMap("erro", mensagem));
    }

    /** Le o corpo JSON; devolve null se invalido/vazio. */
    public static <T> T ler(HttpServletRequest req, Class<T> tipo) throws IOException {
        try (BufferedReader br = req.getReader()) {
            return GSON.fromJson(br, tipo);
        } catch (JsonSyntaxException e) {
            return null;
        }
    }
}
