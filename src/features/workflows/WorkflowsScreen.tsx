import {
  ArrowDown,
  ArrowUp,
  ClipboardList,
  Code2,
  Play,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Workflow
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ScreenHeader } from "../../components/ScreenHeader";
import type {
  AllowedFolder,
  AppSettings,
  CommandTemplateRecord,
  ProjectRecord,
  RegisteredAppRecord,
  WorkflowRecord,
  WorkflowStep,
  WorkflowStepType
} from "../../types";
import { listRegisteredApps } from "../../lib/apps/registeredAppsRepository";
import { listCommandTemplates } from "../../lib/commands/commandTemplateRepository";
import { listProjects } from "../../lib/projects/projectRepository";
import { listAllowedFolders } from "../../lib/storage/allowedFoldersRepository";
import {
  createWorkflow,
  deleteWorkflow,
  listWorkflows,
  parseWorkflowSteps,
  previewWorkflow,
  runWorkflow,
  updateWorkflow,
  validateWorkflowSteps
} from "../../lib/workflows/workflowRepository";

const supportedStepTypes: WorkflowStepType[] = [
  "open_url",
  "open_folder",
  "launch_app",
  "run_command_template",
  "start_background_process",
  "create_note",
  "copy_to_clipboard",
  "search_memory",
  "create_memory",
  "manual_instruction"
];

const templateSteps: WorkflowStep[] = [
  {
    type: "search_memory",
    label: "Search related memory",
    input: { query: "project status" }
  },
  {
    type: "manual_instruction",
    label: "Review next steps",
    input: { text: "Read the project notes and choose the next action." }
  }
];

export function WorkflowsScreen({ settings }: { settings: AppSettings }) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [folders, setFolders] = useState<AllowedFolder[]>([]);
  const [apps, setApps] = useState<RegisteredAppRecord[]>([]);
  const [commands, setCommands] = useState<CommandTemplateRecord[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [selectedProject, setSelectedProject] = useState("all");
  const [query, setQuery] = useState("");
  const [showDraftJson, setShowDraftJson] = useState(false);
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

  const projectName = useMemo(() => {
    return new Map(projects.map((project) => [project.id, project.name]));
  }, [projects]);

  const filteredWorkflows = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    if (!normalized) return workflows;

    return workflows.filter((workflow) => {
      const linkedProject = workflow.project_id ? projectName.get(workflow.project_id) : "global";

      return [
        workflow.name,
        workflow.description,
        workflow.trigger_phrase,
        workflow.risk_level,
        linkedProject
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [workflows, query, projectName]);

  const projectLinkedCount = useMemo(() => {
    return workflows.filter((workflow) => Boolean(workflow.project_id)).length;
  }, [workflows]);

  const confirmationCount = useMemo(() => {
    return workflows.filter((workflow) => workflow.requires_confirmation).length;
  }, [workflows]);

  const highRiskCount = useMemo(() => {
    return workflows.filter(
      (workflow) => workflow.risk_level === "high" || workflow.risk_level === "dangerous"
    ).length;
  }, [workflows]);

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

    if (!draft.name.trim()) {
      setRunMessage("Add a routine name before saving.");
      return;
    }

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

      setDraft({
        ...draft,
        name: "",
        description: "",
        trigger_phrase: "",
        steps: templateSteps,
        steps_json: JSON.stringify(templateSteps, null, 2)
      });

      await refresh();
      setRunMessage("Routine saved locally.");
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
    setDraftSteps([
      ...draft.steps,
      {
        type: "manual_instruction",
        label: "",
        input: { text: "" }
      }
    ]);
  }

  function updateStep(index: number, patch: Partial<WorkflowStep>) {
    setDraftSteps(
      draft.steps.map((step, itemIndex) => (itemIndex === index ? { ...step, ...patch } : step))
    );
  }

  function updateStepInput(index: number, input: Record<string, unknown>) {
    setDraftSteps(
      draft.steps.map((step, itemIndex) =>
        itemIndex === index ? { ...step, input: { ...step.input, ...input } } : step
      )
    );
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

      setPreviewText(
        steps
          .map((step, index) => {
            const label = step.label ? `${step.label}: ` : "";
            return `${index + 1}. ${label}${describeStep(step, apps)}`;
          })
          .join("\n")
      );
    } catch (error) {
      setPreviewText(error instanceof Error ? error.message : String(error));
    }
  }

  async function previewSaved(id: string) {
    try {
      const result = await previewWorkflow(id, settings);

      setPreviewText(
        result.steps
          .map((item, index) => {
            const label = item.step.label ? `${item.step.label}: ` : "";
            const status = item.preview
              ? item.preview.message
              : String(item.step.input.text ?? "Manual instruction");

            return `${index + 1}. ${label}${status}${
              item.blockedReason ? ` (${item.blockedReason})` : ""
            }`;
          })
          .join("\n")
      );
    } catch (error) {
      setPreviewText(error instanceof Error ? error.message : String(error));
    }
  }

  async function run(workflow: WorkflowRecord) {
    setRunMessage(null);

    const confirmed = window.confirm(
      `Run "${workflow.name}" now? Klak will preview the routine and only use supported local steps.`
    );

    if (!confirmed) return;

    setRunMessage("Running routine...");

    try {
      await previewSaved(workflow.id);
      await runWorkflow(workflow.id, settings);
      setRunMessage("Routine completed.");
      await refresh();
    } catch (error) {
      setRunMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="screen routines-screen">
      <ScreenHeader
        title="Routines"
        subtitle="Build repeatable local routines from supported steps only. Risky steps remain visible and confirmation-based."
      />

      <section className="routines-hero">
        <div>
          <span className="eyebrow">Routine builder</span>
          <h3>Turn repeated local work into controlled routines.</h3>
          <p>
            Routines can search memory, open approved apps, create notes, copy prepared text, or run
            saved actions. They do not add arbitrary terminal, browser, screen, or hidden control.
          </p>
        </div>

        <div className="routines-hero-card">
          <ShieldCheck size={20} />
          <div>
            <strong>Preview first</strong>
            <span>Every routine is built from supported steps and can be previewed before running.</span>
          </div>
        </div>
      </section>

      <section className="routines-overview">
        <RoutineMetric label="Saved routines" value={workflows.length} hint="In current view" />
        <RoutineMetric label="Project linked" value={projectLinkedCount} hint="Attached to workspaces" />
        <RoutineMetric label="Confirmation" value={confirmationCount} hint="Require approval" />
        <RoutineMetric label="High risk" value={highRiskCount} hint="Review before running" />
      </section>

      <section className="routine-controls">
        <div className="routine-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search routines, projects, triggers, or risk"
          />
        </div>

        <select
          value={selectedProject}
          onChange={(event) => setSelectedProject(event.target.value)}
          aria-label="Filter routines by project"
        >
          <option value="all">All projects</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </section>

      {(runMessage || previewText) && (
        <section className="routine-feedback-panel">
          {runMessage && <p className="warning">{runMessage}</p>}

          {previewText && (
            <div className="routine-preview-panel">
              <div>
                <strong>Routine preview</strong>
                <span>Review the planned steps before saving or running.</span>
              </div>

              <pre className="preview-text">{previewText}</pre>
            </div>
          )}
        </section>
      )}

      <div className="routines-layout">
        <section className="routine-builder-card">
          <div className="routine-section-header">
            <div>
              <span className="eyebrow">New routine</span>
              <h3>Create a routine</h3>
              <p>Start simple. Add high-risk steps only when the workflow truly needs them.</p>
            </div>
          </div>

          <div className="routine-create-grid">
            <label className="field-stack">
              <span>Name</span>
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Example: Start Klak work session"
              />
            </label>

            <label className="field-stack">
              <span>Trigger phrase</span>
              <input
                value={draft.trigger_phrase}
                onChange={(event) => setDraft({ ...draft, trigger_phrase: event.target.value })}
                placeholder="Example: start my dev session"
              />
            </label>
          </div>

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

          <label className="field-stack">
            <span>Description</span>
            <textarea
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              placeholder="What should this routine help with?"
            />
          </label>

          <label className="routine-confirm-toggle">
            <input
              type="checkbox"
              checked={draft.requires_confirmation}
              onChange={(event) =>
                setDraft({ ...draft, requires_confirmation: event.target.checked })
              }
            />
            <span>
              <strong>Require confirmation before running</strong>
              <small>Recommended for normal use, especially when a routine includes actions.</small>
            </span>
          </label>

          <section className="routine-step-builder">
            <div className="routine-step-builder-header">
              <div>
                <h3>Steps</h3>
                <p>Each step must use one of Klak’s supported local capabilities.</p>
              </div>

              <button onClick={addStep} title="Add step">
                <Plus size={16} /> Step
              </button>
            </div>

            <div className="routine-step-list">
              {draft.steps.map((step, index) => (
                <RoutineStepCard
                  key={`${index}-${step.type}`}
                  step={step}
                  index={index}
                  folders={folders}
                  apps={apps}
                  commands={commands}
                  canMoveUp={index > 0}
                  canMoveDown={index < draft.steps.length - 1}
                  onMove={moveStep}
                  onRemove={removeStep}
                  onStepChange={updateStep}
                  onInput={updateStepInput}
                />
              ))}
            </div>
          </section>

          <div className="routine-advanced-json">
            <button type="button" onClick={() => setShowDraftJson((value) => !value)}>
              <Code2 size={16} /> {showDraftJson ? "Hide advanced JSON" : "Show advanced JSON"}
            </button>

            {showDraftJson && (
              <label className="field-stack">
                <span>Steps JSON</span>
                <textarea
                  className="code-input"
                  value={draft.steps_json}
                  onChange={(event) => setDraftJson(event.target.value)}
                />
                <small>Use this only when the visual step builder is not enough.</small>
              </label>
            )}
          </div>

          <div className="routine-builder-actions">
            <button onClick={previewDraft}>
              <ClipboardList size={16} /> Preview draft
            </button>

            <button className="primary" onClick={create}>
              <Plus size={16} /> Save routine
            </button>
          </div>
        </section>

        <section className="routine-list-panel">
          <div className="routine-list-header">
            <div>
              <span className="eyebrow">Saved</span>
              <h3>Routine library</h3>
              <p className="muted">
                {filteredWorkflows.length} visible{" "}
                {filteredWorkflows.length === 1 ? "routine" : "routines"}
              </p>
            </div>
          </div>

          {filteredWorkflows.length === 0 ? (
            <div className="routine-empty-state">
              <strong>No routines found</strong>
              <p>Create a routine, change the project filter, or clear your search.</p>
            </div>
          ) : (
            <div className="routine-card-list">
              {filteredWorkflows.map((workflow) => (
                <RoutineCard
                  key={workflow.id}
                  workflow={workflow}
                  projects={projects}
                  projectLabel={
                    workflow.project_id
                      ? projectName.get(workflow.project_id) ?? "Project"
                      : "Global"
                  }
                  onPreview={previewSaved}
                  onRun={run}
                  onRefresh={refresh}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function RoutineMetric({
  label,
  value,
  hint
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <article className="routine-stat-card">
      <Workflow size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

function RoutineStepCard({
  step,
  index,
  folders,
  apps,
  commands,
  canMoveUp,
  canMoveDown,
  onMove,
  onRemove,
  onStepChange,
  onInput
}: {
  step: WorkflowStep;
  index: number;
  folders: AllowedFolder[];
  apps: RegisteredAppRecord[];
  commands: CommandTemplateRecord[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
  onStepChange: (index: number, patch: Partial<WorkflowStep>) => void;
  onInput: (index: number, input: Record<string, unknown>) => void;
}) {
  const risk = stepRisk(step.type);

  return (
    <article className="routine-step-card">
      <div className="routine-step-card-header">
        <div>
          <span className="routine-step-number">Step {index + 1}</span>
          <strong>{formatStepType(step.type)}</strong>
        </div>

        <span className={`risk risk-${risk}`}>{risk}</span>
      </div>

      <div className="routine-step-grid">
        <label className="field-stack">
          <span>Step type</span>
          <select
            value={step.type}
            onChange={(event) => onStepChange(index, defaultStep(event.target.value as WorkflowStepType))}
          >
            {supportedStepTypes.map((type) => (
              <option key={type} value={type}>
                {formatStepType(type)}
              </option>
            ))}
          </select>
        </label>

        <label className="field-stack">
          <span>Label</span>
          <input
            value={step.label ?? ""}
            onChange={(event) => onStepChange(index, { label: event.target.value })}
            placeholder="Optional step label"
          />
        </label>
      </div>

      <StepFields
        step={step}
        index={index}
        folders={folders}
        apps={apps}
        commands={commands}
        onInput={onInput}
      />

      <div className="routine-step-actions">
        <button title="Move step up" disabled={!canMoveUp} onClick={() => onMove(index, -1)}>
          <ArrowUp size={16} />
        </button>

        <button
          title="Move step down"
          disabled={!canMoveDown}
          onClick={() => onMove(index, 1)}
        >
          <ArrowDown size={16} />
        </button>

        <button title="Remove step" className="danger-button" onClick={() => onRemove(index)}>
          <Trash2 size={16} />
        </button>
      </div>
    </article>
  );
}

function RoutineCard({
  workflow,
  projects,
  projectLabel,
  onPreview,
  onRun,
  onRefresh
}: {
  workflow: WorkflowRecord;
  projects: ProjectRecord[];
  projectLabel: string;
  onPreview: (id: string) => Promise<void>;
  onRun: (workflow: WorkflowRecord) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({
    project_id: workflow.project_id ?? "",
    name: workflow.name,
    description: workflow.description ?? "",
    trigger_phrase: workflow.trigger_phrase ?? "",
    requires_confirmation: workflow.requires_confirmation,
    steps_json: JSON.stringify(parseWorkflowSteps(workflow), null, 2)
  });

  function resetEditDraft() {
    setEditDraft({
      project_id: workflow.project_id ?? "",
      name: workflow.name,
      description: workflow.description ?? "",
      trigger_phrase: workflow.trigger_phrase ?? "",
      requires_confirmation: workflow.requires_confirmation,
      steps_json: JSON.stringify(parseWorkflowSteps(workflow), null, 2)
    });
  }

  async function save() {
    setMessage(null);

    if (!editDraft.name.trim()) {
      setMessage("Routine name cannot be empty.");
      return;
    }

    try {
      const steps = parseStepsDraft(editDraft.steps_json);

      if (!steps) {
        setMessage("Steps JSON must be a valid array.");
        return;
      }

      validateWorkflowSteps(steps);

      await updateWorkflow(workflow.id, {
        project_id: editDraft.project_id || null,
        name: editDraft.name.trim(),
        description: emptyToNull(editDraft.description),
        trigger_phrase: emptyToNull(editDraft.trigger_phrase),
        requires_confirmation: editDraft.requires_confirmation,
        steps
      });

      setEditing(false);
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function remove() {
    const confirmed = window.confirm(
      `Delete "${workflow.name}"? This removes the saved routine, not your project files.`
    );

    if (!confirmed) return;

    await deleteWorkflow(workflow.id);
    await onRefresh();
  }

  const steps = parseWorkflowSteps(workflow);

  return (
    <article className="routine-card">
      <div className="routine-card-header">
        <div className="routine-title-area">
          <div className="routine-badge-row">
            <span className={`risk risk-${workflow.risk_level}`}>{workflow.risk_level}</span>
            <span className="tag">{projectLabel}</span>
            {workflow.requires_confirmation && (
              <span className="routine-confirm-badge">
                <ShieldCheck size={13} /> Confirmation
              </span>
            )}
          </div>

          <h4>{workflow.name}</h4>

          <p>
            {workflow.description?.trim()
              ? workflow.description
              : "No description yet. Add one so this routine is easier to understand later."}
          </p>
        </div>

        <div className="routine-card-actions">
          <button onClick={() => onPreview(workflow.id)}>
            <ClipboardList size={16} /> Preview
          </button>

          <button className="primary" onClick={() => onRun(workflow)}>
            <Play size={16} /> Run
          </button>

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

          <button className="danger-button" title="Delete routine" onClick={remove}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="routine-summary-grid">
        <div>
          <span>Steps</span>
          <strong>{steps.length}</strong>
        </div>

        <div>
          <span>Trigger</span>
          <strong>{workflow.trigger_phrase || "Not set"}</strong>
        </div>

        <div>
          <span>Runs</span>
          <strong>{workflow.run_count}</strong>
        </div>
      </div>

      {showDetails && (
        <div className="routine-details">
          <div>
            <span className="detail-label">Last run</span>
            <strong>
              {workflow.last_run_at ? new Date(workflow.last_run_at).toLocaleString() : "Never"}
            </strong>
          </div>

          <div>
            <span className="detail-label">Confirmation</span>
            <strong>
              {workflow.requires_confirmation
                ? "Required before running"
                : "Not required by this routine"}
            </strong>
          </div>

          <div>
            <span className="detail-label">Step summary</span>
            <ol>
              {steps.map((step, index) => (
                <li key={`${index}-${step.type}`}>{formatStepType(step.type)}</li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {editing && (
        <div className="routine-edit-form">
          <div className="routine-create-grid">
            <label className="field-stack">
              <span>Name</span>
              <input
                value={editDraft.name}
                onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value })}
              />
            </label>

            <label className="field-stack">
              <span>Trigger phrase</span>
              <input
                value={editDraft.trigger_phrase}
                onChange={(event) =>
                  setEditDraft({ ...editDraft, trigger_phrase: event.target.value })
                }
              />
            </label>
          </div>

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

          <label className="field-stack">
            <span>Description</span>
            <textarea
              value={editDraft.description}
              onChange={(event) =>
                setEditDraft({ ...editDraft, description: event.target.value })
              }
            />
          </label>

          <label className="routine-confirm-toggle">
            <input
              type="checkbox"
              checked={editDraft.requires_confirmation}
              onChange={(event) =>
                setEditDraft({ ...editDraft, requires_confirmation: event.target.checked })
              }
            />
            <span>
              <strong>Require confirmation before running</strong>
              <small>Recommended when this routine includes actions.</small>
            </span>
          </label>

          <label className="field-stack">
            <span>Steps JSON</span>
            <textarea
              className="code-input"
              value={editDraft.steps_json}
              onChange={(event) => setEditDraft({ ...editDraft, steps_json: event.target.value })}
            />
            <small>Saved routine step editing stays advanced for now.</small>
          </label>

          <button className="primary" onClick={save}>
            <Save size={16} /> Save changes
          </button>

          {message && <p className="inline-status">{message}</p>}
        </div>
      )}
    </article>
  );
}

function StepFields({
  step,
  index,
  folders,
  apps,
  commands,
  onInput
}: {
  step: WorkflowStep;
  index: number;
  folders: AllowedFolder[];
  apps: RegisteredAppRecord[];
  commands: CommandTemplateRecord[];
  onInput: (index: number, input: Record<string, unknown>) => void;
}) {
  if (step.type === "open_url") {
    return (
      <RoutineField label="URL">
        <input
          value={String(step.input.url ?? "")}
          onChange={(event) => onInput(index, { url: event.target.value })}
          placeholder="https://example.com"
        />
      </RoutineField>
    );
  }

  if (step.type === "open_folder") {
    return (
      <RoutineField label="Allowed folder">
        <FolderSelect
          value={String(step.input.path ?? "")}
          folders={folders}
          onChange={(path) => onInput(index, { path })}
        />
      </RoutineField>
    );
  }

  if (step.type === "launch_app") {
    return (
      <RoutineField label="Registered app">
        <select
          value={String(step.input.registered_app_id ?? "")}
          onChange={(event) => onInput(index, { registered_app_id: event.target.value })}
        >
          <option value="">Select registered app</option>
          {apps.map((app) => (
            <option key={app.id} value={app.id}>
              {app.name}
            </option>
          ))}
        </select>
      </RoutineField>
    );
  }

  if (step.type === "run_command_template") {
    return (
      <RoutineField label="Saved action">
        <select
          value={String(step.input.command_template_id ?? "")}
          onChange={(event) => onInput(index, { command_template_id: event.target.value })}
        >
          <option value="">Select saved action</option>
          {commands.map((command) => (
            <option key={command.id} value={command.id}>
              {command.name}
            </option>
          ))}
        </select>
      </RoutineField>
    );
  }

  if (step.type === "start_background_process") {
    return (
      <RoutineField label="Long-running saved action">
        <select
          value={String(step.input.command_template_id ?? "")}
          onChange={(event) => onInput(index, { command_template_id: event.target.value })}
        >
          <option value="">Select long-running saved action</option>
          {commands
            .filter((command) => command.is_long_running && command.allow_background_run)
            .map((command) => (
              <option key={command.id} value={command.id}>
                {command.name}
              </option>
            ))}
        </select>
      </RoutineField>
    );
  }

  if (step.type === "create_note") {
    return (
      <div className="routine-step-grid">
        <RoutineField label="Destination folder">
          <FolderSelect
            value={String(step.input.destinationFolder ?? "")}
            folders={folders}
            onChange={(destinationFolder) => onInput(index, { destinationFolder })}
          />
        </RoutineField>

        <RoutineField label="Note title">
          <input
            value={String(step.input.title ?? "")}
            onChange={(event) => onInput(index, { title: event.target.value })}
            placeholder="Note title"
          />
        </RoutineField>

        <RoutineField label="Note content">
          <input
            value={String(step.input.content ?? "")}
            onChange={(event) => onInput(index, { content: event.target.value })}
            placeholder="Note content"
          />
        </RoutineField>
      </div>
    );
  }

  if (step.type === "copy_to_clipboard") {
    return (
      <RoutineField label="Text to copy">
        <textarea
          value={String(step.input.text ?? "")}
          onChange={(event) => onInput(index, { text: event.target.value })}
          placeholder="Text to copy"
        />
      </RoutineField>
    );
  }

  if (step.type === "search_memory") {
    return (
      <RoutineField label="Memory query">
        <input
          value={String(step.input.query ?? "")}
          onChange={(event) => onInput(index, { query: event.target.value })}
          placeholder="Memory query"
        />
      </RoutineField>
    );
  }

  if (step.type === "create_memory") {
    return (
      <div className="routine-step-grid">
        <RoutineField label="Memory title">
          <input
            value={String(step.input.title ?? "")}
            onChange={(event) => onInput(index, { title: event.target.value })}
            placeholder="Memory title"
          />
        </RoutineField>

        <RoutineField label="Memory content">
          <input
            value={String(step.input.content ?? "")}
            onChange={(event) => onInput(index, { content: event.target.value })}
            placeholder="Memory content"
          />
        </RoutineField>

        <RoutineField label="Memory type">
          <select
            value={String(step.input.type ?? "workflow")}
            onChange={(event) => onInput(index, { type: event.target.value })}
          >
            {["profile", "preference", "project", "workflow", "task", "document", "command_history"].map(
              (type) => (
                <option key={type} value={type}>
                  {type.replace(/_/g, " ")}
                </option>
              )
            )}
          </select>
        </RoutineField>
      </div>
    );
  }

  return (
    <RoutineField label="Manual instruction">
      <textarea
        value={String(step.input.text ?? "")}
        onChange={(event) => onInput(index, { text: event.target.value })}
        placeholder="Manual instruction"
      />
    </RoutineField>
  );
}

function RoutineField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field-stack">
      <span>{label}</span>
      {children}
    </label>
  );
}

function FolderSelect({
  value,
  folders,
  onChange
}: {
  value: string;
  folders: AllowedFolder[];
  onChange: (path: string) => void;
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Select allowed folder</option>
      {folders.map((folder) => (
        <option key={folder.id} value={folder.path}>
          {folder.label ?? folder.path}
        </option>
      ))}
    </select>
  );
}

function defaultStep(type: WorkflowStepType): WorkflowStep {
  if (type === "open_url") return { type, label: "", input: { url: "" } };
  if (type === "open_folder") return { type, label: "", input: { path: "" } };
  if (type === "launch_app") return { type, label: "", input: { registered_app_id: "" } };
  if (type === "run_command_template") return { type, label: "", input: { command_template_id: "" } };
  if (type === "start_background_process") return { type, label: "", input: { command_template_id: "" } };
  if (type === "create_note") {
    return { type, label: "", input: { destinationFolder: "", title: "", content: "" } };
  }
  if (type === "copy_to_clipboard") return { type, label: "", input: { text: "" } };
  if (type === "search_memory") return { type, label: "", input: { query: "" } };
  if (type === "create_memory") {
    return {
      type,
      label: "",
      input: { type: "workflow", title: "", content: "", source: "workflow" }
    };
  }

  return { type, label: "", input: { text: "" } };
}

function describeStep(step: WorkflowStep, apps: RegisteredAppRecord[]): string {
  if (step.type === "launch_app") {
    return `launch ${
      apps.find((app) => app.id === step.input.registered_app_id)?.name ?? "registered app"
    }`;
  }

  if (step.type === "run_command_template") return "run saved action";
  if (step.type === "start_background_process") return "start running activity";
  if (step.type === "manual_instruction") {
    return String(step.input.text ?? "manual instruction");
  }

  return `${formatStepType(step.type)} ${JSON.stringify(step.input)}`;
}

function stepRisk(type: WorkflowStepType) {
  if (type === "run_command_template" || type === "start_background_process") return "high";

  return ["open_folder", "launch_app", "create_note", "copy_to_clipboard", "create_memory"].includes(
    type
  )
    ? "medium"
    : "low";
}

function parseStepsDraft(value: string): WorkflowStep[] | null {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function formatStepType(type: WorkflowStepType): string {
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function emptyToNull(value: string): string | null {
  return value.trim() ? value.trim() : null;
}