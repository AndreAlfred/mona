# Mona

One work of art at a time, in the words of the people who knew it best.

Mona is a phone-first web app for two friends who would rather look at art
than refresh their email. Every card shows one artwork and explains it, as
far as possible, with **verbatim, cited human writing**: the artist first,
then scholars, critics, museum text, Wikipedia. AI-written notes are rare,
short, and labelled.

Design: [`docs/superpowers/specs/2026-11-03-mona-design.md`](docs/superpowers/specs/2026-11-03-mona-design.md)

## How it works

| Layer | What | Where |
|---|---|---|
| **Curated** | Researched cards: three sections, cited quotes, technique tags | `content/` JSON, written by agents, merged through the gate |
| **Archive** | Endless cards built live from museum open data (no AI) | Art Institute of Chicago + Cleveland Museum of Art APIs, Wikipedia, Wikiquote, Wikidata |
| **Requests** | "Research this" on an archive card → a GitHub issue → an agent curates it | `app/api/requests`, `worker/`, `agents/curate.md` |

Nothing on the site calls an LLM. Curation runs on existing subscriptions:

- **Daily Claude routine** (Claude Code on the web, scheduled) follows
  [`agents/curate.md`](agents/curate.md), curates broad-first, opens a PR.
- **Local worker** (`worker/mona-worker.mjs`, launchd on a Mac) polls the
  `research` issue queue and hands requests to Codex CLI, then opens a PR.

Every content PR runs **content-gate** (`.github/workflows/content-gate.yml`):
schema, quote-length limits, open-licence images, and **verbatim quote
verification** (each quote must appear on its `readAt` page, with the
author named). Content-only PRs from this repo auto-merge when it passes;
Vercel deploys `main`.

The feed goes deep before wide: ten works by one artist, then an
end-of-artist screen where you either keep going or *pull past a stretchy
point* to leave for someone new. Collection, history and the feed's random
seed live on your device (export/import on the History page).

## Develop

```sh
npm install
npm run dev            # http://localhost:3000 (builds public/data first)
npm test               # unit tests
npm run gate           # the merge gate, locally, for changed content
npm run coverage       # where curated content is thinnest
npm run new-work -- aic-28560 vincent-van-gogh   # scaffold a work from a museum record
npm run archive-index  # rebuild content/archive-artists.json (slow, polite)
```

Environment (Vercel): `MONA_PASSPHRASE` (shared word for the research
button), `GITHUB_ISSUES_TOKEN` (fine-grained PAT: Issues read/write on this
repo only).

## The local worker

```sh
cp worker/com.andrew.mona-worker.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.andrew.mona-worker.plist
tail -f ~/Library/Logs/mona-worker.log
```

It needs `gh` (logged in) and `codex` (logged in with ChatGPT). It works in
its own clone at `~/mona-worker` and never touches anything else. Stop it
with `launchctl unload` on the same plist.

## Credits

Images: Art Institute of Chicago and Cleveland Museum of Art open access
(CC0). AIC descriptions CC BY 4.0. Wikipedia/Wikiquote text CC BY-SA 4.0.
Van Gogh letters via WebExhibits. Every quote links to where it was read.
