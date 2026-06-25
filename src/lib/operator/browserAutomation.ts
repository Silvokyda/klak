import { invoke } from "@tauri-apps/api/core";
import type { BrowserObservation } from "../../types";

export interface BrowserWaitInput {
  sessionId: string;
  selector?: string;
  text?: string;
  timeoutMs?: number;
}

export async function openBrowserSession(sessionId: string, url: string, visible = true): Promise<void> {
  await invoke("browser_open_session", { input: { sessionId, url, visible } });
}

export async function browserNavigate(sessionId: string, url: string): Promise<void> {
  await invoke("browser_navigate_session", { input: { sessionId, url } });
}

export async function browserClick(sessionId: string, selector: string): Promise<void> {
  await invoke("browser_click_selector", { input: { sessionId, selector } });
}

export async function browserType(sessionId: string, selector: string, text: string): Promise<void> {
  await invoke("browser_type_selector", { input: { sessionId, selector, text } });
}

export async function browserSelect(sessionId: string, selector: string, value: string): Promise<void> {
  await invoke("browser_select_option", { input: { sessionId, selector, value } });
}

export async function browserWaitFor(input: BrowserWaitInput): Promise<boolean> {
  return invoke<boolean>("browser_wait_for", { input });
}

export async function browserReadState(sessionId: string, selector?: string): Promise<BrowserObservation> {
  return invoke<BrowserObservation>("browser_read_state", { input: { sessionId, selector } });
}

export async function closeBrowserSession(sessionId: string): Promise<void> {
  await invoke("browser_close_session", { input: { sessionId } });
}
