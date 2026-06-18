export type PermissionMode =
  | "observe_only"
  | "suggest_only"
  | "draft_fill_only"
  | "act_with_confirmation"
  | "trusted_workflows_only";

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
  voiceInputProvider: "disabled" | "openai_transcription" | "local_whisper_cli";
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
  localWhisperExecutablePath: string;
  localWhisperModelPath: string;
  localWhisperLanguage: string;
  localWhisperThreads: number;
  keepTempAudioForDebugging: boolean;
  microphonePermissionStatus: "unknown" | "granted" | "denied" | "prompt";
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
