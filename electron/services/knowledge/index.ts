import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  connectionTargetSchema,
  publicSettingsSchema,
  type KnowledgeService,
  type KnowledgeServiceDependencies,
  type PublicSettings,
  type ServiceContext,
  type ConnectionReport,
} from "../../../src/lib/contracts";
import { DomainError } from "../../../src/lib/domain/validation";
import { applyMigrations, type Migration } from "./database/migrations";
import { createPostgresPool, type ManagedSqlPool } from "./database/postgres";
import { createPersistence } from "./database/persistence";
import { checkCancelled, inTransaction } from "./database/transactions";
import { createRevisionIndexer } from "./indexing/writer";
import { createEmbeddingWorker } from "./indexing/worker";
import { createIndexManager } from "./indexing/manager";
import { createPostgresRetrieval, loadPostgresSources } from "./retrieval/postgres";
import { createHybridSearch } from "./retrieval/hybrid";
import { large3TokenCounter, TOKENIZER_VERSION } from "./providers/tokenizer";
import { OpenRouterEmbeddings } from "./providers/openrouter";
import { createCohereReranker } from "./providers/cohere";
import { createProviderCatalog } from "./providers/catalog";
import { createChatStream } from "./providers/chat";
import { createAssistant } from "./assistant";
import { abortableDelay, withAbort } from "./async";

// Trusted composition/test options only; these never cross preload or IPC.
export type KnowledgeServiceOptions = {
  migrations?: readonly Migration[];
  migrationDirectory?: string;
  schema?: string;
  background?: boolean;
  fetch?: typeof fetch;
  createPool?: typeof createPostgresPool;
};
const migrationFiles = [
  "001_knowledge.sql",
  "002_search_indexes.sql",
  "003_embedding_cache.sql",
] as const;
async function loadMigrations(directory: string): Promise<Migration[]> {
  try {
    return await Promise.all(
      migrationFiles.map(async (file, index) => ({
        version: index + 1,
        sql: await readFile(join(directory, file), "utf8"),
      })),
    );
  } catch {
    throw new DomainError("SCHEMA_MISMATCH", "缺少数据库迁移资源，请检查应用安装文件");
  }
}
type Runtime = ReturnType<typeof composeRuntime>;
type Slot = {
  controller: AbortController;
  ready: Promise<Runtime>;
  pool?: ManagedSqlPool;
  password?: string | null;
  embeddingKey?: string | null;
  closed: boolean;
  requests: Set<Promise<unknown>>;
  loops: Promise<void>[];
};

function composeRuntime(
  deps: KnowledgeServiceDependencies,
  options: KnowledgeServiceOptions,
  pool: ManagedSqlPool,
  catalog: ReturnType<typeof createProviderCatalog>,
) {
  const counter = large3TokenCounter();
  const writer = createRevisionIndexer({
    getSettings: deps.getSettings,
    createId: deps.createId,
    counter,
    tokenizerVersion: TOKENIZER_VERSION,
  });
  const embedding = (key: string, dimensions: 1536 | 3072) =>
    new OpenRouterEmbeddings({ apiKey: key, dimensions, counter, fetch: options.fetch });
  const worker = createEmbeddingWorker({
    pool,
    createId: deps.createId,
    readSecret: deps.readSecret,
    logger: deps.logger,
    embed: (texts, profile, key, signal) =>
      embedding(key, profile.dimensions).embedDocuments(texts, signal),
  });
  const manager = createIndexManager({
    pool,
    getSettings: deps.getSettings,
    createId: deps.createId,
    tokenizerVersion: TOKENIZER_VERSION,
    writer,
    runOnce: worker.runOnce,
    readEmbeddingKey: () => deps.readSecret("openrouter-api-key"),
  });
  const persistence = createPersistence({
    pool,
    now: deps.now,
    createId: deps.createId,
    onRevision: writer.onRevision,
  });
  const recall = createPostgresRetrieval(pool);
  const reranker = createCohereReranker({ fetch: options.fetch });
  const search = createHybridSearch({
    ...recall,
    getSettings: deps.getSettings,
    readSecret: deps.readSecret,
    logger: deps.logger,
    embedQuery: (query, profile, key, context) =>
      embedding(key, profile.dimensions).embedQuery(query, context.signal),
    rerank: (input, context) => reranker.rerank({ ...input, signal: context.signal }),
  });
  const assistant = createAssistant({
    getSettings: deps.getSettings,
    readKey: () => deps.readSecret("openrouter-api-key"),
    model: catalog.model,
    search: search.query,
    sources: (hits, filters, context) => loadPostgresSources(pool, hits, filters, context),
    current: recall.currentChunkIds,
    stream: createChatStream({ fetch: options.fetch }),
    counter,
  });
  return { ...persistence, search, assistant, manager, worker };
}

export function createKnowledgeService(
  deps: KnowledgeServiceDependencies,
  options: KnowledgeServiceOptions = {},
): KnowledgeService {
  const lifetime = new AbortController();
  const requests = new Set<Promise<unknown>>();
  const catalog = createProviderCatalog({ readSecret: deps.readSecret, fetch: options.fetch });
  const makePool = options.createPool ?? createPostgresPool;
  let slot: Slot | undefined;
  let disposing: Promise<void> | undefined;
  const track = <T>(promise: Promise<T>, current?: Slot): Promise<T> => {
    requests.add(promise);
    current?.requests.add(promise);
    const remove = () => {
      requests.delete(promise);
      current?.requests.delete(promise);
    };
    void promise.then(remove, remove);
    return promise;
  };
  const closePool = async (current: Slot) => {
    if (current.pool && !current.closed) {
      current.closed = true;
      await current.pool.close();
    }
  };
  const background = (
    current: Slot,
    action: (context: ServiceContext) => Promise<unknown>,
    interval: number,
  ) => {
    const context = { ownerId: "knowledge-background", signal: current.controller.signal };
    const loop = (async () => {
      while (!context.signal.aborted) {
        try {
          await action(context);
        } catch (error) {
          if (context.signal.aborted) break;
          deps.logger.warn("knowledge.background-failed", {
            code: error instanceof DomainError ? error.code : "INTERNAL",
          });
        }
        try {
          await abortableDelay(interval, context.signal);
        } catch {
          break;
        }
      }
    })();
    current.loops.push(loop);
  };
  const acquire = (): Slot => {
    checkCancelled(lifetime.signal);
    if (slot) return slot;
    let resolveReady!: (runtime: Runtime) => void;
    let rejectReady!: (error: unknown) => void;
    const ready = new Promise<Runtime>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const current: Slot = {
      controller: new AbortController(),
      ready,
      closed: false,
      requests: new Set(),
      loops: [],
    };
    slot = current;
    void (async () => {
      try {
        const settings = publicSettingsSchema.parse(structuredClone(deps.getSettings()));
        current.password = await deps.readSecret("database-password");
        current.embeddingKey = await deps.readSecret("openrouter-api-key");
        checkCancelled(current.controller.signal);
        current.pool = makePool(settings.database, current.password, deps.logger, options.schema);
        const migrations =
          options.migrations ??
          (await loadMigrations(options.migrationDirectory ?? join(__dirname, "db", "migrations")));
        await applyMigrations(current.pool, migrations, {
          schema: options.schema,
          signal: current.controller.signal,
        });
        const runtime = composeRuntime(deps, options, current.pool, catalog);
        await runtime.manager.ensureActive({
          ownerId: "knowledge-initialize",
          signal: current.controller.signal,
        });
        if (options.background !== false) {
          background(current, runtime.manager.recover, 5_000);
          background(current, runtime.worker.runOnce, 250);
          background(current, runtime.worker.runOnce, 250);
        }
        return runtime;
      } catch (error) {
        await closePool(current);
        if (slot === current) slot = undefined;
        if (error instanceof DomainError) throw error;
        throw new DomainError("DATABASE_UNAVAILABLE", "知识库初始化失败，请检查数据库配置");
      }
    })().then(resolveReady, rejectReady);
    void current.ready.catch(() => undefined);
    return current;
  };
  const local = <T, C extends ServiceContext>(
    context: C,
    action: (context: C) => Promise<T>,
  ): Promise<T> => {
    const signal = AbortSignal.any([context.signal, lifetime.signal]);
    return withAbort(signal, () => track(action({ ...context, signal })));
  };
  const database = <T, C extends ServiceContext>(
    context: C,
    action: (runtime: Runtime, context: C) => Promise<T>,
  ): Promise<T> => {
    try {
      checkCancelled(context.signal);
      const current = acquire();
      const signal = AbortSignal.any([context.signal, lifetime.signal, current.controller.signal]);
      return withAbort(signal, () =>
        track(
          (async () => {
            const runtime = await withAbort(signal, () => current.ready);
            checkCancelled(signal);
            return action(runtime, { ...context, signal });
          })(),
          current,
        ),
      );
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const stop = async (current: Slot) => {
    current.controller.abort();
    await current.ready.catch(() => undefined);
    await Promise.allSettled([...current.requests, ...current.loops]);
    await closePool(current);
  };
  const databaseProbe = async (context: ServiceContext): Promise<ConnectionReport> => {
    const start = performance.now();
    const settings = deps.getSettings();
    const password = await deps.readSecret("database-password");
    checkCancelled(context.signal);
    const pool = makePool(settings.database, password, deps.logger, options.schema);
    try {
      const versions = await inTransaction(
        pool,
        context,
        async (connection) => {
          const server = (
            await connection.query<{ version: string; number: number }>(
              "SELECT current_setting('server_version') AS version, current_setting('server_version_num')::integer AS number",
            )
          ).rows[0];
          const extensions = (
            await connection.query<{ name: string; version: string; schema: string }>(
              "SELECT e.extname AS name, e.extversion AS version, n.nspname AS schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname IN ('vector', 'pg_trgm')",
            )
          ).rows;
          const vector = extensions.find(
            (item) => item.name === "vector" && item.schema === "public",
          );
          const match = vector?.version.match(/^(\d+)\.(\d+)(?:\.\d+)?$/);
          if (
            !server ||
            server.number < 170000 ||
            !match ||
            (Number(match[1]) === 0 && Number(match[2]) < 8) ||
            !extensions.some((item) => item.name === "pg_trgm" && item.schema === "public")
          )
            throw new DomainError(
              "SCHEMA_MISMATCH",
              "需要 PostgreSQL >=17、public pgvector >=0.8 和 pg_trgm",
            );
          return { postgresql: server.version, pgvector: vector!.version };
        },
        true,
      );
      return {
        target: "database",
        ok: true,
        latencyMs: performance.now() - start,
        message: "数据库连接与扩展检查通过",
        versions,
      };
    } finally {
      await pool.close();
    }
  };
  return {
    collections: {
      list: (context) => database(context, (runtime, ctx) => runtime.collections.list(ctx)),
      save: (input, context) =>
        database(context, (runtime, ctx) => runtime.collections.save(input, ctx)),
      remove: (id, context) =>
        database(context, (runtime, ctx) => runtime.collections.remove(id, ctx)),
    },
    documents: {
      list: (input, context) =>
        database(context, (runtime, ctx) => runtime.documents.list(input, ctx)),
      get: (id, context) => database(context, (runtime, ctx) => runtime.documents.get(id, ctx)),
      save: (input, context) =>
        database(context, (runtime, ctx) => runtime.documents.save(input, ctx)),
      setFavorite: (input, context) =>
        database(context, (runtime, ctx) => runtime.documents.setFavorite(input, ctx)),
      remove: (input, context) =>
        database(context, (runtime, ctx) => runtime.documents.remove(input, ctx)),
      restore: (input, context) =>
        database(context, (runtime, ctx) => runtime.documents.restore(input, ctx)),
      import: (input, context) =>
        database(context, (runtime, ctx) => runtime.documents.import(input, ctx)),
    },
    search: {
      query: (input, context) =>
        database(context, (runtime, ctx) => runtime.search.query(input, ctx)),
    },
    assistant: {
      start: (input, context) =>
        database(context, (runtime, ctx) => runtime.assistant.start(input, ctx)),
    },
    index: {
      status: (context) => database(context, (runtime, ctx) => runtime.manager.status(ctx)),
      rebuild: (context) => database(context, (runtime, ctx) => runtime.manager.rebuild(ctx)),
    },
    models: { list: (context) => local(context, catalog.list) },
    connections: {
      test: (target, context) =>
        local(context, (ctx) => {
          const parsed = connectionTargetSchema.safeParse(target);
          if (!parsed.success) throw new DomainError("INVALID_INPUT", "连接目标无效");
          return parsed.data === "database" ? databaseProbe(ctx) : catalog.test(parsed.data, ctx);
        }),
    },
    async applySettings(previous: PublicSettings, next: PublicSettings) {
      checkCancelled(lifetime.signal);
      publicSettingsSchema.parse(next);
      catalog.clear();
      const current = slot;
      if (!current) return;
      const password = await deps.readSecret("database-password");
      if (
        JSON.stringify(previous.database) !== JSON.stringify(next.database) ||
        password !== current.password
      ) {
        if (slot === current) slot = undefined;
        await stop(current);
        return;
      }
      const key = await deps.readSecret("openrouter-api-key");
      if (key !== current.embeddingKey) {
        // Also cancel background work, which is outside the platform's operation registry.
        if (slot === current) slot = undefined;
        await stop(current);
        if (!key) return;
        try {
          const fresh = acquire();
          await fresh.ready;
          await inTransaction(
            fresh.pool!,
            { ownerId: "knowledge-settings", signal: fresh.controller.signal },
            async (connection) => {
              await connection.query(`UPDATE index_jobs j SET state = 'pending', attempts = 0, error_code = NULL, next_retry_at = now(), updated_at = now()
            FROM documents d, index_generations g WHERE j.document_id = d.id AND j.generation_id = g.id
            AND j.state = 'failed' AND d.revision = j.revision AND d.deleted_at IS NULL AND g.state IN ('active', 'building')`);
            },
          );
        } catch (error) {
          // A stored credential remains valid configuration while the database is offline.
          deps.logger.warn("knowledge.credentials-resume-failed", {
            code: error instanceof DomainError ? error.code : "INTERNAL",
          });
        }
      }
    },
    dispose() {
      if (!disposing)
        disposing = (async () => {
          lifetime.abort();
          const current = slot;
          slot = undefined;
          if (current) await stop(current);
          await Promise.allSettled([...requests]);
          catalog.clear();
        })();
      return disposing;
    },
  };
}
