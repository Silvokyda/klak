import { invoke } from "@tauri-apps/api/core";
import type { ProcessObservation, WindowObservation } from "../../types";

export async function listOpenWindows(): Promise<WindowObservation[]> {
  return invoke<WindowObservation[]>("list_open_windows");
}

export async function listVisibleProcesses(): Promise<ProcessObservation[]> {
  return invoke<ProcessObservation[]>("list_visible_processes");
}

export async function focusWindow(title: string): Promise<void> {
  await invoke("focus_window_by_title", { input: { title } });
}
