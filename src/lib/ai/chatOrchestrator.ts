import type { AIResponse, AppSettings } from "../../types";
import { listActionLogs } from "../logs/actionLogRepository";
import { searchMemories } from "../memory/memoryRepository";
import { listTools } from "../tools/toolRegistry";
import { OpenAICompatibleProvider } from "./openAiCompatibleProvider";
import { localContextCollector } from "../context/localContext";
import { searchRegisteredApps } from "../apps/registeredAppsRepository";
import { searchProjects } from "../projects/projectRepository";
import { searchWorkflows } from "../workflows/workflowRepository";

export async function sendChatMessage(userMessage: string, settings: AppSettings): Promise<AIResponse> {
  const [relevantMemories, relevantProjects, relevantWorkflows, relevantRegisteredApps, availableTools, recentActionLogs, localContext] = await Promise.all([
    searchMemories(userMessage),
    searchProjects(userMessage),
    searchWorkflows(userMessage),
    searchRegisteredApps(userMessage),
    listTools(settings.allToolsDisabled),
    listActionLogs(),
    settings.localContextEnabled ? localContextCollector.collect() : Promise.resolve({})
  ]);

  if (/\bremember\b.+\bas an app\b/i.test(userMessage) || /\bregister\b.+\bapp\b/i.test(userMessage)) {
    return {
      message: "I can remember that as a registered app, but I need the exact .exe path first. Add it in Apps so Klak can validate it and require approval before launch."
    };
  }

  const launchRequest = userMessage.match(/\b(?:open|launch|start)\s+(.+?)\.?$/i);
  if (launchRequest) {
    const requested = launchRequest[1].trim().toLowerCase();
    const app = relevantRegisteredApps.find((item) => item.allowed && item.name.toLowerCase().includes(requested));
    if (app) {
      return {
        message: `I found the registered app "${app.name}". Review the action preview before it launches.`,
        suggestedAction: { toolName: "launch_app", input: { registered_app_id: app.id } }
      };
    }

    const project = relevantProjects.find((item) => item.name.toLowerCase().includes(requested));
    if (project?.startup_workflow_id && /\bstart\b/i.test(userMessage)) {
      return {
        message: `I found "${project.name}" and its linked startup workflow. Open Projects to preview and run it with confirmation.`
      };
    }
    if (project?.repo_path) {
      return {
        message: `I found "${project.name}". I can open its project folder after approval.`,
        suggestedAction: { toolName: "open_folder", input: { path: project.repo_path } }
      };
    }
  }

  const triggeredWorkflow = relevantWorkflows.find((workflow) => {
    const phrase = workflow.trigger_phrase?.trim();
    return phrase ? userMessage.toLowerCase().includes(phrase.toLowerCase()) : false;
  });

  if (triggeredWorkflow) {
    return {
      message: `I found the saved workflow "${triggeredWorkflow.name}". Open Workflows to preview and run it with confirmation.`
    };
  }

  if (looksLikeRememberRequest(userMessage)) {
    return {
      message: "I can save that as a memory. Review the action preview before it is written locally.",
      suggestedAction: {
        toolName: "create_memory",
        input: {
          type: "preference",
          title: "User requested memory",
          content: userMessage.replace(/remember this:?/i, "").trim() || userMessage,
          source: "explicit_user_request"
        }
      }
    };
  }

  if (looksLikeOpenUrlRequest(userMessage)) {
    const url = userMessage.match(/https?:\/\/\S+/)?.[0];
    if (url) {
      return {
        message: "I can open that URL after you approve the preview.",
        suggestedAction: { toolName: "open_url", input: { url } }
      };
    }
  }

  const folderPath = userMessage.match(/\bopen folder\s+(.+)$/i)?.[1]?.trim();
  if (folderPath) {
    return {
      message: "I can open that folder if it is already in your allowed folders list.",
      suggestedAction: { toolName: "open_folder", input: { path: folderPath } }
    };
  }

  const noteMatch = userMessage.match(/\bcreate note\s+(.+?)\s+in\s+(.+)$/i);
  if (noteMatch) {
    return {
      message: "I can create that Markdown note after you approve the destination.",
      suggestedAction: {
        toolName: "create_note",
        input: { title: noteMatch[1], content: noteMatch[1], destinationFolder: noteMatch[2] }
      }
    };
  }

  const copyMatch = userMessage.match(/\bcopy(?: this)?:?\s+([\s\S]+)$/i);
  if (copyMatch) {
    return {
      message: "I can copy that text after you approve the preview.",
      suggestedAction: { toolName: "copy_to_clipboard", input: { text: copyMatch[1].trim() } }
    };
  }

  const memorySearch = userMessage.match(/\bsearch memory(?: for)?:?\s+(.+)$/i);
  if (memorySearch) {
    return {
      message: "I can search local memory and log the query summary.",
      suggestedAction: { toolName: "search_memory", input: { query: memorySearch[1].trim() } }
    };
  }

  const provider = new OpenAICompatibleProvider(settings.apiBaseUrl, settings.modelName);
  return provider.generateResponse({
    userMessage,
    relevantMemories: relevantMemories.slice(0, 8),
    relevantProjects: relevantProjects.slice(0, 5),
    relevantWorkflows: relevantWorkflows.slice(0, 5),
    relevantRegisteredApps: relevantRegisteredApps.slice(0, 5),
    currentPermissionMode: settings.permissionMode,
    availableTools,
    recentActionLogs: recentActionLogs.slice(0, 10),
    localContext
  });
}

function looksLikeRememberRequest(text: string): boolean {
  return /\bremember this\b|\bremember that\b|\bplease remember\b/i.test(text);
}

function looksLikeOpenUrlRequest(text: string): boolean {
  return /\bopen\b/i.test(text) && /https?:\/\/\S+/i.test(text);
}
