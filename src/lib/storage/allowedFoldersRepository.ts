import type { AllowedFolder } from "../../types";
import { getDatabase } from "../db/database";
import { id, nowIso } from "../utils";

export async function addAllowedFolder(path: string, label?: string): Promise<AllowedFolder> {
  const db = await getDatabase();
  const folder: AllowedFolder = {
    id: id("folder"),
    path,
    label: label ?? null,
    created_at: nowIso()
  };
  await db.execute("INSERT INTO allowed_folders (id, path, label, created_at) VALUES (?, ?, ?, ?)", [
    folder.id,
    folder.path,
    folder.label ?? null,
    folder.created_at
  ]);
  return folder;
}

export async function removeAllowedFolder(folderId: string): Promise<void> {
  const db = await getDatabase();
  await db.execute("DELETE FROM allowed_folders WHERE id = ?", [folderId]);
}

export async function listAllowedFolders(): Promise<AllowedFolder[]> {
  const db = await getDatabase();
  return db.select<AllowedFolder>("SELECT * FROM allowed_folders ORDER BY created_at DESC");
}

export async function setAllowedFolders(paths: string[]): Promise<void> {
  const existing = await listAllowedFolders();
  await Promise.all(existing.map((folder) => removeAllowedFolder(folder.id)));
  const unique = [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
  await Promise.all(unique.map((path) => addAllowedFolder(path)));
}
