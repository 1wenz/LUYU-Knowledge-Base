import type { ZodType } from "zod";
import {
  batchImportSchema,
  collectionSaveSchema,
  documentMutationSchema,
  listDocumentsSchema,
  saveDocumentSchema,
  uuidSchema,
  type Document,
  type DocumentDraft,
  type KnowledgeService,
  type ServiceContext,
  type SaveDocument,
  type PublicError,
  type Collection,
} from "../../../../src/lib/contracts";
import { assertMutableRevision, DomainError } from "../../../../src/lib/domain/validation";
import type { SqlConnection, SqlPool } from "./ports";
import { inTransaction } from "./transactions";
import { lockGenerations } from "./index-lock";

export type StoredDocument = Omit<Document, "createdAt" | "updatedAt" | "deletedAt"> & {
  createdAt: string | Date;
  updatedAt: string | Date;
  deletedAt: string | Date | null;
};
export const documentColumns =
  'id, collection_id AS "collectionId", title, content_markdown AS "contentMarkdown", tags, favorite, revision, created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"';

function parse<T>(schema: ZodType<T>, input: unknown, field?: PublicError["field"]): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new DomainError("INVALID_INPUT", "输入格式或范围不符合要求，请检查后重试", field);
  return result.data;
}
function iso(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new DomainError("SCHEMA_MISMATCH", "数据库时间格式无效");
  return date.toISOString();
}
export function mapDocument(row: StoredDocument): Document {
  return {
    ...row,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    deletedAt: row.deletedAt === null ? null : iso(row.deletedAt),
  };
}
function checkTextStorage(draft: DocumentDraft): void {
  if ([draft.title, draft.contentMarkdown, ...draft.tags].some((text) => text.includes("\0"))) {
    throw new DomainError("INVALID_INPUT", "笔记不能包含空字节字符", "contentMarkdown");
  }
}

export function createPersistence(deps: {
  pool: SqlPool;
  now(): Date;
  createId(): string;
  onRevision(connection: SqlConnection, document: Document, context: ServiceContext): Promise<void>;
}): Pick<KnowledgeService, "documents" | "collections"> {
  const transaction = <T>(
    context: ServiceContext,
    work: (connection: SqlConnection) => Promise<T>,
    readOnly = false,
  ) =>
    inTransaction(
      deps.pool,
      context,
      async (connection) => {
        if (!readOnly) await lockGenerations(connection);
        return work(connection);
      },
      readOnly,
    );
  const lockedDocument = async (connection: SqlConnection, id: string) => {
    const result = await connection.query<StoredDocument>(
      `SELECT ${documentColumns} FROM documents WHERE id = $1 FOR UPDATE`,
      [id],
    );
    return result.rows[0] ? mapDocument(result.rows[0]) : null;
  };
  const requireCollection = async (connection: SqlConnection, id: string | null) => {
    if (id === null) return;
    const result = await connection.query<{ id: string }>(
      "SELECT id FROM collections WHERE id = $1 FOR KEY SHARE",
      [id],
    );
    if (!result.rows.length)
      throw new DomainError("INVALID_INPUT", "分类不存在，请重新选择", "collectionId");
  };
  const saveWithin = async (
    connection: SqlConnection,
    input: SaveDocument,
    context: ServiceContext,
  ): Promise<Document> => {
    checkTextStorage(input.draft);
    await requireCollection(connection, input.draft.collectionId);
    const { title, contentMarkdown, collectionId, tags } = input.draft;
    const timestamp = deps.now().toISOString();
    let result;
    if (input.existing) {
      const { id, expectedRevision } = input.existing;
      const current = await lockedDocument(connection, id);
      assertMutableRevision(current, expectedRevision, false);
      result = await connection.query<StoredDocument>(
        `UPDATE documents SET collection_id = $2, title = $3, content_markdown = $4, tags = $5, revision = revision + 1, updated_at = GREATEST($6::timestamptz, updated_at) WHERE id = $1 AND revision = $7 AND deleted_at IS NULL RETURNING ${documentColumns}`,
        [id, collectionId, title, contentMarkdown, tags, timestamp, expectedRevision],
      );
    } else {
      result = await connection.query<StoredDocument>(
        `INSERT INTO documents (id, collection_id, title, content_markdown, tags, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING ${documentColumns}`,
        [parse(uuidSchema, deps.createId()), collectionId, title, contentMarkdown, tags, timestamp],
      );
    }
    if (result.rows.length !== 1) throw new DomainError("CONFLICT", "笔记已改变，请重新加载");
    const document = mapDocument(result.rows[0]);
    await deps.onRevision(connection, document, context);
    return document;
  };

  const mutate = async (
    input: { id: string; expectedRevision: number },
    context: ServiceContext,
    kind: "favorite" | "remove" | "restore",
    favorite?: boolean,
  ): Promise<Document> => {
    const value = parse(documentMutationSchema, input);
    return transaction(context, async (connection) => {
      const current = await lockedDocument(connection, value.id);
      assertMutableRevision(current, value.expectedRevision, kind === "restore");
      const timestamp = deps.now().toISOString();
      // The assignment is selected only from this fixed internal enum.
      const assignment =
        kind === "favorite"
          ? "favorite = $4::boolean"
          : kind === "remove"
            ? "deleted_at = $3::timestamptz"
            : "deleted_at = NULL";
      const result = await connection.query<StoredDocument>(
        `UPDATE documents SET ${assignment}, revision = revision + 1, updated_at = GREATEST($3::timestamptz, updated_at) WHERE id = $1 AND revision = $2 RETURNING ${documentColumns}`,
        kind === "favorite"
          ? [value.id, value.expectedRevision, timestamp, favorite!]
          : [value.id, value.expectedRevision, timestamp],
      );
      if (!result.rows[0]) throw new DomainError("CONFLICT", "笔记已改变，请重新加载");
      const document = mapDocument(result.rows[0]);
      await deps.onRevision(connection, document, context);
      return document;
    });
  };

  return {
    collections: {
      list: (context) =>
        transaction(
          context,
          async (connection) =>
            (
              await connection.query<Collection>(
                'SELECT id, name, sort_order AS "sortOrder" FROM collections ORDER BY sort_order, id',
              )
            ).rows,
          true,
        ),
      save: async (input, context) => {
        const value = parse(collectionSaveSchema, input);
        if (value.name.includes("\0"))
          throw new DomainError("INVALID_INPUT", "分类名称不能包含空字节");
        return transaction(context, async (connection) => {
          const result = value.id
            ? await connection.query<Collection>(
                'UPDATE collections SET name = $2, sort_order = $3 WHERE id = $1 RETURNING id, name, sort_order AS "sortOrder"',
                [value.id, value.name, value.sortOrder],
              )
            : await connection.query<Collection>(
                'INSERT INTO collections (id, name, sort_order) VALUES ($1, $2, $3) RETURNING id, name, sort_order AS "sortOrder"',
                [parse(uuidSchema, deps.createId()), value.name, value.sortOrder],
              );
          if (!result.rows[0]) throw new DomainError("NOT_FOUND", "分类不存在");
          return result.rows[0];
        });
      },
      remove: async (id, context) => {
        const value = parse(uuidSchema, id, "collectionId");
        return transaction(context, async (connection) => {
          const result = await connection.query(
            "DELETE FROM collections WHERE id = $1 RETURNING id",
            [value],
          );
          if (!result.rowCount) throw new DomainError("NOT_FOUND", "分类不存在");
          return { removed: true };
        });
      },
    },
    documents: {
      get: async (id, context) => {
        const value = parse(uuidSchema, id);
        return transaction(
          context,
          async (connection) => {
            const result = await connection.query<StoredDocument>(
              `SELECT ${documentColumns} FROM documents WHERE id = $1`,
              [value],
            );
            if (!result.rows[0]) throw new DomainError("NOT_FOUND", "笔记不存在");
            return mapDocument(result.rows[0]);
          },
          true,
        );
      },
      list: async (input, context) => {
        const value = parse(listDocumentsSchema, input);
        const predicate = `($1::uuid IS NULL OR collection_id = $1) AND ($2::text IS NULL OR $2 = ANY(tags)) AND ($3::boolean = (deleted_at IS NOT NULL)) AND (NOT $4::boolean OR favorite)`;
        const filters = [
          value.collectionId ?? null,
          value.tag ?? null,
          value.view === "trash",
          value.view === "favorites",
        ];
        return transaction(
          context,
          async (connection) => {
            const total = await connection.query<{ count: string }>(
              `SELECT count(*)::text AS count FROM documents WHERE ${predicate}`,
              filters,
            );
            const result = await connection.query<StoredDocument>(
              `SELECT ${documentColumns} FROM documents WHERE ${predicate} ORDER BY updated_at DESC, id OFFSET $5 LIMIT $6`,
              [...filters, value.offset, value.limit],
            );
            return {
              total: Number(total.rows[0].count),
              items: result.rows.map((row) => {
                const document = mapDocument(row);
                const { contentMarkdown, ...summary } = document;
                return { ...summary, excerpt: Array.from(contentMarkdown).slice(0, 1600).join("") };
              }),
            };
          },
          true,
        );
      },
      save: async (input, context) => {
        const value = parse(saveDocumentSchema, input);
        return transaction(context, (connection) => saveWithin(connection, value, context));
      },
      setFavorite: async (input, context) => {
        if (typeof input.favorite !== "boolean")
          throw new DomainError("INVALID_INPUT", "收藏状态必须为布尔值");
        return mutate(
          { id: input.id, expectedRevision: input.expectedRevision },
          context,
          "favorite",
          input.favorite,
        );
      },
      remove: (input, context) => mutate(input, context, "remove"),
      restore: (input, context) => mutate(input, context, "restore"),
      import: async (input, context) => {
        const value = parse(batchImportSchema, input);
        if (new Set(value.items.map((item) => item.sourceId)).size !== value.items.length)
          throw new DomainError("INVALID_INPUT", "导入来源 id 不能重复");
        for (const item of value.items) checkTextStorage(item.draft);
        return transaction(context, async (connection) => {
          await connection.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
            `zhiyu:import:${value.sourceFingerprint}`,
          ]);
          const existing = await connection.query<{ document_count: number }>(
            "SELECT document_count FROM legacy_imports WHERE source_fingerprint = $1",
            [value.sourceFingerprint],
          );
          if (existing.rows[0]) {
            const ids = await connection.query<{ document_id: string }>(
              "SELECT document_id FROM legacy_import_items WHERE source_fingerprint = $1 ORDER BY source_id",
              [value.sourceFingerprint],
            );
            return {
              imported: 0,
              skipped: existing.rows[0].document_count,
              documentIds: ids.rows.map((row) => row.document_id),
            };
          }
          await connection.query(
            "INSERT INTO legacy_imports (source_fingerprint, document_count) VALUES ($1, $2)",
            [value.sourceFingerprint, value.items.length],
          );
          const ids: string[] = [];
          for (const item of value.items) {
            const document = await saveWithin(connection, { draft: item.draft }, context);
            await connection.query(
              "INSERT INTO legacy_import_items (source_fingerprint, source_id, document_id) VALUES ($1, $2, $3)",
              [value.sourceFingerprint, item.sourceId, document.id],
            );
            ids.push(document.id);
          }
          return { imported: ids.length, skipped: 0, documentIds: ids };
        });
      },
    },
  };
}
