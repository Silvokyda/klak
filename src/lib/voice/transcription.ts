import type { AppSettings, VoiceTranscriptionInput, VoiceTranscriptionProvider, VoiceTranscriptionResult } from "../../types";

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
    return {
      text: "",
      error:
        "Local Whisper CLI paths are configured, but native transcription execution is not enabled in this build yet. Audio was kept local and discarded."
    };
  }
};

export function getTranscriptionProvider(settings: AppSettings): VoiceTranscriptionProvider {
  if (!settings.voiceEnabled || settings.voiceInputProvider === "disabled") return disabledVoiceProvider;
  return localWhisperCliProvider;
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
  window.speechSynthesis.speak(utterance);
  return null;
}
