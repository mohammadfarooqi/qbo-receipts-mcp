import { createServer, Server, IncomingMessage, ServerResponse } from "node:http";

export interface MockQboServerHandle {
    baseUrl: string;
    tokenUrl: string;
    close: () => Promise<void>;
    getRecordedRequests: () => Array<{ method: string; url: string; body: string }>;
}

export interface MockQboServerOptions {
    purchases?: Record<string, unknown>;
    companyInfo?: unknown;
    onRefresh?: () => { access_token: string; refresh_token: string };
}

export async function startMockQboServer(opts: MockQboServerOptions = {}): Promise<MockQboServerHandle> {
    const purchases: Record<string, unknown> = { ...opts.purchases };
    const recorded: Array<{ method: string; url: string; body: string }> = [];

    const handleRequest = (req: IncomingMessage, res: ServerResponse) => {
        const chunks: Buffer[] = [];
        req.on("data", c => chunks.push(c));
        req.on("end", () => {
            const body = Buffer.concat(chunks).toString();
            recorded.push({ method: req.method || "", url: req.url || "", body });
            const url = new URL(req.url || "/", "http://localhost");

            // Token endpoint
            if (url.pathname === "/oauth2/v1/tokens/bearer") {
                const tokens = opts.onRefresh
                    ? opts.onRefresh()
                    : { access_token: "mock-access", refresh_token: "mock-refresh" };
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    ...tokens,
                    expires_in: 3600,
                    x_refresh_token_expires_in: 8726400,
                    token_type: "bearer"
                }));
                return;
            }

            // Get company info
            if (url.pathname.match(/\/v3\/company\/[^/]+\/companyinfo\/[^/]+$/)) {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    CompanyInfo: opts.companyInfo ?? {
                        CompanyName: "Mock Company",
                        Country: "CA",
                        SupportedLanguages: "en",
                        Id: "1",
                        SyncToken: "0"
                    },
                    time: "2026-04-10T00:00:00Z"
                }));
                return;
            }

            // Query endpoint (for search_purchases)
            if (url.pathname.match(/\/v3\/company\/[^/]+\/query$/)) {
                const query = url.searchParams.get("query") || "";
                const rows = Object.values(purchases);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    QueryResponse: {
                        Purchase: query.includes("Purchase") ? rows : [],
                        startPosition: 1,
                        maxResults: rows.length
                    },
                    time: "2026-04-10T00:00:00Z"
                }));
                return;
            }

            // Create purchase (POST) or delete (POST with operation=delete)
            if (url.pathname.match(/\/v3\/company\/[^/]+\/purchase$/) && req.method === "POST") {
                if (url.searchParams.get("operation") === "delete") {
                    const parsed = JSON.parse(body) as { Id: string; SyncToken: string };
                    delete purchases[parsed.Id];
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({
                        Purchase: { ...parsed, status: "Deleted" },
                        time: "2026-04-10T00:00:00Z"
                    }));
                    return;
                }
                const parsed = JSON.parse(body) as Record<string, unknown>;
                const id = String(Object.keys(purchases).length + 1);
                const created = {
                    ...parsed,
                    Id: id,
                    SyncToken: "0",
                    MetaData: { CreateTime: "2026-04-10T00:00:00Z", LastUpdatedTime: "2026-04-10T00:00:00Z" }
                };
                purchases[id] = created;
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ Purchase: created, time: "2026-04-10T00:00:00Z" }));
                return;
            }

            // Upload attachable
            if (url.pathname.match(/\/v3\/company\/[^/]+\/upload$/) && req.method === "POST") {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    AttachableResponse: [{
                        Attachable: {
                            Id: "ATTACH1",
                            FileName: "mock.pdf",
                            SyncToken: "0"
                        }
                    }],
                    time: "2026-04-10T00:00:00Z"
                }));
                return;
            }

            res.writeHead(404);
            res.end(`Mock server: no handler for ${req.method} ${url.pathname}`);
        });
    };

    const server: Server = createServer(handleRequest);
    await new Promise<void>(r => server.listen(0, r));
    const port = (server.address() as { port: number }).port;

    return {
        baseUrl: `http://localhost:${port}`,
        tokenUrl: `http://localhost:${port}/oauth2/v1/tokens/bearer`,
        close: () => new Promise<void>(r => server.close(() => r())),
        getRecordedRequests: () => [...recorded]
    };
}
