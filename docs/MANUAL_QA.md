# Klak Manual QA Checklist

Use this checklist before major milestones. Keep tests local and visible.

## General Use

- Create a saved action that opens or prepares a safe local workspace.
- Create a routine with simple steps such as open folder, open website, create note, or copy a reusable message.
- Confirm Klak asks for approval before running meaningful actions.
- Confirm Activity History shows proposed, approved, completed, failed, and blocked actions.
- Confirm empty states in Routines, Saved Actions, Running Activities, Activity History, and Health Check are understandable.
- Confirm disabled capabilities do not run.

## Running Activities

- Mark a saved action as long-running and background-enabled.
- Start it from Saved Actions and confirm approval is required.
- Confirm Running Activities shows name, space, status, PID, start time, and recent output.
- Try starting the same saved action in the same folder again and confirm duplicate start is blocked.
- View recent output and confirm the UI remains responsive.
- Stop the activity and confirm the status changes to stopped or killed.
- Restart Klak and confirm stale activities from a previous session are marked as stale/unmanaged.
- Confirm stale activities cannot be stopped by Klak.

## General-User App Discovery

- Open Apps.
- Click Scan for apps.
- Confirm suggestions appear from safe Windows app sources.
- Confirm recommended suggestions show app icon or a clean fallback, name, source, path, publisher when available, and status.
- Confirm names are recognizable, such as Microsoft Edge, Paint, Outlook, Snipping Tool, Microsoft Teams, Visual Studio Code, Microsoft Store, and Google Chrome.
- Confirm installer/uninstaller entries are not shown as normal suggestions, including `unins000.exe`, setup executables, update helpers, package cache entries, redistributables, and SDK installers.
- Confirm Visual C++ redistributables, Windows SDK installers, runtime installers, and package cache executables are hidden or marked unsupported.
- Confirm Python, winget, ngrok, PowerShell, CMD, Regedit, Diskpart, and script hosts are not shown as normal apps.
- Confirm Chrome, Edge, VS Code, Slack, Notepad, Paint, OBS, Figma, Teams, Outlook, WinRAR, AnyDesk, or similar user-facing apps appear as recommended if installed and discoverable.
- Toggle Show unsupported/advanced items and confirm technical helpers are separated from Recommended.
- Select a safe recommended app such as Chrome, Edge, Notepad, Word, Zoom, or VS Code.
- Click Add selected apps.
- Confirm only selected apps are added.
- Confirm the same app cannot be added twice.
- Confirm already registered apps show an already-added badge and cannot be selected.
- Confirm blocked or unsupported tools cannot be selected or registered.
- Launch the added app through Klak and confirm approval is required.
- Confirm Activity History records scan, registration attempt, registered apps, and blocked/failed registration entries.
- Confirm Start Menu shortcut-only apps may not appear in v1 unless they also have App Paths or uninstall registry metadata.

## Advanced Developer Use

- Create a finite template such as `npm run build`, `cargo check`, or `git status --short`.
- Confirm finite commands still require preview and approval.
- Confirm long-running commands such as `npm run dev`, `npm run tauri dev`, `php artisan serve`, `flutter run`, and queue workers cannot run through the finite command path.
- Confirm a routine can include `start_background_process` for an approved long-running saved action.
- Confirm a project card shows linked saved actions and running activities.
- Confirm stop attempts, blocked duplicate starts, successes, and failures appear in Activity History.
- Confirm developer tools such as VS Code, Postman, GitHub Desktop, and JetBrains apps can be discovered or manually registered when safe.
- Confirm shells such as PowerShell, CMD, Windows Terminal, WSL, and Bash are blocked as normal apps.
