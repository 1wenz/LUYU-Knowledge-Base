import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { withDatabaseUrl } from "../integration/database-fixture";
import { createEvaluationStore } from "./postgres";
import { readEvaluationConfig, runEvaluation, EvaluationFailure } from "./runner";

test("显式 live：隔离 PostgreSQL、合成语料与付费 provider 预算", { timeout: 200_000 }, async () => {
  const config = readEvaluationConfig();
  try {
    const report = await withDatabaseUrl(config.databaseUrl, async (pool) =>
      runEvaluation(config, { store: createEvaluationStore(pool, config.dimensions) }),
    );
    await mkdir(".cache", { recursive: true });
    await writeFile(".cache/eval-report.json", JSON.stringify(report, null, 2) + "\n", "utf8");
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } catch (error) {
    // Never let a DSN, pg error, provider body, or key become a test diagnostic.
    throw error instanceof EvaluationFailure ? error : new EvaluationFailure("STORE_FAILED");
  }
});
