import { randomUUID } from "node:crypto";

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";

import { analyzeEternalReturnPerformance } from "../services/eternal-return-analysis.js";
import type { CurrentSeasonProfile } from "../services/eternal-return-profile.js";
import { createEmptyReferenceData, getReferenceData, type EternalReturnReferences } from "../sources/eternal-return-reference.js";
import type { StoredEternalReturnGame } from "../storage/eternal-return-store.js";
import {
  buildAnalysisEmbed,
  buildGameDetailEmbed,
  buildRecentGamesEmbed,
  buildSeasonProfileEmbed,
} from "./eternal-return-formatters.js";
import type { BotCommandContext } from "./types.js";

type EternalReturnScreen = "games" | "detail" | "season" | "analysis";
type ComponentInteraction = ButtonInteraction | StringSelectMenuInteraction;

interface ScreenSession {
  id: string;
  ownerId: string;
  userId: string;
  nickname: string;
  references: EternalReturnReferences;
  warning?: string;
  pageSize: number;
  page: number;
  selectedGameId?: number;
  selectedCharacterNum?: number;
  profile?: CurrentSeasonProfile;
  expiresAt: number;
}

const SESSION_TTL_MS = 15 * 60 * 1000;
const sessions = new Map<string, ScreenSession>();

export async function startEternalReturnScreen(
  interaction: ChatInputCommandInteraction,
  context: BotCommandContext,
  screen: EternalReturnScreen,
): Promise<void> {
  const collector = context.eternalReturnCollector;
  const store = context.eternalReturnStore;
  if (!collector || !store || !context.erApiKey) {
    throw new Error("이터널 리턴 화면에 필요한 수집기 또는 DB가 준비되지 않았습니다.");
  }
  const nickname = interaction.options.getString("닉네임", true).trim();
  const collection = await collector.refreshNickname(nickname, "interactive");
  const { references, warning } = await loadReferences(context.erApiKey, store);
  const session: ScreenSession = {
    id: randomUUID(), ownerId: interaction.user.id, userId: collection.userId,
    nickname: collection.nickname || nickname, references,
    ...(warning ? { warning } : {}), page: 0,
    pageSize: interaction.options.getInteger("개수") ?? 5,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  cleanupSessions();
  sessions.set(session.id, session);
  await render(interaction, context, session, screen, screen === "season");
  void collector.backfill(collection.userId, { targetGames: 100 }).catch(error => {
    console.warn(`[interaction ${interaction.id}] eternal-return backfill-failed`, safeError(error));
  });
}

export async function handleEternalReturnComponent(
  interaction: ComponentInteraction,
  context: BotCommandContext,
): Promise<void> {
  const [, sessionId, action] = interaction.customId.split(":");
  const session = sessionId ? sessions.get(sessionId) : undefined;
  if (!session || session.expiresAt <= Date.now()) {
    if (sessionId) sessions.delete(sessionId);
    await interaction.reply({
      content: "이 전적 화면은 만료되었거나 봇 재시작으로 초기화되었습니다. 명령어를 다시 실행해 주세요.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (interaction.user.id !== session.ownerId) {
    await interaction.reply({ content: "이 화면은 명령어를 실행한 사용자만 조작할 수 있습니다.", flags: MessageFlags.Ephemeral });
    return;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  await interaction.deferUpdate();
  try {
    refreshSessionUser(context, session);
    if (action === "prev") session.page = Math.max(0, session.page - 1);
    if (action === "next") await moveNext(context, session);
    if (action === "game" && interaction.isStringSelectMenu()) {
      const gameId = Number(interaction.values[0]);
      if (Number.isSafeInteger(gameId)) session.selectedGameId = gameId;
    }
    if (action === "character" && interaction.isStringSelectMenu()) {
      const value = interaction.values[0];
      if (value === "all") delete session.selectedCharacterNum;
      else session.selectedCharacterNum = Number(value);
    }
    const screen = action === "detail" || action === "game" ? "detail"
      : action === "season" || action === "season-refresh" ? "season"
        : action === "analysis" || action === "character" ? "analysis"
          : "games";
    await render(interaction, context, session, screen, action === "season-refresh");
  } catch (error: unknown) {
    await interaction.editReply({
      content: `전적 화면을 갱신하지 못했습니다. ${error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요."}`,
      embeds: [], components: [],
    });
  }
}

async function render(
  interaction: Pick<ChatInputCommandInteraction | ComponentInteraction, "editReply">,
  context: BotCommandContext,
  session: ScreenSession,
  screen: EternalReturnScreen,
  forceProfile = false,
): Promise<void> {
  const store = context.eternalReturnStore!;
  refreshSessionUser(context, session);
  if (screen === "games") {
    const allGames = store.listGames(session.userId, { limit: 500 });
    const games = allGames.slice(session.page * session.pageSize, (session.page + 1) * session.pageSize);
    const profile = await optionalProfile(context, session, false);
    const backfill = store.getCollectionState(session.userId, "backfill");
    const collectionNotice = backfill?.status === "running"
      ? "과거 전적 수집 중"
      : backfill?.cursor ? "다음 페이지 요청 시 과거 전적을 추가 수집합니다."
        : "수집된 마지막 페이지입니다.";
    const footer = [session.warning, collectionNotice].filter(Boolean).join(" · ");
    await interaction.editReply({
      content: null,
      embeds: [buildRecentGamesEmbed(session.nickname, games, session.references, {
        page: session.page, pageSize: session.pageSize, total: allGames.length,
        ...(profile?.tier ? { tier: `${profile.tier.label} · ${Math.round(profile.mmr ?? 0).toLocaleString("ko-KR")} RP` } : {}),
        ...(footer ? { footer } : {}),
      })],
      components: gameListComponents(session, games, hasMore(context, session, allGames.length)),
    });
    return;
  }
  if (screen === "detail") {
    const games = store.listGames(session.userId, { limit: 500 });
    const pageGames = games.slice(session.page * session.pageSize, (session.page + 1) * session.pageSize);
    const game = selectedGame(store, session, pageGames);
    if (!game) throw new Error("표시할 경기 기록이 없습니다.");
    session.selectedGameId = game.gameId;
    await interaction.editReply({
      content: null,
      embeds: [buildGameDetailEmbed(session.nickname, game, session.references, session.warning)],
      components: detailComponents(session, pageGames),
    });
    return;
  }
  if (screen === "season") {
    const profile = await requiredProfile(context, session, forceProfile);
    await interaction.editReply({
      content: null, embeds: [buildSeasonProfileEmbed(profile, session.references)],
      components: seasonComponents(session),
    });
    return;
  }
  const profile = await requiredProfile(context, session, false);
  const analysis = analyzeEternalReturnPerformance(store, session.userId, {
    seasonId: profile.seasonId, matchingMode: profile.matchingMode,
  });
  await interaction.editReply({
    content: null,
    embeds: [buildAnalysisEmbed(session.nickname, analysis, session.references, session.selectedCharacterNum)],
    components: analysisComponents(session, analysis.byCharacter.map(entry => entry.characterNum)),
  });
}

function refreshSessionUser(context: BotCommandContext, session: ScreenSession): void {
  const currentUser = context.eternalReturnStore?.findUsersByNickname(session.nickname)[0];
  if (currentUser) session.userId = currentUser.userId;
}

async function moveNext(context: BotCommandContext, session: ScreenSession): Promise<void> {
  const store = context.eternalReturnStore!;
  const target = (session.page + 2) * session.pageSize;
  if (store.countGames(session.userId) < target && store.getCollectionState(session.userId, "backfill")?.cursor) {
    await context.eternalReturnCollector!.backfill(session.userId, { targetGames: target });
  }
  if (store.countGames(session.userId) > (session.page + 1) * session.pageSize) session.page += 1;
}

function selectedGame(
  store: NonNullable<BotCommandContext["eternalReturnStore"]>,
  session: ScreenSession,
  fallback: StoredEternalReturnGame[],
): StoredEternalReturnGame | undefined {
  return session.selectedGameId === undefined
    ? fallback[0]
    : store.getGame(session.userId, session.selectedGameId) ?? fallback[0];
}

async function requiredProfile(
  context: BotCommandContext, session: ScreenSession, force: boolean,
): Promise<CurrentSeasonProfile> {
  if (!context.eternalReturnProfileService) throw new Error("시즌 프로필 서비스가 준비되지 않았습니다.");
  const profile = await context.eternalReturnProfileService.getCurrentSeasonProfile(session.userId, {
    force, priority: "interactive",
  });
  session.profile = profile;
  return profile;
}

async function optionalProfile(
  context: BotCommandContext, session: ScreenSession, force: boolean,
): Promise<CurrentSeasonProfile | undefined> {
  try {
    return await requiredProfile(context, session, force);
  } catch {
    return session.profile;
  }
}

function gameListComponents(session: ScreenSession, games: StoredEternalReturnGame[], more: boolean) {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(session, "prev", "◀ 이전", ButtonStyle.Secondary, session.page === 0),
    button(session, "next", "다음 ▶", ButtonStyle.Secondary, !more),
    button(session, "detail", "상세 보기", ButtonStyle.Primary, games.length === 0),
    button(session, "season", "시즌전적", ButtonStyle.Success),
    button(session, "analysis", "전적분석", ButtonStyle.Secondary),
  )];
}

function detailComponents(session: ScreenSession, games: StoredEternalReturnGame[]) {
  const rows: Array<ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>> = [];
  if (games.length > 0) {
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(customId(session, "game"))
        .setPlaceholder("상세 경기 선택")
        .addOptions(games.map((game, index) => ({
          label: `${session.page * session.pageSize + index + 1}번 · #${game.gameRank ?? "-"} · ${session.references.characterName(game.characterNum)}`.slice(0, 100),
          value: String(game.gameId),
          default: game.gameId === session.selectedGameId,
        }))),
    ));
  }
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(session, "games", "← 전적 목록", ButtonStyle.Secondary),
    button(session, "season", "시즌전적", ButtonStyle.Success),
    button(session, "analysis", "전적분석", ButtonStyle.Secondary),
  ));
  return rows;
}

function seasonComponents(session: ScreenSession) {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(session, "games", "최근 전적", ButtonStyle.Secondary),
    button(session, "analysis", "전적 분석", ButtonStyle.Primary),
    button(session, "season-refresh", "새로고침", ButtonStyle.Success),
  )];
}

function analysisComponents(session: ScreenSession, characterCodes: number[]) {
  const rows: Array<ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>> = [];
  const options = [
    { label: "전체", value: "all", default: session.selectedCharacterNum === undefined },
    ...characterCodes.slice(0, 24).map(code => ({
      label: session.references.characterName(code).slice(0, 100), value: String(code),
      default: session.selectedCharacterNum === code,
    })),
  ];
  rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder().setCustomId(customId(session, "character"))
      .setPlaceholder("분석할 실험체 선택").addOptions(options),
  ));
  rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    button(session, "games", "최근 전적", ButtonStyle.Secondary),
    button(session, "season", "시즌전적", ButtonStyle.Success),
  ));
  return rows;
}

function button(
  session: ScreenSession, action: string, label: string, style: ButtonStyle, disabled = false,
): ButtonBuilder {
  return new ButtonBuilder().setCustomId(customId(session, action)).setLabel(label).setStyle(style).setDisabled(disabled);
}

function customId(session: ScreenSession, action: string): string {
  return `er:${session.id}:${action}`;
}

function hasMore(context: BotCommandContext, session: ScreenSession, total: number): boolean {
  return total > (session.page + 1) * session.pageSize
    || Boolean(context.eternalReturnStore?.getCollectionState(session.userId, "backfill")?.cursor);
}

async function loadReferences(
  apiKey: string,
  store: NonNullable<BotCommandContext["eternalReturnStore"]>,
): Promise<{ references: EternalReturnReferences; warning?: string }> {
  try {
    return { references: await getReferenceData(apiKey, { priority: "interactive" }, store) };
  } catch {
    return {
      references: createEmptyReferenceData(),
      warning: "이름 데이터를 불러오지 못해 일부 항목을 코드로 표시합니다.",
    };
  }
}

function safeError(error: unknown): object {
  return error instanceof Error ? { name: error.name, message: error.message } : { name: "UnknownError" };
}

function cleanupSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
}
