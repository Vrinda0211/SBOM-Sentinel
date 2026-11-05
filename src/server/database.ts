import "server-only";

import type { PoolConnection } from "mysql2/promise";
import { getMySqlPool } from "@/lib/mysql";

export function requireUuid(value: string, label: string): void {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new TypeError(`${label} must be a UUID.`);
  }
}

export function requireIsoDate(
  value: string | null | undefined,
  label: string,
): void {
  if (value == null) {
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`${label} must be a date in YYYY-MM-DD format.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TypeError(`${label} must be a valid calendar date.`);
  }
}

export async function inTransaction<T>(
  operation: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
  const connection = await getMySqlPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "The database operation and its rollback both failed.",
      );
    }
    throw error;
  } finally {
    connection.release();
  }
}
