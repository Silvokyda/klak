import { getDatabase } from "../db/database";
import { nowIso } from "../utils";

export async function getToolSettings(): Promise<Record<string, boolean>> {
  const db = await getDatabase();
  const rows = await db.select<{ tool_name: string; enabled: number | boolean }>("SELECT * FROM tool_settings");
  return Object.fromEntries(rows.map((row) => [row.tool_name, Boolean(row.enabled)]));
}

export async function setPersistedToolEnabled(toolName: string, enabled: boolean): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `INSERT INTO tool_settings (tool_name, enabled, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(tool_name) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
    [toolName, enabled ? 1 : 0, nowIso()]
  );
}

export async function isToolEnabled(toolName: string): Promise<boolean | null> {
  const db = await getDatabase();
  const rows = await db.select<{ enabled: number | boolean }>("SELECT * FROM tool_settings WHERE tool_name = ?", [toolName]);
  return rows[0] ? Boolean(rows[0].enabled) : null;
}
