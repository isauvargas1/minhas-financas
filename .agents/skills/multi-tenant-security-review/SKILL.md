---
name: multi-tenant-security-review
description: Review multi-tenant authentication, authorization, tenant isolation, and data-access security using evidence from the repository. Use whenever a task creates, changes, approves, or reviews Authentication, WorkspaceContext, Firestore, Cloud Storage, Security Rules, Cloud Functions, RBAC, workspace memberships, tenant-aware APIs, privileged writes, audit logging, or related Emulator tests.
---

# Multi-Tenant Security Review

Act as a read-only security gate. Inspect the actual implementation, callers, rules, configuration, and tests. During a review, never edit code, configuration, rules, tests, or generated files unless the user explicitly authorizes implementation of fixes.

## Workflow

1. Read [security-checklist.md](references/security-checklist.md) completely.
2. Determine the trust boundaries and trace identity, `workspaceId`, membership, role, resource path, and mutable fields from request entry to persistence and response.
3. Inspect all affected paths: browser/client, API, Cloud Functions, Firestore and Storage Rules, membership/RBAC data, secrets/configuration, audit logging, and Emulator tests.
4. Test the owner/admin/member matrix for allowed and denied operations. Treat backend authorization and Security Rules as independent controls; passing one cannot compensate for failure in the other.
5. Evaluate every applicable checklist item with exact repository evidence. Run read-only checks and relevant tests; do not fix findings without explicit authorization.
6. Report the verdict in the required format.

## Decision policy

- Return `FAIL` for any tenant-isolation weakness, cross-tenant/IDOR path, client-controlled trust decision, or missing negative two-tenant Emulator coverage. These failures are always blocking.
- Return `FAIL` when any other mandatory control fails or lacks evidence. Missing infrastructure or tests are findings, not reasons to relax the gate.
- Return `PASS` only when every applicable item passes with code and test evidence.
- Use `N/A` only when repository evidence proves the affected path cannot exercise the risk. Absence of evidence is `FAIL`.
- Do not approve temporary mitigations, TODOs, manual safeguards, or promises to secure later.

## Required output

Start with exactly `PASS — Multi-tenant security review` or `FAIL — Multi-tenant security review`.

Then provide:

- **Scope and trust boundaries:** entry points, identities, tenant resources, and authorization layers reviewed.
- **Evidence matrix:** one row per checklist item with `PASS`, `FAIL`, or `N/A` and clickable file/line references or test output.
- **Attack paths:** attempted IDOR, cross-tenant access, privilege escalation, mass assignment, replay, and concurrency scenarios.
- **Blocking findings:** exploit scenario, impact, and required remediation for every failure; explicitly label tenant-isolation failures.
- **Verification:** commands and Emulator suites run, including the two tenant identities and denied operations tested.

Do not infer protections from naming, UI visibility, or intended behavior. State unknowns as failures when they prevent approval.
