import type { ActionPreview, AppSettings } from "../../types";
import { approveAction, denyAction } from "../permissions/policy";
import { searchProjects, touchProject } from "../projects/projectRepository";
import { listAllowedFolders } from "../storage/allowedFoldersRepository";
import { executeKlakAction, buildKlakActionPreview } from "../actions/klakActionDispatcher";
import { resolveAppAction } from "../apps/appActionResolver";
import { matchVoiceApprovalTranscript } from "./voiceApprovalMatcher";
import { validateHttpUrl } from "../tools/safeToolUtils";

export type RealtimeVoiceOperatorStatus = "denied" | "completed" | "failed" | "blocked";

export interface RealtimeVoiceFunctionCall {
  sessionGeneration: number;
  responseId: string;
  outputItemId: string;
  callId: string;
  name: string;
  argumentsJson: string;
}

export interface RealtimeVoiceOperatorUpdate {
  sessionGeneration: number;
  responseId: string;
  outputItemId: string;
  callId: string;
  functionName: string;
  status: RealtimeVoiceOperatorStatus;
  message: string;
  preview?: ActionPreview | null;
}

export interface RealtimeVoiceFunctionCallResolution {
  kind: "pending" | "completed" | "blocked" | "failed";
  message: string;
  preview?: ActionPreview | null;
}

interface PendingVoiceAction {
  preview: ActionPreview;
  call: RealtimeVoiceFunctionCall;
  createdAt: string;
  expiresAt: number;
  resolved: boolean;
  expireTimer: number | null;
}

interface BridgeCallbacks {
  onPreviewChanged: (preview: ActionPreview | null) => void;
  onDiagnostic?: (code: string, message: string) => void;
}

const defaultApprovalTimeoutMs = 2 * 60 * 1000;

export class RealtimeVoiceOperatorBridge {
  private pendingAction: PendingVoiceAction | null = null;

  constructor(
    private readonly settings: AppSettings,
    private readonly callbacks: BridgeCallbacks
  ) {}

  getRealtimeTools() {
    return [
      functionTool(
        "resolve_app_action",
        "Resolve App Action",
        "Resolve a requested app name into open, register, or verify behavior.",
        objectSchema(
          {
            app_name: stringProperty("The app name to resolve, for example Google Chrome."),
            action: {
              type: "string",
              enum: ["open", "register", "register_and_open", "check_installed"]
            }
          },
          ["app_name", "action"]
        )
      ),
      functionTool(
        "scan_installed_apps",
        "Scan Installed Apps",
        "Scan safe Windows app sources for discoverable apps.",
        {
          type: "object",
          properties: {},
          additionalProperties: false
        }
      ),
      functionTool(
        "open_allowed_folder",
        "Open Allowed Folder",
        "Create an approval preview to open an existing allowed folder by label, project name, or exact path.",
        objectSchema(
          {
            folder_name_or_path: stringProperty("An allowed folder label, a known project name, or an exact allowed folder path.")
          },
          ["folder_name_or_path"]
        )
      ),
      functionTool(
        "open_url",
        "Open URL",
        "Create an approval preview to open a valid http or https URL.",
        objectSchema({ url: stringProperty("The full http or https URL to open.") }, ["url"])
      )
    ];
  }

  buildSessionInstructions(): string {
    return [
      "You are Klak, a concise local-first desktop assistant.",
      "Your connected action tools include app resolution, app discovery, folder opening, and URL opening.",
      "Do not claim unsupported capabilities such as phone calls, mouse control, keyboard control, screenshots, messaging, deleting files, quitting apps, or unrestricted terminal access.",
      "Do not claim an action has succeeded when you only created an approval preview.",
      "If an action requires approval, say it is waiting for approval in Klak and do not claim success yet.",
      "If approval is pending and the user's reply is unclear, ask for a clear yes or no.",
      "If a tool result says completed, briefly confirm success.",
      "If a tool result says blocked, denied, failed, or unsupported, explain that honestly.",
      "If the user asks for a capability that is not connected, say that capability is not connected yet."
    ].join(" ");
  }

  async handleFunctionCall(call: RealtimeVoiceFunctionCall): Promise<RealtimeVoiceFunctionCallResolution> {
    this.callbacks.onDiagnostic?.(
      "function_call_received",
      `call_id=${call.callId} response_id=${call.responseId} item_id=${call.outputItemId} name=${call.name}`
    );

    if (this.pendingAction) {
      return { kind: "blocked", message: "Another action preview is already pending approval." };
    }

    try {
      const action = await this.resolveFunctionCall(call);
      const preview = await buildKlakActionPreview(action, this.settings);
      if (!preview) {
        return { kind: "blocked", message: "That capability is not connected yet." };
      }
      if (!preview.canRun) {
        return { kind: "blocked", message: blockedReason(preview) };
      }

      if (!preview.requiresConfirmation) {
        const resultSummary = await executeKlakAction(preview, this.settings);
        this.callbacks.onDiagnostic?.(
          "result_returned_to_realtime",
          `call_id=${call.callId} response_id=${call.responseId} item_id=${call.outputItemId} status=completed`
        );
        return { kind: "completed", message: resultSummary, preview: null };
      }

      this.pendingAction = this.createPendingAction(call, preview);
      this.callbacks.onPreviewChanged(preview);
      this.callbacks.onDiagnostic?.(
        "action_proposal_created",
        `call_id=${call.callId} response_id=${call.responseId} item_id=${call.outputItemId} preview_id=${preview.id}`
      );
      this.callbacks.onDiagnostic?.(
        "approval_pending",
        `call_id=${call.callId} response_id=${call.responseId} item_id=${call.outputItemId} preview_id=${preview.id}`
      );

      return {
        kind: "pending",
        message: pendingMessage(preview),
        preview
      };
    } catch (error) {
      return { kind: "failed", message: error instanceof Error ? error.message : String(error) };
    }
  }

  getPendingAction(): ActionPreview | null {
    return this.pendingAction?.preview ?? null;
  }

  getPendingCallId(): string | null {
    return this.pendingAction?.call.callId ?? null;
  }

  async approvePendingAction(): Promise<RealtimeVoiceOperatorUpdate | null> {
    const pending = this.ensurePendingAction();
    if (!pending) return null;
    pending.resolved = true;

    await approveAction(pending.preview.id);
    try {
      const resultSummary = await executeKlakAction(pending.preview, this.settings);
      await this.noteProjectTouchForPreview(pending.preview);
      return this.finishPendingAction("completed", resultSummary);
    } catch (error) {
      this.callbacks.onDiagnostic?.(
        "execution_failed",
        `call_id=${pending.call.callId} response_id=${pending.call.responseId} item_id=${pending.call.outputItemId} preview_id=${pending.preview.id}`
      );
      this.clearPendingAction();
      return {
        sessionGeneration: pending.call.sessionGeneration,
        responseId: pending.call.responseId,
        outputItemId: pending.call.outputItemId,
        callId: pending.call.callId,
        functionName: pending.call.name,
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
        preview: null
      };
    }
  }

  async denyPendingAction(): Promise<RealtimeVoiceOperatorUpdate | null> {
    const pending = this.ensurePendingAction();
    if (!pending) return null;
    pending.resolved = true;

    await denyAction(pending.preview.id);
    return this.finishPendingAction("denied", "The user denied the request.");
  }

  async resolveVoiceApproval(transcript: string): Promise<RealtimeVoiceOperatorUpdate | null> {
    const pending = this.ensurePendingAction();
    if (!pending) return null;

    const match = matchVoiceApprovalTranscript(transcript);
    if (match === "approve") return this.approvePendingAction();
    if (match === "deny") return this.denyPendingAction();
    return null;
  }

  clearPendingAction(): void {
    this.cancelPendingTimer();
    this.pendingAction = null;
    this.callbacks.onPreviewChanged(null);
  }

  private createPendingAction(call: RealtimeVoiceFunctionCall, preview: ActionPreview): PendingVoiceAction {
    const createdAt = Date.now();
    const pending: PendingVoiceAction = {
      call,
      preview,
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: createdAt + defaultApprovalTimeoutMs,
      resolved: false,
      expireTimer: null
    };
    pending.expireTimer = window.setTimeout(() => {
      if (!this.pendingAction || this.pendingAction.call.callId !== call.callId || this.pendingAction.resolved) return;
      this.callbacks.onDiagnostic?.(
        "approval_expired",
        `call_id=${call.callId} response_id=${call.responseId} item_id=${call.outputItemId} preview_id=${preview.id}`
      );
      void denyAction(preview.id).catch(() => undefined);
      this.clearPendingAction();
    }, defaultApprovalTimeoutMs);
    return pending;
  }

  private ensurePendingAction(): PendingVoiceAction | null {
    if (!this.pendingAction) return null;
    if (this.pendingAction.resolved) return null;
    if (Date.now() >= this.pendingAction.expiresAt) {
      this.callbacks.onDiagnostic?.(
        "approval_expired",
        `call_id=${this.pendingAction.call.callId} response_id=${this.pendingAction.call.responseId} item_id=${this.pendingAction.call.outputItemId} preview_id=${this.pendingAction.preview.id}`
      );
      void denyAction(this.pendingAction.preview.id).catch(() => undefined);
      this.clearPendingAction();
      return null;
    }
    return this.pendingAction;
  }

  private async finishPendingAction(status: RealtimeVoiceOperatorStatus, messageOverride?: string): Promise<RealtimeVoiceOperatorUpdate> {
    const pending = this.pendingAction;
    if (!pending) {
      throw new Error("No pending voice action is available.");
    }
    pending.resolved = true;
    this.cancelPendingTimer();

    const message =
      messageOverride ??
      (status === "completed"
        ? `${pending.preview.tool.label} completed successfully.`
        : status === "denied"
          ? `${pending.preview.tool.label} was denied, so Klak did not run it.`
          : `${pending.preview.tool.label} ${status}.`);

    if (status === "completed") {
      this.callbacks.onDiagnostic?.(
        "execution_completed",
        `call_id=${pending.call.callId} response_id=${pending.call.responseId} item_id=${pending.call.outputItemId} preview_id=${pending.preview.id}`
      );
      this.clearPendingAction();
      return {
        sessionGeneration: pending.call.sessionGeneration,
        responseId: pending.call.responseId,
        outputItemId: pending.call.outputItemId,
        callId: pending.call.callId,
        functionName: pending.call.name,
        status: "completed",
        message: messageOverride || message,
        preview: null
      };
    }

    this.callbacks.onDiagnostic?.(
      status === "denied" ? "action_denied" : "action_finished",
      `call_id=${pending.call.callId} response_id=${pending.call.responseId} item_id=${pending.call.outputItemId} preview_id=${pending.preview.id}`
    );
    this.clearPendingAction();
    return {
      sessionGeneration: pending.call.sessionGeneration,
      responseId: pending.call.responseId,
      outputItemId: pending.call.outputItemId,
      callId: pending.call.callId,
      functionName: pending.call.name,
      status,
      message,
      preview: null
    };
  }

  private async noteProjectTouchForPreview(preview: ActionPreview): Promise<void> {
    if (preview.tool.name === "open_folder") {
      const path = String(preview.input.path ?? "");
      const project = await resolveProjectForPath(path);
      if (project) await touchProject(project.id);
    }
  }

  private async resolveFunctionCall(call: RealtimeVoiceFunctionCall) {
    const parsed = parseArguments(call);

    if (call.name === "resolve_app_action") {
      const action = normalizeAppAction(String(parsed.action ?? "open"));
      const resolution = await resolveAppAction(String(parsed.app_name ?? ""), action, this.settings);
      return {
        toolName: "resolve_app_action",
        input: {
          app_name: resolution.app_name,
          action: resolution.action,
          resolution
        }
      };
    }

    if (call.name === "scan_installed_apps") {
      return {
        toolName: "scan_installed_apps",
        input: { registered_executable_paths: [] }
      };
    }

    if (call.name === "open_allowed_folder") {
      const path = await resolveAllowedFolder(String(parsed.folder_name_or_path ?? ""));
      if (!path) {
        throw new Error("The folder is not in Klak's allowed folders list, so the request was blocked.");
      }
      return {
        toolName: "open_folder",
        input: { path }
      };
    }

    if (call.name === "open_url") {
      return {
        toolName: "open_url",
        input: { url: validateHttpUrl(String(parsed.url ?? "")) }
      };
    }

    throw new Error("That capability is not connected yet.");
  }

  private cancelPendingTimer(): void {
    if (!this.pendingAction?.expireTimer) return;
    window.clearTimeout(this.pendingAction.expireTimer);
    this.pendingAction.expireTimer = null;
  }
}

function functionTool(name: string, label: string, description: string, parameters: Record<string, unknown>) {
  return {
    type: "function",
    name,
    description,
    parameters
  };
}

function stringProperty(description: string) {
  return { type: "string", description };
}

function objectSchema(properties: Record<string, unknown>, required: string[]) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false
  };
}

function parseArguments(call: RealtimeVoiceFunctionCall): Record<string, unknown> {
  const parsed = JSON.parse(call.argumentsJson) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The tool arguments were invalid, so the request was blocked.");
  }
  return parsed;
}

function normalizeLookup(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeAppAction(action: string): "open" | "register" | "register_and_open" | "check_installed" {
  if (action === "register") return "register";
  if (action === "register_and_open") return "register_and_open";
  if (action === "check_installed") return "check_installed";
  return "open";
}

async function resolveAllowedFolder(folderNameOrPath: string): Promise<string | null> {
  const lookup = normalizeLookup(folderNameOrPath);
  if (!lookup) return null;

  const folders = await listAllowedFolders();
  for (const folder of folders) {
    const path = folder.path.trim();
    const label = folder.label?.trim() ?? "";
    const leaf = path.split(/[\\/]/).pop() ?? "";
    if ([path, label, leaf].some((candidate) => candidate && normalizeLookup(candidate) === lookup)) {
      return path;
    }
  }

  const partialFolder = folders.filter((folder) => {
    const path = folder.path.trim();
    const label = folder.label?.trim() ?? "";
    const leaf = path.split(/[\\/]/).pop() ?? "";
    return [path, label, leaf].some((candidate) => candidate && normalizeLookup(candidate).includes(lookup));
  });
  if (partialFolder.length === 1) return partialFolder[0].path.trim();

  const projects = await searchProjects(folderNameOrPath);
  const exactProject = projects.find((project) => project.repo_path && normalizeLookup(project.name) === lookup);
  if (exactProject?.repo_path) return exactProject.repo_path;
  if (projects.length === 1 && projects[0]?.repo_path) return projects[0].repo_path;
  return null;
}

async function resolveProjectForPath(path: string) {
  const projects = await searchProjects(path);
  return projects.find((project) => project.repo_path?.trim().toLowerCase() === path.trim().toLowerCase()) ?? null;
}

function pendingMessage(preview: ActionPreview): string {
  if (preview.tool.name === "resolve_app_action") {
    return String(preview.message ?? "I resolved the app action.");
  }
  if (preview.tool.name === "launch_app" || preview.tool.name === "register_and_launch_app") {
    return `I found ${String(preview.input.app_name ?? "that app")}. It needs your approval to register or open it. Say yes to approve or no to cancel.`;
  }
  if (preview.tool.name === "register_discovered_app") {
    return `I found ${String(preview.input.app_name ?? "that app")}. Please approve the registration in Klak. Say yes to approve or no to cancel.`;
  }
  if (preview.tool.name === "set_registered_app_allowed") {
    return `${String(preview.input.app_name ?? "That app")} needs your approval before Klak changes its allowed state. Say yes to approve or no to cancel.`;
  }
  if (preview.tool.name === "open_folder") {
    return "I found that allowed folder. Please approve opening it in Klak. Say yes to approve or no to cancel.";
  }
  if (preview.tool.name === "open_url") {
    return `I can open ${String(preview.input.url ?? "that URL")}, but it is waiting for approval in Klak. Say yes to approve or no to cancel.`;
  }
  return `${preview.tool.label} is waiting for approval in Klak.`;
}

function blockedReason(preview: ActionPreview): string {
  const reason = String(preview.input.blocked_reason ?? "").trim();
  return reason || "The request was blocked by Klak's current permissions or safety policy.";
}
