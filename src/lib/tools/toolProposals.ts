import type { AppSettings, ToolActionInput } from "../../types";
import { createActionPreview } from "../permissions/policy";
import { getRegisteredAppById, validateExecutablePath } from "../apps/registeredAppsRepository";
import { getCommandTemplateById, isLongRunningCommand, validateCommandSafety } from "../commands/commandTemplateRepository";
import { listRunningBackgroundProcesses } from "../processes/backgroundProcessRepository";
import { listTools } from "./toolRegistry";
import {
  assertAllowedFolder,
  assertPathInsideAllowedFolder,
  safeClipboardPreview,
  sanitizeFileName,
  validateHttpUrl,
  looksSensitive
} from "./safeToolUtils";

export async function buildActionPreviewForSuggestion(action: ToolActionInput, settings: AppSettings) {
  const tools = await listTools(settings.allToolsDisabled);
  let tool = tools.find((item) => item.name === action.toolName);
  if (!tool) return null;

  try {
    const input = await normalizeInput(action, settings);
    if (action.toolName === "run_command_template" && typeof input.risk_level === "string") {
      tool = { ...tool, riskLevel: input.risk_level as typeof tool.riskLevel };
    }
    if (action.toolName === "start_background_process" && typeof input.risk_level === "string") {
      tool = { ...tool, riskLevel: input.risk_level as typeof tool.riskLevel };
    }
    return createActionPreview(tool, input, settings);
  } catch (error) {
    return createActionPreview(
      { ...tool, enabled: false },
      {
        ...action.input,
        blocked_reason: error instanceof Error ? error.message : String(error)
      },
      settings
    );
  }
}

async function normalizeInput(action: ToolActionInput, settings: AppSettings): Promise<Record<string, unknown>> {
  if (action.toolName === "open_url") {
    return { ...action.input, url: validateHttpUrl(action.input.url) };
  }
  if (action.toolName === "open_folder") {
    const path = await assertAllowedFolder(String(action.input.path ?? ""), settings);
    return { ...action.input, path };
  }
  if (action.toolName === "create_note") {
    const destinationFolder = String(action.input.destinationFolder ?? action.input.folder ?? "");
    const title = String(action.input.title ?? "Klak Note");
    const fileName = `${sanitizeFileName(String(action.input.fileName ?? title))}.md`;
    const separator = destinationFolder.includes("/") && !destinationFolder.includes("\\") ? "/" : "\\";
    const path = String(action.input.path ?? `${destinationFolder.replace(/[\\/]+$/g, "")}${separator}${fileName}`);
    await assertPathInsideAllowedFolder(path, settings);
    return { ...action.input, title, fileName, path };
  }
  if (action.toolName === "copy_to_clipboard") {
    const text = String(action.input.text ?? "");
    return { ...action.input, text, preview: safeClipboardPreview(text) };
  }
  if (action.toolName === "search_memory") {
    return { query: String(action.input.query ?? "") };
  }
  if (action.toolName === "create_memory") {
    const content = String(action.input.content ?? "");
    if (looksSensitive(content)) {
      throw new Error("Klak will not save content that appears to contain secrets as memory.");
    }
    return action.input;
  }
  if (action.toolName === "launch_app") {
    const registeredAppId = String(action.input.registered_app_id ?? "");
    const app = await getRegisteredAppById(registeredAppId);
    if (!app) throw new Error("Klak can only launch apps that are registered locally.");
    if (!app.allowed) throw new Error("This registered app is disabled.");
    validateExecutablePath(app.executable_path);
    return {
      registered_app_id: app.id,
      app_name: app.name,
      executable_path: app.executable_path,
      app_type: app.app_type
    };
  }
  if (action.toolName === "run_command_template") {
    const commandTemplateId = String(action.input.command_template_id ?? "");
    const template = await getCommandTemplateById(commandTemplateId);
    if (!template) throw new Error("Klak can only run saved command templates.");
    if (!template.enabled) throw new Error("This command template is disabled.");
    if (isLongRunningCommand(template.command)) throw new Error("Long-running command templates are blocked until background process management exists.");
    validateCommandSafety(template.command);
    await assertPathInsideAllowedFolder(template.working_directory, settings);
    return {
      command_template_id: template.id,
      command_name: template.name,
      command: template.command,
      working_directory: template.working_directory,
      command_type: template.command_type,
      risk_level: template.risk_level,
      timeout_seconds: template.timeout_seconds
    };
  }
  if (action.toolName === "start_background_process") {
    const commandTemplateId = String(action.input.command_template_id ?? "");
    const template = await getCommandTemplateById(commandTemplateId);
    if (!template) throw new Error("Klak can only start saved command templates.");
    if (!template.enabled) throw new Error("This command template is disabled.");
    if (!template.is_long_running || !template.allow_background_run) throw new Error("This command template is not approved for background runs.");
    validateCommandSafety(template.command);
    await assertPathInsideAllowedFolder(template.working_directory, settings);
    const running = await listRunningBackgroundProcesses();
    if (running.some((process) => process.command_template_id === template.id)) {
      throw new Error("A background process for this command template is already running.");
    }
    return {
      command_template_id: template.id,
      project_id: template.project_id ?? null,
      command_name: template.name,
      command: template.command,
      working_directory: template.working_directory,
      command_type: template.command_type,
      risk_level: template.risk_level,
      max_runtime_seconds: template.max_runtime_seconds ?? null,
      auto_stop_on_app_exit: template.auto_stop_on_app_exit
    };
  }
  return action.input;
}
