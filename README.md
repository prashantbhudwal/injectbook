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

## Install (local dev)

```bash
npm install
npm run build
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

## Homebrew distribution (tap)

1. Create GitHub release by tagging `vX.Y.Z`.
2. Workflow builds `injectbook-vX.Y.Z-darwin-arm64.tar.gz`.
3. Update `Formula/injectbook.rb` in tap repo with new `url` + `sha256`.
4. Users install:

```bash
brew tap prashantbhudwal/tap
brew install --cask calibre
brew install injectbook
```
