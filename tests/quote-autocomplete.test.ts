import { describe, expect, it, vi } from "vitest";

import { quoteCommand } from "../src/commands/quote.js";

describe("quoteCommand autocomplete", () => {
  it("유가 시장명을 코스피로 표시한다", async () => {
    const respond = vi.fn();
    await quoteCommand.autocomplete?.(
      {
        options: {
          getFocused: () => "삼성",
        },
        respond,
      } as never,
      {
        stockStore: {
          suggest: () => [
            { code: "005930", name: "삼성전자", market: "유가" },
            { code: "091990", name: "셀트리온헬스케어", market: "코스닥" },
          ],
        } as never,
      },
    );

    expect(respond).toHaveBeenCalledWith([
      { name: "삼성전자 (005930) · 코스피", value: "005930" },
      { name: "셀트리온헬스케어 (091990) · 코스닥", value: "091990" },
    ]);
  });
});
