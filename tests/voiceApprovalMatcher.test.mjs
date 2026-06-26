import test from "node:test";
import assert from "node:assert/strict";
import { isDeterministicSleepCommand, matchVoiceApprovalTranscript } from "../tests-dist/voiceApprovalMatcher.mjs";

test("voice approval matcher accepts conservative approvals and denials", () => {
  assert.equal(matchVoiceApprovalTranscript("yes, go ahead"), "approve");
  assert.equal(matchVoiceApprovalTranscript("no, cancel"), "deny");
});

test("voice approval matcher rejects ambiguous replies", () => {
  assert.equal(matchVoiceApprovalTranscript("maybe"), "ambiguous");
  assert.equal(matchVoiceApprovalTranscript("I think so"), "ambiguous");
});

test("voice sleep matcher only accepts deterministic conversation endings", () => {
  assert.equal(isDeterministicSleepCommand("bye for now"), true);
  assert.equal(isDeterministicSleepCommand("goodbye and thanks"), false);
});
