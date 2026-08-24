# Firestore review checklist

Apply every item to each affected path. Cite the exact implementation, rules, index definition, and test where relevant.

## Tenant isolation and query bounds

- Require a non-empty `workspaceId` sourced from authenticated/trusted context for every tenant-owned read and write.
- Constrain reads to the workspace in the collection path or query predicate, and enforce the same boundary in Firestore Security Rules or a trusted backend. Detect IDOR/cross-workspace access.
- Reject collection-wide enumeration, client-side workspace filtering, missing selective predicates, and any full collection scan. Treat collection-group queries as global unless explicitly workspace-bounded and rule-safe.
- Require server-side pagination for lists: stable deterministic ordering, a finite `limit`, and a document/value cursor (`startAfter` or equivalent). Reject offset pagination and fetching all rows before slicing.

## Indexes and query feasibility

- Match equality/range filters and `orderBy` clauses to required single-field and composite indexes. Verify `firestore.indexes.json` or deployed configuration and identify exemptions where useful.
- Confirm cursor fields align with ordering and add a deterministic unique tie-breaker when ordering values may collide.
- Flag query shapes that Firestore cannot serve or that multiply index-entry reads, including multiple range fields and expensive aggregation patterns.

## Reads, listeners, and execution location

- Detect N+1 reads, per-row lookups, sequential document hydration, duplicate subscriptions, and rereads that cache, request scoping, memoization, denormalization, or projections can avoid.
- Justify every realtime listener. Prefer one-shot reads when updates need not be live; verify unsubscribe/lifecycle handling and bounded result sets. Include initial reads and update-driven rereads in cost.
- Reject browser queries that expose excessive data, fetch broad datasets for joins/filtering/aggregation, require privileged access, or should be served by a workspace-scoped backend projection/materialized view.
- Verify aggregates avoid loading all source documents. Prefer Firestore aggregation queries only when their scanned index entries remain bounded and affordable; otherwise maintain tested projections/counters.

## Writes and data model

- Quantify write fan-out, retries, trigger cascades, index amplification, and hotspot risk per logical action. Reject fan-out that grows with tenant history or cardinality without a bounded asynchronous design.
- Reject documents, arrays, maps, logs, counters, or embedded histories that grow without a hard bound. Check document-size, index-entry, write-rate, and hotspot implications; model growing data as bounded/chunked documents or subcollections.
- Use a batch when multiple independent writes must commit atomically; use a transaction when correctness depends on current values or concurrent updates. Verify idempotency and retry safety for functions/jobs.
- Check bulk operations for platform limits, chunking, backpressure, partial failure handling, and resumability.

## Cost and high-volume compatibility

- State formulas and assumptions for reads, writes, deletes, aggregation/index-entry reads, listener reconnects/updates, and triggered/projection writes per action and per relevant time period.
- Evaluate realistic high-volume cardinalities: documents per workspace, active users/listeners, page size, update rate, historical growth, and concurrency. A constant bound must remain safe; “works for current data” fails.
- Account for security-rule dependent reads, transaction retries, offline/reconnect behavior, trigger retries, and index storage/write amplification when applicable.
- Reject designs whose correctness, latency, quota safety, or cost relies on a future optimization, manual cleanup, or undocumented operational discipline.

## Emulator verification

- Require Firebase Emulator tests for changed query shapes, workspace isolation (including cross-workspace denial), rules, pagination boundaries/cursors, empty and maximum page behavior, aggregates/projections, and atomic/concurrent writes as applicable.
- Seed multiple workspaces and enough records to cross at least one page boundary. Assert returned membership/order and read/write side effects, not merely success status.
- Run the relevant Emulator suite. Missing, skipped, or non-runnable required coverage is a failure; report the exact command and output.

## Evidence rules

- Inspect callers and data flow, not only the edited line.
- Cite repository-relative file paths with line numbers for each conclusion. Cite generated output only as supplementary evidence.
- Distinguish measured operation counts from estimates. For estimates, show the formula and named cardinalities.
- If the repository lacks necessary rules, index configuration, schema context, or tests, record that absence as blocking evidence.
