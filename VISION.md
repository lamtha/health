# Vision

> Status: **v0.2 — distribution scope added 2026-04-18.**

## Mission

Build a local-first personal health dashboard that unifies years of fragmented lab, imaging, and clinical reports into a single queryable, chartable view — so that long-run trends and cross-provider signals become easy to see and easy to explore.

## Who it's for

- **Primary user:** Paul — the first user; also the person building and maintaining the app.
- **Distribution target (post-MVP):** other individuals on macOS — friends and family first, with a path to a broader public beta if it takes off. Each install is its own single-user local-first instance: every user owns their own SQLite DB, their own uploaded PDFs, and provides their own Anthropic API key. This repo is a distributable desktop app, not a SaaS.
- **Clinician handoff:** a core requirement — every user needs to be able to export a report (PDF/CSV) to share with their doctor.

## What problem we're solving

Health data today is scattered:
- Each provider (Quest, LabCorp, Lifeforce, Function Health, Viome, GI-MAP, Genova, …) has its own PDF format.
- The same metric (e.g. WBC) appears under different names and different reference ranges across providers.
- There is no way to see *one metric over time, across all providers*, or to correlate GI-map shifts against blood-panel shifts, or against interventions.

This app collapses that fragmentation.

## Success criteria

### MVP (Phases 0–3)
- Every existing **blood panel** and **GI/microbiome** PDF in the source archive is parsed and ingested.
- I can pick any numeric metric (e.g. WBC, hsCRP, Akkermansia) and see a time-series chart across all providers.
- I can drop a new PDF into the upload UI and it appears in the DB and charts within a minute.
- I run the whole thing locally with one command.

### Long-term (post-MVP)
- Cross-category exploration: blood vs GI vs symptoms vs interventions on a shared timeline.
- DNA / genomics overlay once the 100x sequence arrives (variants of interest, gene–metric links).
- Annotation: I can mark interventions (diet change, supplement, travel, illness) as events on the timeline.
- **Clinician export** — produce a clean PDF/CSV I can hand to a doctor (curated metrics, trend charts, date range).
- Natural-language queries against the dataset.
- **Installable by non-developer Mac users** — download a signed DMG, open, enter their own Anthropic API key, start ingesting. No terminal, no `pnpm`, no `.env`.

## Non-goals

- No authentication, no multi-tenant, no cloud hosting of user data. Each install is its own single-user instance; there is no shared server.
- No mobile app. (Desktop distribution — macOS first, Windows contributor-built later — is post-MVP.)
- No clinical recommendations — this is an exploration tool, not a diagnostic or prescriptive one.
- No FHIR / insurance / EMR integration.
- No automatic anomaly detection or alerting (visual exploration only).

## Guiding principles

1. **MVP end-to-end first** — a thin slice across parsing → storage → UI before deepening any layer.
2. **Local-first** — health data never leaves the installing user's machine except for Claude API calls (extraction), which go directly to Anthropic using that user's own API key. No intermediary service ever sees the data. Extraction calls are logged locally so they're auditable.
3. **Read-only source of truth** — `~/Documents/health/reports/paul/` is canonical and never mutated by the app.
4. **Keep extraction replayable** — store raw Claude output alongside parsed metrics so we can re-parse without re-spending API calls.
5. **Data model is additive** — new providers, new categories, DNA all slot in without migration pain.

## Open questions

- (none blocking — core scope resolved 2026-04-17)

## Resolved decisions

- **Single-user per install**; this repo is the distributable desktop app, not a SaaS. Multi-tenant cloud hosting stays out of scope.
- **Clinician export** is in scope (long-term / Phase 4).
- **Interventions** ship in Phase 4, not MVP.
- **Re-parsing** appends a new `Extraction` row rather than overwriting.
- **Distribution** — macOS first (Apple Silicon, Paul's target), Windows contributor-built later. Electron wrapping the existing Next.js app. F&F signed DMG precedes any public beta. (Decided 2026-04-18.)
