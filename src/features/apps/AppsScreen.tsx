import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { FolderSearch, Plus, Rocket, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ActionPreviewCard } from "../../components/ActionPreviewCard";
import { ScreenHeader } from "../../components/ScreenHeader";
import type { ActionPreview, AppSettings, RegisteredAppRecord, RegisteredAppType } from "../../types";
import {
  createRegisteredApp,
  deleteRegisteredApp,
  isBlockedShellExecutable,
  searchRegisteredApps,
  updateRegisteredApp,
  validateExecutablePath
} from "../../lib/apps/registeredAppsRepository";
import { buildActionPreviewForSuggestion } from "../../lib/tools/toolProposals";

const appTypes: RegisteredAppType[] = ["editor", "browser", "design", "communication", "productivity", "dev_tool", "other"];

export function AppsScreen({ settings }: { settings: AppSettings }) {
  const [apps, setApps] = useState<RegisteredAppRecord[]>([]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState({ name: "", executable_path: "", app_type: "editor" as RegisteredAppType, description: "", allowed: true });
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<ActionPreview | null>(null);
  const [pathWarnings, setPathWarnings] = useState<Record<string, string>>({});

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

  return (
    <div className="screen">
      <ScreenHeader title="Apps" subtitle="Register approved local applications before Klak can propose launching them." />
      <section className="toolbar search-toolbar">
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            void refresh(event.target.value);
          }}
          placeholder="Search apps"
        />
      </section>
      <section className="editor">
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
