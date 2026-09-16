import { MATCHING_MODE } from "../sources/eternal-return.js";
import type { StoredEternalReturnGame, EternalReturnStore } from "../storage/eternal-return-store.js";

export type AnalysisMetricName = "damage" | "rank" | "kills" | "deaths" | "assists" | "teamKills";

export interface AnalysisAverage {
  average?: number;
  sampleSize: number;
}

export interface AnalysisMetric {
  recent: AnalysisAverage;
  previous: AnalysisAverage;
  change?: number;
  lowerIsBetter: boolean;
}

export interface AnalysisSegment {
  recentGames: number;
  previousGames: number;
  metrics: Record<AnalysisMetricName, AnalysisMetric>;
}

export interface EternalReturnPerformanceAnalysis {
  userId: string;
  seasonId?: number;
  matchingMode: number;
  windowSize: number;
  collectedGames: number;
  complete: boolean;
  patches: string[];
  overall: AnalysisSegment;
  byCharacter: Array<{ characterNum: number; result: AnalysisSegment }>;
}

const METRICS: ReadonlyArray<{
  name: AnalysisMetricName;
  field: keyof StoredEternalReturnGame;
  lowerIsBetter: boolean;
}> = [
  { name: "damage", field: "damageToPlayer", lowerIsBetter: false },
  { name: "rank", field: "gameRank", lowerIsBetter: true },
  { name: "kills", field: "playerKill", lowerIsBetter: false },
  { name: "deaths", field: "playerDeaths", lowerIsBetter: true },
  { name: "assists", field: "playerAssistant", lowerIsBetter: false },
  { name: "teamKills", field: "teamKill", lowerIsBetter: false },
];

export function analyzeEternalReturnPerformance(
  store: Pick<EternalReturnStore, "listGames">,
  userId: string,
  options: { seasonId?: number; matchingMode?: number; windowSize?: number } = {},
): EternalReturnPerformanceAnalysis {
  const windowSize = clampWindow(options.windowSize);
  const matchingMode = options.matchingMode ?? MATCHING_MODE.rank;
  const games = store.listGames(userId, {
    matchingMode,
    ...(options.seasonId !== undefined ? { seasonId: options.seasonId } : {}),
    limit: windowSize * 2,
  });
  const recent = games.slice(0, windowSize);
  const previous = games.slice(windowSize, windowSize * 2);
  const codes = new Set<number>();
  for (const game of games) {
    if (Number.isSafeInteger(game.characterNum)) codes.add(game.characterNum!);
  }
  const byCharacter = [...codes]
    .map(characterNum => ({
      characterNum,
      result: segment(
        recent.filter(game => game.characterNum === characterNum),
        previous.filter(game => game.characterNum === characterNum),
      ),
    }))
    .sort((a, b) =>
      (b.result.recentGames + b.result.previousGames) - (a.result.recentGames + a.result.previousGames)
      || a.characterNum - b.characterNum);
  return {
    userId,
    ...(options.seasonId !== undefined ? { seasonId: options.seasonId } : {}),
    matchingMode,
    windowSize,
    collectedGames: games.length,
    complete: recent.length === windowSize && previous.length === windowSize,
    patches: [...new Set(games.map(game => game.gameVersion).filter((value): value is string => Boolean(value)))],
    overall: segment(recent, previous),
    byCharacter,
  };
}

function segment(
  recent: readonly StoredEternalReturnGame[],
  previous: readonly StoredEternalReturnGame[],
): AnalysisSegment {
  const metrics = {} as Record<AnalysisMetricName, AnalysisMetric>;
  for (const definition of METRICS) {
    const recentAverage = average(recent, definition.field);
    const previousAverage = average(previous, definition.field);
    metrics[definition.name] = {
      recent: recentAverage,
      previous: previousAverage,
      ...(recentAverage.average !== undefined && previousAverage.average !== undefined
        ? { change: recentAverage.average - previousAverage.average }
        : {}),
      lowerIsBetter: definition.lowerIsBetter,
    };
  }
  return { recentGames: recent.length, previousGames: previous.length, metrics };
}

function average(games: readonly StoredEternalReturnGame[], field: keyof StoredEternalReturnGame): AnalysisAverage {
  const values = games
    .map(game => game[field])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return {
    ...(values.length > 0 ? { average: values.reduce((sum, value) => sum + value, 0) / values.length } : {}),
    sampleSize: values.length,
  };
}

function clampWindow(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(250, Math.trunc(value)));
}
