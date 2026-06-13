import { openUrl } from "@tauri-apps/plugin-opener";
import type { ActionPreview, AppSettings, MemoryType } from "../../types";
import { createMemory } from "../memory/memoryRepository";
import { updateActionLog } from "../logs/actionLogRepository";
import { nowIso } from "../utils";

export async function executeApprovedTool(preview: ActionPreview, settings: AppSettings): Promise<void> {
  if (!preview.canRun) return;
  await updateActionLog(preview.id, { status: "running" });

  try {
    if (preview.tool.name === "open_url") {
      await openUrl(String(preview.input.url));
    } else if (preview.tool.name === "create_memory") {
      await createMemory({
        type: String(preview.input.type ?? "preference") as MemoryType,
        title: String(preview.input.title ?? "Untitled memory"),
        content: String(preview.input.content ?? ""),
        source: String(preview.input.source ?? "action_preview")
      });
    } else if (preview.tool.name === "search_memory") {
      return;
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
