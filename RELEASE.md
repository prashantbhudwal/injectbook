# Injectbook Release Playbook

This file documents exactly how to cut releases for `injectbook` and publish/update the Homebrew tap.

## Repositories

- App repo (source + release workflow): `prashantbhudwal/injectbook`
- Tap repo (formula users install from): `prashantbhudwal/homebrew-tap`

## Local paths used on this machine

- App repo: `~/Code/injectbook`
- Tap repo: `~/Code/homebrew-tap`
- Tap formula file: `~/Code/homebrew-tap/Formula/injectbook.rb`

## One-time setup checks

1. Confirm both repos exist on GitHub and are up to date.
2. Confirm GitHub Actions is enabled for `prashantbhudwal/injectbook`.
3. Confirm Homebrew tap is available locally:
   - `brew tap prashantbhudwal/tap`

## Release process (every version)

1. In app repo, update version where needed (`package.json`, formula version template if you keep one there).
2. Update `CHANGELOG.md`:
   - Move notes from `## [Unreleased]` into a new version section `## [X.Y.Z] - YYYY-MM-DD`
   - Add/update the comparison links at the bottom
   - Keep newest versions at the top
3. Commit and push app changes to `master`.
4. Tag release and push tag:

```bash
cd ~/Code/injectbook
git tag vX.Y.Z
git push origin vX.Y.Z
```

5. Wait for workflow `Release` in app repo to complete successfully.
   - Workflow file: `~/Code/injectbook/.github/workflows/release.yml`
6. From the completed run/release, collect:
   - Asset URL (`injectbook-vX.Y.Z-darwin-<arch>.tar.gz`)
   - SHA256 of that exact asset

## Update Homebrew tap formula

1. Edit tap formula file:
   - `~/Code/homebrew-tap/Formula/injectbook.rb`
2. Update fields:
   - `version "X.Y.Z"`
   - `url "https://github.com/prashantbhudwal/injectbook/releases/download/vX.Y.Z/injectbook-vX.Y.Z-darwin-<arch>.tar.gz"`
   - `sha256 "<real-sha256-from-release-asset>"`
3. Commit and push tap repo:

```bash
cd ~/Code/homebrew-tap
git add Formula/injectbook.rb
git commit -m "injectbook vX.Y.Z"
git push origin main
```

## Verify install from tap

```bash
brew update
brew tap prashantbhudwal/tap
brew install --cask calibre
brew reinstall injectbook
injectbook --version
```

## Notes

- `sha256` cannot be known before the release artifact is built.
- Keep formula in `homebrew-tap` as the source of truth users install from.
- `injectbook` formula depends on `node`; Calibre is installed separately as a cask.
