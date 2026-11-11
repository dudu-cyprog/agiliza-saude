package br.gov.cidadeocidental.agiliza.dao;

/** Regra de negocio violada (ex.: dados divergentes de um paciente ja cadastrado). */
public class ConflitoException extends Exception {
    private static final long serialVersionUID = 1L;

    public ConflitoException(String mensagem) {
        super(mensagem);
    }
}
