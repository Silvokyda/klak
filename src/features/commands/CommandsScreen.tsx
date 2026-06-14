import { Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ActionPreviewCard } from "../../components/ActionPreviewCard";
import { ScreenHeader } from "../../components/ScreenHeader";
import type { ActionPreview, AllowedFolder, AppSettings, CommandTemplateRecord, CommandTemplateType, ProjectRecord, RiskLevel } from "../../types";
import {
  createCommandTemplate,
  deleteCommandTemplate,
  inferCommandRisk,
  inferCommandType,
  isLongRunningCommand,
  searchCommandTemplates,
  updateCommandTemplate,
  validateCommandSafety
} from "../../lib/commands/commandTemplateRepository";
import { listProjects } from "../../lib/projects/projectRepository";
import { listAllowedFolders } from "../../lib/storage/allowedFoldersRepository";
import { buildActionPreviewForSuggestion } from "../../lib/tools/toolProposals";

const commandTypes: CommandTemplateType[] = ["npm", "node", "cargo", "git_readonly", "flutter", "php_artisan", "python", "custom_safe"];
const riskLevels: Array<Exclude<RiskLevel, "dangerous">> = ["low", "medium", "high"];
const presets = [
  { group: "Node/Tauri", name: "Build web app", command: "npm run build" },
  { group: "Node/Tauri", name: "Cargo check", command: "cargo check" },
  { group: "Node/Tauri", name: "Cargo fmt check", command: "cargo fmt --check" },
  { group: "Node/Tauri", name: "Git status", command: "git status --short" },
  { group: "Laravel", name: "PHP tests", command: "php artisan test" },
  { group: "Laravel", name: "Routes", command: "php artisan route:list" },
  { group: "Flutter", name: "Analyze", command: "flutter analyze" },
  { group: "Flutter", name: "Tests", command: "flutter test" },
  { group: "Node/Tauri long-running", name: "Vite dev", command: "npm run dev", longRunning: true },
  { group: "Node/Tauri long-running", name: "Tauri dev", command: "npm run tauri dev", longRunning: true },
  { group: "Laravel long-running", name: "Serve", command: "php artisan serve", longRunning: true },
  { group: "Laravel long-running", name: "Queue worker", command: "php artisan queue:work", longRunning: true },
  { group: "Flutter long-running", name: "Flutter run", command: "flutter run", longRunning: true }
];

export function CommandsScreen({ settings }: { settings: AppSettings }) {
  const [templates, setTemplates] = useState<CommandTemplateRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [folders, setFolders] = useState<AllowedFolder[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<ActionPreview | null>(null);
  const [draft, setDraft] = useState({
    project_id: "",
    name: "",
    description: "",
    command: "npm run build",
    working_directory: "",
    command_type: "npm" as CommandTemplateType,
    risk_level: "medium" as Exclude<RiskLevel, "dangerous">,
    timeout_seconds: 120,
    enabled: true,
    is_long_running: false,
    allow_background_run: false,
    max_runtime_seconds: 0,
    auto_stop_on_app_exit: true
  });

  const projectName = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);

  async function refresh(nextQuery = query) {
    const [nextTemplates, nextProjects, nextFolders] = await Promise.all([
      searchCommandTemplates(nextQuery),
      listProjects(),
      listAllowedFolders()
    ]);
    setTemplates(nextTemplates);
    setProjects(nextProjects);
    setFolders(nextFolders);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function create() {
    setMessage(null);
    try {
      await createCommandTemplate({
        ...draft,
        project_id: emptyToNull(draft.project_id),
        description: emptyToNull(draft.description)
      });
      setDraft({ ...draft, name: "", description: "" });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function applyPreset(command: string, longRunning = false) {
    setDraft({
      ...draft,
      command,
      command_type: inferCommandType(command),
      risk_level: inferCommandRisk(command),
      name: draft.name || command,
      is_long_running: longRunning,
      allow_background_run: longRunning,
      timeout_seconds: longRunning ? 120 : draft.timeout_seconds
    });
  }

  async function run(template: CommandTemplateRecord) {
    setMessage(null);
    const toolName = template.is_long_running ? "start_background_process" : "run_command_template";
    const nextPreview = await buildActionPreviewForSuggestion({ toolName, input: { command_template_id: template.id } }, settings);
    if (nextPreview) setPreview(nextPreview);
  }

  async function update(template: CommandTemplateRecord, patch: Partial<CommandTemplateRecord>) {
    setMessage(null);
    try {
      await updateCommandTemplate(template.id, patch);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="screen">
      <ScreenHeader title="Commands" subtitle="Save finite command templates before Klak can preview and run them." />
      <section className="toolbar search-toolbar">
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            void refresh(event.target.value);
          }}
          placeholder="Search command templates"
        />
      </section>
      <section className="editor">
        <div className="preset-row">
          {presets.map((preset) => (
            <button key={`${preset.group}-${preset.command}`} onClick={() => applyPreset(preset.command, Boolean(preset.longRunning))} title={`Use ${preset.group} preset`}>
              {preset.command}
            </button>
          ))}
        </div>
        <div className="form-grid">
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Template name" />
          <select value={draft.project_id} onChange={(event) => setDraft({ ...draft, project_id: event.target.value })}>
            <option value="">No project</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <select value={draft.working_directory} onChange={(event) => setDraft({ ...draft, working_directory: event.target.value })}>
            <option value="">Allowed working directory</option>
            {folders.map((folder) => <option key={folder.id} value={folder.path}>{folder.label ?? folder.path}</option>)}
          </select>
          <input type="number" min={5} max={600} value={draft.timeout_seconds} onChange={(event) => setDraft({ ...draft, timeout_seconds: Number(event.target.value) })} />
        </div>
        <div className="form-grid">
          <input
            value={draft.command}
            onChange={(event) => {
              const command = event.target.value;
              setDraft({ ...draft, command, command_type: inferCommandType(command), risk_level: inferCommandRisk(command) });
            }}
            placeholder="npm run build"
          />
          <select value={draft.command_type} onChange={(event) => setDraft({ ...draft, command_type: event.target.value as CommandTemplateType })}>
            {commandTypes.map((type) => <option key={type} value={type}>{type.replace(/_/g, " ")}</option>)}
          </select>
          <select value={draft.risk_level} onChange={(event) => setDraft({ ...draft, risk_level: event.target.value as Exclude<RiskLevel, "dangerous"> })}>
            {riskLevels.map((risk) => <option key={risk} value={risk}>{risk}</option>)}
          </select>
          <label className="toggle">
            <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
            Enabled
          </label>
          <label className="toggle">
            <input type="checkbox" checked={draft.is_long_running} onChange={(event) => setDraft({ ...draft, is_long_running: event.target.checked, allow_background_run: event.target.checked ? draft.allow_background_run : false })} />
            Long-running
          </label>
          <label className="toggle">
            <input type="checkbox" checked={draft.allow_background_run} disabled={!draft.is_long_running} onChange={(event) => setDraft({ ...draft, allow_background_run: event.target.checked })} />
            Background run
          </label>
          <label className="toggle">
            <input type="checkbox" checked={draft.auto_stop_on_app_exit} disabled={!draft.is_long_running} onChange={(event) => setDraft({ ...draft, auto_stop_on_app_exit: event.target.checked })} />
            Stop on exit
          </label>
          <input type="number" min={0} max={86400} value={draft.max_runtime_seconds} onChange={(event) => setDraft({ ...draft, max_runtime_seconds: Number(event.target.value) })} placeholder="Max runtime seconds" />
        </div>
        <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Description" />
        <button className="primary" onClick={create}><Plus size={16} /> Create command</button>
      </section>
      {message && <p className="warning">{message}</p>}
      {preview && <ActionPreviewCard preview={preview} settings={settings} onDone={() => { setPreview(null); void refresh(); }} />}
      <section className="list">
        {templates.map((template) => {
          let validation = "";
          try {
            validateCommandSafety(template.command);
          } catch (error) {
            validation = error instanceof Error ? error.message : String(error);
          }
          if (isLongRunningCommand(template.command) && (!template.is_long_running || !template.allow_background_run)) validation ||= "Mark as long-running and allow background run before starting.";
          return (
            <article className="list-row command-row" key={template.id}>
              <div>
                <div className="row between">
                  <span className={`risk risk-${template.risk_level}`}>{template.risk_level}</span>
                  <span className="tag">{template.project_id ? projectName.get(template.project_id) ?? "project" : template.command_type.replace(/_/g, " ")}</span>
                </div>
                <input value={template.name} onChange={(event) => update(template, { name: event.target.value })} />
                <input value={template.command} onChange={(event) => update(template, { command: event.target.value, command_type: inferCommandType(event.target.value), risk_level: inferCommandRisk(event.target.value) })} />
                <div className="form-grid">
                  <select value={template.project_id ?? ""} onChange={(event) => update(template, { project_id: emptyToNull(event.target.value) })}>
                    <option value="">No project</option>
                    {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                  </select>
                  <select value={template.working_directory} onChange={(event) => update(template, { working_directory: event.target.value })}>
                    {folders.map((folder) => <option key={folder.id} value={folder.path}>{folder.label ?? folder.path}</option>)}
                  </select>
                  <input type="number" min={5} max={600} value={template.timeout_seconds} onChange={(event) => update(template, { timeout_seconds: Number(event.target.value) })} />
                  <label className="toggle">
                    <input type="checkbox" checked={template.enabled} onChange={(event) => update(template, { enabled: event.target.checked })} />
                    Enabled
                  </label>
                  <label className="toggle">
                    <input type="checkbox" checked={template.is_long_running} onChange={(event) => update(template, { is_long_running: event.target.checked, allow_background_run: event.target.checked ? template.allow_background_run : false })} />
                    Long-running
                  </label>
                  <label className="toggle">
                    <input type="checkbox" checked={template.allow_background_run} disabled={!template.is_long_running} onChange={(event) => update(template, { allow_background_run: event.target.checked })} />
                    Background
                  </label>
                </div>
                <textarea value={template.description ?? ""} onChange={(event) => update(template, { description: event.target.value })} />
                {validation && <small className="inline-warning">{validation}</small>}
                <small>{template.last_result_summary ?? "No run result yet"}</small>
                <small>Runs: {template.run_count} {template.last_run_at ? `Last run ${new Date(template.last_run_at).toLocaleString()}` : ""}</small>
              </div>
              <div className="row-actions">
                <button title={template.is_long_running ? "Start background process" : "Run command template"} disabled={!template.enabled || Boolean(validation)} onClick={() => run(template)}><Play size={16} /></button>
                <button title="Delete command template" onClick={() => deleteCommandTemplate(template.id).then(() => refresh())}><Trash2 size={16} /></button>
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
