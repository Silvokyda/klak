# Klak Architecture

Klak is a local-first Windows AI operator built as a Tauri v2 desktop app with a React, TypeScript, and Vite frontend. The app is designed to stay visible to the user through its main window and tray icon.

## Frontend and Backend Split

- `src/` contains the React application, screens, local domain logic, AI provider interface, tool registry, permission policy, and local repositories.
- `src-tauri/` contains the Tauri shell, visible window configuration, tray menu, and native plugins.
- `docs/` contains the product, security, memory, and roadmap notes that future contributors should preserve.

The current MVP keeps most application behavior in TypeScript while the Tauri shell provides native desktop capabilities. Repositories use a shared database adapter so the UI talks to one interface in both Tauri and browser development.

## Local-First Design

Klak has no hosted backend, account system, telemetry, analytics, or cloud sync. Settings, memories, tool state, action logs, allowed folders, voice settings, and secrets stay on the local machine.

SQLite is the durable local database in the Tauri runtime. `initDatabase()` in `src/lib/db/database.ts` opens `sqlite:klak.db`, creates `schema_migrations`, and applies the idempotent schema in `src/lib/db/schema.ts`.

Browser-only Vite development uses `klak.insecure_dev_database.v1` in localStorage as an isolated fallback. This fallback exists only so UI flows can be tested without the Tauri runtime.

SQLite stores:

- `memories`
- `projects`
- `workflows`
- `registered_apps`
- `command_templates`
- `background_processes`
- `action_logs`
- `app_settings`
- `tool_settings`
- `allowed_folders`
- `schema_migrations`

## AI Provider Abstraction

The AI layer exposes:

```ts
interface AIProvider {
  generateResponse(input: AIRequest): Promise<AIResponse>;
}
```

The first provider is an OpenAI-compatible HTTP client. It accepts a configurable base URL and model name so Claude-compatible bridges or local model gateways can be added later.

AI requests include the user message, relevant memories, permission mode, enabled tools, recent action logs, and opted-in local context placeholders. Klak must not send files, screenshots, clipboard data, or sensitive local data unless the user explicitly permits it.

## Memory System

Memory is managed through `src/lib/memory/memoryRepository.ts`. The MVP supports profile, preference, project, workflow, task, document, and command history records.

Search starts as simple local text matching. The repository boundary is intentionally narrow so vector search can be added later without changing feature screens.

Structured project and workflow memory lives beside the general memory table. `src/lib/projects/projectRepository.ts` stores project facts, status, and optional startup workflow links. `src/lib/workflows/workflowRepository.ts` stores workflow definitions, builds safe previews, and runs only approved existing tools. The assistant orchestrator searches these repositories with the user message and passes concise context to the AI provider.

Registered apps live in `registered_apps` through `src/lib/apps/registeredAppsRepository.ts`. Records store a user-approved executable path, app type, allowed state, and launch timestamp.

App discovery is transient. The native `scan_installed_apps` command reads bounded Windows registry sources, returns current suggestions, and does not persist candidates. The frontend shows suggestions for user selection. Before saving, `register_discovered_apps` rechecks selected suggestions against a fresh bounded scan and native launch validation, then the existing registered app repository persists only accepted apps.

Command templates live in `command_templates` through `src/lib/commands/commandTemplateRepository.ts`. They store saved finite commands, project links, allowed working directories, risk, timeout, run count, and a short last-result summary.

Background process records live in `background_processes` through `src/lib/processes/backgroundProcessRepository.ts`. They store the command template, project link, PID, status, output preview, and bounded output log path for Klak-managed long-running commands.

## Tool System

Tools are declared in `src/lib/tools/toolRegistry.ts`. Safe MVP tools are enabled where appropriate. Dangerous or future tools are present as disabled extension points:

- browser automation
- file reader
- terminal runner
- desktop clicker
- cloud task runner

Tool execution must pass through the permission policy, action preview, user approval or denial, and audit log update path.

Implemented safe tools:

- `open_url`: validates and opens only `http` and `https` URLs.
- `open_folder`: opens only folders in `allowed_folders`.
- `launch_app`: launches only a locally registered and allowed `.exe`, with no shell and no arbitrary arguments.
- `run_command_template`: runs only a saved, enabled command template from an allowed working directory, after safety validation and approval.
- `start_background_process`: starts only an approved long-running command template as a Klak-managed child process.
- `create_note`: writes Markdown notes only inside allowed folders and refuses overwrites.
- `copy_to_clipboard`: writes clipboard text only after approval and never reads clipboard automatically.
- `search_memory`: searches local memory and logs the query summary.
- `create_memory`: creates memory only through explicit request or approved preview.

Workflows do not add new execution powers. They are ordered collections of the implemented safe tools plus manual instructions. The workflow builder supports add, remove, reorder, type selection, risk display, command-template selection, and an advanced JSON editor. Workflow preview uses the same normalization and permission checks as individual suggested actions, and blocked steps prevent the workflow from running.

The native `launch_registered_app` command validates that the executable exists, is a `.exe`, is not a blocked shell or terminal executable, and starts it with `std::process::Command` without shell interpolation or custom arguments.

The native app discovery commands read Windows App Paths and installed-app uninstall metadata from HKCU/HKLM registry locations. They do not scan the whole disk, Downloads, temp folders, arbitrary folders, or random `.exe` files. Start Menu `.lnk` parsing is not implemented in v1, so shortcut-only apps may require manual registration until a safe shortcut parser is added.

The native `run_command_template` command validates the working directory, splits the saved command into executable and arguments, maps Windows shims such as `npm` to `npm.cmd`, runs without shell interpolation, captures stdout/stderr, truncates output, and enforces a timeout.

The native background process manager keeps an in-memory registry of children started in the current app session. `start_background_process` spawns the saved command, streams stdout/stderr to a bounded local log file, and returns PID/status. `stop_background_process` and status reads only operate on children in that registry, so Klak does not kill arbitrary system processes.

## Secrets

Secrets are not stored in `app_settings`, memories, or logs. The API key path goes through `src/lib/security/secretStore.ts`.

In Tauri, secret operations call native commands backed by the Rust `keyring` crate, which uses Windows credential storage. Browser-only development delegates to `insecureDevSecretStore.ts`, which is clearly named and warned about in setup/settings.

## Voice Foundation

Voice settings live in `app_settings`. The Assistant screen exposes push-to-talk recording only when voice is enabled. Audio recording is visible, starts only after the user presses the voice button, stays local, and is discarded after transcription attempt.

The transcription abstraction is:

```ts
interface VoiceTranscriptionProvider {
  transcribe(input: VoiceTranscriptionInput): Promise<VoiceTranscriptionResult>;
}
```

Initial providers are `disabled` and `local_whisper_cli`. Local Whisper requires user-provided executable and model paths.

For native transcription, the frontend records audio with `MediaRecorder`, writes the blob to a temp file through `save_temp_voice_audio`, then calls `transcribe_audio_with_whisper`. The Rust command validates the executable and model paths, avoids shell interpolation, uses a fixed argument list, enforces a timeout, reads stdout or a `.txt` transcript file, and deletes temp files unless debug retention is enabled.

Voice action logs record events such as recording started, cancelled, transcription requested, completed, and failed. Logs store metadata only, not raw audio and not transcript text.

## Future Cloud Agent

Cloud operations are not implemented. Future cloud support should be optional, user-approved, and separated behind a cloud task interface. Cloud memory sync, cloud task queues, and cloud research should never become implicit defaults.
