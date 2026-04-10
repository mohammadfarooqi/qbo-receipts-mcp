import { TokenRefreshResponseSchema } from "./schema.js";

export interface QboClientOptions {
    clientId: string;
    clientSecret: string;
    accessToken: string;
    refreshToken: string;
    realmId: string;
    tokenUrl: string;
    baseUrl: string;
    minIntervalMs?: number;
}

export class QboClient {
    private clientId: string;
    private clientSecret: string;
    private accessToken: string;
    private refreshToken: string;
    private realmId: string;
    private tokenUrl: string;
    private baseUrl: string;
    private queue: Promise<unknown> = Promise.resolve();
    private minIntervalMs: number;
    private lastRequestAt = 0;

    constructor(opts: QboClientOptions) {
        this.clientId = opts.clientId;
        this.clientSecret = opts.clientSecret;
        this.accessToken = opts.accessToken;
        this.refreshToken = opts.refreshToken;
        this.realmId = opts.realmId;
        this.tokenUrl = opts.tokenUrl;
        this.baseUrl = opts.baseUrl;
        this.minIntervalMs = opts.minIntervalMs ?? 150;
    }

    getAccessToken(): string { return this.accessToken; }
    getRefreshToken(): string { return this.refreshToken; }
    getRealmId(): string { return this.realmId; }
    getBaseUrl(): string { return this.baseUrl; }

    async refreshAccessToken(): Promise<void> {
        const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
        const body = new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: this.refreshToken
        }).toString();
        const res = await fetch(this.tokenUrl, {
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
            throw new Error(`Token refresh failed: ${res.status} ${text}`);
        }
        const parsed = TokenRefreshResponseSchema.parse(await res.json());
        this.accessToken = parsed.access_token;
        this.refreshToken = parsed.refresh_token;
    }
}
