export const sqliteSchema = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT,
  confidence REAL DEFAULT 1,
  importance INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS action_logs (
  id TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  input_summary TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  status TEXT NOT NULL,
  user_approved INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_settings (
  tool_name TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS allowed_folders (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  repo_path TEXT,
  primary_stack TEXT,
  project_type TEXT,
  status TEXT,
  default_branch TEXT,
  dev_url TEXT,
  production_url TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_opened_at TEXT,
  startup_workflow_id TEXT
);

CREATE TABLE IF NOT EXISTS registered_apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  executable_path TEXT NOT NULL,
  app_type TEXT NOT NULL,
  description TEXT,
  allowed INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_launched_at TEXT
);

CREATE TABLE IF NOT EXISTS command_templates (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  command TEXT NOT NULL,
  working_directory TEXT NOT NULL,
  command_type TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  requires_confirmation INTEGER DEFAULT 1,
  timeout_seconds INTEGER DEFAULT 120,
  is_long_running INTEGER DEFAULT 0,
  allow_background_run INTEGER DEFAULT 0,
  max_runtime_seconds INTEGER,
  auto_stop_on_app_exit INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_run_at TEXT,
  run_count INTEGER DEFAULT 0,
  last_result_summary TEXT
);

CREATE TABLE IF NOT EXISTS background_processes (
  id TEXT PRIMARY KEY,
  command_template_id TEXT NOT NULL,
  project_id TEXT,
  name TEXT NOT NULL,
  command TEXT NOT NULL,
  working_directory TEXT NOT NULL,
  status TEXT NOT NULL,
  process_pid INTEGER,
  started_at TEXT NOT NULL,
  stopped_at TEXT,
  exit_code INTEGER,
  last_output_preview TEXT,
  output_log_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  trigger_phrase TEXT,
  steps_json TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  requires_confirmation INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_run_at TEXT,
  run_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS operator_task_runs (
  id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  current_step_id TEXT,
  approvals_json TEXT NOT NULL,
  verification_state_json TEXT NOT NULL,
  retries_json TEXT NOT NULL,
  final_report TEXT,
  failure_class TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operator_task_steps (
  id TEXT PRIMARY KEY,
  task_run_id TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  intent TEXT NOT NULL,
  execution_method TEXT NOT NULL,
  fallback_methods_json TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  verification_json TEXT NOT NULL,
  approval_required TEXT NOT NULL,
  status TEXT NOT NULL,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 0,
  verification_status TEXT NOT NULL,
  checkpoint_json TEXT,
  result_summary TEXT,
  failure_class TEXT,
  action_log_ids_json TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;
