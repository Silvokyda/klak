import { Mic, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AppSettings } from "../types";
import { getTranscriptionProvider } from "../lib/voice/transcription";
import { createActionLog } from "../lib/logs/actionLogRepository";
import { apiKeyVault } from "../lib/security/apiKeyVault";

interface Props {
  settings: AppSettings;
  onTranscript: (text: string) => void | Promise<void>;
  onStatus?: (message: string) => void;
  autoStartSignal?: number;
  autoStopAfterMs?: number;
}

interface RealtimeTranscriptionState {
  ws: WebSocket;
  text: string;
  finalized: boolean;
  resolveFinal?: (text: string) => void;
}

export function VoiceRecorder({ settings, onTranscript, onStatus, autoStartSignal = 0, autoStopAfterMs }: Props) {
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const realtimeRef = useRef<RealtimeTranscriptionState | null>(null);
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
      const realtime = settings.voiceInputProvider === "openai_transcription" ? await startRealtimeTranscription() : null;
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
        if (realtime?.ws.readyState === WebSocket.OPEN) {
          realtime.ws.send(
            JSON.stringify({
              type: "input_audio_buffer.append",
              audio: pcm16Base64(resampleToPcm16(input, audioContext.sampleRate, 24000))
            })
          );
        }
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
      report("Listening...");
      await createActionLog({
        tool_name: "voice_recording_started",
        input_summary: realtime ? "streaming voice recording started" : "push-to-talk recording started",
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
      input_summary: `audio bytes: ${audio.size}, mime: ${audio.type || "unknown"}, provider: ${settings.voiceInputProvider}, streaming: ${Boolean(realtimeRef.current)}`,
      risk_level: "medium",
      status: "completed",
      user_approved: true
    });

    if (settings.voiceInputProvider === "openai_transcription" && realtimeRef.current) {
      report("Finishing live transcript...");
      const transcript = await finishRealtimeTranscription();
      if (transcript) {
        report(`Heard: ${transcript}`);
        await onTranscript(transcript);
        await createActionLog({
          tool_name: "voice_transcription_completed",
          input_summary: `streaming transcript chars: ${transcript.length}`,
          risk_level: "medium",
          status: "completed",
          user_approved: true
        });
        report("Voice command sent.");
        return;
      }
      report("Live transcript was empty. Trying fallback transcription...");
    }

    report("Transcribing...");
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
    realtimeRef.current?.ws.close();
    realtimeRef.current = null;
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

  async function startRealtimeTranscription() {
    const apiKey = await apiKeyVault.getApiKeyForProviderCall();
    if (!apiKey) throw new Error("Add your OpenAI API key in Settings first.");

    const realtimeUrl = `${settings.apiBaseUrl.replace(/^http/, "ws").replace(/\/$/, "")}/realtime?model=gpt-realtime-whisper`;
    const ws = new WebSocket(realtimeUrl, [
      "realtime",
      `openai-insecure-api-key.${apiKey}`,
      "openai-beta.realtime-v1"
    ]);

    const state: RealtimeTranscriptionState = { ws, text: "", finalized: false };
    realtimeRef.current = state;

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("Realtime transcription connection timed out.")), 8000);
      ws.addEventListener(
        "open",
        () => {
          window.clearTimeout(timeout);
          ws.send(
            JSON.stringify({
              type: "session.update",
              session: {
                type: "transcription",
                audio: {
                  input: {
                    format: { type: "audio/pcm", rate: 24000 },
                    transcription: {
                      model: "gpt-realtime-whisper",
                      language: "en",
                      delay: "low"
                    },
                    turn_detection: null
                  }
                }
              }
            })
          );
          resolve();
        },
        { once: true }
      );
      ws.addEventListener(
        "error",
        () => {
          window.clearTimeout(timeout);
          reject(new Error("Realtime transcription connection failed."));
        },
        { once: true }
      );
    });

    ws.addEventListener("message", (event) => {
      const payload = parseRealtimeEvent(event.data);
      if (!payload) return;
      if (payload.type === "error") {
        const message = payload.error?.message ?? "Realtime transcription failed.";
        report(message);
        state.resolveFinal?.("");
        return;
      }
      if (payload.type?.endsWith("transcription.delta") && typeof payload.delta === "string") {
        state.text = `${state.text}${payload.delta}`;
        report(`Hearing: ${state.text}`);
      }
      if (payload.type?.endsWith("transcription.completed")) {
        state.finalized = true;
        const transcript = typeof payload.transcript === "string" ? payload.transcript : state.text;
        state.text = transcript.trim();
        state.resolveFinal?.(state.text);
      }
    });

    ws.addEventListener("close", () => {
      state.resolveFinal?.(state.text.trim());
    });

    return state;
  }

  async function finishRealtimeTranscription() {
    const realtime = realtimeRef.current;
    if (!realtime) return "";
    if (realtime.ws.readyState === WebSocket.OPEN) {
      realtime.ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    }

    const transcript = await new Promise<string>((resolve) => {
      realtime.resolveFinal = resolve;
      window.setTimeout(() => resolve(realtime.text.trim()), 4500);
    });

    realtime.ws.close();
    realtimeRef.current = null;
    return transcript.trim();
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

function parseRealtimeEvent(data: unknown): { type?: string; delta?: string; transcript?: string; error?: { message?: string } } | null {
  if (typeof data !== "string") return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function resampleToPcm16(input: Float32Array, sourceRate: number, targetRate: number) {
  if (sourceRate === targetRate) return floatToPcm16(input);
  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(input.length - 1, left + 1);
    const weight = sourceIndex - left;
    output[index] = input[left] * (1 - weight) + input[right] * weight;
  }
  return floatToPcm16(output);
}

function floatToPcm16(input: Float32Array) {
  const pcm = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return pcm;
}

function pcm16Base64(pcm: Int16Array) {
  const bytes = new Uint8Array(pcm.buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return window.btoa(binary);
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
