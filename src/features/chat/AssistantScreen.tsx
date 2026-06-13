import { Send, Search } from "lucide-react";
import { useState } from "react";
import { ActionPreviewCard } from "../../components/ActionPreviewCard";
import { ScreenHeader } from "../../components/ScreenHeader";
import type { ActionPreview, AppSettings, ChatMessage } from "../../types";
import { sendChatMessage } from "../../lib/ai/chatOrchestrator";
import { createActionPreview } from "../../lib/permissions/policy";
import { listTools } from "../../lib/tools/toolRegistry";
import { id, nowIso } from "../../lib/utils";

export function AssistantScreen({ settings }: { settings: AppSettings }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: id("msg"), role: "assistant", content: "Hi, I’m Klak. I can chat, search local memory, and preview safe local actions.", createdAt: nowIso() }
  ]);
  const [input, setInput] = useState("");
  const [preview, setPreview] = useState<ActionPreview | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!input.trim() || busy) return;
    const userMessage: ChatMessage = { id: id("msg"), role: "user", content: input.trim(), createdAt: nowIso() };
    setMessages((items) => [...items, userMessage]);
    setInput("");
    setBusy(true);
    const response = await sendChatMessage(userMessage.content, settings);
    setMessages((items) => [...items, { id: id("msg"), role: "assistant", content: response.message, createdAt: nowIso() }]);
    if (response.suggestedAction) {
      const tools = await listTools(settings.allToolsDisabled);
      const tool = tools.find((item) => item.name === response.suggestedAction?.toolName);
      if (tool) setPreview(await createActionPreview(tool, response.suggestedAction.input, settings));
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
        <button className="primary" disabled={busy}>
          <Send size={16} />
          Send
        </button>
      </form>
    </div>
  );
}
