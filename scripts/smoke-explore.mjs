#!/usr/bin/env node
// Phase 1 exploration: discover the sandbox's existing structure
// so we can pick real account IDs for the write-path smoke tests.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync } from "node:fs";

function parseEnvFile(path) {
    const content = readFileSync(path, "utf8");
    const env = {};
    for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return env;
}

const creds = parseEnvFile("/Users/mohammadfarooqi/Desktop/code/qb-bookkeeping/.env.credentials.txt");
const tokens = parseEnvFile("/Users/mohammadfarooqi/Desktop/code/qbo-receipts-mcp/.env");

const env = {
    QBO_CLIENT_ID: creds.INTUIT_SANDBOX_CLIENT_ID,
    QBO_CLIENT_SECRET: creds.INTUIT_SANDBOX_CLIENT_SECRET,
    QBO_ACCESS_TOKEN: tokens.QBO_ACCESS_TOKEN,
    QBO_REFRESH_TOKEN: tokens.QBO_REFRESH_TOKEN,
    QBO_REALM_ID: tokens.QBO_REALM_ID,
    QBO_ENVIRONMENT: "sandbox",
    PATH: process.env.PATH
};

const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/src/index.js"],
    env
});
const client = new Client({ name: "smoke-explore", version: "1.0.0" });
await client.connect(transport);

async function callTool(name, args) {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content[0].text;
    if (text.startsWith("Error:")) {
        throw new Error(`[${name}] ${text}`);
    }
    return JSON.parse(text);
}

try {
    console.log("=== search_purchases (no filter, max 20) ===");
    const res = await callTool("search_purchases", { maxResults: 20 });
    const purchases = res.QueryResponse?.Purchase || [];
    console.log(`Found ${purchases.length} purchases in sandbox.`);

    if (purchases.length === 0) {
        console.log("[explore] No purchases in sandbox — sandbox may be empty.");
    } else {
        // Extract unique payment account IDs and expense account IDs
        const paymentAccounts = new Map();
        const expenseAccounts = new Map();
        const currencies = new Map();

        for (const p of purchases) {
            const payId = p.AccountRef?.value;
            const payName = p.AccountRef?.name || "<no name>";
            if (payId) paymentAccounts.set(payId, payName);

            for (const line of (p.Line || [])) {
                const expId = line.AccountBasedExpenseLineDetail?.AccountRef?.value;
                const expName = line.AccountBasedExpenseLineDetail?.AccountRef?.name || "<no name>";
                if (expId) expenseAccounts.set(expId, expName);
            }

            if (p.CurrencyRef?.value) {
                currencies.set(p.CurrencyRef.value, (currencies.get(p.CurrencyRef.value) || 0) + 1);
            } else {
                currencies.set("(home)", (currencies.get("(home)") || 0) + 1);
            }
        }

        console.log("\n=== Payment accounts (AccountRef on Purchase) ===");
        for (const [id, name] of paymentAccounts) {
            console.log(`  ${id}: ${name}`);
        }

        console.log("\n=== Expense line accounts ===");
        for (const [id, name] of expenseAccounts) {
            console.log(`  ${id}: ${name}`);
        }

        console.log("\n=== Currency distribution ===");
        for (const [curr, count] of currencies) {
            console.log(`  ${curr}: ${count}`);
        }

        console.log("\n=== Sample purchase (first) ===");
        const sample = purchases[0];
        console.log(JSON.stringify({
            Id: sample.Id,
            SyncToken: sample.SyncToken,
            TxnDate: sample.TxnDate,
            PaymentType: sample.PaymentType,
            AccountRef: sample.AccountRef,
            CurrencyRef: sample.CurrencyRef,
            ExchangeRate: sample.ExchangeRate,
            TotalAmt: sample.TotalAmt,
            HomeTotalAmt: sample.HomeTotalAmt,
            Line: sample.Line?.map(l => ({
                Amount: l.Amount,
                DetailType: l.DetailType,
                AccountRef: l.AccountBasedExpenseLineDetail?.AccountRef
            }))
        }, null, 2));
    }
} finally {
    await client.close();
}
