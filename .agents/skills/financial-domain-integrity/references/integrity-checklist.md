# Financial Domain Integrity Checklist

Evaluate every item against code and tests. Preserve domain distinctions through persistence, calculations, projections, reports, exports, and migrations.

## Representation and time

- Represent money exactly with one documented, consistent policy across boundaries, such as integer minor units or an exact decimal type. Define currency, scale, rounding mode, conversion points, sign convention, overflow limits, serialization, and validation.
- Reject binary floating-point arithmetic for authoritative monetary values and totals.
- Persist instants (creation, settlement, audit times) as server `Timestamp`. Persist civil business dates (due date, competence, occurrence date) in the single representation defined in `docs/production/FINANCIAL_DOMAIN_MODEL.md` §3 (target: `YYYY-MM-DD` key in `America/Sao_Paulo`, decision D-17), validated server-side and derived by one shared function; one field and one representation per fact. Mixed representations for the same fact, local-midnight instants, `new Date('YYYY-MM-DD')` parsing, and `toISOString().slice(0, 10)` date keys fail. Define period-boundary behavior. Convert to display formats only at system edges.

## Financial semantics

- Treat a contribution as an asset allocation or transfer, not a consumption expense.
- Treat redemption of principal as asset conversion or return of capital, not income.
- Keep cash flow separate from net worth/asset position.
- Keep realized yield separate from unrealized appreciation; define when each becomes recognized.
- Model fees, taxes, refunds, chargebacks, transfers, and reversals explicitly when applicable.
- Prevent double counting between source movements, card invoices, transfers, investment operations, derived entries, aggregates, and reports.
- Define PF and PJ behavior explicitly. Verify ownership, category/accounting semantics, currencies, tax/reporting boundaries, permissions, and aggregation rules; never silently merge or assume equivalence.

## Authority and atomicity

- Perform every authoritative financial write (balances, principal, limits, invoices, settlements, occurrences, allocations, goal progress, and their events/audit) in a trusted backend entry point that validates identity, workspace membership, role, and a strict input schema. Derive amounts, balances, and statuses on the server from stored state; never persist a client-computed balance or total.
- Deny client writes to authoritative financial collections and fields in Firestore Rules. A collection that the client can write directly is not an authoritative source; a second writer (client plus backend, or two backend paths with different semantics) is a concurrent source of truth and fails.
- Commit composite operations atomically: a movement and every record it affects (e.g., loan movement plus cash transaction, receivable settlement plus income, card purchase plus limit ledger and invoice, recurring occurrence plus its confirmed transaction) must be written in one transaction or an equivalent atomic, idempotent unit. Separate client writes, fire-and-forget follow-ups, or “repair later” jobs fail.
- Route every card-affecting flow (purchases originating from recurring expenses, split bills, imports, or manual entry) through the authoritative credit-card domain; a parallel path that writes card effects fails.
- Never mark a dependent state (paid, settled, processed, confirmed) unless the financial record that justifies it was committed in the same atomic unit.

## Critical operations and events

- Make critical operations idempotent at the authoritative write boundary with a stable business key, atomic deduplication, and a deterministic repeated result.
- Make events retry-safe: persist event identity, tolerate duplicate and out-of-order delivery, resume after partial failure, and avoid duplicating side effects.
- Protect concurrent updates with transactions, compare-and-set/version checks, uniqueness constraints, atomic increments only when semantically correct, or another evidenced mechanism.
- Test races involving balance, limits, invoice closure/payment, allocation, redemption, goal progress, aggregates, and projections when those paths are affected.

## History and auditability

- Preserve append-only or otherwise immutable financial history. Cancel, reverse, refund, or adjust with linked compensating records instead of deleting or overwriting historical facts. Elimination or anonymization mandated by a documented decision (D-07, gated by `privacy-lgpd-data-lifecycle`) is not a history violation only when it is backend-executed, audited, applied to the entire scope the decision defines, and leaves no aggregate inconsistent with the remaining sources; any other deletion fails.
- Record actor/service, tenant and PF/PJ context, operation/event identity, timestamps, reason, before/after or sufficient reconstruction data, correlation, and reversal linkage.
- Restrict mutable fields and state transitions. Ensure an edit does not erase the original financial meaning or audit trail.

## Sources, totals, projections, and reports

- Name the official source of truth for each total and derived figure.
- Make totals reconstructible from official source records using documented inclusion, exclusion, sign, currency, time-window, status, and rounding rules.
- Make projections fully recalculable from stored inputs, assumptions, algorithm/version, and effective dates; do not rely on an opaque accumulated value.
- Reconcile reports with official sources and independent reconstruction. Cover period boundaries, pending/settled/cancelled/reversed states, cards, investments, allocations, billing, and PF/PJ separation.
- Detect drift between cached/materialized aggregates and source records; define safe rebuild/backfill behavior.

## Domain replacement and legacy removal (no real production data)

While the product has no real production data, a replaced domain is not kept alive for development/test data. When a change replaces or alters a domain, schema, persisted shape, unit, field, or write path — declared or evidenced by the diff — verify all of the following; any surviving item fails:

- Inventory the legacy surface before changing it: collections, document shapes, fields, units/precision (e.g., float reais versus integer cents), date formats, statuses, writers (client, callable, trigger, cron, script), readers, adapters, compatibility projections, feature flags, Rules blocks, indexes, and tests.
- Remove every legacy write path: no client or backend code can still create or mutate the old shape. Prove it with repository-wide search evidence (collection names, field names, function names, flags) and with Rules that deny the old writes.
- Remove legacy readers, fallbacks, dual-read/dual-write logic, adapters, compatibility layers, and flags that switch between old and new behavior. The new domain is the single source of truth for every figure it owns.
- Remove Rules blocks, composite indexes, TTL policies, crons, and exported Functions that only served the legacy path, or document why each remaining one serves the new domain.
- Replace legacy tests with tests of the new domain; do not delete coverage without equivalent or stronger replacement. Add a Rules Emulator negative test proving that client writes to every legacy path or field are denied (explicit block or default deny), plus search evidence that no backend code writes them.
- Replace migration of test data with a documented reset/seed procedure (Emulator seeds, fixtures, or a guarded non-production cleanup script). Such scripts must refuse the production project.
- Update documentation that still describes the removed path as current.

## Migration with real data (mandatory once real production data exists)

- Inventory legacy shapes, missing fields, old units/precision, date formats, statuses, and ambiguous PF/PJ ownership before changing reads or writes.
- Use a verified migration/backfill; temporary backward-compatible readers are allowed only with a dated removal milestone. Make migration restartable, idempotent, observable, and safe under concurrent live writes.
- Reconcile record counts and monetary totals before and after migration by currency, period, status, and PF/PJ context.
- Define rollback or forward-repair behavior without deleting financial history.

## Mandatory tests

For every financial change, require tests for:

1. creation, including exact amounts, classification, timestamps, audit fields, and derived effects;
2. editing through valid state transitions, including preserved history and recalculated derivatives;
3. cancellation or reversal, including linkage, compensating effects, and repeated reversal attempts;
4. retry or duplicate delivery, including partial-failure recovery and proof of one logical effect; and
5. concurrency whenever applicable, using simultaneous or deterministic interleaved execution that proves no lost update, duplicate effect, invalid state, or aggregate drift;
6. authority, proving through the Rules Emulator suite that the client cannot write the authoritative records or fields directly; and
7. atomicity of composite operations, proving that a failure injected between component writes leaves no partial effect.

Also test boundary rounding, negative/zero/maximum values, timezone and period cutoffs, realized versus unrealized results, contribution/redemption semantics, reconciliation, and representative PF and PJ records whenever affected. When a domain is replaced, test that the legacy write path is gone or rejected; when real production data exists, test migration against representative legacy PF and PJ records. Assert persisted records and official totals, not only UI output or mocked calls.
