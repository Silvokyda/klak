import { invoke } from "@tauri-apps/api/core";
import type { ObservationSnapshot, VerificationRule, VerificationStatus } from "../../types";

export interface VerificationResult {
  status: VerificationStatus;
  summary: string;
}

export async function verifyStep(rule: VerificationRule, observation: ObservationSnapshot): Promise<VerificationResult> {
  if (rule.type === "none") {
    return { status: "skipped", summary: "No explicit verification rule was defined." };
  }

  if (rule.type === "command_result") {
    const result = observation.command_result;
    if (!result) return { status: "failed", summary: "No command result was captured for verification." };
    if (rule.expect_exit_code !== undefined && result.exit_code !== rule.expect_exit_code) {
      return { status: "failed", summary: `Expected exit ${rule.expect_exit_code}, got ${result.exit_code ?? "unknown"}.` };
    }
    if (rule.stdout_includes && !(result.stdout_excerpt ?? "").includes(rule.stdout_includes)) {
      return { status: "failed", summary: `Expected stdout to include "${rule.stdout_includes}".` };
    }
    if (rule.stderr_excludes && (result.stderr_excerpt ?? "").includes(rule.stderr_excludes)) {
      return { status: "failed", summary: `stderr included blocked text "${rule.stderr_excludes}".` };
    }
    return { status: "verified", summary: "Command verification passed." };
  }

  if (rule.type === "browser_text") {
    const browser = observation.browser_state;
    if (!browser) return { status: "failed", summary: "No browser state was available." };
    const textHaystack = `${browser.title ?? ""} ${browser.visible_text ?? ""} ${browser.content_excerpt ?? ""}`;
    if (!textHaystack.includes(rule.text)) {
      return { status: "failed", summary: `Expected browser text "${rule.text}" was not found.` };
    }
    if (rule.url_includes && !(browser.url ?? "").includes(rule.url_includes)) {
      return { status: "failed", summary: `Expected browser URL to include "${rule.url_includes}".` };
    }
    return { status: "verified", summary: "Browser verification passed." };
  }

  if (rule.type === "window_title") {
    const matched = observation.windows.some((windowItem) => windowItem.title.toLowerCase().includes(rule.title_includes.toLowerCase()));
    return matched
      ? { status: "verified", summary: "Window verification passed." }
      : { status: "failed", summary: `No open window title included "${rule.title_includes}".` };
  }

  if (rule.type === "process_running") {
    if (rule.port) {
      const listening = await invoke<boolean>("is_tcp_port_listening", { input: { port: rule.port } }).catch(() => false);
      if (listening) return { status: "verified", summary: `Port ${rule.port} is listening.` };
    }
    const matched = observation.processes.some((process) => {
      if (rule.pid && process.pid === rule.pid) return true;
      if (rule.process_name) return process.process_name.toLowerCase().includes(rule.process_name.toLowerCase());
      return false;
    });
    return matched
      ? { status: "verified", summary: "Process verification passed." }
      : { status: "failed", summary: "Expected process was not running." };
  }

  if (rule.type === "file_exists") {
    const fileState = await invoke<{ exists: boolean; content_excerpt?: string | null }>("read_file_probe", {
      input: { path: rule.path, maxBytes: 1000 }
    }).catch(() => ({ exists: false, content_excerpt: null }));
    if (!fileState.exists) return { status: "failed", summary: `${rule.path} was not found.` };
    if (rule.content_includes && !(fileState.content_excerpt ?? "").includes(rule.content_includes)) {
      return { status: "failed", summary: `Expected file content to include "${rule.content_includes}".` };
    }
    return { status: "verified", summary: "File verification passed." };
  }

  return { status: "failed", summary: "Unsupported verification rule." };
}
