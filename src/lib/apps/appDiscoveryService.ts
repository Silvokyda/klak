import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, DiscoveredAppCandidate, RegisteredAppType } from "../../types";
import { createRegisteredApp, listRegisteredApps } from "./registeredAppsRepository";

export async function scanInstalledApps(settings: AppSettings): Promise<DiscoveredAppCandidate[]> {
  const registeredExecutablePaths = (await listRegisteredApps({ allowed: true })).map((app) => app.executable_path);
  return invoke<DiscoveredAppCandidate[]>("scan_installed_apps", {
    input: { registered_executable_paths: registeredExecutablePaths }
  });
}

export async function resolveSafeDiscoveredAppCandidate(
  appName: string,
  settings: AppSettings
): Promise<DiscoveredAppCandidate | null> {
  const discovered = await scanInstalledApps(settings);
  const lookup = normalize(appName);
  if (!lookup) return null;

  const exact = discovered.filter((candidate) => !candidate.is_blocked && normalize(candidate.name) === lookup);
  if (exact.length === 1) return exact[0];

  const contains = discovered.filter(
    (candidate) =>
      !candidate.is_blocked &&
      [candidate.name, candidate.normalized_name, candidate.publisher ?? "", candidate.source ?? ""]
        .some((value) => normalize(value).includes(lookup))
  );
  if (contains.length === 1) return contains[0];
  return null;
}

export async function registerDiscoveredAppFromCandidate(candidate: DiscoveredAppCandidate) {
  if (!candidate.executable_path) {
    throw new Error("The discovered app does not have a validated executable path.");
  }

  return createRegisteredApp({
    name: candidate.name,
    executable_path: candidate.executable_path,
    app_type: inferAppType(candidate),
    description: candidate.publisher
      ? `Discovered from ${candidate.source}. Publisher: ${candidate.publisher}`
      : `Discovered from ${candidate.source}.`,
    allowed: true
  });
}

function inferAppType(candidate: DiscoveredAppCandidate): RegisteredAppType {
  const normalized = `${candidate.name} ${candidate.publisher ?? ""} ${candidate.source}`.toLowerCase();
  if (/(chrome|edge|browser|firefox|brave|opera|vivaldi)/.test(normalized)) return "browser";
  if (/(code|visual studio|vscode|sublime|notepad\+\+|editor)/.test(normalized)) return "editor";
  if (/(figma|design|canva)/.test(normalized)) return "design";
  if (/(teams|zoom|slack|discord|outlook|mail|chat)/.test(normalized)) return "communication";
  if (/(terminal|cli|sdk|dev|studio|powershell|python|node|cargo|git)/.test(normalized)) return "dev_tool";
  return "other";
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
