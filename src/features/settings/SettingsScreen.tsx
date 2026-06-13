import { RotateCcw, Save } from "lucide-react";
import { useState } from "react";
import { ScreenHeader } from "../../components/ScreenHeader";
import type { AppSettings, PermissionMode } from "../../types";
import { apiKeyVault, devStorageWarning } from "../../lib/security/apiKeyVault";
import { clearLocalData } from "../../lib/storage/settings";

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
      <ScreenHeader title="Settings" subtitle="Provider, permissions, allowed folders, local context toggles, and reset controls." />
      <section className="settings-grid">
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
        <p className="warning">{devStorageWarning}</p>
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
      </section>
      <div className="row">
        <button className="primary" onClick={save}><Save size={16} /> Save settings</button>
        <button className="danger" onClick={reset}><RotateCcw size={16} /> Reset app</button>
      </div>
    </div>
  );
}
