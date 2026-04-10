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

    async enqueue<T>(fn: () => Promise<T>): Promise<T> {
        const run = async (): Promise<T> => {
            const now = Date.now();
            const elapsed = now - this.lastRequestAt;
            if (elapsed < this.minIntervalMs) {
                await new Promise(r => setTimeout(r, this.minIntervalMs - elapsed));
            }
            this.lastRequestAt = Date.now();
            return fn();
        };
        const result = this.queue.then(run, run) as Promise<T>;
        this.queue = result.catch(() => undefined);
        return result;
    }

    async fetchJson(path: string, init: RequestInit = {}): Promise<unknown> {
        return this.enqueue(async () => {
            const url = `${this.baseUrl}${path}`;
            const doFetch = async (): Promise<Response> => {
                const headers = new Headers(init.headers);
                headers.set("Authorization", `Bearer ${this.accessToken}`);
                headers.set("Accept", "application/json");
                if (init.body && !headers.has("Content-Type")) {
                    headers.set("Content-Type", "application/json");
                }
                return fetch(url, { ...init, headers });
            };
            let res = await doFetch();
            if (res.status === 401) {
                await this.refreshAccessToken();
                res = await doFetch();
            }
            if (!res.ok) {
                const text = await res.text();
                throw new Error(`QBO API ${res.status}: ${text}`);
            }
            return res.json();
        });
    }

    async uploadAttachable(opts: {
        fileName: string;
        contentType: string;
        fileBytes: Buffer;
        entityType: string;
        entityId: string;
    }): Promise<{ Id: string; FileName: string }> {
        return this.enqueue(async () => {
            const boundary = `----qbo-mcp-${Date.now()}-${Math.random().toString(36).slice(2)}`;

            const metadata = JSON.stringify({
                AttachableRef: [{
                    EntityRef: {
                        type: opts.entityType,
                        value: opts.entityId
                    }
                }],
                FileName: opts.fileName,
                ContentType: opts.contentType
            }, null, 2);

            const CRLF = "\r\n";
            const parts: Buffer[] = [];
            parts.push(Buffer.from(`--${boundary}${CRLF}`));
            parts.push(Buffer.from(`Content-Disposition: form-data; name="file_metadata_01"${CRLF}`));
            parts.push(Buffer.from(`Content-Type: application/json${CRLF}${CRLF}`));
            parts.push(Buffer.from(metadata));
            parts.push(Buffer.from(`${CRLF}--${boundary}${CRLF}`));
            parts.push(Buffer.from(`Content-Disposition: form-data; name="file_content_01"; filename="${opts.fileName}"${CRLF}`));
            parts.push(Buffer.from(`Content-Type: ${opts.contentType}${CRLF}${CRLF}`));
            parts.push(opts.fileBytes);
            parts.push(Buffer.from(`${CRLF}--${boundary}--${CRLF}`));

            const body = Buffer.concat(parts);
            const url = `${this.baseUrl}/v3/company/${this.realmId}/upload`;
            const headers: Record<string, string> = {
                "Authorization": `Bearer ${this.accessToken}`,
                "Accept": "application/json",
                "Content-Type": `multipart/form-data; boundary=${boundary}`
            };

            let res = await fetch(url, { method: "POST", headers, body });
            if (res.status === 401) {
                await this.refreshAccessToken();
                headers["Authorization"] = `Bearer ${this.accessToken}`;
                res = await fetch(url, { method: "POST", headers, body });
            }
            if (!res.ok) {
                const text = await res.text();
                throw new Error(`Attachable upload failed: ${res.status} ${text}`);
            }
            const json = await res.json() as {
                AttachableResponse: Array<{ Attachable: { Id: string; FileName: string } }>;
            };
            return json.AttachableResponse[0].Attachable;
        });
    }
}
