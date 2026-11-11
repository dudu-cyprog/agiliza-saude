package br.gov.cidadeocidental.agiliza.util;

/**
 * CPF do paciente. Por enquanto aceita QUALQUER sequencia de 11 numeros (projeto de demonstracao).
 * Para exigir CPF real, voltar a conferir os digitos verificadores em valido().
 */
public final class Cpf {

    private Cpf() {
    }

    /** @return somente os digitos, ou "" se nulo. */
    public static String digitos(String valor) {
        return valor == null ? "" : valor.replaceAll("\\D", "");
    }

    public static boolean valido(String valor) {
        return digitos(valor).length() == 11;
    }
}
