import { ClipboardList, Play, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ScreenHeader } from "../../components/ScreenHeader";
import type { AppSettings, ProjectRecord, WorkflowRecord, WorkflowStep } from "../../types";
import { listProjects } from "../../lib/projects/projectRepository";
import { createWorkflow, deleteWorkflow, listWorkflows, parseWorkflowSteps, previewWorkflow, runWorkflow, updateWorkflow } from "../../lib/workflows/workflowRepository";

const templateSteps: WorkflowStep[] = [
  { type: "search_memory", label: "Search related memory", input: { query: "project status" } },
  { type: "manual_instruction", label: "Review next steps", input: { text: "Read the project notes and choose the next action." } }
];

export function WorkflowsScreen({ settings }: { settings: AppSettings }) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [selectedProject, setSelectedProject] = useState("all");
  const [draft, setDraft] = useState({
    project_id: "",
    name: "",
    description: "",
    trigger_phrase: "",
    steps_json: JSON.stringify(templateSteps, null, 2),
    requires_confirmation: true
  });
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<string | null>(null);

  const projectName = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);

  async function refresh() {
    const projectFilter = selectedProject === "all" ? {} : { project_id: selectedProject };
    const [nextProjects, nextWorkflows] = await Promise.all([listProjects(), listWorkflows(projectFilter)]);
    setProjects(nextProjects);
    setWorkflows(nextWorkflows);
  }

  useEffect(() => {
    void refresh();
  }, [selectedProject]);

  async function create() {
    setRunMessage(null);
    const steps = parseStepsDraft(draft.steps_json);
    if (!draft.name.trim() || !steps) {
      setRunMessage("Workflow needs a name and valid JSON steps.");
      return;
    }
    await createWorkflow({
      project_id: draft.project_id || null,
      name: draft.name.trim(),
      description: emptyToNull(draft.description),
      trigger_phrase: emptyToNull(draft.trigger_phrase),
      steps,
      requires_confirmation: draft.requires_confirmation
    });
    setDraft({ ...draft, name: "", description: "", trigger_phrase: "" });
    await refresh();
  }

  async function preview(id: string) {
    try {
      const result = await previewWorkflow(id, settings);
      setPreviewText(result.steps.map((item, index) => {
        const label = item.step.label ? `${item.step.label}: ` : "";
        const status = item.preview ? item.preview.message : String(item.step.input.text ?? "Manual instruction");
        return `${index + 1}. ${label}${status}${item.blockedReason ? ` (${item.blockedReason})` : ""}`;
      }).join("\n"));
    } catch (error) {
      setPreviewText(error instanceof Error ? error.message : String(error));
    }
  }

  async function run(id: string) {
    setRunMessage("Running workflow...");
    try {
      await runWorkflow(id, settings);
      setRunMessage("Workflow completed.");
      await refresh();
    } catch (error) {
      setRunMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="screen">
      <ScreenHeader title="Workflows" subtitle="Compose repeatable local workflows from the safe tools Klak can already preview." />
      <section className="toolbar">
        <select value={selectedProject} onChange={(event) => setSelectedProject(event.target.value)}>
          <option value="all">all projects</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </section>
      <section className="editor">
        <div className="form-grid">
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Workflow name" />
          <input value={draft.trigger_phrase} onChange={(event) => setDraft({ ...draft, trigger_phrase: event.target.value })} placeholder="Trigger phrase" />
          <select value={draft.project_id} onChange={(event) => setDraft({ ...draft, project_id: event.target.value })}>
            <option value="">No project</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <label className="toggle">
            <input type="checkbox" checked={draft.requires_confirmation} onChange={(event) => setDraft({ ...draft, requires_confirmation: event.target.checked })} />
            Require confirmation
          </label>
        </div>
        <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Description" />
        <textarea className="code-input" value={draft.steps_json} onChange={(event) => setDraft({ ...draft, steps_json: event.target.value })} />
        <button className="primary" onClick={create}><Plus size={16} /> Create workflow</button>
      </section>
      {runMessage && <p className="warning">{runMessage}</p>}
      {previewText && <pre className="preview-text">{previewText}</pre>}
      <section className="list">
        {workflows.map((workflow) => (
          <article className="list-row workflow-row" key={workflow.id}>
            <div>
              <div className="row between">
                <span className={`risk risk-${workflow.risk_level}`}>{workflow.risk_level}</span>
                <span className="tag">{workflow.project_id ? projectName.get(workflow.project_id) ?? "project" : "global"}</span>
              </div>
              <input value={workflow.name} onChange={(event) => updateWorkflow(workflow.id, { name: event.target.value }).then(refresh)} />
              <textarea value={workflow.description ?? ""} onChange={(event) => updateWorkflow(workflow.id, { description: event.target.value }).then(refresh)} placeholder="Description" />
              <input value={workflow.trigger_phrase ?? ""} onChange={(event) => updateWorkflow(workflow.id, { trigger_phrase: event.target.value }).then(refresh)} placeholder="Trigger phrase" />
              <textarea
                className="code-input"
                value={JSON.stringify(parseWorkflowSteps(workflow), null, 2)}
                onChange={(event) => {
                  const steps = parseStepsDraft(event.target.value);
                  if (steps) void updateWorkflow(workflow.id, { steps }).then(refresh);
                }}
              />
              <small>Runs: {workflow.run_count} {workflow.last_run_at ? `Last run ${new Date(workflow.last_run_at).toLocaleString()}` : ""}</small>
            </div>
            <div className="row-actions">
              <button title="Preview workflow" onClick={() => preview(workflow.id)}><ClipboardList size={16} /></button>
              <button title="Run workflow" onClick={() => run(workflow.id)}><Play size={16} /></button>
              <button title="Confirmation required" disabled><ShieldCheck size={16} /></button>
              <button title="Delete workflow" onClick={() => deleteWorkflow(workflow.id).then(refresh)}><Trash2 size={16} /></button>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function parseStepsDraft(value: string): WorkflowStep[] | null {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function emptyToNull(value: string): string | null {
  return value.trim() ? value.trim() : null;
}
