# Backlog

Issues, enhancements, and security findings tracked during development. Items are prioritized for a target version (v0.1.0, v0.2.0, v0.3.0) or marked as ongoing/triage.

Every item here originated from real dogfooding — either code review during implementation or actual use. Not speculative features.

---

## v0.1.0 (must-fix before first release)

### [SEC-1] Symlink following in `upload_receipt`
**Source:** Opus security review of Task 25 (2026-04-10)
**Severity:** High
**Details:** `statSync` and `readFileSync` in `src/tools/upload-receipt.ts` follow symlinks. A symlink placed inside `QBO_ATTACH_ALLOWED_DIRS` pointing to a sensitive file (`~/.ssh/id_rsa`, `/etc/shadow`, etc.) would be uploaded to QBO without the allowlist check catching it.
**Fix:** Use `fs.realpathSync()` to canonicalize the path before the allowlist check. Re-verify the canonical path is within an allowed prefix.
**Status:** FIXING NOW (Task 25 hardening)

### [SEC-2] Allowlist prefix without trailing slash
**Source:** Opus security review of Task 25 (2026-04-10)
**Severity:** High
**Details:** `allowedPrefixes.some(p => normalized.startsWith(p))` allows `/Users/me` to match `/Users/meanwhile/evil.pdf`. User sets `QBO_ATTACH_ALLOWED_DIRS=/Users/me/receipts` thinking only that directory is allowed; actually any path starting with `/Users/me/receipts` (including sibling dirs like `/Users/me/receipts-leak/`) is allowed.
**Fix:** Append `/` to each prefix if missing before `startsWith` comparison, OR compare path segments.
**Status:** FIXING NOW (Task 25 hardening)

---

## v0.2.0 (before npm publish)

### [SEC-3] TOCTOU between `statSync` and `readFileSync` in `upload_receipt`
**Source:** Opus security review of Task 25 (2026-04-10)
**Severity:** Medium
**Details:** Between the size check (`statSync`) and the read (`readFileSync`), an attacker with write access could swap the file, bypassing the 20 MB cap.
**Fix:** Open file once with `openSync`, use `fstatSync(fd)` + `readSync` on the same descriptor.

### [SEC-4] No MIME sniffing — content type is trusted from input
**Source:** Opus security review of Task 25 (2026-04-10)
**Severity:** Medium
**Details:** A `.exe` renamed to `receipt.pdf` with `contentType: application/pdf` passes all checks. QBO stores whatever bytes we send.
**Fix:** Magic-byte validation (e.g., `%PDF-` for PDF, `\x89PNG` for PNG, `\xFF\xD8\xFF` for JPEG) before upload. Reject mismatches.

### [SEC-5] Unicode/RLO/zero-width characters in filenames
**Source:** Opus security review of Task 25 (2026-04-10)
**Severity:** Low
**Details:** `UNSAFE_FILENAME_CHARS` only catches ASCII control characters + quotes. Filenames with right-to-left override (`\u202E`), bidirectional controls (`\u202A`-`\u2069`), or zero-width chars (`\u200D`, `\uFEFF`) pass validation and could display misleadingly in QBO.
**Fix:** Add Unicode category denylist or restrict to printable ASCII (depending on UX requirements).

### [SEC-6] `sourceId`/`existingNote` unescaped in memo marker
**Source:** Opus review of Task 23 (2026-04-10)
**Severity:** Low
**Details:** In `formatMemoMarker`, `sourceId` and `existingNote` flow into `PrivateNote` without escaping. If `sourceId` contained `| sess:fake-tag`, a rollback query matching `sess:<tag>` could match unintended records.
**Fix:** Validate `sourceId` against `/^[A-Za-z0-9._:-]+$/` and reject `|` / newlines in `existingNote` within `formatMemoMarker`.

### [BUG-1] `exchangeRate: 0` bypasses `buildPurchasePayload` guard
**Source:** Opus review of Task 23 (2026-04-10)
**Severity:** Low
**Details:** `input.exchangeRate === undefined` catches the unset case but `buildPurchasePayload` is exported and can be called directly, bypassing Zod. `exchangeRate: 0` or negative would slip through.
**Fix:** Tighten to `!input.exchangeRate || input.exchangeRate <= 0` or run Zod schema inside the builder.

### [BUG-2] Dry-run response shares payload reference with non-dry-run path
**Source:** Opus review of Task 23 (2026-04-10)
**Severity:** Low
**Details:** `{ dryRun: true, wouldSend: { ..., body: payload } }` — `payload` is the same object that would be sent on a real call. A caller that inspects then mutates the dry-run output could affect a subsequent non-dry-run call.
**Fix:** `structuredClone(payload)` in the dry-run branch.

### [PRODUCT-1] `get_accounts` tool
Needed for production workflow: fetching the chart of accounts to categorize expenses.

### [PRODUCT-2] Vendor CRUD tools
`get_vendor`, `search_vendors`, `create_vendor`, `update_vendor`. Needed for production workflow.

### [PRODUCT-3] `query` tool
Raw QBO SQL passthrough for edge cases not covered by specific tools.

### [PRODUCT-4] `get_boc_rate` tool
Wraps Bank of Canada Valet API for historical CAD/USD rates. Needed for multi-currency historical catch-up.

### [PRODUCT-5] `rollback_session` tool
Convenience tool that queries for all Purchases with a given session tag in `PrivateNote` and soft-deletes them in one call. Currently the caller has to do this in two steps.

### [PRODUCT-6] MCP registry `server.json`
Required for the Anthropic MCP registry listing. Follow canlii-mcp pattern.

### [PRODUCT-7] `publish.yml` CI workflow
Automated npm publish on GitHub release.

---

## v0.3.0+ / triage

### [SEC-7] Filename length measured in JS string length, not bytes
**Severity:** Low
**Details:** `MAX_FILENAME_LENGTH = 255` is UTF-16 code units. A filename of 255 emoji is ~1020 bytes. QBO/filesystem limits may differ.
**Fix:** Measure with `Buffer.byteLength(name, "utf8")` instead.

### [SEC-8] `.includes("..")` for path traversal is over-restrictive
**Severity:** Very low
**Details:** Rejects legitimate filenames like `my..backup/r.pdf`. Minor UX issue.
**Fix:** Split on separator and reject only `..` path segments.

### [SEC-9] `entityType` enum drift risk
**Severity:** Very low
**Details:** The `entityType` enum in `upload-receipt.ts` is not linked to the type accepted by `client.uploadAttachable`. If they drift, failures happen at runtime.
**Fix:** Share a single source-of-truth enum via `src/schema.ts`.

### [CLEANUP-1] `ValidationOptions.maxSize` is declared but unused
**Source:** Opus review of Task 25
**Fix:** Either use it to honor a caller-provided override, or remove the field.

### [EDGE-1] Missing edge case tests for `create_purchase`
**Source:** Opus review of Task 23
**Cases:** `exchangeRate: 0` direct call, `sourceId` containing `|` or `sess:`, multi-line `existingNote`, very large `totalAmt` float precision, semantically-invalid `txnDate` like `2026-02-30`.

### [PRODUCT-8] Keychain-backed credential storage
**Severity:** N/A — enhancement
**Details:** OAuth tokens currently live in `.env`. macOS Keychain (and equivalent on Linux/Windows) would be safer. Particularly relevant for the Claude Code use case where `.env` files can leak via IDE auto-selection.

### [PRODUCT-9] Memory-efficient upload for large files
**Severity:** N/A — enhancement
**Details:** `readFileSync` loads entire file into memory (up to 20 MB). Fine at current limit; revisit if limit ever grows.

---

## Ongoing — observations from real use

(To be populated as the MCP is actually used against real sandbox and production realms.)
