# Smart Snooze

A Slack agent that sits on top of `dnd.setSnooze` / `dnd.info` and decides,
per message, whether to break through your DND — instead of Slack's
all-or-nothing snooze.

Built for the AI Slack Hackathon (Slack AI capabilities track).

## Core mechanic

1. `/focus` opens a modal (duration, scope, break-through rule presets) and
   calls `dnd.setSnooze` as the baseline silencer.
2. Every incoming message the app sees while you're snoozed is checked
   against your ruleset:
   - **Sender allowlist** — manager / on-call / direct reports always break through
   - **Keywords** — "prod down," "blocked," "incident," etc. (simple substring match)
   - **Frequency** — same person messaging 2+ times in N minutes escalates
   - **LLM urgency classifier** (optional, off by default) — last-resort check for
     messages that don't hit a hard rule
   - **Scope** — global, or restricted to a single channel
3. Matches get delivered immediately as a bot DM, tagged with *why* they broke
   through. Everything else is queued into an end-of-session digest.

## Project layout

```
src/
  app.js                    # Bolt entry point
  db/index.js                lowdb schema + session CRUD (smartSnoozeSessions)
  utils/rules.js             break-through rule evaluation
  utils/llmClassifier.js     optional LLM urgency layer (Claude Haiku)
  blockkit/focusModal.js     /focus modal + submission parsing
  blockkit/cards.js          break-through DM card + digest card
  commands/focus.js          /focus and /unfocus command handlers
  commands/digest.js         end-of-session digest generation
  listeners/messageListener.js   checks live events against active sessions
```

## Setup

1. Create a Slack app at api.slack.com/apps (or use an existing manifest-based one).
   **Bot Token Scopes**: `chat:write`, `channels:read`, `channels:history`,
   `groups:history`, `users:read`, `im:write`.
   **User Token Scopes**: `dnd:write`, `dnd:read` — these are user-scoped, not
   bot-scoped, because Slack only lets a person silence their own
   notifications, not a bot on their behalf. They live in a separate section
   of OAuth & Permissions from the bot scopes above.
   Subscribe to the `message.channels` (and `message.groups`/`message.im` as
   needed) bot event.
2. Enable Socket Mode for local dev and generate an app-level token (`xapp-...`).
3. Install the app (or reinstall, if scopes changed) — you'll get **two**
   tokens on the OAuth & Permissions page: a Bot User OAuth Token (`xoxb-...`)
   and a User OAuth Token (`xoxp-...`).
4. `cp .env.example .env` and fill in `SLACK_BOT_TOKEN` (xoxb), `SLACK_USER_TOKEN`
   (xoxp), `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN`.
5. `npm install`
6. `npm run dev`
7. In Slack, run `/focus`.

## Build order (matches hackathon plan)

- [x] Step 1 — `/focus` modal, hard-coded sender/keyword rules, `dnd.setSnooze`
- [x] Step 2 — message listener, break-through delivery via bot DM
- [x] Step 3 — end-of-session digest, grouped by channel
- [ ] Step 4 — LLM urgency classifier is wired up (`utils/llmClassifier.js`,
      toggle via `ENABLE_LLM_CLASSIFIER=true` + `ANTHROPIC_API_KEY`) but treat
      it as the demo flourish, not something to lean on for MVP correctness.

## Known gaps / next steps

- Session end is scheduled with `setTimeout`, which won't survive a process
  restart. For anything beyond a demo, replace with a periodic sweep over
  `getAllActiveSessions()` (e.g. a `setInterval` or cron) that checks `endTime`.
- The message listener currently evaluates *every* active session against
  every message, without checking channel membership of the session owner —
  fine for a small hackathon workspace, not for scale.
- Frequency tracking (`utils/rules.js`) is in-memory only; resets on restart.
- Thread-scoped snooze ("snooze this thread only") is modeled in the schema
  (`scope: "thread"`) but the `/focus` modal only exposes global/channel
  scope right now — add a thread option if you want to demo it.
