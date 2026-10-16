"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Clock3,
  Database,
  FileText,
  Folder,
  Menu,
  PenLine,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { FluidButton } from "@/components/ui/fluid-button";
import { FluidDialog } from "@/components/ui/fluid-dialog";
import { FluidSidebar, FluidSidebarMenu, type SidebarItem } from "@/components/ui/fluid-sidebar";
import type {
  Citation,
  Collection,
  Document,
  DocumentPage,
  KnowledgeClient,
  ListDocuments,
  SettingsView,
} from "@/lib/contracts";
import { command, readableError, unwrap } from "@/lib/client/result";
import { DocumentEditor } from "./document-editor";
import { ImportDialog } from "./import-dialog";
import { Markdown } from "./markdown";
import { SearchPanel } from "./search-panel";
import { SourceDialog } from "./source-dialog";
import { AssistantPanel } from "./assistant-panel";

type MainView = "notes" | "search" | "assistant" | "settings";
const navItems: SidebarItem[] = [
  { id: "all", label: "全部笔记", icon: FileText },
  { id: "recent", label: "最近编辑", icon: Clock3 },
  { id: "favorites", label: "我的收藏", icon: Star },
  { id: "trash", label: "回收站", icon: Trash2 },
  { id: "search", label: "来源检索", icon: Database },
  { id: "assistant", label: "知识助手", icon: Sparkles },
];

export function Workspace({ client, mode }: { client: KnowledgeClient; mode: "desktop" | "demo" }) {
  const [view, setView] = useState<MainView>("notes");
  const [filter, setFilter] = useState<ListDocuments>({ view: "all", offset: 0, limit: 50 });
  const [page, setPage] = useState<DocumentPage>({ items: [], total: 0 });
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selected, setSelected] = useState<Document | null>(null);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<{ document: Document | null } | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [collectionName, setCollectionName] = useState("");
  const [renaming, setRenaming] = useState<Collection | null>(null);
  const [source, setSource] = useState<Citation | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const selectionRequest = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const refreshData = useCallback(() => setRefresh((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    void Promise.all([
      client.documents.list(command(filter)).then(unwrap),
      client.collections.list(command({})).then(unwrap),
    ])
      .then(([documents, groups]) => {
        if (active) {
          setPage(documents);
          setCollections(groups);
          setError("");
          setLoading(false);
        }
      })
      .catch((error) => {
        if (active) {
          setError(readableError(error));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [client, filter, refresh]);
  useEffect(() => {
    let active = true;
    void client.settings
      .get(command({}))
      .then(unwrap)
      .then((value) => {
        if (active) setSettings(value);
      })
      .catch((error) => {
        if (active) setError(readableError(error));
      });
    return () => {
      active = false;
    };
  }, [client]);
  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    const appearance = settings.settings.appearance;
    root.classList.toggle("dark", appearance.theme === "dark");
    root.classList.toggle("light", appearance.theme === "light");
    root.dataset.reduceMotion = String(appearance.reduceMotion);
  }, [settings]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setView("search");
        requestAnimationFrame(() => inputRef.current?.focus());
      }
      if (event.key === ",") {
        event.preventDefault();
        setView("settings");
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  function choose(id: string) {
    setSidebarOpen(false);
    setSelected(null);
    setQuery("");
    ++selectionRequest.current;
    if (["search", "assistant", "settings"].includes(id)) {
      setView(id as MainView);
      return;
    }
    setView("notes");
    setLoading(true);
    if (collections.some((item) => item.id === id))
      setFilter({ view: "all", collectionId: id, offset: 0, limit: 50 });
    else setFilter({ view: id as ListDocuments["view"], offset: 0, limit: 50 });
  }
  async function openDocument(id: string) {
    const request = ++selectionRequest.current;
    try {
      const value = unwrap(await client.documents.get(command({ id })));
      if (selectionRequest.current === request) {
        setSelected(value);
        setError("");
      }
    } catch (error) {
      if (selectionRequest.current === request) setError(readableError(error));
    }
  }
  async function mutate(run: () => Promise<Document>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await run();
      setSelected(result);
      setError("");
      refreshData();
    } catch (error) {
      setError(readableError(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function saveCollection() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      unwrap(
        await client.collections.save(
          command({
            ...(renaming ? { id: renaming.id } : {}),
            name: collectionName,
            sortOrder: renaming?.sortOrder ?? collections.length,
          }),
        ),
      );
      setCollectionOpen(false);
      setCollectionName("");
      setRenaming(null);
      refreshData();
    } catch (error) {
      setMessage(readableError(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const activeId = view !== "notes" ? view : (filter.collectionId ?? filter.view);
  const activeLabel =
    collections.find((item) => item.id === filter.collectionId)?.name ??
    navItems.find((item) => item.id === filter.view)?.label ??
    "全部笔记";
  const notes = page.items.filter(
    (item) =>
      !query.trim() ||
      [item.title, item.excerpt, ...item.tags]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const tags = [...new Set(page.items.flatMap((item) => item.tags))];
  const navContent = (
    <>
      <div className="mb-8 flex items-center gap-3">
        <BrandMark className="size-9" />
        <span className="text-[1.375rem]">
          知屿 <span className="block text-xs text-muted-foreground">让想法有据可循</span>
        </span>
      </div>
      <FluidSidebarMenu items={navItems} selectedId={activeId} onSelect={choose} />
      <div className="mt-7">
        <p className="mb-2 px-3 text-sm text-muted-foreground">知识分类</p>
        <FluidSidebarMenu
          label="知识分类"
          items={collections.map((item) => ({ id: item.id, label: item.name, icon: Folder }))}
          selectedId={activeId}
          onSelect={choose}
        />
        <FluidButton
          className="mt-2"
          variant="ghost"
          onClick={() => {
            setRenaming(null);
            setCollectionName("");
            setCollectionOpen(true);
          }}
        >
          新建分类
        </FluidButton>
        {filter.collectionId && (
          <FluidButton
            variant="ghost"
            onClick={() => {
              const item = collections.find((item) => item.id === filter.collectionId);
              if (item) {
                setRenaming(item);
                setCollectionName(item.name);
                setCollectionOpen(true);
              }
            }}
          >
            重命名分类
          </FluidButton>
        )}
      </div>
    </>
  );
  return (
    <div className="workspace-shell flex min-h-dvh bg-background">
      <a href="#workspace-main" className="skip-link">
        跳到主要内容
      </a>
      <FluidSidebar
        footer={
          <FluidButton variant="tertiary" className="w-full" onClick={() => choose("settings")}>
            <Settings2 aria-hidden="true" />
            设置与关于
          </FluidButton>
        }
      >
        {navContent}
      </FluidSidebar>
      <div className="min-w-0 flex-1">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card p-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <FluidButton
              variant="ghost"
              iconOnly
              aria-label="打开导航"
              className="min-[1180px]:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu />
            </FluidButton>
            <span className="text-sm text-muted-foreground">
              {mode === "demo" ? "浏览器演示" : "本地知识工作区"}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <FluidButton
              variant="ghost"
              iconOnly
              aria-label="导入资料"
              onClick={() => setImportOpen(true)}
            >
              <Upload />
            </FluidButton>
            <FluidButton
              variant="ghost"
              iconOnly
              aria-label="刷新工作区"
              onClick={() => {
                setLoading(true);
                refreshData();
              }}
            >
              <RefreshCw />
            </FluidButton>
            <FluidButton
              variant="ghost"
              iconOnly
              aria-label="打开设置"
              onClick={() => choose("settings")}
            >
              <Settings2 />
            </FluidButton>
            <FluidButton onClick={() => setEditor({ document: null })}>
              <Plus />
              新建笔记
            </FluidButton>
          </div>
        </header>
        {mode === "demo" && (
          <p className="border-b bg-muted px-5 py-2 text-sm text-muted-foreground">
            演示数据只保存在当前浏览器。检索和回答用于体验界面，不调用云端模型。
          </p>
        )}
        {message && (
          <p
            role="status"
            className="flex items-center justify-between gap-3 border-b px-5 py-3 text-sm"
          >
            <span>{message}</span>
            <FluidButton
              variant="ghost"
              iconOnly
              aria-label="关闭通知"
              onClick={() => setMessage("")}
            >
              ×
            </FluidButton>
          </p>
        )}
        {error && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 border-b p-4 text-destructive"
          >
            <span>{error}</span>
            <FluidButton
              variant="tertiary"
              onClick={() => {
                refreshData();
                if (selected) void openDocument(selected.id);
              }}
            >
              重新加载
            </FluidButton>
          </div>
        )}
        <main id="workspace-main" tabIndex={-1}>
          {view === "notes" && (
            <div className="grid min-w-0 lg:grid-cols-[20rem_minmax(0,1fr)]">
              <section
                aria-label="笔记列表"
                className={`min-w-0 border-r p-5 ${selected ? "hidden lg:block" : ""}`}
              >
                <h1 className="text-2xl">{activeLabel}</h1>
                <p className="my-3 text-sm text-muted-foreground">
                  {query ? `${notes.length} 篇已加载笔记匹配` : `${page.total} 篇笔记`}
                </p>
                <label className="field mb-4">
                  筛选笔记列表
                  <input
                    className="fluid-field"
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="筛选已加载的标题与摘要"
                  />
                </label>
                <label className="field mb-4">
                  按标签筛选
                  <select
                    className="fluid-field"
                    value={filter.tag ?? ""}
                    onChange={(event) => {
                      setLoading(true);
                      setFilter({ ...filter, tag: event.target.value || undefined, offset: 0 });
                    }}
                  >
                    <option value="">全部标签</option>
                    {[...new Set([...(filter.tag ? [filter.tag] : []), ...tags])].map((tag) => (
                      <option key={tag} value={tag}>
                        {tag}
                      </option>
                    ))}
                  </select>
                </label>
                {loading ? (
                  <p role="status">正在读取笔记…</p>
                ) : !notes.length ? (
                  <p className="py-8 text-muted-foreground">
                    {query || filter.tag
                      ? "没有匹配的笔记。"
                      : filter.view === "trash"
                        ? "回收站为空。"
                        : "还没有笔记。"}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {notes.map((note) => (
                      <li key={note.id}>
                        <button
                          aria-label={`打开笔记：${note.title}`}
                          aria-pressed={selected?.id === note.id}
                          onClick={() => {
                            void openDocument(note.id);
                          }}
                          className={`w-full rounded-lg p-3 text-left hover:bg-muted ${selected?.id === note.id ? "bg-secondary" : ""}`}
                        >
                          <span className="block break-words text-lg">
                            {note.title}
                            {note.favorite && (
                              <Star
                                aria-label="已收藏"
                                className="ml-2 inline size-4 text-primary"
                              />
                            )}
                          </span>
                          <span className="my-2 line-clamp-2 break-words text-sm text-muted-foreground">
                            {note.excerpt || "暂无正文"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(note.updatedAt).toLocaleDateString("zh-CN")} ·{" "}
                            {collections.find((item) => item.id === note.collectionId)?.name ??
                              "未分类"}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {page.total > filter.limit && (
                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    <FluidButton
                      variant="tertiary"
                      disabled={filter.offset === 0}
                      onClick={() =>
                        setFilter({ ...filter, offset: Math.max(0, filter.offset - filter.limit) })
                      }
                    >
                      上一页
                    </FluidButton>
                    <span className="text-sm">
                      第 {Math.floor(filter.offset / filter.limit) + 1} 页
                    </span>
                    <FluidButton
                      variant="tertiary"
                      disabled={filter.offset + filter.limit >= page.total}
                      onClick={() => setFilter({ ...filter, offset: filter.offset + filter.limit })}
                    >
                      下一页
                    </FluidButton>
                  </div>
                )}
              </section>
              <section aria-label="笔记详情" className="min-w-0 p-5 sm:p-8">
                {selected ? (
                  <article>
                    <FluidButton
                      variant="ghost"
                      className="mb-4 lg:hidden"
                      onClick={() => setSelected(null)}
                    >
                      返回笔记列表
                    </FluidButton>
                    <div className="mb-5 flex flex-wrap gap-2">
                      {selected.deletedAt ? (
                        <FluidButton
                          disabled={busy}
                          onClick={() => {
                            void mutate(async () =>
                              unwrap(
                                await client.documents.restore(
                                  command({ id: selected.id, expectedRevision: selected.revision }),
                                ),
                              ),
                            );
                          }}
                        >
                          恢复笔记
                        </FluidButton>
                      ) : (
                        <>
                          <FluidButton
                            variant="tertiary"
                            disabled={busy}
                            aria-label={selected.favorite ? "取消收藏" : "收藏笔记"}
                            onClick={() => {
                              void mutate(async () =>
                                unwrap(
                                  await client.documents.setFavorite(
                                    command({
                                      id: selected.id,
                                      expectedRevision: selected.revision,
                                      favorite: !selected.favorite,
                                    }),
                                  ),
                                ),
                              );
                            }}
                          >
                            <Star />
                            {selected.favorite ? "已收藏" : "收藏"}
                          </FluidButton>
                          <FluidButton
                            variant="tertiary"
                            onClick={() => setEditor({ document: selected })}
                          >
                            <PenLine />
                            编辑笔记
                          </FluidButton>
                          <FluidButton
                            variant="ghost"
                            disabled={busy}
                            onClick={() => setRemoveOpen(true)}
                          >
                            <Trash2 />
                            移到回收站
                          </FluidButton>
                        </>
                      )}
                    </div>
                    <h2 className="mb-3 break-words text-2xl">{selected.title}</h2>
                    <p className="mb-5 text-sm text-muted-foreground">
                      更新于 {new Date(selected.updatedAt).toLocaleString("zh-CN")} · 版本{" "}
                      {selected.revision}
                    </p>
                    <div className="mb-8 flex flex-wrap gap-2">
                      {selected.tags.map((tag) => (
                        <span key={tag} className="rounded-md bg-muted px-2 py-1 text-sm">
                          #{tag}
                        </span>
                      ))}
                    </div>
                    <Markdown
                      text={selected.contentMarkdown || "还没有正文。"}
                      client={client}
                      onError={setError}
                    />
                  </article>
                ) : (
                  <div className="mx-auto max-w-lg py-16 text-center">
                    <BookOpen aria-hidden="true" className="mx-auto mb-5 size-10 text-primary" />
                    <h2 className="text-xl">
                      {page.total
                        ? "让每一份资料，都成为思考的起点"
                        : filter.view === "trash"
                          ? "资料可以在这里找回"
                          : "你的知识，从这里开始"}
                    </h2>
                    <p className="my-4 text-muted-foreground">
                      {page.total
                        ? "选择笔记开始阅读，或前往来源检索查找内容。"
                        : "记录一段想法，或导入已有的 Markdown 资料。"}
                    </p>
                  </div>
                )}
              </section>
            </div>
          )}
          {view === "search" && (
            <SearchPanel
              client={client}
              collections={collections}
              inputRef={inputRef}
              onSource={setSource}
            />
          )}
          {view === "assistant" && (
            <AssistantPanel
              client={client}
              mode={mode}
              onSource={setSource}
              onSettings={() => setView("settings")}
            />
          )}
          {view === "settings" && (
            <section className="p-8">
              <h1 className="text-2xl">设置与关于</h1>
              <p className="mt-4">设置界面正在接入共享设置契约。</p>
            </section>
          )}
        </main>
      </div>
      <FluidDialog
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        title="工作区导航"
        description="选择笔记、来源检索或助手。"
        drawer
      >
        {navContent}
        <FluidButton className="mt-6" variant="tertiary" onClick={() => choose("settings")}>
          设置与关于
        </FluidButton>
      </FluidDialog>
      {editor && (
        <DocumentEditor
          document={editor.document}
          collectionId={filter.collectionId}
          collections={collections}
          client={client}
          onClose={() => setEditor(null)}
          onSaved={(document) => {
            setSelected(document);
            setView("notes");
            setFilter({ view: "all", offset: 0, limit: 50 });
            setQuery("");
            refreshData();
            setMessage("笔记已保存");
          }}
        />
      )}
      <FluidDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title="移到回收站"
        description="移入后不会出现在搜索与助手来源中，可以在回收站恢复。"
      >
        <FluidButton
          disabled={busy}
          onClick={() => {
            if (selected)
              void mutate(async () => {
                const result = unwrap(
                  await client.documents.remove(
                    command({ id: selected.id, expectedRevision: selected.revision }),
                  ),
                );
                setRemoveOpen(false);
                return result;
              });
          }}
        >
          确认移入
        </FluidButton>
      </FluidDialog>
      {importOpen && (
        <ImportDialog
          client={client}
          collections={collections}
          onClose={() => setImportOpen(false)}
          onImported={(message) => {
            setMessage(message);
            refreshData();
          }}
        />
      )}
      <FluidDialog
        open={collectionOpen}
        onOpenChange={setCollectionOpen}
        title={renaming ? "重命名分类" : "新建分类"}
        description="分类用于整理笔记和限定检索范围。"
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void saveCollection();
          }}
        >
          <label className="field">
            分类名称
            <input
              className="fluid-field"
              value={collectionName}
              onChange={(event) => setCollectionName(event.target.value)}
              required
              maxLength={80}
            />
          </label>
          <FluidButton type="submit" disabled={busy}>
            保存分类
          </FluidButton>
        </form>
      </FluidDialog>
      {source && (
        <SourceDialog
          key={source.chunkId}
          source={source}
          client={client}
          onClose={() => setSource(null)}
        />
      )}
    </div>
  );
}
