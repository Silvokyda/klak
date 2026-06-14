import { Activity, Bot, Briefcase, Database, GitBranch, History, Rocket, Settings, ShieldCheck, TerminalSquare, Workflow, Wrench } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import type { AppSettings } from "../types";
import { AppsScreen } from "../features/apps/AppsScreen";
import { CommandsScreen } from "../features/commands/CommandsScreen";
import { AssistantScreen } from "../features/chat/AssistantScreen";
import { DiagnosticsScreen } from "../features/diagnostics/DiagnosticsScreen";
import { LogsScreen } from "../features/logs/LogsScreen";
import { MemoryScreen } from "../features/memory/MemoryScreen";
import { ProcessesScreen } from "../features/processes/ProcessesScreen";
import { ProjectsScreen } from "../features/projects/ProjectsScreen";
import { SettingsScreen } from "../features/settings/SettingsScreen";
import { SetupFlow } from "../features/setup/SetupFlow";
import { ToolsScreen } from "../features/tools/ToolsScreen";
import { WorkflowsScreen } from "../features/workflows/WorkflowsScreen";
import { defaultSettings, loadSettings, saveSettings } from "../lib/storage/settings";
import { labelPermissionMode } from "../lib/utils";
import { initDatabase } from "../lib/db/database";
import { listRunningBackgroundProcesses, markProcessStopped, updateBackgroundProcess } from "../lib/processes/backgroundProcessRepository";

type View = "assistant" | "memory" | "projects" | "workflows" | "apps" | "commands" | "processes" | "tools" | "logs" | "diagnostics" | "settings";

export function App() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [view, setView] = useState<View>("assistant");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initDatabase().then(reconcileBackgroundProcesses).then(loadSettings).then((loaded) => {
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
      { id: "workflows" as const, label: "Routines", icon: GitBranch },
      { id: "apps" as const, label: "Apps", icon: Rocket },
      { id: "commands" as const, label: "Saved Actions", icon: TerminalSquare },
      { id: "processes" as const, label: "Running Activities", icon: Workflow },
      { id: "tools" as const, label: "Capabilities", icon: Wrench },
      { id: "logs" as const, label: "Activity History", icon: History },
      { id: "diagnostics" as const, label: "Health Check", icon: Activity },
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
        {view === "processes" && <ProcessesScreen />}
        {view === "tools" && <ToolsScreen settings={settings} onSettingsChange={updateSettings} />}
        {view === "logs" && <LogsScreen />}
        {view === "diagnostics" && <DiagnosticsScreen settings={settings} />}
        {view === "settings" && <SettingsScreen settings={settings} onSettingsChange={updateSettings} />}
      </main>
    </div>
  );
}

async function reconcileBackgroundProcesses() {
  const running = await listRunningBackgroundProcesses();
  await Promise.all(running.map(async (process) => {
    try {
      const status = await invoke<{ running: boolean; status: string; pid: number | null; exit_code: number | null }>("get_background_process_status", {
        input: { process_id: process.id }
      });
      if (status.running) {
        await updateBackgroundProcess(process.id, { status: "running", process_pid: status.pid ?? process.process_pid ?? null });
      } else {
        await markProcessStopped(process.id, { status: status.status as typeof process.status, exit_code: status.exit_code, last_output_preview: status.status === "stale" ? "This activity was from a previous Klak session and is no longer managed." : "Activity was not running when Klak started." });
      }
    } catch {
      await markProcessStopped(process.id, { status: "stale", last_output_preview: "Marked stale on app start. Klak will not try to stop arbitrary system processes." });
    }
  }));
}
