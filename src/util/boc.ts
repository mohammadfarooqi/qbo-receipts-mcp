const BOC_DEFAULT_BASE = "https://www.bankofcanada.ca";
const WINDOW_DAYS = 7;

export interface BocResult {
    date: string;
    rate: number;
    observationDate: string;
    sourceUrl: string;
}

export function computeWindow(date: string): { startDate: string; endDate: string } {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error(`Invalid date "${date}" — expected YYYY-MM-DD`);
    }
    const end = new Date(date + "T00:00:00Z");
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - WINDOW_DAYS);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return { startDate: iso(start), endDate: iso(end) };
}

interface ValetObservation {
    d: string;
    FXUSDCAD?: { v: string };
}

export function parseBocObservations(body: unknown, targetDate: string): { rate: number; observationDate: string } {
    const parsed = body as { observations?: ValetObservation[] };
    const obs = parsed.observations ?? [];
    const eligible = obs
        .filter((o) => typeof o.d === "string" && o.d <= targetDate && o.FXUSDCAD && typeof o.FXUSDCAD.v === "string")
        .sort((a, b) => (a.d < b.d ? 1 : -1));
    if (eligible.length === 0) {
        throw new Error(`No BoC observation found on or before ${targetDate}`);
    }
    const latest = eligible[0];
    const rate = Number.parseFloat(latest.FXUSDCAD!.v);
    if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error(`BoC observation for ${latest.d} has invalid rate: ${latest.FXUSDCAD!.v}`);
    }
    return { rate, observationDate: latest.d };
}

export interface FetchBocRateOptions {
    baseUrl?: string;
}

export async function fetchBocRate(date: string, opts: FetchBocRateOptions = {}): Promise<BocResult> {
    const { startDate, endDate } = computeWindow(date);
    const baseUrl = opts.baseUrl ?? BOC_DEFAULT_BASE;
    const path = `/valet/observations/FXUSDCAD/json?start_date=${startDate}&end_date=${endDate}`;
    const url = `${baseUrl}${path}`;
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`BoC Valet API error: ${res.status} ${text}`);
    }
    const json = await res.json() as unknown;
    const { rate, observationDate } = parseBocObservations(json, date);
    return { date, rate, observationDate, sourceUrl: url };
}
