import { z } from "zod";
import { QboClient } from "../client.js";
import { VendorResponseSchema } from "../schema.js";

export const getVendorInputSchema = z.object({
    id: z.string().min(1).describe("QBO Vendor Id")
});
export type GetVendorInput = z.infer<typeof getVendorInputSchema>;

export async function getVendor(client: QboClient, input: GetVendorInput): Promise<unknown> {
    const path = `/v3/company/${client.getRealmId()}/vendor/${encodeURIComponent(input.id)}`;
    const raw = await client.fetchJson(path);
    return VendorResponseSchema.parse(raw);
}
