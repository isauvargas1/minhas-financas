# Financial Domain Integrity Checklist

Evaluate every item against code and tests. Preserve domain distinctions through persistence, calculations, projections, reports, exports, and migrations.

## Representation and time

- Represent money exactly with one documented, consistent policy across boundaries, such as integer minor units or an exact decimal type. Define currency, scale, rounding mode, conversion points, sign convention, overflow limits, serialization, and validation.
- Reject binary floating-point arithmetic for authoritative monetary values and totals.
- Persist dates as `Timestamp`; define timezone and period-boundary behavior. Convert to display formats only at system edges.

## Financial semantics

- Treat a contribution as an asset allocation or transfer, not a consumption expense.
- Treat redemption of principal as asset conversion or return of capital, not income.
- Keep cash flow separate from net worth/asset position.
- Keep realized yield separate from unrealized appreciation; define when each becomes recognized.
- Model fees, taxes, refunds, chargebacks, transfers, and reversals explicitly when applicable.
- Prevent double counting between source movements, card invoices, transfers, investment operations, derived entries, aggregates, and reports.
- Define PF and PJ behavior explicitly. Verify ownership, category/accounting semantics, currencies, tax/reporting boundaries, permissions, and aggregation rules; never silently merge or assume equivalence.

## Critical operations and events

- Make critical operations idempotent at the authoritative write boundary with a stable business key, atomic deduplication, and a deterministic repeated result.
- Make events retry-safe: persist event identity, tolerate duplicate and out-of-order delivery, resume after partial failure, and avoid duplicating side effects.
- Protect concurrent updates with transactions, compare-and-set/version checks, uniqueness constraints, atomic increments only when semantically correct, or another evidenced mechanism.
- Test races involving balance, limits, invoice closure/payment, allocation, redemption, goal progress, aggregates, and projections when those paths are affected.

## History and auditability

- Preserve append-only or otherwise immutable financial history. Cancel, reverse, refund, or adjust with linked compensating records instead of deleting or overwriting historical facts.
- Record actor/service, tenant and PF/PJ context, operation/event identity, timestamps, reason, before/after or sufficient reconstruction data, correlation, and reversal linkage.
- Restrict mutable fields and state transitions. Ensure an edit does not erase the original financial meaning or audit trail.

## Sources, totals, projections, and reports

- Name the official source of truth for each total and derived figure.
- Make totals reconstructible from official source records using documented inclusion, exclusion, sign, currency, time-window, status, and rounding rules.
- Make projections fully recalculable from stored inputs, assumptions, algorithm/version, and effective dates; do not rely on an opaque accumulated value.
- Reconcile reports with official sources and independent reconstruction. Cover period boundaries, pending/settled/cancelled/reversed states, cards, investments, allocations, billing, and PF/PJ separation.
- Detect drift between cached/materialized aggregates and source records; define safe rebuild/backfill behavior.

## Legacy compatibility and migration

- Inventory legacy shapes, missing fields, old units/precision, date formats, statuses, and ambiguous PF/PJ ownership before changing reads or writes.
- Use backward-compatible readers or a verified migration/backfill. Make migration restartable, idempotent, observable, and safe under concurrent live writes.
- Reconcile record counts and monetary totals before and after migration by currency, period, status, and PF/PJ context.
- Define rollback or forward-repair behavior without deleting financial history.

## Mandatory tests

For every financial change, require tests for:

1. creation, including exact amounts, classification, timestamps, audit fields, and derived effects;
2. editing through valid state transitions, including preserved history and recalculated derivatives;
3. cancellation or reversal, including linkage, compensating effects, and repeated reversal attempts;
4. retry or duplicate delivery, including partial-failure recovery and proof of one logical effect; and
5. concurrency whenever applicable, using simultaneous or deterministic interleaved execution that proves no lost update, duplicate effect, invalid state, or aggregate drift.

Also test boundary rounding, negative/zero/maximum values, timezone and period cutoffs, realized versus unrealized results, contribution/redemption semantics, reconciliation, and representative legacy PF and PJ records whenever affected. Assert persisted records and official totals, not only UI output or mocked calls.
