# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities privately to **security@intelligentiterations.com**.

Do not open a public GitHub issue for security reports. We aim to acknowledge reports within 3 business days and provide a remediation plan within 10 business days for confirmed issues.

## Scope

`website-copy-maker` runs a headless browser against a user-supplied URL and writes generated code to disk. In-scope concerns include:

- Code-execution paths from a malicious source page (e.g. SSRF via the supplied URL, prototype pollution from extracted JSON)
- Generated-project content that leaks credentials or runs untrusted JS at build time
- Supply-chain risks in the generator's own dependencies

Out of scope: visual differences from the source site, missing features in the generated project, the source website's own security posture.

## Safe defaults

- Playwright runs without persistent storage; cookies and localStorage from the rendered site never touch the user's machine outside the browser process.
- The generated project never includes runtime `<script>` tags pointing at the source domain.
- Artifacts stay in explicit caller-supplied directories. New runs refuse existing output directories; reference reads reject path traversal and escaping symlinks.
