"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { BookOpen, Database, FileText, Menu, Search, Settings2, Sparkles } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { ChatMessage } from "@/components/ui/chat-message";
import { FluidButton } from "@/components/ui/fluid-button";
import { FluidDialog } from "@/components/ui/fluid-dialog";
import { InputMessage } from "@/components/ui/input-message";
import { FluidSidebar, FluidSidebarMenu, type SidebarItem } from "@/components/ui/fluid-sidebar";

type Theme = "system" | "light" | "dark";
const previewItems: SidebarItem[] = [
  { id: "notes", label: "全部笔记", icon: FileText },
  { id: "search", label: "来源检索", icon: Database },
  { id: "assistant", label: "知识助手", icon: Sparkles },
];

function applyAppearance(theme: Theme, reduceMotion: boolean) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
  root.dataset.reduceMotion = reduceMotion ? "true" : "false";
}

export function DesignPreview() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("system");
  const [reduceMotion, setReduceMotion] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedView, setSelectedView] = useState("notes");
  const [question, setQuestion] = useState("");
  const [sent, setSent] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const sidebarTriggerRef = useRef<HTMLButtonElement>(null);
  const appearanceTriggerRef = useRef<HTMLButtonElement>(null);
  const appearanceReturnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const previous = {
      dark: root.classList.contains("dark"),
      light: root.classList.contains("light"),
      motion: root.getAttribute("data-reduce-motion"),
    };
    return () => {
      root.classList.toggle("dark", previous.dark);
      root.classList.toggle("light", previous.light);
      if (previous.motion === null) root.removeAttribute("data-reduce-motion");
      else root.setAttribute("data-reduce-motion", previous.motion);
    };
  }, []);

  useEffect(() => {
    applyAppearance(theme, reduceMotion);
  }, [theme, reduceMotion]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        appearanceReturnFocus.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : appearanceTriggerRef.current;
        setAppearanceOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function closeSidebar() {
    setSidebarOpen(false);
    requestAnimationFrame(() => sidebarTriggerRef.current?.focus());
  }

  function closeAppearance() {
    setAppearanceOpen(false);
    requestAnimationFrame(() =>
      (appearanceReturnFocus.current ?? appearanceTriggerRef.current)?.focus(),
    );
  }

  function openAppearance() {
    appearanceReturnFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : appearanceTriggerRef.current;
    setAppearanceOpen(true);
  }

  function sendQuestion(value: string) {
    setSent((current) => [...current, value]);
    setQuestion("");
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <a href="#preview-main" className="skip-link">
        跳到主要内容
      </a>
      <div className="mx-auto flex min-h-dvh max-w-[1440px]">
        <FluidSidebar
          footer={
            <FluidButton variant="secondary" className="w-full" onClick={openAppearance}>
              <Settings2 aria-hidden="true" />
              更多外观选项
            </FluidButton>
          }
        >
          <BrandMark size={32} className="text-primary" />
          <p className="mt-3 text-xl font-semibold">知屿</p>
          <p className="text-xs tracking-[0.18em] text-muted-foreground">KNOWLEDGE BASE</p>
          <div className="mt-9">
            <FluidSidebarMenu
              items={previewItems}
              selectedId={selectedView}
              onSelect={setSelectedView}
            />
          </div>
        </FluidSidebar>

        <main id="preview-main" className="flex min-w-0 flex-1 flex-col">
          <header className="flex min-h-16 flex-wrap items-center gap-3 border-b bg-card px-4 py-3 sm:px-6">
            <button
              ref={sidebarTriggerRef}
              type="button"
              className="inline-flex size-9 items-center justify-center rounded-md hover:bg-secondary min-[1180px]:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="打开导航"
            >
              <Menu aria-hidden="true" />
            </button>
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <BookOpen className="size-5 shrink-0 text-primary" aria-hidden="true" />
              <h1 className="truncate text-lg font-semibold">让知识，有迹可循</h1>
            </div>
            <form
              onSubmit={submitSearch}
              className="order-last flex w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 sm:order-none sm:w-52"
            >
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                placeholder="搜索…"
                aria-label="搜索输入样例"
              />
              <kbd className="hidden text-xs text-muted-foreground xl:block">Ctrl K</kbd>
            </form>
            <FluidButton ref={appearanceTriggerRef} variant="tertiary" onClick={openAppearance}>
              <Settings2 aria-hidden="true" />
              外观样例
            </FluidButton>
          </header>
          <p className="border-b px-4 py-2 text-xs text-muted-foreground sm:px-6">
            设计预览 · 以下资料与检索状态均为静态样例；输入只在当前页面展示。
          </p>

          <div className="grid min-h-0 flex-1 grid-cols-1 min-[1180px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <section
              aria-labelledby="source-title"
              className="hidden min-w-0 border-r p-6 min-[1180px]:block"
            >
              <p className="text-sm text-muted-foreground">今日工作区</p>
              <h2 id="source-title" className="mt-2 text-2xl font-semibold">
                搜索来源
              </h2>
              <div className="mt-6 space-y-3">
                <article className="rounded-xl border bg-card p-4">
                  <p className="text-sm font-medium">研究笔记 · 本地优先</p>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                    数据保存在你管理的 PostgreSQL 中，关键词与语义检索共同工作。
                  </p>
                  <p className="mt-3 text-xs text-muted-foreground">第 3–7 行 · 关键词 + 向量</p>
                </article>
                <article className="rounded-xl border bg-card p-4">
                  <p className="text-sm font-medium">设计原则与状态</p>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                    检索来源先于回答显示，索引和降级状态始终可见。
                  </p>
                  <p className="mt-3 text-xs text-muted-foreground">第 12–18 行 · Rerank 已启用</p>
                </article>
              </div>
            </section>

            <section
              aria-labelledby="assistant-title"
              className="flex min-w-0 flex-col p-4 sm:p-6 lg:p-8"
            >
              <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
                <p className="text-sm text-muted-foreground">知识助手</p>
                <h2 id="assistant-title" className="mt-2 text-2xl font-semibold">
                  把问题交给你的资料
                </h2>
                <div
                  className="mt-6 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pb-6"
                  aria-live="polite"
                >
                  <ChatMessage from="assistant">
                    我会先展示检索到的来源，再根据它们回答。试着问一个和笔记有关的问题。
                  </ChatMessage>
                  {sent.map((message, index) => (
                    <ChatMessage key={`${message}-${index}`} from="user">
                      {message}
                    </ChatMessage>
                  ))}
                  {sent.length > 0 && (
                    <div className="rounded-lg border border-dashed p-3">
                      <p className="text-xs text-muted-foreground">本轮来源</p>
                      <p className="mt-1 text-sm">研究笔记 · 第 3–7 行</p>
                    </div>
                  )}
                </div>
                <div className="mt-auto pt-2">
                  <InputMessage
                    value={question}
                    onValueChange={setQuestion}
                    onSend={sendQuestion}
                    placeholder="向知识库提一个问题…"
                    sendLabel="发送样例"
                    textareaProps={{ "aria-label": "问题输入样例" }}
                  />
                  <p className="mt-3 text-center text-xs text-muted-foreground">
                    <span role="status">已发送 {sent.length} 条样例</span>
                    <span> · 仅用于展示交互状态</span>
                  </p>
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>

      <FluidDialog
        open={sidebarOpen}
        onOpenChange={(open) => (open ? setSidebarOpen(true) : closeSidebar())}
        title="工作区导航"
        description="在笔记、来源和助手之间切换。"
        drawer
      >
        <FluidSidebarMenu
          items={previewItems}
          selectedId={selectedView}
          label="移动工作区导航"
          onSelect={(id) => {
            setSelectedView(id);
            closeSidebar();
          }}
        />
      </FluidDialog>

      <FluidDialog
        open={appearanceOpen}
        onOpenChange={(open) => (open ? setAppearanceOpen(true) : closeAppearance())}
        title="外观与动态效果样例"
        description="主题和动效设置会立即应用到界面。"
      >
        <div className="space-y-5">
          <div className="grid gap-2 text-sm font-medium">
            <label htmlFor="preview-theme">主题样例</label>
            <select
              id="preview-theme"
              value={theme}
              onChange={(event) => setTheme(event.target.value as Theme)}
              className="h-10 rounded-md border-2 bg-background px-3 font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </div>
          <label
            className="flex min-h-10 items-center gap-3 text-sm font-medium"
            htmlFor="preview-reduce-motion"
          >
            <input
              id="preview-reduce-motion"
              type="checkbox"
              checked={reduceMotion}
              onChange={(event) => setReduceMotion(event.target.checked)}
              className="size-4 accent-[var(--primary)]"
            />
            减少动态效果样例
          </label>
          <div className="flex justify-end">
            <FluidButton onClick={closeAppearance}>完成</FluidButton>
          </div>
        </div>
      </FluidDialog>
    </div>
  );
}
