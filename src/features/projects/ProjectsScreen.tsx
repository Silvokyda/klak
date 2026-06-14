import { invoke } from "@tauri-apps/api/core";
import {
  ClipboardList,
  FilePlus,
  FolderOpen,
  Play,
  Plus,
  Save,
  Search,
  Square,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ActionPreviewCard } from "../../components/ActionPreviewCard";
import { ScreenHeader } from "../../components/ScreenHeader";
import type {
  ActionPreview,
  AppSettings,
  BackgroundProcessRecord,
  CommandTemplateRecord,
  ProjectRecord,
  ProjectStatus,
  ProjectType,
  WorkflowRecord
} from "../../types";
import { createCommandTemplate, listCommandTemplates } from "../../lib/commands/commandTemplateRepository";
import { listBackgroundProcesses, markProcessStopped } from "../../lib/processes/backgroundProcessRepository";
import { createProject, deleteProject, listProjects, touchProject, updateProject } from "../../lib/projects/projectRepository";
import { buildActionPreviewForSuggestion } from "../../lib/tools/toolProposals";
import { listWorkflows, previewWorkflow, runWorkflow } from "../../lib/workflows/workflowRepository";

const projectTypes: ProjectType[] = [
  "web_app",
  "mobile_app",
  "backend",
  "desktop_app",
  "ai_project",
  "documentation",
  "business",
  "other"
];

const statuses: Array<ProjectStatus | "all"> = ["all", "active", "paused", "archived"];

const projectTypeDescriptions: Record<ProjectType, string> = {
  web_app: "Browser-based product, dashboard, or web service.",
  mobile_app: "Mobile app project for Android, iOS, or cross-platform work.",
  backend: "API, database, worker, or infrastructure project.",
  desktop_app: "Desktop application or local operator project.",
  ai_project: "AI-assisted product, model workflow, or automation system.",
  documentation: "Docs, research, writing, or knowledge-base project.",
  business: "Business planning, operations, or non-code workspace.",
  other: "Anything that does not fit the common project types."
};

export function ProjectsScreen({ settings }: { settings: AppSettings }) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [commands, setCommands] = useState<CommandTemplateRecord[]>([]);
  const [processes, setProcesses] = useState<BackgroundProcessRecord[]>([]);
  const [status, setStatus] = useState<ProjectStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<ActionPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [workflowPreview, setWorkflowPreview] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    name: "",
    description: "",
    repo_path: "",
    primary_stack: "",
    project_type: "web_app" as ProjectType,
    status: "active" as ProjectStatus,
    default_branch: "",
    dev_url: "",
    production_url: "",
    notes: "",
    startup_workflow_id: ""
  });

  const workflowName = useMemo(() => {
    return new Map(workflows.map((workflow) => [workflow.id, workflow.name]));
  }, [workflows]);

  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    return projects.filter((project) => {
      const matchesStatus = status === "all" || project.status === status;

      if (!matchesStatus) return false;
      if (!normalized) return true;

      return [
        project.name,
        project.description,
        project.repo_path,
        project.primary_stack,
        project.project_type,
        project.status,
        project.default_branch,
        project.dev_url,
        project.production_url,
        project.notes
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [projects, query, status]);

  const activeProjects = useMemo(() => {
    return projects.filter((project) => project.status === "active").length;
  }, [projects]);

  const linkedStartupWorkflows = useMemo(() => {
    return projects.filter((project) => Boolean(project.startup_workflow_id)).length;
  }, [projects]);

  const runningProcesses = useMemo(() => {
    return processes.filter((process) => ["starting", "running"].includes(process.status)).length;
  }, [processes]);

  async function refresh() {
    const [nextProjects, nextWorkflows, nextCommands, nextProcesses] = await Promise.all([
      listProjects({}),
      listWorkflows(),
      listCommandTemplates(),
      listBackgroundProcesses()
    ]);

    setProjects(nextProjects);
    setWorkflows(nextWorkflows);
    setCommands(nextCommands);
    setProcesses(nextProcesses);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function create() {
    setMessage(null);

    if (!draft.name.trim()) {
      setMessage("Add a project name before saving.");
      return;
    }

    await createProject({
      ...draft,
      name: draft.name.trim(),
      description: emptyToNull(draft.description),
      repo_path: emptyToNull(draft.repo_path),
      primary_stack: emptyToNull(draft.primary_stack),
      default_branch: emptyToNull(draft.default_branch),
      dev_url: emptyToNull(draft.dev_url),
      production_url: emptyToNull(draft.production_url),
      notes: emptyToNull(draft.notes),
      startup_workflow_id: emptyToNull(draft.startup_workflow_id)
    });

    setDraft({
      ...draft,
      name: "",
      description: "",
      repo_path: "",
      primary_stack: "",
      default_branch: "",
      dev_url: "",
      production_url: "",
      notes: "",
      startup_workflow_id: ""
    });

    await refresh();
    setMessage("Project saved locally.");
  }

  async function proposeOpenFolder(project: ProjectRecord) {
    setMessage(null);

    if (!project.repo_path) {
      setMessage("Add a local folder before opening this project.");
      return;
    }

    const nextPreview = await buildActionPreviewForSuggestion(
      { toolName: "open_folder", input: { path: project.repo_path } },
      settings
    );

    if (nextPreview) setPreview(nextPreview);
  }

  async function proposeProjectNote(project: ProjectRecord) {
    setMessage(null);

    if (!project.repo_path) {
      setMessage("Add a local folder before creating a project note.");
      return;
    }

    const nextPreview = await buildActionPreviewForSuggestion(
      {
        toolName: "create_note",
        input: {
          destinationFolder: project.repo_path,
          title: `${project.name} note`,
          content: project.notes || `Notes for ${project.name}`
        }
      },
      settings
    );

    if (nextPreview) setPreview(nextPreview);
  }

  async function previewStartup(project: ProjectRecord) {
    setMessage(null);
    setWorkflowPreview(null);

    if (!project.startup_workflow_id) {
      setMessage("Link a startup workflow first.");
      return;
    }

    try {
      const result = await previewWorkflow(project.startup_workflow_id, settings);
      setWorkflowPreview(formatWorkflowPreview(result.steps));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function runStartup(project: ProjectRecord) {
    setMessage(null);
    setWorkflowPreview(null);

    if (!project.startup_workflow_id) {
      setMessage("Link a startup workflow first.");
      return;
    }

    try {
      const result = await previewWorkflow(project.startup_workflow_id, settings);
      setWorkflowPreview(formatWorkflowPreview(result.steps));

      await runWorkflow(project.startup_workflow_id, settings);
      setMessage("Startup workflow completed.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function createBuildCommand(project: ProjectRecord) {
    setMessage(null);

    if (!project.repo_path) {
      setMessage("Add a repository path before creating a project command.");
      return;
    }

    try {
      await createCommandTemplate({
        project_id: project.id,
        name: `${project.name} build`,
        command: "npm run build",
        working_directory: project.repo_path,
        command_type: "npm",
        risk_level: "medium",
        description: `Build ${project.name}`
      });

      setMessage("Build command saved for this project.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function runCommand(command: CommandTemplateRecord) {
    setMessage(null);

    const nextPreview = await buildActionPreviewForSuggestion(
      {
        toolName: command.is_long_running ? "start_background_process" : "run_command_template",
        input: { command_template_id: command.id }
      },
      settings
    );

    if (nextPreview) setPreview(nextPreview);
  }

  async function stopProjectProcess(process: BackgroundProcessRecord) {
    const status = await invoke<{ status: string; exit_code: number | null }>("stop_background_process", {
      input: { process_id: process.id }
    });

    await markProcessStopped(process.id, {
      status: status.status as BackgroundProcessRecord["status"],
      exit_code: status.exit_code,
      last_output_preview: "Stop requested from project screen."
    });

    await refresh();
  }

  return (
    <div className="screen projects-screen">
      <ScreenHeader
        title="Projects"
        subtitle="Keep local project context, folders, workflows, and approved actions in one controlled workspace."
      />

      <section className="projects-hero">
        <div>
          <span className="eyebrow">Workspace registry</span>
          <h3>Organize the things Klak is allowed to help with.</h3>
          <p>
            A project can store local context, a folder, notes, and an optional startup workflow.
            Actions still require preview and approval.
          </p>
        </div>

        <div className="projects-hero-card">
          <strong>Safe by design</strong>
          <span>No automatic terminal execution. No hidden folder access. No browser or screen control.</span>
        </div>
      </section>

      <section className="project-overview">
        <div className="project-stat-card">
          <span>Total projects</span>
          <strong>{projects.length}</strong>
          <small>Saved locally</small>
        </div>

        <div className="project-stat-card">
          <span>Active</span>
          <strong>{activeProjects}</strong>
          <small>Ready for normal work</small>
        </div>

        <div className="project-stat-card">
          <span>Startup workflows</span>
          <strong>{linkedStartupWorkflows}</strong>
          <small>Only run after approval</small>
        </div>

        <div className="project-stat-card">
          <span>Running activities</span>
          <strong>{runningProcesses}</strong>
          <small>Visible background work</small>
        </div>
      </section>

      <section className="project-controls">
        <div className="project-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects, folders, stacks, or notes"
          />
        </div>

        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as ProjectStatus | "all")}
          aria-label="Filter projects"
        >
          {statuses.map((item) => (
            <option key={item} value={item}>
              {formatProjectStatus(item)}
            </option>
          ))}
        </select>
      </section>

      {(message || workflowPreview || preview) && (
        <section className="project-feedback-panel">
          {message && <p className="warning">{message}</p>}

          {workflowPreview && (
            <div className="project-workflow-preview">
              <div>
                <strong>Startup workflow preview</strong>
                <span>Review the planned steps before running anything.</span>
              </div>
              <pre className="preview-text">{workflowPreview}</pre>
            </div>
          )}

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
        </section>
      )}

      <div className="projects-layout">
        <section className="project-create-card">
          <div>
            <span className="eyebrow">New project</span>
            <h3>Add a workspace</h3>
            <p className="muted">
              Start with the name. Add folder, stack, notes, and workflow only when useful.
            </p>
          </div>

          <label className="field-stack">
            <span>Project name</span>
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder="Example: Klak desktop operator"
            />
          </label>

          <label className="field-stack">
            <span>Description</span>
            <textarea
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              placeholder="What is this project for?"
            />
          </label>

          <div className="project-create-grid">
            <label className="field-stack">
              <span>Type</span>
              <select
                value={draft.project_type}
                onChange={(event) =>
                  setDraft({ ...draft, project_type: event.target.value as ProjectType })
                }
              >
                {projectTypes.map((type) => (
                  <option key={type} value={type}>
                    {formatProjectType(type)}
                  </option>
                ))}
              </select>
              <small>{projectTypeDescriptions[draft.project_type]}</small>
            </label>

            <label className="field-stack">
              <span>Status</span>
              <select
                value={draft.status}
                onChange={(event) =>
                  setDraft({ ...draft, status: event.target.value as ProjectStatus })
                }
              >
                {statuses
                  .filter((item) => item !== "all")
                  .map((item) => (
                    <option key={item} value={item}>
                      {formatProjectStatus(item)}
                    </option>
                  ))}
              </select>
            </label>
          </div>

          <label className="field-stack">
            <span>Local folder</span>
            <input
              value={draft.repo_path}
              onChange={(event) => setDraft({ ...draft, repo_path: event.target.value })}
              placeholder="C:\\Users\\silvance\\Documents\\project"
            />
          </label>

          <div className="project-create-grid">
            <label className="field-stack">
              <span>Primary stack</span>
              <input
                value={draft.primary_stack}
                onChange={(event) => setDraft({ ...draft, primary_stack: event.target.value })}
                placeholder="React, Tauri, Rust"
              />
            </label>

            <label className="field-stack">
              <span>Default branch</span>
              <input
                value={draft.default_branch}
                onChange={(event) => setDraft({ ...draft, default_branch: event.target.value })}
                placeholder="main"
              />
            </label>
          </div>

          <label className="field-stack">
            <span>Startup workflow</span>
            <select
              value={draft.startup_workflow_id}
              onChange={(event) => setDraft({ ...draft, startup_workflow_id: event.target.value })}
            >
              <option value="">No startup workflow</option>
              {workflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field-stack">
            <span>Notes</span>
            <textarea
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              placeholder="Important local context for this project"
            />
          </label>

          <button className="primary" onClick={create}>
            <Plus size={16} /> Save project
          </button>
        </section>

        <section className="project-list-panel">
          <div className="project-list-header">
            <div>
              <h3>Saved projects</h3>
              <p className="muted">
                {filteredProjects.length} visible{" "}
                {filteredProjects.length === 1 ? "project" : "projects"}
              </p>
            </div>
          </div>

          {filteredProjects.length === 0 ? (
            <div className="project-empty-state">
              <strong>No projects found</strong>
              <p>Create a project, change the status filter, or clear your search.</p>
            </div>
          ) : (
            <div className="project-card-list">
              {filteredProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  workflows={workflows}
                  commands={commands.filter((command) => command.project_id === project.id)}
                  processes={processes.filter(
                    (process) =>
                      process.project_id === project.id &&
                      ["starting", "running"].includes(process.status)
                  )}
                  workflowName={workflowName}
                  onRefresh={refresh}
                  onOpenFolder={proposeOpenFolder}
                  onCreateNote={proposeProjectNote}
                  onPreviewStartup={previewStartup}
                  onRunStartup={runStartup}
                  onCreateBuildCommand={createBuildCommand}
                  onRunCommand={runCommand}
                  onStopProcess={stopProjectProcess}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ProjectCard({
  project,
  workflows,
  commands,
  processes,
  workflowName,
  onRefresh,
  onOpenFolder,
  onCreateNote,
  onPreviewStartup,
  onRunStartup,
  onCreateBuildCommand,
  onRunCommand,
  onStopProcess
}: {
  project: ProjectRecord;
  workflows: WorkflowRecord[];
  commands: CommandTemplateRecord[];
  processes: BackgroundProcessRecord[];
  workflowName: Map<string, string>;
  onRefresh: () => Promise<void>;
  onOpenFolder: (project: ProjectRecord) => Promise<void>;
  onCreateNote: (project: ProjectRecord) => Promise<void>;
  onPreviewStartup: (project: ProjectRecord) => Promise<void>;
  onRunStartup: (project: ProjectRecord) => Promise<void>;
  onCreateBuildCommand: (project: ProjectRecord) => Promise<void>;
  onRunCommand: (command: CommandTemplateRecord) => Promise<void>;
  onStopProcess: (process: BackgroundProcessRecord) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({
    name: project.name,
    description: project.description ?? "",
    repo_path: project.repo_path ?? "",
    primary_stack: project.primary_stack ?? "",
    project_type: project.project_type,
    status: project.status,
    default_branch: project.default_branch ?? "",
    dev_url: project.dev_url ?? "",
    production_url: project.production_url ?? "",
    notes: project.notes ?? "",
    startup_workflow_id: project.startup_workflow_id ?? ""
  });

  function resetEditDraft() {
    setEditDraft({
      name: project.name,
      description: project.description ?? "",
      repo_path: project.repo_path ?? "",
      primary_stack: project.primary_stack ?? "",
      project_type: project.project_type,
      status: project.status,
      default_branch: project.default_branch ?? "",
      dev_url: project.dev_url ?? "",
      production_url: project.production_url ?? "",
      notes: project.notes ?? "",
      startup_workflow_id: project.startup_workflow_id ?? ""
    });
  }

  async function saveProject() {
    setMessage(null);

    if (!editDraft.name.trim()) {
      setMessage("Project name cannot be empty.");
      return;
    }

    await updateProject(project.id, {
      name: editDraft.name.trim(),
      description: emptyToNull(editDraft.description),
      repo_path: emptyToNull(editDraft.repo_path),
      primary_stack: emptyToNull(editDraft.primary_stack),
      project_type: editDraft.project_type,
      status: editDraft.status,
      default_branch: emptyToNull(editDraft.default_branch),
      dev_url: emptyToNull(editDraft.dev_url),
      production_url: emptyToNull(editDraft.production_url),
      notes: emptyToNull(editDraft.notes),
      startup_workflow_id: emptyToNull(editDraft.startup_workflow_id)
    });

    setEditing(false);
    await onRefresh();
  }

  async function removeProject() {
    const confirmed = window.confirm(
      `Delete "${project.name}"? This removes the local project record, not the project folder.`
    );

    if (!confirmed) return;

    await deleteProject(project.id);
    await onRefresh();
  }

  return (
    <article className="project-card">
      <div className="project-card-header">
        <div className="project-title-area">
          <div className="project-badge-row">
            <span className="tag">{formatProjectType(project.project_type)}</span>
            <span className={`project-status project-status-${project.status}`}>
              {formatProjectStatus(project.status)}
            </span>
          </div>

          <h4>{project.name}</h4>

          <p>
            {project.description?.trim()
              ? project.description
              : "No description yet. Add a short note so Klak knows what this workspace is for."}
          </p>
        </div>

        <div className="project-card-actions">
          <button
            onClick={() => {
              setShowDetails((value) => !value);
              setMessage(null);
            }}
          >
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

          <button title="Delete project" className="danger-button" onClick={removeProject}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="project-summary-grid">
        <div>
          <span>Folder</span>
          <strong>{project.repo_path ? "Linked" : "Not set"}</strong>
        </div>

        <div>
          <span>Stack</span>
          <strong>{project.primary_stack || "Not set"}</strong>
        </div>

        <div>
          <span>Startup</span>
          <strong>
            {project.startup_workflow_id
              ? workflowName.get(project.startup_workflow_id) ?? "Linked workflow"
              : "None"}
          </strong>
        </div>
      </div>

      <div className="project-action-row">
        <button disabled={!project.repo_path} onClick={() => onOpenFolder(project)}>
          <FolderOpen size={16} /> Open folder
        </button>

        <button disabled={!project.repo_path} onClick={() => onCreateNote(project)}>
          <FilePlus size={16} /> Create note
        </button>

        <button disabled={!project.startup_workflow_id} onClick={() => onPreviewStartup(project)}>
          <ClipboardList size={16} /> Preview startup
        </button>

        <button className="primary" disabled={!project.startup_workflow_id} onClick={() => onRunStartup(project)}>
          <Play size={16} /> Run startup
        </button>
      </div>

      {commands.length > 0 && (
        <div className="project-linked-section">
          <div>
            <strong>Saved actions</strong>
            <span>These still open an approval preview before running.</span>
          </div>

          <div className="mini-list">
            {commands.map((command) => (
              <button
                key={command.id}
                title={`Run ${command.name}`}
                disabled={!command.enabled}
                onClick={() => onRunCommand(command)}
              >
                {command.is_long_running ? `Start ${command.name}` : command.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {processes.length > 0 && (
        <div className="project-linked-section project-process-section">
          <div>
            <strong>Running activities</strong>
            <span>Visible background work linked to this project.</span>
          </div>

          <div className="mini-list">
            {processes.map((process) => (
              <button key={process.id} onClick={() => onStopProcess(process)}>
                <Square size={14} /> Stop {process.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {showDetails && (
        <div className="project-details">
          <div>
            <span className="detail-label">Local folder</span>
            <code>{project.repo_path || "Not set"}</code>
          </div>

          <div>
            <span className="detail-label">Default branch</span>
            <strong>{project.default_branch || "Not set"}</strong>
          </div>

          <div>
            <span className="detail-label">Development URL</span>
            <strong>{project.dev_url || "Not set"}</strong>
          </div>

          <div>
            <span className="detail-label">Production URL</span>
            <strong>{project.production_url || "Not set"}</strong>
          </div>

          <div>
            <span className="detail-label">Updated</span>
            <strong>{formatDate(project.updated_at)}</strong>
          </div>

          <div>
            <span className="detail-label">Notes</span>
            <p>{project.notes || "No notes yet."}</p>
          </div>

          <button onClick={() => touchProject(project.id).then(onRefresh)}>
            <FolderOpen size={16} /> Mark as opened
          </button>

          <button onClick={() => onCreateBuildCommand(project)}>
            <Plus size={16} /> Add npm build action
          </button>
        </div>
      )}

      {editing && (
        <div className="project-edit-form">
          <label className="field-stack">
            <span>Project name</span>
            <input
              value={editDraft.name}
              onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value })}
            />
          </label>

          <label className="field-stack">
            <span>Description</span>
            <textarea
              value={editDraft.description}
              onChange={(event) => setEditDraft({ ...editDraft, description: event.target.value })}
            />
          </label>

          <div className="project-create-grid">
            <label className="field-stack">
              <span>Type</span>
              <select
                value={editDraft.project_type}
                onChange={(event) =>
                  setEditDraft({ ...editDraft, project_type: event.target.value as ProjectType })
                }
              >
                {projectTypes.map((type) => (
                  <option key={type} value={type}>
                    {formatProjectType(type)}
                  </option>
                ))}
              </select>
            </label>

            <label className="field-stack">
              <span>Status</span>
              <select
                value={editDraft.status}
                onChange={(event) =>
                  setEditDraft({ ...editDraft, status: event.target.value as ProjectStatus })
                }
              >
                {statuses
                  .filter((item) => item !== "all")
                  .map((item) => (
                    <option key={item} value={item}>
                      {formatProjectStatus(item)}
                    </option>
                  ))}
              </select>
            </label>
          </div>

          <label className="field-stack">
            <span>Local folder</span>
            <input
              value={editDraft.repo_path}
              onChange={(event) => setEditDraft({ ...editDraft, repo_path: event.target.value })}
            />
          </label>

          <div className="project-create-grid">
            <label className="field-stack">
              <span>Primary stack</span>
              <input
                value={editDraft.primary_stack}
                onChange={(event) => setEditDraft({ ...editDraft, primary_stack: event.target.value })}
              />
            </label>

            <label className="field-stack">
              <span>Default branch</span>
              <input
                value={editDraft.default_branch}
                onChange={(event) => setEditDraft({ ...editDraft, default_branch: event.target.value })}
              />
            </label>
          </div>

          <div className="project-create-grid">
            <label className="field-stack">
              <span>Development URL</span>
              <input
                value={editDraft.dev_url}
                onChange={(event) => setEditDraft({ ...editDraft, dev_url: event.target.value })}
              />
            </label>

            <label className="field-stack">
              <span>Production URL</span>
              <input
                value={editDraft.production_url}
                onChange={(event) => setEditDraft({ ...editDraft, production_url: event.target.value })}
              />
            </label>
          </div>

          <label className="field-stack">
            <span>Startup workflow</span>
            <select
              value={editDraft.startup_workflow_id}
              onChange={(event) =>
                setEditDraft({ ...editDraft, startup_workflow_id: event.target.value })
              }
            >
              <option value="">No startup workflow</option>
              {workflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field-stack">
            <span>Notes</span>
            <textarea
              value={editDraft.notes}
              onChange={(event) => setEditDraft({ ...editDraft, notes: event.target.value })}
            />
          </label>

          <button className="primary" onClick={saveProject}>
            <Save size={16} /> Save changes
          </button>

          {message && <p className="inline-status">{message}</p>}
        </div>
      )}
    </article>
  );
}

function formatWorkflowPreview(
  steps: Array<{
    step: { label?: string | null; input: Record<string, unknown> };
    preview?: { message: string } | null;
    blockedReason?: string | null;
  }>
): string {
  return steps
    .map((item, index) => {
      const label = item.step.label ? `${item.step.label}: ` : "";
      const fallback =
        typeof item.step.input.text === "string" ? item.step.input.text : "Manual instruction";
      const status = item.preview ? item.preview.message : fallback;

      return `${index + 1}. ${label}${status}${item.blockedReason ? ` (${item.blockedReason})` : ""}`;
    })
    .join("\n");
}

function formatProjectType(type: ProjectType): string {
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatProjectStatus(status: ProjectStatus | "all"): string {
  if (status === "all") return "All projects";

  return status.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Unknown";

  return date.toLocaleString();
}

function emptyToNull(value: string): string | null {
  return value.trim() ? value.trim() : null;
}