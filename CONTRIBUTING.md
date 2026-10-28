# Contributing to Rounder

Thanks for helping. Bug reports, tool ideas, fixes and new tools are all welcome.

## Before you start

- **Bugs and ideas:** open an [issue](https://github.com/adam-sari/rounder/issues). For a bug, include the tool's URL,
  your browser and device, and what happened. Please don't attach private files; a similar test file is perfect.
- **Security problems:** don't open a public issue. See [SECURITY.md](SECURITY.md).
- **Bigger changes or new tools:** open an issue first, so we can agree on the approach before you spend the time.

## Ground rules

These are what make Rounder what it is, so pull requests that break them can't be merged:

1. **Nothing leaves the device.** Tools process files and text in the browser. No uploads, no server-side processing,
   no sending input to an API.
2. **Every network request is disclosed.** If a tool must fetch something (a model, rates, language data), it asks
   first or says so on the page, and the request is added to `src/pages/security.astro`, `src/pages/privacy.astro`
   and the "Network use" list in the README.
3. **No trackers, no new third-party scripts.** Ads and analytics are set up in one place, and never on ad-free tools.
4. **No dark patterns.** No fake buttons, no nagging, no sign-up walls, no watermarks, no limits.
5. **Licenses must fit.** New dependencies need a license compatible with the AGPL-3.0, and get a line on the
   credits page (`src/pages/credits.astro`). Dependencies of the npm packages must be permissive (no GPL, LGPL or
   MPL); `packages/build/test/licenses.test.ts` checks them.

## Setting up

You need Node 22.

```sh
npm ci
npm run dev       # http://localhost:4321
```

The README explains the stack, how to add a tool and the other commands.

## Before you open a pull request

```sh
npm run check     # types
npm test          # unit tests
npm run e2e       # browser tests (optional locally, but please run them for tool changes)
```

- Put pure logic in `src/tools/lib/<tool>/` with unit tests in `tests/unit/`.
- Keep changes focused, and match the style of the code around them.
- Copy is US English: plain, friendly and honest. Say what a tool does; don't oversell it.
- AI-assisted contributions are fine (Rounder itself is built that way), but you're responsible for understanding,
  testing and standing behind what you submit.

## License

Rounder is licensed under the [GNU AGPL-3.0](LICENSE). The npm packages in `packages/` (`@roundertools/sdk`, the
`roundertools` CLI and `@roundertools/mcp`) are MIT, and so are the site files they bundle: those `.ts` files in
`src/engines` and `src/tools/lib` are offered under "AGPL-3.0-only OR MIT". [REUSE.toml](REUSE.toml) lists exactly
which files that is; UI code (`.svelte`), page copy (`src/tools/defs`) and everything else stay AGPL-3.0 only.

By contributing, you agree that your contribution is licensed the same way as the file it changes: AGPL-3.0 for the
site, MIT for `packages/`, and both AGPL-3.0 and MIT for the files listed in REUSE.toml (inbound = outbound). Sign off
each commit to confirm you have the right to do that, under the [Developer Certificate of Origin](https://developercertificate.org/):
add a `Signed-off-by: Your Name <you@example.com>` line, which `git commit -s` does for you.

If a change makes the SDK bundle a site file it didn't before, `npm run sdk:build` stops and asks you to add it to
REUSE.toml (`node packages/sdk/build.mjs --reuse-write`). That puts the file under the MIT option too, so only do it
for code you wrote or may license that way.
