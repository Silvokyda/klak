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

## Advanced Developer Use

- Create a finite template such as `npm run build`, `cargo check`, or `git status --short`.
- Confirm finite commands still require preview and approval.
- Confirm long-running commands such as `npm run dev`, `npm run tauri dev`, `php artisan serve`, `flutter run`, and queue workers cannot run through the finite command path.
- Confirm a routine can include `start_background_process` for an approved long-running saved action.
- Confirm a project card shows linked saved actions and running activities.
- Confirm stop attempts, blocked duplicate starts, successes, and failures appear in Activity History.
