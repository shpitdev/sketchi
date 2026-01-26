import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const OUTPUT_DIR = join(import.meta.dirname, "../output");

function getTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

export interface OutputSession {
  dir: string;
  timestamp: string;
  saveJson: (name: string, data: unknown) => Promise<string>;
  savePng: (name: string, buffer: Buffer) => Promise<string>;
  saveText: (name: string, content: string) => Promise<string>;
}

export async function createOutputSession(
  prefix = "run"
): Promise<OutputSession> {
  const timestamp = getTimestamp();
  const dir = join(OUTPUT_DIR, `${prefix}_${timestamp}`);
  await mkdir(dir, { recursive: true });

  const saveJson = async (name: string, data: unknown): Promise<string> => {
    const path = join(dir, `${name}.json`);
    await writeFile(path, JSON.stringify(data, null, 2));
    return path;
  };

  const savePng = async (name: string, buffer: Buffer): Promise<string> => {
    const path = join(dir, `${name}.png`);
    await writeFile(path, buffer);
    return path;
  };

  const saveText = async (name: string, content: string): Promise<string> => {
    const path = join(dir, `${name}.txt`);
    await writeFile(path, content);
    return path;
  };

  return { dir, timestamp, saveJson, savePng, saveText };
}
