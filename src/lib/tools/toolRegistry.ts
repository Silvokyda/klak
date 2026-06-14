import type { ToolDefinition } from "../../types";
import { getToolSettings, isToolEnabled as getPersistedToolEnabled, setPersistedToolEnabled } from "./toolSettingsRepository";

export const initialTools: ToolDefinition[] = [
  {
    name: "open_url",
    label: "Open URL",
    description: "Open a URL in the default browser.",
    riskLevel: "low",
    enabled: true,
    future: false
  },
  {
    name: "open_folder",
    label: "Open Folder",
    description: "Open a folder that the user has allowed.",
    riskLevel: "medium",
    enabled: true,
    future: false
  },
  {
    name: "create_memory",
    label: "Create Memory",
    description: "Save a memory after approval or an explicit remember request.",
    riskLevel: "medium",
    enabled: true,
    future: false
  },
  {
    name: "search_memory",
    label: "Search Memory",
    description: "Search local memories.",
    riskLevel: "low",
    enabled: true,
    future: false
  },
  {
    name: "create_note",
    label: "Create Note",
    description: "Create a local Markdown note in an allowed folder.",
    riskLevel: "medium",
    enabled: true,
    future: false
  },
  {
    name: "copy_to_clipboard",
    label: "Copy to Clipboard",
    description: "Copy text to the clipboard after preview and confirmation.",
    riskLevel: "medium",
    enabled: true,
    future: false
  },
  {
    name: "launch_app",
    label: "Launch App",
    description: "Launch an app that the user registered and allowed.",
    riskLevel: "medium",
    enabled: true,
    future: false
  },
  {
    name: "run_command_template",
    label: "Run Command Template",
    description: "Run a saved finite command template from an allowed folder.",
    riskLevel: "high",
    enabled: true,
    future: false
  },
  {
    name: "browser_automation",
    label: "Browser Automation",
    description: "Future controlled browser workflows.",
    riskLevel: "high",
    enabled: false,
    future: true
  },
  {
    name: "file_reader",
    label: "File Reader",
    description: "Future allowed file reading.",
    riskLevel: "high",
    enabled: false,
    future: true
  },
  {
    name: "terminal_runner",
    label: "Terminal Runner",
    description: "Future terminal command execution.",
    riskLevel: "dangerous",
    enabled: false,
    future: true
  },
  {
    name: "desktop_clicker",
    label: "Desktop Clicker",
    description: "Future mouse and keyboard automation.",
    riskLevel: "dangerous",
    enabled: false,
    future: true
  },
  {
    name: "cloud_task_runner",
    label: "Cloud Task Runner",
    description: "Future optional cloud operations.",
    riskLevel: "high",
    enabled: false,
    future: true
  }
];

export async function listTools(allToolsDisabled = false): Promise<ToolDefinition[]> {
  const overrides = await getToolSettings();
  return initialTools.map((tool) => ({
    ...tool,
    enabled: allToolsDisabled ? false : overrides[tool.name] ?? tool.enabled
  }));
}

export async function setToolEnabled(toolName: string, enabled: boolean): Promise<void> {
  await setPersistedToolEnabled(toolName, enabled);
}

export async function isToolEnabled(toolName: string): Promise<boolean> {
  const persisted = await getPersistedToolEnabled(toolName);
  return persisted ?? initialTools.find((tool) => tool.name === toolName)?.enabled ?? false;
}
