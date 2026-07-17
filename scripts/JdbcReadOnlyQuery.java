import com.alibaba.druid.filter.config.ConfigTools;
import org.jasypt.encryption.pbe.StandardPBEStringEncryptor;

import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Statement;
import java.util.Properties;

public final class JdbcReadOnlyQuery {
    private JdbcReadOnlyQuery() {}

    public static void main(String[] args) throws Exception {
        if (args.length != 3) {
            throw new IllegalArgumentException("Usage: JdbcReadOnlyQuery <properties> <datasource-prefix> <sql-file>");
        }
        Properties properties = new Properties();
        try (FileInputStream input = new FileInputStream(args[0])) {
            properties.load(input);
        }
        String prefix = args[1];
        String url = required(properties, prefix + ".jdbc-url");
        String username = decrypt(properties, required(properties, prefix + ".username"));
        String password = decrypt(properties, required(properties, prefix + ".password"));
        String sql = new String(Files.readAllBytes(Paths.get(args[2])), StandardCharsets.UTF_8);

        Class.forName("com.mysql.cj.jdbc.Driver");
        try (Connection connection = DriverManager.getConnection(url, username, password)) {
            connection.setReadOnly(true);
            try (Statement statement = connection.createStatement()) {
                statement.setFetchSize(500);
                statement.setMaxRows(10000);
                try (ResultSet resultSet = statement.executeQuery(sql)) {
                    printJson(resultSet);
                }
            }
        }
    }

    private static String required(Properties properties, String key) {
        String value = properties.getProperty(key);
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException("Missing property: " + key);
        }
        return value.trim();
    }

    private static String decrypt(Properties properties, String value) {
        if (value.startsWith("ENC(") && value.endsWith(")")) {
            StandardPBEStringEncryptor encryptor = new StandardPBEStringEncryptor();
            encryptor.setPassword(required(properties, "jasypt.encryptor.password"));
            return encryptor.decrypt(value.substring(4, value.length() - 1));
        }
        try {
            return ConfigTools.decrypt(value);
        } catch (Exception ignored) {
            return value;
        }
    }

    private static void printJson(ResultSet resultSet) throws Exception {
        ResultSetMetaData metadata = resultSet.getMetaData();
        int columns = metadata.getColumnCount();
        StringBuilder output = new StringBuilder("[\n");
        boolean firstRow = true;
        while (resultSet.next()) {
            if (!firstRow) output.append(",\n");
            firstRow = false;
            output.append("  {");
            for (int column = 1; column <= columns; column++) {
                if (column > 1) output.append(',');
                output.append('\"').append(escape(metadata.getColumnLabel(column))).append("\":");
                Object value = resultSet.getObject(column);
                if (value == null) output.append("null");
                else if (value instanceof Number || value instanceof Boolean) output.append(value);
                else output.append('\"').append(escape(String.valueOf(value))).append('\"');
            }
            output.append('}');
        }
        output.append("\n]\n");
        System.out.print(output);
    }

    private static String escape(String value) {
        return value.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\r", "\\r")
                .replace("\n", "\\n")
                .replace("\t", "\\t");
    }
}
