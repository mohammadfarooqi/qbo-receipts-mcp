#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRequire } from "node:module";
import { clientFromEnv, QboClient } from "./client.js";
import {
    getCompanyInfoInputSchema, getCompanyInfo,
    searchPurchasesInputSchema, searchPurchases,
    createPurchaseInputSchema, createPurchase,
    deletePurchaseInputSchema, deletePurchase,
    uploadReceiptInputSchema, uploadReceipt
} from "./tools/index.js";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json") as { version: string };

function textResult(data: unknown): { content: Array<{ type: "text"; text: string }> } {
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err: unknown): { content: Array<{ type: "text"; text: string }>; isError: true } {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}

async function withClient<T>(fn: (client: QboClient) => Promise<T>): Promise<T> {
    const client = clientFromEnv(process.env);
    return fn(client);
}

const server = new McpServer({
    name: "qbo-receipts-mcp",
    version,
    description: "QuickBooks Online MCP server focused on expense entry with receipt attachments. Multi-currency aware. Creates Purchase records (QBO 'Expense' in UI), uploads Attachable files, and supports session-tagged rollback via soft-delete."
});

server.registerTool("get_company_info", {
    description: "Returns the authenticated QBO company's metadata including CompanyName and home currency. Use this to verify OAuth and realm are correct before any write operation.",
    inputSchema: getCompanyInfoInputSchema.shape
}, async (args) => {
    try {
        const result = await withClient(c => getCompanyInfo(c, args));
        return textResult(result);
    } catch (e) { return errorResult(e); }
});

server.registerTool("search_purchases", {
    description: "Query QBO Purchase records with optional filters on date range, total amount, and currency. Returns raw Purchase entities matching the filter. Use for duplicate detection before creating new expenses. Amounts are in the transaction currency (TotalAmt), NOT the home currency.",
    inputSchema: searchPurchasesInputSchema.shape
}, async (args) => {
    try {
        const result = await withClient(c => searchPurchases(c, args));
        return textResult(result);
    } catch (e) { return errorResult(e); }
});

server.registerTool("create_purchase", {
    description: "Create a new QBO Purchase record (appears as an 'Expense' in the QBO UI). REQUIRES a session tag for rollback grouping. Sets an idempotency marker in PrivateNote. For USD expenses, the exchangeRate field is REQUIRED. Honors QBO_DRY_RUN env var.",
    inputSchema: createPurchaseInputSchema.shape
}, async (args) => {
    try {
        const result = await withClient(c => createPurchase(c, args));
        return textResult(result);
    } catch (e) { return errorResult(e); }
});

server.registerTool("delete_purchase", {
    description: "Soft-delete a QBO Purchase by Id + SyncToken. Marks the record as Deleted and removes it from normal queries and reports. Used as the rollback primitive. Honors QBO_DRY_RUN env var.",
    inputSchema: deletePurchaseInputSchema.shape
}, async (args) => {
    try {
        const result = await withClient(c => deletePurchase(c, args));
        return textResult(result);
    } catch (e) { return errorResult(e); }
});

server.registerTool("upload_receipt", {
    description: "Upload a receipt file (PDF, image, etc.) and link it to a QBO entity (typically a Purchase) as an Attachable. Validates file size (max 20 MB), content type (PDF/image/office docs), filename safety, and path safety. Set QBO_ATTACH_ALLOWED_DIRS env var (colon-separated) to restrict file paths. Honors QBO_DRY_RUN.",
    inputSchema: uploadReceiptInputSchema.shape
}, async (args) => {
    try {
        const result = await withClient(c => uploadReceipt(c, args));
        return textResult(result);
    } catch (e) { return errorResult(e); }
});

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch(err => {
    console.error("qbo-receipts-mcp failed to start:", err);
    process.exit(1);
});
