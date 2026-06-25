import { listen } from "@tauri-apps/api/event";
import { Radio, RotateCcw, Square, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AppSettings } from "../types";
import {
  RealtimeVoiceSession,
  type RealtimeVoiceSnapshot
} from "../lib/voice/realtimeVoiceSession";

interface Props {
  settings: AppSettings;
  onFinalTurn: (turn: { userTranscript: string; assistantTranscript: string }) => void;
}

const initialSnapshot: RealtimeVoiceSnapshot = {
  state: "idle",
  selectedMicrophone: "",
  partialUserTranscript: "",
  finalUserTranscript: "",
  partialAssistantTranscript: "",
  finalAssistantTranscript: "",
  error: null,
  cloudProcessing: false
};

export function RealtimeVoicePanel({ settings, onFinalTurn }: Props) {
  const [snapshot, setSnapshot] = useState<RealtimeVoiceSnapshot>(initialSnapshot);
  const sessionRef = useRef<RealtimeVoiceSession | null>(null);

  useEffect(() => {
    sessionRef.current?.close("settings_changed");
    sessionRef.current = new RealtimeVoiceSession(settings, setSnapshot, onFinalTurn);

    return () => {
      void sessionRef.current?.close("component_unmounted");
      sessionRef.current = null;
    };
  }, [settings, onFinalTurn]);

  useEffect(() => {
    const wake = listen("klak-wake-detected", () => {
      void sessionRef.current?.start("wake");
    });
    const summoned = listen("klak-summoned", () => {
      void sessionRef.current?.start("summon");
    });
    return () => {
      wake.then((dispose) => dispose());
      summoned.then((dispose) => dispose());
    };
  }, []);

  const activeTranscript = snapshot.partialUserTranscript || snapshot.finalUserTranscript;
  const assistantTranscript = snapshot.partialAssistantTranscript || snapshot.finalAssistantTranscript;

  return (
    <section className={`realtime-voice-panel realtime-state-${snapshot.state}`}>
      <div className="realtime-voice-header">
        <div>
          <strong>Realtime voice</strong>
          <span>{snapshot.cloudProcessing ? "Cloud speech-to-speech" : "Ready"}</span>
        </div>
        <span className="status-badge">{formatState(snapshot.state)}</span>
      </div>

      <div className="realtime-voice-body">
        <div className="realtime-orb" aria-hidden="true">
          <Radio size={20} />
        </div>
        <div className="realtime-voice-copy">
          <span>{snapshot.selectedMicrophone || "Microphone not connected"}</span>
          <strong>{statusLine(snapshot.state)}</strong>
          <p>{snapshot.error ?? "Wake phrase, tray summon, or Start conversation will open a live session."}</p>
        </div>
      </div>

      <div className="realtime-transcripts">
        <TranscriptLine label="You" value={activeTranscript || "Listening for your voice..."} />
        <TranscriptLine label="Klak" value={assistantTranscript || "No assistant speech yet."} />
      </div>

      <div className="routine-builder-actions">
        <button type="button" onClick={() => sessionRef.current?.start("manual")}>
          <Radio size={16} />
          Start conversation
        </button>
        <button type="button" onClick={() => sessionRef.current?.stopSpeaking()}>
          <VolumeX size={16} />
          Stop speaking
        </button>
        <button type="button" onClick={() => sessionRef.current?.close("ended_by_user")}>
          <Square size={16} />
          End conversation
        </button>
        <button type="button" onClick={() => sessionRef.current?.start("retry")}>
          <RotateCcw size={16} />
          Retry connection
        </button>
      </div>
    </section>
  );
}

function TranscriptLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="realtime-transcript-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatState(state: RealtimeVoiceSnapshot["state"]) {
  return state.replace(/_/g, " ");
}

function statusLine(state: RealtimeVoiceSnapshot["state"]) {
  if (state === "listening") return "Listening";
  if (state === "user_speaking") return "User speaking";
  if (state === "processing") return "Thinking";
  if (state === "assistant_speaking") return "Assistant speaking";
  if (state === "connecting") return "Connecting";
  if (state === "awakening") return "Awakening";
  if (state === "interrupted") return "Interrupted";
  if (state === "error") return "Connection failed";
  return "Idle";
}
