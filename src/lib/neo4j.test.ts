import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authBasic, closeSession, createDriver, createSession } = vi.hoisted(
  () => ({
    authBasic: vi.fn(),
    closeSession: vi.fn(),
    createDriver: vi.fn(),
    createSession: vi.fn(),
  }),
);

vi.mock("server-only", () => ({}));
vi.mock("neo4j-driver", () => ({
  default: {
    auth: { basic: authBasic },
    driver: createDriver,
  },
}));

import { getNeo4jDriver, withNeo4jSession } from "./neo4j";

describe("Neo4j connection", () => {
  beforeEach(() => {
    delete globalThis.neo4jDriver;
    vi.stubEnv("NEO4J_URI", "neo4j://localhost:7687");
    vi.stubEnv("NEO4J_USERNAME", "neo4j");
    vi.stubEnv("NEO4J_PASSWORD", "test-password");
    authBasic.mockReset().mockReturnValue("auth-token");
    closeSession.mockReset().mockResolvedValue(undefined);
    createSession.mockReset().mockReturnValue({ close: closeSession });
    createDriver.mockReset().mockReturnValue({ session: createSession });
  });

  afterEach(() => {
    delete globalThis.neo4jDriver;
    vi.unstubAllEnvs();
  });

  it("creates and reuses a driver with configured credentials", () => {
    const driver = getNeo4jDriver();

    expect(getNeo4jDriver()).toBe(driver);
    expect(authBasic).toHaveBeenCalledWith("neo4j", "test-password");
    expect(createDriver).toHaveBeenCalledOnce();
    expect(createDriver).toHaveBeenCalledWith(
      "neo4j://localhost:7687",
      "auth-token",
    );
  });

  it("rejects incomplete connection configuration", () => {
    vi.stubEnv("NEO4J_PASSWORD", " ");

    expect(() => getNeo4jDriver()).toThrow(
      "NEO4J_URI, NEO4J_USERNAME, and NEO4J_PASSWORD must be configured.",
    );
    expect(createDriver).not.toHaveBeenCalled();
  });

  it("closes a session after a successful operation", async () => {
    const operation = vi.fn().mockResolvedValue("result");

    await expect(withNeo4jSession(operation)).resolves.toBe("result");
    expect(createSession).toHaveBeenCalledOnce();
    expect(closeSession).toHaveBeenCalledOnce();
  });

  it("preserves an operation failure while closing the session", async () => {
    const error = new Error("query failed");
    const operation = vi.fn().mockRejectedValue(error);

    await expect(withNeo4jSession(operation)).rejects.toBe(error);
    expect(closeSession).toHaveBeenCalledOnce();
  });

  it("reports both operation and close failures", async () => {
    const operationError = new Error("query failed");
    const closeError = new Error("session close failed");
    const operation = vi.fn().mockRejectedValue(operationError);
    closeSession.mockRejectedValue(closeError);

    await expect(withNeo4jSession(operation)).rejects.toMatchObject({
      errors: [operationError, closeError],
      message: "The Neo4j operation and session close both failed.",
    });
  });
});
