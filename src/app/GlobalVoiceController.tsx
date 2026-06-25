import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AppSettings } from "../types";
import { RealtimeVoiceSession, type RealtimeVoiceSnapshot } from "../lib/voice/realtimeVoiceSession";
import { syncWakeListener } from "../lib/voice/wakeListener";

type VoicePhase =
  | "idle"
  | "wake_detected"
  | RealtimeVoiceSnapshot["state"];

export interface VoiceTurn {
  id: string;
  userTranscript: string;
  assistantTranscript: string;
  createdAt: string;
}

export interface VoiceDiagnosticEntry {
  id: string;
  code: string;
  message: string;
  createdAt: string;
}

export interface GlobalVoiceState {
  sessionGeneration: number;
  phase: VoicePhase;
  label: string;
  detail: string;
  snapshot: RealtimeVoiceSnapshot | null;
  diagnostics: VoiceDiagnosticEntry[];
  turns: VoiceTurn[];
  listeningReady: boolean;
  canStopSpeaking: boolean;
  canEndConversation: boolean;
  canRetry: boolean;
}

interface GlobalVoiceControllerContextValue extends GlobalVoiceState {
  stopSpeaking: () => void;
  endConversation: () => Promise<void>;
  retryConnection: () => Promise<void>;
  openAssistant: () => void;
}

const VoiceControllerContext = createContext<GlobalVoiceControllerContextValue | null>(null);

export function useGlobalVoiceController() {
  const context = useContext(VoiceControllerContext);
  if (!context) {
    throw new Error("useGlobalVoiceController must be used within GlobalVoiceControllerProvider.");
  }
  return context;
}

export function GlobalVoiceControllerProvider({
  settings,
  onOpenAssistant,
  children
}: {
  settings: AppSettings;
  onOpenAssistant: () => void;
  children: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<RealtimeVoiceSnapshot | null>(null);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [diagnostics, setDiagnostics] = useState<VoiceDiagnosticEntry[]>([]);
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [sessionGeneration, setSessionGeneration] = useState(0);
  const sessionRef = useRef<RealtimeVoiceSession | null>(null);
  const startInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const settingsRef = useRef(settings);
  const snapshotRef = useRef<RealtimeVoiceSnapshot | null>(null);
  const rebuildTokenRef = useRef(0);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) {
        void session.close("provider_unmount");
      }
    };
  }, []);

  const appendDiagnostic = useCallback((code: string, message: string) => {
    setDiagnostics((current) => {
      const next = [
        ...current,
        {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          code,
          message,
          createdAt: new Date().toISOString()
        }
      ].slice(-8);
      return next;
    });
  }, []);

  const publishCaption = useCallback(async (text: string) => {
    try {
      await invoke("update_voice_caption", { text: text.slice(0, 220) });
    } catch {
      // The overlay is a convenience; the session still works if caption updates fail.
    }
  }, []);

  const syncOverlay = useCallback(
    async (nextPhase: VoicePhase, nextSnapshot: RealtimeVoiceSnapshot | null, extraDetail?: string) => {
      const label = voiceLabelForPhase(nextPhase);
      const detail = extraDetail || voiceDetailForPhase(nextPhase, nextSnapshot);
      if (!mountedRef.current) return;
      setPhase(nextPhase);
      setSnapshot(nextSnapshot);
      await publishCaption(detail && detail !== label ? `${label} - ${detail}` : label);
    },
    [publishCaption]
  );

  const pushTurn = useCallback((turn: { userTranscript: string; assistantTranscript: string }) => {
    const userTranscript = turn.userTranscript.trim();
    const assistantTranscript = turn.assistantTranscript.trim();
    if (!userTranscript && !assistantTranscript) return;
    setTurns((current) => [
      ...current,
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        userTranscript,
        assistantTranscript,
        createdAt: new Date().toISOString()
      }
    ]);
  }, []);

  const setSessionSnapshot = useCallback(
    (nextSnapshot: RealtimeVoiceSnapshot) => {
      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
      void syncOverlay(nextSnapshot.state, nextSnapshot);
    },
    [syncOverlay]
  );

  const handleFinalTurn = useCallback(
    (turn: { userTranscript: string; assistantTranscript: string }) => {
      pushTurn(turn);
    },
    [pushTurn]
  );

  const report = useCallback(
    (code: string, message: string) => {
      appendDiagnostic(code, message);
    },
    [appendDiagnostic]
  );

  const closeSession = useCallback(
    async (reason: string) => {
      const session = sessionRef.current;
      if (!session) return;
      report("cleanup_start", `cleanup: ${reason}`);
      await session.close(reason);
      const wakeStatus = await syncWakeListener(settingsRef.current).catch(() => undefined);
      if (wakeStatus?.running) {
        report("wake_listener_resumed", "wake listener resumed");
      }
      await syncOverlay("idle", null, "Idle");
    },
    [report, syncOverlay]
  );

  const startSession = useCallback(
    async (reason: "summon" | "retry" | "wake" | "manual") => {
      if (startInFlightRef.current) {
        report("session_start_rejected", `duplicate start ignored (${reason})`);
        return;
      }

      const session = sessionRef.current;
      if (!session) {
        report("session_start_rejected", `no realtime session available (${reason})`);
        return;
      }

      const currentState = session.getSnapshot().state;
      if (!["idle", "error"].includes(currentState)) {
        report("session_start_rejected", `duplicate start ignored while ${currentState}`);
        return;
      }

      startInFlightRef.current = true;
      report("session_start_accepted", `starting from ${reason}`);
      void syncOverlay("awakening", session.getSnapshot(), "Wake detected");
      try {
        await session.start(reason);
      } finally {
        startInFlightRef.current = false;
      }
    },
    [report, syncOverlay]
  );

  const retryConnection = useCallback(async () => {
    await closeSession("retry_connection");
    await startSession("retry");
  }, [closeSession, startSession]);

  const stopSpeaking = useCallback(() => {
    sessionRef.current?.stopSpeaking();
    report("interruption", "manual stop speaking");
  }, [report]);

  const endConversation = useCallback(async () => {
    await closeSession("ended_by_user");
  }, [closeSession]);

  useEffect(() => {
    let cancelled = false;
    const token = ++rebuildTokenRef.current;

    const rebuildSession = async () => {
      const existing = sessionRef.current;
      sessionRef.current = null;
      if (existing) {
        await existing.close("settings_changed");
      }

      if (cancelled || token !== rebuildTokenRef.current) return;

      if (!settings.setupComplete || !settings.voiceEnabled || settings.voiceConversationMode !== "openai_realtime") {
        setSessionGeneration(token);
        if (settings.setupComplete) {
          const wakeStatus = await syncWakeListener(settings).catch(() => undefined);
          if (wakeStatus?.running) {
            report("wake_listener_resumed", "wake listener resumed");
          }
        }
        await syncOverlay("idle", null, "Idle");
        return;
      }

      sessionRef.current = new RealtimeVoiceSession(settings, setSessionSnapshot, handleFinalTurn, report);
      setSessionGeneration(token);
      const wakeStatus = await syncWakeListener(settings).catch(() => undefined);
      if (wakeStatus?.running) {
        report("wake_listener_resumed", "wake listener resumed");
      }
      await syncOverlay("idle", sessionRef.current.getSnapshot(), "Idle");
    };

    void rebuildSession();

    return () => {
      cancelled = true;
    };
  }, [handleFinalTurn, report, setSessionSnapshot, settings, syncOverlay]);

  useEffect(() => {
    const unlistenWake = listen<{ score?: number; threshold?: number; model?: string }>("klak-wake-detected", (event) => {
      report("wake_received", "wake detected");
      void syncOverlay("wake_detected", snapshotRef.current, "Wake detected");
      report("wake_score", `score: ${typeof event.payload.score === "number" ? event.payload.score.toFixed(3) : "unknown"}`);
    });

    const unlistenSummoned = listen("klak-summoned", () => {
      report("summon_received", "summon received");
      void startSession("summon");
    });

    return () => {
      unlistenWake.then((dispose) => dispose());
      unlistenSummoned.then((dispose) => dispose());
    };
  }, [publishCaption, report, startSession, syncOverlay]);

  const state = useMemo<GlobalVoiceState>(() => {
    const listeningReady = Boolean(
      snapshot &&
        snapshot.state === "listening" &&
        settings.voiceEnabled &&
        settings.voiceConversationMode === "openai_realtime"
    );
    const label = voiceLabelForPhase(phase);
    const detail = voiceDetailForPhase(phase, snapshot);
    return {
      sessionGeneration,
      phase,
      label,
      detail,
      snapshot,
      diagnostics,
      turns,
      listeningReady,
      canStopSpeaking: Boolean(snapshot && ["assistant_speaking", "processing", "interrupted"].includes(snapshot.state)),
      canEndConversation: Boolean(snapshot && snapshot.state !== "idle"),
      canRetry: Boolean(snapshot && ["error", "reconnecting", "connecting", "awakening", "listening", "assistant_speaking", "processing", "interrupted"].includes(snapshot.state))
    };
  }, [diagnostics, phase, sessionGeneration, snapshot, turns, settings.voiceConversationMode, settings.voiceEnabled]);

  const value = useMemo<GlobalVoiceControllerContextValue>(
    () => ({
      ...state,
      stopSpeaking,
      endConversation,
      retryConnection,
      openAssistant: onOpenAssistant
    }),
    [endConversation, onOpenAssistant, retryConnection, state, stopSpeaking]
  );

  return <VoiceControllerContext.Provider value={value}>{children}</VoiceControllerContext.Provider>;
}

function voiceLabelForPhase(phase: VoicePhase): string {
  switch (phase) {
    case "wake_detected":
      return "Wake detected";
    case "awakening":
      return "Wake detected";
    case "connecting":
      return "Connecting";
    case "listening":
      return "Listening";
    case "user_speaking":
      return "You're speaking";
    case "processing":
      return "Thinking";
    case "assistant_speaking":
      return "Klak is speaking";
    case "interrupted":
      return "Interrupted";
    case "reconnecting":
      return "Reconnecting";
    case "closing":
      return "Going to sleep";
    case "error":
      return "Connection failed";
    case "idle":
    default:
      return "Idle";
  }
}

function voiceDetailForPhase(phase: VoicePhase, snapshot: RealtimeVoiceSnapshot | null): string {
  if (phase === "wake_detected") return "Wake detected";
  if (phase === "closing") return "Going to sleep";
  if (phase === "error") return snapshot?.error || "Connection failed";
  if (phase === "connecting") return snapshot?.selectedMicrophone ? `Using ${snapshot.selectedMicrophone}` : "Connecting";
  if (phase === "listening" && snapshot?.selectedMicrophone) return `Listening on ${snapshot.selectedMicrophone}`;
  if (phase === "assistant_speaking") return snapshot?.finalAssistantTranscript || snapshot?.partialAssistantTranscript || "Speaking";
  if (phase === "user_speaking") return snapshot?.partialUserTranscript || "Listening for your voice";
  if (phase === "processing") return "Thinking";
  if (phase === "interrupted") return "Interrupted";
  if (phase === "reconnecting") return "Trying to recover";
  return "Idle";
}
