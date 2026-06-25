import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "../../types";
import { createActionLog } from "../logs/actionLogRepository";
import { stopWakeListener, syncWakeListener } from "./wakeListener";

export type RealtimeVoiceState =
  | "idle"
  | "awakening"
  | "connecting"
  | "listening"
  | "user_speaking"
  | "processing"
  | "assistant_speaking"
  | "interrupted"
  | "closing"
  | "error";

export interface RealtimeVoiceSnapshot {
  state: RealtimeVoiceState;
  selectedMicrophone: string;
  partialUserTranscript: string;
  finalUserTranscript: string;
  partialAssistantTranscript: string;
  finalAssistantTranscript: string;
  error: string | null;
  cloudProcessing: boolean;
}

interface RealtimeSessionCredential {
  client_secret: string;
  model: string;
  expires_at?: number | null;
  endpoint: string;
}

type RealtimeServerEvent =
  | { type: "input_audio_buffer.speech_started" }
  | { type: "input_audio_buffer.speech_stopped" }
  | { type: "input_audio_buffer.committed" }
  | { type: "response.created" }
  | { type: "response.done" }
  | { type: "response.cancelled" }
  | { type: "response.audio_transcript.delta"; delta?: string }
  | { type: "response.audio_transcript.done"; transcript?: string }
  | { type: "conversation.item.input_audio_transcription.delta"; delta?: string }
  | { type: "conversation.item.input_audio_transcription.completed"; transcript?: string }
  | { type: "error"; error?: { message?: string } }
  | { type: string; [key: string]: unknown };

const emptySnapshot: RealtimeVoiceSnapshot = {
  state: "idle",
  selectedMicrophone: "",
  partialUserTranscript: "",
  finalUserTranscript: "",
  partialAssistantTranscript: "",
  finalAssistantTranscript: "",
  error: null,
  cloudProcessing: false
};

export class RealtimeVoiceSession {
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private inactivityTimer: number | null = null;
  private starting = false;
  private snapshot: RealtimeVoiceSnapshot = { ...emptySnapshot };

  constructor(
    private readonly settings: AppSettings,
    private readonly onUpdate: (snapshot: RealtimeVoiceSnapshot) => void,
    private readonly onFinalTurn?: (turn: { userTranscript: string; assistantTranscript: string }) => void
  ) {}

  getSnapshot(): RealtimeVoiceSnapshot {
    return { ...this.snapshot };
  }

  async start(reason: "wake" | "summon" | "manual" | "retry" = "manual"): Promise<void> {
    if (this.starting || !["idle", "error"].includes(this.snapshot.state)) return;
    this.starting = true;
    this.transition("awakening", { error: null, cloudProcessing: true });
    await audit("realtime_session_requested", `reason: ${reason}`);

    try {
      if (!this.settings.apiKeyStored) {
        throw new Error("Add your OpenAI API key in Settings before using realtime voice.");
      }

      await stopWakeListener();
      this.transition("connecting");

      const credential = await invoke<RealtimeSessionCredential>("create_realtime_session", {
        input: {
          api_base_url: this.settings.apiBaseUrl,
          model: this.settings.realtimeVoiceModel || "gpt-4o-realtime-preview",
          voice: this.settings.realtimeVoiceName || "alloy",
          instructions:
            "You are Klak, a concise local-first desktop assistant. Do not execute tools directly. If a user asks for an action, explain that Klak will prepare an approval preview in the app."
        }
      });

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      this.stream = stream;
      this.snapshot.selectedMicrophone = stream.getAudioTracks()[0]?.label ?? "Microphone";

      const peer = new RTCPeerConnection();
      this.peer = peer;
      stream.getAudioTracks().forEach((track) => peer.addTrack(track, stream));
      peer.onconnectionstatechange = () => {
        if (["failed", "disconnected"].includes(peer.connectionState)) {
          void this.fail(`Realtime connection ${peer.connectionState}.`);
        }
      };
      peer.ontrack = (event) => this.attachAssistantAudio(event.streams[0]);

      const channel = peer.createDataChannel("oai-events");
      this.channel = channel;
      channel.onopen = () => {
        this.transition("listening");
        void audit("realtime_listening_started", `model: ${credential.model}`);
      };
      channel.onmessage = (event) => this.handleEvent(event.data);
      channel.onerror = () => void this.fail("Realtime data channel failed.");
      channel.onclose = () => {
        if (!["closing", "idle", "error"].includes(this.snapshot.state)) void this.close("channel_closed");
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const sdpResponse = await fetch(credential.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credential.client_secret}`,
          "Content-Type": "application/sdp"
        },
        body: offer.sdp
      });

      if (!sdpResponse.ok) {
        throw new Error(`Realtime WebRTC handshake returned ${sdpResponse.status}.`);
      }

      await peer.setRemoteDescription({ type: "answer", sdp: await sdpResponse.text() });
      await audit("realtime_session_connected", `model: ${credential.model}`);
    } catch (error) {
      await this.fail(error instanceof Error ? error.message : String(error));
    } finally {
      this.starting = false;
    }
  }

  stopSpeaking(): void {
    if (!this.channel || this.channel.readyState !== "open") return;
    this.stopAssistantAudio();
    this.channel.send(JSON.stringify({ type: "response.cancel" }));
    this.transition("interrupted");
    void audit("realtime_response_interrupted", "user stopped assistant audio");
    window.setTimeout(() => {
      if (this.snapshot.state === "interrupted") this.transition("listening");
    }, 250);
  }

  async close(reason = "ended_by_user"): Promise<void> {
    if (this.snapshot.state === "closing" || this.snapshot.state === "idle") return;
    this.transition("closing");
    this.cleanup();
    await audit("realtime_session_closed", `reason: ${reason}`);
    if (this.settings.wakeWordEnabled) await syncWakeListener(this.settings).catch(() => undefined);
    this.transition("idle", {
      cloudProcessing: false,
      partialUserTranscript: "",
      partialAssistantTranscript: ""
    });
  }

  private handleEvent(raw: unknown): void {
    if (typeof raw !== "string") return;
    let event: RealtimeServerEvent;
    try {
      event = JSON.parse(raw) as RealtimeServerEvent;
    } catch {
      return;
    }

    switch (event.type) {
      case "input_audio_buffer.speech_started":
        if (this.snapshot.state === "assistant_speaking") this.stopSpeaking();
        this.transition("user_speaking", { partialUserTranscript: "", partialAssistantTranscript: "" });
        break;
      case "input_audio_buffer.speech_stopped":
        this.transition("processing");
        break;
      case "input_audio_buffer.committed":
        void audit("realtime_user_turn_completed", "input audio committed");
        break;
      case "conversation.item.input_audio_transcription.delta":
        this.transition(this.snapshot.state, {
          partialUserTranscript: `${this.snapshot.partialUserTranscript}${stringField(event, "delta")}`
        });
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (looksLikeSleepPhrase(stringField(event, "transcript") || this.snapshot.partialUserTranscript)) {
          void this.close("sleep_phrase");
          break;
        }
        this.transition(this.snapshot.state, {
          finalUserTranscript: stringField(event, "transcript") || this.snapshot.partialUserTranscript,
          partialUserTranscript: ""
        });
        break;
      case "response.created":
        this.transition("assistant_speaking", { partialAssistantTranscript: "" });
        void audit("realtime_assistant_response_started", "response started");
        break;
      case "response.audio_transcript.delta":
        this.transition("assistant_speaking", {
          partialAssistantTranscript: `${this.snapshot.partialAssistantTranscript}${stringField(event, "delta")}`
        });
        break;
      case "response.audio_transcript.done":
        this.transition("assistant_speaking", {
          finalAssistantTranscript: stringField(event, "transcript") || this.snapshot.partialAssistantTranscript,
          partialAssistantTranscript: ""
        });
        break;
      case "response.done":
        this.onFinalTurn?.({
          userTranscript: this.snapshot.finalUserTranscript,
          assistantTranscript: this.snapshot.finalAssistantTranscript || this.snapshot.partialAssistantTranscript
        });
        this.transition("listening", { partialAssistantTranscript: "" });
        break;
      case "response.cancelled":
        this.transition("interrupted");
        window.setTimeout(() => {
          if (this.snapshot.state === "interrupted") this.transition("listening");
        }, 250);
        break;
      case "error":
        void this.fail(errorMessage(event));
        break;
      default:
        break;
    }
  }

  private attachAssistantAudio(stream: MediaStream): void {
    this.stopAssistantAudio();
    const audio = new Audio();
    audio.autoplay = true;
    audio.srcObject = stream;
    this.audio = audio;
    void audio.play().catch(() => undefined);
  }

  private stopAssistantAudio(): void {
    if (!this.audio) return;
    this.audio.pause();
    this.audio.srcObject = null;
    this.audio.remove();
    this.audio = null;
  }

  private cleanup(): void {
    this.clearInactivityTimer();
    this.stopAssistantAudio();
    this.channel?.close();
    this.channel = null;
    this.peer?.close();
    this.peer = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  private async fail(message: string): Promise<void> {
    this.cleanup();
    await audit("realtime_session_failed", `error: ${message.slice(0, 160)}`, "failed");
    if (this.settings.wakeWordEnabled) await syncWakeListener(this.settings).catch(() => undefined);
    this.transition("error", { error: message, cloudProcessing: false });
  }

  private transition(state: RealtimeVoiceState, patch: Partial<RealtimeVoiceSnapshot> = {}): void {
    this.snapshot = { ...this.snapshot, ...patch, state };
    if (state === "listening") this.armInactivityTimer();
    if (["user_speaking", "assistant_speaking", "processing", "closing", "idle", "error"].includes(state)) {
      this.clearInactivityTimer();
    }
    this.onUpdate({ ...this.snapshot });
  }

  private armInactivityTimer(): void {
    this.clearInactivityTimer();
    this.inactivityTimer = window.setTimeout(() => {
      void this.close("inactivity_timeout");
    }, 5 * 60 * 1000);
  }

  private clearInactivityTimer(): void {
    if (this.inactivityTimer === null) return;
    window.clearTimeout(this.inactivityTimer);
    this.inactivityTimer = null;
  }
}

async function audit(toolName: string, inputSummary: string, status: "completed" | "failed" = "completed") {
  await createActionLog({
    tool_name: toolName,
    input_summary: inputSummary,
    risk_level: "medium",
    status,
    user_approved: true
  }).catch(() => undefined);
}

function looksLikeSleepPhrase(value: string): boolean {
  return /^(go to sleep|stop listening|sleep now|that's all|that is all)\.?$/i.test(value.trim());
}

function stringField(event: Record<string, unknown>, key: string): string {
  const value = event[key];
  return typeof value === "string" ? value : "";
}

function errorMessage(event: Record<string, unknown>): string {
  const error = event.error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Realtime session error.";
}
