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
