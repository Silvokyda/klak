import type {
  AIProvider,
  CommandTemplateRecord,
  OperatorMode,
  OperatorPlannerRequest,
  OperatorTaskPlan,
  ProjectRecord,
  RegisteredAppRecord,
  TaskScope
} from "../../types";
import { OpenAICompatibleProvider } from "../ai/openAiCompatibleProvider";
import { apiKeyVault } from "../security/apiKeyVault";

interface PlanEnvelope {
  summary?: string;
  scope?: Partial<TaskScope>;
  steps?: Array<Record<string, unknown>>;
}

export async function planOperatorTask(input: OperatorPlannerRequest, provider?: AIProvider): Promise<OperatorTaskPlan> {
  const aiKey = await apiKeyVault.getApiKeyForProviderCall();
  if (aiKey) {
    const preferredProvider =
      provider ??
      new OpenAICompatibleProvider(
        "https://api.openai.com/v1",
        "gpt-4o-mini"
      );
    const plan = await tryAiPlan(input, preferredProvider).catch(() => null);
    if (plan) return plan;
  }
  return buildHeuristicPlan(input);
}

async function tryAiPlan(input: OperatorPlannerRequest, provider: AIProvider): Promise<OperatorTaskPlan | null> {
  const response = await provider.generateResponse({
    userMessage: buildPlanningPrompt(input),
    relevantMemories: [],
    relevantProjects: input.availableProjects.slice(0, 8),
    relevantWorkflows: [],
    relevantRegisteredApps: input.availableRegisteredApps.slice(0, 8),
    relevantCommandTemplates: input.availableCommandTemplates.slice(0, 12),
    relevantBackgroundProcesses: input.runningProcesses.slice(0, 8),
    currentPermissionMode: input.permissionMode,
    availableTools: [],
    recentActionLogs: []
  });

  const parsed = extractPlanEnvelope(response.message);
  if (!parsed?.steps?.length) return null;
  return normalizePlanEnvelope(input, parsed);
}

function buildHeuristicPlan(input: OperatorPlannerRequest): OperatorTaskPlan {
  const commandSteps = pickRelevantCommands(input.userGoal, input.availableCommandTemplates);
  const summary = commandSteps.length
    ? "Klak prepared a bounded local operator plan using your saved actions and local tooling."
    : "Klak could not safely infer a concrete automation path, so the task is prepared for observation and manual takeover.";

  const scope: TaskScope = {
    allowed_apps: [],
    allowed_folders: [...new Set(input.allowedFolders)],
    allowed_domains: extractDomains(input.userGoal),
    allowed_command_template_ids: commandSteps.map((item) => item.id),
    allowed_recipients: [],
    allowed_action_classes: ["observe", "command", "browser", "window", "manual_review"],
    max_actions: Math.max(6, commandSteps.length * 2 || 4),
    max_runtime_seconds: 1800
  };

  if (!commandSteps.length) {
    return {
      summary,
      scope,
      steps: [
        {
          title: "Inspect local environment",
          kind: "manual_review",
          intent: "Observe the current machine state and prepare for a bounded next action.",
          execution_method: "human_takeover",
          fallback_methods: ["human_takeover"],
          inputs: { message: input.userGoal },
          verification: { type: "none" },
          approval_required: "before_step",
          retry_limit: 0,
          requires_human_reason: "No approved saved action or safe deterministic route was found."
        }
      ]
    };
  }

  return {
    summary,
    scope,
    steps: commandSteps.map((command, index) => ({
      title: index === 0 ? `Start ${command.name}` : `Continue with ${command.name}`,
      kind: command.is_long_running && command.allow_background_run ? "command" : "command",
      intent: command.description || `Run ${command.command}`,
      execution_method: "command_template",
      fallback_methods: ["human_takeover"],
      inputs: {
        command_template_id: command.id,
        command_name: command.name
      },
      verification: command.is_long_running
        ? { type: "process_running", process_name: firstCommandToken(command.command) }
        : { type: "command_result", expect_exit_code: 0 },
      approval_required: "before_step",
      retry_limit: 1
    }))
  };
}

function normalizePlanEnvelope(input: OperatorPlannerRequest, envelope: PlanEnvelope): OperatorTaskPlan {
  const scope: TaskScope = {
    allowed_apps: ensureStringArray(envelope.scope?.allowed_apps),
    allowed_folders: ensureStringArray(envelope.scope?.allowed_folders).filter((path) => input.allowedFolders.includes(path)),
    allowed_domains: ensureStringArray(envelope.scope?.allowed_domains),
    allowed_command_template_ids: ensureKnownIds(ensureStringArray(envelope.scope?.allowed_command_template_ids), input.availableCommandTemplates.map((item) => item.id)),
    allowed_recipients: ensureStringArray(envelope.scope?.allowed_recipients),
    allowed_action_classes: ensureStringArray(envelope.scope?.allowed_action_classes),
    max_actions: clampNumber(envelope.scope?.max_actions, 3, 30, 12),
    max_runtime_seconds: clampNumber(envelope.scope?.max_runtime_seconds, 60, 7200, 1800)
  };

  return {
    summary: String(envelope.summary ?? "Klak prepared a structured operator plan."),
    scope,
    steps: (envelope.steps ?? []).map((step, index) => ({
      title: String(step.title ?? `Step ${index + 1}`),
      kind: normalizeStepKind(step.kind),
      intent: String(step.intent ?? step.title ?? `Complete step ${index + 1}`),
      execution_method: normalizeExecutionMethod(step.execution_method),
      fallback_methods: ensureExecutionMethods(step.fallback_methods),
      inputs: (step.inputs as Record<string, unknown>) ?? {},
      verification: normalizeVerification(step.verification),
      approval_required: normalizeApproval(step.approval_required),
      retry_limit: clampNumber(step.retry_limit, 0, 3, 1),
      requires_human_reason: typeof step.requires_human_reason === "string" ? step.requires_human_reason : null
    }))
  };
}

function buildPlanningPrompt(input: OperatorPlannerRequest): string {
  return JSON.stringify({
    instruction:
      "Return JSON only with keys summary, scope, and steps. Scope keys: allowed_apps, allowed_folders, allowed_domains, allowed_command_template_ids, allowed_recipients, allowed_action_classes, max_actions, max_runtime_seconds. Step keys: title, kind, intent, execution_method, fallback_methods, inputs, verification, approval_required, retry_limit, requires_human_reason. Use only registered app IDs and command template IDs from context. Prefer command_template, filesystem, browser_dom, windows_ui, then human_takeover. For secret entry or submit/send, use approval_required secret_input_required or before_consequential_action.",
    goal: input.userGoal,
    mode: input.mode,
    permissionMode: input.permissionMode,
    allowedFolders: input.allowedFolders,
    projects: serializeProjects(input.availableProjects),
    commandTemplates: serializeCommands(input.availableCommandTemplates),
    registeredApps: serializeApps(input.availableRegisteredApps),
    runningProcesses: input.runningProcesses.map((process) => ({
      id: process.id,
      name: process.name,
      status: process.status,
      projectId: process.project_id
    }))
  });
}

function extractPlanEnvelope(text: string): PlanEnvelope | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as PlanEnvelope;
  } catch {
    return null;
  }
}

function pickRelevantCommands(goal: string, commands: CommandTemplateRecord[]) {
  const lowered = goal.toLowerCase();
  const scored = commands.map((command) => ({
    command,
    score: scoreCommand(command, lowered)
  })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, 4).map((item) => item.command);
}

function scoreCommand(command: CommandTemplateRecord, goal: string): number {
  const haystack = `${command.name} ${command.description ?? ""} ${command.command} ${command.working_directory}`.toLowerCase();
  return goal.split(/\W+/).filter((token) => token.length > 2 && haystack.includes(token)).length;
}

function extractDomains(text: string): string[] {
  const domains = Array.from(text.matchAll(/https?:\/\/([^/\s]+)/gi)).map((match) => match[1].toLowerCase());
  return [...new Set(domains)];
}

function firstCommandToken(command: string): string {
  return command.trim().split(/\s+/)[0] ?? command.trim();
}

function ensureStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function ensureKnownIds(values: string[], known: string[]): string[] {
  const set = new Set(known);
  return values.filter((item) => set.has(item));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function normalizeStepKind(value: unknown): OperatorTaskPlan["steps"][number]["kind"] {
  if (value === "filesystem" || value === "browser" || value === "window" || value === "launch_app" || value === "approval" || value === "secret_prompt" || value === "manual_review" || value === "human_takeover") {
    return value;
  }
  return "command";
}

function normalizeExecutionMethod(value: unknown): OperatorTaskPlan["steps"][number]["execution_method"] {
  if (value === "filesystem" || value === "browser_dom" || value === "windows_ui" || value === "mouse_keyboard" || value === "human_takeover") {
    return value;
  }
  return "command_template";
}

function ensureExecutionMethods(value: unknown): OperatorTaskPlan["steps"][number]["fallback_methods"] {
  const methods = ensureStringArray(value).filter((item): item is OperatorTaskPlan["steps"][number]["fallback_methods"][number] =>
    ["command_template", "filesystem", "browser_dom", "windows_ui", "mouse_keyboard", "human_takeover"].includes(item)
  );
  return methods.length ? methods : ["human_takeover"];
}

function normalizeVerification(value: unknown): OperatorTaskPlan["steps"][number]["verification"] {
  if (value && typeof value === "object" && "type" in (value as JsonRecord)) {
    return value as OperatorTaskPlan["steps"][number]["verification"];
  }
  return { type: "none" };
}

function normalizeApproval(value: unknown): OperatorTaskPlan["steps"][number]["approval_required"] {
  if (value === "before_step" || value === "before_consequential_action" || value === "secret_input_required") return value;
  return "none";
}

function serializeProjects(projects: ProjectRecord[]) {
  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    repoPath: project.repo_path,
    devUrl: project.dev_url,
    notes: project.notes
  }));
}

function serializeCommands(commands: CommandTemplateRecord[]) {
  return commands.map((command) => ({
    id: command.id,
    name: command.name,
    description: command.description,
    command: command.command,
    workingDirectory: command.working_directory,
    enabled: command.enabled,
    isLongRunning: command.is_long_running,
    allowBackgroundRun: command.allow_background_run
  }));
}

function serializeApps(apps: RegisteredAppRecord[]) {
  return apps.map((app) => ({
    id: app.id,
    name: app.name,
    appType: app.app_type,
    allowed: app.allowed
  }));
}

type JsonRecord = Record<string, unknown>;

export function operatorModeLabel(mode: OperatorMode): string {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}
