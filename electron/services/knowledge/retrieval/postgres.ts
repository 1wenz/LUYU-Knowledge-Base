import { uuidSchema, type SearchFilters, type ServiceContext } from "../../../../src/lib/contracts";
import { planKeywordQuery } from "../../../../src/lib/domain/segmentation";
import { validateEmbeddingBatch } from "../../../../src/lib/domain/vectors";
import { DomainError } from "../../../../src/lib/domain/validation";
import { inTransaction } from "../database/transactions";
import type { SqlPool, SqlParameter } from "../database/ports";
import type { ActiveProfile, RetrievalCandidate, RetrievalPorts } from "./hybrid";

const sourceColumns = `c.id AS "chunkId", d.id AS "documentId", d.revision AS "documentRevision",
  d.title, d.tags, c.content, c.start_line AS "startLine", c.end_line AS "endLine", d.updated_at AS "updatedAt"`;
const current = `c.document_revision = d.revision AND d.deleted_at IS NULL
  AND ($2::uuid IS NULL OR d.collection_id = $2)
  AND d.tags @> $3::text[] AND (NOT $4::boolean OR d.favorite)`;
const filterValues = (profileId: string, filters?: SearchFilters): SqlParameter[] => [
  profileId,
  filters?.collectionId ?? null,
  filters?.tags ?? [],
  filters?.favoriteOnly ?? false,
];
type Row = Omit<RetrievalCandidate, "updatedAt"> & { updatedAt: Date | string };
const candidates = (rows: Row[]): RetrievalCandidate[] =>
  rows.map((row) => ({
    ...row,
    updatedAt: new Date(row.updatedAt).toISOString(),
  }));
function checkLimit(value: number, max: number): void {
  if (!Number.isInteger(value) || value < 1 || value > max)
    throw new DomainError("INVALID_INPUT", "召回数量超出范围", "retrieval");
}

export function createPostgresRetrieval(
  pool: SqlPool,
): Pick<RetrievalPorts, "activeProfile" | "keyword" | "vector" | "currentChunkIds"> {
  return {
    activeProfile: (context) =>
      inTransaction(
        pool,
        context,
        async (connection) => {
          const result = await connection.query<ActiveProfile>(`SELECT g.id, g.model, g.dimensions,
        EXISTS(SELECT 1 FROM chunk_embeddings e JOIN document_chunks c ON c.id = e.chunk_id
          JOIN documents d ON d.id = c.document_id WHERE e.generation_id = g.id
          AND c.document_revision = d.revision AND d.deleted_at IS NULL) AS "vectorReady"
        FROM index_generations g WHERE g.state = 'active'`);
          return result.rows[0] ?? null;
        },
        true,
      ),

    keyword: (input, context) =>
      inTransaction(
        pool,
        context,
        async (connection) => {
          checkLimit(input.limit, 100);
          const plan = planKeywordQuery(input.query);
          const values = [
            ...filterValues(input.profile.id, input.filters),
            plan.terms.join(" "),
            plan.literalPattern,
            input.limit,
          ];
          const result = await connection.query<Row>(
            `WITH q AS (
          SELECT plainto_tsquery('simple', $5::text) AS terms
        ), fts AS (
          SELECT c.id, ts_rank_cd(c.search_tsv, q.terms) AS score
          FROM document_chunks c JOIN documents d ON d.id = c.document_id CROSS JOIN q
          WHERE c.generation_id = $1 AND ${current}
            AND ${plan.shortQuery ? "false" : "c.search_tsv @@ q.terms"}
          ORDER BY score DESC, c.id LIMIT $7
        ), phrase AS (
          SELECT c.id, 1.0::real AS score FROM document_chunks c JOIN documents d ON d.id = c.document_id
          WHERE c.generation_id = $1 AND ${current} AND c.search_text ILIKE $6 ESCAPE E'\\\\'
          ORDER BY c.id LIMIT $7
        ), merged AS (
          SELECT id, max(score) AS score FROM (SELECT * FROM fts UNION ALL SELECT * FROM phrase) hits GROUP BY id
        ) SELECT ${sourceColumns} FROM merged m JOIN document_chunks c ON c.id = m.id
          JOIN documents d ON d.id = c.document_id ORDER BY m.score DESC, c.id LIMIT $7`,
            values,
          );
          return candidates(result.rows);
        },
        true,
      ),

    vector: (input, context) =>
      inTransaction(
        pool,
        context,
        async (connection) => {
          checkLimit(input.limit, 100);
          checkLimit(input.oversample, 400);
          if (input.oversample < input.limit || ![1536, 3072].includes(input.profile.dimensions))
            throw new DomainError("INVALID_INPUT", "向量召回配置无效", "retrieval");
          const [embedding] = validateEmbeddingBatch(
            { data: [{ index: 0, embedding: input.embedding }] },
            1,
            input.profile.dimensions,
          );
          // Literals are from the checked union, preserving the partial expression index predicate.
          const dimensions = input.profile.dimensions;
          const cast = dimensions === 3072 ? "public.halfvec(3072)" : "public.vector(1536)";
          await connection.query(
            "SELECT set_config('hnsw.ef_search', $1, true), set_config('hnsw.iterative_scan', 'strict_order', true), set_config('hnsw.max_scan_tuples', '20000', true)",
            [String(Math.max(80, input.oversample))],
          );
          const result = await connection.query<Row>(
            `WITH ann AS MATERIALIZED (
          SELECT c.id, e.embedding FROM chunk_embeddings e JOIN document_chunks c ON c.id = e.chunk_id
          JOIN documents d ON d.id = c.document_id
          WHERE e.generation_id = $1 AND e.dimensions = ${dimensions} AND ${current}
          ORDER BY e.embedding::${cast} <=> $5::${cast} LIMIT $6
        ) SELECT ${sourceColumns}, greatest(-1.0, least(1.0, 1 - (a.embedding <=> $5::public.vector))) AS "vectorCosine"
          FROM ann a JOIN document_chunks c ON c.id = a.id JOIN documents d ON d.id = c.document_id
          ORDER BY a.embedding <=> $5::public.vector, c.id LIMIT $7`,
            [
              ...filterValues(input.profile.id, input.filters),
              JSON.stringify(embedding),
              input.oversample,
              input.limit,
            ],
          );
          return candidates(result.rows);
        },
        true,
      ),

    currentChunkIds: (items, filters, context: ServiceContext) =>
      inTransaction(
        pool,
        context,
        async (connection) => {
          if (!items.length) return [];
          if (
            items.length > 100 ||
            items.some((item) => !uuidSchema.safeParse(item.chunkId).success)
          )
            throw new DomainError("INVALID_INPUT", "来源片段数量或 ID 无效");
          const result = await connection.query<{
            id: string;
            documentId: string;
            revision: number;
          }>(
            `SELECT c.id, d.id AS "documentId", d.revision
        FROM document_chunks c JOIN documents d ON d.id = c.document_id
        WHERE c.id = ANY($1::uuid[]) AND ${current}`,
            [
              items.map((item) => item.chunkId),
              filters?.collectionId ?? null,
              filters?.tags ?? [],
              filters?.favoriteOnly ?? false,
            ],
          );
          const source = new Map(items.map((item) => [item.chunkId, item]));
          return result.rows
            .filter((row) => {
              const item = source.get(row.id);
              return item?.documentId === row.documentId && item.documentRevision === row.revision;
            })
            .map((row) => row.id);
        },
        true,
      ),
  };
}
