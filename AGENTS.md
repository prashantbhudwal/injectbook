# Agent Guide (injectbook)

This repository is a small Node.js + TypeScript CLI that converts books (via Calibre) into Codex-compatible skill folders.
Keep changes deterministic (no LLM in the core pipeline) and preserve the existing CLI UX.

## Repo Quick Map

- `src/cli.ts`: CLI entrypoint (Commander), exit codes, top-level error handling.
- `src/commands/convert.ts`: end-to-end conversion (Calibre normalize -> parse -> write).
- `src/parser.ts`: EPUB parsing + cleanup + chapter splitting + boilerplate filtering.
- `src/skill-writer.ts`: writes `SKILL.md` + `references/` files.
- `src/types.ts`: shared types + `CliError`.
- `templates/SKILL.md.tpl`: default skill template (copied into `dist/` at build time).
- `test/*.test.ts`: unit tests + corpus e2e test (compiled to `dist/test/*.js`).
- `.github/workflows/ci.yml`: runs `pnpm run check` + `pnpm test` on Node 20.

## Requirements

- Node.js: >= 20 (see `package.json#engines`).
- Calibre CLI: `ebook-convert` must be available for real conversions and corpus e2e.
  - macOS dev convenience: the CLI can prompt to install Calibre via Homebrew.

## Build / Check / Test

### Install

```bash
pnpm install
```

### Typecheck (no emit)

```bash
pnpm run check
```

### Build

```bash
pnpm run build
```

Notes:
- Build runs `tsc`, copies `templates/` and `package.json` into `dist/`, and chmods `dist/src/cli.js`.
- If you add new runtime assets, update `scripts/copy-assets.cjs` and `package.json#pkg.assets`.

### Tests

All tests compile TS first and then run Node's built-in test runner against `dist/test/*.js`.

```bash
pnpm test          # alias for pnpm run test:all
pnpm run test:unit # parser + skill-writer unit tests
pnpm run test:e2e  # corpus conversion test (requires local samples + Calibre)
```

### Run A Single Test File

```bash
pnpm run build
node --test dist/test/parser.test.js
```

### Run A Single Test By Name (Recommended)

Node's `--test-name-pattern` filters test names.

```bash
pnpm run build
node --test --test-name-pattern "slugify normalizes text" dist/test/parser.test.js
```

### Corpus e2e test prerequisites

- Needs at least 5 PDFs in `local-pdfs/` and 5 EPUBs in `local-epubs/`.
- If missing, the test is skipped with a reason (see `test/conversion-corpus.test.ts`).

## Lint / Format

- No dedicated linter/formatter is configured (no ESLint/Prettier/Biome in this repo).
- Keep formatting consistent with existing files:
  - 2-space indent
  - double quotes
  - semicolons
  - trailing commas only where already used (don’t reformat whole files)

## Code Style Guidelines

### Imports

- Prefer `node:`-prefixed builtins (e.g. `import fs from "node:fs"`).
- Import ordering (match existing files):
  1) Node builtins
  2) external deps
  3) local modules
- Keep type-only imports type-only:
  - `import type { Chapter } from "../src/types";`
  - or `import { CliError, type Chapter } from "./types";`

### TypeScript

- `strict: true` is enabled (see `tsconfig.json`); avoid `any`.
- Prefer small, explicit helper types (`type Foo = { ... }`) over complex generics.
- Use narrow type guards in array filters:
  - `.filter((x): x is T => Boolean(x))`
- Prefer `as const` for frozen config objects when values are used as literals.

### Naming

- Files: `kebab-case.ts`.
- Types: `PascalCase` (`BookMetadata`, `SkillWriteOptions`).
- Values/functions: `camelCase` (`parseEpubToChapters`, `normalizeInputWithCalibre`).
- Constants: `SCREAMING_SNAKE_CASE` when truly constant (`DEFAULT_PARSE_OPTIONS`).
- Boolean options: prefer `stripImages`, `includeFullBook`, `filterBoilerplate`.

### Control Flow / Determinism

- Keep output deterministic (stable ordering, stable filenames, stable content).
- Avoid introducing non-deterministic iteration over object keys unless explicitly sorted.
- For output filenames, preserve zero-padded numeric prefixes (see `chapterFileName`).

### Error Handling & Exit Codes

- Use `CliError` for expected, user-facing failures (bad args, missing deps, parse failures, output conflicts).
- Re-throw `CliError` unchanged when caught.
- Wrap unexpected errors with a helpful message and exit code `4`.
- Exit codes are defined in `src/types.ts`:
  - `2` invalid input/arguments
  - `3` missing runtime dependency (Calibre/Homebrew install path)
  - `4` extraction/parse/conversion failure
  - `5` output write conflict
- If you add a new code path that changes these semantics, update:
  - `src/types.ts`
  - CLI handling in `src/cli.ts`
  - docs in `README.md`

### Node / FS / Processes

- This is a CLI: sync filesystem calls are acceptable and used throughout (`fs.*Sync`).
- When spawning processes:
  - prefer `spawn` for streaming output and long-running tasks
  - use `shell: false`
  - capture output for error reporting when not verbose
- Keep verbose mode behavior consistent: emit raw subprocess output to stdout/stderr when `--verbose`.

### Tests

- Tests use `node:test` + `node:assert/strict`.
- Keep fixtures small and in-memory when possible (see EPUB zip fixtures in `test/parser.test.ts`).
- Clean up temp dirs/files in `finally` or at test end (`fs.rmSync(..., { recursive: true, force: true })`).
- Corpus test should remain skippable when sample inputs are absent; do not hard-fail CI.

## Cursor / Copilot Instructions

- No Cursor rules found (`.cursor/rules/` or `.cursorrules` are not present).
- No Copilot instructions found (`.github/copilot-instructions.md` is not present).

## Suggested Local Workflow

```bash
pnpm install
pnpm run check
pnpm test
```
