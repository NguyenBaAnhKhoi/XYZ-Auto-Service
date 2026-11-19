package com.example.demo;

import org.junit.jupiter.api.Test;

import java.io.File;
import java.nio.file.Files;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class NeonConnectivityTest {

    private String resolveDatabaseUrl() {
        String dbUrl = System.getenv("DATABASE_URL");
        if (dbUrl != null && !dbUrl.isBlank()) {
            return dbUrl;
        }
        dbUrl = System.getenv("DATABASE_URL_UNPOOLED");
        if (dbUrl != null && !dbUrl.isBlank()) {
            return dbUrl;
        }

        // Try reading from .env.local or .env in current and parent directories
        File[] candidateFiles = new File[]{
                new File(".env.local"),
                new File(".env"),
                new File("../.env.local"),
                new File("../.env")
        };

        for (File file : candidateFiles) {
            if (file.exists() && file.isFile()) {
                try {
                    List<String> lines = Files.readAllLines(file.toPath());
                    for (String line : lines) {
                        line = line.trim();
                        if (line.startsWith("DATABASE_URL=") || line.startsWith("DATABASE_URL_UNPOOLED=")) {
                            String value = line.substring(line.indexOf('=') + 1).trim();
                            if ((value.startsWith("\"") && value.endsWith("\"")) ||
                                    (value.startsWith("'") && value.endsWith("'"))) {
                                value = value.substring(1, value.length() - 1).trim();
                            }
                            if (!value.isBlank()) {
                                return value;
                            }
                        }
                    }
                } catch (Exception ignored) {
                }
            }
        }
        return null;
    }

    @Test
    void testNeonDatabaseConnectionAndQueries() throws Exception {
        String rawUrl = resolveDatabaseUrl();
        assertNotNull(rawUrl, "DATABASE_URL or .env.local must be present for Neon connectivity test");

        // Convert to JDBC URL if in postgres:// format
        String jdbcUrl;
        String user = null;
        String password = null;

        String cleanUrl = rawUrl.trim();
        if ((cleanUrl.startsWith("\"") && cleanUrl.endsWith("\"")) ||
                (cleanUrl.startsWith("'") && cleanUrl.endsWith("'"))) {
            cleanUrl = cleanUrl.substring(1, cleanUrl.length() - 1).trim();
        }

        if (cleanUrl.startsWith("postgres://") || cleanUrl.startsWith("postgresql://")) {
            java.net.URI uri = java.net.URI.create(cleanUrl.replaceFirst("^postgres(ql)?://", "http://"));
            String host = uri.getHost();
            int port = uri.getPort() > 0 ? uri.getPort() : 5432;
            String path = uri.getPath();
            String query = uri.getQuery();

            StringBuilder sb = new StringBuilder("jdbc:postgresql://")
                    .append(host)
                    .append(":")
                    .append(port)
                    .append((path != null && !path.isEmpty()) ? path : "/neondb");

            if (query != null && !query.isEmpty()) {
                sb.append("?").append(query);
                if (!query.contains("sslmode=")) {
                    sb.append("&sslmode=require");
                }
            } else {
                sb.append("?sslmode=require");
            }
            jdbcUrl = sb.toString();

            String userInfo = uri.getUserInfo();
            if (userInfo != null && !userInfo.isEmpty()) {
                String[] parts = userInfo.split(":", 2);
                if (parts.length > 0) user = java.net.URLDecoder.decode(parts[0], java.nio.charset.StandardCharsets.UTF_8);
                if (parts.length > 1) password = java.net.URLDecoder.decode(parts[1], java.nio.charset.StandardCharsets.UTF_8);
            }
        } else {
            jdbcUrl = cleanUrl.startsWith("jdbc:") ? cleanUrl : "jdbc:" + cleanUrl;
        }

        System.out.println("Connecting to Neon PostgreSQL: " + jdbcUrl.replaceAll(":[^:@]+@", ":***@"));

        try (Connection conn = DriverManager.getConnection(jdbcUrl, user, password);
             Statement stmt = conn.createStatement()) {

            assertNotNull(conn, "Connection to Neon PostgreSQL should not be null");
            assertFalse(conn.isClosed(), "Connection to Neon PostgreSQL should be open");

            // Execute test queries
            try (ResultSet rs = stmt.executeQuery("SELECT 1 AS alive, current_database() AS db, current_user AS usr, version() AS ver")) {
                assertTrue(rs.next(), "Query should return at least one row");
                assertEquals(1, rs.getInt("alive"));
                String dbName = rs.getString("db");
                String dbUser = rs.getString("usr");
                String version = rs.getString("ver");

                System.out.println("[Neon Connectivity Success] Database: " + dbName + ", User: " + dbUser);
                System.out.println("[PostgreSQL Version] " + version);

                assertNotNull(dbName);
                assertNotNull(dbUser);
                assertTrue(version.toLowerCase().contains("postgresql"));
            }
        }
    }
}
