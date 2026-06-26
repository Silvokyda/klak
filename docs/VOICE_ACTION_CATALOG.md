# Klak Voice Action Catalog

This document records the current mapping between manual UI actions and whether they are safely reachable through voice in the current implementation.

## Applications

| Manual action | Current service / repository | Voice-safe | Approval | Status |
| --- | --- | --- | --- | --- |
| Scan installed apps | `src-tauri/src/lib.rs` `scan_installed_apps` | Yes | None | Complete |
| Register a safe discovered app | `src/lib/apps/appDiscoveryService.ts`, `src/lib/apps/registeredAppsRepository.ts` | Yes | Before registration | Complete |
| Launch a registered app | `src/lib/apps/registeredAppsRepository.ts`, `src/lib/tools/toolExecutor.ts` | Yes | Before launch | Complete |
| Enable or disable a registered app | `src/lib/apps/registeredAppsRepository.ts` | Yes | Before change | Complete |
| Combined register-and-launch | `src/lib/apps/appDiscoveryService.ts`, `src/lib/tools/toolExecutor.ts` | Yes | Before combined action | Complete |

## Allowed Folders

| Manual action | Current service / repository | Voice-safe | Approval | Status |
| --- | --- | --- | --- | --- |
| List allowed folders | `src/lib/storage/allowedFoldersRepository.ts` | Yes | None | Partial |
| Add allowed folder | `src/lib/storage/allowedFoldersRepository.ts` | Yes | Before add | Partial |
| Open allowed folder | `src/lib/storage/allowedFoldersRepository.ts`, `src/lib/tools/toolExecutor.ts` | Yes | Before open | Complete |
| Remove allowed folder | `src/lib/storage/allowedFoldersRepository.ts` | Yes | Before remove | Partial |

## URLs

| Manual action | Current service / repository | Voice-safe | Approval | Status |
| --- | --- | --- | --- | --- |
| Open HTTP or HTTPS URL | `src/lib/tools/safeToolUtils.ts`, `src/lib/tools/toolExecutor.ts` | Yes | Before open | Complete |

## Memories

| Manual action | Current service / repository | Voice-safe | Approval | Status |
| --- | --- | --- | --- | --- |
| Search memory | `src/lib/memory/memoryRepository.ts`, `src/lib/tools/toolExecutor.ts` | Yes | None | Complete |
| Create memory | `src/lib/memory/memoryRepository.ts`, `src/lib/tools/toolExecutor.ts` | Yes | Before create | Complete |
| Update memory | `src/lib/memory/memoryRepository.ts` | Not yet | Manual UI only | Complete in UI, unsupported in voice |
| Delete memory | `src/lib/memory/memoryRepository.ts` | Not yet | Manual UI only | Complete in UI, unsupported in voice |

## Projects and Workflows

| Manual action | Current service / repository | Voice-safe | Approval | Status |
| --- | --- | --- | --- | --- |
| Create project | `src/lib/projects/projectRepository.ts` | Not yet | Manual UI only | Complete in UI, unsupported in voice |
| Update project | `src/lib/projects/projectRepository.ts` | Not yet | Manual UI only | Complete in UI, unsupported in voice |
| Create workflow | `src/lib/workflows/workflowRepository.ts` | Not yet | Manual UI only | Complete in UI, unsupported in voice |
| Link startup workflow | `src/lib/projects/projectRepository.ts` | Not yet | Manual UI only | Complete in UI, unsupported in voice |
| Run workflow | `src/lib/workflows/workflowRepository.ts` | Partial | Before run | Partial |

## Commands and Background Activities

| Manual action | Current service / repository | Voice-safe | Approval | Status |
| --- | --- | --- | --- | --- |
| Run saved command template | `src/lib/commands/commandTemplateRepository.ts`, `src/lib/tools/toolExecutor.ts` | Partial | Before run | Partial |
| Start approved background process | `src/lib/processes/backgroundProcessRepository.ts`, `src/lib/tools/toolExecutor.ts` | Partial | Before start | Partial |
| Stop Klak-managed background process | `src/lib/processes/backgroundProcessRepository.ts` | Not yet | Manual UI only | Partial |

## Other screens

| Screen | Current voice coverage | Notes |
| --- | --- | --- |
| Assistant | Partial | Uses the shared preview/execution path, but not every manual control is voice-enabled. |
| Memory | Partial | Search and create are voice-ready; edit/delete remain UI only. |
| Projects | Partial | Project creation and update remain UI driven. |
| Workflows | Partial | Workflow preview and execution exist, but full voice mapping is not complete. |
| Apps | Complete for core app actions | Scan, register, launch, enable/disable, and combined register-and-launch are wired. |
| Commands | Partial | Saved command execution is supported, but not every editor control is voice-enabled. |
| Running Activities | Partial | Voice can start supported managed processes; stop remains UI-focused. |
| History | Not yet | Read-only UI. |
| Health Check | Not yet | Read-only UI. |
| Settings | Not yet | Read-only UI. |

## Notes

- Voice approval only resolves actions that are already allowed by the local policy.
- Dangerous or blocked actions remain blocked even if the user says yes.
- This catalog intentionally marks unsupported areas instead of assuming universal voice control.
