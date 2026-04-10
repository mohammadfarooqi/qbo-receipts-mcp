#!/usr/bin/env node
// Rollback the Gmail-to-sandbox demo by session tag.
//
// Usage: node scripts/rollback-gmail-demo.mjs <sessionTag>
// Example: node scripts/rollback-gmail-demo.mjs 2026-04-10-1030

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

const sessionTag = process.argv[2];
if (!sessionTag || !/^\d{4}-\d{2}-\d{2}-\d{4}$/.test(sessionTag)) {
    console.error("Usage: node scripts/rollback-gmail-demo.mjs <YYYY-MM-DD-HHmm>");
    console.error("Example: node scripts/rollback-gmail-demo.mjs 2026-04-10-1030");
    process.exit(1);
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

console.log(`[rollback] session tag = ${sessionTag}`);
console.log(`[rollback] sandbox realm = ${env.QBO_REALM_ID}`);

const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/src/index.js"],
    env
});
const client = new Client({ name: "gmail-rollback", version: "1.0.0" });
await client.connect(transport);

try {
    const result = await client.callTool({
        name: "rollback_session",
        arguments: {
            sessionTag,
            txnDateAfter: "2024-01-01",
            txnDateBefore: "2026-12-31"
        }
    });
    const text = result.content[0].text;
    if (text.startsWith("Error:")) {
        console.error(`[rollback] FAILED: ${text}`);
        process.exit(1);
    }
    const data = JSON.parse(text);
    console.log(`[rollback] matched=${data.matched} deleted=${data.deleted}`);
    console.log(`[rollback] ids: ${JSON.stringify(data.ids)}`);
    if (data.results) {
        for (const r of data.results) {
            console.log(`[rollback]   ${r.id}: ${r.ok ? "DELETED" : `FAILED (${r.error})`}`);
        }
    }
} finally {
    await client.close();
}
