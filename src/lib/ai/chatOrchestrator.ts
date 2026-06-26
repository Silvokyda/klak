import type { AIResponse, AppSettings } from "../../types";
import { listActionLogs } from "../logs/actionLogRepository";
import { searchMemories } from "../memory/memoryRepository";
import { listTools } from "../tools/toolRegistry";
import { OpenAICompatibleProvider } from "./openAiCompatibleProvider";
import { localContextCollector } from "../context/localContext";
import { searchRegisteredApps } from "../apps/registeredAppsRepository";
import { resolveAppAction } from "../apps/appActionResolver";
import { isLongRunningCommand, searchCommandTemplates } from "../commands/commandTemplateRepository";
import { listRunningBackgroundProcesses } from "../processes/backgroundProcessRepository";
import { searchProjects } from "../projects/projectRepository";
import { searchWorkflows } from "../workflows/workflowRepository";

export async function sendChatMessage(userMessage: string, settings: AppSettings): Promise<AIResponse> {
  const [relevantMemories, relevantProjects, relevantWorkflows, relevantRegisteredApps, relevantCommandTemplates, runningProcesses, availableTools, recentActionLogs, localContext] = await Promise.all([
    searchMemories(userMessage),
    searchProjects(userMessage),
    searchWorkflows(userMessage),
    searchRegisteredApps(userMessage),
    searchCommandTemplates(userMessage),
    listRunningBackgroundProcesses(),
    listTools(settings.allToolsDisabled),
    listActionLogs(),
    settings.localContextEnabled ? localContextCollector.collect() : Promise.resolve({})
  ]);

  if (/\b(register|add|open|launch|start)\b.+\b(powershell|cmd|command prompt|pwsh|wscript|cscript|mshta|rundll32|regedit|diskpart)\b/i.test(userMessage)) {
    return {
      message: "I cannot register that as a normal app because it can run system commands. Klak blocks system command and scripting tools from app registration."
    };
  }

  if (/\bremember\b.+\bas an app\b/i.test(userMessage) || /\bregister\b.+\bapp\b/i.test(userMessage)) {
    return {
      message: "I can help with that app request. Ask me to open the app name, and I will resolve the registered or safe installed match before asking for approval."
    };
  }

  if (/\b(save|remember)\b.+\bas (?:a )?command\b/i.test(userMessage)) {
    return {
      message: "I can save that as an approved saved action, but I need the project and an allowed working directory first. Add it in Saved Actions so Klak can validate it before any run."
    };
  }

  if (/\bwhat(?:'s| is)? running\b/i.test(userMessage)) {
    return {
      message: runningProcesses.length
        ? `Klak is managing these running activities: ${runningProcesses.map((process) => `${process.name} (${process.status})`).join(", ")}.`
        : "Klak is not managing any running activities right now."
    };
  }

  if (/^\s*(kill|stop)\s+/i.test(userMessage) && /\b(node|cargo|npm|php|flutter|process)\b/i.test(userMessage)) {
    return {
      message: "I can only stop activities that Klak started from approved saved actions. Open Running Activities to stop a Klak-managed activity."
    };
  }

  const commandListProject = userMessage.match(/\bwhat commands do you know for\s+(.+?)\??$/i)?.[1]?.trim().toLowerCase();
  if (commandListProject) {
    const project = relevantProjects.find((item) => item.name.toLowerCase().includes(commandListProject));
    const commands = project ? relevantCommandTemplates.filter((item) => item.project_id === project.id) : relevantCommandTemplates;
    return {
      message: commands.length
        ? `I know these saved actions: ${commands.map((item) => item.name).join(", ")}.`
        : "I did not find saved actions for that project."
    };
  }

  const runCommandRequest = userMessage.match(/\b(?:run|start)\s+(.+?)\.?$/i)?.[1]?.trim().toLowerCase();
  if (runCommandRequest) {
    const command = relevantCommandTemplates.find((item) => item.enabled && item.name.toLowerCase().includes(runCommandRequest));
    if (command) {
      if (isLongRunningCommand(command.command)) {
        if (command.is_long_running && command.allow_background_run) {
          return {
            message: `I found the long-running saved action "${command.name}". Review the action preview before it starts as a running activity.`,
            suggestedAction: { toolName: "start_background_process", input: { command_template_id: command.id } }
          };
        }
        return {
          message: "That saved action looks long-running, but it is not approved for Running Activities yet. Mark it as long-running and allow background run before starting it."
        };
      }
      return {
        message: `I found the saved action "${command.name}". Review the action preview before it runs.`,
        suggestedAction: { toolName: "run_command_template", input: { command_template_id: command.id } }
      };
    }
  }

  const launchRequest = userMessage.match(/\b(?:open|launch|start)\s+(.+?)\.?$/i);
  if (launchRequest) {
    const requested = launchRequest[1].trim();
    const resolution = await resolveAppAction(requested, "open", settings);
    return {
      message: resolution.message,
      suggestedAction: { toolName: "resolve_app_action", input: { app_name: requested, action: "open" } }
    };
  }

  const triggeredWorkflow = relevantWorkflows.find((workflow) => {
    const phrase = workflow.trigger_phrase?.trim();
    return phrase ? userMessage.toLowerCase().includes(phrase.toLowerCase()) : false;
  });

  if (triggeredWorkflow) {
    return {
      message: `I found the saved routine "${triggeredWorkflow.name}". Open Routines to preview and run it with confirmation.`
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
    relevantCommandTemplates: relevantCommandTemplates.slice(0, 5),
    relevantBackgroundProcesses: runningProcesses.slice(0, 5),
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
