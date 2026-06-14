import { Mic, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AppSettings } from "../types";
import { getTranscriptionProvider } from "../lib/voice/transcription";
import { createActionLog } from "../lib/logs/actionLogRepository";
import { verifyOwnerVoice } from "../lib/voice/voiceProfile";

interface Props {
  settings: AppSettings;
  onTranscript: (text: string) => void | Promise<void>;
  autoStartSignal?: number;
  autoStopAfterMs?: number;
}

export function VoiceRecorder({ settings, onTranscript, autoStartSignal = 0, autoStopAfterMs }: Props) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingRef = useRef(false);
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  useEffect(() => {
    if (!autoStartSignal || recordingRef.current) return;
    void start();

    if (autoStopAfterMs) {
      window.setTimeout(() => {
        if (recordingRef.current) void stop();
      }, autoStopAfterMs);
    }
  }, [autoStartSignal]);

  async function start() {
    setMessage(null);
    if (!settings.voiceEnabled) {
      setMessage("Voice input is disabled in Settings.");
      return;
    }
    if (settings.voiceInputProvider === "disabled") {
      setMessage("Choose a voice input provider in Settings first.");
      return;
    }
    if (settings.voiceInputProvider === "openai_transcription" && !settings.apiKeyStored) {
      setMessage("Add your OpenAI API key in Settings first.");
      return;
    }
    if (settings.voiceInputProvider === "local_whisper_cli" && (!settings.localWhisperExecutablePath || !settings.localWhisperModelPath)) {
      setMessage("Configure local Whisper first.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage("Microphone recording is not available in this WebView.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
      };
      recorder.start();
      recordingRef.current = true;
      setRecording(true);
      await createActionLog({
        tool_name: "voice_recording_started",
        input_summary: "push-to-talk recording started",
        risk_level: "medium",
        status: "completed",
        user_approved: true
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function stop() {
    const recorder = recorderRef.current;
    if (!recorder || !recording) return;
    const stopped = new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
    });
    recorder.stop();
    await stopped;
    recordingRef.current = false;
    setRecording(false);
    const audio = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
    chunksRef.current = [];
    await createActionLog({
      tool_name: "voice_transcription_requested",
      input_summary: `audio bytes: ${audio.size}, provider: ${settings.voiceInputProvider}`,
      risk_level: "medium",
      status: "completed",
      user_approved: true
    });
    if (settings.voiceProfileEnabled) {
      const voiceCheck = await verifyOwnerVoice(audio, settings);
      if (!voiceCheck.ok) {
        await createActionLog({
          tool_name: "voice_owner_verification_failed",
          input_summary: voiceCheck.message,
          risk_level: "medium",
          status: "blocked",
          user_approved: false,
          error_message: voiceCheck.message
        });
        setMessage(voiceCheck.message);
        return;
      }
    }
    const result = await getTranscriptionProvider(settings).transcribe({ audio, settings });
    if (result.text) {
      await onTranscript(result.text);
      await createActionLog({
        tool_name: "voice_transcription_completed",
        input_summary: `transcript chars: ${result.text.length}, duration ms: ${result.durationMs ?? "unknown"}`,
        risk_level: "medium",
        status: "completed",
        user_approved: true
      });
      setMessage(result.warning ?? "Voice command sent.");
    } else {
      await createActionLog({
        tool_name: "voice_transcription_failed",
        input_summary: `provider: ${settings.voiceInputProvider}`,
        risk_level: "medium",
        status: "failed",
        user_approved: true,
        error_message: result.error ?? "Transcription failed."
      });
      setMessage(result.error ?? "Transcription failed.");
    }
  }

  function cancel() {
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    chunksRef.current = [];
    recordingRef.current = false;
    setRecording(false);
    void createActionLog({
      tool_name: "voice_recording_cancelled",
      input_summary: "push-to-talk recording cancelled",
      risk_level: "medium",
      status: "completed",
      user_approved: true
    });
    setMessage("Recording canceled. No audio was saved.");
  }

  if (!settings.voiceEnabled) {
    return <div className="voice-control muted">Voice is off in Settings.</div>;
  }

  const needsWhisperSetup =
    settings.voiceInputProvider === "local_whisper_cli" && (!settings.localWhisperExecutablePath || !settings.localWhisperModelPath);
  const needsOpenAiSetup = settings.voiceInputProvider === "openai_transcription" && !settings.apiKeyStored;

  return (
    <div className="voice-control">
      <div className={recording ? "recording-dot active" : "recording-dot"} />
      <button
        type="button"
        onClick={recording ? stop : start}
        disabled={needsWhisperSetup || needsOpenAiSetup}
        title={
          needsOpenAiSetup
            ? "Add your OpenAI API key first."
            : needsWhisperSetup
              ? "Configure local Whisper first."
              : recording
                ? "Stop recording"
                : "Start push-to-talk recording"
        }
      >
        {recording ? <Square size={16} /> : <Mic size={16} />}
        {recording ? "Stop" : "Voice"}
      </button>
      {recording && (
        <button type="button" onClick={cancel} title="Cancel recording">
          <X size={16} />
          Cancel
        </button>
      )}
      {needsOpenAiSetup && <span>Add your OpenAI API key first.</span>}
      {needsWhisperSetup && <span>Configure local Whisper first.</span>}
      {message && <span>{message}</span>}
    </div>
  );
}
