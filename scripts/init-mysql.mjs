import "dotenv/config";

import { createConnection, createPool } from "mysql2/promise";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const database = process.env.MYSQL_DATABASE;
if (!database || !/^[A-Za-z0-9_]+$/.test(database)) {
  throw new Error("MYSQL_DATABASE must contain only letters, numbers, and underscores.");
}

const config = {
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
};
for (const name of ["MYSQL_HOST", "MYSQL_USER", "MYSQL_PASSWORD"]) {
  if (!process.env[name]) {
    throw new Error(`${name} must be configured.`);
  }
}
if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error("MYSQL_PORT must be an integer between 1 and 65535.");
}

const admin = await createConnection(config);
try {
  await admin.query(
    `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4`,
  );
} finally {
  await admin.end();
}

const pool = createPool({ ...config, database, multipleStatements: false });
try {
  for (const filename of ["schema.sql", "views.sql"]) {
    const sql = await readFile(
      fileURLToPath(new URL(`../database/mysql/${filename}`, import.meta.url)),
      "utf8",
    );
    const statements = sql
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) {
      await pool.query(statement);
    }
  }

  const indexes = [
    {
      table: "COMPONENT",
      name: "idx_component_lookup",
      definition: "(component_name, component_type)",
    },
    {
      table: "COMPONENT_VERSION_VULNERABILITY",
      name: "idx_cvv_vulnerability_component",
      definition: "(vulnerability_id, component_version_id)",
    },
  ];
  for (const index of indexes) {
    const [existing] = await pool.execute(
      `SELECT 1
       FROM information_schema.statistics
       WHERE table_schema = DATABASE()
         AND table_name = ?
         AND index_name = ?
       LIMIT 1`,
      [index.table, index.name],
    );
    if (existing.length === 0) {
      await pool.query(
        `ALTER TABLE \`${index.table}\`
         ADD INDEX \`${index.name}\` ${index.definition}`,
      );
    }
  }

  const routineSql = await readFile(
    fileURLToPath(
      new URL("../database/mysql/procedures.sql", import.meta.url),
    ),
    "utf8",
  );
  for (const statement of routineSql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean)) {
    await pool.query(statement);
  }
} finally {
  await pool.end();
}

console.info(`MySQL schema initialized in database "${database}".`);
