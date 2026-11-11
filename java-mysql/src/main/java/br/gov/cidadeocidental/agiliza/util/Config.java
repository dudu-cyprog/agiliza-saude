package br.gov.cidadeocidental.agiliza.util;

import java.io.IOException;
import java.io.InputStream;
import java.util.Properties;

/** Le o db.properties; variaveis de ambiente (DB_URL, DB_USER...) tem prioridade. */
public final class Config {

    private static final Properties PROPS = new Properties();

    static {
        try (InputStream in = Config.class.getClassLoader().getResourceAsStream("db.properties")) {
            if (in == null) {
                throw new IllegalStateException("db.properties nao encontrado no classpath");
            }
            PROPS.load(in);
        } catch (IOException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    private Config() {
    }

    public static String get(String chave) {
        String env = System.getenv(chave.toUpperCase().replace('.', '_'));
        String valor = (env != null && !env.isEmpty()) ? env : PROPS.getProperty(chave);
        if (valor == null) {
            throw new IllegalStateException("Configuracao ausente: " + chave);
        }
        return valor.replace("${user.home}", System.getProperty("user.home"));
    }
}
