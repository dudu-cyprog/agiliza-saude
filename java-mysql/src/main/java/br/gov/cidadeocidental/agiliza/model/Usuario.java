package br.gov.cidadeocidental.agiliza.model;

public class Usuario implements java.io.Serializable {
    private static final long serialVersionUID = 1L;
    public int id;
    public String nome;
    public String email;
    public String perfil;
    /** Nunca e serializado para o cliente (transient). */
    public transient String senhaHash;

    public boolean ehRegulador() {
        return "REGULADOR".equals(perfil) || "ADMIN".equals(perfil);
    }
}
