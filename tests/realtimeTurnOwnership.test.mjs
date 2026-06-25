import test from "node:test";
import assert from "node:assert/strict";
import { RealtimeTurnOwnership } from "../tests-dist/realtimeTurnOwnership.mjs";

test("late cancelled response events do not update the next turn", () => {
  const ownership = new RealtimeTurnOwnership();

  assert.equal(ownership.beginUserTurn("user-a"), true);
  ownership.appendUserTranscript("user-a", "Really ");
  ownership.finalizeUserTranscript("user-a", "Really cool");

  assert.equal(ownership.beginResponse("response-a"), true);
  assert.equal(ownership.registerResponseOutput("response-a", "assistant-a"), true);
  ownership.appendAssistantTranscript("response-a", "assistant-a", "I can ");
  ownership.cancelResponse("response-a");

  assert.equal(ownership.beginUserTurn("user-b"), true);
  ownership.appendUserTranscript("user-b", "Open ");
  ownership.finalizeUserTranscript("user-b", "Open Chrome");

  assert.equal(ownership.beginResponse("response-b"), true);
  assert.equal(ownership.registerResponseOutput("response-b", "assistant-b"), true);

  assert.equal(ownership.appendAssistantTranscript("response-a", "assistant-a", "place phone calls"), null);
  assert.equal(ownership.finalizeAssistantTranscript("response-a", "assistant-a", "place phone calls"), null);
  assert.equal(ownership.completeResponse("response-a"), null);
  assert.equal(ownership.getCurrentAssistantFinalTranscript(), "");

  ownership.appendAssistantTranscript("response-b", "assistant-b", "Please approve the launch in Klak.");
  ownership.finalizeAssistantTranscript("response-b", "assistant-b", "Please approve the launch in Klak.");

  assert.deepEqual(ownership.completeResponse("response-b"), {
    userTranscript: "Open Chrome",
    assistantTranscript: "Please approve the launch in Klak."
  });
  assert.equal(ownership.completeResponse("response-b"), null);
});
