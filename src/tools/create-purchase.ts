import { z } from "zod";
import { QboClient } from "../client.js";
import { PurchaseResponseSchema } from "../schema.js";
import { formatMemoMarker, validateSessionTag } from "../session.js";
import { isDryRun } from "../util/dry-run.js";

export const createPurchaseInputSchema = z.object({
    txnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Transaction date (YYYY-MM-DD)"),
    paymentType: z.enum(["Cash", "Check", "CreditCard"]).describe("Payment type"),
    paymentAccountId: z.string().describe("QBO Account Id for the payment source (bank or credit card)"),
    totalAmt: z.number().positive().describe("Total amount in the transaction currency (tax-inclusive for Quick Method)"),
    expenseAccountId: z.string().describe("QBO Account Id for the expense line (e.g. Subscriptions, Meals)"),
    vendorId: z.string().optional().describe("QBO Vendor Id for EntityRef"),
    currencyCode: z.string().regex(/^[A-Z]{3}$/).optional().describe("ISO 4217 currency code if different from home currency"),
    exchangeRate: z.number().positive().optional().describe("Exchange rate (home currency per 1 foreign unit). REQUIRED if currencyCode differs from home currency."),
    description: z.string().optional().describe("Optional line description"),
    source: z.enum(["gmail", "pp", "manual"]).describe("Source of the transaction (for memo marker)"),
    sourceId: z.string().min(1).describe("Source identifier (gmail message id, paypal transaction id, or manual description)"),
    sessionTag: z.string().describe("Session tag in YYYY-MM-DD-HHmm format for rollback grouping"),
    existingNote: z.string().optional().describe("Optional existing note text (memo marker will be appended)")
});
export type CreatePurchaseInput = z.infer<typeof createPurchaseInputSchema>;

export function buildPurchasePayload(input: CreatePurchaseInput): Record<string, unknown> {
    validateSessionTag(input.sessionTag);
    if (input.currencyCode && input.exchangeRate === undefined) {
        throw new Error(`ExchangeRate is required when currencyCode is set (got currencyCode=${input.currencyCode})`);
    }

    const privateNote = formatMemoMarker({
        source: input.source,
        sourceId: input.sourceId,
        sessionTag: input.sessionTag,
        existingNote: input.existingNote
    });

    const payload: Record<string, unknown> = {
        TxnDate: input.txnDate,
        PaymentType: input.paymentType,
        AccountRef: { value: input.paymentAccountId },
        TotalAmt: input.totalAmt,
        PrivateNote: privateNote,
        Line: [{
            Amount: input.totalAmt,
            Description: input.description,
            DetailType: "AccountBasedExpenseLineDetail",
            AccountBasedExpenseLineDetail: {
                AccountRef: { value: input.expenseAccountId }
            }
        }]
    };
    if (input.vendorId) {
        payload.EntityRef = { value: input.vendorId, type: "Vendor" };
    }
    if (input.currencyCode) {
        payload.CurrencyRef = { value: input.currencyCode };
        payload.ExchangeRate = input.exchangeRate;
    }
    return payload;
}

export async function createPurchase(
    client: QboClient,
    input: CreatePurchaseInput,
    env: Record<string, string | undefined> = process.env
): Promise<unknown> {
    const payload = buildPurchasePayload(input);
    if (isDryRun(env)) {
        return { dryRun: true, wouldSend: { method: "POST", path: `/v3/company/${client.getRealmId()}/purchase`, body: payload } };
    }
    const path = `/v3/company/${client.getRealmId()}/purchase`;
    const raw = await client.fetchJson(path, {
        method: "POST",
        body: JSON.stringify(payload)
    });
    return PurchaseResponseSchema.parse(raw);
}
