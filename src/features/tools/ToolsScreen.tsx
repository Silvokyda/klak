import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Lock,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  ToggleLeft,
  Wrench
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ScreenHeader } from "../../components/ScreenHeader";
import type { AppSettings, ToolDefinition } from "../../types";
import { listTools, setToolEnabled } from "../../lib/tools/toolRegistry";

type CapabilityFilter = "all" | "enabled" | "available" | "locked";

export function ToolsScreen({
  settings,
  onSettingsChange
}: {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
}) {
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CapabilityFilter>("all");
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    setTools(await listTools(settings.allToolsDisabled));
  }

  useEffect(() => {
    void refresh();
  }, [settings.allToolsDisabled]);

  const visibleTools = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    return tools.filter((tool) => {
      const locked = isCapabilityLocked(tool);
      const available = !locked;

      const matchesFilter =
        filter === "all" ||
        (filter === "enabled" && tool.enabled) ||
        (filter === "available" && available) ||
        (filter === "locked" && locked);

      if (!matchesFilter) return false;
      if (!normalized) return true;

      return [tool.label, tool.description, tool.name, tool.riskLevel]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [tools, query, filter]);

  const enabledCount = useMemo(() => {
    return tools.filter((tool) => tool.enabled && !isCapabilityLocked(tool)).length;
  }, [tools]);

  const availableCount = useMemo(() => {
    return tools.filter((tool) => !isCapabilityLocked(tool)).length;
  }, [tools]);

  const lockedCount = useMemo(() => {
    return tools.filter(isCapabilityLocked).length;
  }, [tools]);

  const riskyEnabledCount = useMemo(() => {
    return tools.filter(
      (tool) => tool.enabled && (tool.riskLevel === "high" || tool.riskLevel === "dangerous")
    ).length;
  }, [tools]);

  async function toggleAllToolsDisabled(disabled: boolean) {
    setMessage(null);
    onSettingsChange({ ...settings, allToolsDisabled: disabled });
    setMessage(disabled ? "All capabilities are disabled." : "Capabilities can now be enabled individually.");
  }

  async function toggleTool(tool: ToolDefinition, enabled: boolean) {
    setMessage(null);

    if (isCapabilityLocked(tool)) {
      setMessage("This capability is locked because it is future-only or too risky.");
      return;
    }

    if (settings.allToolsDisabled) {
      setMessage("Disable All is currently on. Turn it off before enabling individual capabilities.");
      return;
    }

    if (enabled && tool.riskLevel === "high") {
      const confirmed = window.confirm(
        `Enable "${tool.label}"? This is marked high risk and should only be enabled if you understand what it can do.`
      );

      if (!confirmed) return;
    }

    await setToolEnabled(tool.name, enabled);
    await refresh();
    setMessage(enabled ? `${tool.label} enabled.` : `${tool.label} disabled.`);
  }

  return (
    <div className="screen capabilities-screen">
      <ScreenHeader
        title="Capabilities"
        subtitle="Control which local tools Klak may use. Future and dangerous capabilities stay locked."
        actions={
          <label className="capability-master-toggle">
            <input
              type="checkbox"
              checked={settings.allToolsDisabled}
              onChange={(event) => toggleAllToolsDisabled(event.target.checked)}
            />
            <span>Disable all</span>
          </label>
        }
      />

      <section className="capabilities-hero">
        <div>
          <span className="eyebrow">Permission dashboard</span>
          <h3>{settings.allToolsDisabled ? "All capabilities are currently disabled." : "Enable only what Klak needs."}</h3>
          <p>
            Capabilities define what Klak can prepare or run locally. Keep this list narrow,
            review risk labels, and leave future or dangerous tools locked.
          </p>
        </div>

        <div className="capabilities-hero-card">
          <ShieldCheck size={20} />
          <div>
            <strong>{settings.allToolsDisabled ? "Safe lockdown" : "User-controlled"}</strong>
            <span>
              {settings.allToolsDisabled
                ? "No capability can be used until Disable All is turned off."
                : "Each capability can still be enabled or disabled one by one."}
            </span>
          </div>
        </div>
      </section>

      {message && <p className="inline-status">{message}</p>}

      <section className="capability-overview">
        <CapabilityMetric
          icon={<Wrench size={18} />}
          label="Total capabilities"
          value={`${tools.length}`}
          hint="Known local tools"
        />

        <CapabilityMetric
          icon={<CheckCircle2 size={18} />}
          label="Enabled"
          value={`${enabledCount}`}
          hint="Available for Klak"
        />

        <CapabilityMetric
          icon={<SlidersHorizontal size={18} />}
          label="Available"
          value={`${availableCount}`}
          hint="Can be toggled"
        />

        <CapabilityMetric
          icon={<Lock size={18} />}
          label="Locked"
          value={`${lockedCount}`}
          hint="Future or dangerous"
        />

        <CapabilityMetric
          icon={<AlertTriangle size={18} />}
          label="High risk enabled"
          value={`${riskyEnabledCount}`}
          hint="Review carefully"
        />
      </section>

      <section className="capability-controls">
        <div className="capability-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search capabilities by name, risk, or description"
          />
        </div>

        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as CapabilityFilter)}
          aria-label="Filter capabilities"
        >
          <option value="all">All capabilities</option>
          <option value="enabled">Enabled</option>
          <option value="available">Available</option>
          <option value="locked">Locked</option>
        </select>
      </section>

      <section className="capability-safety-note">
        <AlertTriangle size={18} />
        <div>
          <strong>Keep Klak conservative.</strong>
          <span>
            Enabling a capability does not mean Klak should act silently. Risky actions should still use
            previews, approvals, and visible audit logs.
          </span>
        </div>
      </section>

      <section className="capability-list-panel">
        <div className="capability-list-header">
          <div>
            <h3>Local capabilities</h3>
            <p className="muted">
              {visibleTools.length} visible {visibleTools.length === 1 ? "capability" : "capabilities"}
            </p>
          </div>
        </div>

        {visibleTools.length === 0 ? (
          <div className="capability-empty-state">
            <strong>No capabilities found</strong>
            <p>Change the filter or clear your search.</p>
          </div>
        ) : (
          <div className="capability-card-grid">
            {visibleTools.map((tool) => (
              <CapabilityCard
                key={tool.name}
                tool={tool}
                allToolsDisabled={settings.allToolsDisabled}
                onToggle={toggleTool}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function CapabilityCard({
  tool,
  allToolsDisabled,
  onToggle
}: {
  tool: ToolDefinition;
  allToolsDisabled: boolean;
  onToggle: (tool: ToolDefinition, enabled: boolean) => Promise<void>;
}) {
  const locked = isCapabilityLocked(tool);
  const disabled = allToolsDisabled || locked;

  return (
    <article className={`capability-card ${locked ? "capability-card-locked" : ""}`}>
      <div className="capability-card-top">
        <div className="capability-risk-row">
          <span className={`risk risk-${tool.riskLevel}`}>{formatRiskLevel(tool.riskLevel)}</span>
          {tool.future && <span className="tag">Future</span>}
          {tool.riskLevel === "dangerous" && <span className="tag">Locked</span>}
        </div>

        <CapabilityStateBadge tool={tool} allToolsDisabled={allToolsDisabled} />
      </div>

      <div className="capability-card-body">
        <h3>{tool.label}</h3>
        <p>{tool.description}</p>
      </div>

      <div className="capability-risk-copy">
        <strong>{getRiskTitle(tool.riskLevel)}</strong>
        <span>{getRiskDescription(tool)}</span>
      </div>

      <div className="capability-card-footer">
        <label className="capability-toggle-row">
          <input
            type="checkbox"
            checked={tool.enabled}
            disabled={disabled}
            onChange={(event) => onToggle(tool, event.target.checked)}
          />
          <span>
            <strong>{tool.enabled ? "Enabled" : "Disabled"}</strong>
            <small>{getToggleReason(tool, allToolsDisabled)}</small>
          </span>
        </label>
      </div>
    </article>
  );
}

function CapabilityStateBadge({
  tool,
  allToolsDisabled
}: {
  tool: ToolDefinition;
  allToolsDisabled: boolean;
}) {
  if (allToolsDisabled) {
    return (
      <span className="capability-state capability-state-off">
        <ToggleLeft size={14} /> Globally off
      </span>
    );
  }

  if (isCapabilityLocked(tool)) {
    return (
      <span className="capability-state capability-state-locked">
        <Lock size={14} /> Locked
      </span>
    );
  }

  if (tool.enabled) {
    return (
      <span className="capability-state capability-state-enabled">
        <CheckCircle2 size={14} /> Enabled
      </span>
    );
  }

  return <span className="capability-state capability-state-off">Disabled</span>;
}

function CapabilityMetric({
  icon,
  label,
  value,
  hint
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <article className="capability-metric-card">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

function isCapabilityLocked(tool: ToolDefinition): boolean {
  return tool.future || tool.riskLevel === "dangerous";
}

function formatRiskLevel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getRiskTitle(riskLevel: string): string {
  if (riskLevel === "low") return "Low risk";
  if (riskLevel === "medium") return "Medium risk";
  if (riskLevel === "high") return "High risk";
  if (riskLevel === "dangerous") return "Dangerous";
  return formatRiskLevel(riskLevel);
}

function getRiskDescription(tool: ToolDefinition): string {
  if (tool.future) return "This capability is planned for later and cannot be enabled yet.";
  if (tool.riskLevel === "dangerous") return "This capability is intentionally locked.";
  if (tool.riskLevel === "high") return "Enable only when the user clearly understands the impact.";
  if (tool.riskLevel === "medium") return "Use with previews, confirmations, and visible audit logs.";
  return "Safe for normal local use when enabled intentionally.";
}

function getToggleReason(tool: ToolDefinition, allToolsDisabled: boolean): string {
  if (allToolsDisabled) return "Disabled by global safety switch.";
  if (tool.future) return "Future capability. Not available yet.";
  if (tool.riskLevel === "dangerous") return "Locked because this is too risky.";
  if (tool.enabled) return "Klak may use this capability when appropriate.";
  return "Off until you enable it.";
}