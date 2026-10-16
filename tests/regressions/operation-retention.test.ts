import assert from "node:assert/strict";
import test from "node:test";
import { OperationRegistry } from "../../electron/platform/operations";
import type { OperationEvent } from "../../src/lib/contracts";

const uuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

test("单窗口长期查询不会因已结束记录累计而停止服务", async () => {
  const operations = new OperationRegistry(() => {});
  try {
    for (let index = 0; index < 4100; index++) {
      assert.equal(await operations.run("owner", uuid(index), "search", async () => index), index);
    }
  } finally {
    operations.dispose();
  }
});

test("已结束的流式任务释放记录但仍保持唯一终态", async () => {
  let terminalCount = 0;
  let complete!: () => void;
  const operations = new OperationRegistry((_owner, event: OperationEvent) => {
    if (event.payload.type === "completed") {
      terminalCount++;
      complete();
    }
  });
  try {
    for (let index = 0; index < 4100; index++) {
      const finished = new Promise<void>((resolve) => {
        complete = resolve;
      });
      operations.start("owner", uuid(index), "assistant", async () => {});
      await finished;
    }
    assert.equal(terminalCount, 4100);
  } finally {
    operations.dispose();
  }
});

test("清理完成历史保留最近重复检测与 32 个活动调用限制", async () => {
  const operations = new OperationRegistry(() => {});
  const pending: Promise<unknown>[] = [];
  try {
    await operations.run("owner", uuid(9000), "search", async () => "finished");
    await assert.rejects(operations.run("owner", uuid(9000), "search", async () => "replayed"));
    for (let index = 0; index < 32; index++) {
      pending.push(operations.run("owner", uuid(index), "call", async () => new Promise(() => {})));
    }
    await assert.rejects(operations.run("owner", uuid(100), "call", async () => "overflow"));
  } finally {
    operations.cancelOwner("owner");
    const results = await Promise.allSettled(pending);
    assert.equal(results.length, 32);
    assert.ok(results.every((result) => result.status === "rejected"));
    operations.dispose();
  }
});
