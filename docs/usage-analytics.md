# Usage recording and user-centred improvement (UI 0.5)

The public companion and native GUI share a content-free event contract. Recording starts only after explicit visitor opt-in. Declining recording does not restrict analysis. Consent settings, pending count, stop, deletion and optional structured usability feedback are available below the workspace. There is no recording before opt-in, DOM replay, screen recording, automatic text/URL capture, fingerprinting, account identity in usage records or third-party analytics SDK.

## Instrumentation inventory

`telemetry/controls.json` identifies all 85 authored visitor-control definitions, including interactive SVGs. Repeated controls (residues, intervals, descriptor detail buttons) reuse their authored control ID; scientific content is never used as a control label. `data-ux` is stable across UI states. New controls must be explicitly registered, and coverage checks reject unregistered controls. Administrator controls are excluded from visitor recording.

Delegated events record activation attempts, disabled-control attempts, input-presence changes, focus/blur duration, sustained hover, summary open/close and settled scroll direction. Semantic events record analysis start/completion/failure/cancellation, imports, output requests/generation/errors, screens, selections, viewports, track counts, filter result counts, annotation availability, active view time, transport counters and voluntary task/difficulty/completion ratings. Generic activation is an attempt, not evidence of success. Hover/focus/scroll are observations, not proof of reading or frustration.

`telemetry/contract.json` is the runtime allowlist. `event.schema.json` and `openapi.json` document the exchange protocol. After changing the contract, run `python telemetry/schema.py`; after adding controls, register IDs and run `python telemetry/instrument.py`. Copy the contract into the native `usage-contract.json` and frontend `ux-contract.json`. Shared tests check control coverage and forbidden properties. The UI version and event version are required on every event; breaking versions need a decoder/migration before accepting old events.

## Recorded context and excluded content

An event contains a random event UUID, random logical-session UUID, sequence number, timestamp, UI/schema version, event/target and typed allowlisted properties. Context includes screen, JA/EN, input method, width category, browser/native execution, input mode, coarse length category, whether a cleavage is known, selection context/width, filter categories/result counts and bounded latency. Stream IDs link consenting activity for up to 30 days and are pseudonymous, not a promise of anonymity.

Never record precursor/SP sequences, residues, sequence hashes, protein names, accessions, organisms, uploaded filenames, search text, exact coordinates, metric values, DOM text/images, URLs, query strings, error messages/stacks, request/response bodies from the scientific API, IP addresses or email in the usage dataset. Application errors use fixed categories. Server validators reject unknown fields and arbitrary strings before any batch is stored. Error responses contain fixed codes, not submitted content. Hosting infrastructure may have separate standard access logs; application collection does not copy them into usage records.

## Transport and retention

The browser queues at most 200 sanitized events in IndexedDB, sends batches of at most 30 to a same-origin endpoint, retries with bounded backoff and removes acknowledged IDs. Retries are deduplicated by event UUID. Queued events older than 24 hours or from an unsupported UI contract are dropped and counted; storage failures fall back to the in-memory queue. There is no claim of lossless recording on abrupt browser shutdown or cleared storage. Clock skew outside the acceptance window can reject events.

Stream creation records opt-in contract version 1 and a hashed 256-bit deletion credential. Public writes require same origin and the stream credential; batches are bounded to 24 KiB, 30 events and 5,000 records per stream/day, with additional process-local request throttling. This throttling is best effort per Worker isolate, not a distributed abuse prevention system. Public reads authorize the server-provided Sites owner identity against a runtime allowlist. The native backend remains restricted to trusted loopback hosts and same-origin requests; its administrator report is local-only.

Stop disables new collection and clears unsent records. Delete revokes the stream and removes its individual records, including pending writes that arrive after revocation. Unlinked daily aggregates remain. The deletion credential stays local and is never stored in event rows. If browser storage is cleared, prior credentials cannot be recovered. Expired stream credentials cannot write or read events.

Queries exclude expired individual records. Raw retention is 30 days, aggregate retention 180 days. Physical pruning runs when streams are registered or reports read; it is access-triggered, not an installed daily scheduler. A dedicated maintenance trigger is a future operational addition before promising deletion on an exact calendar deadline. Local storage defaults to `~/.local/share/sp-features/usage.db`; `SP_USAGE_DB` overrides it, and `SP_USAGE_DISABLED=1` disables collection.

## Storage and administrator report

Public: Sites-provisioned D1 binding `DB`, with schema-only migration `drizzle/0000_usage.sql`. Native: SQLite with the identical tables/aggregation trigger. Ingestion, duplicate suppression and daily-count updates share a transaction; a retry cannot increment aggregate counts twice. Individual deletion does not undo already unlinked aggregates.

`/admin` shows 7/30-day counts, daily UI/screen/width/modality/outcome segmentation, control use, median/p95 duration, event transitions, voluntary feedback and bounded session timelines. Timings use the latest 5,000 duration events; reports cap daily rows at 2,000, control rows at 200, sessions/feedback at 100 and a timeline at 500. Limits are disclosed in the UI. JSON export supports deeper local analysis. Raw events and aggregate counts can differ after individual deletion.

LCP observations and Event Timing latency are limited browser observations, not a full Web Vitals evaluation. `event_latency` is not labelled as official INP. No session task success or dropout rate is inferred from raw counts. Export generation and print requests do not prove a file was saved or a PDF was created. Structured task completion is self-reported; other task progress remains observational.

## Improvement cycle

1. Review input → analysis → exploration → provenance → export paths, grouped by UI version and device width.
2. Identify repeated actions, zero-result searches, failures, slow steps and unsuccessful feedback as candidates.
3. Record observed evidence, a causal hypothesis, the proposed change and its validation criterion in a GitHub issue/PR.
4. Re-run control/privacy/browser regressions and compare equivalent cohorts after publication.
5. Supplement logs with researcher task tests: inspect +1, aggregate an interval, inspect a source, save and restore. Logs cannot explain intent by themselves; opt-in populations may differ from nonparticipants.

## Validation and boundaries

`npm --prefix frontend run test:usage` checks allowlisting, every authored control, public stream/owner authorization, same-origin rejection, atomic malformed-batch rejection, retry deduplication, aggregate counts, timeline, revocation and retention. Python tests exercise the native API. CI Chromium tests cover opt-in, absence of pre-consent records, content-free payloads, deletion and the administrator route alongside the existing analysis/export/mobile checks.

The scientific calculation and public TSignal connection are unchanged. This release implements first-party recording, storage, reports and the exchange contract; PostHog/OpenTelemetry adapters, full screen replay, daily scheduling and randomized design experiments are not deployed. Local browser visual review is unavailable in the managed development environment; CI interaction checks target the native backend.
