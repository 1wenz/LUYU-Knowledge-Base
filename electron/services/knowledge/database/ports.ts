/** Minimal main-process SQL port. The pg adapter is supplied after M0. */
export type SqlParameter = string | number | boolean | null | readonly string[];
export interface SqlConnection {
  query<Row extends object = Record<string, never>>(
    text: string,
    values?: readonly SqlParameter[],
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
  release(destroy?: boolean): void;
}
export interface SqlPool {
  connect(): Promise<SqlConnection>;
}
