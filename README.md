# Klak

Klak - your local AI operator.

Klak is a local-first Windows desktop assistant built with Tauri v2, React, TypeScript, Vite, and SQLite-backed local persistence. It starts as a visible desktop app with first-time setup, local memory, permissions, tool previews, audit logs, and a configurable OpenAI-compatible provider.

## Requirements

- Node.js 20+
- npm
- Rust toolchain for Tauri desktop commands
- Visual Studio 2022 Build Tools with Desktop development with C++, MSVC, and Windows SDK
- Windows WebView2 runtime

## Setup

```powershell
npm install
npm run dev
```

For the native desktop shell, run from a Visual Studio Developer PowerShell or initialize the Build Tools environment first:

```powershell
npm run tauri dev
```

## Build

```powershell
npm run build
npm run tauri build
```

## Notes

- Local data is stored in `sqlite:klak.db` through the Tauri SQL plugin when Klak runs as a desktop app.
- During browser-only Vite development, repositories use `klak.insecure_dev_database.v1` in localStorage so UI work can continue without the Tauri runtime.
- Database initialization is idempotent. `initDatabase()` creates tables and records migration version `1` in `schema_migrations`.
- SQLite tables store memories, projects, workflows, registered apps, command templates, background processes, action logs, non-secret app settings, tool settings, and allowed folders.
- API keys are stored through `secretStore`. In native Tauri, Klak uses Windows-backed storage through the Rust `keyring` crate. In browser-only development, Klak falls back to `insecureDevSecretStore.ts` and warns: "Development storage is active. Do not use production keys."
- Implemented safe tools: `open_url`, `open_folder`, `launch_app`, `run_command_template`, `start_background_process`, `create_note`, `copy_to_clipboard`, `search_memory`, and `create_memory`. They all go through permission checks, action previews, approval/denial, and audit logging.
- The Apps screen can scan bounded Windows app metadata for safe suggestions, and users explicitly choose which `.exe` applications to register. Klak can launch only registered apps, never arbitrary shell commands or arguments.
- Dangerous tools are registered as disabled future extension points and blocked by the permission system.
- Voice input is opt-in and push-to-talk only. Klak does not listen in the background and does not upload audio.
- No telemetry, analytics, accounts, hosted backend, cloud sync, screenshot capture, browser automation, terminal execution, or unrestricted clipboard/file reading is implemented.

## Registered Apps And Startup Workflows

Click Scan for apps in Apps to find safe suggestions from Windows App Paths and installed-app registry metadata. Klak prioritizes recognizable user-facing apps, shows icons when Windows exposes them, and separates technical helpers, installers, update tools, and unsupported system items behind a toggle. Select only the apps you want Klak to remember, then click Add selected apps. You can still register manually with an exact executable path when needed.

Klak blocks system command, scripting, and CLI tools such as `powershell.exe`, `cmd.exe`, `pwsh.exe`, `winget.exe`, `python.exe`, `py.exe`, `ngrok.exe`, `wscript.exe`, `cscript.exe`, `mshta.exe`, `rundll32.exe`, `regedit.exe`, `diskpart.exe`, `wt.exe`, `WindowsTerminal.exe`, `bash.exe`, and `wsl.exe`. App discovery v1 does not parse Start Menu `.lnk` shortcuts, so shortcut-only apps may need manual registration.

Workflows can be built with the step builder or the advanced JSON editor. Supported steps are `open_url`, `open_folder`, `launch_app`, `create_note`, `copy_to_clipboard`, `search_memory`, `create_memory`, and `manual_instruction`.

To create a project startup workflow, register any apps first, create a workflow with safe steps, then link it from the Projects screen. Running a startup workflow still requires an explicit preview and user action; terminal commands remain manual instructions.

## Command Templates

Commands are saved templates, not arbitrary terminal access. The Commands screen lets users create finite templates such as `npm run build`, `cargo check`, `cargo fmt --check`, `git status --short`, `php artisan test`, `flutter analyze`, and `flutter test`.

Rules:

- commands must be saved before they can run,
- working directories must be inside allowed folders,
- shell chaining, pipes, redirection, background execution, destructive commands, credential-looking commands, and environment dumping are blocked,
- command output is captured and truncated,
- timeouts are enforced,
- long-running commands such as `npm run tauri dev` must be explicitly marked for background runs.

Workflow command steps select saved command templates only. Project command buttons also run through the same preview and approval path.

## Background Processes

Long-running command templates can be marked as `Long-running` and `Background run`. Starting one creates a Klak-managed process record, writes bounded output to the system temp directory under `klak/process-logs`, and shows status in Running Activities.

Klak only stops processes it started and recorded. Duplicate starts for the same template are blocked. On app start, stale process records are reconciled; if the native child is no longer known, the record is marked stopped or exited rather than killing arbitrary system processes.

Example Klak startup workflow:

1. `launch_app`: VS Code
2. `open_folder`: the Klak repository
3. `start_background_process`: `npm run tauri dev`
4. `open_url`: `http://localhost:1420`

## Local Whisper CLI

Local Whisper transcription is supported in the native Tauri app. Configure these in Settings when you have your own local Whisper executable and model:

- Local Whisper executable path
- Local Whisper model path
- Local Whisper language, default `auto`
- Local Whisper threads, default `4`

Accepted executable names include `whisper-cli.exe`, `main.exe`, `whisper.cpp.exe`, and `faster-whisper.exe`. Unusual executable names are allowed only when explicitly configured, and Klak shows a warning. Klak does not download models automatically and does not accept custom shell arguments.

Audio flow:

- recording starts only when you press the voice button,
- temporary audio is written under the system temp directory,
- the configured Whisper executable is called with controlled arguments,
- transcript text is inserted into the chat input for review,
- the message is not sent automatically,
- temporary audio and transcript files are deleted unless `Keep temporary audio for debugging` is enabled.

## Native Verification Notes

- `npm run build` verifies TypeScript and the production web bundle.
- `cargo check` passes when run through the Visual Studio Build Tools environment.
- `npm run tauri dev` launches the native app when port `1420` is free.
- Native SQLite was verified at `C:\Users\silvance\AppData\Roaming\local.klak.operator\klak.db`.
- If Windows Smart App Control blocks generated binaries, allow or rebuild according to your local Windows policy.
- `src-tauri/icons/icon.ico` is required for Windows packaging.
- Repeatable manual QA lives in `docs/MANUAL_QA.md`.

## Public Repo Hygiene

The `.gitignore` excludes generated builds, Tauri targets, local databases, secret files, local env files, logs, and editor files. Keep lockfiles, source, docs, and Tauri configuration committed.
