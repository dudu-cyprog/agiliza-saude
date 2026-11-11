package br.gov.cidadeocidental.agiliza.model;

import java.time.LocalDate;

/** Dados ja validados vindos do formulario do municipe (site) ou do servidor (balcao). */
public class NovaSolicitacao {
    public String nome;
    public String cpf;            // 11 digitos
    public String cartaoSus;      // 15 digitos (no balcao pode ser null)
    public LocalDate nascimento;
    public String telefone;       // somente digitos (no balcao pode ser null)
    public int ubsId;
    public int servicoId;
    public String anexoArquivo;
    public String anexoNomeOriginal;
    public String anexoTipo;

    // ----- somente no atendimento presencial (balcao)
    public String observacao;
    public Prioridade prioridade = Prioridade.NORMAL;
    public String prioridadeMotivo;
    public String cirurgiaProcedimento;
    public String cirurgiaHospital;
    public boolean preopExames;
    public boolean preopRisco;
    public boolean preopTermo;
    public boolean preopOrientado;
}
