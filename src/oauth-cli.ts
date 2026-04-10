#!/usr/bin/env node

export interface BuildAuthUrlOptions {
    clientId: string;
    redirectUri: string;
    state: string;
    scope: string;
}

export function buildAuthUrl(options: BuildAuthUrlOptions): string {
    const url = new URL("https://appcenter.intuit.com/connect/oauth2");
    url.searchParams.set("client_id", options.clientId);
    url.searchParams.set("redirect_uri", options.redirectUri);
    url.searchParams.set("state", options.state);
    url.searchParams.set("scope", options.scope);
    url.searchParams.set("response_type", "code");
    return url.toString();
}

export interface TokenResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    x_refresh_token_expires_in: number;
    token_type: string;
}

export interface ExchangeOptions {
    tokenUrl: string;
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
}

export async function exchangeCodeForTokens(opts: ExchangeOptions): Promise<TokenResponse> {
    const basic = Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString("base64");
    const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: opts.code,
        redirect_uri: opts.redirectUri
    }).toString();

    const res = await fetch(opts.tokenUrl, {
        method: "POST",
        headers: {
            "Authorization": `Basic ${basic}`,
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Token exchange failed: ${res.status} ${text}`);
    }
    return (await res.json()) as TokenResponse;
}

import { createServer as createHttpServer } from "node:http";
import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync, readFileSync } from "node:fs";

const INTUIT_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REDIRECT_URI = "http://localhost:8000/callback";
const CALLBACK_PORT = 8000;
const SCOPE = "com.intuit.quickbooks.accounting";

async function runOAuthFlow(): Promise<void> {
    const clientId = process.env.QBO_CLIENT_ID;
    const clientSecret = process.env.QBO_CLIENT_SECRET;
    const envPath = process.env.QBO_ENV_FILE || ".env";

    if (!clientId || !clientSecret) {
        console.error("ERROR: QBO_CLIENT_ID and QBO_CLIENT_SECRET env vars required.");
        console.error("Export them before running this CLI, e.g.:");
        console.error("  export QBO_CLIENT_ID=your-sandbox-client-id");
        console.error("  export QBO_CLIENT_SECRET=your-sandbox-client-secret");
        console.error("  npx qbo-receipts-mcp-oauth");
        process.exit(1);
    }

    const state = randomBytes(16).toString("hex");
    const { code, realmId } = await captureCallback(state);
    const tokens = await exchangeCodeForTokens({
        tokenUrl: INTUIT_TOKEN_URL,
        clientId,
        clientSecret,
        code,
        redirectUri: REDIRECT_URI
    });

    writeTokensToEnv(envPath, tokens, realmId);

    console.log(`\nSuccess. Tokens written to ${envPath}:`);
    console.log(`  QBO_ACCESS_TOKEN=<redacted, ${tokens.expires_in}s lifetime>`);
    console.log(`  QBO_REFRESH_TOKEN=<redacted, ~100 day lifetime>`);
    console.log(`  QBO_REALM_ID=${realmId}`);
    console.log(`\nYou can now run: npx qbo-receipts-mcp`);
}

function captureCallback(expectedState: string): Promise<{ code: string; realmId: string }> {
    return new Promise((resolve, reject) => {
        const server = createHttpServer((req, res) => {
            if (!req.url) return;
            const url = new URL(req.url, `http://localhost:${CALLBACK_PORT}`);
            if (url.pathname !== "/callback") {
                res.writeHead(404);
                res.end();
                return;
            }
            const code = url.searchParams.get("code");
            const state = url.searchParams.get("state");
            const realmId = url.searchParams.get("realmId");

            if (state !== expectedState) {
                res.writeHead(400, { "Content-Type": "text/plain" });
                res.end("State mismatch. Possible CSRF. Close this tab and retry.");
                server.close();
                reject(new Error("OAuth state mismatch"));
                return;
            }
            if (!code || !realmId) {
                res.writeHead(400, { "Content-Type": "text/plain" });
                res.end("Missing code or realmId in callback. Close this tab and retry.");
                server.close();
                reject(new Error("OAuth callback missing code or realmId"));
                return;
            }

            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(`<html><body style="font-family:sans-serif;padding:2em"><h1>Authorized</h1><p>You can close this tab and return to the terminal.</p></body></html>`);
            server.close();
            resolve({ code, realmId });
        });

        server.listen(CALLBACK_PORT, () => {
            const authUrl = buildAuthUrl({
                clientId: process.env.QBO_CLIENT_ID!,
                redirectUri: REDIRECT_URI,
                state: expectedState,
                scope: SCOPE
            });
            console.log("Open this URL in your browser:");
            console.log(authUrl);
            console.log("\nWaiting for the Intuit callback...");
        });

        server.on("error", reject);
    });
}

export function writeTokensToEnv(envPath: string, tokens: TokenResponse, realmId: string): void {
    const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
    const lines = existing.split("\n").filter(l => {
        const k = l.split("=")[0];
        return k !== "QBO_ACCESS_TOKEN" && k !== "QBO_REFRESH_TOKEN" && k !== "QBO_REALM_ID";
    });
    lines.push(`QBO_ACCESS_TOKEN=${tokens.access_token}`);
    lines.push(`QBO_REFRESH_TOKEN=${tokens.refresh_token}`);
    lines.push(`QBO_REALM_ID=${realmId}`);
    writeFileSync(envPath, lines.filter(l => l.trim()).join("\n") + "\n", { mode: 0o600 });
}

if (import.meta.url === `file://${process.argv[1]}`) {
    runOAuthFlow().catch(err => {
        console.error("OAuth flow failed:", err);
        process.exit(1);
    });
}
