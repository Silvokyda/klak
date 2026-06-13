import type { AppSettings, ToolActionInput } from "../../types";
import { createActionPreview } from "../permissions/policy";
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
  const tool = tools.find((item) => item.name === action.toolName);
  if (!tool) return null;

  try {
    const input = await normalizeInput(action, settings);
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
  return action.input;
}
