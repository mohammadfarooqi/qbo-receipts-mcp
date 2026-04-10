const SESSION_TAG_PATTERN = /^\d{4}-\d{2}-\d{2}-\d{4}$/;

export function validateSessionTag(tag: string): string {
    if (!tag || !SESSION_TAG_PATTERN.test(tag)) {
        throw new Error(`Invalid session tag "${tag}" — expected YYYY-MM-DD-HHmm`);
    }
    return tag;
}

export interface MemoMarkerOptions {
    source: "gmail" | "pp" | "manual";
    sourceId: string;
    sessionTag: string;
    existingNote?: string;
}

export function formatMemoMarker(opts: MemoMarkerOptions): string {
    validateSessionTag(opts.sessionTag);
    if (opts.existingNote !== undefined) {
        if (/[|\r\n\0]/.test(opts.existingNote)) {
            throw new Error("existingNote must not contain pipe, newline, or null characters (memo marker injection prevention)");
        }
    }
    const marker = `auto:${opts.source}:${opts.sourceId} | sess:${opts.sessionTag}`;
    if (opts.existingNote && opts.existingNote.trim().length > 0) {
        return `${opts.existingNote.trim()} | ${marker}`;
    }
    return marker;
}
