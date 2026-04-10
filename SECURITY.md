# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this MCP server, please report it responsibly:

1. **Do NOT open a public issue** for security vulnerabilities
2. Email **mohammad.farooqi@gmail.com** with:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
3. You can expect an initial response within 48 hours

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
