import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import Database from "better-sqlite3";

import {
  DEFAULT_DOMESTIC_STOCKS,
  normalizeStockName,
  StockLookupError,
} from "../sources/domestic-stocks.js";
import type {
  DomesticStockEntry,
  DomesticStockMatch,
} from "../sources/domestic-stocks.js";
import type {
  OverseasExchange,
  OverseasStockEntry,
  OverseasStockMatch,
} from "../sources/overseas-stocks.js";

interface DomesticStockRow {
  code: string;
  name: string;
  market: string | null;
}

interface OverseasStockRow {
  symbol: string;
  exchange: OverseasExchange;
  name: string;
}

export interface StockSuggestion {
  code: string;
  name: string;
  market?: string;
}

export interface DomesticStockImportResult {
  insertedOrUpdated: number;
  total: number;
}

export interface OverseasStockSuggestion {
  symbol: string;
  exchange: OverseasExchange;
  name: string;
}

export interface OverseasStockImportResult {
  insertedOrUpdated: number;
  total: number;
}

export class StockStore {
  readonly #database: Database.Database;

  private constructor(database: Database.Database) {
    this.#database = database;
    this.#migrate();
    this.seedDefaults();
  }

  static async open(filePath: string): Promise<StockStore> {
    await mkdir(dirname(filePath), { recursive: true });
    const database = new Database(filePath);
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    return new StockStore(database);
  }

  close(): void {
    this.#database.close();
  }

  count(): number {
    const row = this.#database
      .prepare("SELECT COUNT(*) AS count FROM domestic_stocks")
      .get() as { count: number };
    return row.count;
  }

  countOverseas(): number {
    const row = this.#database
      .prepare("SELECT COUNT(*) AS count FROM overseas_stocks")
      .get() as { count: number };
    return row.count;
  }

  importStocks(
    stocks: readonly DomesticStockEntry[],
    source = "manual",
  ): DomesticStockImportResult {
    const now = Date.now();
    const stockStatement = this.#database.prepare(`
      INSERT INTO domestic_stocks (
        code, name, normalized_name, market, source, updated_at
      ) VALUES (
        @code, @name, @normalizedName, @market, @source, @updatedAt
      )
      ON CONFLICT(code) DO UPDATE SET
        name = excluded.name,
        normalized_name = excluded.normalized_name,
        market = excluded.market,
        source = excluded.source,
        updated_at = excluded.updated_at
    `);
    const deleteAliasStatement = this.#database.prepare(
      "DELETE FROM domestic_stock_aliases WHERE code = ?",
    );
    const aliasStatement = this.#database.prepare(`
      INSERT OR IGNORE INTO domestic_stock_aliases (
        code, alias, normalized_alias
      ) VALUES (
        @code, @alias, @normalizedAlias
      )
    `);

    let insertedOrUpdated = 0;
    const transaction = this.#database.transaction(() => {
      for (const stock of stocks) {
        if (!/^\d{6}$/.test(stock.code)) {
          continue;
        }

        const result = stockStatement.run({
          code: stock.code,
          name: stock.name,
          normalizedName: normalizeStockName(stock.name),
          market: stock.market ?? null,
          source,
          updatedAt: now,
        });
        insertedOrUpdated += result.changes;
        deleteAliasStatement.run(stock.code);

        for (const alias of getAliases(stock)) {
          aliasStatement.run({
            code: stock.code,
            alias,
            normalizedAlias: normalizeStockName(alias),
          });
        }
      }
    });
    transaction();

    return {
      insertedOrUpdated,
      total: this.count(),
    };
  }

  importOverseasStocks(
    stocks: readonly OverseasStockEntry[],
    source = "manual",
  ): OverseasStockImportResult {
    const now = Date.now();
    const stockStatement = this.#database.prepare(`
      INSERT INTO overseas_stocks (
        symbol, exchange, name, normalized_name, source, updated_at
      ) VALUES (
        @symbol, @exchange, @name, @normalizedName, @source, @updatedAt
      )
      ON CONFLICT(symbol, exchange) DO UPDATE SET
        name = excluded.name,
        normalized_name = excluded.normalized_name,
        source = excluded.source,
        updated_at = excluded.updated_at
    `);
    const deleteAliasStatement = this.#database.prepare(
      "DELETE FROM overseas_stock_aliases WHERE symbol = ? AND exchange = ?",
    );
    const aliasStatement = this.#database.prepare(`
      INSERT OR IGNORE INTO overseas_stock_aliases (
        symbol, exchange, alias, normalized_alias
      ) VALUES (
        @symbol, @exchange, @alias, @normalizedAlias
      )
    `);

    let insertedOrUpdated = 0;
    const transaction = this.#database.transaction(() => {
      for (const stock of stocks) {
        if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(stock.symbol)) {
          continue;
        }

        const result = stockStatement.run({
          symbol: stock.symbol,
          exchange: stock.exchange,
          name: stock.name,
          normalizedName: normalizeStockName(stock.name),
          source,
          updatedAt: now,
        });
        insertedOrUpdated += result.changes;
        deleteAliasStatement.run(stock.symbol, stock.exchange);
        for (const alias of getOverseasAliases(stock)) {
          aliasStatement.run({
            symbol: stock.symbol,
            exchange: stock.exchange,
            alias,
            normalizedAlias: normalizeStockName(alias),
          });
        }
      }
    });
    transaction();

    return { insertedOrUpdated, total: this.countOverseas() };
  }

  resolve(query: string): DomesticStockMatch {
    const normalizedQuery = normalizeStockName(query);
    if (/^\d{6}$/.test(normalizedQuery)) {
      const stock = this.findByCode(normalizedQuery);
      return {
        code: normalizedQuery,
        ...(stock ? { name: stock.name } : {}),
        ...(stock?.market ? { market: stock.market } : {}),
        matchedBy: "code",
      };
    }

    const exactMatches = this.findByAlias(normalizedQuery, false);
    if (exactMatches.length === 1) {
      return toMatch(exactMatches[0], "name");
    }

    if (exactMatches.length > 1) {
      throw new StockLookupError(
        `종목명이 여러 개와 일치합니다: ${formatSuggestions(exactMatches)}`,
      );
    }

    const partialMatches = this.findByAlias(normalizedQuery, true);
    if (partialMatches.length === 1) {
      return toMatch(partialMatches[0], "name");
    }

    if (partialMatches.length > 1) {
      throw new StockLookupError(
        `종목명이 여러 개와 일치합니다: ${formatSuggestions(partialMatches)}`,
      );
    }

    throw new StockLookupError(
      "종목을 찾지 못했습니다. 6자리 종목코드나 등록된 종목명을 입력해 주세요.",
    );
  }

  suggest(query: string, limit = 25): StockSuggestion[] {
    const normalizedQuery = normalizeStockName(query);
    if (normalizedQuery.length === 0) {
      return this.listPopular(limit).map(toSuggestion);
    }

    if (/^\d+$/.test(normalizedQuery)) {
      return this.findByCodePrefix(normalizedQuery, limit).map(toSuggestion);
    }

    return this.findByAliasPrefix(normalizedQuery, limit).map(toSuggestion);
  }

  resolveOverseas(query: string): OverseasStockMatch {
    const normalizedQuery = normalizeStockName(query);
    const symbol = query.trim().toUpperCase();
    if (/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) {
      const matches = this.findOverseasBySymbol(symbol);
      if (matches.length === 1) {
        return toOverseasMatch(matches[0], "symbol");
      }
      if (matches.length > 1) {
        throw new StockLookupError(
          `종목명이 여러 개와 일치합니다: ${formatOverseasSuggestions(matches)}`,
        );
      }
    }

    const exactMatches = this.findOverseasByAlias(normalizedQuery, false);
    if (exactMatches.length === 1) {
      return toOverseasMatch(exactMatches[0], "name");
    }
    if (exactMatches.length > 1) {
      throw new StockLookupError(
        `종목명이 여러 개와 일치합니다: ${formatOverseasSuggestions(exactMatches)}`,
      );
    }

    const partialMatches = this.findOverseasByAlias(normalizedQuery, true);
    if (partialMatches.length === 1) {
      return toOverseasMatch(partialMatches[0], "name");
    }
    if (partialMatches.length > 1) {
      throw new StockLookupError(
        `종목명이 여러 개와 일치합니다: ${formatOverseasSuggestions(partialMatches)}`,
      );
    }

    throw new StockLookupError(
      "미국 주식을 찾지 못했습니다. 티커 또는 미국 상장 종목명을 입력해 주세요.",
    );
  }

  suggestOverseas(query: string, limit = 25): OverseasStockSuggestion[] {
    const normalizedQuery = normalizeStockName(query);
    if (normalizedQuery.length === 0) {
      return this.listOverseasPopular(limit).map(toOverseasSuggestion);
    }

    if (/^[a-z][a-z0-9.-]{0,9}$/i.test(query.trim())) {
      return this.findOverseasBySymbolPrefix(query.trim().toUpperCase(), limit)
        .map(toOverseasSuggestion);
    }
    return this.findOverseasByAliasPrefix(normalizedQuery, limit)
      .map(toOverseasSuggestion);
  }

  private seedDefaults(): void {
    if (this.count() > 0) {
      return;
    }

    this.importStocks(DEFAULT_DOMESTIC_STOCKS, "seed");
  }

  private findByCode(code: string): DomesticStockRow | undefined {
    const row = this.#database
      .prepare("SELECT code, name, market FROM domestic_stocks WHERE code = ?")
      .get(code) as DomesticStockRow | undefined;
    return row;
  }

  private findByAlias(
    normalizedQuery: string,
    partial: boolean,
  ): DomesticStockRow[] {
    const condition = partial
      ? "a.normalized_alias LIKE ? ESCAPE '\\'"
      : "a.normalized_alias = ?";
    const value = partial ? `%${escapeLike(normalizedQuery)}%` : normalizedQuery;
    return this.#database
      .prepare(
        `SELECT DISTINCT s.code, s.name, s.market
         FROM domestic_stock_aliases a
         JOIN domestic_stocks s ON s.code = a.code
         WHERE ${condition}
         ORDER BY
           CASE WHEN a.normalized_alias = ? THEN 0 ELSE 1 END,
           LENGTH(a.normalized_alias) ASC,
           s.code ASC
         LIMIT 6`,
      )
      .all(value, normalizedQuery) as DomesticStockRow[];
  }

  private findByCodePrefix(prefix: string, limit: number): DomesticStockRow[] {
    return this.#database
      .prepare(
        `SELECT code, name, market
         FROM domestic_stocks
         WHERE code LIKE ? ESCAPE '\\'
         ORDER BY code ASC
         LIMIT ?`,
      )
      .all(`${escapeLike(prefix)}%`, limit) as DomesticStockRow[];
  }

  private findByAliasPrefix(
    normalizedQuery: string,
    limit: number,
  ): DomesticStockRow[] {
    return this.#database
      .prepare(
        `SELECT DISTINCT s.code, s.name, s.market
         FROM domestic_stock_aliases a
         JOIN domestic_stocks s ON s.code = a.code
         WHERE a.normalized_alias LIKE ? ESCAPE '\\'
         ORDER BY
           CASE WHEN a.normalized_alias = ? THEN 0 ELSE 1 END,
           CASE WHEN a.normalized_alias LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END,
           LENGTH(a.normalized_alias) ASC,
           s.code ASC
         LIMIT ?`,
      )
      .all(
        `%${escapeLike(normalizedQuery)}%`,
        normalizedQuery,
        `${escapeLike(normalizedQuery)}%`,
        limit,
      ) as DomesticStockRow[];
  }

  private listPopular(limit: number): DomesticStockRow[] {
    return this.#database
      .prepare(
        `SELECT code, name, market
         FROM domestic_stocks
         ORDER BY
           CASE code
             WHEN '005930' THEN 0
             WHEN '000660' THEN 1
             WHEN '042700' THEN 2
             WHEN '264850' THEN 3
             ELSE 4
           END,
           code ASC
         LIMIT ?`,
      )
      .all(limit) as DomesticStockRow[];
  }

  private findOverseasBySymbol(symbol: string): OverseasStockRow[] {
    return this.#database
      .prepare(`
        SELECT symbol, exchange, name FROM overseas_stocks
        WHERE symbol = ?
        ORDER BY CASE exchange WHEN 'NAS' THEN 0 WHEN 'NYS' THEN 1 ELSE 2 END
        LIMIT 6
      `)
      .all(symbol) as OverseasStockRow[];
  }

  private findOverseasByAlias(
    normalizedQuery: string,
    partial: boolean,
  ): OverseasStockRow[] {
    const condition = partial
      ? "a.normalized_alias LIKE ? ESCAPE '\\'"
      : "a.normalized_alias = ?";
    const value = partial ? `%${escapeLike(normalizedQuery)}%` : normalizedQuery;
    return this.#database
      .prepare(`
        SELECT DISTINCT s.symbol, s.exchange, s.name
        FROM overseas_stock_aliases a
        JOIN overseas_stocks s
          ON s.symbol = a.symbol AND s.exchange = a.exchange
        WHERE ${condition}
        ORDER BY
          CASE WHEN a.normalized_alias = ? THEN 0 ELSE 1 END,
          LENGTH(a.normalized_alias) ASC, s.symbol ASC
        LIMIT 6
      `)
      .all(value, normalizedQuery) as OverseasStockRow[];
  }

  private findOverseasBySymbolPrefix(
    prefix: string,
    limit: number,
  ): OverseasStockRow[] {
    return this.#database
      .prepare(`
        SELECT symbol, exchange, name FROM overseas_stocks
        WHERE symbol LIKE ? ESCAPE '\\'
        ORDER BY symbol ASC, exchange ASC
        LIMIT ?
      `)
      .all(`${escapeLike(prefix)}%`, limit) as OverseasStockRow[];
  }

  private findOverseasByAliasPrefix(
    normalizedQuery: string,
    limit: number,
  ): OverseasStockRow[] {
    return this.#database
      .prepare(`
        SELECT DISTINCT s.symbol, s.exchange, s.name
        FROM overseas_stock_aliases a
        JOIN overseas_stocks s
          ON s.symbol = a.symbol AND s.exchange = a.exchange
        WHERE a.normalized_alias LIKE ? ESCAPE '\\'
        ORDER BY
          CASE WHEN a.normalized_alias = ? THEN 0 ELSE 1 END,
          CASE WHEN a.normalized_alias LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END,
          LENGTH(a.normalized_alias) ASC, s.symbol ASC
        LIMIT ?
      `)
      .all(
        `%${escapeLike(normalizedQuery)}%`,
        normalizedQuery,
        `${escapeLike(normalizedQuery)}%`,
        limit,
      ) as OverseasStockRow[];
  }

  private listOverseasPopular(limit: number): OverseasStockRow[] {
    return this.#database
      .prepare(`
        SELECT symbol, exchange, name FROM overseas_stocks
        ORDER BY
          CASE symbol
            WHEN 'AAPL' THEN 0 WHEN 'NVDA' THEN 1 WHEN 'TSLA' THEN 2
            WHEN 'MSFT' THEN 3 WHEN 'SPCX' THEN 4 ELSE 5
          END,
          symbol ASC
        LIMIT ?
      `)
      .all(limit) as OverseasStockRow[];
  }

  #migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS domestic_stocks (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        market TEXT,
        source TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS domestic_stock_aliases (
        code TEXT NOT NULL,
        alias TEXT NOT NULL,
        normalized_alias TEXT NOT NULL,
        PRIMARY KEY (normalized_alias, code),
        FOREIGN KEY (code) REFERENCES domestic_stocks(code) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_domestic_stocks_normalized_name
        ON domestic_stocks(normalized_name);

      CREATE INDEX IF NOT EXISTS idx_domestic_stock_aliases_code
        ON domestic_stock_aliases(code);

      CREATE TABLE IF NOT EXISTS overseas_stocks (
        symbol TEXT NOT NULL,
        exchange TEXT NOT NULL CHECK(exchange IN ('NAS', 'NYS', 'AMS')),
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        source TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (symbol, exchange)
      );

      CREATE TABLE IF NOT EXISTS overseas_stock_aliases (
        symbol TEXT NOT NULL,
        exchange TEXT NOT NULL,
        alias TEXT NOT NULL,
        normalized_alias TEXT NOT NULL,
        PRIMARY KEY (normalized_alias, symbol, exchange),
        FOREIGN KEY (symbol, exchange)
          REFERENCES overseas_stocks(symbol, exchange) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_overseas_stocks_normalized_name
        ON overseas_stocks(normalized_name);
      CREATE INDEX IF NOT EXISTS idx_overseas_stock_aliases_symbol
        ON overseas_stock_aliases(symbol, exchange);
    `);
  }
}

function toMatch(
  stock: DomesticStockRow | undefined,
  matchedBy: "code" | "name",
): DomesticStockMatch {
  if (!stock) {
    throw new StockLookupError("종목을 찾지 못했습니다.");
  }

  return {
    code: stock.code,
    name: stock.name,
    ...(stock.market ? { market: stock.market } : {}),
    matchedBy,
  };
}

function toSuggestion(stock: DomesticStockRow): StockSuggestion {
  return {
    code: stock.code,
    name: stock.name,
    ...(stock.market ? { market: stock.market } : {}),
  };
}

function getAliases(stock: DomesticStockEntry): readonly string[] {
  return [stock.name, stock.code, ...(stock.aliases ?? [])];
}

function getOverseasAliases(stock: OverseasStockEntry): readonly string[] {
  return [stock.name, stock.symbol, ...(stock.aliases ?? [])];
}

function formatSuggestions(stocks: readonly DomesticStockRow[]): string {
  return stocks
    .slice(0, 5)
    .map((stock) => `${stock.name}(${stock.code})`)
    .join(", ");
}

function toOverseasMatch(
  stock: OverseasStockRow | undefined,
  matchedBy: "symbol" | "name",
): OverseasStockMatch {
  if (!stock) {
    throw new StockLookupError("미국 주식을 찾지 못했습니다.");
  }
  return {
    symbol: stock.symbol,
    exchange: stock.exchange,
    name: stock.name,
    matchedBy,
  };
}

function toOverseasSuggestion(stock: OverseasStockRow): OverseasStockSuggestion {
  return { symbol: stock.symbol, exchange: stock.exchange, name: stock.name };
}

function formatOverseasSuggestions(stocks: readonly OverseasStockRow[]): string {
  return stocks
    .slice(0, 5)
    .map((stock) => `${stock.name}(${stock.symbol})`)
    .join(", ");
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
