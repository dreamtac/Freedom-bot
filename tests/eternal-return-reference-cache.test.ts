import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { getReferenceData } from "../src/sources/eternal-return-reference.js";
import { EternalReturnRequestQueue, replaceEternalReturnRequestQueueForTesting } from "../src/sources/eternal-return-request-queue.js";
import { EternalReturnStore } from "../src/storage/eternal-return-store.js";

const originalFetch = global.fetch;
const temporaryDirectories: string[] = [];
let restoreQueue: (() => void) | undefined;

afterEach(async () => {
  global.fetch = originalFetch;
  restoreQueue?.();
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true })));
});

it("공통 자료를 최초 8 API 호출로 저장하고 재시작 뒤 SQLite에서 재사용한다", async () => {
  let clock = 0;
  restoreQueue = replaceEternalReturnRequestQueueForTesting(new EternalReturnRequestQueue({
    minStartIntervalMs: 0, now: () => clock, sleep: async ms => { clock += ms; },
  }));
  const directory = await mkdtemp(join(tmpdir(), "freedom-bot-er-reference-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "test.sqlite");
  const urls: string[] = [];
  global.fetch = vi.fn(async (input) => {
    const url = String(input);
    urls.push(url);
    if (url === "https://example.test/ko.txt") {
      return new Response("Character/Name/1┃재키");
    }
    if (url.endsWith("/v1/l10n/Korean")) {
      return json({ code: 200, data: { l10Path: "https://example.test/ko.txt" } });
    }
    if (url.endsWith("/v2/data/hash")) return json({ code: 200, data: { Character: "hash-1" } });
    if (url.endsWith("/v2/data/Character")) return json({ code: 200, data: [{ code: 1 }] });
    return json({ code: 200, data: [] });
  }) as typeof fetch;

  const first = await EternalReturnStore.open(path);
  const references = await getReferenceData("stored-cache-key", {}, first);
  expect(references.characterName(1)).toBe("재키");
  expect(urls.filter(url => url.includes("open-api.bser.io"))).toHaveLength(8);
  expect(urls).toHaveLength(9);
  first.close();

  global.fetch = vi.fn(async () => { throw new Error("network should not be used"); }) as typeof fetch;
  const reopened = await EternalReturnStore.open(path);
  const cached = await getReferenceData("stored-cache-key", {}, reopened);
  expect(cached.characterName(1)).toBe("재키");
  expect(global.fetch).not.toHaveBeenCalled();
  reopened.close();
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}
