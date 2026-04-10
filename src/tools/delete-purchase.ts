import { z } from "zod";
import { QboClient } from "../client.js";
import { isDryRun } from "../util/dry-run.js";

export const deletePurchaseInputSchema = z.object({
    id: z.string().describe("QBO Purchase Id to soft-delete"),
    syncToken: z.string().describe("Current SyncToken of the Purchase (required by QBO for updates/deletes)")
});
export type DeletePurchaseInput = z.infer<typeof deletePurchaseInputSchema>;

export async function deletePurchase(
    client: QboClient,
    input: DeletePurchaseInput,
    env: Record<string, string | undefined> = process.env
): Promise<unknown> {
    const payload = { Id: input.id, SyncToken: input.syncToken };
    if (isDryRun(env)) {
        return { dryRun: true, wouldSend: { method: "POST", path: `/v3/company/${client.getRealmId()}/purchase?operation=delete`, body: payload } };
    }
    const path = `/v3/company/${client.getRealmId()}/purchase?operation=delete`;
    return client.fetchJson(path, {
        method: "POST",
        body: JSON.stringify(payload)
    });
}
