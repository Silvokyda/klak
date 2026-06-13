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
- SQLite tables store memories, action logs, non-secret app settings, tool settings, and allowed folders.
- API keys are stored through `secretStore`. In native Tauri, Klak uses Windows-backed storage through the Rust `keyring` crate. In browser-only development, Klak falls back to `insecureDevSecretStore.ts` and warns: "Development storage is active. Do not use production keys."
- Implemented safe tools: `open_url`, `open_folder`, `create_note`, `copy_to_clipboard`, `search_memory`, and `create_memory`. They all go through permission checks, action previews, approval/denial, and audit logging.
- Dangerous tools are registered as disabled future extension points and blocked by the permission system.
- Voice input is opt-in and push-to-talk only. Klak does not listen in the background and does not upload audio.
- No telemetry, analytics, accounts, hosted backend, cloud sync, screenshot capture, browser automation, terminal execution, or unrestricted clipboard/file reading is implemented.

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

## Public Repo Hygiene

The `.gitignore` excludes generated builds, Tauri targets, local databases, secret files, local env files, logs, and editor files. Keep lockfiles, source, docs, and Tauri configuration committed.
