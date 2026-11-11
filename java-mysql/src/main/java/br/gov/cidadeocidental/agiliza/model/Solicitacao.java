package br.gov.cidadeocidental.agiliza.model;

/** Visao completa de uma solicitacao (ja com dados de paciente, UBS e servico). */
public class Solicitacao {
    public long id;
    public String protocolo;
    public String status;
    public String statusRotulo;
    public String paciente;
    public String cpf;
    public String cartaoSus;
    public String telefone;
    public String nascimento;
    public Integer idade;
    public String servico;
    public String ubs;
    public String mensagemPublica;
    public boolean temAnexo;
    public String criadoEm;
    public String atualizadoEm;
    /** Dias de espera: em aberto ate hoje; marcados/finalizados ate a ultima atualizacao. */
    public int diasEspera;
    /** SITE (o proprio municipe) ou BALCAO (registrado pelo servidor). */
    public String canal;
    public String criadoPor;
    /** Cirurgia eletiva (null nos demais servicos). */
    public String cirurgiaProcedimento;
    public String cirurgiaHospital;
    public java.util.Map<String, Boolean> preOp;
    // ----- somente para o painel (interno)
    public String prioridade;
    public String prioridadeRotulo;
    public String prioridadeMotivo;
    public String prioridadePor;
    public String prioridadeEm;
    // Marcacao pela agenda (quando o pedido ocupa uma vaga)
    public String agendaData;
    public String agendaHora;
    public String agendaLocal;
    public String agendaProfissional;
    public String agendaOrientacoes;
    public Integer agendaId;
    public Integer agendaVaga;
    public int servicoId;
}
