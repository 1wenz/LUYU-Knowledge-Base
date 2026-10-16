"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  BookOpen,
  Clock3,
  FileText,
  Folder,
  Heart,
  Lightbulb,
  PanelLeft,
  PenLine,
  Plus,
  Search,
  Sparkles,
  Star,
  Tag,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { DesktopInfo } from "@/lib/desktop";
import { NoteEditor } from "./note-editor";
import { collections, filterNotes, type CollectionId, type Note, type NoteFilter } from "./model";
import { noteRepository } from "./repository";

const collectionIcons: Record<CollectionId, typeof Folder> = {
  product: Folder,
  engineering: FileText,
  ideas: Lightbulb,
};

function dateLabel(date: string, full = false) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    ...(full ? { year: "numeric" as const } : {}),
    month: "numeric",
    day: "numeric",
  }).format(new Date(date));
}

export function KnowledgeWorkspace() {
  const snapshot = useSyncExternalStore(
    noteRepository.subscribe,
    noteRepository.getSnapshot,
    noteRepository.getServerSnapshot,
  );
  const [filter, setFilter] = useState<NoteFilter>({ view: "all", query: "" });
  const [selectedId, setSelectedId] = useState("welcome");
  const [editor, setEditor] = useState<"new" | Note | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopInfo, setDesktopInfo] = useState<DesktopInfo | null>(null);
  const [message, setMessage] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const canWrite = snapshot.ready && !snapshot.blocked;
  const notes = useMemo(() => filterNotes(snapshot.notes, filter), [filter, snapshot.notes]);
  const selected = notes.find((note) => note.id === selectedId) ?? notes[0] ?? null;
  const allTags = [...new Set(snapshot.notes.flatMap((note) => note.tags))];

  useEffect(() => {
    window.desktop
      ?.getInfo()
      .then(setDesktopInfo)
      .catch(() => undefined);
    function shortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 3500);
    return () => window.clearTimeout(timer);
  }, [message]);

  function chooseView(view: NoteFilter["view"]) {
    setFilter((current) => ({ ...current, view, collectionId: undefined, tag: undefined }));
    setSidebarOpen(false);
  }

  function chooseCollection(collectionId: CollectionId) {
    setFilter((current) => ({ ...current, view: "all", collectionId, tag: undefined }));
    setSidebarOpen(false);
  }

  function chooseTag(tag: string) {
    setFilter((current) => ({ ...current, tag: current.tag === tag ? undefined : tag }));
  }

  function saveNote(draft: Parameters<typeof noteRepository.save>[0], id?: string) {
    const savedId = noteRepository.save(draft, id);
    setFilter({ view: "all", query: "" });
    setSelectedId(savedId);
    setMessage(id ? "笔记已更新" : "笔记已创建");
  }

  function action(run: () => void) {
    try {
      run();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败，请重试。");
    }
  }

  function removeNote(note: Note) {
    if (!window.confirm("确定删除“" + note.title + "”吗？")) return;
    action(() => {
      noteRepository.remove(note.id);
      setMessage("笔记已删除");
    });
  }

  const activeCollection = collections.find((item) => item.id === filter.collectionId);
  const activeLabel =
    activeCollection?.name ??
    (filter.view === "favorites" ? "我的收藏" : filter.view === "recent" ? "最近编辑" : "全部笔记");

  return (
    <div className="flex h-dvh min-h-[560px] overflow-hidden bg-muted/30 text-foreground">
      {sidebarOpen && (
        <button
          aria-label="关闭导航"
          className="fixed inset-0 z-20 bg-black/30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        aria-label="工作区导航"
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-60 shrink-0 flex-col border-r bg-card transition-transform lg:static lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-20 shrink-0 items-center gap-3 px-6">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <BookOpen className="size-5" />
          </div>
          <div>
            <p className="text-xl font-semibold tracking-wider">知屿</p>
            <p className="text-[10px] tracking-[0.15em] text-muted-foreground">KNOWLEDGE BASE</p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="收起侧栏"
          >
            <PanelLeft />
          </Button>
        </div>
        <div className="px-5">
          <Button
            disabled={!canWrite}
            className="h-10 w-full gap-2 shadow-sm"
            onClick={() => setEditor("new")}
          >
            <Plus />
            新建笔记
          </Button>
        </div>
        <nav className="flex-1 space-y-7 overflow-y-auto px-3 py-7">
          <div className="space-y-1">
            <p className="px-3 pb-2 text-[11px] font-semibold tracking-widest text-muted-foreground">
              工作区
            </p>
            <Button
              variant="ghost"
              aria-pressed={filter.view === "all" && !filter.collectionId}
              className={cn(
                "h-10 w-full justify-start gap-3 font-normal",
                filter.view === "all" &&
                  !filter.collectionId &&
                  "bg-accent font-medium text-accent-foreground",
              )}
              onClick={() => chooseView("all")}
            >
              <FileText className="text-muted-foreground" />
              全部笔记
              <span className="ml-auto text-xs text-muted-foreground">{snapshot.notes.length}</span>
            </Button>
            <Button
              variant="ghost"
              aria-pressed={filter.view === "recent"}
              className={cn(
                "h-10 w-full justify-start gap-3 font-normal",
                filter.view === "recent" && "bg-accent font-medium text-accent-foreground",
              )}
              onClick={() => chooseView("recent")}
            >
              <Clock3 className="text-muted-foreground" />
              最近编辑
            </Button>
            <Button
              variant="ghost"
              aria-pressed={filter.view === "favorites"}
              className={cn(
                "h-10 w-full justify-start gap-3 font-normal",
                filter.view === "favorites" && "bg-accent font-medium text-accent-foreground",
              )}
              onClick={() => chooseView("favorites")}
            >
              <Heart className="text-muted-foreground" />
              我的收藏
              <span className="ml-auto text-xs text-muted-foreground">
                {snapshot.notes.filter((note) => note.favorite).length}
              </span>
            </Button>
          </div>
          <div className="space-y-1">
            <p className="px-3 pb-2 text-[11px] font-semibold tracking-widest text-muted-foreground">
              知识分类
            </p>
            {collections.map((collection) => {
              const Icon = collectionIcons[collection.id];
              return (
                <Button
                  key={collection.id}
                  variant="ghost"
                  aria-pressed={filter.collectionId === collection.id}
                  className={cn(
                    "h-10 w-full justify-start gap-3 font-normal",
                    filter.collectionId === collection.id &&
                      "bg-accent font-medium text-accent-foreground",
                  )}
                  onClick={() => chooseCollection(collection.id)}
                >
                  <Icon className="text-muted-foreground" />
                  {collection.name}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {snapshot.notes.filter((note) => note.collectionId === collection.id).length}
                  </span>
                </Button>
              );
            })}
          </div>
          <div className="space-y-3 px-3">
            <p className="text-[11px] font-semibold tracking-widest text-muted-foreground">
              常用标签
            </p>
            <div className="flex flex-wrap gap-1.5">
              {allTags.slice(0, 8).map((tag) => (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={filter.tag === tag}
                  onClick={() => chooseTag(tag)}
                  className={cn(
                    "rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent",
                    filter.tag === tag && "bg-primary text-primary-foreground",
                  )}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        </nav>
        <div className="border-t p-5">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <Sparkles className="size-4" />
            </div>
            <div>
              <p className="text-sm font-medium">本地优先 · 安心记录</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {desktopInfo ? "桌面工作区 · v" + desktopInfo.version : "数据保存在当前设备"}
              </p>
            </div>
          </div>
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-20 shrink-0 items-center gap-4 border-b bg-card px-5 sm:px-8">
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="打开导航"
          >
            <PanelLeft />
          </Button>
          <div className="relative max-w-xl flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={filter.query}
              onChange={(event) =>
                setFilter((current) => ({ ...current, query: event.target.value }))
              }
              placeholder="搜索笔记、标签和内容…"
              className="h-10 border-0 bg-muted/70 pl-9 pr-20 shadow-none focus-visible:ring-1"
              aria-label="搜索笔记"
            />
            <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">
              Ctrl K
            </kbd>
          </div>
          <span className="ml-auto hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
            <span
              className={cn("size-1.5 rounded-full", canWrite ? "bg-emerald-500" : "bg-amber-500")}
            />
            {snapshot.blocked ? "存储异常" : snapshot.ready ? "本地存储已就绪" : "读取中"}
          </span>
        </header>
        <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
          <section
            aria-label="笔记列表"
            className="flex max-h-[40vh] min-h-0 w-full flex-col border-b xl:max-h-none xl:w-[340px] xl:shrink-0 xl:border-r xl:border-b-0 2xl:w-[380px]"
          >
            <div className="flex items-center justify-between px-6 pt-6 pb-3">
              <div>
                <p className="text-[11px] tracking-wider text-muted-foreground">
                  你的知识，持续生长
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight">{activeLabel}</h1>
              </div>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={!canWrite}
                onClick={() => setEditor("new")}
                aria-label="添加笔记"
              >
                <Plus />
              </Button>
            </div>
            <div className="flex shrink-0 items-center gap-2 px-6 pb-4">
              <Badge variant="secondary" className="rounded-md font-normal">
                {notes.length} 条笔记
              </Badge>
              {filter.tag && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setFilter((current) => ({ ...current, tag: undefined }))}
                >
                  #{filter.tag} ×
                </Button>
              )}
            </div>
            {snapshot.error && (
              <p
                role="alert"
                className="mx-5 mb-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs leading-5 text-destructive"
              >
                {snapshot.error}
              </p>
            )}
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-5">
              {snapshot.ready && !notes.length && (
                <div className="rounded-xl border border-dashed p-6 text-center">
                  <Search className="mx-auto size-6 text-muted-foreground" />
                  <p className="mt-3 text-sm font-medium">没有找到笔记</p>
                  <p className="mt-1 text-xs text-muted-foreground">换个关键词，或记录新的想法。</p>
                </div>
              )}
              {notes.map((note) => {
                const collection = collections.find((item) => item.id === note.collectionId)!;
                return (
                  <button
                    key={note.id}
                    type="button"
                    aria-pressed={selected?.id === note.id}
                    onClick={() => setSelectedId(note.id)}
                    className={cn(
                      "group w-full rounded-xl border border-transparent px-3.5 py-3.5 text-left transition-colors hover:bg-muted/80",
                      selected?.id === note.id && "border-border bg-card shadow-sm",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="line-clamp-1 text-sm font-medium">{note.title}</span>
                      {note.favorite && (
                        <Star className="mt-0.5 size-3.5 shrink-0 fill-amber-400 text-amber-400" />
                      )}
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                      {note.content.replaceAll("\n", " ")}
                    </p>
                    <div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span className={cn("rounded px-1.5 py-0.5", collection.color)}>
                        {collection.name}
                      </span>
                      <span className="ml-auto">{dateLabel(note.updatedAt)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
          <section
            aria-label="笔记详情"
            className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-background"
          >
            {selected ? (
              <article className="mx-auto max-w-3xl px-6 py-8 sm:px-10 sm:py-10 2xl:py-14">
                <div className="flex items-center justify-between gap-3">
                  <Badge variant="outline" className="gap-1.5 rounded-md bg-card font-normal">
                    <Tag className="size-3" />
                    {collections.find((item) => item.id === selected.collectionId)?.name}
                  </Badge>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={!canWrite}
                      onClick={() => action(() => noteRepository.toggleFavorite(selected.id))}
                      aria-label={selected.favorite ? "取消收藏" : "收藏笔记"}
                    >
                      <Star
                        className={cn(
                          "size-4",
                          selected.favorite && "fill-amber-400 text-amber-400",
                        )}
                      />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={!canWrite}
                      onClick={() => setEditor(selected)}
                      aria-label="编辑笔记"
                    >
                      <PenLine />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={!canWrite}
                      onClick={() => removeNote(selected)}
                      aria-label="删除笔记"
                    >
                      <Trash2 className="text-muted-foreground" />
                    </Button>
                  </div>
                </div>
                <h2 className="mt-7 text-3xl leading-snug font-semibold tracking-tight sm:text-[34px]">
                  {selected.title}
                </h2>
                <p className="mt-3 text-xs text-muted-foreground">
                  更新于 {dateLabel(selected.updatedAt, true)} · {selected.content.length} 字
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {selected.tags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => chooseTag(tag)}
                      className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
                    >
                      #{tag}
                    </button>
                  ))}
                </div>
                <Separator className="my-8" />
                <div className="whitespace-pre-wrap break-words text-[15px] leading-8 text-foreground/85">
                  {selected.content || (
                    <span className="text-muted-foreground">还没有内容，记录第一个想法吧。</span>
                  )}
                </div>
                <div className="mt-12 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-4 text-xs text-muted-foreground">
                  <span>创建于 {dateLabel(selected.createdAt, true)}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!canWrite}
                    onClick={() => setEditor(selected)}
                  >
                    <PenLine className="size-3.5" />
                    继续编辑
                  </Button>
                </div>
              </article>
            ) : (
              <div className="flex h-full min-h-48 items-center justify-center p-8 text-center text-muted-foreground">
                <div>
                  <BookOpen className="mx-auto size-8" />
                  <p className="mt-3 text-sm">新的知识，从一条笔记开始</p>
                  <Button className="mt-5" disabled={!canWrite} onClick={() => setEditor("new")}>
                    <Plus />
                    新建笔记
                  </Button>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
      {editor && (
        <NoteEditor
          note={editor === "new" ? undefined : editor}
          initialCollection={filter.collectionId ?? "ideas"}
          onClose={() => setEditor(null)}
          onSave={saveNote}
        />
      )}
      {message && (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 rounded-full bg-foreground px-5 py-2.5 text-sm text-background shadow-lg"
        >
          {message}
        </div>
      )}
    </div>
  );
}
