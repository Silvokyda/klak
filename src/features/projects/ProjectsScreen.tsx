import { ClipboardList, FilePlus, FolderOpen, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ActionPreviewCard } from "../../components/ActionPreviewCard";
import { ScreenHeader } from "../../components/ScreenHeader";
import type { ActionPreview, AppSettings, ProjectRecord, ProjectStatus, ProjectType, WorkflowRecord } from "../../types";
import { buildActionPreviewForSuggestion } from "../../lib/tools/toolProposals";
import { createProject, deleteProject, listProjects, touchProject, updateProject } from "../../lib/projects/projectRepository";
import { listWorkflows, previewWorkflow, runWorkflow } from "../../lib/workflows/workflowRepository";

const projectTypes: ProjectType[] = ["web_app", "mobile_app", "backend", "desktop_app", "ai_project", "documentation", "business", "other"];
const statuses: Array<ProjectStatus | "all"> = ["all", "active", "paused", "archived"];

export function ProjectsScreen({ settings }: { settings: AppSettings }) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [status, setStatus] = useState<ProjectStatus | "all">("all");
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

  const workflowName = useMemo(() => new Map(workflows.map((workflow) => [workflow.id, workflow.name])), [workflows]);

  async function refresh() {
    const [nextProjects, nextWorkflows] = await Promise.all([
      listProjects(status === "all" ? {} : { status }),
      listWorkflows()
    ]);
    setProjects(nextProjects);
    setWorkflows(nextWorkflows);
  }

  useEffect(() => {
    void refresh();
  }, [status]);

  async function create() {
    if (!draft.name.trim()) return;
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
    setDraft({ ...draft, name: "", description: "", repo_path: "", primary_stack: "", default_branch: "", dev_url: "", production_url: "", notes: "", startup_workflow_id: "" });
    await refresh();
  }

  async function proposeOpenFolder(project: ProjectRecord) {
    const nextPreview = await buildActionPreviewForSuggestion({ toolName: "open_folder", input: { path: project.repo_path } }, settings);
    if (nextPreview) setPreview(nextPreview);
  }

  async function proposeProjectNote(project: ProjectRecord) {
    const nextPreview = await buildActionPreviewForSuggestion({
      toolName: "create_note",
      input: {
        destinationFolder: project.repo_path,
        title: `${project.name} note`,
        content: project.notes || `Notes for ${project.name}`
      }
    }, settings);
    if (nextPreview) setPreview(nextPreview);
  }

  async function previewStartup(project: ProjectRecord) {
    setMessage(null);
    if (!project.startup_workflow_id) {
      setMessage("Link a startup workflow first.");
      return;
    }
    try {
      const result = await previewWorkflow(project.startup_workflow_id, settings);
      setWorkflowPreview(result.steps.map((item, index) => {
        const label = item.step.label ? `${item.step.label}: ` : "";
        const status = item.preview ? item.preview.message : String(item.step.input.text ?? "Manual instruction");
        return `${index + 1}. ${label}${status}${item.blockedReason ? ` (${item.blockedReason})` : ""}`;
      }).join("\n"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function runStartup(project: ProjectRecord) {
    setMessage(null);
    if (!project.startup_workflow_id) {
      setMessage("Link a startup workflow first.");
      return;
    }
    try {
      await previewStartup(project);
      await runWorkflow(project.startup_workflow_id, settings);
      setMessage("Startup workflow completed.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="screen">
      <ScreenHeader title="Projects" subtitle="Project memory lives locally and can link an explicit startup workflow." />
      <section className="toolbar">
        <select value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus | "all")}>
          {statuses.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </section>
      <section className="editor project-editor">
        <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Project name" />
        <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Description" />
        <div className="form-grid">
          <input value={draft.repo_path} onChange={(event) => setDraft({ ...draft, repo_path: event.target.value })} placeholder="Repository path" />
          <input value={draft.primary_stack} onChange={(event) => setDraft({ ...draft, primary_stack: event.target.value })} placeholder="Primary stack" />
          <select value={draft.project_type} onChange={(event) => setDraft({ ...draft, project_type: event.target.value as ProjectType })}>
            {projectTypes.map((type) => <option key={type} value={type}>{type.replace(/_/g, " ")}</option>)}
          </select>
          <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as ProjectStatus })}>
            {statuses.filter((item) => item !== "all").map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <input value={draft.default_branch} onChange={(event) => setDraft({ ...draft, default_branch: event.target.value })} placeholder="Default branch" />
          <input value={draft.dev_url} onChange={(event) => setDraft({ ...draft, dev_url: event.target.value })} placeholder="Development URL" />
          <select value={draft.startup_workflow_id} onChange={(event) => setDraft({ ...draft, startup_workflow_id: event.target.value })}>
            <option value="">No startup workflow</option>
            {workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}
          </select>
        </div>
        <textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Notes" />
        <button className="primary" onClick={create}><Plus size={16} /> Create project</button>
      </section>
      {message && <p className="warning">{message}</p>}
      {workflowPreview && <pre className="preview-text">{workflowPreview}</pre>}
      {preview && <ActionPreviewCard preview={preview} settings={settings} onDone={() => setPreview(null)} />}
      <section className="list">
        {projects.map((project) => (
          <article className="list-row project-row" key={project.id}>
            <div>
              <div className="row between">
                <span className="tag">{project.project_type.replace(/_/g, " ")}</span>
                <span className="status-badge">{project.status}</span>
              </div>
              <input value={project.name} onChange={(event) => updateProject(project.id, { name: event.target.value }).then(refresh)} />
              <textarea value={project.description ?? ""} onChange={(event) => updateProject(project.id, { description: event.target.value }).then(refresh)} />
              <div className="form-grid">
                <input value={project.repo_path ?? ""} onChange={(event) => updateProject(project.id, { repo_path: event.target.value }).then(refresh)} placeholder="Repository path" />
                <input value={project.primary_stack ?? ""} onChange={(event) => updateProject(project.id, { primary_stack: event.target.value }).then(refresh)} placeholder="Primary stack" />
                <input value={project.dev_url ?? ""} onChange={(event) => updateProject(project.id, { dev_url: event.target.value }).then(refresh)} placeholder="Development URL" />
                <select value={project.startup_workflow_id ?? ""} onChange={(event) => updateProject(project.id, { startup_workflow_id: emptyToNull(event.target.value) }).then(refresh)}>
                  <option value="">No startup workflow</option>
                  {workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}
                </select>
                <input value={project.notes ?? ""} onChange={(event) => updateProject(project.id, { notes: event.target.value }).then(refresh)} placeholder="Notes" />
              </div>
              <small>Startup workflow: {project.startup_workflow_id ? workflowName.get(project.startup_workflow_id) ?? "linked workflow" : "none"}</small>
              <small>Updated {new Date(project.updated_at).toLocaleString()}</small>
            </div>
            <div className="row-actions">
              <button title="Mark opened" onClick={() => touchProject(project.id).then(refresh)}><FolderOpen size={16} /></button>
              <button title="Open project folder" onClick={() => proposeOpenFolder(project)}><FolderOpen size={16} /></button>
              <button title="Create project note" onClick={() => proposeProjectNote(project)}><FilePlus size={16} /></button>
              <button title="Preview startup workflow" onClick={() => previewStartup(project)}><ClipboardList size={16} /></button>
              <button title="Run startup workflow" onClick={() => runStartup(project)}><Play size={16} /></button>
              <button title="Delete project" onClick={() => deleteProject(project.id).then(refresh)}><Trash2 size={16} /></button>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function emptyToNull(value: string): string | null {
  return value.trim() ? value.trim() : null;
}
