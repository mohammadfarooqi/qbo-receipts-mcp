# qbo-receipts-mcp

[![npm version](https://img.shields.io/npm/v/qbo-receipts-mcp)](https://www.npmjs.com/package/qbo-receipts-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server for creating QuickBooks Online expenses with receipt file attachments. Multi-currency aware. Minimal tool surface, TDD'd, security-reviewed.

**Positioning:** the only QBO MCP in the ecosystem that actually uploads receipt bytes and links them to the created expense record. Other QBO MCPs either omit attachments entirely or expose metadata-only Attachable tools that don't accept file content.

```bash
npx qbo-receipts-mcp
```

## Features

- **13 tools** — `get_company_info`, `search_purchases`, `create_purchase`, `delete_purchase`, `upload_receipt`, `get_accounts`, `search_vendors`, `get_vendor`, `create_vendor`, `update_vendor`, `query`, `get_boc_rate`, `rollback_session`
- **Receipt attachments** — multipart upload to QBO's `/upload` endpoint with the Attachable entity, linked to Purchase records
- **Multi-currency** — explicit `ExchangeRate` on every USD/foreign-currency expense; required (not defaulted), so historical catch-up entries use the correct rate
- **Session-tagged rollback** — every created expense carries `auto:<source>:<id> | sess:<session>` in the memo; rollback = soft-delete by session tag
- **Dry-run mode** — `QBO_DRY_RUN=true` turns every write into a preview
- **Path safety** — `QBO_ATTACH_ALLOWED_DIRS` env var restricts which filesystem paths `upload_receipt` can read; symlinks that escape the allowlist are rejected via `realpathSync`
- **Filename safety** — rejects CR/LF/NUL/quote/backslash in filenames to prevent multipart Content-Disposition header injection
- **Content-type allowlist** — only PDF, image, Office, CSV, text files accepted
- **20 MB file size cap** — per QBO API limits
- **Input validation** — Zod schemas on every tool input and every API response
- **Rate limiter** — serialized promise queue stays under QBO's 500 req/min limit
- **Auto token refresh** — 401 responses trigger a single refresh + retry
- **Minimal footprint** — 2 runtime dependencies (MCP SDK + Zod), runs locally as a stdio process

## Security warnings

Before running this MCP against a production QBO realm, read these:

- **Set `QBO_ATTACH_ALLOWED_DIRS`** to a specific directory (or colon-separated list). It is technically optional, but leaving it unset means `upload_receipt` can read any file the Node process can read. For a production deployment, always set it.
- **No automatic deduplication.** If `create_purchase` succeeds at QBO but the MCP response is lost (network blip, client crash), the next retry creates a duplicate. Always call `search_purchases` with your session tag before retrying a failed `create_purchase`.
- **Tokens are stored in plaintext.** The OAuth helper writes to `.env` with mode `0600`. Do not commit `.env`. Keychain-backed storage is on the roadmap.
- **Single-process assumption.** Concurrent MCP invocations against the same OAuth app are not safe — the refresh token rotation can race. Run one MCP instance at a time per QBO realm.
- **Sandbox first.** Test every workflow against your Intuit sandbox before pointing at your real company. The plan calls for a sandbox smoke test before prod.

For the full security posture, see [SECURITY.md](SECURITY.md).

## Quick Start

**Prerequisites:** Node.js 18+, an [Intuit Developer](https://developer.intuit.com) app, and a QuickBooks Online company (sandbox or production).

### 1. Create an Intuit Developer app

Visit https://developer.intuit.com → Dashboard → Create an app → **QuickBooks Online and Payments**.

Under **Keys & OAuth 2.0 Redirect URIs**, add `http://localhost:8000/callback` to the redirect URIs list (on both the Development and Production tabs).

Copy the **Client ID** and **Client Secret** (separate ones for Development and Production).

### 2. Run the OAuth helper once

```bash
export QBO_CLIENT_ID=your-client-id
export QBO_CLIENT_SECRET=your-client-secret
npx qbo-receipts-mcp-oauth
```

This opens a browser to Intuit, captures the callback on `http://localhost:8000/callback`, exchanges the code for tokens, and writes `QBO_ACCESS_TOKEN`, `QBO_REFRESH_TOKEN`, and `QBO_REALM_ID` to `.env` (mode 0600).

### 3. Add to Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "qbo-receipts": {
      "command": "npx",
      "args": ["-y", "qbo-receipts-mcp"],
      "env": {
        "QBO_CLIENT_ID": "your-client-id",
        "QBO_CLIENT_SECRET": "your-client-secret",
        "QBO_ACCESS_TOKEN": "from-oauth-helper",
        "QBO_REFRESH_TOKEN": "from-oauth-helper",
        "QBO_REALM_ID": "from-oauth-helper",
        "QBO_ENVIRONMENT": "sandbox",
        "QBO_ATTACH_ALLOWED_DIRS": "/Users/you/receipts"
      }
    }
  }
}
```

Restart Claude Desktop.

### 4. Or add to Claude Code

```bash
claude mcp add qbo-receipts \
  -e QBO_CLIENT_ID=... \
  -e QBO_CLIENT_SECRET=... \
  -e QBO_ACCESS_TOKEN=... \
  -e QBO_REFRESH_TOKEN=... \
  -e QBO_REALM_ID=... \
  -e QBO_ENVIRONMENT=sandbox \
  -e QBO_ATTACH_ALLOWED_DIRS=/Users/you/receipts \
  -- npx -y qbo-receipts-mcp
```

## Tools

### get_company_info

Returns the authenticated QBO company's metadata including CompanyName and Country. Use this to verify OAuth and realm are correct before any write operation.

```
get_company_info({})
```

### search_purchases

Query existing Purchase records with optional filters on date range, total amount, and currency. Used for duplicate detection before creating new expenses. **Amounts match on the transaction currency (`TotalAmt`), not the home-converted amount.**

```
search_purchases({
  txnDateAfter: "2025-01-01",
  txnDateBefore: "2025-12-31",
  totalAmt: 42.00,
  currencyCode: "USD",
  maxResults: 100
})
```

### create_purchase

Create a new QBO Purchase (appears as an "Expense" in the QBO UI).

- **Required:** `txnDate`, `paymentType`, `paymentAccountId`, `totalAmt`, `expenseAccountId`, `source`, `sourceId`, `sessionTag`
- **For foreign currency:** `currencyCode` AND `exchangeRate` are both required — the tool will refuse to guess
- **Session tag** must match `YYYY-MM-DD-HHmm` format
- **Memo marker** is automatically added: `auto:<source>:<sourceId> | sess:<sessionTag>`

```
create_purchase({
  txnDate: "2025-11-04",
  paymentType: "CreditCard",
  paymentAccountId: "1102",
  totalAmt: 42.00,
  expenseAccountId: "80",
  vendorId: "55",
  currencyCode: "USD",
  exchangeRate: 1.4090,
  source: "pp",
  sourceId: "4AB12345CD678901E",
  sessionTag: "2026-04-10-0930"
})
```

### upload_receipt

Upload a receipt file and link it to a QBO entity as an Attachable.

- Max file size: 20 MB
- Allowed content types: `application/pdf`, `image/png`, `image/jpeg`, `image/gif`, `image/tiff`, DOCX, XLSX, CSV, plain text
- Filename safety enforced: no CR/LF/NUL/quote/backslash
- Set `QBO_ATTACH_ALLOWED_DIRS` env var (colon-separated) to restrict filesystem paths
- Symlinks are resolved via `realpathSync`; any symlink whose target escapes the allowlist is rejected

```
upload_receipt({
  filePath: "/Users/you/receipts/aws-2025-11-04.pdf",
  contentType: "application/pdf",
  entityType: "Purchase",
  entityId: "42"
})
```

### delete_purchase

Soft-delete a Purchase by Id + SyncToken. Marks the record as `Deleted`. Used as the rollback primitive: to undo a batch, query for all Purchases with `sess:<session-tag>` in the memo and delete each one.

```
delete_purchase({ id: "42", syncToken: "0" })
```

### get_accounts

Fetch the QBO chart of accounts. Optional filters narrow results by account type and active status.

**Inputs:** `accountType?` (one of: `Bank`, `Other Current Asset`, `Fixed Asset`, `Other Asset`, `Accounts Receivable`, `Equity`, `Expense`, `Other Expense`, `Cost of Goods Sold`, `Accounts Payable`, `Credit Card`, `Long Term Liability`, `Other Current Liability`, `Income`, `Other Income`), `active?` (boolean), `maxResults?` (default 500, max 1000)

**Use case:** Discovery of payment account Ids (e.g. `1101`/`1102` for CAD/USD cards) and expense account Ids before calling `create_purchase`.

### search_vendors

Query QBO Vendor records with prefix, currency, and active filters.

**Inputs:** `namePrefix?` (prefix match on `DisplayName`; rejects single-quote, percent sign, backslash, and semicolon for SQL injection safety), `currencyCode?` (ISO 4217), `active?` (boolean), `maxResults?` (default 500)

**Notes:** Use for dedup before `create_vendor`. The `namePrefix` filter is a SQL `LIKE` prefix match executed server-side by QBO.

### get_vendor

Fetch a single QBO Vendor by Id.

**Inputs:** `id` (QBO Vendor Id, required)

**Returns:** Full Vendor entity including `CurrencyRef`, billing address, and `SyncToken`.

### create_vendor

Create a new QBO Vendor. `CurrencyRef` is **permanent** at creation and cannot be changed later.

**Inputs:** `displayName` (required; for USD vendors use the `(USD)` suffix convention), `companyName?`, `givenName?`, `familyName?`, `email?`, `phone?`, `webAddr?`, `currencyCode?` (ISO 4217, permanent), `notes?`, `taxIdentifier?`, `vendor1099?`, `billAddrLine1?`, `billAddrLine2?`, `billAddrCity?`, `billAddrCountrySubDivisionCode?`, `billAddrPostalCode?`, `billAddrCountry?`

**Honors:** `QBO_DRY_RUN`

### update_vendor

Update an existing QBO Vendor by Id and SyncToken. Sparse update — only provided fields change.

**Inputs:** `id` (required), `syncToken` (required), plus any of the mutable fields (`displayName`, `companyName`, `email`, `active`, `notes`, etc.).

**Note:** `currencyCode` is deliberately absent from the input schema because QBO treats `Vendor.CurrencyRef` as immutable. Use `active: false` to archive a vendor.

**Honors:** `QBO_DRY_RUN`

### query

Raw QBO query endpoint (escape hatch). SELECT-only, length-capped at 2000 chars.

**Inputs:** `query` (string, must start with `SELECT`)

**Rejected:** semicolons, SQL comments (`--` and `/* */`), mutation keywords (`INSERT`, `UPDATE`, `DELETE`, `MERGE`, `TRUNCATE`, `INTO`, `CDC`).

**Use case:** Edge cases not covered by a specific tool. Response is passed through without schema validation.

### get_boc_rate

Historical CAD/USD exchange rate from the Bank of Canada Valet API. CRA-accepted source per Income Tax Folio S5-F4-C1. No authentication required.

**Inputs:** `date` (YYYY-MM-DD)

**Returns:** `{ date, rate, observationDate, sourceUrl }`. The `rate` is CAD per 1 USD (matching QBO's `ExchangeRate` convention). `observationDate` may differ from `date` if the target falls on a weekend or holiday (7-day lookback).

**Env override:** `BOC_BASE_URL` for testing against a mock.

### rollback_session

Find all Purchases whose `PrivateNote` contains `sess:<sessionTag>` within a date window and soft-delete them. The rollback primitive for a write batch gone wrong.

**Inputs:** `sessionTag` (required, `YYYY-MM-DD-HHmm` format), `txnDateAfter?` (defaults to today − 60 days), `txnDateBefore?` (defaults to tomorrow)

**Returns:** Summary with `matched`, `deleted`, `ids`, `results`, and the date window used.

**Honors:** `QBO_DRY_RUN` — in dry-run, returns the matched Ids without deleting.

## Environment Variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `QBO_CLIENT_ID` | Yes | — | Intuit Developer app Client ID |
| `QBO_CLIENT_SECRET` | Yes | — | Intuit Developer app Client Secret |
| `QBO_ACCESS_TOKEN` | Yes | — | Current access token (refreshed automatically on 401) |
| `QBO_REFRESH_TOKEN` | Yes | — | Current refresh token |
| `QBO_REALM_ID` | Yes | — | QuickBooks Company ID |
| `QBO_ENVIRONMENT` | No | `sandbox` | `sandbox` or `production` |
| `QBO_BASE_URL` | No | derived | Override API base URL (used in tests) |
| `QBO_TOKEN_URL` | No | Intuit default | Override token endpoint (used in tests) |
| `QBO_DRY_RUN` | No | `false` | When `true` (or `1`, `yes`), write tools return a preview instead of calling QBO |
| `QBO_ATTACH_ALLOWED_DIRS` | No | unrestricted | Colon-separated prefixes for allowed `upload_receipt` paths |
| `BOC_BASE_URL` | No | `https://www.bankofcanada.ca` | Override Bank of Canada Valet API base URL (used by `get_boc_rate`; set for testing against a mock) |

## Dry-run Mode

Set `QBO_DRY_RUN=true` (or `1`, or `yes`) to make `create_purchase`, `delete_purchase`, and `upload_receipt` return a `{ dryRun: true, wouldSend: {...} }` preview instead of calling QBO. Strongly recommended for the first run against a production realm.

## Session Tags & Rollback

Every `create_purchase` call requires a `sessionTag` in `YYYY-MM-DD-HHmm` format (e.g. `2026-04-10-0930`). The tag is embedded in the `PrivateNote` field as `... | sess:2026-04-10-0930`.

To roll back a batch, use the dedicated `rollback_session` tool:

```
rollback_session({ sessionTag: "2026-04-10-0930" })
```

Or manually: query purchases with `search_purchases({...})`, filter client-side by `PrivateNote` containing `sess:2026-04-10-0930`, then call `delete_purchase({ id, syncToken })` for each.

## Multi-currency

For any transaction in a currency other than the home currency, **both `currencyCode` AND `exchangeRate` must be provided** to `create_purchase`. The tool refuses to guess or default to today's rate. This ensures historical catch-up entries use the actual rate in effect on the transaction date.

Recommended FX source for historical CAD/USD (Canadian users): **Bank of Canada Valet API** (CRA-accepted, free, no auth). Use the `get_boc_rate` tool:

```
get_boc_rate({ date: "2025-11-04" })
```

This returns the official `FXUSDCAD` observation for the given date (or the nearest prior business day), which you can pass directly as `exchangeRate` in `create_purchase`.

## Development

```bash
git clone https://github.com/mohammadfarooqi/qbo-receipts-mcp.git
cd qbo-receipts-mcp
npm install
npm run build
npm run test
```

Tests run against a local mock HTTP server (zero external dependencies). No sandbox access or real credentials required.

## Project Structure

```
src/
  index.ts              # MCP server entry — tool registration, stdio
  oauth-cli.ts          # Standalone OAuth helper (bin entry)
  client.ts             # QBO HTTP client: OAuth refresh, rate limit, multipart upload
  schema.ts             # Zod schemas for all entities and API responses
  session.ts            # Session tag validation, memo marker formatting
  util/dry-run.ts       # QBO_DRY_RUN env var check
  tools/                # One file per tool
    get-company-info.ts
    search-purchases.ts
    create-purchase.ts
    delete-purchase.ts
    upload-receipt.ts
test/
  mock-server.ts        # Local HTTP server mocking QBO
  unit.test.ts          # Unit tests (schema, client, session, tools)
  integration.test.ts   # End-to-end MCP tests via stdio client
```

## Security

See [SECURITY.md](SECURITY.md) for disclosure policy.

Known hardening opportunities are tracked in [docs/backlog.md](docs/backlog.md). The v0.1.0 release includes fixes for symlink following (SEC-1) and allowlist prefix confusion (SEC-2). Deferred to v0.2.0: TOCTOU between statSync/readFileSync (SEC-3), no MIME sniffing (SEC-4), Unicode control chars in filenames (SEC-5).

## Known Limitations (v0.2.0)

- **No npm publish yet.** v0.2.0 is published via GitHub release only. Install via `git clone` or `npm install github:mohammadfarooqi/qbo-receipts-mcp#v0.2.0`.
- **DOCX/XLSX disambiguation.** The mime-sniff helper verifies ZIP container headers for OfficeXML formats but does not inspect the inner directory structure. A generic ZIP file declared as DOCX will pass.
- **SEC-10 (Unicode homoglyph bypass in `query` tool).** Fullwidth Latin characters bypass the mutation-keyword regex. Non-exploitable because QBO's `/query` endpoint is a read-only GET.
- **No batch endpoint.** `rollback_session` loops over individual soft-delete calls rather than using QBO's `/batch` endpoint. Fine at current scale; revisit if rollback batches exceed 100 rows.
- **No MCP registry entry.** `server.json` for the Anthropic MCP registry is pending.
- **Purchase entity only.** The QBO API's `Bill` entity (vendor invoices with A/P) is NOT supported. This MCP focuses on immediate-payment "Expense" transactions.
- **No bank feed integration.** If your QBO company has a bank feed connected, API-created Purchases may conflict with feed items on the same date/amount. Check feed state before bulk-creating expenses.
- **OAuth helper writes to `.env`.** If you prefer Keychain or another secret store, wrap the tool accordingly.

## Contributing

Contributions welcome. Please open an issue before starting significant work.

**To submit a PR:**

1. Fork, create a feature branch
2. Make your changes with tests
3. Run `npm run test` and `npm audit --audit-level=high`
4. Open a PR with a description

## License

MIT — see [LICENSE](LICENSE).
