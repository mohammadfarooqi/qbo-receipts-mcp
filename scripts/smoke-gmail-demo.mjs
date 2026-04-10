#!/usr/bin/env node
// Gmail-to-sandbox real-transaction demo.
//
// Creates 2 real transactions in the Intuit sandbox, sourced from real
// PayPal CSV rows + real Gmail receipts, and leaves them LIVE so the user
// can inspect them in the sandbox UI.
//
//   Transaction 1: Udemy  $16.94 CAD  2024-05-22  (CAD home-currency write)
//   Transaction 2: Setapp $9.99  USD  2024-06-23  (USD foreign write with explicit ExchangeRate)
//
// Both receipts are PDF files generated from the original Gmail HTML.
//
// The script prints every purchase id, attachable id, and the exact session
// tag at the end. To clean up later, run rollback-gmail-demo.mjs with the tag.
//
// NOT rolled back automatically. NOT shipped in the npm package.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, realpathSync } from "node:fs";

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

function parseResult(result) {
    const text = result.content[0].text;
    if (text.startsWith("Error:")) throw new Error(text);
    return JSON.parse(text);
}

const credsFile = "/Users/mohammadfarooqi/Desktop/code/qb-bookkeeping/.env.credentials.txt";
const tokenFile = "/Users/mohammadfarooqi/Desktop/code/qbo-receipts-mcp/.env";
const creds = parseEnvFile(credsFile);
const tokens = parseEnvFile(tokenFile);

// Canonicalize staging dir so SEC-1 symlink check passes on macOS.
const stagingDir = realpathSync("/Users/mohammadfarooqi/Desktop/code/qb-bookkeeping/staging/receipts");

const env = {
    QBO_CLIENT_ID: creds.INTUIT_SANDBOX_CLIENT_ID,
    QBO_CLIENT_SECRET: creds.INTUIT_SANDBOX_CLIENT_SECRET,
    QBO_ACCESS_TOKEN: tokens.QBO_ACCESS_TOKEN,
    QBO_REFRESH_TOKEN: tokens.QBO_REFRESH_TOKEN,
    QBO_REALM_ID: tokens.QBO_REALM_ID,
    QBO_ENVIRONMENT: "sandbox",
    QBO_ATTACH_ALLOWED_DIRS: stagingDir,
    PATH: process.env.PATH
};
for (const k of ["QBO_CLIENT_ID", "QBO_CLIENT_SECRET", "QBO_ACCESS_TOKEN", "QBO_REFRESH_TOKEN", "QBO_REALM_ID"]) {
    if (!env[k]) { console.error(`Missing ${k}`); process.exit(1); }
}

console.log(`[demo] sandbox realm = ${env.QBO_REALM_ID}`);
console.log(`[demo] staging dir  = ${stagingDir}`);

// Session tag for this run
const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const sessionTag = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
console.log(`[demo] session tag  = ${sessionTag}`);
console.log(`[demo] rollback cmd: node scripts/rollback-gmail-demo.mjs ${sessionTag}`);
console.log();

const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/src/index.js"],
    env
});
const client = new Client({ name: "gmail-demo", version: "1.0.0" });
await client.connect(transport);

async function callTool(name, args) {
    process.stdout.write(`[demo] ${name}... `);
    const r = await client.callTool({ name, arguments: args });
    const text = r.content[0].text;
    if (text.startsWith("Error:")) {
        console.log("FAIL");
        console.error(text);
        throw new Error(text);
    }
    console.log("OK");
    return JSON.parse(text);
}

try {
    // -------- Phase 1: Discovery --------
    const company = await callTool("get_company_info", {});
    console.log(`        company: ${company.CompanyInfo.CompanyName} (${company.CompanyInfo.Country})`);

    const accountsAll = await callTool("get_accounts", {});
    const accounts = accountsAll.QueryResponse.Account ?? [];
    const cadBanks = accounts.filter(a => (a.AccountType === "Bank" || a.AccountType === "Credit Card") &&
                                           (a.CurrencyRef?.value === "CAD" || !a.CurrencyRef));
    const usdBanks = accounts.filter(a => (a.AccountType === "Bank" || a.AccountType === "Credit Card") &&
                                           a.CurrencyRef?.value === "USD");
    const expenses = accounts.filter(a => a.AccountType === "Expense");

    // Pick "Computer and Internet Expenses" for both if available (real-world usage: developer training + Mac tools)
    const expenseAcct = expenses.find(a => /Computer and Internet/i.test(a.Name)) ||
                         expenses.find(a => /software|subscription/i.test(a.Name)) ||
                         expenses[0];
    const cadPay = cadBanks.find(a => /Credit Card/i.test(a.AccountType) && /visa/i.test(a.Name)) ||
                   cadBanks.find(a => /Credit Card/i.test(a.AccountType)) ||
                   cadBanks[0];
    // For USD: sandbox has no USD banks — we'll use the CAD one for the USD payment account too
    // (QBO allows this; the expense is recorded in USD via CurrencyRef + ExchangeRate).
    const usdPay = usdBanks[0] ?? cadPay;

    console.log(`        CAD payment acct: ${cadPay.Id}=${cadPay.Name}`);
    console.log(`        USD payment acct: ${usdPay.Id}=${usdPay.Name}${usdBanks.length === 0 ? " (CAD fallback — sandbox has no USD accounts)" : ""}`);
    console.log(`        expense acct:     ${expenseAcct.Id}=${expenseAcct.Name}`);

    // -------- Phase 2: Vendor dedup + create --------
    // Use unique suffix so reruns don't collide
    const runSfx = `-${pad(now.getHours())}${pad(now.getMinutes())}${Math.random().toString(36).slice(2, 5)}`;

    // Udemy CAD
    const udemySearch = await callTool("search_vendors", { namePrefix: "Udemy" });
    let udemyId;
    if (udemySearch.QueryResponse.Vendor?.length > 0) {
        udemyId = udemySearch.QueryResponse.Vendor[0].Id;
        console.log(`        Udemy vendor already exists: id=${udemyId}`);
    } else {
        const v = await callTool("create_vendor", {
            displayName: `Udemy${runSfx}`,
            currencyCode: "CAD",
            email: "support@udemy.com",
            notes: `Created by Gmail demo ${sessionTag}. Real vendor from 2024 PayPal CSV.`
        });
        udemyId = v.Vendor.Id;
        console.log(`        Udemy vendor created: id=${udemyId}`);
    }

    // Setapp Limited USD — follow the (USD) suffix convention
    const setappSearch = await callTool("search_vendors", { namePrefix: "Setapp" });
    let setappId;
    if (setappSearch.QueryResponse.Vendor?.length > 0) {
        setappId = setappSearch.QueryResponse.Vendor[0].Id;
        console.log(`        Setapp vendor already exists: id=${setappId}`);
    } else {
        const v = await callTool("create_vendor", {
            displayName: `Setapp Limited${runSfx} (USD)`,
            currencyCode: "USD",
            email: "support@setapp.com",
            notes: `Created by Gmail demo ${sessionTag}. Real vendor from 2024 PayPal CSV.`
        });
        setappId = v.Vendor.Id;
        console.log(`        Setapp vendor created: id=${setappId}`);
    }

    // -------- Phase 3: BoC rate for the USD transaction --------
    const rateResp = await callTool("get_boc_rate", { date: "2024-06-23" });
    console.log(`        BoC rate for 2024-06-23: ${rateResp.rate} (observation ${rateResp.observationDate})`);

    // -------- Phase 4: Create CAD purchase (Udemy) --------
    // House rule: enter 100% face amount ($16.94), no HST split (Quick Method).
    // House rule: omit currencyCode for home-currency writes (works around BUG-3 fixed in v0.2.2).
    const cadPurchase = await callTool("create_purchase", {
        txnDate: "2024-05-22",
        paymentType: "CreditCard",
        paymentAccountId: cadPay.Id,
        totalAmt: 16.94,
        expenseAccountId: expenseAcct.Id,
        vendorId: udemyId,
        source: "pp",
        sourceId: "2HU44047EE1285948",
        sessionTag,
        description: "Udemy course purchase — 2024-05-22. Professional development (online course platform). PayPal transaction 2HU44047EE1285948. Paid via AmEx-1006. Tax-inclusive total per Quick Method."
    });
    const cadPurchaseId = cadPurchase.Purchase.Id;
    console.log(`[demo] CAD Purchase CREATED  id=${cadPurchaseId} amount=${cadPurchase.Purchase.TotalAmt} CAD`);

    // -------- Phase 5: Create USD purchase (Setapp) --------
    // House rule: USD expense requires explicit ExchangeRate from BoC.
    const usdPurchase = await callTool("create_purchase", {
        txnDate: "2024-06-23",
        paymentType: "CreditCard",
        paymentAccountId: usdPay.Id,
        totalAmt: 9.99,
        expenseAccountId: expenseAcct.Id,
        vendorId: setappId,
        currencyCode: "USD",
        exchangeRate: rateResp.rate,
        source: "pp",
        sourceId: "4U75348537988261L",
        sessionTag,
        description: "Setapp Limited Mac dev tools subscription — 2024-06-23. PayPal transaction 4U75348537988261L. Paid via AmEx-1006. USD expense; ExchangeRate from Bank of Canada Valet API (CRA-accepted per Income Tax Folio S5-F4-C1)."
    });
    const usdPurchaseId = usdPurchase.Purchase.Id;
    console.log(`[demo] USD Purchase CREATED  id=${usdPurchaseId} amount=${usdPurchase.Purchase.TotalAmt} USD ExchangeRate=${usdPurchase.Purchase.ExchangeRate} HomeTotalAmt=${usdPurchase.Purchase.HomeTotalAmt ?? "(not set)"}`);
    if (usdPurchase.Purchase.HomeTotalAmt) {
        const expected = 9.99 * rateResp.rate;
        console.log(`        HomeTotalAmt sanity: expected ≈ ${expected.toFixed(2)} CAD, got ${usdPurchase.Purchase.HomeTotalAmt}`);
    }

    // -------- Phase 6: Upload receipt PDFs --------
    const udemyReceipt = `${stagingDir}/udemy-2024-05-22.pdf`;
    const setappReceipt = `${stagingDir}/setapp-2024-06-23.pdf`;

    const udemyAttach = await callTool("upload_receipt", {
        filePath: udemyReceipt,
        contentType: "application/pdf",
        entityType: "Purchase",
        entityId: cadPurchaseId
    });
    console.log(`[demo] Udemy receipt attached: attachable id=${udemyAttach.Id} filename=${udemyAttach.FileName}`);

    const setappAttach = await callTool("upload_receipt", {
        filePath: setappReceipt,
        contentType: "application/pdf",
        entityType: "Purchase",
        entityId: usdPurchaseId
    });
    console.log(`[demo] Setapp receipt attached: attachable id=${setappAttach.Id} filename=${setappAttach.FileName}`);

    // -------- Phase 7: Dedup verification (prove search finds them) --------
    const dedup1 = await callTool("search_purchases", {
        txnDateAfter: "2024-05-22",
        txnDateBefore: "2024-05-22",
        totalAmt: 16.94
    });
    const found1 = (dedup1.QueryResponse.Purchase ?? []).find(p => p.Id === cadPurchaseId);
    console.log(`[demo] Dedup CAD by date+amount: ${found1 ? "HIT (id matches)" : "MISS"}`);

    const dedup2 = await callTool("search_purchases", {
        txnDateAfter: "2024-06-23",
        txnDateBefore: "2024-06-23",
        totalAmt: 9.99
    });
    const found2 = (dedup2.QueryResponse.Purchase ?? []).find(p => p.Id === usdPurchaseId);
    console.log(`[demo] Dedup USD by date+amount: ${found2 ? "HIT (id matches)" : "MISS"}`);

    // -------- Summary --------
    console.log("\n[demo] ============================================================");
    console.log("[demo] DEMO COMPLETE — transactions are LIVE in sandbox");
    console.log("[demo] ============================================================");
    console.log();
    console.log("[demo] Session tag for rollback:");
    console.log(`[demo]   ${sessionTag}`);
    console.log();
    console.log("[demo] Sandbox UI — inspect the transactions:");
    console.log(`[demo]   Sign in at: https://app.sandbox.qbo.intuit.com/app/homepage`);
    console.log(`[demo]   Realm: ${env.QBO_REALM_ID} (Sandbox Company CA 7419)`);
    console.log(`[demo]   Expenses: https://app.sandbox.qbo.intuit.com/app/expenses`);
    console.log();
    console.log("[demo] Transaction 1 — CAD (Udemy):");
    console.log(`[demo]   Purchase Id:   ${cadPurchaseId}`);
    console.log(`[demo]   Amount:        $16.94 CAD`);
    console.log(`[demo]   Date:          2024-05-22`);
    console.log(`[demo]   Vendor:        Udemy (id ${udemyId})`);
    console.log(`[demo]   Account:       ${expenseAcct.Name}`);
    console.log(`[demo]   Payment:       ${cadPay.Name}`);
    console.log(`[demo]   Memo marker:   auto:pp:2HU44047EE1285948 | sess:${sessionTag}`);
    console.log(`[demo]   Attachment:    ${udemyAttach.FileName} (attachable id ${udemyAttach.Id})`);
    console.log(`[demo]   Deep link:     https://app.sandbox.qbo.intuit.com/app/expense?txnId=${cadPurchaseId}`);
    console.log();
    console.log("[demo] Transaction 2 — USD (Setapp):");
    console.log(`[demo]   Purchase Id:   ${usdPurchaseId}`);
    console.log(`[demo]   Amount:        $9.99 USD (≈ ${(9.99 * rateResp.rate).toFixed(2)} CAD at ${rateResp.rate})`);
    console.log(`[demo]   Date:          2024-06-23`);
    console.log(`[demo]   Vendor:        Setapp Limited (id ${setappId})`);
    console.log(`[demo]   Account:       ${expenseAcct.Name}`);
    console.log(`[demo]   Payment:       ${usdPay.Name}`);
    console.log(`[demo]   ExchangeRate:  ${rateResp.rate} (Bank of Canada, observation ${rateResp.observationDate})`);
    console.log(`[demo]   Memo marker:   auto:pp:4U75348537988261L | sess:${sessionTag}`);
    console.log(`[demo]   Attachment:    ${setappAttach.FileName} (attachable id ${setappAttach.Id})`);
    console.log(`[demo]   Deep link:     https://app.sandbox.qbo.intuit.com/app/expense?txnId=${usdPurchaseId}`);
    console.log();
    console.log("[demo] What to look for in the UI:");
    console.log("[demo]   - Both expenses appear in Expenses tab with date, vendor, amount, memo");
    console.log("[demo]   - Click each expense → attachment icon → download PDF → verify receipt content");
    console.log("[demo]   - USD expense should show exchange rate field populated");
    console.log("[demo]   - Private note should contain 'auto:pp:...' marker (not the user-facing memo)");
    console.log();
    console.log("[demo] Cleanup when done inspecting:");
    console.log(`[demo]   node scripts/rollback-gmail-demo.mjs ${sessionTag}`);
    console.log();
} finally {
    await client.close();
}
