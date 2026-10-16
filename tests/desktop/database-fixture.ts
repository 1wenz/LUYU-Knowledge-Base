import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { PublicSettings } from "../../src/lib/contracts";

/** Own a new database, since the production app deliberately uses only public schema. */
export async function createDesktopTestDatabase() {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error("需要显式的专用 TEST_DATABASE_URL。");
  const url = new URL(connectionString);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    throw new Error("桌面验收只使用本机隔离测试实例。");
  const database = `zhiyu_desktop_test_${randomUUID().replaceAll("-", "")}`;
  if (!/^zhiyu_desktop_test_[a-f0-9]{32}$/.test(database)) throw new Error("测试数据库名无效。");
  const admin = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 3000 });
  let oid: number | undefined;
  let created = false;
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    try {
      if (created) {
        const current = await admin.query<{ oid: number }>(
          "SELECT oid FROM pg_database WHERE datname = $1",
          [database],
        );
        if (current.rows[0]?.oid !== oid) throw new Error("测试数据库归属已改变，拒绝清理。");
        await admin.query(`DROP DATABASE "${database}"`);
      }
    } finally {
      await admin.end();
    }
  };
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    oid = (
      await admin.query<{ oid: number }>("SELECT oid FROM pg_database WHERE datname = $1", [
        database,
      ])
    ).rows[0].oid;
    const ownedUrl = new URL(url);
    ownedUrl.pathname = `/${database}`;
    const owned = new Pool({
      connectionString: ownedUrl.href,
      max: 1,
      connectionTimeoutMillis: 3000,
    });
    try {
      await owned.query("CREATE EXTENSION vector WITH SCHEMA public");
      await owned.query("CREATE EXTENSION pg_trgm WITH SCHEMA public");
    } finally {
      await owned.end();
    }
    const settings: PublicSettings["database"] = {
      host: url.hostname,
      port: Number(url.port || 5432),
      database,
      user: decodeURIComponent(url.username),
      sslMode: "disable",
    };
    return { settings, password: decodeURIComponent(url.password), dispose };
  } catch (error) {
    try {
      await dispose();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "桌面验收数据库准备与清理均失败。");
    }
    throw error;
  }
}
