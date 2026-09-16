import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import Database from "better-sqlite3";

import type { EternalReturnGame } from "../sources/eternal-return.js";

export type EternalReturnCollectionKind = "latest" | "backfill";
export type EternalReturnCollectionStatus = "idle" | "running" | "succeeded" | "failed";

export interface EternalReturnUserRecord {
  userId: string;
  nickname: string;
  normalizedNickname: string;
  autoRefresh: boolean;
  firstSeenAt: Date;
  lastSeenAt: Date;
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
  first_seen_at: number;
  last_seen_at: number;
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
  trait_first_core: "traitFirstCore",
} as const;

const JSON_FIELDS = {
  equipment_json: "equipment",
  trait_first_sub_json: "traitFirstSub",
  trait_second_sub_json: "traitSecondSub",
  place_of_start_json: "placeOfStart",
  place_of_death_json: "placeOfDeath",
  kill_monsters_json: "killMonsters",
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
      if (collection) this.#writeCollectionState(userId, collection, timestamp);
    });
    transaction();
    return changed;
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
      CREATE INDEX IF NOT EXISTS idx_er_users_nickname ON er_users(normalized_nickname, last_seen_at DESC);
      CREATE INDEX IF NOT EXISTS idx_er_user_nicknames_lookup ON er_user_nicknames(normalized_nickname, last_seen_at DESC);
      CREATE INDEX IF NOT EXISTS idx_er_games_user_time ON er_games(user_id, started_at DESC, game_id DESC);
      CREATE INDEX IF NOT EXISTS idx_er_games_analysis ON er_games(user_id, matching_mode, character_num, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_er_games_season ON er_games(user_id, season_id, matching_mode, started_at DESC);
    `);
  }
}

function gameUpsertSql(): string {
  const columns = ["user_id", "game_id", ...Object.keys(NUMBER_FIELDS), "game_version", "start_dtm", "started_at",
    ...Object.keys(JSON_FIELDS), "collected_at", "updated_at"];
  const updates = columns.filter(column => !["user_id", "game_id", "collected_at"].includes(column))
    .map(column => `${column} = excluded.${column}`).join(",\n        ");
  return `INSERT INTO er_games (${columns.join(", ")}) VALUES (${columns.map(column => `@${column}`).join(", ")})
    ON CONFLICT(user_id, game_id) DO UPDATE SET ${updates}`;
}

function gameValues(userId: string, game: EternalReturnGame, now: number): Record<string, unknown> | undefined {
  const source = game as Record<string, unknown>;
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
    autoRefresh: row.auto_refresh === 1, firstSeenAt: new Date(row.first_seen_at), lastSeenAt: new Date(row.last_seen_at) };
}

function normalizeNickname(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("ko-KR");
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
