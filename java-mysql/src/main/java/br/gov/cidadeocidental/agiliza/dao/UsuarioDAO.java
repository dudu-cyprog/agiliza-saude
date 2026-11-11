package br.gov.cidadeocidental.agiliza.dao;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

import br.gov.cidadeocidental.agiliza.model.Usuario;
import br.gov.cidadeocidental.agiliza.util.ConnectionFactory;

public class UsuarioDAO {

    public Usuario buscarAtivoPorEmail(String email) throws SQLException {
        String sql = "SELECT id, nome, email, perfil, senha_hash FROM usuario WHERE email = ? AND ativo = 1";
        try (Connection c = ConnectionFactory.getConnection();
             PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, email);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) {
                    return null;
                }
                Usuario u = new Usuario();
                u.id = rs.getInt("id");
                u.nome = rs.getString("nome");
                u.email = rs.getString("email");
                u.perfil = rs.getString("perfil");
                u.senhaHash = rs.getString("senha_hash");
                return u;
            }
        }
    }

    public void registrarLogin(int usuarioId) throws SQLException {
        try (Connection c = ConnectionFactory.getConnection();
             PreparedStatement ps = c.prepareStatement("UPDATE usuario SET ultimo_login = NOW() WHERE id = ?")) {
            ps.setInt(1, usuarioId);
            ps.executeUpdate();
        }
    }
}
