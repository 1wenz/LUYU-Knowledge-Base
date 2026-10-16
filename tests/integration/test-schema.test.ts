import assert from "node:assert/strict";
import test from "node:test";
import { withOwnedTestSchema } from "./test-schema";
import type { SqlPool } from "../../electron/services/knowledge/database/ports";

function fixture(failCreate = false) {
  const statements: string[] = [];
  let released = false;
  const pool: SqlPool = {
    connect: async () => ({
      async query<Row extends object>(text: string) {
        statements.push(text);
        if (failCreate && text.startsWith("CREATE")) throw new Error("cannot create schema");
        return { rows: [] as Row[], rowCount: 0 };
      },
      release() {
        released = true;
      },
    }),
  };
  return { pool, statements, released: () => released };
}

test("测试只创建并清理自己生成的随机 schema", async () => {
  const db = fixture();
  const schemas: string[] = [];
  for (let index = 0; index < 2; index++) {
    await withOwnedTestSchema(db.pool, async (schema) => {
      assert.match(schema, /^zhiyu_test_[a-f0-9]{32}$/);
      schemas.push(schema);
    });
  }
  assert.notEqual(schemas[0], schemas[1]);
  assert.deepEqual(
    db.statements,
    schemas.flatMap((schema) => [`CREATE SCHEMA "${schema}"`, `DROP SCHEMA "${schema}" CASCADE`]),
  );
  assert.equal(db.released(), true);
});

test("创建失败时不能执行 DROP；测试失败时仍清理已创建的 schema", async () => {
  const failed = fixture(true);
  await assert.rejects(withOwnedTestSchema(failed.pool, async () => undefined));
  assert.equal(failed.statements.length, 1);
  assert.equal(failed.released(), true);
  const db = fixture();
  await assert.rejects(
    withOwnedTestSchema(db.pool, async () => {
      throw new Error("test failed");
    }),
    /test failed/,
  );
  assert.equal(db.statements.length, 2);
  assert.ok(db.statements[1].startsWith('DROP SCHEMA "zhiyu_test_'));
});
