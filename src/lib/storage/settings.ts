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
  | "voice_conversation_mode"
  | "voice_input_provider"
  | "realtime_voice_model"
  | "realtime_voice_name"
  | "voice_output_provider"
  | "voice_output_voice_name"
  | "voice_output_rate"
  | "voice_output_pitch"
  | "openai_transcription_model"
  | "voice_profile_enabled"
  | "voice_profile_status"
  | "voice_profile_calibration"
  | "wake_word_enabled"
  | "wake_word_provider"
  | "wake_word_python_path"
  | "wake_word_model"
  | "wake_word_custom_model_path"
  | "wake_word_threshold"
  | "wake_word_diagnostics_enabled"
  | "wake_word_device_name"
  | "wake_word_device_index"
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
  voiceConversationMode: "local_push_to_talk",
  voiceInputProvider: "openai_transcription",
  realtimeVoiceModel: "gpt-realtime-2",
  realtimeVoiceName: "alloy",
  voiceOutputProvider: "disabled",
  voiceOutputVoiceName: "",
  voiceOutputRate: 1,
  voiceOutputPitch: 1,
  openAiTranscriptionModel: "gpt-4o-mini-transcribe",
  voiceProfileEnabled: false,
  voiceProfileStatus: "not_enrolled",
  voiceProfileCalibration: "",
  wakeWordEnabled: false,
  wakeWordProvider: "openwakeword_sidecar",
  wakeWordPythonPath: "python",
  wakeWordModel: "hey_jarvis",
  wakeWordCustomModelPath: "",
  wakeWordThreshold: 0.55,
  wakeWordDiagnosticsEnabled: false,
  wakeWordDeviceName: "",
  wakeWordDeviceIndex: null,
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
    voiceConversationMode:
      (rows.voice_conversation_mode as AppSettings["voiceConversationMode"]) ||
      defaultSettings.voiceConversationMode,
    voiceInputProvider: (rows.voice_input_provider as AppSettings["voiceInputProvider"]) || defaultSettings.voiceInputProvider,
    realtimeVoiceModel: rows.realtime_voice_model || defaultSettings.realtimeVoiceModel,
    realtimeVoiceName: rows.realtime_voice_name || defaultSettings.realtimeVoiceName,
    voiceOutputProvider: (rows.voice_output_provider as AppSettings["voiceOutputProvider"]) || defaultSettings.voiceOutputProvider,
    voiceOutputVoiceName: rows.voice_output_voice_name || defaultSettings.voiceOutputVoiceName,
    voiceOutputRate: Number(rows.voice_output_rate || defaultSettings.voiceOutputRate),
    voiceOutputPitch: Number(rows.voice_output_pitch || defaultSettings.voiceOutputPitch),
    openAiTranscriptionModel: rows.openai_transcription_model || defaultSettings.openAiTranscriptionModel,
    voiceProfileEnabled: rows.voice_profile_enabled === "true",
    voiceProfileStatus: (rows.voice_profile_status as AppSettings["voiceProfileStatus"]) || defaultSettings.voiceProfileStatus,
    voiceProfileCalibration: rows.voice_profile_calibration || "",
    wakeWordEnabled: rows.wake_word_enabled === "true",
    wakeWordProvider: (rows.wake_word_provider as AppSettings["wakeWordProvider"]) || defaultSettings.wakeWordProvider,
    wakeWordPythonPath: rows.wake_word_python_path || defaultSettings.wakeWordPythonPath,
    wakeWordModel: rows.wake_word_model || defaultSettings.wakeWordModel,
    wakeWordCustomModelPath: rows.wake_word_custom_model_path || "",
    wakeWordThreshold: Number(rows.wake_word_threshold || defaultSettings.wakeWordThreshold),
    wakeWordDiagnosticsEnabled: rows.wake_word_diagnostics_enabled === "true",
    wakeWordDeviceName: rows.wake_word_device_name || "",
    wakeWordDeviceIndex:
      rows.wake_word_device_index && rows.wake_word_device_index !== "null"
        ? Number(rows.wake_word_device_index)
        : null,
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
    setSetting("voice_conversation_mode", settings.voiceConversationMode),
    setSetting("voice_input_provider", settings.voiceInputProvider),
    setSetting("realtime_voice_model", settings.realtimeVoiceModel),
    setSetting("realtime_voice_name", settings.realtimeVoiceName),
    setSetting("voice_output_provider", settings.voiceOutputProvider),
    setSetting("voice_output_voice_name", settings.voiceOutputVoiceName),
    setSetting("voice_output_rate", String(settings.voiceOutputRate)),
    setSetting("voice_output_pitch", String(settings.voiceOutputPitch)),
    setSetting("openai_transcription_model", settings.openAiTranscriptionModel),
    setSetting("voice_profile_enabled", String(settings.voiceProfileEnabled)),
    setSetting("voice_profile_status", settings.voiceProfileStatus),
    setSetting("voice_profile_calibration", settings.voiceProfileCalibration),
    setSetting("wake_word_enabled", String(settings.wakeWordEnabled)),
    setSetting("wake_word_provider", settings.wakeWordProvider),
    setSetting("wake_word_python_path", settings.wakeWordPythonPath),
    setSetting("wake_word_model", settings.wakeWordModel),
    setSetting("wake_word_custom_model_path", settings.wakeWordCustomModelPath),
    setSetting("wake_word_threshold", String(settings.wakeWordThreshold)),
    setSetting("wake_word_diagnostics_enabled", String(settings.wakeWordDiagnosticsEnabled)),
    setSetting("wake_word_device_name", settings.wakeWordDeviceName),
    setSetting("wake_word_device_index", String(settings.wakeWordDeviceIndex ?? "null")),
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
