import type { ActionPreview, AppSettings, RiskLevel, WorkflowRecord, WorkflowStep } from "../../types";
import { getDatabase } from "../db/database";
import { createActionLog, updateActionLog } from "../logs/actionLogRepository";
import { executeApprovedTool } from "../tools/toolExecutor";
import { buildActionPreviewForSuggestion } from "../tools/toolProposals";
import { id, nowIso } from "../utils";

export interface WorkflowInput {
  project_id?: string | null;
  name: string;
  description?: string | null;
  trigger_phrase?: string | null;
  steps: WorkflowStep[];
  risk_level?: RiskLevel;
  requires_confirmation?: boolean;
}

export interface WorkflowFilters {
  project_id?: string;
}

export interface WorkflowStepPreview {
  step: WorkflowStep;
  preview: ActionPreview | null;
  blockedReason?: string;
}

export interface WorkflowPreview {
  workflow: WorkflowRecord;
  steps: WorkflowStepPreview[];
  canRun: boolean;
  riskLevel: RiskLevel;
}

export async function createWorkflow(input: WorkflowInput): Promise<WorkflowRecord> {
  const db = await getDatabase();
  const timestamp = nowIso();
  const workflow: WorkflowRecord = {
    id: id("wf"),
    project_id: input.project_id ?? null,
    name: input.name,
    description: input.description ?? null,
    trigger_phrase: input.trigger_phrase ?? null,
    steps_json: JSON.stringify(input.steps),
    risk_level: input.risk_level ?? inferWorkflowRisk(input.steps),
    requires_confirmation: input.requires_confirmation ?? true,
    created_at: timestamp,
    updated_at: timestamp,
    last_run_at: null,
    run_count: 0
  };
  await db.execute(
    `INSERT INTO workflows (id, project_id, name, description, trigger_phrase, steps_json, risk_level, requires_confirmation, created_at, updated_at, last_run_at, run_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      workflow.id,
      workflow.project_id ?? null,
      workflow.name,
      workflow.description ?? null,
      workflow.trigger_phrase ?? null,
      workflow.steps_json,
      workflow.risk_level,
      workflow.requires_confirmation ? 1 : 0,
      workflow.created_at,
      workflow.updated_at,
      workflow.last_run_at ?? null,
      workflow.run_count
    ]
  );
  return workflow;
}

export async function updateWorkflow(workflowId: string, input: Partial<WorkflowInput>): Promise<WorkflowRecord | null> {
  const existing = await getWorkflowById(workflowId);
  if (!existing) return null;
  const steps = input.steps ?? parseWorkflowSteps(existing);
  const updated: WorkflowRecord = {
    ...existing,
    ...input,
    steps_json: JSON.stringify(steps),
    risk_level: input.risk_level ?? inferWorkflowRisk(steps),
    requires_confirmation: input.requires_confirmation ?? existing.requires_confirmation,
    updated_at: nowIso()
  };
  const db = await getDatabase();
  await db.execute(
    `UPDATE workflows
     SET project_id = ?, name = ?, description = ?, trigger_phrase = ?, steps_json = ?, risk_level = ?, requires_confirmation = ?, updated_at = ?, last_run_at = ?, run_count = ?
     WHERE id = ?`,
    [
      updated.project_id ?? null,
      updated.name,
      updated.description ?? null,
      updated.trigger_phrase ?? null,
      updated.steps_json,
      updated.risk_level,
      updated.requires_confirmation ? 1 : 0,
      updated.updated_at,
      updated.last_run_at ?? null,
      updated.run_count,
      workflowId
    ]
  );
  return updated;
}

export async function deleteWorkflow(workflowId: string): Promise<void> {
  const db = await getDatabase();
  await db.execute("DELETE FROM workflows WHERE id = ?", [workflowId]);
}

export async function getWorkflowById(workflowId: string): Promise<WorkflowRecord | null> {
  const db = await getDatabase();
  const rows = await db.select<DbWorkflow>("SELECT * FROM workflows WHERE id = ?", [workflowId]);
  return rows[0] ? fromDb(rows[0]) : null;
}

export async function listWorkflows(filters: WorkflowFilters = {}): Promise<WorkflowRecord[]> {
  const db = await getDatabase();
  const rows = filters.project_id
    ? await db.select<DbWorkflow>("SELECT * FROM workflows WHERE project_id = ? ORDER BY updated_at DESC", [filters.project_id])
    : await db.select<DbWorkflow>("SELECT * FROM workflows ORDER BY updated_at DESC");
  return rows.map(fromDb);
}

export async function searchWorkflows(query: string): Promise<WorkflowRecord[]> {
  if (!query.trim()) return listWorkflows();
  const db = await getDatabase();
  const like = `%${query.trim()}%`;
  const rows = await db.select<DbWorkflow>(
    `SELECT * FROM workflows
     WHERE name LIKE ? OR description LIKE ? OR trigger_phrase LIKE ? OR steps_json LIKE ?
     ORDER BY updated_at DESC`,
    [like, like, like, like]
  );
  return rows.map(fromDb);
}

export async function markWorkflowRun(workflowId: string): Promise<void> {
  const db = await getDatabase();
  await db.execute("UPDATE workflows SET last_run_at = ?, run_count = run_count + 1 WHERE id = ?", [nowIso(), workflowId]);
}

export async function previewWorkflow(workflowId: string, settings: AppSettings): Promise<WorkflowPreview> {
  const workflow = await getWorkflowById(workflowId);
  if (!workflow) throw new Error("Workflow not found.");
  const steps = parseWorkflowSteps(workflow);
  validateWorkflowSteps(steps);

  const previews: WorkflowStepPreview[] = [];
  for (const step of steps) {
    if (step.type === "manual_instruction") {
      previews.push({ step, preview: null });
      continue;
    }

    const preview = await buildActionPreviewForSuggestion({ toolName: step.type, input: step.input }, settings);
    previews.push({
      step,
      preview,
      blockedReason: preview?.canRun ? undefined : "Step is blocked by permissions, tool settings, or safety validation."
    });
  }

  return {
    workflow,
    steps: previews,
    canRun: previews.every((item) => !item.preview || item.preview.canRun),
    riskLevel: workflow.risk_level
  };
}

export async function runWorkflow(workflowId: string, settings: AppSettings): Promise<void> {
  const workflowPreview = await previewWorkflow(workflowId, settings);
  const { workflow } = workflowPreview;
  const log = await createActionLog({
    tool_name: "workflow_run",
    input_summary: `workflow: ${workflow.name}`,
    risk_level: workflow.risk_level,
    status: "running",
    user_approved: true
  });
  try {
    if (!workflowPreview.canRun) throw new Error("Workflow has blocked steps and cannot run.");
    for (const stepPreview of workflowPreview.steps) {
      if (!stepPreview.preview) continue;
      await executeApprovedTool(stepPreview.preview, settings);
    }
    await markWorkflowRun(workflow.id);
    await updateActionLog(log.id, { status: "completed", completed_at: nowIso(), user_approved: true });
  } catch (error) {
    await updateActionLog(log.id, {
      status: "failed",
      completed_at: nowIso(),
      user_approved: true,
      error_message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

export function parseWorkflowSteps(workflow: WorkflowRecord): WorkflowStep[] {
  try {
    const parsed = JSON.parse(workflow.steps_json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function validateWorkflowSteps(steps: WorkflowStep[]): void {
  const allowed = new Set(["open_url", "open_folder", "launch_app", "run_command_template", "create_note", "copy_to_clipboard", "search_memory", "create_memory", "manual_instruction"]);
  for (const step of steps) {
    if (!step || typeof step !== "object") throw new Error("Workflow step must be an object.");
    if (!allowed.has(step.type)) throw new Error(`Unsupported workflow step: ${step.type}`);
    if (step.type !== "manual_instruction" && (!step.input || typeof step.input !== "object" || Array.isArray(step.input))) {
      throw new Error(`Workflow step input must be an object: ${step.type}`);
    }
  }
}

function inferWorkflowRisk(steps: WorkflowStep[]): RiskLevel {
  if (steps.some((step) => ["run_command_template"].includes(step.type))) return "high";
  if (steps.some((step) => ["open_folder", "launch_app", "create_note", "copy_to_clipboard", "create_memory"].includes(step.type))) return "medium";
  return "low";
}

interface DbWorkflow extends Omit<WorkflowRecord, "requires_confirmation"> {
  requires_confirmation: number | boolean;
}

function fromDb(row: DbWorkflow): WorkflowRecord {
  return { ...row, requires_confirmation: Boolean(row.requires_confirmation), run_count: Number(row.run_count ?? 0) };
}
