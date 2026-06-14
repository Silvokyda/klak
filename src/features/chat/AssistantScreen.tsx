import {
  Bot,
  ClipboardCheck,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  UserRound,
  Volume2
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ActionPreviewCard } from "../../components/ActionPreviewCard";
import { ScreenHeader } from "../../components/ScreenHeader";
import type { ActionPreview, AppSettings, ChatMessage } from "../../types";
import { sendChatMessage } from "../../lib/ai/chatOrchestrator";
import { id, nowIso } from "../../lib/utils";
import { buildActionPreviewForSuggestion } from "../../lib/tools/toolProposals";
import { VoiceRecorder } from "../../components/VoiceRecorder";
import { speakText } from "../../lib/voice/transcription";

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
      content: "Hi, I’m Klak. I can chat, search local memory, and preview safe local actions.",
      createdAt: nowIso()
    }
  ]);
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<ActionPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);

  const threadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    thread.scrollTop = thread.scrollHeight;
  }, [messages, busy]);

  async function submit() {
    if (!input.trim() || busy) return;

    const userMessage: ChatMessage = {
      id: id("msg"),
      role: "user",
      content: input.trim(),
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
        if (nextPreview) setPreview(nextPreview);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen chat-screen operator-chat-screen">
      <ScreenHeader
        title="Assistant"
        subtitle="Ask Klak to help with local memory, apps, routines, and approved actions."
        actions={
          <button title="Search memory">
            <Search size={16} />
            Memory
          </button>
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
            <strong>Ready</strong>
            <span>Ask naturally. You stay in control.</span>
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
              <p>When Klak wants to open an app, save memory, run a routine, or copy text, you’ll review it here first.</p>
            </div>
          )}
        </aside>
      </div>

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
            placeholder="Ask Klak to remember something, open an app, or help with a routine..."
          />
          <VoiceRecorder settings={settings} onTranscript={(text) => setInput(text)} />
        </div>

        <button className="primary send-button" disabled={busy || !input.trim()}>
          <Send size={16} />
          {busy ? "Sending" : "Send"}
        </button>
      </form>

      {voiceMessage && <p className="warning">{voiceMessage}</p>}
    </div>
  );
}