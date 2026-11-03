# Mona — design

Date: 2026-11-03 · Owner: Andrew Trimble · Status: approved 2026-11-03

## Intent

Mona replaces a bad habit. When Andrew reaches for his phone in a dead
moment (between conversations, under a minute) and would otherwise check
email or scroll, he opens Mona instead and sees one painting, with enough
real context to learn something in that minute and the option to go
deeper.

Two people use it: Andrew and one friend. Each has their own copy with its
own path through the art. They don't see each other's activity inside the
app; they talk about what they found, and can send each other a specific
work.

What makes it different from an art-history course or an AI art bot:

- **Inexhaustible.** No fixed syllabus; there is always another work.
- **Human words first, cited.** Wherever possible the text on a card is a
  quotation from a human writer with a visible citation. AI-written text
  is allowed only to fill gaps and is always labelled as AI.

## Goals

1. A card that is useful in under a minute: image first, then at a glance
   artist, active years, title, date, and which period/phase of the
   artist's work it belongs to.
2. Optional depth below the fold, three sections, each led by cited human
   writing where it exists:
   - **In their work**: how the piece matters within the artist's oeuvre.
   - **In its moment**: how it relates to the art world / movement then.
   - **Why it matters**: the piece in the artist's own life and
     circumstances (preferred), and/or the human meaning of its subject
     (grief, devotion, labour…) and its social-cultural relevance, cited.
     Not relevance to the reader.
3. Tags for techniques, materials, and styles (chiaroscuro, oil on panel,
   tenebrism, sfumato, egg tempera, etching…). Tapping a tag opens a feed
   of works sharing it. When a tag is especially significant to a work,
   the card highlights it with a short cited explanation. Tags, artists,
   movements and peers form one browsable network.
4. Endless scroll that goes deep before it goes wide (see Feed).
5. **Collect** (not "like") any work; collected works form **your
   collection**. A **history** of everything seen, each entry reopening
   the full card. Neither affects what Mona serves.
6. **Share** from the collection (and from any card) via the phone's
   native share sheet; the link opens the full card for anyone, no
   account.
7. Runs at zero ongoing cost (see Constraints).

## Non-goals (v1)

- Modern and contemporary art. Scope is roughly pre-1930, where museum
  open-access images are free and high resolution. Expandable later.
- Accounts, logins, syncing between devices, any social features inside
  the app.
- Recommendations driven by collection/history.
- Notifications, streaks, or any engagement mechanics.

## Anti-goals (failure even if it "works")

- A fabricated or misattributed quotation. One is a serious bug.
- Uncited AI prose presented as fact, or AI text not visibly labelled.
- A frictionless infinite feed that recreates doomscrolling. Depth-first
  with deliberate friction is the point.
- Slow first paint. If the card isn't on screen fast, the phone habit wins.
- Visual clutter competing with the art.

## Constraints

- **No paid API usage.** Andrew has a Claude Pro subscription and a
  ChatGPT subscription only. No Anthropic/OpenAI API keys. The deployed
  site never calls an LLM.
- **Free hosting.** Vercel free tier; public GitHub repo
  `AndreAlfred/mona` (Andrew explicitly authorised creating it publicly
  and deploying).
- **Images** must be openly licensed (CC0 / public domain): museum open
  access, Wikimedia Commons.
- Primary device: phone, saved to the home screen (installable PWA).
  Should also read well on desktop.

## Source hierarchy (decided)

Every passage of text records its source tier. Prefer the highest tier
available for each section:

1. The artist (letters, diaries, statements, recorded remarks)
2. Scholars (books, journal articles, catalogue raisonné essays)
3. Critics (published criticism, contemporary or later)
4. Museum text (wall labels, collection descriptions, museum essays)
5. Wikipedia
6. Other websites
7. Social media (e.g. Reddit) — only when nothing better exists, clearly
   marked

The card shows the citation (author, work, publisher/site, link) and a
small tier label so a Van Gogh letter is visibly different from a forum
post. Lower tiers appear only when higher ones aren't available.

AI-written text: allowed only where no human source covers a needed
point, short, and labelled "Mona's note (AI)" or similar. Never the lead
of a section if a human quote exists.

**Claims beyond quotes (my call).** Every factual claim on a curated card
is either sourced or labelled AI:
- Title, date, medium, dimensions, attribution ("workshop of…") come from
  the holding museum's record and are stored with that record's URL.
- Period/phase label, each tag assignment, and each peer/movement link
  carry a source (a passage or a structured record such as the museum
  record or Wikidata). If the agent can't source one, it either drops it
  or marks it as an AI judgement, shown with the AI label.
- Attribution of quotes: alongside the verbatim check, the merge check
  confirms the credited author's name appears on the `readAt` page.
  Agents are told never to use Wikiquote's "Misattributed" or "Disputed"
  sections.

**Quote length (my call).** Quotes are short excerpts with full
attribution: at most ~75 words per quote and at most two quotes from any
one copyrighted source per card. The merge check enforces the word limit.
Wikipedia text keeps its CC BY-SA attribution with a link.

## Look and feel (decided)

Serifed and editorial. Plain white background is fine. Let the art
breathe and do the work: the image dominates, typography is quiet and
museum-label-like, generous whitespace, minimal chrome. Specific
typefaces and details are the builder's call within that brief (avoid
generic system/Inter-style UI fonts).

## How it works

### Three content layers

**1. Curated cards (pre-generated).** Full cards with all three sections,
human quotes from tiers 1–4 where findable, tags with highlighted
explanations, peer links. Produced by agents outside the site, committed
as content files to the repo, deployed by Vercel on merge.

**2. Archive cards (live, endless, no AI).** When curated content for the
current path runs out, Mona builds cards on the fly from free public
sources, client- or edge-side:
- Museum open-access APIs that include curator-written text, e.g. Art
  Institute of Chicago (description), Cleveland Museum of Art
  (description / wall description). Others (e.g. the Met) for images and
  metadata where useful.
- Wikipedia (artist and, where it exists, the work).
- Wikiquote (the artist's own words, with its sourcing).
- Wikidata for artist relations (movement, influenced by, student of) to
  power peer links.
Archive cards carry only what those sources say, cited, and are honestly
labelled as not yet curated (no "significance/relevance" sections unless a
source supplies them). Filter to public-domain / CC0 works in scope.

**3. Research requests (asynchronous).** On an archive card, the reader
can tap "research this" (for the artist, the work, or a tag). This files
a request; an agent curates it; the curated card replaces the archive
card when ready. Status is visible on the card ("researching…"), and the
finished card slides in without a manual refresh if the reader is still
there.

### Producers (agents) — all outside the site

Both producers follow one shared, versioned playbook in the repo (e.g.
`agents/curate.md`) and one content schema, so output is consistent
regardless of which agent wrote it.

- **Daily Claude routine.** A scheduled Claude Code routine on Andrew's
  Pro plan, run in the cloud. Each run: first clears any queued research
  requests, then extends coverage breadth-first — a handful of artists
  across several periods at the start, then filling whichever periods,
  movements and tags are thinnest (tracked in a coverage file in the
  repo). Target output per run: ~2–3 artists × 10 works. Opens a PR.
  *Builder must confirm what Pro allows for scheduled routines (frequency,
  run limits) and size runs accordingly.*
- **Local research worker.** A small program on Andrew's Mac (launchd),
  polling the request queue every ~15–30 s. Outbound-only; nothing on the
  Mac is exposed to the internet. On finding a request it marks it
  in-progress and hands it to **Codex CLI** (`codex exec`, signed in with
  Andrew's ChatGPT subscription), working in a dedicated clone, with
  permission only to write content files. The worker runs validation,
  commits to a branch, opens a PR that closes the request. If the Mac is
  asleep, requests wait for the next daily routine.

**What each request type produces (my call):**
- **Work:** one curated card.
- **Artist:** the artist profile plus up to 10 curated works.
- **Tag:** its cited explanation plus up to 6 curated example works.

**If Pro can't schedule cloud routines usefully (my call):** run the
daily curation on the Mac instead, using launchd and headless `claude -p`
with the same playbook. If that's also limited, Codex runs it.

### Request queue

GitHub Issues on the Mona repo, with a label (e.g. `research`). The site
files issues through a serverless function holding a token scoped only to
creating issues on this repo. Requests are **structured taps, never free
text** (type + stable ids of artist / work / tag), so strangers can't
inject instructions into an agent. Duplicate requests attach to the
existing open issue. My call: the "research this" button asks once per
device for a short shared passphrase Andrew gives his friend, to stop
strangers from burning his subscription usage; reading, collecting and
sharing need no passphrase.

### Merge gate (credibility enforcement)

Every content PR runs a free GitHub Actions check, and auto-merges only if
it passes:
- Content validates against the schema.
- Images resolve and are openly licensed.
- **Quote verification:** every quoted passage must record a `readAt` URL
  (where the agent actually read the text) and that page must contain the
  quote verbatim after whitespace/typography normalisation. The citation
  can name an original book/article plus page while `readAt` points at
  where the text is accessible (Internet Archive, Google Books, a museum
  essay, an open journal). A quote that can't be verified fails the PR;
  the agent drops it rather than keep it unverified. (If a legitimate
  source blocks automated fetching, the builder may add a narrow,
  documented allowance — but never for AI-sourced text.)
- Site builds.

Vercel deploys `main` on merge.

### Feed behaviour

- Each device has its own random path through the shared content library.
- Opening Mona shows a new unseen work immediately (prefetch the next
  couple of cards so scrolling is instant).
- Scrolling continues **through the same artist**. After **10 works**
  (my call; tunable) the reader hits an end-of-artist screen summarising
  what they saw. From there:
  - tap to keep going with this artist (more curated works, then archive
    works by them), or
  - **pull past a stretchy resistance point** to move to a new artist.
    Moving on is a deliberate act, never the side-effect of scrolling.
- New artists are chosen to vary period/movement from the last one.
  Unseen curated artists come first. Once those run out, new artists come
  from the archive layer (my call): candidates come from the museum APIs
  (artists with enough open-access works in scope), with period and
  movement from Wikidata. So for most of Mona's life, many cards will be
  archive cards, and each archive card has a "research this" button.
- Never show a work already in this device's history unless the reader
  navigates to it.
- From any card: "more by this artist" (always one tap), peers/movement,
  and tags all open their own feeds.

### Collection, history, sharing

- Stored on the device (IndexedDB/localStorage). No accounts. An export
  (and import) button guards against losing a phone or clearing Safari.
- Collection and history entries store ids and reopen the card's
  **current** version (my call), so a corrected or removed quote doesn't
  persist on a phone. When an archive card has since been curated, the
  curated version opens.
- Every work has a stable public URL. Curated cards are static pages;
  archive cards resolve by source + id. Opening a shared link doesn't
  alter the recipient's feed or history unless they collect it.

### Content model (sketch — builder finalises)

- **Artist:** id, name, life dates, active years, movements, peers
  (artist ids), Wikidata id, short cited bio passages.
- **Work:** id, artist id, title, date, medium, dimensions, holding
  museum + URL, image (URL, licence, credit), period/phase in the
  artist's career, tags (with optional highlight passage), three sections
  each a list of passages.
- **Passage:** kind (`quote` | `ai`), text, and for quotes: author, work
  title, publisher/site, year, page if any, `readAt` URL, tier (1–7),
  accessed date.
- **Tag:** id, kind (technique | material | style | movement), name,
  explanation passages.
- **Coverage:** periods/movements and their curated counts, to steer the
  daily routine.

## First deployment

- Site live on Vercel, installable on the phone, curated + archive layers
  working, collection/history/share working.
- Seed content produced through the same pipeline and merge gate, broad
  rather than linear: my call, ~5 artists from distinct periods (e.g.
  Northern Renaissance, Italian Baroque, Dutch Golden Age, Romanticism,
  Impressionism), ~10 works each where open-licensed images exist.
- Daily Claude routine scheduled; local worker installed and verified
  end-to-end with one real request.
- Public repo `AndreAlfred/mona` with a README explaining the layers and
  how to run the worker.

## Left to the builder

Framework and libraries; typefaces within the editorial-serif brief;
exact museum APIs used for the archive layer and their filtering; content
file format and layout; how the end-of-artist friction feels in detail;
caching/prefetch strategy; the passphrase mechanism; worker
implementation details and PR auto-merge mechanics; seed artist choices
within the broad-first principle.
