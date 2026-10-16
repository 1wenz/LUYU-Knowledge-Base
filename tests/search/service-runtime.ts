import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DEFAULT_SETTINGS } from "../../src/lib/contracts";
import { DomainError } from "../../src/lib/domain/validation";
import { createKnowledgeService } from "../../electron/services/knowledge";

async function main() {
  let closed = 0;
  const service = createKnowledgeService(
    {
      getSettings: () => structuredClone(DEFAULT_SETTINGS),
      readSecret: async () => "synthetic-key",
      createId: randomUUID,
      now: () => new Date(),
      logger: { info() {}, warn() {}, error() {} },
      emit() {},
    },
    {
      fetch: async (url) =>
        String(url).endsWith("/models")
          ? Response.json({ data: [] })
          : Response.json({ valid: true }),
      createPool: () => ({
        connect: async () => {
          throw new Error("synthetic-database-unavailable");
        },
        close: async () => {
          closed++;
        },
      }),
    },
  );
  const context = { ownerId: "bundled-test", signal: new AbortController().signal };
  assert.deepEqual(await service.models.list(context), []);
  assert.equal((await service.connections.test("cohere", context)).ok, true);
  // The real default resource loader must find the copied SQL before the fake connection is requested.
  await assert.rejects(
    service.index.status(context),
    (error: unknown) => error instanceof DomainError && error.code === "DATABASE_UNAVAILABLE",
  );
  await service.dispose();
  assert.equal(closed, 1);
  process.stdout.write(JSON.stringify({ service: true, migrations: true, providerProbe: true }));
}
void main().catch(() => {
  process.exitCode = 1;
});
