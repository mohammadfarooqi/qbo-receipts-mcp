import { z } from "zod";
import { QboClient } from "../client.js";
import { PurchaseQueryResponseSchema } from "../schema.js";

export const searchPurchasesInputSchema = z.object({
    txnDateAfter: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Inclusive lower bound on transaction date (YYYY-MM-DD)"),
    txnDateBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Inclusive upper bound on transaction date (YYYY-MM-DD)"),
    totalAmt: z.number().optional().describe("Exact total amount match (in the transaction currency, not home currency)"),
    currencyCode: z.string().regex(/^[A-Z]{3}$/).optional().describe("ISO 4217 currency code (e.g. USD, CAD, EUR)"),
    maxResults: z.number().int().min(1).max(1000).default(100).describe("Max rows to return (1-1000)")
});
export type SearchPurchasesInput = z.infer<typeof searchPurchasesInputSchema>;

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function buildPurchaseQuery(input: Partial<SearchPurchasesInput>): string {
    const clauses: string[] = [];
    if (input.txnDateAfter) {
        if (!DATE_PATTERN.test(input.txnDateAfter)) throw new Error(`Invalid txnDateAfter: ${input.txnDateAfter}`);
        clauses.push(`TxnDate >= '${input.txnDateAfter}'`);
    }
    if (input.txnDateBefore) {
        if (!DATE_PATTERN.test(input.txnDateBefore)) throw new Error(`Invalid txnDateBefore: ${input.txnDateBefore}`);
        clauses.push(`TxnDate <= '${input.txnDateBefore}'`);
    }
    if (input.totalAmt !== undefined) {
        if (!Number.isFinite(input.totalAmt) || input.totalAmt < 0) throw new Error(`Invalid totalAmt: ${input.totalAmt}`);
        clauses.push(`TotalAmt = '${input.totalAmt.toFixed(2)}'`);
    }
    if (input.currencyCode) {
        if (!CURRENCY_CODE_PATTERN.test(input.currencyCode)) throw new Error(`Invalid currencyCode: ${input.currencyCode}`);
        clauses.push(`CurrencyRef = '${input.currencyCode}'`);
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
    const max = input.maxResults ?? 100;
    return `SELECT * FROM Purchase${where} ORDER BY TxnDate DESC MAXRESULTS ${max}`;
}

export async function searchPurchases(client: QboClient, input: SearchPurchasesInput): Promise<unknown> {
    const query = buildPurchaseQuery(input);
    const encoded = encodeURIComponent(query);
    const path = `/v3/company/${client.getRealmId()}/query?query=${encoded}`;
    const raw = await client.fetchJson(path);
    return PurchaseQueryResponseSchema.parse(raw);
}
