\set ON_ERROR_STOP on
\encoding UTF8

-- Run against TEST_DATABASE_URL only. The random schema exists only in this transaction.
SELECT 'zhiyu_test_' || replace(gen_random_uuid()::text, '-', '') AS test_schema \gset
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
CREATE SCHEMA :"test_schema";
SET LOCAL search_path TO :"test_schema", pg_catalog, public;

DO $$
BEGIN
  IF current_setting('server_version_num')::integer < 170000 THEN
    RAISE EXCEPTION 'PostgreSQL 17 or newer is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
                  WHERE e.extname = 'vector' AND n.nspname = 'public'
                    AND (split_part(e.extversion, '.', 1)::integer > 0
                         OR split_part(e.extversion, '.', 2)::integer >= 8))
     OR NOT EXISTS (SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
                     WHERE e.extname = 'pg_trgm' AND n.nspname = 'public') THEN
    RAISE EXCEPTION 'Preinstall vector >=0.8 and pg_trgm in the test database';
  END IF;
END;
$$;

\ir ../../db/migrations/001_knowledge.sql
\ir ../../db/migrations/002_search_indexes.sql

INSERT INTO documents (id, collection_id, title, content_markdown, tags) VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '中文知识库', '# 中文知识库', ARRAY['检索']),
  ('10000000-0000-4000-8000-000000000002', NULL, '另一份知识笔记', '# 另一份知识笔记', ARRAY['离线']);

INSERT INTO index_generations (
  id, fingerprint, model, dimensions, chunk_config,
  normalizer_version, splitter_version, tokenizer_version, state
) VALUES
  ('20000000-0000-4000-8000-000000000001', repeat('1', 64), 'openai/text-embedding-3-large', 3072,
   '{"chunkTokens":800,"overlapTokens":120}', 'test', 'test', 'test', 'active'),
  ('20000000-0000-4000-8000-000000000002', repeat('2', 64), 'openai/text-embedding-3-large', 1536,
   '{"chunkTokens":800,"overlapTokens":120}', 'test', 'test', 'test', 'retired');

INSERT INTO document_chunks (
  id, generation_id, document_id, document_revision, ordinal, content,
  content_hash, token_count, start_line, end_line, search_tsv, search_text
) VALUES
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001', 1, 0, '中文知识库', repeat('1', 64), 6, 1, 1,
   to_tsvector('simple', '中文 知识库'), '中文知识库'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000002', 1, 0, '另一份知识笔记', repeat('2', 64), 8, 1, 1,
   to_tsvector('simple', '中文 知识 笔记'), '另一份知识笔记'),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002',
   '10000000-0000-4000-8000-000000000001', 1, 0, '1536维测试', repeat('3', 64), 6, 1, 1,
   to_tsvector('simple', '测试'), '1536维测试');

INSERT INTO chunk_embeddings (chunk_id, generation_id, model, dimensions, embedding, cache_key) VALUES
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
   'openai/text-embedding-3-large', 3072,
   (ARRAY[1::real] || array_fill(0::real, ARRAY[3071]))::public.vector, 'synthetic-3072-a'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001',
   'openai/text-embedding-3-large', 3072,
   (ARRAY[0::real, 1::real] || array_fill(0::real, ARRAY[3070]))::public.vector, 'synthetic-3072-b'),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002',
   'openai/text-embedding-3-large', 1536,
   (ARRAY[1::real] || array_fill(0::real, ARRAY[1535]))::public.vector, 'synthetic-1536');

DO $$
DECLARE
  affected integer;
BEGIN
  IF (SELECT count(*) FROM collections) <> 3 THEN
    RAISE EXCEPTION 'Expected exactly three initial collections';
  END IF;
  IF (SELECT count(*) FROM document_chunks WHERE search_tsv @@ plainto_tsquery('simple', '中文')) <> 2 THEN
    RAISE EXCEPTION 'Chinese FTS did not match segmented terms';
  END IF;
  IF (SELECT count(*) FROM document_chunks WHERE search_text ILIKE '%知%') <> 2 THEN
    RAISE EXCEPTION 'Single-character literal recall failed';
  END IF;

  UPDATE documents SET revision = revision + 1, title = '已经更新'
   WHERE id = '10000000-0000-4000-8000-000000000001' AND revision = 1;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'First revision update must succeed'; END IF;
  UPDATE documents SET revision = revision + 1, title = '过期写入'
   WHERE id = '10000000-0000-4000-8000-000000000001' AND revision = 1;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Stale revision must not overwrite'; END IF;

  IF (SELECT count(*) FROM document_chunks c JOIN documents d ON d.id = c.document_id
       WHERE c.generation_id = '20000000-0000-4000-8000-000000000001'
         AND c.document_revision = d.revision AND d.deleted_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'Old chunk revisions must be excluded';
  END IF;
  UPDATE documents SET deleted_at = now(), revision = revision + 1
   WHERE id = '10000000-0000-4000-8000-000000000002';
  IF EXISTS (SELECT 1 FROM document_chunks c JOIN documents d ON d.id = c.document_id
              WHERE c.generation_id = '20000000-0000-4000-8000-000000000001'
                AND c.document_revision = d.revision AND d.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Deleted documents must be excluded';
  END IF;

  BEGIN
    INSERT INTO documents (id, title, content_markdown) VALUES (gen_random_uuid(), ' ', '');
    RAISE EXCEPTION 'Blank titles must fail';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO documents (id, title, content_markdown, tags)
      VALUES (gen_random_uuid(), '重复标签', '', ARRAY['检索', '检索']);
    RAISE EXCEPTION 'Duplicate tags must fail';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO documents (id, title, content_markdown)
      VALUES (gen_random_uuid(), '正文上限', repeat('中', 700000));
    RAISE EXCEPTION 'UTF-8 body limit must fail';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

-- Small fixtures normally favor sequential scans. Force ANN to prove expression compatibility.
SET LOCAL enable_seqscan = off;
DO $$
DECLARE
  query3072 public.vector := (ARRAY[1::real] || array_fill(0::real, ARRAY[3071]))::public.vector;
  query1536 public.vector := (ARRAY[1::real] || array_fill(0::real, ARRAY[1535]))::public.vector;
  result_id uuid;
  query_plan json;
BEGIN
  SELECT chunk_id INTO result_id FROM chunk_embeddings WHERE dimensions = 3072
    ORDER BY embedding::public.halfvec(3072) <=> query3072::public.halfvec(3072) LIMIT 1;
  IF result_id IS DISTINCT FROM '30000000-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION '3072-dimensional ANN returned the wrong nearest neighbor';
  END IF;
  EXECUTE 'EXPLAIN (FORMAT JSON) SELECT chunk_id FROM chunk_embeddings WHERE dimensions=3072
    ORDER BY embedding::public.halfvec(3072) <=> $1::public.halfvec(3072) LIMIT 1'
    INTO query_plan USING query3072;
  IF position('chunk_embeddings_hnsw_3072' IN query_plan::text) = 0 THEN
    RAISE EXCEPTION '3072-dimensional HNSW index was not used';
  END IF;

  SELECT chunk_id INTO result_id FROM chunk_embeddings WHERE dimensions = 1536
    ORDER BY embedding::public.vector(1536) <=> query1536::public.vector(1536) LIMIT 1;
  IF result_id IS DISTINCT FROM '30000000-0000-4000-8000-000000000003'::uuid THEN
    RAISE EXCEPTION '1536-dimensional ANN returned the wrong nearest neighbor';
  END IF;
  EXECUTE 'EXPLAIN (FORMAT JSON) SELECT chunk_id FROM chunk_embeddings WHERE dimensions=1536
    ORDER BY embedding::public.vector(1536) <=> $1::public.vector(1536) LIMIT 1'
    INTO query_plan USING query1536;
  IF position('chunk_embeddings_hnsw_1536' IN query_plan::text) = 0 THEN
    RAISE EXCEPTION '1536-dimensional HNSW index was not used';
  END IF;
END;
$$;

ROLLBACK;
\echo 'PASS: real PostgreSQL migrations, constraints, revision, Chinese recall and 3072/1536 HNSW'
