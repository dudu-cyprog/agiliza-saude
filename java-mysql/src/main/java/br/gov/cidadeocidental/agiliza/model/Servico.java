package br.gov.cidadeocidental.agiliza.model;

public class Servico {
    public int id;
    public String nome;
    public String descricao;
    /** true = so o servidor abre, no atendimento presencial (ex.: cirurgia eletiva). */
    public boolean somenteEquipe;
}
