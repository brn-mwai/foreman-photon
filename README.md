# foreman

> Text your thoughts. Foreman files them to the right project and tells you what's slipping.

An iMessage-native operations agent for founders juggling many projects. No UI, no dashboard — just text your phone like you text a friend.

Built on [`@photon-ai/imessage-kit`](https://github.com/photon-hq/imessage-kit) (macOS iMessage SDK) and Google Gemini for intent classification.

**Repo:** [`foreman-photon`](https://github.com/brn-mwai/foreman-photon) — the agent that runs the site while you build.

---

## Why this exists

If you ship across five repos, three pitch decks, and a competition at once, the bottleneck is not execution — it is *context reassembly*. Every morning you re-load: who needs what, what's stale, what did I decide on Tuesday about X.

Foreman is a conversation-native stand-in for that ritual. Every thought you fire at it becomes a structured note in the right project's log. Every morning it fires back a digest of commits, blockers, and stalled projects.

One sentence: **"Text it anything; it files the note, nudges the stale ones, and writes your morning standup."**

---

## System design

### Component topology

```
                           ┌───────────────────────────────┐
                           │        macOS · chat.db        │
                           │ (Messages SQLite, read-only)  │
                           └────────────────┬──────────────┘
                                            │  WAL tail + osascript
                                            ▼
                           ┌───────────────────────────────┐
                           │   @photon-ai/imessage-kit     │
                           │   startWatching · send        │
                           └────────────────┬──────────────┘
                                            │ onDirectMessage
                                            ▼
    ┌─────────────────────────────────────────────────────────────────┐
    │                      foreman · src/index.ts                     │
    │                                                                 │
    │   owner-handle gate  ─►  tryCommand()  ─►  route()  ─►  reply   │
    │                             │                 │                 │
    │                             ▼                 ▼                 │
    │                       commands.ts         router.ts             │
    │                       (grammar)           (Gemini JSON)         │
    └───────┬────────────────────────────────────────────┬────────────┘
            │                                            │
            ▼                                            ▼
    ┌───────────────────┐                       ┌────────────────────┐
    │  standup.ts       │                       │  storage.ts        │
    │  git log scan +   │                       │  append-only JSONL │
    │  notes rollup     │                       │  ~/.foreman/…      │
    └───────────────────┘                       └────────────────────┘
```

### Request flow

1. **Watch.** `imessage-kit` tails `chat.db` WAL; each new row fires `onDirectMessage`.
2. **Gate.** We drop anything not from `OWNER_HANDLE` (normalized: no spaces/dashes/parens).
3. **Parse.** `commands.ts` checks a fixed grammar: `standup`, `todos`, `blockers`, `done <id>`, `list`, `help`. Hit → handled and replied.
4. **Route.** Miss → Gemini classifies `{slug, kind, summary, confidence}`. Keyword fallback if LLM fails.
5. **Persist.** Append a `Note` to `~/.foreman/projects/<slug>/notes.jsonl`.
6. **Reply.** `→ AXI Mobility [todo] · id=abc123`.

### Morning standup flow

```
  tick every 60s ──► matches STANDUP_AT?
                           │
                           ▼
                     buildStandup()
                   ┌──────┴───────┐
                   ▼              ▼
        git log --since=24h    readNotes(slug)
        (per project repo)     (todos, blockers)
                   │              │
                   └──────┬───────┘
                          ▼
                   stale detector (last activity > STALE_DAYS)
                          │
                          ▼
                    sdk.send(OWNER_HANDLE, digest)
```

---

## Ontology

Modelled against BFO (ISO/IEC 21838) so the schema stays portable and the agent has a stable world model. See `Claude_brain/domains/ai-ml/agents/bfo-ontology-fundamentals.md`.

### Entity → BFO category → storage shape

| Foreman entity       | BFO category                               | Storage                                                   |
| -------------------- | ------------------------------------------ | --------------------------------------------------------- |
| `Project`            | Independent continuant (object aggregate)  | `PROJECTS[]` registry in `projects.ts`                    |
| `Owner`              | Independent continuant (object) + Role     | `OWNER_HANDLE` env var (role = founder, externally held)  |
| `Chat`               | Site (immaterial container)                | `msg.chatId` from SDK                                     |
| `Note`               | Generically Dependent Continuant (info)    | JSONL row: `{id, ts, kind, text, done, source}`           |
| `Note.kind`          | GDC subtype marker                         | enum: `note \| todo \| blocker \| decision \| idea`       |
| `Standup Digest`     | GDC (information content entity)           | synthesised on demand, not persisted                      |
| `Routing decision`   | Process (occurrent) → produces a GDC       | Gemini call → returns `Routed` → emits `Note`             |
| `Send / Watch`       | Process (occurrent)                        | AppleScript `osascript` / WAL tail                        |
| `Staleness`          | Quality (SDC) of a `Project`               | derived from `fs.stat(notes.jsonl).mtimeMs`               |
| `Confidence`         | Quality (SDC) of a `Routing decision`      | `0..1` on the `Routed` GDC                                |

### Continuant vs Occurrent — what that buys us

Foreman keeps the two cleanly split:

- **Continuants** (things that persist): `Project`, `Owner`, `Chat`. Live in the registry / env.
- **Occurrents** (events in time): every `Note` append, every routing call, every `send`. Live append-only in JSONL, never mutated (except `done` toggle — see below).

The one compromise: marking a todo `done` mutates a Note in place. Pragmatic, not principled — future versions should log a `Completion` occurrent instead of mutating the GDC.

### Directory layout (file-system is the database)

```
~/.foreman/
├─ projects/
│  ├─ axi/
│  │  └─ notes.jsonl          ← append-only log of GDCs for AXI
│  ├─ wispy/
│  │  └─ notes.jsonl
│  ├─ revlog/
│  │  └─ notes.jsonl
│  ├─ tollgate/
│  │  └─ notes.jsonl
│  ├─ kusini/
│  │  └─ notes.jsonl
│  ├─ ktp/
│  │  └─ notes.jsonl
│  ├─ paramgolf/
│  │  └─ notes.jsonl
│  └─ inbox/
│     └─ notes.jsonl          ← fallback bucket
```

No SQL, no ORM, no migration dance. Append a line, grep a file. If the shape of a `Note` changes, old rows parse as a strict subset — forward-compatible.

---

## Command grammar

All commands are whole-message matches (case-insensitive), keeping parse cost O(1).

| Pattern              | Effect                                                      |
| -------------------- | ----------------------------------------------------------- |
| `help`, `?`          | Print this grammar.                                         |
| `standup` / `morning` / `gm` | Build + send today's digest.                        |
| `list`               | Dump project slugs and names.                               |
| `todos [slug]`       | Open todos, all projects or scoped.                         |
| `blockers`           | Open blockers across all projects.                          |
| `done <id>`          | Mark a note done by id.                                     |
| *anything else*      | Route through Gemini → append Note → reply `→ <Project> [kind] · <id>`. |

### Reply format

Confirmation messages compress to one line so you can scroll a thread and grok state:

```
→ Wispy [todo] · kf2p9a
→ AXI Mobility [blocker] ? · kf2p9b     # `?` = low confidence, verify
→ inbox · kf2p9c                         # kind=note, no decoration
```

---

## Tech stack

| Layer            | Choice                              | Reason                                            |
| ---------------- | ----------------------------------- | ------------------------------------------------- |
| Runtime          | Bun ≥ 1.1 (Node 20 compatible)      | imessage-kit ships zero-dep under Bun             |
| Language         | TypeScript (ES2022, ESM)            | type safety + `@google/genai` SDK is TS-native    |
| iMessage SDK     | `@photon-ai/imessage-kit`           | the build-challenge requirement                   |
| LLM              | Gemini 2.5 Flash (`@google/genai`)  | fast, cheap, JSON-mode native                     |
| Storage          | JSONL on local disk                 | append-only, greppable, zero deps                 |
| Scheduler        | `setInterval` + HH:MM match         | no cron daemon required                           |
| Process ownership| macOS user session (Full Disk Access) | required by chat.db — no daemon escalation      |

---

## Setup

### 1. Prereqs

- **macOS** (only platform iMessage runs on).
- Bun ≥ 1.1 or Node 20+.
- Apple ID signed into Messages.app.
- A Gemini API key.

### 2. Grant Full Disk Access

Required so `imessage-kit` can read `~/Library/Messages/chat.db`.

1. `System Settings → Privacy & Security → Full Disk Access`
2. Add your terminal (Terminal.app, iTerm, Warp) or your IDE.

### 3. Install + configure

```bash
git clone <your-fork>/foreman
cd foreman
bun install
cp .env.example .env
# edit .env: set OWNER_HANDLE and GEMINI_API_KEY
```

### 4. Run

```bash
bun run start
# 👷 foreman running · owner=+15555551234
```

Then text your own number (or email) from your phone. You'll get a structured reply in seconds.

### 5. (Optional) Run as a login agent

Write a `launchd` plist at `~/Library/LaunchAgents/cc.foreman.agent.plist` pointing at `bun run start` in the project dir. Load with `launchctl load …`. Now Foreman wakes with your Mac.

---

## Configuration

| Env var          | Purpose                                              | Default                          |
| ---------------- | ---------------------------------------------------- | -------------------------------- |
| `OWNER_HANDLE`   | Only texts from this handle are processed.           | **required**                     |
| `GEMINI_API_KEY` | Gemini auth.                                         | **required**                     |
| `GEMINI_MODEL`   | Model to route with.                                 | `gemini-2.5-flash-preview-05-20` |
| `FOREMAN_HOME`   | Data directory.                                      | `~/.foreman`                     |
| `STANDUP_AT`     | `HH:MM` local time to push morning digest. Empty = off. | `07:00`                       |
| `STALE_DAYS`     | Project is "stale" if silent this long.              | `3`                              |

---

## File layout

```
foreman/
├─ package.json
├─ tsconfig.json
├─ .env.example
├─ src/
│  ├─ index.ts        · entry: watcher + owner gate + standup scheduler
│  ├─ commands.ts     · fixed grammar parser
│  ├─ router.ts       · Gemini JSON classifier + keyword fallback
│  ├─ projects.ts     · the 7 active projects + alias table
│  ├─ storage.ts      · JSONL append/read + markDone + staleness probe
│  └─ standup.ts      · git log + notes rollup → digest string
└─ README.md
```

---

## Security model

- **Owner-only:** every incoming message is dropped unless sender matches `OWNER_HANDLE`. Spoofing would require compromising the sender's Apple ID.
- **Local-only data:** notes never leave disk except when you ask for a standup.
- **Gemini sees summaries only:** we send the raw text to Gemini *once* for routing; nothing fans out beyond that call.
- **No secrets in notes:** Foreman does not strip PII from notes you type. Treat `~/.foreman` like your `~/.ssh` — don't sync to a shared drive.
- **Full Disk Access is powerful:** granting it lets Foreman read every macOS database the user owns. Only run from a terminal you trust.

---

## Extending

Some easy next moves:

1. **Email digests.** Swap `sdk.send` for an SMTP step when you want the standup in inbox.
2. **Per-project repo hooks.** Add `repoPath` to every project in `projects.ts` and you get commit-aware digests for free.
3. **Tapback reactions as ack.** Upgrade to [Advanced iMessage Kit](https://github.com/photon-hq/advanced-imessage-kit) to confirm filings with a tapback instead of a reply.
4. **Weekly rollup.** A second scheduler at `FRIDAY 17:00` that calls Gemini on the week's notes per project and writes a Markdown summary.

---

## License

MIT. Credit `@photon-ai/imessage-kit` and Gemini.
