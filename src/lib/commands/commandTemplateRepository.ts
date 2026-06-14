import type { CommandTemplateRecord, CommandTemplateType, RiskLevel } from "../../types";
import { getDatabase } from "../db/database";
import { id, nowIso } from "../utils";

export interface CommandTemplateInput {
  project_id?: string | null;
  name: string;
  description?: string | null;
  command: string;
  working_directory: string;
  command_type?: CommandTemplateType;
  risk_level?: Exclude<RiskLevel, "dangerous">;
  enabled?: boolean;
  requires_confirmation?: boolean;
  timeout_seconds?: number;
}

export interface CommandTemplateFilters {
  project_id?: string;
  enabled?: boolean;
}

export interface CommandRunResult {
  exit_code: number | null;
  stdout: string;
  stderr: string;
  duration_ms: number;
  timed_out: boolean;
}

export async function createCommandTemplate(input: CommandTemplateInput): Promise<CommandTemplateRecord> {
  validateCommandTemplateInput(input);
  const db = await getDatabase();
  const timestamp = nowIso();
  const template: CommandTemplateRecord = {
    id: id("cmd"),
    project_id: input.project_id ?? null,
    name: input.name.trim(),
    description: input.description ?? null,
    command: input.command.trim(),
    working_directory: input.working_directory.trim(),
    command_type: input.command_type ?? inferCommandType(input.command),
    risk_level: input.risk_level ?? inferCommandRisk(input.command),
    enabled: input.enabled ?? true,
    requires_confirmation: input.requires_confirmation ?? true,
    timeout_seconds: clampTimeout(input.timeout_seconds ?? 120),
    created_at: timestamp,
    updated_at: timestamp,
    last_run_at: null,
    run_count: 0,
    last_result_summary: null
  };
  await db.execute(
    `INSERT INTO command_templates (id, project_id, name, description, command, working_directory, command_type, risk_level, enabled, requires_confirmation, timeout_seconds, created_at, updated_at, last_run_at, run_count, last_result_summary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      template.id,
      template.project_id ?? null,
      template.name,
      template.description ?? null,
      template.command,
      template.working_directory,
      template.command_type,
      template.risk_level,
      template.enabled ? 1 : 0,
      template.requires_confirmation ? 1 : 0,
      template.timeout_seconds,
      template.created_at,
      template.updated_at,
      template.last_run_at ?? null,
      template.run_count,
      template.last_result_summary ?? null
    ]
  );
  return template;
}

export async function updateCommandTemplate(templateId: string, input: Partial<CommandTemplateInput>): Promise<CommandTemplateRecord | null> {
  const existing = await getCommandTemplateById(templateId);
  if (!existing) return null;
  const updated: CommandTemplateRecord = {
    ...existing,
    ...input,
    command_type: input.command_type ?? existing.command_type,
    risk_level: input.risk_level ?? existing.risk_level,
    enabled: input.enabled ?? existing.enabled,
    requires_confirmation: input.requires_confirmation ?? existing.requires_confirmation,
    timeout_seconds: clampTimeout(input.timeout_seconds ?? existing.timeout_seconds),
    updated_at: nowIso()
  };
  validateCommandTemplateInput(updated);
  const db = await getDatabase();
  await db.execute(
    `UPDATE command_templates
     SET project_id = ?, name = ?, description = ?, command = ?, working_directory = ?, command_type = ?, risk_level = ?, enabled = ?, requires_confirmation = ?, timeout_seconds = ?, updated_at = ?
     WHERE id = ?`,
    [
      updated.project_id ?? null,
      updated.name,
      updated.description ?? null,
      updated.command,
      updated.working_directory,
      updated.command_type,
      updated.risk_level,
      updated.enabled ? 1 : 0,
      updated.requires_confirmation ? 1 : 0,
      updated.timeout_seconds,
      updated.updated_at,
      templateId
    ]
  );
  return updated;
}

export async function deleteCommandTemplate(templateId: string): Promise<void> {
  const db = await getDatabase();
  await db.execute("DELETE FROM command_templates WHERE id = ?", [templateId]);
}

export async function getCommandTemplateById(templateId: string): Promise<CommandTemplateRecord | null> {
  const db = await getDatabase();
  const rows = await db.select<DbCommandTemplate>("SELECT * FROM command_templates WHERE id = ?", [templateId]);
  return rows[0] ? fromDb(rows[0]) : null;
}

export async function listCommandTemplates(filters: CommandTemplateFilters = {}): Promise<CommandTemplateRecord[]> {
  const db = await getDatabase();
  let rows: DbCommandTemplate[];
  if (filters.project_id) rows = await db.select<DbCommandTemplate>("SELECT * FROM command_templates WHERE project_id = ? ORDER BY updated_at DESC", [filters.project_id]);
  else if (typeof filters.enabled === "boolean") rows = await db.select<DbCommandTemplate>("SELECT * FROM command_templates WHERE enabled = ? ORDER BY updated_at DESC", [filters.enabled ? 1 : 0]);
  else rows = await db.select<DbCommandTemplate>("SELECT * FROM command_templates ORDER BY updated_at DESC");
  return rows.map(fromDb);
}

export async function searchCommandTemplates(query: string): Promise<CommandTemplateRecord[]> {
  if (!query.trim()) return listCommandTemplates();
  const db = await getDatabase();
  const like = `%${query.trim()}%`;
  const rows = await db.select<DbCommandTemplate>(
    `SELECT * FROM command_templates
     WHERE name LIKE ? OR description LIKE ? OR command LIKE ? OR working_directory LIKE ? OR command_type LIKE ?
     ORDER BY updated_at DESC`,
    [like, like, like, like, like]
  );
  return rows.map(fromDb);
}

export async function touchCommandTemplate(templateId: string, summary: string): Promise<void> {
  const db = await getDatabase();
  await db.execute("UPDATE command_templates SET last_run_at = ?, last_result_summary = ?, run_count = run_count + 1 WHERE id = ?", [
    nowIso(),
    summary.slice(0, 1000),
    templateId
  ]);
}

export function validateCommandTemplateInput(input: Pick<CommandTemplateInput, "name" | "command" | "working_directory"> & Partial<CommandTemplateInput>): void {
  if (!input.name.trim()) throw new Error("Command template name is required.");
  if (!input.command.trim()) throw new Error("Command is required.");
  if (!input.working_directory.trim()) throw new Error("Working directory is required.");
  validateCommandSafety(input.command);
}

export function validateCommandSafety(command: string): void {
  const normalized = command.trim().toLowerCase();
  if (!normalized) throw new Error("Command is required.");
  if (/[|;]/.test(command) || command.includes("&&") || command.includes("||") || command.includes(">") || command.includes("<") || command.includes("& ")) {
    throw new Error("Command templates cannot use shell chaining, pipes, redirection, or background execution.");
  }
  const blocked = [
    /\brm\b/,
    /\bdel\b/,
    /\brmdir\b/,
    /\bremove-item\b/,
    /\bformat\b/,
    /\bshutdown\b/,
    /\brestart-computer\b/,
    /\breg\s+delete\b/,
    /\bnet\s+user\b/,
    /\bcipher\b/,
    /\bdiskpart\b/,
    /\bset\b/,
    /\bprintenv\b/,
    /\benv\b/,
    /\bcurl\b.*\b(api[_-]?key|token|secret|password)\b/,
    /\bwget\b.*\b(api[_-]?key|token|secret|password)\b/,
    /\b(api[_-]?key|token|secret|password)=/
  ];
  if (blocked.some((pattern) => pattern.test(normalized))) {
    throw new Error("This command matches a blocked safety pattern.");
  }
  const type = inferCommandType(command);
  if (type === "git_readonly" && !/^git\s+(status|log|show|diff|branch|rev-parse|remote)\b/i.test(command.trim())) {
    throw new Error("Git command templates are limited to read-only git commands.");
  }
}

export function inferCommandType(command: string): CommandTemplateType {
  const trimmed = command.trim().toLowerCase();
  if (trimmed.startsWith("npm ")) return "npm";
  if (trimmed.startsWith("node ")) return "node";
  if (trimmed.startsWith("cargo ")) return "cargo";
  if (trimmed.startsWith("git ")) return "git_readonly";
  if (trimmed.startsWith("flutter ")) return "flutter";
  if (trimmed.startsWith("php artisan ")) return "php_artisan";
  if (trimmed.startsWith("python ") || trimmed.startsWith("py ")) return "python";
  return "custom_safe";
}

export function inferCommandRisk(command: string): Exclude<RiskLevel, "dangerous"> {
  const lower = command.toLowerCase();
  if (/\b(dev|serve|watch)\b/.test(lower)) return "high";
  if (/\b(build|test|check|fmt|analyze|route:list|status|log|diff)\b/.test(lower)) return "medium";
  return "medium";
}

export function isLongRunningCommand(command: string): boolean {
  return /\b(dev|serve|watch|start)\b/i.test(command);
}

function clampTimeout(timeout: number): number {
  return Math.max(5, Math.min(600, Math.round(timeout)));
}

interface DbCommandTemplate extends Omit<CommandTemplateRecord, "enabled" | "requires_confirmation"> {
  enabled: number | boolean;
  requires_confirmation: number | boolean;
}

function fromDb(row: DbCommandTemplate): CommandTemplateRecord {
  return {
    ...row,
    enabled: Boolean(row.enabled),
    requires_confirmation: Boolean(row.requires_confirmation),
    timeout_seconds: Number(row.timeout_seconds ?? 120),
    run_count: Number(row.run_count ?? 0)
  };
}
