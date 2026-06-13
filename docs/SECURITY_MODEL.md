# Klak Security Model

Klak is a visible local desktop assistant, not a stealth application.

## Baseline Rules

1. Klak must never run invisibly.
2. Klak must always have a visible tray or app interface.
3. Klak must never collect passwords.
4. Klak must never exfiltrate local files.
5. Klak must not send local file contents to AI unless the user approves.
6. Klak must ask before risky actions.
7. Klak must log every action.
8. Klak must allow the user to reset or delete local data.
9. Klak must allow disabling all tools.
10. Klak must start local-first.

## Permission Modes

- Observe only: no tool execution.
- Suggest only: suggestions without execution.
- Draft/fill only: future draft-only workflows.
- Act with confirmation: default mode; meaningful actions require preview and approval.
- Trusted workflows only: future mode for narrow user-approved workflows.

The default is `act_with_confirmation`. Klak must never default to full autopilot.

## Risk Levels

- Low: safe local lookup or low-impact action.
- Medium: actions that change local state or open local resources.
- High: sensitive local context or stronger automation.
- Dangerous: blocked in the MVP.

Dangerous examples include deleting files, sending emails, submitting forms, running shell commands, making payments, changing passwords, installing software, and accessing private credentials.

## Action Preview

Before meaningful action, Klak shows:

- what it wants to do,
- which tool it will use,
- what data it will use,
- the risk level,
- approve and deny controls.

## Audit Logging

Every tool call proposal is logged with status, risk level, input summary, timestamp, and approval state. Statuses are `proposed`, `approved`, `denied`, `running`, `completed`, `failed`, and `blocked`.

Action logs are stored locally in SQLite through `src/lib/logs/actionLogRepository.ts`. The action preview path creates a `proposed` log entry, and approval or denial updates that same record.

## Settings And Secrets

Non-secret settings are stored in the local SQLite `app_settings` table. Tool enabled state is stored in `tool_settings`, and allowed folders are stored in `allowed_folders`.

API keys are handled by `src/lib/security/secretStore.ts`, not SQLite settings or memories. The current implementation uses `insecureDevSecretStore.ts` and displays: "Development storage is active. Do not use production keys." Replace this with OS keychain storage before production use.

In the native Tauri app, `secretStore` calls Rust commands backed by the `keyring` crate and Windows credential storage. Browser-only development still uses `insecureDevSecretStore.ts`.

## Safe Local Tools

- `open_url` allows only `http` and `https`.
- `open_folder` allows only folders already present in `allowed_folders`.
- `create_note` writes only inside allowed folders and refuses to overwrite existing files.
- `copy_to_clipboard` writes text only after user approval and never reads clipboard automatically.
- `search_memory` searches local memory and should avoid logging raw sensitive queries.
- `create_memory` must not save secrets as memories.

All tool calls pass through preview, approval or denial, and audit logging.

## Voice Rules

- Microphone use is opt-in.
- Recording starts only when the user presses the voice button.
- Recording state is visible.
- Canceling recording discards audio.
- No wake-word listening.
- No background microphone capture.
- No cloud speech services by default.
- Local Whisper execution validates configured executable and model paths.
- Local Whisper is launched through `std::process::Command`, not through shell interpolation.
- Custom user shell arguments are not accepted.
- Temporary audio is deleted after transcription unless debugging retention is enabled.
- Transcription does not auto-send chat messages.
- Spoken output is off by default and guarded against obvious secret-like text.

## Not Implemented

Klak still does not implement browser automation, mouse or keyboard control, screenshot capture, clipboard reading, cloud sync, account login, telemetry, unrestricted file reading, terminal execution, wake-word listening, or always-on microphone capture.
