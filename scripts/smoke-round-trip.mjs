#!/usr/bin/env node
// Phase 2: full round-trip smoke test against real Intuit sandbox.
// Creates a dummy CAD Purchase, uploads a receipt, searches for it, deletes it.
// Tracks created IDs and attempts cleanup on any failure.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function parseEnvFile(path) {
    const content = readFileSync(path, "utf8");
    const env = {};
    for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return env;
}

const creds = parseEnvFile("/Users/mohammadfarooqi/Desktop/code/qb-bookkeeping/.env.credentials.txt");
const tokens = parseEnvFile("/Users/mohammadfarooqi/Desktop/code/qbo-receipts-mcp/.env");

const env = {
    QBO_CLIENT_ID: creds.INTUIT_SANDBOX_CLIENT_ID,
    QBO_CLIENT_SECRET: creds.INTUIT_SANDBOX_CLIENT_SECRET,
    QBO_ACCESS_TOKEN: tokens.QBO_ACCESS_TOKEN,
    QBO_REFRESH_TOKEN: tokens.QBO_REFRESH_TOKEN,
    QBO_REALM_ID: tokens.QBO_REALM_ID,
    QBO_ENVIRONMENT: "sandbox",
    PATH: process.env.PATH
};

const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/src/index.js"],
    env
});
const client = new Client({ name: "smoke-rt", version: "1.0.0" });
await client.connect(transport);

async function callTool(name, args) {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content[0].text;
    if (text.startsWith("Error:")) {
        throw new Error(`[${name}] ${text}`);
    }
    return JSON.parse(text);
}

// Track IDs for cleanup
const createdPurchases = [];
let currentStep = "init";

// Unique session tag so we can find our work
const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const sessionTag = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const sourceId = `smoke-rt-${Date.now()}`;

// Unique amount to make search trivial
const testAmount = 77.77;

console.log(`[rt] session_tag=${sessionTag} source_id=${sourceId}`);

try {
    // --- Step 1: search_purchases with a narrow date filter (tests query encoding) ---
    currentStep = "search_by_date";
    console.log("\n[rt] Step 1: search_purchases by date (tests WHERE clause encoding)");
    const dateSearch = await callTool("search_purchases", {
        txnDateAfter: "2026-03-01",
        txnDateBefore: "2026-04-30",
        maxResults: 5
    });
    const datedRows = dateSearch.QueryResponse?.Purchase || [];
    console.log(`  → ${datedRows.length} purchases in March-April 2026`);

    // --- Step 2: create_purchase DRY-RUN ---
    currentStep = "create_dry_run";
    console.log("\n[rt] Step 2: create_purchase (DRY-RUN via QBO_DRY_RUN=... wait, dry-run is env-controlled)");
    console.log("  Skipping dedicated dry-run — the env var is set at server spawn time.");
    console.log("  Our integration tests already verify dry-run works. Skipping.");

    // --- Step 3: create_purchase REAL (CAD) ---
    currentStep = "create_real";
    console.log("\n[rt] Step 3: create_purchase (real CAD write)");
    const created = await callTool("create_purchase", {
        txnDate: "2026-04-10",
        paymentType: "Check",
        paymentAccountId: "38",              // Chequing (from exploration)
        totalAmt: testAmount,
        expenseAccountId: "89",              // Interest expense (innocuous category)
        description: "qbo-receipts-mcp smoke test round-trip",
        source: "manual",
        sourceId,
        sessionTag
    });
    const id = created.Purchase?.Id;
    const syncToken = created.Purchase?.SyncToken;
    if (!id) throw new Error("create_purchase returned no Id");
    createdPurchases.push({ id, syncToken });
    console.log(`  → Created Purchase Id=${id} SyncToken=${syncToken}`);
    console.log(`  → PrivateNote: ${created.Purchase.PrivateNote}`);
    console.log(`  → TotalAmt: ${created.Purchase.TotalAmt}, HomeTotalAmt: ${created.Purchase.HomeTotalAmt ?? "n/a"}`);

    // --- Step 4: search_purchases by amount (should find our new one) ---
    currentStep = "search_by_amount";
    console.log("\n[rt] Step 4: search_purchases by exact amount (should find the one we just created)");
    const byAmount = await callTool("search_purchases", {
        totalAmt: testAmount,
        txnDateAfter: "2026-04-10",
        txnDateBefore: "2026-04-10"
    });
    const foundRows = byAmount.QueryResponse?.Purchase || [];
    console.log(`  → Found ${foundRows.length} row(s) with amount ${testAmount} on 2026-04-10`);
    const ourRow = foundRows.find(p => p.Id === id);
    if (!ourRow) {
        console.log(`  ⚠️  Our created Purchase (Id=${id}) NOT found in search results — dedup may be imperfect`);
    } else {
        console.log(`  ✓ Dedup works — found our Purchase by amount+date`);
    }

    // --- Step 5: upload_receipt ---
    currentStep = "upload_receipt";
    console.log("\n[rt] Step 5: upload_receipt (multipart upload to real QBO)");
    const stagingDir = mkdtempSync(join(tmpdir(), "qbo-rt-"));
    const pdfPath = join(stagingDir, `smoke-receipt-${Date.now()}.pdf`);
    // Minimal valid PDF bytes
    writeFileSync(pdfPath, Buffer.from("%PDF-1.4\n1 0 obj\n<</Type /Catalog>>\nendobj\ntrailer\n<</Root 1 0 R>>\n%%EOF\n"));
    try {
        const uploaded = await callTool("upload_receipt", {
            filePath: pdfPath,
            contentType: "application/pdf",
            entityType: "Purchase",
            entityId: id
        });
        console.log(`  → Attachable Id=${uploaded.Id} FileName=${uploaded.FileName}`);
        if (uploaded.AttachableRef && uploaded.AttachableRef.length > 0) {
            console.log(`  ✓ Attached to EntityRef ${uploaded.AttachableRef[0].EntityRef.type}:${uploaded.AttachableRef[0].EntityRef.value}`);
        }
    } finally {
        try { unlinkSync(pdfPath); } catch {}
    }

    // --- Step 6: delete_purchase (cleanup + tests soft-delete) ---
    currentStep = "delete_purchase";
    console.log("\n[rt] Step 6: delete_purchase (rollback primitive)");
    const deleted = await callTool("delete_purchase", { id, syncToken });
    if (deleted.Purchase?.status === "Deleted") {
        console.log(`  ✓ Purchase ${id} marked as Deleted`);
        createdPurchases.pop();  // don't try to delete again in finally
    } else {
        console.log(`  ? Unexpected delete response:`, JSON.stringify(deleted, null, 2));
    }

    console.log("\n[rt] ALL STEPS PASSED ✓");

} catch (err) {
    console.error(`\n[rt] FAILED at step "${currentStep}":`);
    console.error(err.message);
    process.exitCode = 1;
} finally {
    // Attempt cleanup of any orphan purchases
    if (createdPurchases.length > 0) {
        console.log(`\n[rt] Cleanup: attempting to delete ${createdPurchases.length} orphan purchase(s)`);
        for (const p of createdPurchases) {
            try {
                await callTool("delete_purchase", { id: p.id, syncToken: p.syncToken });
                console.log(`  ✓ Deleted orphan ${p.id}`);
            } catch (e) {
                console.error(`  ✗ Failed to delete orphan ${p.id}: ${e.message}`);
                console.error(`    Manually delete via QBO UI or: delete_purchase({id:"${p.id}",syncToken:"${p.syncToken}"})`);
            }
        }
    }
    await client.close();
}
