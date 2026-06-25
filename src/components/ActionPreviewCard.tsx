import { Check, X } from "lucide-react";
import { useState } from "react";
import type { ActionPreview, AppSettings } from "../types";
import { approveAction, denyAction } from "../lib/permissions/policy";
import { executeApprovedTool } from "../lib/tools/toolExecutor";

interface Props {
  preview: ActionPreview;
  settings?: AppSettings;
  onApprove?: () => Promise<void>;
  onDeny?: () => Promise<void>;
  onDone: () => void;
}

export function ActionPreviewCard({ preview, settings, onApprove, onDeny, onDone }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function approve() {
    setError(null);
    setRunning(true);
    try {
      if (onApprove) {
        await onApprove();
      } else {
        if (!settings) throw new Error("Settings are required to execute this preview.");
        await approveAction(preview.id);
        await executeApprovedTool(preview, settings);
      }
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setRunning(false);
    }
  }

  async function deny() {
    if (onDeny) {
      await onDeny();
    } else {
      await denyAction(preview.id);
    }
    onDone();
  }

  return (
    <section className="preview">
      <div>
        <span className={`risk risk-${preview.riskLevel}`}>{preview.riskLevel}</span>
        <h3>{preview.message}</h3>
        <p>Capability: {preview.tool.label}</p>
        <p>Data: {preview.inputSummary || "No input data"}</p>
      </div>
      <div className="row">
        <button className="primary" disabled={!preview.canRun || running} onClick={approve} title="Approve action">
          <Check size={16} />
          {running ? "Running" : "Approve"}
        </button>
        <button onClick={deny} disabled={running} title="Deny action">
          <X size={16} />
          Deny
        </button>
        {running && <button onClick={() => setRunning(false)} title="Stop current UI action">Stop</button>}
      </div>
      {!preview.canRun && <p className="warning">This action is blocked by the current mode or MVP safety policy.</p>}
      {error && <p className="warning">{error}</p>}
    </section>
  );
}
