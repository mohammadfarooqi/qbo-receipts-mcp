import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startMockQboServer, MockQboServerHandle } from "./mock-server.js";

let mockServer: MockQboServerHandle;
let client: Client;

before(async () => {
    mockServer = await startMockQboServer();
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
    it("lists exactly 6 tools with expected names", async () => {
        const { tools } = await client.listTools();
        assert.equal(tools.length, 6);
        const names = tools.map(t => t.name).sort();
        assert.deepEqual(names, [
            "create_purchase",
            "delete_purchase",
            "get_accounts",
            "get_company_info",
            "search_purchases",
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
});
