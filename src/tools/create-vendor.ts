import { z } from "zod";
import { QboClient } from "../client.js";
import { VendorResponseSchema } from "../schema.js";
import { isDryRun } from "../util/dry-run.js";

export const createVendorInputSchema = z.object({
    displayName: z.string().min(1).max(500).describe("Display name shown in QBO. For USD vendors, suffix with '(USD)' per project convention."),
    companyName: z.string().max(500).optional().describe("Legal company name (separate from DisplayName)"),
    givenName: z.string().max(100).optional().describe("First name (for individual vendors)"),
    familyName: z.string().max(100).optional().describe("Last name (for individual vendors)"),
    email: z.string().email().max(200).optional().describe("Primary email"),
    phone: z.string().max(50).optional().describe("Primary phone"),
    webAddr: z.string().url().max(500).optional().describe("Web URL"),
    currencyCode: z.string().regex(/^[A-Z]{3}$/).optional().describe("ISO 4217 currency code. PERMANENT — cannot be changed after creation. Defaults to home currency if omitted."),
    notes: z.string().max(2000).optional().describe("Free-form notes stored on the vendor"),
    taxIdentifier: z.string().max(50).optional().describe("Tax ID number (e.g. BN for Canadian vendors)"),
    vendor1099: z.boolean().optional().describe("1099 eligibility flag (US context)"),
    billAddrLine1: z.string().max(500).optional(),
    billAddrLine2: z.string().max(500).optional(),
    billAddrCity: z.string().max(100).optional(),
    billAddrCountrySubDivisionCode: z.string().max(100).optional(),
    billAddrPostalCode: z.string().max(30).optional(),
    billAddrCountry: z.string().max(100).optional()
});
export type CreateVendorInput = z.infer<typeof createVendorInputSchema>;

export function buildVendorPayload(input: CreateVendorInput): Record<string, unknown> {
    const payload: Record<string, unknown> = { DisplayName: input.displayName };
    if (input.companyName) payload.CompanyName = input.companyName;
    if (input.givenName) payload.GivenName = input.givenName;
    if (input.familyName) payload.FamilyName = input.familyName;
    if (input.email) payload.PrimaryEmailAddr = { Address: input.email };
    if (input.phone) payload.PrimaryPhone = { FreeFormNumber: input.phone };
    if (input.webAddr) payload.WebAddr = { URI: input.webAddr };
    if (input.currencyCode) payload.CurrencyRef = { value: input.currencyCode };
    if (input.notes) payload.Notes = input.notes;
    if (input.taxIdentifier) payload.TaxIdentifier = input.taxIdentifier;
    if (input.vendor1099 !== undefined) payload.Vendor1099 = input.vendor1099;

    const addr: Record<string, string> = {};
    if (input.billAddrLine1) addr.Line1 = input.billAddrLine1;
    if (input.billAddrLine2) addr.Line2 = input.billAddrLine2;
    if (input.billAddrCity) addr.City = input.billAddrCity;
    if (input.billAddrCountrySubDivisionCode) addr.CountrySubDivisionCode = input.billAddrCountrySubDivisionCode;
    if (input.billAddrPostalCode) addr.PostalCode = input.billAddrPostalCode;
    if (input.billAddrCountry) addr.Country = input.billAddrCountry;
    if (Object.keys(addr).length > 0) payload.BillAddr = addr;

    return payload;
}

export async function createVendor(
    client: QboClient,
    input: CreateVendorInput,
    env: Record<string, string | undefined> = process.env
): Promise<unknown> {
    const payload = buildVendorPayload(input);
    if (isDryRun(env)) {
        return { dryRun: true, wouldSend: { method: "POST", path: `/v3/company/${client.getRealmId()}/vendor`, body: payload } };
    }
    const path = `/v3/company/${client.getRealmId()}/vendor`;
    const raw = await client.fetchJson(path, {
        method: "POST",
        body: JSON.stringify(payload)
    });
    return VendorResponseSchema.parse(raw);
}
