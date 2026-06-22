import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

interface StoreData {
  version: 1;
  seenPostIds: string[];
}

export class SeenPostStore {
  readonly #filePath: string;
  #seenPostIds = new Set<string>();
  #loaded = false;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  async load(): Promise<void> {
    if (this.#loaded) {
      return;
    }

    try {
      const raw = await readFile(this.#filePath, "utf8");
      const data = JSON.parse(raw) as StoreData;
      this.#seenPostIds = new Set(data.seenPostIds);
    } catch (error: unknown) {
      if (!isFileNotFoundError(error)) {
        throw error;
      }
    }

    this.#loaded = true;
  }

  isEmpty(): boolean {
    this.#assertLoaded();
    return this.#seenPostIds.size === 0;
  }

  has(postId: string): boolean {
    this.#assertLoaded();
    return this.#seenPostIds.has(postId);
  }

  async add(postIds: Iterable<string>): Promise<void> {
    this.#assertLoaded();
    for (const postId of postIds) {
      this.#seenPostIds.add(postId);
    }

    await mkdir(dirname(this.#filePath), { recursive: true });
    const temporaryPath = `${this.#filePath}.tmp`;
    const data: StoreData = {
      version: 1,
      seenPostIds: [...this.#seenPostIds].sort(),
    };
    await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.#filePath);
  }

  #assertLoaded(): void {
    if (!this.#loaded) {
      throw new Error("SeenPostStore.load()를 먼저 호출해야 합니다.");
    }
  }
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
