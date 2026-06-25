import { createActionLog, updateActionLog } from "../logs/actionLogRepository";
import type {
  ActionLog,
  AppSettings,
  OperatorFailureClass,
  OperatorMode,
  OperatorTaskRunHydrated,
  OperatorTaskStepHydrated,
  OperatorTaskStatus,
  RiskLevel
} from "../../types";
import { approveAction } from "../permissions/policy";
import { buildActionPreviewForSuggestion } from "../tools/toolProposals";
import { executeApprovedTool } from "../tools/toolExecutor";
import { nowIso } from "../utils";
import {
  createOperatorTaskRun,
  getOperatorTaskRunById,
  updateOperatorTaskRun,
  updateOperatorTaskStep
} from "./operatorTaskRepository";
import { canExecuteOperatorMode, enforceTaskScope, stepNeedsApproval } from "./operatorPolicy";
import { browserClick, browserNavigate, browserReadState, browserSelect, browserType, browserWaitFor, openBrowserSession } from "./browserAutomation";
import { focusWindow } from "./desktopObserver";
import { observeEnvironment } from "./observer";
import { planOperatorTask } from "./operatorPlanner";
import { verifyStep } from "./verification";
import { searchProjects } from "../projects/projectRepository";
import { listCommandTemplates } from "../commands/commandTemplateRepository";
import { searchRegisteredApps } from "../apps/registeredAppsRepository";
import { listRunningBackgroundProcesses } from "../processes/backgroundProcessRepository";
import { OpenAICompatibleProvider } from "../ai/openAiCompatibleProvider";

export async function createPlannedOperatorTask(goal: string, settings: AppSettings, mode: OperatorMode = "assisted") {
  const [projects, commands, apps, runningProcesses] = await Promise.all([
    searchProjects(goal),
    listCommandTemplates({ enabled: true }),
    searchRegisteredApps(goal),
    listRunningBackgroundProcesses()
  ]);

  const plan = await planOperatorTask(
    {
      userGoal: goal,
      mode,
      permissionMode: settings.permissionMode,
      availableProjects: projects,
      availableCommandTemplates: commands,
      availableRegisteredApps: apps.filter((app) => app.allowed),
      runningProcesses,
      allowedFolders: settings.allowedFolders
    },
    new OpenAICompatibleProvider(settings.apiBaseUrl, settings.modelName)
  );

  return createOperatorTaskRun({
    goal,
    mode,
    status: "ready",
    plan
  });
}

export async function runOperatorTask(taskRunId: string, settings: AppSettings): Promise<OperatorTaskRunHydrated> {
  let run = await getOperatorTaskRunById(taskRunId);
  if (!run) throw new Error("Task run not found.");
  if (!canExecuteOperatorMode(run.mode)) {
    await failRun(run, "blocked", "unsupported", "This operator mode is modeled but not executable in v1.");
    return (await getOperatorTaskRunById(taskRunId)) as OperatorTaskRunHydrated;
  }

  if (run.status === "completed" || run.status === "cancelled") return run;

  await updateOperatorTaskRun(run.id, { status: "running" });
  run = (await getOperatorTaskRunById(run.id)) as OperatorTaskRunHydrated;

  for (const step of run.steps) {
    if (!["ready", "pending", "awaiting_approval"].includes(step.status)) continue;
    if (step.status === "pending") {
      await updateOperatorTaskStep(step.id, { status: "ready" });
    }
    const latest = (await getOperatorTaskRunById(run.id)) as OperatorTaskRunHydrated;
    const current = latest.steps.find((item) => item.id === step.id);
    if (!current) continue;

    if (stepNeedsApproval(current) && current.status !== "awaiting_approval") {
      await updateOperatorTaskRun(latest.id, { status: "awaiting_approval", current_step_id: current.id });
      await updateOperatorTaskStep(current.id, { status: "awaiting_approval" });
      return (await getOperatorTaskRunById(run.id)) as OperatorTaskRunHydrated;
    }

    if (current.status === "awaiting_approval") {
      return (await getOperatorTaskRunById(run.id)) as OperatorTaskRunHydrated;
    }

    const outcome = await executeStep(latest, current, settings);
    if (outcome === "pause") {
      return (await getOperatorTaskRunById(run.id)) as OperatorTaskRunHydrated;
    }
    if (outcome === "failed") {
      return (await getOperatorTaskRunById(run.id)) as OperatorTaskRunHydrated;
    }
  }

  await updateOperatorTaskRun(run.id, {
    status: "completed",
    current_step_id: null,
    completed_at: nowIso(),
    final_report: buildFinalReport((await getOperatorTaskRunById(run.id)) as OperatorTaskRunHydrated)
  });
  return (await getOperatorTaskRunById(run.id)) as OperatorTaskRunHydrated;
}

export async function approveOperatorTaskStep(taskRunId: string, stepId: string, settings: AppSettings) {
  const run = await getOperatorTaskRunById(taskRunId);
  if (!run) throw new Error("Task run not found.");
  const step = run.steps.find((item) => item.id === stepId);
  if (!step) throw new Error("Task step not found.");
  await updateOperatorTaskStep(step.id, {
    status: step.approval_required === "secret_input_required" ? "awaiting_manual" : "ready"
  });
  await updateOperatorTaskRun(taskRunId, {
    status: step.approval_required === "secret_input_required" ? "paused" : "running",
    approvals: [...new Set([...run.approvals, step.id])]
  });
  return runOperatorTask(taskRunId, settings);
}

export async function denyOperatorTaskStep(taskRunId: string, stepId: string, reason: string) {
  const run = await getOperatorTaskRunById(taskRunId);
  if (!run) throw new Error("Task run not found.");
  await updateOperatorTaskStep(stepId, {
    status: "blocked",
    failure_class: "human_required",
    result_summary: reason,
    completed_at: nowIso()
  });
  await updateOperatorTaskRun(taskRunId, {
    status: "blocked",
    failure_class: "human_required",
    final_report: reason,
    completed_at: nowIso()
  });
  return getOperatorTaskRunById(taskRunId);
}

export async function completeManualOperatorStep(taskRunId: string, stepId: string, note: string, settings: AppSettings) {
  const run = await getOperatorTaskRunById(taskRunId);
  if (!run) throw new Error("Task run not found.");
  await updateOperatorTaskStep(stepId, {
    status: "completed",
    verification_status: "skipped",
    result_summary: note,
    completed_at: nowIso()
  });
  await promoteNextStep(taskRunId, stepId);
  return runOperatorTask(taskRunId, settings);
}

async function executeStep(run: OperatorTaskRunHydrated, step: OperatorTaskStepHydrated, settings: AppSettings): Promise<"completed" | "pause" | "failed"> {
  try {
    enforceTaskScope(step, run.scope, settings);
    await updateOperatorTaskRun(run.id, { current_step_id: step.id, status: "running" });
    await updateOperatorTaskStep(step.id, { status: "running", started_at: step.started_at ?? nowIso() });

    const actionLog = await createOperatorActionLog(step);
    let browserSessionId: string | undefined;
    let commandResult = null;

    if (step.execution_method === "command_template") {
      const preview = await buildActionPreviewForSuggestion({
        toolName: isBackgroundStep(step) ? "start_background_process" : "run_command_template",
        input: { command_template_id: String(step.inputs.command_template_id ?? "") }
      }, settings);
      if (!preview) throw new Error("Klak could not build a saved-action preview for this step.");
      await approveAction(preview.id);
      await executeApprovedTool(preview, settings);
      await updateActionLog(actionLog.id, { status: "completed", user_approved: true, completed_at: nowIso() });
    } else if (step.execution_method === "browser_dom") {
      browserSessionId = String(step.inputs.session_id ?? `browser-${run.id}`);
      const action = String(step.inputs.action ?? "open");
      if (action === "open") {
        await openBrowserSession(browserSessionId, String(step.inputs.url ?? ""), true);
      } else if (action === "navigate") {
        await browserNavigate(browserSessionId, String(step.inputs.url ?? ""));
      } else if (action === "click") {
        await browserClick(browserSessionId, String(step.inputs.selector ?? ""));
      } else if (action === "type") {
        await browserType(browserSessionId, String(step.inputs.selector ?? ""), String(step.inputs.text ?? ""));
      } else if (action === "select") {
        await browserSelect(browserSessionId, String(step.inputs.selector ?? ""), String(step.inputs.value ?? ""));
      } else if (action === "wait") {
        const matched = await browserWaitFor({
          sessionId: browserSessionId,
          selector: typeof step.inputs.selector === "string" ? step.inputs.selector : undefined,
          text: typeof step.inputs.text === "string" ? step.inputs.text : undefined,
          timeoutMs: typeof step.inputs.timeout_ms === "number" ? step.inputs.timeout_ms : 12000
        });
        if (!matched) throw new Error("The browser condition was not met before timeout.");
      } else if (action === "read") {
        await browserReadState(browserSessionId, typeof step.inputs.selector === "string" ? step.inputs.selector : undefined);
      }
      await updateActionLog(actionLog.id, { status: "completed", user_approved: true, completed_at: nowIso() });
    } else if (step.execution_method === "windows_ui") {
      await focusWindow(String(step.inputs.title ?? ""));
      await updateActionLog(actionLog.id, { status: "completed", user_approved: true, completed_at: nowIso() });
    } else if (step.execution_method === "human_takeover") {
      await updateOperatorTaskRun(run.id, { status: "paused", current_step_id: step.id });
      await updateOperatorTaskStep(step.id, {
        status: "awaiting_manual",
        result_summary: String(step.inputs.message ?? "Manual takeover requested.")
      });
      await updateActionLog(actionLog.id, { status: "blocked", user_approved: false, completed_at: nowIso() });
      return "pause";
    } else {
      throw new Error(`Unsupported execution method ${step.execution_method}.`);
    }

    const observation = await observeEnvironment({
      browserSessionId,
      browserSelector: typeof step.inputs.selector === "string" ? step.inputs.selector : undefined,
      commandResult
    });
    const verification = await verifyStep(step.verification, observation);
    if (verification.status === "failed") {
      return handleVerificationFailure(run, step, verification.summary);
    }

    await updateOperatorTaskStep(step.id, {
      status: "completed",
      verification_status: verification.status,
      result_summary: verification.summary,
      action_log_ids: [...new Set([...step.action_log_ids, actionLog.id])],
      completed_at: nowIso()
    });
    await promoteNextStep(run.id, step.id);
    return "completed";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failureClass = classifyFailure(message);
    const retryCount = step.retry_count + 1;
    if (failureClass === "transient" && retryCount <= step.max_retries) {
      await updateOperatorTaskStep(step.id, {
        status: "ready",
        retry_count: retryCount,
        failure_class: failureClass,
        result_summary: message
      });
      return "pause";
    }
    await updateOperatorTaskStep(step.id, {
      status: failureClass === "human_required" ? "awaiting_manual" : "failed",
      retry_count: retryCount,
      failure_class: failureClass,
      result_summary: message,
      completed_at: nowIso()
    });
    await failRun(run, failureClass === "human_required" ? "paused" : "failed", failureClass, message);
    return "failed";
  }
}

async function promoteNextStep(taskRunId: string, completedStepId: string) {
  const refreshed = await getOperatorTaskRunById(taskRunId);
  if (!refreshed) return;
  const currentIndex = refreshed.steps.findIndex((step) => step.id === completedStepId);
  const next = refreshed.steps[currentIndex + 1];
  if (!next) {
    await updateOperatorTaskRun(taskRunId, { current_step_id: null });
    return;
  }
  await updateOperatorTaskStep(next.id, { status: "ready" });
  await updateOperatorTaskRun(taskRunId, { current_step_id: next.id, status: "ready" });
}

async function failRun(
  run: OperatorTaskRunHydrated,
  status: OperatorTaskStatus,
  failureClass: OperatorFailureClass,
  message: string
) {
  await updateOperatorTaskRun(run.id, {
    status,
    failure_class: failureClass,
    final_report: message,
    completed_at: status === "paused" ? null : nowIso()
  });
}

async function handleVerificationFailure(run: OperatorTaskRunHydrated, step: OperatorTaskStepHydrated, summary: string) {
  const fallbacks = step.fallback_methods.filter((method) => method !== step.execution_method);
  if (fallbacks.length > 0) {
    await updateOperatorTaskStep(step.id, {
      execution_method: fallbacks[0],
      status: "ready",
      failure_class: "verification_failed",
      result_summary: `${summary} Retrying with fallback ${fallbacks[0]}.`
    });
    return "pause" as const;
  }
  await updateOperatorTaskStep(step.id, {
    status: "failed",
    verification_status: "failed",
    failure_class: "verification_failed",
    result_summary: summary,
    completed_at: nowIso()
  });
  await failRun(run, "failed", "verification_failed", summary);
  return "failed" as const;
}

async function createOperatorActionLog(step: OperatorTaskStepHydrated): Promise<ActionLog> {
  const toolName = step.execution_method === "browser_dom"
    ? "browser_automation"
    : step.execution_method === "windows_ui"
      ? "window_observer"
      : step.execution_method === "filesystem"
        ? "filesystem"
        : step.execution_method === "human_takeover"
          ? "human_takeover"
          : "run_command_template";
  return createActionLog({
    tool_name: toolName,
    input_summary: `${step.title}: ${step.intent}`.slice(0, 400),
    risk_level: riskForStep(step),
    status: "running",
    user_approved: true
  });
}

function riskForStep(step: OperatorTaskStepHydrated): RiskLevel {
  if (step.approval_required === "secret_input_required" || step.approval_required === "before_consequential_action") return "high";
  if (step.execution_method === "browser_dom" || step.execution_method === "windows_ui") return "high";
  if (step.execution_method === "human_takeover") return "medium";
  return "medium";
}

function isBackgroundStep(step: OperatorTaskStepHydrated): boolean {
  return step.verification.type === "process_running";
}

function classifyFailure(message: string): OperatorFailureClass {
  if (/scope|permission|blocked|not executable/i.test(message)) return "permission_blocked";
  if (/timeout|temporar|condition/i.test(message)) return "transient";
  if (/manual|secret|human/i.test(message)) return "human_required";
  if (/unsupported/i.test(message)) return "unsupported";
  if (/verify|expected|not found/i.test(message)) return "verification_failed";
  return "environment_changed";
}

function buildFinalReport(run: OperatorTaskRunHydrated): string {
  const completed = run.steps.filter((step) => step.status === "completed");
  const incomplete = run.steps.filter((step) => step.status !== "completed");
  return [
    `Goal: ${run.goal}`,
    `Completed steps: ${completed.length}/${run.steps.length}`,
    completed.length ? `Verified work: ${completed.map((step) => step.title).join(", ")}` : "Verified work: none",
    incomplete.length ? `Remaining or blocked: ${incomplete.map((step) => `${step.title} (${step.status})`).join(", ")}` : "Remaining or blocked: none"
  ].join("\n");
}
