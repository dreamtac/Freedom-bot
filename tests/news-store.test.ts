import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { NewsPost } from "../src/sources/types.js";
import { NewsStore } from "../src/storage/news-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("NewsStore", () => {
  it("기준 공지는 알림 완료 상태로 저장한다", async () => {
    const { store } = await createStore();
    store.upsert([createPost("endfield:1")], true);

    expect(store.count()).toBe(1);
    expect(store.getPending("endfield")).toEqual([]);
    expect(store.listRecent()[0]?.title).toBe("공지 endfield:1");
    store.close();
  });

  it("새 공지는 알림 대기로 저장하고 완료 처리할 수 있다", async () => {
    const { store } = await createStore();
    store.upsert([createPost("endfield:2")]);

    expect(store.getPending("endfield")).toHaveLength(1);
    store.markNotified("endfield:2");
    expect(store.getPending("endfield")).toEqual([]);
    store.close();
  });

  it("기존 JSON ID를 이전하고 최신 데이터로 보강한다", async () => {
    const { directory, store } = await createStore();
    const legacyPath = join(directory, "seen-posts.json");
    await writeFile(
      legacyPath,
      JSON.stringify({ version: 1, seenPostIds: ["endfield:3"] }),
    );

    await expect(store.importLegacyJson(legacyPath)).resolves.toBe(1);
    store.upsert([createPost("endfield:3")]);

    expect(store.getPending("endfield")).toEqual([]);
    expect(store.listRecent()[0]?.title).toBe("공지 endfield:3");
    store.close();
  });
});

async function createStore(): Promise<{
  directory: string;
  store: NewsStore;
}> {
  const directory = await mkdtemp(join(tmpdir(), "freedom-bot-"));
  temporaryDirectories.push(directory);
  return {
    directory,
    store: await NewsStore.open(join(directory, "test.sqlite")),
  };
}

function createPost(id: string): NewsPost {
  return {
    id,
    sourceKey: "endfield",
    source: "명일방주: 엔드필드",
    category: "notices",
    title: `공지 ${id}`,
    summary: "요약",
    publishedAt: new Date("2026-06-22T10:00:00Z"),
    url: `https://example.com/${id}`,
  };
}
