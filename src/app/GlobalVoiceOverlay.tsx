import { Bot, MicOff, PlayCircle, Radio, Square, Sparkles } from "lucide-react";
import { ActionPreviewCard } from "../components/ActionPreviewCard";
import { useGlobalVoiceController } from "./GlobalVoiceController";

export function GlobalVoiceOverlay() {
  const voice = useGlobalVoiceController();
  const hasDiagnostics = voice.diagnostics.length > 0;
  const lastDiagnostic = hasDiagnostics ? voice.diagnostics[voice.diagnostics.length - 1] : null;

  return (
    <div className="global-voice-overlay" aria-live="polite">
      <div className="global-voice-overlay__header">
        <div>
          <span className="global-voice-overlay__eyebrow">Global voice</span>
          <strong>{voice.label}</strong>
        </div>
        <span className={`status-badge ${voice.phase === "error" ? "status-error" : ""}`}>{voice.label}</span>
      </div>

      <p className="global-voice-overlay__detail">
        {voice.detail || "Waiting for a wake phrase."}
      </p>

      {voice.pendingPreview && (
        <div className="global-voice-overlay__diagnostic">
          <Sparkles size={14} />
          <span>Approval required. Say yes to approve or no to cancel.</span>
        </div>
      )}

      {voice.snapshot && (
        <div className="global-voice-overlay__transcripts">
          <div>
            <span>You</span>
            <strong>{voice.snapshot.finalUserTranscript || voice.snapshot.partialUserTranscript || " "}</strong>
          </div>
          <div>
            <span>Klak</span>
            <strong>{voice.snapshot.finalAssistantTranscript || voice.snapshot.partialAssistantTranscript || " "}</strong>
          </div>
        </div>
      )}

      {lastDiagnostic && (
        <div className="global-voice-overlay__diagnostic">
          <Sparkles size={14} />
          <span>{lastDiagnostic.message}</span>
        </div>
      )}

      {voice.pendingPreview && (
        <div className="global-voice-overlay__preview">
          <ActionPreviewCard
            preview={voice.pendingPreview}
            onApprove={() => voice.approvePendingPreview()}
            onDeny={() => voice.denyPendingPreview()}
            onDone={() => undefined}
          />
        </div>
      )}

      <div className="global-voice-overlay__actions">
        <button type="button" onClick={() => voice.stopSpeaking()} disabled={!voice.canStopSpeaking}>
          <MicOff size={15} />
          Stop speaking
        </button>
        <button type="button" onClick={() => void voice.endConversation()} disabled={!voice.canEndConversation}>
          <Square size={15} />
          End conversation
        </button>
        <button type="button" onClick={() => void voice.retryConnection()} disabled={!voice.canRetry}>
          <PlayCircle size={15} />
          Retry
        </button>
        <button type="button" onClick={voice.openAssistant}>
          <Bot size={15} />
          Open Assistant
        </button>
      </div>

      <div className={`global-voice-overlay__pulse ${voice.listeningReady ? "ready" : ""}`}>
        <Radio size={16} />
      </div>
    </div>
  );
}
