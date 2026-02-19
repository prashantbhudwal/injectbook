# Injectbook Release Playbook

This file documents exactly how to cut releases for `injectbook` and publish/update the Homebrew tap.
It is written for an agent-driven release where the agent performs all post-tag steps automatically.

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
   - Asset URLs:
     - `injectbook-vX.Y.Z-darwin-arm64.tar.gz`
     - `injectbook-vX.Y.Z-darwin-amd64.tar.gz`
   - SHA256 for each exact asset

## Agent automation policy (preferred)

After pushing tag `vX.Y.Z`, the agent should complete all remaining steps without asking for confirmation:

1. Query GitHub release metadata:

```bash
gh release view vX.Y.Z --repo prashantbhudwal/injectbook --json assets,tagName,name,publishedAt,url
```

2. Extract artifact URLs and SHA256 values:
   - `injectbook-vX.Y.Z-darwin-arm64.tar.gz` + SHA
   - `injectbook-vX.Y.Z-darwin-amd64.tar.gz` + SHA
   - SHA values come from `assets[].digest` (`sha256:<value>`)

3. Update local tap formula in `~/Code/homebrew-tap/Formula/injectbook.rb`:
   - `version "X.Y.Z"`
   - conditional `url`/`sha256` for `arm64` and `amd64`

4. Commit and push tap repo:

```bash
cd ~/Code/homebrew-tap
git add Formula/injectbook.rb
git commit -m "injectbook vX.Y.Z"
git push origin main
```

5. Verify brew install end-to-end:

```bash
brew update
brew tap prashantbhudwal/tap
brew reinstall injectbook
injectbook --version
```

6. Report final shipping status including:
   - app commit/tag pushed
   - tap commit pushed
   - installed brew version output

## Update Homebrew tap formula

1. Edit tap formula file:
   - `~/Code/homebrew-tap/Formula/injectbook.rb`
2. Update fields:
   - `version "X.Y.Z"`
   - `arm64` URL/SHA:
     - `url "https://github.com/prashantbhudwal/injectbook/releases/download/vX.Y.Z/injectbook-vX.Y.Z-darwin-arm64.tar.gz"`
     - `sha256 "<real-arm64-sha256-from-release-asset>"`
   - `amd64` URL/SHA:
     - `url "https://github.com/prashantbhudwal/injectbook/releases/download/vX.Y.Z/injectbook-vX.Y.Z-darwin-amd64.tar.gz"`
     - `sha256 "<real-amd64-sha256-from-release-asset>"`
   - remove `depends_on "node"` (standalone binary release)
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

## Operational notes from current setup

- App repo branch used for release: `master`
- App release tag format: `vX.Y.Z`
- Tap repo branch: `main`
- `sha256` must always come from the published release artifact, never precomputed locally.

## Notes

- `sha256` cannot be known before the release artifact is built.
- Keep formula in `homebrew-tap` as the source of truth users install from.
- Keep `/Formula/injectbook.rb` in this repo synchronized with tap formula contents.
- `injectbook` formula installs a standalone binary and does not depend on `node`; Calibre is installed separately as a cask.
