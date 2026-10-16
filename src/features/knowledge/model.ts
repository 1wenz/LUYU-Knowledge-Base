export const collections = [
  { id: "product", name: "产品设计", color: "bg-amber-100 text-amber-700" },
  { id: "engineering", name: "技术笔记", color: "bg-blue-100 text-blue-700" },
  { id: "ideas", name: "灵感碎片", color: "bg-violet-100 text-violet-700" },
] as const;

export type CollectionId = (typeof collections)[number]["id"];
export type Note = {
  id: string;
  title: string;
  content: string;
  collectionId: CollectionId;
  tags: string[];
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
};

export type NoteDraft = Pick<Note, "title" | "content" | "collectionId" | "tags">;
export type NoteFilter = {
  view: "all" | "favorites" | "recent";
  collectionId?: CollectionId;
  tag?: string;
  query: string;
};

export function filterNotes(notes: readonly Note[], filter: NoteFilter) {
  const query = filter.query.trim().toLocaleLowerCase();
  return notes
    .filter((note) => {
      if (filter.view === "favorites" && !note.favorite) return false;
      if (filter.collectionId && note.collectionId !== filter.collectionId) return false;
      if (filter.tag && !note.tags.includes(filter.tag)) return false;
      return (
        !query ||
        [note.title, note.content, ...note.tags].join(" ").toLocaleLowerCase().includes(query)
      );
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function validateDraft(draft: NoteDraft) {
  if (!draft.title.trim()) throw new Error("请填写笔记标题。");
  if (draft.title.trim().length > 120) throw new Error("标题最多 120 个字符。");
  if (!collections.some((collection) => collection.id === draft.collectionId)) {
    throw new Error("请选择有效的分类。");
  }
  return {
    ...draft,
    title: draft.title.trim(),
    tags: [...new Set(draft.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 12),
  };
}

export function isNote(value: unknown): value is Note {
  if (typeof value !== "object" || value === null) return false;
  const note = value as Partial<Note>;
  return (
    typeof note.id === "string" &&
    note.id.length > 0 &&
    typeof note.title === "string" &&
    typeof note.content === "string" &&
    collections.some((collection) => collection.id === note.collectionId) &&
    Array.isArray(note.tags) &&
    note.tags.every((tag) => typeof tag === "string") &&
    typeof note.favorite === "boolean" &&
    typeof note.createdAt === "string" &&
    !Number.isNaN(Date.parse(note.createdAt)) &&
    typeof note.updatedAt === "string" &&
    !Number.isNaN(Date.parse(note.updatedAt))
  );
}
