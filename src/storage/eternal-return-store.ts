import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";

import Database from "better-sqlite3";

import { normalizeEternalReturnGame } from "../services/eternal-return-game-normalizer.js";
import type { EternalReturnGame } from "../sources/eternal-return.js";

export type EternalReturnCollectionKind = "latest" | "backfill";
export type EternalReturnCollectionStatus = "idle" | "running" | "succeeded" | "failed";
export type EternalReturnReceiptStatus = "pending" | "sending" | "sent" | "failed" | "suppressed";

export interface EternalReturnUserRecord {
  userId: string;
  nickname: string;
  normalizedNickname: string;
  autoRefresh: boolean;
  receiptEnabled: boolean;
  receiptChannelId?: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface EternalReturnReceiptPlayerInput {
  userId: string;
  nickname: string;
  teamNumber?: number;
  isMonitored?: boolean;
}

export interface EternalReturnGameReceipt {
  receiptId: string;
  gameId: number;
  channelId: string;
  status: EternalReturnReceiptStatus;
  detectedAt: Date;
  sentAt?: Date;
  messageId?: string;
  attemptCount: number;
  lastAttemptAt?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface EternalReturnGameReceiptPlayer {
  receiptId: string;
  gameId: number;
  userId: string;
  nickname: string;
  teamNumber?: number;
  isMonitored: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface EternalReturnGameReceiptInput {
  gameId: number;
  channelId: string;
  players?: readonly EternalReturnReceiptPlayerInput[];
  status?: "pending" | "suppressed";
  detectedAt?: Date;
}

export interface StoredEternalReturnGame extends EternalReturnGame {
  userId: string;
  gameId: number;
  startDtm?: string;
  collectedAt: Date;
  updatedAt: Date;
  /** Optional analysis fields grouped for callers that do not need the full game model. */
  optional: Readonly<Record<string, unknown>>;
}

export interface EternalReturnGameQuery {
  matchingMode?: number;
  characterNum?: number;
  seasonId?: number;
  beforeStartedAt?: Date;
  limit?: number;
}

export interface EternalReturnCharacterSummary {
  characterNum: number;
  games: number;
  averageDamage?: number;
  damageSamples: number;
}

export interface EternalReturnCollectionState {
  userId: string;
  kind: EternalReturnCollectionKind;
  status: EternalReturnCollectionStatus;
  cursor?: string;
  boundaryGameId?: number;
  lastAttemptAt?: Date;
  lastSuccessAt?: Date;
  lastError?: string;
  updatedAt: Date;
}

export interface EternalReturnCollectionUpdate {
  kind: EternalReturnCollectionKind;
  status: EternalReturnCollectionStatus;
  /** 최신 수집에서 완료 경계보다 앞에 있어 게임 결과 알림 후보가 된 경기 ID. */
  receiptEligibleGameIds?: readonly number[];
  cursor?: string | null;
  boundaryGameId?: number | null;
  attemptedAt?: Date;
  succeededAt?: Date | null;
  error?: string | null;
}

export interface EternalReturnReferenceCache<T = unknown> {
  dataType: string;
  cacheKey: string;
  payload: T;
  sourceVersion?: string;
  fetchedAt: Date;
  expiresAt?: Date;
}

export interface EternalReturnSeasonProfile<TStats = unknown, TRank = unknown> {
  userId: string;
  seasonId: number;
  matchingMode: number;
  mmr?: number;
  rank?: number;
  serverRank?: number;
  stats?: TStats;
  rankData?: TRank;
  fetchedAt: Date;
  expiresAt?: Date;
}

interface UserRow {
  user_id: string;
  nickname: string;
  normalized_nickname: string;
  auto_refresh: number;
  receipt_enabled: number;
  receipt_channel_id: string | null;
  first_seen_at: number;
  last_seen_at: number;
}

interface ReceiptRow {
  receipt_id: string;
  game_id: number;
  channel_id: string;
  status: EternalReturnReceiptStatus;
  detected_at: number;
  sent_at: number | null;
  message_id: string | null;
  attempt_count: number;
  last_attempt_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

interface ReceiptPlayerRow {
  receipt_id: string;
  game_id: number;
  user_id: string;
  nickname: string;
  team_number: number | null;
  is_monitored: number;
  created_at: number;
  updated_at: number;
}

interface GameRow extends Record<string, unknown> {
  user_id: string;
  game_id: number;
  start_dtm: string | null;
  collected_at: number;
  updated_at: number;
}

interface CollectionStateRow {
  user_id: string;
  kind: EternalReturnCollectionKind;
  status: EternalReturnCollectionStatus;
  cursor: string | null;
  boundary_game_id: number | null;
  last_attempt_at: number | null;
  last_success_at: number | null;
  last_error: string | null;
  updated_at: number;
}

const NUMBER_FIELDS = {
  season_id: "seasonId",
  version_season: "versionSeason",
  version_major: "versionMajor",
  version_minor: "versionMinor",
  matching_mode: "matchingMode",
  matching_team_mode: "matchingTeamMode",
  character_num: "characterNum",
  character_level: "characterLevel",
  game_rank: "gameRank",
  player_kill: "playerKill",
  player_assistant: "playerAssistant",
  player_deaths: "playerDeaths",
  team_kill: "teamKill",
  mmr_gain: "mmrGain",
  mmr_before: "mmrBefore",
  mmr_after: "mmrAfter",
  damage_to_player: "damageToPlayer",
  damage_from_player: "damageFromPlayer",
  damage_to_monster: "damageToMonster",
  heal_amount: "healAmount",
  team_recover: "teamRecover",
  protect_absorb: "protectAbsorb",
  cc_time_to_player: "ccTimeToPlayer",
  monster_kill: "monsterKill",
  route_id_of_start: "routeIdOfStart",
  play_time: "playTime",
  total_time: "totalTime",
  duration: "duration",
  victory: "victory",
  escape_state: "escapeState",
  view_contribution: "viewContribution",
  add_surveillance_camera: "addSurveillanceCamera",
  remove_surveillance_camera: "removeSurveillanceCamera",
  tactical_skill_group: "tacticalSkillGroup",
  tactical_skill_level: "tacticalSkillLevel",
  tactical_skill_use_count: "tacticalSkillUseCount",
  team_number: "teamNumber",
  pre_made: "preMade",
  premade_matching_type: "premadeMatchingType",
  bot_added: "botAdded",
  best_weapon: "bestWeapon",
  best_weapon_level: "bestWeaponLevel",
  mmr_avg: "mmrAvg",
  skin_code: "skinCode",
  trait_first_core: "traitFirstCore",
  damage_to_player_basic: "damageToPlayer_basic",
  damage_to_player_skill: "damageToPlayer_skill",
  damage_to_player_item_skill: "damageToPlayer_itemSkill",
  damage_to_player_direct: "damageToPlayer_direct",
  damage_to_player_unique_skill: "damageToPlayer_uniqueSkill",
  damage_to_player_trap: "damageToPlayer_trap",
  damage_to_player_shield: "damageToPlayer_Shield",
  damage_offseted_by_shield_player: "damageOffsetedByShield_Player",
  damage_offseted_by_shield_monster: "damageOffsetedByShield_Monster",
  add_telephoto_camera: "addTelephotoCamera",
  remove_telephoto_camera: "removeTelephotoCamera",
  use_recon_drone: "useReconDrone",
  use_emp_drone: "useEmpDrone",
  use_hyper_loop: "useHyperLoop",
  use_security_console: "useSecurityConsole",
  total_double_kill: "totalDoubleKill",
  total_triple_kill: "totalTripleKill",
  total_quadra_kill: "totalQuadraKill",
  total_extra_kill: "totalExtraKill",
  clutch_count: "clutchCount",
  terminate_count: "terminateCount",
  team_elimination: "teamElimination",
  team_down: "teamDown",
  total_gain_vf_credit: "totalGainVFCredit",
  total_use_vf_credit: "totalUseVFCredit",
  cr_get_animal: "crGetAnimal",
  cr_get_mutant: "crGetMutant",
  cr_get_phase_start: "crGetPhaseStart",
  cr_get_kill: "crGetKill",
  cr_get_assist: "crGetAssist",
  cr_get_time_elapsed: "crGetTimeElapsed",
  cr_get_credit_bonus: "crGetCreditBonus",
  cr_get_by_guide_robot: "crGetByGuideRobot",
  kill_alpha_gain_vf_credit: "killAlphaGainVFCredit",
  kill_omega_gain_vf_credit: "killOmegaGainVFCredit",
  kill_gamma_gain_vf_credit: "killGammaGainVFCredit",
  kill_wickline_gain_vf_credit: "killWicklineGainVFCredit",
  kill_item_bounty_gain_vf_credit: "killItemBountyGainVFCredit",
  kill_drone_gain_vf_credit: "killDroneGainVFCredit",
  kill_turret_gain_vf_credit: "killTurretGainVFCredit",
  item_shredder_gain_vf_credit: "itemShredderGainVFCredit",
  kiosk_exchange_credit: "kioskExchangeCredit",
  remote_drone_use_vf_credit_myself: "remoteDroneUseVFCreditMySelf",
  remote_drone_use_vf_credit_ally: "remoteDroneUseVFCreditAlly",
  transfer_console_material_use_vf_credit: "transferConsoleFromMaterialUseVFCredit",
  transfer_console_escape_key_use_vf_credit: "transferConsoleFromEscapeKeyUseVFCredit",
  transfer_console_revival_use_vf_credit: "transferConsoleFromRevivalUseVFCredit",
  credit_revival_count: "creditRevivalCount",
  credit_revived_others_count: "creditRevivedOthersCount",
  tactical_skill_upgrade_use_vf_credit: "tacticalSkillUpgradeUseVFCredit",
  cr_use_remote_drone: "crUseRemoteDrone",
  cr_use_upgrade_tactical_skill: "crUseUpgradeTacticalSkill",
  cr_use_tree_of_life: "crUseTreeOfLife",
  cr_use_meteorite: "crUseMeteorite",
  cr_use_mythril: "crUseMythril",
  cr_use_force_core: "crUseForceCore",
  cr_use_vf_blood_sample: "crUseVFBloodSample",
  cr_use_activation_module: "crUseActivationModule",
  cr_use_rootkit: "crUseRootkit",
  damage_to_guide_robot: "damageToGuideRobot",
  use_guide_robot: "useGuideRobot",
  fishing_count: "fishingCount",
  use_emoticon_count: "useEmoticonCount",
  craft_mythic: "craftMythic",
  enter_dimension_rift: "enterDimensionRift",
  enter_dimension_empowered_rift: "enterDimensionEmpoweredRift",
  win_from_dimension_rift: "winFromDimensionRift",
  win_from_dimension_empowered_rift: "winFromDimensionEmpoweredRift",
  enter_turbulent_rift: "enterTurbulentRift",
  get_buff_cube_red: "getBuffCubeRed",
  get_buff_cube_purple: "getBuffCubePurple",
  get_buff_cube_green: "getBuffCubeGreen",
  get_buff_cube_gold: "getBuffCubeGold",
  get_buff_cube_sky_blue: "getBuffCubeSkyBlue",
  sum_get_buff_cube: "sumGetBuffCube",
  gimmick_apple_dropped: "gimmickAppleDropped",
  gimmick_drum_use_count: "gimmickDrumUseCount",
  gimmick_drum_attack_count: "gimmickDrumAttackCount",
  gimmick_drum_dropped_hit_count: "gimmickDrumDroppedHitCount",
  gimmick_hospital_discount_rate: "gimmickHospitalDiscountRate",
  gimmick_grandfather_clock_use_count: "gimmickGrandfatherClockUseCount",
} as const;

const JSON_FIELDS = {
  equipment_json: "equipment",
  trait_first_sub_json: "traitFirstSub",
  trait_second_sub_json: "traitSecondSub",
  place_of_start_json: "placeOfStart",
  place_of_death_json: "placeOfDeath",
  kill_monsters_json: "killMonsters",
  credit_source_json: "creditSource",
  credit_timeline_json: "totalVFCredits",
  used_credit_timeline_json: "usedVFCredits",
  mastery_levels_json: "masteryLevel",
  skill_level_info_json: "skillLevelInfo",
  skill_order_json: "skillOrderInfo",
  food_craft_count_json: "foodCraftCount",
  beverage_craft_count_json: "beverageCraftCount",
  air_supply_open_count_json: "airSupplyOpenCount",
  get_bori_reward_json: "getBoriReward",
  active_installation_json: "activeInstallation",
  use_gadget_json: "useGadget",
  gimmick_evidence_locker_count_json: "gimmickEvidenceLockerCount",
  gimmick_evidence_locker_item_json: "gimmickEvidenceLockerItem",
  item_transferred_console_json: "itemTransferredConsole",
  item_transferred_drone_json: "itemTransferredDrone",
  receipt_details_json: "receiptDetails",
  extra_json: "extra",
  normalization_warnings_json: "normalizationWarnings",
} as const;

const OPTIONAL_FIELD_NAMES = new Set<string>([
  "versionSeason", "versionMajor", "versionMinor", "gameVersion", "mmrBefore", "mmrAfter",
  "victory", "escapeState", "teamRecover", "protectAbsorb", "ccTimeToPlayer", "killMonsters",
  "viewContribution", "addSurveillanceCamera", "removeSurveillanceCamera", "tacticalSkillGroup",
  "tacticalSkillLevel", "tacticalSkillUseCount", "teamNumber", "preMade", "premadeMatchingType",
  "botAdded", "characterLevel", "bestWeapon",
]);

export class EternalReturnStore {
  readonly #database: Database.Database;

  private constructor(database: Database.Database) {
    this.#database = database;
    this.#migrate();
    this.recoverInterruptedGameReceipts();
  }

  static async open(filePath: string): Promise<EternalReturnStore> {
    await mkdir(dirname(filePath), { recursive: true });
    const database = new Database(filePath);
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    return new EternalReturnStore(database);
  }

  close(): void {
    this.#database.close();
  }

  upsertUser(userId: string, nickname: string, observedAt = new Date()): EternalReturnUserRecord {
    const trimmedNickname = nickname.trim();
    if (!userId.trim() || !trimmedNickname) throw new Error("이터널 리턴 UID와 닉네임이 필요합니다.");
    const normalizedNickname = normalizeNickname(trimmedNickname);
    const timestamp = observedAt.getTime();
    const transaction = this.#database.transaction(() => {
      this.#database.prepare(`
        INSERT INTO er_users (
          user_id, nickname, normalized_nickname, auto_refresh, first_seen_at, last_seen_at
        ) VALUES (?, ?, ?, 0, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          nickname = excluded.nickname,
          normalized_nickname = excluded.normalized_nickname,
          last_seen_at = excluded.last_seen_at
      `).run(userId, trimmedNickname, normalizedNickname, timestamp, timestamp);
      this.#database.prepare(`
        INSERT INTO er_user_nicknames (
          user_id, nickname, normalized_nickname, first_seen_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, normalized_nickname) DO UPDATE SET
          nickname = excluded.nickname,
          last_seen_at = excluded.last_seen_at
      `).run(userId, trimmedNickname, normalizedNickname, timestamp, timestamp);
    });
    transaction();
    return this.getUser(userId)!;
  }

  /**
   * 닉네임 조회 API가 매 요청마다 다른 불투명 userId를 반환하므로, 같은 닉네임으로
   * 확인된 기존 레코드를 이번 응답의 userId로 합친다. 경기 ID 중복은 제거하고
   * 더 최근의 수집 상태와 시즌 프로필을 보존한다.
   */
  upsertResolvedUser(userId: string, nickname: string, observedAt = new Date()): EternalReturnUserRecord {
    const current = this.upsertUser(userId, nickname, observedAt);
    const duplicates = this.findUsersByNickname(nickname).filter(user => user.userId !== userId);
    if (duplicates.length === 0) return current;
    const receiptEnabled = current.receiptEnabled || duplicates.some(user => user.receiptEnabled);
    const receiptChannelId = current.receiptChannelId
      ?? duplicates.find(user => user.receiptEnabled && user.receiptChannelId)?.receiptChannelId
      ?? duplicates.find(user => user.receiptChannelId)?.receiptChannelId;

    const merge = this.#database.transaction(() => {
      for (const duplicate of duplicates) {
        this.#database.prepare(`
          DELETE FROM er_games AS old
          WHERE old.user_id = ? AND EXISTS (
            SELECT 1 FROM er_games AS fresh
            WHERE fresh.user_id = ? AND fresh.game_id = old.game_id
          )
        `).run(duplicate.userId, userId);
        this.#database.prepare("UPDATE er_games SET user_id = ? WHERE user_id = ?")
          .run(userId, duplicate.userId);

        this.#database.prepare(`
          DELETE FROM er_season_profiles AS old
          WHERE old.user_id = ? AND EXISTS (
            SELECT 1 FROM er_season_profiles AS fresh
            WHERE fresh.user_id = ?
              AND fresh.season_id = old.season_id
              AND fresh.matching_mode = old.matching_mode
              AND fresh.fetched_at >= old.fetched_at
          )
        `).run(duplicate.userId, userId);
        this.#database.prepare(`
          DELETE FROM er_season_profiles AS fresh
          WHERE fresh.user_id = ? AND EXISTS (
            SELECT 1 FROM er_season_profiles AS old
            WHERE old.user_id = ?
              AND old.season_id = fresh.season_id
              AND old.matching_mode = fresh.matching_mode
              AND old.fetched_at > fresh.fetched_at
          )
        `).run(userId, duplicate.userId);
        this.#database.prepare("UPDATE er_season_profiles SET user_id = ? WHERE user_id = ?")
          .run(userId, duplicate.userId);

        this.#database.prepare(`
          DELETE FROM er_collection_state AS old
          WHERE old.user_id = ? AND EXISTS (
            SELECT 1 FROM er_collection_state AS fresh
            WHERE fresh.user_id = ? AND fresh.kind = old.kind AND fresh.updated_at >= old.updated_at
          )
        `).run(duplicate.userId, userId);
        this.#database.prepare(`
          DELETE FROM er_collection_state AS fresh
          WHERE fresh.user_id = ? AND EXISTS (
            SELECT 1 FROM er_collection_state AS old
            WHERE old.user_id = ? AND old.kind = fresh.kind AND old.updated_at > fresh.updated_at
          )
        `).run(userId, duplicate.userId);
        this.#database.prepare("UPDATE er_collection_state SET user_id = ? WHERE user_id = ?")
          .run(userId, duplicate.userId);

        this.#database.prepare(`
          DELETE FROM er_game_receipt_players AS old
          WHERE old.user_id = ? AND EXISTS (
            SELECT 1 FROM er_game_receipt_players AS fresh
            WHERE fresh.receipt_id = old.receipt_id AND fresh.user_id = ?
          )
        `).run(duplicate.userId, userId);
        this.#database.prepare("UPDATE er_game_receipt_players SET user_id = ? WHERE user_id = ?")
          .run(userId, duplicate.userId);

        const aliases = this.#database.prepare(`
          SELECT nickname, normalized_nickname, first_seen_at, last_seen_at
          FROM er_user_nicknames WHERE user_id = ?
        `).all(duplicate.userId) as Array<{
          nickname: string; normalized_nickname: string; first_seen_at: number; last_seen_at: number;
        }>;
        for (const alias of aliases) {
          this.#database.prepare(`
            INSERT INTO er_user_nicknames (
              user_id, nickname, normalized_nickname, first_seen_at, last_seen_at
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, normalized_nickname) DO UPDATE SET
              nickname = CASE
                WHEN excluded.last_seen_at > er_user_nicknames.last_seen_at THEN excluded.nickname
                ELSE er_user_nicknames.nickname
              END,
              first_seen_at = MIN(er_user_nicknames.first_seen_at, excluded.first_seen_at),
              last_seen_at = MAX(er_user_nicknames.last_seen_at, excluded.last_seen_at)
          `).run(userId, alias.nickname, alias.normalized_nickname, alias.first_seen_at, alias.last_seen_at);
        }
        this.#database.prepare("DELETE FROM er_users WHERE user_id = ?").run(duplicate.userId);
      }
      this.#database.prepare(`
        UPDATE er_users SET auto_refresh = ?, receipt_enabled = ?, receipt_channel_id = ?,
          first_seen_at = ? WHERE user_id = ?
      `).run(
        duplicates.some(user => user.autoRefresh) || current.autoRefresh ? 1 : 0,
        receiptEnabled ? 1 : 0,
        receiptChannelId ?? null,
        Math.min(current.firstSeenAt.getTime(), ...duplicates.map(user => user.firstSeenAt.getTime())),
        userId,
      );
    });
    merge();
    return this.getUser(userId)!;
  }

  getUser(userId: string): EternalReturnUserRecord | undefined {
    const row = this.#database.prepare("SELECT * FROM er_users WHERE user_id = ?").get(userId) as UserRow | undefined;
    return row ? toUser(row) : undefined;
  }

  findUsersByNickname(nickname: string): EternalReturnUserRecord[] {
    const rows = this.#database.prepare(`
      SELECT u.* FROM er_user_nicknames n
      JOIN er_users u ON u.user_id = n.user_id
      WHERE n.normalized_nickname = ?
      ORDER BY n.last_seen_at DESC, u.user_id ASC
    `).all(normalizeNickname(nickname)) as UserRow[];
    return rows.map(toUser);
  }

  setAutoRefresh(userId: string, enabled: boolean): void {
    const result = this.#database.prepare("UPDATE er_users SET auto_refresh = ? WHERE user_id = ?")
      .run(enabled ? 1 : 0, userId);
    if (result.changes === 0) throw new Error(`알 수 없는 이터널 리턴 UID입니다: ${userId}`);
  }

  listAutoRefreshUsers(): EternalReturnUserRecord[] {
    return (this.#database.prepare("SELECT * FROM er_users WHERE auto_refresh = 1 ORDER BY nickname")
      .all() as UserRow[]).map(toUser);
  }

  listUsers(): EternalReturnUserRecord[] {
    return (this.#database.prepare("SELECT * FROM er_users ORDER BY nickname, user_id")
      .all() as UserRow[]).map(toUser);
  }

  setReceiptSettings(userId: string, enabled: boolean, channelId?: string | null): void {
    const previous = this.getUser(userId);
    if (!previous) throw new Error(`알 수 없는 이터널 리턴 UID입니다: ${userId}`);
    const channel = channelId === undefined ? undefined : normalizeOptionalChannelId(channelId);
    const result = channel === undefined
      ? this.#database.prepare("UPDATE er_users SET receipt_enabled = ? WHERE user_id = ?")
        .run(enabled ? 1 : 0, userId)
      : this.#database.prepare(`
          UPDATE er_users SET receipt_enabled = ?, receipt_channel_id = ? WHERE user_id = ?
        `).run(enabled ? 1 : 0, channel, userId);
    if (result.changes === 0) throw new Error(`알 수 없는 이터널 리턴 UID입니다: ${userId}`);
    const effectiveChannel = channel === undefined ? previous.receiptChannelId : channel ?? undefined;
    if (enabled && effectiveChannel
      && (!previous.receiptEnabled || previous.receiptChannelId !== effectiveChannel)) {
      this.initializeReceiptBaseline(effectiveChannel, [userId]);
    }
  }

  listReceiptEnabledUsers(): EternalReturnUserRecord[] {
    return (this.#database.prepare("SELECT * FROM er_users WHERE receipt_enabled = 1 ORDER BY nickname")
      .all() as UserRow[]).map(toUser);
  }

  enqueueGameReceipt(input: EternalReturnGameReceiptInput): EternalReturnGameReceipt {
    const gameId = normalizeGameId(input.gameId);
    const channelId = normalizeChannelId(input.channelId);
    const detectedAt = input.detectedAt ?? new Date();
    const timestamp = detectedAt.getTime();
    const status = input.status ?? "pending";
    const receiptId = createReceiptId(channelId, gameId);
    let storedReceiptId = receiptId;
    const transaction = this.#database.transaction(() => {
      this.#database.prepare(`
        INSERT INTO er_game_receipts (
          receipt_id, game_id, channel_id, status, detected_at, attempt_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)
        ON CONFLICT(channel_id, game_id) DO NOTHING
      `).run(receiptId, gameId, channelId, status, timestamp, timestamp, timestamp);
      const stored = this.#database.prepare(`
        SELECT receipt_id FROM er_game_receipts WHERE channel_id = ? AND game_id = ?
      `).get(channelId, gameId) as { receipt_id: string };
      storedReceiptId = stored.receipt_id;
      this.#upsertReceiptPlayers(storedReceiptId, gameId, input.players ?? [], timestamp);
    });
    transaction();
    return this.getGameReceipt(storedReceiptId)!;
  }

  /** 여러 유저에게서 감지된 경기들을 한 트랜잭션으로 큐에 넣고 새 결과 개수를 반환한다. */
  enqueueGameReceiptBatch(inputs: readonly EternalReturnGameReceiptInput[]): number {
    const normalized = inputs.map(input => ({
      input,
      gameId: normalizeGameId(input.gameId),
      channelId: normalizeChannelId(input.channelId),
      timestamp: (input.detectedAt ?? new Date()).getTime(),
      status: input.status ?? "pending",
    }));
    let inserted = 0;
    const transaction = this.#database.transaction(() => {
      for (const item of normalized) {
        const proposedReceiptId = createReceiptId(item.channelId, item.gameId);
        const result = this.#database.prepare(`
          INSERT INTO er_game_receipts (
            receipt_id, game_id, channel_id, status, detected_at, attempt_count, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)
          ON CONFLICT(channel_id, game_id) DO NOTHING
        `).run(proposedReceiptId, item.gameId, item.channelId, item.status,
          item.timestamp, item.timestamp, item.timestamp);
        inserted += result.changes;
        const stored = this.#database.prepare(`
          SELECT receipt_id FROM er_game_receipts WHERE channel_id = ? AND game_id = ?
        `).get(item.channelId, item.gameId) as { receipt_id: string };
        this.#upsertReceiptPlayers(stored.receipt_id, item.gameId, item.input.players ?? [], item.timestamp);
      }
    });
    transaction();
    return inserted;
  }

  getGameReceipt(receiptId: string): EternalReturnGameReceipt | undefined {
    const row = this.#database.prepare("SELECT * FROM er_game_receipts WHERE receipt_id = ?")
      .get(receiptId) as ReceiptRow | undefined;
    return row ? toReceipt(row) : undefined;
  }

  getGameReceiptByChannelGame(channelId: string, gameId: number): EternalReturnGameReceipt | undefined {
    const row = this.#database.prepare(`
      SELECT * FROM er_game_receipts WHERE channel_id = ? AND game_id = ?
    `).get(normalizeChannelId(channelId), normalizeGameId(gameId)) as ReceiptRow | undefined;
    return row ? toReceipt(row) : undefined;
  }

  listGameReceiptPlayers(receiptId: string): EternalReturnGameReceiptPlayer[] {
    const rows = this.#database.prepare(`
      SELECT * FROM er_game_receipt_players WHERE receipt_id = ?
      ORDER BY team_number ASC, nickname ASC, user_id ASC
    `).all(receiptId) as ReceiptPlayerRow[];
    return rows.map(toReceiptPlayer);
  }

  listUnqueuedReceiptGames(userId: string, channelId: string, limit = 500): StoredEternalReturnGame[] {
    requireUser(this.#database, userId);
    const rows = this.#database.prepare(`
      SELECT g.* FROM er_games g
      WHERE g.user_id = ? AND g.receipt_eligible = 1 AND NOT EXISTS (
        SELECT 1 FROM er_game_receipts r
        JOIN er_game_receipt_players p ON p.receipt_id = r.receipt_id
        WHERE r.channel_id = ? AND r.game_id = g.game_id AND p.user_id = g.user_id
      )
      ORDER BY g.started_at ASC, g.game_id ASC LIMIT ?
    `).all(userId, normalizeChannelId(channelId), clampLimit(limit)) as GameRow[];
    return rows.map(toGame);
  }

  claimNextGameReceipt(channelId: string, now = new Date()): EternalReturnGameReceipt | undefined {
    const normalizedChannelId = normalizeChannelId(channelId);
    const timestamp = now.getTime();
    const claim = this.#database.transaction(() => {
      const candidate = this.#database.prepare(`
        SELECT receipt_id FROM er_game_receipts
        WHERE channel_id = ? AND status = 'pending'
        ORDER BY detected_at ASC, receipt_id ASC LIMIT 1
      `).get(normalizedChannelId) as { receipt_id: string } | undefined;
      if (!candidate) return undefined;
      const result = this.#database.prepare(`
        UPDATE er_game_receipts SET
          status = 'sending', attempt_count = attempt_count + 1,
          last_attempt_at = ?, last_error = NULL, updated_at = ?
        WHERE receipt_id = ? AND status = 'pending'
      `).run(timestamp, timestamp, candidate.receipt_id);
      return result.changes === 1 ? this.getGameReceipt(candidate.receipt_id) : undefined;
    });
    return claim();
  }

  claimNextPendingGameReceipt(now = new Date()): EternalReturnGameReceipt | undefined {
    const timestamp = now.getTime();
    const claim = this.#database.transaction(() => {
      const candidate = this.#database.prepare(`
        SELECT receipt_id FROM er_game_receipts
        WHERE status = 'pending'
        ORDER BY detected_at ASC, receipt_id ASC LIMIT 1
      `).get() as { receipt_id: string } | undefined;
      if (!candidate) return undefined;
      const result = this.#database.prepare(`
        UPDATE er_game_receipts SET
          status = 'sending', attempt_count = attempt_count + 1,
          last_attempt_at = ?, last_error = NULL, updated_at = ?
        WHERE receipt_id = ? AND status = 'pending'
      `).run(timestamp, timestamp, candidate.receipt_id);
      return result.changes === 1 ? this.getGameReceipt(candidate.receipt_id) : undefined;
    });
    return claim();
  }

  markGameReceiptSent(receiptId: string, messageId: string, sentAt = new Date()): EternalReturnGameReceipt {
    const trimmedMessageId = messageId.trim();
    if (!trimmedMessageId) throw new Error("디스코드 메시지 ID가 필요합니다.");
    const timestamp = sentAt.getTime();
    const result = this.#database.prepare(`
      UPDATE er_game_receipts SET status = 'sent', sent_at = ?, message_id = ?,
        last_error = NULL, updated_at = ?
      WHERE receipt_id = ? AND status = 'sending'
    `).run(timestamp, trimmedMessageId, timestamp, receiptId);
    if (result.changes === 0) throw invalidReceiptTransition(receiptId, "sent");
    return this.getGameReceipt(receiptId)!;
  }

  markGameReceiptFailed(receiptId: string, error: string, failedAt = new Date()): EternalReturnGameReceipt {
    const timestamp = failedAt.getTime();
    const result = this.#database.prepare(`
      UPDATE er_game_receipts SET status = 'failed', last_error = ?, updated_at = ?
      WHERE receipt_id = ? AND status = 'sending'
    `).run(error.trim() || "알 수 없는 발송 오류", timestamp, receiptId);
    if (result.changes === 0) throw invalidReceiptTransition(receiptId, "failed");
    return this.getGameReceipt(receiptId)!;
  }

  retryFailedGameReceipts(channelId?: string, now = new Date(), maxAttempts = 3): number {
    const timestamp = now.getTime();
    const result = channelId === undefined
      ? this.#database.prepare(`
          UPDATE er_game_receipts SET status = 'pending', last_error = NULL, updated_at = ?
          WHERE status = 'failed' AND attempt_count < ?
        `).run(timestamp, maxAttempts)
      : this.#database.prepare(`
          UPDATE er_game_receipts SET status = 'pending', last_error = NULL, updated_at = ?
          WHERE status = 'failed' AND channel_id = ? AND attempt_count < ?
        `).run(timestamp, normalizeChannelId(channelId), maxAttempts);
    return result.changes;
  }

  putGameReceiptDetails(receiptId: string, details: unknown): void {
    const payload = stringifyJson(details);
    const result = this.#database.prepare(`
      UPDATE er_games SET receipt_details_json = ?, updated_at = updated_at
      WHERE EXISTS (
        SELECT 1 FROM er_game_receipt_players p
        WHERE p.receipt_id = ? AND p.user_id = er_games.user_id AND p.game_id = er_games.game_id
      )
    `).run(payload, receiptId);
    if (result.changes === 0) throw new Error(`게임 결과 상세를 저장할 경기 기록이 없습니다: ${receiptId}`);
  }

  getGameReceiptDetails<T = unknown>(receiptId: string): T | undefined {
    const row = this.#database.prepare(`
      SELECT g.receipt_details_json details
      FROM er_game_receipt_players p
      JOIN er_games g ON g.user_id = p.user_id AND g.game_id = p.game_id
      WHERE p.receipt_id = ? AND g.receipt_details_json IS NOT NULL
      ORDER BY p.created_at ASC LIMIT 1
    `).get(receiptId) as { details: string } | undefined;
    return row ? parseJson(row.details) as T : undefined;
  }

  recoverInterruptedGameReceipts(now = new Date()): number {
    const timestamp = now.getTime();
    const result = this.#database.prepare(`
      UPDATE er_game_receipts SET status = 'pending',
        last_error = '발송 중 프로세스가 종료되어 다시 대기열에 등록되었습니다.', updated_at = ?
      WHERE status = 'sending'
    `).run(timestamp);
    return result.changes;
  }

  /**
   * 이미 수집된 경기는 최초 배포 때 알림으로 보내지 않는다. 같은 gameId를 가진
   * 등록 친구들은 한 suppressed 결과에 묶이며 반복 실행해도 기존 상태를 바꾸지 않는다.
   */
  initializeReceiptBaseline(channelId: string, userIds: readonly string[], now = new Date()): number {
    const normalizedChannelId = normalizeChannelId(channelId);
    const uniqueUserIds = [...new Set(userIds.map(value => value.trim()).filter(Boolean))];
    if (uniqueUserIds.length === 0) return 0;
    for (const userId of uniqueUserIds) requireUser(this.#database, userId);
    const placeholders = uniqueUserIds.map(() => "?").join(", ");
    const rows = this.#database.prepare(`
      SELECT g.game_id, g.user_id, u.nickname, g.team_number
      FROM er_games g JOIN er_users u ON u.user_id = g.user_id
      WHERE g.user_id IN (${placeholders})
      ORDER BY g.game_id ASC, g.user_id ASC
    `).all(...uniqueUserIds) as Array<{
      game_id: number; user_id: string; nickname: string; team_number: number | null;
    }>;
    const grouped = new Map<number, EternalReturnReceiptPlayerInput[]>();
    for (const row of rows) {
      const players = grouped.get(row.game_id) ?? [];
      players.push({ userId: row.user_id, nickname: row.nickname,
        ...(row.team_number !== null ? { teamNumber: row.team_number } : {}), isMonitored: true });
      grouped.set(row.game_id, players);
    }
    const timestamp = now.getTime();
    let inserted = 0;
    const transaction = this.#database.transaction(() => {
      for (const [gameId, players] of grouped) {
        const receiptId = createReceiptId(normalizedChannelId, gameId);
        const result = this.#database.prepare(`
          INSERT INTO er_game_receipts (
            receipt_id, game_id, channel_id, status, detected_at, attempt_count, created_at, updated_at
          ) VALUES (?, ?, ?, 'suppressed', ?, 0, ?, ?)
          ON CONFLICT(channel_id, game_id) DO NOTHING
        `).run(receiptId, gameId, normalizedChannelId, timestamp, timestamp, timestamp);
        inserted += result.changes;
        const stored = this.#database.prepare(`
          SELECT receipt_id FROM er_game_receipts WHERE channel_id = ? AND game_id = ?
        `).get(normalizedChannelId, gameId) as { receipt_id: string };
        this.#upsertReceiptPlayers(stored.receipt_id, gameId, players, timestamp);
      }
    });
    transaction();
    return inserted;
  }

  saveGamePage(
    userId: string,
    games: readonly EternalReturnGame[],
    collection?: EternalReturnCollectionUpdate,
    collectedAt = new Date(),
  ): number {
    const timestamp = collectedAt.getTime();
    const statement = this.#database.prepare(gameUpsertSql());
    let changed = 0;
    const transaction = this.#database.transaction(() => {
      requireUser(this.#database, userId);
      for (const game of games) {
        const values = gameValues(userId, game, timestamp);
        if (!values) continue;
        changed += statement.run(values).changes;
      }
      if (collection?.kind === "latest") {
        const eligibleIds = [...new Set((collection.receiptEligibleGameIds ?? [])
          .filter(gameId => Number.isSafeInteger(gameId) && gameId > 0))];
        const markEligible = this.#database.prepare(`
          UPDATE er_games SET receipt_eligible = 1 WHERE user_id = ? AND game_id = ?
        `);
        for (const gameId of eligibleIds) markEligible.run(userId, gameId);
      }
      if (collection) this.#writeCollectionState(userId, collection, timestamp);
    });
    transaction();
    return changed;
  }

  countExistingGameIds(userId: string, gameIds: readonly number[]): number {
    const uniqueIds = [...new Set(gameIds.filter(Number.isSafeInteger))];
    if (uniqueIds.length === 0) return 0;
    const placeholders = uniqueIds.map(() => "?").join(", ");
    const row = this.#database.prepare(
      `SELECT COUNT(*) count FROM er_games WHERE user_id = ? AND game_id IN (${placeholders})`,
    ).get(userId, ...uniqueIds) as { count: number };
    return row.count;
  }

  countGames(userId: string, query: Omit<EternalReturnGameQuery, "beforeStartedAt" | "limit"> = {}): number {
    const conditions = ["user_id = @userId"];
    const parameters: Record<string, unknown> = { userId };
    addGameFilters(conditions, parameters, query);
    const row = this.#database.prepare(`SELECT COUNT(*) count FROM er_games WHERE ${conditions.join(" AND ")}`)
      .get(parameters) as { count: number };
    return row.count;
  }

  getGame(userId: string, gameId: number): StoredEternalReturnGame | undefined {
    const row = this.#database.prepare("SELECT * FROM er_games WHERE user_id = ? AND game_id = ?")
      .get(userId, gameId) as GameRow | undefined;
    return row ? toGame(row) : undefined;
  }

  listGames(userId: string, query: EternalReturnGameQuery = {}): StoredEternalReturnGame[] {
    const conditions = ["user_id = @userId"];
    const parameters: Record<string, unknown> = { userId, limit: clampLimit(query.limit) };
    addGameFilters(conditions, parameters, query);
    if (query.beforeStartedAt) {
      conditions.push("started_at < @beforeStartedAt");
      parameters.beforeStartedAt = query.beforeStartedAt.getTime();
    }
    const rows = this.#database.prepare(`
      SELECT * FROM er_games WHERE ${conditions.join(" AND ")}
      ORDER BY started_at DESC, game_id DESC LIMIT @limit
    `).all(parameters) as GameRow[];
    return rows.map(toGame);
  }

  getCharacterSummaries(
    userId: string,
    query: Pick<EternalReturnGameQuery, "matchingMode" | "seasonId"> = {},
  ): EternalReturnCharacterSummary[] {
    const conditions = ["user_id = @userId", "character_num IS NOT NULL"];
    const parameters: Record<string, unknown> = { userId };
    addGameFilters(conditions, parameters, query);
    const rows = this.#database.prepare(`
      SELECT character_num, COUNT(*) games, AVG(damage_to_player) average_damage,
        COUNT(damage_to_player) damage_samples
      FROM er_games WHERE ${conditions.join(" AND ")}
      GROUP BY character_num
      ORDER BY games DESC, character_num ASC
    `).all(parameters) as Array<{
      character_num: number; games: number; average_damage: number | null; damage_samples: number;
    }>;
    return rows.map(row => ({
      characterNum: row.character_num,
      games: row.games,
      ...(row.average_damage !== null ? { averageDamage: row.average_damage } : {}),
      damageSamples: row.damage_samples,
    }));
  }

  updateCollectionState(userId: string, update: EternalReturnCollectionUpdate, now = new Date()): void {
    requireUser(this.#database, userId);
    this.#writeCollectionState(userId, update, now.getTime());
  }

  getCollectionState(userId: string, kind: EternalReturnCollectionKind): EternalReturnCollectionState | undefined {
    const row = this.#database.prepare("SELECT * FROM er_collection_state WHERE user_id = ? AND kind = ?")
      .get(userId, kind) as CollectionStateRow | undefined;
    if (!row) return undefined;
    return {
      userId: row.user_id,
      kind: row.kind,
      status: row.status,
      ...(row.cursor !== null ? { cursor: row.cursor } : {}),
      ...(row.boundary_game_id !== null ? { boundaryGameId: row.boundary_game_id } : {}),
      ...(row.last_attempt_at !== null ? { lastAttemptAt: new Date(row.last_attempt_at) } : {}),
      ...(row.last_success_at !== null ? { lastSuccessAt: new Date(row.last_success_at) } : {}),
      ...(row.last_error !== null ? { lastError: row.last_error } : {}),
      updatedAt: new Date(row.updated_at),
    };
  }

  putReference<T>(entry: EternalReturnReferenceCache<T>): void {
    this.#database.prepare(`
      INSERT INTO er_reference_cache (
        data_type, cache_key, payload_json, source_version, fetched_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(data_type, cache_key) DO UPDATE SET
        payload_json = excluded.payload_json,
        source_version = excluded.source_version,
        fetched_at = excluded.fetched_at,
        expires_at = excluded.expires_at
    `).run(entry.dataType, entry.cacheKey, stringifyJson(entry.payload), entry.sourceVersion ?? null,
      entry.fetchedAt.getTime(), entry.expiresAt?.getTime() ?? null);
  }

  getReference<T = unknown>(dataType: string, cacheKey = "default"): EternalReturnReferenceCache<T> | undefined {
    const row = this.#database.prepare(`
      SELECT * FROM er_reference_cache WHERE data_type = ? AND cache_key = ?
    `).get(dataType, cacheKey) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      dataType: String(row.data_type), cacheKey: String(row.cache_key),
      payload: parseJson(row.payload_json as string) as T,
      ...(row.source_version !== null ? { sourceVersion: String(row.source_version) } : {}),
      fetchedAt: new Date(Number(row.fetched_at)),
      ...(row.expires_at !== null ? { expiresAt: new Date(Number(row.expires_at)) } : {}),
    };
  }

  putSeasonProfile<TStats, TRank>(profile: EternalReturnSeasonProfile<TStats, TRank>): void {
    requireUser(this.#database, profile.userId);
    this.#database.prepare(`
      INSERT INTO er_season_profiles (
        user_id, season_id, matching_mode, mmr, rank, server_rank,
        stats_json, rank_json, fetched_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, season_id, matching_mode) DO UPDATE SET
        mmr = excluded.mmr, rank = excluded.rank, server_rank = excluded.server_rank,
        stats_json = excluded.stats_json, rank_json = excluded.rank_json,
        fetched_at = excluded.fetched_at, expires_at = excluded.expires_at
    `).run(profile.userId, profile.seasonId, profile.matchingMode,
      nullableNumber(profile.mmr), nullableNumber(profile.rank), nullableNumber(profile.serverRank),
      profile.stats === undefined ? null : stringifyJson(profile.stats),
      profile.rankData === undefined ? null : stringifyJson(profile.rankData),
      profile.fetchedAt.getTime(), profile.expiresAt?.getTime() ?? null);
  }

  getSeasonProfile<TStats = unknown, TRank = unknown>(
    userId: string, seasonId: number, matchingMode: number,
  ): EternalReturnSeasonProfile<TStats, TRank> | undefined {
    const row = this.#database.prepare(`
      SELECT * FROM er_season_profiles
      WHERE user_id = ? AND season_id = ? AND matching_mode = ?
    `).get(userId, seasonId, matchingMode) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      userId: String(row.user_id), seasonId: Number(row.season_id), matchingMode: Number(row.matching_mode),
      ...(row.mmr !== null ? { mmr: Number(row.mmr) } : {}),
      ...(row.rank !== null ? { rank: Number(row.rank) } : {}),
      ...(row.server_rank !== null ? { serverRank: Number(row.server_rank) } : {}),
      ...(row.stats_json !== null ? { stats: parseJson(String(row.stats_json)) as TStats } : {}),
      ...(row.rank_json !== null ? { rankData: parseJson(String(row.rank_json)) as TRank } : {}),
      fetchedAt: new Date(Number(row.fetched_at)),
      ...(row.expires_at !== null ? { expiresAt: new Date(Number(row.expires_at)) } : {}),
    };
  }

  #upsertReceiptPlayers(
    receiptId: string,
    gameId: number,
    players: readonly EternalReturnReceiptPlayerInput[],
    timestamp: number,
  ): void {
    const statement = this.#database.prepare(`
      INSERT INTO er_game_receipt_players (
        receipt_id, game_id, user_id, nickname, team_number, is_monitored, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(receipt_id, user_id) DO UPDATE SET
        nickname = excluded.nickname,
        team_number = COALESCE(excluded.team_number, er_game_receipt_players.team_number),
        is_monitored = MAX(er_game_receipt_players.is_monitored, excluded.is_monitored),
        updated_at = excluded.updated_at
    `);
    for (const player of players) {
      const playerUserId = player.userId.trim();
      const playerNickname = player.nickname.trim();
      if (!playerUserId || !playerNickname) continue;
      statement.run(receiptId, gameId, playerUserId, playerNickname,
        normalizeOptionalInteger(player.teamNumber), player.isMonitored ? 1 : 0, timestamp, timestamp);
    }
  }

  #writeCollectionState(userId: string, update: EternalReturnCollectionUpdate, now: number): void {
    this.#database.prepare(`
      INSERT INTO er_collection_state (
        user_id, kind, status, cursor, boundary_game_id,
        last_attempt_at, last_success_at, last_error, updated_at
      ) VALUES (@userId, @kind, @status, @cursor, @boundaryGameId,
        @lastAttemptAt, @lastSuccessAt, @lastError, @updatedAt)
      ON CONFLICT(user_id, kind) DO UPDATE SET
        status = excluded.status,
        cursor = CASE WHEN @setCursor = 1 THEN excluded.cursor ELSE er_collection_state.cursor END,
        boundary_game_id = CASE
          WHEN @setBoundaryGameId = 1 THEN excluded.boundary_game_id
          ELSE er_collection_state.boundary_game_id
        END,
        last_attempt_at = COALESCE(excluded.last_attempt_at, er_collection_state.last_attempt_at),
        last_success_at = COALESCE(excluded.last_success_at, er_collection_state.last_success_at),
        last_error = CASE WHEN @setLastError = 1 THEN excluded.last_error ELSE er_collection_state.last_error END,
        updated_at = excluded.updated_at
    `).run({
      userId, kind: update.kind, status: update.status,
      cursor: update.cursor ?? null, boundaryGameId: update.boundaryGameId ?? null,
      setCursor: Object.hasOwn(update, "cursor") ? 1 : 0,
      setBoundaryGameId: Object.hasOwn(update, "boundaryGameId") ? 1 : 0,
      lastAttemptAt: update.attemptedAt?.getTime() ?? null,
      lastSuccessAt: update.succeededAt?.getTime() ?? null,
      lastError: update.error ?? null, updatedAt: now,
      setLastError: Object.hasOwn(update, "error") ? 1 : 0,
    });
  }

  #migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS er_users (
        user_id TEXT PRIMARY KEY,
        nickname TEXT NOT NULL,
        normalized_nickname TEXT NOT NULL,
        auto_refresh INTEGER NOT NULL DEFAULT 0 CHECK(auto_refresh IN (0, 1)),
        receipt_enabled INTEGER NOT NULL DEFAULT 0 CHECK(receipt_enabled IN (0, 1)),
        receipt_channel_id TEXT,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS er_user_nicknames (
        user_id TEXT NOT NULL REFERENCES er_users(user_id) ON DELETE CASCADE,
        nickname TEXT NOT NULL,
        normalized_nickname TEXT NOT NULL,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, normalized_nickname)
      );
      CREATE TABLE IF NOT EXISTS er_games (
        user_id TEXT NOT NULL REFERENCES er_users(user_id) ON DELETE CASCADE,
        game_id INTEGER NOT NULL,
        season_id INTEGER, version_season INTEGER, version_major INTEGER, version_minor INTEGER,
        game_version TEXT, matching_mode INTEGER, matching_team_mode INTEGER,
        character_num INTEGER, character_level INTEGER, game_rank INTEGER,
        player_kill INTEGER, player_assistant INTEGER, player_deaths INTEGER, team_kill INTEGER,
        mmr_gain REAL, mmr_before REAL, mmr_after REAL,
        damage_to_player REAL, damage_from_player REAL, damage_to_monster REAL,
        heal_amount REAL, team_recover REAL, protect_absorb REAL, cc_time_to_player REAL,
        monster_kill INTEGER, route_id_of_start INTEGER, play_time REAL, total_time REAL, duration REAL,
        victory INTEGER, escape_state INTEGER, view_contribution REAL,
        add_surveillance_camera INTEGER, remove_surveillance_camera INTEGER,
        tactical_skill_group INTEGER, tactical_skill_level INTEGER, tactical_skill_use_count INTEGER,
        team_number INTEGER, pre_made INTEGER, premade_matching_type INTEGER,
        bot_added INTEGER, best_weapon INTEGER, trait_first_core INTEGER,
        start_dtm TEXT, started_at INTEGER,
        receipt_eligible INTEGER NOT NULL DEFAULT 0 CHECK(receipt_eligible IN (0, 1)),
        equipment_json TEXT, trait_first_sub_json TEXT, trait_second_sub_json TEXT,
        place_of_start_json TEXT, place_of_death_json TEXT, kill_monsters_json TEXT,
        collected_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, game_id)
      );
      CREATE TABLE IF NOT EXISTS er_collection_state (
        user_id TEXT NOT NULL REFERENCES er_users(user_id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('latest', 'backfill')),
        status TEXT NOT NULL CHECK(status IN ('idle', 'running', 'succeeded', 'failed')),
        cursor TEXT, boundary_game_id INTEGER,
        last_attempt_at INTEGER, last_success_at INTEGER, last_error TEXT, updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, kind)
      );
      CREATE TABLE IF NOT EXISTS er_reference_cache (
        data_type TEXT NOT NULL, cache_key TEXT NOT NULL DEFAULT 'default', payload_json TEXT NOT NULL,
        source_version TEXT, fetched_at INTEGER NOT NULL, expires_at INTEGER,
        PRIMARY KEY (data_type, cache_key)
      );
      CREATE TABLE IF NOT EXISTS er_season_profiles (
        user_id TEXT NOT NULL REFERENCES er_users(user_id) ON DELETE CASCADE,
        season_id INTEGER NOT NULL, matching_mode INTEGER NOT NULL,
        mmr REAL, rank INTEGER, server_rank INTEGER, stats_json TEXT, rank_json TEXT,
        fetched_at INTEGER NOT NULL, expires_at INTEGER,
        PRIMARY KEY (user_id, season_id, matching_mode)
      );
      CREATE TABLE IF NOT EXISTS er_game_receipts (
        receipt_id TEXT PRIMARY KEY,
        game_id INTEGER NOT NULL,
        channel_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'sending', 'sent', 'failed', 'suppressed')),
        detected_at INTEGER NOT NULL,
        sent_at INTEGER,
        message_id TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_attempt_at INTEGER,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (channel_id, game_id)
      );
      CREATE TABLE IF NOT EXISTS er_game_receipt_players (
        receipt_id TEXT NOT NULL REFERENCES er_game_receipts(receipt_id) ON DELETE CASCADE,
        game_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        nickname TEXT NOT NULL,
        team_number INTEGER,
        is_monitored INTEGER NOT NULL DEFAULT 0 CHECK(is_monitored IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (receipt_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_er_users_nickname ON er_users(normalized_nickname, last_seen_at DESC);
      CREATE INDEX IF NOT EXISTS idx_er_user_nicknames_lookup ON er_user_nicknames(normalized_nickname, last_seen_at DESC);
      CREATE INDEX IF NOT EXISTS idx_er_games_user_time ON er_games(user_id, started_at DESC, game_id DESC);
      CREATE INDEX IF NOT EXISTS idx_er_games_analysis ON er_games(user_id, matching_mode, character_num, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_er_games_season ON er_games(user_id, season_id, matching_mode, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_er_game_receipts_status
        ON er_game_receipts(status, detected_at, receipt_id);
      CREATE INDEX IF NOT EXISTS idx_er_game_receipt_players_user
        ON er_game_receipt_players(user_id, game_id);
    `);
    ensureColumns(this.#database, "er_users", {
      receipt_enabled: "INTEGER NOT NULL DEFAULT 0 CHECK(receipt_enabled IN (0, 1))",
      receipt_channel_id: "TEXT",
    });
    ensureColumns(this.#database, "er_games", {
      ...Object.fromEntries(Object.keys(NUMBER_FIELDS).map(column => [column, "REAL"])),
      ...Object.fromEntries(Object.keys(JSON_FIELDS).map(column => [column, "TEXT"])),
      receipt_eligible: "INTEGER NOT NULL DEFAULT 0 CHECK(receipt_eligible IN (0, 1))",
    });
  }
}

function gameUpsertSql(): string {
  const columns = ["user_id", "game_id", ...Object.keys(NUMBER_FIELDS), "game_version", "start_dtm", "started_at",
    ...Object.keys(JSON_FIELDS), "collected_at", "updated_at"];
  const updates = columns.filter(column => !["user_id", "game_id", "collected_at"].includes(column))
    .map(column => column === "receipt_details_json"
      ? `${column} = COALESCE(excluded.${column}, er_games.${column})`
      : `${column} = excluded.${column}`).join(",\n        ");
  return `INSERT INTO er_games (${columns.join(", ")}) VALUES (${columns.map(column => `@${column}`).join(", ")})
    ON CONFLICT(user_id, game_id) DO UPDATE SET ${updates}`;
}

function gameValues(userId: string, game: EternalReturnGame, now: number): Record<string, unknown> | undefined {
  const normalized = normalizeEternalReturnGame(game);
  if (!normalized) return undefined;
  const source = normalized as Record<string, unknown>;
  const gameId = nullableNumber(source.gameId);
  if (gameId === null || !Number.isSafeInteger(gameId)) return undefined;
  const values: Record<string, unknown> = { user_id: userId, game_id: gameId };
  for (const [column, field] of Object.entries(NUMBER_FIELDS)) values[column] = nullableNumber(source[field]);
  values.game_version = nullableString(source.gameVersion);
  values.start_dtm = nullableString(source.startDtm);
  values.started_at = parseDate(source.startDtm);
  for (const [column, field] of Object.entries(JSON_FIELDS)) values[column] = optionalJson(source[field]);
  values.collected_at = now;
  values.updated_at = now;
  return values;
}

function toGame(row: GameRow): StoredEternalReturnGame {
  const game: Record<string, unknown> = { userId: row.user_id, gameId: row.game_id };
  for (const [column, field] of Object.entries(NUMBER_FIELDS)) {
    if (row[column] !== null) game[field] = Number(row[column]);
  }
  if (row.game_version !== null) game.gameVersion = String(row.game_version);
  if (row.start_dtm !== null) game.startDtm = row.start_dtm;
  for (const [column, field] of Object.entries(JSON_FIELDS)) {
    if (row[column] !== null) game[field] = parseJson(String(row[column]));
  }
  const optional: Record<string, unknown> = {};
  for (const field of OPTIONAL_FIELD_NAMES) if (field in game) optional[field] = game[field];
  game.optional = optional;
  game.collectedAt = new Date(Number(row.collected_at));
  game.updatedAt = new Date(Number(row.updated_at));
  return game as unknown as StoredEternalReturnGame;
}

function toUser(row: UserRow): EternalReturnUserRecord {
  return { userId: row.user_id, nickname: row.nickname, normalizedNickname: row.normalized_nickname,
    autoRefresh: row.auto_refresh === 1, receiptEnabled: row.receipt_enabled === 1,
    ...(row.receipt_channel_id !== null ? { receiptChannelId: row.receipt_channel_id } : {}),
    firstSeenAt: new Date(row.first_seen_at), lastSeenAt: new Date(row.last_seen_at) };
}

function toReceipt(row: ReceiptRow): EternalReturnGameReceipt {
  return {
    receiptId: row.receipt_id,
    gameId: row.game_id,
    channelId: row.channel_id,
    status: row.status,
    detectedAt: new Date(row.detected_at),
    ...(row.sent_at !== null ? { sentAt: new Date(row.sent_at) } : {}),
    ...(row.message_id !== null ? { messageId: row.message_id } : {}),
    attemptCount: row.attempt_count,
    ...(row.last_attempt_at !== null ? { lastAttemptAt: new Date(row.last_attempt_at) } : {}),
    ...(row.last_error !== null ? { lastError: row.last_error } : {}),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function toReceiptPlayer(row: ReceiptPlayerRow): EternalReturnGameReceiptPlayer {
  return {
    receiptId: row.receipt_id,
    gameId: row.game_id,
    userId: row.user_id,
    nickname: row.nickname,
    ...(row.team_number !== null ? { teamNumber: row.team_number } : {}),
    isMonitored: row.is_monitored === 1,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function normalizeNickname(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("ko-KR");
}

function normalizeChannelId(value: string): string {
  const channelId = value.trim();
  if (!channelId) throw new Error("게임 결과를 보낼 디스코드 채널 ID가 필요합니다.");
  return channelId;
}

function normalizeOptionalChannelId(value: string | null): string | null {
  if (value === null) return null;
  return normalizeChannelId(value);
}

function normalizeGameId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`올바르지 않은 게임 ID입니다: ${value}`);
  return value;
}

function normalizeOptionalInteger(value: number | undefined): number | null {
  return Number.isSafeInteger(value) ? value! : null;
}

function createReceiptId(channelId: string, gameId: number): string {
  return createHash("sha256").update(channelId).update("\0").update(String(gameId)).digest("base64url").slice(0, 20);
}

function invalidReceiptTransition(receiptId: string, target: EternalReturnReceiptStatus): Error {
  return new Error(`게임 결과 발송 상태를 ${target}(으)로 바꿀 수 없습니다: ${receiptId}`);
}

function ensureColumns(
  database: Database.Database,
  table: "er_users" | "er_games",
  definitions: Readonly<Record<string, string>>,
): void {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  const existing = new Set(rows.map(row => row.name));
  for (const [column, definition] of Object.entries(definitions)) {
    if (existing.has(column)) continue;
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function requireUser(database: Database.Database, userId: string): void {
  if (!database.prepare("SELECT 1 FROM er_users WHERE user_id = ?").get(userId)) {
    throw new Error(`알 수 없는 이터널 리턴 UID입니다: ${userId}`);
  }
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseDate(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function optionalJson(value: unknown): string | null {
  return value === undefined || value === null ? null : stringifyJson(value);
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function clampLimit(value: number | undefined): number {
  if (value === undefined) return 20;
  if (!Number.isFinite(value)) return 20;
  return Math.max(1, Math.min(500, Math.trunc(value)));
}

function addGameFilters(
  conditions: string[],
  parameters: Record<string, unknown>,
  query: Pick<EternalReturnGameQuery, "matchingMode" | "characterNum" | "seasonId">,
): void {
  if (query.matchingMode !== undefined) {
    conditions.push("matching_mode = @matchingMode");
    parameters.matchingMode = query.matchingMode;
  }
  if (query.characterNum !== undefined) {
    conditions.push("character_num = @characterNum");
    parameters.characterNum = query.characterNum;
  }
  if (query.seasonId !== undefined) {
    conditions.push("season_id = @seasonId");
    parameters.seasonId = query.seasonId;
  }
}
