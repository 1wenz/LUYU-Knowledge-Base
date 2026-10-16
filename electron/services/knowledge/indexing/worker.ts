import type { SafeLogger, ServiceContext, SecretKind } from "../../../../src/lib/contracts";
import { DomainError } from "../../../../src/lib/domain/validation";
import { validateEmbeddingBatch } from "../../../../src/lib/domain/vectors";
import type { SqlConnection, SqlPool } from "../database/ports";
import { checkCancelled, inTransaction } from "../database/transactions";
import { lockGenerations } from "../database/index-lock";
import { embeddingCacheKey, type Generation } from "./profile";
import { generationColumns, parseGeneration } from "./writer";

type Job = {
  id: string;
  documentId: string;
  revision: number;
  generationId: string;
  leaseToken: string;
  attempts: number;
};
type PendingChunk = {
  id: string;
  content: string;
  tokenCount: number;
  cacheKey: string;
  embedding?: number[];
};
export type EmbedBatch = (
  texts: string[],
  profile: Generation,
  key: string,
  signal: AbortSignal,
) => Promise<number[][]>;

export function createEmbeddingWorker(deps: {
  pool: SqlPool;
  createId(): string;
  readSecret(kind: SecretKind): Promise<string | null>;
  embed: EmbedBatch;
  logger: SafeLogger;
  maxBatch?: number;
  maxBatchTokens?: number;
}) {
  const maxBatch = deps.maxBatch ?? 16;
  const maxBatchTokens = deps.maxBatchTokens ?? 8192;
  if (
    !Number.isInteger(maxBatch) ||
    maxBatch < 1 ||
    maxBatch > 16 ||
    !Number.isInteger(maxBatchTokens) ||
    maxBatchTokens < 1
  )
    throw new DomainError("INVALID_INPUT", "索引批次配置无效", "indexing");
  const transaction = <T>(
    context: ServiceContext,
    work: (connection: SqlConnection) => Promise<T>,
  ) => inTransaction(deps.pool, context, work);
  const claim = (context: ServiceContext): Promise<Job | null> =>
    transaction(context, async (connection) => {
      await lockGenerations(connection);
      await connection.query(`UPDATE index_jobs j SET state = 'obsolete', lease_token = NULL, lease_expires_at = NULL, updated_at = now()
      FROM documents d, index_generations g WHERE j.document_id = d.id AND j.generation_id = g.id
      AND j.state IN ('pending', 'running', 'failed') AND (d.deleted_at IS NOT NULL OR d.revision <> j.revision OR g.state NOT IN ('active', 'building'))`);
      await connection.query(`UPDATE index_jobs SET state = 'failed', lease_token = NULL, lease_expires_at = NULL, error_code = 'TIMEOUT', updated_at = now()
      WHERE state = 'running' AND lease_expires_at < now() AND attempts >= 5`);
      const result = await connection.query<Job>(
        `WITH candidate AS (
        SELECT j.id FROM index_jobs j JOIN documents d ON d.id = j.document_id JOIN index_generations g ON g.id = j.generation_id
        WHERE ((j.state IN ('pending', 'failed') AND j.next_retry_at <= now()) OR (j.state = 'running' AND j.lease_expires_at < now()))
          AND j.attempts < 5 AND d.deleted_at IS NULL AND d.revision = j.revision AND g.state IN ('active', 'building')
        ORDER BY j.next_retry_at, j.created_at, j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1
      ) UPDATE index_jobs j SET state = 'running', attempts = attempts + 1, lease_token = $1,
        lease_expires_at = now() + interval '120 seconds', error_code = NULL, updated_at = now()
        FROM candidate WHERE j.id = candidate.id RETURNING j.id, j.document_id AS "documentId", j.revision,
          j.generation_id AS "generationId", j.lease_token AS "leaseToken", j.attempts`,
        [deps.createId()],
      );
      return result.rows[0] ?? null;
    });
  const load = (job: Job, context: ServiceContext) =>
    inTransaction(
      deps.pool,
      context,
      async (connection) => {
        const generation = (
          await connection.query<Generation>(
            `SELECT ${generationColumns} FROM index_generations WHERE id = $1 AND state IN ('active', 'building')`,
            [job.generationId],
          )
        ).rows[0];
        if (!generation) return null;
        const profile = parseGeneration(generation);
        const chunks = await connection.query<Omit<PendingChunk, "cacheKey">>(
          `SELECT c.id, c.content, c.token_count AS "tokenCount" FROM document_chunks c
      JOIN documents d ON d.id = c.document_id WHERE c.generation_id = $1 AND c.document_id = $2 AND c.document_revision = $3
      AND d.revision = $3 AND d.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM chunk_embeddings e WHERE e.chunk_id = c.id) ORDER BY c.ordinal`,
          [job.generationId, job.documentId, job.revision],
        );
        const pending: PendingChunk[] = [];
        for (const chunk of chunks.rows) {
          const cacheKey = embeddingCacheKey(profile, chunk.content);
          const cached = (
            await connection.query<{ embedding: string }>(
              "SELECT embedding::text AS embedding FROM chunk_embeddings WHERE cache_key = $1 AND dimensions = $2 AND model = $3 LIMIT 1",
              [cacheKey, profile.dimensions, profile.model],
            )
          ).rows[0];
          let embedding: number[] | undefined;
          if (cached) {
            let raw: unknown;
            try {
              raw = JSON.parse(cached.embedding);
            } catch {
              throw new DomainError("SCHEMA_MISMATCH", "向量缓存格式无效");
            }
            [embedding] = validateEmbeddingBatch(
              { data: [{ index: 0, embedding: raw }] },
              1,
              profile.dimensions,
            );
          }
          pending.push({ ...chunk, cacheKey, embedding });
        }
        return { profile, pending };
      },
      true,
    );
  const lockCurrent = async (connection: SqlConnection, job: Job): Promise<boolean> => {
    await lockGenerations(connection);
    // Same lock order as document save: catalog -> document -> job.
    const document = (
      await connection.query<{ revision: number; deleted: boolean }>(
        "SELECT revision, deleted_at IS NOT NULL AS deleted FROM documents WHERE id = $1 FOR UPDATE",
        [job.documentId],
      )
    ).rows[0];
    const lease = (
      await connection.query<{ valid: boolean }>(
        `SELECT lease_expires_at > now() AS valid FROM index_jobs
      WHERE id = $1 AND state = 'running' AND lease_token = $2 FOR UPDATE`,
        [job.id, job.leaseToken],
      )
    ).rows[0];
    if (!lease?.valid) return false;
    const generation = await connection.query(
      "SELECT id FROM index_generations WHERE id = $1 AND state IN ('active', 'building')",
      [job.generationId],
    );
    if (
      !document ||
      document.deleted ||
      document.revision !== job.revision ||
      !generation.rows.length
    ) {
      await connection.query(
        "UPDATE index_jobs SET state = 'obsolete', lease_token = NULL, lease_expires_at = NULL, updated_at = now() WHERE id = $1 AND lease_token = $2",
        [job.id, job.leaseToken],
      );
      return false;
    }
    return true;
  };
  const save = (job: Job, profile: Generation, batch: PendingChunk[], context: ServiceContext) =>
    transaction(context, async (connection) => {
      if (!(await lockCurrent(connection, job))) return false;
      for (const chunk of batch) {
        if (!chunk.embedding) throw new DomainError("SCHEMA_MISMATCH", "索引批次缺少 embedding");
        const [vector] = validateEmbeddingBatch(
          { data: [{ index: 0, embedding: chunk.embedding }] },
          1,
          profile.dimensions,
        );
        if (profile.dimensions === 3072 && vector.some((value) => Math.abs(value) > 65504))
          throw new DomainError("SCHEMA_MISMATCH", "embedding 超出 halfvec 索引可表示范围");
        const result = await connection.query(
          `INSERT INTO chunk_embeddings (chunk_id, generation_id, model, dimensions, embedding, cache_key)
        SELECT id, generation_id, $2, $3, $4::public.vector, $5 FROM document_chunks WHERE id = $1 AND generation_id = $6
        AND document_id = $7 AND document_revision = $8 ON CONFLICT (chunk_id) DO NOTHING`,
          [
            chunk.id,
            profile.model,
            profile.dimensions,
            JSON.stringify(vector),
            chunk.cacheKey,
            job.generationId,
            job.documentId,
            job.revision,
          ],
        );
        if (result.rowCount !== 1) throw new DomainError("CONFLICT", "片段已改变，请重新索引");
      }
      await connection.query(
        "UPDATE index_jobs SET lease_expires_at = now() + interval '120 seconds', updated_at = now() WHERE id = $1 AND lease_token = $2",
        [job.id, job.leaseToken],
      );
      return true;
    });
  const finish = (job: Job, context: ServiceContext) =>
    transaction(context, async (connection) => {
      if (!(await lockCurrent(connection, job))) return;
      const missing = await connection.query(
        `SELECT c.id FROM document_chunks c WHERE generation_id = $1 AND document_id = $2 AND document_revision = $3
      AND NOT EXISTS (SELECT 1 FROM chunk_embeddings e WHERE e.chunk_id = c.id) LIMIT 1`,
        [job.generationId, job.documentId, job.revision],
      );
      await connection.query(
        `UPDATE index_jobs SET state = $3, lease_token = NULL, lease_expires_at = NULL, next_retry_at = now(), error_code = NULL, updated_at = now()
      WHERE id = $1 AND lease_token = $2`,
        [job.id, job.leaseToken, missing.rows.length ? "pending" : "completed"],
      );
    });
  const fail = async (job: Job, error: DomainError) => {
    const cleanup = { ownerId: "index-worker", signal: new AbortController().signal };
    await transaction(cleanup, async (connection) => {
      const cancelled = error.code === "CANCELLED";
      const retryable = error.retryable;
      await connection.query(
        `UPDATE index_jobs SET state = $3, attempts = CASE WHEN $4 THEN greatest(0, attempts - 1) WHEN $5 THEN attempts ELSE 5 END,
        lease_token = NULL, lease_expires_at = NULL, error_code = $6, next_retry_at = now() + $7::integer * interval '1 second', updated_at = now()
        WHERE id = $1 AND state = 'running' AND lease_token = $2`,
        [
          job.id,
          job.leaseToken,
          cancelled ? "pending" : "failed",
          cancelled,
          retryable,
          cancelled ? null : error.code,
          cancelled ? 0 : Math.min(60, 2 ** job.attempts),
        ],
      );
    });
  };
  const runOnce = async (context: ServiceContext): Promise<boolean> => {
    checkCancelled(context.signal);
    const key = await deps.readSecret("openrouter-api-key");
    if (!key) return false;
    const job = await claim(context);
    if (!job) return false;
    try {
      const loaded = await load(job, context);
      if (!loaded) {
        await finish(job, context);
        return true;
      }
      const { profile, pending } = loaded;
      let next = 0;
      while (next < pending.length) {
        checkCancelled(context.signal);
        const batch: PendingChunk[] = [];
        let tokens = 0;
        while (next < pending.length && batch.length < maxBatch) {
          const chunk = pending[next];
          if (chunk.tokenCount > maxBatchTokens)
            throw new DomainError("INVALID_INPUT", "片段超过 embedding token 预算");
          if (batch.length && tokens + chunk.tokenCount > maxBatchTokens) break;
          batch.push(chunk);
          tokens += chunk.tokenCount;
          next++;
        }
        const uncached = batch.filter((chunk) => !chunk.embedding);
        if (uncached.length) {
          const raw = await deps.embed(
            uncached.map((chunk) => chunk.content),
            profile,
            key,
            context.signal,
          );
          const vectors = validateEmbeddingBatch(
            { data: raw.map((embedding, index) => ({ index, embedding })) },
            uncached.length,
            profile.dimensions,
          );
          uncached.forEach((chunk, index) => {
            chunk.embedding = vectors[index];
          });
        }
        if (!(await save(job, profile, batch, context))) return true;
      }
      await finish(job, context);
      deps.logger.info("index.job-completed", { count: pending.length });
    } catch (error) {
      const known = context.signal.aborted
        ? new DomainError("CANCELLED", "索引已取消")
        : error instanceof DomainError
          ? error
          : new DomainError("PROVIDER_UNAVAILABLE", "索引服务暂时不可用");
      try {
        await fail(job, known);
      } catch {
        deps.logger.error("index.job-release-failed", { code: "DATABASE_UNAVAILABLE" });
      }
      deps.logger.warn("index.job-failed", { code: known.code });
      if (known.code === "CANCELLED") throw known;
    }
    return true;
  };
  let inFlight = 0;
  return {
    async runOnce(context: ServiceContext): Promise<boolean> {
      checkCancelled(context.signal);
      if (inFlight >= 2) return false;
      inFlight++;
      try {
        return await runOnce(context);
      } finally {
        inFlight--;
      }
    },
  };
}
