# Project: H Evidence AI SLR Tool (Prototype) — Complete Build Spec

This file is the entire specification. You should not need to open any
external link to understand what to build — every operative detail is
written out below. The reference repository links are included only so you
can inspect real code if you want extra confidence on a specific mechanism;
if a link is unreachable, proceed from the description here instead of
stalling.

---

## 0. Cost Discipline — read this before writing any model-calling code

The client will test this app repeatedly before ever sharing it with their
own client. That testing must cost nothing per run.

- **Every model call in this app goes through Ollama by default, full
  stop.** Do not call the Claude API anywhere during build or testing.
- Build one thin model-provider function that every feature calls through —
  e.g. `callModel(messages, options)` — rather than hardcoding a model
  endpoint inside each feature. This function reads a `MODEL_PROVIDER`
  environment variable (`ollama` or `claude`) and routes accordingly.
  Swapping providers later must be changing that one variable, not editing
  code in multiple places.
- Do not add an Anthropic API key, billing, or any live Claude call anywhere
  until you are explicitly told the client is moving to the sharing/demo
  stage with their client.
- Known quality risk to watch for: the screening/calibration logic (Section
  4.1) and report-generation logic (Section 4.4) below were originally
  designed and tuned against Claude's models. Running them against a local
  Ollama model may produce weaker structured-JSON reliability and lower
  compliance accuracy. Use a capable local model — `qwen2.5:14b` or larger
  if the machine/VPS has the RAM for it; 7B/8B-class models are more likely
  to struggle specifically on the structured-output-heavy steps (screening
  JSON, extraction JSON, PRISMA checklist audit). Flag any malformed or
  low-quality output you observe during testing rather than silently
  accepting it.

---

## 1. What This App Is

A single Next.js web app, hosted at a public URL (no login), that runs a
4-step workflow per systematic literature review (SLR) project:

**Search → Screen → Extract → Report**

It pulls real papers from free academic sources, screens them with AI plus
human-in-the-loop review, extracts structured data from full-text PDFs
using a side-by-side PDF-and-spreadsheet interface, and generates a
PRISMA-2020-compliant Word manuscript at the end. It is branded for H
Evidence (dark blue / light blue theme, their logo).

## 2. What The Finished Prototype Must Do (user-facing capabilities)

- Import/generate a set of candidate papers by running an AI-generated
  search strategy against PubMed, Europe PMC, and OpenAlex — not just
  producing search strings for a human to run elsewhere; the app performs
  the retrieval itself.
- Automatically remove duplicate records across the combined result set.
- Screen titles/abstracts against reviewer-defined inclusion/exclusion
  criteria, using two independent AI passes with an agreement score, and
  let a human resolve anything flagged.
- Improve its own screening accuracy over a session as the human corrects
  it (active-learning calibration — details in 4.1).
- Let a reviewer upload full-text PDFs plus an Excel/CSV "coding form" of
  extraction questions, and extract answers per PDF with the exact source
  text and page number shown alongside the original PDF for verification.
- Optionally run a broader web-research pass, both as an early sanity check
  ("has this review already been done?") and as narrative material for the
  report's background/discussion sections.
- Generate a complete PRISMA-2020 manuscript (.docx) at the end, with an
  accurate flow diagram built from the app's own real counts, not manually
  re-entered numbers.
- Keep AI output as suggestions only — a human decision is always what's
  treated as final, at every step.
- Be usable by multiple people at once via a shared link (no login),
  since it's a prototype meant to be tested repeatedly and eventually
  demoed to the client's own client.

## 3. Architecture Overview

| Layer | Detail |
|---|---|
| Framework | Next.js, App Router |
| Hosting | Vercel (client's existing Vercel Pro subscription), public URL, no login/auth gate |
| Model calls | All routed through one `callModel()` function; defaults to a self-hosted Ollama instance; Claude API supported by the same function but disabled until explicitly switched on |
| Ollama, local dev | Runs on the developer's own machine at `http://localhost:11434`, OpenAI-compatible endpoint at `/v1/chat/completions` |
| Ollama, production | Runs on a separate, small, always-on VPS (Vercel's serverless functions cannot run Ollama — it needs a persistent process). The Vercel app calls this VPS over HTTPS, with a shared-secret header so the inference endpoint isn't openly callable by anyone who finds the VPS address, even though the *app itself* has no login. |
| Search data sources | PubMed (E-utilities API, free, no key needed under ~3 requests/sec), Europe PMC (REST API, free, no key), OpenAlex (REST API, free, no key). No paid sources (Embase, Scopus, Web of Science) in this phase. |
| Persistence | A lightweight hosted database (Vercel Postgres or Neon — both have usable free tiers) so a project's state (search results, screening decisions, extraction table, report) survives across sessions and across the multiple people using the shared link. |
| Branding | CSS theme tokens `--color-primary` (dark blue) and `--color-secondary` (light blue) — placeholder hex values until the client supplies exact brand colors and logo; keep them centralized in one theme file so they're a one-place swap. |

---

## 4. Functional Components — full detail

### 4.1 Search, Retrieval, Screening & Calibration Engine

Reference implementation for inspiration: `https://github.com/AngelChen-HC/systematic-review-skill`
(this is a Claude Skill — an instruction set meant to run inside Claude, not
a library you `npm install`; port its approach into your own server-side
functions rather than trying to execute it directly).

Build the following:

1. **PICO-structured search generation.** Given a plain-language research
   question, generate a PICO-structured search concept (Population,
   Intervention, Comparator, Outcome) via `callModel()`.
2. **Per-source query translation.** Translate that PICO concept into the
   correct *native* query syntax for each source separately — do not reuse
   one query string across all three, they are not interchangeable:
   - **PubMed:** E-utilities syntax, e.g. field tags like `[tiab]`
     (title/abstract) and `[mesh]` (MeSH term), combined with `esearch`
     then `efetch`.
   - **Europe PMC:** its own REST query syntax (different from PubMed's).
   - **OpenAlex:** REST API `filter=` query syntax (different again).
3. **Real retrieval**, not just string generation: actually call all three
   APIs and pull back the candidate record sets.
4. **Deduplication:** merge the three result sets — DOI exact match first,
   then fuzzy title-similarity matching for anything without a DOI match.
5. **Dual AI screening:** for each deduplicated record's title/abstract,
   run two independent screening passes against the reviewer's
   inclusion/exclusion criteria, each producing Include / Exclude /
   Flag-for-review. Compute Cohen's Kappa agreement between the two passes.
   Anything disagreeing or flagged goes to a human reviewer queue.
6. **Active-learning calibration:** every time a human overrides an AI
   screening decision, store that correction. Periodically (e.g. every N
   corrections, or every new batch) select the most informative recent
   corrections and inject them back into the screening prompt as few-shot
   examples for subsequent batches, so accuracy improves as the reviewer
   works. Log each calibration update with a timestamp.
7. **Audit trail:** log every search run, every screening decision, and
   every calibration update, in order, so the process is reconstructable
   later (a simple append-only log table is sufficient for the prototype;
   a tamper-evident hash chain is a nice-to-have, not required for this
   phase).
8. **Optional "Quick Scope" hook:** before running the full search, offer
   a button that instead runs the broad-research agent (Section 4.3) to
   quickly check whether a review on this exact topic already exists.

### 4.2 Extraction (rebuild this exact UX)

Reference for the interaction pattern: `https://github.com/noah-schroeder/AIDE`
(an R Shiny app — rebuild the *behavior* below in this Next.js app; do not
try to port R code).

Exact behavior to replicate:

1. **Model endpoint setup:** the extraction step calls whatever endpoint
   `callModel()` currently points to (Ollama locally/on the VPS by
   default). No API key required for Ollama. If/when Claude is enabled
   later, its key is read server-side only, never exposed to the browser.
2. **Coding form upload:** the reviewer uploads an Excel or CSV file where
   **row 1 = the extraction prompts** (these become column headers) — e.g.
   "Study Authors", "Sample Size", "Intervention Type", "Effect Size".
   Subsequent rows will hold one row of extracted answers per PDF
   processed. Show the parsed prompts back to the reviewer for
   confirmation before starting extraction.
3. **Prompt-quality guidance in the UI itself:**
   - Good prompt examples: "What is the total sample size of the study?",
     "List all authors of this study, separated by commas."
   - Poor prompt examples to warn against: "Authors" (too vague), "Number"
     (ambiguous).
   - Every prompt sent to the model should explicitly instruct: "If not
     found, respond with 'Not reported'" — this avoids the model
     fabricating an answer when the information isn't present.
4. **Two PDF processing modes**, selectable per document:
   - **Send PDF file:** sends the complete PDF (preserves images, tables,
     formatting) — slower, more tokens, best when visual elements matter.
   - **Send text only:** extracts text first (e.g. via `pdf.js` or similar)
     and sends only that — faster, fewer tokens, best for text-heavy
     documents without important figures/tables.
5. **One API call per PDF, containing all of that project's prompts at
   once** (not one call per prompt per PDF). The model must return
   structured JSON in this exact shape:
   ```json
   {
     "responses": [
       {
         "prompt": "What is the sample size?",
         "response": "N = 150",
         "source": "A total of 150 participants were recruited...",
         "page": "3"
       }
     ]
   }
   ```
6. **Side-by-side review UI:** the PDF viewer pane and the coding-form
   grid pane are shown together. Selecting a response highlights/jumps to
   the exact `source` text at the given `page` inside the PDF pane, so the
   reviewer can verify the extraction against the original document
   without hunting for it.
7. **Human edit + record:** the reviewer can edit any response before
   accepting it. A "Record" action commits that PDF's row into the coding
   form. "Next PDF" advances to the next document in the project queue.
8. **Export:** "Download Form" exports the completed coding form as an
   Excel file; "View Form" shows the accumulated table in-app.
9. **No third-party storage:** PDFs and extracted data are only ever sent
   to the currently configured model endpoint (Ollama or Claude) — never
   to any other third-party service.

### 4.3 Broad Research & Narrative Drafting (optional, on by default)

Reference: `https://github.com/assafelovic/gpt-researcher` — a
general-purpose, multi-agent web research tool (a planner agent breaks a
question into sub-questions, execution agents crawl and aggregate many web
sources, and it compiles a citation-backed report). It is not
database-specific and not PRISMA-compliant on its own — it supplements
Sections 4.1/4.4, it does not replace them.

Two uses in this app:

1. **Quick Scope** (called from Section 4.1, step 8): before running the
   full multi-database search, quickly check whether a review on this
   topic has already been published, and surface that to the reviewer as
   an early signal.
2. **Narrative drafting** (called after extraction is complete): generate
   supporting background/discussion prose with citations on the review's
   topic, which the report step (4.4) can draw on for its narrative
   sections.

Give each project a toggle to turn this component off entirely if not
wanted for that review.

### 4.4 Report Generation

Reference implementation for inspiration: `https://github.com/keemanxp/slr-prisma`
(also a Claude Skill, MIT licensed — port its approach, don't try to
execute it directly).

Build the following, run once screening (4.1) and extraction (4.2) are
complete (and narrative drafting, 4.3, if enabled):

1. Compile a single manuscript with these sections, in this order: **Title
   Page, Abstract, Introduction, Methods, Results, Discussion,
   Conclusions, References.**
2. **Auto-generate and embed an annotated PRISMA flow diagram**, populated
   entirely from the app's own real numbers (records identified per
   source, duplicates removed, records screened, records excluded with
   reasons, records included) — never prompt the reviewer to manually
   re-enter counts that the app already knows.
3. **References in APA 7th-edition format**, and verify they correspond to
   real sources actually used in the review — do not fabricate citations.
4. **Run a 27-item PRISMA 2020 checklist audit** against the compiled
   manuscript and flag any item that isn't clearly addressed, rather than
   silently omitting it.
5. **Output as a downloadable .docx file** — use the same Node-based docx
   generation approach already used elsewhere in this project (the `docx`
   npm package), not a PDF or plain text file.

### 4.5 Branded Application Shell

This is the Next.js app itself, tying 4.1–4.4 together:

- A project sidebar listing all projects (the link is open/multi-user, so
  people need to find their own project or start a new one).
- A 4-step wizard per project: **Search → Screen → Extract → Report**,
  matching Sections 4.1–4.4 in that order.
- Dark blue / light blue theme (Section 3), H Evidence logo once supplied.
- General shape/inspiration only (not copied wholesale) for the
  import/dedup/workspace pattern and the "AI suggestion vs. human final
  decision" separation: `https://github.com/sadeghanisi/SLR`.
- Optional later inspiration for a project dashboard (cross-reference
  matrix, gap-analysis views), once the core 4-step flow works:
  `https://github.com/ErenDexter/ResearchQ` (alpha-quality software — do
  not depend on its code directly, look at it for UI ideas only).

### 4.6 Tools referenced but explicitly NOT integrated into the app's code

- **Consensus.app** (`https://consensus.app`) — a commercial, closed-source
  academic search engine (AI paper summaries + a "Consensus Meter" showing
  what percentage of studies agree/disagree on a yes/no question). It has
  **no confirmed public API**. Do not attempt to call it from code. It can
  be mentioned to reviewers as an external tool they might open separately
  for a fast sanity check — nothing more than a text mention/link in the
  UI, if that.
- **ASReview** (`https://github.com/asreview/asreview`) — a separate,
  peer-reviewed (published in Nature Machine Intelligence) active-learning
  screening engine. Section 4.1 already implements its own active-learning
  calibration loop — do not build a second, parallel active-learning
  system. If Section 4.1's calibration quality looks weak during testing,
  consult ASReview's published methodology to improve it, rather than
  integrating ASReview itself as a second engine.

---

## 5. Build Order — work through these 9 phases in sequence

Stop and report back after each phase, with something you actually ran and
verified working, before starting the next one. Do not skip or combine
phases.

1. **Scaffold.** `create-next-app` (App Router), Tailwind with the theme
   tokens from Section 3, the 4-step wizard layout, and a project sidebar.
   No API integrations yet.
2. **Search & Retrieval** (Section 4.1, steps 1–4, plus the Quick Scope
   hook from step 8 using Section 4.3). Result: a deduplicated list of
   candidate papers in the UI, exportable as CSV.
3. **Screening & Calibration** (Section 4.1, steps 5–7). Result: a
   screened set of Include/Exclude/Flagged records with visible Cohen's
   Kappa agreement, and a working correction → calibration loop.
4. **Extraction** (Section 4.2, all steps). Result: a working side-by-side
   PDF + coding-form interface producing a downloadable completed Excel
   file from at least one real test PDF.
5. **Narrative Drafting** (Section 4.3, step 2). Result: a narrative
   background/discussion draft generated from a completed extraction,
   toggleable per project.
6. **Report Generation** (Section 4.4, all steps). Result: a downloadable
   .docx manuscript with a flow diagram built from real Phase 2/3 counts.
7. **Persistence.** Add the hosted database (Section 3) and move all state
   from Phases 2–6 out of memory/session-only storage into it, so
   projects survive across sessions and across concurrent users.
8. **Wire together.** Confirm one project record in the database carries
   state correctly across all 4 workflow steps end to end, and that
   opening the shared link lets someone start a new project or resume an
   existing one.
9. **Deploy.** Push to Vercel. Provision the Ollama VPS if not already
   done, confirm the Vercel app can reach it over HTTPS with the
   shared-secret header, and run one complete real pass — a small real
   PubMed topic, a few dozen results, all the way through to a downloaded
   report — before considering this phase done.

---

## 6. Explicitly Out of Scope for This Phase

- Paid database APIs (Embase, Scopus, Web of Science) — free sources only
  (PubMed, Europe PMC, OpenAlex), per Section 3.
- Login/auth of any kind — the app stays open-link, no login, per Section 3.

Everything else described in this document is in scope for this build.

---

## 7. When You're Unsure

Stop and ask rather than guessing on: exact brand hex codes/logo file,
which VPS provider or Ollama model size to use, the domain name for the
Vercel deployment, or anything that would require re-architecting a phase
you've already built and reported as done.

---

## 8. Data Handling Note

PDFs and extracted data should only ever be sent to the currently
configured model endpoint (Ollama locally/on the VPS, or Claude once
enabled) — never to any other third-party service. Since the app has no
login, remind whoever is testing it not to put confidential/real client
data into the shared link until access control is revisited (this is
already flagged to the client separately; it is not something to solve in
code during this phase).
