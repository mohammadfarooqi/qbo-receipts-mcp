# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-04-10

### Added

- **8 new tools** — tool surface expands from 5 to 13:
  - `get_accounts` — chart of accounts with optional `accountType` and `active` filters.
  - `search_vendors` — vendor query with `namePrefix` (LIKE prefix match, injection-guarded), `currencyCode`, and `active` filters.
  - `get_vendor` — fetch single vendor by Id.
  - `create_vendor` — create with permanent `CurrencyRef`, honors `QBO_DRY_RUN`. Currency is set at creation and cannot be changed later (QBO rule, enforced at the tool layer).
  - `update_vendor` — sparse update by Id + SyncToken. Strict Zod schema refuses `currencyCode` entirely (matches QBO's immutability rule).
  - `query` — guarded raw SELECT-only passthrough. Length capped at 2000 chars. Rejects semicolons, SQL comments (`--`, `/* */`), and mutation keywords (INSERT, UPDATE, DELETE, MERGE, TRUNCATE, INTO, CDC). Returns unvalidated JSON as an escape hatch.
  - `get_boc_rate` — historical CAD/USD rate via Bank of Canada Valet API with a 7-day weekend/holiday fallback window. CRA-accepted source per Income Tax Folio S5-F4-C1. No authentication required.
  - `rollback_session` — finds all Purchases whose `PrivateNote` contains `sess:<tag>` within a 60-day date window and soft-deletes them. Honors `QBO_DRY_RUN`. The rollback primitive for a write batch gone wrong.
- `BOC_BASE_URL` environment variable — optional override for the Bank of Canada Valet API base URL, used for testing against a mock.
- `src/util/boc.ts` — pure Bank of Canada Valet API fetcher with observation-window logic and graceful weekend/holiday fallback.
- `src/util/mime-sniff.ts` — magic-byte signature helper. Signatures for PDF, PNG, JPEG, GIF, TIFF (both endiannesses), and the ZIP container used by DOCX/XLSX.
- Expanded mock HTTP server with handlers for accounts, vendors (create and sparse update), single-vendor GET, and a query router that dispatches by `FROM Purchase|Account|Vendor`.
- 9 new integration tests covering end-to-end round trips for all 8 new tools plus tool-list assertion at 13 tools.

### Fixed

- **SEC-3:** TOCTOU window between `statSync` and `readFileSync` in `upload_receipt`. Refactored to open the canonical path once via `openSync`, size-check via `fstatSync(fd)`, read into a pre-sized buffer via `readSync` in a loop, and close the fd in a `finally` block. Post-open path swaps no longer affect the read.
- **SEC-4:** `upload_receipt` now verifies magic bytes against the declared `contentType` before upload. Rejects mismatches for PDF, PNG, JPEG, GIF, TIFF, DOCX, and XLSX. `text/plain` and `text/csv` skip sniffing (no reliable magic). Prevents `.exe`-renamed-to-`.pdf` attacks.

### Unchanged

- No new runtime dependencies. Still only `@modelcontextprotocol/sdk` and `zod`.
- OAuth flow, rate limiter, and multipart upload logic are untouched.
- All v0.1.x write paths retain their dry-run and session-tag semantics.
- Existing 5 tools and their schemas are backwards-compatible.

### Known limitations / deferred

- **No npm publish yet.** v0.2.0 is published via GitHub release only. Install via `git clone` or `npm install github:mohammadfarooqi/qbo-receipts-mcp#v0.2.0`. npm publish deferred until after a full sandbox USD round trip against real Intuit.
- **DOCX/XLSX disambiguation** — `sniffMimeType` verifies ZIP container headers but does not inspect the inner directory structure. A generic ZIP declared as DOCX will pass.
- **SEC-10** (Unicode homoglyph bypass in `query` tool mutation-keyword regex) — fullwidth Latin characters like `ＤＥＬＥＴＥ` pass the keyword check. Non-exploitable because QBO's `/query` endpoint is a read-only GET and does not execute DML.
- **SEC-5, SEC-6, BUG-1, BUG-2** (filename Unicode RLO, memo marker escape, `exchangeRate: 0` builder guard, dry-run payload cloning) remain tracked in `docs/backlog.md`. None block the catch-up workflow.
- **No `batch` endpoint wrapper** — `rollback_session` loops over soft-delete calls rather than using QBO's `/batch`. Fine at current scale (5-10 rows per session).
- **No MCP registry entry** — `server.json` for the Anthropic MCP registry is pending.

### Testing

- 162 tests passing (unit + integration, all against a local mock HTTP server).
- No changes to CI matrix (Node 18 / 20 / 22).

---

## [0.1.2] — 2026-04-10

### Changed

- **Privacy:** removed personal email address from `SECURITY.md` and from the `docs/plans/v0.1.0.md` embedded template. Vulnerability reporting now routes through GitHub's native **Private Vulnerability Reporting** (enabled on the repository), which keeps exploit details confidential between reporter and maintainer until a fix is ready. Non-security bugs and feature requests go to regular GitHub issues.
- GitHub Private Vulnerability Reporting enabled at repository level via `PUT /repos/.../private-vulnerability-reporting`.

No code changes. Docs-only patch release.

---

## [0.1.1] — 2026-04-10

### Fixed

- **SCHEMA-1:** `PurchaseLineSchema` rejected Purchases with `ItemBasedExpenseLineDetail` lines. Real QBO realms (including Intuit's demo sandboxes) contain Purchases with multiple line DetailType values, so v0.1.0's strict `z.literal("AccountBasedExpenseLineDetail")` caused `search_purchases` to fail whenever any row used a different line type. Loosened the schema to accept any `DetailType` string with `.passthrough()` for unknown fields; write-side validation via `buildPurchasePayload` is unchanged. Added regression tests for `ItemBasedExpenseLineDetail` and future-proof unknown types. Found via real sandbox smoke test immediately after the v0.1.0 tag.

### Added

- `scripts/smoke-*.mjs` — local smoke test scripts used to validate the MCP against a real Intuit sandbox realm. Not shipped via npm (scripts/ is excluded from the `files` allowlist). Committed for reproducibility.

### Validation against real Intuit sandbox

Sandbox: `Sandbox Company CA 7419` (realm `9341456848594339`, Canadian Plus tier). Full CAD round trip verified end-to-end:

- `get_company_info` returned the real company name
- `search_purchases` with date filter returned existing demo purchases
- `create_purchase` wrote a real Purchase (Id `182`), memo marker correctly formatted as `auto:manual:<id> | sess:<tag>`
- `search_purchases` by exact `TotalAmt` + date found the created Purchase (dedup strategy validated)
- `upload_receipt` multipart-uploaded a PDF, got back Attachable Id `637344` linked to Purchase:182
- `delete_purchase` returned `status: Deleted`

Every architectural decision from the v0.1.0 plan survived contact with real Intuit: hand-rolled OAuth, native `fetch`, multipart upload with `file_metadata_01`/`file_content_01` part names, soft-delete rollback via `?operation=delete`, and session-tagged memo markers.

### Behavior notes from validation

- QBO does NOT populate `HomeTotalAmt` on home-currency Purchases. Field is only present for foreign-currency transactions. Schema already handles this correctly (`HomeTotalAmt` optional). Only check `HomeTotalAmt` drift for foreign-currency transactions.
- The sandbox had no USD-denominated vendors or accounts, so the USD write path (with explicit `ExchangeRate`) was only validated against the mock server, not real Intuit. Deferred to v0.2.0.

---

## [0.1.0] — 2026-04-10

### Added

- Initial release.
- 5 tools: `get_company_info`, `search_purchases`, `create_purchase`, `delete_purchase`, `upload_receipt`.
- Hand-rolled OAuth 2.0 token refresh (no `node-quickbooks` or `intuit-oauth` dependency).
- Multipart upload for the Attachable entity (file bytes + metadata in one request).
- Session-tagged memo markers enforced on every `create_purchase` call.
- Dry-run mode via `QBO_DRY_RUN=true`.
- Path safety allowlist via `QBO_ATTACH_ALLOWED_DIRS`.
- Symlink resolution via `realpathSync` — any symlink whose canonical target escapes the allowlist is rejected (SEC-1 fix).
- Allowlist prefix normalization to prevent `/Users/me` matching `/Users/meanwhile/...` (SEC-2 fix).
- Content-type allowlist + 20 MB file size cap on receipt uploads.
- Filename safety check — rejects CR/LF/NUL/quote/backslash in filenames to prevent multipart Content-Disposition header injection.
- Rate limiter (serialized promise queue with configurable min interval).
- Auto token refresh on 401 responses with single retry.
- OAuth helper CLI (`qbo-receipts-mcp-oauth`) for one-time initial authorization.
- Mock HTTP server for integration tests (zero dependencies beyond Node built-ins).
- Full integration test exercising create → upload → search → delete round-trip, dry-run mode, and USD exchange-rate guard.
- CI workflow (Node 18/20/22 matrix, build + unit tests + audit).
- MIT license, SECURITY.md, full README, v0.1.0 implementation plan in `docs/plans/`, and a backlog in `docs/backlog.md`.

### Explicitly not in this release (planned for v0.2.0)

- `get_accounts`, `search_vendors`, `get_vendor`, `create_vendor`, `update_vendor`, `query`, `get_boc_rate`
- npm publish workflow
- MCP registry `server.json`
- First npm publish
- MIME sniffing, TOCTOU fix on file upload, Unicode filename denylist (tracked as SEC-3, SEC-4, SEC-5 in docs/backlog.md)
