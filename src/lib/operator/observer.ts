import { invoke } from "@tauri-apps/api/core";
import type { CommandRunResult } from "../commands/commandTemplateRepository";
import type { BrowserObservation, FileObservation, ObservationSnapshot } from "../../types";
import { listVisibleProcesses, listOpenWindows } from "./desktopObserver";
import { browserReadState } from "./browserAutomation";
import { nowIso } from "../utils";

interface ObserveInput {
  browserSessionId?: string | null;
  browserSelector?: string;
  files?: string[];
  commandResult?: CommandRunResult | null;
}

export async function observeEnvironment(input: ObserveInput = {}): Promise<ObservationSnapshot> {
  const [windows, processes, browserState, files] = await Promise.all([
    listOpenWindows().catch(() => []),
    listVisibleProcesses().catch(() => []),
    input.browserSessionId ? browserReadState(input.browserSessionId, input.browserSelector).catch(() => null) : Promise.resolve(null),
    observeFiles(input.files ?? [])
  ]);

  return {
    windows,
    processes,
    files,
    browser_state: browserState,
    command_result: input.commandResult
      ? {
          exit_code: input.commandResult.exit_code,
          stdout_excerpt: input.commandResult.stdout.slice(0, 400),
          stderr_excerpt: input.commandResult.stderr.slice(0, 400),
          timed_out: input.commandResult.timed_out
        }
      : null,
    screenshot_ref: null,
    observed_at: nowIso()
  };
}

async function observeFiles(paths: string[]): Promise<FileObservation[]> {
  if (!paths.length) return [];
  return invoke<FileObservation[]>("stat_paths", { input: { paths } }).catch(() =>
    paths.map((path) => ({
      path,
      exists: false,
      size: null,
      modified_at: null
    }))
  );
}

export function summarizeBrowserObservation(observation: BrowserObservation | null | undefined): string {
  if (!observation) return "No browser state was captured.";
  return `${observation.title ?? "Untitled page"} at ${observation.url ?? "unknown URL"}`;
}
