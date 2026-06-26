import { invoke } from "@tauri-apps/api/core";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import type { ActionPreview, AppSettings, MemoryType } from "../../types";
import {
  createRegisteredApp,
  getRegisteredAppById,
  touchRegisteredApp,
  updateRegisteredApp,
  validateExecutablePath
} from "../apps/registeredAppsRepository";
import { touchCommandTemplate, validateCommandSafety, type CommandRunResult } from "../commands/commandTemplateRepository";
import { createBackgroundProcess, listRunningBackgroundProcesses, updateBackgroundProcess } from "../processes/backgroundProcessRepository";
import { createMemory } from "../memory/memoryRepository";
import { updateActionLog } from "../logs/actionLogRepository";
import { nowIso } from "../utils";
import { searchMemories } from "../memory/memoryRepository";
import { scanInstalledApps } from "../apps/appDiscoveryService";
import { resolveAppAction, type AppActionResolution } from "../apps/appActionResolver";
import {
  assertAllowedFolder,
  assertPathInsideAllowedFolder,
  buildNoteMarkdown,
  looksSensitive,
  normalizeMemoryType,
  validateHttpUrl
} from "./safeToolUtils";

export async function executeApprovedTool(preview: ActionPreview, settings: AppSettings): Promise<string> {
  if (!preview.canRun) return "Tool execution was skipped because the preview is blocked.";
  await updateActionLog(preview.id, { status: "running" });

  try {
    if (preview.tool.name === "scan_installed_apps") {
      const result = await scanInstalledApps(settings);
      const names = result.slice(0, 5).map((candidate) => candidate.name).filter(Boolean);
      await updateActionLog(preview.id, {
        status: "completed",
        user_approved: true,
        completed_at: nowIso(),
        error_message: `Found ${result.length} candidate(s). ${names.length ? `Matches: ${names.join(", ")}.` : ""}`.trim()
      });
      return names.length
        ? `Found ${result.length} safe app candidate(s): ${names.join(", ")}.`
        : `Found ${result.length} safe app candidate(s).`;
    } else if (preview.tool.name === "resolve_app_action") {
      const appName = String(preview.input.app_name ?? "");
      const action = normalizeAppAction(preview.input.action);
      const resolution: AppActionResolution =
        preview.input.resolution && typeof preview.input.resolution === "object"
          ? (preview.input.resolution as AppActionResolution)
          : await resolveAppAction(appName, action, settings);

      if (resolution.status === "check_installed") {
        const names = resolution.matches.map((match) => match.name).slice(0, 8);
        await updateActionLog(preview.id, {
          status: "completed",
          user_approved: true,
          completed_at: nowIso()
        });
        return names.length
          ? `Found ${resolution.matches.length} matching installed app(s): ${names.join(", ")}.`
          : `I did not find a safe installed app named ${appName}.`;
      }

      const selected = resolution.selected;
      if (!selected) {
        throw new Error(resolution.message || "No app match was selected.");
      }

      if (selected.kind === "registered") {
        if (!selected.allowed) throw new Error(`${selected.name} is registered but disabled.`);
        validateExecutablePath(selected.executable_path);
        await invoke("launch_registered_app", { input: { executable_path: selected.executable_path } });
        await touchRegisteredApp(selected.id);
        await updateActionLog(preview.id, {
          status: "completed",
          user_approved: true,
          completed_at: nowIso()
        });
        return `${selected.name} launch completed.`;
      }

      const candidate = selected;
      validateExecutablePath(candidate.executable_path);
      const registered = await createRegisteredApp({
        name: candidate.name,
        executable_path: candidate.executable_path,
        app_type: inferAppTypeFromCandidateName(candidate.name, candidate.source),
        description: candidate.publisher
          ? `Discovered from ${candidate.source}. Publisher: ${candidate.publisher}`
          : `Discovered from ${candidate.source}.`,
        allowed: true
      });

      if (action === "register") {
        await updateActionLog(preview.id, {
          status: "completed",
          user_approved: true,
          completed_at: nowIso()
        });
        return `${registered.name} was registered.`;
      }

      await invoke("launch_registered_app", { input: { executable_path: registered.executable_path } });
      await touchRegisteredApp(registered.id);
      await updateActionLog(preview.id, {
        status: "completed",
        user_approved: true,
        completed_at: nowIso()
      });
      return `${registered.name} was registered and launched.`;
    } else if (preview.tool.name === "register_discovered_app" || preview.tool.name === "register_and_launch_app") {
      const candidate = preview.input.candidate;
      if (!candidate || typeof candidate !== "object") {
        throw new Error("A discovered app candidate is required.");
      }
      const candidateRecord = candidate as {
        name?: string;
        executable_path?: string | null;
        publisher?: string | null;
        source?: string;
      };
      const executablePath = String(candidateRecord.executable_path ?? "").trim();
      if (!executablePath) throw new Error("The discovered app does not have a validated executable path.");
      validateExecutablePath(executablePath);
      const registered = await createRegisteredApp({
        name: String(candidateRecord.name ?? "Discovered app"),
        executable_path: executablePath,
        app_type: inferAppTypeFromCandidateName(String(candidateRecord.name ?? ""), String(candidateRecord.source ?? "")),
        description: candidateRecord.publisher
          ? `Discovered from ${String(candidateRecord.source ?? "safe app sources")}. Publisher: ${candidateRecord.publisher}`
          : `Discovered from ${String(candidateRecord.source ?? "safe app sources")}.`,
        allowed: true
      });
      if (preview.tool.name === "register_and_launch_app") {
        try {
          await invoke("launch_registered_app", { input: { executable_path: registered.executable_path } });
          await touchRegisteredApp(registered.id);
          await updateActionLog(preview.id, {
            status: "completed",
            user_approved: true,
            completed_at: nowIso()
          });
          return `${registered.name} was registered and launched.`;
        } catch (error) {
          await updateActionLog(preview.id, {
            status: "failed",
            user_approved: true,
            completed_at: nowIso(),
            error_message: error instanceof Error ? error.message : String(error)
          });
          throw new Error(`${registered.name} was registered, but the launch failed.`);
        }
      }
      await updateActionLog(preview.id, {
        status: "completed",
        user_approved: true,
        completed_at: nowIso()
      });
      return `${registered.name} was registered.`;
    } else if (preview.tool.name === "set_registered_app_allowed") {
      const registeredAppId = String(preview.input.registered_app_id ?? "");
      const app = await getRegisteredAppById(registeredAppId);
      if (!app) throw new Error("Klak can only update registered apps.");
      const allowed = Boolean(preview.input.allowed ?? true);
      await updateRegisteredApp(app.id, { allowed });
      await updateActionLog(preview.id, {
        status: "completed",
        user_approved: true,
        completed_at: nowIso()
      });
      return `${app.name} was ${allowed ? "enabled" : "disabled"}.`;
    }

    if (preview.tool.name === "open_url") {
      const url = validateHttpUrl(preview.input.url);
      await openUrl(url);
      await updateActionLog(preview.id, {
        status: "completed",
        user_approved: true,
        completed_at: nowIso()
      });
      return `Opened ${url}.`;
    } else if (preview.tool.name === "open_folder") {
      const path = await assertAllowedFolder(String(preview.input.path ?? ""), settings);
      await openPath(path);
      await updateActionLog(preview.id, {
        status: "completed",
        user_approved: true,
        completed_at: nowIso()
      });
      return "Opened the allowed folder.";
    } else if (preview.tool.name === "create_memory") {
      if (looksSensitive(String(preview.input.content ?? ""))) {
        throw new Error("Klak will not save content that appears to contain secrets as memory.");
      }
      await createMemory({
        type: normalizeMemoryType(preview.input.type) as MemoryType,
        title: String(preview.input.title ?? "Untitled memory"),
        content: String(preview.input.content ?? ""),
        source: String(preview.input.source ?? "action_preview")
      });
      await updateActionLog(preview.id, {
        status: "completed",
        user_approved: true,
        completed_at: nowIso()
      });
      return `Saved memory "${String(preview.input.title ?? "Untitled memory")}".`;
    } else if (preview.tool.name === "search_memory") {
      await searchMemories(String(preview.input.query ?? ""));
      await updateActionLog(preview.id, {
        status: "completed",
        user_approved: true,
        completed_at: nowIso()
      });
      return "Completed the local memory search.";
    } else if (preview.tool.name === "create_note") {
      const path = await assertPathInsideAllowedFolder(String(preview.input.path ?? ""), settings);
      await invoke("create_markdown_note", {
        path,
        content: buildNoteMarkdown(String(preview.input.title ?? "Klak Note"), String(preview.input.content ?? ""))
      });
      await updateActionLog(preview.id, {
        status: "completed",
        user_approved: true,
        completed_at: nowIso()
      });
      return `Created "${String(preview.input.title ?? "Klak Note")}".`;
    } else if (preview.tool.name === "copy_to_clipboard") {
      await invoke("copy_text_to_clipboard", { text: String(preview.input.text ?? "") });
      await updateActionLog(preview.id, {
        status: "completed",
        user_approved: true,
        completed_at: nowIso()
      });
      return "Copied the text to the clipboard.";
    } else if (preview.tool.name === "launch_app") {
      validateExecutablePath(String(preview.input.executable_path ?? ""));
      await invoke("launch_registered_app", {
        input: { executable_path: String(preview.input.executable_path) }
      });
      await touchRegisteredApp(String(preview.input.registered_app_id ?? ""));
      await updateActionLog(preview.id, {
        status: "completed",
        user_approved: true,
        completed_at: nowIso()
      });
      return `${String(preview.input.app_name ?? "The application")} launch completed.`;
    } else if (preview.tool.name === "run_command_template") {
      validateCommandSafety(String(preview.input.command ?? ""));
      await assertPathInsideAllowedFolder(String(preview.input.working_directory ?? ""), settings);
      const result = await invoke<CommandRunResult>("run_command_template", {
        input: {
          command_template_id: String(preview.input.command_template_id ?? ""),
          command: String(preview.input.command ?? ""),
          working_directory: String(preview.input.working_directory ?? ""),
          timeout_seconds: Number(preview.input.timeout_seconds ?? 120)
        }
      });
      const summary = summarizeCommandResult(result);
      if (result.timed_out || (result.exit_code ?? 1) !== 0) {
        throw new Error(summary);
      }
      await touchCommandTemplate(String(preview.input.command_template_id ?? ""), summary);
      await updateActionLog(preview.id, {
        status: "completed",
        user_approved: true,
        completed_at: nowIso()
      });
      return summary;
    } else if (preview.tool.name === "start_background_process") {
      validateCommandSafety(String(preview.input.command ?? ""));
      await assertPathInsideAllowedFolder(String(preview.input.working_directory ?? ""), settings);
      const running = await listRunningBackgroundProcesses();
      if (running.some((process) => process.command_template_id === String(preview.input.command_template_id ?? "") && process.working_directory === String(preview.input.working_directory ?? ""))) {
        throw new Error("This saved action is already running for that folder.");
      }
      const process = await createBackgroundProcess({
        command_template_id: String(preview.input.command_template_id ?? ""),
        project_id: preview.input.project_id ? String(preview.input.project_id) : null,
        name: String(preview.input.command_name ?? "Background process"),
        command: String(preview.input.command ?? ""),
        working_directory: String(preview.input.working_directory ?? ""),
        status: "starting",
        output_log_path: `klak-${String(preview.input.command_template_id ?? "process")}-${Date.now()}`
      });
      const result = await invoke<{ process_id: string; pid: number; status: string; output_log_path: string }>("start_background_process", {
        input: {
          process_id: process.id,
          command_template_id: process.command_template_id,
          command: process.command,
          working_directory: process.working_directory,
          output_log_path: process.output_log_path,
          max_runtime_seconds: preview.input.max_runtime_seconds ? Number(preview.input.max_runtime_seconds) : null
        }
      });
      await updateBackgroundProcess(process.id, {
        status: "running",
        process_pid: result.pid,
        output_log_path: result.output_log_path,
        last_output_preview: "Started running activity."
      });
      await touchCommandTemplate(process.command_template_id, `Started running activity pid ${result.pid}`);
      await updateActionLog(preview.id, {
        status: "completed",
        user_approved: true,
        completed_at: nowIso()
      });
      return `Started running activity pid ${result.pid}.`;
    } else {
      throw new Error(`${preview.tool.label} is registered but execution is stubbed in this MVP.`);
    }
  } catch (error) {
    await updateActionLog(preview.id, {
      status: "failed",
      user_approved: true,
      completed_at: nowIso(),
      error_message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

function inferAppTypeFromCandidateName(name: string, source: string) {
  const normalized = `${name} ${source}`.toLowerCase();
  if (/(chrome|edge|browser|firefox|brave|opera|vivaldi)/.test(normalized)) return "browser";
  if (/(code|visual studio|vscode|sublime|notepad\+\+|editor)/.test(normalized)) return "editor";
  if (/(figma|design|canva)/.test(normalized)) return "design";
  if (/(teams|zoom|slack|discord|outlook|mail|chat)/.test(normalized)) return "communication";
  if (/(terminal|cli|sdk|dev|studio|powershell|python|node|cargo|git)/.test(normalized)) return "dev_tool";
  return "other";
}

function normalizeAppAction(action: unknown): "open" | "register" | "register_and_open" | "check_installed" {
  const normalized = String(action ?? "open");
  if (normalized === "register") return "register";
  if (normalized === "register_and_open") return "register_and_open";
  if (normalized === "check_installed") return "check_installed";
  return "open";
}

function summarizeCommandResult(result: CommandRunResult): string {
  const status = result.timed_out ? "timed out" : `exit ${result.exit_code ?? "unknown"}`;
  const output = (result.stderr || result.stdout).trim().slice(0, 500);
  return `Command ${status} in ${result.duration_ms}ms${output ? `: ${output}` : ""}`;
}
