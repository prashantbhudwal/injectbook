export const CALIBRE = {
  brewInstallHint: "brew install --cask calibre",
  trustPitch:
    "Calibre is one of the most established open-source ebook tools, trusted by millions of readers worldwide for over a decade.",
  whyInjectbookUsesIt:
    "injectbook uses Calibre to normalize book inputs before extraction for reliable conversion and metadata handling."
} as const;

export function calibreInfoMessage(): string {
  return `${CALIBRE.whyInjectbookUsesIt} ${CALIBRE.trustPitch}`;
}

