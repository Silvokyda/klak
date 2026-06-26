import type { ActionPreview, AppSettings, ToolActionInput, ToolDefinition } from "../../types";
import { approveAction, createActionPreview, denyAction } from "../permissions/policy";
import { executeApprovedTool } from "../tools/toolExecutor";
import { buildActionPreviewForSuggestion } from "../tools/toolProposals";

export interface KlakActionResult {
  status: "completed" | "denied" | "blocked" | "failed";
  message: string;
}

export interface KlakActionCatalogEntry {
  tool: ToolDefinition;
  requiresApproval: boolean;
  voiceInvokable: boolean;
}

export async function buildKlakActionPreview(action: ToolActionInput, settings: AppSettings): Promise<ActionPreview | null> {
  return buildActionPreviewForSuggestion(action, settings);
}

export async function approveKlakAction(preview: ActionPreview): Promise<void> {
  await approveAction(preview.id);
}

export async function denyKlakAction(preview: ActionPreview): Promise<void> {
  await denyAction(preview.id);
}

export async function executeKlakAction(preview: ActionPreview, settings: AppSettings): Promise<string> {
  return executeApprovedTool(preview, settings);
}

export function summarizeKlakResult(status: KlakActionResult["status"], message: string): KlakActionResult {
  return { status, message };
}
