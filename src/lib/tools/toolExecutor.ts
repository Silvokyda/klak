import { invoke } from "@tauri-apps/api/core";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import type { ActionPreview, AppSettings, MemoryType } from "../../types";
import { touchRegisteredApp, validateExecutablePath } from "../apps/registeredAppsRepository";
import { touchCommandTemplate, validateCommandSafety, type CommandRunResult } from "../commands/commandTemplateRepository";
import { createMemory } from "../memory/memoryRepository";
import { updateActionLog } from "../logs/actionLogRepository";
import { nowIso } from "../utils";
import { searchMemories } from "../memory/memoryRepository";
import {
  assertAllowedFolder,
  assertPathInsideAllowedFolder,
  buildNoteMarkdown,
  looksSensitive,
  normalizeMemoryType,
  validateHttpUrl
} from "./safeToolUtils";

export async function executeApprovedTool(preview: ActionPreview, settings: AppSettings): Promise<void> {
  if (!preview.canRun) return;
  await updateActionLog(preview.id, { status: "running" });

  try {
    if (preview.tool.name === "open_url") {
      await openUrl(validateHttpUrl(preview.input.url));
    } else if (preview.tool.name === "open_folder") {
      const path = await assertAllowedFolder(String(preview.input.path ?? ""), settings);
      await openPath(path);
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
    } else if (preview.tool.name === "search_memory") {
      await searchMemories(String(preview.input.query ?? ""));
    } else if (preview.tool.name === "create_note") {
      const path = await assertPathInsideAllowedFolder(String(preview.input.path ?? ""), settings);
      await invoke("create_markdown_note", {
        path,
        content: buildNoteMarkdown(String(preview.input.title ?? "Klak Note"), String(preview.input.content ?? ""))
      });
    } else if (preview.tool.name === "copy_to_clipboard") {
      await invoke("copy_text_to_clipboard", { text: String(preview.input.text ?? "") });
    } else if (preview.tool.name === "launch_app") {
      validateExecutablePath(String(preview.input.executable_path ?? ""));
      await invoke("launch_registered_app", {
        input: { executable_path: String(preview.input.executable_path) }
      });
      await touchRegisteredApp(String(preview.input.registered_app_id ?? ""));
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
    } else {
      throw new Error(`${preview.tool.label} is registered but execution is stubbed in this MVP.`);
    }

    await updateActionLog(preview.id, {
      status: "completed",
      user_approved: true,
      completed_at: nowIso()
    });
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

function summarizeCommandResult(result: CommandRunResult): string {
  const status = result.timed_out ? "timed out" : `exit ${result.exit_code ?? "unknown"}`;
  const output = (result.stderr || result.stdout).trim().slice(0, 500);
  return `Command ${status} in ${result.duration_ms}ms${output ? `: ${output}` : ""}`;
}
