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
