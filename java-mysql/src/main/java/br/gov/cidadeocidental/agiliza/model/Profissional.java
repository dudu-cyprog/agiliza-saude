package br.gov.cidadeocidental.agiliza.model;

/** Profissional (medico, laboratorio...) com a agenda semanal padrao. */
public class Profissional {
    public Integer id;
    public String nome;
    public String especialidade;
    public String registro;
    public int servicoId;
    public String servico;
    public String local;
    /** Dias da semana: 0=domingo ... 6=sabado. */
    public int[] diasSemana;
    public String horaInicio;   // HH:mm
    public String horaFim;      // HH:mm
    public int duracaoMin;
    public boolean ativo = true;
    /** Desativado (nao trabalha mais) desde AAAA-MM-DD; os dados ficam guardados. */
    public String inativoDesde;
    /** Ferias/afastamento (AAAA-MM-DD): nesses dias nao gera agenda. */
    public String feriasInicio;
    public String feriasFim;
    public String feriasMotivo;
    /** Calculado: quantas vagas por dia. */
    public int vagasPorDia;
}
