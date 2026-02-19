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

function splitOversizedPlainBlock(block: string, maxChapterWords: number): string[] {
  const words = block.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];

  for (let index = 0; index < words.length; index += maxChapterWords) {
    const chunk = words.slice(index, index + maxChapterWords).join(" ").trim();
    if (chunk) {
      chunks.push(chunk);
    }
  }

  return chunks;
}

function splitMarkdownByWordCount(markdown: string, maxChapterWords: number): string[] {
  const paragraphBlocks = markdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (paragraphBlocks.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  let currentBlocks: string[] = [];
  let currentWords = 0;

  const flushCurrent = (): void => {
    if (currentBlocks.length === 0) {
      return;
    }
    chunks.push(currentBlocks.join("\n\n").trim());
    currentBlocks = [];
    currentWords = 0;
  };

  for (const block of paragraphBlocks) {
    const blockWords = chapterWordCount(block);
    if (blockWords > Math.floor(maxChapterWords * 1.5)) {
      flushCurrent();
      chunks.push(...splitOversizedPlainBlock(block, maxChapterWords));
      continue;
    }

    if (currentWords > 0 && currentWords + blockWords > maxChapterWords) {
      flushCurrent();
    }

    currentBlocks.push(block);
    currentWords += blockWords;
  }

  flushCurrent();
  return chunks.filter(Boolean);
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

function stripMarkdownTitleDecorations(value: string): string {
  return value
    .replace(/[*_`~]/g, "")
    .replace(/!\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1");
}

function cleanTitle(value: string): string {
  return stripMarkdownTitleDecorations(value)
    .replace(/\s*[.\u2022·•]{3,}\s*\d+\s*$/g, "")
    .replace(/\[\d+\]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeChapterTitle(rawTitle: string, fallback: string): string {
  const cleaned = cleanTitle(rawTitle);
  if (!cleaned) {
    return fallback;
  }

  if (/^\d+$/.test(cleaned)) {
    return `Chapter ${cleaned}`;
  }

  const chapterMatch = cleaned.match(/^chapter\s+(\d+)\b(.*)$/i);
  if (chapterMatch) {
    const chapterNumber = chapterMatch[1];
    const suffix = (chapterMatch[2] || "").trim();
    if (!suffix) {
      return `Chapter ${chapterNumber}`;
    }
    const normalizedSuffix = suffix.replace(/^[:.\-]\s*/, "").trim();
    return normalizedSuffix ? `Chapter ${chapterNumber}: ${normalizedSuffix}` : `Chapter ${chapterNumber}`;
  }

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (cleaned.length > 95 || words.length > 15) {
    return fallback;
  }

  if (/[.?!]\s+[A-Z]/.test(cleaned) && words.length > 8) {
    return fallback;
  }

  const punctuationHits = (cleaned.match(/[,;:]/g) || []).length;
  if (words.length > 12 && punctuationHits >= 2) {
    return fallback;
  }

  return cleaned;
}

function isLikelyNoteDenseMarkdown(markdown: string): boolean {
  const inlineNoteMatches = markdown.match(/(?:^|\s)(?:\[\d+\]|\d+\\?[.)]|[ivxlcdm]+[.)])\s+[A-Za-z]/gim) || [];
  if (inlineNoteMatches.length >= 30 && chapterWordCount(markdown) <= 15000) {
    return true;
  }

  const lines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 350);

  if (lines.length < 40) {
    return false;
  }

  let noteLikeLines = 0;
  for (const line of lines) {
    if (/^(?:\[\d+\]|\d+\\?[.)]|[ivxlcdm]+[.)])\s+/i.test(line) || /^\d{1,3}\s+[A-Za-z]/.test(line)) {
      noteLikeLines += 1;
    }
  }

  return noteLikeLines / lines.length >= 0.33;
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

type BoilerplateRule = {
  id: string;
  kind: "hard" | "soft";
  titlePattern?: RegExp;
  contentPattern?: RegExp;
  predicate?: (chapter: Chapter) => boolean;
  maxWords?: number;
};

const BOILERPLATE_RULES: BoilerplateRule[] = [
  {
    id: "title-front-matter",
    kind: "hard",
    titlePattern:
      /^\s*(cover|title page|contents|table of contents|about the author|by the same author|copyright page)\s*$/i
  },
  {
    id: "title-back-matter",
    kind: "hard",
    titlePattern: /^\s*(notes|endnotes|index|bibliography|references)\s*$/i
  },
  {
    id: "legal-license",
    kind: "soft",
    contentPattern: /project gutenberg|gutenberg license|full license|terms of use|copyright|all rights reserved/i,
    maxWords: 4000
  },
  {
    id: "notes-content-density",
    kind: "hard",
    predicate: (chapter) => isLikelyNoteDenseMarkdown(chapter.markdown)
  }
];

function isBoilerplateChapter(chapter: Chapter, options: ParseOptions): boolean {
  if (!options.filterBoilerplate) {
    return false;
  }

  const normalizedTitle = cleanTitle(chapter.title);
  const normalizedTitleLower = normalizedTitle.toLowerCase();
  if (/\b(index|glossary)\b/.test(normalizedTitleLower)) {
    return false;
  }

  const sample = `${normalizedTitleLower}\n${chapter.markdown.slice(0, 2500).toLowerCase()}`;

  for (const rule of BOILERPLATE_RULES) {
    const titleMatch = rule.titlePattern ? rule.titlePattern.test(normalizedTitle) : false;
    const contentMatch = rule.contentPattern ? rule.contentPattern.test(sample) : false;
    const predicateMatch = rule.predicate ? rule.predicate(chapter) : false;
    if (!titleMatch && !contentMatch && !predicateMatch) {
      continue;
    }

    if (rule.kind === "hard") {
      return true;
    }

    const withinWordLimit = typeof rule.maxWords !== "number" || chapter.wordCount <= rule.maxWords;
    if (withinWordLimit) {
      return true;
    }
  }

  return false;
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
  minSectionWords: number,
  maxChapterWords: number
): { title?: string; markdown: string }[] {
  const merged = [...sections];
  for (let index = 1; index < merged.length; index += 1) {
    const previousWordCount = chapterWordCount(merged[index - 1].markdown);
    const currentWordCount = chapterWordCount(merged[index].markdown);
    if (currentWordCount < minSectionWords && previousWordCount + currentWordCount <= maxChapterWords * 1.25) {
      merged[index - 1].markdown = `${merged[index - 1].markdown}\n\n${merged[index].markdown}`;
      merged.splice(index, 1);
      index -= 1;
    }
  }

  if (
    merged.length > 1 &&
    chapterWordCount(merged[0].markdown) < minSectionWords &&
    chapterWordCount(merged[0].markdown) + chapterWordCount(merged[1].markdown) <= maxChapterWords * 1.25
  ) {
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
  const merged =
    fallbackSections.length >= 2
      ? mergeTinySections(fallbackSections, options.minSectionWords, options.maxChapterWords)
      : [];
  if (merged.length >= 2) {
    return merged.map((section, index) => {
      const sectionTitle = normalizeChapterTitle(section.title || "", `${chapter.title} Part ${index + 1}`);
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

  const fallbackWordChunks = splitMarkdownByWordCount(chapter.markdown, options.maxChapterWords);
  if (fallbackWordChunks.length < 2) {
    return [chapter];
  }

  return fallbackWordChunks.map((sectionMarkdown, index) => {
    const sectionTitle = `${chapter.title} Part ${index + 1}`;
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
  let sawImageOnlyContent = false;

  for (const [index, href] of chapterHrefs.entries()) {
    const normalizedPath = path.posix.normalize(path.posix.join(opfDir, href));
    const entry = zip.getEntry(normalizedPath);
    if (!entry) {
      continue;
    }

    const html = entry.getData().toString("utf8");
    const markdown = finalizeCleanup(nhm.translate(html), parseOptions);
    if (!markdown) {
      if (parseOptions.stripImages && /<img\b/i.test(html)) {
        sawImageOnlyContent = true;
      }
      continue;
    }

    const defaultTitle = `Chapter ${index + 1}`;
    const hrefKey = normalizeHrefKey(href);
    const tocTitle = preferredTitleMap.get(hrefKey);
    const firstHeading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
    const title = normalizeChapterTitle(tocTitle || firstHeading || (preferredHrefSet.size > 0 ? "" : defaultTitle), defaultTitle);
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
    .filter((chapter) => !isBoilerplateChapter(chapter, parseOptions))
    .flatMap((chapter) => splitLargeChapter(chapter, parseOptions))
    .filter((chapter) => !isBoilerplateChapter(chapter, parseOptions));

  if (filteredAndSplit.length === 0) {
    if (sawImageOnlyContent) {
      throw new CliError(
        "No text could be extracted. The converted EPUB appears image-only (common with scanned PDFs). OCR is required; this version does not support OCR.",
        4
      );
    }

    throw new CliError("No chapter content could be extracted from converted EPUB", 4);
  }

  // Reindex after filtering empty sections so output filenames are contiguous.
  const reindexed = filteredAndSplit.map((chapter, idx) => ({
    ...chapter,
    index: idx + 1
  }));

  return { metadata, chapters: reindexed };
}
