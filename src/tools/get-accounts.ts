import { z } from "zod";
import { QboClient } from "../client.js";
import { AccountQueryResponseSchema } from "../schema.js";

const KNOWN_ACCOUNT_TYPES = [
    "Bank",
    "Other Current Asset",
    "Fixed Asset",
    "Other Asset",
    "Accounts Receivable",
    "Equity",
    "Expense",
    "Other Expense",
    "Cost of Goods Sold",
    "Accounts Payable",
    "Credit Card",
    "Long Term Liability",
    "Other Current Liability",
    "Income",
    "Other Income"
] as const;

export const getAccountsInputSchema = z.object({
    accountType: z.enum(KNOWN_ACCOUNT_TYPES).optional().describe("Filter by AccountType (e.g. Bank, Credit Card, Expense)"),
    active: z.boolean().optional().describe("Filter by Active flag"),
    maxResults: z.number().int().min(1).max(1000).default(500).describe("Max rows to return (1-1000)")
});
export type GetAccountsInput = z.infer<typeof getAccountsInputSchema>;

export function buildAccountsQuery(input: Partial<GetAccountsInput>): string {
    const clauses: string[] = [];
    if (input.accountType) {
        clauses.push(`AccountType = '${input.accountType}'`);
    }
    if (input.active !== undefined) {
        clauses.push(`Active = ${input.active ? "true" : "false"}`);
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
    const max = input.maxResults ?? 500;
    return `SELECT * FROM Account${where} ORDER BY Name MAXRESULTS ${max}`;
}

export async function getAccounts(client: QboClient, input: GetAccountsInput): Promise<unknown> {
    const query = buildAccountsQuery(input);
    const encoded = encodeURIComponent(query);
    const path = `/v3/company/${client.getRealmId()}/query?query=${encoded}`;
    const raw = await client.fetchJson(path);
    return AccountQueryResponseSchema.parse(raw);
}
