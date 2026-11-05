import "server-only";

import neo4j, { type Driver, type Session } from "neo4j-driver";

declare global {
  var neo4jDriver: Driver | undefined;
}

export function getNeo4jDriver(): Driver {
  if (globalThis.neo4jDriver) {
    return globalThis.neo4jDriver;
  }

  const { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD } = process.env;
  if (
    !NEO4J_URI?.trim() ||
    !NEO4J_USERNAME?.trim() ||
    !NEO4J_PASSWORD?.trim()
  ) {
    throw new Error(
      "NEO4J_URI, NEO4J_USERNAME, and NEO4J_PASSWORD must be configured.",
    );
  }

  globalThis.neo4jDriver = neo4j.driver(
    NEO4J_URI,
    neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD),
  );

  return globalThis.neo4jDriver;
}

export async function withNeo4jSession<T>(
  operation: (session: Session) => Promise<T>,
): Promise<T> {
  const session = getNeo4jDriver().session();
  let operationFailed = false;
  let operationError: unknown;

  try {
    return await operation(session);
  } catch (error) {
    operationFailed = true;
    operationError = error;
    throw error;
  } finally {
    try {
      await session.close();
    } catch (closeError) {
      if (operationFailed) {
        throw new AggregateError(
          [operationError, closeError],
          "The Neo4j operation and session close both failed.",
        );
      }
      throw closeError;
    }
  }
}
