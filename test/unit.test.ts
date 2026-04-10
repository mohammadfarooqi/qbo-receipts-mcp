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

import { FaultSchema, TokenRefreshResponseSchema } from "../src/schema.js";

describe("schema — FaultSchema", () => {
    it("parses a valid QBO Fault error response", () => {
        const result = FaultSchema.parse({
            Fault: {
                Error: [{
                    Message: "Invalid Reference Id",
                    Detail: "Something is wrong",
                    code: "2500",
                    element: "Account"
                }],
                type: "ValidationFault"
            },
            time: "2026-04-10T12:00:00.000Z"
        });
        assert.equal(result.Fault.Error[0].code, "2500");
    });
});

describe("schema — TokenRefreshResponseSchema", () => {
    it("parses a valid token refresh response", () => {
        const result = TokenRefreshResponseSchema.parse({
            access_token: "new-access",
            refresh_token: "new-refresh",
            expires_in: 3600,
            x_refresh_token_expires_in: 8726400,
            token_type: "bearer"
        });
        assert.equal(result.access_token, "new-access");
    });
});

import { QboClient } from "../src/client.js";
import { createServer as createHttpServer2 } from "node:http";

describe("client — refreshAccessToken", () => {
    it("POSTs refresh_token grant and updates stored tokens", async () => {
        let capturedAuth = "";
        let capturedBody = "";
        const server = createHttpServer2((req, res) => {
            capturedAuth = req.headers.authorization || "";
            const chunks: Buffer[] = [];
            req.on("data", c => chunks.push(c));
            req.on("end", () => {
                capturedBody = Buffer.concat(chunks).toString();
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    access_token: "refreshed-access",
                    refresh_token: "rotated-refresh",
                    expires_in: 3600,
                    x_refresh_token_expires_in: 8726400,
                    token_type: "bearer"
                }));
            });
        });
        await new Promise<void>(r => server.listen(0, r));
        const port = (server.address() as { port: number }).port;

        try {
            const client = new QboClient({
                clientId: "CID",
                clientSecret: "SEC",
                accessToken: "old-access",
                refreshToken: "old-refresh",
                realmId: "REALM",
                tokenUrl: `http://localhost:${port}/oauth2/v1/tokens/bearer`,
                baseUrl: "http://unused"
            });
            await client.refreshAccessToken();

            assert.equal(client.getAccessToken(), "refreshed-access");
            assert.equal(client.getRefreshToken(), "rotated-refresh");

            const expectedAuth = "Basic " + Buffer.from("CID:SEC").toString("base64");
            assert.equal(capturedAuth, expectedAuth);

            const params = new URLSearchParams(capturedBody);
            assert.equal(params.get("grant_type"), "refresh_token");
            assert.equal(params.get("refresh_token"), "old-refresh");
        } finally {
            await new Promise<void>(r => server.close(() => r()));
        }
    });
});

describe("client — rate limiter", () => {
    it("serializes requests with minimum interval", async () => {
        const client = new QboClient({
            clientId: "c", clientSecret: "s",
            accessToken: "a", refreshToken: "r",
            realmId: "R", tokenUrl: "http://unused",
            baseUrl: "http://unused",
            minIntervalMs: 50
        });

        const timestamps: number[] = [];
        const runs = [0, 1, 2].map(async () => {
            await client.enqueue(async () => {
                timestamps.push(Date.now());
                return null;
            });
        });
        await Promise.all(runs);

        assert.equal(timestamps.length, 3);
        assert.ok(timestamps[1] - timestamps[0] >= 45, `gap 1 too small: ${timestamps[1] - timestamps[0]}`);
        assert.ok(timestamps[2] - timestamps[1] >= 45, `gap 2 too small: ${timestamps[2] - timestamps[1]}`);
    });
});
