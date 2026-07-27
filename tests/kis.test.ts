import { describe, expect, it } from "vitest";

import {
  KisClient,
  normalizeDomesticStockCode,
  normalizeFuturesCode,
} from "../src/sources/kis.js";

describe("normalizeDomesticStockCode", () => {
  it("6자리 국내 종목코드를 허용한다", () => {
    expect(normalizeDomesticStockCode("005930")).toBe("005930");
  });

  it("잘못된 국내 종목코드는 거부한다", () => {
    expect(() => normalizeDomesticStockCode("AAPL")).toThrow(
      "국내 주식 종목코드는 6자리 숫자여야 합니다.",
    );
  });
});

describe("normalizeFuturesCode", () => {
  it("영숫자 야간선물 종목코드를 허용한다", () => {
    expect(normalizeFuturesCode("1a01609")).toBe("1A01609");
  });
});

describe("KisClient", () => {
  it("접근 토큰을 발급받아 국내 현재가를 조회한다", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (input: string | URL, init?: RequestInit) => {
      requests.push({ url: input.toString(), init });

      if (input.toString().endsWith("/oauth2/tokenP")) {
        return Response.json({
          access_token: "test-access-token",
          expires_in: 3600,
        });
      }

      return Response.json({
        rt_cd: "0",
        msg1: "정상처리 되었습니다.",
        output: {
          hts_kor_isnm: "삼성전자",
          rprs_mrkt_kor_name: "KOSPI",
          stck_prpr: "72000",
          prdy_vrss: "500",
          prdy_vrss_sign: "2",
          prdy_ctrt: "0.70",
          stck_oprc: "71500",
          stck_hgpr: "72500",
          stck_lwpr: "71000",
          acml_vol: "1234567",
        },
      });
    };

    const client = new KisClient(
      {
        appKey: "app-key",
        appSecret: "app-secret",
        baseUrl: "https://openapi.example.com:9443",
      },
      fetchImpl,
    );

    await expect(client.fetchDomesticQuote("005930")).resolves.toMatchObject({
      code: "005930",
      marketCode: "J",
      name: "삼성전자",
      marketName: "KOSPI",
      price: 72_000,
      change: 500,
      changeRate: 0.7,
      changeDirection: "up",
      volume: 1_234_567,
    });

    expect(requests).toHaveLength(2);
    expect(requests[1]?.url).toContain(
      "/uapi/domestic-stock/v1/quotations/inquire-price",
    );
    expect(requests[1]?.url).toContain("FID_INPUT_ISCD=005930");
    expect(requests[1]?.url).toContain("FID_COND_MRKT_DIV_CODE=J");
    expect(requests[1]?.init?.headers).toMatchObject({
      authorization: "Bearer test-access-token",
      tr_id: "FHKST01010100",
    });
  });

  it("NXT 시장 구분 코드로 현재가를 조회할 수 있다", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (input: string | URL, init?: RequestInit) => {
      requests.push({ url: input.toString(), init });

      if (input.toString().endsWith("/oauth2/tokenP")) {
        return Response.json({
          access_token: "test-nxt-access-token",
          expires_in: 3600,
        });
      }

      return Response.json({
        rt_cd: "0",
        output: {
          hts_kor_isnm: "삼성전자",
          rprs_mrkt_kor_name: "NXT",
          stck_prpr: "72100",
          prdy_vrss: "600",
          prdy_vrss_sign: "2",
          prdy_ctrt: "0.84",
        },
      });
    };

    const client = new KisClient(
      {
        appKey: "nxt-app-key",
        appSecret: "app-secret",
        baseUrl: "https://openapi.example.com:9443",
      },
      fetchImpl,
    );

    await expect(client.fetchDomesticQuote("005930", "NX")).resolves.toMatchObject({
      code: "005930",
      marketCode: "NX",
      name: "삼성전자",
      marketName: "NXT",
      price: 72_100,
    });

    expect(requests[1]?.url).toContain("FID_COND_MRKT_DIV_CODE=NX");
  });

  it("국내 일봉 거래량을 조회한다", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (input: string | URL, init?: RequestInit) => {
      requests.push({ url: input.toString(), init });

      if (input.toString().endsWith("/oauth2/tokenP")) {
        return Response.json({
          access_token: "test-daily-access-token",
          expires_in: 3600,
        });
      }

      return Response.json({
        rt_cd: "0",
        output2: [
          {
            stck_bsop_date: "20260714",
            stck_clpr: "72000",
            acml_vol: "1000000",
          },
          {
            stck_bsop_date: "20260713",
            stck_clpr: "71000",
            acml_vol: "800000",
          },
        ],
      });
    };

    const client = new KisClient(
      {
        appKey: "daily-app-key",
        appSecret: "app-secret",
        baseUrl: "https://openapi.example.com:9443",
      },
      fetchImpl,
    );

    await expect(client.fetchDomesticDailyPrices("005930")).resolves.toEqual([
      { date: "20260714", close: 72_000, volume: 1_000_000 },
      { date: "20260713", close: 71_000, volume: 800_000 },
    ]);

    expect(requests[1]?.url).toContain(
      "/uapi/domestic-stock/v1/quotations/inquire-daily-price",
    );
    expect(requests[1]?.url).toContain("FID_PERIOD_DIV_CODE=D");
    expect(requests[1]?.init?.headers).toMatchObject({
      authorization: "Bearer test-daily-access-token",
      tr_id: "FHKST01010400",
    });
  });

  it("국내 투자자별 매수·매도 수급을 조회한다", async () => {
    const fetchImpl = async (input: string | URL) => {
      if (input.toString().endsWith("/oauth2/tokenP")) {
        return Response.json({ access_token: "investor-token", expires_in: 3600 });
      }
      return Response.json({
        rt_cd: "0",
        output: [
          {
            stck_bsop_date: "20260722",
            prsn_ntby_qty: "-3000",
            prsn_shnu_vol: "10000",
            prsn_seln_vol: "13000",
            frgn_ntby_qty: "1000",
            frgn_shnu_vol: "9000",
            frgn_seln_vol: "8000",
            orgn_ntby_qty: "2000",
            orgn_shnu_vol: "7000",
            orgn_seln_vol: "5000",
          },
        ],
      });
    };
    const client = new KisClient(
      {
        appKey: "investor-app-key",
        appSecret: "app-secret",
        baseUrl: "https://openapi.example.com:9443",
      },
      fetchImpl,
    );

    await expect(client.fetchDomesticInvestorFlow("005930")).resolves.toEqual({
      date: "20260722",
      personal: { buyVolume: 10_000, sellVolume: 13_000, netBuyVolume: -3_000 },
      foreign: { buyVolume: 9_000, sellVolume: 8_000, netBuyVolume: 1_000 },
      institution: { buyVolume: 7_000, sellVolume: 5_000, netBuyVolume: 2_000 },
    });
  });

  it("미국 주식 현재가와 일봉 거래량을 조회한다", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (input: string | URL, init?: RequestInit) => {
      requests.push({ url: input.toString(), init });
      if (input.toString().endsWith("/oauth2/tokenP")) {
        return Response.json({ access_token: "us-token", expires_in: 3600 });
      }
      if (input.toString().includes("/dailyprice")) {
        return Response.json({
          rt_cd: "0",
          output2: [
            { xymd: "20260720", clos: "180.50", tvol: "10000000" },
            { xymd: "20260717", clos: "179.00", tvol: "9000000" },
          ],
        });
      }
      return Response.json({
        rt_cd: "0",
        output: {
          last: "181.25", base: "180.00", diff: "1.25", rate: "0.69",
          tvol: "1234567", tamt: "223456789",
        },
      });
    };
    const client = new KisClient(
      {
        appKey: "us-app-key",
        appSecret: "app-secret",
        baseUrl: "https://openapi.example.com:9443",
      },
      fetchImpl,
    );

    await expect(client.fetchOverseasQuote("aapl", "NAS")).resolves.toMatchObject({
      symbol: "AAPL", exchange: "NAS", exchangeName: "NASDAQ",
      price: 181.25, change: 1.25, volume: 1_234_567,
    });
    await expect(client.fetchOverseasDailyPrices("AAPL", "NAS")).resolves.toEqual([
      { date: "20260720", close: 180.5, volume: 10_000_000 },
      { date: "20260717", close: 179, volume: 9_000_000 },
    ]);
    expect(requests[1]?.url).toContain("/uapi/overseas-price/v1/quotations/price");
    expect(requests[1]?.url).toContain("EXCD=NAS");
    expect(requests[1]?.init?.headers).toMatchObject({ tr_id: "HHDFS00000300" });
    expect(requests[2]?.init?.headers).toMatchObject({ tr_id: "HHDFS76240000" });
  });

  it("미국 주식의 별도 등락 부호를 현재가 변동에 적용한다", async () => {
    const fetchImpl = async (input: string | URL) => {
      if (input.toString().endsWith("/oauth2/tokenP")) {
        return Response.json({ access_token: "us-down-token", expires_in: 3600 });
      }
      return Response.json({
        rt_cd: "0",
        output: {
          last: "324.1327",
          base: "342.0900",
          sign: "5",
          diff: "17.9573",
          rate: "-5.25",
        },
      });
    };
    const client = new KisClient(
      {
        appKey: "us-down-app-key",
        appSecret: "app-secret",
        baseUrl: "https://openapi.example.com:9443",
      },
      fetchImpl,
    );

    await expect(client.fetchOverseasQuote("GOOGL", "NAS")).resolves.toMatchObject({
      price: 324.1327,
      previousClose: 342.09,
      change: -17.9573,
      changeRate: -5.25,
      changeDirection: "down",
    });
  });

  it("KOSPI200 KRX 야간선물 시세를 조회한다", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (input: string | URL, init?: RequestInit) => {
      requests.push({ url: input.toString(), init });
      if (input.toString().endsWith("/oauth2/tokenP")) {
        return Response.json({ access_token: "night-futures-token", expires_in: 3600 });
      }
      return Response.json({
        rt_cd: "0",
        output1: {
          hts_kor_isnm: "KOSPI200 야간선물",
          futs_prpr: "392.45",
          futs_prdy_vrss: "4.15",
          prdy_vrss_sign: "2",
          futs_prdy_ctrt: "1.07",
          futs_prdy_clpr: "388.30",
          futs_oprc: "389.80",
          futs_hgpr: "393.20",
          futs_lwpr: "388.75",
          acml_vol: "12345",
        },
      });
    };
    const client = new KisClient(
      {
        appKey: "night-futures-app-key",
        appSecret: "app-secret",
        baseUrl: "https://openapi.example.com:9443",
      },
      fetchImpl,
    );

    await expect(client.fetchKrxNightFuturesQuote("1A01609")).resolves.toMatchObject({
      code: "1A01609",
      name: "KOSPI200 야간선물",
      price: 392.45,
      change: 4.15,
      changeRate: 1.07,
      previousClose: 388.3,
      open: 389.8,
      high: 393.2,
      low: 388.75,
      volume: 12_345,
    });
    expect(requests[1]?.url).toContain(
      "/uapi/domestic-futureoption/v1/quotations/inquire-price",
    );
    expect(requests[1]?.url).toContain("FID_COND_MRKT_DIV_CODE=CM");
    expect(requests[1]?.url).toContain("FID_INPUT_ISCD=1A01609");
    expect(requests[1]?.init?.headers).toMatchObject({ tr_id: "FHMIF10000000" });
  });

  it("종목별 최근 뉴스 제목을 조회한다", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (input: string | URL, init?: RequestInit) => {
      requests.push({ url: input.toString(), init });

      if (input.toString().endsWith("/oauth2/tokenP")) {
        return Response.json({
          access_token: "test-news-access-token",
          expires_in: 3600,
        });
      }

      return Response.json({
        rt_cd: "0",
        output: [
          {
            cntt_usiq_srno: "12345",
            data_dt: "20260720",
            data_tm: "143015",
            hts_pbnt_titl_cntt: "삼성전자, 차세대 메모리 투자 확대",
            news_lrdv_code: "01",
            dorg: "연합뉴스",
          },
        ],
      });
    };

    const client = new KisClient(
      {
        appKey: "news-app-key",
        appSecret: "app-secret",
        baseUrl: "https://openapi.example.com:9443",
      },
      fetchImpl,
    );

    await expect(client.fetchDomesticNewsTitles("005930")).resolves.toEqual([
      {
        serialNumber: "12345",
        date: "20260720",
        time: "143015",
        title: "삼성전자, 차세대 메모리 투자 확대",
        categoryCode: "01",
        source: "연합뉴스",
      },
    ]);

    expect(requests[1]?.url).toContain(
      "/uapi/domestic-stock/v1/quotations/news-title",
    );
    expect(requests[1]?.url).toContain("FID_INPUT_ISCD=005930");
    expect(requests[1]?.init?.headers).toMatchObject({
      authorization: "Bearer test-news-access-token",
      tr_id: "FHKST01011800",
    });
  });
});
