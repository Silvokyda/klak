import type { AIProvider, AIRequest, AIResponse } from "../../types";
import { apiKeyVault } from "../security/apiKeyVault";

interface ChatToolCall {
  function?: {
    name?: string;
    arguments?: string;
  };
}

export class OpenAICompatibleProvider implements AIProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string
  ) {}

  async generateResponse(input: AIRequest): Promise<AIResponse> {
    const apiKey = await apiKeyVault.getApiKeyForProviderCall();
    if (!apiKey) {
      return {
        message:
          "I need an API key before I can call the configured AI provider. You can add one in Settings."
      };
    }

    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        tool_choice: "auto",
        tools: buildOpenAiTools(input),
        messages: [
          {
            role: "system",
            content:
              "You are Klak, a local-first Windows AI operator. Do not request or expose secrets. When a user asks for a concrete supported action, call exactly one matching tool with IDs from the provided context. The app will preview and require approval before execution. If no safe exact action is available, answer normally and explain what setup is needed."
          },
          {
            role: "user",
            content: JSON.stringify({
              message: input.userMessage,
              memories: input.relevantMemories,
              projects: input.relevantProjects ?? [],
              workflows: (input.relevantWorkflows ?? []).map((workflow) => ({
                id: workflow.id,
                name: workflow.name,
                description: workflow.description,
                triggerPhrase: workflow.trigger_phrase,
                riskLevel: workflow.risk_level
              })),
              registeredApps: (input.relevantRegisteredApps ?? []).map((app) => ({
                id: app.id,
                name: app.name,
                appType: app.app_type,
                allowed: app.allowed
              })),
              commandTemplates: (input.relevantCommandTemplates ?? []).map((command) => ({
                id: command.id,
                projectId: command.project_id,
                name: command.name,
                command: command.command,
                commandType: command.command_type,
                riskLevel: command.risk_level,
                enabled: command.enabled
              })),
              backgroundProcesses: (input.relevantBackgroundProcesses ?? []).map((process) => ({
                id: process.id,
                name: process.name,
                projectId: process.project_id,
                status: process.status,
                pid: process.process_pid
              })),
              permissionMode: input.currentPermissionMode,
              availableTools: input.availableTools.map((tool) => ({
                name: tool.name,
                enabled: tool.enabled,
                riskLevel: tool.riskLevel
              })),
              recentActionLogs: input.recentActionLogs.slice(0, 5),
              localContext: input.localContext ?? {}
            })
          }
        ]
      })
    });

    if (!response.ok) {
      return { message: `The AI provider returned ${response.status}. Check your API key and model settings.` };
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;
    const toolCall = Array.isArray(message?.tool_calls) ? message.tool_calls[0] as ChatToolCall | undefined : undefined;
    const suggestedAction = toolCallToSuggestedAction(toolCall);
    if (suggestedAction) {
      return {
        message: message?.content || actionMessage(suggestedAction.toolName),
        suggestedAction
      };
    }

    return {
      message: message?.content ?? "I did not receive a usable response."
    };
  }
}

function toolCallToSuggestedAction(toolCall: ChatToolCall | undefined): AIResponse["suggestedAction"] {
  const name = toolCall?.function?.name;
  const rawArgs = toolCall?.function?.arguments;
  if (!name || !rawArgs) return undefined;

  try {
    const input = JSON.parse(rawArgs) as Record<string, unknown>;
    return { toolName: name, input };
  } catch {
    return undefined;
  }
}

function actionMessage(toolName: string): string {
  const labels: Record<string, string> = {
    open_url: "I can open that URL after you approve the preview.",
    open_folder: "I can open that folder after you approve the preview.",
    create_memory: "I can save that as memory after you approve the preview.",
    search_memory: "I can search memory and log the query.",
    create_note: "I can create that note after you approve the preview.",
    copy_to_clipboard: "I can copy that text after you approve the preview.",
    launch_app: "I found a registered app. Review the action preview before it launches.",
    run_command_template: "I found a saved action. Review the action preview before it runs.",
    start_background_process: "I found a running activity. Review the action preview before it starts."
  };
  return labels[toolName] ?? "I prepared an action preview for your approval.";
}

function buildOpenAiTools(input: AIRequest) {
  const enabled = new Set(input.availableTools.filter((tool) => tool.enabled && !tool.future).map((tool) => tool.name));
  const launchableAppIds = input.relevantRegisteredApps?.filter((app) => app.allowed).map((app) => app.id) ?? [];
  const runnableCommandIds = input.relevantCommandTemplates?.filter((command) => command.enabled && !command.is_long_running).map((command) => command.id) ?? [];
  const backgroundCommandIds = input.relevantCommandTemplates?.filter((command) => command.enabled && command.is_long_running && command.allow_background_run).map((command) => command.id) ?? [];

  return [
    enabled.has("open_url") && {
      type: "function",
      function: {
        name: "open_url",
        description: "Open a normal http or https URL in the default browser after user approval.",
        parameters: objectSchema({
          url: { type: "string", description: "The full http or https URL." }
        }, ["url"])
      }
    },
    enabled.has("open_folder") && {
      type: "function",
      function: {
        name: "open_folder",
        description: "Open a folder after user approval. The path must be one of the user's allowed folders.",
        parameters: objectSchema({
          path: { type: "string", description: "The exact folder path from allowed local context or project context." }
        }, ["path"])
      }
    },
    enabled.has("create_memory") && {
      type: "function",
      function: {
        name: "create_memory",
        description: "Save a non-sensitive user preference, project fact, task, workflow, document note, or profile fact as local memory.",
        parameters: objectSchema({
          type: { type: "string", enum: ["profile", "preference", "project", "workflow", "task", "document", "command_history"] },
          title: { type: "string" },
          content: { type: "string" },
          source: { type: "string", description: "Use explicit_user_request when the user asked Klak to remember it." }
        }, ["type", "title", "content", "source"])
      }
    },
    enabled.has("search_memory") && {
      type: "function",
      function: {
        name: "search_memory",
        description: "Search Klak local memory.",
        parameters: objectSchema({
          query: { type: "string" }
        }, ["query"])
      }
    },
    enabled.has("create_note") && {
      type: "function",
      function: {
        name: "create_note",
        description: "Create a Markdown note in an allowed folder after user approval.",
        parameters: objectSchema({
          title: { type: "string" },
          content: { type: "string" },
          destinationFolder: { type: "string", description: "A folder path the user has allowed." }
        }, ["title", "content", "destinationFolder"])
      }
    },
    enabled.has("copy_to_clipboard") && {
      type: "function",
      function: {
        name: "copy_to_clipboard",
        description: "Copy text to the clipboard after user approval.",
        parameters: objectSchema({
          text: { type: "string" }
        }, ["text"])
      }
    },
    enabled.has("launch_app") && launchableAppIds.length > 0 && {
      type: "function",
      function: {
        name: "launch_app",
        description: "Launch an app that already exists in registeredApps. Use only an exact registered_app_id from context.",
        parameters: objectSchema({
          registered_app_id: {
            type: "string",
            enum: launchableAppIds,
            description: "ID of the registered app to launch."
          }
        }, ["registered_app_id"])
      }
    },
    enabled.has("run_command_template") && runnableCommandIds.length > 0 && {
      type: "function",
      function: {
        name: "run_command_template",
        description: "Run an enabled non-long-running saved action. Use only a command_template_id from context.",
        parameters: objectSchema({
          command_template_id: {
            type: "string",
            enum: runnableCommandIds,
            description: "ID of the saved action."
          }
        }, ["command_template_id"])
      }
    },
    enabled.has("start_background_process") && backgroundCommandIds.length > 0 && {
      type: "function",
      function: {
        name: "start_background_process",
        description: "Start an enabled saved long-running action that is approved for background run. Use only a command_template_id from context.",
        parameters: objectSchema({
          command_template_id: {
            type: "string",
            enum: backgroundCommandIds,
            description: "ID of the approved long-running saved action."
          }
        }, ["command_template_id"])
      }
    }
  ].filter(Boolean);
}

function objectSchema(properties: Record<string, unknown>, required: string[]) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false
  };
}
