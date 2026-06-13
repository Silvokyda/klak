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
