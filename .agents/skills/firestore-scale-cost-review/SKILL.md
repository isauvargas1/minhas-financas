---
name: firestore-scale-cost-review
description: Review Firestore changes for tenant isolation, query scalability, read/write cost, indexing, pagination, listeners, data modeling, aggregates, and Emulator coverage. Use whenever a task creates, changes, approves, or reviews Firestore queries, listeners, schemas or document shapes, indexes, aggregates, projections, transactions, batches, or pagination in frontend, backend, rules, migrations, or tests.
---

# Firestore Scale and Cost Review

Act as a blocking architecture gate. Inspect the repository and the actual diff or implementation; never approve from a description alone.

## Workflow

1. Read [review-checklist.md](references/review-checklist.md) completely.
2. Identify every affected query, listener, write path, schema, index, aggregate, pagination path, security rule, and Emulator test, including indirect callers.
3. Trace `workspaceId` from trusted context through storage paths, filters, rules, indexes, and tests. Treat client-supplied tenant isolation alone as insufficient.
4. Evaluate every applicable checklist item using code, configuration, rules, and tests. Estimate operation counts at realistic and high-volume cardinalities.
5. If implementation is requested, fix failures before approval and run relevant static checks and Emulator tests. Do not weaken the gate because tests or infrastructure are missing.
6. Report the verdict using the required format below.

## Decision policy

- Return `FAIL` if any applicable mandatory item fails, evidence is missing, scale/cost depends on an unstated assumption, or correctness is deferred to “optimize later.”
- Reject temporary workarounds, unbounded designs, client-side filtering/pagination/aggregation of broad datasets, and TODO-based remediation.
- Return `PASS` only when all applicable items pass with evidence from the current repository and relevant verification.
- Mark an item `N/A` only with concrete evidence that the affected paths cannot exercise it. Missing evidence is `FAIL`, not `N/A`.

## Required output

Start with exactly `PASS — Firestore scale/cost review` or `FAIL — Firestore scale/cost review`.

Then provide:

- **Scope:** affected code paths and operations.
- **Evidence:** one row per checklist item with `PASS`, `FAIL`, or `N/A`, plus clickable file/line references or command/test output.
- **Cost model:** expected reads, writes, listener re-reads, and fan-out per user action and at stated high-volume assumptions.
- **Blocking findings:** required changes for every failure; omit only on `PASS`.
- **Verification:** commands/tests run and results, explicitly naming Emulator coverage.

Do not claim facts not established by repository evidence. Clearly label estimates and their assumptions.
