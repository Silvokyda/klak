import type {
  CheckpointRecord,
  OperatorFailureClass,
  OperatorMode,
  OperatorTaskPlan,
  OperatorTaskRun,
  OperatorTaskRunHydrated,
  OperatorTaskStatus,
  OperatorTaskStep,
  OperatorTaskStepHydrated,
  OperatorStepStatus,
  VerificationStatus
} from "../../types";
import { getDatabase } from "../db/database";
import { id, nowIso } from "../utils";

type JsonMap = Record<string, unknown>;

interface CreateOperatorTaskRunInput {
  goal: string;
  mode: OperatorMode;
  status: OperatorTaskStatus;
  plan: OperatorTaskPlan;
}

type OperatorTaskRunPatch = Partial<{
  goal: string;
  mode: OperatorMode;
  status: OperatorTaskStatus;
  plan: OperatorTaskPlan;
  current_step_id: string | null;
  approvals: string[];
  verification_state: Record<string, VerificationStatus>;
  retries: Record<string, number>;
  final_report: string | null;
  failure_class: OperatorFailureClass | null;
  started_at: string;
  completed_at: string | null;
}>;

type OperatorTaskStepPatch = Partial<{
  order_index: number;
  title: string;
  kind: OperatorTaskStep["kind"];
  intent: string;
  execution_method: OperatorTaskStep["execution_method"];
  fallback_methods: string[];
  inputs: Record<string, unknown>;
  verification: Record<string, unknown>;
  approval_required: OperatorTaskStep["approval_required"];
  status: OperatorStepStatus;
  retry_count: number;
  max_retries: number;
  verification_status: VerificationStatus;
  checkpoint: CheckpointRecord | null;
  result_summary: string | null;
  failure_class: OperatorFailureClass | null;
  action_log_ids: string[];
  started_at: string | null;
  completed_at: string | null;
}>;

export async function createOperatorTaskRun(input: CreateOperatorTaskRunInput): Promise<OperatorTaskRunHydrated> {
  const db = await getDatabase();
  const timestamp = nowIso();
  const runId = id("task");
  const plan = input.plan;
  const run: OperatorTaskRun = {
    id: runId,
    goal: input.goal.trim(),
    mode: input.mode,
    status: input.status,
    scope_json: JSON.stringify(plan.scope),
    plan_json: JSON.stringify(plan),
    current_step_id: null,
    approvals_json: JSON.stringify([]),
    verification_state_json: JSON.stringify({}),
    retries_json: JSON.stringify({}),
    final_report: null,
    failure_class: null,
    started_at: timestamp,
    completed_at: null,
    created_at: timestamp,
    updated_at: timestamp
  };
  await db.execute(
    `INSERT INTO operator_task_runs (id, goal, mode, status, scope_json, plan_json, current_step_id, approvals_json, verification_state_json, retries_json, final_report, failure_class, started_at, completed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      run.id,
      run.goal,
      run.mode,
      run.status,
      run.scope_json,
      run.plan_json,
      run.current_step_id ?? null,
      run.approvals_json,
      run.verification_state_json,
      run.retries_json,
      run.final_report ?? null,
      run.failure_class ?? null,
      run.started_at,
      run.completed_at ?? null,
      run.created_at,
      run.updated_at
    ]
  );

  for (const [index, step] of plan.steps.entries()) {
    const row: OperatorTaskStep = {
      id: id("step"),
      task_run_id: runId,
      order_index: index,
      title: step.title,
      kind: step.kind,
      intent: step.intent,
      execution_method: step.execution_method,
      fallback_methods_json: JSON.stringify(step.fallback_methods),
      inputs_json: JSON.stringify(step.inputs),
      verification_json: JSON.stringify(step.verification),
      approval_required: step.approval_required,
      status: index === 0 ? "ready" : "pending",
      retry_count: 0,
      max_retries: step.retry_limit,
      verification_status: "pending",
      checkpoint_json: null,
      result_summary: null,
      failure_class: null,
      action_log_ids_json: JSON.stringify([]),
      started_at: null,
      completed_at: null,
      created_at: timestamp,
      updated_at: timestamp
    };
    await db.execute(
      `INSERT INTO operator_task_steps (id, task_run_id, order_index, title, kind, intent, execution_method, fallback_methods_json, inputs_json, verification_json, approval_required, status, retry_count, max_retries, verification_status, checkpoint_json, result_summary, failure_class, action_log_ids_json, started_at, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.task_run_id,
        row.order_index,
        row.title,
        row.kind,
        row.intent,
        row.execution_method,
        row.fallback_methods_json,
        row.inputs_json,
        row.verification_json,
        row.approval_required,
        row.status,
        row.retry_count,
        row.max_retries,
        row.verification_status,
        row.checkpoint_json ?? null,
        row.result_summary ?? null,
        row.failure_class ?? null,
        row.action_log_ids_json,
        row.started_at ?? null,
        row.completed_at ?? null,
        row.created_at,
        row.updated_at
      ]
    );
    if (index === 0) {
      run.current_step_id = row.id;
    }
  }

  if (run.current_step_id) {
    await updateOperatorTaskRun(run.id, { current_step_id: run.current_step_id });
  }
  return getOperatorTaskRunById(run.id) as Promise<OperatorTaskRunHydrated>;
}

export async function getOperatorTaskRunById(taskRunId: string): Promise<OperatorTaskRunHydrated | null> {
  const db = await getDatabase();
  const rows = await db.select<OperatorTaskRun>("SELECT * FROM operator_task_runs WHERE id = ?", [taskRunId]);
  if (!rows[0]) return null;
  const steps = await listOperatorTaskSteps(taskRunId);
  return hydrateRun(rows[0], steps);
}

export async function listOperatorTaskRuns(status?: OperatorTaskStatus): Promise<OperatorTaskRunHydrated[]> {
  const db = await getDatabase();
  const rows = status
    ? await db.select<OperatorTaskRun>("SELECT * FROM operator_task_runs WHERE status = ? ORDER BY updated_at DESC", [status])
    : await db.select<OperatorTaskRun>("SELECT * FROM operator_task_runs ORDER BY updated_at DESC");
  const hydrated: OperatorTaskRunHydrated[] = [];
  for (const row of rows) {
    const steps = await listOperatorTaskSteps(row.id);
    hydrated.push(hydrateRun(row, steps));
  }
  return hydrated;
}

export async function listOperatorTaskSteps(taskRunId: string): Promise<OperatorTaskStepHydrated[]> {
  const db = await getDatabase();
  const rows = await db.select<OperatorTaskStep>("SELECT * FROM operator_task_steps WHERE task_run_id = ? ORDER BY order_index ASC", [taskRunId]);
  return rows.map(hydrateStep);
}

export async function updateOperatorTaskRun(taskRunId: string, patch: OperatorTaskRunPatch): Promise<void> {
  const existing = await getOperatorTaskRunById(taskRunId);
  if (!existing) return;
  const next: OperatorTaskRun = {
    ...existing,
    goal: patch.goal ?? existing.goal,
    mode: patch.mode ?? existing.mode,
    status: patch.status ?? existing.status,
    scope_json: JSON.stringify(patch.plan?.scope ?? existing.scope),
    plan_json: JSON.stringify(patch.plan ?? existing.plan),
    current_step_id: patch.current_step_id === undefined ? existing.current_step_id ?? null : patch.current_step_id,
    approvals_json: JSON.stringify(patch.approvals ?? existing.approvals),
    verification_state_json: JSON.stringify(patch.verification_state ?? existing.verification_state),
    retries_json: JSON.stringify(patch.retries ?? existing.retries),
    final_report: patch.final_report === undefined ? existing.final_report ?? null : patch.final_report,
    failure_class: patch.failure_class === undefined ? existing.failure_class ?? null : patch.failure_class,
    started_at: patch.started_at ?? existing.started_at,
    completed_at: patch.completed_at === undefined ? existing.completed_at ?? null : patch.completed_at,
    created_at: existing.created_at,
    updated_at: nowIso()
  };
  const db = await getDatabase();
  await db.execute(
    `UPDATE operator_task_runs
     SET goal = ?, mode = ?, status = ?, scope_json = ?, plan_json = ?, current_step_id = ?, approvals_json = ?, verification_state_json = ?, retries_json = ?, final_report = ?, failure_class = ?, started_at = ?, completed_at = ?, updated_at = ?
     WHERE id = ?`,
    [
      next.goal,
      next.mode,
      next.status,
      next.scope_json,
      next.plan_json,
      next.current_step_id ?? null,
      next.approvals_json,
      next.verification_state_json,
      next.retries_json,
      next.final_report ?? null,
      next.failure_class ?? null,
      next.started_at,
      next.completed_at ?? null,
      next.updated_at,
      taskRunId
    ]
  );
}

export async function updateOperatorTaskStep(stepId: string, patch: OperatorTaskStepPatch): Promise<void> {
  const existing = await getOperatorTaskStepById(stepId);
  if (!existing) return;
  const next: OperatorTaskStep = {
    ...existing,
    order_index: patch.order_index ?? existing.order_index,
    title: patch.title ?? existing.title,
    kind: patch.kind ?? existing.kind,
    intent: patch.intent ?? existing.intent,
    execution_method: patch.execution_method ?? existing.execution_method,
    fallback_methods_json: JSON.stringify(patch.fallback_methods ?? existing.fallback_methods),
    inputs_json: JSON.stringify(patch.inputs ?? existing.inputs),
    verification_json: JSON.stringify(patch.verification ?? existing.verification),
    approval_required: patch.approval_required ?? existing.approval_required,
    status: patch.status ?? existing.status,
    retry_count: patch.retry_count ?? existing.retry_count,
    max_retries: patch.max_retries ?? existing.max_retries,
    verification_status: patch.verification_status ?? existing.verification_status,
    checkpoint_json: patch.checkpoint === undefined ? existing.checkpoint_json ?? null : JSON.stringify(patch.checkpoint),
    result_summary: patch.result_summary === undefined ? existing.result_summary ?? null : patch.result_summary,
    failure_class: patch.failure_class === undefined ? existing.failure_class ?? null : patch.failure_class,
    action_log_ids_json: JSON.stringify(patch.action_log_ids ?? existing.action_log_ids),
    started_at: patch.started_at === undefined ? existing.started_at ?? null : patch.started_at,
    completed_at: patch.completed_at === undefined ? existing.completed_at ?? null : patch.completed_at,
    created_at: existing.created_at,
    updated_at: nowIso()
  };
  const db = await getDatabase();
  await db.execute(
    `UPDATE operator_task_steps
     SET order_index = ?, title = ?, kind = ?, intent = ?, execution_method = ?, fallback_methods_json = ?, inputs_json = ?, verification_json = ?, approval_required = ?, status = ?, retry_count = ?, max_retries = ?, verification_status = ?, checkpoint_json = ?, result_summary = ?, failure_class = ?, action_log_ids_json = ?, started_at = ?, completed_at = ?, updated_at = ?
     WHERE id = ?`,
    [
      next.order_index,
      next.title,
      next.kind,
      next.intent,
      next.execution_method,
      next.fallback_methods_json,
      next.inputs_json,
      next.verification_json,
      next.approval_required,
      next.status,
      next.retry_count,
      next.max_retries,
      next.verification_status,
      next.checkpoint_json ?? null,
      next.result_summary ?? null,
      next.failure_class ?? null,
      next.action_log_ids_json,
      next.started_at ?? null,
      next.completed_at ?? null,
      next.updated_at,
      stepId
    ]
  );
}

export async function getOperatorTaskStepById(stepId: string): Promise<OperatorTaskStepHydrated | null> {
  const db = await getDatabase();
  const rows = await db.select<OperatorTaskStep>("SELECT * FROM operator_task_steps WHERE id = ?", [stepId]);
  return rows[0] ? hydrateStep(rows[0]) : null;
}

export function hydrateRun(run: OperatorTaskRun, steps: OperatorTaskStepHydrated[]): OperatorTaskRunHydrated {
  return {
    ...run,
    scope: safeJson(run.scope_json, emptyScope()) as OperatorTaskRunHydrated["scope"],
    plan: safeJson(run.plan_json, { summary: "", scope: emptyScope(), steps: [] }) as OperatorTaskPlan,
    approvals: safeJson(run.approvals_json, []) as string[],
    verification_state: safeJson(run.verification_state_json, {}) as Record<string, VerificationStatus>,
    retries: safeJson(run.retries_json, {}) as Record<string, number>,
    steps
  };
}

export function hydrateStep(step: OperatorTaskStep): OperatorTaskStepHydrated {
  return {
    ...step,
    fallback_methods: safeJson(step.fallback_methods_json, []) as OperatorTaskStepHydrated["fallback_methods"],
    inputs: safeJson(step.inputs_json, {}) as OperatorTaskStepHydrated["inputs"],
    verification: safeJson(step.verification_json, { type: "none" }) as OperatorTaskStepHydrated["verification"],
    checkpoint: step.checkpoint_json ? (safeJson(step.checkpoint_json, null) as CheckpointRecord | null) : null,
    action_log_ids: safeJson(step.action_log_ids_json, []) as string[]
  };
}

function safeJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function emptyScope() {
  return {
    allowed_apps: [],
    allowed_folders: [],
    allowed_domains: [],
    allowed_command_template_ids: [],
    allowed_recipients: [],
    allowed_action_classes: [],
    max_actions: 12,
    max_runtime_seconds: 900
  };
}
