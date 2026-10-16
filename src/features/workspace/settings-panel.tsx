"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FluidButton } from "@/components/ui/fluid-button";
import { FluidDialog } from "@/components/ui/fluid-dialog";
import { TabsSubtle } from "@/components/ui/tabs-subtle";
import {
  appearanceSettingsSchema,
  databaseSettingsSchema,
  generationSettingsSchema,
  indexingSettingsSchema,
  modelSettingsSchema,
  retrievalSettingsSchema,
  settingsUpdateSchema,
  type ChatModelInfo,
  type IndexStatus,
  type KnowledgeClient,
  type PublicSettings,
  type SettingsView,
} from "@/lib/contracts";
import { ClientError, command, readableError, unwrap } from "@/lib/client/result";
import { useOperation } from "@/lib/client/use-operation";
import { AboutPanel, ConnectionTest, NumberField, SecretField } from "./settings-fields";

const groups = [
  { id: "database", label: "连接" },
  { id: "models", label: "模型与 API" },
  { id: "indexing", label: "向量索引" },
  { id: "retrieval", label: "检索" },
  { id: "generation", label: "生成" },
  { id: "appearance", label: "外观" },
  { id: "about", label: "关于" },
] as const;
type Tab = (typeof groups)[number]["id"];
type Group = Exclude<Tab, "about">;

export function SettingsPanel({
  client,
  mode,
  onUpdated,
}: {
  client: KnowledgeClient;
  mode: "demo" | "desktop";
  onUpdated: (view: SettingsView) => void;
}) {
  const [loaded, setLoaded] = useState<SettingsView | null>(null);
  const [draft, setDraft] = useState<PublicSettings | null>(null);
  const [tab, setTab] = useState<Tab>("database");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [models, setModels] = useState<ChatModelInfo[]>([]);
  const [modelMessage, setModelMessage] = useState("");
  const [modelsBusy, setModelsBusy] = useState(false);
  const [index, setIndex] = useState<IndexStatus | null>(null);
  const [indexError, setIndexError] = useState("");
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const saving = useRef(false);
  const fetchingModels = useRef(false);
  const mounted = useRef(false);
  const { state: operation, running, start, cancel } = useOperation(client);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshIndex = useCallback(() => {
    return client.index
      .status(command({}))
      .then(unwrap)
      .then((status) => {
        if (mounted.current) {
          setIndex(status);
          setIndexError("");
        }
      })
      .catch((error) => {
        if (mounted.current) setIndexError(readableError(error));
      });
  }, [client]);
  useEffect(() => {
    let active = true;
    void client.settings
      .get(command({}))
      .then(unwrap)
      .then((value) => {
        if (active) {
          setLoaded(value);
          setDraft(value.settings);
          setError("");
          setConflict(false);
        }
      })
      .catch((error) => {
        if (active) setError(readableError(error));
      });
    void refreshIndex();
    return () => {
      active = false;
    };
  }, [client, retry, refreshIndex]);
  useEffect(() => {
    if (!["completed", "cancelled", "failed"].includes(operation.status)) return;
    let active = true;
    void refreshIndex();
    void client.settings
      .get(command({}))
      .then(unwrap)
      .then((value) => {
        if (active) {
          setLoaded(value);
          onUpdated(value);
        }
      })
      .catch((error) => {
        if (active) setError(readableError(error));
      });
    return () => {
      active = false;
    };
  }, [client, operation.status, refreshIndex, onUpdated]);

  function change<G extends Group>(group: G, value: PublicSettings[G]) {
    setDraft((current) => (current ? { ...current, [group]: value } : current));
    setNotice("");
  }
  async function save(group: Group) {
    if (!loaded || !draft || saving.current || conflict) return;
    const parsed = settingsUpdateSchema.safeParse({
      expectedRevision: loaded.settings.revision,
      patch: { [group]: draft[group] },
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(
        issue.code === "custom"
          ? group === "generation"
            ? "每文档上限不能超过上下文片段数。"
            : issue.message
          : "请检查本组数值范围与填写格式，字段范围见输入框。",
      );
      return;
    }
    saving.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = unwrap(await client.settings.update(command(parsed.data)));
      if (!mounted.current) return;
      setLoaded(value);
      setDraft((previous) =>
        previous
          ? { ...previous, revision: value.settings.revision, [group]: value.settings[group] }
          : value.settings,
      );
      onUpdated(value);
      setNotice(`${groups.find((item) => item.id === group)?.label}设置已保存。`);
      await refreshIndex();
    } catch (error) {
      if (mounted.current) {
        setError(readableError(error));
        setConflict(error instanceof ClientError && error.detail.code === "CONFLICT");
      }
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function listModels() {
    if (fetchingModels.current) return;
    fetchingModels.current = true;
    setModelsBusy(true);
    setModelMessage("");
    try {
      const available = unwrap(await client.models.list(command({})));
      if (!mounted.current) return;
      setModels(available);
      const model = available.find((model) => model.id === draft?.models.chatModel);
      setModelMessage(
        model
          ? `已在可用列表中找到 ${model.id}。`
          : draft?.models.chatModel
            ? "当前 ID 未出现在可用列表中，请核对或选择列表中的模型。"
            : `已读取 ${available.length} 个模型，可选择或手填 ID 后再次核对。`,
      );
    } catch (error) {
      if (mounted.current) setModelMessage(readableError(error));
    } finally {
      fetchingModels.current = false;
      if (mounted.current) setModelsBusy(false);
    }
  }
  if (!loaded || !draft)
    return (
      <section className="p-8">
        <h1 className="text-2xl">设置与关于</h1>
        {error ? (
          <p role="alert" className="my-5 text-destructive">
            {error}
          </p>
        ) : (
          <p role="status" className="my-5">
            正在读取设置…
          </p>
        )}
        <FluidButton variant="tertiary" onClick={() => setRetry((value) => value + 1)}>
          重新加载设置
        </FluidButton>
      </section>
    );
  const current = draft;
  const snapshot = loaded;
  const currentModel = models.find((model) => model.id === current.models.chatModel);
  const updateSecrets = (secrets: SettingsView["secrets"]) => {
    const next = { ...snapshot, secrets };
    setLoaded(next);
    onUpdated(next);
  };
  const canRebuild = mode === "demo" || snapshot.secrets["openrouter-api-key"].configured;
  const saveButton = (group: Group) => (
    <div className="border-t pt-5">
      <FluidButton
        disabled={busy || conflict}
        onClick={() => {
          void save(group);
        }}
      >
        保存{groups.find((item) => item.id === group)?.label}设置
      </FluidButton>
    </div>
  );
  return (
    <section aria-label="设置与关于" className="mx-auto w-full max-w-4xl p-5 sm:p-8">
      <h1 className="text-2xl">设置与关于</h1>
      <p className="mt-2 mb-6 text-muted-foreground">
        按组保存，修改索引配置后需手动开始重建。连接测试使用已保存配置。
      </p>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">设置版本 {snapshot.settings.revision}</p>
        <FluidButton
          variant="tertiary"
          disabled={busy}
          onClick={() => {
            setNotice("");
            setRetry((value) => value + 1);
          }}
        >
          重新加载设置
        </FluidButton>
      </div>
      {snapshot.index.requiresReindex && (
        <div className="mb-5 rounded-lg border p-4 text-warning">
          <h2 className="text-lg">需要重建索引</h2>
          <p className="text-sm">
            向量设置已经保存，现有索引会保留到重建完成。请在“向量索引”中确认开始。
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="mb-5 rounded-lg border p-4 text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-5 text-success">
          {notice}
        </p>
      )}
      <TabsSubtle
        value={tab}
        onValueChange={(value) => {
          const next = groups.find((item) => item.id === value);
          if (next) {
            setTab(next.id);
            setNotice("");
          }
        }}
        label="设置分组"
        tabs={[
          {
            value: "database",
            label: "连接",
            content: (
              <div className="space-y-5">
                <h2 className="text-xl">PostgreSQL 连接</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="field">
                    主机
                    <input
                      className="fluid-field"
                      value={current.database.host}
                      onChange={(event) =>
                        change("database", { ...current.database, host: event.target.value })
                      }
                    />
                  </label>
                  <NumberField
                    label="端口"
                    value={current.database.port}
                    schema={databaseSettingsSchema.shape.port}
                    onChange={(value) => change("database", { ...current.database, port: value })}
                  />
                  <label className="field">
                    数据库
                    <input
                      className="fluid-field"
                      value={current.database.database}
                      onChange={(event) =>
                        change("database", { ...current.database, database: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    用户
                    <input
                      className="fluid-field"
                      value={current.database.user}
                      onChange={(event) =>
                        change("database", { ...current.database, user: event.target.value })
                      }
                    />
                  </label>
                </div>
                <label className="field">
                  TLS
                  <select
                    className="fluid-field"
                    value={current.database.sslMode}
                    onChange={(event) =>
                      change("database", {
                        ...current.database,
                        sslMode: event.target.value === "verify-full" ? "verify-full" : "disable",
                      })
                    }
                  >
                    <option value="disable">本机连接</option>
                    <option value="verify-full">验证服务器证书</option>
                  </select>
                </label>
                <p className="text-sm text-muted-foreground">
                  远程主机必须验证证书。应用不会自动创建数据库或角色。
                </p>
                {saveButton("database")}
                <SecretField
                  kind="database-password"
                  status={snapshot.secrets["database-password"]}
                  client={client}
                  mode={mode}
                  onUpdated={updateSecrets}
                />
                <ConnectionTest target="database" client={client} />
              </div>
            ),
          },
          {
            value: "models",
            label: "模型与 API",
            content: (
              <div className="space-y-5">
                <h2 className="text-xl">模型与 API</h2>
                <label className="field">
                  聊天模型 ID
                  <input
                    className="fluid-field font-mono"
                    list="available-chat-models"
                    value={current.models.chatModel ?? ""}
                    placeholder="选择或输入实际可用的模型 ID"
                    onChange={(event) =>
                      change("models", { ...current.models, chatModel: event.target.value || null })
                    }
                  />
                </label>
                <datalist id="available-chat-models">
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </datalist>
                <FluidButton
                  variant="tertiary"
                  disabled={modelsBusy}
                  onClick={() => {
                    void listModels();
                  }}
                >
                  刷新模型列表并验证
                </FluidButton>
                {modelMessage && (
                  <p role="status" className="text-sm">
                    {modelMessage}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  {currentModel
                    ? `上下文窗口：${currentModel.contextLength ?? "未知"} tokens；输出上限：${currentModel.maxOutputTokens ?? "未知"} tokens；温度：${currentModel.supportsTemperature === null ? "能力未知" : currentModel.supportsTemperature ? "支持" : "不支持"}。`
                    : "模型能力尚未核实，请刷新列表核对；无法确认的能力显示为未知。"}
                </p>
                <p className="break-all text-sm">
                  Embedding：<code>{current.models.embeddingModel}</code>（固定）
                </p>
                <p className="text-sm">
                  Rerank：<code>{current.models.rerankModel}</code>（固定）
                </p>
                <label className="field">
                  Embedding 维度
                  <select
                    className="fluid-field"
                    value={current.models.embeddingDimensions}
                    onChange={(event) => {
                      const parsed = modelSettingsSchema.shape.embeddingDimensions.safeParse(
                        Number(event.target.value),
                      );
                      if (parsed.success)
                        change("models", { ...current.models, embeddingDimensions: parsed.data });
                    }}
                  >
                    <option value="3072">3072 维</option>
                    <option value="1536">1536 维</option>
                  </select>
                </label>
                {saveButton("models")}
                <p className="text-sm text-muted-foreground">
                  未配置 OpenRouter 时仍可编辑资料与进行关键词检索；没有 Cohere key
                  时保留召回结果并提示降级。
                </p>
                <SecretField
                  kind="openrouter-api-key"
                  status={snapshot.secrets["openrouter-api-key"]}
                  client={client}
                  mode={mode}
                  onUpdated={updateSecrets}
                />
                <ConnectionTest target="openrouter" client={client} />
                <SecretField
                  kind="cohere-api-key"
                  status={snapshot.secrets["cohere-api-key"]}
                  client={client}
                  mode={mode}
                  onUpdated={updateSecrets}
                />
                <ConnectionTest target="cohere" client={client} />
              </div>
            ),
          },
          {
            value: "indexing",
            label: "向量索引",
            content: (
              <div className="space-y-5">
                <h2 className="text-xl">片段与向量索引</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <NumberField
                    label="片段长度"
                    unit="tokens"
                    value={current.indexing.chunkTokens}
                    schema={indexingSettingsSchema.shape.chunkTokens}
                    onChange={(value) =>
                      change("indexing", { ...current.indexing, chunkTokens: value })
                    }
                  />
                  <NumberField
                    label="重叠长度"
                    unit="tokens"
                    value={current.indexing.overlapTokens}
                    schema={indexingSettingsSchema.shape.overlapTokens}
                    onChange={(value) =>
                      change("indexing", { ...current.indexing, overlapTokens: value })
                    }
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  重叠量需小于片段长度的一半；保存后须重新生成向量。
                </p>
                {saveButton("indexing")}
                <div className="rounded-lg border p-4">
                  <h3 className="mb-3 text-lg">索引状态</h3>
                  {index ? (
                    <div className="space-y-2 text-sm">
                      <p>
                        文档 {index.documentCount} 篇 · 片段 {index.chunkCount} 个 · 待处理{" "}
                        {index.pendingCount} 个 · 失败 {index.failedCount} 个
                      </p>
                      <p className="break-all">
                        当前可用代次：{index.activeGenerationId ?? "尚未建立"}
                      </p>
                      {index.lastErrorCode && (
                        <p className="text-destructive">最近错误：{index.lastErrorCode}</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm">索引状态暂不可用。</p>
                  )}
                  {indexError && (
                    <p role="alert" className="my-3 text-destructive">
                      {indexError}
                    </p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-3">
                    <FluidButton
                      variant="tertiary"
                      onClick={() => {
                        void refreshIndex();
                      }}
                    >
                      刷新索引状态
                    </FluidButton>
                    {running ? (
                      <FluidButton
                        onClick={() => {
                          void cancel();
                        }}
                      >
                        取消重建
                      </FluidButton>
                    ) : (
                      <FluidButton disabled={!index} onClick={() => setConfirmRebuild(true)}>
                        重建索引
                      </FluidButton>
                    )}
                  </div>
                  {!canRebuild && (
                    <p className="mt-3 text-sm text-warning">
                      请先配置 OpenRouter API key，再重建向量。关键词检索仍可使用。
                    </p>
                  )}
                  {operation.progress && (
                    <div className="mt-4">
                      <progress
                        aria-label="索引重建进度"
                        value={operation.progress.completed + operation.progress.failed}
                        max={Math.max(1, operation.progress.total)}
                        className="w-full accent-primary"
                      />
                      <p role="status" className="text-sm">
                        已处理 {operation.progress.completed} / {operation.progress.total} 篇，失败{" "}
                        {operation.progress.failed} 篇
                      </p>
                    </div>
                  )}
                  {operation.status === "starting" && (
                    <p role="status" className="mt-3 text-sm">
                      重建操作已启动，等待进度…
                    </p>
                  )}
                  {operation.status === "completed" && (
                    <p role="status" className="mt-3 text-success">
                      索引重建完成。
                    </p>
                  )}
                  {operation.status === "cancelled" && (
                    <p role="status" className="mt-3 text-sm">
                      重建已取消，当前可用索引已保留。
                    </p>
                  )}
                  {operation.error && (
                    <p role="alert" className="mt-3 text-destructive">
                      {operation.error}
                    </p>
                  )}
                </div>
              </div>
            ),
          },
          {
            value: "retrieval",
            label: "检索",
            content: (
              <div className="space-y-5">
                <h2 className="text-xl">召回与重排</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <NumberField
                    label="关键词候选"
                    unit="片段"
                    value={current.retrieval.keywordCandidates}
                    schema={retrievalSettingsSchema.shape.keywordCandidates}
                    onChange={(value) =>
                      change("retrieval", { ...current.retrieval, keywordCandidates: value })
                    }
                  />
                  <NumberField
                    label="向量候选"
                    unit="片段"
                    value={current.retrieval.vectorCandidates}
                    schema={retrievalSettingsSchema.shape.vectorCandidates}
                    onChange={(value) =>
                      change("retrieval", { ...current.retrieval, vectorCandidates: value })
                    }
                  />
                  <NumberField
                    label="向量过采样"
                    unit="片段"
                    value={current.retrieval.vectorOversample}
                    schema={retrievalSettingsSchema.shape.vectorOversample}
                    onChange={(value) =>
                      change("retrieval", { ...current.retrieval, vectorOversample: value })
                    }
                  />
                  <NumberField
                    label="重排候选"
                    unit="片段"
                    value={current.retrieval.rerankCandidates}
                    schema={retrievalSettingsSchema.shape.rerankCandidates}
                    onChange={(value) =>
                      change("retrieval", { ...current.retrieval, rerankCandidates: value })
                    }
                  />
                  <NumberField
                    label="结果数量"
                    unit="片段"
                    value={current.retrieval.resultCount}
                    schema={retrievalSettingsSchema.shape.resultCount}
                    onChange={(value) =>
                      change("retrieval", { ...current.retrieval, resultCount: value })
                    }
                  />
                  <NumberField
                    label="关键词权重"
                    value={current.retrieval.keywordWeight}
                    schema={retrievalSettingsSchema.shape.keywordWeight}
                    step={0.01}
                    onChange={(value) =>
                      change("retrieval", { ...current.retrieval, keywordWeight: value })
                    }
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  向量权重为 1 − 关键词权重。向量过采样不小于向量候选；重排候选不小于结果数量。
                </p>
                <label className="flex items-center gap-3">
                  <input
                    className="size-4 accent-primary"
                    type="checkbox"
                    checked={current.retrieval.rerankEnabled}
                    onChange={(event) =>
                      change("retrieval", {
                        ...current.retrieval,
                        rerankEnabled: event.target.checked,
                      })
                    }
                  />
                  启用 Cohere Rerank
                </label>
                {saveButton("retrieval")}
              </div>
            ),
          },
          {
            value: "generation",
            label: "生成",
            content: (
              <div className="space-y-5">
                <h2 className="text-xl">回答生成</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <NumberField
                    label="温度"
                    value={current.generation.temperature}
                    schema={generationSettingsSchema.shape.temperature}
                    step={0.1}
                    onChange={(value) =>
                      change("generation", { ...current.generation, temperature: value })
                    }
                  />
                  <NumberField
                    label="上下文片段"
                    unit="片段"
                    value={current.generation.contextChunks}
                    schema={generationSettingsSchema.shape.contextChunks}
                    onChange={(value) =>
                      change("generation", { ...current.generation, contextChunks: value })
                    }
                  />
                  <NumberField
                    label="每文档上限"
                    unit="片段"
                    value={current.generation.maxChunksPerDocument}
                    schema={generationSettingsSchema.shape.maxChunksPerDocument}
                    onChange={(value) =>
                      change("generation", { ...current.generation, maxChunksPerDocument: value })
                    }
                  />
                  <NumberField
                    label="上下文预算"
                    unit="tokens"
                    value={current.generation.contextTokenBudget}
                    schema={generationSettingsSchema.shape.contextTokenBudget}
                    onChange={(value) =>
                      change("generation", { ...current.generation, contextTokenBudget: value })
                    }
                  />
                  <NumberField
                    label="输出上限"
                    unit="tokens"
                    value={current.generation.maxOutputTokens}
                    schema={generationSettingsSchema.shape.maxOutputTokens}
                    onChange={(value) =>
                      change("generation", { ...current.generation, maxOutputTokens: value })
                    }
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  每文档上限不超过上下文片段数。主进程还会按所选模型的实际窗口和能力验证预算；不支持温度的模型会省略该参数。
                </p>
                {saveButton("generation")}
              </div>
            ),
          },
          {
            value: "appearance",
            label: "外观",
            content: (
              <div className="space-y-5">
                <h2 className="text-xl">阅读与外观</h2>
                <label className="field">
                  主题
                  <select
                    className="fluid-field"
                    value={current.appearance.theme}
                    onChange={(event) => {
                      const parsed = appearanceSettingsSchema.shape.theme.safeParse(
                        event.target.value,
                      );
                      if (parsed.success)
                        change("appearance", { ...current.appearance, theme: parsed.data });
                    }}
                  >
                    <option value="system">跟随系统</option>
                    <option value="light">浅色</option>
                    <option value="dark">深色</option>
                  </select>
                </label>
                <label className="flex items-center gap-3">
                  <input
                    className="size-4 accent-primary"
                    type="checkbox"
                    checked={current.appearance.reduceMotion}
                    onChange={(event) =>
                      change("appearance", {
                        ...current.appearance,
                        reduceMotion: event.target.checked,
                      })
                    }
                  />
                  减少动态效果
                </label>
                <p className="text-sm text-muted-foreground">
                  系统要求减少动态效果时始终生效。字体随应用本地加载。
                </p>
                {saveButton("appearance")}
              </div>
            ),
          },
          { value: "about", label: "关于", content: <AboutPanel client={client} /> },
        ]}
      />
      <FluidDialog
        open={confirmRebuild}
        onOpenChange={setConfirmRebuild}
        title="确认重建索引"
        description={
          mode === "demo"
            ? "演示模式只模拟索引进度，不调用云端服务。"
            : "重建会调用 Embedding 服务并产生费用。当前可用索引会保留到新代次完成。"
        }
      >
        <p className="mb-5">
          当前有 {index?.documentCount ?? 0} 篇文档、{index?.chunkCount ?? 0}{" "}
          个片段，重建后的片段数可能变化。
        </p>
        {!canRebuild && <p className="mb-4 text-warning">请先配置 OpenRouter API key。</p>}
        <FluidButton
          disabled={!canRebuild || running}
          onClick={() => {
            setConfirmRebuild(false);
            void start({ kind: "reindex" });
          }}
        >
          开始重建
        </FluidButton>
      </FluidDialog>
    </section>
  );
}
