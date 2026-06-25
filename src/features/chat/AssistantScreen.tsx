import {
  Bot,
  ClipboardCheck,
  PlayCircle,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
  Volume2
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActionPreviewCard } from "../../components/ActionPreviewCard";
import { OperatorTaskPanel } from "../../components/OperatorTaskPanel";
import { ScreenHeader } from "../../components/ScreenHeader";
import type { ActionPreview, AppSettings, ChatMessage, OperatorTaskRunHydrated } from "../../types";
import { sendChatMessage } from "../../lib/ai/chatOrchestrator";
import { id, nowIso } from "../../lib/utils";
import { buildActionPreviewForSuggestion } from "../../lib/tools/toolProposals";
import { VoiceRecorder } from "../../components/VoiceRecorder";
import { RealtimeVoicePanel } from "../../components/RealtimeVoicePanel";
import { speakText } from "../../lib/voice/transcription";
import { approveAction, denyAction } from "../../lib/permissions/policy";
import { executeApprovedTool } from "../../lib/tools/toolExecutor";
import { createPlannedOperatorTask, runOperatorTask } from "../../lib/operator/operatorRuntime";
import { createActionLog } from "../../lib/logs/actionLogRepository";

const starterPrompts = [
  "Remember that I prefer local-first tools.",
  "Show me what you can safely do.",
  "Help me prepare my work setup.",
  "Search my memory for recent projects."
];

export function AssistantScreen({ settings }: { settings: AppSettings }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: id("msg"),
      role: "assistant",
      content: "Hi, I'm Klak. I can chat, search local memory, preview safe local actions, and run bounded operator tasks.",
      createdAt: nowIso()
    }
  ]);
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<ActionPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);
  const [wakeNotice, setWakeNotice] = useState<string | null>(null);
  const [autoVoiceSignal, setAutoVoiceSignal] = useState(0);
  const [operatorRun, setOperatorRun] = useState<OperatorTaskRunHydrated | null>(null);

  const threadRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<ActionPreview | null>(null);

  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    thread.scrollTop = thread.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    const unlisten = listen("klak-summoned", () => {
      if (settings.voiceConversationMode === "openai_realtime") return;
      const spoken = speakText("I'm listening.", settings);
      if (spoken) setVoiceMessage(spoken);
      window.setTimeout(() => {
        setAutoVoiceSignal((value) => value + 1);
      }, 900);
    });

    return () => {
      unlisten.then((dispose) => dispose());
    };
  }, [settings]);

  useEffect(() => {
    const unlisten = listen<{ model?: string; score?: number; threshold?: number }>("klak-wake-detected", (event) => {
      const score = typeof event.payload.score === "number" ? event.payload.score : null;
      const threshold = typeof event.payload.threshold === "number" ? event.payload.threshold : null;
      const model = event.payload.model || settings.wakeWordModel || "wake word";
      const summary = `Wake word detected - opening voice session${
        score === null ? "" : ` (${score.toFixed(3)} / ${threshold?.toFixed(2) ?? "?"})`
      }.`;
      setWakeNotice(summary);
      void updateCaption(summary);
      void createActionLog({
        tool_name: "wake_word_detected",
        input_summary: `model: ${model}, score: ${score ?? "unknown"}, threshold: ${threshold ?? "unknown"}`,
        risk_level: "medium",
        status: "completed",
        user_approved: true
      });
      window.setTimeout(() => setWakeNotice(null), 8000);
    });

    return () => {
      unlisten.then((dispose) => dispose());
    };
  }, [settings.wakeWordModel]);

  async function submit(overrideText?: string) {
    const content = (overrideText ?? input).trim();
    if (!content || busy) return;
    void updateCaption(`Heard: ${content}`);

    if (previewRef.current && looksLikeVoiceApproval(content)) {
      await approvePreview(previewRef.current);
      setInput("");
      return;
    }

    if (previewRef.current && looksLikeVoiceDenial(content)) {
      await denyPreview(previewRef.current);
      setInput("");
      return;
    }

    const userMessage: ChatMessage = {
      id: id("msg"),
      role: "user",
      content,
      createdAt: nowIso()
    };

    setMessages((items) => [...items, userMessage]);
    setInput("");
    setBusy(true);

    try {
      const response = await sendChatMessage(userMessage.content, settings);

      setMessages((items) => [
        ...items,
        {
          id: id("msg"),
          role: "assistant",
          content: response.message,
          createdAt: nowIso()
        }
      ]);

      if (response.suggestedAction) {
        const nextPreview = await buildActionPreviewForSuggestion(response.suggestedAction, settings);
        if (nextPreview) {
          setPreview(nextPreview);
          const spoken = speakText(`${nextPreview.message} Can I do this? Say yes or no.`, settings);
          if (spoken) setVoiceMessage(spoken);
          void updateCaption(`${nextPreview.message} Say yes or no.`);
          window.setTimeout(() => {
            setAutoVoiceSignal((value) => value + 1);
          }, 2600);
        }
      } else {
        const spoken = speakText(response.message, settings);
        if (spoken) setVoiceMessage(spoken);
        void updateCaption(response.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const addRealtimeTurn = useCallback((turn: { userTranscript: string; assistantTranscript: string }) => {
    const userTranscript = turn.userTranscript.trim();
    const assistantTranscript = turn.assistantTranscript.trim();
    if (!userTranscript && !assistantTranscript) return;
    setMessages((items) => [
      ...items,
      ...(userTranscript
        ? [{ id: id("msg"), role: "user" as const, content: userTranscript, createdAt: nowIso() }]
        : []),
      ...(assistantTranscript
        ? [{ id: id("msg"), role: "assistant" as const, content: assistantTranscript, createdAt: nowIso() }]
        : [])
    ]);
  }, []);

  async function runAsTask() {
    const content = input.trim();
    if (!content || busy) return;
    setBusy(true);
    setMessages((items) => [
      ...items,
      {
        id: id("msg"),
        role: "user",
        content,
        createdAt: nowIso()
      }
    ]);
    setInput("");

    try {
      const planned = await createPlannedOperatorTask(content, settings);
      setOperatorRun(planned);
      const started = await runOperatorTask(planned.id, settings);
      setOperatorRun(started);
      setMessages((items) => [
        ...items,
        {
          id: id("msg"),
          role: "assistant",
          content: `I created a bounded operator task with ${started.steps.length} step${started.steps.length === 1 ? "" : "s"}. Follow it in the task panel while I work through approvals, verification, and recovery.`,
          createdAt: nowIso()
        }
      ]);
    } catch (error) {
      const failed = error instanceof Error ? error.message : String(error);
      setMessages((items) => [
        ...items,
        {
          id: id("msg"),
          role: "assistant",
          content: `I couldn't start that operator task: ${failed}`,
          createdAt: nowIso()
        }
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function approvePreview(nextPreview: ActionPreview) {
    setBusy(true);
    setMessages((items) => [
      ...items,
      { id: id("msg"), role: "user", content: "Yes, do it.", createdAt: nowIso() }
    ]);

    try {
      await approveAction(nextPreview.id);
      await executeApprovedTool(nextPreview, settings);
      setPreview(null);
      const done = "Done.";
      setMessages((items) => [
        ...items,
        { id: id("msg"), role: "assistant", content: done, createdAt: nowIso() }
      ]);
      const spoken = speakText(done, settings);
      if (spoken) setVoiceMessage(spoken);
      void updateCaption(done);
    } catch (error) {
      const failed = error instanceof Error ? error.message : String(error);
      setMessages((items) => [
        ...items,
        { id: id("msg"), role: "assistant", content: `I couldn't complete that: ${failed}`, createdAt: nowIso() }
      ]);
      const spoken = speakText(`I couldn't complete that. ${failed}`, settings);
      if (spoken) setVoiceMessage(spoken);
      void updateCaption(`I couldn't complete that: ${failed}`);
    } finally {
      setBusy(false);
    }
  }

  async function denyPreview(nextPreview: ActionPreview) {
    await denyAction(nextPreview.id);
    setPreview(null);
    const denied = "Okay, I won't do that.";
    setMessages((items) => [
      ...items,
      { id: id("msg"), role: "user", content: "No.", createdAt: nowIso() },
      { id: id("msg"), role: "assistant", content: denied, createdAt: nowIso() }
    ]);
    const spoken = speakText(denied, settings);
    if (spoken) setVoiceMessage(spoken);
    void updateCaption(denied);
  }

  return (
    <div className="screen chat-screen operator-chat-screen">
      <ScreenHeader
        title="Assistant"
        subtitle="Ask Klak to help with local memory, apps, routines, approved actions, or bounded operator tasks."
        actions={
          <div className="header-action-row">
            <button title="Search memory">
              <Search size={16} />
              Memory
            </button>
            <button className="primary" type="button" disabled={busy || !input.trim()} onClick={() => runAsTask()}>
              <PlayCircle size={16} />
              Run Task
            </button>
          </div>
        }
      />

      <div className="operator-status-strip">
        <div className="operator-status-card">
          <ShieldCheck size={18} />
          <div>
            <strong>Permissioned actions</strong>
            <span>Klak previews meaningful actions before running them.</span>
          </div>
        </div>

        <div className="operator-status-card">
          <ClipboardCheck size={18} />
          <div>
            <strong>Local context</strong>
            <span>Memory and activity stay on this device.</span>
          </div>
        </div>

        <div className="operator-status-card">
          <Sparkles size={18} />
          <div>
            <strong>Operator ready</strong>
            <span>Run a bounded task when you want observe-plan-act-verify execution.</span>
          </div>
        </div>
      </div>

      <div className="operator-chat-grid">
        <section className="assistant-workspace">
          <div className="assistant-thread" ref={threadRef}>
            {messages.map((message) => (
              <article key={message.id} className={`operator-message ${message.role}`}>
                <div className="operator-avatar">
                  {message.role === "assistant" ? <Bot size={16} /> : <UserRound size={16} />}
                </div>

                <div className="operator-bubble">
                  <p>{message.content}</p>

                  <div className="operator-message-meta">
                    <span>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>

                    {message.role === "assistant" && (
                      <button
                        className="text-action"
                        title="Speak response"
                        onClick={() => setVoiceMessage(speakText(message.content, settings))}
                      >
                        <Volume2 size={13} />
                        Speak
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}

            {busy && (
              <article className="operator-message assistant">
                <div className="operator-avatar">
                  <Bot size={16} />
                </div>
                <div className="operator-bubble thinking">
                  <span className="pulse-dot" />
                  Klak is thinking...
                </div>
              </article>
            )}
          </div>

          <div className="starter-panel">
            <div>
              <strong>Try asking</strong>
              <span>Useful local requests to start with</span>
            </div>

            <div className="starter-grid">
              {starterPrompts.map((prompt) => (
                <button type="button" key={prompt} onClick={() => setInput(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        </section>

        <aside className="operator-preview-panel">
          <div className="preview-panel-header">
            <div>
              <h3>Action Preview</h3>
              <p>Klak will ask before doing anything meaningful.</p>
            </div>
            <span className={preview ? "warning-badge" : "status-badge"}>
              {preview ? "Review needed" : "Clear"}
            </span>
          </div>

          {preview ? (
            <ActionPreviewCard preview={preview} settings={settings} onDone={() => setPreview(null)} />
          ) : (
            <div className="empty-action-state">
              <ShieldCheck size={28} />
              <strong>No pending action</strong>
              <p>When Klak wants to open an app, save memory, run a routine, or copy text, you'll review it here first.</p>
            </div>
          )}
        </aside>
      </div>

      <OperatorTaskPanel run={operatorRun} settings={settings} onChange={setOperatorRun} />

      {settings.voiceEnabled && settings.voiceConversationMode === "openai_realtime" && (
        <RealtimeVoicePanel settings={settings} onFinalTurn={addRealtimeTurn} />
      )}

      <form
        className="operator-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="composer-input-wrap">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask Klak to remember something, open an app, help with a routine, or run a task..."
          />
          {settings.voiceConversationMode === "local_push_to_talk" && (
            <VoiceRecorder
              settings={settings}
              onTranscript={(text) => submit(text)}
              onStatus={(message) => {
                void updateCaption(message);
                if (/failed|disabled|configure|api key|microphone|not available|ignored|match/i.test(message)) {
                  const spoken = speakText(message, settings);
                  if (spoken) setVoiceMessage(spoken);
                }
              }}
              autoStartSignal={autoVoiceSignal}
              autoStopAfterMs={9000}
            />
          )}
        </div>

        <button className="primary send-button" disabled={busy || !input.trim()}>
          <Send size={16} />
          {busy ? "Sending" : "Send"}
        </button>
        <button className="send-button secondary" type="button" disabled={busy || !input.trim()} onClick={() => runAsTask()}>
          <PlayCircle size={16} />
          Run Task
        </button>
      </form>

      {voiceMessage && <p className="warning">{voiceMessage}</p>}
      {wakeNotice && <p className="inline-status">{wakeNotice}</p>}
    </div>
  );
}

function looksLikeVoiceApproval(text: string): boolean {
  return /^(yes|yeah|yep|approve|approved|do it|go ahead|run it|open it|start it|please do|confirm)\b/i.test(text.trim());
}

function looksLikeVoiceDenial(text: string): boolean {
  return /^(no|nope|deny|cancel|stop|don't|do not|never mind|nevermind)\b/i.test(text.trim());
}

async function updateCaption(text: string): Promise<void> {
  try {
    await invoke("update_voice_caption", { text: text.slice(0, 220) });
  } catch {
    // Caption overlay is a native enhancement; the assistant still works without it.
  }
}
