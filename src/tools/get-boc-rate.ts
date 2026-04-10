import { z } from "zod";
import { fetchBocRate } from "../util/boc.js";

export const getBocRateInputSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Transaction date (YYYY-MM-DD). Returns the latest Bank of Canada USD/CAD observation on or before this date (falls back up to 7 days for weekends/holidays).")
});
export type GetBocRateInput = z.infer<typeof getBocRateInputSchema>;

export async function getBocRate(
    input: GetBocRateInput,
    env: Record<string, string | undefined> = process.env
): Promise<unknown> {
    const baseUrl = env.BOC_BASE_URL;
    return fetchBocRate(input.date, baseUrl ? { baseUrl } : {});
}
