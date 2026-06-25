import { CheckCircle2, Hand, PauseCircle, PlayCircle, ShieldAlert, StopCircle } from "lucide-react";
import type { AppSettings, OperatorTaskRunHydrated, OperatorTaskStepHydrated } from "../types";
import {
  approveOperatorTaskStep,
  completeManualOperatorStep,
  denyOperatorTaskStep,
  runOperatorTask
} from "../lib/operator/operatorRuntime";

interface Props {
  run: OperatorTaskRunHydrated | null;
  settings: AppSettings;
  onChange: (run: OperatorTaskRunHydrated | null) => void;
}

export function OperatorTaskPanel({ run, settings, onChange }: Props) {
  if (!run) {
    return (
      <section className="operator-task-panel empty">
        <div className="empty-action-state">
          <PlayCircle size={28} />
          <strong>No active operator task</strong>
          <p>Use Run Task to turn a goal into a bounded observe-plan-act-verify run.</p>
        </div>
      </section>
    );
  }

  const activeRun = run;
  const currentStep = activeRun.steps.find((step) => step.id === activeRun.current_step_id) ?? activeRun.steps.find((step) => step.status !== "completed") ?? null;
  const completedCount = activeRun.steps.filter((step) => step.status === "completed").length;

  async function continueRun() {
    onChange(await runOperatorTask(activeRun.id, settings));
  }

  async function approveCurrentStep(step: OperatorTaskStepHydrated) {
    onChange(await approveOperatorTaskStep(activeRun.id, step.id, settings));
  }

  async function denyCurrentStep(step: OperatorTaskStepHydrated) {
    onChange(await denyOperatorTaskStep(activeRun.id, step.id, "You denied this operator step."));
  }

  async function completeManualStep(step: OperatorTaskStepHydrated) {
    onChange(await completeManualOperatorStep(activeRun.id, step.id, "Manual takeover completed.", settings));
  }

  return (
    <section className="operator-task-panel">
      <div className="operator-task-hero">
        <div>
          <span className={`status-badge status-${activeRun.status}`}>{activeRun.status.replace(/_/g, " ")}</span>
          <h3>{activeRun.goal}</h3>
          <p>{activeRun.plan.summary}</p>
        </div>

        <div className="operator-task-progress">
          <strong>{completedCount}/{activeRun.steps.length}</strong>
          <span>steps complete</span>
        </div>
      </div>

      {currentStep && (
        <div className="operator-current-step">
          <div className="operator-step-header">
            <div>
              <small>Current step</small>
              <h4>{currentStep.title}</h4>
            </div>
            <span className={`risk risk-${riskTone(currentStep.status)}`}>{currentStep.execution_method.replace(/_/g, " ")}</span>
          </div>

          <p>{currentStep.intent}</p>

          <div className="operator-step-meta">
            <span>Approval: {currentStep.approval_required.replace(/_/g, " ")}</span>
            <span>Verification: {currentStep.verification.type}</span>
            <span>Retries: {currentStep.retry_count}/{currentStep.max_retries}</span>
          </div>

          {currentStep.result_summary && <p className="warning">{currentStep.result_summary}</p>}

          <div className="operator-step-actions">
            {activeRun.status !== "completed" && activeRun.status !== "cancelled" && activeRun.status !== "failed" && (
              <button className="primary" onClick={() => continueRun()}>
                <PlayCircle size={16} />
                {activeRun.status === "awaiting_approval" ? "Refresh" : "Continue"}
              </button>
            )}

            {currentStep.status === "awaiting_approval" && (
              <>
                <button className="primary" onClick={() => approveCurrentStep(currentStep)}>
                  <CheckCircle2 size={16} />
                  Approve step
                </button>
                <button onClick={() => denyCurrentStep(currentStep)}>
                  <StopCircle size={16} />
                  Deny
                </button>
              </>
            )}

            {currentStep.status === "awaiting_manual" && (
              <button onClick={() => completeManualStep(currentStep)}>
                <Hand size={16} />
                Mark manual step done
              </button>
            )}
          </div>
        </div>
      )}

      <div className="operator-task-grid">
        <section className="operator-plan-list">
          <div className="preview-panel-header">
            <div>
              <h3>Plan</h3>
              <p>Structured steps with verification and fallback state.</p>
            </div>
          </div>

          <div className="operator-plan-items">
            {activeRun.steps.map((step) => (
              <article key={step.id} className={`operator-plan-item status-${step.status}`}>
                <div className="operator-plan-marker">
                  {step.status === "completed" ? <CheckCircle2 size={16} /> : step.status === "awaiting_manual" ? <Hand size={16} /> : step.status === "awaiting_approval" ? <ShieldAlert size={16} /> : <PauseCircle size={16} />}
                </div>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.intent}</p>
                  <span>{step.status.replace(/_/g, " ")} / {step.verification.type}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="operator-plan-list">
          <div className="preview-panel-header">
            <div>
              <h3>Completion report</h3>
              <p>Task outcome, recoveries, and remaining work.</p>
            </div>
          </div>
          <pre className="operator-report">{activeRun.final_report ?? "The report will appear here when Klak completes or pauses the run."}</pre>
        </section>
      </div>
    </section>
  );
}

function riskTone(status: OperatorTaskStepHydrated["status"]) {
  if (status === "failed" || status === "blocked") return "high";
  if (status === "awaiting_approval" || status === "awaiting_manual") return "medium";
  return "low";
}
