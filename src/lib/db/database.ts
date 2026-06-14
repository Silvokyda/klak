import Database from "@tauri-apps/plugin-sql";
import { sqliteSchema } from "./schema";

type BindValue = string | number | null;
type Row = Record<string, unknown>;

interface DbAdapter {
  execute(sql: string, bindValues?: BindValue[]): Promise<void>;
  select<T>(sql: string, bindValues?: BindValue[]): Promise<T[]>;
}

let adapterPromise: Promise<DbAdapter> | null = null;

export async function initDatabase(): Promise<void> {
  const db = await getDatabase();
  await db.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = await db.select<{ version: number }>("SELECT version FROM schema_migrations WHERE version = ?", [1]);
  if (applied.length === 0) {
    for (const statement of sqliteSchema.split(";").map((item) => item.trim()).filter(Boolean)) {
      await db.execute(statement);
    }
    await db.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", [1, new Date().toISOString()]);
  } else {
    for (const statement of sqliteSchema.split(";").map((item) => item.trim()).filter(Boolean)) {
      await db.execute(statement);
    }
  }
  try {
    await db.execute("ALTER TABLE projects ADD COLUMN startup_workflow_id TEXT");
  } catch {
    // Existing databases may already have the column.
  }
  for (const statement of [
    "ALTER TABLE command_templates ADD COLUMN is_long_running INTEGER DEFAULT 0",
    "ALTER TABLE command_templates ADD COLUMN allow_background_run INTEGER DEFAULT 0",
    "ALTER TABLE command_templates ADD COLUMN max_runtime_seconds INTEGER",
    "ALTER TABLE command_templates ADD COLUMN auto_stop_on_app_exit INTEGER DEFAULT 1"
  ]) {
    try {
      await db.execute(statement);
    } catch {
      // Existing databases may already have these columns.
    }
  }
}

export async function getDatabase(): Promise<DbAdapter> {
  adapterPromise ??= createAdapter();
  return adapterPromise;
}

export async function resetLocalDatabase(): Promise<void> {
  const db = await getDatabase();
  await db.execute("DELETE FROM memories");
  await db.execute("DELETE FROM action_logs");
  await db.execute("DELETE FROM app_settings");
  await db.execute("DELETE FROM tool_settings");
  await db.execute("DELETE FROM allowed_folders");
  await db.execute("DELETE FROM projects");
  await db.execute("DELETE FROM workflows");
  await db.execute("DELETE FROM registered_apps");
  await db.execute("DELETE FROM command_templates");
  await db.execute("DELETE FROM background_processes");
}

async function createAdapter(): Promise<DbAdapter> {
  if (isTauriRuntime()) {
    const sqlite = await Database.load("sqlite:klak.db");
    return {
      async execute(sql, bindValues = []) {
        await sqlite.execute(sql, bindValues);
      },
      async select<T>(sql: string, bindValues: BindValue[] = []) {
        return sqlite.select<T[]>(sql, bindValues);
      }
    };
  }
  return createInsecureDevDatabase();
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function createInsecureDevDatabase(): DbAdapter {
  const key = "klak.insecure_dev_database.v1";

  type State = {
    memories: Row[];
    action_logs: Row[];
    app_settings: Row[];
    tool_settings: Row[];
    allowed_folders: Row[];
    projects: Row[];
    workflows: Row[];
    registered_apps: Row[];
    command_templates: Row[];
    background_processes: Row[];
    schema_migrations: Row[];
  };

  const empty = (): State => ({
    memories: [],
    action_logs: [],
    app_settings: [],
    tool_settings: [],
    allowed_folders: [],
    projects: [],
    workflows: [],
    registered_apps: [],
    command_templates: [],
    background_processes: [],
    schema_migrations: []
  });

  const read = (): State => ({ ...empty(), ...JSON.parse(localStorage.getItem(key) ?? "{}") });
  const write = (state: State) => localStorage.setItem(key, JSON.stringify(state));

  return {
    async execute(sql, bindValues = []) {
      const state = read();
      const normalized = normalizeSql(sql);
      if (normalized.startsWith("CREATE TABLE") || normalized.startsWith("ALTER TABLE")) return;
      if (normalized.startsWith("INSERT INTO SCHEMA_MIGRATIONS")) state.schema_migrations.push({ version: bindValues[0], applied_at: bindValues[1] });
      else if (normalized.startsWith("INSERT INTO MEMORIES")) upsert(state.memories, memoryRow(bindValues));
      else if (normalized.startsWith("UPDATE MEMORIES")) updateById(state.memories, String(bindValues[9]), memoryPatch(bindValues));
      else if (normalized.startsWith("DELETE FROM MEMORIES")) removeById(state.memories, String(bindValues[0]));
      else if (normalized.startsWith("UPDATE MEMORIES SET LAST_USED_AT")) updateById(state.memories, String(bindValues[1]), { last_used_at: bindValues[0] });
      else if (normalized.startsWith("INSERT INTO ACTION_LOGS")) upsert(state.action_logs, actionRow(bindValues));
      else if (normalized.startsWith("UPDATE ACTION_LOGS")) updateById(state.action_logs, String(bindValues[7]), actionPatch(bindValues));
      else if (normalized.startsWith("INSERT INTO APP_SETTINGS")) upsertByKey(state.app_settings, { key: bindValues[0], value: bindValues[1], updated_at: bindValues[2] });
      else if (normalized.startsWith("INSERT INTO TOOL_SETTINGS")) upsertByToolName(state.tool_settings, { tool_name: bindValues[0], enabled: bindValues[1], updated_at: bindValues[2] });
      else if (normalized.startsWith("INSERT INTO ALLOWED_FOLDERS")) upsert(state.allowed_folders, { id: bindValues[0], path: bindValues[1], label: bindValues[2], created_at: bindValues[3] });
      else if (normalized.startsWith("DELETE FROM ALLOWED_FOLDERS")) removeById(state.allowed_folders, String(bindValues[0]));
      else if (normalized.startsWith("INSERT INTO PROJECTS")) upsert(state.projects, projectRow(bindValues));
      else if (normalized.startsWith("UPDATE PROJECTS SET LAST_OPENED_AT")) updateById(state.projects, String(bindValues[1]), { last_opened_at: bindValues[0] });
      else if (normalized.startsWith("UPDATE PROJECTS")) updateById(state.projects, String(bindValues[12]), projectPatch(bindValues));
      else if (normalized.startsWith("DELETE FROM PROJECTS")) removeById(state.projects, String(bindValues[0]));
      else if (normalized.startsWith("INSERT INTO REGISTERED_APPS")) upsert(state.registered_apps, registeredAppRow(bindValues));
      else if (normalized.startsWith("UPDATE REGISTERED_APPS SET LAST_LAUNCHED_AT")) updateById(state.registered_apps, String(bindValues[1]), { last_launched_at: bindValues[0] });
      else if (normalized.startsWith("UPDATE REGISTERED_APPS")) updateById(state.registered_apps, String(bindValues[7]), registeredAppPatch(bindValues));
      else if (normalized.startsWith("DELETE FROM REGISTERED_APPS")) removeById(state.registered_apps, String(bindValues[0]));
      else if (normalized.startsWith("INSERT INTO COMMAND_TEMPLATES")) upsert(state.command_templates, commandTemplateRow(bindValues));
      else if (normalized.startsWith("UPDATE COMMAND_TEMPLATES SET LAST_RUN_AT")) {
        const id = String(bindValues[2]);
        const template = state.command_templates.find((row) => row.id === id);
        updateById(state.command_templates, id, { last_run_at: bindValues[0], last_result_summary: bindValues[1], run_count: Number(template?.run_count ?? 0) + 1 });
      }
      else if (normalized.startsWith("UPDATE COMMAND_TEMPLATES")) updateById(state.command_templates, String(bindValues[15]), commandTemplatePatch(bindValues));
      else if (normalized.startsWith("DELETE FROM COMMAND_TEMPLATES")) removeById(state.command_templates, String(bindValues[0]));
      else if (normalized.startsWith("INSERT INTO BACKGROUND_PROCESSES")) upsert(state.background_processes, backgroundProcessRow(bindValues));
      else if (normalized.startsWith("UPDATE BACKGROUND_PROCESSES")) updateById(state.background_processes, String(bindValues[9]), backgroundProcessPatch(bindValues));
      else if (normalized.startsWith("DELETE FROM BACKGROUND_PROCESSES")) removeById(state.background_processes, String(bindValues[0]));
      else if (normalized.startsWith("INSERT INTO WORKFLOWS")) upsert(state.workflows, workflowRow(bindValues));
      else if (normalized.startsWith("UPDATE WORKFLOWS SET LAST_RUN_AT")) {
        const id = String(bindValues[1]);
        const workflow = state.workflows.find((row) => row.id === id);
        updateById(state.workflows, id, { last_run_at: bindValues[0], run_count: Number(workflow?.run_count ?? 0) + 1 });
      }
      else if (normalized.startsWith("UPDATE WORKFLOWS")) updateById(state.workflows, String(bindValues[10]), workflowPatch(bindValues));
      else if (normalized.startsWith("DELETE FROM WORKFLOWS")) removeById(state.workflows, String(bindValues[0]));
      else if (normalized.startsWith("DELETE FROM")) {
        const table = normalized.split(" ")[2].toLowerCase() as keyof State;
        if (Array.isArray(state[table])) state[table] = [];
      }
      write(state);
    },
    async select<T>(sql: string, bindValues: BindValue[] = []) {
      const state = read();
      const normalized = normalizeSql(sql);
      let rows: Row[] = [];
      if (normalized.includes("FROM SCHEMA_MIGRATIONS")) rows = state.schema_migrations.filter((row) => row.version === bindValues[0]);
      else if (normalized.includes("FROM MEMORIES")) rows = selectMemories(state.memories, normalized, bindValues);
      else if (normalized.includes("FROM ACTION_LOGS")) rows = selectActionLogs(state.action_logs, normalized, bindValues);
      else if (normalized.includes("FROM APP_SETTINGS")) rows = selectSettings(state.app_settings, normalized, bindValues);
      else if (normalized.includes("FROM TOOL_SETTINGS")) rows = selectToolSettings(state.tool_settings, normalized, bindValues);
      else if (normalized.includes("FROM ALLOWED_FOLDERS")) rows = [...state.allowed_folders].sort(sortCreatedDesc);
      else if (normalized.includes("FROM PROJECTS")) rows = selectProjects(state.projects, normalized, bindValues);
      else if (normalized.includes("FROM WORKFLOWS")) rows = selectWorkflows(state.workflows, normalized, bindValues);
      else if (normalized.includes("FROM REGISTERED_APPS")) rows = selectRegisteredApps(state.registered_apps, normalized, bindValues);
      else if (normalized.includes("FROM COMMAND_TEMPLATES")) rows = selectCommandTemplates(state.command_templates, normalized, bindValues);
      else if (normalized.includes("FROM BACKGROUND_PROCESSES")) rows = selectBackgroundProcesses(state.background_processes, normalized, bindValues);
      return rows as T[];
    }
  };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toUpperCase();
}

function upsert(rows: Row[], row: Row) {
  const index = rows.findIndex((item) => item.id === row.id);
  if (index >= 0) rows[index] = row;
  else rows.push(row);
}

function upsertByKey(rows: Row[], row: Row) {
  const index = rows.findIndex((item) => item.key === row.key);
  if (index >= 0) rows[index] = row;
  else rows.push(row);
}

function upsertByToolName(rows: Row[], row: Row) {
  const index = rows.findIndex((item) => item.tool_name === row.tool_name);
  if (index >= 0) rows[index] = row;
  else rows.push(row);
}

function removeById(rows: Row[], id: string) {
  const index = rows.findIndex((row) => row.id === id);
  if (index >= 0) rows.splice(index, 1);
}

function updateById(rows: Row[], id: string, patch: Row) {
  const index = rows.findIndex((row) => row.id === id);
  if (index >= 0) rows[index] = { ...rows[index], ...patch };
}

function memoryRow(values: BindValue[]): Row {
  const [id, type, title, content, source, confidence, importance, created_at, updated_at, last_used_at, expires_at] = values;
  return { id, type, title, content, source, confidence, importance, created_at, updated_at, last_used_at, expires_at };
}

function memoryPatch(values: BindValue[]): Row {
  const [type, title, content, source, confidence, importance, updated_at, last_used_at, expires_at] = values;
  return { type, title, content, source, confidence, importance, updated_at, last_used_at, expires_at };
}

function actionRow(values: BindValue[]): Row {
  const [id, tool_name, input_summary, risk_level, status, user_approved, created_at, completed_at, error_message] = values;
  return { id, tool_name, input_summary, risk_level, status, user_approved, created_at, completed_at, error_message };
}

function actionPatch(values: BindValue[]): Row {
  const [tool_name, input_summary, risk_level, status, user_approved, completed_at, error_message] = values;
  return { tool_name, input_summary, risk_level, status, user_approved, completed_at, error_message };
}

function projectRow(values: BindValue[]): Row {
  const [id, name, description, repo_path, primary_stack, project_type, status, default_branch, dev_url, production_url, notes, created_at, updated_at, last_opened_at, startup_workflow_id] = values;
  return { id, name, description, repo_path, primary_stack, project_type, status, default_branch, dev_url, production_url, notes, created_at, updated_at, last_opened_at, startup_workflow_id };
}

function projectPatch(values: BindValue[]): Row {
  const [name, description, repo_path, primary_stack, project_type, status, default_branch, dev_url, production_url, notes, updated_at, startup_workflow_id] = values;
  return { name, description, repo_path, primary_stack, project_type, status, default_branch, dev_url, production_url, notes, updated_at, startup_workflow_id };
}

function registeredAppRow(values: BindValue[]): Row {
  const [id, name, executable_path, app_type, description, allowed, created_at, updated_at, last_launched_at] = values;
  return { id, name, executable_path, app_type, description, allowed, created_at, updated_at, last_launched_at };
}

function registeredAppPatch(values: BindValue[]): Row {
  const [name, executable_path, app_type, description, allowed, updated_at, last_launched_at] = values;
  return { name, executable_path, app_type, description, allowed, updated_at, last_launched_at };
}

function commandTemplateRow(values: BindValue[]): Row {
  const [id, project_id, name, description, command, working_directory, command_type, risk_level, enabled, requires_confirmation, timeout_seconds, is_long_running, allow_background_run, max_runtime_seconds, auto_stop_on_app_exit, created_at, updated_at, last_run_at, run_count, last_result_summary] = values;
  return { id, project_id, name, description, command, working_directory, command_type, risk_level, enabled, requires_confirmation, timeout_seconds, is_long_running, allow_background_run, max_runtime_seconds, auto_stop_on_app_exit, created_at, updated_at, last_run_at, run_count, last_result_summary };
}

function commandTemplatePatch(values: BindValue[]): Row {
  const [project_id, name, description, command, working_directory, command_type, risk_level, enabled, requires_confirmation, timeout_seconds, is_long_running, allow_background_run, max_runtime_seconds, auto_stop_on_app_exit, updated_at] = values;
  return { project_id, name, description, command, working_directory, command_type, risk_level, enabled, requires_confirmation, timeout_seconds, is_long_running, allow_background_run, max_runtime_seconds, auto_stop_on_app_exit, updated_at };
}

function backgroundProcessRow(values: BindValue[]): Row {
  const [id, command_template_id, project_id, name, command, working_directory, status, process_pid, started_at, stopped_at, exit_code, last_output_preview, output_log_path, created_at, updated_at] = values;
  return { id, command_template_id, project_id, name, command, working_directory, status, process_pid, started_at, stopped_at, exit_code, last_output_preview, output_log_path, created_at, updated_at };
}

function backgroundProcessPatch(values: BindValue[]): Row {
  const [status, process_pid, stopped_at, exit_code, last_output_preview, output_log_path, updated_at, name, command, id] = values;
  return { status, process_pid, stopped_at, exit_code, last_output_preview, output_log_path, updated_at, name, command, id };
}

function workflowRow(values: BindValue[]): Row {
  const [id, project_id, name, description, trigger_phrase, steps_json, risk_level, requires_confirmation, created_at, updated_at, last_run_at, run_count] = values;
  return { id, project_id, name, description, trigger_phrase, steps_json, risk_level, requires_confirmation, created_at, updated_at, last_run_at, run_count };
}

function workflowPatch(values: BindValue[]): Row {
  const [project_id, name, description, trigger_phrase, steps_json, risk_level, requires_confirmation, updated_at, last_run_at, run_count] = values;
  return { project_id, name, description, trigger_phrase, steps_json, risk_level, requires_confirmation, updated_at, last_run_at, run_count };
}

function selectMemories(rows: Row[], sql: string, values: BindValue[]): Row[] {
  let result = rows.filter((row) => !row.expires_at || Date.parse(String(row.expires_at)) > Date.now());
  if (sql.includes("WHERE ID =")) result = result.filter((row) => row.id === values[0]);
  if (sql.includes("TYPE =")) result = result.filter((row) => row.type === values[0]);
  if (sql.includes("LIKE")) {
      const query = String(values[0] ?? "").replace(/%/g, "").toLowerCase();
    result = result.filter((row) => `${row.title} ${row.content} ${row.source} ${row.type}`.toLowerCase().includes(query));
  }
  return result.sort((a, b) => Date.parse(String(b.updated_at)) - Date.parse(String(a.updated_at)));
}

function selectActionLogs(rows: Row[], sql: string, values: BindValue[]): Row[] {
  let result = [...rows];
  if (sql.includes("WHERE ID =")) result = result.filter((row) => row.id === values[0]);
  if (sql.includes("STATUS =")) result = result.filter((row) => row.status === values[0]);
  return result.sort((a, b) => Date.parse(String(b.created_at)) - Date.parse(String(a.created_at)));
}

function selectSettings(rows: Row[], sql: string, values: BindValue[]): Row[] {
  if (sql.includes("WHERE KEY =")) return rows.filter((row) => row.key === values[0]);
  return rows;
}

function selectToolSettings(rows: Row[], sql: string, values: BindValue[]): Row[] {
  if (sql.includes("WHERE TOOL_NAME =")) return rows.filter((row) => row.tool_name === values[0]);
  return rows;
}

function selectProjects(rows: Row[], sql: string, values: BindValue[]): Row[] {
  let result = [...rows];
  if (sql.includes("WHERE ID =")) result = result.filter((row) => row.id === values[0]);
  else if (sql.includes("LIKE")) {
    const query = String(values[0] ?? "").replace(/%/g, "").toLowerCase();
    result = result.filter((row) => `${row.name} ${row.description} ${row.repo_path} ${row.primary_stack} ${row.notes}`.toLowerCase().includes(query));
  } else if (sql.includes("STATUS =")) result = result.filter((row) => row.status === values[0]);
  return result.sort((a, b) => Date.parse(String(b.updated_at)) - Date.parse(String(a.updated_at)));
}

function selectWorkflows(rows: Row[], sql: string, values: BindValue[]): Row[] {
  let result = [...rows];
  if (sql.includes("WHERE ID =")) result = result.filter((row) => row.id === values[0]);
  else if (sql.includes("LIKE")) {
    const query = String(values[0] ?? "").replace(/%/g, "").toLowerCase();
    result = result.filter((row) => `${row.name} ${row.description} ${row.trigger_phrase} ${row.steps_json}`.toLowerCase().includes(query));
  } else if (sql.includes("PROJECT_ID =")) result = result.filter((row) => row.project_id === values[0]);
  return result.sort((a, b) => Date.parse(String(b.updated_at)) - Date.parse(String(a.updated_at)));
}

function selectRegisteredApps(rows: Row[], sql: string, values: BindValue[]): Row[] {
  let result = [...rows];
  if (sql.includes("WHERE ID =")) result = result.filter((row) => row.id === values[0]);
  else if (sql.includes("LIKE")) {
    const query = String(values[0] ?? "").replace(/%/g, "").toLowerCase();
    result = result.filter((row) => `${row.name} ${row.executable_path} ${row.app_type} ${row.description}`.toLowerCase().includes(query));
  } else if (sql.includes("ALLOWED =")) result = result.filter((row) => row.allowed === values[0]);
  return result.sort((a, b) => Date.parse(String(b.updated_at)) - Date.parse(String(a.updated_at)));
}

function selectCommandTemplates(rows: Row[], sql: string, values: BindValue[]): Row[] {
  let result = [...rows];
  if (sql.includes("WHERE ID =")) result = result.filter((row) => row.id === values[0]);
  else if (sql.includes("LIKE")) {
    const query = String(values[0] ?? "").replace(/%/g, "").toLowerCase();
    result = result.filter((row) => `${row.name} ${row.description} ${row.command} ${row.working_directory} ${row.command_type}`.toLowerCase().includes(query));
  } else if (sql.includes("PROJECT_ID =")) result = result.filter((row) => row.project_id === values[0]);
  else if (sql.includes("ENABLED =")) result = result.filter((row) => row.enabled === values[0]);
  return result.sort((a, b) => Date.parse(String(b.updated_at)) - Date.parse(String(a.updated_at)));
}

function selectBackgroundProcesses(rows: Row[], sql: string, values: BindValue[]): Row[] {
  let result = [...rows];
  if (sql.includes("WHERE ID =")) result = result.filter((row) => row.id === values[0]);
  else if (sql.includes("COMMAND_TEMPLATE_ID =")) result = result.filter((row) => row.command_template_id === values[0]);
  else if (sql.includes("PROJECT_ID =")) result = result.filter((row) => row.project_id === values[0]);
  else if (sql.includes("STATUS IN")) result = result.filter((row) => ["starting", "running"].includes(String(row.status)));
  return result.sort((a, b) => Date.parse(String(b.updated_at)) - Date.parse(String(a.updated_at)));
}

function sortCreatedDesc(a: Row, b: Row) {
  return Date.parse(String(b.created_at)) - Date.parse(String(a.created_at));
}
