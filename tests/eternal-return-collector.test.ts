import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { EternalReturnCollector } from "../src/services/eternal-return-collector.js";
import type { EternalReturnGame, EternalReturnResponse } from "../src/sources/eternal-return.js";
import { EternalReturnStore } from "../src/storage/eternal-return-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true })));
});

describe("EternalReturnCollector latest refresh", () => {
  it.each([
    { added: 0, pages: [[100, 99]], calls: 1 },
    { added: 1, pages: [[101, 100]], calls: 1 },
    { added: 9, pages: [[109, 108, 107, 106, 105, 104, 103, 102, 101, 100]], calls: 1 },
    { added: 10, pages: [range(110, 101), [100]], calls: 2 },
    { added: 11, pages: [range(111, 102), [101, 100]], calls: 2 },
  ])("새 경기 $added개를 기존 완료 경계까지 수집한다", async ({ added, pages, calls }) => {
    const { store } = await createStore();
    seedBoundary(store, 100);
    const loadPage = pagesLoader(pages);
    const collector = new EternalReturnCollector({ apiKey: "key", store, loadPage });

    const result = await collector.refreshUser("uid");

    expect(loadPage).toHaveBeenCalledTimes(calls);
    expect(result.newGameIds).toHaveLength(added);
    expect(result.newGameIds).toEqual(pages.flat().filter(gameId => gameId > 100));
    expect(result.reachedBoundary).toBe(true);
    expect(store.getCollectionState("uid", "latest")?.boundaryGameId).toBe(pages[0]?.[0]);
    expect(store.getCollectionState("uid", "latest")?.status).toBe("succeeded");
    store.close();
  });

  it("신규 닉네임의 첫 페이지를 즉시 저장하고 과거 수집 커서를 분리한다", async () => {
    const { store } = await createStore();
    const resolveUserId = vi.fn().mockResolvedValue("new-uid");
    const loadPage = vi.fn().mockResolvedValue(response(range(20, 11), "10"));
    const collector = new EternalReturnCollector({ apiKey: "key", store, resolveUserId, loadPage });

    const result = await collector.refreshNickname(" 홉빵맨 ");

    expect(resolveUserId).toHaveBeenCalledWith("홉빵맨", "key", { priority: "interactive" });
    expect(result.games).toHaveLength(10);
    expect(result.next).toBe("10");
    expect(result.newGameIds).toEqual([]);
    expect(store.getUser("new-uid")?.nickname).toBe("홉빵맨");
    expect(store.getUser("new-uid")?.autoRefresh).toBe(false);
    expect(store.getCollectionState("new-uid", "latest")?.boundaryGameId).toBe(20);
    expect(store.getCollectionState("new-uid", "backfill")).toMatchObject({ status: "idle", cursor: "10" });
    store.close();
  });

  it("이미 저장된 경기만 다시 확인하면 새 경기 수는 0이다", async () => {
    const { store } = await createStore();
    seedBoundary(store, 100);
    const collector = new EternalReturnCollector({
      apiKey: "key", store, loadPage: vi.fn().mockResolvedValue(response([100])),
    });
    const result = await collector.refreshUser("uid");
    expect(result.storedGames).toBe(0);
    expect(result.newGameIds).toEqual([]);
    expect(store.getCollectionState("uid", "latest")?.lastSuccessAt).toBeInstanceOf(Date);
    store.close();
  });

  it("같은 닉네임의 동시 직접 검색은 UID와 페이지 요청을 공유한다", async () => {
    const { store } = await createStore();
    const resolveUserId = vi.fn(async () => {
      await Promise.resolve();
      return "uid";
    });
    const loadPage = vi.fn().mockResolvedValue(response([10]));
    const collector = new EternalReturnCollector({ apiKey: "key", store, resolveUserId, loadPage });

    const [first, second] = await Promise.all([
      collector.refreshNickname("홉빵맨"), collector.refreshNickname(" 홉빵맨 "),
    ]);
    expect(first).toBe(second);
    expect(resolveUserId).toHaveBeenCalledTimes(1);
    expect(loadPage).toHaveBeenCalledTimes(1);
    store.close();
  });

  it("수동 검색과 자동 갱신이 같은 UID이면 페이지 요청을 공유한다", async () => {
    const { store } = await createStore();
    store.upsertUser("uid", "홉빵맨");
    let finish!: (value: EternalReturnResponse) => void;
    const loadPage = vi.fn(() => new Promise<EternalReturnResponse>(resolve => { finish = resolve; }));
    const collector = new EternalReturnCollector({
      apiKey: "key", store, resolveUserId: vi.fn().mockResolvedValue("uid"), loadPage,
    });

    const manual = collector.refreshNickname("홉빵맨");
    await Promise.resolve();
    const automatic = collector.refreshUser("uid", "refresh");
    finish(response([10]));
    await Promise.all([manual, automatic]);
    expect(loadPage).toHaveBeenCalledTimes(1);
    store.close();
  });

  it("중간 실패 시 저장한 페이지는 유지하고 완료 경계는 옮기지 않은 뒤 재개한다", async () => {
    const { store, path } = await createStore();
    seedBoundary(store, 100);
    store.setReceiptSettings("uid", true, "channel");
    const failedLoader = vi.fn()
      .mockResolvedValueOnce(response(range(110, 101), "100"))
      .mockRejectedValueOnce(new Error("temporary"));
    const first = new EternalReturnCollector({ apiKey: "key", store, loadPage: failedLoader });

    await expect(first.refreshUser("uid")).rejects.toThrow("temporary");
    expect(store.countGames("uid")).toBe(11);
    expect(store.getCollectionState("uid", "latest")).toMatchObject({
      status: "failed", boundaryGameId: 100, lastError: "temporary",
    });
    store.close();

    const reopened = await EternalReturnStore.open(path);
    expect(reopened.listUnqueuedReceiptGames("uid", "channel").map(game => game.gameId))
      .toEqual(range(110, 101).reverse());

    const resumedLoader = pagesLoader([range(110, 101), [100, 99]]);
    const resumed = new EternalReturnCollector({ apiKey: "key", store: reopened, loadPage: resumedLoader });
    const result = await resumed.refreshUser("uid");
    expect(result.newGameIds).toEqual(range(110, 101));
    expect(reopened.countGames("uid")).toBe(12);
    expect(reopened.getCollectionState("uid", "latest")).toMatchObject({
      status: "succeeded", boundaryGameId: 110,
    });
    reopened.close();
  });

  it("반복된 next를 실패로 기록하고 완료 경계를 유지한다", async () => {
    const { store } = await createStore();
    seedBoundary(store, 100);
    const loadPage = vi.fn().mockResolvedValue(response(range(110, 101), "same"));
    const collector = new EternalReturnCollector({ apiKey: "key", store, loadPage });
    await expect(collector.refreshUser("uid")).rejects.toThrow(/반복/);
    expect(store.getCollectionState("uid", "latest")).toMatchObject({
      status: "failed", boundaryGameId: 100,
    });
    store.close();
  });
});

describe("EternalReturnCollector backfill", () => {
  it("모드 혼합 페이지를 실제 표본 수가 찰 때까지 이어서 수집한다", async () => {
    const { store } = await createStore();
    store.upsertUser("uid", "홉빵맨");
    store.saveGamePage("uid", [game(20, 3), game(19, 2)], {
      kind: "latest", status: "succeeded", boundaryGameId: 20,
    });
    store.updateCollectionState("uid", { kind: "backfill", status: "idle", cursor: "18" });
    const loadPage = vi.fn()
      .mockResolvedValueOnce({ code: 200, userGames: [game(18, 2), game(17, 3), game(16, 2)], next: "15" })
      .mockResolvedValueOnce({ code: 200, userGames: [game(15, 3), game(14, 3)], next: "13" });
    const collector = new EternalReturnCollector({ apiKey: "key", store, loadPage });

    const result = await collector.backfill("uid", { targetGames: 4, matchingMode: 3 });

    expect(loadPage).toHaveBeenCalledTimes(2);
    expect(result.games).toHaveLength(4);
    expect(result.newGameIds).toEqual([]);
    expect(result.next).toBe("13");
    expect(store.getCollectionState("uid", "backfill")).toMatchObject({ status: "succeeded", cursor: "13" });
    store.close();
  });

  it("빈 페이지에서는 제공 범위 끝으로 표시하고 커서를 지운다", async () => {
    const { store } = await createStore();
    store.upsertUser("uid", "홉빵맨");
    store.updateCollectionState("uid", { kind: "backfill", status: "idle", cursor: "10" });
    const loadPage = vi.fn().mockResolvedValue({ code: 200, userGames: [], next: "unexpected" });
    const collector = new EternalReturnCollector({ apiKey: "key", store, loadPage });

    const result = await collector.backfill("uid", { targetGames: 100 });

    expect(result.exhausted).toBe(true);
    expect(result.next).toBeUndefined();
    expect(store.getCollectionState("uid", "backfill")).toMatchObject({ status: "succeeded" });
    expect(store.getCollectionState("uid", "backfill")?.cursor).toBeUndefined();
    store.close();
  });

  it("실패한 페이지의 커서를 보존하고 다음 실행에서 그 페이지부터 재개한다", async () => {
    const { store } = await createStore();
    store.upsertUser("uid", "홉빵맨");
    store.updateCollectionState("uid", { kind: "backfill", status: "idle", cursor: "20" });
    const failed = new EternalReturnCollector({
      apiKey: "key", store, loadPage: vi.fn().mockRejectedValue(new Error("network")),
    });
    await expect(failed.backfill("uid", { targetGames: 1 })).rejects.toThrow("network");
    expect(store.getCollectionState("uid", "backfill")).toMatchObject({ status: "failed", cursor: "20" });

    const loadPage = vi.fn().mockResolvedValue(response([20], "19"));
    const resumed = new EternalReturnCollector({ apiKey: "key", store, loadPage });
    await resumed.backfill("uid", { targetGames: 1 });
    expect(loadPage.mock.calls[0]?.[2]).toMatchObject({ next: "20", priority: "backfill" });
    expect(store.countGames("uid")).toBe(1);
    store.close();
  });
});

async function createStore(): Promise<{ store: EternalReturnStore; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "freedom-bot-er-collector-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "test.sqlite");
  return { store: await EternalReturnStore.open(path), path };
}

function seedBoundary(store: EternalReturnStore, gameId: number): void {
  store.upsertUser("uid", "홉빵맨");
  store.saveGamePage("uid", [game(gameId)], {
    kind: "latest", status: "succeeded", boundaryGameId: gameId,
  });
}

function pagesLoader(pages: number[][]) {
  let index = 0;
  return vi.fn(async () => {
    const ids = pages[index++] ?? [];
    return response(ids, index < pages.length ? `cursor-${index}` : undefined);
  });
}

function response(ids: number[], next?: string): EternalReturnResponse {
  return { code: 200, userGames: ids.map(id => game(id)), ...(next ? { next } : {}) };
}

function game(gameId: number, matchingMode = 3): EternalReturnGame {
  return { gameId, seasonId: 18, matchingMode, characterNum: 1, startDtm: new Date(gameId * 1_000).toISOString() };
}

function range(from: number, to: number): number[] {
  return Array.from({ length: from - to + 1 }, (_, index) => from - index);
}
