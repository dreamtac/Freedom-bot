import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from "discord.js";

import { MATCHING_MODE, TEAM_MODE } from "../sources/eternal-return.js";
import type {
  EternalReturnReceiptPlayerView,
  EternalReturnReceiptView,
  ReceiptMetric,
} from "../services/eternal-return-receipt.js";

export type EternalReturnReceiptSection = "combat" | "contribution" | "credits" | "activity" | "build";

export function buildReceiptComponents(
  view: EternalReturnReceiptView,
  receiptId: string,
  selectedPlayerIndex = 0,
): Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>> {
  const rows: Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>> = [];
  if (view.players.length > 1) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(receiptCustomId(receiptId, "player"))
      .setPlaceholder("상세 전적을 볼 유저 선택")
      .addOptions(view.players.slice(0, 25).map((player, index) => ({
        label: `${player.nickname} · ${player.characterName}`.slice(0, 100),
        value: String(index),
        default: index === selectedPlayerIndex,
      })));
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
  }
  const sections: ReadonlyArray<[EternalReturnReceiptSection, string, string]> = [
    ["combat", "전투", "⚔️"],
    ["contribution", "팀 기여", "❤️"],
    ["credits", "크레딧", "💰"],
    ["activity", "행동", "👁️"],
    ["build", "빌드", "🛠️"],
  ];
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    sections.map(([section, label, emoji]) => new ButtonBuilder()
      .setCustomId(receiptCustomId(receiptId, section))
      .setLabel(label)
      .setEmoji(emoji)
      .setStyle(ButtonStyle.Secondary)),
  ));
  return rows;
}

function receiptCustomId(receiptId: string, action: EternalReturnReceiptSection | "player"): string {
  return `er:r:${receiptId}:${action}`;
}

export function buildReceiptSummaryEmbed(view: EternalReturnReceiptView): EmbedBuilder {
  if (!view.valid) throw new Error(`게임 결과 정합성 검증 실패: ${view.errors.join("; ")}`);
  const single = view.players.length === 1 ? view.players[0] : undefined;
  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle(limit(single ? `🎮 ${single.nickname} 게임 결과` : "🎮 친구 게임 결과", 256))
    .setDescription(limit([
      `${modeName(view.matchingMode)}/${teamModeName(view.matchingTeamMode)}`,
      formatDateTime(view.startedAt),
      formatDuration(view.duration),
    ].filter(value => value !== "-").join(" · "), 4096))
    .setTimestamp(new Date());

  if (single) addSingleSummary(embed, single);
  else addTeamSummary(embed, view);
  if (view.features.length > 0) {
    embed.addFields({
      name: "✨ 이번 경기의 특징",
      value: limit(view.features.slice(0, 4).map(feature => `• ${feature}`).join("\n"), 1024),
    });
  }
  return embed;
}

export function buildReceiptDetailEmbed(
  player: EternalReturnReceiptPlayerView,
  section: EternalReturnReceiptSection,
): EmbedBuilder {
  const builders: Record<EternalReturnReceiptSection, () => { title: string; body: string }> = {
    combat: () => ({ title: "⚔️ 전투 상세", body: combatBody(player) }),
    contribution: () => ({ title: "❤️ 팀 기여", body: contributionBody(player) }),
    credits: () => ({ title: "💰 크레딧 명세", body: creditBody(player) }),
    activity: () => ({ title: "👁️ 활동 기록", body: activityBody(player) }),
    build: () => ({ title: "🛠️ 최종 빌드", body: buildBody(player) }),
  };
  const content = builders[section]();
  return new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle(limit(`${content.title} · ${player.nickname}`, 256))
    .setDescription(limit(content.body, 4096));
}

function addSingleSummary(embed: EmbedBuilder, player: EternalReturnReceiptPlayerView): void {
  const game = player.game;
  const rank = game.gameRank !== undefined ? `${medal(game.gameRank)} ${game.gameRank}위` : "순위 -";
  const rp = game.mmrGain !== undefined ? ` · RP ${signed(game.mmrGain)}` : "";
  embed.addFields(
    {
      name: limit(`${player.characterName} · ${rank}${rp}`, 256),
      value: limit([
        `K/D/A ${number(game.playerKill)}/${number(game.playerDeaths)}/${number(game.playerAssistant)} · 팀킬 ${number(game.teamKill)}`,
        `⚔️ 가한 피해 ${number(game.damageToPlayer)} · 🛡️ 받은 피해 ${number(game.damageFromPlayer)}`,
        `🐺 야생동물 피해 ${number(game.damageToMonster)}${game.monsterKill !== undefined ? ` · ${number(game.monsterKill)}마리` : ""}`,
      ].join("\n"), 1024),
    },
  );
  if (player.credits.totalGain !== undefined || player.credits.totalUse !== undefined) {
    embed.addFields({
      name: "💰 크레딧",
      value: `획득 ${number(player.credits.totalGain)} · 사용 ${number(player.credits.totalUse)}`
        + (player.credits.balance !== undefined ? ` · 수지 ${signed(player.credits.balance)}` : ""),
    });
  }
}

function addTeamSummary(embed: EmbedBuilder, view: EternalReturnReceiptView): void {
  for (const team of view.teams.slice(0, 4)) {
    const rank = team.rank !== undefined ? `${medal(team.rank)} ${team.rank}위` : "순위 -";
    const fullTeam = team.players.length === (view.matchingTeamMode ?? 0);
    const damageLabel = fullTeam ? "팀 피해" : "등록 친구 피해";
    const lines = [
      `${rank}${team.teamKill !== undefined ? ` · 팀킬 ${number(team.teamKill)}` : ""} · ${damageLabel} ${number(team.damage)}`,
      ...team.players.map(player => `${player.nickname} · ${player.characterName} · `
        + `${number(player.game.playerKill)}/${number(player.game.playerDeaths)}/${number(player.game.playerAssistant)}`
        + ` · 피해 ${number(player.game.damageToPlayer)}`),
    ];
    embed.addFields({
      name: team.teamNumber !== undefined ? `팀 ${team.teamNumber}` : "등록 친구",
      value: limit(lines.join("\n"), 1024),
    });
  }
}

function combatBody(player: EternalReturnReceiptPlayerView): string {
  const game = player.game;
  const combat = player.combat;
  const lines = [
    `K/D/A  ${number(game.playerKill)} / ${number(game.playerDeaths)} / ${number(game.playerAssistant)}`,
    game.teamKill !== undefined ? `팀킬  ${number(game.teamKill)}` : "",
    combat.dealt !== undefined ? `가한 피해  ${number(combat.dealt)}` : "",
    ...combat.damageTypes.map(metric => ` ├ ${metric.label}  ${number(metric.value)}`),
    combat.unclassifiedDamage !== undefined
      ? ` ├ 분류되지 않은 피해  ${number(combat.unclassifiedDamage)}` : "",
    combat.shieldDamage !== undefined ? ` └ 보호막에 가한 피해  ${number(combat.shieldDamage)}` : "",
    combat.received !== undefined ? `받은 피해  ${number(combat.received)}` : "",
    combat.shieldAbsorbed !== undefined ? `보호막 피해 흡수  ${number(combat.shieldAbsorbed)}` : "",
    combat.ccSeconds !== undefined ? `가한 CC 시간  ${number(combat.ccSeconds)}초` : "",
    "",
    combat.multikills.map(metric => `${metric.label} ${number(metric.value)}회`).join(" · "),
    combat.clutch !== undefined ? `클러치 ${number(combat.clutch)}회` : "",
    combat.terminate !== undefined ? `터미네이트 ${number(combat.terminate)}팀` : "",
  ];
  return compact(lines, "기록된 전투 상세가 없습니다.");
}

function contributionBody(player: EternalReturnReceiptPlayerView): string {
  const support = metricLines(player.contribution.support);
  const vision = metricLines(player.contribution.vision);
  return compact([
    support.length > 0 ? "**지원**" : "",
    ...support,
    support.length > 0 && vision.length > 0 ? "" : "",
    vision.length > 0 ? "**시야 지원**" : "",
    ...vision,
  ], "기록된 팀 기여가 없습니다.");
}

function creditBody(player: EternalReturnReceiptPlayerView): string {
  const credits = player.credits;
  if (!credits.valid) return `정합성 오류로 표시할 수 없습니다.\n${credits.errors.join("\n")}`;
  const lines = [
    credits.totalGain !== undefined ? `**총 획득  ${number(credits.totalGain)}**` : "**획득 상세**",
    ...nestedMetricLines(credits.gain),
    "",
    credits.totalUse !== undefined ? `**총 사용  ${number(credits.totalUse)}**` : "**사용 상세**",
    ...nestedMetricLines(credits.use),
    credits.balance !== undefined ? `\n**수지  ${signed(credits.balance)}**` : "",
  ];
  if (credits.discountCoupon) {
    lines.push("", `할인 쿠폰 사용 · 재료 실제 결제 ${number(
      credits.use.find(metric => metric.key === "material")?.value,
    )}`);
  }
  if (credits.droneItems.length > 0) {
    lines.push("", "**원격 드론 구매 품목**",
      ...credits.droneItems.map(item => `• ${item.name} ${item.count}개`));
  }
  return compact(lines, "기록된 크레딧 상세가 없습니다.");
}

function activityBody(player: EternalReturnReceiptPlayerView): string {
  return player.activity.lines.length > 0
    ? player.activity.lines.map(line => `• ${line}`).join("\n")
    : "기록된 특별 행동이 없습니다.";
}

function buildBody(player: EternalReturnReceiptPlayerView): string {
  const game = player.game;
  const build = player.build;
  const route = game.routeIdOfStart !== undefined
    ? `루트 ${game.routeIdOfStart}${build.route?.title ? ` · ${build.route.title}` : ""}` : "";
  const likes = build.route?.likes !== undefined ? `추천 ${number(build.route.likes)}회(조회 시점)` : "";
  const skillChunks = chunk(build.skillOrder, 10).map((items, index) =>
    `${index * 10 + 1}~${index * 10 + items.length}: ${items.join(" → ")}`);
  return compact([
    `실험체 ${player.characterName}${game.characterLevel !== undefined ? ` · 레벨 ${number(game.characterLevel)}` : ""}`,
    game.bestWeaponLevel !== undefined ? `무기 숙련도 ${number(game.bestWeaponLevel)}` : "",
    game.tacticalSkillLevel !== undefined ? `전술 스킬 레벨 ${number(game.tacticalSkillLevel)}` : "",
    route,
    likes,
    build.startArea ? `시작 ${build.startArea}` : "",
    "",
    build.equipment.length > 0 ? "**장비**" : "",
    build.equipment.join(" / "),
    build.traits.length > 0 ? "\n**특성**" : "",
    build.traits.join(" / "),
    player.credits.coinToss > 0 ? `코인 토스 효과: +${number(player.credits.coinToss)} 크레딧` : "",
    skillChunks.length > 0 ? "\n**스킬 레벨업 순서**" : "",
    ...skillChunks,
  ], "기록된 빌드 상세가 없습니다.");
}

function nestedMetricLines(metrics: readonly ReceiptMetric[]): string[] {
  const lines: string[] = [];
  metrics.forEach((metric, index) => {
    const branch = index === metrics.length - 1 ? "└" : "├";
    lines.push(` ${branch} ${metric.label}  ${number(metric.value)}`);
    for (const detail of metric.details ?? []) lines.push(`    • ${detail.label} ${number(detail.value)}`);
  });
  return lines;
}

function metricLines(metrics: readonly ReceiptMetric[]): string[] {
  return metrics.map(metric => `${metric.label}  ${number(metric.value)}`);
}

function modeName(mode: number | undefined): string {
  if (mode === MATCHING_MODE.normal) return "일반";
  if (mode === MATCHING_MODE.rank) return "랭크";
  return mode === undefined ? "모드 -" : `모드 ${mode}`;
}

function teamModeName(mode: number | undefined): string {
  if (mode === TEAM_MODE.solo) return "Solo";
  if (mode === TEAM_MODE.duo) return "Duo";
  if (mode === TEAM_MODE.squad) return "Squad";
  return mode === undefined ? "팀 -" : `팀 ${mode}`;
}

function formatDateTime(value: string | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function formatDuration(value: number | undefined): string {
  if (!value || value <= 0) return "-";
  return `${Math.floor(value / 60)}분 ${Math.floor(value % 60)}초`;
}

function medal(rank: number): string {
  return rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "🏁";
}

function number(value: unknown): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString("ko-KR", { maximumFractionDigits: 1 }) : "-";
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${number(value)}`;
}

function compact(lines: readonly string[], fallback: string): string {
  const content = lines.filter((line, index) => line !== "" || (index > 0 && lines[index - 1] !== ""))
    .join("\n").trim();
  return content || fallback;
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function limit(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, Math.max(0, maximum - 1))}…`;
}
