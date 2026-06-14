import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AppSettings } from "../../types";

export interface WakeListenerStatus {
  running: boolean;
  message: string;
}

export async function syncWakeListener(settings: AppSettings): Promise<WakeListenerStatus> {
  if (!isTauri()) {
    return { running: false, message: "Wake word requires the native Klak desktop app." };
  }

  if (!settings.wakeWordEnabled) {
    await invoke("stop_wake_listener");
    return { running: false, message: "Wake word disabled." };
  }

  return invoke<WakeListenerStatus>("start_wake_listener", {
    input: {
      python_executable_path: settings.wakeWordPythonPath,
      model_name: settings.wakeWordModel,
      custom_model_path: settings.wakeWordCustomModelPath || null,
      threshold: settings.wakeWordThreshold
    }
  });
}

export async function stopWakeListener(): Promise<void> {
  if (isTauri()) await invoke("stop_wake_listener");
}
