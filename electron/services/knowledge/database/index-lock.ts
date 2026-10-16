import type { SqlConnection } from "./ports";

/** Acquire before document row locks; generation switches take the exclusive form. */
export async function lockGenerations(connection: SqlConnection, exclusive = false): Promise<void> {
  await connection.query(
    exclusive
      ? "SELECT pg_advisory_xact_lock(hashtextextended('zhiyu:index-generations', 0))"
      : "SELECT pg_advisory_xact_lock_shared(hashtextextended('zhiyu:index-generations', 0))",
  );
}
