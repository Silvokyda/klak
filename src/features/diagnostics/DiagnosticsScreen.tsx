import { invoke } from "@tauri-apps/api/core";
import { Activity, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { ScreenHeader } from "../../components/ScreenHeader";
import type { ActionLog, AppSettings, ProjectRecord, RegisteredAppRecord, ToolDefinition, WorkflowRecord } from "../../types";
import { createRegisteredApp, deleteRegisteredApp, isBlockedShellExecutable, listRegisteredApps, validateExecutablePath } from "../../lib/apps/registeredAppsRepository";
import { listActionLogs } from "../../lib/logs/actionLogRepository";
import { listProjects } from "../../lib/projects/projectRepository";
import { listTools } from "../../lib/tools/toolRegistry";
import { listWorkflows, validateWorkflowSteps } from "../../lib/workflows/workflowRepository";

interface DiagnosticsSnapshot {
  projects: ProjectRecord[];
  workflows: WorkflowRecord[];
  registeredApps: RegisteredAppRecord[];
  tools: ToolDefinition[];
  logs: ActionLog[];
  checks: string[];
}

export function DiagnosticsScreen({ settings }: { settings: AppSettings }) {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);

  async function refresh() {
    const [projects, workflows, registeredApps, tools, logs, checks] = await Promise.all([
      listProjects(),
      listWorkflows(),
      listRegisteredApps(),
      listTools(settings.allToolsDisabled),
      listActionLogs(),
      runDiagnosticsChecks()
    ]);
    setSnapshot({ projects, workflows, registeredApps, tools, logs, checks });
  }

  useEffect(() => {
    void refresh();
  }, [settings.allToolsDisabled]);

  const failedLogs = snapshot?.logs.filter((log) => log.status === "failed" || log.status === "blocked").slice(0, 6) ?? [];
  const linkedStartupCount = snapshot?.projects.filter((project) => Boolean(project.startup_workflow_id)).length ?? 0;

  return (
    <div className="screen">
      <ScreenHeader
        title="Diagnostics"
        subtitle="Local health checks for memory, apps, workflows, permissions, and recent action failures."
        actions={<button onClick={refresh} title="Refresh diagnostics"><RefreshCw size={16} /> Refresh</button>}
      />
      <section className="metric-grid">
        <Metric label="Projects" value={snapshot?.projects.length ?? 0} />
        <Metric label="Workflows" value={snapshot?.workflows.length ?? 0} />
        <Metric label="Registered apps" value={snapshot?.registeredApps.length ?? 0} />
        <Metric label="Startup links" value={linkedStartupCount} />
        <Metric label="Enabled tools" value={snapshot?.tools.filter((tool) => tool.enabled && !tool.future).length ?? 0} />
        <Metric label="Recent failures" value={failedLogs.length} />
      </section>
      <section className="settings-grid">
        <div className="section-divider">
          <h3>Runtime</h3>
          <p>Permission mode: {settings.permissionMode}</p>
          <p>Local context: {settings.localContextEnabled ? "enabled" : "disabled"}</p>
          <p>Voice: {settings.voiceEnabled ? "enabled" : "disabled"}</p>
          <p>All tools disabled: {settings.allToolsDisabled ? "yes" : "no"}</p>
        </div>
        <div className="section-divider">
          <h3>App launcher</h3>
          {snapshot?.checks.map((check) => <p key={check}>{check}</p>)}
        </div>
        <div className="section-divider">
          <h3>Workflow builder</h3>
          <p>Supported step validation: enabled</p>
          <p>Launch app step support: {snapshot?.tools.some((tool) => tool.name === "launch_app" && tool.enabled) ? "enabled" : "disabled"}</p>
          <p>Startup workflow linkage: {linkedStartupCount} linked project(s)</p>
        </div>
        <div className="section-divider">
          <h3>Recent blocked or failed actions</h3>
          {failedLogs.length === 0 ? <p>No recent blocked or failed actions.</p> : failedLogs.map((log) => (
            <p key={log.id}><strong>{log.tool_name}</strong>: {log.error_message ?? log.status}</p>
          ))}
        </div>
      </section>
    </div>
  );
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
    checks.push(`Create/delete test registered app record: failed (${error instanceof Error ? error.message : String(error)})`);
  } finally {
    if (testId) await deleteRegisteredApp(testId);
  }

  checks.push(isBlockedShellExecutable("C:\\Windows\\System32\\cmd.exe") ? "Blocked shell app rule: passed" : "Blocked shell app rule: failed");
  try {
    validateExecutablePath("C:\\Windows\\System32\\cmd.exe");
    checks.push("Shell executable validation: failed");
  } catch {
    checks.push("Shell executable validation: passed");
  }

  try {
    await invoke("launch_registered_app", { input: { executable_path: "C:\\KlakDiagnostics\\missing-safe-app.exe" } });
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
  return checks;
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <article className="metric">
      <Activity size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
