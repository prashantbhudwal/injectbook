# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- No changes yet.

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

[Unreleased]: https://github.com/prashantbhudwal/injectbook/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/prashantbhudwal/injectbook/releases/tag/v0.2.0
