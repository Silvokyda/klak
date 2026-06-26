const approvalPhrases = new Set([
  "yes",
  "yes go ahead",
  "yes please",
  "yeah",
  "yep",
  "sure",
  "okay",
  "ok",
  "okay do it",
  "go ahead",
  "proceed",
  "approve",
  "approved",
  "do it",
  "continue",
  "that is fine",
  "sounds good"
]);

const denialPhrases = new Set([
  "no",
  "no cancel",
  "no thanks",
  "cancel",
  "deny",
  "stop",
  "do not do it",
  "dont do it",
  "don't do it",
  "never mind",
  "nevermind",
  "forget it",
  "leave it"
]);

const sleepPhrases = new Set([
  "go to sleep",
  "stop listening",
  "go away",
  "bye",
  "goodbye",
  "okay bye",
  "ok bye",
  "all right bye",
  "bye for now",
  "that is all",
  "that's all",
  "thats all",
  "end conversation",
  "you can go now"
]);

export function normalizeTranscript(transcript) {
  return transcript
    .trim()
    .toLowerCase()
    .replace(/[.!?,]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[’]/g, "'")
    .replace(/\bdo not\b/g, "do not")
    .replace(/\bdon't\b/g, "don't")
    .replace(/\bnevermind\b/g, "nevermind");
}

export function matchVoiceApprovalTranscript(transcript) {
  const normalized = normalizeTranscript(transcript);
  if (!normalized) return "none";
  if (sleepPhrases.has(normalized)) return "sleep";
  if (approvalPhrases.has(normalized)) return "approve";
  if (denialPhrases.has(normalized)) return "deny";
  const tokens = normalized.split(" ");
  if (tokens.length <= 3) {
    if (approvalPhrases.has(tokens.join(" "))) return "approve";
    if (denialPhrases.has(tokens.join(" "))) return "deny";
  }
  if (tokens.length === 1 && (tokens[0] === "yes" || tokens[0] === "no")) {
    return tokens[0] === "yes" ? "approve" : "deny";
  }
  return "ambiguous";
}

export function isDeterministicSleepCommand(transcript) {
  return matchVoiceApprovalTranscript(transcript) === "sleep";
}
