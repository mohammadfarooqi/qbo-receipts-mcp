export function isDryRun(env: Record<string, string | undefined>): boolean {
    const v = (env.QBO_DRY_RUN || "").toLowerCase();
    return v === "true" || v === "1" || v === "yes";
}
