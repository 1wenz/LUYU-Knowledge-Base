import { DEFAULT_SETTINGS } from "../../src/lib/contracts";
import { createPersistence } from "../../electron/services/knowledge/database/persistence";
import type { SqlPool } from "../../electron/services/knowledge/database/ports";
import { inTransaction } from "../../electron/services/knowledge/database/transactions";
import { createRevisionIndexer } from "../../electron/services/knowledge/indexing/writer";
import { createEmbeddingWorker } from "../../electron/services/knowledge/indexing/worker";
import { createPostgresRetrieval } from "../../electron/services/knowledge/retrieval/postgres";
import {
  large3TokenCounter,
  TOKENIZER_VERSION,
} from "../../electron/services/knowledge/providers/tokenizer";
import { corpus } from "./fixtures";
import { EvaluationFailure, type EvaluationStore, type EvaluationCandidate } from "./runner";

export function createEvaluationStore(pool: SqlPool, dimensions: 1536 | 3072): EvaluationStore {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.models.embeddingDimensions = dimensions;
  let sequence = 0;
  // Stable within the owned schema, including the RRF tie-break; never reuse a business schema.
  const createId = () => `00000000-0000-4000-8000-${(++sequence).toString(16).padStart(12, "0")}`;
  const writer = createRevisionIndexer({
    getSettings: () => settings,
    createId,
    counter: large3TokenCounter(),
    tokenizerVersion: TOKENIZER_VERSION,
  });
  const documents = createPersistence({
    pool,
    createId,
    now: () => new Date("2026-10-16T00:00:00.000Z"),
    onRevision: writer.onRevision,
  }).documents;
  const recall = createPostgresRetrieval(pool);
  const keys = new Map<string, string>();
  let chunks: Array<{ content: string }> = [];
  return {
    async prepare(context) {
      for (const source of corpus) {
        const document = await documents.save(
          {
            draft: {
              title: source.title,
              contentMarkdown: source.content,
              tags: source.tags,
              collectionId: null,
            },
          },
          context,
        );
        keys.set(document.id, source.key);
      }
      chunks = await inTransaction(
        pool,
        context,
        async (connection) =>
          (
            await connection.query<{ content: string }>(
              "SELECT c.content FROM document_chunks c JOIN index_generations g ON g.id = c.generation_id WHERE g.state = 'active' ORDER BY c.id",
            )
          ).rows,
        true,
      );
      return chunks.map((chunk) => chunk.content);
    },
    async index(vectors, context) {
      if (vectors.length !== chunks.length) throw new EvaluationFailure("STORE_FAILED");
      const byContent = new Map(chunks.map((chunk, index) => [chunk.content, vectors[index]]));
      const worker = createEmbeddingWorker({
        pool,
        createId,
        logger: { info() {}, warn() {}, error() {} },
        readSecret: async () => "precomputed-synthetic-eval",
        embed: async (texts) =>
          texts.map((text) => {
            const vector = byContent.get(text);
            if (!vector) throw new EvaluationFailure("STORE_FAILED");
            return vector;
          }),
      });
      for (let count = 0; count <= corpus.length; count++) {
        if (!(await worker.runOnce(context))) break;
      }
      const incomplete = await inTransaction(
        pool,
        context,
        async (connection) =>
          (await connection.query("SELECT id FROM index_jobs WHERE state <> 'completed' LIMIT 1"))
            .rows.length,
        true,
      );
      if (incomplete) throw new EvaluationFailure("STORE_FAILED");
    },
    async recall({ question, embedding }, context) {
      const profile = await recall.activeProfile(context);
      if (!profile?.vectorReady) throw new EvaluationFailure("STORE_FAILED");
      const input = { query: question.query, profile, limit: 40 };
      const keywordStart = performance.now();
      const keyword = await recall.keyword(input, context);
      const keywordMs = performance.now() - keywordStart;
      const vectorStart = performance.now();
      const vector = await recall.vector({ ...input, embedding, oversample: 80 }, context);
      const vectorMs = performance.now() - vectorStart;
      const map = (items: typeof keyword): EvaluationCandidate[] =>
        items.map((item) => {
          const documentKey = keys.get(item.documentId);
          if (!documentKey) throw new EvaluationFailure("STORE_FAILED");
          return {
            id: item.chunkId,
            documentKey,
            tags: item.tags,
            source: {
              chunkId: item.chunkId,
              documentId: item.documentId,
              documentRevision: item.documentRevision,
              title: item.title,
              content: item.content,
              startLine: item.startLine,
              endLine: item.endLine,
            },
          };
        });
      return {
        keyword: map(keyword),
        vector: map(vector),
        timingsMs: { keyword: keywordMs, vector: vectorMs },
      };
    },
  };
}
