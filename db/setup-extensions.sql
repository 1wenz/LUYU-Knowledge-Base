-- Administrator setup for the explicitly selected application/test database.
-- Does not create users, databases, passwords or application data.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
