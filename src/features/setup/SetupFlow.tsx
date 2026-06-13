import { FolderOpen } from "lucide-react";
import { useState } from "react";
import type { AppSettings, PermissionMode } from "../../types";
import { apiKeyVault, devStorageWarning } from "../../lib/security/apiKeyVault";

const modes: PermissionMode[] = [
  "observe_only",
  "suggest_only",
  "draft_fill_only",
  "act_with_confirmation",
  "trusted_workflows_only"
];

export function SetupFlow({ settings, onComplete }: { settings: AppSettings; onComplete: (settings: AppSettings) => void }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(settings);
  const [apiKey, setApiKey] = useState("");
  const [folder, setFolder] = useState("");

  async function finish() {
    if (apiKey.trim()) await apiKeyVault.saveApiKey(apiKey.trim());
    onComplete({ ...draft, apiKeyStored: Boolean(apiKey.trim()) || draft.apiKeyStored, setupComplete: true });
  }

  return (
    <div className="setup">
      <section>
        <div className="brand setup-brand">
          <div className="mark">K</div>
          <div>
            <h1>Klak</h1>
            <p>your local AI operator</p>
          </div>
        </div>
        {step === 0 && (
          <div className="setup-page">
            <h2>Welcome</h2>
            <p>Klak runs locally, stays visible, asks before meaningful actions, and keeps memory on this device.</p>
          </div>
        )}
        {step === 1 && (
          <div className="setup-page">
            <h2>Choose AI Provider</h2>
            <select
              value={draft.aiProvider}
              onChange={(event) => setDraft({ ...draft, aiProvider: event.target.value as AppSettings["aiProvider"] })}
            >
              <option value="openai_compatible">OpenAI-compatible</option>
              <option value="claude">Claude placeholder</option>
              <option value="local">Local model placeholder</option>
            </select>
            <input value={draft.apiBaseUrl} onChange={(event) => setDraft({ ...draft, apiBaseUrl: event.target.value })} />
          </div>
        )}
        {step === 2 && (
          <div className="setup-page">
            <h2>Add API Key</h2>
            <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-..." />
            <p className="warning">{devStorageWarning}</p>
          </div>
        )}
        {step === 3 && (
          <div className="setup-page">
            <h2>Choose Permission Mode</h2>
            <div className="choice-grid">
              {modes.map((mode) => (
                <button
                  key={mode}
                  className={draft.permissionMode === mode ? "selected" : ""}
                  onClick={() => setDraft({ ...draft, permissionMode: mode })}
                >
                  {mode.replace(/_/g, " ")}
                </button>
              ))}
            </div>
            <p>Default: act with confirmation.</p>
          </div>
        )}
        {step === 4 && (
          <div className="setup-page">
            <h2>Allowed Folders</h2>
            <div className="inline-form">
              <input value={folder} onChange={(event) => setFolder(event.target.value)} placeholder="C:\\Users\\you\\Documents" />
              <button
                onClick={() => {
                  if (!folder.trim()) return;
                  setDraft({ ...draft, allowedFolders: [...draft.allowedFolders, folder.trim()] });
                  setFolder("");
                }}
              >
                <FolderOpen size={16} />
                Add
              </button>
            </div>
            <ul>{draft.allowedFolders.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
        )}
        {step === 5 && (
          <div className="setup-page">
            <h2>Finish Setup</h2>
            <p>Klak is ready with local memory, previews, audit logs, and safe tool defaults.</p>
          </div>
        )}
        <footer className="row between">
          <button disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
          {step < 5 ? <button className="primary" onClick={() => setStep(step + 1)}>Next</button> : <button className="primary" onClick={finish}>Finish</button>}
        </footer>
      </section>
    </div>
  );
}
