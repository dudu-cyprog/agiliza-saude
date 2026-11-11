package br.gov.cidadeocidental.agiliza.model;

/**
 * Prioridade na fila, definida pela equipe (classificacao de risco).
 * E INTERNA: a consulta do municipe nunca devolve este campo.
 */
public enum Prioridade {
    URGENTE("Urgente"),
    PRIORITARIO("Prioritário"),
    NORMAL("Normal");

    private final String rotulo;

    Prioridade(String rotulo) {
        this.rotulo = rotulo;
    }

    public String getRotulo() {
        return rotulo;
    }
}
