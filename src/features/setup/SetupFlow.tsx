import { FolderOpen } from "lucide-react";
import { useState } from "react";
import type { AppSettings, PermissionMode } from "../../types";
import { apiKeyVault } from "../../lib/security/apiKeyVault";
import { getSecretStorageStatus } from "../../lib/security/secretStore";

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

  const finalStep = 7;

  async function finish() {
    if (apiKey.trim()) await apiKeyVault.saveApiKey(apiKey.trim());
    onComplete({
      ...draft,
      apiKeyStored: Boolean(apiKey.trim()) || draft.apiKeyStored,
      setupComplete: true,
      voiceProfileEnabled: false
    });
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
            <p className="warning">{getSecretStorageStatus()}</p>
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
            <h2>Voice</h2>
            <label className="toggle">
              <input
                type="checkbox"
                checked={draft.voiceEnabled}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    voiceEnabled: event.target.checked,
                    voiceInputProvider: event.target.checked ? "openai_transcription" : "disabled",
                    voiceOutputProvider: event.target.checked ? "web_speech" : "disabled"
                  })
                }
              />
              Enable voice input and spoken replies
            </label>
            <select
              value={draft.voiceInputProvider}
              onChange={(event) =>
                setDraft({ ...draft, voiceInputProvider: event.target.value as AppSettings["voiceInputProvider"] })
              }
            >
              <option value="disabled">Disabled</option>
              <option value="openai_transcription">OpenAI transcription</option>
              <option value="local_whisper_cli">Local Whisper CLI</option>
            </select>
            <select
              value={draft.voiceOutputProvider}
              onChange={(event) =>
                setDraft({ ...draft, voiceOutputProvider: event.target.value as AppSettings["voiceOutputProvider"] })
              }
            >
              <option value="disabled">Disabled</option>
              <option value="web_speech">WebView speech synthesis</option>
            </select>
            <input
              value={draft.openAiTranscriptionModel}
              onChange={(event) => setDraft({ ...draft, openAiTranscriptionModel: event.target.value })}
              placeholder="gpt-4o-mini-transcribe"
            />
          </div>
        )}
        {step === 6 && (
          <div className="setup-page">
            <h2>Wake Word</h2>
            <label className="toggle">
              <input
                type="checkbox"
                checked={draft.wakeWordEnabled}
                onChange={(event) => setDraft({ ...draft, wakeWordEnabled: event.target.checked })}
              />
              Enable free local wake word with openWakeWord
            </label>
            <input
              value={draft.wakeWordPythonPath}
              onChange={(event) => setDraft({ ...draft, wakeWordPythonPath: event.target.value })}
              placeholder="python"
            />
            <input
              value={draft.wakeWordModel}
              onChange={(event) => setDraft({ ...draft, wakeWordModel: event.target.value })}
              placeholder="hey_jarvis"
            />
            <input
              value={draft.wakeWordCustomModelPath}
              onChange={(event) => setDraft({ ...draft, wakeWordCustomModelPath: event.target.value })}
              placeholder="C:\\Models\\hi-klak.onnx"
            />
            <input
              type="number"
              min={0.2}
              max={0.95}
              step={0.05}
              value={draft.wakeWordThreshold}
              onChange={(event) => setDraft({ ...draft, wakeWordThreshold: Number(event.target.value) || 0.55 })}
            />
            <p>Install dependencies with: pip install -r sidecar\\requirements-wakeword.txt</p>
          </div>
        )}
        {step === 7 && (
          <div className="setup-page">
            <h2>Finish Setup</h2>
            <p>Klak is ready with local memory, previews, audit logs, and safe tool defaults.</p>
          </div>
        )}
        <footer className="row between">
          <button disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
          {step < finalStep ? <button className="primary" onClick={() => setStep(step + 1)}>Next</button> : <button className="primary" onClick={finish}>Finish</button>}
        </footer>
      </section>
    </div>
  );
}
