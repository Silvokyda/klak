import type { ProjectRecord, ProjectStatus, ProjectType } from "../../types";
import { getDatabase } from "../db/database";
import { id, nowIso } from "../utils";

export interface ProjectInput {
  name: string;
  description?: string | null;
  repo_path?: string | null;
  primary_stack?: string | null;
  project_type?: ProjectType;
  status?: ProjectStatus;
  default_branch?: string | null;
  dev_url?: string | null;
  production_url?: string | null;
  notes?: string | null;
}

export interface ProjectFilters {
  status?: ProjectStatus;
}

export async function createProject(input: ProjectInput): Promise<ProjectRecord> {
  const db = await getDatabase();
  const timestamp = nowIso();
  const project: ProjectRecord = {
    id: id("proj"),
    name: input.name,
    description: input.description ?? null,
    repo_path: input.repo_path ?? null,
    primary_stack: input.primary_stack ?? null,
    project_type: input.project_type ?? "other",
    status: input.status ?? "active",
    default_branch: input.default_branch ?? null,
    dev_url: input.dev_url ?? null,
    production_url: input.production_url ?? null,
    notes: input.notes ?? null,
    created_at: timestamp,
    updated_at: timestamp,
    last_opened_at: null
  };
  await db.execute(
    `INSERT INTO projects (id, name, description, repo_path, primary_stack, project_type, status, default_branch, dev_url, production_url, notes, created_at, updated_at, last_opened_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      project.id,
      project.name,
      project.description ?? null,
      project.repo_path ?? null,
      project.primary_stack ?? null,
      project.project_type,
      project.status,
      project.default_branch ?? null,
      project.dev_url ?? null,
      project.production_url ?? null,
      project.notes ?? null,
      project.created_at,
      project.updated_at,
      project.last_opened_at ?? null
    ]
  );
  return project;
}

export async function updateProject(projectId: string, input: Partial<ProjectInput>): Promise<ProjectRecord | null> {
  const existing = await getProjectById(projectId);
  if (!existing) return null;
  const updated: ProjectRecord = { ...existing, ...input, updated_at: nowIso() };
  const db = await getDatabase();
  await db.execute(
    `UPDATE projects
     SET name = ?, description = ?, repo_path = ?, primary_stack = ?, project_type = ?, status = ?, default_branch = ?, dev_url = ?, production_url = ?, notes = ?, updated_at = ?
     WHERE id = ?`,
    [
      updated.name,
      updated.description ?? null,
      updated.repo_path ?? null,
      updated.primary_stack ?? null,
      updated.project_type,
      updated.status,
      updated.default_branch ?? null,
      updated.dev_url ?? null,
      updated.production_url ?? null,
      updated.notes ?? null,
      updated.updated_at,
      projectId
    ]
  );
  return updated;
}

export async function deleteProject(projectId: string): Promise<void> {
  const db = await getDatabase();
  await db.execute("DELETE FROM projects WHERE id = ?", [projectId]);
}

export async function getProjectById(projectId: string): Promise<ProjectRecord | null> {
  const db = await getDatabase();
  const rows = await db.select<ProjectRecord>("SELECT * FROM projects WHERE id = ?", [projectId]);
  return rows[0] ?? null;
}

export async function listProjects(filters: ProjectFilters = {}): Promise<ProjectRecord[]> {
  const db = await getDatabase();
  return filters.status
    ? db.select<ProjectRecord>("SELECT * FROM projects WHERE status = ? ORDER BY updated_at DESC", [filters.status])
    : db.select<ProjectRecord>("SELECT * FROM projects ORDER BY updated_at DESC");
}

export async function searchProjects(query: string): Promise<ProjectRecord[]> {
  const db = await getDatabase();
  const like = `%${query.trim()}%`;
  if (!query.trim()) return listProjects();
  return db.select<ProjectRecord>(
    `SELECT * FROM projects
     WHERE name LIKE ? OR description LIKE ? OR repo_path LIKE ? OR primary_stack LIKE ? OR notes LIKE ?
     ORDER BY updated_at DESC`,
    [like, like, like, like, like]
  );
}

export async function touchProject(projectId: string): Promise<void> {
  const db = await getDatabase();
  await db.execute("UPDATE projects SET last_opened_at = ? WHERE id = ?", [nowIso(), projectId]);
}
