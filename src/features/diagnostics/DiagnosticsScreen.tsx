import { Activity, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { ScreenHeader } from "../../components/ScreenHeader";
import type { ActionLog, AppSettings, ProjectRecord, ToolDefinition, WorkflowRecord } from "../../types";
import { listActionLogs } from "../../lib/logs/actionLogRepository";
import { listProjects } from "../../lib/projects/projectRepository";
import { listTools } from "../../lib/tools/toolRegistry";
import { listWorkflows } from "../../lib/workflows/workflowRepository";

interface DiagnosticsSnapshot {
  projects: ProjectRecord[];
  workflows: WorkflowRecord[];
  tools: ToolDefinition[];
  logs: ActionLog[];
}

export function DiagnosticsScreen({ settings }: { settings: AppSettings }) {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);

  async function refresh() {
    const [projects, workflows, tools, logs] = await Promise.all([
      listProjects(),
      listWorkflows(),
      listTools(settings.allToolsDisabled),
      listActionLogs()
    ]);
    setSnapshot({ projects, workflows, tools, logs });
  }

  useEffect(() => {
    void refresh();
  }, [settings.allToolsDisabled]);

  const failedLogs = snapshot?.logs.filter((log) => log.status === "failed" || log.status === "blocked").slice(0, 6) ?? [];

  return (
    <div className="screen">
      <ScreenHeader
        title="Diagnostics"
        subtitle="Local health checks for memory, workflows, permissions, and recent action failures."
        actions={<button onClick={refresh} title="Refresh diagnostics"><RefreshCw size={16} /> Refresh</button>}
      />
      <section className="metric-grid">
        <Metric label="Projects" value={snapshot?.projects.length ?? 0} />
        <Metric label="Workflows" value={snapshot?.workflows.length ?? 0} />
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
          <h3>Recent blocked or failed actions</h3>
          {failedLogs.length === 0 ? <p>No recent blocked or failed actions.</p> : failedLogs.map((log) => (
            <p key={log.id}><strong>{log.tool_name}</strong>: {log.error_message ?? log.status}</p>
          ))}
        </div>
      </section>
    </div>
  );
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
