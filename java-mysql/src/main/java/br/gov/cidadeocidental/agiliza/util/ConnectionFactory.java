package br.gov.cidadeocidental.agiliza.util;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;

/** Fabrica de conexoes JDBC. Para producao, trocar por um pool (HikariCP / DataSource do Tomcat). */
public final class ConnectionFactory {

    static {
        try {
            Class.forName("com.mysql.cj.jdbc.Driver");
        } catch (ClassNotFoundException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    private ConnectionFactory() {
    }

    public static Connection getConnection() throws SQLException {
        return DriverManager.getConnection(
                Config.get("db.url"), Config.get("db.user"), Config.get("db.password"));
    }
}
