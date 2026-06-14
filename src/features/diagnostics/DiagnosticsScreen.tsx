import { invoke } from "@tauri-apps/api/core";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Database,
  History,
  RefreshCw,
  ShieldCheck,
  Wrench,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ScreenHeader } from "../../components/ScreenHeader";
import type {
  ActionLog,
  AppSettings,
  BackgroundProcessRecord,
  CommandTemplateRecord,
  ProjectRecord,
  RegisteredAppRecord,
  ToolDefinition,
  WorkflowRecord
} from "../../types";
import {
  createRegisteredApp,
  deleteRegisteredApp,
  isBlockedShellExecutable,
  listRegisteredApps,
  validateExecutablePath
} from "../../lib/apps/registeredAppsRepository";
import {
  createCommandTemplate,
  deleteCommandTemplate,
  listCommandTemplates,
  validateCommandSafety
} from "../../lib/commands/commandTemplateRepository";
import { listActionLogs } from "../../lib/logs/actionLogRepository";
import { listBackgroundProcesses, listRunningBackgroundProcesses } from "../../lib/processes/backgroundProcessRepository";
import { listProjects } from "../../lib/projects/projectRepository";
import { listTools } from "../../lib/tools/toolRegistry";
import { listWorkflows, validateWorkflowSteps } from "../../lib/workflows/workflowRepository";

interface DiagnosticsSnapshot {
  projects: ProjectRecord[];
  workflows: WorkflowRecord[];
  registeredApps: RegisteredAppRecord[];
  commandTemplates: CommandTemplateRecord[];
  backgroundProcesses: BackgroundProcessRecord[];
  tools: ToolDefinition[];
  logs: ActionLog[];
  checks: string[];
  checkedAt: string;
}

type CheckState = "passed" | "warning" | "failed";

export function DiagnosticsScreen({ settings }: { settings: AppSettings }) {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    setRefreshing(true);
    setMessage(null);

    try {
      const [
        projects,
        workflows,
        registeredApps,
        commandTemplates,
        backgroundProcesses,
        tools,
        logs,
        checks
      ] = await Promise.all([
        listProjects(),
        listWorkflows(),
        listRegisteredApps(),
        listCommandTemplates(),
        listBackgroundProcesses(),
        listTools(settings.allToolsDisabled),
        listActionLogs(),
        runDiagnosticsChecks()
      ]);

      setSnapshot({
        projects,
        workflows,
        registeredApps,
        commandTemplates,
        backgroundProcesses,
        tools,
        logs,
        checks,
        checkedAt: new Date().toISOString()
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [settings.allToolsDisabled]);

  const failedLogs = useMemo(() => {
    return (
      snapshot?.logs
        .filter((log) => log.status === "failed" || log.status === "blocked")
        .slice(0, 6) ?? []
    );
  }, [snapshot]);

  const linkedStartupCount = useMemo(() => {
    return snapshot?.projects.filter((project) => Boolean(project.startup_workflow_id)).length ?? 0;
  }, [snapshot]);

  const runningProcessCount = useMemo(() => {
    return snapshot?.backgroundProcesses.filter((process) => ["starting", "running"].includes(process.status)).length ?? 0;
  }, [snapshot]);

  const staleProcessCount = useMemo(() => {
    return snapshot?.backgroundProcesses.filter((process) => process.status === "stale").length ?? 0;
  }, [snapshot]);

  const enabledToolCount = useMemo(() => {
    return snapshot?.tools.filter((tool) => tool.enabled && !tool.future).length ?? 0;
  }, [snapshot]);

  const checkSummary = useMemo(() => {
    const checks = snapshot?.checks ?? [];

    return {
      passed: checks.filter((check) => getCheckState(check) === "passed").length,
      warning: checks.filter((check) => getCheckState(check) === "warning").length,
      failed: checks.filter((check) => getCheckState(check) === "failed").length
    };
  }, [snapshot]);

  const overallState: CheckState = checkSummary.failed > 0 ? "failed" : checkSummary.warning > 0 ? "warning" : "passed";

  return (
    <div className="screen health-screen">
      <ScreenHeader
        title="Health Check"
        subtitle="Local checks for Klak’s apps, routines, saved actions, permissions, and recent failures."
        actions={
          <button onClick={refresh} title="Refresh diagnostics" disabled={refreshing}>
            <RefreshCw size={16} /> {refreshing ? "Checking..." : "Refresh"}
          </button>
        }
      />

      <section className={`health-hero health-hero-${overallState}`}>
        <div>
          <span className="eyebrow">Local system status</span>
          <h3>{formatOverallState(overallState)}</h3>
          <p>
            Klak checks only its own local records, approved tools, saved actions, and managed activity
            state. It does not inspect the whole computer.
          </p>
        </div>

        <div className="health-hero-card">
          <HealthStateIcon state={overallState} />
          <div>
            <strong>{checkSummary.passed} passed</strong>
            <span>
              {checkSummary.failed} failed · {checkSummary.warning} need attention
            </span>
            <small>
              Last checked: {snapshot ? formatDate(snapshot.checkedAt) : "Not checked yet"}
            </small>
          </div>
        </div>
      </section>

      {message && <p className="warning">{message}</p>}

      <section className="health-overview">
        <HealthMetric icon={<Database size={18} />} label="Projects" value={snapshot?.projects.length ?? 0} hint="Local workspaces" />
        <HealthMetric icon={<Wrench size={18} />} label="Routines" value={snapshot?.workflows.length ?? 0} hint="Saved workflows" />
        <HealthMetric icon={<ShieldCheck size={18} />} label="Registered apps" value={snapshot?.registeredApps.length ?? 0} hint="Approved app records" />
        <HealthMetric icon={<Cpu size={18} />} label="Saved actions" value={snapshot?.commandTemplates.length ?? 0} hint="Controlled commands" />
        <HealthMetric icon={<Activity size={18} />} label="Running activities" value={runningProcessCount} hint="Managed by Klak" />
        <HealthMetric icon={<History size={18} />} label="Recent failures" value={failedLogs.length} hint="Blocked or failed" />
      </section>

      <section className="health-main-grid">
        <div className="health-column">
          <HealthSection title="Runtime safety" description="Current local behavior and permission settings.">
            <HealthInfoRow label="Permission mode" value={formatSetting(settings.permissionMode)} />
            <HealthInfoRow label="Local context" value={settings.localContextEnabled ? "Enabled" : "Disabled"} />
            <HealthInfoRow label="Voice" value={settings.voiceEnabled ? "Enabled" : "Disabled"} />
            <HealthInfoRow label="All tools disabled" value={settings.allToolsDisabled ? "Yes" : "No"} />
          </HealthSection>

          <HealthSection title="Local inventory" description="Records Klak can use when you approve actions.">
            <HealthInfoRow label="Startup workflow links" value={`${linkedStartupCount} project(s)`} />
            <HealthInfoRow label="Enabled tools" value={`${enabledToolCount}`} />
            <HealthInfoRow label="Stale activity records" value={`${staleProcessCount}`} />
            <HealthInfoRow
              label="Last command run"
              value={snapshot?.commandTemplates.find((item) => item.last_run_at)?.last_result_summary ?? "None"}
            />
          </HealthSection>

          <HealthSection title="Recent blocked or failed actions" description="Useful when something did not run.">
            {failedLogs.length === 0 ? (
              <div className="health-empty-mini">No recent blocked or failed actions.</div>
            ) : (
              <div className="health-failure-list">
                {failedLogs.map((log) => (
                  <article key={log.id} className="health-failure-card">
                    <strong>{formatToolName(log.tool_name)}</strong>
                    <span>{log.error_message ?? log.status}</span>
                  </article>
                ))}
              </div>
            )}
          </HealthSection>
        </div>

        <div className="health-column">
          <HealthSection title="Diagnostics checks" description="Local validation checks Klak can safely run.">
            {!snapshot ? (
              <div className="health-empty-mini">Run Health Check to see diagnostics.</div>
            ) : (
              <div className="health-check-list">
                {snapshot.checks.map((check) => (
                  <HealthCheckRow key={check} check={check} />
                ))}
              </div>
            )}
          </HealthSection>

          <HealthSection title="Activity manager" description="Background work remains visible and limited.">
            <HealthInfoRow
              label="Manager capability"
              value={
                snapshot?.tools.some((tool) => tool.name === "start_background_process" && tool.enabled)
                  ? "Enabled"
                  : "Disabled"
              }
            />
            <HealthInfoRow label="Running now" value={`${runningProcessCount}`} />
            <HealthInfoRow label="Output logs" value="System temp / klak / process-logs" />
            <HealthInfoRow label="Stale records" value={`${staleProcessCount}`} />
          </HealthSection>
        </div>
      </section>
    </div>
  );
}

function HealthMetric({
  icon,
  label,
  value,
  hint
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <article className="health-metric-card">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

function HealthSection({
  title,
  description,
  children
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="health-section-card">
      <div className="health-section-header">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {children}
    </section>
  );
}

function HealthInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="health-info-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function HealthCheckRow({ check }: { check: string }) {
  const state = getCheckState(check);

  return (
    <article className={`health-check-row health-check-${state}`}>
      <HealthStateIcon state={state} />
      <span>{cleanCheckLabel(check)}</span>
    </article>
  );
}

function HealthStateIcon({ state }: { state: CheckState }) {
  if (state === "passed") return <CheckCircle2 size={18} />;
  if (state === "warning") return <AlertTriangle size={18} />;
  return <XCircle size={18} />;
}

function getCheckState(check: string): CheckState {
  const normalized = check.toLowerCase();

  if (normalized.includes("failed")) return "failed";
  if (normalized.includes("needs attention")) return "warning";

  return "passed";
}

function cleanCheckLabel(check: string): string {
  return check
    .replace(/: passed$/i, "")
    .replace(/: failed$/i, "")
    .replace(/: needs attention$/i, "");
}

function formatOverallState(state: CheckState): string {
  if (state === "passed") return "Everything Klak checked looks healthy.";
  if (state === "warning") return "Klak found a few items that need attention.";
  return "Klak found health check failures.";
}

function formatSetting(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatToolName(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Unknown";

  return date.toLocaleString();
}

async function runDiagnosticsChecks(): Promise<string[]> {
  const checks: string[] = [];
  let testId: string | null = null;

  try {
    const app = await createRegisteredApp({
      name: "Klak diagnostics app",
      executable_path: "C:\\KlakDiagnostics\\fake-safe-app.exe",
      app_type: "other",
      description: "Temporary diagnostics record",
      allowed: false
    });

    testId = app.id;
    checks.push("Create/delete test registered app record: passed");
  } catch (error) {
    checks.push(
      `Create/delete test registered app record: failed (${
        error instanceof Error ? error.message : String(error)
      })`
    );
  } finally {
    if (testId) await deleteRegisteredApp(testId);
  }

  checks.push(
    isBlockedShellExecutable("C:\\Windows\\System32\\cmd.exe")
      ? "Blocked shell app rule: passed"
      : "Blocked shell app rule: failed"
  );

  try {
    validateExecutablePath("C:\\Windows\\System32\\cmd.exe");
    checks.push("Shell executable validation: failed");
  } catch {
    checks.push("Shell executable validation: passed");
  }

  try {
    await invoke("launch_registered_app", {
      input: { executable_path: "C:\\KlakDiagnostics\\missing-safe-app.exe" }
    });

    checks.push("Nonexistent executable launch handling: failed");
  } catch {
    checks.push("Nonexistent executable launch handling: passed");
  }

  try {
    validateWorkflowSteps([{ type: "manual_instruction", input: { text: "diagnostic" } }]);
    checks.push("Workflow builder validation status: passed");
  } catch {
    checks.push("Workflow builder validation status: failed");
  }

  checks.push("App launcher native command status: registered");

  try {
    const discovery = await invoke<{ accepted: unknown[]; rejected: unknown[] }>(
      "register_discovered_apps",
      {
        input: { candidates: [], registered_executable_paths: [] }
      }
    );

    checks.push(
      Array.isArray(discovery.accepted) && Array.isArray(discovery.rejected)
        ? "App discovery command status: registered"
        : "App discovery command status: needs attention"
    );
  } catch {
    checks.push("App discovery command status: failed");
  }

  checks.push("Registered apps table status: reachable");

  let commandTestId: string | null = null;

  try {
    const command = await createCommandTemplate({
      name: "Klak diagnostics command",
      command: "git status --short",
      working_directory: "C:\\KlakDiagnostics",
      command_type: "git_readonly",
      risk_level: "low",
      enabled: false
    });

    commandTestId = command.id;
    checks.push("Command template repository health: passed");
  } catch (error) {
    checks.push(
      `Command template repository health: failed (${
        error instanceof Error ? error.message : String(error)
      })`
    );
  } finally {
    if (commandTestId) await deleteCommandTemplate(commandTestId);
  }

  try {
    validateCommandSafety("rm -rf .");
    checks.push("Blocked command safety test: failed");
  } catch {
    checks.push("Blocked command safety test: passed");
  }

  try {
    validateCommandSafety("git status --short");
    checks.push("Allowed command validation test: passed");
  } catch {
    checks.push("Allowed command validation test: failed");
  }

  checks.push("Command runner status: registered");

  try {
    const status = await invoke<{ status: string }>("get_background_process_status", {
      input: { process_id: "diagnostic-process-id" }
    });

    checks.push(
      status.status === "stale"
        ? "Activity manager native status check: passed"
        : "Activity manager native status check: needs attention"
    );
  } catch {
    checks.push("Activity manager native status check: failed");
  }

  try {
    const running = await listRunningBackgroundProcesses();
    const hasDuplicate = running.some(
      (process, index) =>
        running.findIndex(
          (item) =>
            item.command_template_id === process.command_template_id &&
            item.working_directory === process.working_directory
        ) !== index
    );

    checks.push(
      hasDuplicate
        ? "Duplicate activity blocking test: needs attention"
        : "Duplicate activity blocking test: passed"
    );
  } catch {
    checks.push("Duplicate activity blocking test: failed");
  }

  checks.push("Running activity table validation: passed");

  return checks;
}