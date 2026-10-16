"use client";

import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { FluidButton } from "@/components/ui/fluid-button";
import { FluidDialog } from "@/components/ui/fluid-dialog";
import {
  secretSetSchema,
  type AppInfo,
  type ConnectionTarget,
  type KnowledgeClient,
  type SecretKind,
  type SecretStatus,
} from "@/lib/contracts";
import { command, readableError, unwrap } from "@/lib/client/result";

export function NumberField({
  label,
  value,
  onChange,
  schema,
  step = 1,
  unit,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  schema: z.ZodNumber;
  step?: number;
  unit?: string;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {unit && `（${unit}）`}
      </span>
      <input
        className="fluid-field"
        type="number"
        value={Number.isFinite(value) ? value : ""}
        min={schema.minValue ?? undefined}
        max={schema.maxValue ?? undefined}
        step={step}
        onChange={(event) => onChange(event.target.valueAsNumber)}
      />
    </label>
  );
}

export const secretNames: Record<SecretKind, string> = {
  "openrouter-api-key": "OpenRouter API key",
  "cohere-api-key": "Cohere API key",
  "database-password": "数据库密码",
};

export function SecretField({
  kind,
  status,
  client,
  mode,
  onUpdated,
}: {
  kind: SecretKind;
  status: SecretStatus[SecretKind];
  client: KnowledgeClient;
  mode: "demo" | "desktop";
  onUpdated: (status: SecretStatus) => void;
}) {
  const name = secretNames[kind];
  const [value, setValue] = useState("");
  const [persistence, setPersistence] = useState<"encrypted" | "session">(
    mode === "demo" ? "session" : "encrypted",
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function save(remove: boolean) {
    if (inFlight.current) return;
    const parsed = secretSetSchema.safeParse({ kind, value, persistence });
    setValue("");
    setError("");
    setMessage("");
    if (!remove && !parsed.success) {
      setError("请输入 1–4096 个字符的新值。");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const next = remove
        ? unwrap(await client.secrets.delete(command({ kind })))
        : parsed.success
          ? unwrap(await client.secrets.set(command(parsed.data)))
          : null;
      if (next && mounted.current) {
        onUpdated(next);
        setMessage(remove ? "已删除。" : "已保存，新值已从输入框清空。");
      }
    } catch (error) {
      if (mounted.current) setError(readableError(error));
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section aria-label={name} className="space-y-3 rounded-lg border p-4">
      <p className="text-sm">
        {name}：
        {status.configured
          ? `已配置（${status.persistence === "encrypted" ? "系统加密" : "当前会话"}）`
          : "未配置"}
      </p>
      <label className="field">
        新 {name}
        <input
          className="fluid-field"
          type="password"
          autoComplete="new-password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="输入新值以设置或替换"
          disabled={busy}
        />
      </label>
      <label className="field">
        保存方式
        <select
          className="fluid-field"
          value={persistence}
          disabled={busy}
          onChange={(event) =>
            setPersistence(event.target.value === "session" ? "session" : "encrypted")
          }
        >
          <option value="encrypted" disabled={mode === "demo"}>
            系统加密
          </option>
          <option value="session">仅当前会话</option>
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <FluidButton
          variant="tertiary"
          disabled={busy || !value.trim()}
          onClick={() => {
            void save(false);
          }}
        >
          保存 {name}
        </FluidButton>
        <FluidButton
          variant="ghost"
          disabled={busy || !status.configured}
          onClick={() => {
            void save(true);
          }}
        >
          删除 {name}
        </FluidButton>
      </div>
      {message && (
        <p role="status" className="text-sm text-success">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

export function ConnectionTest({
  target,
  client,
}: {
  target: ConnectionTarget;
  client: KnowledgeClient;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const label =
    target === "database" ? "数据库连接" : target === "openrouter" ? "OpenRouter" : "Cohere";
  async function test() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("正在测试已保存的配置…");
    try {
      const report = unwrap(await client.connections.test(command({ target })));
      setMessage(
        `${report.ok ? "连接成功" : "连接未通过"}：${report.message}${report.ok ? `（${Math.round(report.latencyMs)} ms）` : ""}`,
      );
    } catch (error) {
      setMessage(readableError(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <FluidButton
        variant="tertiary"
        disabled={busy}
        onClick={() => {
          void test();
        }}
      >
        测试{label}
      </FluidButton>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </div>
  );
}

export function AboutPanel({ client }: { client: KnowledgeClient }) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [license, setLicense] = useState<{ title: string; text: string } | null>(null);
  useEffect(() => {
    let active = true;
    void client.system
      .getInfo(command({}))
      .then(unwrap)
      .then((value) => {
        if (active) {
          setInfo(value);
          setError("");
        }
      })
      .catch((error) => {
        if (active) setError(readableError(error));
      });
    return () => {
      active = false;
    };
  }, [client, retry]);
  async function showLicense(title: string, path: string) {
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error("License unavailable");
      setLicense({ title, text: await response.text() });
    } catch {
      setError("许可文本暂时无法读取，请重试。");
    }
  }
  function external(url: string) {
    void client.system
      .openExternal(command({ url }))
      .then(unwrap)
      .catch((error) => setError(readableError(error)));
  }
  return (
    <div className="space-y-5">
      <h2 className="text-xl">关于知屿</h2>
      {!info && !error && <p role="status">正在读取版本信息…</p>}
      {info && (
        <>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2 text-sm">
            <dt>版本</dt>
            <dd>{info.version}</dd>
            <dt>系统与架构</dt>
            <dd>
              {info.platform} / {info.arch}
            </dd>
            <dt>Electron</dt>
            <dd>{info.versions.electron}</dd>
            <dt>Chrome</dt>
            <dd>{info.versions.chrome}</dd>
            <dt>Node</dt>
            <dd>{info.versions.node}</dd>
            <dt>运行模式</dt>
            <dd>{info.mode === "demo" ? "浏览器演示" : "桌面应用"}</dd>
            <dt>许可证</dt>
            <dd>{info.developer.license}</dd>
          </dl>
          <p className="text-sm">开发者：{info.developer.name ?? "未配置"}</p>
          <p className="text-sm [overflow-wrap:anywhere]">
            支持：{info.developer.support ?? "未配置"}
          </p>
          <p className="text-sm [overflow-wrap:anywhere]">
            版权：{info.developer.copyright ?? "未配置"}
          </p>
          <div className="flex flex-wrap gap-3">
            {info.developer.homepage ? (
              <FluidButton variant="tertiary" onClick={() => external(info.developer.homepage!)}>
                开发者主页
              </FluidButton>
            ) : (
              <p className="text-sm text-muted-foreground">主页：未配置</p>
            )}
            {info.developer.repository ? (
              <FluidButton variant="tertiary" onClick={() => external(info.developer.repository!)}>
                项目仓库
              </FluidButton>
            ) : (
              <p className="text-sm text-muted-foreground">仓库：未配置</p>
            )}
          </div>
        </>
      )}
      <div className="space-y-2 border-t pt-5">
        <h3 className="text-lg">许可证与致谢</h3>
        <p className="text-sm text-muted-foreground">
          Fluid Functionalism、shadcn/ui、Radix、Lucide；字体为 Geist、Geist Mono
          与霞鹜文楷屏幕阅读版。
        </p>
        <div className="flex flex-wrap gap-2">
          <FluidButton
            variant="tertiary"
            onClick={() => {
              void showLicense(
                "Fluid Functionalism · MIT 许可",
                "/licenses/fluid-functionalism-MIT.txt",
              );
            }}
          >
            Fluid Functionalism · MIT 许可
          </FluidButton>
          <FluidButton
            variant="tertiary"
            onClick={() => {
              void showLicense("Geist · OFL 许可", "/fonts/geist/OFL.txt");
            }}
          >
            Geist · OFL 许可
          </FluidButton>
          <FluidButton
            variant="tertiary"
            onClick={() => {
              void showLicense("霞鹜文楷 · OFL 许可", "/fonts/lxgw/OFL.txt");
            }}
          >
            霞鹜文楷 · OFL 许可
          </FluidButton>
        </div>
      </div>
      {error && (
        <div role="alert" className="text-destructive">
          <p>{error}</p>
          <FluidButton variant="tertiary" onClick={() => setRetry((value) => value + 1)}>
            重试读取
          </FluidButton>
        </div>
      )}
      <FluidDialog
        open={!!license}
        onOpenChange={(open) => {
          if (!open) setLicense(null);
        }}
        title={license?.title ?? "许可证"}
        description="随应用打包的上游许可证原文。"
        className="document-editor"
      >
        <pre className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">
          {license?.text}
        </pre>
      </FluidDialog>
    </div>
  );
}
