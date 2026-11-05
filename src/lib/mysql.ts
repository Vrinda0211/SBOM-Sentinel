import "server-only";

import { createPool, type Pool } from "mysql2/promise";

declare global {
  var mysqlPool: Pool | undefined;
}

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} must be configured.`);
  }
  return value;
}

function getMySqlConfig() {
  const portValue = process.env.MYSQL_PORT ?? "3306";
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("MYSQL_PORT must be an integer between 1 and 65535.");
  }

  const password = process.env.MYSQL_PASSWORD;
  if (password === undefined) {
    throw new Error("MYSQL_PASSWORD must be configured.");
  }

  return {
    host: requiredEnvironmentValue("MYSQL_HOST"),
    port,
    user: requiredEnvironmentValue("MYSQL_USER"),
    password,
    database: requiredEnvironmentValue("MYSQL_DATABASE"),
  };
}

export function getMySqlPool(): Pool {
  if (!globalThis.mysqlPool) {
    globalThis.mysqlPool = createPool({
      ...getMySqlConfig(),
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }

  return globalThis.mysqlPool;
}
