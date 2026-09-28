---
name: financial-domain-integrity
description: Validate financial-domain correctness, integrity, authority, and test coverage using repository evidence. Use whenever a task creates, changes, fixes, approves, or reviews transactions/cash, credit cards, invoices, recurring expenses, split bills, loans, clients/receivables, goals, investments, reports, allocations, SaaS billing amounts persisted or shown in user financial reports, monetary calculations, financial events, balances, projections, reconciliation, migrations or domain replacements, legacy removal, or PF/PJ behavior in frontend, backend, persistence, jobs, APIs, or tests.
---

# Financial Domain Integrity

Act as a blocking domain-integrity gate. Inspect the actual implementation, callers, persisted data shapes, migrations, Rules, and tests; never approve from a description alone.

## Project context

- Master plan and domain model: `docs/production/PRODUCTION_READINESS_PLAN.md` and `docs/production/FINANCIAL_DOMAIN_MODEL.md`. They record targets and gaps; they are not proof of implementation.
- There is **no real production data** (`docs/production/PRODUCTION_READINESS_PLAN.md` §1, "Política de legado"); this exemption ends at the first PROD release with real users, which must be recorded in the plan. Compatibility that exists only to preserve development/test data is not a requirement. When a domain is definitively replaced, this gate verifies that the old write path, schema readers, fallbacks, adapters, feature flags, and concurrent sources of truth were **removed** — see the checklist section “Domain replacement and legacy removal”. Once real production data exists, the “Migration with real data” section applies in full.
- Authoritative financial writes belong to the backend (Cloud Functions with Admin SDK, strict input validation, Firestore transactions). Firestore Rules must deny client writes to authoritative financial records.
- Boundaries: SaaS subscription billing, Stripe, entitlements, and quotas are gated by `billing-entitlement-integrity`; this skill still applies to any monetary amount that billing persists or exposes in user financial reports. Tenant authorization is gated by `multi-tenant-security-review`; query cost and indexes by `firestore-scale-cost-review`.

## Workflow

1. Read [integrity-checklist.md](references/integrity-checklist.md) completely.
2. Map every affected write, event, calculation, aggregate, projection, report, migration, and read model back to its official source of truth. Identify every writer of each source (client, callable, trigger, cron, script) and flag any second writer or second source.
3. Classify each financial movement before reviewing arithmetic: consumption expense, income, contribution, principal redemption, realized yield, unrealized appreciation, fee, transfer, loan principal, loan repayment, receivable settlement, card purchase, invoice payment, refund, reversal, or other explicit domain type.
4. Trace amount, currency, persisted dates, identity, PF/PJ context, idempotency key, event identity, status, reversal linkage, and audit metadata across all affected layers.
5. Evaluate every applicable checklist item with repository evidence. Exercise duplicate delivery, retry after partial failure, concurrent operations, stale writes, cancellation/reversal, and — when a domain is being replaced — the absence of every legacy write/read path.
6. If implementation is requested, correct every failure and add the required tests. If only review or diagnosis is requested, remain read-only and report the necessary remediation.
7. Run relevant unit, integration, Emulator, reconciliation, and (when applicable) migration checks. Report unavailable infrastructure as a verification gap, which blocks `PASS`.

## Decision policy

- Return `FAIL` for any applicable invariant violation, double counting, unreconstructible total, irreconcilable report, lossy money representation, authoritative financial write performed by the client, non-atomic composite operation, destructive financial-history deletion, unsafe retry/concurrency behavior, ambiguous PF/PJ behavior, surviving legacy write path or concurrent source of truth after a declared replacement, unsafe migration of real data, or missing required test.
- Treat missing evidence as `FAIL`, not `N/A`. Use `N/A` only when code evidence proves the item cannot apply to the changed paths.
- Require creation, editing, cancellation/reversal, and retry tests for every financial change. Require concurrency tests whenever overlapping execution, duplicate delivery, read-modify-write, balance/limit updates, aggregation, or asynchronous processing is possible.
- Do not accept TODOs, manual safeguards, UI-only validation, “legacy kept for safety”, dormant fallbacks, or eventual cleanup as substitutes for integrity.
- Return `PASS` only when all applicable checks pass with evidence from the current repository and relevant verification. There is no “PASS with caveats”.

## Required output

Start with exactly `PASS — Financial domain integrity` or `FAIL — Financial domain integrity`.

Then provide:

- **Scope:** affected domain flows, storage, calculations, reports, migrations/replacements, and PF/PJ paths.
- **Authority map:** official source of truth per affected figure, every writer of it, and the trusted boundary that performs each write.
- **Movement semantics:** classification and accounting effect of each affected movement on cash flow, assets, liabilities, income, expense, principal, realized yield, and appreciation.
- **Evidence matrix:** one row per checklist section with `PASS`, `FAIL`, or `N/A`, plus clickable file/line references or command/test output.
- **Reconciliation:** official sources, reconstruction formula, double-counting controls, and report/aggregate comparison.
- **Retry and concurrency:** idempotency boundaries, replay outcomes, race scenarios, and protections.
- **Legacy removal:** for a replaced domain, the removed write paths, readers, fallbacks, flags, Rules, indexes and tests, with search evidence proving no remaining references; otherwise `N/A` with justification.
- **Blocking findings:** invariant, failure scenario, impact, and required remediation for every failure; omit only on `PASS`.
- **Verification:** commands and tests run, explicitly covering creation, editing, cancellation/reversal, retry, concurrency when applicable, and legacy removal or migration behavior.

Do not infer financial semantics from labels or UI placement. State assumptions and unresolved ambiguities as failures when they prevent a safe conclusion.
