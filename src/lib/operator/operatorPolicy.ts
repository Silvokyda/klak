import type { AppSettings, OperatorTaskRunHydrated, OperatorTaskStepHydrated, TaskScope } from "../../types";

export function canExecuteOperatorMode(mode: OperatorTaskRunHydrated["mode"]): boolean {
  return mode === "observe" || mode === "assisted";
}

export function enforceTaskScope(step: OperatorTaskStepHydrated, scope: TaskScope, settings: AppSettings): void {
  if (step.execution_method === "command_template") {
    const commandTemplateId = String(step.inputs.command_template_id ?? "");
    if (scope.allowed_command_template_ids.length && !scope.allowed_command_template_ids.includes(commandTemplateId)) {
      throw new Error("This step is outside the task's approved saved actions scope.");
    }
  }

  if (step.execution_method === "browser_dom") {
    const url = String(step.inputs.url ?? "");
    const domain = safeDomain(url);
    if (domain && scope.allowed_domains.length && !scope.allowed_domains.includes(domain)) {
      throw new Error("This browser step is outside the task's approved domain scope.");
    }
  }

  if (step.execution_method === "filesystem") {
    const path = String(step.inputs.path ?? step.inputs.folder ?? "");
    if (path && scope.allowed_folders.length && !scope.allowed_folders.some((folder) => path.toLowerCase().startsWith(folder.toLowerCase()))) {
      throw new Error("This filesystem step is outside the task's approved folder scope.");
    }
  }

  if (step.execution_method === "windows_ui") {
    const appId = String(step.inputs.registered_app_id ?? "");
    if (appId && scope.allowed_apps.length && !scope.allowed_apps.includes(appId)) {
      throw new Error("This window step is outside the task's approved app scope.");
    }
  }

  if (settings.permissionMode === "observe_only" && step.execution_method !== "human_takeover") {
    throw new Error("Observe Only mode cannot execute operator actions.");
  }
}

export function stepNeedsApproval(step: OperatorTaskStepHydrated): boolean {
  return step.approval_required !== "none";
}

function safeDomain(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}
