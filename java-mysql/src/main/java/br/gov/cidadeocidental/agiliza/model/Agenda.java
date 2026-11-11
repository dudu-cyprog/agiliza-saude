package br.gov.cidadeocidental.agiliza.model;

import java.util.List;

/** Um dia de atendimento com N vagas (do profissional ou avulsa/mutirao). */
public class Agenda {
    public Integer id;
    public int servicoId;
    public String servico;
    public Integer profissionalId;
    public String profissional;
    public String especialidade;
    public String local;
    public String data;          // AAAA-MM-DD
    public String horaInicio;    // HH:mm
    public int intervaloMin;
    public int vagas;
    public String orientacoes;
    public int ocupadas;
    /** Numeros das vagas ja ocupadas (para mostrar so os horarios livres). */
    public List<Integer> ocupadasNums;
    /** So no detalhe: as vagas ocupadas. */
    public List<Vaga> vagasOcupadas;

    /** Vaga ocupada (numero 0..vagas-1; horario = inicio + numero * intervalo). */
    public static class Vaga {
        public int numero;
        public String hora;
        public long solicitacaoId;
        public String protocolo;
        public String paciente;
        public String cpf;
        public String telefone;
        public String status;
        public String prioridade;
        public int diasEspera;
    }

    /** Candidato da fila (sugestao para "Preencher com a fila"). */
    public static class Candidato {
        public long solicitacaoId;
        public String protocolo;
        public String paciente;
        public String prioridade;
        public String prioridadeMotivo;
        public int diasEspera;
        public int idade;
    }
}
