import { z } from "zod";
import { QboClient } from "../client.js";
import { VendorResponseSchema } from "../schema.js";
import { isDryRun } from "../util/dry-run.js";

// Strict mode: rejects unknown fields like `currencyCode` (see A7 — vendor
// currency is set at creation and is immutable per QBO rules).
export const updateVendorInputSchema = z.object({
    id: z.string().min(1).describe("QBO Vendor Id to update"),
    syncToken: z.string().describe("Current SyncToken of the Vendor (required by QBO for updates)"),
    displayName: z.string().min(1).max(500).optional().describe("New display name"),
    companyName: z.string().max(500).optional(),
    givenName: z.string().max(100).optional(),
    familyName: z.string().max(100).optional(),
    email: z.string().email().max(200).optional(),
    phone: z.string().max(50).optional(),
    webAddr: z.string().url().max(500).optional(),
    notes: z.string().max(2000).optional(),
    taxIdentifier: z.string().max(50).optional(),
    vendor1099: z.boolean().optional(),
    active: z.boolean().optional().describe("Set Active flag — use false to archive a vendor"),
    billAddrLine1: z.string().max(500).optional(),
    billAddrLine2: z.string().max(500).optional(),
    billAddrCity: z.string().max(100).optional(),
    billAddrCountrySubDivisionCode: z.string().max(100).optional(),
    billAddrPostalCode: z.string().max(30).optional(),
    billAddrCountry: z.string().max(100).optional()
}).strict();
export type UpdateVendorInput = z.infer<typeof updateVendorInputSchema>;

export function buildVendorUpdatePayload(input: UpdateVendorInput): Record<string, unknown> {
    const payload: Record<string, unknown> = {
        Id: input.id,
        SyncToken: input.syncToken,
        sparse: true
    };
    let changed = 0;
    if (input.displayName !== undefined) { payload.DisplayName = input.displayName; changed++; }
    if (input.companyName !== undefined) { payload.CompanyName = input.companyName; changed++; }
    if (input.givenName !== undefined) { payload.GivenName = input.givenName; changed++; }
    if (input.familyName !== undefined) { payload.FamilyName = input.familyName; changed++; }
    if (input.email !== undefined) { payload.PrimaryEmailAddr = { Address: input.email }; changed++; }
    if (input.phone !== undefined) { payload.PrimaryPhone = { FreeFormNumber: input.phone }; changed++; }
    if (input.webAddr !== undefined) { payload.WebAddr = { URI: input.webAddr }; changed++; }
    if (input.notes !== undefined) { payload.Notes = input.notes; changed++; }
    if (input.taxIdentifier !== undefined) { payload.TaxIdentifier = input.taxIdentifier; changed++; }
    if (input.vendor1099 !== undefined) { payload.Vendor1099 = input.vendor1099; changed++; }
    if (input.active !== undefined) { payload.Active = input.active; changed++; }

    const addr: Record<string, string> = {};
    if (input.billAddrLine1 !== undefined) addr.Line1 = input.billAddrLine1;
    if (input.billAddrLine2 !== undefined) addr.Line2 = input.billAddrLine2;
    if (input.billAddrCity !== undefined) addr.City = input.billAddrCity;
    if (input.billAddrCountrySubDivisionCode !== undefined) addr.CountrySubDivisionCode = input.billAddrCountrySubDivisionCode;
    if (input.billAddrPostalCode !== undefined) addr.PostalCode = input.billAddrPostalCode;
    if (input.billAddrCountry !== undefined) addr.Country = input.billAddrCountry;
    if (Object.keys(addr).length > 0) { payload.BillAddr = addr; changed++; }

    if (changed === 0) {
        throw new Error("update_vendor requires at least one field to change besides id and syncToken");
    }
    return payload;
}

export async function updateVendor(
    client: QboClient,
    input: UpdateVendorInput,
    env: Record<string, string | undefined> = process.env
): Promise<unknown> {
    const payload = buildVendorUpdatePayload(input);
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
