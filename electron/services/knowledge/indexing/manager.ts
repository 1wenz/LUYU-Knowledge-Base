import {
  apiErrorCodeSchema,
  indexStatusSchema,
  type IndexStatus,
  type OperationContext,
  type PublicSettings,
  type ServiceContext,
} from "../../../../src/lib/contracts";
import { DomainError } from "../../../../src/lib/domain/validation";
import type { SqlPool } from "../database/ports";
import { documentColumns, mapDocument, type StoredDocument } from "../database/persistence";
import { inTransaction, checkCancelled } from "../database/transactions";
import { lockGenerations } from "../database/index-lock";
import { indexProfile, type Generation } from "./profile";
import {
  createRevisionIndexer,
  generationColumns,
  insertGeneration,
  parseGeneration,
} from "./writer";
import { abortableDelay } from "../async";

export function createIndexManager(deps: {
  pool: SqlPool;
  getSettings(): PublicSettings;
  createId(): string;
  tokenizerVersion: string;
  writer: ReturnType<typeof createRevisionIndexer>;
  runOnce(context: ServiceContext): Promise<boolean>;
  readEmbeddingKey(): Promise<string | null>;
}) {
  const target = () => indexProfile(deps.getSettings(), deps.tokenizerVersion);
  const ensureActive = (context: ServiceContext) =>
    inTransaction(deps.pool, context, async (connection) => {
      await lockGenerations(connection, true);
      const active = await connection.query<Generation>(
        `SELECT ${generationColumns} FROM index_generations WHERE state = 'active'`,
      );
      if (!active.rows.length)
        await insertGeneration(connection, deps.createId(), target(), "active");
    });
  const seedMissing = async (id: string, context: ServiceContext): Promise<boolean> => {
    const ids = await inTransaction(
      deps.pool,
      context,
      async (connection) =>
        (
          await connection.query<{ id: string }>(
            `SELECT d.id FROM documents d
      WHERE d.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM index_jobs j WHERE j.document_id = d.id AND j.revision = d.revision AND j.generation_id = $1)
      ORDER BY d.id LIMIT 20`,
            [id],
          )
        ).rows.map((row) => row.id),
      true,
    );
    for (const documentId of ids) {
      await inTransaction(deps.pool, context, async (connection) => {
        await lockGenerations(connection);
        const document = (
          await connection.query<StoredDocument>(
            `SELECT ${documentColumns} FROM documents WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
            [documentId],
          )
        ).rows[0];
        if (!document) return;
        const generation = (
          await connection.query<Generation>(
            `SELECT ${generationColumns} FROM index_generations WHERE id = $1 AND state IN ('active', 'building')`,
            [id],
          )
        ).rows[0];
        if (!generation) return;
        const existing = await connection.query(
          "SELECT id FROM index_jobs WHERE document_id = $1 AND revision = $2 AND generation_id = $3",
          [document.id, document.revision, id],
        );
        if (!existing.rows.length)
          await deps.writer.forGeneration(
            connection,
            mapDocument(document),
            parseGeneration(generation),
            context,
          );
      });
    }
    return ids.length > 0;
  };
  const trySwitch = (id: string, context: ServiceContext) =>
    inTransaction(deps.pool, context, async (connection) => {
      await lockGenerations(connection, true);
      const generation = (
        await connection.query<{ state: string; error_code: string | null }>(
          "SELECT state, error_code FROM index_generations WHERE id = $1",
          [id],
        )
      ).rows[0];
      if (generation?.state === "active") return true;
      if (generation?.state !== "building") {
        const code = apiErrorCodeSchema.safeParse(generation?.error_code);
        throw new DomainError(code.success ? code.data : "CONFLICT", "重建索引状态已改变");
      }
      const permanent = (
        await connection.query<{ error_code: string | null }>(
          `SELECT j.error_code FROM index_jobs j JOIN documents d ON d.id = j.document_id
      WHERE j.generation_id = $1 AND j.revision = d.revision AND d.deleted_at IS NULL AND j.state = 'failed' AND j.attempts >= 5 LIMIT 1`,
          [id],
        )
      ).rows[0];
      if (permanent) {
        const code = apiErrorCodeSchema.safeParse(permanent.error_code);
        throw new DomainError(
          code.success ? code.data : "PROVIDER_UNAVAILABLE",
          "索引重建未完成，请检查模型服务后重试",
        );
      }
      const incomplete = await connection.query(
        `SELECT d.id FROM documents d WHERE d.deleted_at IS NULL AND (
      NOT EXISTS (SELECT 1 FROM index_jobs j WHERE j.document_id = d.id AND j.revision = d.revision AND j.generation_id = $1 AND j.state = 'completed')
      OR NOT EXISTS (SELECT 1 FROM document_chunks c WHERE c.document_id = d.id AND c.document_revision = d.revision AND c.generation_id = $1)
      OR EXISTS (SELECT 1 FROM document_chunks c WHERE c.document_id = d.id AND c.document_revision = d.revision AND c.generation_id = $1
        AND NOT EXISTS (SELECT 1 FROM chunk_embeddings e WHERE e.chunk_id = c.id))) LIMIT 1`,
        [id],
      );
      if (incomplete.rows.length) return false;
      await connection.query(
        "UPDATE index_generations SET state = 'retired' WHERE state = 'active'",
      );
      await connection.query(
        "UPDATE index_generations SET state = 'active', activated_at = now(), error_code = NULL WHERE id = $1 AND state = 'building'",
        [id],
      );
      return true;
    });
  const failBuilding = (id: string, code: string) =>
    inTransaction(
      deps.pool,
      { ownerId: "index-cleanup", signal: new AbortController().signal },
      async (connection) => {
        await lockGenerations(connection, true);
        const changed = await connection.query(
          "UPDATE index_generations SET state = 'failed', error_code = $2 WHERE id = $1 AND state = 'building'",
          [id, code],
        );
        if (changed.rowCount)
          await connection.query(
            "UPDATE index_jobs SET state = 'obsolete', lease_token = NULL, lease_expires_at = NULL, updated_at = now() WHERE generation_id = $1 AND state IN ('pending', 'running', 'failed')",
            [id],
          );
      },
    );
  const progress = (id: string, context: ServiceContext) =>
    inTransaction(
      deps.pool,
      context,
      async (connection) =>
        (
          await connection.query<{ total: number; completed: number; failed: number }>(
            `SELECT count(*)::integer AS total,
    count(*) FILTER (WHERE j.state = 'completed')::integer AS completed, count(*) FILTER (WHERE j.state = 'failed')::integer AS failed
    FROM documents d LEFT JOIN index_jobs j ON j.document_id = d.id AND j.revision = d.revision AND j.generation_id = $1 WHERE d.deleted_at IS NULL`,
            [id],
          )
        ).rows[0],
      true,
    );
  return {
    ensureActive,
    async recover(context: ServiceContext): Promise<void> {
      await ensureActive(context);
      const generations = await inTransaction(
        deps.pool,
        context,
        async (connection) =>
          (
            await connection.query<{ id: string; state: string }>(
              "SELECT id, state FROM index_generations WHERE state IN ('active', 'building') ORDER BY state",
            )
          ).rows,
        true,
      );
      for (const generation of generations) {
        while (await seedMissing(generation.id, context)) {
          checkCancelled(context.signal);
        }
        if (generation.state === "building") {
          try {
            await trySwitch(generation.id, context);
          } catch (error) {
            if (error instanceof DomainError && error.code !== "CANCELLED")
              await failBuilding(generation.id, error.code);
            else throw error;
          }
        }
      }
    },
    status: (context: ServiceContext): Promise<IndexStatus> =>
      inTransaction(
        deps.pool,
        context,
        async (connection) => {
          const generations = (
            await connection.query<{ id: string; state: string; fingerprint: string }>(
              "SELECT id, state, fingerprint FROM index_generations WHERE state IN ('active', 'building')",
            )
          ).rows;
          const active = generations.find((row) => row.state === "active");
          const building = generations.find((row) => row.state === "building");
          const count = (
            await connection.query<{
              documents: number;
              chunks: number;
              pending: number;
              failed: number;
            }>(
              `SELECT
        (SELECT count(*)::integer FROM documents WHERE deleted_at IS NULL) AS documents,
        (SELECT count(*)::integer FROM document_chunks c JOIN documents d ON d.id = c.document_id WHERE c.generation_id = $1 AND c.document_revision = d.revision AND d.deleted_at IS NULL) AS chunks,
        (SELECT count(*)::integer FROM index_jobs j JOIN documents d ON d.id = j.document_id JOIN index_generations g ON g.id = j.generation_id WHERE g.state IN ('active', 'building') AND j.revision = d.revision AND d.deleted_at IS NULL AND j.state IN ('pending', 'running')) AS pending,
        (SELECT count(*)::integer FROM index_jobs j JOIN documents d ON d.id = j.document_id JOIN index_generations g ON g.id = j.generation_id WHERE g.state IN ('active', 'building') AND j.revision = d.revision AND d.deleted_at IS NULL AND j.state = 'failed') AS failed`,
              [active?.id ?? null],
            )
          ).rows[0];
          const last = (
            await connection.query<{ error_code: string }>(
              `SELECT error_code FROM (
                SELECT j.error_code, j.updated_at AS occurred_at FROM index_jobs j
                JOIN documents d ON d.id = j.document_id JOIN index_generations g ON g.id = j.generation_id
                WHERE j.state = 'failed' AND j.error_code IS NOT NULL AND j.revision = d.revision
                  AND d.deleted_at IS NULL AND g.state IN ('active', 'building')
                UNION ALL SELECT error_code, created_at FROM index_generations WHERE state = 'failed' AND error_code IS NOT NULL
                  AND created_at > COALESCE((SELECT activated_at FROM index_generations WHERE state = 'active'), '-infinity')
              ) errors ORDER BY occurred_at DESC LIMIT 1`,
            )
          ).rows[0];
          const code = apiErrorCodeSchema.safeParse(last?.error_code);
          return indexStatusSchema.parse({
            activeGenerationId: active?.id ?? null,
            buildingGenerationId: building?.id ?? null,
            documentCount: count.documents,
            chunkCount: count.chunks,
            pendingCount: count.pending,
            failedCount: count.failed,
            requiresReindex: !active || active.fingerprint !== target().fingerprint,
            lastErrorCode: code.success ? code.data : null,
          });
        },
        true,
      ),
    async rebuild(context: OperationContext): Promise<void> {
      checkCancelled(context.signal);
      if (!(await deps.readEmbeddingKey()))
        throw new DomainError("CONFIG_REQUIRED", "请先配置 OpenRouter API key");
      const profile = target();
      const generation = await inTransaction(deps.pool, context, async (connection) => {
        await lockGenerations(connection, true);
        const existing = (
          await connection.query<Generation>(
            `SELECT ${generationColumns} FROM index_generations WHERE state = 'building'`,
          )
        ).rows[0];
        if (existing) {
          if (existing.fingerprint !== profile.fingerprint)
            throw new DomainError("CONFLICT", "已有其他配置的索引正在重建");
          return parseGeneration(existing);
        }
        const id = deps.createId();
        await insertGeneration(connection, id, profile, "building");
        return { ...profile, id, state: "building" as const };
      });
      try {
        while (true) {
          checkCancelled(context.signal);
          while (await seedMissing(generation.id, context)) {
            checkCancelled(context.signal);
          }
          await Promise.all([deps.runOnce(context), deps.runOnce(context)]);
          context.emit({ type: "progress", ...(await progress(generation.id, context)) });
          if (await trySwitch(generation.id, context)) return;
          await abortableDelay(250, context.signal);
        }
      } catch (error) {
        const known =
          error instanceof DomainError ? error : new DomainError("INTERNAL", "索引重建失败");
        try {
          await failBuilding(generation.id, known.code);
        } catch {
          /* Recovery will validate the persisted generation before activation. */
        }
        throw known;
      }
    },
  };
}
