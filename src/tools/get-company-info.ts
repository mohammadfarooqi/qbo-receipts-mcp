import { z } from "zod";
import { QboClient } from "../client.js";
import { CompanyInfoSchema } from "../schema.js";

export const getCompanyInfoInputSchema = z.object({}).describe("No parameters. Returns the company info for the authenticated realm.");
export type GetCompanyInfoInput = z.infer<typeof getCompanyInfoInputSchema>;

export async function getCompanyInfo(client: QboClient, _input: GetCompanyInfoInput): Promise<unknown> {
    const path = `/v3/company/${client.getRealmId()}/companyinfo/${client.getRealmId()}`;
    const raw = await client.fetchJson(path);
    return CompanyInfoSchema.parse(raw);
}
