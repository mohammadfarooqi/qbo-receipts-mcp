import { z } from "zod";
import { QboClient } from "../client.js";
import { VendorQueryResponseSchema } from "../schema.js";

// Allow letters, digits, spaces, and a small set of safe punctuation.
// Rejects single-quote, percent, backslash, semicolon, and control chars.
const NAME_PREFIX_PATTERN = /^[A-Za-z0-9 .,&()_\-]+$/;

export const searchVendorsInputSchema = z.object({
    namePrefix: z.string().min(1).max(100).regex(NAME_PREFIX_PATTERN, "namePrefix contains unsafe characters").optional().describe("Prefix match on DisplayName. Safe characters only (no quotes, %, ;, backslash)."),
    currencyCode: z.string().regex(/^[A-Z]{3}$/).optional().describe("ISO 4217 currency code (e.g. USD, CAD)"),
    active: z.boolean().optional().describe("Filter by Active flag"),
    maxResults: z.number().int().min(1).max(1000).default(500).describe("Max rows to return (1-1000)")
});
export type SearchVendorsInput = z.infer<typeof searchVendorsInputSchema>;

export function buildVendorsQuery(input: Partial<SearchVendorsInput>): string {
    const clauses: string[] = [];
    if (input.namePrefix) {
        clauses.push(`DisplayName LIKE '${input.namePrefix}%'`);
    }
    if (input.currencyCode) {
        clauses.push(`CurrencyRef = '${input.currencyCode}'`);
    }
    if (input.active !== undefined) {
        clauses.push(`Active = ${input.active ? "true" : "false"}`);
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
    const max = input.maxResults ?? 500;
    return `SELECT * FROM Vendor${where} ORDER BY DisplayName MAXRESULTS ${max}`;
}

export async function searchVendors(client: QboClient, input: SearchVendorsInput): Promise<unknown> {
    const query = buildVendorsQuery(input);
    const encoded = encodeURIComponent(query);
    const path = `/v3/company/${client.getRealmId()}/query?query=${encoded}`;
    const raw = await client.fetchJson(path);
    return VendorQueryResponseSchema.parse(raw);
}
