import type { BackgroundProcessRecord, BackgroundProcessStatus } from "../../types";
import { getDatabase } from "../db/database";
import { id, nowIso } from "../utils";

export interface BackgroundProcessInput {
  command_template_id: string;
  project_id?: string | null;
  name: string;
  command: string;
  working_directory: string;
  status?: BackgroundProcessStatus;
  process_pid?: number | null;
  last_output_preview?: string | null;
  output_log_path?: string | null;
}

export interface BackgroundProcessFilters {
  project_id?: string;
  command_template_id?: string;
}

export async function createBackgroundProcess(input: BackgroundProcessInput): Promise<BackgroundProcessRecord> {
  const db = await getDatabase();
  const timestamp = nowIso();
  const process: BackgroundProcessRecord = {
    id: id("proc"),
    command_template_id: input.command_template_id,
    project_id: input.project_id ?? null,
    name: input.name,
    command: input.command,
    working_directory: input.working_directory,
    status: input.status ?? "starting",
    process_pid: input.process_pid ?? null,
    started_at: timestamp,
    stopped_at: null,
    exit_code: null,
    last_output_preview: input.last_output_preview ?? null,
    output_log_path: input.output_log_path ?? null,
    created_at: timestamp,
    updated_at: timestamp
  };
  await db.execute(
    `INSERT INTO background_processes (id, command_template_id, project_id, name, command, working_directory, status, process_pid, started_at, stopped_at, exit_code, last_output_preview, output_log_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      process.id,
      process.command_template_id,
      process.project_id ?? null,
      process.name,
      process.command,
      process.working_directory,
      process.status,
      process.process_pid ?? null,
      process.started_at,
      process.stopped_at ?? null,
      process.exit_code ?? null,
      process.last_output_preview ?? null,
      process.output_log_path ?? null,
      process.created_at,
      process.updated_at
    ]
  );
  return process;
}

export async function updateBackgroundProcess(processId: string, input: Partial<BackgroundProcessRecord>): Promise<BackgroundProcessRecord | null> {
  const existing = await getBackgroundProcessById(processId);
  if (!existing) return null;
  const updated: BackgroundProcessRecord = { ...existing, ...input, updated_at: nowIso() };
  const db = await getDatabase();
  await db.execute(
    `UPDATE background_processes
     SET status = ?, process_pid = ?, stopped_at = ?, exit_code = ?, last_output_preview = ?, output_log_path = ?, updated_at = ?, name = ?, command = ?
     WHERE id = ?`,
    [
      updated.status,
      updated.process_pid ?? null,
      updated.stopped_at ?? null,
      updated.exit_code ?? null,
      updated.last_output_preview ?? null,
      updated.output_log_path ?? null,
      updated.updated_at,
      updated.name,
      updated.command,
      processId
    ]
  );
  return updated;
}

export async function getBackgroundProcessById(processId: string): Promise<BackgroundProcessRecord | null> {
  const db = await getDatabase();
  const rows = await db.select<DbBackgroundProcess>("SELECT * FROM background_processes WHERE id = ?", [processId]);
  return rows[0] ? fromDb(rows[0]) : null;
}

export async function listBackgroundProcesses(filters: BackgroundProcessFilters = {}): Promise<BackgroundProcessRecord[]> {
  const db = await getDatabase();
  let rows: DbBackgroundProcess[];
  if (filters.command_template_id) rows = await db.select<DbBackgroundProcess>("SELECT * FROM background_processes WHERE command_template_id = ? ORDER BY updated_at DESC", [filters.command_template_id]);
  else if (filters.project_id) rows = await db.select<DbBackgroundProcess>("SELECT * FROM background_processes WHERE project_id = ? ORDER BY updated_at DESC", [filters.project_id]);
  else rows = await db.select<DbBackgroundProcess>("SELECT * FROM background_processes ORDER BY updated_at DESC");
  return rows.map(fromDb);
}

export async function listRunningBackgroundProcesses(): Promise<BackgroundProcessRecord[]> {
  const db = await getDatabase();
  const rows = await db.select<DbBackgroundProcess>("SELECT * FROM background_processes WHERE status IN ('starting', 'running') ORDER BY updated_at DESC");
  return rows.map(fromDb);
}

export async function markProcessStopped(processId: string, input: { status?: BackgroundProcessStatus; exit_code?: number | null; last_output_preview?: string | null } = {}) {
  return updateBackgroundProcess(processId, {
    status: input.status ?? "stopped",
    stopped_at: nowIso(),
    exit_code: input.exit_code ?? null,
    last_output_preview: input.last_output_preview ?? null
  });
}

export async function deleteBackgroundProcess(processId: string): Promise<void> {
  const db = await getDatabase();
  await db.execute("DELETE FROM background_processes WHERE id = ?", [processId]);
}

interface DbBackgroundProcess extends BackgroundProcessRecord {}

function fromDb(row: DbBackgroundProcess): BackgroundProcessRecord {
  return {
    ...row,
    process_pid: row.process_pid == null ? null : Number(row.process_pid),
    exit_code: row.exit_code == null ? null : Number(row.exit_code)
  };
}
