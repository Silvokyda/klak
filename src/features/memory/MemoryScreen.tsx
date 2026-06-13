import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ScreenHeader } from "../../components/ScreenHeader";
import type { MemoryRecord, MemoryType } from "../../types";
import { createMemory, deleteMemory, listMemories, updateMemory } from "../../lib/memory/memoryRepository";

const memoryTypes: Array<MemoryType | "all"> = ["all", "profile", "preference", "project", "workflow", "task", "document", "command_history"];

export function MemoryScreen() {
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [filter, setFilter] = useState<MemoryType | "all">("all");
  const [draft, setDraft] = useState({ type: "preference" as MemoryType, title: "", content: "" });

  async function refresh() {
    setMemories(await listMemories(filter));
  }

  useEffect(() => {
    void refresh();
  }, [filter]);

  async function create() {
    if (!draft.title.trim() || !draft.content.trim()) return;
    await createMemory({ ...draft, source: "manual" });
    setDraft({ ...draft, title: "", content: "" });
    await refresh();
  }

  return (
    <div className="screen">
      <ScreenHeader title="Memory" subtitle="Local memories are explicit, editable, and deletable." />
      <section className="toolbar">
        <select value={filter} onChange={(event) => setFilter(event.target.value as MemoryType | "all")}>
          {memoryTypes.map((type) => <option key={type} value={type}>{type.replace(/_/g, " ")}</option>)}
        </select>
      </section>
      <section className="editor">
        <select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as MemoryType })}>
          {memoryTypes.filter((type) => type !== "all").map((type) => <option key={type} value={type}>{type.replace(/_/g, " ")}</option>)}
        </select>
        <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Title" />
        <textarea value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} placeholder="Memory content" />
        <button className="primary" onClick={create}><Plus size={16} /> Create memory</button>
      </section>
      <section className="list">
        {memories.map((memory) => (
          <article className="list-row" key={memory.id}>
            <div>
              <span className="tag">{memory.type}</span>
              <input value={memory.title} onChange={(event) => updateMemory(memory.id, { title: event.target.value }).then(refresh)} />
              <textarea value={memory.content} onChange={(event) => updateMemory(memory.id, { content: event.target.value }).then(refresh)} />
              <small>Source: {memory.source} · Importance: {memory.importance}</small>
            </div>
            <button title="Delete memory" onClick={() => deleteMemory(memory.id).then(refresh)}><Trash2 size={16} /></button>
          </article>
        ))}
      </section>
    </div>
  );
}
