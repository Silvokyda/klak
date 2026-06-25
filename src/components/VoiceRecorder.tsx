import { Mic, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AppSettings } from "../types";
import { getTranscriptionProvider } from "../lib/voice/transcription";
import { createActionLog } from "../lib/logs/actionLogRepository";

interface Props {
  settings: AppSettings;
  onTranscript: (text: string) => void | Promise<void>;
  onStatus?: (message: string) => void;
  autoStartSignal?: number;
  autoStopAfterMs?: number;
}

export function VoiceRecorder({ settings, onTranscript, onStatus, autoStartSignal = 0, autoStopAfterMs }: Props) {
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const sampleRateRef = useRef(44100);
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
      report("Voice input is disabled in Settings.");
      return;
    }
    if (settings.voiceInputProvider === "disabled") {
      report("Choose a voice input provider in Settings first.");
      return;
    }
    if (settings.voiceInputProvider === "openai_transcription" && !settings.apiKeyStored) {
      report("Add your OpenAI API key in Settings first.");
      return;
    }
    if (settings.voiceInputProvider === "local_whisper_cli" && (!settings.localWhisperExecutablePath || !settings.localWhisperModelPath)) {
      report("Configure local Whisper first.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      report("Microphone recording is not available in this WebView.");
      return;
    }
    const AudioContextCtor =
      window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      report("Audio capture is not available in this WebView.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      const audioContext = new AudioContextCtor();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (event) => {
        if (!recordingRef.current) return;
        const input = event.inputBuffer.getChannelData(0);
        pcmChunksRef.current.push(new Float32Array(input));
        event.outputBuffer.getChannelData(0).fill(0);
      };
      source.connect(processor);
      processor.connect(audioContext.destination);

      streamRef.current = stream;
      audioContextRef.current = audioContext;
      audioSourceRef.current = source;
      audioProcessorRef.current = processor;
      sampleRateRef.current = audioContext.sampleRate;
      pcmChunksRef.current = [];
      recordingRef.current = true;
      setRecording(true);
      report(
        settings.voiceInputProvider === "local_whisper_cli"
          ? "Listening locally... I will transcribe when this turn ends."
          : "Listening..."
      );
      await createActionLog({
        tool_name: "voice_recording_started",
        input_summary: "push-to-talk recording started",
        risk_level: "medium",
        status: "completed",
        user_approved: true
      });
    } catch (error) {
      report(error instanceof Error ? error.message : String(error));
    }
  }

  async function stop() {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setRecording(false);
    const audio = await finishWavCapture();
    if (audio.size < 4000) {
      report("I did not capture enough audio. Try again and speak after Listening appears.");
      return;
    }
    await createActionLog({
      tool_name: "voice_transcription_requested",
      input_summary: `audio bytes: ${audio.size}, mime: ${audio.type || "unknown"}, provider: ${settings.voiceInputProvider}`,
      risk_level: "medium",
      status: "completed",
      user_approved: true
    });
    report(settings.voiceInputProvider === "local_whisper_cli" ? "Running local Whisper..." : "Transcribing...");
    const result = await getTranscriptionProvider(settings).transcribe({ audio, settings });
    if (result.text) {
      report(`Heard: ${result.text}`);
      await onTranscript(result.text);
      await createActionLog({
        tool_name: "voice_transcription_completed",
        input_summary: `transcript chars: ${result.text.length}, duration ms: ${result.durationMs ?? "unknown"}`,
        risk_level: "medium",
        status: "completed",
        user_approved: true
      });
      report(result.warning ?? "Voice command sent.");
    } else {
      await createActionLog({
        tool_name: "voice_transcription_failed",
        input_summary: `provider: ${settings.voiceInputProvider}`,
        risk_level: "medium",
        status: "failed",
        user_approved: true,
        error_message: result.error ?? "Transcription failed."
      });
      report(result.error ?? "Transcription failed.");
    }
  }

  function cancel() {
    recordingRef.current = false;
    setRecording(false);
    void finishWavCapture();
    void createActionLog({
      tool_name: "voice_recording_cancelled",
      input_summary: "push-to-talk recording cancelled",
      risk_level: "medium",
      status: "completed",
      user_approved: true
    });
    report("Recording canceled. No audio was saved.");
  }

  function report(nextMessage: string) {
    setMessage(nextMessage);
    onStatus?.(nextMessage);
  }

  async function finishWavCapture() {
    audioProcessorRef.current?.disconnect();
    audioSourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      await audioContextRef.current.close().catch(() => undefined);
    }
    const audio = encodeWav(pcmChunksRef.current, sampleRateRef.current);
    audioProcessorRef.current = null;
    audioSourceRef.current = null;
    audioContextRef.current = null;
    streamRef.current = null;
    pcmChunksRef.current = [];
    return audio;
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

function encodeWav(chunks: Float32Array[], sampleRate: number) {
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, sampleCount * 2, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (let index = 0; index < chunk.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, chunk[index]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
