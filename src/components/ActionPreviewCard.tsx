import { Check, X } from "lucide-react";
import type { ActionPreview, AppSettings } from "../types";
import { approveAction, denyAction } from "../lib/permissions/policy";
import { executeApprovedTool } from "../lib/tools/toolExecutor";

interface Props {
  preview: ActionPreview;
  settings: AppSettings;
  onDone: () => void;
}

export function ActionPreviewCard({ preview, settings, onDone }: Props) {
  async function approve() {
    await approveAction(preview.id);
    await executeApprovedTool(preview, settings);
    onDone();
  }

  async function deny() {
    await denyAction(preview.id);
    onDone();
  }

  return (
    <section className="preview">
      <div>
        <span className={`risk risk-${preview.riskLevel}`}>{preview.riskLevel}</span>
        <h3>{preview.message}</h3>
        <p>Tool: {preview.tool.label}</p>
        <p>Data: {preview.inputSummary || "No input data"}</p>
      </div>
      <div className="row">
        <button className="primary" disabled={!preview.canRun} onClick={approve} title="Approve action">
          <Check size={16} />
          Approve
        </button>
        <button onClick={deny} title="Deny action">
          <X size={16} />
          Deny
        </button>
      </div>
      {!preview.canRun && <p className="warning">This action is blocked by the current mode or MVP safety policy.</p>}
    </section>
  );
}
