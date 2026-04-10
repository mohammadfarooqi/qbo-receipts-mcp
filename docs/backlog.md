# Backlog

Issues, enhancements, and security findings tracked during development. Items are prioritized for a target version (v0.1.0, v0.2.0, v0.3.0) or marked as ongoing/triage.

Every item here originated from real dogfooding — either code review during implementation or actual use. Not speculative features.

---

## v0.1.0 — Resolved

### [PKG-1] bin entries point to wrong paths — FIXED 2026-04-10
Fixed by updating `package.json` `bin`, `start`, `oauth` script paths to `dist/src/*.js` and narrowing `files` allowlist to `dist/src/` (so tests don't ship). See commit for details.

### [PKG-2] dist/test/** files ship in published tarball — FIXED 2026-04-10
Resolved by the same `files` allowlist change as PKG-1.

### [SEC-1] Symlink following in upload_receipt — FIXED 2026-04-10
Fixed in Task 25 hardening commit. `uploadReceipt` now calls `fs.realpathSync.native()` to canonicalize the file path and re-checks the allowlist against the canonical path. Four new tests (symlink escape + symlink within allowlist + allowlist prefix trailing slash + legitimate file).

### [SEC-2] Allowlist prefix without trailing slash — FIXED 2026-04-10
Fixed in Task 25 hardening commit. `validateUploadReceiptInput` now normalizes each allowlist prefix to end with `/` and appends `/` to the candidate path before the `startsWith` check.

### [SCHEMA-1] PurchaseLineSchema rejected ItemBasedExpenseLineDetail — FIXED 2026-04-10
**Source:** Real sandbox smoke test (2026-04-10, post-v0.1.0 tag)
**Severity:** High (read path broken against real data)
**Details:** The original `PurchaseLineSchema` used `DetailType: z.literal("AccountBasedExpenseLineDetail")` with a required `AccountBasedExpenseLineDetail` field. QBO's sandbox (and real production companies) returns Purchases with multiple line DetailType values — `ItemBasedExpenseLineDetail` (for item-based purchases like inventory), potentially `TaxLineDetail`, `SubTotalLineDetail`, etc. When `search_purchases` encountered any Purchase with a non-AccountBased line type, the entire `PurchaseQueryResponseSchema.parse()` call failed and the tool returned a validation error. Found on the very first smoke test against the sandbox: 4 of 20 sandbox demo Purchases use `ItemBasedExpenseLineDetail`.
**Fix:** Loosened `PurchaseLineSchema` to accept any `DetailType` string, made `AccountBasedExpenseLineDetail` optional, and added `.passthrough()` for unknown fields. Write-side validation is unchanged: `buildPurchasePayload` always constructs `AccountBasedExpenseLineDetail` directly. Added two regression tests (one for `ItemBasedExpenseLineDetail`, one for a future-proof unknown DetailType). Commit `78e322c`.
**Lesson:** Strict Zod literals on response schemas are brittle against real APIs. For read-side validation, prefer permissive schemas with passthrough and rely on type narrowing at consumption points.

---

## v0.2.0 — Resolved

### [SEC-3] TOCTOU between `statSync` and `readFileSync` — FIXED 2026-04-10
Fixed in Task 21 of the v0.2.0 plan. `uploadReceipt` was refactored to open the canonical path once with `openSync`, use `fstatSync(fd)` for the size check, allocate a pre-sized buffer via `Buffer.alloc`, and read via `readSync` in a loop from the same descriptor. `closeSync(fd)` runs in a `finally` block. No TOCTOU window between stat and read — both operate on the same inode via the fd. Post-open path swaps do not affect the read.

### [SEC-4] MIME sniffing — FIXED 2026-04-10
Fixed in Tasks 20 + 21 of the v0.2.0 plan. New helper `src/util/mime-sniff.ts` exports `sniffMimeType(buf, declaredType)` which verifies the first N bytes of a file against a magic-byte signature for the declared content type. Signatures cover `application/pdf` (`%PDF-`), `image/png`, `image/jpeg`, `image/gif`, `image/tiff` (both LE and BE), and the ZIP container used by DOCX/XLSX. `text/plain` and `text/csv` skip sniffing (no reliable magic bytes). The helper is called inside `uploadReceipt` after the file bytes are read and before the upload happens. Known tradeoff: DOCX/XLSX disambiguation is not implemented — any ZIP file passes as OfficeXML. Logged as v0.3.0 candidate if stricter validation is ever needed.

### [SEC-10] Unicode homoglyph bypass in query tool mutation keyword check — NEW, DEFERRED
**Source:** Opus code review of Task 13 (2026-04-10)
**Severity:** Very low (defense-in-depth gap, not exploitable)
**Details:** `validateQuery` uses ASCII `\b` word-boundary regex against uppercased mutation keywords. A query containing `SELECT * FROM Vendor WHERE x = 'ＩＮＳＥＲＴ'` (fullwidth Latin) would pass the keyword check because `\bINSERT\b` doesn't match `ＩＮＳＥＲＴ`. The prefix check `/^SELECT\s/i` is ASCII-only so it does correctly reject a fullwidth SELECT prefix.
**Non-exploitability:** QBO's `/query` endpoint is a read-only GET. It does not execute DML. A mutation keyword that slips through our guard would just be sent to QBO as part of a query string and rejected at the API layer or interpreted as literal data. This is a guard inconsistency, not a security hole.
**Fix (if ever needed):** Unicode-normalize (NFKC) the input before running the keyword check, or reject non-ASCII characters entirely.

---

## v0.2.0 (before npm publish)

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

### [PRODUCT-1] `get_accounts` tool — SHIPPED in v0.2.0
### [PRODUCT-2] Vendor CRUD tools — SHIPPED in v0.2.0 (`get_vendor`, `search_vendors`, `create_vendor`, `update_vendor`)
### [PRODUCT-3] `query` tool — SHIPPED in v0.2.0
### [PRODUCT-4] `get_boc_rate` tool — SHIPPED in v0.2.0
### [PRODUCT-5] `rollback_session` tool — SHIPPED in v0.2.0

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
