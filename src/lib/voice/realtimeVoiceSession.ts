import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "../../types";
import { createActionLog } from "../logs/actionLogRepository";
import {
  RealtimeVoiceOperatorBridge,
  type RealtimeVoiceOperatorUpdate
} from "./RealtimeVoiceOperatorBridge";
import { RealtimeTurnOwnership } from "./realtimeTurnOwnership";
import { stopWakeListener, syncWakeListener } from "./wakeListener";
import { isDeterministicSleepCommand } from "./voiceApprovalMatcher";

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
  private configuredSessionGeneration: number | null = null;
  private turnOwnership = new RealtimeTurnOwnership();
  private micAcquired = false;
  private peerConnected = false;
  private dataChannelOpen = false;
  private sessionCreated = false;
  private suppressNextAssistantResponse = false;
  private snapshot: RealtimeVoiceSnapshot = { ...emptySnapshot };

  constructor(
    private readonly settings: AppSettings,
    private readonly operatorBridge: RealtimeVoiceOperatorBridge,
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
          instructions: this.operatorBridge.buildSessionInstructions()
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
        this.maybeConfigureRealtimeSession(generation);
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

    const responseId = this.turnOwnership.getCurrentResponseId();
    if (responseId) {
      this.turnOwnership.cancelResponse(responseId);
      this.sendEvent({ type: "response.cancel", response: { id: responseId } });
      this.sendEvent({ type: "output_audio_buffer.clear" });
      this.emitDiagnostic("response_cancel_requested", `response_id=${responseId}`);
    }

    this.transition("interrupted");
    void audit("realtime_response_interrupted", "user stopped assistant audio");

    window.setTimeout(() => {
      if (this.snapshot.state === "interrupted") this.transition("listening");
    }, 250);
  }

  async publishOperatorUpdate(update: RealtimeVoiceOperatorUpdate): Promise<void> {
    if (!this.isGenerationActive(update.sessionGeneration)) return;
    if (!this.channel || this.channel.readyState !== "open") return;

    this.emitDiagnostic(
      "result_returned_to_realtime",
      `call_id=${update.callId} response_id=${update.responseId} item_id=${update.outputItemId} status=${update.status}`
    );

    this.sendEvent({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: update.callId,
        output: JSON.stringify({
          status: update.status,
          message: update.message
        })
      }
    });

    this.sendEvent({
      type: "response.create",
      response: {
        instructions:
          "Respond briefly to the latest tool result. Confirm success only for completed. Explain denied, blocked, or failed results honestly.",
        output_modalities: ["audio"]
      }
    });
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
    const resolvedResponseId = responseObjectId || responseId;
    const outputItemId = nestedStringField(event, "item", "id") || itemId;

    switch (event.type) {
      case "input_audio_buffer.speech_started":
        if (!this.turnOwnership.beginUserTurn(itemId)) break;
        this.emitDiagnostic("speech_started", `item_id=${itemId || "unknown"}`);
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
        this.emitDiagnostic("speech_stopped", `item_id=${itemId || "unknown"}`);
        this.transition("processing");
        break;
      case "input_audio_buffer.committed":
        void audit("realtime_user_turn_completed", "input audio committed");
        break;
      case "conversation.item.input_audio_transcription.delta":
        {
          const partial = this.turnOwnership.appendUserTranscript(itemId, stringField(event, "delta"));
          if (partial !== null) {
            this.transition(this.snapshot.state, { partialUserTranscript: partial });
          }
        }
        break;
      case "conversation.item.input_audio_transcription.completed":
        {
          const transcript = this.turnOwnership.finalizeUserTranscript(
            itemId,
            stringField(event, "transcript") || this.turnOwnership.getCurrentUserPartialTranscript()
          );
          if (!transcript) break;
          if (isDeterministicSleepCommand(transcript)) {
            void this.close("sleep_phrase");
            break;
          }
          void this.handleApprovalTranscript(transcript);
          this.emitDiagnostic("user_transcript_finalized", `item_id=${itemId || "unknown"}`);
          this.transition(this.snapshot.state, {
            finalUserTranscript: transcript,
            partialUserTranscript: ""
          });
        }
        break;
      case "response.created":
        if (this.suppressNextAssistantResponse) {
          this.suppressNextAssistantResponse = false;
          if (resolvedResponseId) {
            this.sendEvent({ type: "response.cancel", response: { id: resolvedResponseId } });
          }
          break;
        }
        this.turnOwnership.beginResponse(resolvedResponseId);
        this.transition("processing");
        this.emitDiagnostic("response_created", `response_id=${resolvedResponseId || "unknown"}`);
        void audit("realtime_assistant_response_started", "response started");
        break;
      case "response.output_item.added":
      case "response.output_item.done":
        this.turnOwnership.registerResponseOutput(resolvedResponseId, outputItemId);
        break;
      case "response.output_audio.delta":
        if (this.turnOwnership.isActiveResponse(resolvedResponseId, outputItemId)) {
          this.resumeAssistantAudio();
          this.emitDiagnostic(
            "assistant_audio_started",
            `response_id=${resolvedResponseId || "unknown"} item_id=${outputItemId || "unknown"}`
          );
          this.transition("assistant_speaking");
        }
        break;
      case "response.output_audio_transcript.delta":
        {
          const partial = this.turnOwnership.appendAssistantTranscript(
            resolvedResponseId,
            outputItemId,
            stringField(event, "delta")
          );
          if (partial !== null) {
            this.turnOwnership.registerResponseOutput(resolvedResponseId, outputItemId);
            this.resumeAssistantAudio();
            this.emitDiagnostic(
              "assistant_audio_started",
              `response_id=${resolvedResponseId || "unknown"} item_id=${outputItemId || "unknown"}`
            );
            this.transition("assistant_speaking", {
              partialAssistantTranscript: partial
            });
          }
        }
        break;
      case "response.output_audio_transcript.done":
        {
          const finalTranscript = this.turnOwnership.finalizeAssistantTranscript(
            resolvedResponseId,
            outputItemId,
            stringField(event, "transcript") || this.turnOwnership.getCurrentAssistantPartialTranscript()
          );
          if (finalTranscript !== null) {
            this.turnOwnership.registerResponseOutput(resolvedResponseId, outputItemId);
            this.transition("assistant_speaking", {
              finalAssistantTranscript: finalTranscript,
              partialAssistantTranscript: ""
            });
          }
        }
        break;
      case "response.function_call_arguments.done":
        if (this.turnOwnership.isActiveResponse(resolvedResponseId, outputItemId)) {
          this.turnOwnership.registerResponseOutput(resolvedResponseId, outputItemId);
          void this.handleFunctionCall({
            sessionGeneration: generation,
            responseId: resolvedResponseId,
            outputItemId,
            callId: stringField(event, "call_id"),
            name: stringField(event, "name"),
            argumentsJson: stringField(event, "arguments")
          });
        }
        break;
      case "session.created":
        this.sessionCreated = true;
        this.emitDiagnostic("session_created", "session.created");
        this.maybeConfigureRealtimeSession(generation);
        this.maybeEnterListening();
        break;
      case "session.updated":
        this.emitDiagnostic("session_updated", "session.updated");
        break;
      case "response.done":
        this.emitDiagnostic("response_done", `response_id=${resolvedResponseId || "unknown"}`);
        this.handleResponseDone(resolvedResponseId);
        break;
      case "response.cancelled":
        if (this.turnOwnership.isActiveResponse(resolvedResponseId, outputItemId)) {
          this.handleResponseCancellation(resolvedResponseId);
        }
        break;
      case "error":
        void this.fail(errorMessage(event), generation);
        break;
      default:
        break;
    }
  }

  private async handleFunctionCall(call: {
    sessionGeneration: number;
    responseId: string;
    outputItemId: string;
    callId: string;
    name: string;
    argumentsJson: string;
  }): Promise<void> {
    const resolution = await this.operatorBridge.handleFunctionCall(call);
    if (resolution.kind === "pending") {
      return;
    }

    this.emitDiagnostic(
      "result_returned_to_realtime",
      `call_id=${call.callId} response_id=${call.responseId} item_id=${call.outputItemId} status=${resolution.kind}`
    );

    await this.publishOperatorUpdate({
      sessionGeneration: call.sessionGeneration,
      responseId: call.responseId,
      outputItemId: call.outputItemId,
      callId: call.callId,
      functionName: call.name,
      status: resolution.kind === "completed" ? "completed" : resolution.kind,
      message: resolution.message,
      preview: resolution.preview ?? null
    });
  }

  private async handleApprovalTranscript(transcript: string): Promise<void> {
    const pending = this.operatorBridge.getPendingAction();
    if (!pending) return;

    if (isDeterministicSleepCommand(transcript)) {
      void this.close("sleep_phrase");
      return;
    }

    const approval = await this.operatorBridge.resolveVoiceApproval(transcript);
    if (!approval) {
      this.emitDiagnostic("approval_ambiguous", "Approval response was unclear; Klak needs a clear yes or no.");
      return;
    }

    this.suppressNextAssistantResponse = true;
    window.setTimeout(() => {
      void this.publishOperatorUpdate(approval);
    }, 0);
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
    this.turnOwnership.reset();
    this.operatorBridge.clearPendingAction();
    this.configuredSessionGeneration = null;
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

  private handleResponseCancellation(responseId?: string): void {
    this.turnOwnership.cancelResponse(responseId);
    this.pauseAssistantAudio();
    this.transition("interrupted");
    window.setTimeout(() => {
      if (this.snapshot.state === "interrupted") this.transition("listening");
    }, 250);
  }

  private handleResponseDone(responseId?: string): void {
    const completedTurn = this.turnOwnership.completeResponse(responseId);
    if (!completedTurn) return;

    this.onFinalTurn?.(completedTurn);

    if (this.snapshot.state === "user_speaking") {
      this.transition("user_speaking", { partialAssistantTranscript: "" });
      return;
    }

    this.transition("listening", {
      partialAssistantTranscript: "",
      finalAssistantTranscript: completedTurn.assistantTranscript || this.turnOwnership.getCurrentAssistantFinalTranscript()
    });
  }

  private maybeConfigureRealtimeSession(generation: number): void {
    if (!this.isGenerationActive(generation)) return;
    if (!this.channel || this.channel.readyState !== "open" || !this.sessionCreated) return;
    if (this.configuredSessionGeneration === generation) return;

    this.sendEvent({
      type: "session.update",
      session: {
        type: "realtime",
        instructions: this.operatorBridge.buildSessionInstructions(),
        output_modalities: ["audio"],
        tools: this.operatorBridge.getRealtimeTools(),
        tool_choice: "auto"
      }
    });
    this.configuredSessionGeneration = generation;
  }

  private sendEvent(payload: Record<string, unknown>): void {
    if (!this.channel || this.channel.readyState !== "open") return;
    this.channel.send(JSON.stringify(payload));
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

function normalizeSpokenPhrase(value: string): string {
  return value.trim().toLowerCase().replace(/[.!?,]+$/g, "").replace(/\s+/g, " ");
}

function looksLikeSleepPhrase(value: string): boolean {
  const normalized = normalizeSpokenPhrase(value);
  return [
    "go to sleep",
    "stop listening",
    "go away",
    "bye for now",
    "that is all",
    "end conversation"
  ].includes(normalized);
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
