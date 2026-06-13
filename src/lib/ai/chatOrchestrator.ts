import type { AIResponse, AppSettings } from "../../types";
import { listActionLogs } from "../logs/actionLogRepository";
import { searchMemories } from "../memory/memoryRepository";
import { listTools } from "../tools/toolRegistry";
import { OpenAICompatibleProvider } from "./openAiCompatibleProvider";
import { localContextCollector } from "../context/localContext";

export async function sendChatMessage(userMessage: string, settings: AppSettings): Promise<AIResponse> {
  const [relevantMemories, availableTools, recentActionLogs, localContext] = await Promise.all([
    searchMemories(userMessage),
    listTools(settings.allToolsDisabled),
    listActionLogs(),
    settings.localContextEnabled ? localContextCollector.collect() : Promise.resolve({})
  ]);

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
