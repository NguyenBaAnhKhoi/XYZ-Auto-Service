package com.example.demo;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;

import java.io.File;
import java.net.URI;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Automatically converts standard cloud PostgreSQL connection strings
 * (e.g. from Neon, Supabase, Render, Railway, Heroku) into Spring Boot JDBC configuration.
 * Handles DATABASE_URL in postgres:// or postgresql:// formats, extracts credentials,
 * ensures sslmode=require for cloud providers, and automatically loads .env.local / .env if present.
 */
public class CloudDatabaseEnvironmentPostProcessor implements EnvironmentPostProcessor {

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        String databaseUrl = resolveDatabaseUrl(environment);
        if (databaseUrl == null || databaseUrl.isBlank()) {
            return;
        }

        databaseUrl = databaseUrl.trim();
        if ((databaseUrl.startsWith("\"") && databaseUrl.endsWith("\"")) ||
                (databaseUrl.startsWith("'") && databaseUrl.endsWith("'"))) {
            databaseUrl = databaseUrl.substring(1, databaseUrl.length() - 1).trim();
        }

        Map<String, Object> props = new HashMap<>();
        props.put("spring.datasource.driver-class-name", "org.postgresql.Driver");

        if (databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://")) {
            try {
                // Replace scheme with standard http for safe URI parsing
                String rawUri = databaseUrl.replaceFirst("^postgres(ql)?://", "http://");
                URI uri = URI.create(rawUri);

                String host = uri.getHost();
                int port = uri.getPort() > 0 ? uri.getPort() : 5432;
                String path = uri.getPath();
                String query = uri.getQuery();

                StringBuilder jdbcUrl = new StringBuilder("jdbc:postgresql://")
                        .append(host)
                        .append(":")
                        .append(port)
                        .append((path != null && !path.isEmpty()) ? path : "/xyz_auto_service");

                if (query != null && !query.isEmpty()) {
                    jdbcUrl.append("?").append(query);
                    if (!query.contains("sslmode=")) {
                        jdbcUrl.append("&sslmode=require");
                    }
                } else {
                    jdbcUrl.append("?sslmode=require");
                }

                props.put("spring.datasource.url", jdbcUrl.toString());

                String userInfo = uri.getUserInfo();
                if (userInfo != null && !userInfo.isEmpty()) {
                    String[] parts = userInfo.split(":", 2);
                    if (parts.length > 0 && !parts[0].isEmpty()) {
                        String user = java.net.URLDecoder.decode(parts[0], java.nio.charset.StandardCharsets.UTF_8);
                        props.put("spring.datasource.username", user);
                    }
                    if (parts.length > 1) {
                        String pass = java.net.URLDecoder.decode(parts[1], java.nio.charset.StandardCharsets.UTF_8);
                        props.put("spring.datasource.password", pass);
                    }
                }
            } catch (Exception e) {
                // Fallback: prefix jdbc: and ensure postgresql scheme if standard URI parsing fails
                String normalized = databaseUrl.replaceFirst("^postgres://", "postgresql://");
                String fallback = normalized.startsWith("jdbc:") ? normalized : "jdbc:" + normalized;
                props.put("spring.datasource.url", fallback);
            }
        } else if (!databaseUrl.startsWith("jdbc:")) {
            String normalized = databaseUrl.replaceFirst("^postgres://", "postgresql://");
            props.put("spring.datasource.url", normalized.startsWith("jdbc:") ? normalized : "jdbc:" + normalized);
        } else {
            props.put("spring.datasource.url", databaseUrl);
        }

        if (!props.isEmpty()) {
            environment.getPropertySources().addFirst(new MapPropertySource("cloudDatabaseConfiguration", props));
        }
    }

    private String resolveDatabaseUrl(ConfigurableEnvironment environment) {
        String[] keys = new String[]{"DATABASE_URL", "DATABASE_URL_UNPOOLED", "NEON_DATABASE_URL", "POSTGRES_URL"};
        for (String key : keys) {
            String val = environment.getProperty(key);
            if (val != null && !val.isBlank()) {
                return val;
            }
        }

        // Avoid reading ambient .env in isolated unit tests that use MockEnvironment
        if (environment.getPropertySources().contains("mockProperties")) {
            return null;
        }

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
                    Map<String, Object> dotenvProps = new HashMap<>();
                    for (String line : lines) {
                        line = line.trim();
                        if (line.isEmpty() || line.startsWith("#") || !line.contains("=")) {
                            continue;
                        }
                        int eqIdx = line.indexOf('=');
                        String k = line.substring(0, eqIdx).trim();
                        String v = line.substring(eqIdx + 1).trim();
                        if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) {
                            v = v.substring(1, v.length() - 1).trim();
                        }
                        dotenvProps.put(k, v);
                    }
                    if (!dotenvProps.isEmpty()) {
                        environment.getPropertySources().addLast(new MapPropertySource("dotenvFileProperties", dotenvProps));
                        for (String key : keys) {
                            Object val = dotenvProps.get(key);
                            if (val != null && !val.toString().isBlank()) {
                                return val.toString();
                            }
                        }
                    }
                } catch (Exception ignored) {
                }
            }
        }

        return null;
    }
}
