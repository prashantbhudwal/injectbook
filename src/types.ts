export type ExitCode = 0 | 2 | 3 | 4 | 5;

export type BookMetadata = {
  title?: string;
  authors: string[];
  language?: string;
  publisher?: string;
  tags: string[];
};

export type Chapter = {
  index: number;
  title: string;
  slug: string;
  sourceFile: string;
  markdown: string;
  wordCount: number;
};

export type SkillWriteOptions = {
  outDir: string;
  skillName: string;
  description: string;
  chapterPrefix: string;
  includeFullBook: boolean;
  overwrite: boolean;
};

export class CliError extends Error {
  code: ExitCode;

  constructor(message: string, code: ExitCode) {
    super(message);
    this.name = "CliError";
    this.code = code;
  }
}
