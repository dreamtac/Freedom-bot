import {
  getRankByUserId,
  getUserStatsByUserId,
  MATCHING_MODE,
  type EternalReturnRank,
  type EternalReturnRequestOptions,
  type EternalReturnUserStats,
} from "../sources/eternal-return.js";
import {
  findCurrentSeason,
  getSeasonData,
  type EternalReturnSeason,
} from "../sources/eternal-return-reference.js";
import type { EternalReturnRequestPriority } from "../sources/eternal-return-request-queue.js";
import type { EternalReturnSeasonProfile, EternalReturnStore } from "../storage/eternal-return-store.js";

const PROFILE_TTL_MS = 5 * 60 * 1000;
export const CURRENT_TIER_RULE_SEASON_ID = 41;
export const CURRENT_TIER_SOURCE = "https://support.playeternalreturn.com/hc/en-us/articles/21812479709081-Rank-System-Tiers";

export interface EternalReturnTier {
  label: string;
  minimumMmr: number;
  verified: boolean;
  source: string;
}

export interface PreferredCharacterProfile {
  characterNum: number;
  seasonGames: number;
  averageDamage?: number;
  damageSamples: number;
  collectedGames: number;
}

export interface CurrentSeasonProfile {
  userId: string;
  nickname: string;
  seasonId: number;
  seasonName: string;
  matchingMode: number;
  mmr?: number;
  rank?: number;
  serverRank?: number;
  tier?: EternalReturnTier;
  seasonGames: number;
  collectedGames: number;
  partial: boolean;
  preferredCharacters: PreferredCharacterProfile[];
  fetchedAt: Date;
  expiresAt?: Date;
  cached: boolean;
}

interface EternalReturnProfileServiceOptions {
  apiKey: string;
  store: EternalReturnStore;
  now?: () => Date;
  loadSeasons?: (
    apiKey: string, options: EternalReturnRequestOptions, store: EternalReturnStore,
  ) => Promise<EternalReturnSeason[]>;
  loadStats?: typeof getUserStatsByUserId;
  loadRank?: typeof getRankByUserId;
}

export class EternalReturnProfileService {
  readonly #apiKey: string;
  readonly #store: EternalReturnStore;
  readonly #now: () => Date;
  readonly #loadSeasons: NonNullable<EternalReturnProfileServiceOptions["loadSeasons"]>;
  readonly #loadStats: typeof getUserStatsByUserId;
  readonly #loadRank: typeof getRankByUserId;
  readonly #refreshes = new Map<string, Promise<CurrentSeasonProfile>>();

  constructor(options: EternalReturnProfileServiceOptions) {
    this.#apiKey = options.apiKey;
    this.#store = options.store;
    this.#now = options.now ?? (() => new Date());
    this.#loadSeasons = options.loadSeasons ?? getSeasonData;
    this.#loadStats = options.loadStats ?? getUserStatsByUserId;
    this.#loadRank = options.loadRank ?? getRankByUserId;
  }

  async getCurrentSeason(priority: EternalReturnRequestPriority = "refresh"): Promise<EternalReturnSeason> {
    const current = findCurrentSeason(await this.#loadSeasons(this.#apiKey, { priority }, this.#store));
    if (!current) throw new Error("이터널 리턴 현재 시즌을 공식 Season 데이터에서 찾지 못했습니다.");
    return current;
  }

  async getCurrentSeasonProfile(
    userId: string,
    options: { force?: boolean; priority?: EternalReturnRequestPriority; matchingMode?: number } = {},
  ): Promise<CurrentSeasonProfile> {
    const season = await this.getCurrentSeason(options.priority);
    const seasonId = Number(season.seasonID);
    const matchingMode = options.matchingMode ?? MATCHING_MODE.rank;
    const key = `${userId}:${seasonId}:${matchingMode}`;
    const cached = this.#store.getSeasonProfile<EternalReturnUserStats, EternalReturnRank>(userId, seasonId, matchingMode);
    if (!options.force && cached?.expiresAt && cached.expiresAt.getTime() > this.#now().getTime()) {
      return this.#toProfile(userId, season, cached, true);
    }
    const existing = this.#refreshes.get(key);
    if (existing) return existing;
    const request = this.#refresh(userId, season, matchingMode, options.priority ?? "interactive")
      .finally(() => this.#refreshes.delete(key));
    this.#refreshes.set(key, request);
    return request;
  }

  async #refresh(
    userId: string,
    season: EternalReturnSeason,
    matchingMode: number,
    priority: EternalReturnRequestPriority,
  ): Promise<CurrentSeasonProfile> {
    const seasonId = Number(season.seasonID);
    const [statsResponse, rankResponse] = await Promise.all([
      this.#loadStats(userId, seasonId, matchingMode, this.#apiKey, { priority }),
      this.#loadRank(userId, seasonId, this.#apiKey, { priority }),
    ]);
    const stats = Array.isArray(statsResponse.userStats)
      ? statsResponse.userStats[0] ?? {}
      : statsResponse.userStats ?? {};
    const rank = rankResponse.userRank ?? {};
    const fetchedAt = this.#now();
    const mmr = finite(stats.mmr ?? rank.mmr);
    const rankPosition = integer(stats.rank ?? rank.rank);
    const serverRank = integer(rank.serverRank);
    const stored: EternalReturnSeasonProfile<EternalReturnUserStats, EternalReturnRank> = {
      userId, seasonId, matchingMode,
      ...(mmr !== undefined ? { mmr } : {}),
      ...(rankPosition !== undefined ? { rank: rankPosition } : {}),
      ...(serverRank !== undefined ? { serverRank } : {}),
      stats, rankData: rank, fetchedAt,
      expiresAt: new Date(fetchedAt.getTime() + PROFILE_TTL_MS),
    };
    this.#store.putSeasonProfile(stored);
    return this.#toProfile(userId, season, stored, false);
  }

  #toProfile(
    userId: string,
    season: EternalReturnSeason,
    stored: EternalReturnSeasonProfile<EternalReturnUserStats, EternalReturnRank>,
    cached: boolean,
  ): CurrentSeasonProfile {
    const user = this.#store.getUser(userId);
    if (!user) throw new Error(`알 수 없는 이터널 리턴 UID입니다: ${userId}`);
    const summaries = this.#store.getCharacterSummaries(userId, {
      seasonId: stored.seasonId, matchingMode: stored.matchingMode,
    });
    const summaryByCharacter = new Map(summaries.map(summary => [summary.characterNum, summary]));
    const official = new Map<number, number>();
    for (const stat of stored.stats?.characterStats ?? []) {
      const characterNum = integer(stat.characterCode ?? stat.characterNum);
      const games = integer(stat.totalGames ?? stat.usages);
      if (characterNum !== undefined && games !== undefined) official.set(characterNum, games);
    }
    const orderedCodes = [...official]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .map(([code]) => code);
    for (const summary of summaries) {
      if (!official.has(summary.characterNum)) orderedCodes.push(summary.characterNum);
    }
    const preferredCharacters = orderedCodes.slice(0, 5).map(characterNum => {
      const summary = summaryByCharacter.get(characterNum);
      return {
        characterNum,
        seasonGames: official.get(characterNum) ?? summary?.games ?? 0,
        ...(summary?.averageDamage !== undefined ? { averageDamage: summary.averageDamage } : {}),
        damageSamples: summary?.damageSamples ?? 0,
        collectedGames: summary?.games ?? 0,
      };
    });
    const seasonGames = integer(stored.stats?.totalGames) ?? 0;
    const collectedGames = this.#store.countGames(userId, {
      seasonId: stored.seasonId, matchingMode: stored.matchingMode,
    });
    const mmr = finite(stored.mmr);
    const rank = integer(stored.rank);
    const tier = mmr === undefined ? undefined : currentTier(stored.seasonId, mmr, rank);
    return {
      userId, nickname: stored.stats?.nickname?.trim() || user.nickname,
      seasonId: stored.seasonId,
      seasonName: season.seasonName ?? `Season ${stored.seasonId}`,
      matchingMode: stored.matchingMode,
      ...(mmr !== undefined ? { mmr } : {}),
      ...(rank !== undefined ? { rank } : {}),
      ...(stored.serverRank !== undefined ? { serverRank: stored.serverRank } : {}),
      ...(tier ? { tier } : {}),
      seasonGames, collectedGames,
      partial: collectedGames < seasonGames,
      preferredCharacters,
      fetchedAt: stored.fetchedAt,
      ...(stored.expiresAt ? { expiresAt: stored.expiresAt } : {}),
      cached,
    };
  }
}

const TIER_STEPS: ReadonlyArray<[number, string]> = [
  [7600, "미스릴"], [7300, "메테오라이트 1"], [7000, "메테오라이트 2"], [6700, "메테오라이트 3"], [6400, "메테오라이트 4"],
  [6050, "다이아몬드 1"], [5700, "다이아몬드 2"], [5350, "다이아몬드 3"], [5000, "다이아몬드 4"],
  [4650, "플래티넘 1"], [4300, "플래티넘 2"], [3950, "플래티넘 3"], [3600, "플래티넘 4"],
  [3300, "골드 1"], [3000, "골드 2"], [2700, "골드 3"], [2400, "골드 4"],
  [2150, "실버 1"], [1900, "실버 2"], [1650, "실버 3"], [1400, "실버 4"],
  [1200, "브론즈 1"], [1000, "브론즈 2"], [800, "브론즈 3"], [600, "브론즈 4"],
  [450, "아이언 1"], [300, "아이언 2"], [150, "아이언 3"], [0, "아이언 4"],
];

export function currentTier(seasonId: number, mmr: number, rank?: number): EternalReturnTier | undefined {
  if (seasonId !== CURRENT_TIER_RULE_SEASON_ID || !Number.isFinite(mmr)) return undefined;
  let label = TIER_STEPS.find(([minimum]) => mmr >= minimum)?.[1] ?? "아이언 4";
  if (mmr >= 7600 && rank !== undefined) {
    if (rank <= 300) label = "이모탈";
    else if (rank <= 1000) label = "타이탄";
  }
  const minimumMmr = TIER_STEPS.find(([, candidate]) => candidate === label)?.[0] ?? 7600;
  return { label, minimumMmr, verified: true, source: CURRENT_TIER_SOURCE };
}

function finite(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function integer(value: unknown): number | undefined {
  const number = finite(value);
  return number !== undefined && Number.isSafeInteger(number) ? number : undefined;
}
