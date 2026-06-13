import type { AppSettings, MemoryType } from "../../types";
import { listAllowedFolders } from "../storage/allowedFoldersRepository";

export function validateHttpUrl(value: unknown): string {
  const url = new URL(String(value ?? ""));
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed.");
  }
  return url.toString();
}

export async function assertAllowedFolder(path: string, settings: AppSettings): Promise<string> {
  const allowed = await listAllowedFolders();
  const normalized = normalizePath(path);
  const matchesSettings = settings.allowedFolders.some((folder) => normalizePath(folder) === normalized);
  const matchesDatabase = allowed.some((folder) => normalizePath(folder.path) === normalized);
  if (!matchesSettings && !matchesDatabase) {
    throw new Error("This folder is not in Klak's allowed folders list.");
  }
  return path;
}

export async function assertPathInsideAllowedFolder(path: string, settings: AppSettings): Promise<string> {
  const allowed = await listAllowedFolders();
  const normalized = normalizePath(path);
  const allowedPaths = [...settings.allowedFolders, ...allowed.map((folder) => folder.path)].map(normalizePath);
  if (!allowedPaths.some((folder) => normalized === folder || normalized.startsWith(`${folder}\\`) || normalized.startsWith(`${folder}/`))) {
    throw new Error("The destination path is not inside an allowed folder.");
  }
  return path;
}

export function sanitizeFileName(input: string): string {
  const trimmed = input.trim() || "klak-note";
  return trimmed
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80)
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

export function buildNoteMarkdown(title: string, content: string): string {
  return `# ${title.trim() || "Klak Note"}\n\n${content.trim()}\n`;
}

export function safeClipboardPreview(text: string): string {
  const lines = text.split(/\r?\n/).slice(0, 4).join("\n");
  return `${lines}${text.length > lines.length ? "\n..." : ""}\n\n${text.length} characters`;
}

export function looksSensitive(value: string): boolean {
  return /\b(api[_ -]?key|password|secret|token|private key|credential)\b/i.test(value);
}

export function normalizeMemoryType(value: unknown): MemoryType {
  const allowed: MemoryType[] = ["profile", "preference", "project", "workflow", "task", "document", "command_history"];
  return allowed.includes(value as MemoryType) ? (value as MemoryType) : "preference";
}

function normalizePath(path: string): string {
  return path.trim().replace(/[\\/]+$/g, "").toLowerCase();
}
