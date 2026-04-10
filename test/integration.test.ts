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
    it("lists exactly 5 tools with expected names", async () => {
        const { tools } = await client.listTools();
        assert.equal(tools.length, 5);
        const names = tools.map(t => t.name).sort();
        assert.deepEqual(names, [
            "create_purchase",
            "delete_purchase",
            "get_company_info",
            "search_purchases",
            "upload_receipt"
        ]);
    });
});
