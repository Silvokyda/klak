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
}

export interface AllowedFolder {
  id: string;
  path: string;
  label?: string | null;
  created_at: string;
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

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}
