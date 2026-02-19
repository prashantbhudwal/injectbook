import path from "node:path";
import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";
import { NodeHtmlMarkdown } from "node-html-markdown";
import { CliError, type BookMetadata, type Chapter } from "./types";

type ManifestItem = {
  id: string;
  href: string;
  mediaType: string;
};

type SpineItem = {
  idref: string;
};

type TocLabelMap = Map<string, string>;

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

function asDcString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  if (value && typeof value === "object" && "#text" in value) {
    const text = (value as { "#text"?: unknown })["#text"];
    if (typeof text === "string") {
      const trimmed = text.trim();
      return trimmed ? trimmed : undefined;
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

function cleanupMarkdown(markdown: string): string {
  return markdown
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s*\[\]\(#[^)]+\)\s*$/gm, "")
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
    mediaType: item["media-type"]
  })) as ManifestItem[];

  const spine = asArray(pkg.spine?.itemref).map((item) => ({
    idref: item.idref
  })) as SpineItem[];

  const creators = asArray(pkg.metadata?.["dc:creator"]).map(asDcString).filter((value): value is string => Boolean(value));
  const subjects = asArray(pkg.metadata?.["dc:subject"]).map(asDcString).filter((value): value is string => Boolean(value));

  const opfMetadata: BookMetadata = {
    title: asDcString(pkg.metadata?.["dc:title"]),
    authors: creators,
    language: asDcString(pkg.metadata?.["dc:language"]),
    publisher: asDcString(pkg.metadata?.["dc:publisher"]),
    tags: subjects
  };

  return { manifest, spine, metadata: opfMetadata };
}

function parseNcxTitleMap(zip: AdmZip, opfDir: string, manifest: ManifestItem[]): TocLabelMap {
  const ncxItem = manifest.find((item) => item.mediaType === "application/x-dtbncx+xml");
  if (!ncxItem) {
    return new Map();
  }

  const fullPath = path.posix.normalize(path.posix.join(opfDir, ncxItem.href));
  const entry = zip.getEntry(fullPath);
  if (!entry) {
    return new Map();
  }

  const parsed = xmlParser.parse(entry.getData().toString("utf8"));
  const navPoints = asArray(parsed?.ncx?.navMap?.navPoint);
  const map: TocLabelMap = new Map();

  const stack = [...navPoints];
  while (stack.length > 0) {
    const node = stack.shift();
    if (!node) {
      continue;
    }

    const src = node.content?.src;
    const text = node.navLabel?.text;
    if (typeof src === "string" && typeof text === "string" && text.trim()) {
      map.set(normalizeHrefKey(src), text.trim());
    }

    const children = asArray(node.navPoint);
    stack.push(...children);
  }

  return map;
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

export function parseEpubToChapters(epubPath: string): { metadata: BookMetadata; chapters: Chapter[] } {
  const zip = new AdmZip(epubPath);
  const opfPath = extractContainerOpfPath(zip);
  const opfDir = path.posix.dirname(opfPath);
  const { manifest, spine, metadata } = parseOpf(zip, opfPath);

  const nhm = new NodeHtmlMarkdown();
  const tocTitleMap = parseNcxTitleMap(zip, opfDir, manifest);
  const spineHrefs = deriveSpineHrefs(spine, manifest);

  const chapters: Chapter[] = [];

  for (const [index, href] of spineHrefs.entries()) {
    const normalizedPath = path.posix.normalize(path.posix.join(opfDir, href));
    const entry = zip.getEntry(normalizedPath);
    if (!entry) {
      continue;
    }

    const html = entry.getData().toString("utf8");
    const markdown = cleanupMarkdown(nhm.translate(html));
    if (!markdown) {
      continue;
    }

    const defaultTitle = `Chapter ${index + 1}`;
    const tocTitle = tocTitleMap.get(normalizeHrefKey(href));
    const firstHeading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
    const title = tocTitle || firstHeading || defaultTitle;

    chapters.push({
      index: index + 1,
      title,
      slug: slugify(title),
      sourceFile: normalizedPath,
      markdown,
      wordCount: chapterWordCount(markdown)
    });
  }

  if (chapters.length === 0) {
    throw new CliError("No chapter content could be extracted from converted EPUB", 4);
  }

  // Reindex after filtering empty sections so output filenames are contiguous.
  const reindexed = chapters.map((chapter, idx) => ({
    ...chapter,
    index: idx + 1
  }));

  return { metadata, chapters: reindexed };
}
