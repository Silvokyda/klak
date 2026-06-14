import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  History,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ScreenHeader } from "../../components/ScreenHeader";
import type { ActionLog } from "../../types";
import { listActionLogs } from "../../lib/logs/actionLogRepository";

type StatusFilter = "all" | "pending" | "completed" | "blocked_failed" | "denied";
type RiskFilter = "all" | "low" | "medium" | "high" | "dangerous";

export function LogsScreen() {
  const [logs, setLogs] = useState<ActionLog[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);

    try {
      setLogs(await listActionLogs());
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const visibleLogs = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    return logs.filter((log) => {
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "pending" && log.user_approved === null) ||
        (statusFilter === "completed" && log.status === "completed") ||
        (statusFilter === "blocked_failed" &&
          (log.status === "blocked" || log.status === "failed")) ||
        (statusFilter === "denied" && log.user_approved === false);

      const matchesRisk = riskFilter === "all" || log.risk_level === riskFilter;

      if (!matchesStatus || !matchesRisk) return false;
      if (!normalized) return true;

      return [
        log.tool_name,
        log.input_summary,
        log.status,
        log.risk_level,
        log.error_message ?? ""
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [logs, query, statusFilter, riskFilter]);

  const completedCount = useMemo(() => {
    return logs.filter((log) => log.status === "completed").length;
  }, [logs]);

  const blockedOrFailedCount = useMemo(() => {
    return logs.filter((log) => log.status === "blocked" || log.status === "failed").length;
  }, [logs]);

  const pendingCount = useMemo(() => {
    return logs.filter((log) => log.user_approved === null).length;
  }, [logs]);

  const approvedCount = useMemo(() => {
    return logs.filter((log) => log.user_approved === true).length;
  }, [logs]);

  return (
    <div className="screen history-screen">
      <ScreenHeader
        title="Activity History"
        subtitle="A local audit trail of proposed, approved, denied, blocked, failed, and completed actions."
        actions={
          <button onClick={refresh} disabled={refreshing} title="Refresh activity history">
            <RefreshCw size={16} /> {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        }
      />

      <section className="history-hero">
        <div>
          <span className="eyebrow">Local audit trail</span>
          <h3>See what Klak proposed, what ran, and what was blocked.</h3>
          <p>
            This screen is read-only. It helps you verify that Klak stays visible, permission-based,
            and accountable for every local action.
          </p>
        </div>

        <div className="history-hero-card">
          <ShieldCheck size={20} />
          <div>
            <strong>Accountability by default</strong>
            <span>Actions are logged locally so the user can review what happened later.</span>
          </div>
        </div>
      </section>

      <section className="history-overview">
        <HistoryMetric
          icon={<History size={18} />}
          label="Total logs"
          value={logs.length}
          hint="Local records"
        />

        <HistoryMetric
          icon={<CheckCircle2 size={18} />}
          label="Completed"
          value={completedCount}
          hint="Finished actions"
        />

        <HistoryMetric
          icon={<AlertTriangle size={18} />}
          label="Blocked or failed"
          value={blockedOrFailedCount}
          hint="Needs review"
        />

        <HistoryMetric
          icon={<Clock3 size={18} />}
          label="Pending"
          value={pendingCount}
          hint="Awaiting decision"
        />

        <HistoryMetric
          icon={<ShieldCheck size={18} />}
          label="Approved"
          value={approvedCount}
          hint="User allowed"
        />
      </section>

      <section className="history-controls">
        <div className="history-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search capability, summary, status, risk, or error"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending approval</option>
          <option value="completed">Completed</option>
          <option value="blocked_failed">Blocked or failed</option>
          <option value="denied">Denied</option>
        </select>

        <select
          value={riskFilter}
          onChange={(event) => setRiskFilter(event.target.value as RiskFilter)}
          aria-label="Filter by risk"
        >
          <option value="all">All risk levels</option>
          <option value="low">Low risk</option>
          <option value="medium">Medium risk</option>
          <option value="high">High risk</option>
          <option value="dangerous">Dangerous</option>
        </select>
      </section>

      <section className="history-list-panel">
        <div className="history-list-header">
          <div>
            <h3>Audit records</h3>
            <p className="muted">
              {visibleLogs.length} visible {visibleLogs.length === 1 ? "record" : "records"}
            </p>
          </div>
        </div>

        {visibleLogs.length === 0 ? (
          <div className="history-empty-state">
            <strong>No history records found</strong>
            <p>Run an approved action, change the filters, or clear your search.</p>
          </div>
        ) : (
          <div className="history-card-list">
            {visibleLogs.map((log) => (
              <HistoryCard key={log.id} log={log} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function HistoryMetric({
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
    <article className="history-stat-card">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

function HistoryCard({ log }: { log: ActionLog }) {
  const [showDetails, setShowDetails] = useState(false);
  const state = getLogState(log);

  return (
    <article className={`history-card history-card-${state}`}>
      <div className="history-card-header">
        <div className="history-title-area">
          <div className="history-badge-row">
            <span className={`history-status history-status-${state}`}>
              <HistoryStateIcon state={state} />
              {formatLogStatus(log)}
            </span>

            <span className={`risk risk-${log.risk_level}`}>{formatRisk(log.risk_level)}</span>

            <span className="tag">{formatApproval(log.user_approved)}</span>
          </div>

          <h4>{formatToolName(log.tool_name)}</h4>
          <p>{log.input_summary || "No summary recorded."}</p>
        </div>

        <div className="history-card-actions">
          <button onClick={() => setShowDetails((value) => !value)}>
            {showDetails ? "Hide details" : "Details"}
          </button>
        </div>
      </div>

      <div className="history-summary-grid">
        <div>
          <span>Status</span>
          <strong>{formatLogStatus(log)}</strong>
        </div>

        <div>
          <span>Created</span>
          <strong>{formatDate(log.created_at)}</strong>
        </div>

        <div>
          <span>Approval</span>
          <strong>{formatApproval(log.user_approved)}</strong>
        </div>
      </div>

      {log.error_message && (
        <p className="history-error-note">
          {log.error_message}
        </p>
      )}

      {showDetails && (
        <div className="history-details">
          <div>
            <span className="detail-label">Capability</span>
            <strong>{formatToolName(log.tool_name)}</strong>
          </div>

          <div>
            <span className="detail-label">Raw capability name</span>
            <code>{log.tool_name}</code>
          </div>

          <div>
            <span className="detail-label">Input summary</span>
            <p>{log.input_summary || "No summary recorded."}</p>
          </div>

          <div>
            <span className="detail-label">Risk level</span>
            <strong>{formatRisk(log.risk_level)}</strong>
          </div>

          <div>
            <span className="detail-label">Created</span>
            <strong>{formatDate(log.created_at)}</strong>
          </div>

          <div>
            <span className="detail-label">Completed</span>
            <strong>{log.completed_at ? formatDate(log.completed_at) : "Not completed"}</strong>
          </div>

          <div>
            <span className="detail-label">User approval</span>
            <strong>{formatApproval(log.user_approved)}</strong>
          </div>

          <div>
            <span className="detail-label">Error or block reason</span>
            <p>{log.error_message || "None recorded."}</p>
          </div>
        </div>
      )}
    </article>
  );
}

function HistoryStateIcon({ state }: { state: string }) {
  if (state === "completed") return <CheckCircle2 size={14} />;
  if (state === "blocked" || state === "failed" || state === "denied") return <XCircle size={14} />;
  if (state === "pending") return <Clock3 size={14} />;
  return <AlertTriangle size={14} />;
}

function getLogState(log: ActionLog): string {
  if (log.user_approved === false) return "denied";
  if (log.user_approved === null) return "pending";
  if (log.status === "completed") return "completed";
  if (log.status === "blocked") return "blocked";
  if (log.status === "failed") return "failed";

  return "running";
}

function formatLogStatus(log: ActionLog): string {
  if (log.user_approved === false) return "Denied";
  if (log.user_approved === null) return "Pending";

  return formatWords(log.status);
}

function formatApproval(value: boolean | null): string {
  if (value === null) return "Pending";
  return value ? "Approved" : "Denied";
}

function formatToolName(value: string): string {
  return formatWords(value);
}

function formatRisk(value: string): string {
  return formatWords(value);
}

function formatWords(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Unknown";

  return date.toLocaleString();
}