import type { AppSettings, DiscoveredAppCandidate, RegisteredAppRecord, ToolActionInput } from "../../types";
import { listRegisteredApps } from "./registeredAppsRepository";
import { scanInstalledApps } from "./appDiscoveryService";

export type AppActionKind = "open" | "register" | "register_and_open" | "check_installed";

export type ResolvedAppMatch =
  | {
      kind: "registered";
      id: string;
      name: string;
      executable_path: string;
      allowed: boolean;
      app_type: RegisteredAppRecord["app_type"];
    }
  | {
      kind: "discovered";
      id: string;
      name: string;
      executable_path: string;
      source: string;
      publisher: string | null;
      confidence: string;
      category: string;
    };

export interface AppActionResolution {
  action: AppActionKind;
  app_name: string;
  normalized_app_name: string;
  status: "resolved" | "check_installed" | "ambiguous" | "not_found" | "blocked";
  message: string;
  prompt: string;
  matches: ResolvedAppMatch[];
  selected?: ResolvedAppMatch | null;
  suggestedAction?: ToolActionInput | null;
}

interface ResolutionSources {
  appName: string;
  action: AppActionKind;
  registeredApps: RegisteredAppRecord[];
  discoveredApps: DiscoveredAppCandidate[];
}

export async function resolveAppAction(appName: string, action: AppActionKind, settings: AppSettings): Promise<AppActionResolution> {
  const [registeredApps, discoveredApps] = await Promise.all([listRegisteredApps(), scanInstalledApps(settings)]);
  return resolveAppActionFromSources({ appName, action, registeredApps, discoveredApps });
}

export function resolveAppActionFromSources({
  appName,
  action,
  registeredApps,
  discoveredApps
}: ResolutionSources): AppActionResolution {
  const normalized = normalize(appName);
  if (!normalized) {
    return {
      action,
      app_name: appName,
      normalized_app_name: normalized,
      status: "blocked",
      message: "Please say the app name.",
      prompt: "Please say the app name.",
      matches: []
    };
  }

  const registeredMatch = pickRegisteredMatch(normalized, registeredApps);
  if (registeredMatch) {
    if (action === "register") {
      return {
        action,
        app_name: appName,
        normalized_app_name: normalized,
        status: "blocked",
        message: `${registeredMatch.name} is already registered.`,
        prompt: `${registeredMatch.name} is already registered.`,
        matches: [registeredMatch]
      };
    }

    if (registeredMatch.kind === "registered" && !registeredMatch.allowed) {
      return {
        action,
        app_name: appName,
        normalized_app_name: normalized,
        status: "blocked",
        message: `${registeredMatch.name} is registered but disabled.`,
        prompt: `${registeredMatch.name} is registered but disabled.`,
        matches: [registeredMatch]
      };
    }

    const suggestedAction: ToolActionInput =
      action === "check_installed"
        ? { toolName: "scan_installed_apps", input: { app_name: appName } }
        : { toolName: "launch_app", input: { registered_app_id: registeredMatch.id } };
    const prompt = `I found ${registeredMatch.name}. Say yes to approve or no to cancel.`;
    return {
      action,
      app_name: appName,
      normalized_app_name: normalized,
      status: action === "check_installed" ? "check_installed" : "resolved",
      message: prompt,
      prompt,
      matches: [registeredMatch],
      selected: registeredMatch,
      suggestedAction
    };
  }

  const discoveredMatches = findDiscoveredMatches(normalized, discoveredApps);
  if (action === "check_installed") {
    const summary = discoveredMatches.length
      ? `I found ${discoveredMatches.length} matching installed app${discoveredMatches.length === 1 ? "" : "s"}: ${formatMatchNames(discoveredMatches)}.`
      : `I did not find a safe installed app named ${appName}.`;
    return {
      action,
      app_name: appName,
      normalized_app_name: normalized,
      status: discoveredMatches.length ? "check_installed" : "not_found",
      message: summary,
      prompt: summary,
      matches: discoveredMatches,
      suggestedAction: { toolName: "scan_installed_apps", input: { app_name: appName } }
    };
  }

  if (discoveredMatches.length === 1) {
    const selected = discoveredMatches[0];
    const suggestedAction =
      action === "register"
        ? { toolName: "register_discovered_app", input: { app_name: selected.name, candidate: selected } }
        : { toolName: "register_and_launch_app", input: { app_name: selected.name, candidate: selected } };
    const prompt = `I found ${selected.name}. Say yes to approve or no to cancel.`;
    return {
      action,
      app_name: appName,
      normalized_app_name: normalized,
      status: "resolved",
      message: prompt,
      prompt,
      matches: discoveredMatches,
      selected,
      suggestedAction
    };
  }

  if (discoveredMatches.length > 1) {
    const prompt = `I found several apps that match ${appName}: ${formatMatchNames(discoveredMatches)}.`;
    return {
      action,
      app_name: appName,
      normalized_app_name: normalized,
      status: "ambiguous",
      message: `${prompt} Say the full app name, or ask me to check installed apps.`,
      prompt: `${prompt} Say the full app name, or ask me to check installed apps.`,
      matches: discoveredMatches.slice(0, 8)
    };
  }

  return {
    action,
    app_name: appName,
    normalized_app_name: normalized,
    status: "not_found",
    message: `I could not find a registered or safe installed app named ${appName}.`,
    prompt: `I could not find a registered or safe installed app named ${appName}.`,
    matches: []
  };
}

function pickRegisteredMatch(lookup: string, apps: RegisteredAppRecord[]): ResolvedAppMatch | null {
  const exact = apps.find((app) => normalize(app.name) === lookup);
  if (exact) return toRegisteredMatch(exact);

  const contains = apps.filter((app) => normalize(app.name).includes(lookup) || lookup.includes(normalize(app.name)));
  if (contains.length === 1) return toRegisteredMatch(contains[0]);
  return null;
}

function findDiscoveredMatches(lookup: string, apps: DiscoveredAppCandidate[]): ResolvedAppMatch[] {
  const safeApps = apps.filter((candidate) => !candidate.is_blocked && candidate.executable_path);
  const exact = safeApps.filter((candidate) => normalize(candidate.name) === lookup || normalize(candidate.normalized_name) === lookup);
  if (exact.length === 1) return exact.map(toDiscoveredMatch);

  const contains = safeApps.filter((candidate) =>
    [candidate.name, candidate.normalized_name, candidate.publisher ?? "", candidate.source ?? ""].some((value) => normalize(value).includes(lookup))
  );
  if (contains.length === 1) return contains.map(toDiscoveredMatch);

  if (exact.length > 1) return exact.map(toDiscoveredMatch);
  return contains.map(toDiscoveredMatch);
}

function formatMatchNames(matches: ResolvedAppMatch[]): string {
  return matches
    .slice(0, 4)
    .map((match) => match.name)
    .join(", ");
}

function toRegisteredMatch(app: RegisteredAppRecord): ResolvedAppMatch {
  return {
    kind: "registered",
    id: app.id,
    name: app.name,
    executable_path: app.executable_path,
    allowed: app.allowed,
    app_type: app.app_type
  };
}

function toDiscoveredMatch(candidate: DiscoveredAppCandidate): ResolvedAppMatch {
  return {
    kind: "discovered",
    id: candidate.id,
    name: candidate.name,
    executable_path: candidate.executable_path ?? "",
    source: candidate.source,
    publisher: candidate.publisher ?? null,
    confidence: candidate.confidence,
    category: candidate.category
  };
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
