import { EmbedBuilder } from "discord.js";
import { MATCHING_MODE, TEAM_MODE } from "../sources/eternal-return.js";
import type { EternalReturnGame, EternalReturnRank } from "../sources/eternal-return.js";
import type { EternalReturnReferences } from "../sources/eternal-return-reference.js";
import type { CurrentSeasonProfile } from "../services/eternal-return-profile.js";
import type {
  AnalysisMetricName,
  AnalysisSegment,
  EternalReturnPerformanceAnalysis,
} from "../services/eternal-return-analysis.js";

const matchingModeLabels: Record<number, string> = {
  [MATCHING_MODE.normal]: "일반",
  [MATCHING_MODE.rank]: "랭크",
};

const teamModeLabels: Record<number, string> = {
  [TEAM_MODE.solo]: "Solo",
  [TEAM_MODE.duo]: "Duo",
  [TEAM_MODE.squad]: "Squad",
};

const equipmentSlots: [string, string][] = [
  ["0", "무기"],
  ["1", "옷"],
  ["2", "머리"],
  ["3", "팔"],
  ["4", "다리"],
];

export function formatNumber(value: unknown) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }

  return Number(value).toLocaleString("ko-KR");
}
function formatDuration(seconds: unknown) {
  const totalSeconds = Number(seconds);

  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return "-";
  }

  const minutes = Math.floor(totalSeconds / 60);
  const remainSeconds = Math.floor(totalSeconds % 60);
  return `${minutes}분 ${remainSeconds}초`;
}

function formatDateTime(value: string | undefined) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatEquipment(equipment: EternalReturnGame["equipment"], references: EternalReturnReferences) {
  return equipmentSlots
    .map(([slot, label]) => {
      const code = equipment?.[slot];
      return `${label} ${code ? references.itemName(code) : "-"}`;
    })
    .join(" / ");
}

function formatTraits(game: EternalReturnGame, references: EternalReturnReferences) {
  const traitCodes = [
    game.traitFirstCore,
    ...(Array.isArray(game.traitFirstSub) ? game.traitFirstSub : []),
    ...(Array.isArray(game.traitSecondSub) ? game.traitSecondSub : []),
  ].filter(Boolean);

  if (traitCodes.length === 0) {
    return "-";
  }

  return traitCodes.map((code) => references.traitName(code)).join(" / ");
}

function buildGameSummary(game: EternalReturnGame, index: number, references: EternalReturnReferences) {
  const mode = matchingModeLabels[game.matchingMode ?? -1] || `모드 ${game.matchingMode ?? "-"}`;
  const rank = game.gameRank ? `#${game.gameRank}` : "등수 -";
  const character = references.characterName(game.characterNum);

  return {
    name: limit(`${index + 1}. ${rank} · ${mode} · ${character} · ${formatDateTime(game.startDtm)}`, 256),
    value: limit([
      `K/D/A ${formatNumber(game.playerKill)}/${formatNumber(game.playerDeaths)}/${formatNumber(game.playerAssistant)} · 팀킬 ${formatNumber(game.teamKill)}`,
      `가한 ${formatNumber(game.damageToPlayer)} · 받은 ${formatNumber(game.damageFromPlayer)} · 야생동물 ${formatNumber(game.damageToMonster)}`,
    ].join("\n"), 1024),
    inline: false,
  };
}

export function buildRecentGamesEmbed(
  nickname: string,
  games: EternalReturnGame[],
  references: EternalReturnReferences,
  options: { page?: number; pageSize?: number; total?: number; tier?: string; footer?: string } = {},
) {
  const limitedGames = games.slice(0, 5);
  const page = options.page ?? 0;
  const embed = new EmbedBuilder()
    .setTitle(`${nickname} 최근 전적`)
    .setColor(0x2f80ed)
    .setTimestamp(new Date());

  if (limitedGames.length === 0) {
    return embed.setDescription("이 조건에서 표시할 경기 정보가 없습니다.");
  }

  embed.setDescription([
    options.tier ? `현재 티어 **${options.tier}**` : undefined,
    `${page + 1}페이지 · ${options.total ?? limitedGames.length}경기 수집됨`,
  ].filter(Boolean).join("\n"));
  embed.addFields(limitedGames.map((game, index) => buildGameSummary(game, page * (options.pageSize ?? 5) + index, references)));
  if (options.footer) embed.setFooter({ text: options.footer });
  return embed;
}

export function buildGameDetailEmbed(
  nickname: string,
  game: EternalReturnGame,
  references: EternalReturnReferences,
  footer?: string,
) {
  const mode = matchingModeLabels[game.matchingMode ?? -1] || `알 수 없는 모드 ${game.matchingMode ?? "-"}`;
  const teamMode = teamModeLabels[game.matchingTeamMode ?? -1] || `팀 ${game.matchingTeamMode ?? "-"}`;
  const embed = new EmbedBuilder()
    .setTitle(`${nickname} 경기 상세 · #${game.gameRank ?? "-"}`)
    .setDescription(limit(`${mode}/${teamMode} · ${references.characterName(game.characterNum)} · ${formatDateTime(game.startDtm)}`, 4096))
    .addFields(
      { name: "전투", value: `K/D/A ${formatNumber(game.playerKill)}/${formatNumber(game.playerDeaths)}/${formatNumber(game.playerAssistant)} · 팀킬 ${formatNumber(game.teamKill)}` },
      { name: "피해", value: `가한 ${formatNumber(game.damageToPlayer)} · 받은 ${formatNumber(game.damageFromPlayer)} · 야생동물 ${formatNumber(game.damageToMonster)}` },
      { name: "장비", value: limit(formatEquipment(game.equipment, references), 1024) },
      { name: "특성", value: limit(formatTraits(game, references), 1024) },
      { name: "동선", value: limit(`시작 ${references.areaName(game.placeOfStart)} · 사망 ${references.areaName(game.placeOfDeath)} · 루트 ${game.routeIdOfStart || "-"}`, 1024) },
      { name: "경기 시간", value: formatDuration(game.playTime || game.totalTime || game.duration), inline: true },
    )
    .setColor(0x2f80ed)
    .setTimestamp(new Date());
  if (footer) embed.setFooter({ text: footer });
  return embed;
}

export function buildSeasonProfileEmbed(profile: CurrentSeasonProfile, references: EternalReturnReferences) {
  const title = profile.tier
    ? `${profile.tier.label} · ${formatNumber(profile.mmr)} RP`
    : profile.mmr !== undefined ? `${formatNumber(profile.mmr)} RP` : "랭크 기록 없음";
  const rank = profile.rank !== undefined ? ` · 전체 ${formatNumber(profile.rank)}위` : "";
  const embed = new EmbedBuilder()
    .setTitle(`${profile.nickname} 시즌 전적`)
    .setDescription(`${title}${rank}\n시즌 ${profile.seasonGames}경기 · DB 수집 ${profile.collectedGames}경기`)
    .setColor(0x27ae60)
    .setTimestamp(profile.fetchedAt);
  if (profile.preferredCharacters.length === 0) {
    embed.addFields({ name: "선호 실험체", value: "현재 시즌 랭크 기록이 없습니다." });
  } else {
    embed.addFields(profile.preferredCharacters.map((character, index) => ({
      name: limit(`${index + 1}. ${references.characterName(character.characterNum)} · 시즌 ${character.seasonGames}경기`, 256),
      value: character.averageDamage === undefined
        ? `평균 피해 데이터 없음 · 피해 표본 ${character.damageSamples}경기`
        : `평균 피해 ${formatNumber(Math.round(character.averageDamage))} · 피해 표본 ${character.damageSamples}경기`,
    })));
  }
  embed.setFooter({
    text: `${profile.partial ? "일부 경기만 수집됨 · " : ""}${profile.stale ? "갱신 실패 · 이전 캐시 사용" : profile.cached ? "캐시 사용" : "방금 갱신"}`,
  });
  return embed;
}

const metricLabels: Record<AnalysisMetricName, string> = {
  damage: "평균 피해", rank: "평균 순위", kills: "평균 킬",
  deaths: "평균 데스", assists: "평균 어시스트", teamKills: "평균 팀킬",
};

export function buildAnalysisEmbed(
  nickname: string,
  analysis: EternalReturnPerformanceAnalysis,
  references: EternalReturnReferences,
  characterNum?: number,
) {
  const selected = characterNum === undefined
    ? analysis.overall
    : analysis.byCharacter.find(entry => entry.characterNum === characterNum)?.result;
  const segment = selected ?? emptySegment();
  const lines = (Object.keys(metricLabels) as AnalysisMetricName[]).map(name => {
    const metric = segment.metrics[name];
    const change = metric.change === undefined ? "-" : `${metric.change >= 0 ? "+" : ""}${formatDecimal(metric.change)}`;
    return `${metricLabels[name]}  ${formatDecimal(metric.recent.average)} ↔ ${formatDecimal(metric.previous.average)}  (${change})`;
  });
  const scope = characterNum === undefined ? "전체" : references.characterName(characterNum);
  const mode = matchingModeLabels[analysis.matchingMode] ?? `모드 ${analysis.matchingMode}`;
  const filter = analysis.seasonId === undefined ? mode : `현재 시즌 ${mode}`;
  return new EmbedBuilder()
    .setTitle(limit(`${nickname} 전적 분석 · ${scope}`, 256))
    .setDescription(`최근 ${segment.recentGames}경기 ↔ 이전 ${segment.previousGames}경기\n\n${lines.join("\n")}`)
    .addFields(
      { name: "분석 표본", value: `${filter} ${analysis.collectedGames}/${analysis.windowSize * 2}경기${analysis.complete ? "" : " · 표본 부족"}` },
      { name: "DB 전체 수집", value: `${analysis.totalStoredGames}경기`, inline: true },
      { name: "패치", value: analysis.patches.length > 0 ? analysis.patches.join(", ").slice(0, 1024) : "정보 없음" },
    )
    .setFooter({ text: "순위와 데스는 감소할수록 좋습니다. 항목별 결측치는 평균에서 제외됩니다." })
    .setColor(0x9b51e0)
    .setTimestamp(new Date());
}

function formatDecimal(value: number | undefined): string {
  return value === undefined ? "-" : value.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
}

function emptySegment(): AnalysisSegment {
  const empty = { recent: { sampleSize: 0 }, previous: { sampleSize: 0 }, lowerIsBetter: false };
  return {
    recentGames: 0, previousGames: 0,
    metrics: {
      damage: { ...empty }, rank: { ...empty, lowerIsBetter: true }, kills: { ...empty },
      deaths: { ...empty, lowerIsBetter: true }, assists: { ...empty }, teamKills: { ...empty },
    },
  };
}

function limit(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, Math.max(0, maximum - 1))}…`;
}

export function buildRankEmbed(nickname: string, userRank: EternalReturnRank | undefined) {
  if (!userRank) {
    return new EmbedBuilder()
      .setTitle(`${nickname} 랭크`)
      .setDescription("랭크 정보를 찾지 못했습니다.")
      .setColor(0xf2994a)
      .setTimestamp(new Date());
  }

  return new EmbedBuilder()
    .setTitle(`${userRank.nickname || nickname} 랭크`)
    .addFields(
      { name: "MMR", value: formatNumber(userRank.mmr), inline: true },
      { name: "통합 랭킹", value: formatNumber(userRank.rank), inline: true },
      { name: "서버 랭킹", value: formatNumber(userRank.serverRank), inline: true },
      { name: "서버 코드", value: String(userRank.serverCode ?? "-"), inline: true }
    )
    .setColor(0x27ae60)
    .setTimestamp(new Date());
}

export function buildFreeCharactersEmbed(modeLabel: string, characterCodes: number[], references: EternalReturnReferences) {
  const description =
    characterCodes.length > 0
      ? [...new Set(characterCodes.map((code) => references.characterName(code)))].join(", ")
      : "무료 캐릭터 정보를 찾지 못했습니다.";

  return new EmbedBuilder()
    .setTitle(`${modeLabel} 무료 캐릭터`)
    .setDescription(limit(description, 4096))
    .setColor(0x9b51e0)
    .setTimestamp(new Date());
}
