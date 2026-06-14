import { FolderOpen, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ScreenHeader } from "../../components/ScreenHeader";
import type { ProjectRecord, ProjectStatus, ProjectType } from "../../types";
import { createProject, deleteProject, listProjects, touchProject, updateProject } from "../../lib/projects/projectRepository";

const projectTypes: ProjectType[] = ["web_app", "mobile_app", "backend", "desktop_app", "ai_project", "documentation", "business", "other"];
const statuses: Array<ProjectStatus | "all"> = ["all", "active", "paused", "archived"];

export function ProjectsScreen() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [status, setStatus] = useState<ProjectStatus | "all">("all");
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
    notes: ""
  });

  async function refresh() {
    setProjects(await listProjects(status === "all" ? {} : { status }));
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
      notes: emptyToNull(draft.notes)
    });
    setDraft({ ...draft, name: "", description: "", repo_path: "", primary_stack: "", default_branch: "", dev_url: "", production_url: "", notes: "" });
    await refresh();
  }

  return (
    <div className="screen">
      <ScreenHeader title="Projects" subtitle="Project memory lives locally and gives Klak stable context about your work." />
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
          <input value={draft.production_url} onChange={(event) => setDraft({ ...draft, production_url: event.target.value })} placeholder="Production URL" />
        </div>
        <textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Notes" />
        <button className="primary" onClick={create}><Plus size={16} /> Create project</button>
      </section>
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
                <input value={project.notes ?? ""} onChange={(event) => updateProject(project.id, { notes: event.target.value }).then(refresh)} placeholder="Notes" />
              </div>
              <small>Updated {new Date(project.updated_at).toLocaleString()}</small>
            </div>
            <div className="row-actions">
              <button title="Mark opened" onClick={() => touchProject(project.id).then(refresh)}><FolderOpen size={16} /></button>
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
