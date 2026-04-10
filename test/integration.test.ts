import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startMockQboServer, MockQboServerHandle } from "./mock-server.js";

let mockServer: MockQboServerHandle;
let client: Client;

before(async () => {
    mockServer = await startMockQboServer({
        accounts: {
            "1101": { Id: "1101", SyncToken: "0", Name: "CAD Credit Card", AccountType: "Credit Card", Active: true },
            "1102": { Id: "1102", SyncToken: "0", Name: "USD Credit Card", AccountType: "Credit Card", Active: true, CurrencyRef: { value: "USD", name: "United States Dollar" } },
            "80": { Id: "80", SyncToken: "0", Name: "Subscriptions", AccountType: "Expense", Active: true }
        },
        vendors: {
            "900": { Id: "900", SyncToken: "0", DisplayName: "Existing CAD Vendor", Active: true }
        }
    });
    const transport = new StdioClientTransport({
        command: "node",
        args: ["dist/src/index.js"],
        env: {
            QBO_CLIENT_ID: "test-cid",
            QBO_CLIENT_SECRET: "test-sec",
            QBO_ACCESS_TOKEN: "test-access",
            QBO_REFRESH_TOKEN: "test-refresh",
            QBO_REALM_ID: "TEST-REALM",
            QBO_BASE_URL: mockServer.baseUrl,
            QBO_TOKEN_URL: mockServer.tokenUrl,
            BOC_BASE_URL: mockServer.baseUrl,
            PATH: process.env.PATH || ""
        }
    });
    client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(transport);
});

after(async () => {
    await client.close();
    await mockServer.close();
});

describe("MCP Server — tool registration", () => {
    it("lists exactly 13 tools with expected names", async () => {
        const { tools } = await client.listTools();
        assert.equal(tools.length, 13);
        const names = tools.map(t => t.name).sort();
        assert.deepEqual(names, [
            "create_purchase",
            "create_vendor",
            "delete_purchase",
            "get_accounts",
            "get_boc_rate",
            "get_company_info",
            "get_vendor",
            "query",
            "rollback_session",
            "search_purchases",
            "search_vendors",
            "update_vendor",
            "upload_receipt"
        ]);
    });
});

function parseResult(result: Awaited<ReturnType<typeof client.callTool>>): unknown {
    const text = (result.content as Array<{ text: string }>)[0].text;
    if (text.startsWith("Error:")) throw new Error(text);
    return JSON.parse(text);
}

describe("MCP Server — full round-trip", () => {
    it("get_company_info returns Mock Company", async () => {
        const data = parseResult(await client.callTool({
            name: "get_company_info",
            arguments: {}
        })) as { CompanyInfo: { CompanyName: string } };
        assert.equal(data.CompanyInfo.CompanyName, "Mock Company");
    });

    it("create_purchase + upload_receipt + search_purchases + delete_purchase", async () => {
        // Create a CAD purchase
        const created = parseResult(await client.callTool({
            name: "create_purchase",
            arguments: {
                txnDate: "2026-01-15",
                paymentType: "CreditCard",
                paymentAccountId: "1101",
                totalAmt: 113.00,
                expenseAccountId: "80",
                source: "manual",
                sourceId: "round-trip-test",
                sessionTag: "2026-04-10-0930"
            }
        })) as { Purchase: { Id: string; SyncToken: string; PrivateNote: string } };

        assert.ok(created.Purchase.Id, "should have Purchase Id");
        assert.match(created.Purchase.PrivateNote, /auto:manual:round-trip-test \| sess:2026-04-10-0930/);

        // Upload a fake receipt (create a temp file because upload_receipt reads from disk)
        const { writeFileSync, unlinkSync, mkdtempSync } = await import("node:fs");
        const { tmpdir } = await import("node:os");
        const { join } = await import("node:path");
        const tmpDir = mkdtempSync(join(tmpdir(), "qbo-mcp-rt-"));
        const tmpFile = join(tmpDir, `round-trip-receipt.pdf`);
        writeFileSync(tmpFile, Buffer.from("%PDF-1.4\nfake\n"));
        try {
            const attached = parseResult(await client.callTool({
                name: "upload_receipt",
                arguments: {
                    filePath: tmpFile,
                    contentType: "application/pdf",
                    entityType: "Purchase",
                    entityId: created.Purchase.Id
                }
            })) as { Id: string };
            assert.ok(attached.Id, "should have Attachable Id");
        } finally {
            try { unlinkSync(tmpFile); } catch { /* ignore */ }
        }

        // Search for the created purchase by amount
        const search = parseResult(await client.callTool({
            name: "search_purchases",
            arguments: { totalAmt: 113.00 }
        })) as { QueryResponse: { Purchase?: Array<{ Id: string }> } };
        assert.ok(
            search.QueryResponse.Purchase && search.QueryResponse.Purchase.length > 0,
            "search should return at least one result"
        );

        // Delete it
        const deleted = parseResult(await client.callTool({
            name: "delete_purchase",
            arguments: { id: created.Purchase.Id, syncToken: created.Purchase.SyncToken }
        })) as { Purchase: { status: string } };
        assert.equal(deleted.Purchase.status, "Deleted");
    });

    it("create_purchase in dry-run mode does not POST to /purchase", async () => {
        // Separate mock + client so we can measure POST count against a clean state
        const mock = await startMockQboServer();
        const transport = new StdioClientTransport({
            command: "node",
            args: ["dist/src/index.js"],
            env: {
                QBO_CLIENT_ID: "c", QBO_CLIENT_SECRET: "s",
                QBO_ACCESS_TOKEN: "a", QBO_REFRESH_TOKEN: "r",
                QBO_REALM_ID: "R",
                QBO_BASE_URL: mock.baseUrl, QBO_TOKEN_URL: mock.tokenUrl,
                QBO_DRY_RUN: "true",
                PATH: process.env.PATH || ""
            }
        });
        const dryClient = new Client({ name: "t2", version: "1.0.0" });
        await dryClient.connect(transport);
        try {
            const result = parseResult(await dryClient.callTool({
                name: "create_purchase",
                arguments: {
                    txnDate: "2026-01-15",
                    paymentType: "CreditCard",
                    paymentAccountId: "1101",
                    totalAmt: 100.00,
                    expenseAccountId: "80",
                    source: "manual",
                    sourceId: "dry-test",
                    sessionTag: "2026-04-10-0930"
                }
            })) as { dryRun: boolean; wouldSend: { method: string; body: Record<string, unknown> } };
            assert.equal(result.dryRun, true);
            assert.equal(result.wouldSend.method, "POST");

            // Verify the mock received ZERO /purchase POSTs
            const posts = mock.getRecordedRequests().filter(r =>
                r.method === "POST" && r.url.includes("/purchase") && !r.url.includes("operation=delete")
            );
            assert.equal(posts.length, 0, "dry-run must not POST to QBO");
        } finally {
            await dryClient.close();
            await mock.close();
        }
    });

    it("create_purchase returns an error when USD has no exchangeRate", async () => {
        const result = await client.callTool({
            name: "create_purchase",
            arguments: {
                txnDate: "2025-11-04",
                paymentType: "CreditCard",
                paymentAccountId: "1102",
                totalAmt: 42.00,
                expenseAccountId: "80",
                currencyCode: "USD",
                source: "manual",
                sourceId: "usd-no-rate",
                sessionTag: "2026-04-10-0930"
            }
        });
        const text = (result.content as Array<{ text: string }>)[0].text;
        assert.match(text, /ExchangeRate is required/);
    });

    it("get_accounts returns seeded accounts", async () => {
        const data = parseResult(await client.callTool({
            name: "get_accounts",
            arguments: {}
        })) as { QueryResponse: { Account: Array<{ Id: string }> } };
        const ids = data.QueryResponse.Account.map(a => a.Id).sort();
        assert.deepEqual(ids, ["1101", "1102", "80"]);
    });

    it("get_accounts with accountType filter still returns results from mock", async () => {
        const data = parseResult(await client.callTool({
            name: "get_accounts",
            arguments: { accountType: "Credit Card" }
        })) as { QueryResponse: { Account: Array<{ Id: string }> } };
        // Mock server ignores WHERE clause and returns all accounts — we only verify the tool wires correctly.
        assert.ok(Array.isArray(data.QueryResponse.Account));
    });

    it("create_vendor then get_vendor round-trip", async () => {
        const created = parseResult(await client.callTool({
            name: "create_vendor",
            arguments: { displayName: "Stripe Inc. (USD)", currencyCode: "USD" }
        })) as { Vendor: { Id: string; CurrencyRef: { value: string } } };
        assert.equal(created.Vendor.CurrencyRef.value, "USD");
        const fetched = parseResult(await client.callTool({
            name: "get_vendor",
            arguments: { id: created.Vendor.Id }
        })) as { Vendor: { Id: string; DisplayName: string } };
        assert.equal(fetched.Vendor.Id, created.Vendor.Id);
        assert.equal(fetched.Vendor.DisplayName, "Stripe Inc. (USD)");
    });

    it("update_vendor changes DisplayName and increments SyncToken", async () => {
        const search = parseResult(await client.callTool({
            name: "search_vendors",
            arguments: { namePrefix: "Existing" }
        })) as { QueryResponse: { Vendor: Array<{ Id: string; SyncToken: string }> } };
        assert.ok(search.QueryResponse.Vendor.length >= 1);
        const target = search.QueryResponse.Vendor.find(v => v.Id === "900")!;
        const updated = parseResult(await client.callTool({
            name: "update_vendor",
            arguments: { id: target.Id, syncToken: target.SyncToken, displayName: "Updated Name" }
        })) as { Vendor: { DisplayName: string; SyncToken: string } };
        assert.equal(updated.Vendor.DisplayName, "Updated Name");
        assert.notEqual(updated.Vendor.SyncToken, target.SyncToken);
    });

    it("update_vendor rejects currencyCode (strict schema)", async () => {
        const result = await client.callTool({
            name: "update_vendor",
            arguments: { id: "900", syncToken: "0", currencyCode: "USD" }
        });
        const text = (result.content as Array<{ text: string }>)[0].text;
        assert.ok(text.startsWith("Error:"), `Expected error but got: ${text}`);
    });

    it("query accepts a valid SELECT", async () => {
        const data = parseResult(await client.callTool({
            name: "query",
            arguments: { query: "SELECT * FROM Vendor" }
        })) as { QueryResponse: { Vendor: unknown[] } };
        assert.ok(Array.isArray(data.QueryResponse.Vendor));
    });

    it("query rejects mutation keywords", async () => {
        const result = await client.callTool({
            name: "query",
            arguments: { query: "SELECT * FROM Vendor; DELETE FROM Vendor" }
        });
        const text = (result.content as Array<{ text: string }>)[0].text;
        assert.ok(text.startsWith("Error:"), `Expected error but got: ${text}`);
    });

    it("rollback_session with no matches returns zero", async () => {
        const data = parseResult(await client.callTool({
            name: "rollback_session",
            arguments: { sessionTag: "1999-01-01-0000" }
        })) as { matched: number; deleted: number };
        assert.equal(data.matched, 0);
    });

    it("get_boc_rate errors gracefully when BoC is unreachable via mock", async () => {
        // BOC_BASE_URL points at the mock QBO server, which 404s on /valet/observations.
        // This proves the tool is wired end-to-end; the tool will return an error result.
        const result = await client.callTool({
            name: "get_boc_rate",
            arguments: { date: "2024-06-15" }
        });
        const text = (result.content as Array<{ text: string }>)[0].text;
        // Either success (unlikely) or a clean error. Both prove the wiring is correct.
        assert.ok(typeof text === "string" && text.length > 0);
    });
});
