import { z } from "zod";
import { closeSync, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { basename, normalize } from "node:path";
import { QboClient } from "../client.js";
import { AttachableSchema } from "../schema.js";
import { isDryRun } from "../util/dry-run.js";
import { sniffMimeType } from "../util/mime-sniff.js";

const ALLOWED_CONTENT_TYPES = new Set([
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/tiff",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
    "text/plain"
]);

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB per QBO docs

// Filename safety for multipart Content-Disposition header.
// Rejects: CR, LF, NUL, double-quote, backslash.
// Accepts: everything else including spaces, hyphens, underscores, dots, parens, unicode.
// Also enforces a length cap.
const UNSAFE_FILENAME_CHARS = /[\r\n\0"\\]/;
const MAX_FILENAME_LENGTH = 255;

export const uploadReceiptInputSchema = z.object({
    filePath: z.string().min(1).describe("Absolute path to the receipt file to upload"),
    contentType: z.string().describe("MIME content type (e.g. application/pdf, image/png, image/jpeg)"),
    entityType: z.enum(["Purchase", "Bill", "Invoice", "Estimate", "CreditMemo", "JournalEntry", "VendorCredit", "Deposit"]).describe("Type of QBO entity to attach to"),
    entityId: z.string().describe("QBO Id of the entity to attach to"),
    fileNameOverride: z.string().optional().describe("Optional override for the filename displayed in QBO")
});
export type UploadReceiptInput = z.infer<typeof uploadReceiptInputSchema>;

export interface ValidationOptions {
    allowedPrefixes?: string[];
    maxSize?: number;
}

export function validateUploadReceiptInput(input: UploadReceiptInput, opts: ValidationOptions): void {
    if (input.filePath.includes("..")) {
        throw new Error("Invalid filePath: path traversal (..) not allowed");
    }
    const normalized = normalize(input.filePath);
    if (opts.allowedPrefixes && opts.allowedPrefixes.length > 0) {
        const prefixesWithSlash = opts.allowedPrefixes.map(p => p.endsWith("/") ? p : p + "/");
        const normalizedForMatch = normalized.endsWith("/") ? normalized : normalized + "/";
        if (!prefixesWithSlash.some(p => normalizedForMatch.startsWith(p))) {
            throw new Error(`filePath ${normalized} is outside allowed directories: ${opts.allowedPrefixes.join(", ")}`);
        }
    }
    if (!ALLOWED_CONTENT_TYPES.has(input.contentType)) {
        throw new Error(`Unsupported contentType: ${input.contentType}. Allowed: ${[...ALLOWED_CONTENT_TYPES].join(", ")}`);
    }

    // Filename safety — prevents multipart Content-Disposition header injection.
    // The effective filename is either the explicit override or the basename of filePath.
    const effectiveName = input.fileNameOverride ?? basename(input.filePath);
    if (effectiveName.length === 0) {
        throw new Error("Unsafe filename: empty");
    }
    if (effectiveName.length > MAX_FILENAME_LENGTH) {
        throw new Error(`Unsafe filename: length ${effectiveName.length} exceeds max ${MAX_FILENAME_LENGTH}`);
    }
    if (UNSAFE_FILENAME_CHARS.test(effectiveName)) {
        throw new Error(`Unsafe filename: contains forbidden character (CR, LF, NUL, double-quote, or backslash)`);
    }
}

export async function uploadReceipt(
    client: QboClient,
    input: UploadReceiptInput,
    env: Record<string, string | undefined> = process.env
): Promise<unknown> {
    const allowedPrefixes = env.QBO_ATTACH_ALLOWED_DIRS?.split(":").filter(Boolean) ?? [];
    validateUploadReceiptInput(input, { allowedPrefixes });

    // Canonicalize the path — resolves symlinks, normalizes separators.
    let canonicalPath: string;
    try {
        canonicalPath = realpathSync.native(input.filePath);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Cannot resolve filePath ${input.filePath}: ${msg}`);
    }

    // Re-check the allowlist against the canonical (post-symlink) path.
    if (allowedPrefixes.length > 0) {
        const prefixesWithSlash = allowedPrefixes.map(p => p.endsWith("/") ? p : p + "/");
        const candidate = canonicalPath.endsWith("/") ? canonicalPath : canonicalPath + "/";
        if (!prefixesWithSlash.some(p => candidate.startsWith(p))) {
            throw new Error(`filePath ${input.filePath} resolves to ${canonicalPath} which is outside allowed directories: ${allowedPrefixes.join(", ")}`);
        }
    }

    // SEC-3: open the file ONCE and use the same fd for size check and read.
    // No TOCTOU window between stat and read — both operate on the same inode.
    const fd = openSync(canonicalPath, "r");
    let fileBytes: Buffer;
    let sizeBytes: number;
    try {
        const stat = fstatSync(fd);
        sizeBytes = stat.size;
        if (sizeBytes > MAX_FILE_SIZE_BYTES) {
            throw new Error(`File ${canonicalPath} is ${sizeBytes} bytes; max allowed is ${MAX_FILE_SIZE_BYTES} bytes (20 MB)`);
        }
        fileBytes = Buffer.alloc(sizeBytes);
        let readSoFar = 0;
        while (readSoFar < sizeBytes) {
            const n = readSync(fd, fileBytes, readSoFar, sizeBytes - readSoFar, readSoFar);
            if (n === 0) break;
            readSoFar += n;
        }
        if (readSoFar !== sizeBytes) {
            throw new Error(`Read ${readSoFar} bytes from ${canonicalPath}, expected ${sizeBytes}`);
        }
    } finally {
        closeSync(fd);
    }

    // SEC-4: verify magic bytes match the declared content type.
    sniffMimeType(fileBytes, input.contentType);

    const fileName = input.fileNameOverride ?? basename(canonicalPath);

    if (isDryRun(env)) {
        return {
            dryRun: true,
            wouldSend: {
                method: "POST",
                path: `/v3/company/${client.getRealmId()}/upload`,
                fileName,
                contentType: input.contentType,
                sizeBytes,
                entityType: input.entityType,
                entityId: input.entityId
            }
        };
    }

    const result = await client.uploadAttachable({
        fileName,
        contentType: input.contentType,
        fileBytes,
        entityType: input.entityType,
        entityId: input.entityId
    });
    return AttachableSchema.parse(result);
}
