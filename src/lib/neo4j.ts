import neo4j, { type Driver } from "neo4j-driver";

let driver: Driver | undefined;

export function getNeo4jDriver(): Driver {
  if (driver) {
    return driver;
  }

  const { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD } = process.env;
  if (!NEO4J_URI || !NEO4J_USERNAME || !NEO4J_PASSWORD) {
    throw new Error(
      "NEO4J_URI, NEO4J_USERNAME, and NEO4J_PASSWORD must be configured.",
    );
  }

  driver = neo4j.driver(
    NEO4J_URI,
    neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD),
  );

  return driver;
}
