import { invoke } from "@tauri-apps/api/core";
import {
  Activity,
  Clock3,
  FolderKanban,
  RefreshCw,
  Search,
  Square,
  Terminal,
  Trash2
} from "lucide-react";
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

type ActivityFilter = "all" | "active" | "finished" | "stale";

export function ProcessesScreen() {
  const [processes, setProcesses] = useState<BackgroundProcessRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [selectedOutput, setSelectedOutput] = useState<{ title: string; content: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const projectName = useMemo(() => {
    return new Map(projects.map((project) => [project.id, project.name]));
  }, [projects]);

  const visibleProcesses = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    return processes.filter((process) => {
      const active = isManagedActive(process);
      const matchesFilter =
        filter === "all" ||
        (filter === "active" && active) ||
        (filter === "finished" && !active && process.status !== "stale") ||
        (filter === "stale" && process.status === "stale");

      if (!matchesFilter) return false;
      if (!normalized) return true;

      const linkedProject = process.project_id ? projectName.get(process.project_id) : "global";

      return [
        process.name,
        process.command,
        process.status,
        process.working_directory,
        process.last_output_preview,
        linkedProject
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [processes, projectName, query, filter]);

  const activeCount = useMemo(() => {
    return processes.filter(isManagedActive).length;
  }, [processes]);

  const staleCount = useMemo(() => {
    return processes.filter((process) => process.status === "stale").length;
  }, [processes]);

  const projectLinkedCount = useMemo(() => {
    return processes.filter((process) => Boolean(process.project_id)).length;
  }, [processes]);

  async function refresh() {
    const [nextProcesses, nextProjects] = await Promise.all([
      listBackgroundProcesses(),
      listProjects()
    ]);

    setProjects(nextProjects);
    setProcesses(nextProcesses);

    await Promise.all(nextProcesses.filter(isManagedActive).map(refreshStatus));

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
      const status = await invoke<{
        running: boolean;
        status: string;
        pid: number | null;
        exit_code: number | null;
      }>("get_background_process_status", {
        input: { process_id: process.id }
      });

      await updateBackgroundProcess(process.id, {
        status: status.status as BackgroundProcessRecord["status"],
        process_pid: status.pid ?? process.process_pid ?? null,
        exit_code: status.exit_code,
        stopped_at: status.running ? null : new Date().toISOString(),
        last_output_preview:
          status.status === "stale"
            ? "This activity is from a previous Klak session and is no longer controlled by Klak."
            : process.last_output_preview
      });
    } catch {
      await markProcessStopped(process.id, {
        status: "stale",
        last_output_preview: "Klak cannot confirm this previous activity is still managed."
      });
    }
  }

  async function stop(process: BackgroundProcessRecord, force = false) {
    setMessage(null);

    if (force) {
      const confirmed = window.confirm(
        `Force stop "${process.name}"? Use this only if the normal stop does not work.`
      );

      if (!confirmed) return;
    }

    const audit = await createActionLog({
      tool_name: force ? "force_stop_activity" : "stop_activity",
      input_summary: `${process.name} (${process.id})`,
      risk_level: "medium",
      status: "running",
      user_approved: true
    });

    try {
      if (process.status === "stale") {
        const explanation =
          "This activity was started in a previous Klak session and is no longer controlled by Klak. Klak will not stop arbitrary system processes.";

        await updateActionLog(audit.id, {
          status: "blocked",
          completed_at: new Date().toISOString(),
          error_message: explanation
        });

        setMessage(explanation);
        return;
      }

      if (!isManagedActive(process)) {
        const explanation = "This activity is already stopped or finished.";

        await updateActionLog(audit.id, {
          status: "completed",
          completed_at: new Date().toISOString(),
          error_message: explanation
        });

        setMessage(explanation);
        return;
      }

      const status = await invoke<{ status: string; exit_code: number | null }>(
        "stop_background_process",
        {
          input: { process_id: process.id, force }
        }
      );

      await markProcessStopped(process.id, {
        status: status.status as BackgroundProcessRecord["status"],
        exit_code: status.exit_code
      });

      await updateActionLog(audit.id, {
        status: "completed",
        completed_at: new Date().toISOString(),
        error_message: null
      });

      await refresh();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      await updateActionLog(audit.id, {
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: errorMessage
      });

      setMessage(errorMessage);
    }
  }

  async function readOutput(process: BackgroundProcessRecord) {
    setMessage(null);

    if (!process.output_log_path) {
      setSelectedOutput({
        title: process.name,
        content: "No output log path recorded."
      });
      return;
    }

    const result = await invoke<{ output: string; warning?: string | null }>(
      "read_background_process_output",
      {
        outputLogPath: process.output_log_path
      }
    );

    setSelectedOutput({
      title: process.name,
      content: `${result.warning ? `${result.warning}\n\n` : ""}${result.output || "No output yet."}`
    });
  }

  async function deleteRecord(process: BackgroundProcessRecord) {
    setMessage(null);

    if (isManagedActive(process)) {
      setMessage("Stop this activity before deleting its local record.");
      return;
    }

    const confirmed = window.confirm(
      `Delete the local activity record for "${process.name}"? This does not delete any project files.`
    );

    if (!confirmed) return;

    await deleteBackgroundProcess(process.id);
    await refresh();
  }

  return (
    <div className="screen processes-screen">
      <ScreenHeader
        title="Running Activities"
        subtitle="Visible background work started by Klak from approved saved actions."
        actions={
          <button onClick={refresh} title="Refresh activity status">
            <RefreshCw size={16} /> Refresh
          </button>
        }
      />

      <section className="processes-hero">
        <div>
          <span className="eyebrow">Managed activities</span>
          <h3>Klak only tracks and stops activities it started.</h3>
          <p>
            This is not a full system task manager. Stale or unmanaged activity is shown for
            transparency, but Klak will not stop arbitrary Windows processes.
          </p>
        </div>

        <div className="processes-hero-card">
          <Terminal size={20} />
          <div>
            <strong>Visible control</strong>
            <span>Background work stays reviewable, refreshable, and stoppable from here.</span>
          </div>
        </div>
      </section>

      <section className="process-overview">
        <div className="process-stat-card">
          <Activity size={18} />
          <span>Total records</span>
          <strong>{processes.length}</strong>
          <small>Recent Klak-started activities</small>
        </div>

        <div className="process-stat-card">
          <Square size={18} />
          <span>Active</span>
          <strong>{activeCount}</strong>
          <small>Starting or running now</small>
        </div>

        <div className="process-stat-card">
          <FolderKanban size={18} />
          <span>Project linked</span>
          <strong>{projectLinkedCount}</strong>
          <small>Connected to saved projects</small>
        </div>

        <div className="process-stat-card">
          <Clock3 size={18} />
          <span>Stale</span>
          <strong>{staleCount}</strong>
          <small>From previous sessions</small>
        </div>
      </section>

      <section className="process-controls">
        <div className="process-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search activities, commands, projects, or folders"
          />
        </div>

        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as ActivityFilter)}
          aria-label="Filter activities"
        >
          <option value="all">All activities</option>
          <option value="active">Active only</option>
          <option value="finished">Finished</option>
          <option value="stale">Stale</option>
        </select>
      </section>

      {(message || selectedOutput) && (
        <section className="process-feedback-panel">
          {message && <p className="warning">{message}</p>}

          {selectedOutput && (
            <div className="process-output-panel">
              <div className="process-output-header">
                <div>
                  <strong>Output</strong>
                  <span>{selectedOutput.title}</span>
                </div>

                <button onClick={() => setSelectedOutput(null)}>Close</button>
              </div>

              <pre className="preview-text">{selectedOutput.content}</pre>
            </div>
          )}
        </section>
      )}

      <section className="process-list-panel">
        <div className="process-list-header">
          <div>
            <h3>Activity records</h3>
            <p className="muted">
              {visibleProcesses.length} visible{" "}
              {visibleProcesses.length === 1 ? "activity" : "activities"}
            </p>
          </div>
        </div>

        {visibleProcesses.length === 0 ? (
          <div className="process-empty-state">
            <strong>No activities found</strong>
            <p>Run an approved saved action, change the filter, or clear your search.</p>
          </div>
        ) : (
          <div className="process-card-list">
            {visibleProcesses.map((process) => (
              <ProcessCard
                key={process.id}
                process={process}
                projectName={
                  process.project_id ? projectName.get(process.project_id) ?? "Project" : "Global"
                }
                onRefresh={async () => {
                  await refreshStatus(process);
                  await refresh();
                }}
                onReadOutput={readOutput}
                onStop={stop}
                onDelete={deleteRecord}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ProcessCard({
  process,
  projectName,
  onRefresh,
  onReadOutput,
  onStop,
  onDelete
}: {
  process: BackgroundProcessRecord;
  projectName: string;
  onRefresh: () => Promise<void>;
  onReadOutput: (process: BackgroundProcessRecord) => Promise<void>;
  onStop: (process: BackgroundProcessRecord, force?: boolean) => Promise<void>;
  onDelete: (process: BackgroundProcessRecord) => Promise<void>;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const active = isManagedActive(process);

  return (
    <article className="process-card">
      <div className="process-card-header">
        <div className="process-title-area">
          <div className="process-badge-row">
            <span className={`process-status process-status-${String(process.status).replace(/_/g, "-")}`}>
              {formatActivityStatus(process.status)}
            </span>
            <span className="tag">{projectName}</span>
          </div>

          <h4>{process.name}</h4>

          <p>
            {process.last_output_preview ??
              "No recent output yet. Open the output panel to check the activity log."}
          </p>
        </div>

        <div className="process-card-actions">
          <button onClick={() => setShowDetails((value) => !value)}>
            {showDetails ? "Hide details" : "Details"}
          </button>

          <button title="Refresh activity" onClick={onRefresh}>
            <RefreshCw size={16} />
          </button>

          <button title="Delete activity record" className="danger-button" onClick={() => onDelete(process)}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <div className="process-summary-grid">
        <div>
          <span>Status</span>
          <strong>{formatActivityStatus(process.status)}</strong>
        </div>

        <div>
          <span>Started</span>
          <strong>{formatDate(process.started_at)}</strong>
        </div>

        <div>
          <span>Project</span>
          <strong>{projectName}</strong>
        </div>
      </div>

      {process.status === "stale" && (
        <p className="process-safety-note">
          This activity is from a previous Klak session. Klak cannot safely stop it.
        </p>
      )}

      <div className="process-action-row">
        <button onClick={() => onReadOutput(process)}>View output</button>

        <button disabled={!active} onClick={() => onStop(process)}>
          <Square size={16} /> Stop
        </button>

        <button disabled={!active} onClick={() => onStop(process, true)}>
          Force stop
        </button>
      </div>

      {showDetails && (
        <div className="process-details">
          <div>
            <span className="detail-label">Saved action</span>
            <code>{process.command}</code>
          </div>

          <div>
            <span className="detail-label">Working folder</span>
            <code>{process.working_directory}</code>
          </div>

          <div>
            <span className="detail-label">PID</span>
            <strong>{process.process_pid ?? "Not managed"}</strong>
          </div>

          <div>
            <span className="detail-label">Exit code</span>
            <strong>
              {process.exit_code !== null && process.exit_code !== undefined
                ? process.exit_code
                : "Not available"}
            </strong>
          </div>

          <div>
            <span className="detail-label">Stopped or exited</span>
            <strong>{process.stopped_at ? formatDate(process.stopped_at) : "Still active or unknown"}</strong>
          </div>

          <div>
            <span className="detail-label">Output log</span>
            <code>{process.output_log_path || "Not recorded"}</code>
          </div>
        </div>
      )}
    </article>
  );
}

function isManagedActive(process: BackgroundProcessRecord): boolean {
  return process.status === "starting" || process.status === "running";
}

function formatActivityStatus(status: BackgroundProcessRecord["status"]): string {
  return String(status)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Unknown";

  return date.toLocaleString();
}