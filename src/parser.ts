import path from "node:path";
import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";
import { parse as parseHtml } from "node-html-parser";
import { NodeHtmlMarkdown } from "node-html-markdown";
import { CliError, type BookMetadata, type Chapter } from "./types";

type ManifestItem = {
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
};

type SpineItem = {
  idref: string;
};

type TocLabelMap = Map<string, string>;
type TocEntry = {
  href: string;
  title: string;
};

export type ParseOptions = {
  stripImages: boolean;
  stripInternalLinks: boolean;
  filterBoilerplate: boolean;
  maxChapterWords: number;
  minSectionWords: number;
};

const DEFAULT_PARSE_OPTIONS: ParseOptions = {
  stripImages: true,
  stripInternalLinks: true,
  filterBoilerplate: true,
  maxChapterWords: 15000,
  minSectionWords: 300
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ""
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function firstMeaningfulText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const text = firstMeaningfulText(item);
      if (text) {
        return text;
      }
    }
    return undefined;
  }

  if (value && typeof value === "object") {
    const textLike = (value as Record<string, unknown>)["#text"];
    const preferred = firstMeaningfulText(textLike);
    if (preferred) {
      return preferred;
    }

    for (const nested of Object.values(value as Record<string, unknown>)) {
      const text = firstMeaningfulText(nested);
      if (text) {
        return text;
      }
    }
  }

  return undefined;
}

function normalizeHrefKey(value: string): string {
  return value.split("#")[0].replace(/^\.\//, "").toLowerCase();
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60) || "chapter";
}

function chapterWordCount(markdown: string): number {
  const words = markdown
    .replace(/^---[\s\S]*?---/m, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.length;
}

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function cleanTitle(value: string): string {
  return value.replace(/\[\d+\]\s*$/g, "").replace(/\s+/g, " ").trim();
}

function stripMarkdownLinkDestination(markdown: string, stripInternalLinks: boolean): string {
  if (!stripInternalLinks) {
    return markdown;
  }

  const withoutFootnoteTargets = markdown.replace(/\[\[([^\]]+)\]\]\(([^)\n]+)\)/g, (_full, label: string, destination: string) => {
    const rawDest = destination.trim().split(/\s+/)[0] || "";
    if (/^https?:\/\//i.test(rawDest)) {
      return `[[${label}]](${destination})`;
    }
    return `[[${label}]]`;
  });

  return withoutFootnoteTargets.replace(/(?<!!)\[((?:\\.|[^\]])+)\]\(([^)\n]+)\)/g, (_full, label: string, destination: string) => {
    const rawDest = destination.trim().split(/\s+/)[0] || "";
    if (/^https?:\/\//i.test(rawDest)) {
      return `[${label}](${destination})`;
    }
    return label;
  });
}

function unescapeMarkdownSyntax(markdown: string): string {
  return markdown
    .replace(/\\\[/g, "[")
    .replace(/\\\]/g, "]")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\!/g, "!");
}

function cleanupMarkdown(markdown: string, options: ParseOptions): string {
  return markdown
    .replace(/^\s*<\?xml[^>]*>\s*$/gim, "")
    .replace(/^\s*<!DOCTYPE[^>]*>\s*$/gim, "")
    .replace(options.stripImages ? /!\[[^\]]*]\([^)\n]*\)/g : /$^/g, "")
    .replace(options.stripImages ? /!\[[^\]]*]\[[^\]]*]/g : /$^/g, "")
    .replace(options.stripImages ? /^\[[^\]]+]:\s*\S+\s*$/gm : /$^/g, "")
    .replace(options.stripImages ? /<img\b[^>]*>/gi : /$^/g, "")
    .replace(/\[[^\]]*]\(\#[^)]+\)/g, "")
    .replace(/^\s*\[\]\(#[^)]+\)\s*$/gm, "")
    .replace(/\n[ \t]+\n/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeMetadataList(value: unknown): string[] {
  const values = asArray(value).map((item) => firstMeaningfulText(item)).filter((item): item is string => Boolean(item));
  return values.map((item) => decodeBasicEntities(item)).map((item) => item.trim()).filter(Boolean);
}

function isBoilerplateChapter(title: string, markdown: string, options: ParseOptions): boolean {
  if (!options.filterBoilerplate) {
    return false;
  }

  const normalizedTitle = cleanTitle(title).toLowerCase();
  if (/\b(index|glossary)\b/.test(normalizedTitle)) {
    return false;
  }

  if (/^\s*(cover|title page|contents|table of contents)\s*$/.test(normalizedTitle)) {
    return true;
  }

  const sample = `${normalizedTitle}\n${markdown.slice(0, 2500).toLowerCase()}`;
  return /project gutenberg|gutenberg license|full license|terms of use|copyright|all rights reserved/.test(sample);
}

function parseNavEntries(zip: AdmZip, opfDir: string, manifest: ManifestItem[]): TocEntry[] {
  const navItem =
    manifest.find((item) => item.properties?.split(/\s+/).includes("nav")) ||
    manifest.find((item) => /xhtml|html/.test(item.mediaType) && /nav/i.test(item.href));

  if (!navItem) {
    return [];
  }

  const fullPath = path.posix.normalize(path.posix.join(opfDir, navItem.href));
  const entry = zip.getEntry(fullPath);
  if (!entry) {
    return [];
  }

  const root = parseHtml(entry.getData().toString("utf8"));
  const navNodes = root.querySelectorAll("nav");
  const tocNav = navNodes.find((node) => {
    const epubType = String(node.getAttribute("epub:type") || node.getAttribute("type") || "");
    return epubType.toLowerCase().includes("toc");
  });
  if (!tocNav) {
    return [];
  }

  const firstOl = tocNav.querySelector("ol");
  if (!firstOl) {
    return [];
  }

  const entries: TocEntry[] = [];
  for (const child of firstOl.childNodes) {
    const tagName = String((child as { tagName?: string }).tagName || "").toLowerCase();
    if (tagName !== "li") {
      continue;
    }
    const anchor = (
      child as unknown as {
        querySelector: (selector: string) => { getAttribute: (name: string) => string | undefined; text: string } | null;
      }
    ).querySelector("a");
    const href = anchor?.getAttribute("href") || "";
    const label = cleanTitle((anchor?.text || "").replace(/\s+/g, " ").trim());
    if (href && label) {
      entries.push({ href, title: label });
    }
  }

  return entries;
}

function splitMarkdownByHeading(markdown: string, level: 1 | 2): { title?: string; markdown: string }[] {
  const heading = "#".repeat(level);
  const regex = new RegExp(`^${heading}\\s+(.+)$`, "gm");
  const matches = [...markdown.matchAll(regex)];

  if (matches.length < 2) {
    return [];
  }

  const sections: { title?: string; markdown: string }[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const start = current.index ?? 0;
    const end = matches[index + 1]?.index ?? markdown.length;
    const chunk = markdown.slice(start, end).trim();
    if (!chunk) {
      continue;
    }
    sections.push({
      title: cleanTitle((current[1] || "").trim()),
      markdown: chunk
    });
  }

  return sections;
}

function mergeTinySections(
  sections: { title?: string; markdown: string }[],
  minSectionWords: number
): { title?: string; markdown: string }[] {
  const merged = [...sections];
  for (let index = 1; index < merged.length; index += 1) {
    if (chapterWordCount(merged[index].markdown) < minSectionWords) {
      merged[index - 1].markdown = `${merged[index - 1].markdown}\n\n${merged[index].markdown}`;
      merged.splice(index, 1);
      index -= 1;
    }
  }

  if (merged.length > 1 && chapterWordCount(merged[0].markdown) < minSectionWords) {
    merged[1].markdown = `${merged[0].markdown}\n\n${merged[1].markdown}`;
    merged.shift();
  }

  return merged;
}

function splitLargeChapter(chapter: Chapter, options: ParseOptions): Chapter[] {
  if (chapter.wordCount <= options.maxChapterWords) {
    return [chapter];
  }

  const sections = splitMarkdownByHeading(chapter.markdown, 1);
  const fallbackSections = sections.length > 0 ? sections : splitMarkdownByHeading(chapter.markdown, 2);
  if (fallbackSections.length < 2) {
    return [chapter];
  }

  const merged = mergeTinySections(fallbackSections, options.minSectionWords);
  if (merged.length < 2) {
    return [chapter];
  }

  return merged.map((section, index) => {
    const sectionTitle = cleanTitle(section.title || `${chapter.title} Part ${index + 1}`) || `${chapter.title} Part ${index + 1}`;
    const sectionMarkdown = section.markdown.trim();
    return {
      index: chapter.index,
      title: sectionTitle,
      slug: slugify(sectionTitle),
      sourceFile: `${chapter.sourceFile}#part-${index + 1}`,
      markdown: sectionMarkdown,
      wordCount: chapterWordCount(sectionMarkdown)
    };
  });
}

function resolveParseOptions(options?: Partial<ParseOptions>): ParseOptions {
  return {
    ...DEFAULT_PARSE_OPTIONS,
    ...(options || {})
  };
}

function finalizeCleanup(markdown: string, options: ParseOptions): string {
  const normalized = unescapeMarkdownSyntax(markdown);
  return cleanupMarkdown(stripMarkdownLinkDestination(normalized, options.stripInternalLinks), options)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractContainerOpfPath(zip: AdmZip): string {
  const containerEntry = zip.getEntry("META-INF/container.xml");
  if (!containerEntry) {
    throw new CliError("EPUB is missing META-INF/container.xml", 4);
  }

  const parsed = xmlParser.parse(containerEntry.getData().toString("utf8"));
  const rootfile = parsed?.container?.rootfiles?.rootfile;
  const fullPath = Array.isArray(rootfile) ? rootfile[0]?.["full-path"] : rootfile?.["full-path"];

  if (!fullPath || typeof fullPath !== "string") {
    throw new CliError("Could not resolve OPF path from EPUB container.xml", 4);
  }

  return fullPath;
}

function parseOpf(zip: AdmZip, opfPath: string): { manifest: ManifestItem[]; spine: SpineItem[]; metadata: BookMetadata } {
  const opfEntry = zip.getEntry(opfPath);
  if (!opfEntry) {
    throw new CliError(`OPF file not found at ${opfPath}`, 4);
  }

  const parsed = xmlParser.parse(opfEntry.getData().toString("utf8"));
  const pkg = parsed?.package;
  if (!pkg) {
    throw new CliError("Invalid OPF package file", 4);
  }

  const manifest = asArray(pkg.manifest?.item).map((item) => ({
    id: item.id,
    href: item.href,
    mediaType: item["media-type"],
    properties: item.properties
  })) as ManifestItem[];

  const spine = asArray(pkg.spine?.itemref).map((item) => ({
    idref: item.idref
  })) as SpineItem[];

  const creators = normalizeMetadataList(pkg.metadata?.["dc:creator"]);
  const subjects = normalizeMetadataList(pkg.metadata?.["dc:subject"]);

  const opfMetadata: BookMetadata = {
    title: firstMeaningfulText(pkg.metadata?.["dc:title"]),
    authors: creators,
    language: firstMeaningfulText(pkg.metadata?.["dc:language"]),
    publisher: firstMeaningfulText(pkg.metadata?.["dc:publisher"]),
    tags: subjects
  };

  return { manifest, spine, metadata: opfMetadata };
}

function parseNcxEntries(zip: AdmZip, opfDir: string, manifest: ManifestItem[]): TocEntry[] {
  const ncxItem = manifest.find((item) => item.mediaType === "application/x-dtbncx+xml");
  if (!ncxItem) {
    return [];
  }

  const fullPath = path.posix.normalize(path.posix.join(opfDir, ncxItem.href));
  const entry = zip.getEntry(fullPath);
  if (!entry) {
    return [];
  }

  const parsed = xmlParser.parse(entry.getData().toString("utf8"));
  const navPoints = asArray(parsed?.ncx?.navMap?.navPoint);
  const entries: TocEntry[] = [];
  for (const node of navPoints) {
    const src = node.content?.src;
    const text = node.navLabel?.text;
    if (typeof src === "string" && typeof text === "string" && text.trim()) {
      entries.push({ href: src, title: text.trim() });
    }
  }

  return entries;
}

function toTocLabelMap(entries: TocEntry[]): TocLabelMap {
  const map: TocLabelMap = new Map();
  for (const entry of entries) {
    const key = normalizeHrefKey(entry.href);
    if (!map.has(key)) {
      map.set(key, cleanTitle(entry.title));
    }
  }
  return map;
}

function toTocHrefSet(entries: TocEntry[]): Set<string> {
  const hrefs = new Set<string>();
  for (const entry of entries) {
    hrefs.add(normalizeHrefKey(entry.href));
  }
  return hrefs;
}

function deriveSpineHrefs(spine: SpineItem[], manifest: ManifestItem[]): string[] {
  const manifestById = new Map(manifest.map((item) => [item.id, item]));
  const spineHrefs = spine
    .map((entry) => manifestById.get(entry.idref)?.href)
    .filter((href): href is string => Boolean(href));

  if (spineHrefs.length > 0) {
    return spineHrefs;
  }

  return manifest
    .filter((item) => /xhtml|html/.test(item.mediaType))
    .map((item) => item.href);
}

export function parseEpubToChapters(epubPath: string, options?: Partial<ParseOptions>): { metadata: BookMetadata; chapters: Chapter[] } {
  const parseOptions = resolveParseOptions(options);
  const zip = new AdmZip(epubPath);
  const opfPath = extractContainerOpfPath(zip);
  const opfDir = path.posix.dirname(opfPath);
  const { manifest, spine, metadata } = parseOpf(zip, opfPath);

  const nhm = new NodeHtmlMarkdown();
  const navEntries = parseNavEntries(zip, opfDir, manifest);
  const ncxEntries = parseNcxEntries(zip, opfDir, manifest);
  const preferredTocEntries = navEntries.length > 0 ? navEntries : ncxEntries;
  const preferredTitleMap = toTocLabelMap(preferredTocEntries);
  const preferredHrefSet = toTocHrefSet(preferredTocEntries);
  const spineHrefs = deriveSpineHrefs(spine, manifest);
  const tocMatchedSpineHrefs =
    preferredHrefSet.size > 0
      ? spineHrefs.filter((href) => preferredHrefSet.has(normalizeHrefKey(href)))
      : spineHrefs;
  const chapterHrefs = tocMatchedSpineHrefs.length > 0 ? tocMatchedSpineHrefs : spineHrefs;

  const chapters: Chapter[] = [];

  for (const [index, href] of chapterHrefs.entries()) {
    const normalizedPath = path.posix.normalize(path.posix.join(opfDir, href));
    const entry = zip.getEntry(normalizedPath);
    if (!entry) {
      continue;
    }

    const html = entry.getData().toString("utf8");
    const markdown = finalizeCleanup(nhm.translate(html), parseOptions);
    if (!markdown) {
      continue;
    }

    const defaultTitle = `Chapter ${index + 1}`;
    const hrefKey = normalizeHrefKey(href);
    const tocTitle = preferredTitleMap.get(hrefKey);
    const firstHeading = cleanTitle(markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || "");
    const title = cleanTitle(tocTitle || firstHeading || (preferredHrefSet.size > 0 ? "" : defaultTitle));
    if (!title) {
      continue;
    }

    chapters.push({
      index: index + 1,
      title,
      slug: slugify(title),
      sourceFile: normalizedPath,
      markdown,
      wordCount: chapterWordCount(markdown)
    });
  }

  const filteredAndSplit = chapters
    .filter((chapter) => !isBoilerplateChapter(chapter.title, chapter.markdown, parseOptions))
    .flatMap((chapter) => splitLargeChapter(chapter, parseOptions))
    .filter((chapter) => !isBoilerplateChapter(chapter.title, chapter.markdown, parseOptions));

  if (filteredAndSplit.length === 0) {
    throw new CliError("No chapter content could be extracted from converted EPUB", 4);
  }

  // Reindex after filtering empty sections so output filenames are contiguous.
  const reindexed = filteredAndSplit.map((chapter, idx) => ({
    ...chapter,
    index: idx + 1
  }));

  return { metadata, chapters: reindexed };
}
