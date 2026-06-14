import { ArrowDown, ArrowUp, ClipboardList, Play, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ScreenHeader } from "../../components/ScreenHeader";
import type { AllowedFolder, AppSettings, CommandTemplateRecord, ProjectRecord, RegisteredAppRecord, WorkflowRecord, WorkflowStep, WorkflowStepType } from "../../types";
import { listRegisteredApps } from "../../lib/apps/registeredAppsRepository";
import { listCommandTemplates } from "../../lib/commands/commandTemplateRepository";
import { listProjects } from "../../lib/projects/projectRepository";
import { listAllowedFolders } from "../../lib/storage/allowedFoldersRepository";
import { createWorkflow, deleteWorkflow, listWorkflows, parseWorkflowSteps, previewWorkflow, runWorkflow, updateWorkflow, validateWorkflowSteps } from "../../lib/workflows/workflowRepository";

const supportedStepTypes: WorkflowStepType[] = ["open_url", "open_folder", "launch_app", "run_command_template", "start_background_process", "create_note", "copy_to_clipboard", "search_memory", "create_memory", "manual_instruction"];

const templateSteps: WorkflowStep[] = [
  { type: "search_memory", label: "Search related memory", input: { query: "project status" } },
  { type: "manual_instruction", label: "Review next steps", input: { text: "Read the project notes and choose the next action." } }
];

export function WorkflowsScreen({ settings }: { settings: AppSettings }) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [folders, setFolders] = useState<AllowedFolder[]>([]);
  const [apps, setApps] = useState<RegisteredAppRecord[]>([]);
  const [commands, setCommands] = useState<CommandTemplateRecord[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [selectedProject, setSelectedProject] = useState("all");
  const [draft, setDraft] = useState({
    project_id: "",
    name: "",
    description: "",
    trigger_phrase: "",
    steps: templateSteps,
    steps_json: JSON.stringify(templateSteps, null, 2),
    requires_confirmation: true
  });
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState<string | null>(null);

  const projectName = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);

  async function refresh() {
    const projectFilter = selectedProject === "all" ? {} : { project_id: selectedProject };
    const [nextProjects, nextFolders, nextApps, nextCommands, nextWorkflows] = await Promise.all([
      listProjects(),
      listAllowedFolders(),
      listRegisteredApps({ allowed: true }),
      listCommandTemplates({ enabled: true }),
      listWorkflows(projectFilter)
    ]);
    setProjects(nextProjects);
    setFolders(nextFolders);
    setApps(nextApps);
    setCommands(nextCommands);
    setWorkflows(nextWorkflows);
  }

  useEffect(() => {
    void refresh();
  }, [selectedProject]);

  async function create() {
    setRunMessage(null);
    try {
      const steps = parseStepsDraft(draft.steps_json) ?? draft.steps;
      validateWorkflowSteps(steps);
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
    } catch (error) {
      setRunMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function setDraftSteps(steps: WorkflowStep[]) {
    setDraft({ ...draft, steps, steps_json: JSON.stringify(steps, null, 2) });
  }

  function setDraftJson(value: string) {
    const parsed = parseStepsDraft(value);
    setDraft({ ...draft, steps_json: value, steps: parsed ?? draft.steps });
  }

  function addStep() {
    setDraftSteps([...draft.steps, { type: "manual_instruction", label: "", input: { text: "" } }]);
  }

  function updateStep(index: number, patch: Partial<WorkflowStep>) {
    setDraftSteps(draft.steps.map((step, itemIndex) => itemIndex === index ? { ...step, ...patch } : step));
  }

  function updateStepInput(index: number, input: Record<string, unknown>) {
    setDraftSteps(draft.steps.map((step, itemIndex) => itemIndex === index ? { ...step, input: { ...step.input, ...input } } : step));
  }

  function moveStep(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= draft.steps.length) return;
    const next = [...draft.steps];
    const [step] = next.splice(index, 1);
    next.splice(nextIndex, 0, step);
    setDraftSteps(next);
  }

  function removeStep(index: number) {
    setDraftSteps(draft.steps.filter((_, itemIndex) => itemIndex !== index));
  }

  function previewDraft() {
    try {
      const steps = parseStepsDraft(draft.steps_json) ?? draft.steps;
      validateWorkflowSteps(steps);
      setPreviewText(steps.map((step, index) => `${index + 1}. ${step.label ? `${step.label}: ` : ""}${describeStep(step, apps)}`).join("\n"));
    } catch (error) {
      setPreviewText(error instanceof Error ? error.message : String(error));
    }
  }

  async function previewSaved(id: string) {
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
      await previewSaved(id);
      await runWorkflow(id, settings);
      setRunMessage("Workflow completed.");
      await refresh();
    } catch (error) {
      setRunMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="screen">
      <ScreenHeader title="Workflows" subtitle="Build repeatable local workflows from supported safe steps only." />
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
        <section className="step-builder">
          <div className="row between">
            <h3>Steps</h3>
            <button onClick={addStep} title="Add step"><Plus size={16} /> Step</button>
          </div>
          {draft.steps.map((step, index) => (
            <article className="step-card" key={`${index}-${step.type}`}>
              <div className="form-grid">
                <select value={step.type} onChange={(event) => updateStep(index, defaultStep(event.target.value as WorkflowStepType))}>
                  {supportedStepTypes.map((type) => <option key={type} value={type}>{type.replace(/_/g, " ")}</option>)}
                </select>
                <input value={step.label ?? ""} onChange={(event) => updateStep(index, { label: event.target.value })} placeholder="Label" />
                <span className={`risk risk-${stepRisk(step.type)}`}>{stepRisk(step.type)}</span>
              </div>
              <StepFields step={step} index={index} folders={folders} apps={apps} commands={commands} onInput={updateStepInput} />
              <div className="row">
                <button title="Move step up" disabled={index === 0} onClick={() => moveStep(index, -1)}><ArrowUp size={16} /></button>
                <button title="Move step down" disabled={index === draft.steps.length - 1} onClick={() => moveStep(index, 1)}><ArrowDown size={16} /></button>
                <button title="Remove step" onClick={() => removeStep(index)}><Trash2 size={16} /></button>
              </div>
            </article>
          ))}
        </section>
        <textarea className="code-input" value={draft.steps_json} onChange={(event) => setDraftJson(event.target.value)} />
        <div className="row">
          <button onClick={previewDraft}><ClipboardList size={16} /> Preview draft</button>
          <button className="primary" onClick={create}><Plus size={16} /> Create workflow</button>
        </div>
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
              <button title="Preview workflow" onClick={() => previewSaved(workflow.id)}><ClipboardList size={16} /></button>
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

function StepFields({ step, index, folders, apps, commands, onInput }: {
  step: WorkflowStep;
  index: number;
  folders: AllowedFolder[];
  apps: RegisteredAppRecord[];
  commands: CommandTemplateRecord[];
  onInput: (index: number, input: Record<string, unknown>) => void;
}) {
  if (step.type === "open_url") return <input value={String(step.input.url ?? "")} onChange={(event) => onInput(index, { url: event.target.value })} placeholder="https://example.com" />;
  if (step.type === "open_folder") return <FolderSelect value={String(step.input.path ?? "")} folders={folders} onChange={(path) => onInput(index, { path })} />;
  if (step.type === "launch_app") {
    return (
      <select value={String(step.input.registered_app_id ?? "")} onChange={(event) => onInput(index, { registered_app_id: event.target.value })}>
        <option value="">Select registered app</option>
        {apps.map((app) => <option key={app.id} value={app.id}>{app.name}</option>)}
      </select>
    );
  }
  if (step.type === "run_command_template") {
    return (
      <select value={String(step.input.command_template_id ?? "")} onChange={(event) => onInput(index, { command_template_id: event.target.value })}>
        <option value="">Select command template</option>
        {commands.map((command) => <option key={command.id} value={command.id}>{command.name}</option>)}
      </select>
    );
  }
  if (step.type === "start_background_process") {
    return (
      <select value={String(step.input.command_template_id ?? "")} onChange={(event) => onInput(index, { command_template_id: event.target.value })}>
        <option value="">Select long-running command template</option>
        {commands.filter((command) => command.is_long_running && command.allow_background_run).map((command) => <option key={command.id} value={command.id}>{command.name}</option>)}
      </select>
    );
  }
  if (step.type === "create_note") {
    return (
      <div className="form-grid">
        <FolderSelect value={String(step.input.destinationFolder ?? "")} folders={folders} onChange={(destinationFolder) => onInput(index, { destinationFolder })} />
        <input value={String(step.input.title ?? "")} onChange={(event) => onInput(index, { title: event.target.value })} placeholder="Note title" />
        <input value={String(step.input.content ?? "")} onChange={(event) => onInput(index, { content: event.target.value })} placeholder="Note content" />
      </div>
    );
  }
  if (step.type === "copy_to_clipboard") return <textarea value={String(step.input.text ?? "")} onChange={(event) => onInput(index, { text: event.target.value })} placeholder="Text to copy" />;
  if (step.type === "search_memory") return <input value={String(step.input.query ?? "")} onChange={(event) => onInput(index, { query: event.target.value })} placeholder="Memory query" />;
  if (step.type === "create_memory") {
    return (
      <div className="form-grid">
        <input value={String(step.input.title ?? "")} onChange={(event) => onInput(index, { title: event.target.value })} placeholder="Memory title" />
        <input value={String(step.input.content ?? "")} onChange={(event) => onInput(index, { content: event.target.value })} placeholder="Memory content" />
        <select value={String(step.input.type ?? "workflow")} onChange={(event) => onInput(index, { type: event.target.value })}>
          {["profile", "preference", "project", "workflow", "task", "document", "command_history"].map((type) => <option key={type} value={type}>{type.replace(/_/g, " ")}</option>)}
        </select>
      </div>
    );
  }
  return <textarea value={String(step.input.text ?? "")} onChange={(event) => onInput(index, { text: event.target.value })} placeholder="Manual instruction" />;
}

function FolderSelect({ value, folders, onChange }: { value: string; folders: AllowedFolder[]; onChange: (path: string) => void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Select allowed folder</option>
      {folders.map((folder) => <option key={folder.id} value={folder.path}>{folder.label ?? folder.path}</option>)}
    </select>
  );
}

function defaultStep(type: WorkflowStepType): WorkflowStep {
  if (type === "open_url") return { type, label: "", input: { url: "" } };
  if (type === "open_folder") return { type, label: "", input: { path: "" } };
  if (type === "launch_app") return { type, label: "", input: { registered_app_id: "" } };
  if (type === "run_command_template") return { type, label: "", input: { command_template_id: "" } };
  if (type === "start_background_process") return { type, label: "", input: { command_template_id: "" } };
  if (type === "create_note") return { type, label: "", input: { destinationFolder: "", title: "", content: "" } };
  if (type === "copy_to_clipboard") return { type, label: "", input: { text: "" } };
  if (type === "search_memory") return { type, label: "", input: { query: "" } };
  if (type === "create_memory") return { type, label: "", input: { type: "workflow", title: "", content: "", source: "workflow" } };
  return { type, label: "", input: { text: "" } };
}

function describeStep(step: WorkflowStep, apps: RegisteredAppRecord[]): string {
  if (step.type === "launch_app") return `launch ${apps.find((app) => app.id === step.input.registered_app_id)?.name ?? "registered app"}`;
  if (step.type === "run_command_template") return "run saved command template";
  if (step.type === "start_background_process") return "start saved background process";
  if (step.type === "manual_instruction") return String(step.input.text ?? "manual instruction");
  return `${step.type.replace(/_/g, " ")} ${JSON.stringify(step.input)}`;
}

function stepRisk(type: WorkflowStepType) {
  if (type === "run_command_template" || type === "start_background_process") return "high";
  return ["open_folder", "launch_app", "create_note", "copy_to_clipboard", "create_memory"].includes(type) ? "medium" : "low";
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
