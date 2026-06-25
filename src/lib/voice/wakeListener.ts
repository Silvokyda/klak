import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AppSettings } from "../../types";

export interface WakeListenerStatus {
  running: boolean;
  state: "stopped" | "starting" | "running" | "stopping" | "failed" | string;
  pid: number | null;
  message: string;
  selected_microphone?: string | null;
  latest_error?: string | null;
}

export interface WakeAudioDevice {
  device_index: number;
  device_name: string;
  max_input_channels: number;
  default_sample_rate: number;
  is_default: boolean;
  can_attempt: boolean;
}

export async function syncWakeListener(settings: AppSettings): Promise<WakeListenerStatus> {
  if (!isTauri()) {
    return {
      running: false,
      state: "stopped",
      pid: null,
      message: "Wake word requires the native Klak desktop app."
    };
  }

  if (!settings.wakeWordEnabled) {
    await invoke("stop_wake_listener");
    return { running: false, state: "stopped", pid: null, message: "Wake word disabled." };
  }

  return invoke<WakeListenerStatus>("start_wake_listener", {
    input: {
      python_executable_path: settings.wakeWordPythonPath,
      model_name: settings.wakeWordModel,
      custom_model_path: settings.wakeWordCustomModelPath || null,
      threshold: settings.wakeWordThreshold,
      diagnostics_enabled: settings.wakeWordDiagnosticsEnabled,
      device_name: settings.wakeWordDeviceName || null,
      device_index: settings.wakeWordDeviceIndex
    }
  });
}

export async function stopWakeListener(): Promise<void> {
  if (isTauri()) await invoke("stop_wake_listener");
}

export async function getWakeListenerStatus(): Promise<WakeListenerStatus> {
  if (!isTauri()) {
    return { running: false, state: "stopped", pid: null, message: "Wake word requires the native Klak desktop app." };
  }
  return invoke<WakeListenerStatus>("get_wake_listener_status");
}

export async function listWakeAudioDevices(settings: AppSettings): Promise<WakeAudioDevice[]> {
  if (!isTauri()) return [];
  return invoke<WakeAudioDevice[]>("list_wake_audio_devices", {
    input: {
      python_executable_path: settings.wakeWordPythonPath
    }
  });
}
