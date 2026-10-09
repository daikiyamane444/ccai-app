/**
 * プロンプトは app/prompts/<名前>.md から名前で読み込む（コードに埋め込まない。SPEC-000b）。
 * ファイルの形: 先頭に「---」で囲んだ見出し（spec・purpose・version・updated）、その後ろがシステムプロンプトの本文。
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type Prompt = { name: string; spec: string; purpose: string; version: string; updated: string; system: string };

export const PROMPT_NAME_RE = /^[a-z0-9_-]{1,64}$/;

export class PromptNotFoundError extends Error {
  constructor() {
    super("prompt not found");
    this.name = "PromptNotFoundError";
  }
}

export function promptsDir(): string {
  return join(process.cwd(), "prompts");
}

export function parsePrompt(name: string, text: string): Prompt {
  const m = text.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new PromptNotFoundError();
  const head: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) head[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const system = m[2].trim();
  if (!head.spec || !head.purpose || !head.version || !system) throw new PromptNotFoundError();
  return { name, spec: head.spec, purpose: head.purpose, version: head.version, updated: head.updated ?? "", system };
}

/** 名前でプロンプトを読む。名前の形が違う・ファイルがない・形式が違うときは PromptNotFoundError（プロバイダは呼ばない） */
export async function loadPrompt(name: string, dir: string = promptsDir()): Promise<Prompt> {
  if (!PROMPT_NAME_RE.test(name)) throw new PromptNotFoundError();
  let text: string;
  try {
    text = await readFile(join(dir, `${name}.md`), "utf8");
  } catch {
    throw new PromptNotFoundError();
  }
  return parsePrompt(name, text);
}
