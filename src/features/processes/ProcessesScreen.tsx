import { invoke } from "@tauri-apps/api/core";
import { RefreshCw, Square, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ScreenHeader } from "../../components/ScreenHeader";
import type { BackgroundProcessRecord, ProjectRecord } from "../../types";
import { createActionLog, updateActionLog } from "../../lib/logs/actionLogRepository";
import {
  deleteBackgroundProcess,
  listBackgroundProcesses,
  markProcessStopped,
  updateBackgroundProcess
} from "../../lib/processes/backgroundProcessRepository";
import { listProjects } from "../../lib/projects/projectRepository";

export function ProcessesScreen() {
  const [processes, setProcesses] = useState<BackgroundProcessRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [output, setOutput] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const projectName = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);

  async function refresh() {
    const [nextProcesses, nextProjects] = await Promise.all([listBackgroundProcesses(), listProjects()]);
    setProjects(nextProjects);
    setProcesses(nextProcesses);
    await Promise.all(nextProcesses.filter((process) => process.status === "starting" || process.status === "running").map(refreshStatus));
    setProcesses(await listBackgroundProcesses());
  }

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(interval);
  }, []);

  async function refreshStatus(process: BackgroundProcessRecord) {
    if (process.status === "stale") return;
    try {
      const status = await invoke<{ running: boolean; status: string; pid: number | null; exit_code: number | null }>("get_background_process_status", {
        input: { process_id: process.id }
      });
      await updateBackgroundProcess(process.id, {
        status: status.status as BackgroundProcessRecord["status"],
        process_pid: status.pid ?? process.process_pid ?? null,
        exit_code: status.exit_code,
        stopped_at: status.running ? null : new Date().toISOString(),
        last_output_preview: status.status === "stale" ? "This activity is from a previous Klak session and is no longer controlled by Klak." : process.last_output_preview
      });
    } catch {
      await markProcessStopped(process.id, { status: "stale", last_output_preview: "Klak cannot confirm this previous activity is still managed." });
    }
  }

  async function stop(process: BackgroundProcessRecord, force = false) {
    setMessage(null);
    const audit = await createActionLog({
      tool_name: force ? "force_stop_activity" : "stop_activity",
      input_summary: `${process.name} (${process.id})`,
      risk_level: "medium",
      status: "running",
      user_approved: true
    });
    try {
      if (process.status === "stale") {
        const explanation = "This activity was started in a previous Klak session and is no longer controlled by Klak. Klak will not stop arbitrary system processes.";
        await updateActionLog(audit.id, { status: "blocked", completed_at: new Date().toISOString(), error_message: explanation });
        setMessage(explanation);
        return;
      }
      if (!["starting", "running"].includes(process.status)) {
        const explanation = "This activity is already stopped or finished.";
        await updateActionLog(audit.id, { status: "completed", completed_at: new Date().toISOString(), error_message: explanation });
        setMessage(explanation);
        return;
      }
      const status = await invoke<{ status: string; exit_code: number | null }>("stop_background_process", {
        input: { process_id: process.id, force }
      });
      await markProcessStopped(process.id, { status: status.status as BackgroundProcessRecord["status"], exit_code: status.exit_code });
      await updateActionLog(audit.id, { status: "completed", completed_at: new Date().toISOString(), error_message: null });
      await refresh();
    } catch (error) {
      await updateActionLog(audit.id, { status: "failed", completed_at: new Date().toISOString(), error_message: error instanceof Error ? error.message : String(error) });
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function readOutput(process: BackgroundProcessRecord) {
    if (!process.output_log_path) {
      setOutput("No output log path recorded.");
      return;
    }
    const result = await invoke<{ output: string; warning?: string | null }>("read_background_process_output", {
      outputLogPath: process.output_log_path
    });
    setOutput(`${result.warning ? `${result.warning}\n\n` : ""}${result.output || "No output yet."}`);
  }

  return (
    <div className="screen">
      <ScreenHeader
        title="Running Activities"
        subtitle="Activities Klak started from approved saved actions. Klak only stops activities it currently manages."
        actions={<button onClick={refresh} title="Refresh activity status"><RefreshCw size={16} /> Refresh</button>}
      />
      {message && <p className="warning">{message}</p>}
      {output && <pre className="preview-text">{output}</pre>}
      <section className="list">
        {processes.length === 0 && <p className="inline-status">No running or recent activities yet.</p>}
        {processes.map((process) => (
          <article className="list-row process-row" key={process.id}>
            <div>
              <div className="row between">
                <span className="status-badge">{process.status}</span>
                <span className="tag">{process.project_id ? projectName.get(process.project_id) ?? "project" : "global"}</span>
              </div>
              <strong>{process.name}</strong>
              <small>Saved action: {process.command}</small>
              <small>Space: {process.working_directory}</small>
              <small>PID: {process.process_pid ?? "not managed"} Started: {new Date(process.started_at).toLocaleString()}</small>
              {process.stopped_at && <small>Stopped or exited: {new Date(process.stopped_at).toLocaleString()}</small>}
              {process.exit_code !== null && process.exit_code !== undefined && <small>Exit code: {process.exit_code}</small>}
              <small>{process.last_output_preview ?? process.output_log_path ?? "No recent output yet"}</small>
              {process.status === "stale" && <small className="inline-warning">This activity is from a previous Klak session. Klak cannot safely stop it.</small>}
            </div>
            <div className="row-actions">
              <button title="Refresh activity" onClick={() => refreshStatus(process).then(refresh)}><RefreshCw size={16} /></button>
              <button title="View recent output" onClick={() => readOutput(process)}>Output</button>
              <button title="Stop activity" disabled={!["starting", "running"].includes(process.status)} onClick={() => stop(process)}><Square size={16} /></button>
              <button title="Force stop managed activity" disabled={!["starting", "running"].includes(process.status)} onClick={() => stop(process, true)}>Force</button>
              <button title="Delete activity record" onClick={() => deleteBackgroundProcess(process.id).then(refresh)}><Trash2 size={16} /></button>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
