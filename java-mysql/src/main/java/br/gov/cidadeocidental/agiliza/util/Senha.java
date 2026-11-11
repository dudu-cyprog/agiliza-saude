package br.gov.cidadeocidental.agiliza.util;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.security.spec.InvalidKeySpecException;
import java.util.Base64;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/** Hash de senha com PBKDF2-SHA256 (somente JDK). Formato: iteracoes:salt:hash (Base64). */
public final class Senha {

    private static final int ITERACOES = 120_000;
    private static final int BITS = 256;
    private static final SecureRandom RNG = new SecureRandom();

    private Senha() {
    }

    public static String gerarHash(String senha) {
        byte[] salt = new byte[16];
        RNG.nextBytes(salt);
        byte[] hash = pbkdf2(senha.toCharArray(), salt, ITERACOES);
        return ITERACOES + ":" + Base64.getEncoder().encodeToString(salt)
                + ":" + Base64.getEncoder().encodeToString(hash);
    }

    public static boolean confere(String senha, String armazenado) {
        try {
            String[] p = armazenado.split(":");
            int iter = Integer.parseInt(p[0]);
            byte[] salt = Base64.getDecoder().decode(p[1]);
            byte[] esperado = Base64.getDecoder().decode(p[2]);
            byte[] calculado = pbkdf2(senha.toCharArray(), salt, iter);
            return MessageDigest.isEqual(esperado, calculado);
        } catch (RuntimeException e) {
            return false;
        }
    }

    private static byte[] pbkdf2(char[] senha, byte[] salt, int iter) {
        try {
            SecretKeyFactory f = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
            return f.generateSecret(new PBEKeySpec(senha, salt, iter, BITS)).getEncoded();
        } catch (NoSuchAlgorithmException | InvalidKeySpecException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Utilitario: gera hash para inserir novos usuarios no banco. */
    public static void main(String[] args) {
        if (args.length != 1) {
            System.out.println("Uso: Senha <senha>");
            return;
        }
        System.out.println(gerarHash(args[0]));
    }
}
