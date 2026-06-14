import type { RegisteredAppRecord, RegisteredAppType } from "../../types";
import { getDatabase } from "../db/database";
import { id, nowIso } from "../utils";

export const blockedShellAppNames = new Set(["powershell.exe", "cmd.exe", "wt.exe", "windowsterminal.exe", "bash.exe", "wsl.exe"]);

export interface RegisteredAppInput {
  name: string;
  executable_path: string;
  app_type?: RegisteredAppType;
  description?: string | null;
  allowed?: boolean;
}

export interface RegisteredAppFilters {
  allowed?: boolean;
}

export async function createRegisteredApp(input: RegisteredAppInput): Promise<RegisteredAppRecord> {
  validateRegisteredAppInput(input);
  const db = await getDatabase();
  const timestamp = nowIso();
  const app: RegisteredAppRecord = {
    id: id("app"),
    name: input.name.trim(),
    executable_path: input.executable_path.trim(),
    app_type: input.app_type ?? "other",
    description: input.description ?? null,
    allowed: input.allowed ?? true,
    created_at: timestamp,
    updated_at: timestamp,
    last_launched_at: null
  };
  await db.execute(
    `INSERT INTO registered_apps (id, name, executable_path, app_type, description, allowed, created_at, updated_at, last_launched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [app.id, app.name, app.executable_path, app.app_type, app.description ?? null, app.allowed ? 1 : 0, app.created_at, app.updated_at, app.last_launched_at ?? null]
  );
  return app;
}

export async function updateRegisteredApp(appId: string, input: Partial<RegisteredAppInput>): Promise<RegisteredAppRecord | null> {
  const existing = await getRegisteredAppById(appId);
  if (!existing) return null;
  const updated: RegisteredAppRecord = {
    ...existing,
    ...input,
    executable_path: input.executable_path ?? existing.executable_path,
    app_type: input.app_type ?? existing.app_type,
    allowed: input.allowed ?? existing.allowed,
    updated_at: nowIso()
  };
  validateRegisteredAppInput(updated);
  const db = await getDatabase();
  await db.execute(
    `UPDATE registered_apps
     SET name = ?, executable_path = ?, app_type = ?, description = ?, allowed = ?, updated_at = ?, last_launched_at = ?
     WHERE id = ?`,
    [updated.name, updated.executable_path, updated.app_type, updated.description ?? null, updated.allowed ? 1 : 0, updated.updated_at, updated.last_launched_at ?? null, appId]
  );
  return updated;
}

export async function deleteRegisteredApp(appId: string): Promise<void> {
  const db = await getDatabase();
  await db.execute("DELETE FROM registered_apps WHERE id = ?", [appId]);
}

export async function getRegisteredAppById(appId: string): Promise<RegisteredAppRecord | null> {
  const db = await getDatabase();
  const rows = await db.select<DbRegisteredApp>("SELECT * FROM registered_apps WHERE id = ?", [appId]);
  return rows[0] ? fromDb(rows[0]) : null;
}

export async function listRegisteredApps(filters: RegisteredAppFilters = {}): Promise<RegisteredAppRecord[]> {
  const db = await getDatabase();
  const rows =
    typeof filters.allowed === "boolean"
      ? await db.select<DbRegisteredApp>("SELECT * FROM registered_apps WHERE allowed = ? ORDER BY updated_at DESC", [filters.allowed ? 1 : 0])
      : await db.select<DbRegisteredApp>("SELECT * FROM registered_apps ORDER BY updated_at DESC");
  return rows.map(fromDb);
}

export async function searchRegisteredApps(query: string): Promise<RegisteredAppRecord[]> {
  if (!query.trim()) return listRegisteredApps();
  const db = await getDatabase();
  const like = `%${query.trim()}%`;
  const rows = await db.select<DbRegisteredApp>(
    `SELECT * FROM registered_apps
     WHERE name LIKE ? OR executable_path LIKE ? OR app_type LIKE ? OR description LIKE ?
     ORDER BY updated_at DESC`,
    [like, like, like, like]
  );
  return rows.map(fromDb);
}

export async function touchRegisteredApp(appId: string): Promise<void> {
  const db = await getDatabase();
  await db.execute("UPDATE registered_apps SET last_launched_at = ? WHERE id = ?", [nowIso(), appId]);
}

export function validateRegisteredAppInput(input: Pick<RegisteredAppInput, "name" | "executable_path">): void {
  if (!input.name.trim()) throw new Error("Registered app name is required.");
  validateExecutablePath(input.executable_path);
}

export function validateExecutablePath(path: string): void {
  const trimmed = path.trim();
  if (!trimmed) throw new Error("Executable path is required.");
  if (!trimmed.toLowerCase().endsWith(".exe")) throw new Error("Registered apps must point to a .exe file.");
  if (isBlockedShellExecutable(trimmed)) throw new Error("Shell and terminal apps are blocked in this pass.");
}

export function isBlockedShellExecutable(path: string): boolean {
  const fileName = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  return blockedShellAppNames.has(fileName);
}

interface DbRegisteredApp extends Omit<RegisteredAppRecord, "allowed"> {
  allowed: number | boolean;
}

function fromDb(row: DbRegisteredApp): RegisteredAppRecord {
  return { ...row, allowed: Boolean(row.allowed) };
}
