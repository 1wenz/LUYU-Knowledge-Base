import initial from "../../db/migrations/001_knowledge.sql";
import vectorIndexes from "../../db/migrations/002_search_indexes.sql";
import embeddingCache from "../../db/migrations/003_embedding_cache.sql";
import type { Migration } from "../services/knowledge/database/migrations";

// Trusted, versioned SQL is bundled into the main process, including inside app.asar.
export const knowledgeMigrations: readonly Migration[] = [
  { version: 1, sql: initial },
  { version: 2, sql: vectorIndexes },
  { version: 3, sql: embeddingCache },
];
