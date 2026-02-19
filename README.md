# injectbook

`injectbook` is a Node.js + TypeScript CLI that converts books into Codex-compatible agent skills.

## What it generates

For an input book, the CLI outputs:

- `SKILL.md`
- `references/book_full.md` (unless disabled)
- `references/chapter-001-*.md`, `references/chapter-002-*.md`, ...

No LLM is used. Output is deterministic.

## Prerequisites

- [Calibre CLI tools](https://calibre-ebook.com) (`ebook-convert`)

## Platform support

- Works on macOS, Linux, and Windows where `ebook-convert` is available.
- On macOS Apple Silicon (`arm64`), `injectbook` automatically retries Calibre under Rosetta (`x86_64`) if Calibre hits the Qt `neon` runtime error.
- Homebrew auto-install prompt for Calibre is macOS-only.

## Supported input

- Any format that Calibre can convert to EPUB, including PDF

## Install (Homebrew)

```bash
brew tap prashantbhudwal/tap
brew install --cask calibre
brew install injectbook
injectbook --version
```

Homebrew installs a standalone `injectbook` binary. Node.js is not required for Homebrew installs.

## Install (local dev)

```bash
npm install
npm run build
node dist/src/cli.js --version
```

Local development requires [Node.js](https://nodejs.org) v20+.

## Usage

```bash
injectbook convert ./my-book.epub
injectbook convert ./my-book.pdf
```

If Calibre is missing, the CLI explains why it is required and, on macOS terminals, asks whether you want it installed via Homebrew.

Options:

- `--out-dir <path>` default `./<book-slug>-skill`
- `--skill-name <name>`
- `--description <text>`
- `--include-full-book` / `--no-include-full-book`
- `--chapter-prefix <string>` default `chapter-`
- `--install` write to `.agents/skills/<book-slug>-skill`
- `--install-dir <path>` default `.agents/skills`
- `--max-chapter-words <n>` default `15000`
- `--filter-boilerplate` / `--no-filter-boilerplate`
- `--strip-images` / `--no-strip-images`
- `--strip-internal-links` / `--no-strip-internal-links`
- `--calibre-arg <arg>` repeatable, appends one raw token to `ebook-convert`
- `--keep-temp` keep temporary conversion files when conversion fails
- `--overwrite`
- `--verbose`

PDF notes:

- Text-based PDFs work best.
- Scanned/image-only PDFs require OCR, which is not supported in this version.

Exit codes:

- `0` success
- `2` invalid input/arguments
- `3` missing runtime dependency (Calibre/Homebrew install path)
- `4` extraction/parse failure
- `5` output write conflict

## Development

```bash
npm run check
npm run test:unit
npm run test:e2e
npm run test:all
npm run build:binary
```

### Corpus-based end-to-end regression test

For real-book validation, run a corpus of local PDFs through the full conversion pipeline and inspect generated skill outputs. This is a corpus-based end-to-end regression test (also a smoke test across heterogeneous inputs).

Test modes:

- `npm run test:unit`: parser + skill-writer unit tests only
- `npm run test:e2e`: corpus conversion test only (`5` PDFs + `5` EPUBs)
- `npm run test:all` (and `npm test`): unit tests first, then corpus conversion

```bash
mkdir -p output/local-pdfs-verify
for f in local-pdfs/*.pdf; do
  base="$(basename "$f" .pdf)"
  node dist/src/cli.js convert "$f" --out-dir "output/local-pdfs-verify/${base}-skill" --overwrite
done
```

Quick quality checks:

- Review chapter counts and chapter size distribution in `references/chapter-*.md`.
- Spot-check front/back matter handling (`Contents`, `Notes`, `Index`) for each converted book.
- Confirm no books fail extraction unexpectedly.

## Release docs

Release/tap maintenance steps are documented in:

- `RELEASE.md`
- `CHANGELOG.md`
