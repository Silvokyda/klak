# Klak Memory Model

Klak memory is local, explicit, editable, and deletable.

Memories are stored in the local SQLite `memories` table in the Tauri app. Browser-only development uses the isolated insecure dev database fallback.

## Memory Types

- `profile`: durable facts about the user.
- `preference`: user preferences and repeated choices.
- `project`: project-specific context.
- `workflow`: repeated process knowledge.
- `task`: temporary or active task context.
- `document`: user-approved document context.
- `command_history`: user-approved command or workflow history.

Projects and workflows also have dedicated local tables. Use `project` and `workflow` memories for narrative facts and user preferences; use the `projects` and `workflows` records for structured fields such as repository path, status, trigger phrase, and workflow steps.

## When To Save Memory

Klak should not silently save everything as permanent memory. Memory should be saved when:

- the user explicitly says "remember this" or an equivalent phrase,
- the user approves a suggested memory,
- a repeated workflow or project fact is clearly useful and the user confirms it.

Temporary task memory can have an expiration time. Permanent memories should remain visible in the Memory screen and be editable or deletable.

## Search

The MVP uses simple local text search across title, content, source, and type. This is intentionally small and transparent.

The search interface should later support embeddings or vector search while preserving local-first behavior and user control.

## Persistence

The repository functions are:

- `createMemory(input)`
- `updateMemory(id, input)`
- `deleteMemory(id)`
- `getMemoryById(id)`
- `listMemories(filters?)`
- `searchMemories(query, filters?)`
- `touchMemory(id)`

API keys and other secrets must never be stored as memories.

The safe `create_memory` tool is intended for user-approved facts, preferences, project notes, workflows, tasks, documents, and command history. If content appears to contain credentials, tokens, API keys, or passwords, it should be refused or redirected to secret storage rather than memory.

## Project and Workflow Memory

Project records are managed by `src/lib/projects/projectRepository.ts` and store local context such as name, repository path, stack, status, URLs, and notes.

Workflow records are managed by `src/lib/workflows/workflowRepository.ts` and store repeatable local workflows as JSON steps. Workflow execution is limited to the existing safe tool registry: URL opening, allowed-folder opening, note creation inside allowed folders, clipboard writing, memory search, and memory creation. Manual instructions are shown as human-readable steps and are not executed by the app.

Assistant requests include relevant memories, projects, and workflow summaries. Saved workflow trigger phrases are detected locally; the assistant points the user to the Workflows screen for preview and confirmation rather than running workflows silently.
