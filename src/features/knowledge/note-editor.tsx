"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { collections, type CollectionId, type Note, type NoteDraft } from "./model";

type Props = {
  note?: Note;
  initialCollection: CollectionId;
  onClose: () => void;
  onSave: (draft: NoteDraft, id?: string) => void;
};

export function NoteEditor({ note, initialCollection, onClose, onSave }: Props) {
  const [title, setTitle] = useState(note?.title ?? "");
  const [content, setContent] = useState(note?.content ?? "");
  const [collectionId, setCollectionId] = useState<CollectionId>(
    note?.collectionId ?? initialCollection,
  );
  const [tags, setTags] = useState(note?.tags.join("，") ?? "");
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      onSave({ title, content, collectionId, tags: tags.split(/[,，]/) }, note?.id);
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : "保存失败，请重试。");
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{note ? "编辑笔记" : "新建笔记"}</DialogTitle>
          <DialogDescription>记录你的发现，让想法在这里慢慢生长。</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-2">
            <label htmlFor="note-title" className="text-sm font-medium">
              标题
            </label>
            <Input
              id="note-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="给这条笔记一个名字"
              maxLength={120}
              required
              autoFocus
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="note-collection" className="text-sm font-medium">
                分类
              </label>
              <select
                id="note-collection"
                value={collectionId}
                onChange={(event) => setCollectionId(event.target.value as CollectionId)}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {collections.map((collection) => (
                  <option key={collection.id} value={collection.id}>
                    {collection.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="note-tags" className="text-sm font-medium">
                标签
              </label>
              <Input
                id="note-tags"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="用逗号分隔，例如：阅读，灵感"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label htmlFor="note-content" className="text-sm font-medium">
              内容
            </label>
            <Textarea
              id="note-content"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="从一个想法、一段摘录或一个问题开始…"
              className="min-h-64 resize-y leading-7"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit">保存笔记</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
