# Parallel agent runs, prompt queue and steer

Decided with the user on 2026-10-22.

## Intent

Users want several agents working on the same canvas at once (for example Claude Code in one chat session and
Codex in another), and want to keep typing while an agent works: messages queue up, and any queued message can
be pushed into the running agent ("steer") to change its direction without waiting for the run to end.

## Decisions

1. **One run per chat session, up to 3 at once** (`MAX_CONCURRENT_RUNS` in `packages/agent/src/bridge-protocol.ts`).
   The visible session is the one in the Agent panel; other sessions keep running in the background. Switching
   sessions and starting a new session are allowed while runs are active. Each running session shows a running
   indicator in the session list.
2. **Soft claims for conflicts.** Nodes a run creates or edits are claimed by that run until it ends. A tool call
   from another run that would modify or delete a claimed node (or a descendant of one) fails with a coded error
   (`node_claimed`, naming the other session's title) so that agent can pick another target. Reads are never
   blocked. The user is never blocked by claims.
3. **Selective "Undo all".** Every agent transaction carries `runId` (`Transaction.runId` in
   `packages/doc/src/history.ts`). "Undo all" for a run reverts only that run's transactions. It is allowed when no
   later transaction from someone else (another run or the user) touched the same nodes; otherwise it is disabled
   with a reason. Undo of a run is one new undoable transaction (so it can be redone with Cmd+Shift+Z).
4. **Queue by default, steer on demand.** While the visible session's run is active, Enter adds the message to
   that session's queue. Queued messages show above the composer and can be edited, removed or steered. When the
   run ends, the first queued message starts the next run automatically (with session history as today).
5. **Steer.**
   - In-browser runtimes (Anthropic API, custom OpenAI/Anthropic-compatible): the message is appended as a user
     message at the next turn boundary of the running loop.
   - Claude Code (`steer: "native"`): the editor sends `run_steer`; the bridge feeds it into the Agent SDK's
     streaming input; the bridge emits `run_event { kind: "steered" }` when delivered.
   - Other CLIs (`steer: "restart"`): the editor cancels the run at once and starts a new run in the same session
     with the steer message plus the session history (canvas changes already made stay).
   - The steered message is shown in the transcript as a user bubble marked "steered".
6. **Background runs do not move the user's selection or camera.** Only the run of the visible session may focus
   the viewport, and no run changes the selection while the user is working in another session.
7. **Each run has its own agent focus box and cursor on the canvas**, tinted per session, labelled with the session
   title.

## Non-goals

- More than one run inside one session.
- Running sessions across different open files at the same time (switching files still cancels runs).
- Merging conflicting edits automatically.

## Contracts already in the code

- `Transaction.runId?: string` and `commit(…, { source, label, runId })` in `packages/doc/src/history.ts`.
- `BRIDGE_PROTOCOL_VERSION = 4`, `MAX_CONCURRENT_RUNS = 3`, editor→bridge `run_steer { runId, text, attachments? }`,
  `RunEvent { kind: "steered"; text }`, `LocalAgentInfo.steer: "native" | "restart"` in
  `packages/agent/src/bridge-protocol.ts`; adapters declare `steer` (default "restart") in
  `apps/bridge/src/agents/types.ts`.
