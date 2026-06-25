export type PermissionMode =
  | "observe_only"
  | "suggest_only"
  | "draft_fill_only"
  | "act_with_confirmation"
  | "trusted_workflows_only";

export type OperatorMode = "observe" | "assisted" | "autopilot" | "unattended";

export type MemoryType =
  | "profile"
  | "preference"
  | "project"
  | "workflow"
  | "task"
  | "document"
  | "command_history";

export type RiskLevel = "low" | "medium" | "high" | "dangerous";

export type ActionStatus =
  | "proposed"
  | "approved"
  | "denied"
  | "running"
  | "completed"
  | "failed"
  | "blocked";

export type OperatorTaskStatus =
  | "draft"
  | "planning"
  | "ready"
  | "awaiting_approval"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled";

export type OperatorStepKind =
  | "command"
  | "filesystem"
  | "browser"
  | "window"
  | "launch_app"
  | "approval"
  | "secret_prompt"
  | "manual_review"
  | "human_takeover";

export type OperatorStepStatus =
  | "pending"
  | "ready"
  | "running"
  | "awaiting_approval"
  | "awaiting_manual"
  | "completed"
  | "failed"
  | "blocked"
  | "skipped";

export type ExecutionMethod =
  | "command_template"
  | "filesystem"
  | "browser_dom"
  | "windows_ui"
  | "mouse_keyboard"
  | "human_takeover";

export type VerificationStatus = "pending" | "verified" | "failed" | "skipped";

export type ApprovalRequirement =
  | "none"
  | "before_step"
  | "before_consequential_action"
  | "secret_input_required";

export type OperatorFailureClass =
  | "transient"
  | "permission_blocked"
  | "environment_changed"
  | "verification_failed"
  | "unsupported"
  | "human_required";

export interface MemoryRecord {
  id: string;
  type: MemoryType;
  title: string;
  content: string;
  source: string;
  confidence: number;
  importance: number;
  created_at: string;
  updated_at: string;
  last_used_at?: string | null;
  expires_at?: string | null;
}

export interface ActionLog {
  id: string;
  tool_name: string;
  input_summary: string;
  risk_level: RiskLevel;
  status: ActionStatus;
  user_approved: boolean | null;
  created_at: string;
  completed_at?: string | null;
  error_message?: string | null;
}

export interface AppSettings {
  setupComplete: boolean;
  aiProvider: "openai_compatible" | "claude" | "local";
  apiBaseUrl: string;
  modelName: string;
  apiKeyStored: boolean;
  permissionMode: PermissionMode;
  allowedFolders: string[];
  clipboardReadEnabled: boolean;
  localContextEnabled: boolean;
  allToolsDisabled: boolean;
  voiceEnabled: boolean;
  pushToTalkEnabled: boolean;
  voiceConversationMode: "local_push_to_talk" | "openai_realtime";
  voiceInputProvider: "disabled" | "openai_transcription" | "local_whisper_cli";
  realtimeVoiceModel: string;
  realtimeVoiceName: string;
  voiceOutputProvider: "disabled" | "web_speech";
  voiceOutputVoiceName: string;
  voiceOutputRate: number;
  voiceOutputPitch: number;
  openAiTranscriptionModel: string;
  voiceProfileEnabled: boolean;
  voiceProfileStatus: "not_enrolled" | "enrolled";
  voiceProfileCalibration: string;
  wakeWordEnabled: boolean;
  wakeWordProvider: "openwakeword_sidecar";
  wakeWordPythonPath: string;
  wakeWordModel: string;
  wakeWordCustomModelPath: string;
  wakeWordThreshold: number;
  wakeWordDiagnosticsEnabled: boolean;
  wakeWordDeviceName: string;
  wakeWordDeviceIndex: number | null;
  localWhisperExecutablePath: string;
  localWhisperModelPath: string;
  localWhisperLanguage: string;
  localWhisperThreads: number;
  keepTempAudioForDebugging: boolean;
  microphonePermissionStatus: "unknown" | "granted" | "denied" | "prompt";
}

export interface TaskScope {
  allowed_apps: string[];
  allowed_folders: string[];
  allowed_domains: string[];
  allowed_command_template_ids: string[];
  allowed_recipients: string[];
  allowed_action_classes: string[];
  max_actions: number;
  max_runtime_seconds: number;
}

export interface AllowedFolder {
  id: string;
  path: string;
  label?: string | null;
  created_at: string;
}

export type ProjectType =
  | "web_app"
  | "mobile_app"
  | "backend"
  | "desktop_app"
  | "ai_project"
  | "documentation"
  | "business"
  | "other";

export type ProjectStatus = "active" | "paused" | "archived";

export interface ProjectRecord {
  id: string;
  name: string;
  description?: string | null;
  repo_path?: string | null;
  primary_stack?: string | null;
  project_type: ProjectType;
  status: ProjectStatus;
  default_branch?: string | null;
  dev_url?: string | null;
  production_url?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  last_opened_at?: string | null;
  startup_workflow_id?: string | null;
}

export type RegisteredAppType = "editor" | "browser" | "design" | "communication" | "productivity" | "dev_tool" | "other";

export interface RegisteredAppRecord {
  id: string;
  name: string;
  executable_path: string;
  app_type: RegisteredAppType;
  description?: string | null;
  allowed: boolean;
  created_at: string;
  updated_at: string;
  last_launched_at?: string | null;
}

export interface DiscoveredAppCandidate {
  id: string;
  name: string;
  normalized_name: string;
  executable_path?: string | null;
  source: string;
  publisher?: string | null;
  icon_path?: string | null;
  confidence: "high" | "medium" | "low" | string;
  category: "recommended" | "already_registered" | "advanced" | "unsupported" | "blocked" | string;
  is_registered: boolean;
  is_blocked: boolean;
  block_reason?: string | null;
  detected_at: string;
}

export type CommandTemplateType = "npm" | "node" | "cargo" | "git_readonly" | "flutter" | "php_artisan" | "python" | "custom_safe";

export interface CommandTemplateRecord {
  id: string;
  project_id?: string | null;
  name: string;
  description?: string | null;
  command: string;
  working_directory: string;
  command_type: CommandTemplateType;
  risk_level: Exclude<RiskLevel, "dangerous">;
  enabled: boolean;
  requires_confirmation: boolean;
  timeout_seconds: number;
  is_long_running: boolean;
  allow_background_run: boolean;
  max_runtime_seconds?: number | null;
  auto_stop_on_app_exit: boolean;
  created_at: string;
  updated_at: string;
  last_run_at?: string | null;
  run_count: number;
  last_result_summary?: string | null;
}

export type BackgroundProcessStatus = "starting" | "running" | "stopped" | "exited" | "failed" | "killed" | "blocked" | "stale";

export interface BackgroundProcessRecord {
  id: string;
  command_template_id: string;
  project_id?: string | null;
  name: string;
  command: string;
  working_directory: string;
  status: BackgroundProcessStatus;
  process_pid?: number | null;
  started_at: string;
  stopped_at?: string | null;
  exit_code?: number | null;
  last_output_preview?: string | null;
  output_log_path?: string | null;
  created_at: string;
  updated_at: string;
}

export type WorkflowStepType =
  | "open_url"
  | "open_folder"
  | "launch_app"
  | "run_command_template"
  | "start_background_process"
  | "create_note"
  | "copy_to_clipboard"
  | "search_memory"
  | "create_memory"
  | "manual_instruction";

export interface WorkflowStep {
  type: WorkflowStepType;
  label?: string;
  input: Record<string, unknown>;
}

export interface WorkflowRecord {
  id: string;
  project_id?: string | null;
  name: string;
  description?: string | null;
  trigger_phrase?: string | null;
  steps_json: string;
  risk_level: RiskLevel;
  requires_confirmation: boolean;
  created_at: string;
  updated_at: string;
  last_run_at?: string | null;
  run_count: number;
}

export interface LocalContextSnapshot {
  activeWindowTitle?: string;
  currentBrowserUrl?: string;
  selectedText?: string;
  clipboardContent?: string;
  allowedFileContents?: Array<{ path: string; content: string }>;
  screenshot?: never;
}

export interface BrowserObservation {
  session_id?: string | null;
  url?: string | null;
  title?: string | null;
  visible_text?: string | null;
  selector_found?: boolean | null;
  content_excerpt?: string | null;
}

export interface WindowObservation {
  title: string;
  process_name?: string | null;
  pid?: number | null;
  is_foreground?: boolean;
}

export interface ProcessObservation {
  pid: number;
  process_name: string;
  window_title?: string | null;
}

export interface FileObservation {
  path: string;
  exists: boolean;
  size?: number | null;
  modified_at?: string | null;
}

export interface CommandObservation {
  exit_code?: number | null;
  stdout_excerpt?: string | null;
  stderr_excerpt?: string | null;
  timed_out?: boolean;
}

export interface ObservationSnapshot {
  windows: WindowObservation[];
  processes: ProcessObservation[];
  files: FileObservation[];
  browser_state?: BrowserObservation | null;
  command_result?: CommandObservation | null;
  screenshot_ref?: string | null;
  observed_at: string;
}

export type VerificationRule =
  | {
      type: "none";
    }
  | {
      type: "command_result";
      expect_exit_code?: number;
      stdout_includes?: string;
      stderr_excludes?: string;
    }
  | {
      type: "file_exists";
      path: string;
      content_includes?: string;
    }
  | {
      type: "process_running";
      process_name?: string;
      pid?: number;
      port?: number;
    }
  | {
      type: "browser_text";
      text: string;
      url_includes?: string;
    }
  | {
      type: "window_title";
      title_includes: string;
    };

export interface CheckpointRecord {
  type: "file_backup" | "draft_state" | "note" | "none";
  target?: string | null;
  backup_path?: string | null;
  created_at: string;
  summary: string;
}

export interface OperatorTaskPlanStep {
  title: string;
  kind: OperatorStepKind;
  intent: string;
  execution_method: ExecutionMethod;
  fallback_methods: ExecutionMethod[];
  inputs: Record<string, unknown>;
  verification: VerificationRule;
  approval_required: ApprovalRequirement;
  retry_limit: number;
  requires_human_reason?: string | null;
}

export interface OperatorTaskPlan {
  summary: string;
  scope: TaskScope;
  steps: OperatorTaskPlanStep[];
}

export interface OperatorTaskRun {
  id: string;
  goal: string;
  mode: OperatorMode;
  status: OperatorTaskStatus;
  scope_json: string;
  plan_json: string;
  current_step_id?: string | null;
  approvals_json: string;
  verification_state_json: string;
  retries_json: string;
  final_report?: string | null;
  failure_class?: OperatorFailureClass | null;
  started_at: string;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface OperatorTaskStep {
  id: string;
  task_run_id: string;
  order_index: number;
  title: string;
  kind: OperatorStepKind;
  intent: string;
  execution_method: ExecutionMethod;
  fallback_methods_json: string;
  inputs_json: string;
  verification_json: string;
  approval_required: ApprovalRequirement;
  status: OperatorStepStatus;
  retry_count: number;
  max_retries: number;
  verification_status: VerificationStatus;
  checkpoint_json?: string | null;
  result_summary?: string | null;
  failure_class?: OperatorFailureClass | null;
  action_log_ids_json: string;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface OperatorTaskRunHydrated extends OperatorTaskRun {
  scope: TaskScope;
  plan: OperatorTaskPlan;
  approvals: string[];
  verification_state: Record<string, VerificationStatus>;
  retries: Record<string, number>;
  steps: OperatorTaskStepHydrated[];
}

export interface OperatorTaskStepHydrated extends OperatorTaskStep {
  fallback_methods: ExecutionMethod[];
  inputs: Record<string, unknown>;
  verification: VerificationRule;
  checkpoint?: CheckpointRecord | null;
  action_log_ids: string[];
}

export interface AIRequest {
  userMessage: string;
  relevantMemories: MemoryRecord[];
  relevantProjects?: ProjectRecord[];
  relevantWorkflows?: WorkflowRecord[];
  relevantRegisteredApps?: RegisteredAppRecord[];
  relevantCommandTemplates?: CommandTemplateRecord[];
  relevantBackgroundProcesses?: BackgroundProcessRecord[];
  currentPermissionMode: PermissionMode;
  availableTools: ToolDefinition[];
  recentActionLogs: ActionLog[];
  localContext?: LocalContextSnapshot;
}

export interface OperatorPlannerRequest {
  userGoal: string;
  mode: OperatorMode;
  permissionMode: PermissionMode;
  availableProjects: ProjectRecord[];
  availableCommandTemplates: CommandTemplateRecord[];
  availableRegisteredApps: RegisteredAppRecord[];
  runningProcesses: BackgroundProcessRecord[];
  allowedFolders: string[];
}

export interface AIResponse {
  message: string;
  suggestedAction?: ToolActionInput;
  suggestedMemory?: Pick<MemoryRecord, "type" | "title" | "content" | "source" | "confidence" | "importance">;
}

export interface AIProvider {
  generateResponse(input: AIRequest): Promise<AIResponse>;
}

export interface ToolDefinition {
  name: string;
  label: string;
  description: string;
  riskLevel: RiskLevel;
  enabled: boolean;
  future: boolean;
}

export interface ToolActionInput {
  toolName: string;
  input: Record<string, unknown>;
}

export interface ActionPreview {
  id: string;
  tool: ToolDefinition;
  input: Record<string, unknown>;
  inputSummary: string;
  message: string;
  riskLevel: RiskLevel;
  canRun: boolean;
  requiresConfirmation: boolean;
}

export interface VoiceTranscriptionInput {
  audio: Blob;
  settings: AppSettings;
}

export interface VoiceTranscriptionResult {
  text: string;
  error?: string;
  warning?: string;
  durationMs?: number;
}

export interface VoiceTranscriptionProvider {
  transcribe(input: VoiceTranscriptionInput): Promise<VoiceTranscriptionResult>;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}
