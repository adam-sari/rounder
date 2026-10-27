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
   credits page (`src/pages/credits.astro`).

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

Rounder is licensed under the [GNU AGPL-3.0](LICENSE). By contributing, you agree that your contribution is
licensed under the same license.
