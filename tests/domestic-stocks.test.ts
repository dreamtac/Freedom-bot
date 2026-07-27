import { describe, expect, it } from "vitest";

import { resolveDomesticStockQuery } from "../src/sources/domestic-stocks.js";

describe("resolveDomesticStockQuery", () => {
  it("6자리 종목코드를 그대로 사용한다", () => {
    expect(resolveDomesticStockQuery("005930")).toEqual({
      code: "005930",
      name: "삼성전자",
      matchedBy: "code",
    });
  });

  it("종목명을 종목코드로 매칭한다", () => {
    expect(resolveDomesticStockQuery("삼성전자")).toEqual({
      code: "005930",
      name: "삼성전자",
      matchedBy: "name",
    });
  });

  it("코스닥 종목명도 종목코드로 매칭한다", () => {
    expect(resolveDomesticStockQuery("이랜시스")).toEqual({
      code: "264850",
      name: "이랜시스",
      matchedBy: "name",
    });
  });

  it("별칭과 공백을 정리해서 매칭한다", () => {
    expect(resolveDomesticStockQuery(" sk hynix ")).toEqual({
      code: "000660",
      name: "SK하이닉스",
      matchedBy: "name",
    });
  });

  it("알 수 없는 종목명은 설명 가능한 오류를 낸다", () => {
    expect(() => resolveDomesticStockQuery("없는종목")).toThrow(
      "종목을 찾지 못했습니다.",
    );
  });
});
