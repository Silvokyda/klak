import { invoke } from "@tauri-apps/api/core";
import { RefreshCw, Square, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ScreenHeader } from "../../components/ScreenHeader";
import type { BackgroundProcessRecord, ProjectRecord } from "../../types";
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
    try {
      const status = await invoke<{ running: boolean; status: string; pid: number | null; exit_code: number | null }>("get_background_process_status", {
        input: { process_id: process.id }
      });
      await updateBackgroundProcess(process.id, {
        status: status.status as BackgroundProcessRecord["status"],
        process_pid: status.pid ?? process.process_pid ?? null,
        exit_code: status.exit_code,
        stopped_at: status.running ? null : new Date().toISOString()
      });
    } catch {
      await markProcessStopped(process.id, { status: "failed", last_output_preview: "Unable to query native process status." });
    }
  }

  async function stop(process: BackgroundProcessRecord, force = false) {
    setMessage(null);
    try {
      const status = await invoke<{ status: string; exit_code: number | null }>("stop_background_process", {
        input: { process_id: process.id, force }
      });
      await markProcessStopped(process.id, { status: status.status as BackgroundProcessRecord["status"], exit_code: status.exit_code });
      await refresh();
    } catch (error) {
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
        title="Processes"
        subtitle="Klak-managed background processes started from approved command templates."
        actions={<button onClick={refresh} title="Refresh process status"><RefreshCw size={16} /> Refresh</button>}
      />
      {message && <p className="warning">{message}</p>}
      {output && <pre className="preview-text">{output}</pre>}
      <section className="list">
        {processes.map((process) => (
          <article className="list-row process-row" key={process.id}>
            <div>
              <div className="row between">
                <span className="status-badge">{process.status}</span>
                <span className="tag">{process.project_id ? projectName.get(process.project_id) ?? "project" : "global"}</span>
              </div>
              <strong>{process.name}</strong>
              <small>{process.command}</small>
              <small>{process.working_directory}</small>
              <small>PID: {process.process_pid ?? "none"} Started: {new Date(process.started_at).toLocaleString()}</small>
              <small>{process.last_output_preview ?? process.output_log_path ?? "No output yet"}</small>
            </div>
            <div className="row-actions">
              <button title="Refresh process" onClick={() => refreshStatus(process).then(refresh)}><RefreshCw size={16} /></button>
              <button title="View recent output" onClick={() => readOutput(process)}>Output</button>
              <button title="Stop process" disabled={!["starting", "running"].includes(process.status)} onClick={() => stop(process)}><Square size={16} /></button>
              <button title="Force stop process" disabled={!["starting", "running"].includes(process.status)} onClick={() => stop(process, true)}>Force</button>
              <button title="Delete process record" onClick={() => deleteBackgroundProcess(process.id).then(refresh)}><Trash2 size={16} /></button>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
