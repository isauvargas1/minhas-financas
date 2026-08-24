# Multi-tenant security checklist

Apply every item to each affected operation. Cite implementation, Security Rules, configuration, and tests separately.

## Identity, tenant, and membership

- Require authenticated identity from a verified server/runtime token; reject user IDs, roles, claims, or authentication state asserted only by the client.
- Require a non-empty `workspaceId`, validate it on the backend, and prove it matches every route parameter, document/storage path, payload reference, queried resource, and persisted tenant field. Reject mismatches rather than silently substituting values.
- Verify active workspace membership server-side for every tenant-owned read, write, invocation, download, upload, and privileged action. Define behavior for removed, disabled, invited, and stale-token members.
- Prevent enumeration and access across workspaces in direct document reads, queries, collection-group queries, APIs, callable/HTTP functions, background jobs, exports, signed URLs, and error responses.
- Treat every cross-tenant read, write, metadata leak, or IDOR path as a blocking failure regardless of likelihood or current data volume.

## RBAC and privileged operations

- Build an explicit owner/admin/member matrix per operation and verify default deny. Test both permitted and forbidden role transitions and resources.
- Derive effective role and workspace membership from trusted backend data or verified claims with safe revocation semantics. Never authorize from client-provided role, workspace, ownership, or hidden UI controls.
- Restrict sensitive writes—membership/role changes, ownership transfer, billing, secrets, audit data, workspace deletion, privileged flags, and equivalent operations—to trusted backend entry points.
- Prevent self-promotion, removal of required last owner, unauthorized invitations, membership reassignment, and confused-deputy behavior.

## Data integrity and input handling

- Protect immutable/security-critical fields on create and update, including workspace/tenant owner, creator, role, subject IDs, billing/security state, and server timestamps. Compare stored and proposed values in Rules and enforce an allowlist on the backend.
- Prevent mass assignment by constructing persisted objects from explicitly allowed fields. Reject unknown, forbidden, nested, prototype-polluting, and type-confused input.
- Validate schema, types, lengths, formats, ranges, collection sizes, references, state transitions, and normalization on the trusted boundary. Do not rely on client validation.
- Use atomic transactions or equivalent conditional writes for authorization-sensitive read-modify-write operations. Check TOCTOU, simultaneous role/membership changes, duplicate requests, and lost updates.
- Require idempotency/replay protection for retryable or sensitive operations. Bind idempotency keys to authenticated user, workspace, operation, and payload; define retention and conflict behavior.

## Independent enforcement layers

- Evaluate Firestore and Storage Security Rules as if backend checks were absent. Confirm default deny, tenant path coherence, membership/RBAC lookup, immutable fields, query constraints, and denial of cross-tenant operations.
- Evaluate APIs and Cloud Functions as if Security Rules were absent or bypassed by Admin SDK. Require authentication, workspace/path coherence, membership, RBAC, validation, and field allowlists in backend code.
- Do not accept one layer as compensation for a missing or permissive other layer when both are in scope. Note intentional trusted-service exceptions and prove their controls.

## Audit, secrets, and Storage

- Emit tamper-resistant audit events for sensitive/security-relevant actions with actor, effective workspace, action, target, outcome, request/correlation ID, and server timestamp. Avoid secrets and unnecessary personal data; define access and retention.
- Detect secrets, service-account material, private keys, privileged tokens, webhook secrets, credentials, or sensitive config in source, client bundles, logs, errors, fixtures, and committed environment files. Require server-side secret management and least privilege.
- Isolate Storage objects under validated workspace paths. Enforce membership/RBAC, content type and size, immutable ownership/tenant metadata, safe filenames, and cross-workspace denial in Storage Rules and backend/signed-URL issuance.
- Verify downloads, listings, resumable uploads, metadata updates, deletes, and generated/signed URLs cannot cross tenant boundaries or outlive revoked access beyond an explicitly accepted policy.

## Emulator tests

- Require negative Firebase Emulator tests using at least tenant A and tenant B with distinct users and resources. Attempt both directions of cross-tenant access for every changed Firestore/Storage operation and relevant function/API path.
- Cover unauthenticated, non-member, removed member, member/admin/owner boundaries, forged `workspaceId`, path/payload mismatch, forged role, immutable-field changes, mass assignment, and privileged writes as applicable.
- Cover concurrent authorization-sensitive updates and replay/idempotency behavior where applicable. Assert final state and audit side effects, not only response status.
- Run the relevant Emulator suite. Missing, skipped, permissive, or non-runnable negative coverage is a blocking failure.

## Evidence rules

- Trace indirect callers and shared helpers; do not review only changed lines.
- Cite repository-relative paths and line numbers for every conclusion. Record commands and exact test results.
- Demonstrate independent enforcement with separate evidence for Rules and backend.
- Describe each failure as a concrete attacker, request/resource substitution, authorization decision, and resulting impact.
- Do not modify anything during review without explicit user authorization. If fixes are requested later, preserve the review verdict until the remediated code and tests are re-reviewed.
