import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import Database from "better-sqlite3";
import type { OverseasExchange } from "../sources/overseas-stocks.js";

export const MAX_PRICE_ALERT_STOCKS = 40;
export const MAX_PRICE_ALERT_STOCKS_WITH_NIGHT_FUTURES = MAX_PRICE_ALERT_STOCKS - 1;
export const PRICE_ALERT_THRESHOLDS = [3, 5, 8, 10] as const;
export const NIGHT_FUTURES_ALERT_THRESHOLDS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export type PriceAlertDirection = "up" | "down";
export type MarketCloseReportMarket = "domestic" | "overseas";

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

export interface NxtClosingPrice {
  tradingDate: string;
  price: number;
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
    const maximumStocks = this.getMaximumStockAlerts();
    if (!this.isRegistered(stock.code) && this.count() >= maximumStocks) {
      throw new Error(
        this.isNightFuturesAlertEnabled()
          ? `야간선물 알림이 켜져 있어 실시간 주가 알림은 최대 ${maximumStocks}종목까지 등록할 수 있습니다.`
          : `실시간 주가 알림은 최대 ${maximumStocks}종목까지 등록할 수 있습니다.`,
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
    let removed = 0;
    const transaction = this.#database.transaction(() => {
      removed = this.#database
        .prepare("DELETE FROM price_alert_stocks WHERE code = ?")
        .run(code).changes;
      if (removed === 0) {
        return;
      }
      this.#database.prepare("DELETE FROM price_alert_events WHERE code = ?").run(code);
      this.#database.prepare("DELETE FROM price_alert_openings WHERE code = ?").run(code);
      this.#database.prepare("DELETE FROM price_alert_nxt_closes WHERE code = ?").run(code);
    });
    transaction();
    return removed > 0;
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

  updateOverseasMetadata(
    code: string,
    metadata: { exchange: OverseasExchange },
  ): boolean {
    const result = this.#database
      .prepare(
        `UPDATE price_alert_stocks
         SET exchange = @exchange
         WHERE code = @code AND asset_type = 'overseas'`,
      )
      .run({
        code,
        exchange: metadata.exchange,
      });
    return result.changes > 0;
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

  hasSentMarketCloseReport(
    market: MarketCloseReportMarket,
    tradingDate: string,
  ): boolean {
    const row = this.#database
      .prepare(
        `SELECT 1 FROM market_close_reports
         WHERE market = ? AND trading_date = ?`,
      )
      .get(market, tradingDate) as { 1: number } | undefined;
    return row !== undefined;
  }

  markMarketCloseReportSent(
    market: MarketCloseReportMarket,
    tradingDate: string,
    notifiedAt = new Date(),
  ): void {
    this.#database
      .prepare(
        `INSERT OR IGNORE INTO market_close_reports (
          market, trading_date, notified_at
        ) VALUES (?, ?, ?)`,
      )
      .run(market, tradingDate, notifiedAt.getTime());
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

  saveNxtClosingPrice(code: string, tradingDate: string, price: number): void {
    this.#database
      .prepare(
        `INSERT INTO price_alert_nxt_closes (code, trading_date, closing_price, recorded_at)
         VALUES (@code, @tradingDate, @price, @recordedAt)
         ON CONFLICT(code, trading_date) DO UPDATE SET
           closing_price = excluded.closing_price,
           recorded_at = excluded.recorded_at`,
      )
      .run({
        code,
        tradingDate,
        price,
        recordedAt: Date.now(),
      });
  }

  getNxtClosingPrice(code: string, tradingDate: string): number | undefined {
    const row = this.#database
      .prepare(
        `SELECT closing_price FROM price_alert_nxt_closes
         WHERE code = ? AND trading_date = ?`,
      )
      .get(code, tradingDate) as { closing_price: number } | undefined;
    return row?.closing_price;
  }

  getLatestNxtClosingPriceBefore(
    code: string,
    tradingDate: string,
  ): NxtClosingPrice | undefined {
    const row = this.#database
      .prepare(
        `SELECT trading_date, closing_price
         FROM price_alert_nxt_closes
         WHERE code = ? AND trading_date < ?
         ORDER BY trading_date DESC
         LIMIT 1`,
      )
      .get(code, tradingDate) as
      | { trading_date: string; closing_price: number }
      | undefined;
    return row
      ? { tradingDate: row.trading_date, price: row.closing_price }
      : undefined;
  }

  isNightFuturesAlertEnabled(): boolean {
    const row = this.#database
      .prepare("SELECT enabled FROM night_futures_alert_settings WHERE id = 1")
      .get() as { enabled: number } | undefined;
    return row?.enabled === 1;
  }

  getMaximumStockAlerts(): number {
    return this.isNightFuturesAlertEnabled()
      ? MAX_PRICE_ALERT_STOCKS_WITH_NIGHT_FUTURES
      : MAX_PRICE_ALERT_STOCKS;
  }

  setNightFuturesAlertEnabled(enabled: boolean): boolean {
    if (enabled && this.count() >= MAX_PRICE_ALERT_STOCKS) {
      return false;
    }

    this.#database
      .prepare(
        `INSERT INTO night_futures_alert_settings (id, enabled, updated_at)
         VALUES (1, @enabled, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           enabled = excluded.enabled,
           updated_at = excluded.updated_at`,
      )
      .run({ enabled: enabled ? 1 : 0, updatedAt: Date.now() });
    return true;
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

      CREATE TABLE IF NOT EXISTS price_alert_nxt_closes (
        code TEXT NOT NULL,
        trading_date TEXT NOT NULL,
        closing_price REAL NOT NULL,
        recorded_at INTEGER NOT NULL,
        PRIMARY KEY (code, trading_date)
      );

      CREATE INDEX IF NOT EXISTS idx_price_alert_nxt_closes_code_date
        ON price_alert_nxt_closes(code, trading_date DESC);

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

      CREATE TABLE IF NOT EXISTS market_close_reports (
        market TEXT NOT NULL CHECK(market IN ('domestic', 'overseas')),
        trading_date TEXT NOT NULL,
        notified_at INTEGER NOT NULL,
        PRIMARY KEY (market, trading_date)
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
