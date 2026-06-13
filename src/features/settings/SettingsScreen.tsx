import { RotateCcw, Save } from "lucide-react";
import { useState } from "react";
import { ScreenHeader } from "../../components/ScreenHeader";
import type { AppSettings, PermissionMode } from "../../types";
import { apiKeyVault } from "../../lib/security/apiKeyVault";
import { clearLocalData } from "../../lib/storage/settings";
import { getSecretStorageStatus } from "../../lib/security/secretStore";

const modes: PermissionMode[] = ["observe_only", "suggest_only", "draft_fill_only", "act_with_confirmation", "trusted_workflows_only"];

export function SettingsScreen({ settings, onSettingsChange }: { settings: AppSettings; onSettingsChange: (settings: AppSettings) => void }) {
  const [draft, setDraft] = useState(settings);
  const [apiKey, setApiKey] = useState("");

  async function save() {
    if (apiKey.trim()) await apiKeyVault.saveApiKey(apiKey.trim());
    await onSettingsChange({ ...draft, apiKeyStored: draft.apiKeyStored || Boolean(apiKey.trim()) });
    setApiKey("");
  }

  async function reset() {
    if (!confirm("Reset Klak local settings, memories, tools, logs, and dev API key storage?")) return;
    await clearLocalData();
    location.reload();
  }

  return (
    <div className="screen">
      <ScreenHeader
        title="Settings"
        subtitle="Provider, permissions, allowed folders, voice, local context toggles, and reset controls."
        actions={<span className="status-badge">Local-first</span>}
      />
      <section className="settings-grid">
        <div className="settings-banner">
          <strong>OpenAI key configured: {draft.apiKeyStored ? "yes" : "no"}</strong>
          <span>{getSecretStorageStatus()}</span>
        </div>
        <label>
          AI provider
          <select value={draft.aiProvider} onChange={(event) => setDraft({ ...draft, aiProvider: event.target.value as AppSettings["aiProvider"] })}>
            <option value="openai_compatible">OpenAI-compatible</option>
            <option value="claude">Claude placeholder</option>
            <option value="local">Local model placeholder</option>
          </select>
        </label>
        <label>
          Base URL
          <input value={draft.apiBaseUrl} onChange={(event) => setDraft({ ...draft, apiBaseUrl: event.target.value })} />
        </label>
        <label>
          Model
          <input value={draft.modelName} onChange={(event) => setDraft({ ...draft, modelName: event.target.value })} />
        </label>
        <label>
          API key
          <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={draft.apiKeyStored ? "Stored" : "Not stored"} />
        </label>
        <label>
          Permission mode
          <select value={draft.permissionMode} onChange={(event) => setDraft({ ...draft, permissionMode: event.target.value as PermissionMode })}>
            {modes.map((mode) => <option key={mode} value={mode}>{mode.replace(/_/g, " ")}</option>)}
          </select>
        </label>
        <label>
          Allowed folders
          <textarea value={draft.allowedFolders.join("\n")} onChange={(event) => setDraft({ ...draft, allowedFolders: event.target.value.split("\n").filter(Boolean) })} />
        </label>
        <label className="toggle">
          <input type="checkbox" checked={draft.localContextEnabled} onChange={(event) => setDraft({ ...draft, localContextEnabled: event.target.checked })} />
          Enable local context placeholders
        </label>
        <label className="toggle">
          <input type="checkbox" checked={draft.clipboardReadEnabled} onChange={(event) => setDraft({ ...draft, clipboardReadEnabled: event.target.checked })} />
          Allow clipboard reading later
        </label>
        <div className="section-divider">
          <h3>Voice</h3>
          <p>No wake-word listening. Recording starts only when you press the voice button.</p>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={draft.voiceEnabled} onChange={(event) => setDraft({ ...draft, voiceEnabled: event.target.checked })} />
          Enable voice input
        </label>
        <label className="toggle">
          <input type="checkbox" checked={draft.pushToTalkEnabled} onChange={(event) => setDraft({ ...draft, pushToTalkEnabled: event.target.checked })} />
          Push-to-talk only
        </label>
        <label>
          Voice input provider
          <select
            value={draft.voiceInputProvider}
            onChange={(event) => setDraft({ ...draft, voiceInputProvider: event.target.value as AppSettings["voiceInputProvider"] })}
          >
            <option value="disabled">Disabled</option>
            <option value="local_whisper_cli">Local Whisper CLI</option>
          </select>
        </label>
        <label>
          Voice output provider
          <select
            value={draft.voiceOutputProvider}
            onChange={(event) => setDraft({ ...draft, voiceOutputProvider: event.target.value as AppSettings["voiceOutputProvider"] })}
          >
            <option value="disabled">Disabled</option>
            <option value="web_speech">WebView speech synthesis</option>
          </select>
        </label>
        <label>
          Local Whisper executable path
          <input
            value={draft.localWhisperExecutablePath}
            onChange={(event) => setDraft({ ...draft, localWhisperExecutablePath: event.target.value })}
            placeholder="C:\\Tools\\whisper\\whisper-cli.exe"
          />
        </label>
        <label>
          Local Whisper model path
          <input
            value={draft.localWhisperModelPath}
            onChange={(event) => setDraft({ ...draft, localWhisperModelPath: event.target.value })}
            placeholder="C:\\Models\\ggml-base.en.bin"
          />
        </label>
        <p className="warning">Voice output is off by default. Audio is not uploaded by Klak, and transcription does not auto-send messages.</p>
      </section>
      <div className="row">
        <button className="primary" onClick={save}><Save size={16} /> Save settings</button>
        <button className="danger" onClick={reset}><RotateCcw size={16} /> Reset app</button>
      </div>
    </div>
  );
}
