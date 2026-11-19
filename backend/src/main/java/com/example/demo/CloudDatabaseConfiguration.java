package com.example.demo;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;

import javax.sql.DataSource;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

/**
 * Robust cloud database configuration for PostgreSQL runtime environments.
 * Converts postgres:// and postgresql:// URIs into valid JDBC URLs with credentials and SSL settings.
 */
@Configuration
@Profile("postgres")
public class CloudDatabaseConfiguration {

    private static final Logger log = LoggerFactory.getLogger(CloudDatabaseConfiguration.class);

    @Bean
    @Primary
    public DataSource dataSource(Environment env) {
        String rawUrl = resolveDatabaseUrl(env);
        String username = env.getProperty("DB_USER", env.getProperty("POSTGRES_USER", env.getProperty("spring.datasource.username", "postgres")));
        String password = env.getProperty("DB_PASSWORD", env.getProperty("POSTGRES_PASSWORD", env.getProperty("spring.datasource.password", "postgres")));
        String jdbcUrl = "jdbc:postgresql://localhost:5432/xyz_auto_service?sslmode=prefer";

        if (rawUrl != null && !rawUrl.isBlank()) {
            rawUrl = rawUrl.trim();
            if ((rawUrl.startsWith("\"") && rawUrl.endsWith("\"")) ||
                    (rawUrl.startsWith("'") && rawUrl.endsWith("'"))) {
                rawUrl = rawUrl.substring(1, rawUrl.length() - 1).trim();
            }

            if (rawUrl.startsWith("postgres://") || rawUrl.startsWith("postgresql://")) {
                try {
                    String httpUri = rawUrl.replaceFirst("^postgres(ql)?://", "http://");
                    URI uri = URI.create(httpUri);
                    String host = uri.getHost();
                    int port = uri.getPort() > 0 ? uri.getPort() : 5432;
                    String path = uri.getPath();
                    String query = uri.getQuery();

                    StringBuilder builder = new StringBuilder("jdbc:postgresql://")
                            .append(host)
                            .append(":")
                            .append(port)
                            .append((path != null && !path.isEmpty()) ? path : "/xyz_auto_service");

                    if (query != null && !query.isEmpty()) {
                        builder.append("?").append(query);
                        if (!query.contains("sslmode=")) {
                            builder.append("&sslmode=require");
                        }
                    } else {
                        builder.append("?sslmode=require");
                    }
                    jdbcUrl = builder.toString();

                    String userInfo = uri.getUserInfo();
                    if (userInfo != null && !userInfo.isEmpty()) {
                        String[] parts = userInfo.split(":", 2);
                        if (parts.length > 0 && !parts[0].isEmpty()) {
                            username = URLDecoder.decode(parts[0], StandardCharsets.UTF_8);
                        }
                        if (parts.length > 1) {
                            password = URLDecoder.decode(parts[1], StandardCharsets.UTF_8);
                        }
                    }
                } catch (Exception e) {
                    String normalized = rawUrl.replaceFirst("^postgres://", "postgresql://");
                    jdbcUrl = normalized.startsWith("jdbc:") ? normalized : "jdbc:" + normalized;
                }
            } else if (!rawUrl.startsWith("jdbc:")) {
                String normalized = rawUrl.replaceFirst("^postgres://", "postgresql://");
                jdbcUrl = normalized.startsWith("jdbc:") ? normalized : "jdbc:" + normalized;
            } else {
                jdbcUrl = rawUrl;
            }
        }

        log.info("[CloudDatabaseConfiguration] Initializing HikariDataSource with JDBC URL: {} and user: {}", jdbcUrl, username);

        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(jdbcUrl);
        config.setUsername(username);
        config.setPassword(password);
        config.setDriverClassName("org.postgresql.Driver");

        config.setMaximumPoolSize(10);
        config.setMinimumIdle(2);
        config.setIdleTimeout(30000);
        config.setConnectionTimeout(20000);
        config.setMaxLifetime(600000);
        config.setKeepaliveTime(30000);
        config.setLeakDetectionThreshold(20000);

        return new HikariDataSource(config);
    }

    private String resolveDatabaseUrl(Environment env) {
        String[] keys = new String[]{
                "DB_URL",
                "SPRING_DATASOURCE_URL",
                "DATABASE_URL",
                "DATABASE_URL_UNPOOLED",
                "NEON_DATABASE_URL",
                "POSTGRES_URL",
                "JDBC_DATABASE_URL"
        };
        for (String key : keys) {
            String val = env.getProperty(key);
            if (val != null && !val.isBlank()) {
                return val;
            }
        }
        return null;
    }
}
