package br.gov.cidadeocidental.agiliza.model;

/** Situacoes possiveis de uma solicitacao. */
public enum Status {
    RECEBIDA("Recebida", false, "Solicitação recebida. Aguardando triagem."),
    EM_TRIAGEM("Em Triagem", false, "Solicitação em triagem pela equipe da UBS."),
    EM_ANALISE_REGULACAO("Em Regulação", false, "Solicitação em análise pela regulação médica."),
    AGENDADA("Agendada", true, "Atendimento agendado. Aguarde contato da UBS."),
    CONCLUIDA("Concluída", true, "Atendimento concluído."),
    NEGADA("Não autorizada", true, "Solicitação não autorizada. Procure sua UBS de referência."),
    CANCELADA("Cancelada", false, "Solicitação cancelada."),
    FALTOU("Não compareceu", false, "Você não compareceu ao atendimento marcado. Procure sua UBS para remarcar.");

    private final String rotulo;
    private final boolean exigeRegulador;
    private final String mensagemPadrao;

    Status(String rotulo, boolean exigeRegulador, String mensagemPadrao) {
        this.rotulo = rotulo;
        this.exigeRegulador = exigeRegulador;
        this.mensagemPadrao = mensagemPadrao;
    }

    public String getRotulo() {
        return rotulo;
    }

    /** Status que somente REGULADOR/ADMIN podem aplicar. */
    public boolean exigeRegulador() {
        return exigeRegulador;
    }

    public String getMensagemPadrao() {
        return mensagemPadrao;
    }
}
