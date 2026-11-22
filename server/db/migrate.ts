import type { Pool, RowDataPacket } from 'mysql2/promise'

const migrations: Array<{ version: number; statements: string[] }> = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INT NOT NULL PRIMARY KEY,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS admin_users (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(80) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS admin_sessions (
        token_hash CHAR(64) NOT NULL PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_admin_sessions_user (user_id),
        INDEX idx_admin_sessions_expiry (expires_at),
        CONSTRAINT fk_admin_sessions_user FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS site_settings (
        id INT NOT NULL PRIMARY KEY,
        site_name VARCHAR(120) NOT NULL,
        subtitle VARCHAR(255) NOT NULL,
        console_url VARCHAR(500) NOT NULL,
        accent_color VARCHAR(20) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS nav_groups (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        anchor VARCHAR(160) NOT NULL UNIQUE,
        sort_order INT NOT NULL DEFAULT 0,
        is_visible BOOLEAN NOT NULL DEFAULT TRUE,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS documents (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        group_id BIGINT UNSIGNED NOT NULL,
        title VARCHAR(180) NOT NULL,
        nav_label VARCHAR(120) NOT NULL,
        slug VARCHAR(180) NOT NULL UNIQUE,
        markdown LONGTEXT NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        is_visible BOOLEAN NOT NULL DEFAULT TRUE,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_documents_group_order (group_id, sort_order),
        CONSTRAINT fk_documents_group FOREIGN KEY (group_id) REFERENCES nav_groups(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS media_assets (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        storage_name VARCHAR(255) NOT NULL UNIQUE,
        original_name VARCHAR(255) NOT NULL,
        mime VARCHAR(80) NOT NULL,
        byte_size BIGINT UNSIGNED NOT NULL,
        width INT NULL,
        height INT NULL,
        url_path VARCHAR(500) NOT NULL,
        created_by BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_media_created (created_at),
        CONSTRAINT fk_media_user FOREIGN KEY (created_by) REFERENCES admin_users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS publications (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        site_name VARCHAR(120) NOT NULL,
        subtitle VARCHAR(255) NOT NULL,
        console_url VARCHAR(500) NOT NULL,
        accent_color VARCHAR(20) NOT NULL,
        document_count INT NOT NULL DEFAULT 0,
        created_by BIGINT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_publications_created (created_at),
        CONSTRAINT fk_publications_user FOREIGN KEY (created_by) REFERENCES admin_users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS publication_groups (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        publication_id BIGINT UNSIGNED NOT NULL,
        source_group_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(120) NOT NULL,
        anchor VARCHAR(160) NOT NULL,
        sort_order INT NOT NULL,
        INDEX idx_pub_groups_order (publication_id, sort_order),
        CONSTRAINT fk_pub_groups_publication FOREIGN KEY (publication_id) REFERENCES publications(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS publication_documents (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        publication_id BIGINT UNSIGNED NOT NULL,
        publication_group_id BIGINT UNSIGNED NOT NULL,
        source_document_id BIGINT UNSIGNED NOT NULL,
        title VARCHAR(180) NOT NULL,
        nav_label VARCHAR(120) NOT NULL,
        slug VARCHAR(180) NOT NULL,
        markdown LONGTEXT NOT NULL,
        rendered_html LONGTEXT NOT NULL,
        search_text LONGTEXT NOT NULL,
        sort_order INT NOT NULL,
        INDEX idx_pub_docs_order (publication_group_id, sort_order),
        INDEX idx_pub_docs_source (publication_id, source_document_id),
        CONSTRAINT fk_pub_docs_publication FOREIGN KEY (publication_id) REFERENCES publications(id) ON DELETE CASCADE,
        CONSTRAINT fk_pub_docs_group FOREIGN KEY (publication_group_id) REFERENCES publication_groups(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS site_state (
        id INT NOT NULL PRIMARY KEY,
        active_publication_id BIGINT UNSIGNED NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_state_publication FOREIGN KEY (active_publication_id) REFERENCES publications(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        admin_id BIGINT UNSIGNED NOT NULL,
        action VARCHAR(100) NOT NULL,
        target_type VARCHAR(80) NOT NULL,
        target_id VARCHAR(80) NULL,
        details TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_audit_created (created_at),
        CONSTRAINT fk_audit_user FOREIGN KEY (admin_id) REFERENCES admin_users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `INSERT INTO site_settings (id, site_name, subtitle, console_url, accent_color)
       VALUES (1, ${JSON.stringify(process.env.DEFAULT_SITE_NAME ?? 'Link API 文档')}, ${JSON.stringify(process.env.DEFAULT_SITE_SUBTITLE ?? 'AI API 接入与使用指南')}, ${JSON.stringify(process.env.DEFAULT_CONSOLE_URL ?? 'https://ai.gs88.shop')}, ${JSON.stringify(process.env.DEFAULT_ACCENT_COLOR ?? '#6d4aff')})
       ON DUPLICATE KEY UPDATE id = id`,
      `INSERT INTO site_state (id, active_publication_id) VALUES (1, NULL)
       ON DUPLICATE KEY UPDATE id = id`
    ]
  },
  {
    version: 2,
    statements: [
      `ALTER TABLE publication_documents ADD COLUMN content_updated_at DATETIME NULL`
    ]
  },
  {
    version: 3,
    statements: [
      `CREATE TABLE IF NOT EXISTS model_plaza_state (
        id INT NOT NULL PRIMARY KEY, settings_json LONGTEXT NULL, snapshot_json LONGTEXT NULL,
        last_attempt_at DATETIME NULL, last_error TEXT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    ]
  }
]

export async function migrate(pool: Pool) {
  const connection = await pool.getConnection()
  try {
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INT NOT NULL PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    const [rows] = await connection.query<Array<RowDataPacket & { version: number }>>('SELECT version FROM schema_migrations')
    const applied = new Set(rows.map((row) => row.version))

    for (const migration of migrations) {
      if (applied.has(migration.version)) continue
      await connection.beginTransaction()
      try {
        for (const statement of migration.statements) {
          await connection.query(statement)
        }
        await connection.query('INSERT INTO schema_migrations (version) VALUES (?)', [migration.version])
        await connection.commit()
      } catch (error) {
        await connection.rollback()
        throw error
      }
    }
  } finally {
    connection.release()
  }
}
