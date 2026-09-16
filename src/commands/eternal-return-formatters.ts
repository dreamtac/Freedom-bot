import { EmbedBuilder } from "discord.js";
import { MATCHING_MODE, TEAM_MODE } from "../sources/eternal-return.js";
import type { EternalReturnGame, EternalReturnRank } from "../sources/eternal-return.js";
import type { EternalReturnReferences } from "../sources/eternal-return-reference.js";

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

function formatNumber(value: unknown) {
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
  const teamMode = teamModeLabels[game.matchingTeamMode ?? -1] || `팀 ${game.matchingTeamMode ?? "-"}`;
  const rank = game.gameRank ? `#${game.gameRank}` : "등수 -";
  const character = references.characterName(game.characterNum);
  const mmrGain =
    game.matchingMode === MATCHING_MODE.rank && game.mmrGain !== undefined
      ? ` / LP ${game.mmrGain >= 0 ? "+" : ""}${game.mmrGain}`
      : "";

  return {
    name: `${index + 1}. ${rank} ${mode}/${teamMode} | ${character}`,
    value: [
      `K/A/D ${formatNumber(game.playerKill)}/${formatNumber(game.playerAssistant)}/${formatNumber(game.playerDeaths)} | 팀킬 ${formatNumber(game.teamKill)}${mmrGain}`,
      `피해 ${formatNumber(game.damageToPlayer)} / 받은 피해 ${formatNumber(game.damageFromPlayer)} / 회복 ${formatNumber(game.healAmount)}`,
      `야생동물 ${formatNumber(game.monsterKill)} | 루트 ${game.routeIdOfStart || "-"} | ${formatDuration(game.playTime || game.totalTime || game.duration)}`,
      `시작 ${references.areaName(game.placeOfStart)} / 사망 ${references.areaName(game.placeOfDeath)} | ${formatDateTime(game.startDtm)}`,
      `장비: ${formatEquipment(game.equipment, references)}`,
      `특성: ${formatTraits(game, references)}`,
    ].join("\n"),
    inline: false,
  };
}

export function buildRecentGamesEmbed(nickname: string, games: EternalReturnGame[], references: EternalReturnReferences) {
  const limitedGames = games.slice(0, 5);
  const embed = new EmbedBuilder()
    .setTitle(`${nickname} 최근 전적`)
    .setColor(0x2f80ed)
    .setTimestamp(new Date());

  if (limitedGames.length === 0) {
    return embed.setDescription("최근 경기 정보를 찾지 못했습니다.");
  }

  return embed
    .setDescription(`최근 ${limitedGames.length}경기 요약입니다.`)
    .addFields(limitedGames.map((game, index) => buildGameSummary(game, index, references)));
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
    .setDescription(description)
    .setColor(0x9b51e0)
    .setTimestamp(new Date());
}
