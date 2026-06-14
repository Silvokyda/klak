import { useEffect, useState } from "react";
import { ScreenHeader } from "../../components/ScreenHeader";
import type { AppSettings, ToolDefinition } from "../../types";
import { listTools, setToolEnabled } from "../../lib/tools/toolRegistry";

export function ToolsScreen({ settings, onSettingsChange }: { settings: AppSettings; onSettingsChange: (settings: AppSettings) => void }) {
  const [tools, setTools] = useState<ToolDefinition[]>([]);

  async function refresh() {
    setTools(await listTools(settings.allToolsDisabled));
  }

  useEffect(() => {
    void refresh();
  }, [settings.allToolsDisabled]);

  return (
    <div className="screen">
      <ScreenHeader
        title="Capabilities"
        subtitle="Safe local capabilities can be enabled here. Future risky capabilities stay disabled by default."
        actions={
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.allToolsDisabled}
              onChange={(event) => onSettingsChange({ ...settings, allToolsDisabled: event.target.checked })}
            />
            Disable all
          </label>
        }
      />
      <section className="card-grid">
        {tools.map((tool) => (
          <article className="tool-card" key={tool.name}>
            <div>
              <span className={`risk risk-${tool.riskLevel}`}>{tool.riskLevel}</span>
              {tool.future && <span className="tag">future</span>}
              <h3>{tool.label}</h3>
              <p>{tool.description}</p>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={tool.enabled}
                disabled={settings.allToolsDisabled || tool.future || tool.riskLevel === "dangerous"}
                onChange={(event) => setToolEnabled(tool.name, event.target.checked).then(refresh)}
              />
              Enabled
            </label>
          </article>
        ))}
      </section>
    </div>
  );
}
