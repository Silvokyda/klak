import type { ReactNode } from "react";
import {
  KeyRound,
  Mic,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Stethoscope,
  Trash2
} from "lucide-react";
import { useMemo, useState } from "react";
import { ScreenHeader } from "../../components/ScreenHeader";
import type { AppSettings, PermissionMode } from "../../types";
import { apiKeyVault } from "../../lib/security/apiKeyVault";
import { getSecretStorageStatus } from "../../lib/security/secretStore";
import { clearLocalData } from "../../lib/storage/settings";
import { testWhisperSetup } from "../../lib/voice/transcription";

const modes: PermissionMode[] = [
  "observe_only",
  "suggest_only",
  "draft_fill_only",
  "act_with_confirmation",
  "trusted_workflows_only"
];

const permissionModeDescriptions: Record<PermissionMode, { title: string; description: string }> = {
  observe_only: {
    title: "Observe only",
    description: "Klak can help explain and organize, but it should not prepare or run actions."
  },
  suggest_only: {
    title: "Suggest only",
    description: "Klak can suggest next steps, but you stay fully in control of execution."
  },
  draft_fill_only: {
    title: "Draft and fill only",
    description: "Klak can prepare drafts or structured inputs, but actions still need you."
  },
  act_with_confirmation: {
    title: "Act with confirmation",
    description: "Klak can prepare approved actions, then waits for confirmation before running."
  },
  trusted_workflows_only: {
    title: "Trusted workflows only",
    description: "Klak can only run workflows you have explicitly saved and approved."
  }
};

export function SettingsScreen({
  settings,
  onSettingsChange
}: {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [whisperStatus, setWhisperStatus] = useState<string | null>(null);

  const hasUnsavedChanges = useMemo(() => {
    return JSON.stringify(draft) !== JSON.stringify(settings) || Boolean(apiKey.trim());
  }, [draft, settings, apiKey]);

  const selectedPermissionMode = permissionModeDescriptions[draft.permissionMode];

  async function save() {
    setMessage(null);

    const nextApiKey = apiKey.trim();

    if (nextApiKey) {
      await apiKeyVault.saveApiKey(nextApiKey);
    }

    const nextSettings = {
      ...draft,
      apiKeyStored: draft.apiKeyStored || Boolean(nextApiKey)
    };

    await Promise.resolve(onSettingsChange(nextSettings));

    setDraft(nextSettings);
    setApiKey("");
    setMessage("Settings saved locally.");
  }

  async function reset() {
    const confirmed = window.confirm(
      "Reset Klak local settings, memories, tools, logs, saved actions, and dev API key storage?"
    );

    if (!confirmed) return;

    await clearLocalData();
    window.location.reload();
  }

  async function testWhisper() {
    setWhisperStatus("Testing local Whisper setup...");

    try {
      const result = await testWhisperSetup(draft);
      setWhisperStatus(result);
    } catch (error) {
      setWhisperStatus(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="screen settings-screen">
      <ScreenHeader
        title="Settings"
        subtitle="Control Klak’s provider, permissions, local access, voice setup, and reset behavior."
        actions={<span className="status-badge">Local-first</span>}
      />

      <section className="settings-hero">
        <div>
          <span className="eyebrow">Control center</span>
          <h3>Choose how much Klak is allowed to do.</h3>
          <p>
            Keep Klak conservative by default. Provider access, local folders, voice, and risky
            behavior stay visible and user-controlled.
          </p>
        </div>

        <div className="settings-hero-card">
          <ShieldCheck size={20} />
          <div>
            <strong>{selectedPermissionMode.title}</strong>
            <span>{selectedPermissionMode.description}</span>
          </div>
        </div>
      </section>

      {message && <p className="inline-status">{message}</p>}

      <section className="settings-overview">
        <SettingsMetric
          icon={<KeyRound size={18} />}
          label="API key"
          value={draft.apiKeyStored ? "Stored" : "Missing"}
          hint={getSecretStorageStatus()}
        />

        <SettingsMetric
          icon={<ShieldCheck size={18} />}
          label="Permission mode"
          value={selectedPermissionMode.title}
          hint="Controls action approval"
        />

        <SettingsMetric
          icon={<SlidersHorizontal size={18} />}
          label="Allowed folders"
          value={`${draft.allowedFolders.length}`}
          hint="Local paths Klak may use"
        />

        <SettingsMetric
          icon={<Mic size={18} />}
          label="Voice"
          value={draft.voiceEnabled ? "Enabled" : "Off"}
          hint="No wake-word listening"
        />
      </section>

      <div className="settings-layout">
        <div className="settings-column">
          <SettingsSection
            title="AI provider"
            description="Configure the model endpoint Klak uses for assistant reasoning."
          >
            <label className="field-stack">
              <span>Provider</span>
              <select
                value={draft.aiProvider}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    aiProvider: event.target.value as AppSettings["aiProvider"]
                  })
                }
              >
                <option value="openai_compatible">OpenAI-compatible</option>
                <option value="claude">Claude placeholder</option>
                <option value="local">Local model placeholder</option>
              </select>
            </label>

            <label className="field-stack">
              <span>Base URL</span>
              <input
                value={draft.apiBaseUrl}
                onChange={(event) => setDraft({ ...draft, apiBaseUrl: event.target.value })}
                placeholder="https://api.openai.com/v1"
              />
            </label>

            <label className="field-stack">
              <span>Model</span>
              <input
                value={draft.modelName}
                onChange={(event) => setDraft({ ...draft, modelName: event.target.value })}
                placeholder="Model name"
              />
            </label>

            <label className="field-stack">
              <span>API key</span>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={draft.apiKeyStored ? "Stored. Enter a new key to replace." : "Not stored"}
              />
              <small>{getSecretStorageStatus()}</small>
            </label>
          </SettingsSection>

          <SettingsSection
            title="Permission mode"
            description="Choose the highest level of action Klak can prepare."
          >
            <label className="field-stack">
              <span>Current mode</span>
              <select
                value={draft.permissionMode}
                onChange={(event) =>
                  setDraft({ ...draft, permissionMode: event.target.value as PermissionMode })
                }
              >
                {modes.map((mode) => (
                  <option key={mode} value={mode}>
                    {permissionModeDescriptions[mode].title}
                  </option>
                ))}
              </select>
              <small>{selectedPermissionMode.description}</small>
            </label>

            <div className="permission-mode-list">
              {modes.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={draft.permissionMode === mode ? "selected" : ""}
                  onClick={() => setDraft({ ...draft, permissionMode: mode })}
                >
                  <strong>{permissionModeDescriptions[mode].title}</strong>
                  <span>{permissionModeDescriptions[mode].description}</span>
                </button>
              ))}
            </div>
          </SettingsSection>

          <SettingsSection
            title="Local access"
            description="Limit where Klak can safely prepare local file actions."
          >
            <label className="field-stack">
              <span>Allowed folders</span>
              <textarea
                value={draft.allowedFolders.join("\n")}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    allowedFolders: event.target.value
                      .split("\n")
                      .map((item) => item.trim())
                      .filter(Boolean)
                  })
                }
                placeholder={"C:\\Users\\silvance\\Documents\\klak\nC:\\Users\\silvance\\Documents\\projects"}
              />
              <small>One folder per line. Keep this narrow instead of allowing your whole disk.</small>
            </label>

            <ToggleRow
              checked={draft.localContextEnabled}
              title="Enable local context"
              description="Allow Klak to use approved local context placeholders."
              onChange={(checked) => setDraft({ ...draft, localContextEnabled: checked })}
            />

            <ToggleRow
              checked={draft.clipboardReadEnabled}
              title="Allow clipboard reading later"
              description="Keep off unless you intentionally add clipboard-based workflows."
              onChange={(checked) => setDraft({ ...draft, clipboardReadEnabled: checked })}
            />
          </SettingsSection>
        </div>

        <div className="settings-column">
          <SettingsSection
            title="Voice"
            description="Voice is optional. Klak does not listen in the background."
          >
            <div className="settings-note-card">
              <strong>Voice safety</strong>
              <span>
                Transcription does not auto-send messages. No wake word is enabled. Temporary audio is
                deleted unless debug retention is turned on.
              </span>
            </div>

            <ToggleRow
              checked={draft.voiceEnabled}
              title="Enable voice input"
              description="Allows manual voice input when you choose to use it."
              onChange={(checked) => setDraft({ ...draft, voiceEnabled: checked })}
            />

            <ToggleRow
              checked={draft.pushToTalkEnabled}
              title="Push-to-talk only"
              description="Keeps voice interaction intentional instead of always listening."
              onChange={(checked) => setDraft({ ...draft, pushToTalkEnabled: checked })}
            />

            <label className="field-stack">
              <span>Voice input provider</span>
              <select
                value={draft.voiceInputProvider}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    voiceInputProvider: event.target.value as AppSettings["voiceInputProvider"]
                  })
                }
              >
                <option value="disabled">Disabled</option>
                <option value="local_whisper_cli">Local Whisper CLI</option>
              </select>
            </label>

            <label className="field-stack">
              <span>Voice output provider</span>
              <select
                value={draft.voiceOutputProvider}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    voiceOutputProvider: event.target.value as AppSettings["voiceOutputProvider"]
                  })
                }
              >
                <option value="disabled">Disabled</option>
                <option value="web_speech">WebView speech synthesis</option>
              </select>
            </label>
          </SettingsSection>

          <SettingsSection
            title="Local Whisper setup"
            description="Use only if you have a local Whisper executable and model on this computer."
          >
            <label className="field-stack">
              <span>Executable path</span>
              <input
                value={draft.localWhisperExecutablePath}
                onChange={(event) =>
                  setDraft({ ...draft, localWhisperExecutablePath: event.target.value })
                }
                placeholder="C:\\Tools\\whisper\\whisper-cli.exe"
              />
            </label>

            <label className="field-stack">
              <span>Model path</span>
              <input
                value={draft.localWhisperModelPath}
                onChange={(event) =>
                  setDraft({ ...draft, localWhisperModelPath: event.target.value })
                }
                placeholder="C:\\Models\\ggml-base.en.bin"
              />
            </label>

            <div className="settings-two-col">
              <label className="field-stack">
                <span>Language</span>
                <input
                  value={draft.localWhisperLanguage}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      localWhisperLanguage: event.target.value || "auto"
                    })
                  }
                  placeholder="auto"
                />
              </label>

              <label className="field-stack">
                <span>Threads</span>
                <input
                  type="number"
                  min={1}
                  max={16}
                  value={draft.localWhisperThreads}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      localWhisperThreads: Number(event.target.value) || 4
                    })
                  }
                />
              </label>
            </div>

            <ToggleRow
              checked={draft.keepTempAudioForDebugging}
              title="Keep temporary audio for debugging"
              description="Leave this off for normal use."
              danger
              onChange={(checked) => setDraft({ ...draft, keepTempAudioForDebugging: checked })}
            />

            <div className="settings-test-row">
              <button type="button" onClick={testWhisper}>
                <Stethoscope size={16} />
                Test Whisper setup
              </button>

              {whisperStatus && <span className="inline-status">{whisperStatus}</span>}
            </div>
          </SettingsSection>

          <SettingsSection
            title="Danger zone"
            description="Resetting clears local Klak data from this device."
            danger
          >
            <div className="settings-danger-card">
              <Trash2 size={18} />
              <div>
                <strong>Reset local app data</strong>
                <span>
                  This clears local settings, memories, tools, logs, saved actions, and dev API key
                  storage. It does not delete your project folders.
                </span>
              </div>
            </div>

            <button className="danger" onClick={reset}>
              <RotateCcw size={16} /> Reset app
            </button>
          </SettingsSection>
        </div>
      </div>

      <section className="settings-save-bar">
        <div>
          <strong>{hasUnsavedChanges ? "Unsaved changes" : "Settings are up to date"}</strong>
          <span>
            Changes stay local. Save before leaving this screen if you changed provider, permissions,
            folders, or voice settings.
          </span>
        </div>

        <button className="primary" onClick={save} disabled={!hasUnsavedChanges}>
          <Save size={16} /> Save settings
        </button>
      </section>
    </div>
  );
}

function SettingsSection({
  title,
  description,
  children,
  danger = false
}: {
  title: string;
  description: string;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <section className={`settings-section-card ${danger ? "settings-section-danger" : ""}`}>
      <div className="settings-section-header">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>

      {children}
    </section>
  );
}

function SettingsMetric({
  icon,
  label,
  value,
  hint
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <article className="settings-metric-card">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

function ToggleRow({
  checked,
  title,
  description,
  onChange,
  danger = false
}: {
  checked: boolean;
  title: string;
  description: string;
  onChange: (checked: boolean) => void;
  danger?: boolean;
}) {
  return (
    <label className={`settings-toggle-row ${danger ? "settings-toggle-danger" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />

      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
    </label>
  );
}