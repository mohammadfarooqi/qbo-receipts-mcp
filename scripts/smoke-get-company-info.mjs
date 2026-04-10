#!/usr/bin/env node
// Sandbox smoke test: call get_company_info against a real Intuit sandbox.
// Reads credentials from two files:
//   - qb-bookkeeping/.env.credentials.txt (client id/secret)
//   - qbo-receipts-mcp/.env (access/refresh token, realm id)
//
// Usage: node scripts/smoke-get-company-info.mjs
//
// NOT shipped in the npm package (scripts/ isn't in "files" allowlist).

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
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim();
        env[key] = value;
    }
    return env;
}

const credsFile = "/Users/mohammadfarooqi/Desktop/code/qb-bookkeeping/.env.credentials.txt";
const tokenFile = "/Users/mohammadfarooqi/Desktop/code/qbo-receipts-mcp/.env";

const creds = parseEnvFile(credsFile);
const tokens = parseEnvFile(tokenFile);

const env = {
    QBO_CLIENT_ID: creds.INTUIT_SANDBOX_CLIENT_ID,
    QBO_CLIENT_SECRET: creds.INTUIT_SANDBOX_CLIENT_SECRET,
    QBO_ACCESS_TOKEN: tokens.QBO_ACCESS_TOKEN,
    QBO_REFRESH_TOKEN: tokens.QBO_REFRESH_TOKEN,
    QBO_REALM_ID: tokens.QBO_REALM_ID,
    QBO_ENVIRONMENT: "sandbox",
    PATH: process.env.PATH
};

// Sanity check without printing values
const missing = Object.entries(env).filter(([k, v]) => k !== "PATH" && !v).map(([k]) => k);
if (missing.length > 0) {
    console.error(`Missing env vars: ${missing.join(", ")}`);
    process.exit(1);
}
console.log(`[smoke] creds loaded: QBO_CLIENT_ID=<${env.QBO_CLIENT_ID.length} chars>, realm=${env.QBO_REALM_ID}`);

const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/src/index.js"],
    env
});
const client = new Client({ name: "smoke-test", version: "1.0.0" });

console.log("[smoke] connecting to MCP server over stdio...");
await client.connect(transport);

console.log("[smoke] calling get_company_info...");
const result = await client.callTool({ name: "get_company_info", arguments: {} });
const text = result.content[0].text;

if (text.startsWith("Error:")) {
    console.error("[smoke] FAILED:");
    console.error(text);
    await client.close();
    process.exit(1);
}

const data = JSON.parse(text);
console.log("[smoke] SUCCESS. CompanyInfo:");
console.log(JSON.stringify(data, null, 2));

await client.close();
console.log("[smoke] done.");
