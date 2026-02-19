# injectbook

`injectbook` is a Node.js + TypeScript CLI that converts books into Codex-compatible agent skills.

## What it generates

For an input book, the CLI outputs:

- `SKILL.md`
- `references/book_full.md` (unless disabled)
- `references/chapter-001-*.md`, `references/chapter-002-*.md`, ...

No LLM is used. Output is deterministic.

## Prerequisites

- [Node.js](https://nodejs.org) (v20+)
- [Calibre CLI tools](https://calibre-ebook.com) (`ebook-convert`)

## Supported input

- Any format that Calibre can convert to EPUB

## Install (Homebrew)

```bash
brew tap prashantbhudwal/tap
brew install --cask calibre
brew install injectbook
injectbook --version
```

## Install (local dev)

```bash
npm install
npm run build
node dist/src/cli.js --version
```

## Usage

```bash
injectbook convert ./my-book.epub
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
- `--overwrite`
- `--verbose`

Exit codes:

- `0` success
- `2` invalid input/arguments
- `3` missing runtime dependency (Calibre/Homebrew install path)
- `4` extraction/parse failure
- `5` output write conflict

## Development

```bash
npm run check
npm test
npm run build:binary
```

## Release docs

Release/tap maintenance steps are documented in:

- `RELEASE.md`
- `CHANGELOG.md`
