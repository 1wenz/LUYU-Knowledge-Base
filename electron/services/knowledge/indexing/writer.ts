import {
  indexingSettingsSchema,
  uuidSchema,
  type Document,
  type PublicSettings,
  type ServiceContext,
} from "../../../../src/lib/contracts";
import { chunkMarkdown, type TokenCounter } from "../../../../src/lib/domain/chunking";
import { prepareKeywordFields } from "../../../../src/lib/domain/segmentation";
import { DomainError } from "../../../../src/lib/domain/validation";
import type { SqlConnection } from "../database/ports";
import { checkCancelled } from "../database/transactions";
import { hashText, indexProfile, type Generation, type IndexProfile } from "./profile";

export const generationColumns = `id, fingerprint, model, dimensions, chunk_config AS "chunkConfig",
  normalizer_version AS "normalizerVersion", splitter_version AS "splitterVersion", tokenizer_version AS "tokenizerVersion", state`;

export function parseGeneration(row: Generation): Generation {
  if (
    !uuidSchema.safeParse(row.id).success ||
    !/^[a-f0-9]{64}$/.test(row.fingerprint) ||
    row.model !== "openai/text-embedding-3-large" ||
    ![1536, 3072].includes(row.dimensions) ||
    !indexingSettingsSchema.safeParse(row.chunkConfig).success ||
    !["active", "building"].includes(row.state)
  )
    throw new DomainError("SCHEMA_MISMATCH", "数据库索引配置无效");
  return row;
}

export async function insertGeneration(
  connection: SqlConnection,
  id: string,
  profile: IndexProfile,
  state: Generation["state"],
): Promise<void> {
  if (!uuidSchema.safeParse(id).success) throw new DomainError("INTERNAL", "生成的索引 ID 无效");
  await connection.query(
    `INSERT INTO index_generations
    (id, fingerprint, model, dimensions, chunk_config, normalizer_version, splitter_version, tokenizer_version, state, activated_at)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, CASE WHEN $9 = 'active' THEN now() ELSE NULL END)
    ON CONFLICT DO NOTHING`,
    [
      id,
      profile.fingerprint,
      profile.model,
      profile.dimensions,
      JSON.stringify(profile.chunkConfig),
      profile.normalizerVersion,
      profile.splitterVersion,
      profile.tokenizerVersion,
      state,
    ],
  );
}

export function createRevisionIndexer(deps: {
  getSettings(): PublicSettings;
  createId(): string;
  counter: TokenCounter;
  tokenizerVersion: string;
}) {
  const forGeneration = async (
    connection: SqlConnection,
    document: Document,
    generation: Generation,
    context: ServiceContext,
  ): Promise<void> => {
    checkCancelled(context.signal);
    const supported = indexProfile(deps.getSettings(), deps.tokenizerVersion);
    if (
      generation.tokenizerVersion !== supported.tokenizerVersion ||
      generation.normalizerVersion !== supported.normalizerVersion ||
      generation.splitterVersion !== supported.splitterVersion
    )
      throw new DomainError("INDEX_NOT_READY", "索引实现版本已改变，请先完成重建");
    // Idempotent reconstruction of this revision, including retries after a process restart.
    await connection.query(
      "DELETE FROM document_chunks WHERE generation_id = $1 AND document_id = $2 AND document_revision = $3",
      [generation.id, document.id, document.revision],
    );
    await connection.query(
      `UPDATE index_jobs SET state = 'obsolete', lease_token = NULL, lease_expires_at = NULL, updated_at = now()
      WHERE generation_id = $1 AND document_id = $2 AND revision <> $3 AND state IN ('pending', 'running', 'failed')`,
      [generation.id, document.id, document.revision],
    );
    if (document.deletedAt !== null) return;
    const chunks = chunkMarkdown(
      document.contentMarkdown,
      {
        maxTokens: generation.chunkConfig.chunkTokens,
        overlapTokens: generation.chunkConfig.overlapTokens,
      },
      deps.counter,
    );
    // Empty notes still expose searchable title/tags, with their source anchored at line 1.
    if (!chunks.length) {
      chunks.push(
        ...chunkMarkdown(
          document.title,
          {
            maxTokens: generation.chunkConfig.chunkTokens,
            overlapTokens: generation.chunkConfig.overlapTokens,
          },
          deps.counter,
        ).map((chunk) => ({ ...chunk, startLine: 1, endLine: 1 })),
      );
    }
    for (const chunk of chunks) {
      checkCancelled(context.signal);
      const fields = prepareKeywordFields({
        title: document.title,
        tags: document.tags,
        content: chunk.content,
      });
      const id = deps.createId();
      if (!uuidSchema.safeParse(id).success)
        throw new DomainError("INTERNAL", "生成的片段 ID 无效");
      await connection.query(
        `INSERT INTO document_chunks
        (id, generation_id, document_id, document_revision, ordinal, content, content_hash, token_count, start_line, end_line, search_tsv, search_text)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          setweight(to_tsvector('simple', $11), 'A') || setweight(to_tsvector('simple', $12), 'A') || setweight(to_tsvector('simple', $13), 'B'), $14)`,
        [
          id,
          generation.id,
          document.id,
          document.revision,
          chunk.ordinal,
          chunk.content,
          hashText(chunk.content),
          chunk.tokenCount,
          chunk.startLine,
          chunk.endLine,
          fields.titleTerms,
          fields.tagTerms,
          fields.bodyTerms,
          fields.phrase,
        ],
      );
    }
    await connection.query(
      `INSERT INTO index_jobs (id, document_id, revision, generation_id, state)
      VALUES ($1, $2, $3, $4, 'pending') ON CONFLICT (document_id, revision, generation_id) DO UPDATE
      SET state = 'pending', attempts = 0, next_retry_at = now(), lease_token = NULL, lease_expires_at = NULL, error_code = NULL, updated_at = now()`,
      [deps.createId(), document.id, document.revision, generation.id],
    );
  };
  return {
    forGeneration,
    async onRevision(
      connection: SqlConnection,
      document: Document,
      context: ServiceContext,
    ): Promise<void> {
      let result = await connection.query<Generation>(
        `SELECT ${generationColumns} FROM index_generations WHERE state IN ('active', 'building') ORDER BY state`,
      );
      if (!result.rows.some((row) => row.state === "active")) {
        await insertGeneration(
          connection,
          deps.createId(),
          indexProfile(deps.getSettings(), deps.tokenizerVersion),
          "active",
        );
        result = await connection.query<Generation>(
          `SELECT ${generationColumns} FROM index_generations WHERE state IN ('active', 'building') ORDER BY state`,
        );
      }
      for (const row of result.rows)
        await forGeneration(connection, document, parseGeneration(row), context);
    },
  };
}
