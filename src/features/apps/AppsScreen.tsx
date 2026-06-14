import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  AppWindow,
  CheckCircle2,
  FolderSearch,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  Search,
  ShieldCheck,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ActionPreviewCard } from "../../components/ActionPreviewCard";
import { ScreenHeader } from "../../components/ScreenHeader";
import type {
  ActionPreview,
  AppSettings,
  DiscoveredAppCandidate,
  RegisteredAppRecord,
  RegisteredAppType
} from "../../types";
import {
  createRegisteredApp,
  deleteRegisteredApp,
  isBlockedShellExecutable,
  searchRegisteredApps,
  updateRegisteredApp,
  validateExecutablePath
} from "../../lib/apps/registeredAppsRepository";
import { createActionLog, updateActionLog } from "../../lib/logs/actionLogRepository";
import { buildActionPreviewForSuggestion } from "../../lib/tools/toolProposals";
import { nowIso } from "../../lib/utils";

const appTypes: RegisteredAppType[] = [
  "editor",
  "browser",
  "design",
  "communication",
  "productivity",
  "dev_tool",
  "other"
];

type SuggestionFilter = "recommended" | "all_reviewable" | "advanced" | "unsupported";

export function AppsScreen({ settings }: { settings: AppSettings }) {
  const [apps, setApps] = useState<RegisteredAppRecord[]>([]);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState({
    name: "",
    executable_path: "",
    app_type: "editor" as RegisteredAppType,
    description: "",
    allowed: true
  });
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<ActionPreview | null>(null);
  const [pathWarnings, setPathWarnings] = useState<Record<string, string>>({});
  const [suggestions, setSuggestions] = useState<DiscoveredAppCandidate[]>([]);
  const [suggestionQuery, setSuggestionQuery] = useState("");
  const [suggestionFilter, setSuggestionFilter] = useState<SuggestionFilter>("recommended");
  const [selectedSuggestions, setSelectedSuggestions] = useState<Record<string, boolean>>({});
  const [scanning, setScanning] = useState(false);
  const [addingSuggestions, setAddingSuggestions] = useState(false);

  async function refresh(nextQuery = query) {
    const nextApps = await searchRegisteredApps(nextQuery);
    setApps(nextApps);
    await refreshPathWarnings(nextApps);
  }

  useEffect(() => {
    void refresh();
  }, []);

  const recommendedSuggestionCount = useMemo(() => {
    return suggestions.filter((candidate) => candidate.category === "recommended").length;
  }, [suggestions]);

  const reviewableSuggestionCount = useMemo(() => {
    return suggestions.filter(isSelectableSuggestion).length;
  }, [suggestions]);

  const selectedSuggestionCount = useMemo(() => {
    return suggestions.filter(
      (candidate) => selectedSuggestions[candidate.id] && isSelectableSuggestion(candidate)
    ).length;
  }, [suggestions, selectedSuggestions]);

  const readyAppCount = useMemo(() => {
    return apps.filter((app) => app.allowed && !pathWarnings[app.id]).length;
  }, [apps, pathWarnings]);

  const attentionAppCount = useMemo(() => {
    return apps.filter((app) => !app.allowed || Boolean(pathWarnings[app.id])).length;
  }, [apps, pathWarnings]);

  const filteredSuggestions = useMemo(() => {
    const normalized = suggestionQuery.trim().toLowerCase();

    return suggestions.filter((candidate) => {
      const matchesFilter =
        suggestionFilter === "all_reviewable"
          ? candidate.category === "recommended" ||
            candidate.category === "already_registered" ||
            candidate.category === "advanced"
          : suggestionFilter === "recommended"
            ? candidate.category === "recommended" || candidate.category === "already_registered"
            : suggestionFilter === "advanced"
              ? candidate.category === "advanced"
              : candidate.category === "unsupported" || candidate.category === "blocked";

      if (!matchesFilter) return false;
      if (!normalized) return true;

      return [
        candidate.name,
        candidate.source,
        candidate.publisher ?? "",
        candidate.executable_path ?? "",
        candidate.category,
        candidate.block_reason ?? ""
      ].some((value) => value.toLowerCase().includes(normalized));
    });
  }, [suggestions, suggestionQuery, suggestionFilter]);

  const recommendedSuggestions = filteredSuggestions.filter(
    (candidate) => candidate.category === "recommended" || candidate.category === "already_registered"
  );
  const advancedSuggestions = filteredSuggestions.filter((candidate) => candidate.category === "advanced");
  const unsupportedSuggestions = filteredSuggestions.filter(
    (candidate) => candidate.category === "unsupported" || candidate.category === "blocked"
  );

  async function create() {
    setMessage(null);

    if (!draft.name.trim() || !draft.executable_path.trim()) {
      setMessage("Add an app name and executable path before registering.");
      return;
    }

    try {
      validateExecutablePath(draft.executable_path);

      if (isBlockedShellExecutable(draft.executable_path)) {
        setMessage("System command tools cannot be registered as normal apps.");
        return;
      }

      await createRegisteredApp({
        ...draft,
        name: draft.name.trim(),
        executable_path: draft.executable_path.trim(),
        description: emptyToNull(draft.description)
      });

      setDraft({ ...draft, name: "", executable_path: "", description: "" });
      await refresh();
      setMessage("App registered locally.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function scanApps() {
    setMessage(null);
    setScanning(true);

    const scanLog = await createActionLog({
      tool_name: "scan_installed_apps",
      input_summary: "Scan safe Windows app sources for app suggestions.",
      risk_level: "low",
      status: "running",
      user_approved: true
    });

    try {
      const registeredPaths = apps.map((app) => app.executable_path);
      const discovered = await invoke<DiscoveredAppCandidate[]>("scan_installed_apps", {
        input: { registered_executable_paths: registeredPaths }
      });

      setSuggestions(discovered);
      setSelectedSuggestions({});
      setSuggestionFilter("recommended");

      const recommendedCount = discovered.filter(
        (candidate) => candidate.category === "recommended"
      ).length;

      await updateActionLog(scanLog.id, {
        status: "completed",
        completed_at: nowIso(),
        error_message: `Found ${recommendedCount} recommended app(s) from ${discovered.length} suggestion(s).`
      });

      setMessage(
        discovered.length
          ? `Found ${recommendedCount} recommended app(s). Technical helpers and unsupported items are separated.`
          : "No app suggestions were found from safe Windows app sources."
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      await updateActionLog(scanLog.id, {
        status: "failed",
        completed_at: nowIso(),
        error_message: errorMessage
      });

      setMessage(errorMessage);
    } finally {
      setScanning(false);
    }
  }

  async function addSelectedSuggestions() {
    setMessage(null);
    setAddingSuggestions(true);

    const selected = suggestions.filter(
      (candidate) => selectedSuggestions[candidate.id] && isSelectableSuggestion(candidate)
    );

    const attemptLog = await createActionLog({
      tool_name: "register_discovered_apps",
      input_summary: `Register ${selected.length} selected app suggestion(s).`,
      risk_level: "low",
      status: "running",
      user_approved: true
    });

    try {
      const result = await invoke<{
        accepted: DiscoveredAppCandidate[];
        rejected: DiscoveredAppCandidate[];
      }>("register_discovered_apps", {
        input: {
          candidates: selected,
          registered_executable_paths: apps.map((app) => app.executable_path)
        }
      });

      let added = 0;

      for (const candidate of result.accepted) {
        if (!candidate.executable_path) continue;

        try {
          await createRegisteredApp({
            name: candidate.name,
            executable_path: candidate.executable_path,
            app_type: inferAppType(candidate),
            description: candidate.publisher
              ? `Discovered from ${candidate.source}. Publisher: ${candidate.publisher}`
              : `Discovered from ${candidate.source}.`,
            allowed: true
          });

          added += 1;

          await createActionLog({
            tool_name: "app_registered",
            input_summary: `Registered ${candidate.name} from ${candidate.source}.`,
            risk_level: "low",
            status: "completed",
            user_approved: true
          });
        } catch (error) {
          await createActionLog({
            tool_name: "app_registration_failed",
            input_summary: `Could not register ${candidate.name}.`,
            risk_level: "low",
            status: "failed",
            user_approved: true,
            error_message: error instanceof Error ? error.message : String(error)
          });
        }
      }

      for (const candidate of result.rejected) {
        await createActionLog({
          tool_name: "app_registration_blocked",
          input_summary: `Blocked ${candidate.name} from app discovery.`,
          risk_level: "low",
          status: "blocked",
          user_approved: true,
          error_message: candidate.block_reason ?? "This suggestion cannot be registered."
        });
      }

      await refresh();

      setSuggestions((current) =>
        current.map((candidate) =>
          result.accepted.some((item) => item.id === candidate.id)
            ? { ...candidate, is_registered: true }
            : candidate
        )
      );

      setSelectedSuggestions({});

      await updateActionLog(attemptLog.id, {
        status: "completed",
        completed_at: nowIso(),
        error_message: result.rejected.length
          ? `Added ${added}; ${result.rejected.length} blocked or skipped.`
          : `Added ${added} app(s).`
      });

      setMessage(
        result.rejected.length
          ? `Added ${added} app(s). ${result.rejected.length} suggestion(s) were blocked or skipped.`
          : `Added ${added} app(s).`
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      await updateActionLog(attemptLog.id, {
        status: "failed",
        completed_at: nowIso(),
        error_message: errorMessage
      });

      setMessage(errorMessage);
    } finally {
      setAddingSuggestions(false);
    }
  }

  async function chooseExe() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Windows executable", extensions: ["exe"] }]
    });

    if (typeof selected === "string") {
      setDraft({ ...draft, executable_path: selected });
    }
  }

  async function launch(app: RegisteredAppRecord) {
    setMessage(null);

    const nextPreview = await buildActionPreviewForSuggestion(
      { toolName: "launch_app", input: { registered_app_id: app.id } },
      settings
    );

    if (nextPreview) setPreview(nextPreview);
  }

  async function refreshPathWarnings(nextApps: RegisteredAppRecord[]) {
    const entries = await Promise.all(
      nextApps.map(async (app) => {
        try {
          const check = await invoke<{
            exists: boolean;
            valid_extension: boolean;
            blocked_shell: boolean;
            message: string;
          }>("validate_registered_app_path", {
            input: { executable_path: app.executable_path }
          });

          return [
            app.id,
            check.exists && check.valid_extension && !check.blocked_shell ? "" : check.message
          ] as const;
        } catch {
          return [
            app.id,
            "Path existence will be checked in the native app before launch."
          ] as const;
        }
      })
    );

    setPathWarnings(Object.fromEntries(entries));
  }

  async function update(app: RegisteredAppRecord, patch: Partial<RegisteredAppRecord>) {
    setMessage(null);

    try {
      await updateRegisteredApp(app.id, patch);
      await refresh();
      setMessage("App updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function remove(app: RegisteredAppRecord) {
    const confirmed = window.confirm(
      `Remove "${app.name}" from Klak? This only deletes the local app record.`
    );

    if (!confirmed) return;

    await deleteRegisteredApp(app.id);
    await refresh();
  }

  function findIconPathForRegisteredApp(app: RegisteredAppRecord): string | null {
    const appPath = normalizeComparablePath(app.executable_path);
    const appName = normalizeComparableName(app.name);

    const byPath = suggestions.find((candidate) => {
      if (!candidate.executable_path || !candidate.icon_path) return false;
      return normalizeComparablePath(candidate.executable_path) === appPath;
    });

    if (byPath?.icon_path) return byPath.icon_path;

    const byName = suggestions.find((candidate) => {
      if (!candidate.icon_path) return false;
      return normalizeComparableName(candidate.name) === appName;
    });

    return byName?.icon_path ?? null;
  }

  return (
    <div className="screen apps-screen">
      <ScreenHeader
        title="Apps"
        subtitle="Register local apps Klak can suggest opening. Launches still require preview and approval."
        actions={
          <button onClick={scanApps} disabled={scanning} title="Scan safe Windows app sources">
            <RefreshCw size={16} /> {scanning ? "Scanning..." : "Scan for apps"}
          </button>
        }
      />

      <section className="apps-hero">
        <div>
          <span className="eyebrow">Local app vault</span>
          <h3>Choose which apps Klak is allowed to suggest.</h3>
          <p>
            Klak scans bounded Windows app sources, separates unsupported items, and only registers
            apps you select. It does not launch apps silently.
          </p>
        </div>

        <div className="apps-hero-card">
          <ShieldCheck size={20} />
          <div>
            <strong>Approval required</strong>
            <span>Opening an app still goes through an action preview before launch.</span>
          </div>
        </div>
      </section>

      <section className="apps-overview">
        <AppMetric
          icon={<AppWindow size={18} />}
          label="Registered apps"
          value={`${apps.length}`}
          hint="Saved locally"
        />
        <AppMetric
          icon={<CheckCircle2 size={18} />}
          label="Ready"
          value={`${readyAppCount}`}
          hint="Allowed and reachable"
        />
        <AppMetric
          icon={<AlertTriangle size={18} />}
          label="Needs attention"
          value={`${attentionAppCount}`}
          hint="Disabled or path issue"
        />
        <AppMetric
          icon={<Plus size={18} />}
          label="Suggestions"
          value={`${recommendedSuggestionCount}`}
          hint="Recommended from scan"
        />
      </section>

      {message && <p className="warning">{message}</p>}

      {preview && (
        <ActionPreviewCard
          preview={preview}
          settings={settings}
          onDone={() => {
            setPreview(null);
            void refresh();
          }}
        />
      )}

      <div className="apps-layout">
        <div className="apps-column">
          <section className="app-discovery-panel">
            <div className="apps-panel-header">
              <div>
                <span className="eyebrow">Discovery</span>
                <h3>Suggested apps</h3>
                <p>
                  Review scan results before adding them. Installers, shells, and unsupported tools
                  stay blocked or separated.
                </p>
              </div>

              <button
                className="primary"
                onClick={addSelectedSuggestions}
                disabled={addingSuggestions || selectedSuggestionCount === 0}
                title="Add selected apps"
              >
                <Plus size={16} />
              </button>
            </div>

            <div className="app-review-row">
              <div className="app-search">
                <Search size={16} />
                <input
                  value={suggestionQuery}
                  onChange={(event) => setSuggestionQuery(event.target.value)}
                  placeholder="Search suggestions"
                />
              </div>

              <select
                value={suggestionFilter}
                onChange={(event) => setSuggestionFilter(event.target.value as SuggestionFilter)}
                aria-label="Filter app suggestions"
              >
                <option value="recommended">Recommended</option>
                <option value="all_reviewable">Reviewable</option>
                <option value="advanced">Advanced</option>
                <option value="unsupported">Unsupported</option>
              </select>
            </div>

            <div className="apps-suggestion-summary">
              <span>{recommendedSuggestionCount} recommended</span>
              <span>{reviewableSuggestionCount} can be reviewed</span>
              <span>{selectedSuggestionCount} selected</span>
            </div>

            {filteredSuggestions.length === 0 ? (
              <div className="apps-empty-state">
                <strong>No suggestions shown</strong>
                <p>Click Scan for apps, change the filter, or clear your search.</p>
              </div>
            ) : (
              <div className="app-suggestion-list">
                <SuggestionGroup
                  title="Recommended"
                  candidates={recommendedSuggestions}
                  selectedSuggestions={selectedSuggestions}
                  setSelectedSuggestions={setSelectedSuggestions}
                />
                <SuggestionGroup
                  title="Advanced"
                  candidates={advancedSuggestions}
                  selectedSuggestions={selectedSuggestions}
                  setSelectedSuggestions={setSelectedSuggestions}
                />
                <SuggestionGroup
                  title="Unsupported"
                  candidates={unsupportedSuggestions}
                  selectedSuggestions={selectedSuggestions}
                  setSelectedSuggestions={setSelectedSuggestions}
                />
              </div>
            )}
          </section>

          <section className="manual-app-card">
            <div className="apps-panel-header">
              <div>
                <span className="eyebrow">Manual registration</span>
                <h3>Add an app yourself</h3>
                <p>Use this when discovery misses a normal desktop app you trust.</p>
              </div>
            </div>

            <div className="app-create-grid">
              <label className="field-stack">
                <span>App name</span>
                <input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder="Example: Visual Studio Code"
                />
              </label>

              <label className="field-stack">
                <span>Type</span>
                <select
                  value={draft.app_type}
                  onChange={(event) =>
                    setDraft({ ...draft, app_type: event.target.value as RegisteredAppType })
                  }
                >
                  {appTypes.map((type) => (
                    <option key={type} value={type}>
                      {formatAppType(type)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="field-stack">
              <span>Executable path</span>
              <div className="path-picker">
                <input
                  value={draft.executable_path}
                  onChange={(event) => setDraft({ ...draft, executable_path: event.target.value })}
                  placeholder="C:\\Program Files\\App\\App.exe"
                />
                <button title="Choose executable" onClick={chooseExe}>
                  <FolderSearch size={16} />
                </button>
              </div>
            </label>

            <label className="field-stack">
              <span>Description</span>
              <textarea
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                placeholder="What is this app used for?"
              />
            </label>

            <label className="app-allow-toggle">
              <input
                type="checkbox"
                checked={draft.allowed}
                onChange={(event) => setDraft({ ...draft, allowed: event.target.checked })}
              />
              <span>
                <strong>Allow Klak to suggest this app</strong>
                <small>Klak will still ask before opening it.</small>
              </span>
            </label>

            <button className="primary" onClick={create}>
              <Plus size={16} /> Register app
            </button>
          </section>
        </div>

        <section className="registered-apps-panel">
          <div className="apps-panel-header registered-apps-header">
            <div>
              <span className="eyebrow">Registered</span>
              <h3>App vault</h3>
              <p>These are the apps Klak can propose opening after your approval.</p>
            </div>

            <span className="tag">
              {apps.length} app{apps.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="app-search registered-app-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                void refresh(event.target.value);
              }}
              placeholder="Search registered apps"
            />
          </div>

          {apps.length === 0 ? (
            <div className="apps-empty-state">
              <strong>No registered apps yet</strong>
              <p>Scan for apps or register one manually. Klak will only use apps you approve.</p>
            </div>
          ) : (
            <div className="apps-registered-grid">
              {apps.map((app) => {
                const iconPath = findIconPathForRegisteredApp(app);

                return (
                  <RegisteredAppCard
                    key={app.id}
                    app={app}
                    iconPath={iconPath}
                    pathWarning={pathWarnings[app.id] ?? ""}
                    onLaunch={() => launch(app)}
                    onSave={(patch) => update(app, patch)}
                    onDelete={() => remove(app)}
                  />
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function AppMetric({
  icon,
  label,
  value,
  hint
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <article className="apps-stat-card">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

function SuggestionGroup({
  title,
  candidates,
  selectedSuggestions,
  setSelectedSuggestions
}: {
  title: string;
  candidates: DiscoveredAppCandidate[];
  selectedSuggestions: Record<string, boolean>;
  setSelectedSuggestions: (value: Record<string, boolean>) => void;
}) {
  if (candidates.length === 0) return null;

  return (
    <div className="app-suggestion-section">
      <div className="app-suggestion-section-header">
        <h4>{title}</h4>
        <span className="tag">{candidates.length}</span>
      </div>

      {candidates.map((candidate) => {
        const selectable = isSelectableSuggestion(candidate);

        return (
          <article
            className={`app-suggestion-card ${candidate.is_blocked ? "app-suggestion-blocked" : ""}`}
            key={candidate.id}
          >
            <AppIcon candidate={candidate} />

            <div className="app-suggestion-main">
              <div className="app-suggestion-title">
                <label className="app-allow-toggle compact">
                  <input
                    type="checkbox"
                    checked={Boolean(selectedSuggestions[candidate.id])}
                    disabled={!selectable}
                    onChange={(event) =>
                      setSelectedSuggestions({
                        ...selectedSuggestions,
                        [candidate.id]: event.target.checked
                      })
                    }
                  />
                  <span>
                    <strong>{candidate.name}</strong>
                    <small>{candidate.publisher || candidate.source}</small>
                  </span>
                </label>
              </div>

              <div className="app-suggestion-meta">
                <span className="tag">{candidate.source}</span>
                <span
                  className={
                    candidate.is_blocked
                      ? "warning-badge"
                      : candidate.is_registered
                        ? "status-badge"
                        : candidate.category === "recommended"
                          ? "status-badge"
                          : "tag"
                  }
                >
                  {candidate.is_registered ? "already added" : candidate.category.replace(/_/g, " ")}
                </span>
                <span className="tag">{candidate.confidence}</span>
              </div>

              <small className="app-suggestion-path">
                {candidate.executable_path
                  ? formatUserFriendlyPath(candidate.executable_path)
                  : "No executable path available"}
              </small>

              {candidate.block_reason && (
                <small className="inline-warning">{candidate.block_reason}</small>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function AppIcon({ candidate }: { candidate: DiscoveredAppCandidate }) {
  const [failed, setFailed] = useState(false);
  const iconUrl = !failed ? getIconUrl(candidate.icon_path ?? null) : null;
  const initials = candidate.name.trim().slice(0, 1).toUpperCase() || "A";

  if (iconUrl) {
    return (
      <div className="app-icon app-icon-image">
        <img src={iconUrl} alt="" loading="lazy" onError={() => setFailed(true)} />
      </div>
    );
  }

  return (
    <div className="app-icon app-icon-fallback">
      <span>{initials}</span>
    </div>
  );
}

function RegisteredAppCard({
  app,
  iconPath,
  pathWarning,
  onLaunch,
  onSave,
  onDelete
}: {
  app: RegisteredAppRecord;
  iconPath: string | null;
  pathWarning: string;
  onLaunch: () => void;
  onSave: (patch: Partial<RegisteredAppRecord>) => Promise<void>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [editDraft, setEditDraft] = useState({
    name: app.name,
    executable_path: app.executable_path,
    app_type: app.app_type,
    description: app.description ?? "",
    allowed: app.allowed
  });

  const blocked = isBlockedShellExecutable(app.executable_path);

  let validation = "";

  try {
    validateExecutablePath(app.executable_path);
  } catch (error) {
    validation = error instanceof Error ? error.message : String(error);
  }

  const disabledReason = validation || pathWarning;
  const canLaunch = app.allowed && !blocked && !disabledReason;
  const description = cleanRegisteredAppDescription(app.description ?? null);

  async function saveEdit() {
    await onSave({
      name: editDraft.name.trim(),
      executable_path: editDraft.executable_path.trim(),
      app_type: editDraft.app_type,
      description: emptyToNull(editDraft.description),
      allowed: editDraft.allowed
    });

    setEditing(false);
  }

  return (
    <article className="app-card">
      <div className="app-card-top">
        <AppIcon
          candidate={{
            id: app.id,
            name: app.name,
            normalized_name: app.name.toLowerCase(),
            executable_path: app.executable_path,
            source: "Registered",
            publisher: null,
            icon_path: iconPath,
            confidence: "registered",
            category: app.allowed ? "recommended" : "unsupported",
            is_registered: true,
            is_blocked: blocked,
            block_reason: blocked ? "System command tools cannot be registered as normal apps." : null,
            detected_at: app.created_at
          }}
        />

        <div className="app-card-summary">
          <div className="app-card-title-row">
            <div>
              <h4>{app.name}</h4>
              <p>{description}</p>
            </div>

            <div className="app-card-badges">
              <span className="tag">{formatAppType(app.app_type)}</span>
              <span
                className={`app-status-badge ${
                  canLaunch ? "app-status-ready" : app.allowed ? "app-status-attention" : "app-status-disabled"
                }`}
              >
                {canLaunch ? "Ready" : app.allowed ? "Needs attention" : "Disabled"}
              </span>
            </div>
          </div>

          <small className="muted">
            {app.last_launched_at
              ? `Last opened ${new Date(app.last_launched_at).toLocaleString()}`
              : "Not opened yet"}
          </small>

          {disabledReason && <small className="inline-warning">{disabledReason}</small>}
        </div>
      </div>

      <div className="app-card-actions">
        <button className="primary" title="Open app" disabled={!canLaunch} onClick={onLaunch}>
          <Rocket size={16} /> Open
        </button>

        <button title="Show app details" onClick={() => setShowDetails((value) => !value)}>
          {showDetails ? "Hide details" : "Details"}
        </button>

        <button
          title="Edit registered app"
          onClick={() => {
            setEditing((value) => !value);
            setEditDraft({
              name: app.name,
              executable_path: app.executable_path,
              app_type: app.app_type,
              description: app.description ?? "",
              allowed: app.allowed
            });
          }}
        >
          {editing ? "Cancel" : "Edit"}
        </button>

        <button title="Delete registered app" className="danger-button" onClick={onDelete}>
          <Trash2 size={16} />
        </button>
      </div>

      {showDetails && (
        <div className="app-card-details">
          <div>
            <span className="detail-label">App location</span>
            <code>{formatUserFriendlyPath(app.executable_path)}</code>
          </div>

          <div>
            <span className="detail-label">Permission</span>
            <strong>
              {app.allowed
                ? "Klak may suggest opening this app after approval."
                : "Klak will not suggest opening this app."}
            </strong>
          </div>

          <div>
            <span className="detail-label">Safety status</span>
            <strong>{canLaunch ? "Ready to preview" : disabledReason || "Disabled"}</strong>
          </div>
        </div>
      )}

      {editing && (
        <div className="app-card-edit">
          <div className="app-create-grid">
            <label className="field-stack">
              <span>App name</span>
              <input
                value={editDraft.name}
                onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value })}
              />
            </label>

            <label className="field-stack">
              <span>Type</span>
              <select
                value={editDraft.app_type}
                onChange={(event) =>
                  setEditDraft({
                    ...editDraft,
                    app_type: event.target.value as RegisteredAppType
                  })
                }
              >
                {appTypes.map((type) => (
                  <option key={type} value={type}>
                    {formatAppType(type)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field-stack">
            <span>Executable path</span>
            <input
              value={editDraft.executable_path}
              onChange={(event) =>
                setEditDraft({ ...editDraft, executable_path: event.target.value })
              }
            />
          </label>

          <label className="field-stack">
            <span>Description</span>
            <textarea
              value={editDraft.description}
              onChange={(event) => setEditDraft({ ...editDraft, description: event.target.value })}
            />
          </label>

          <label className="app-allow-toggle">
            <input
              type="checkbox"
              checked={editDraft.allowed}
              onChange={(event) => setEditDraft({ ...editDraft, allowed: event.target.checked })}
            />
            <span>
              <strong>Allow Klak to suggest this app</strong>
              <small>Klak still asks before opening.</small>
            </span>
          </label>

          <button className="primary" onClick={saveEdit}>
            <Save size={16} /> Save changes
          </button>
        </div>
      )}
    </article>
  );
}

function getIconUrl(iconPath: string | null): string | null {
  if (!iconPath) return null;

  const normalizedPath = iconPath.toLowerCase();

  if (
    !normalizedPath.endsWith(".png") &&
    !normalizedPath.endsWith(".ico") &&
    !normalizedPath.endsWith(".jpg") &&
    !normalizedPath.endsWith(".jpeg") &&
    !normalizedPath.endsWith(".webp")
  ) {
    return null;
  }

  try {
    return convertFileSrc(iconPath);
  } catch {
    return null;
  }
}

function isSelectableSuggestion(candidate: DiscoveredAppCandidate): boolean {
  return (
    Boolean(candidate.executable_path) &&
    !candidate.is_blocked &&
    !candidate.is_registered &&
    (candidate.category === "recommended" || candidate.category === "advanced")
  );
}

function emptyToNull(value: string): string | null {
  return value.trim() ? value.trim() : null;
}

function inferAppType(candidate: DiscoveredAppCandidate): RegisteredAppType {
  const value = `${candidate.name} ${candidate.publisher ?? ""} ${
    candidate.executable_path ?? ""
  }`.toLowerCase();

  if (/\b(chrome|edge|firefox|brave|opera|browser)\b/.test(value)) return "browser";
  if (/\b(code|visual studio|postman|github|jetbrains|android studio)\b/.test(value)) {
    return "dev_tool";
  }
  if (/\b(zoom|teams|slack|discord)\b/.test(value)) return "communication";
  if (/\b(word|excel|powerpoint|office|notion|obsidian|onenote|adobe acrobat)\b/.test(value)) {
    return "productivity";
  }
  if (/\b(figma|photoshop|illustrator|premiere|blender|canva)\b/.test(value)) return "design";

  return "other";
}

function normalizeComparablePath(value: string): string {
  return value.replace(/^\\\\\?\\/, "").replace(/\//g, "\\").trim().toLowerCase();
}

function normalizeComparableName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

function formatAppType(value: RegisteredAppType): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatUserFriendlyPath(value: string): string {
  return value.replace(/^\\\\\?\\/, "");
}

function cleanRegisteredAppDescription(value: string | null): string {
  if (!value) return "Klak can suggest opening this app when you ask.";

  return value
    .replace(/^Discovered from /i, "Added from ")
    .replace(/\.\s*Publisher:/i, " · Publisher:")
    .trim();
}