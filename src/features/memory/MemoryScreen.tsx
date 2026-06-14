import {
  Database,
  FileText,
  Plus,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ScreenHeader } from "../../components/ScreenHeader";
import type { MemoryRecord, MemoryType } from "../../types";
import {
  createMemory,
  deleteMemory,
  listMemories,
  updateMemory
} from "../../lib/memory/memoryRepository";

const memoryTypes: Array<MemoryType | "all"> = [
  "all",
  "profile",
  "preference",
  "project",
  "workflow",
  "task",
  "document",
  "command_history"
];

const writableMemoryTypes: MemoryType[] = [
  "profile",
  "preference",
  "project",
  "workflow",
  "task",
  "document",
  "command_history"
];

const memoryTypeDescriptions: Record<MemoryType, string> = {
  profile: "Things about the user or local setup.",
  preference: "How Klak should behave for you.",
  project: "Context for a project or workspace.",
  workflow: "Notes about a routine or repeated flow.",
  task: "A task Klak should keep in context.",
  document: "Useful context from a local document.",
  command_history: "A record from an approved local action."
};

export function MemoryScreen() {
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [filter, setFilter] = useState<MemoryType | "all">("all");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState({
    type: "preference" as MemoryType,
    title: "",
    content: ""
  });
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    setMemories(await listMemories("all"));
  }

  useEffect(() => {
    void refresh();
  }, []);

  const filteredMemories = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    return memories.filter((memory) => {
      const matchesType = filter === "all" || memory.type === filter;

      if (!matchesType) return false;
      if (!normalized) return true;

      return [memory.title, memory.content, memory.type, memory.source]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [memories, filter, query]);

  const typeCounts = useMemo(() => {
    return memories.reduce<Record<string, number>>((counts, memory) => {
      counts[memory.type] = (counts[memory.type] ?? 0) + 1;
      return counts;
    }, {});
  }, [memories]);

  const manualCount = useMemo(() => {
    return memories.filter((memory) => memory.source === "manual").length;
  }, [memories]);

  async function create() {
    setMessage(null);

    if (!draft.title.trim() || !draft.content.trim()) {
      setMessage("Add a title and memory content before saving.");
      return;
    }

    await createMemory({
      type: draft.type,
      title: draft.title.trim(),
      content: draft.content.trim(),
      source: "manual"
    });

    setDraft((current) => ({ ...current, title: "", content: "" }));
    await refresh();
    setMessage("Memory saved locally.");
  }

  return (
    <div className="screen memory-screen">
      <ScreenHeader
        title="Memory"
        subtitle="A local vault for things Klak is allowed to remember. Nothing here is hidden from you."
      />

      <section className="memory-hero">
        <div className="memory-hero-copy">
          <span className="eyebrow">Local memory vault</span>
          <h3>Review, add, edit, or remove Klak’s saved context.</h3>
          <p>
            Memories are stored on this device and only help Klak understand your
            preferences, projects, routines, and approved local context.
          </p>
        </div>

        <div className="memory-hero-card">
          <ShieldCheck size={20} />
          <div>
            <strong>User controlled</strong>
            <span>No silent memory. No cloud sync. No hidden profile.</span>
          </div>
        </div>
      </section>

      <section className="memory-overview">
        <div className="memory-stat-card">
          <Database size={18} />
          <span>Total memories</span>
          <strong>{memories.length}</strong>
          <small>Saved on this device</small>
        </div>

        <div className="memory-stat-card">
          <FileText size={18} />
          <span>Current view</span>
          <strong>{filteredMemories.length}</strong>
          <small>
            {filter === "all"
              ? "Showing every type"
              : `${typeCounts[filter] ?? 0} saved as ${formatMemoryType(filter)}`}
          </small>
        </div>

        <div className="memory-stat-card">
          <SlidersHorizontal size={18} />
          <span>Control</span>
          <strong>{manualCount}</strong>
          <small>Manual memories you added</small>
        </div>
      </section>

      <section className="memory-controls">
        <div className="memory-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search saved local context"
          />
        </div>

        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as MemoryType | "all")}
          aria-label="Filter memories"
        >
          {memoryTypes.map((type) => (
            <option key={type} value={type}>
              {formatMemoryType(type)}
            </option>
          ))}
        </select>
      </section>

      <div className="memory-layout">
        <section className="memory-create-card">
          <div>
            <span className="eyebrow">New memory</span>
            <h3>Save approved context</h3>
            <p className="muted">
              Use this for preferences, project notes, recurring routines, or
              details you want Klak to remember locally.
            </p>
          </div>

          <label className="field-stack">
            <span>Memory type</span>
            <select
              value={draft.type}
              onChange={(event) =>
                setDraft({ ...draft, type: event.target.value as MemoryType })
              }
            >
              {writableMemoryTypes.map((type) => (
                <option key={type} value={type}>
                  {formatMemoryType(type)}
                </option>
              ))}
            </select>
            <small>{memoryTypeDescriptions[draft.type]}</small>
          </label>

          <label className="field-stack">
            <span>Title</span>
            <input
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="Example: Preferred project folder"
            />
          </label>

          <label className="field-stack">
            <span>Memory content</span>
            <textarea
              value={draft.content}
              onChange={(event) =>
                setDraft({ ...draft, content: event.target.value })
              }
              placeholder="What should Klak remember?"
            />
          </label>

          <button className="primary" onClick={create}>
            <Plus size={16} /> Save memory
          </button>

          {message && <p className="inline-status">{message}</p>}
        </section>

        <section className="memory-list-panel">
          <div className="memory-list-header">
            <div>
              <h3>Saved memories</h3>
              <p className="muted">
                {filteredMemories.length} visible{" "}
                {filteredMemories.length === 1 ? "memory" : "memories"}
              </p>
            </div>
          </div>

          {filteredMemories.length === 0 ? (
            <div className="memory-empty-state">
              <strong>No memories found</strong>
              <p>Save a memory, change the filter, or clear your search.</p>
            </div>
          ) : (
            <div className="memory-card-list">
              {filteredMemories.map((memory) => (
                <MemoryCard key={memory.id} memory={memory} onRefresh={refresh} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function MemoryCard({
  memory,
  onRefresh
}: {
  memory: MemoryRecord;
  onRefresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [title, setTitle] = useState(memory.title);
  const [content, setContent] = useState(memory.content);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setMessage(null);

    if (!title.trim() || !content.trim()) {
      setMessage("Title and content cannot be empty.");
      return;
    }

    await updateMemory(memory.id, {
      title: title.trim(),
      content: content.trim()
    });

    setEditing(false);
    await onRefresh();
  }

  async function remove() {
    const confirmed = window.confirm(
      "Delete this memory? Klak will no longer use it as local context."
    );

    if (!confirmed) return;

    await deleteMemory(memory.id);
    await onRefresh();
  }

  return (
    <article className="memory-card">
      <div className="memory-card-header">
        <div className="memory-card-title">
          <span className="tag">{formatMemoryType(memory.type)}</span>
          <h4>{memory.title}</h4>
          <p>{memoryTypeDescriptions[memory.type]}</p>
        </div>

        <div className="memory-card-actions">
          <button onClick={() => setShowDetails((value) => !value)}>
            {showDetails ? "Hide details" : "Details"}
          </button>
          <button
            onClick={() => {
              setEditing((value) => !value);
              setMessage(null);
              setTitle(memory.title);
              setContent(memory.content);
            }}
          >
            {editing ? "Cancel" : "Edit"}
          </button>
          <button title="Delete memory" className="danger-button" onClick={remove}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {editing ? (
        <div className="memory-edit-form">
          <label className="field-stack">
            <span>Title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>

          <label className="field-stack">
            <span>Memory content</span>
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
          </label>

          <button className="primary" onClick={save}>
            <Save size={16} /> Save changes
          </button>

          {message && <p className="inline-status">{message}</p>}
        </div>
      ) : (
        <p className="memory-content">{memory.content}</p>
      )}

      {showDetails && (
        <div className="memory-details">
          <div>
            <span className="detail-label">Source</span>
            <strong>{formatMemorySource(memory.source)}</strong>
          </div>

          <div>
            <span className="detail-label">Importance</span>
            <strong>{memory.importance}</strong>
          </div>

          <div>
            <span className="detail-label">Storage</span>
            <strong>Local device</strong>
          </div>
        </div>
      )}
    </article>
  );
}

function formatMemoryType(type: MemoryType | "all"): string {
  if (type === "all") return "All";

  const labels: Record<MemoryType, string> = {
    profile: "Profile",
    preference: "Preference",
    project: "Project note",
    workflow: "Routine note",
    task: "Task note",
    document: "Document note",
    command_history: "Action history"
  };

  return labels[type];
}

function formatMemorySource(source: string): string {
  if (source === "manual") return "Added by you";

  return source
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}