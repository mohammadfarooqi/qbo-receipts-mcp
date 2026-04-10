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
    uploadReceiptInputSchema, uploadReceipt,
    getAccountsInputSchema, getAccounts,
    searchVendorsInputSchema, searchVendors,
    getVendorInputSchema, getVendor,
    createVendorInputSchema, createVendor,
    updateVendorInputSchema, updateVendor,
    queryInputSchema, query as runQuery,
    getBocRateInputSchema, getBocRate
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

server.registerTool("get_accounts", {
    description: "Fetch the QBO chart of accounts. Optional filters: accountType (e.g. Bank, Credit Card, Expense), active. Use this for discovery (finding payment account Ids like 1101/1102, expense account Ids for categorization) and dedup.",
    inputSchema: getAccountsInputSchema.shape
}, async (args) => {
    try {
        const result = await withClient(c => getAccounts(c, args));
        return textResult(result);
    } catch (e) { return errorResult(e); }
});

server.registerTool("search_vendors", {
    description: "Query QBO Vendor records with optional filters on namePrefix (LIKE match), currencyCode, and active status. Use for dedup before calling create_vendor. DisplayName ordering, max 1000 results per page.",
    inputSchema: searchVendorsInputSchema.shape
}, async (args) => {
    try {
        const result = await withClient(c => searchVendors(c, args));
        return textResult(result);
    } catch (e) { return errorResult(e); }
});

server.registerTool("get_vendor", {
    description: "Fetch a single QBO Vendor by Id. Returns the full Vendor entity including CurrencyRef, billing address, and SyncToken.",
    inputSchema: getVendorInputSchema.shape
}, async (args) => {
    try {
        const result = await withClient(c => getVendor(c, args));
        return textResult(result);
    } catch (e) { return errorResult(e); }
});

server.registerTool("create_vendor", {
    description: "Create a new QBO Vendor. CurrencyRef is PERMANENT at creation and cannot be changed later — if you need to change a vendor's currency, create a new vendor and archive the old one. For USD vendors, follow the project convention of suffixing displayName with '(USD)'. Honors QBO_DRY_RUN.",
    inputSchema: createVendorInputSchema.shape
}, async (args) => {
    try {
        const result = await withClient(c => createVendor(c, args));
        return textResult(result);
    } catch (e) { return errorResult(e); }
});

server.registerTool("update_vendor", {
    description: "Update a QBO Vendor by Id + SyncToken. Sparse update — only provided fields are changed. Use active:false to archive a vendor. CurrencyRef cannot be updated (QBO rule) — this tool's input schema does not accept a currencyCode field at all. Honors QBO_DRY_RUN.",
    inputSchema: updateVendorInputSchema.shape
}, async (args) => {
    try {
        const result = await withClient(c => updateVendor(c, args));
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

server.registerTool("query", {
    description: "Raw QBO query endpoint (escape hatch). SELECT statements only. Max 2000 chars. Rejected: semicolons, SQL comments (--), mutation keywords (INSERT, UPDATE, DELETE, MERGE, TRUNCATE, INTO, CDC). Response is passed through without schema validation — caller interprets the shape. Use this when a specific tool doesn't cover your query pattern.",
    inputSchema: queryInputSchema.shape
}, async (args) => {
    try {
        const result = await withClient(c => runQuery(c, args));
        return textResult(result);
    } catch (e) { return errorResult(e); }
});

server.registerTool("get_boc_rate", {
    description: "Fetch historical USD/CAD exchange rate from the Bank of Canada Valet API for a given date. The value is CAD per 1 USD, matching QBO's ExchangeRate convention. Handles weekends/holidays by returning the latest observation within a 7-day lookback window. CRA-accepted source per Income Tax Folio S5-F4-C1. No authentication required. Override base URL via BOC_BASE_URL env var (for testing).",
    inputSchema: getBocRateInputSchema.shape
}, async (args) => {
    try {
        const result = await getBocRate(args);
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
