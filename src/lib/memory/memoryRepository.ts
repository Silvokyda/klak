import type { MemoryRecord, MemoryType } from "../../types";
import { getDatabase } from "../db/database";
import { id, nowIso } from "../utils";

export interface MemoryInput {
  type: MemoryType;
  title: string;
  content: string;
  source?: string | null;
  confidence?: number;
  importance?: number;
  expires_at?: string | null;
}

export interface MemoryFilters {
  type?: MemoryType | "all";
  includeExpired?: boolean;
}

export async function createMemory(input: MemoryInput): Promise<MemoryRecord> {
  const db = await getDatabase();
  const timestamp = nowIso();
  const memory: MemoryRecord = {
    id: id("mem"),
    type: input.type,
    title: input.title,
    content: input.content,
    source: input.source ?? "manual",
    confidence: input.confidence ?? 1,
    importance: input.importance ?? 1,
    created_at: timestamp,
    updated_at: timestamp,
    last_used_at: null,
    expires_at: input.expires_at ?? null
  };
  await db.execute(
    `INSERT INTO memories (id, type, title, content, source, confidence, importance, created_at, updated_at, last_used_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      memory.id,
      memory.type,
      memory.title,
      memory.content,
      memory.source,
      memory.confidence,
      memory.importance,
      memory.created_at,
      memory.updated_at,
      memory.last_used_at ?? null,
      memory.expires_at ?? null
    ]
  );
  return memory;
}

export async function updateMemory(memoryId: string, input: Partial<MemoryInput>): Promise<MemoryRecord | null> {
  const existing = await getMemoryById(memoryId);
  if (!existing) return null;
  const updated: MemoryRecord = {
    ...existing,
    ...input,
    source: input.source ?? existing.source,
    confidence: input.confidence ?? existing.confidence,
    importance: input.importance ?? existing.importance,
    updated_at: nowIso()
  };
  const db = await getDatabase();
  await db.execute(
    `UPDATE memories
     SET type = ?, title = ?, content = ?, source = ?, confidence = ?, importance = ?, updated_at = ?, last_used_at = ?, expires_at = ?
     WHERE id = ?`,
    [
      updated.type,
      updated.title,
      updated.content,
      updated.source,
      updated.confidence,
      updated.importance,
      updated.updated_at,
      updated.last_used_at ?? null,
      updated.expires_at ?? null,
      memoryId
    ]
  );
  return updated;
}

export async function deleteMemory(memoryId: string): Promise<void> {
  const db = await getDatabase();
  await db.execute("DELETE FROM memories WHERE id = ?", [memoryId]);
}

export async function getMemoryById(memoryId: string): Promise<MemoryRecord | null> {
  const db = await getDatabase();
  const rows = await db.select<MemoryRecord>("SELECT * FROM memories WHERE id = ?", [memoryId]);
  return rows[0] ?? null;
}

export async function listMemories(filters: MemoryFilters | MemoryType | "all" = {}): Promise<MemoryRecord[]> {
  const normalized = typeof filters === "string" ? { type: filters } : filters;
  const db = await getDatabase();
  const rows =
    normalized.type && normalized.type !== "all"
      ? await db.select<MemoryRecord>("SELECT * FROM memories WHERE type = ? ORDER BY updated_at DESC", [normalized.type])
      : await db.select<MemoryRecord>("SELECT * FROM memories ORDER BY updated_at DESC");
  if (normalized.includeExpired) return rows;
  return rows.filter((memory) => !memory.expires_at || Date.parse(memory.expires_at) > Date.now());
}

export async function searchMemories(query: string, filters: MemoryFilters = {}): Promise<MemoryRecord[]> {
  const db = await getDatabase();
  const like = `%${query.trim()}%`;
  const rows = query.trim()
    ? await db.select<MemoryRecord>(
        `SELECT * FROM memories
         WHERE (title LIKE ? OR content LIKE ? OR source LIKE ? OR type LIKE ?)
         ORDER BY updated_at DESC`,
        [like, like, like, like]
      )
    : await listMemories(filters);
  return rows.filter((memory) => {
    const typeMatches = !filters.type || filters.type === "all" || memory.type === filters.type;
    const expiryMatches = filters.includeExpired || !memory.expires_at || Date.parse(memory.expires_at) > Date.now();
    return typeMatches && expiryMatches;
  });
}

export async function touchMemory(memoryId: string): Promise<void> {
  const db = await getDatabase();
  await db.execute("UPDATE memories SET last_used_at = ? WHERE id = ?", [nowIso(), memoryId]);
}
