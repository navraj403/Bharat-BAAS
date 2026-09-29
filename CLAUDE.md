@AGENTS.md

# Claude Code notes

Everything shared with Codex (stack, architecture, lanes, conventions, guardrails) is in `AGENTS.md`, imported above. Only Claude-specific notes go here.

- **Role:** the main Claude session is the **PM/orchestrator**. It delegates per `docs/BUILD_PLAN.md` §7–§9, runs the gates, commits, and owns the dev server and DB seed. Subagents act only as the agent id in their brief and edit only the files it owns.
- **Next.js 16:** before using an unfamiliar API (params, caching, `cookies()`, route handlers, `next/navigation`), read the matching guide in `node_modules/next/dist/docs/01-app/`. Don't rely on memory of Next 13–15.
- **Subagents:** use them only when the user asks. For a parallel lane, prefer Codex, per the lane table in `AGENTS.md`.
- **Previewing:** run the dev server through the Browser pane's `preview_start` (config in `.claude/launch.json`), not a raw background `npm run dev`.
- **Before handing back:** run `npm run check`, append a line to `docs/STATUS.md`, and summarise what changed and what's next in 3–5 lines.
- **Time budget:** this is a 2-hour build. When a choice is between polish and finishing the demo path in `AGENTS.md` → "Definition of done", finish the path first.
