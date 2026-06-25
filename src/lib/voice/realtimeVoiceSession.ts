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
  | "reconnecting"
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

type RealtimeServerEvent = { type: string } & Record<string, unknown>;

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
  private connectionRecoveryTimer: number | null = null;
  private starting = false;
  private lifecycleGeneration = 0;
  private currentTurnGeneration = 0;
  private currentUserItemId: string | null = null;
  private currentResponseId: string | null = null;
  private userItemGenerations = new Map<string, number>();
  private responseGenerations = new Map<string, number>();
  private micAcquired = false;
  private peerConnected = false;
  private dataChannelOpen = false;
  private sessionCreated = false;
  private snapshot: RealtimeVoiceSnapshot = { ...emptySnapshot };

  constructor(
    private readonly settings: AppSettings,
    private readonly onUpdate: (snapshot: RealtimeVoiceSnapshot) => void,
    private readonly onFinalTurn?: (turn: { userTranscript: string; assistantTranscript: string }) => void,
    private readonly onDiagnostic?: (code: string, message: string) => void
  ) {}

  getSnapshot(): RealtimeVoiceSnapshot {
    return { ...this.snapshot };
  }

  async start(reason: "wake" | "summon" | "manual" | "retry" = "manual"): Promise<void> {
    if (this.starting || !["idle", "error"].includes(this.snapshot.state)) return;
    this.starting = true;
    const generation = ++this.lifecycleGeneration;
    this.transition("awakening", { error: null, cloudProcessing: true });
    this.emitDiagnostic("session_start_requested", `reason: ${reason}`);
    await audit("realtime_session_requested", `reason: ${reason}`);

    try {
      if (!this.settings.apiKeyStored) {
        throw new Error("Add your OpenAI API key in Settings before using realtime voice.");
      }

      this.emitDiagnostic("temporary_credential_request_started", "requesting temporary realtime credential");
      this.emitDiagnostic("wake_listener_paused", "wake listener paused");
      await stopWakeListener();
      if (!this.isGenerationActive(generation)) return;

      this.transition("connecting");

      const credential = await invoke<RealtimeSessionCredential>("create_realtime_session", {
        input: {
          api_base_url: this.settings.apiBaseUrl,
          model: this.settings.realtimeVoiceModel || "gpt-realtime-2",
          voice: this.settings.realtimeVoiceName || "alloy",
          instructions:
            "You are Klak, a concise local-first desktop assistant. Do not execute tools directly. If a user asks for an action, explain that Klak will prepare an approval preview in the app."
        }
      });
      this.emitDiagnostic("temporary_credential_acquired", `model: ${credential.model}`);

      if (!this.isGenerationActive(generation)) return;

      this.emitDiagnostic("microphone_request_started", "requesting microphone access");
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
      } catch (error) {
        this.emitDiagnostic(
          "microphone_permission_failure",
          error instanceof Error ? error.message : "microphone permission failed"
        );
        throw error;
      }

      if (!this.isGenerationActive(generation)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      this.stream = stream;
      this.micAcquired = true;
      this.snapshot.selectedMicrophone = stream.getAudioTracks()[0]?.label ?? "Microphone";
      this.emitDiagnostic("microphone_acquired", this.snapshot.selectedMicrophone);

      const peer = new RTCPeerConnection();
      this.peer = peer;
      stream.getAudioTracks().forEach((track) => peer.addTrack(track, stream));

      peer.onconnectionstatechange = () => {
        if (!this.isGenerationActive(generation)) return;
        this.emitDiagnostic("peer_connection_state", peer.connectionState);
        if (peer.connectionState === "connected") {
          this.peerConnected = true;
          this.clearConnectionRecoveryTimer();
          this.maybeEnterListening();
          return;
        }
        if (peer.connectionState === "disconnected") {
          this.peerConnected = false;
          this.armConnectionRecoveryTimer(generation);
          this.transition("reconnecting", {
            error: "Realtime connection briefly disconnected. Klak is trying to recover."
          });
          return;
        }
        if (peer.connectionState === "failed") {
          void this.fail("Realtime connection failed.", generation);
          return;
        }
        if (peer.connectionState === "closed" && !["closing", "idle", "error"].includes(this.snapshot.state)) {
          void this.fail("Realtime connection closed.", generation);
        }
      };

      peer.oniceconnectionstatechange = () => {
        if (!this.isGenerationActive(generation)) return;
        this.emitDiagnostic("ice_connection_state", peer.iceConnectionState);
        if (peer.iceConnectionState === "connected" || peer.iceConnectionState === "completed") {
          this.peerConnected = true;
          this.clearConnectionRecoveryTimer();
          this.maybeEnterListening();
          return;
        }
        if (peer.iceConnectionState === "disconnected") {
          this.peerConnected = false;
          this.armConnectionRecoveryTimer(generation);
          this.transition("reconnecting", {
            error: "Realtime ICE connection briefly disconnected. Klak is trying to recover."
          });
          return;
        }
        if (peer.iceConnectionState === "failed") {
          void this.fail("Realtime ICE connection failed.", generation);
        }
      };

      peer.ontrack = (event) => this.attachAssistantAudio(event.streams[0]);

      const channel = peer.createDataChannel("oai-events");
      this.channel = channel;
      channel.onopen = () => {
        if (!this.isGenerationActive(generation)) return;
        this.dataChannelOpen = true;
        this.emitDiagnostic("data_channel_open", "oai-events");
        this.maybeEnterListening(credential.model);
      };
      channel.onmessage = (event) => this.handleEvent(event.data, generation);
      channel.onerror = () => {
        this.emitDiagnostic("data_channel_error", "oai-events");
        void this.fail("Realtime data channel failed.", generation);
      };
      channel.onclose = () => {
        if (!this.isGenerationActive(generation)) return;
        this.dataChannelOpen = false;
        this.emitDiagnostic("data_channel_close", "oai-events");
        if (!["closing", "idle", "error"].includes(this.snapshot.state)) void this.close("channel_closed");
      };

      const offer = await peer.createOffer();
      if (!this.isGenerationActive(generation)) {
        this.cleanup();
        return;
      }

      await peer.setLocalDescription(offer);
      if (!this.isGenerationActive(generation)) {
        this.cleanup();
        return;
      }

      const sdpResponse = await fetch(credential.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credential.client_secret}`,
          "Content-Type": "application/sdp"
        },
        body: offer.sdp
      });

      if (!this.isGenerationActive(generation)) {
        this.cleanup();
        return;
      }

      if (!sdpResponse.ok) {
        const detail = await sdpResponse.text().catch(() => "");
        this.emitDiagnostic("sdp_request_failure", `status: ${sdpResponse.status}`);
        throw new Error(
          `Realtime WebRTC handshake returned ${sdpResponse.status}${detail ? `: ${detail.slice(0, 160)}` : ""}.`
        );
      }

      this.emitDiagnostic("sdp_request_success", `status: ${sdpResponse.status}`);
      const answerSdp = await sdpResponse.text();
      await peer.setRemoteDescription({ type: "answer", sdp: answerSdp });

      if (!this.isGenerationActive(generation)) {
        this.cleanup();
        return;
      }

      await audit("realtime_session_connected", `model: ${credential.model}`);
    } catch (error) {
      if (this.isGenerationActive(generation)) {
        await this.fail(error instanceof Error ? error.message : String(error), generation);
      }
    } finally {
      if (this.isGenerationActive(generation)) {
        this.starting = false;
      }
    }
  }

  stopSpeaking(): void {
    if (!this.channel || this.channel.readyState !== "open") return;
    this.pauseAssistantAudio();

    if (this.currentResponseId) {
      this.channel.send(
        JSON.stringify({ type: "response.cancel", response: { id: this.currentResponseId } })
      );
      this.channel.send(JSON.stringify({ type: "output_audio_buffer.clear" }));
    }

    this.transition("interrupted");
    void audit("realtime_response_interrupted", "user stopped assistant audio");

    window.setTimeout(() => {
      if (this.snapshot.state === "interrupted") this.transition("listening");
    }, 250);
  }

  async close(reason = "ended_by_user"): Promise<void> {
    if (this.snapshot.state === "closing" || this.snapshot.state === "idle") return;
    this.starting = false;
    const generation = ++this.lifecycleGeneration;
    this.emitDiagnostic("session_cleanup_started", `reason: ${reason}`);
    this.transition("closing");
    this.cleanup();
    await audit("realtime_session_closed", `reason: ${reason}`);
    if (!this.isGenerationActive(generation)) return;
    this.transition("idle", {
      cloudProcessing: false,
      partialUserTranscript: "",
      finalUserTranscript: "",
      partialAssistantTranscript: "",
      finalAssistantTranscript: "",
      error: null
    });
  }

  private handleEvent(raw: unknown, generation: number): void {
    if (!this.isGenerationActive(generation)) return;
    if (typeof raw !== "string") return;

    let event: RealtimeServerEvent;
    try {
      event = JSON.parse(raw) as RealtimeServerEvent;
    } catch {
      return;
    }

    const itemId = stringField(event, "item_id");
    const responseId = responseIdField(event);
    const responseObjectId = nestedStringField(event, "response", "id");

    switch (event.type) {
      case "input_audio_buffer.speech_started":
        if (!this.beginUserTurn(itemId)) break;
        this.emitDiagnostic("speech_started", "input_audio_buffer.speech_started");
        if (this.snapshot.state === "assistant_speaking") {
          this.pauseAssistantAudio();
          this.transition("interrupted");
        }
        this.transition("user_speaking", {
          partialUserTranscript: "",
          finalUserTranscript: "",
          partialAssistantTranscript: "",
          finalAssistantTranscript: "",
          error: null
        });
        break;
      case "input_audio_buffer.speech_stopped":
        this.emitDiagnostic("speech_stopped", "input_audio_buffer.speech_stopped");
        this.transition("processing");
        break;
      case "input_audio_buffer.committed":
        void audit("realtime_user_turn_completed", "input audio committed");
        break;
      case "conversation.item.input_audio_transcription.delta":
        if (this.acceptsUserTranscript(itemId)) {
          this.transition(this.snapshot.state, {
            partialUserTranscript: `${this.snapshot.partialUserTranscript}${stringField(event, "delta")}`
          });
        }
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (!this.acceptsUserTranscript(itemId)) break;
        {
          const transcript = stringField(event, "transcript") || this.snapshot.partialUserTranscript;
          if (looksLikeSleepPhrase(transcript)) {
            void this.close("sleep_phrase");
            break;
          }
          this.emitDiagnostic("user_transcript_finalized", "conversation item transcript completed");
          this.transition(this.snapshot.state, {
            finalUserTranscript: transcript,
            partialUserTranscript: ""
          });
        }
        break;
      case "response.created":
        this.beginResponse(responseObjectId);
        this.transition("processing");
        this.emitDiagnostic("response_created", "response.created");
        void audit("realtime_assistant_response_started", "response started");
        break;
      case "response.output_audio.delta":
        if (this.acceptsResponseEvent(responseId)) {
          this.beginAssistantOutput(responseId);
          this.resumeAssistantAudio();
          this.emitDiagnostic("assistant_audio_started", "response.output_audio.delta");
          this.transition("assistant_speaking");
        }
        break;
      case "response.output_audio.done":
        if (this.acceptsResponseEvent(responseId)) {
          this.beginAssistantOutput(responseId);
        }
        break;
      case "response.output_audio_transcript.delta":
        if (this.acceptsResponseEvent(responseId)) {
          this.beginAssistantOutput(responseId);
          this.resumeAssistantAudio();
          this.emitDiagnostic("assistant_audio_started", "response.output_audio_transcript.delta");
          this.transition("assistant_speaking", {
            partialAssistantTranscript: `${this.snapshot.partialAssistantTranscript}${stringField(event, "delta")}`
          });
        }
        break;
      case "response.output_audio_transcript.done":
        if (this.acceptsResponseEvent(responseId)) {
          this.beginAssistantOutput(responseId);
          this.transition("assistant_speaking", {
            finalAssistantTranscript: stringField(event, "transcript") || this.snapshot.partialAssistantTranscript,
            partialAssistantTranscript: ""
          });
        }
        break;
      case "session.created":
        this.sessionCreated = true;
        this.emitDiagnostic("session_created", "session.created");
        this.maybeEnterListening();
        break;
      case "session.updated":
        this.emitDiagnostic("session_updated", "session.updated");
        break;
      case "response.done":
        this.emitDiagnostic("response_done", "response.done");
        this.handleResponseDone(responseObjectId || responseId);
        break;
      case "response.cancelled":
        if (this.acceptsResponseEvent(responseObjectId || responseId)) {
          this.handleResponseCancellation(responseObjectId || responseId);
        }
        break;
      case "error":
        void this.fail(errorMessage(event), generation);
        break;
      default:
        break;
    }
  }

  private attachAssistantAudio(stream: MediaStream): void {
    if (!this.audio) {
      const audio = new Audio();
      audio.autoplay = true;
      audio.srcObject = stream;
      this.audio = audio;
      void audio.play().catch(() => undefined);
      return;
    }

    this.audio.srcObject = stream;
    void this.audio.play().catch(() => undefined);
  }

  private resumeAssistantAudio(): void {
    if (!this.audio) return;
    void this.audio.play().catch(() => undefined);
  }

  private pauseAssistantAudio(): void {
    if (!this.audio) return;
    this.audio.pause();
  }

  private detachAssistantAudio(): void {
    if (!this.audio) return;
    this.audio.pause();
    this.audio.srcObject = null;
    this.audio.remove();
    this.audio = null;
  }

  private cleanup(): void {
    this.clearInactivityTimer();
    this.clearConnectionRecoveryTimer();
    this.detachAssistantAudio();
    this.channel?.close();
    this.channel = null;
    this.peer?.close();
    this.peer = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.currentResponseId = null;
    this.currentUserItemId = null;
    this.responseGenerations.clear();
    this.userItemGenerations.clear();
    this.micAcquired = false;
    this.peerConnected = false;
    this.dataChannelOpen = false;
    this.sessionCreated = false;
  }

  private async fail(message: string, generation?: number): Promise<void> {
    if (generation !== undefined && !this.isGenerationActive(generation)) return;
    this.starting = false;
    this.cleanup();
    this.emitDiagnostic("session_failed", message);
    await audit("realtime_session_failed", `error: ${message.slice(0, 160)}`, "failed");
    if (this.settings.wakeWordEnabled) {
      const wakeStatus = await syncWakeListener(this.settings).catch(() => undefined);
      if (wakeStatus?.running) {
        this.emitDiagnostic("wake_listener_resumed", "wake listener resumed");
      }
    }
    if (generation === undefined || this.isGenerationActive(generation)) {
      this.transition("error", { error: message, cloudProcessing: false });
    }
  }

  private transition(state: RealtimeVoiceState, patch: Partial<RealtimeVoiceSnapshot> = {}): void {
    this.snapshot = { ...this.snapshot, ...patch, state };
    if (state === "listening") this.armInactivityTimer();
    if (["user_speaking", "assistant_speaking", "processing", "interrupted", "closing", "idle", "error"].includes(state)) {
      this.clearInactivityTimer();
    }
    this.onUpdate({ ...this.snapshot });
  }

  private beginUserTurn(itemId?: string): boolean {
    if (itemId && itemId === this.currentUserItemId) return false;
    this.currentTurnGeneration += 1;
    this.currentUserItemId = itemId ?? null;
    if (itemId) {
      this.userItemGenerations.set(itemId, this.currentTurnGeneration);
    }
    return true;
  }

  private acceptsUserTranscript(itemId?: string): boolean {
    if (!itemId) return true;
    return this.userItemGenerations.get(itemId) === this.currentTurnGeneration;
  }

  private beginResponse(responseId?: string): void {
    if (!responseId) return;
    this.currentResponseId = responseId;
    this.responseGenerations.set(responseId, this.currentTurnGeneration);
  }

  private beginAssistantOutput(responseId?: string): void {
    if (!responseId) return;
    this.currentResponseId = responseId;
    this.responseGenerations.set(responseId, this.currentTurnGeneration);
  }

  private acceptsResponseEvent(responseId?: string): boolean {
    if (!responseId) return Boolean(this.currentResponseId);
    return this.responseGenerations.get(responseId) === this.currentTurnGeneration;
  }

  private handleResponseCancellation(responseId?: string): void {
    if (responseId && this.currentResponseId && responseId !== this.currentResponseId) return;
    this.pauseAssistantAudio();
    this.transition("interrupted");
    window.setTimeout(() => {
      if (this.snapshot.state === "interrupted") this.transition("listening");
    }, 250);
  }

  private handleResponseDone(responseId?: string): void {
    if (!this.acceptsResponseEvent(responseId)) return;
    if (responseId) {
      this.responseGenerations.delete(responseId);
      if (this.currentResponseId === responseId) {
        this.currentResponseId = null;
      }
    }

    const assistantTranscript = this.snapshot.finalAssistantTranscript || this.snapshot.partialAssistantTranscript;
    this.onFinalTurn?.({
      userTranscript: this.snapshot.finalUserTranscript,
      assistantTranscript
    });

    if (this.snapshot.state === "user_speaking") {
      this.transition("user_speaking", { partialAssistantTranscript: "" });
      return;
    }

    this.transition("listening", { partialAssistantTranscript: "" });
  }

  private armConnectionRecoveryTimer(generation: number): void {
    this.clearConnectionRecoveryTimer();
    this.connectionRecoveryTimer = window.setTimeout(() => {
      if (!this.isGenerationActive(generation)) return;
      if (this.peer?.connectionState === "disconnected") {
        void this.fail("Realtime connection disconnected.", generation);
      }
    }, 3500);
  }

  private clearConnectionRecoveryTimer(): void {
    if (this.connectionRecoveryTimer === null) return;
    window.clearTimeout(this.connectionRecoveryTimer);
    this.connectionRecoveryTimer = null;
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

  private isGenerationActive(generation: number): boolean {
    return this.lifecycleGeneration === generation;
  }

  private maybeEnterListening(model?: string): void {
    if (!this.micAcquired || !this.peerConnected || !this.dataChannelOpen || !this.sessionCreated) return;
    if (this.snapshot.state !== "listening") {
      this.transition("listening");
      void audit("realtime_listening_started", `model: ${(model ?? this.settings.realtimeVoiceModel) || "gpt-realtime-2"}`);
      this.emitDiagnostic("ready_to_listen", `model: ${(model ?? this.settings.realtimeVoiceModel) || "gpt-realtime-2"}`);
    }
  }

  private emitDiagnostic(code: string, message: string): void {
    this.onDiagnostic?.(code, message);
    void audit(`realtime_${code}`, message);
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

function nestedStringField(event: Record<string, unknown>, outerKey: string, innerKey: string): string {
  const nested = event[outerKey];
  if (!nested || typeof nested !== "object") return "";
  const value = (nested as Record<string, unknown>)[innerKey];
  return typeof value === "string" ? value : "";
}

function responseIdField(event: Record<string, unknown>): string {
  return stringField(event, "response_id") || nestedStringField(event, "response", "id");
}

function errorMessage(event: Record<string, unknown>): string {
  const error = event.error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Realtime session error.";
}
