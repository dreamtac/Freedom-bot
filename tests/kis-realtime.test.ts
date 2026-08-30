import { describe, expect, it, vi } from "vitest";
import type WebSocket from "ws";

import {
  KIS_REALTIME_INACTIVITY_TIMEOUT_MS,
  KisRealtimeClient,
  parseDomesticTradeMessage,
  parseKrxNightFuturesTradeMessage,
  parseOverseasTradeMessage,
} from "../src/sources/kis-realtime.js";

class FakeRealtimeWebSocket {
  closed = false;
  readonly pongs: string[] = [];
  readonly sent: string[] = [];
  onclose: WebSocket["onclose"] = null;
  onerror: WebSocket["onerror"] = null;
  onmessage: WebSocket["onmessage"] = null;
  onopen: WebSocket["onopen"] = null;

  close(): void {
    this.closed = true;
  }

  pong(data: string): void {
    this.pongs.push(data);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  open(): void {
    this.onopen?.(new Event("open") as Parameters<NonNullable<WebSocket["onopen"]>>[0]);
  }

  message(data: string): void {
    this.onmessage?.({ data } as Parameters<NonNullable<WebSocket["onmessage"]>>[0]);
  }
}

describe("KisRealtimeClient", () => {
  it("KIS PINGPONG 메시지에 원문 PONG을 반환한다", async () => {
    const socket = new FakeRealtimeWebSocket();
    const controller = new AbortController();
    const client = new KisRealtimeClient(
      {
        appKey: "app-key",
        appSecret: "app-secret",
        baseUrl: "https://openapi.example.com:9443",
        websocketUrl: "ws://ops.example.com:21000",
      },
      async () =>
        ({
          ok: true,
          json: async () => ({ approval_key: "approval-key" }),
        }) as Response,
      () => socket as unknown as WebSocket,
    );

    const streaming = client.streamPriceAlerts(
      [{ assetType: "domestic", code: "005930", market: "KRX" }],
      () => undefined,
      controller.signal,
    );

    await vi.waitFor(() => expect(socket.onopen).not.toBeNull());
    socket.open();
    const pingPong = JSON.stringify({ header: { tr_id: "PINGPONG" } });
    socket.message(pingPong);

    await vi.waitFor(() => expect(socket.pongs).toEqual([pingPong]));
    controller.abort();
    await streaming;
  });

  it("2분 동안 메시지가 없으면 소켓을 종료해 재연결할 수 있게 한다", async () => {
    vi.useFakeTimers();
    const socket = new FakeRealtimeWebSocket();
    const controller = new AbortController();
    const client = new KisRealtimeClient(
      {
        appKey: "app-key",
        appSecret: "app-secret",
        baseUrl: "https://openapi.example.com:9443",
        websocketUrl: "ws://ops.example.com:21000",
      },
      async () =>
        ({
          ok: true,
          json: async () => ({ approval_key: "approval-key" }),
        }) as Response,
      () => socket as unknown as WebSocket,
    );

    try {
      const streaming = client.streamPriceAlerts(
        [{ assetType: "domestic", code: "005930", market: "KRX" }],
        () => undefined,
        controller.signal,
      );
      await flushMicrotasks();
      expect(socket.onopen).not.toBeNull();
      socket.open();
      socket.message(createSubscriptionResponse());
      await flushMicrotasks();
      expect(client.getStatus()).toMatchObject({
        state: "connected",
        confirmedSubscriptions: 1,
        totalSubscriptions: 1,
      });

      const rejected = expect(streaming).rejects.toThrow("2분 동안 수신되지 않아 재연결");
      await vi.advanceTimersByTimeAsync(KIS_REALTIME_INACTIVITY_TIMEOUT_MS);
      await rejected;
      expect(socket.closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("KIS가 구독을 거절하면 즉시 연결을 종료한다", async () => {
    const socket = new FakeRealtimeWebSocket();
    const controller = new AbortController();
    const client = new KisRealtimeClient(
      {
        appKey: "app-key",
        appSecret: "app-secret",
        baseUrl: "https://openapi.example.com:9443",
        websocketUrl: "ws://ops.example.com:21000",
      },
      async () => Response.json({ approval_key: "approval-key" }),
      () => socket as unknown as WebSocket,
    );

    const streaming = client.streamPriceAlerts(
      [{ assetType: "domestic", code: "005930", market: "KRX" }],
      () => undefined,
      controller.signal,
    );
    await vi.waitFor(() => expect(socket.onopen).not.toBeNull());
    const rejected = expect(streaming).rejects.toThrow("구독이 거절되었습니다");
    socket.open();
    socket.message(createSubscriptionResponse("1", "구독 한도를 초과했습니다."));

    await rejected;
    expect(socket.closed).toBe(true);
    expect(client.getStatus()).toMatchObject({
      state: "error",
      confirmedSubscriptions: 0,
      totalSubscriptions: 1,
    });
  });

  it("미국 종목 구독 정보로 공식 해외 체결 메시지에 거래소를 연결한다", async () => {
    const socket = new FakeRealtimeWebSocket();
    const controller = new AbortController();
    const ticks: unknown[] = [];
    const client = new KisRealtimeClient(
      {
        appKey: "app-key",
        appSecret: "app-secret",
        baseUrl: "https://openapi.example.com:9443",
        websocketUrl: "ws://ops.example.com:21000",
      },
      async () => Response.json({ approval_key: "approval-key" }),
      () => socket as unknown as WebSocket,
    );

    const streaming = client.streamPriceAlerts(
      [{ assetType: "overseas", symbol: "SOXL", exchange: "AMS" }],
      (tick) => ticks.push(tick),
      controller.signal,
    );
    await vi.waitFor(() => expect(socket.onopen).not.toBeNull());
    socket.open();
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({
      body: { input: { tr_id: "HDFSCNT0", tr_key: "DAMSSOXL" } },
    });
    socket.message(createSubscriptionResponse("0", "정상처리 되었습니다.", "HDFSCNT0", "DAMSSOXL"));
    socket.message(createOverseasTradeMessage("SOXL", 85, 100));

    await vi.waitFor(() => expect(ticks).toMatchObject([
      { assetType: "overseas", code: "SOXL", market: "AMS", price: 85, open: 100 },
    ]));
    expect(client.getStatus().lastTickAt?.overseas).toBeTypeOf("number");
    controller.abort();
    await streaming;
  });

  it("미국 데이장은 거래소별 주간거래 구독키를 사용한다", async () => {
    const socket = new FakeRealtimeWebSocket();
    const controller = new AbortController();
    const client = new KisRealtimeClient(
      {
        appKey: "app-key",
        appSecret: "app-secret",
        baseUrl: "https://openapi.example.com:9443",
        websocketUrl: "ws://ops.example.com:21000",
      },
      async () => Response.json({ approval_key: "approval-key" }),
      () => socket as unknown as WebSocket,
    );

    const streaming = client.streamPriceAlerts(
      [{ assetType: "overseas", symbol: "SOXL", exchange: "AMS", session: "day" }],
      () => undefined,
      controller.signal,
    );
    await vi.waitFor(() => expect(socket.onopen).not.toBeNull());
    socket.open();
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({
      body: { input: { tr_id: "HDFSCNT0", tr_key: "RBAASOXL" } },
    });
    socket.message(createSubscriptionResponse("0", "정상처리 되었습니다.", "HDFSCNT0", "RBAASOXL"));
    controller.abort();
    await streaming;
  });
});

function createSubscriptionResponse(
  resultCode = "0",
  message = "정상처리 되었습니다.",
  transactionId = "H0UNCNT0",
  key = "005930",
): string {
  return JSON.stringify({
    header: { tr_id: transactionId, tr_key: key },
    body: { rt_cd: resultCode, msg1: message },
  });
}

async function flushMicrotasks(): Promise<void> {
  for (let count = 0; count < 10; count += 1) {
    await Promise.resolve();
  }
}

describe("parseDomesticTradeMessage", () => {
  it("KIS 국내 체결가 WebSocket 메시지에서 현재가와 시가를 읽는다", () => {
    const values = Array<string>(46).fill("");
    values[0] = "005930";
    values[1] = "093001";
    values[2] = "72000";
    values[3] = "2";
    values[4] = "500";
    values[5] = "0.70";
    values[6] = "71800";
    values[7] = "71500";
    values[8] = "72500";
    values[9] = "71000";
    values[10] = "72100";
    values[11] = "72000";
    values[12] = "3";
    values[13] = "1234567";
    values[14] = "100000000";
    const row = values.join("^");

    expect(parseDomesticTradeMessage(`0|H0UNCNT0|001|${row}`)).toEqual([
      {
        code: "005930",
        market: "KRX",
        assetType: "domestic",
        tradeTime: "093001",
        price: 72_000,
        open: 71_500,
        high: 72_500,
        low: 71_000,
        volume: 1_234_567,
        change: 500,
        changeRate: 0.7,
      },
    ]);
  });

  it("다른 형식의 메시지와 시가가 없는 틱은 무시한다", () => {
    expect(parseDomesticTradeMessage("0|PINGPONG|001|anything")).toEqual([]);
    expect(parseDomesticTradeMessage("0|H0UNCNT0|001|005930^093001^72000")).toEqual([]);
  });

  it("NXT 체결가 메시지를 NXT 시장 틱으로 구분한다", () => {
    const values = Array<string>(46).fill("");
    values[0] = "005930";
    values[2] = "72500";
    values[7] = "71500";

    expect(parseDomesticTradeMessage(`0|H0NXCNT0|001|${values.join("^")}`)).toMatchObject([
      { code: "005930", market: "NXT", assetType: "domestic", price: 72_500, open: 71_500 },
    ]);
  });

  it("KIS 미국 주식 체결가 WebSocket 메시지를 읽는다", () => {
    const values = [
      "DNASAAPL", "AAPL", "2", "20260720", "20260720", "093001", "20260720", "223001",
      "180.00", "182.00", "179.50", "181.25", "2", "1.25", "0.69",
      "181.24", "181.26", "10", "12", "100", "1234567", "223456789",
      "534567", "700000", "130.00", "1",
    ];
    expect(parseOverseasTradeMessage(
      "0|HDFSCNT0|001|" + values.join("^"),
      new Map([["AAPL", "NAS"]]),
    )).toEqual([
      {
        code: "AAPL",
        market: "NAS",
        assetType: "overseas",
        tradingDate: "20260720",
        tradeTime: "093001",
        price: 181.25,
        open: 180,
        high: 182,
        low: 179.5,
        volume: 1_234_567,
        change: 1.25,
        changeRate: 0.69,
      },
    ]);
  });

  it("KIS KRX 야간선물 체결가 WebSocket 메시지를 읽는다", () => {
    const values = Array<string>(49).fill("");
    values[0] = "1A01609";
    values[1] = "215900";
    values[2] = "28.75";
    values[3] = "5";
    values[4] = "2.54";
    values[5] = "1103.75";
    values[6] = "1136.55";
    values[7] = "1140.20";
    values[8] = "1099.00";
    values[10] = "8568";

    expect(parseKrxNightFuturesTradeMessage(`0|H0MFCNT0|001|${values.join("^")}`)).toEqual([
      {
        code: "1A01609",
        market: "KRX_NIGHT_FUTURES",
        assetType: "nightFutures",
        tradeTime: "215900",
        price: 1103.75,
        open: 1136.55,
        high: 1140.2,
        low: 1099,
        volume: 8568,
        change: -28.75,
        changeRate: -2.54,
      },
    ]);
  });
});

function createOverseasTradeMessage(symbol: string, price: number, open: number): string {
  const values = [
    `DAMS${symbol}`, symbol, "2", "20260824", "20260824", "153000", "20260825", "043000",
    String(open), String(open), String(price), String(price), "5", String(open - price),
    "-15.00", String(price - 0.01), String(price + 0.01), "10", "12", "100",
    "1234567", "223456789", "700000", "534567", "95.00", "1",
  ];
  return `0|HDFSCNT0|001|${values.join("^")}`;
}
