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
    schema_migrations: Row[];
  };

  const empty = (): State => ({
    memories: [],
    action_logs: [],
    app_settings: [],
    tool_settings: [],
    allowed_folders: [],
    schema_migrations: []
  });

  const read = (): State => ({ ...empty(), ...JSON.parse(localStorage.getItem(key) ?? "{}") });
  const write = (state: State) => localStorage.setItem(key, JSON.stringify(state));

  return {
    async execute(sql, bindValues = []) {
      const state = read();
      const normalized = normalizeSql(sql);
      if (normalized.startsWith("CREATE TABLE")) return;
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

function sortCreatedDesc(a: Row, b: Row) {
  return Date.parse(String(b.created_at)) - Date.parse(String(a.created_at));
}
