import type { ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Play,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Terminal,
  Trash2,
  Wrench
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ActionPreviewCard } from "../../components/ActionPreviewCard";
import { ScreenHeader } from "../../components/ScreenHeader";
import type {
  ActionPreview,
  AllowedFolder,
  AppSettings,
  CommandTemplateRecord,
  CommandTemplateType,
  ProjectRecord,
  RiskLevel
} from "../../types";
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

const commandTypes: CommandTemplateType[] = [
  "npm",
  "node",
  "cargo",
  "git_readonly",
  "flutter",
  "php_artisan",
  "python",
  "custom_safe"
];

const riskLevels: Array<Exclude<RiskLevel, "dangerous">> = ["low", "medium", "high"];

const presets = [
  { group: "Node / Tauri", name: "Build web app", command: "npm run build" },
  { group: "Node / Tauri", name: "Cargo check", command: "cargo check" },
  { group: "Node / Tauri", name: "Cargo fmt check", command: "cargo fmt --check" },
  { group: "Node / Tauri", name: "Git status", command: "git status --short" },
  { group: "Laravel", name: "PHP tests", command: "php artisan test" },
  { group: "Laravel", name: "Routes", command: "php artisan route:list" },
  { group: "Flutter", name: "Analyze", command: "flutter analyze" },
  { group: "Flutter", name: "Tests", command: "flutter test" },
  { group: "Long-running", name: "Vite dev", command: "npm run dev", longRunning: true },
  { group: "Long-running", name: "Tauri dev", command: "npm run tauri dev", longRunning: true },
  { group: "Long-running", name: "Laravel serve", command: "php artisan serve", longRunning: true },
  { group: "Long-running", name: "Queue worker", command: "php artisan queue:work", longRunning: true },
  { group: "Long-running", name: "Flutter run", command: "flutter run", longRunning: true }
];

type ActionFilter = "all" | "enabled" | "disabled" | "long_running" | "needs_attention";

export function CommandsScreen({ settings }: { settings: AppSettings }) {
  const [templates, setTemplates] = useState<CommandTemplateRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [folders, setFolders] = useState<AllowedFolder[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ActionFilter>("all");
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

  const projectName = useMemo(() => {
    return new Map(projects.map((project) => [project.id, project.name]));
  }, [projects]);

  const visibleTemplates = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    return templates.filter((template) => {
      const validation = getTemplateValidation(template);
      const matchesFilter =
        filter === "all" ||
        (filter === "enabled" && template.enabled) ||
        (filter === "disabled" && !template.enabled) ||
        (filter === "long_running" && template.is_long_running) ||
        (filter === "needs_attention" && Boolean(validation));

      if (!matchesFilter) return false;
      if (!normalized) return true;

      const linkedProject = template.project_id ? projectName.get(template.project_id) : "";

      return [
        template.name,
        template.command,
        template.description,
        template.command_type,
        template.risk_level,
        linkedProject,
        validation
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [templates, query, filter, projectName]);

  const enabledCount = useMemo(() => {
    return templates.filter((template) => template.enabled).length;
  }, [templates]);

  const longRunningCount = useMemo(() => {
    return templates.filter((template) => template.is_long_running).length;
  }, [templates]);

  const attentionCount = useMemo(() => {
    return templates.filter((template) => Boolean(getTemplateValidation(template))).length;
  }, [templates]);

  const highRiskCount = useMemo(() => {
    return templates.filter((template) => template.risk_level === "high").length;
  }, [templates]);

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

    if (!draft.name.trim()) {
      setMessage("Add a saved action name before saving.");
      return;
    }

    if (!draft.command.trim()) {
      setMessage("Add a command before saving.");
      return;
    }

    if (!draft.working_directory.trim()) {
      setMessage("Choose an allowed working folder before saving.");
      return;
    }

    try {
      validateCommandSafety(draft.command);

      await createCommandTemplate({
        ...draft,
        project_id: emptyToNull(draft.project_id),
        name: draft.name.trim(),
        command: draft.command.trim(),
        working_directory: draft.working_directory.trim(),
        description: emptyToNull(draft.description)
      });

      setDraft({ ...draft, name: "", description: "" });
      await refresh();
      setMessage("Saved action created locally.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function applyPreset(command: string, longRunning = false) {
    const detectedLongRunning = longRunning || isLongRunningCommand(command);

    setDraft({
      ...draft,
      command,
      command_type: inferCommandType(command),
      risk_level: inferCommandRisk(command),
      name: draft.name || command,
      is_long_running: detectedLongRunning,
      allow_background_run: detectedLongRunning,
      timeout_seconds: detectedLongRunning ? 120 : draft.timeout_seconds,
      max_runtime_seconds: detectedLongRunning ? draft.max_runtime_seconds : 0
    });
  }

  function updateDraftCommand(command: string) {
    const detectedLongRunning = isLongRunningCommand(command);

    setDraft({
      ...draft,
      command,
      command_type: inferCommandType(command),
      risk_level: inferCommandRisk(command),
      is_long_running: detectedLongRunning ? true : draft.is_long_running,
      allow_background_run: detectedLongRunning ? true : draft.allow_background_run
    });
  }

  async function run(template: CommandTemplateRecord) {
    setMessage(null);

    const validation = getTemplateValidation(template);

    if (validation) {
      setMessage(validation);
      return;
    }

    const toolName = template.is_long_running ? "start_background_process" : "run_command_template";

    const nextPreview = await buildActionPreviewForSuggestion(
      { toolName, input: { command_template_id: template.id } },
      settings
    );

    if (nextPreview) setPreview(nextPreview);
  }

  async function update(template: CommandTemplateRecord, patch: Partial<CommandTemplateRecord>) {
    setMessage(null);

    try {
      await updateCommandTemplate(template.id, patch);
      await refresh();
      setMessage("Saved action updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function remove(template: CommandTemplateRecord) {
    const confirmed = window.confirm(
      `Delete "${template.name}"? This removes the saved action, not your project files.`
    );

    if (!confirmed) return;

    await deleteCommandTemplate(template.id);
    await refresh();
  }

  return (
    <div className="screen actions-screen">
      <ScreenHeader
        title="Saved Actions"
        subtitle="Save approved local commands for projects and routines. Running still uses preview and confirmation."
      />

      <section className="actions-hero">
        <div>
          <span className="eyebrow">Command library</span>
          <h3>Store repeatable local actions without giving Klak a free terminal.</h3>
          <p>
            Saved actions are restricted templates. Klak can propose running them, but each run still
            goes through the action preview flow.
          </p>
        </div>

        <div className="actions-hero-card">
          <ShieldCheck size={20} />
          <div>
            <strong>Preview required</strong>
            <span>No arbitrary terminal execution. Only saved, validated actions can be proposed.</span>
          </div>
        </div>
      </section>

      <section className="actions-overview">
        <ActionMetric icon={<Terminal size={18} />} label="Saved actions" value={templates.length} hint="Local templates" />
        <ActionMetric icon={<CheckCircle2 size={18} />} label="Enabled" value={enabledCount} hint="Available to use" />
        <ActionMetric icon={<Activity size={18} />} label="Long-running" value={longRunningCount} hint="Can start activities" />
        <ActionMetric icon={<AlertTriangle size={18} />} label="Needs attention" value={attentionCount} hint="Validation warnings" />
        <ActionMetric icon={<Wrench size={18} />} label="High risk" value={highRiskCount} hint="Review carefully" />
      </section>

      <section className="actions-controls">
        <div className="actions-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              void refresh(event.target.value);
            }}
            placeholder="Search saved actions, commands, projects, or risk"
          />
        </div>

        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as ActionFilter)}
          aria-label="Filter saved actions"
        >
          <option value="all">All saved actions</option>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
          <option value="long_running">Long-running</option>
          <option value="needs_attention">Needs attention</option>
        </select>
      </section>

      {message && <p className="warning">{message}</p>}

      {preview && (
        <ActionPreviewCard
          preview={preview}
          settings={settings}
          onDone={() => {
            setPreview(null);
            void refresh();
          }}
        />
      )}

      <div className="actions-layout">
        <section className="action-create-card">
          <div className="actions-section-header">
            <div>
              <span className="eyebrow">New saved action</span>
              <h3>Create a controlled command</h3>
              <p>Use presets where possible. Keep working folders narrow and command scope specific.</p>
            </div>
          </div>

          <section className="action-presets-panel">
            <div className="actions-mini-header">
              <strong>Presets</strong>
              <span>Safe starting points for common project tasks.</span>
            </div>

            <div className="action-preset-groups">
              {groupPresets().map((group) => (
                <div className="action-preset-group" key={group.name}>
                  <span>{group.name}</span>
                  <div>
                    {group.items.map((preset) => (
                      <button
                        key={`${preset.group}-${preset.command}`}
                        onClick={() => applyPreset(preset.command, Boolean(preset.longRunning))}
                        title={`Use ${preset.name}`}
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="action-create-grid">
            <label className="field-stack">
              <span>Name</span>
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Example: Build Klak"
              />
            </label>

            <label className="field-stack">
              <span>Project</span>
              <select
                value={draft.project_id}
                onChange={(event) => setDraft({ ...draft, project_id: event.target.value })}
              >
                <option value="">No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field-stack">
            <span>Allowed working folder</span>
            <select
              value={draft.working_directory}
              onChange={(event) => setDraft({ ...draft, working_directory: event.target.value })}
            >
              <option value="">Choose allowed working folder</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.path}>
                  {folder.label ?? folder.path}
                </option>
              ))}
            </select>
            <small>Only folders listed in settings should be used for saved actions.</small>
          </label>

          <label className="field-stack">
            <span>Command</span>
            <input
              value={draft.command}
              onChange={(event) => updateDraftCommand(event.target.value)}
              placeholder="npm run build"
            />
          </label>

          <div className="action-create-grid">
            <label className="field-stack">
              <span>Command type</span>
              <select
                value={draft.command_type}
                onChange={(event) =>
                  setDraft({ ...draft, command_type: event.target.value as CommandTemplateType })
                }
              >
                {commandTypes.map((type) => (
                  <option key={type} value={type}>
                    {formatCommandType(type)}
                  </option>
                ))}
              </select>
            </label>

            <label className="field-stack">
              <span>Risk level</span>
              <select
                value={draft.risk_level}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    risk_level: event.target.value as Exclude<RiskLevel, "dangerous">
                  })
                }
              >
                {riskLevels.map((risk) => (
                  <option key={risk} value={risk}>
                    {formatRisk(risk)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="action-create-grid">
            <label className="field-stack">
              <span>Timeout seconds</span>
              <input
                type="number"
                min={5}
                max={600}
                value={draft.timeout_seconds}
                onChange={(event) =>
                  setDraft({ ...draft, timeout_seconds: Number(event.target.value) })
                }
              />
            </label>

            <label className="field-stack">
              <span>Max runtime seconds</span>
              <input
                type="number"
                min={0}
                max={86400}
                value={draft.max_runtime_seconds}
                onChange={(event) =>
                  setDraft({ ...draft, max_runtime_seconds: Number(event.target.value) })
                }
                placeholder="0 means no limit"
              />
            </label>
          </div>

          <label className="field-stack">
            <span>Description</span>
            <textarea
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              placeholder="What does this saved action do?"
            />
          </label>

          <div className="action-toggle-grid">
            <ToggleRow
              checked={draft.enabled}
              title="Enabled"
              description="Klak may propose this action."
              onChange={(checked) => setDraft({ ...draft, enabled: checked })}
            />

            <ToggleRow
              checked={draft.is_long_running}
              title="Long-running"
              description="Use for dev servers, workers, or app sessions."
              onChange={(checked) =>
                setDraft({
                  ...draft,
                  is_long_running: checked,
                  allow_background_run: checked ? draft.allow_background_run : false
                })
              }
            />

            <ToggleRow
              checked={draft.allow_background_run}
              disabled={!draft.is_long_running}
              title="Allow background run"
              description="Creates a visible running activity."
              onChange={(checked) => setDraft({ ...draft, allow_background_run: checked })}
            />

            <ToggleRow
              checked={draft.auto_stop_on_app_exit}
              disabled={!draft.is_long_running}
              title="Stop on app exit"
              description="Ask Klak to stop the activity when Klak closes."
              onChange={(checked) => setDraft({ ...draft, auto_stop_on_app_exit: checked })}
            />
          </div>

          <button className="primary" onClick={create}>
            <Plus size={16} /> Create saved action
          </button>
        </section>

        <section className="action-list-panel">
          <div className="actions-section-header">
            <div>
              <span className="eyebrow">Saved</span>
              <h3>Action library</h3>
              <p className="muted">
                {visibleTemplates.length} visible{" "}
                {visibleTemplates.length === 1 ? "action" : "actions"}
              </p>
            </div>
          </div>

          {visibleTemplates.length === 0 ? (
            <div className="actions-empty-state">
              <strong>No saved actions found</strong>
              <p>Create an action, change the filter, or clear your search.</p>
            </div>
          ) : (
            <div className="action-card-list">
              {visibleTemplates.map((template) => (
                <CommandCard
                  key={template.id}
                  template={template}
                  projects={projects}
                  folders={folders}
                  projectLabel={
                    template.project_id
                      ? projectName.get(template.project_id) ?? "Project"
                      : formatCommandType(template.command_type)
                  }
                  onRun={run}
                  onSave={(patch) => update(template, patch)}
                  onDelete={() => remove(template)}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function CommandCard({
  template,
  projects,
  folders,
  projectLabel,
  onRun,
  onSave,
  onDelete
}: {
  template: CommandTemplateRecord;
  projects: ProjectRecord[];
  folders: AllowedFolder[];
  projectLabel: string;
  onRun: (template: CommandTemplateRecord) => Promise<void>;
  onSave: (patch: Partial<CommandTemplateRecord>) => Promise<void>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({
    project_id: template.project_id ?? "",
    name: template.name,
    description: template.description ?? "",
    command: template.command,
    working_directory: template.working_directory,
    command_type: template.command_type,
    risk_level: template.risk_level as Exclude<RiskLevel, "dangerous">,
    timeout_seconds: template.timeout_seconds,
    enabled: template.enabled,
    is_long_running: template.is_long_running,
    allow_background_run: template.allow_background_run,
    max_runtime_seconds: template.max_runtime_seconds,
    auto_stop_on_app_exit: template.auto_stop_on_app_exit
  });

  const validation = getTemplateValidation(template);
  const canRun = template.enabled && !validation;

  function resetEditDraft() {
    setEditDraft({
      project_id: template.project_id ?? "",
      name: template.name,
      description: template.description ?? "",
      command: template.command,
      working_directory: template.working_directory,
      command_type: template.command_type,
      risk_level: template.risk_level as Exclude<RiskLevel, "dangerous">,
      timeout_seconds: template.timeout_seconds,
      enabled: template.enabled,
      is_long_running: template.is_long_running,
      allow_background_run: template.allow_background_run,
      max_runtime_seconds: template.max_runtime_seconds,
      auto_stop_on_app_exit: template.auto_stop_on_app_exit
    });
  }

  function updateEditCommand(command: string) {
    const detectedLongRunning = isLongRunningCommand(command);

    setEditDraft({
      ...editDraft,
      command,
      command_type: inferCommandType(command),
      risk_level: inferCommandRisk(command),
      is_long_running: detectedLongRunning ? true : editDraft.is_long_running,
      allow_background_run: detectedLongRunning ? true : editDraft.allow_background_run
    });
  }

  async function save() {
    setMessage(null);

    if (!editDraft.name.trim()) {
      setMessage("Saved action name cannot be empty.");
      return;
    }

    if (!editDraft.command.trim()) {
      setMessage("Command cannot be empty.");
      return;
    }

    if (!editDraft.working_directory.trim()) {
      setMessage("Choose an allowed working folder.");
      return;
    }

    try {
      validateCommandSafety(editDraft.command);

      await onSave({
        project_id: emptyToNull(editDraft.project_id),
        name: editDraft.name.trim(),
        description: emptyToNull(editDraft.description),
        command: editDraft.command.trim(),
        working_directory: editDraft.working_directory.trim(),
        command_type: editDraft.command_type,
        risk_level: editDraft.risk_level,
        timeout_seconds: editDraft.timeout_seconds,
        enabled: editDraft.enabled,
        is_long_running: editDraft.is_long_running,
        allow_background_run: editDraft.allow_background_run,
        max_runtime_seconds: editDraft.max_runtime_seconds,
        auto_stop_on_app_exit: editDraft.auto_stop_on_app_exit
      });

      setEditing(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <article className={`action-card ${validation ? "action-card-attention" : ""}`}>
      <div className="action-card-header">
        <div className="action-title-area">
          <div className="action-badge-row">
            <span className={`risk risk-${template.risk_level}`}>{formatRisk(template.risk_level)}</span>
            <span className="tag">{projectLabel}</span>
            {template.is_long_running && (
              <span className="action-running-badge">
                <Clock3 size={13} /> Long-running
              </span>
            )}
            {!template.enabled && <span className="warning-badge">Disabled</span>}
          </div>

          <h4>{template.name}</h4>

          <p>
            {template.description?.trim()
              ? template.description
              : "No description yet. Add one so this action is easier to review before running."}
          </p>
        </div>

        <div className="action-card-actions">
          <button title={template.is_long_running ? "Start running activity" : "Run saved action"} disabled={!canRun} onClick={() => onRun(template)}>
            <Play size={16} /> {template.is_long_running ? "Start" : "Run"}
          </button>

          <button onClick={() => setShowDetails((value) => !value)}>
            {showDetails ? "Hide details" : "Details"}
          </button>

          <button
            onClick={() => {
              setEditing((value) => !value);
              setMessage(null);
              resetEditDraft();
            }}
          >
            {editing ? "Cancel" : "Edit"}
          </button>

          <button className="danger-button" title="Delete saved action" onClick={onDelete}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="action-command-preview">
        <span>Command</span>
        <code>{template.command}</code>
      </div>

      <div className="action-summary-grid">
        <div>
          <span>Runs</span>
          <strong>{template.run_count}</strong>
        </div>

        <div>
          <span>Timeout</span>
          <strong>{template.timeout_seconds}s</strong>
        </div>

        <div>
          <span>Last run</span>
          <strong>{template.last_run_at ? new Date(template.last_run_at).toLocaleString() : "Never"}</strong>
        </div>
      </div>

      {validation && <p className="action-warning-note">{validation}</p>}

      {template.last_result_summary && (
        <p className="action-result-note">{template.last_result_summary}</p>
      )}

      {showDetails && (
        <div className="action-details">
          <div>
            <span className="detail-label">Working folder</span>
            <code>{template.working_directory}</code>
          </div>

          <div>
            <span className="detail-label">Command type</span>
            <strong>{formatCommandType(template.command_type)}</strong>
          </div>

          <div>
            <span className="detail-label">Background run</span>
            <strong>{template.allow_background_run ? "Allowed" : "Not allowed"}</strong>
          </div>

          <div>
            <span className="detail-label">Stop on app exit</span>
            <strong>{template.auto_stop_on_app_exit ? "Yes" : "No"}</strong>
          </div>

          <div>
            <span className="detail-label">Max runtime</span>
            <strong>
              {template.max_runtime_seconds ? `${template.max_runtime_seconds}s` : "No limit set"}
            </strong>
          </div>
        </div>
      )}

      {editing && (
        <div className="action-edit-form">
          <div className="action-create-grid">
            <label className="field-stack">
              <span>Name</span>
              <input
                value={editDraft.name}
                onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value })}
              />
            </label>

            <label className="field-stack">
              <span>Project</span>
              <select
                value={editDraft.project_id}
                onChange={(event) => setEditDraft({ ...editDraft, project_id: event.target.value })}
              >
                <option value="">No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field-stack">
            <span>Working folder</span>
            <select
              value={editDraft.working_directory}
              onChange={(event) =>
                setEditDraft({ ...editDraft, working_directory: event.target.value })
              }
            >
              {editDraft.working_directory &&
                !folders.some((folder) => folder.path === editDraft.working_directory) && (
                  <option value={editDraft.working_directory}>{editDraft.working_directory}</option>
                )}
              {folders.map((folder) => (
                <option key={folder.id} value={folder.path}>
                  {folder.label ?? folder.path}
                </option>
              ))}
            </select>
          </label>

          <label className="field-stack">
            <span>Command</span>
            <input
              value={editDraft.command}
              onChange={(event) => updateEditCommand(event.target.value)}
            />
          </label>

          <div className="action-create-grid">
            <label className="field-stack">
              <span>Command type</span>
              <select
                value={editDraft.command_type}
                onChange={(event) =>
                  setEditDraft({
                    ...editDraft,
                    command_type: event.target.value as CommandTemplateType
                  })
                }
              >
                {commandTypes.map((type) => (
                  <option key={type} value={type}>
                    {formatCommandType(type)}
                  </option>
                ))}
              </select>
            </label>

            <label className="field-stack">
              <span>Risk level</span>
              <select
                value={editDraft.risk_level}
                onChange={(event) =>
                  setEditDraft({
                    ...editDraft,
                    risk_level: event.target.value as Exclude<RiskLevel, "dangerous">
                  })
                }
              >
                {riskLevels.map((risk) => (
                  <option key={risk} value={risk}>
                    {formatRisk(risk)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="action-create-grid">
            <label className="field-stack">
              <span>Timeout seconds</span>
              <input
                type="number"
                min={5}
                max={600}
                value={editDraft.timeout_seconds}
                onChange={(event) =>
                  setEditDraft({ ...editDraft, timeout_seconds: Number(event.target.value) })
                }
              />
            </label>

            <label className="field-stack">
              <span>Max runtime seconds</span>
              <input
                type="number"
                min={0}
                max={86400}
                value={editDraft.max_runtime_seconds}
                onChange={(event) =>
                  setEditDraft({ ...editDraft, max_runtime_seconds: Number(event.target.value) })
                }
              />
            </label>
          </div>

          <label className="field-stack">
            <span>Description</span>
            <textarea
              value={editDraft.description}
              onChange={(event) =>
                setEditDraft({ ...editDraft, description: event.target.value })
              }
            />
          </label>

          <div className="action-toggle-grid">
            <ToggleRow
              checked={editDraft.enabled}
              title="Enabled"
              description="Klak may propose this action."
              onChange={(checked) => setEditDraft({ ...editDraft, enabled: checked })}
            />

            <ToggleRow
              checked={editDraft.is_long_running}
              title="Long-running"
              description="Use for dev servers, workers, or app sessions."
              onChange={(checked) =>
                setEditDraft({
                  ...editDraft,
                  is_long_running: checked,
                  allow_background_run: checked ? editDraft.allow_background_run : false
                })
              }
            />

            <ToggleRow
              checked={editDraft.allow_background_run}
              disabled={!editDraft.is_long_running}
              title="Allow background run"
              description="Creates a visible running activity."
              onChange={(checked) =>
                setEditDraft({ ...editDraft, allow_background_run: checked })
              }
            />

            <ToggleRow
              checked={editDraft.auto_stop_on_app_exit}
              disabled={!editDraft.is_long_running}
              title="Stop on app exit"
              description="Ask Klak to stop the activity when Klak closes."
              onChange={(checked) =>
                setEditDraft({ ...editDraft, auto_stop_on_app_exit: checked })
              }
            />
          </div>

          <button className="primary" onClick={save}>
            <Save size={16} /> Save changes
          </button>

          {message && <p className="inline-status">{message}</p>}
        </div>
      )}
    </article>
  );
}

function ActionMetric({
  icon,
  label,
  value,
  hint
}: {
  icon: ReactNode;
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <article className="action-stat-card">
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
  disabled = false
}: {
  checked: boolean;
  title: string;
  description: string;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`action-toggle-row ${disabled ? "action-toggle-disabled" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
    </label>
  );
}

function groupPresets() {
  const groups: Array<{ name: string; items: typeof presets }> = [];

  for (const preset of presets) {
    const group = groups.find((item) => item.name === preset.group);

    if (group) {
      group.items.push(preset);
    } else {
      groups.push({ name: preset.group, items: [preset] });
    }
  }

  return groups;
}

function getTemplateValidation(template: CommandTemplateRecord): string {
  try {
    validateCommandSafety(template.command);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  if (
    isLongRunningCommand(template.command) &&
    (!template.is_long_running || !template.allow_background_run)
  ) {
    return "Mark this as long-running and allow background run before starting it.";
  }

  return "";
}

function formatCommandType(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatRisk(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function emptyToNull(value: string): string | null {
  return value.trim() ? value.trim() : null;
}