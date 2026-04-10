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
