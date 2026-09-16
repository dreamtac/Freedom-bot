import {
  getGameResults,
  getGamesByUserId,
  getUserIdByNickname,
  type EternalReturnGame,
  type EternalReturnRequestOptions,
  type EternalReturnResponse,
} from "../sources/eternal-return.js";
import type { EternalReturnRequestPriority } from "../sources/eternal-return-request-queue.js";
import {
  type EternalReturnGameQuery,
  type EternalReturnStore,
  type StoredEternalReturnGame,
} from "../storage/eternal-return-store.js";

export interface EternalReturnCollectionResult {
  userId: string;
  nickname: string;
  games: StoredEternalReturnGame[];
  pagesFetched: number;
  recordsSeen: number;
  storedGames: number;
  reachedBoundary: boolean;
  exhausted: boolean;
  next?: string;
}

export interface EternalReturnBackfillOptions {
  targetGames?: number;
  matchingMode?: number;
  characterNum?: number;
  seasonId?: number;
}

interface CollectorOptions {
  apiKey: string;
  store: EternalReturnStore;
  now?: () => Date;
  resolveUserId?: (
    nickname: string, apiKey: string, options: EternalReturnRequestOptions,
  ) => Promise<string>;
  loadPage?: (
    userId: string, apiKey: string,
    options: EternalReturnRequestOptions & { next?: string },
  ) => Promise<EternalReturnResponse>;
}

export class EternalReturnCollector {
  readonly #apiKey: string;
  readonly #store: EternalReturnStore;
  readonly #now: () => Date;
  readonly #resolveUserId: NonNullable<CollectorOptions["resolveUserId"]>;
  readonly #loadPage: NonNullable<CollectorOptions["loadPage"]>;
  readonly #refreshes = new Map<string, Promise<EternalReturnCollectionResult>>();
  readonly #backfills = new Map<string, Promise<EternalReturnCollectionResult>>();
  #stopped = false;

  constructor(options: CollectorOptions) {
    this.#apiKey = options.apiKey;
    this.#store = options.store;
    this.#now = options.now ?? (() => new Date());
    this.#resolveUserId = options.resolveUserId ?? getUserIdByNickname;
    this.#loadPage = options.loadPage ?? getGamesByUserId;
  }

  refreshNickname(
    nickname: string,
    priority: EternalReturnRequestPriority = "interactive",
  ): Promise<EternalReturnCollectionResult> {
    if (this.#stopped) return Promise.reject(new Error("이터널 리턴 전적 수집기가 종료되었습니다."));
    const trimmedNickname = nickname.trim();
    const key = normalizeNickname(trimmedNickname);
    const existing = this.#refreshes.get(key);
    if (existing) return existing;
    const request = this.#refreshNickname(trimmedNickname, priority)
      .finally(() => this.#refreshes.delete(key));
    this.#refreshes.set(key, request);
    return request;
  }

  refreshUser(
    userId: string,
    priority: EternalReturnRequestPriority = "refresh",
  ): Promise<EternalReturnCollectionResult> {
    if (this.#stopped) return Promise.reject(new Error("이터널 리턴 전적 수집기가 종료되었습니다."));
    const user = this.#store.getUser(userId);
    if (!user) return Promise.reject(new Error(`알 수 없는 이터널 리턴 UID입니다: ${userId}`));
    const key = `uid:${userId}`;
    const existing = this.#refreshes.get(key);
    if (existing) return existing;
    const request = this.#refreshUser(userId, user.nickname, priority)
      .finally(() => this.#refreshes.delete(key));
    this.#refreshes.set(key, request);
    return request;
  }

  backfill(
    userId: string,
    options: EternalReturnBackfillOptions = {},
  ): Promise<EternalReturnCollectionResult> {
    if (this.#stopped) return Promise.reject(new Error("이터널 리턴 전적 수집기가 종료되었습니다."));
    const filterKey = [options.matchingMode, options.characterNum, options.seasonId].join(":");
    const key = `${userId}:${filterKey}`;
    const existing = this.#backfills.get(key);
    if (existing) return existing;
    const request = this.#backfill(userId, options).finally(() => this.#backfills.delete(key));
    this.#backfills.set(key, request);
    return request;
  }

  async shutdown(): Promise<void> {
    this.#stopped = true;
    await Promise.allSettled([
      ...new Set(this.#refreshes.values()),
      ...new Set(this.#backfills.values()),
    ]);
  }

  async #refreshNickname(
    nickname: string,
    priority: EternalReturnRequestPriority,
  ): Promise<EternalReturnCollectionResult> {
    if (!nickname) throw new Error("이터널 리턴 닉네임이 필요합니다.");
    const userId = await this.#resolveUserId(nickname, this.#apiKey, { priority });
    this.#store.upsertUser(userId, nickname, this.#now());
    return this.#refreshUser(userId, nickname, priority);
  }

  async #refreshUser(
    userId: string,
    nickname: string,
    priority: EternalReturnRequestPriority,
  ): Promise<EternalReturnCollectionResult> {
    const startedAt = this.#now();
    const previous = this.#store.getCollectionState(userId, "latest");
    const boundary = previous?.boundaryGameId;
    this.#store.updateCollectionState(userId, {
      kind: "latest", status: "running", attemptedAt: startedAt, error: null,
    }, startedAt);

    let cursor: string | undefined;
    let firstNext: string | undefined;
    let newestGameId: number | undefined;
    let pagesFetched = 0;
    let recordsSeen = 0;
    let storedGames = 0;
    let reachedBoundary = false;
    let exhausted = false;
    const cursors = new Set<string>();
    const pageSignatures = new Set<string>();

    try {
      while (true) {
        if (cursor && cursors.has(cursor)) throw new Error(`반복된 경기 페이지 커서입니다: ${cursor}`);
        if (cursor) cursors.add(cursor);
        const response = await this.#loadPage(userId, this.#apiKey, {
          priority,
          ...(cursor ? { next: cursor } : {}),
        });
        pagesFetched += 1;
        const games = validGames(getGameResults(response));
        recordsSeen += games.length;
        const next = normalizeCursor(response.next);
        if (pagesFetched === 1) firstNext = next;
        if (newestGameId === undefined) newestGameId = games[0]?.gameId;

        const signature = games.map(game => game.gameId).join(",");
        if (games.length > 0 && pageSignatures.has(signature)) {
          throw new Error("같은 경기 페이지가 반복되었습니다.");
        }
        if (games.length > 0) pageSignatures.add(signature);
        reachedBoundary = boundary !== undefined && games.some(game => game.gameId === boundary);
        exhausted = games.length === 0 || next === undefined;
        storedGames += this.#store.saveGamePage(userId, games, {
          kind: "latest", status: "running", cursor: next ?? null,
        }, this.#now());

        if (boundary === undefined || reachedBoundary || exhausted) break;
        if (next === cursor) throw new Error(`반복된 경기 페이지 커서입니다: ${next}`);
        cursor = next;
      }

      const completedAt = this.#now();
      this.#store.updateCollectionState(userId, {
        kind: "latest", status: "succeeded", cursor: null,
        ...(newestGameId !== undefined ? { boundaryGameId: newestGameId } : {}),
        succeededAt: completedAt, error: null,
      }, completedAt);
      if (boundary === undefined && !this.#store.getCollectionState(userId, "backfill")) {
        this.#store.updateCollectionState(userId, {
          kind: "backfill", status: firstNext ? "idle" : "succeeded",
          cursor: firstNext ?? null, error: null,
          ...(!firstNext ? { succeededAt: completedAt } : {}),
        }, completedAt);
      }
      return this.#result(userId, nickname, {
        pagesFetched, recordsSeen, storedGames, reachedBoundary, exhausted,
        ...(firstNext ? { next: firstNext } : {}),
      });
    } catch (error: unknown) {
      const failedAt = this.#now();
      this.#store.updateCollectionState(userId, {
        kind: "latest", status: "failed", error: errorMessage(error),
      }, failedAt);
      throw error;
    }
  }

  async #backfill(
    userId: string,
    options: EternalReturnBackfillOptions,
  ): Promise<EternalReturnCollectionResult> {
    const user = this.#store.getUser(userId);
    if (!user) throw new Error(`알 수 없는 이터널 리턴 UID입니다: ${userId}`);
    const targetGames = clampTarget(options.targetGames);
    const query = gameQuery(options);
    let state = this.#store.getCollectionState(userId, "backfill");
    if (!state) {
      await this.refreshUser(userId, "backfill");
      state = this.#store.getCollectionState(userId, "backfill");
    }
    let cursor = state?.cursor;
    let pagesFetched = 0;
    let recordsSeen = 0;
    let storedGames = 0;
    let exhausted = cursor === undefined;
    const cursors = new Set<string>();
    const pageSignatures = new Set<string>();
    const startedAt = this.#now();
    this.#store.updateCollectionState(userId, {
      kind: "backfill", status: "running", attemptedAt: startedAt, error: null,
    }, startedAt);

    try {
      while (this.#store.countGames(userId, query) < targetGames && cursor) {
        if (cursors.has(cursor)) throw new Error(`반복된 경기 페이지 커서입니다: ${cursor}`);
        cursors.add(cursor);
        const response = await this.#loadPage(userId, this.#apiKey, { priority: "backfill", next: cursor });
        pagesFetched += 1;
        const games = validGames(getGameResults(response));
        recordsSeen += games.length;
        const signature = games.map(game => game.gameId).join(",");
        if (games.length > 0 && pageSignatures.has(signature)) throw new Error("같은 경기 페이지가 반복되었습니다.");
        if (games.length > 0) pageSignatures.add(signature);
        const next = normalizeCursor(response.next);
        if (next === cursor) throw new Error(`반복된 경기 페이지 커서입니다: ${next}`);
        exhausted = games.length === 0 || next === undefined;
        storedGames += this.#store.saveGamePage(userId, games, {
          kind: "backfill", status: "running", cursor: exhausted ? null : (next ?? null),
        }, this.#now());
        cursor = exhausted ? undefined : next;
        if (exhausted) break;
      }

      const completedAt = this.#now();
      this.#store.updateCollectionState(userId, {
        kind: "backfill", status: "succeeded", cursor: cursor ?? null,
        succeededAt: completedAt, error: null,
      }, completedAt);
      return this.#result(userId, user.nickname, {
        pagesFetched, recordsSeen, storedGames, reachedBoundary: false, exhausted,
        ...(cursor ? { next: cursor } : {}),
      }, query);
    } catch (error: unknown) {
      this.#store.updateCollectionState(userId, {
        kind: "backfill", status: "failed", cursor: cursor ?? null, error: errorMessage(error),
      }, this.#now());
      throw error;
    }
  }

  #result(
    userId: string,
    nickname: string,
    progress: Omit<EternalReturnCollectionResult, "userId" | "nickname" | "games">,
    query: EternalReturnGameQuery = {},
  ): EternalReturnCollectionResult {
    return {
      userId, nickname, games: this.#store.listGames(userId, { ...query, limit: 500 }),
      ...progress,
    };
  }
}

function validGames(games: readonly EternalReturnGame[]): Array<EternalReturnGame & { gameId: number }> {
  const valid: Array<EternalReturnGame & { gameId: number }> = [];
  for (const game of games) {
    const gameId = Number((game as Record<string, unknown>).gameId);
    if (Number.isSafeInteger(gameId)) valid.push({ ...game, gameId });
  }
  return valid;
}

function normalizeCursor(value: number | string | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  const cursor = String(value).trim();
  return cursor && cursor !== "0" ? cursor : undefined;
}

function normalizeNickname(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("ko-KR");
}

function clampTarget(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 100;
  return Math.max(1, Math.min(5_000, Math.trunc(value)));
}

function gameQuery(options: EternalReturnBackfillOptions): EternalReturnGameQuery {
  return {
    ...(options.matchingMode !== undefined ? { matchingMode: options.matchingMode } : {}),
    ...(options.characterNum !== undefined ? { characterNum: options.characterNum } : {}),
    ...(options.seasonId !== undefined ? { seasonId: options.seasonId } : {}),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000);
}
