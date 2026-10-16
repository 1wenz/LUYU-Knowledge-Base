import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../../src/lib/domain/validation";
import {
  applyMigrations,
  migrationChecksum,
} from "../../electron/services/knowledge/database/migrations";
import type {
  SqlConnection,
  SqlParameter,
  SqlPool,
} from "../../electron/services/knowledge/database/ports";

function fixture(
  options: {
    applied?: Array<{ version: number; checksum: string }>;
    vectorVersion?: string;
    failOn?: string;
    schemaExists?: boolean;
  } = {},
) {
  const calls: Array<{ text: string; values: readonly SqlParameter[] }> = [];
  const applied = options.applied ?? [];
  let released = false;
  let schema = "public";
  const connection: SqlConnection = {
    async query<Row extends object>(text: string, values: readonly SqlParameter[] = []) {
      calls.push({ text, values });
      if (text === options.failOn) throw new Error("password=do-not-expose SQL body");
      let rows: object[] = [];
      if (text.includes("set_config('search_path'")) schema = String(values[0]).split('"')[1];
      if (text.includes("current_schema() AS schema"))
        rows = [{ schema: options.schemaExists === false ? "pg_catalog" : schema }];
      if (text.includes("server_version_num")) rows = [{ version: 170005 }];
      if (text.includes("FROM pg_extension"))
        rows = [
          { name: "vector", version: options.vectorVersion ?? "0.8.0", schema: "public" },
          { name: "pg_trgm", version: "1.6", schema: "public" },
        ];
      if (text.includes("SELECT version, checksum")) rows = applied;
      return { rows: rows as Row[], rowCount: rows.length };
    },
    release() {
      released = true;
    },
  };
  const pool: SqlPool = { connect: async () => connection };
  return { pool, calls, released: () => released };
}

const migrations = [
  { version: 1, sql: "CREATE TABLE example (id integer);\n" },
  { version: 2, sql: "CREATE INDEX example_idx ON example(id);\n" },
];

test("迁移在同一短事务内按版本执行，checksum 参数化写入，连接释放", async () => {
  const db = fixture();
  const result = await applyMigrations(db.pool, migrations, {
    schema: "zhiyu_test_0123456789abcdef0123456789abcdef",
  });
  assert.deepEqual(result.applied, [1, 2]);
  assert.equal(db.calls[0].text, "BEGIN");
  assert.ok(db.calls.some((call) => call.text.includes("pg_advisory_xact_lock")));
  assert.ok(
    db.calls.findIndex((call) => call.text === migrations[0].sql) <
      db.calls.findIndex((call) => call.text === migrations[1].sql),
  );
  assert.equal(db.calls.at(-1)!.text, "COMMIT");
  const inserts = db.calls.filter((call) => call.text.includes("INSERT INTO schema_migrations"));
  assert.deepEqual(
    inserts.map((call) => call.values),
    [
      [1, migrationChecksum(migrations[0].sql)],
      [2, migrationChecksum(migrations[1].sql)],
    ],
  );
  assert.equal(db.released(), true);
});

test("重复启动不重新执行已校验的迁移，CRLF 不改变 checksum", async () => {
  assert.equal(migrationChecksum("SELECT 1;\r\n"), migrationChecksum("SELECT 1;\n"));
  const db = fixture({
    applied: migrations.map((migration) => ({
      version: migration.version,
      checksum: migrationChecksum(migration.sql),
    })),
  });
  assert.deepEqual((await applyMigrations(db.pool, migrations)).applied, []);
  assert.ok(db.calls.every((call) => !migrations.some((migration) => migration.sql === call.text)));
});

test("已提交迁移内容变化或数据库版本超前时拒绝启动并回滚", async () => {
  for (const applied of [
    [{ version: 1, checksum: "wrong" }],
    [{ version: 99, checksum: "unknown" }],
    [{ version: 2, checksum: migrationChecksum(migrations[1].sql) }],
  ]) {
    const db = fixture({ applied });
    await assert.rejects(
      applyMigrations(db.pool, migrations),
      (error: unknown) => error instanceof DomainError && error.code === "SCHEMA_MISMATCH",
    );
    assert.equal(db.calls.at(-1)!.text, "ROLLBACK");
    assert.ok(!db.calls.some((call) => call.text === migrations[0].sql));
    assert.equal(db.released(), true);
  }
});

test("pgvector 低版本不能静默继续，失败不暴露数据库异常原文", async () => {
  const outdated = fixture({ vectorVersion: "0.7.4" });
  await assert.rejects(
    applyMigrations(outdated.pool, migrations),
    (error: unknown) => error instanceof DomainError && error.code === "SCHEMA_MISMATCH",
  );
  const failed = fixture({ failOn: migrations[1].sql });
  await assert.rejects(
    applyMigrations(failed.pool, migrations),
    (error: unknown) => error instanceof DomainError && !error.message.includes("do-not-expose"),
  );
  assert.equal(failed.calls.at(-1)!.text, "ROLLBACK");
  assert.equal(failed.released(), true);
});

test("schema 标识符不能注入 SQL，取消时不提交任何迁移", async () => {
  const db = fixture();
  await assert.rejects(
    applyMigrations(db.pool, migrations, { schema: "public; DROP SCHEMA public" }),
    DomainError,
  );
  assert.equal(db.calls.length, 0);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    applyMigrations(db.pool, migrations, { signal: controller.signal }),
    (error: unknown) => error instanceof DomainError && error.code === "CANCELLED",
  );
  assert.equal(db.calls.length, 0);
});

test("目标 schema 不存在时不得退回 public 执行迁移", async () => {
  const db = fixture({ schemaExists: false });
  await assert.rejects(
    applyMigrations(db.pool, migrations, { schema: "missing_schema" }),
    (error: unknown) => error instanceof DomainError && error.code === "SCHEMA_MISMATCH",
  );
  assert.ok(db.calls.every((call) => !call.text.startsWith("CREATE TABLE")));
  assert.equal(db.calls.at(-1)!.text, "ROLLBACK");
});
