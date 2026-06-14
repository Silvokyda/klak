import { FolderOpen, Mic, UserRoundCheck } from "lucide-react";
import { useRef, useState } from "react";
import type { AppSettings, PermissionMode } from "../../types";
import { apiKeyVault } from "../../lib/security/apiKeyVault";
import { getSecretStorageStatus } from "../../lib/security/secretStore";
import { createVoiceProfile, voiceProfileSummary } from "../../lib/voice/voiceProfile";

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
  const [voiceSamples, setVoiceSamples] = useState<Blob[]>([]);
  const [voiceProfileMessage, setVoiceProfileMessage] = useState<string | null>(null);
  const [capturingVoiceSample, setCapturingVoiceSample] = useState(false);
  const sampleRecorderRef = useRef<MediaRecorder | null>(null);
  const sampleChunksRef = useRef<Blob[]>([]);

  const finalStep = 8;

  async function finish() {
    if (apiKey.trim()) await apiKeyVault.saveApiKey(apiKey.trim());
    onComplete({ ...draft, apiKeyStored: Boolean(apiKey.trim()) || draft.apiKeyStored, setupComplete: true });
  }

  async function captureVoiceSample() {
    setVoiceProfileMessage(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceProfileMessage("Microphone recording is not available in this WebView.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      sampleChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      sampleRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) sampleChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
      };
      recorder.start();
      setCapturingVoiceSample(true);
      window.setTimeout(() => {
        void stopVoiceSampleCapture();
      }, 3200);
    } catch (error) {
      setVoiceProfileMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function stopVoiceSampleCapture() {
    const recorder = sampleRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;

    const stopped = new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
    });
    recorder.stop();
    await stopped;
    setCapturingVoiceSample(false);
    const sample = new Blob(sampleChunksRef.current, { type: recorder.mimeType || "audio/webm" });
    sampleChunksRef.current = [];
    if (sample.size < 1000) {
      setVoiceProfileMessage("That sample was too quiet or too short. Try again near the microphone.");
      return;
    }
    setVoiceSamples((items) => [...items, sample].slice(-5));
    setVoiceProfileMessage("Sample captured.");
  }

  async function enrollVoiceProfile() {
    setVoiceProfileMessage("Creating local voice profile...");
    try {
      const calibration = await createVoiceProfile(voiceSamples, "Hi Klak");
      setDraft({
        ...draft,
        voiceProfileEnabled: true,
        voiceProfileStatus: "enrolled",
        voiceProfileCalibration: calibration
      });
      setVoiceSamples([]);
      setVoiceProfileMessage("Owner voice profile captured.");
    } catch (error) {
      setVoiceProfileMessage(error instanceof Error ? error.message : String(error));
    }
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
            <h2>Owner Voice Lock</h2>
            <p>{voiceProfileSummary(draft)}</p>
            <label className="toggle">
              <input
                type="checkbox"
                checked={draft.voiceProfileEnabled}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    voiceProfileEnabled: event.target.checked,
                    voiceProfileStatus: draft.voiceProfileCalibration ? "enrolled" : "not_enrolled"
                  })
                }
              />
              Require owner-like voice before Klak accepts spoken commands
            </label>
            <p>Say "Hi Klak, this is my voice" for each sample. Capture at least three samples.</p>
            <div className="voice-profile-meter">
              {[0, 1, 2].map((index) => (
                <span key={index} className={voiceSamples.length > index ? "filled" : ""} />
              ))}
            </div>
            <div className="row">
              <button type="button" onClick={captureVoiceSample} disabled={capturingVoiceSample}>
                <Mic size={16} />
                {capturingVoiceSample ? "Listening" : "Capture sample"}
              </button>
              <button type="button" onClick={enrollVoiceProfile} disabled={voiceSamples.length < 3 || capturingVoiceSample}>
                <UserRoundCheck size={16} />
                Enroll voice
              </button>
            </div>
            {voiceProfileMessage && <p className="inline-status">{voiceProfileMessage}</p>}
          </div>
        )}
        {step === 7 && (
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
        {step === 8 && (
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
