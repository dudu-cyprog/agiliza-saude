package br.gov.cidadeocidental.agiliza.dao;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

import br.gov.cidadeocidental.agiliza.model.Servico;
import br.gov.cidadeocidental.agiliza.model.Ubs;
import br.gov.cidadeocidental.agiliza.util.ConnectionFactory;

public class CatalogoDAO {

    public List<Ubs> listarUbs() throws SQLException {
        String sql = "SELECT id, nome, endereco, "
                + "CONCAT(TIME_FORMAT(horario_abertura,'%H:%i'),' às ',TIME_FORMAT(horario_fechamento,'%H:%i')) AS horario "
                + "FROM ubs WHERE ativa = 1 ORDER BY nome";
        List<Ubs> lista = new ArrayList<>();
        try (Connection c = ConnectionFactory.getConnection();
             PreparedStatement ps = c.prepareStatement(sql);
             ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                Ubs u = new Ubs();
                u.id = rs.getInt("id");
                u.nome = rs.getString("nome");
                u.endereco = rs.getString("endereco");
                u.horario = rs.getString("horario");
                lista.add(u);
            }
        }
        return lista;
    }

    /** Servicos que o municipe pode pedir pelo site (sem os "somente equipe"). */
    public List<Servico> listarServicos() throws SQLException {
        return listarServicos(false);
    }

    /** @param incluirEquipe true no painel: inclui os servicos que so o servidor abre (cirurgia eletiva). */
    public List<Servico> listarServicos(boolean incluirEquipe) throws SQLException {
        String sql = "SELECT id, nome, descricao, somente_equipe FROM servico WHERE ativo = 1"
                + (incluirEquipe ? "" : " AND somente_equipe = 0") + " ORDER BY id";
        List<Servico> lista = new ArrayList<>();
        try (Connection c = ConnectionFactory.getConnection();
             PreparedStatement ps = c.prepareStatement(sql);
             ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                Servico s = new Servico();
                s.id = rs.getInt("id");
                s.nome = rs.getString("nome");
                s.descricao = rs.getString("descricao");
                s.somenteEquipe = rs.getBoolean("somente_equipe");
                lista.add(s);
            }
        }
        return lista;
    }
}
