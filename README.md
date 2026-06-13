# Klak

Klak - your local AI operator.

Klak is a local-first Windows desktop assistant built with Tauri v2, React, TypeScript, Vite, and SQLite-backed local persistence. It starts as a visible desktop app with first-time setup, local memory, permissions, tool previews, audit logs, and a configurable OpenAI-compatible provider.

## Requirements

- Node.js 20+
- npm
- Rust toolchain for Tauri desktop commands
- Windows WebView2 runtime

## Setup

```powershell
npm install
npm run dev
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
- API keys are stored through `secretStore`. The current implementation is an isolated dev fallback named `insecureDevSecretStore.ts`, and the UI warns: "Development storage is active. Do not use production keys."
- Dangerous tools are registered as disabled future extension points and blocked by the permission system.
- No telemetry, analytics, accounts, hosted backend, cloud sync, screenshot capture, or clipboard reading is implemented.

## Public Repo Hygiene

The `.gitignore` excludes generated builds, Tauri targets, local databases, secret files, local env files, logs, and editor files. Keep lockfiles, source, docs, and Tauri configuration committed.
