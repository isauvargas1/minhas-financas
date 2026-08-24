---
name: financial-domain-integrity
description: Validate financial-domain correctness, integrity, and test coverage using repository evidence. Use whenever a task creates, changes, fixes, approves, or reviews transactions, goals, cards, investments, reports, allocations, billing, monetary calculations, financial events, balances, projections, migrations, or PF/PJ behavior in frontend, backend, persistence, jobs, APIs, or tests.
---

# Financial Domain Integrity

Act as a blocking domain-integrity gate. Inspect the actual implementation, callers, persisted data, migrations, and tests; never approve from a description alone.

## Workflow

1. Read [integrity-checklist.md](references/integrity-checklist.md) completely.
2. Map every affected write, event, calculation, aggregate, projection, report, migration, and read model back to its official source of truth.
3. Classify each financial movement before reviewing arithmetic: consumption expense, income, contribution, principal redemption, realized yield, unrealized appreciation, fee, transfer, refund, reversal, or other explicit domain type.
4. Trace amount, currency, persisted dates, identity, PF/PJ context, idempotency key, event identity, status, reversal linkage, and audit metadata across all affected layers.
5. Evaluate every applicable checklist item with repository evidence. Exercise duplicate delivery, retry after partial failure, concurrent operations, stale writes, cancellation/reversal, and legacy data.
6. If implementation is requested, correct every failure and add the required tests. If only review or diagnosis is requested, remain read-only and report the necessary remediation.
7. Run relevant unit, integration, Emulator, migration, and reconciliation checks. Report unavailable infrastructure as a verification gap.

## Decision policy

- Return `FAIL` for any applicable invariant violation, double counting, unreconstructible total, irreconcilable report, lossy money representation, destructive financial-history deletion, unsafe retry/concurrency behavior, ambiguous PF/PJ behavior, incompatible migration, or missing required test.
- Treat missing evidence as `FAIL`, not `N/A`. Use `N/A` only when code evidence proves the item cannot apply to the changed paths.
- Require creation, editing, cancellation/reversal, and retry tests for every financial change. Require concurrency tests whenever overlapping execution, duplicate delivery, read-modify-write, balance/limit updates, aggregation, or asynchronous processing is possible.
- Do not accept TODOs, manual safeguards, UI-only validation, or eventual cleanup as substitutes for integrity.
- Return `PASS` only when all applicable checks pass with evidence from the current repository and relevant verification.

## Required output

Start with exactly `PASS — Financial domain integrity` or `FAIL — Financial domain integrity`.

Then provide:

- **Scope:** affected domain flows, storage, calculations, reports, migrations, and PF/PJ paths.
- **Movement semantics:** classification and accounting effect of each affected movement on cash flow, assets, income, expense, principal, realized yield, and appreciation.
- **Evidence matrix:** one row per checklist section with `PASS`, `FAIL`, or `N/A`, plus clickable file/line references or command/test output.
- **Reconciliation:** official sources, reconstruction formula, double-counting controls, and report/aggregate comparison.
- **Retry and concurrency:** idempotency boundaries, replay outcomes, race scenarios, and protections.
- **Blocking findings:** invariant, failure scenario, impact, and required remediation for every failure; omit only on `PASS`.
- **Verification:** commands and tests run, explicitly covering creation, editing, cancellation/reversal, retry, concurrency when applicable, and legacy migration behavior.

Do not infer financial semantics from labels or UI placement. State assumptions and unresolved ambiguities as failures when they prevent a safe conclusion.
