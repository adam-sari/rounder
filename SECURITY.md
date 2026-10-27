# Security policy

Rounder is a static site whose tools run in the visitor's browser. The security that matters most is that files and
text never leave the device, and that nothing on a tool page can read them that shouldn't.

## Reporting a vulnerability

Please report privately, not in a public issue:

- open a [private security advisory](https://github.com/adam-sari/rounder/security/advisories/new), or
- email hello@roundertools.com.

Include the affected page or file, steps to reproduce, and what an attacker could do. You'll get a reply within a few
days. Please give us a reasonable chance to fix the problem before you share details publicly. We won't take action
against good-faith research that avoids harming people or their data.

The same contacts are in [`/.well-known/security.txt`](https://roundertools.com/.well-known/security.txt).

## In scope

- anything that sends a visitor's files or tool input off the device, or lets another origin read them
- cross-site scripting, including through crafted files (PDF, SVG, Markdown, HTML, archives, subtitles…)
- weaknesses in the cryptographic tools (file encryptor, PDF protect/unlock, password tools)
- supply-chain problems in vendored files (`public/vendor`, `public/models`) or the build scripts
- network requests that aren't listed on [/security](https://roundertools.com/security)

## Out of scope

- the behavior of Google's ad and consent code, or of third-party ads (report a bad ad as described on /contact)
- missing headers without a concrete attack, and best-practice reports from automated scanners
- denial of service against your own browser with a huge file

## Supported versions

Only the live site, roundertools.com, and the `main` branch are supported.
