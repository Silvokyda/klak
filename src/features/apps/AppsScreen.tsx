import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { FolderSearch, Plus, RefreshCw, Rocket, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ActionPreviewCard } from "../../components/ActionPreviewCard";
import { ScreenHeader } from "../../components/ScreenHeader";
import type { ActionPreview, AppSettings, DiscoveredAppCandidate, RegisteredAppRecord, RegisteredAppType } from "../../types";
import {
  createRegisteredApp,
  deleteRegisteredApp,
  isBlockedShellExecutable,
  searchRegisteredApps,
  updateRegisteredApp,
  validateExecutablePath
} from "../../lib/apps/registeredAppsRepository";
import { createActionLog, updateActionLog } from "../../lib/logs/actionLogRepository";
import { buildActionPreviewForSuggestion } from "../../lib/tools/toolProposals";
import { nowIso } from "../../lib/utils";

const appTypes: RegisteredAppType[] = ["editor", "browser", "design", "communication", "productivity", "dev_tool", "other"];

export function AppsScreen({ settings }: { settings: AppSettings }) {
  const [apps, setApps] = useState<RegisteredAppRecord[]>([]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState({ name: "", executable_path: "", app_type: "editor" as RegisteredAppType, description: "", allowed: true });
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<ActionPreview | null>(null);
  const [pathWarnings, setPathWarnings] = useState<Record<string, string>>({});
  const [suggestions, setSuggestions] = useState<DiscoveredAppCandidate[]>([]);
  const [suggestionQuery, setSuggestionQuery] = useState("");
  const [selectedSuggestions, setSelectedSuggestions] = useState<Record<string, boolean>>({});
  const [scanning, setScanning] = useState(false);
  const [addingSuggestions, setAddingSuggestions] = useState(false);

  async function refresh(nextQuery = query) {
    const nextApps = await searchRegisteredApps(nextQuery);
    setApps(nextApps);
    await refreshPathWarnings(nextApps);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function create() {
    setMessage(null);
    try {
      await createRegisteredApp({ ...draft, description: emptyToNull(draft.description) });
      setDraft({ ...draft, name: "", executable_path: "", description: "" });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function scanApps() {
    setMessage(null);
    setScanning(true);
    const scanLog = await createActionLog({
      tool_name: "scan_installed_apps",
      input_summary: "Scan safe Windows app sources for app suggestions.",
      risk_level: "low",
      status: "running",
      user_approved: true
    });
    try {
      const registeredPaths = apps.map((app) => app.executable_path);
      const discovered = await invoke<DiscoveredAppCandidate[]>("scan_installed_apps", {
        input: { registered_executable_paths: registeredPaths }
      });
      setSuggestions(discovered);
      setSelectedSuggestions({});
      await updateActionLog(scanLog.id, {
        status: "completed",
        completed_at: nowIso(),
        error_message: `Found ${discovered.length} app suggestion(s).`
      });
      setMessage(discovered.length ? `Found ${discovered.length} app suggestion(s). You choose what gets added.` : "No app suggestions were found from safe Windows app sources.");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await updateActionLog(scanLog.id, { status: "failed", completed_at: nowIso(), error_message: errorMessage });
      setMessage(errorMessage);
    } finally {
      setScanning(false);
    }
  }

  async function addSelectedSuggestions() {
    setMessage(null);
    setAddingSuggestions(true);
    const selected = suggestions.filter((candidate) => selectedSuggestions[candidate.id]);
    const attemptLog = await createActionLog({
      tool_name: "register_discovered_apps",
      input_summary: `Register ${selected.length} selected app suggestion(s).`,
      risk_level: "low",
      status: "running",
      user_approved: true
    });
    try {
      const result = await invoke<{ accepted: DiscoveredAppCandidate[]; rejected: DiscoveredAppCandidate[] }>("register_discovered_apps", {
        input: {
          candidates: selected,
          registered_executable_paths: apps.map((app) => app.executable_path)
        }
      });
      let added = 0;
      for (const candidate of result.accepted) {
        if (!candidate.executable_path) continue;
        try {
          await createRegisteredApp({
            name: candidate.name,
            executable_path: candidate.executable_path,
            app_type: inferAppType(candidate),
            description: candidate.publisher ? `Discovered from ${candidate.source}. Publisher: ${candidate.publisher}` : `Discovered from ${candidate.source}.`,
            allowed: true
          });
          added += 1;
          await createActionLog({
            tool_name: "app_registered",
            input_summary: `Registered ${candidate.name} from ${candidate.source}.`,
            risk_level: "low",
            status: "completed",
            user_approved: true
          });
        } catch (error) {
          await createActionLog({
            tool_name: "app_registration_failed",
            input_summary: `Could not register ${candidate.name}.`,
            risk_level: "low",
            status: "failed",
            user_approved: true,
            error_message: error instanceof Error ? error.message : String(error)
          });
        }
      }
      for (const candidate of result.rejected) {
        await createActionLog({
          tool_name: "app_registration_blocked",
          input_summary: `Blocked ${candidate.name} from app discovery.`,
          risk_level: "low",
          status: "blocked",
          user_approved: true,
          error_message: candidate.block_reason ?? "This suggestion cannot be registered."
        });
      }
      await refresh();
      setSuggestions((current) => current.map((candidate) => result.accepted.some((item) => item.id === candidate.id) ? { ...candidate, is_registered: true } : candidate));
      setSelectedSuggestions({});
      await updateActionLog(attemptLog.id, {
        status: result.rejected.length ? "completed" : "completed",
        completed_at: nowIso(),
        error_message: result.rejected.length ? `Added ${added}; ${result.rejected.length} blocked or skipped.` : `Added ${added} app(s).`
      });
      setMessage(result.rejected.length ? `Added ${added} app(s). ${result.rejected.length} suggestion(s) were blocked or skipped.` : `Added ${added} app(s).`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await updateActionLog(attemptLog.id, { status: "failed", completed_at: nowIso(), error_message: errorMessage });
      setMessage(errorMessage);
    } finally {
      setAddingSuggestions(false);
    }
  }

  async function chooseExe() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Windows executable", extensions: ["exe"] }]
    });
    if (typeof selected === "string") setDraft({ ...draft, executable_path: selected });
  }

  async function launch(app: RegisteredAppRecord) {
    setMessage(null);
    const nextPreview = await buildActionPreviewForSuggestion({ toolName: "launch_app", input: { registered_app_id: app.id } }, settings);
    if (nextPreview) setPreview(nextPreview);
  }

  async function refreshPathWarnings(nextApps: RegisteredAppRecord[]) {
    const entries = await Promise.all(nextApps.map(async (app) => {
      try {
        const check = await invoke<{ exists: boolean; valid_extension: boolean; blocked_shell: boolean; message: string }>("validate_registered_app_path", {
          input: { executable_path: app.executable_path }
        });
        return [app.id, check.exists && check.valid_extension && !check.blocked_shell ? "" : check.message] as const;
      } catch {
        return [app.id, "Path existence will be checked in the native app before launch."] as const;
      }
    }));
    setPathWarnings(Object.fromEntries(entries));
  }

  async function update(app: RegisteredAppRecord, patch: Partial<RegisteredAppRecord>) {
    setMessage(null);
    try {
      await updateRegisteredApp(app.id, patch);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  const normalizedSuggestionQuery = suggestionQuery.trim().toLowerCase();
  const filteredSuggestions = suggestions.filter((candidate) => {
    if (!normalizedSuggestionQuery) return true;
    return [candidate.name, candidate.source, candidate.publisher ?? "", candidate.executable_path ?? ""].some((value) => value.toLowerCase().includes(normalizedSuggestionQuery));
  });
  const selectedSuggestionCount = suggestions.filter((candidate) => selectedSuggestions[candidate.id]).length;

  return (
    <div className="screen">
      <ScreenHeader
        title="Apps"
        subtitle="Add local apps Klak can suggest opening. Klak only adds what you choose and still asks before launching."
        actions={<button onClick={scanApps} disabled={scanning} title="Scan safe Windows app sources"><RefreshCw size={16} /> {scanning ? "Scanning" : "Scan for apps"}</button>}
      />
      <section className="editor">
        <div className="row between">
          <div>
            <h3>Suggested Apps</h3>
            <p className="muted">Scan your computer for apps Klak can safely suggest. You choose what gets added.</p>
          </div>
          <button className="primary" onClick={addSelectedSuggestions} disabled={addingSuggestions || selectedSuggestionCount === 0} title="Add selected apps"><Plus size={16} /> Add selected apps</button>
        </div>
        <div className="path-picker">
          <input value={suggestionQuery} onChange={(event) => setSuggestionQuery(event.target.value)} placeholder="Search suggestions" />
          <button title="Search suggestions" disabled><Search size={16} /></button>
        </div>
        {filteredSuggestions.length === 0 ? (
          <p className="empty-state">No suggestions yet. Click Scan for apps to look in safe Windows app sources.</p>
        ) : (
          <div className="discovery-list">
            {filteredSuggestions.map((candidate) => {
              const selectable = Boolean(candidate.executable_path) && !candidate.is_blocked && !candidate.is_registered;
              return (
                <article className={candidate.is_blocked ? "discovery-row blocked" : "discovery-row"} key={candidate.id}>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedSuggestions[candidate.id])}
                      disabled={!selectable}
                      onChange={(event) => setSelectedSuggestions({ ...selectedSuggestions, [candidate.id]: event.target.checked })}
                    />
                    <span>{candidate.name}</span>
                  </label>
                  <div className="discovery-meta">
                    <span className="tag">{candidate.source}</span>
                    <span className={candidate.is_blocked ? "warning-badge" : candidate.is_registered ? "status-badge" : "tag"}>
                      {candidate.is_blocked ? "unsupported" : candidate.is_registered ? "already added" : candidate.confidence}
                    </span>
                    {candidate.publisher && <span>{candidate.publisher}</span>}
                  </div>
                  <small>{candidate.executable_path ?? "No executable path available"}</small>
                  {candidate.block_reason && <small className="inline-warning">{candidate.block_reason}</small>}
                </article>
              );
            })}
          </div>
        )}
      </section>
      <section className="toolbar search-toolbar">
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            void refresh(event.target.value);
          }}
          placeholder="Search registered apps"
        />
      </section>
      <section className="editor">
        <h3>Register Manually</h3>
        <div className="form-grid">
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="App name" />
          <select value={draft.app_type} onChange={(event) => setDraft({ ...draft, app_type: event.target.value as RegisteredAppType })}>
            {appTypes.map((type) => <option key={type} value={type}>{type.replace(/_/g, " ")}</option>)}
          </select>
          <label className="toggle">
            <input type="checkbox" checked={draft.allowed} onChange={(event) => setDraft({ ...draft, allowed: event.target.checked })} />
            Allowed
          </label>
        </div>
        <div className="path-picker">
          <input value={draft.executable_path} onChange={(event) => setDraft({ ...draft, executable_path: event.target.value })} placeholder="C:\Program Files\App\App.exe" />
          <button title="Choose executable" onClick={chooseExe}><FolderSearch size={16} /></button>
        </div>
        <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Description" />
        <button className="primary" onClick={create}><Plus size={16} /> Register app</button>
      </section>
      {message && <p className="warning">{message}</p>}
      {preview && <ActionPreviewCard preview={preview} settings={settings} onDone={() => { setPreview(null); void refresh(); }} />}
      <section className="list">
        <div>
          <h3>Registered Apps</h3>
          <p className="muted">These are the apps Klak can propose opening after your approval.</p>
        </div>
        {apps.map((app) => {
          const pathWarning = pathWarnings[app.id] ?? "";
          const blocked = isBlockedShellExecutable(app.executable_path);
          let validation = "";
          try {
            validateExecutablePath(app.executable_path);
          } catch (error) {
            validation = error instanceof Error ? error.message : String(error);
          }
          return (
            <article className="list-row app-row" key={app.id}>
              <div>
                <div className="row between">
                  <span className="tag">{app.app_type.replace(/_/g, " ")}</span>
                  <span className={app.allowed && !blocked ? "status-badge" : "warning-badge"}>{app.allowed ? "allowed" : "disabled"}</span>
                </div>
                <input value={app.name} onChange={(event) => update(app, { name: event.target.value })} />
                <input value={app.executable_path} onChange={(event) => update(app, { executable_path: event.target.value })} />
                <textarea value={app.description ?? ""} onChange={(event) => update(app, { description: event.target.value })} />
                <label className="toggle">
                  <input type="checkbox" checked={app.allowed} onChange={(event) => update(app, { allowed: event.target.checked })} />
                  Allowed
                </label>
                {(validation || pathWarning) && <small className="inline-warning">{validation || pathWarning}</small>}
                <small>{app.last_launched_at ? `Last launched ${new Date(app.last_launched_at).toLocaleString()}` : "Never launched"}</small>
              </div>
              <div className="row-actions">
                <button title="Launch registered app" disabled={!app.allowed || Boolean(validation || pathWarning)} onClick={() => launch(app)}><Rocket size={16} /></button>
                <button title="Delete registered app" onClick={() => deleteRegisteredApp(app.id).then(() => refresh())}><Trash2 size={16} /></button>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}

function emptyToNull(value: string): string | null {
  return value.trim() ? value.trim() : null;
}

function inferAppType(candidate: DiscoveredAppCandidate): RegisteredAppType {
  const value = `${candidate.name} ${candidate.publisher ?? ""} ${candidate.executable_path ?? ""}`.toLowerCase();
  if (/\b(chrome|edge|firefox|brave|opera|browser)\b/.test(value)) return "browser";
  if (/\b(code|visual studio|postman|github|jetbrains|android studio)\b/.test(value)) return "dev_tool";
  if (/\b(zoom|teams|slack|discord)\b/.test(value)) return "communication";
  if (/\b(word|excel|powerpoint|office|notion|obsidian|onenote|adobe acrobat)\b/.test(value)) return "productivity";
  if (/\b(figma|photoshop|illustrator|premiere|blender|canva)\b/.test(value)) return "design";
  return "other";
}
