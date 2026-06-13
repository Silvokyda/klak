import type { AppSettings, PermissionMode } from "../../types";
import { getDatabase, resetLocalDatabase } from "../db/database";
import { deleteSecret, hasSecret } from "../security/secretStore";
import { nowIso } from "../utils";
import { listAllowedFolders, setAllowedFolders } from "./allowedFoldersRepository";

export type SettingKey =
  | "setup_completed"
  | "ai_provider"
  | "api_base_url"
  | "ai_model"
  | "permission_mode"
  | "cloud_enabled"
  | "clipboard_reading_enabled"
  | "screenshot_enabled"
  | "local_context_enabled"
  | "all_tools_disabled"
  | "current_theme"
  | "voice_enabled"
  | "push_to_talk_enabled"
  | "voice_input_provider"
  | "voice_output_provider"
  | "local_whisper_executable_path"
  | "local_whisper_model_path"
  | "local_whisper_language"
  | "local_whisper_threads"
  | "keep_temp_audio_for_debugging"
  | "microphone_permission_status";

export const defaultSettings: AppSettings = {
  setupComplete: false,
  aiProvider: "openai_compatible",
  apiBaseUrl: "https://api.openai.com/v1",
  modelName: "gpt-4o-mini",
  apiKeyStored: false,
  permissionMode: "act_with_confirmation",
  allowedFolders: [],
  clipboardReadEnabled: false,
  localContextEnabled: false,
  allToolsDisabled: false,
  voiceEnabled: false,
  pushToTalkEnabled: true,
  voiceInputProvider: "disabled",
  voiceOutputProvider: "disabled",
  localWhisperExecutablePath: "",
  localWhisperModelPath: "",
  localWhisperLanguage: "auto",
  localWhisperThreads: 4,
  keepTempAudioForDebugging: false,
  microphonePermissionStatus: "unknown"
};

export async function getSetting(key: SettingKey): Promise<string | null> {
  const db = await getDatabase();
  const rows = await db.select<{ key: string; value: string; updated_at: string }>("SELECT * FROM app_settings WHERE key = ?", [key]);
  return rows[0]?.value ?? null;
}

export async function setSetting(key: SettingKey, value: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, nowIso()]
  );
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const db = await getDatabase();
  const rows = await db.select<{ key: string; value: string }>("SELECT * FROM app_settings");
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export async function setSetupCompleted(value: boolean): Promise<void> {
  await setSetting("setup_completed", String(value));
}

export async function isSetupCompleted(): Promise<boolean> {
  return (await getSetting("setup_completed")) === "true";
}

export async function loadSettings(): Promise<AppSettings> {
  const rows = await getAllSettings();
  const folders = await listAllowedFolders();
  return {
    ...defaultSettings,
    setupComplete: rows.setup_completed === "true",
    aiProvider: (rows.ai_provider as AppSettings["aiProvider"]) || defaultSettings.aiProvider,
    apiBaseUrl: rows.api_base_url || defaultSettings.apiBaseUrl,
    modelName: rows.ai_model || defaultSettings.modelName,
    apiKeyStored: await hasSecret("ai_api_key"),
    permissionMode: (rows.permission_mode as PermissionMode) || defaultSettings.permissionMode,
    allowedFolders: folders.map((folder) => folder.path),
    clipboardReadEnabled: rows.clipboard_reading_enabled === "true",
    localContextEnabled: rows.local_context_enabled === "true",
    allToolsDisabled: rows.all_tools_disabled === "true",
    voiceEnabled: rows.voice_enabled === "true",
    pushToTalkEnabled: rows.push_to_talk_enabled !== "false",
    voiceInputProvider: (rows.voice_input_provider as AppSettings["voiceInputProvider"]) || defaultSettings.voiceInputProvider,
    voiceOutputProvider: (rows.voice_output_provider as AppSettings["voiceOutputProvider"]) || defaultSettings.voiceOutputProvider,
    localWhisperExecutablePath: rows.local_whisper_executable_path || "",
    localWhisperModelPath: rows.local_whisper_model_path || "",
    localWhisperLanguage: rows.local_whisper_language || defaultSettings.localWhisperLanguage,
    localWhisperThreads: Number(rows.local_whisper_threads || defaultSettings.localWhisperThreads),
    keepTempAudioForDebugging: rows.keep_temp_audio_for_debugging === "true",
    microphonePermissionStatus:
      (rows.microphone_permission_status as AppSettings["microphonePermissionStatus"]) ||
      defaultSettings.microphonePermissionStatus
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await Promise.all([
    setSetting("setup_completed", String(settings.setupComplete)),
    setSetting("ai_provider", settings.aiProvider),
    setSetting("api_base_url", settings.apiBaseUrl),
    setSetting("ai_model", settings.modelName),
    setSetting("permission_mode", settings.permissionMode),
    setSetting("clipboard_reading_enabled", String(settings.clipboardReadEnabled)),
    setSetting("local_context_enabled", String(settings.localContextEnabled)),
    setSetting("all_tools_disabled", String(settings.allToolsDisabled)),
    setSetting("voice_enabled", String(settings.voiceEnabled)),
    setSetting("push_to_talk_enabled", String(settings.pushToTalkEnabled)),
    setSetting("voice_input_provider", settings.voiceInputProvider),
    setSetting("voice_output_provider", settings.voiceOutputProvider),
    setSetting("local_whisper_executable_path", settings.localWhisperExecutablePath),
    setSetting("local_whisper_model_path", settings.localWhisperModelPath),
    setSetting("local_whisper_language", settings.localWhisperLanguage),
    setSetting("local_whisper_threads", String(settings.localWhisperThreads)),
    setSetting("keep_temp_audio_for_debugging", String(settings.keepTempAudioForDebugging)),
    setSetting("microphone_permission_status", settings.microphonePermissionStatus),
    setSetting("cloud_enabled", "false"),
    setSetting("screenshot_enabled", "false")
  ]);
  await setAllowedFolders(settings.allowedFolders);
}

export async function clearLocalData(): Promise<void> {
  await resetLocalDatabase();
  await deleteSecret("ai_api_key");
}
