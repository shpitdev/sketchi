import type { PromptFrontmatter } from "./schema";

export interface PromptRecord extends PromptFrontmatter {
  body: string;
  sourcePath: string;
}

export type PromptVariables = Record<string, string | number | boolean>;
