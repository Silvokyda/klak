import type { AIProvider, AIRequest, AIResponse } from "../../types";
import { apiKeyVault } from "../security/apiKeyVault";

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
        messages: [
          {
            role: "system",
            content:
              "You are Klak, a local-first Windows AI operator. Do not request or expose secrets. If an action is useful, describe it as a suggestion; the app will create a preview before execution."
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
    return {
      message: data.choices?.[0]?.message?.content ?? "I did not receive a usable response."
    };
  }
}
