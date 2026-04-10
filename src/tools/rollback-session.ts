import { z } from "zod";
import { QboClient } from "../client.js";
import { PurchaseQueryResponseSchema, Purchase } from "../schema.js";
import { validateSessionTag } from "../session.js";
import { isDryRun } from "../util/dry-run.js";
import { buildPurchaseQuery } from "./search-purchases.js";

const DEFAULT_WINDOW_DAYS = 60;

const SESSION_TAG_REGEX = /^\d{4}-\d{2}-\d{2}-\d{4}$/;

export const rollbackSessionInputSchema = z.object({
    sessionTag: z.string().regex(SESSION_TAG_REGEX, "Session tag must be in YYYY-MM-DD-HHmm format").describe("Session tag in YYYY-MM-DD-HHmm format — identifies the write batch to roll back"),
    txnDateAfter: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Lower bound on transaction date (defaults to today − 60 days)"),
    txnDateBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Upper bound on transaction date (defaults to tomorrow)")
});
export type RollbackSessionInput = z.infer<typeof rollbackSessionInputSchema>;

export function computeDefaultDateWindow(now: Date = new Date()): { txnDateAfter: string; txnDateBefore: string } {
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const before = new Date(now);
    before.setUTCDate(before.getUTCDate() + 1);
    const after = new Date(now);
    after.setUTCDate(after.getUTCDate() - DEFAULT_WINDOW_DAYS);
    return { txnDateAfter: iso(after), txnDateBefore: iso(before) };
}

export function filterPurchasesBySessionTag<T extends { PrivateNote?: string }>(rows: T[], tag: string): T[] {
    const needle = `sess:${tag}`;
    return rows.filter((r) => typeof r.PrivateNote === "string" && r.PrivateNote.includes(needle));
}

export async function rollbackSession(
    client: QboClient,
    input: RollbackSessionInput,
    env: Record<string, string | undefined> = process.env
): Promise<unknown> {
    validateSessionTag(input.sessionTag);
    const defaults = computeDefaultDateWindow();
    const txnDateAfter = input.txnDateAfter ?? defaults.txnDateAfter;
    const txnDateBefore = input.txnDateBefore ?? defaults.txnDateBefore;

    const query = buildPurchaseQuery({ txnDateAfter, txnDateBefore, maxResults: 1000 });
    const encoded = encodeURIComponent(query);
    const queryPath = `/v3/company/${client.getRealmId()}/query?query=${encoded}`;
    const raw = await client.fetchJson(queryPath);
    const parsed = PurchaseQueryResponseSchema.parse(raw);
    const rows: Purchase[] = parsed.QueryResponse.Purchase ?? [];
    const hits = filterPurchasesBySessionTag(rows, input.sessionTag);
    const ids = hits.map((h) => h.Id);

    if (isDryRun(env)) {
        return {
            dryRun: true,
            sessionTag: input.sessionTag,
            window: { txnDateAfter, txnDateBefore },
            matched: hits.length,
            deleted: 0,
            ids
        };
    }

    const deletePath = `/v3/company/${client.getRealmId()}/purchase?operation=delete`;
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const h of hits) {
        try {
            await client.fetchJson(deletePath, {
                method: "POST",
                body: JSON.stringify({ Id: h.Id, SyncToken: h.SyncToken })
            });
            results.push({ id: h.Id, ok: true });
        } catch (err) {
            results.push({ id: h.Id, ok: false, error: err instanceof Error ? err.message : String(err) });
        }
    }

    return {
        dryRun: false,
        sessionTag: input.sessionTag,
        window: { txnDateAfter, txnDateBefore },
        matched: hits.length,
        deleted: results.filter((r) => r.ok).length,
        ids,
        results
    };
}
