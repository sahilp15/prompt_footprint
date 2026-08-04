# PromptFootprint dashboard (`stats-site`)

React + Vite. This single app ships in two places:

- **Extension dashboard** — the build output is copied to `extension/dashboard`
  and becomes the extension's options page. `chrome.storage.local` is available,
  so it shows the user's real data.
- **Public web build** — deployed to GitHub Pages. No `chrome`, no backend, so
  it serves demo data and the marketing pages own the root.

```bash
npm install
npm run dev      # http://localhost:5173
npm run check    # typecheck + lint + tests + production build
```

To rebuild the extension's dashboard:

```bash
npm run build -- --outDir ../extension/dashboard --emptyOutDir
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server (demo data) |
| `npm run build` | Production build |
| `npm run lint` | ESLint over `src/` |
| `npm run typecheck` | `tsc --noEmit` over the Token Cutter engine and its tests |
| `npm test` | `node --test` over `test/**/*.test.ts` |
| `npm run eval` | Token Cutter quality metrics against the built-in dataset |
| `npm run check` | All of the above, in order |

The engine and its tests are TypeScript, run directly by Node's built-in type
stripping — there is no test build step and no test-runner dependency.

## Token Cutter

`src/lib/tokenCutter/` is a local-first prompt optimizer. It runs entirely in
the browser: no API key, no network, no account. Full documentation lives in
[`docs/TOKEN_CUTTER.md`](../docs/TOKEN_CUTTER.md).

```
protect → segment → extract → detect → generate → apply → validate
```

| Module | Responsibility |
| --- | --- |
| `tokens.ts` | Token estimation and the environmental model |
| `protect.ts` | Regions that must never be rewritten |
| `segment.ts` | Sentences, blocks, and prompt structure |
| `entities.ts` | Names, numbers, dates, links, negations… |
| `constraints.ts` | Requirements, and contradictions between them |
| `lexicon.ts` | Curated filler / wordiness / spelling rules |
| `grammar.ts` | Spelling, grammar, spacing |
| `redundancy.ts` | Repeated instructions and constraints |
| `suggestions.ts` | Safety vetoes, overlap resolution, level gating |
| `apply.ts` | Non-destructive edit application and the diff |
| `validate.ts` | Semantic safety — what was lost |
| `explain.ts` | "Explain my prompt" |
| `memory.ts` | Local preferences and relevance matching |
| `gemini.ts` | Optional enhancement via the Worker proxy |
| `evalDataset.ts` / `evaluate.ts` | Quality measurement |

`test/parity.test.ts` loads the extension's own `tokenEstimator.js`,
`constants.js`, and `environmentalModel.js` and asserts this app produces
identical numbers, so the two halves of the product cannot drift apart.

## Adding an award

Append one entry to `src/data/awards.js`. The Awards page derives its featured
slot, timeline, and headline statistics from that array — no component changes
needed.
