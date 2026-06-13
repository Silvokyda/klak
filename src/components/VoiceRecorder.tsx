import { Mic, Square, X } from "lucide-react";
import { useRef, useState } from "react";
import type { AppSettings } from "../types";
import { getTranscriptionProvider } from "../lib/voice/transcription";

interface Props {
  settings: AppSettings;
  onTranscript: (text: string) => void;
}

export function VoiceRecorder({ settings, onTranscript }: Props) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function start() {
    setMessage(null);
    if (!settings.voiceEnabled) {
      setMessage("Voice input is disabled in Settings.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage("Microphone recording is not available in this WebView.");
      return;
    }
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
    setRecording(true);
  }

  async function stop() {
    const recorder = recorderRef.current;
    if (!recorder || !recording) return;
    const stopped = new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
    });
    recorder.stop();
    await stopped;
    setRecording(false);
    const audio = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
    chunksRef.current = [];
    const result = await getTranscriptionProvider(settings).transcribe({ audio, settings });
    if (result.text) onTranscript(result.text);
    setMessage(result.error ?? "Transcription inserted into the chat input.");
  }

  function cancel() {
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    chunksRef.current = [];
    setRecording(false);
    setMessage("Recording canceled. No audio was saved.");
  }

  return (
    <div className="voice-control">
      <div className={recording ? "recording-dot active" : "recording-dot"} />
      <button type="button" onClick={recording ? stop : start} title={recording ? "Stop recording" : "Start push-to-talk recording"}>
        {recording ? <Square size={16} /> : <Mic size={16} />}
        {recording ? "Stop" : "Voice"}
      </button>
      {recording && (
        <button type="button" onClick={cancel} title="Cancel recording">
          <X size={16} />
          Cancel
        </button>
      )}
      {message && <span>{message}</span>}
    </div>
  );
}
