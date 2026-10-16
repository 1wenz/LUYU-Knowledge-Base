"use client";

import { isNote, validateDraft, type Note, type NoteDraft } from "./model";
import { seedNotes } from "./seed";

export const storageKey = "zhiyu:notes:v1";
export type NoteSnapshot = {
  notes: readonly Note[];
  ready: boolean;
  error: string | null;
  blocked: boolean;
};

export interface NoteRepository {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => NoteSnapshot;
  getServerSnapshot: () => NoteSnapshot;
  save: (draft: NoteDraft, id?: string) => string;
  toggleFavorite: (id: string) => void;
  remove: (id: string) => void;
}

const serverSnapshot: NoteSnapshot = {
  notes: seedNotes,
  ready: false,
  error: null,
  blocked: false,
};

export type StorageEnvironment = {
  getStorage: () => Pick<Storage, "getItem" | "setItem">;
  onStorageChange: (reload: () => void) => () => void;
};

const browserEnvironment: StorageEnvironment = {
  getStorage: () => window.localStorage,
  onStorageChange(reload) {
    const handler = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) reload();
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  },
};

export function createBrowserRepository(
  environment: StorageEnvironment = browserEnvironment,
): NoteRepository {
  let snapshot = serverSnapshot;
  const listeners = new Set<() => void>();
  let unsubscribeStorage: (() => void) | undefined;

  function emit() {
    for (const listener of listeners) listener();
  }

  function load() {
    try {
      const stored = environment.getStorage().getItem(storageKey);
      let notes = seedNotes;
      if (stored !== null) {
        const data: unknown = JSON.parse(stored);
        if (
          typeof data !== "object" ||
          data === null ||
          !("version" in data) ||
          data.version !== 1 ||
          !("notes" in data) ||
          !Array.isArray(data.notes) ||
          !data.notes.every(isNote) ||
          new Set(data.notes.map((note: Note) => note.id)).size !== data.notes.length
        )
          throw new Error("本地数据格式无效。");
        notes = data.notes;
      }
      snapshot = { notes, ready: true, error: null, blocked: false };
    } catch {
      snapshot = {
        notes: seedNotes,
        ready: true,
        blocked: true,
        error: "本地数据无法读取，已暂时显示示例笔记。请先备份本地数据，写入已暂停。",
      };
    }
    emit();
  }

  function persist(notes: Note[]) {
    if (!snapshot.ready || snapshot.blocked) throw new Error("本地存储尚未就绪，无法保存。");
    try {
      environment.getStorage().setItem(storageKey, JSON.stringify({ version: 1, notes }));
      snapshot = { notes, ready: true, error: null, blocked: false };
      emit();
    } catch {
      throw new Error("保存失败，请检查设备存储空间或浏览器存储权限。");
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        unsubscribeStorage = environment.onStorageChange(load);
        load();
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) unsubscribeStorage?.();
      };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => serverSnapshot,
    save(draft, id) {
      const normalized = validateDraft(draft);
      const now = new Date().toISOString();
      const existing = id ? snapshot.notes.find((note) => note.id === id) : undefined;
      if (id && !existing) throw new Error("这条笔记已不存在。");
      const note: Note = {
        ...normalized,
        id: existing?.id ?? crypto.randomUUID(),
        favorite: existing?.favorite ?? false,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      persist([note, ...snapshot.notes.filter((item) => item.id !== note.id)]);
      return note.id;
    },
    toggleFavorite(id) {
      if (!snapshot.notes.some((note) => note.id === id)) throw new Error("这条笔记已不存在。");
      persist(
        snapshot.notes.map((note) =>
          note.id === id ? { ...note, favorite: !note.favorite } : note,
        ),
      );
    },
    remove(id) {
      persist(snapshot.notes.filter((note) => note.id !== id));
    },
  };
}

export const noteRepository = createBrowserRepository();
