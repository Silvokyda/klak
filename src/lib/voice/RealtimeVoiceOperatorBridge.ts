import type { ActionPreview, AppSettings, RegisteredAppRecord } from "../../types";
import { listRegisteredApps } from "../apps/registeredAppsRepository";
import { createActionLog } from "../logs/actionLogRepository";
import { approveAction, denyAction } from "../permissions/policy";
import { searchProjects, touchProject } from "../projects/projectRepository";
import { listAllowedFolders } from "../storage/allowedFoldersRepository";
import { executeApprovedTool } from "../tools/toolExecutor";
import { buildActionPreviewForSuggestion } from "../tools/toolProposals";
import { validateHttpUrl } from "../tools/safeToolUtils";

export type RealtimeVoiceOperatorStatus =
  | "pending"
  | "approved"
  | "denied"
  | "completed"
  | "failed"
  | "blocked";

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

interface PendingVoiceAction {
  preview: ActionPreview;
  call: RealtimeVoiceFunctionCall;
}

interface BridgeCallbacks {
  onPreviewChanged: (preview: ActionPreview | null) => void;
  onDiagnostic?: (code: string, message: string) => void;
}

export class RealtimeVoiceOperatorBridge {
  private pendingAction: PendingVoiceAction | null = null;

  constructor(
    private readonly settings: AppSettings,
    private readonly callbacks: BridgeCallbacks
  ) {}

  getRealtimeTools() {
    return [
      {
        type: "function",
        name: "launch_registered_app",
        description: "Create an approval preview to launch a registered and enabled desktop application by name.",
        parameters: objectSchema(
          {
            app_name: {
              type: "string",
              description: "The registered application name, for example Google Chrome."
            }
          },
          ["app_name"]
        )
      },
      {
        type: "function",
        name: "open_allowed_folder",
        description: "Create an approval preview to open an existing allowed folder by label, project name, or exact path.",
        parameters: objectSchema(
          {
            folder_name_or_path: {
              type: "string",
              description: "An allowed folder label, a known project name, or an exact allowed folder path."
            }
          },
          ["folder_name_or_path"]
        )
      },
      {
        type: "function",
        name: "open_url",
        description: "Create an approval preview to open a valid http or https URL.",
        parameters: objectSchema(
          {
            url: {
              type: "string",
              description: "The full http or https URL to open."
            }
          },
          ["url"]
        )
      }
    ];
  }

  buildSessionInstructions(): string {
    return [
      "You are Klak, a concise local-first desktop assistant.",
      "Your only connected action tools in this realtime session are launch_registered_app, open_allowed_folder, and open_url.",
      "Do not claim unsupported capabilities such as phone calls, mouse control, keyboard control, screenshots, messaging, deleting files, quitting apps, or unrestricted terminal access.",
      "Do not claim an action has succeeded when you only created an approval preview.",
      "If a tool result says pending approval, tell the user it is waiting for approval in Klak.",
      "If a tool result says completed, briefly confirm success.",
      "If a tool result says blocked, denied, failed, or unsupported, explain that honestly.",
      "If the user asks for a capability that is not connected, say that capability is not connected yet."
    ].join(" ");
  }

  async handleFunctionCall(call: RealtimeVoiceFunctionCall): Promise<RealtimeVoiceOperatorUpdate> {
    this.callbacks.onDiagnostic?.(
      "function_call_received",
      `call_id=${call.callId} response_id=${call.responseId} item_id=${call.outputItemId} name=${call.name}`
    );

    if (this.pendingAction) {
      return this.blockedUpdate(call, "Another action preview is already pending approval.");
    }

    try {
      const action = await this.resolveFunctionCall(call);
      const preview = await buildActionPreviewForSuggestion(action, this.settings);
      if (!preview) {
        return this.blockedUpdate(call, "That capability is not connected yet.");
      }
      if (!preview.canRun) {
        return this.blockedUpdate(call, blockedReason(preview));
      }

      this.pendingAction = { preview, call };
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
        sessionGeneration: call.sessionGeneration,
        responseId: call.responseId,
        outputItemId: call.outputItemId,
        callId: call.callId,
        functionName: call.name,
        status: "pending",
        message: pendingMessage(preview),
        preview
      };
    } catch (error) {
      return this.failedUpdate(call, error instanceof Error ? error.message : String(error));
    }
  }

  async approvePendingAction(): Promise<RealtimeVoiceOperatorUpdate | null> {
    if (!this.pendingAction) return null;
    const pending = this.pendingAction;
    this.callbacks.onDiagnostic?.(
      "action_approved",
      `call_id=${pending.call.callId} response_id=${pending.call.responseId} item_id=${pending.call.outputItemId} preview_id=${pending.preview.id}`
    );

    await approveAction(pending.preview.id);
    const approvedUpdate: RealtimeVoiceOperatorUpdate = {
      sessionGeneration: pending.call.sessionGeneration,
      responseId: pending.call.responseId,
      outputItemId: pending.call.outputItemId,
      callId: pending.call.callId,
      functionName: pending.call.name,
      status: "approved",
      message: `${pending.preview.tool.label} was approved. Klak is running it now.`,
      preview: pending.preview
    };

    try {
      const resultSummary = await executeApprovedTool(pending.preview, this.settings);
      if (pending.preview.tool.name === "open_folder") {
        const project = await resolveProjectForPath(String(pending.preview.input.path ?? ""));
        if (project) {
          await touchProject(project.id);
        }
      }
      this.callbacks.onDiagnostic?.(
        "execution_completed",
        `call_id=${pending.call.callId} response_id=${pending.call.responseId} item_id=${pending.call.outputItemId} preview_id=${pending.preview.id}`
      );
      this.clearPendingPreview();
      return {
        ...approvedUpdate,
        status: "completed",
        message: resultSummary,
        preview: null
      };
    } catch (error) {
      this.callbacks.onDiagnostic?.(
        "execution_failed",
        `call_id=${pending.call.callId} response_id=${pending.call.responseId} item_id=${pending.call.outputItemId} preview_id=${pending.preview.id}`
      );
      this.clearPendingPreview();
      return {
        ...approvedUpdate,
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
        preview: null
      };
    }
  }

  async denyPendingAction(): Promise<RealtimeVoiceOperatorUpdate | null> {
    if (!this.pendingAction) return null;
    const pending = this.pendingAction;
    await denyAction(pending.preview.id);
    this.callbacks.onDiagnostic?.(
      "action_denied",
      `call_id=${pending.call.callId} response_id=${pending.call.responseId} item_id=${pending.call.outputItemId} preview_id=${pending.preview.id}`
    );
    this.clearPendingPreview();
    return {
      sessionGeneration: pending.call.sessionGeneration,
      responseId: pending.call.responseId,
      outputItemId: pending.call.outputItemId,
      callId: pending.call.callId,
      functionName: pending.call.name,
      status: "denied",
      message: `${pending.preview.tool.label} was denied, so Klak did not run it.`,
      preview: null
    };
  }

  clearPendingAction(): void {
    this.clearPendingPreview();
  }

  private clearPendingPreview(): void {
    this.pendingAction = null;
    this.callbacks.onPreviewChanged(null);
  }

  private async resolveFunctionCall(call: RealtimeVoiceFunctionCall) {
    const parsed = parseArguments(call);
    if (call.name === "launch_registered_app") {
      const app = await resolveRegisteredApp(String(parsed.app_name ?? ""));
      if (!app) {
        throw new Error("The application is not registered, so the request was blocked.");
      }
      if (!app.allowed) {
        throw new Error("The application is registered but disabled, so the request was blocked.");
      }
      return {
        toolName: "launch_app",
        input: { registered_app_id: app.id }
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
        input: { url: validateHttpUrl(parsed.url) }
      };
    }

    throw new Error("That capability is not connected yet.");
  }

  private blockedUpdate(call: RealtimeVoiceFunctionCall, message: string): RealtimeVoiceOperatorUpdate {
    this.callbacks.onDiagnostic?.(
      "result_returned_to_realtime",
      `call_id=${call.callId} response_id=${call.responseId} item_id=${call.outputItemId} status=blocked`
    );
    void createActionLog({
      tool_name: `realtime_${call.name}`,
      input_summary: `call_id=${call.callId}`,
      risk_level: "medium",
      status: "blocked",
      user_approved: null,
      error_message: message
    }).catch(() => undefined);
    return {
      sessionGeneration: call.sessionGeneration,
      responseId: call.responseId,
      outputItemId: call.outputItemId,
      callId: call.callId,
      functionName: call.name,
      status: "blocked",
      message
    };
  }

  private failedUpdate(call: RealtimeVoiceFunctionCall, message: string): RealtimeVoiceOperatorUpdate {
    this.callbacks.onDiagnostic?.(
      "result_returned_to_realtime",
      `call_id=${call.callId} response_id=${call.responseId} item_id=${call.outputItemId} status=failed`
    );
    return {
      sessionGeneration: call.sessionGeneration,
      responseId: call.responseId,
      outputItemId: call.outputItemId,
      callId: call.callId,
      functionName: call.name,
      status: "failed",
      message
    };
  }
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

async function resolveRegisteredApp(appName: string): Promise<RegisteredAppRecord | null> {
  const lookup = normalizeLookup(appName);
  if (!lookup) return null;
  const apps = await listRegisteredApps({ allowed: true });
  const exact = apps.find((app) => normalizeLookup(app.name) === lookup);
  if (exact) return exact;

  const contains = apps.filter((app) => normalizeLookup(app.name).includes(lookup));
  if (contains.length === 1) return contains[0];
  return null;
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
  if (preview.tool.name === "launch_app") {
    return `I found ${String(preview.input.app_name ?? "that registered app")}. Please approve the launch in Klak.`;
  }
  if (preview.tool.name === "open_folder") {
    return "I found that allowed folder. Please approve opening it in Klak.";
  }
  if (preview.tool.name === "open_url") {
    return `I can open ${String(preview.input.url ?? "that URL")}, but it is waiting for approval in Klak.`;
  }
  return "The action preview is ready and waiting for approval in Klak.";
}

function blockedReason(preview: ActionPreview): string {
  const reason = String(preview.input.blocked_reason ?? "").trim();
  return reason || "The request was blocked by Klak's current permissions or safety policy.";
}
