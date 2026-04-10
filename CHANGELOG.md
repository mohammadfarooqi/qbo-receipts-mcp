# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
