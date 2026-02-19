# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- No changes yet.

## [0.3.0] - 2026-02-19

### Added

- CLI options `--calibre-arg` (repeatable raw tokens) and `--keep-temp` plus documentation describing PDF support, platform coverage, and the corpus-based regression smoke test.
- Parser coverage expanded with new unit tests and a conversion-corpus regression test that exercises five local EPUBs and five PDFs end-to-end.

### Changed

- Calibre normalization now streams via `spawn`, emits heartbeat/status lines, retries under Rosetta for the Qt NEON issue on macOS ARM, and lets `--keep-temp` retain conversion artifacts for inspection.
- Chapter normalization gained smarter title heuristics, merges tiny sections only when safe, and splits oversized content by headings or word chunks so long chapters stay manageable without manual tuning.

### Fixed

- Empty, image-only conversions now throw a clear OCR guidance error, and note-dense or boilerplate sections are filtered while legitimate `Index` chapters remain preserved regardless of casing.

## [0.2.0] - 2026-02-19

### Added

- TOC-first chapter selection:
  - EPUB3 `nav` TOC support (preferred when available)
  - EPUB2 NCX TOC support (fallback)
- Parser regression coverage for TOC-referenced spine filtering.
- CI workflow for `push` and `pull_request`:
  - `npm run check`
  - `npm test`
- CLI options:
  - `--install`
  - `--install-dir <path>`
  - `--max-chapter-words <n>`
  - `--filter-boilerplate` / `--no-filter-boilerplate`
  - `--strip-images` / `--no-strip-images`
  - `--strip-internal-links` / `--no-strip-internal-links`

### Changed

- Chapter extraction now prefers TOC-defined structure over raw Calibre split fragments.
- Markdown cleanup removes XML/doctype noise and strips internal links/images by default.
- `SKILL.md` chapter index now includes chapter word counts.
- Calibre normalization uses:
  - `--dont-split-on-page-breaks`
  - `--flow-size 0`
- README updated with new CLI flags and changelog reference.

### Fixed

- Metadata extraction no longer emits placeholders like `[object Object]`.
- Reduced non-chapter artifacts in chapter indexes for many EPUBs.

[Unreleased]: https://github.com/prashantbhudwal/injectbook/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/prashantbhudwal/injectbook/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/prashantbhudwal/injectbook/releases/tag/v0.2.0
