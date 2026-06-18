import type { AppSettings, VoiceTranscriptionInput, VoiceTranscriptionProvider, VoiceTranscriptionResult } from "../../types";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { apiKeyVault } from "../security/apiKeyVault";

interface NativeTempAudioOutput {
  audio_path: string;
}

interface NativeWhisperOutput {
  transcript: string;
  duration_ms: number;
  warning?: string | null;
}

export const disabledVoiceProvider: VoiceTranscriptionProvider = {
  async transcribe(): Promise<VoiceTranscriptionResult> {
    return { text: "", error: "Voice transcription is disabled." };
  }
};

export const localWhisperCliProvider: VoiceTranscriptionProvider = {
  async transcribe(input: VoiceTranscriptionInput): Promise<VoiceTranscriptionResult> {
    if (!input.settings.localWhisperExecutablePath || !input.settings.localWhisperModelPath) {
      return { text: "", error: "Local transcription is not configured yet." };
    }
    if (!isTauri()) {
      return { text: "", error: "Local Whisper transcription requires the native Klak desktop app." };
    }
    try {
      const audioBytes = new Uint8Array(await input.audio.arrayBuffer());
      const saved = await invoke<NativeTempAudioOutput>("save_temp_voice_audio", {
        input: {
          bytes: Array.from(audioBytes),
          extension: extensionFromMime(input.audio.type)
        }
      });
      const result = await invoke<NativeWhisperOutput>("transcribe_audio_with_whisper", {
        input: {
          audio_path: saved.audio_path,
          executable_path: input.settings.localWhisperExecutablePath,
          model_path: input.settings.localWhisperModelPath,
          language: input.settings.localWhisperLanguage,
          threads: input.settings.localWhisperThreads,
          keep_temp_audio_for_debugging: input.settings.keepTempAudioForDebugging
        }
      });
      return {
        text: result.transcript,
        warning: result.warning ?? undefined,
        durationMs: result.duration_ms
      };
    } catch (error) {
      return { text: "", error: error instanceof Error ? error.message : String(error) };
    }
  }
};

export const openAiTranscriptionProvider: VoiceTranscriptionProvider = {
  async transcribe(input: VoiceTranscriptionInput): Promise<VoiceTranscriptionResult> {
    const apiKey = await apiKeyVault.getApiKeyForProviderCall();
    if (!apiKey) {
      return { text: "", error: "Add your OpenAI API key in Settings before using OpenAI voice transcription." };
    }

    try {
      const form = new FormData();
      form.append("model", input.settings.openAiTranscriptionModel || "gpt-4o-mini-transcribe");
      form.append("response_format", "json");
      form.append("file", input.audio, `klak-voice.${extensionFromMime(input.audio.type)}`);

      const response = await fetch(`${input.settings.apiBaseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`
        },
        body: form
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        return {
          text: "",
          error: `OpenAI transcription returned ${response.status}${errorText ? `: ${errorText.slice(0, 240)}` : "."}`
        };
      }

      const data = await response.json();
      return { text: typeof data.text === "string" ? data.text.trim() : "" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const hint = /failed to fetch|network|load failed/i.test(message)
        ? "OpenAI transcription could not reach the API. Check your internet connection and the Klak API base URL."
        : message;
      return { text: "", error: hint };
    }
  }
};

export function getTranscriptionProvider(settings: AppSettings): VoiceTranscriptionProvider {
  if (!settings.voiceEnabled || settings.voiceInputProvider === "disabled") return disabledVoiceProvider;
  if (settings.voiceInputProvider === "openai_transcription") return openAiTranscriptionProvider;
  return localWhisperCliProvider;
}

export async function testWhisperSetup(settings: AppSettings): Promise<string> {
  if (!isTauri()) return "Local Whisper setup can only be tested in the native Klak desktop app.";
  const result = await invoke<{ ok: boolean; message: string; warning?: string | null }>("validate_whisper_setup", {
    executablePath: settings.localWhisperExecutablePath,
    modelPath: settings.localWhisperModelPath
  });
  return [result.message, result.warning].filter(Boolean).join(" ");
}

export function canSpeak(settings: AppSettings): boolean {
  return settings.voiceOutputProvider === "web_speech" && typeof window !== "undefined" && "speechSynthesis" in window;
}

export function speakText(text: string, settings: AppSettings): string | null {
  if (!canSpeak(settings)) return "Voice output is disabled or unavailable.";
  if (/\b(api[_ -]?key|password|secret|token|credential)\b/i.test(text)) {
    return "Klak will not speak content that appears to contain secrets.";
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  const selectedVoice = voices.find((voice) => voice.name === settings.voiceOutputVoiceName);
  if (selectedVoice) utterance.voice = selectedVoice;
  utterance.rate = clampSpeechValue(settings.voiceOutputRate, 0.6, 1.4, 1);
  utterance.pitch = clampSpeechValue(settings.voiceOutputPitch, 0.7, 1.3, 1);
  window.speechSynthesis.speak(utterance);
  return null;
}

function clampSpeechValue(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function extensionFromMime(mimeType: string): string {
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}
