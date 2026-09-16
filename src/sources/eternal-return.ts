import {
  EternalReturnRequestQueueStoppedError,
  getEternalReturnRequestQueue,
  type EternalReturnRequestPriority,
} from "./eternal-return-request-queue.js";

const API_BASE = "https://open-api.bser.io";
const REQUEST_TIMEOUT_MS = 10_000;

export const MATCHING_MODE = { normal: 2, rank: 3 } as const;
export const TEAM_MODE = { solo: 1, duo: 2, squad: 3 } as const;

export interface EternalReturnUser {
  nickname: string;
  uid?: string;
  userId?: string;
}

export interface EternalReturnGame {
  gameId?: number;
  seasonId?: number;
  versionSeason?: number;
  versionMajor?: number;
  versionMinor?: number;
  gameVersion?: string;
  matchingMode?: number;
  matchingTeamMode?: number;
  characterNum?: number;
  characterLevel?: number;
  gameRank?: number;
  playerKill?: number;
  playerAssistant?: number;
  playerDeaths?: number;
  teamKill?: number;
  mmrGain?: number;
  mmrBefore?: number;
  mmrAfter?: number;
  damageToPlayer?: number;
  damageFromPlayer?: number;
  damageToMonster?: number;
  healAmount?: number;
  teamRecover?: number;
  protectAbsorb?: number;
  ccTimeToPlayer?: number;
  monsterKill?: number;
  killMonsters?: Record<string, number> | number[];
  routeIdOfStart?: number;
  playTime?: number;
  totalTime?: number;
  duration?: number;
  placeOfStart?: number | string;
  placeOfDeath?: number | string;
  startDtm?: string;
  equipment?: Record<string, number> | null;
  traitFirstCore?: number;
  traitFirstSub?: number[];
  traitSecondSub?: number[];
  victory?: number;
  escapeState?: number;
  viewContribution?: number;
  addSurveillanceCamera?: number;
  removeSurveillanceCamera?: number;
  tacticalSkillGroup?: number;
  tacticalSkillLevel?: number;
  tacticalSkillUseCount?: number;
  teamNumber?: number;
  preMade?: number;
  premadeMatchingType?: number;
  botAdded?: number;
  bestWeapon?: number;
}

export interface EternalReturnRank {
  nickname?: string;
  mmr?: number;
  rank?: number;
  serverRank?: number;
  serverCode?: number;
}

export interface EternalReturnCharacterStat {
  characterCode?: number;
  characterNum?: number;
  totalGames?: number;
  usages?: number;
  wins?: number;
  top3?: number;
  [key: string]: unknown;
}

export interface EternalReturnUserStats {
  nickname?: string;
  mmr?: number;
  rank?: number;
  rankSize?: number;
  totalGames?: number;
  totalWins?: number;
  characterStats?: EternalReturnCharacterStat[];
  [key: string]: unknown;
}

export interface ReferenceRow {
  code?: number | string;
  maskCode?: number | string;
  name?: string;
}

export interface EternalReturnResponse {
  code: number;
  message?: string;
  user?: EternalReturnUser;
  userGames?: EternalReturnGame[];
  gameResults?: EternalReturnGame[];
  games?: EternalReturnGame[];
  userRank?: EternalReturnRank;
  userStats?: EternalReturnUserStats | EternalReturnUserStats[];
  freeCharacters?: number[];
  data?: ReferenceRow[] | { l10Path?: string };
  next?: number | string;
}

export class EternalReturnApiError extends Error {}

function retryDelay(value: string | null, attempt: number): number {
  if (value?.trim()) {
    const seconds = Number(value);
    const delay = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(value) - Date.now();
    if (Number.isFinite(delay) && delay >= 0) return Math.min(delay, 30_000);
  }
  return attempt * 1000;
}

export interface EternalReturnRequestOptions {
  priority?: EternalReturnRequestPriority;
}

export async function erGet(
  path: string,
  apiKey: string,
  options: EternalReturnRequestOptions = {},
): Promise<EternalReturnResponse> {
  const queue = getEternalReturnRequestQueue();
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    let response: Response;
    try {
      response = await queue.schedule(async signal => fetch(`${API_BASE}${path}`, {
        headers: { accept: "application/json", "x-api-key": apiKey },
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      }), options.priority);
    } catch (error: unknown) {
      if (error instanceof EternalReturnRequestQueueStoppedError) throw error;
      throw new EternalReturnApiError("이터널 리턴 API에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }

    const body: unknown = await response.json().catch(() => null);
    const retryAfter = response.headers.get("retry-after");
    const rateLimited = response.status === 429 || (response.status === 403 && retryAfter !== null);
    if (rateLimited) {
      queue.pauseFor(retryDelay(retryAfter, attempt));
      if (attempt < 4) continue;
    }
    if (response.status === 401 || response.status === 403) {
      throw new EternalReturnApiError("이터널 리턴 API 접근이 거부되었습니다. API 키 상태 또는 호출 제한을 확인해 주세요.");
    }
    if (rateLimited) {
      throw new EternalReturnApiError("이터널 리턴 API 요청이 많습니다. 잠시 후 다시 시도해 주세요.");
    }
    if (response.status === 404) return { code: 404 };
    if (!response.ok) {
      throw new EternalReturnApiError(`이터널 리턴 API 요청에 실패했습니다. (HTTP ${response.status})`);
    }
    if (!body || typeof body !== "object" || !("code" in body) || typeof body.code !== "number") {
      throw new EternalReturnApiError("이터널 리턴 API 응답 형식을 확인할 수 없습니다.");
    }
    if (body.code !== 200 && body.code !== 404) {
      throw new EternalReturnApiError(`이터널 리턴 API 오류가 발생했습니다. (코드 ${body.code})`);
    }
    return body as EternalReturnResponse;
  }
  throw new EternalReturnApiError("이터널 리턴 API 요청에 실패했습니다.");
}

export async function getUserIdByNickname(
  nickname: string,
  apiKey: string,
  options: EternalReturnRequestOptions = {},
): Promise<string> {
  const data = await erGet(
    `/v1/user/nickname?query=${encodeURIComponent(nickname.trim())}`,
    apiKey,
    options,
  );
  // The live API uses userId; the current documentation also shows uid.
  const userId = data.user?.uid || data.user?.userId;
  if (!userId) {
    throw new EternalReturnApiError("해당 닉네임의 사용자를 찾지 못했습니다. 현재 게임 닉네임을 확인해 주세요.");
  }
  return userId;
}

export async function getRecentGamesByNickname(
  nickname: string,
  apiKey: string,
  options: EternalReturnRequestOptions = {},
): Promise<EternalReturnResponse> {
  const normalizedNickname = nickname.trim();
  const requestKey = `${apiKey}\0${normalizedNickname}`;
  const existing = recentGameRequests.get(requestKey);
  if (existing) return existing;
  const request = (async () => {
    const userId = await getUserIdByNickname(normalizedNickname, apiKey, options);
    return erGet(`/v1/user/games/uid/${encodeURIComponent(userId)}`, apiKey, options);
  })().finally(() => recentGameRequests.delete(requestKey));
  recentGameRequests.set(requestKey, request);
  return request;
}

export async function getGamesByUserId(
  userId: string,
  apiKey: string,
  options: EternalReturnRequestOptions & { next?: number | string } = {},
): Promise<EternalReturnResponse> {
  const next = options.next === undefined ? "" : `?next=${encodeURIComponent(String(options.next))}`;
  return erGet(
    `/v1/user/games/uid/${encodeURIComponent(userId)}${next}`,
    apiKey,
    options,
  );
}

const recentGameRequests = new Map<string, Promise<EternalReturnResponse>>();

export async function getRankByNickname(
  nickname: string,
  seasonId: number,
  apiKey: string,
  options: EternalReturnRequestOptions = {},
): Promise<EternalReturnResponse> {
  const userId = await getUserIdByNickname(nickname, apiKey, options);
  return getRankByUserId(userId, seasonId, apiKey, options);
}

export function getRankByUserId(
  userId: string,
  seasonId: number,
  apiKey: string,
  options: EternalReturnRequestOptions = {},
): Promise<EternalReturnResponse> {
  return erGet(`/v1/rank/uid/${encodeURIComponent(userId)}/${seasonId}/${TEAM_MODE.squad}`, apiKey, options);
}

export function getUserStatsByUserId(
  userId: string,
  seasonId: number,
  matchingMode: number,
  apiKey: string,
  options: EternalReturnRequestOptions = {},
): Promise<EternalReturnResponse> {
  return erGet(
    `/v2/user/stats/uid/${encodeURIComponent(userId)}/${seasonId}/${matchingMode}`,
    apiKey,
    options,
  );
}

export function getGameResults(data: EternalReturnResponse): EternalReturnGame[] {
  const games = data.userGames ?? data.gameResults ?? data.games ?? [];
  if (!Array.isArray(games) || games.some(game => !game || typeof game !== "object")) {
    throw new EternalReturnApiError("이터널 리턴 경기 목록의 형식을 확인할 수 없습니다.");
  }
  return games;
}

export async function getFreeCharacters(
  matchingMode: number,
  apiKey: string,
  options: EternalReturnRequestOptions = {},
): Promise<number[]> {
  const data = await erGet(`/v1/freeCharacters/${matchingMode}`, apiKey, options);
  if (data.code === 404) return [];
  if (!Array.isArray(data.freeCharacters)) {
    throw new EternalReturnApiError("이터널 리턴 무료 캐릭터 목록의 형식을 확인할 수 없습니다.");
  }
  return data.freeCharacters;
}
