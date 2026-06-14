import { Activity, Bot, Briefcase, Database, GitBranch, History, Rocket, Settings, ShieldCheck, TerminalSquare, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AppSettings } from "../types";
import { AppsScreen } from "../features/apps/AppsScreen";
import { CommandsScreen } from "../features/commands/CommandsScreen";
import { AssistantScreen } from "../features/chat/AssistantScreen";
import { DiagnosticsScreen } from "../features/diagnostics/DiagnosticsScreen";
import { LogsScreen } from "../features/logs/LogsScreen";
import { MemoryScreen } from "../features/memory/MemoryScreen";
import { ProjectsScreen } from "../features/projects/ProjectsScreen";
import { SettingsScreen } from "../features/settings/SettingsScreen";
import { SetupFlow } from "../features/setup/SetupFlow";
import { ToolsScreen } from "../features/tools/ToolsScreen";
import { WorkflowsScreen } from "../features/workflows/WorkflowsScreen";
import { defaultSettings, loadSettings, saveSettings } from "../lib/storage/settings";
import { labelPermissionMode } from "../lib/utils";
import { initDatabase } from "../lib/db/database";

type View = "assistant" | "memory" | "projects" | "workflows" | "apps" | "commands" | "tools" | "logs" | "diagnostics" | "settings";

export function App() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [view, setView] = useState<View>("assistant");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initDatabase().then(loadSettings).then((loaded) => {
      setSettings(loaded);
      setReady(true);
    });
  }, []);

  async function updateSettings(next: AppSettings) {
    setSettings(next);
    await saveSettings(next);
  }

  const nav = useMemo(
    () => [
      { id: "assistant" as const, label: "Assistant", icon: Bot },
      { id: "memory" as const, label: "Memory", icon: Database },
      { id: "projects" as const, label: "Projects", icon: Briefcase },
      { id: "workflows" as const, label: "Workflows", icon: GitBranch },
      { id: "apps" as const, label: "Apps", icon: Rocket },
      { id: "commands" as const, label: "Commands", icon: TerminalSquare },
      { id: "tools" as const, label: "Tools", icon: Wrench },
      { id: "logs" as const, label: "Logs", icon: History },
      { id: "diagnostics" as const, label: "Diagnostics", icon: Activity },
      { id: "settings" as const, label: "Settings", icon: Settings }
    ],
    []
  );

  if (!ready) return <div className="boot">Loading Klak...</div>;

  if (!settings.setupComplete) {
    return <SetupFlow settings={settings} onComplete={updateSettings} />;
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="mark">K</div>
          <div>
            <h1>Klak</h1>
            <p>your local AI operator</p>
          </div>
        </div>
        <nav>
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <button className={view === item.id ? "active" : ""} key={item.id} onClick={() => setView(item.id)}>
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="mode-pill">
          <ShieldCheck size={16} />
          {labelPermissionMode(settings.permissionMode)}
        </div>
      </aside>

      <main className="main">
        {view === "assistant" && <AssistantScreen settings={settings} />}
        {view === "memory" && <MemoryScreen />}
        {view === "projects" && <ProjectsScreen settings={settings} />}
        {view === "workflows" && <WorkflowsScreen settings={settings} />}
        {view === "apps" && <AppsScreen settings={settings} />}
        {view === "commands" && <CommandsScreen settings={settings} />}
        {view === "tools" && <ToolsScreen settings={settings} onSettingsChange={updateSettings} />}
        {view === "logs" && <LogsScreen />}
        {view === "diagnostics" && <DiagnosticsScreen settings={settings} />}
        {view === "settings" && <SettingsScreen settings={settings} onSettingsChange={updateSettings} />}
      </main>
    </div>
  );
}
