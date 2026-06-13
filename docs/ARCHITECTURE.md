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

## Tool System

Tools are declared in `src/lib/tools/toolRegistry.ts`. Safe MVP tools are enabled where appropriate. Dangerous or future tools are present as disabled extension points:

- browser automation
- app launcher
- file reader
- terminal runner
- desktop clicker
- cloud task runner

Tool execution must pass through the permission policy, action preview, user approval or denial, and audit log update path.

Implemented safe tools:

- `open_url`: validates and opens only `http` and `https` URLs.
- `open_folder`: opens only folders in `allowed_folders`.
- `create_note`: writes Markdown notes only inside allowed folders and refuses overwrites.
- `copy_to_clipboard`: writes clipboard text only after approval and never reads clipboard automatically.
- `search_memory`: searches local memory and logs the query summary.
- `create_memory`: creates memory only through explicit request or approved preview.

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
