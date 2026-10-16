// Offline probe: instantiate real dependencies without opening a socket or requesting a model.
import pg from "pg";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { getEncoding } from "js-tiktoken";
import { knowledgeMigrations } from "../../electron/platform/migration-resources";
import { migrationChecksum } from "../../electron/services/knowledge/database/migrations";

const pool = new pg.Pool({ max: 1 });
const embedding = new OpenAIEmbeddings({
  apiKey: "synthetic-offline-probe",
  model: "text-embedding-3-large",
  dimensions: 3072,
});
const chat = new ChatOpenAI({ apiKey: "synthetic-offline-probe", model: "synthetic-model" });
console.log(
  JSON.stringify({
    pool: typeof pool.connect,
    embedding: typeof embedding.embedQuery,
    chat: typeof chat.stream,
    chineseTokens: getEncoding("cl100k_base").encode("中文混合检索").length,
    nativeUnavailable: pg.native === null,
    migrations: knowledgeMigrations.map(({ version, sql }) => ({
      version,
      checksum: migrationChecksum(sql),
    })),
  }),
);
