import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildAuthUrl } from "../src/oauth-cli.js";

describe("oauth-cli — buildAuthUrl", () => {
    it("constructs the Intuit authorization URL with correct params", () => {
        const url = buildAuthUrl({
            clientId: "ABCD1234",
            redirectUri: "http://localhost:8000/callback",
            state: "xyz-state-nonce",
            scope: "com.intuit.quickbooks.accounting"
        });
        const parsed = new URL(url);
        assert.equal(parsed.origin, "https://appcenter.intuit.com");
        assert.equal(parsed.pathname, "/connect/oauth2");
        assert.equal(parsed.searchParams.get("client_id"), "ABCD1234");
        assert.equal(parsed.searchParams.get("redirect_uri"), "http://localhost:8000/callback");
        assert.equal(parsed.searchParams.get("state"), "xyz-state-nonce");
        assert.equal(parsed.searchParams.get("scope"), "com.intuit.quickbooks.accounting");
        assert.equal(parsed.searchParams.get("response_type"), "code");
    });
});

import { exchangeCodeForTokens } from "../src/oauth-cli.js";
import { createServer, Server } from "node:http";

describe("oauth-cli — exchangeCodeForTokens", () => {
    it("POSTs to the Intuit token endpoint with Basic auth and returns tokens", async () => {
        let capturedAuth = "";
        let capturedBody = "";
        const server: Server = createServer((req, res) => {
            capturedAuth = req.headers.authorization || "";
            const chunks: Buffer[] = [];
            req.on("data", (c) => chunks.push(c));
            req.on("end", () => {
                capturedBody = Buffer.concat(chunks).toString();
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    access_token: "access-xyz",
                    refresh_token: "refresh-xyz",
                    expires_in: 3600,
                    x_refresh_token_expires_in: 8726400,
                    token_type: "bearer"
                }));
            });
        });
        await new Promise<void>((r) => server.listen(0, r));
        const port = (server.address() as { port: number }).port;
        const tokenUrl = `http://localhost:${port}/oauth2/v1/tokens/bearer`;

        try {
            const tokens = await exchangeCodeForTokens({
                tokenUrl,
                clientId: "ABCD1234",
                clientSecret: "SECRET5678",
                code: "auth-code-abc",
                redirectUri: "http://localhost:8000/callback"
            });
            assert.equal(tokens.access_token, "access-xyz");
            assert.equal(tokens.refresh_token, "refresh-xyz");
            assert.equal(tokens.expires_in, 3600);

            const expected = "Basic " + Buffer.from("ABCD1234:SECRET5678").toString("base64");
            assert.equal(capturedAuth, expected);

            const params = new URLSearchParams(capturedBody);
            assert.equal(params.get("grant_type"), "authorization_code");
            assert.equal(params.get("code"), "auth-code-abc");
            assert.equal(params.get("redirect_uri"), "http://localhost:8000/callback");
        } finally {
            await new Promise<void>((r) => server.close(() => r()));
        }
    });
});

import { writeTokensToEnv } from "../src/oauth-cli.js";
import { readFileSync as readFileSync2, writeFileSync as writeFileSync2, unlinkSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("oauth-cli — writeTokensToEnv", () => {
    it("appends tokens to a new .env file", () => {
        const dir = mkdtempSync(join(tmpdir(), "qbo-mcp-test-"));
        const envPath = join(dir, ".env");
        try {
            writeTokensToEnv(envPath, {
                access_token: "aaa",
                refresh_token: "rrr",
                expires_in: 3600,
                x_refresh_token_expires_in: 8726400,
                token_type: "bearer"
            }, "123456789");

            const content = readFileSync2(envPath, "utf8");
            assert.match(content, /QBO_ACCESS_TOKEN=aaa/);
            assert.match(content, /QBO_REFRESH_TOKEN=rrr/);
            assert.match(content, /QBO_REALM_ID=123456789/);
        } finally {
            unlinkSync(envPath);
        }
    });

    it("replaces existing QBO_ lines without touching other lines", () => {
        const dir = mkdtempSync(join(tmpdir(), "qbo-mcp-test-"));
        const envPath = join(dir, ".env");
        try {
            writeFileSync2(envPath, "OTHER_VAR=keepme\nQBO_ACCESS_TOKEN=old\nQBO_REFRESH_TOKEN=oldr\nQBO_REALM_ID=old\n");
            writeTokensToEnv(envPath, {
                access_token: "new-access",
                refresh_token: "new-refresh",
                expires_in: 3600,
                x_refresh_token_expires_in: 8726400,
                token_type: "bearer"
            }, "new-realm");

            const content = readFileSync2(envPath, "utf8");
            assert.match(content, /OTHER_VAR=keepme/);
            assert.match(content, /QBO_ACCESS_TOKEN=new-access/);
            assert.match(content, /QBO_REFRESH_TOKEN=new-refresh/);
            assert.match(content, /QBO_REALM_ID=new-realm/);
            assert.doesNotMatch(content, /QBO_ACCESS_TOKEN=old/);
        } finally {
            unlinkSync(envPath);
        }
    });
});

import { FaultSchema, TokenRefreshResponseSchema } from "../src/schema.js";

describe("schema — FaultSchema", () => {
    it("parses a valid QBO Fault error response", () => {
        const result = FaultSchema.parse({
            Fault: {
                Error: [{
                    Message: "Invalid Reference Id",
                    Detail: "Something is wrong",
                    code: "2500",
                    element: "Account"
                }],
                type: "ValidationFault"
            },
            time: "2026-04-10T12:00:00.000Z"
        });
        assert.equal(result.Fault.Error[0].code, "2500");
    });
});

describe("schema — TokenRefreshResponseSchema", () => {
    it("parses a valid token refresh response", () => {
        const result = TokenRefreshResponseSchema.parse({
            access_token: "new-access",
            refresh_token: "new-refresh",
            expires_in: 3600,
            x_refresh_token_expires_in: 8726400,
            token_type: "bearer"
        });
        assert.equal(result.access_token, "new-access");
    });
});

import { QboClient } from "../src/client.js";
import { createServer as createHttpServer2 } from "node:http";

describe("client — refreshAccessToken", () => {
    it("POSTs refresh_token grant and updates stored tokens", async () => {
        let capturedAuth = "";
        let capturedBody = "";
        const server = createHttpServer2((req, res) => {
            capturedAuth = req.headers.authorization || "";
            const chunks: Buffer[] = [];
            req.on("data", c => chunks.push(c));
            req.on("end", () => {
                capturedBody = Buffer.concat(chunks).toString();
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    access_token: "refreshed-access",
                    refresh_token: "rotated-refresh",
                    expires_in: 3600,
                    x_refresh_token_expires_in: 8726400,
                    token_type: "bearer"
                }));
            });
        });
        await new Promise<void>(r => server.listen(0, r));
        const port = (server.address() as { port: number }).port;

        try {
            const client = new QboClient({
                clientId: "CID",
                clientSecret: "SEC",
                accessToken: "old-access",
                refreshToken: "old-refresh",
                realmId: "REALM",
                tokenUrl: `http://localhost:${port}/oauth2/v1/tokens/bearer`,
                baseUrl: "http://unused"
            });
            await client.refreshAccessToken();

            assert.equal(client.getAccessToken(), "refreshed-access");
            assert.equal(client.getRefreshToken(), "rotated-refresh");

            const expectedAuth = "Basic " + Buffer.from("CID:SEC").toString("base64");
            assert.equal(capturedAuth, expectedAuth);

            const params = new URLSearchParams(capturedBody);
            assert.equal(params.get("grant_type"), "refresh_token");
            assert.equal(params.get("refresh_token"), "old-refresh");
        } finally {
            await new Promise<void>(r => server.close(() => r()));
        }
    });
});

describe("client — rate limiter", () => {
    it("serializes requests with minimum interval", async () => {
        const client = new QboClient({
            clientId: "c", clientSecret: "s",
            accessToken: "a", refreshToken: "r",
            realmId: "R", tokenUrl: "http://unused",
            baseUrl: "http://unused",
            minIntervalMs: 50
        });

        const timestamps: number[] = [];
        const runs = [0, 1, 2].map(async () => {
            await client.enqueue(async () => {
                timestamps.push(Date.now());
                return null;
            });
        });
        await Promise.all(runs);

        assert.equal(timestamps.length, 3);
        assert.ok(timestamps[1] - timestamps[0] >= 45, `gap 1 too small: ${timestamps[1] - timestamps[0]}`);
        assert.ok(timestamps[2] - timestamps[1] >= 45, `gap 2 too small: ${timestamps[2] - timestamps[1]}`);
    });
});

describe("client — fetchJson with 401 auto-refresh", () => {
    it("refreshes access token on 401 and retries once", async () => {
        let callCount = 0;
        let tokenCallCount = 0;
        const apiServer = createHttpServer2((req, res) => {
            if (req.url === "/oauth2/v1/tokens/bearer") {
                tokenCallCount++;
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    access_token: "new-access",
                    refresh_token: "new-refresh",
                    expires_in: 3600,
                    x_refresh_token_expires_in: 8726400,
                    token_type: "bearer"
                }));
                return;
            }
            callCount++;
            const auth = req.headers.authorization || "";
            if (auth === "Bearer old-access") {
                res.writeHead(401);
                res.end(JSON.stringify({ error: "unauthorized" }));
                return;
            }
            if (auth === "Bearer new-access") {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, calls: callCount }));
                return;
            }
            res.writeHead(500);
            res.end();
        });
        await new Promise<void>(r => apiServer.listen(0, r));
        const port = (apiServer.address() as { port: number }).port;

        try {
            const client = new QboClient({
                clientId: "c", clientSecret: "s",
                accessToken: "old-access", refreshToken: "r",
                realmId: "R",
                tokenUrl: `http://localhost:${port}/oauth2/v1/tokens/bearer`,
                baseUrl: `http://localhost:${port}`,
                minIntervalMs: 0
            });
            const result = await client.fetchJson("/v3/company/R/companyinfo/R") as { ok: boolean };
            assert.equal(result.ok, true);
            assert.equal(tokenCallCount, 1, "should refresh exactly once");
            assert.equal(client.getAccessToken(), "new-access");
        } finally {
            await new Promise<void>(r => apiServer.close(() => r()));
        }
    });
});

describe("client — uploadAttachable", () => {
    it("POSTs multipart body with file_metadata_01 and file_content_01 parts", async () => {
        let capturedContentType = "";
        let capturedBody = Buffer.alloc(0);
        const apiServer = createHttpServer2((req, res) => {
            capturedContentType = req.headers["content-type"] || "";
            const chunks: Buffer[] = [];
            req.on("data", c => chunks.push(c));
            req.on("end", () => {
                capturedBody = Buffer.concat(chunks);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    AttachableResponse: [{
                        Attachable: { Id: "ATT1", FileName: "receipt.pdf" }
                    }],
                    time: "2026-04-10T00:00:00Z"
                }));
            });
        });
        await new Promise<void>(r => apiServer.listen(0, r));
        const port = (apiServer.address() as { port: number }).port;

        try {
            const client = new QboClient({
                clientId: "c", clientSecret: "s",
                accessToken: "a", refreshToken: "r",
                realmId: "R",
                tokenUrl: "http://unused",
                baseUrl: `http://localhost:${port}`,
                minIntervalMs: 0
            });
            const pdfBytes = Buffer.from("%PDF-1.4\n%fake\n");
            const result = await client.uploadAttachable({
                fileName: "receipt.pdf",
                contentType: "application/pdf",
                fileBytes: pdfBytes,
                entityType: "Purchase",
                entityId: "42"
            });
            assert.ok(result.Id, "should return Attachable Id");

            assert.match(capturedContentType, /^multipart\/form-data; boundary=/);
            const bodyText = capturedBody.toString("binary");
            assert.match(bodyText, /Content-Disposition: form-data; name="file_metadata_01"/);
            assert.match(bodyText, /Content-Disposition: form-data; name="file_content_01"; filename="receipt.pdf"/);
            assert.match(bodyText, /"type": "Purchase"/);
            assert.match(bodyText, /"value": "42"/);
            assert.match(bodyText, /%PDF-1\.4/);
        } finally {
            await new Promise<void>(r => apiServer.close(() => r()));
        }
    });
});

import { clientFromEnv } from "../src/client.js";

describe("client — clientFromEnv", () => {
    it("constructs a QboClient from environment variables", () => {
        const env = {
            QBO_CLIENT_ID: "cid",
            QBO_CLIENT_SECRET: "sec",
            QBO_ACCESS_TOKEN: "at",
            QBO_REFRESH_TOKEN: "rt",
            QBO_REALM_ID: "999",
            QBO_ENVIRONMENT: "sandbox"
        };
        const client = clientFromEnv(env);
        assert.equal(client.getRealmId(), "999");
        assert.ok(client.getBaseUrl().includes("sandbox-quickbooks"));
    });

    it("throws on missing required env", () => {
        assert.throws(() => clientFromEnv({} as Record<string, string>), /QBO_CLIENT_ID/);
    });

    it("uses production base URL when QBO_ENVIRONMENT=production", () => {
        const env = {
            QBO_CLIENT_ID: "cid", QBO_CLIENT_SECRET: "sec",
            QBO_ACCESS_TOKEN: "at", QBO_REFRESH_TOKEN: "rt",
            QBO_REALM_ID: "999",
            QBO_ENVIRONMENT: "production"
        };
        const client = clientFromEnv(env);
        assert.equal(client.getBaseUrl(), "https://quickbooks.api.intuit.com");
    });

    it("honors QBO_BASE_URL override for tests", () => {
        const env = {
            QBO_CLIENT_ID: "cid", QBO_CLIENT_SECRET: "sec",
            QBO_ACCESS_TOKEN: "at", QBO_REFRESH_TOKEN: "rt",
            QBO_REALM_ID: "999",
            QBO_BASE_URL: "http://localhost:1234"
        };
        const client = clientFromEnv(env);
        assert.equal(client.getBaseUrl(), "http://localhost:1234");
    });
});

import { validateSessionTag, formatMemoMarker } from "../src/session.js";

describe("session — validateSessionTag", () => {
    it("accepts valid YYYY-MM-DD-HHmm", () => {
        assert.equal(validateSessionTag("2026-04-10-0930"), "2026-04-10-0930");
    });
    it("rejects missing parts", () => {
        assert.throws(() => validateSessionTag("2026-04-10"), /Invalid session tag/);
    });
    it("rejects wrong format", () => {
        assert.throws(() => validateSessionTag("April-10-0930"), /Invalid session tag/);
    });
    it("rejects empty", () => {
        assert.throws(() => validateSessionTag(""), /Invalid session tag/);
    });
});

describe("session — formatMemoMarker", () => {
    it("formats with source, id, and session tag", () => {
        assert.equal(
            formatMemoMarker({ source: "gmail", sourceId: "abc123", sessionTag: "2026-04-10-0930" }),
            "auto:gmail:abc123 | sess:2026-04-10-0930"
        );
    });
    it("appends to an existing note", () => {
        assert.equal(
            formatMemoMarker({
                source: "pp",
                sourceId: "TXN1",
                sessionTag: "2026-04-10-0930",
                existingNote: "Client dinner"
            }),
            "Client dinner | auto:pp:TXN1 | sess:2026-04-10-0930"
        );
    });
});

import { isDryRun } from "../src/util/dry-run.js";

describe("dry-run", () => {
    it("returns true for QBO_DRY_RUN=true", () => {
        assert.equal(isDryRun({ QBO_DRY_RUN: "true" }), true);
    });
    it("returns true for QBO_DRY_RUN=TRUE (case-insensitive)", () => {
        assert.equal(isDryRun({ QBO_DRY_RUN: "TRUE" }), true);
    });
    it("returns true for QBO_DRY_RUN=1", () => {
        assert.equal(isDryRun({ QBO_DRY_RUN: "1" }), true);
    });
    it("returns false when unset", () => {
        assert.equal(isDryRun({}), false);
    });
    it("returns false for QBO_DRY_RUN=false", () => {
        assert.equal(isDryRun({ QBO_DRY_RUN: "false" }), false);
    });
});

import { CompanyInfoSchema, PurchaseSchema, PurchaseQueryResponseSchema } from "../src/schema.js";

describe("schema — CompanyInfoSchema", () => {
    it("parses a valid CompanyInfo response envelope", () => {
        const result = CompanyInfoSchema.parse({
            CompanyInfo: {
                Id: "1",
                SyncToken: "0",
                CompanyName: "Uqaab Consultants Inc.",
                Country: "CA",
                SupportedLanguages: "en"
            },
            time: "2026-04-10T00:00:00Z"
        });
        assert.equal(result.CompanyInfo.CompanyName, "Uqaab Consultants Inc.");
    });
});

describe("schema — PurchaseSchema", () => {
    it("parses a USD Purchase with ExchangeRate", () => {
        const result = PurchaseSchema.parse({
            Id: "42",
            SyncToken: "0",
            TxnDate: "2025-11-04",
            PaymentType: "CreditCard",
            AccountRef: { value: "1102", name: "USD Credit Card" },
            CurrencyRef: { value: "USD", name: "US Dollar" },
            ExchangeRate: 1.4090,
            TotalAmt: 42.00,
            PrivateNote: "auto:pp:ABC | sess:2026-04-10-0930",
            Line: [{
                Amount: 42.00,
                DetailType: "AccountBasedExpenseLineDetail",
                AccountBasedExpenseLineDetail: {
                    AccountRef: { value: "80", name: "Subscriptions" }
                }
            }]
        });
        assert.equal(result.Id, "42");
        assert.equal(result.ExchangeRate, 1.4090);
    });
});

describe("schema — PurchaseQueryResponseSchema", () => {
    it("parses a query response with purchases", () => {
        const result = PurchaseQueryResponseSchema.parse({
            QueryResponse: {
                Purchase: [{
                    Id: "42",
                    SyncToken: "0",
                    TxnDate: "2025-11-04",
                    PaymentType: "CreditCard",
                    AccountRef: { value: "1102" },
                    TotalAmt: 42.00,
                    Line: [{
                        Amount: 42.00,
                        DetailType: "AccountBasedExpenseLineDetail",
                        AccountBasedExpenseLineDetail: { AccountRef: { value: "80" } }
                    }]
                }],
                startPosition: 1,
                maxResults: 1
            },
            time: "2026-04-10T00:00:00Z"
        });
        assert.equal(result.QueryResponse.Purchase?.length, 1);
    });

    it("parses an empty query response", () => {
        const result = PurchaseQueryResponseSchema.parse({
            QueryResponse: { startPosition: 1, maxResults: 0 },
            time: "2026-04-10T00:00:00Z"
        });
        assert.equal(result.QueryResponse.Purchase, undefined);
    });

    it("parses a Purchase with ItemBasedExpenseLineDetail line (read-side leniency)", () => {
        // Regression test for the bug found against real sandbox data on 2026-04-10:
        // QBO returns Purchases with multiple DetailType values (AccountBasedExpenseLineDetail,
        // ItemBasedExpenseLineDetail, etc). Read-side parsing must accept any DetailType.
        const result = PurchaseQueryResponseSchema.parse({
            QueryResponse: {
                Purchase: [{
                    Id: "99",
                    SyncToken: "0",
                    TxnDate: "2026-03-15",
                    PaymentType: "Check",
                    AccountRef: { value: "38" },
                    TotalAmt: 250,
                    Line: [{
                        Id: "1",
                        Amount: 250,
                        DetailType: "ItemBasedExpenseLineDetail",
                        ItemBasedExpenseLineDetail: {
                            ItemRef: { value: "1", name: "Landscaping" },
                            Qty: 1,
                            UnitPrice: 250
                        }
                    }]
                }],
                startPosition: 1,
                maxResults: 1
            },
            time: "2026-04-10T00:00:00Z"
        });
        assert.equal(result.QueryResponse.Purchase?.[0].Line[0].DetailType, "ItemBasedExpenseLineDetail");
    });

    it("parses a Purchase with an unknown DetailType line (future-proof passthrough)", () => {
        const result = PurchaseQueryResponseSchema.parse({
            QueryResponse: {
                Purchase: [{
                    Id: "100",
                    SyncToken: "0",
                    TxnDate: "2026-03-15",
                    PaymentType: "CreditCard",
                    AccountRef: { value: "38" },
                    TotalAmt: 100,
                    Line: [{
                        Amount: 100,
                        DetailType: "SomeFutureLineDetail",
                        SomeFutureLineDetail: { foo: "bar" }
                    }]
                }],
                startPosition: 1,
                maxResults: 1
            },
            time: "2026-04-10T00:00:00Z"
        });
        assert.equal(result.QueryResponse.Purchase?.[0].Line[0].DetailType, "SomeFutureLineDetail");
    });
});

import { buildPurchaseQuery } from "../src/tools/search-purchases.js";

describe("search-purchases — buildPurchaseQuery", () => {
    it("builds a base SELECT with no filters", () => {
        const q = buildPurchaseQuery({});
        assert.equal(q, "SELECT * FROM Purchase ORDER BY TxnDate DESC MAXRESULTS 100");
    });
    it("adds date range filters", () => {
        const q = buildPurchaseQuery({ txnDateAfter: "2025-01-01", txnDateBefore: "2025-12-31" });
        assert.match(q, /TxnDate >= '2025-01-01'/);
        assert.match(q, /TxnDate <= '2025-12-31'/);
    });
    it("adds exact amount filter", () => {
        const q = buildPurchaseQuery({ totalAmt: 42.00 });
        assert.match(q, /TotalAmt = '42\.00'/);
    });
    it("adds currency filter", () => {
        const q = buildPurchaseQuery({ currencyCode: "USD" });
        assert.match(q, /CurrencyRef = 'USD'/);
    });
    it("respects max results", () => {
        const q = buildPurchaseQuery({ maxResults: 50 });
        assert.match(q, /MAXRESULTS 50$/);
    });
    it("rejects SQL-injection-looking input in currency code", () => {
        assert.throws(() => buildPurchaseQuery({ currencyCode: "USD' OR 1=1--" }), /Invalid/);
    });
});

import { buildPurchasePayload } from "../src/tools/create-purchase.js";

describe("create-purchase — buildPurchasePayload", () => {
    it("builds a minimal CAD purchase with memo marker", () => {
        const payload = buildPurchasePayload({
            txnDate: "2026-01-15",
            paymentType: "CreditCard",
            paymentAccountId: "1101",
            totalAmt: 113.00,
            expenseAccountId: "80",
            source: "gmail",
            sourceId: "MSG123",
            sessionTag: "2026-04-10-0930"
        });
        assert.equal(payload.TxnDate, "2026-01-15");
        assert.equal(payload.PaymentType, "CreditCard");
        assert.equal((payload.AccountRef as { value: string }).value, "1101");
        assert.equal((payload.Line as Array<{ Amount: number }>)[0].Amount, 113.00);
        assert.equal(((payload.Line as Array<{ AccountBasedExpenseLineDetail: { AccountRef: { value: string } } }>)[0]).AccountBasedExpenseLineDetail.AccountRef.value, "80");
        assert.equal(payload.PrivateNote, "auto:gmail:MSG123 | sess:2026-04-10-0930");
    });
    it("includes CurrencyRef and ExchangeRate when provided", () => {
        const payload = buildPurchasePayload({
            txnDate: "2025-11-04",
            paymentType: "CreditCard",
            paymentAccountId: "1102",
            totalAmt: 42.00,
            expenseAccountId: "80",
            source: "pp",
            sourceId: "TXN1",
            sessionTag: "2026-04-10-0930",
            currencyCode: "USD",
            exchangeRate: 1.4090
        });
        assert.equal((payload.CurrencyRef as { value: string })?.value, "USD");
        assert.equal(payload.ExchangeRate, 1.4090);
    });
    it("includes vendor entity ref when provided", () => {
        const payload = buildPurchasePayload({
            txnDate: "2026-01-15",
            paymentType: "CreditCard",
            paymentAccountId: "1101",
            totalAmt: 113.00,
            expenseAccountId: "80",
            vendorId: "55",
            source: "manual",
            sourceId: "demo",
            sessionTag: "2026-04-10-0930"
        });
        const ref = payload.EntityRef as { value: string; type: string };
        assert.equal(ref?.value, "55");
        assert.equal(ref?.type, "Vendor");
    });
    it("rejects invalid session tag at build time", () => {
        assert.throws(() => buildPurchasePayload({
            txnDate: "2026-01-15",
            paymentType: "CreditCard",
            paymentAccountId: "1101",
            totalAmt: 113.00,
            expenseAccountId: "80",
            source: "gmail",
            sourceId: "MSG123",
            sessionTag: "bad-tag"
        }), /Invalid session tag/);
    });
    it("rejects USD without ExchangeRate", () => {
        assert.throws(() => buildPurchasePayload({
            txnDate: "2025-11-04",
            paymentType: "CreditCard",
            paymentAccountId: "1102",
            totalAmt: 42.00,
            expenseAccountId: "80",
            source: "pp",
            sourceId: "TXN1",
            sessionTag: "2026-04-10-0930",
            currencyCode: "USD"
        }), /ExchangeRate is required/);
    });
});

import { validateUploadReceiptInput } from "../src/tools/upload-receipt.js";

describe("upload-receipt — validation", () => {
    it("rejects absolute paths outside allowed dirs when allowlist set", () => {
        assert.throws(() => validateUploadReceiptInput({
            filePath: "/etc/passwd.pdf",
            contentType: "application/pdf",
            entityType: "Purchase",
            entityId: "42"
        }, { allowedPrefixes: ["/Users/me/receipts/"] }), /outside allowed/);
    });
    it("rejects path traversal", () => {
        assert.throws(() => validateUploadReceiptInput({
            filePath: "../../../etc/passwd",
            contentType: "application/pdf",
            entityType: "Purchase",
            entityId: "42"
        }, {}), /path traversal/i);
    });
    it("rejects invalid content type", () => {
        assert.throws(() => validateUploadReceiptInput({
            filePath: "/tmp/r.exe",
            contentType: "application/x-msdownload",
            entityType: "Purchase",
            entityId: "42"
        }, {}), /contentType/);
    });
    it("accepts PDF, PNG, JPEG", () => {
        for (const ct of ["application/pdf", "image/png", "image/jpeg"]) {
            assert.doesNotThrow(() => validateUploadReceiptInput({
                filePath: "/tmp/r.pdf",
                contentType: ct,
                entityType: "Purchase",
                entityId: "42"
            }, {}));
        }
    });
    it("rejects filename with double-quote (multipart header injection)", () => {
        assert.throws(() => validateUploadReceiptInput({
            filePath: `/tmp/a"bad".pdf`,
            contentType: "application/pdf",
            entityType: "Purchase",
            entityId: "42"
        }, {}), /Unsafe filename/);
    });
    it("rejects fileNameOverride with CRLF (header injection)", () => {
        assert.throws(() => validateUploadReceiptInput({
            filePath: "/tmp/r.pdf",
            contentType: "application/pdf",
            entityType: "Purchase",
            entityId: "42",
            fileNameOverride: "foo\r\nX-Injected: evil.pdf"
        }, {}), /Unsafe filename/);
    });
    it("rejects fileNameOverride with NUL byte", () => {
        assert.throws(() => validateUploadReceiptInput({
            filePath: "/tmp/r.pdf",
            contentType: "application/pdf",
            entityType: "Purchase",
            entityId: "42",
            fileNameOverride: "foo\0evil.pdf"
        }, {}), /Unsafe filename/);
    });
    it("rejects fileNameOverride with backslash", () => {
        assert.throws(() => validateUploadReceiptInput({
            filePath: "/tmp/r.pdf",
            contentType: "application/pdf",
            entityType: "Purchase",
            entityId: "42",
            fileNameOverride: "foo\\bar.pdf"
        }, {}), /Unsafe filename/);
    });
    it("accepts normal filenames with spaces, hyphens, underscores, dots", () => {
        assert.doesNotThrow(() => validateUploadReceiptInput({
            filePath: "/tmp/AWS invoice 2025-11-04.pdf",
            contentType: "application/pdf",
            entityType: "Purchase",
            entityId: "42"
        }, {}));
    });
});

describe("upload-receipt — hardening (SEC-1, SEC-2)", () => {
    it("rejects allowlist prefix without trailing slash that would allow sibling dirs (SEC-2)", () => {
        // Prefix "/Users/me/receipts" should NOT allow "/Users/me/receipts-leak/foo.pdf"
        assert.throws(() => validateUploadReceiptInput({
            filePath: "/Users/me/receipts-leak/foo.pdf",
            contentType: "application/pdf",
            entityType: "Purchase",
            entityId: "42"
        }, { allowedPrefixes: ["/Users/me/receipts"] }), /outside allowed/);
    });

    it("still allows legitimate files under the (now properly bounded) prefix", () => {
        assert.doesNotThrow(() => validateUploadReceiptInput({
            filePath: "/Users/me/receipts/aws.pdf",
            contentType: "application/pdf",
            entityType: "Purchase",
            entityId: "42"
        }, { allowedPrefixes: ["/Users/me/receipts"] }));
    });

    it("allows a file reached via a symlink that resolves inside the allowlist", async () => {
        const { mkdtempSync, writeFileSync, symlinkSync, rmSync, realpathSync } = await import("node:fs");
        const { tmpdir } = await import("node:os");
        const { join } = await import("node:path");
        const dir = realpathSync(mkdtempSync(join(tmpdir(), "qbo-mcp-sym-ok-")));
        const real = join(dir, "real.pdf");
        const link = join(dir, "link.pdf");
        writeFileSync(real, Buffer.from("%PDF-1.4\n"));
        symlinkSync(real, link);
        try {
            // Should not throw — the realpath of link.pdf is real.pdf which is under `dir`.
            const { uploadReceipt } = await import("../src/tools/upload-receipt.js");
            const fakeClient = {
                getRealmId: () => "REALM",
                uploadAttachable: async () => ({ Id: "ATT1", FileName: "real.pdf" })
            };
            const result = await uploadReceipt(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                fakeClient as any,
                {
                    filePath: link,
                    contentType: "application/pdf",
                    entityType: "Purchase",
                    entityId: "42"
                },
                { QBO_ATTACH_ALLOWED_DIRS: dir }
            );
            assert.ok(result);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("rejects a symlink whose target escapes the allowlist (SEC-1)", async () => {
        const { mkdtempSync, writeFileSync, symlinkSync, rmSync, realpathSync } = await import("node:fs");
        const { tmpdir } = await import("node:os");
        const { join } = await import("node:path");
        const allowed = realpathSync(mkdtempSync(join(tmpdir(), "qbo-mcp-sym-in-")));
        const outside = realpathSync(mkdtempSync(join(tmpdir(), "qbo-mcp-sym-out-")));
        const outsideFile = join(outside, "secret.pdf");
        const link = join(allowed, "link.pdf");
        writeFileSync(outsideFile, Buffer.from("%PDF-1.4\nfake-secret\n"));
        symlinkSync(outsideFile, link);
        try {
            const { uploadReceipt } = await import("../src/tools/upload-receipt.js");
            const fakeClient = {
                getRealmId: () => "REALM",
                uploadAttachable: async () => ({ Id: "ATT1", FileName: "link.pdf" })
            };
            await assert.rejects(
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                uploadReceipt(fakeClient as any, {
                    filePath: link,
                    contentType: "application/pdf",
                    entityType: "Purchase",
                    entityId: "42"
                }, { QBO_ATTACH_ALLOWED_DIRS: allowed }),
                /outside allowed|escapes|canonical/i
            );
        } finally {
            rmSync(allowed, { recursive: true, force: true });
            rmSync(outside, { recursive: true, force: true });
        }
    });
});

import { AccountSchema, AccountQueryResponseSchema } from "../src/schema.js";

describe("schema — AccountSchema", () => {
    it("accepts a minimal Account", () => {
        const parsed = AccountSchema.parse({
            Id: "42",
            SyncToken: "0",
            Name: "Chequing",
            AccountType: "Bank",
            Active: true
        });
        assert.equal(parsed.Id, "42");
        assert.equal(parsed.AccountType, "Bank");
    });

    it("accepts an Account with currency and sub-account", () => {
        const parsed = AccountSchema.parse({
            Id: "1102",
            SyncToken: "3",
            Name: "USD Credit Card",
            AccountType: "Credit Card",
            AccountSubType: "CreditCard",
            Active: true,
            CurrencyRef: { value: "USD", name: "United States Dollar" },
            CurrentBalance: -1234.56,
            Classification: "Liability"
        });
        assert.equal(parsed.CurrencyRef?.value, "USD");
    });

    it("passes through unknown fields without failing", () => {
        const parsed = AccountSchema.parse({
            Id: "9",
            SyncToken: "0",
            Name: "X",
            AccountType: "Expense",
            Active: true,
            FullyQualifiedName: "Operating Expenses:X",
            SomeNewFutureField: "ok"
        });
        assert.equal(parsed.Id, "9");
        assert.equal((parsed as Record<string, unknown>)["SomeNewFutureField"], "ok");
    });
});

describe("schema — AccountQueryResponseSchema", () => {
    it("accepts a wrapped query response", () => {
        const parsed = AccountQueryResponseSchema.parse({
            QueryResponse: {
                Account: [
                    { Id: "1", SyncToken: "0", Name: "A", AccountType: "Bank", Active: true }
                ],
                startPosition: 1,
                maxResults: 1
            },
            time: "2026-04-10T00:00:00Z"
        });
        assert.equal(parsed.QueryResponse.Account?.length, 1);
    });

    it("accepts an empty QueryResponse (no Account key)", () => {
        const parsed = AccountQueryResponseSchema.parse({
            QueryResponse: { startPosition: 1, maxResults: 0 }
        });
        assert.equal(parsed.QueryResponse.Account, undefined);
    });
});

import { VendorSchema, VendorResponseSchema, VendorQueryResponseSchema } from "../src/schema.js";

describe("schema — VendorSchema", () => {
    it("accepts a minimal active vendor", () => {
        const parsed = VendorSchema.parse({
            Id: "77",
            SyncToken: "0",
            DisplayName: "Acme Corp",
            Active: true
        });
        assert.equal(parsed.DisplayName, "Acme Corp");
    });

    it("accepts a USD vendor with CurrencyRef and addresses", () => {
        const parsed = VendorSchema.parse({
            Id: "78",
            SyncToken: "2",
            DisplayName: "Stripe Inc. (USD)",
            CompanyName: "Stripe, Inc.",
            Active: true,
            CurrencyRef: { value: "USD", name: "United States Dollar" },
            PrimaryEmailAddr: { Address: "billing@stripe.com" },
            BillAddr: {
                Line1: "510 Townsend St",
                City: "San Francisco",
                CountrySubDivisionCode: "CA",
                PostalCode: "94103",
                Country: "US",
                UnknownAddrField: "x"
            }
        });
        assert.equal(parsed.CurrencyRef?.value, "USD");
        assert.equal(parsed.BillAddr?.City, "San Francisco");
        assert.equal((parsed.BillAddr as Record<string, unknown>)["UnknownAddrField"], "x");
    });

    it("passes through unknown fields", () => {
        const parsed = VendorSchema.parse({
            Id: "9",
            SyncToken: "0",
            DisplayName: "X",
            Active: true,
            FutureField: 42
        });
        assert.equal(parsed.Id, "9");
        assert.equal((parsed as Record<string, unknown>)["FutureField"], 42);
    });
});

describe("schema — VendorResponseSchema", () => {
    it("accepts a single-vendor response", () => {
        const parsed = VendorResponseSchema.parse({
            Vendor: { Id: "1", SyncToken: "0", DisplayName: "V", Active: true },
            time: "2026-04-10T00:00:00Z"
        });
        assert.equal(parsed.Vendor.Id, "1");
    });
});

describe("schema — VendorQueryResponseSchema", () => {
    it("accepts a wrapped query response", () => {
        const parsed = VendorQueryResponseSchema.parse({
            QueryResponse: {
                Vendor: [
                    { Id: "1", SyncToken: "0", DisplayName: "A", Active: true },
                    { Id: "2", SyncToken: "0", DisplayName: "B", Active: false }
                ],
                startPosition: 1,
                maxResults: 2
            }
        });
        assert.equal(parsed.QueryResponse.Vendor?.length, 2);
    });

    it("accepts empty results", () => {
        const parsed = VendorQueryResponseSchema.parse({
            QueryResponse: { startPosition: 1, maxResults: 0 }
        });
        assert.equal(parsed.QueryResponse.Vendor, undefined);
    });
});

import { buildAccountsQuery, getAccountsInputSchema } from "../src/tools/get-accounts.js";

describe("get-accounts — input validation", () => {
    it("defaults maxResults to 500", () => {
        const parsed = getAccountsInputSchema.parse({});
        assert.equal(parsed.maxResults, 500);
    });

    it("rejects an invalid accountType", () => {
        assert.throws(() => getAccountsInputSchema.parse({ accountType: "'; DROP TABLE" }));
    });

    it("accepts known accountType values", () => {
        for (const t of ["Bank", "Credit Card", "Expense", "Accounts Payable", "Equity"]) {
            const parsed = getAccountsInputSchema.parse({ accountType: t });
            assert.equal(parsed.accountType, t);
        }
    });
});

describe("get-accounts — buildAccountsQuery", () => {
    it("builds SELECT * FROM Account with MAXRESULTS", () => {
        const q = buildAccountsQuery({ maxResults: 500 });
        assert.equal(q, "SELECT * FROM Account ORDER BY Name MAXRESULTS 500");
    });

    it("adds AccountType clause", () => {
        const q = buildAccountsQuery({ accountType: "Bank", maxResults: 500 });
        assert.equal(q, "SELECT * FROM Account WHERE AccountType = 'Bank' ORDER BY Name MAXRESULTS 500");
    });

    it("adds Active clause", () => {
        const q = buildAccountsQuery({ active: true, maxResults: 100 });
        assert.equal(q, "SELECT * FROM Account WHERE Active = true ORDER BY Name MAXRESULTS 100");
    });

    it("combines multiple clauses with AND", () => {
        const q = buildAccountsQuery({ accountType: "Expense", active: true, maxResults: 50 });
        assert.equal(q, "SELECT * FROM Account WHERE AccountType = 'Expense' AND Active = true ORDER BY Name MAXRESULTS 50");
    });
});

import { buildVendorsQuery, searchVendorsInputSchema } from "../src/tools/search-vendors.js";

describe("search-vendors — input validation", () => {
    it("defaults maxResults to 500", () => {
        assert.equal(searchVendorsInputSchema.parse({}).maxResults, 500);
    });

    it("rejects single quotes in namePrefix (SQL injection guard)", () => {
        assert.throws(() => searchVendorsInputSchema.parse({ namePrefix: "O'Brien" }));
    });

    it("rejects percent signs in namePrefix", () => {
        assert.throws(() => searchVendorsInputSchema.parse({ namePrefix: "foo%" }));
    });

    it("accepts a clean namePrefix with spaces, dots, parens, digits", () => {
        const parsed = searchVendorsInputSchema.parse({ namePrefix: "Stripe Inc. (USD) 2024" });
        assert.equal(parsed.namePrefix, "Stripe Inc. (USD) 2024");
    });

    it("rejects lowercase currencyCode", () => {
        assert.throws(() => searchVendorsInputSchema.parse({ currencyCode: "usd" }));
    });
});

describe("search-vendors — buildVendorsQuery", () => {
    it("builds bare query with MAXRESULTS", () => {
        const q = buildVendorsQuery({ maxResults: 500 });
        assert.equal(q, "SELECT * FROM Vendor ORDER BY DisplayName MAXRESULTS 500");
    });

    it("adds a DisplayName LIKE clause for namePrefix", () => {
        const q = buildVendorsQuery({ namePrefix: "Acme", maxResults: 500 });
        assert.equal(q, "SELECT * FROM Vendor WHERE DisplayName LIKE 'Acme%' ORDER BY DisplayName MAXRESULTS 500");
    });

    it("adds currencyCode clause", () => {
        const q = buildVendorsQuery({ currencyCode: "USD", maxResults: 500 });
        assert.equal(q, "SELECT * FROM Vendor WHERE CurrencyRef = 'USD' ORDER BY DisplayName MAXRESULTS 500");
    });

    it("adds Active clause", () => {
        const q = buildVendorsQuery({ active: true, maxResults: 500 });
        assert.equal(q, "SELECT * FROM Vendor WHERE Active = true ORDER BY DisplayName MAXRESULTS 500");
    });

    it("combines all three clauses", () => {
        const q = buildVendorsQuery({ namePrefix: "Stripe", currencyCode: "USD", active: true, maxResults: 100 });
        assert.equal(q, "SELECT * FROM Vendor WHERE DisplayName LIKE 'Stripe%' AND CurrencyRef = 'USD' AND Active = true ORDER BY DisplayName MAXRESULTS 100");
    });
});

import { getVendor, getVendorInputSchema } from "../src/tools/get-vendor.js";

describe("get-vendor — input validation", () => {
    it("requires a non-empty id", () => {
        assert.throws(() => getVendorInputSchema.parse({ id: "" }));
    });

    it("accepts a valid id", () => {
        assert.equal(getVendorInputSchema.parse({ id: "77" }).id, "77");
    });
});

describe("get-vendor — fetches from /vendor/:id", () => {
    it("calls the correct path and parses the response", async () => {
        let capturedPath = "";
        const fake = {
            getRealmId: () => "REALM",
            fetchJson: async (path: string) => {
                capturedPath = path;
                return {
                    Vendor: { Id: "77", SyncToken: "0", DisplayName: "Acme", Active: true },
                    time: "2026-04-10T00:00:00Z"
                };
            }
        } as unknown as import("../src/client.js").QboClient;
        const result = await getVendor(fake, { id: "77" }) as { Vendor: { Id: string } };
        assert.equal(capturedPath, "/v3/company/REALM/vendor/77");
        assert.equal(result.Vendor.Id, "77");
    });
});

import { buildVendorPayload, createVendorInputSchema, createVendor } from "../src/tools/create-vendor.js";

describe("create-vendor — input validation", () => {
    it("requires displayName", () => {
        assert.throws(() => createVendorInputSchema.parse({}));
    });

    it("rejects invalid currencyCode", () => {
        assert.throws(() => createVendorInputSchema.parse({ displayName: "X", currencyCode: "us" }));
    });

    it("accepts a minimal input", () => {
        const parsed = createVendorInputSchema.parse({ displayName: "Acme Corp" });
        assert.equal(parsed.displayName, "Acme Corp");
    });
});

describe("create-vendor — buildVendorPayload", () => {
    it("builds minimal payload", () => {
        const p = buildVendorPayload({ displayName: "Acme Corp" });
        assert.deepEqual(p, { DisplayName: "Acme Corp" });
    });

    it("includes CurrencyRef when currencyCode is set", () => {
        const p = buildVendorPayload({ displayName: "Stripe (USD)", currencyCode: "USD" });
        assert.deepEqual(p, { DisplayName: "Stripe (USD)", CurrencyRef: { value: "USD" } });
    });

    it("includes companyName and email when set", () => {
        const p = buildVendorPayload({
            displayName: "Acme",
            companyName: "Acme Corp",
            email: "billing@acme.com"
        }) as Record<string, unknown>;
        assert.equal(p.CompanyName, "Acme Corp");
        assert.deepEqual(p.PrimaryEmailAddr, { Address: "billing@acme.com" });
    });

    it("includes BillAddr when any address field is provided", () => {
        const p = buildVendorPayload({
            displayName: "A",
            billAddrLine1: "1 Main St",
            billAddrCity: "Toronto",
            billAddrCountrySubDivisionCode: "ON",
            billAddrPostalCode: "M5V 1A1",
            billAddrCountry: "CA"
        }) as Record<string, unknown>;
        assert.deepEqual(p.BillAddr, {
            Line1: "1 Main St",
            City: "Toronto",
            CountrySubDivisionCode: "ON",
            PostalCode: "M5V 1A1",
            Country: "CA"
        });
    });
});

describe("create-vendor — dry-run", () => {
    it("returns dry-run payload when QBO_DRY_RUN=true", async () => {
        const fake = { getRealmId: () => "REALM", fetchJson: async () => { throw new Error("should not be called"); } } as unknown as import("../src/client.js").QboClient;
        const result = await createVendor(fake, { displayName: "X", currencyCode: "USD" }, { QBO_DRY_RUN: "true" }) as { dryRun: boolean; wouldSend: { body: unknown } };
        assert.equal(result.dryRun, true);
        assert.deepEqual(result.wouldSend.body, { DisplayName: "X", CurrencyRef: { value: "USD" } });
    });
});

import { buildVendorUpdatePayload, updateVendorInputSchema, updateVendor } from "../src/tools/update-vendor.js";

describe("update-vendor — input validation", () => {
    it("requires id and syncToken", () => {
        assert.throws(() => updateVendorInputSchema.parse({}));
        assert.throws(() => updateVendorInputSchema.parse({ id: "1" }));
        assert.throws(() => updateVendorInputSchema.parse({ syncToken: "0" }));
    });

    it("has no currencyCode field (permanence is enforced at the schema level)", () => {
        const parsed = updateVendorInputSchema.parse({ id: "1", syncToken: "0", displayName: "X" }) as Record<string, unknown>;
        assert.equal(parsed.currencyCode, undefined);
    });

    it("rejects unknown fields like currencyCode (strict mode)", () => {
        assert.throws(() => updateVendorInputSchema.parse({ id: "1", syncToken: "0", currencyCode: "USD" }));
    });
});

describe("update-vendor — buildVendorUpdatePayload", () => {
    it("produces a sparse update with Id, SyncToken, sparse flag, and changed fields", () => {
        const p = buildVendorUpdatePayload({ id: "77", syncToken: "3", displayName: "Acme Ltd" });
        assert.deepEqual(p, {
            Id: "77",
            SyncToken: "3",
            sparse: true,
            DisplayName: "Acme Ltd"
        });
    });

    it("includes multiple changed fields", () => {
        const p = buildVendorUpdatePayload({
            id: "1",
            syncToken: "0",
            displayName: "A",
            active: false,
            notes: "archived"
        }) as Record<string, unknown>;
        assert.equal(p.DisplayName, "A");
        assert.equal(p.Active, false);
        assert.equal(p.Notes, "archived");
    });

    it("throws if no mutable fields are provided", () => {
        assert.throws(() => buildVendorUpdatePayload({ id: "1", syncToken: "0" }), /at least one field/);
    });
});

describe("update-vendor — dry-run", () => {
    it("returns dry-run payload when QBO_DRY_RUN=true", async () => {
        const fake = { getRealmId: () => "REALM", fetchJson: async () => { throw new Error("should not call"); } } as unknown as import("../src/client.js").QboClient;
        const result = await updateVendor(fake, { id: "77", syncToken: "3", displayName: "New Name" }, { QBO_DRY_RUN: "true" }) as { dryRun: boolean; wouldSend: { body: { DisplayName: string } } };
        assert.equal(result.dryRun, true);
        assert.equal(result.wouldSend.body.DisplayName, "New Name");
    });
});

import { validateQuery, queryInputSchema, query as runQuery } from "../src/tools/query.js";

describe("query — validateQuery", () => {
    it("accepts a simple SELECT", () => {
        validateQuery("SELECT * FROM Account");
    });

    it("accepts SELECT with WHERE and MAXRESULTS", () => {
        validateQuery("SELECT * FROM Purchase WHERE TxnDate >= '2024-01-01' MAXRESULTS 100");
    });

    it("rejects queries under 10 chars", () => {
        assert.throws(() => validateQuery("SELECT"), /length/i);
    });

    it("rejects queries over 2000 chars", () => {
        const long = "SELECT * FROM X WHERE Id = '" + "a".repeat(2100) + "'";
        assert.throws(() => validateQuery(long), /length/i);
    });

    it("rejects queries not starting with SELECT", () => {
        assert.throws(() => validateQuery("INSERT INTO Foo VALUES (1)"), /SELECT/i);
        assert.throws(() => validateQuery("describe Account"), /SELECT/i);
    });

    it("rejects queries containing ;", () => {
        assert.throws(() => validateQuery("SELECT * FROM Account; DROP TABLE X"), /semicolon/i);
    });

    it("rejects mutation keywords (case-insensitive)", () => {
        assert.throws(() => validateQuery("SELECT * FROM A WHERE UPDATE = 1"), /mutation/i);
        assert.throws(() => validateQuery("SELECT insert FROM Account"), /mutation/i);
        assert.throws(() => validateQuery("SELECT * FROM A deLETe"), /mutation/i);
    });

    it("rejects -- SQL comment", () => {
        assert.throws(() => validateQuery("SELECT * FROM Account -- comment"), /comment/i);
    });

    it("rejects INTO keyword", () => {
        assert.throws(() => validateQuery("SELECT * INTO Backup FROM Account"), /mutation/i);
    });

    it("rejects /* ... */ multiline comment (deviation: hardened beyond plan)", () => {
        assert.throws(() => validateQuery("SELECT * FROM Account /* sneaky */"), /comment/i);
    });

    it("documents known false-positive: mutation keyword inside string literal is rejected", () => {
        // This is an intentional tradeoff — the guard is a blunt instrument.
        // Callers can restructure queries to avoid keyword-as-data in string literals.
        assert.throws(
            () => validateQuery("SELECT * FROM Vendor WHERE Notes = 'remember to DELETE old contacts'"),
            /mutation/i
        );
    });

    it("exports a Zod input schema that accepts { query: string }", () => {
        const parsed = queryInputSchema.parse({ query: "SELECT * FROM Account" });
        assert.equal(parsed.query, "SELECT * FROM Account");
    });
});

describe("query — fetcher", () => {
    it("calls /query with URL-encoded query string and returns raw JSON", async () => {
        let capturedPath = "";
        const fake = {
            getRealmId: () => "REALM",
            fetchJson: async (path: string) => { capturedPath = path; return { QueryResponse: { totalCount: 0 } }; }
        } as unknown as import("../src/client.js").QboClient;
        const result = await runQuery(fake, { query: "SELECT * FROM Account" }) as { QueryResponse: { totalCount: number } };
        assert.ok(capturedPath.startsWith("/v3/company/REALM/query?query="));
        assert.ok(capturedPath.includes(encodeURIComponent("SELECT * FROM Account")));
        assert.equal(result.QueryResponse.totalCount, 0);
    });
});

import { fetchBocRate, parseBocObservations, computeWindow } from "../src/util/boc.js";

describe("boc — computeWindow", () => {
    it("produces a 7-day window ending at the target date", () => {
        const { startDate, endDate } = computeWindow("2024-06-15");
        assert.equal(endDate, "2024-06-15");
        assert.equal(startDate, "2024-06-08");
    });

    it("handles month boundaries", () => {
        const { startDate, endDate } = computeWindow("2024-03-02");
        assert.equal(endDate, "2024-03-02");
        assert.equal(startDate, "2024-02-24");
    });
});

describe("boc — parseBocObservations", () => {
    it("returns the latest observation <= target date", () => {
        const body = {
            observations: [
                { d: "2024-06-13", FXUSDCAD: { v: "1.3721" } },
                { d: "2024-06-14", FXUSDCAD: { v: "1.3750" } }
            ]
        };
        const result = parseBocObservations(body, "2024-06-15");
        assert.equal(result.observationDate, "2024-06-14");
        assert.equal(result.rate, 1.375);
    });

    it("picks the exact target date when present", () => {
        const body = {
            observations: [
                { d: "2024-06-13", FXUSDCAD: { v: "1.3721" } },
                { d: "2024-06-14", FXUSDCAD: { v: "1.3750" } },
                { d: "2024-06-15", FXUSDCAD: { v: "1.3760" } }
            ]
        };
        const result = parseBocObservations(body, "2024-06-15");
        assert.equal(result.observationDate, "2024-06-15");
        assert.equal(result.rate, 1.376);
    });

    it("ignores observations after the target date", () => {
        const body = {
            observations: [
                { d: "2024-06-14", FXUSDCAD: { v: "1.3750" } },
                { d: "2024-06-16", FXUSDCAD: { v: "1.3800" } }
            ]
        };
        const result = parseBocObservations(body, "2024-06-15");
        assert.equal(result.observationDate, "2024-06-14");
    });

    it("throws when no observations are <= target", () => {
        const body = { observations: [{ d: "2024-06-16", FXUSDCAD: { v: "1.3800" } }] };
        assert.throws(() => parseBocObservations(body, "2024-06-15"), /No BoC observation/);
    });

    it("throws when observations is empty", () => {
        assert.throws(() => parseBocObservations({ observations: [] }, "2024-06-15"), /No BoC observation/);
    });
});

describe("boc — fetchBocRate via local server", () => {
    it("calls the Valet API and returns the latest observation <= target", async () => {
        let capturedPath = "";
        const server = createServer((req, res) => {
            capturedPath = req.url || "";
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                observations: [
                    { d: "2024-06-14", FXUSDCAD: { v: "1.3750" } }
                ]
            }));
        });
        await new Promise<void>((r) => server.listen(0, r));
        const port = (server.address() as { port: number }).port;
        try {
            const result = await fetchBocRate("2024-06-15", { baseUrl: `http://localhost:${port}` });
            assert.equal(result.rate, 1.375);
            assert.equal(result.observationDate, "2024-06-14");
            assert.equal(result.date, "2024-06-15");
            assert.ok(capturedPath.includes("start_date=2024-06-08"));
            assert.ok(capturedPath.includes("end_date=2024-06-15"));
        } finally {
            await new Promise<void>((r) => server.close(() => r()));
        }
    });

    it("throws on non-200 response", async () => {
        const server = createServer((_req, res) => {
            res.writeHead(503);
            res.end("busy");
        });
        await new Promise<void>((r) => server.listen(0, r));
        const port = (server.address() as { port: number }).port;
        try {
            await assert.rejects(
                fetchBocRate("2024-06-15", { baseUrl: `http://localhost:${port}` }),
                /BoC Valet API error/
            );
        } finally {
            await new Promise<void>((r) => server.close(() => r()));
        }
    });
});
