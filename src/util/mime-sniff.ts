type Signature = (buf: Buffer) => boolean;

const startsWith = (bytes: number[]): Signature => (buf: Buffer) => {
    if (buf.length < bytes.length) return false;
    for (let i = 0; i < bytes.length; i++) {
        if (buf[i] !== bytes[i]) return false;
    }
    return true;
};

const anyOf = (sigs: Signature[]): Signature => (buf: Buffer) => sigs.some((s) => s(buf));

const PDF = startsWith([0x25, 0x50, 0x44, 0x46, 0x2D]); // %PDF-
const PNG = startsWith([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const JPEG = startsWith([0xFF, 0xD8, 0xFF]);
const GIF87 = startsWith([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]);
const GIF89 = startsWith([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const GIF = anyOf([GIF87, GIF89]);
const TIFF_LE = startsWith([0x49, 0x49, 0x2A, 0x00]);
const TIFF_BE = startsWith([0x4D, 0x4D, 0x00, 0x2A]);
const TIFF = anyOf([TIFF_LE, TIFF_BE]);
// Known tradeoff: DOCX/XLSX are ZIP containers. We verify the ZIP local-file-header
// magic (PK\x03\x04) but do NOT introspect Content_Types.xml or the internal
// directory structure (word/ vs xl/). A generic .zip renamed to .docx will pass.
// This is an accepted SEC-4 tradeoff — the sniff is a coarse filter against
// wildly-mismatched content (e.g. EXE declared as PDF), not a full format validator.
const ZIP = startsWith([0x50, 0x4B, 0x03, 0x04]); // PK\x03\x04

const SIGS: Record<string, { minBytes: number; check: Signature }> = {
    "application/pdf": { minBytes: 5, check: PDF },
    "image/png": { minBytes: 8, check: PNG },
    "image/jpeg": { minBytes: 3, check: JPEG },
    "image/gif": { minBytes: 6, check: GIF },
    "image/tiff": { minBytes: 4, check: TIFF },
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { minBytes: 4, check: ZIP },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { minBytes: 4, check: ZIP }
};

export const SNIFFABLE_TYPES = new Set(Object.keys(SIGS));

export function sniffMimeType(buf: Buffer, declaredType: string): void {
    const sig = SIGS[declaredType];
    if (!sig) {
        // text/plain, text/csv, or anything else not sniffable — caller's responsibility.
        return;
    }
    if (buf.length < sig.minBytes) {
        throw new Error(`File too small to sniff magic bytes for ${declaredType} (need ${sig.minBytes} bytes, got ${buf.length})`);
    }
    if (!sig.check(buf)) {
        throw new Error(`File content does not match declared contentType ${declaredType} (magic bytes mismatch)`);
    }
}
