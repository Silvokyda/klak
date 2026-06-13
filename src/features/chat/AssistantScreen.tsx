import { Send, Search, Volume2 } from "lucide-react";
import { useState } from "react";
import { ActionPreviewCard } from "../../components/ActionPreviewCard";
import { ScreenHeader } from "../../components/ScreenHeader";
import type { ActionPreview, AppSettings, ChatMessage } from "../../types";
import { sendChatMessage } from "../../lib/ai/chatOrchestrator";
import { id, nowIso } from "../../lib/utils";
import { buildActionPreviewForSuggestion } from "../../lib/tools/toolProposals";
import { VoiceRecorder } from "../../components/VoiceRecorder";
import { speakText } from "../../lib/voice/transcription";

export function AssistantScreen({ settings }: { settings: AppSettings }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: id("msg"), role: "assistant", content: "Hi, I’m Klak. I can chat, search local memory, and preview safe local actions.", createdAt: nowIso() }
  ]);
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<ActionPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);

  async function submit() {
    if (!input.trim() || busy) return;
    const userMessage: ChatMessage = { id: id("msg"), role: "user", content: input.trim(), createdAt: nowIso() };
    setMessages((items) => [...items, userMessage]);
    setInput("");
    setBusy(true);
    const response = await sendChatMessage(userMessage.content, settings);
    setMessages((items) => [...items, { id: id("msg"), role: "assistant", content: response.message, createdAt: nowIso() }]);
    if (response.suggestedAction) {
      const nextPreview = await buildActionPreviewForSuggestion(response.suggestedAction, settings);
      if (nextPreview) setPreview(nextPreview);
    }
    setBusy(false);
  }

  return (
    <div className="screen chat-screen">
      <ScreenHeader
        title="Assistant"
        subtitle="Chat, review local context, and approve actions before anything meaningful happens."
        actions={<button title="Search memory"><Search size={16} /> Memory</button>}
      />
      <div className="chat-layout">
        <section className="chat-log">
          {messages.map((message) => (
            <article key={message.id} className={`message ${message.role}`}>
              <p>{message.content}</p>
              {message.role === "assistant" && (
                <button
                  className="icon-action"
                  title="Speak response"
                  onClick={() => setVoiceMessage(speakText(message.content, settings))}
                >
                  <Volume2 size={14} />
                  Speak
                </button>
              )}
            </article>
          ))}
        </section>
        <aside className="action-panel">
          <h3>Action Preview</h3>
          {preview ? <ActionPreviewCard preview={preview} settings={settings} onDone={() => setPreview(null)} /> : <p>No pending action.</p>}
        </aside>
      </div>
      <form className="composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask Klak, or say 'remember this...'" />
        <VoiceRecorder settings={settings} onTranscript={(text) => setInput(text)} />
        <button className="primary" disabled={busy}>
          <Send size={16} />
          Send
        </button>
      </form>
      {voiceMessage && <p className="warning">{voiceMessage}</p>}
    </div>
  );
}
