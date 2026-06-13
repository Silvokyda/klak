import type { ActionLog, ActionStatus, RiskLevel } from "../../types";
import { getDatabase } from "../db/database";
import { id, nowIso } from "../utils";

export interface CreateActionLogInput {
  tool_name: string;
  input_summary: string;
  risk_level: RiskLevel;
  status: ActionStatus;
  user_approved?: boolean | null;
  error_message?: string | null;
}

export interface ActionLogFilters {
  status?: ActionStatus;
}

export async function createActionLog(input: CreateActionLogInput): Promise<ActionLog> {
  const db = await getDatabase();
  const timestamp = nowIso();
  const log: ActionLog = {
    id: id("act"),
    tool_name: input.tool_name,
    input_summary: input.input_summary,
    risk_level: input.risk_level,
    status: input.status,
    user_approved: input.user_approved ?? null,
    created_at: timestamp,
    completed_at: ["completed", "failed", "blocked", "denied"].includes(input.status) ? timestamp : null,
    error_message: input.error_message ?? null
  };
  await db.execute(
    `INSERT INTO action_logs (id, tool_name, input_summary, risk_level, status, user_approved, created_at, completed_at, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      log.id,
      log.tool_name,
      log.input_summary,
      log.risk_level,
      log.status,
      boolToDb(log.user_approved),
      log.created_at,
      log.completed_at ?? null,
      log.error_message ?? null
    ]
  );
  return log;
}

export async function updateActionLog(actionId: string, input: Partial<ActionLog>): Promise<ActionLog | null> {
  const existing = await getActionLogById(actionId);
  if (!existing) return null;
  const updated: ActionLog = { ...existing, ...input };
  const db = await getDatabase();
  await db.execute(
    `UPDATE action_logs
     SET tool_name = ?, input_summary = ?, risk_level = ?, status = ?, user_approved = ?, completed_at = ?, error_message = ?
     WHERE id = ?`,
    [
      updated.tool_name,
      updated.input_summary,
      updated.risk_level,
      updated.status,
      boolToDb(updated.user_approved),
      updated.completed_at ?? null,
      updated.error_message ?? null,
      actionId
    ]
  );
  return updated;
}

export async function listActionLogs(filters: ActionLogFilters = {}): Promise<ActionLog[]> {
  const db = await getDatabase();
  const rows = filters.status
    ? await db.select<DbActionLog>("SELECT * FROM action_logs WHERE status = ? ORDER BY created_at DESC", [filters.status])
    : await db.select<DbActionLog>("SELECT * FROM action_logs ORDER BY created_at DESC");
  return rows.map(fromDb);
}

export async function getActionLogById(actionId: string): Promise<ActionLog | null> {
  const db = await getDatabase();
  const rows = await db.select<DbActionLog>("SELECT * FROM action_logs WHERE id = ?", [actionId]);
  return rows[0] ? fromDb(rows[0]) : null;
}

export const logAction = createActionLog;

interface DbActionLog extends Omit<ActionLog, "user_approved"> {
  user_approved: number | boolean | null;
}

function boolToDb(value: boolean | null): number | null {
  if (value === null) return null;
  return value ? 1 : 0;
}

function fromDb(row: DbActionLog): ActionLog {
  return {
    ...row,
    user_approved: row.user_approved === null ? null : Boolean(row.user_approved)
  };
}
