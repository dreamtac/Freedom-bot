import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import Database from "better-sqlite3";
import type { OverseasExchange } from "../sources/overseas-stocks.js";

export const MAX_PRICE_ALERT_STOCKS = 40;
export const PRICE_ALERT_THRESHOLDS = [3, 5, 8, 10] as const;
export const NIGHT_FUTURES_ALERT_THRESHOLDS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export type PriceAlertDirection = "up" | "down";

export interface PriceAlertStock {
  code: string;
  name: string;
  assetType: "domestic" | "overseas";
  market?: string;
  exchange?: OverseasExchange;
  createdAt: Date;
}

export interface PriceAlertEvent {
  code: string;
  tradingDate: string;
  direction: PriceAlertDirection;
  threshold: number;
}

interface PriceAlertStockRow {
  code: string;
  name: string;
  market: string | null;
  asset_type: "domestic" | "overseas";
  exchange: OverseasExchange | null;
  created_at: number;
}

export class PriceAlertStore {
  readonly #database: Database.Database;

  private constructor(database: Database.Database) {
    this.#database = database;
    this.#migrate();
  }

  static async open(filePath: string): Promise<PriceAlertStore> {
    await mkdir(dirname(filePath), { recursive: true });
    const database = new Database(filePath);
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    return new PriceAlertStore(database);
  }

  close(): void {
    this.#database.close();
  }

  count(): number {
    const row = this.#database
      .prepare("SELECT COUNT(*) AS count FROM price_alert_stocks")
      .get() as { count: number };
    return row.count;
  }

  add(stock: Omit<PriceAlertStock, "createdAt">): boolean {
    if (!this.isRegistered(stock.code) && this.count() >= MAX_PRICE_ALERT_STOCKS) {
      throw new Error(
        `실시간 주가 알림은 최대 ${MAX_PRICE_ALERT_STOCKS}종목까지 등록할 수 있습니다.`,
      );
    }

    const result = this.#database
      .prepare(
        `INSERT OR IGNORE INTO price_alert_stocks (
          code, name, asset_type, market, exchange, created_at
        ) VALUES (@code, @name, @assetType, @market, @exchange, @createdAt)`,
      )
      .run({
        code: stock.code,
        name: stock.name,
        assetType: stock.assetType,
        market: stock.market ?? null,
        exchange: stock.exchange ?? null,
        createdAt: Date.now(),
      });
    return result.changes > 0;
  }

  remove(code: string): boolean {
    const result = this.#database
      .prepare("DELETE FROM price_alert_stocks WHERE code = ?")
      .run(code);
    return result.changes > 0;
  }

  list(): PriceAlertStock[] {
    const rows = this.#database
      .prepare(
        `SELECT code, name, asset_type, market, exchange, created_at
         FROM price_alert_stocks
         ORDER BY created_at ASC, code ASC`,
      )
      .all() as PriceAlertStockRow[];
    return rows.map((row) => ({
      code: row.code,
      name: row.name,
      assetType: row.asset_type,
      ...(row.market ? { market: row.market } : {}),
      ...(row.exchange ? { exchange: row.exchange } : {}),
      createdAt: new Date(row.created_at),
    }));
  }

  get(code: string): PriceAlertStock | undefined {
    const row = this.#database
      .prepare(
        `SELECT code, name, asset_type, market, exchange, created_at
         FROM price_alert_stocks
         WHERE code = ?`,
      )
      .get(code) as PriceAlertStockRow | undefined;
    return row
      ? {
          code: row.code,
          name: row.name,
          assetType: row.asset_type,
          ...(row.market ? { market: row.market } : {}),
          ...(row.exchange ? { exchange: row.exchange } : {}),
          createdAt: new Date(row.created_at),
        }
      : undefined;
  }

  hasNotified(event: PriceAlertEvent): boolean {
    const row = this.#database
      .prepare(
        `SELECT 1 FROM price_alert_events
         WHERE code = @code
           AND trading_date = @tradingDate
           AND direction = @direction
           AND threshold = @threshold`,
      )
      .get(event) as { 1: number } | undefined;
    return row !== undefined;
  }

  markNotified(event: PriceAlertEvent, notifiedAt = new Date()): void {
    this.#database
      .prepare(
        `INSERT OR IGNORE INTO price_alert_events (
          code, trading_date, direction, threshold, notified_at
        ) VALUES (
          @code, @tradingDate, @direction, @threshold, @notifiedAt
        )`,
      )
      .run({ ...event, notifiedAt: notifiedAt.getTime() });
  }

  getOpeningPrice(code: string, tradingDate: string): number | undefined {
    const row = this.#database
      .prepare(
        `SELECT opening_price FROM price_alert_openings
         WHERE code = ? AND trading_date = ?`,
      )
      .get(code, tradingDate) as { opening_price: number } | undefined;
    return row?.opening_price;
  }

  saveOpeningPrice(code: string, tradingDate: string, openingPrice: number): void {
    this.#database
      .prepare(
        `INSERT INTO price_alert_openings (code, trading_date, opening_price, recorded_at)
         VALUES (@code, @tradingDate, @openingPrice, @recordedAt)
         ON CONFLICT(code, trading_date) DO UPDATE SET
           opening_price = excluded.opening_price,
           recorded_at = excluded.recorded_at`,
      )
      .run({
        code,
        tradingDate,
        openingPrice,
        recordedAt: Date.now(),
      });
  }

  isNightFuturesAlertEnabled(): boolean {
    const row = this.#database
      .prepare("SELECT enabled FROM night_futures_alert_settings WHERE id = 1")
      .get() as { enabled: number } | undefined;
    return row?.enabled === 1;
  }

  setNightFuturesAlertEnabled(enabled: boolean): void {
    this.#database
      .prepare(
        `INSERT INTO night_futures_alert_settings (id, enabled, updated_at)
         VALUES (1, @enabled, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           enabled = excluded.enabled,
           updated_at = excluded.updated_at`,
      )
      .run({ enabled: enabled ? 1 : 0, updatedAt: Date.now() });
  }

  hasNightFuturesNotified(event: Omit<PriceAlertEvent, "code">): boolean {
    const row = this.#database
      .prepare(
        `SELECT 1 FROM night_futures_alert_events
         WHERE trading_date = @tradingDate
           AND direction = @direction
           AND threshold = @threshold`,
      )
      .get(event) as { 1: number } | undefined;
    return row !== undefined;
  }

  markNightFuturesNotified(
    event: Omit<PriceAlertEvent, "code">,
    notifiedAt = new Date(),
  ): void {
    this.#database
      .prepare(
        `INSERT OR IGNORE INTO night_futures_alert_events (
          trading_date, direction, threshold, notified_at
        ) VALUES (
          @tradingDate, @direction, @threshold, @notifiedAt
        )`,
      )
      .run({ ...event, notifiedAt: notifiedAt.getTime() });
  }

  private isRegistered(code: string): boolean {
    const row = this.#database
      .prepare("SELECT 1 FROM price_alert_stocks WHERE code = ?")
      .get(code) as { 1: number } | undefined;
    return row !== undefined;
  }

  #migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS price_alert_stocks (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        asset_type TEXT NOT NULL DEFAULT 'domestic'
          CHECK(asset_type IN ('domestic', 'overseas')),
        market TEXT,
        exchange TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS price_alert_events (
        code TEXT NOT NULL,
        trading_date TEXT NOT NULL,
        direction TEXT NOT NULL CHECK(direction IN ('up', 'down')),
        threshold REAL NOT NULL,
        notified_at INTEGER NOT NULL,
        PRIMARY KEY (code, trading_date, direction, threshold)
      );

      CREATE INDEX IF NOT EXISTS idx_price_alert_events_date
        ON price_alert_events(trading_date, code);

      CREATE TABLE IF NOT EXISTS price_alert_openings (
        code TEXT NOT NULL,
        trading_date TEXT NOT NULL,
        opening_price REAL NOT NULL,
        recorded_at INTEGER NOT NULL,
        PRIMARY KEY (code, trading_date)
      );

      CREATE TABLE IF NOT EXISTS night_futures_alert_settings (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS night_futures_alert_events (
        trading_date TEXT NOT NULL,
        direction TEXT NOT NULL CHECK(direction IN ('up', 'down')),
        threshold REAL NOT NULL,
        notified_at INTEGER NOT NULL,
        PRIMARY KEY (trading_date, direction, threshold)
      );
    `);

    const columns = this.#database
      .prepare("PRAGMA table_info(price_alert_stocks)")
      .all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((column) => column.name));
    if (!columnNames.has("asset_type")) {
      this.#database.exec(
        "ALTER TABLE price_alert_stocks ADD COLUMN asset_type TEXT NOT NULL DEFAULT 'domestic'",
      );
    }
    if (!columnNames.has("exchange")) {
      this.#database.exec("ALTER TABLE price_alert_stocks ADD COLUMN exchange TEXT");
    }
  }
}
