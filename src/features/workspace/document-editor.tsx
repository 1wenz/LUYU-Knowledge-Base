"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { FluidButton } from "@/components/ui/fluid-button";
import { FluidDialog } from "@/components/ui/fluid-dialog";
import { TabsSubtle } from "@/components/ui/tabs-subtle";
import {
  documentDraftSchema,
  type Collection,
  type Document,
  type KnowledgeClient,
} from "@/lib/contracts";
import { ClientError, command, readableError, unwrap } from "@/lib/client/result";
import { Markdown } from "./markdown";

export function DocumentEditor({
  document: initial,
  collectionId,
  collections,
  client,
  onClose,
  onSaved,
}: {
  document: Document | null;
  collectionId?: string;
  collections: Collection[];
  client: KnowledgeClient;
  onClose: () => void;
  onSaved: (document: Document) => void;
}) {
  const [base, setBase] = useState(initial);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.contentMarkdown ?? "");
  const [collection, setCollection] = useState(initial?.collectionId ?? collectionId ?? "");
  const [tags, setTags] = useState(initial?.tags.join("，") ?? "");
  const [tab, setTab] = useState("edit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [discard, setDiscard] = useState(false);
  const inFlight = useRef(false);
  const dirty =
    title !== (initial?.title ?? "") ||
    content !== (initial?.contentMarkdown ?? "") ||
    tags !== (initial?.tags.join("，") ?? "") ||
    collection !== (initial?.collectionId ?? collectionId ?? "");
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const parsed = documentDraftSchema.safeParse({
      title,
      contentMarkdown: content,
      collectionId: collection || null,
      tags: tags
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "请检查笔记内容。");
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      const saved = unwrap(
        await client.documents.save(
          command({
            draft: parsed.data,
            ...(base ? { existing: { id: base.id, expectedRevision: base.revision } } : {}),
          }),
        ),
      );
      onSaved(saved);
      onClose();
    } catch (error) {
      setError(readableError(error));
      setConflict(error instanceof ClientError && error.detail.code === "CONFLICT");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }
  async function reloadBase() {
    if (!base) return;
    try {
      setBase(unwrap(await client.documents.get(command({ id: base.id }))));
      setConflict(false);
      setError("已读取最新版本。草稿仍保留；再次保存会用当前草稿更新最新版本，请先核对。");
    } catch (error) {
      setError(readableError(error));
    }
  }
  const close = () => {
    if (!saving) {
      if (dirty) setDiscard(true);
      else onClose();
    }
  };
  return (
    <>
      <FluidDialog
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title={initial ? "编辑笔记" : "新建笔记"}
        description="支持 Markdown 基础语法。外链由应用打开，图片不会自动加载。"
        className="document-editor"
      >
        <form
          onSubmit={(event) => {
            void save(event);
          }}
          className="space-y-4"
        >
          <label className="field">
            标题
            <input
              className="fluid-field"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              maxLength={240}
              autoFocus
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="field">
              分类
              <select
                className="fluid-field"
                value={collection}
                onChange={(event) => setCollection(event.target.value)}
              >
                <option value="">未分类</option>
                {collections.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              标签
              <input
                className="fluid-field"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="阅读，灵感"
              />
            </label>
          </div>
          <TabsSubtle
            value={tab}
            onValueChange={setTab}
            label="笔记编辑模式"
            tabs={[
              {
                value: "edit",
                label: "编辑",
                content: (
                  <label className="field">
                    Markdown 正文
                    <textarea
                      className="fluid-field min-h-60 resize-y font-mono"
                      value={content}
                      onChange={(event) => setContent(event.target.value)}
                    />
                  </label>
                ),
              },
              {
                value: "preview",
                label: "安全预览",
                content: (
                  <div className="min-h-60 rounded-lg border p-4">
                    <Markdown text={content || "还没有正文。"} client={client} onError={setError} />
                  </div>
                ),
              },
            ]}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {conflict && (
            <FluidButton
              variant="tertiary"
              onClick={() => {
                void reloadBase();
              }}
            >
              读取最新版本并保留草稿
            </FluidButton>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span role="status" className="text-sm text-muted-foreground">
              {saving ? "正在保存…" : dirty ? "有未保存的修改" : "尚未修改"}
            </span>
            <div className="flex gap-2">
              <FluidButton variant="ghost" disabled={saving} onClick={close}>
                取消
              </FluidButton>
              <FluidButton type="submit" disabled={saving || conflict}>
                保存笔记
              </FluidButton>
            </div>
          </div>
        </form>
      </FluidDialog>
      <FluidDialog
        open={discard}
        onOpenChange={setDiscard}
        title="保留这份草稿吗"
        description="关闭编辑器会丢弃尚未保存的修改。"
      >
        <div className="flex flex-wrap gap-3">
          <FluidButton onClick={() => setDiscard(false)}>继续编辑</FluidButton>
          <FluidButton variant="tertiary" onClick={onClose}>
            放弃草稿
          </FluidButton>
        </div>
      </FluidDialog>
    </>
  );
}
