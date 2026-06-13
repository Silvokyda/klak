import type { ActionPreview, AppSettings, PermissionMode, RiskLevel, ToolDefinition } from "../../types";
import { logAction, updateActionLog } from "../logs/actionLogRepository";
import { nowIso, summarizeInput } from "../utils";

export function requireConfirmation(mode: PermissionMode, riskLevel: RiskLevel): boolean {
  if (riskLevel === "dangerous" || riskLevel === "high" || riskLevel === "medium") return true;
  return mode !== "trusted_workflows_only";
}

export function canExecuteTool(tool: ToolDefinition, settings: AppSettings): boolean {
  if (settings.allToolsDisabled) return false;
  if (!tool.enabled || tool.future) return false;
  if (tool.riskLevel === "dangerous") return false;
  if (settings.permissionMode === "observe_only" || settings.permissionMode === "suggest_only") return false;
  return true;
}

export async function createActionPreview(
  tool: ToolDefinition,
  input: Record<string, unknown>,
  settings: AppSettings
): Promise<ActionPreview> {
  const inputSummary = summarizeInput(input);
  const actionLog = await logAction({
    tool_name: tool.name,
    input_summary: inputSummary,
    risk_level: tool.riskLevel,
    status: canExecuteTool(tool, settings) ? "proposed" : "blocked",
    user_approved: null,
    error_message: canExecuteTool(tool, settings) ? null : "Tool blocked by current permissions or MVP policy."
  });
  const preview: ActionPreview = {
    id: actionLog.id,
    tool,
    input,
    inputSummary,
    message: describeAction(tool.name, input),
    riskLevel: tool.riskLevel,
    canRun: canExecuteTool(tool, settings),
    requiresConfirmation: requireConfirmation(settings.permissionMode, tool.riskLevel)
  };
  return preview;
}

export async function approveAction(actionId: string): Promise<void> {
  await updateActionLog(actionId, {
    status: "approved",
    user_approved: true
  });
}

export async function denyAction(actionId: string): Promise<void> {
  await updateActionLog(actionId, {
    status: "denied",
    user_approved: false,
    completed_at: nowIso()
  });
}

function describeAction(toolName: string, input: Record<string, unknown>): string {
  if (toolName === "open_url") return `I plan to open ${String(input.url ?? "the requested URL")} in your browser.`;
  if (toolName === "open_folder") return `I plan to open the allowed folder ${String(input.path ?? "")}.`;
  if (toolName === "create_memory") return `I plan to save a local memory titled "${String(input.title ?? "Untitled")}".`;
  if (toolName === "create_note") return `I plan to create a Markdown note named ${String(input.fileName ?? "note.md")}.`;
  if (toolName === "copy_to_clipboard") return "I plan to copy the previewed text to your clipboard.";
  return `I plan to use ${toolName}.`;
}
