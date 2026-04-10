# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this MCP server, please report it privately — **do not open a public issue with exploit details.**

### Preferred: GitHub Private Vulnerability Reporting

1. Go to the [Security tab](https://github.com/mohammadfarooqi/qbo-receipts-mcp/security/advisories/new) of this repository
2. Click **"Report a vulnerability"** (the green button)
3. Fill in the private advisory form with:
   - A clear description of the vulnerability
   - Steps to reproduce (a minimal proof-of-concept helps if applicable)
   - Potential impact and affected versions
   - Any remediation you'd suggest

GitHub's private vulnerability reporting keeps the discussion confidential between you and the maintainer until a fix is ready and a coordinated disclosure is published. This is the preferred channel for anything that could be exploited against a real QuickBooks Online realm or used to leak credentials or data.

You can expect an initial response within 48 hours.

See GitHub's [privately reporting a security vulnerability](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) guide for details about the reporter flow.

### For non-security bugs, feature requests, or general questions

Open a regular issue at https://github.com/mohammadfarooqi/qbo-receipts-mcp/issues. Please do NOT include exploit details in public issues — escalate to the private advisory flow above if you suspect a real vulnerability.

## Scope

This MCP server:

- Only makes HTTPS requests to `sandbox-quickbooks.api.intuit.com`, `quickbooks.api.intuit.com`, and `oauth.platform.intuit.com` (OAuth token endpoint)
- Reads receipt files from the local filesystem only at paths the user explicitly passes to `upload_receipt`
- Does NOT execute shell commands
- Does NOT send data to any third party besides Intuit
- Validates all tool inputs with Zod schemas
- Validates all QBO API responses with Zod schemas
- Has 2 runtime dependencies (`@modelcontextprotocol/sdk` + `zod`)

## OAuth Credentials

- OAuth credentials are read from environment variables, never logged, never included in MCP responses
- Access tokens are kept in memory only
- Refresh tokens are read from env at startup and (optionally) rewritten to `.env` by the OAuth helper CLI
- Users are responsible for filesystem permissions on their `.env` file (recommend `chmod 600`)

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |
