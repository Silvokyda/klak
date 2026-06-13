import { useEffect, useState } from "react";
import { ScreenHeader } from "../../components/ScreenHeader";
import type { ActionLog } from "../../types";
import { listActionLogs } from "../../lib/logs/actionLogRepository";

export function LogsScreen() {
  const [logs, setLogs] = useState<ActionLog[]>([]);

  useEffect(() => {
    listActionLogs().then(setLogs);
  }, []);

  return (
    <div className="screen">
      <ScreenHeader title="Audit Logs" subtitle="Every proposed, approved, denied, blocked, failed, or completed action is listed here." />
      <section className="table">
        <div className="table-head">
          <span>Tool</span>
          <span>Status</span>
          <span>Risk</span>
          <span>Approved</span>
          <span>Created</span>
        </div>
        {logs.map((log) => (
          <div className="table-row" key={log.id}>
            <span>{log.tool_name}<small>{log.input_summary}</small></span>
            <span>{log.status}</span>
            <span className={`risk risk-${log.risk_level}`}>{log.risk_level}</span>
            <span>{log.user_approved === null ? "pending" : log.user_approved ? "yes" : "no"}</span>
            <span>{new Date(log.created_at).toLocaleString()}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
