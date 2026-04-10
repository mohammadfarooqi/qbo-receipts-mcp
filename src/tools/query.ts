import { z } from "zod";
import { QboClient } from "../client.js";

const MIN_QUERY_LEN = 10;
const MAX_QUERY_LEN = 2000;
// Mutation-proxy keywords. INTO is included because QBO's query dialect does
// not support SELECT ... INTO; rejecting it blocks a class of result-diversion
// attempts even though no HTTP state change is possible on /query (GET).
const MUTATION_KEYWORDS = ["INSERT", "UPDATE", "DELETE", "MERGE", "TRUNCATE", "CDC", "INTO"];

export const queryInputSchema = z.object({
    query: z.string().describe("Raw QBO query (SELECT-only). Max 2000 chars. No semicolons or mutation keywords.")
});
export type QueryInput = z.infer<typeof queryInputSchema>;

/**
 * Defense-in-depth guard for the QBO /query passthrough.
 *
 * Known tradeoffs (intentional — the tool is an escape hatch, callers can
 * restructure queries that trip false positives):
 *   - Mutation keywords inside string literals are rejected
 *     (e.g. WHERE Notes = 'please DELETE later' will fail).
 *   - `--` and `/* ... *\/` sequences inside string literals are also rejected.
 *   - Only ASCII SELECT is accepted; unicode lookalikes (e.g. fullwidth ＳELECT)
 *     are rejected by the /^SELECT\s/i anchor.
 */
export function validateQuery(q: string): void {
    if (q.length < MIN_QUERY_LEN || q.length > MAX_QUERY_LEN) {
        throw new Error(`query length ${q.length} is outside allowed range ${MIN_QUERY_LEN}-${MAX_QUERY_LEN}`);
    }
    const trimmed = q.trim();
    if (!/^SELECT\s/i.test(trimmed)) {
        throw new Error("query must start with SELECT");
    }
    if (trimmed.includes(";")) {
        throw new Error("query must not contain semicolon");
    }
    if (trimmed.includes("--")) {
        throw new Error("query must not contain SQL comment (--)");
    }
    if (trimmed.includes("/*") || trimmed.includes("*/")) {
        throw new Error("query must not contain SQL comment (/* */)");
    }
    const upper = trimmed.toUpperCase();
    for (const kw of MUTATION_KEYWORDS) {
        // Whole-word match only; \b is ASCII word boundary which is correct
        // here because every keyword is ASCII letters.
        const re = new RegExp(`\\b${kw}\\b`);
        if (re.test(upper)) {
            throw new Error(`query contains forbidden mutation keyword: ${kw}`);
        }
    }
}

export async function query(client: QboClient, input: QueryInput): Promise<unknown> {
    validateQuery(input.query);
    const encoded = encodeURIComponent(input.query);
    const path = `/v3/company/${client.getRealmId()}/query?query=${encoded}`;
    return client.fetchJson(path);
}
