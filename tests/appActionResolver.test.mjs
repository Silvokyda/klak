import test from "node:test";
import assert from "node:assert/strict";
import { resolveAppActionFromSources } from "../tests-dist/appActionResolver.mjs";

const registeredApps = [
  {
    id: "app-1",
    name: "Google Chrome",
    executable_path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    app_type: "browser",
    allowed: true
  }
];

const discoveredApps = [
  {
    id: "disc-1",
    name: "AnyDesk",
    normalized_name: "anydesk",
    executable_path: "C:\\Program Files\\AnyDesk\\AnyDesk.exe",
    source: "Start Menu",
    publisher: "AnyDesk Software GmbH",
    confidence: "high",
    category: "recommended",
    is_registered: false,
    is_blocked: false
  },
  {
    id: "disc-2",
    name: "AnyDesk Support",
    normalized_name: "anydesk support",
    executable_path: "C:\\Program Files\\AnyDesk\\Support.exe",
    source: "Start Menu",
    publisher: "AnyDesk Software GmbH",
    confidence: "medium",
    category: "advanced",
    is_registered: false,
    is_blocked: false
  }
];

test("registered app open resolves to launch_app", () => {
  const result = resolveAppActionFromSources({
    appName: "Chrome",
    action: "open",
    registeredApps,
    discoveredApps: []
  });

  assert.equal(result.status, "resolved");
  assert.equal(result.selected?.kind, "registered");
  assert.equal(result.suggestedAction?.toolName, "launch_app");
});

test("unregistered installed app open resolves to register_and_launch_app", () => {
  const result = resolveAppActionFromSources({
    appName: "AnyDesk",
    action: "open",
    registeredApps: [],
    discoveredApps: [discoveredApps[0]]
  });

  assert.equal(result.status, "resolved");
  assert.equal(result.selected?.kind, "discovered");
  assert.equal(result.suggestedAction?.toolName, "register_and_launch_app");
  assert.match(result.message, /Say yes to approve/);
});

test("check_installed returns candidate matches", () => {
  const result = resolveAppActionFromSources({
    appName: "AnyDes",
    action: "check_installed",
    registeredApps: [],
    discoveredApps
  });

  assert.equal(result.status, "check_installed");
  assert.equal(result.matches.length, 2);
  assert.deepEqual(
    result.matches.map((match) => match.name),
    ["AnyDesk", "AnyDesk Support"]
  );
});

test("ambiguous app names stay ambiguous instead of falling back to folders", () => {
  const result = resolveAppActionFromSources({
    appName: "AnyDes",
    action: "open",
    registeredApps: [],
    discoveredApps
  });

  assert.equal(result.status, "ambiguous");
  assert.match(result.message, /Several apps|several apps/i);
});

test("missing app names stay not_found", () => {
  const result = resolveAppActionFromSources({
    appName: "NotARealApp",
    action: "open",
    registeredApps: [],
    discoveredApps: []
  });

  assert.equal(result.status, "not_found");
  assert.match(result.message, /could not find/i);
});
