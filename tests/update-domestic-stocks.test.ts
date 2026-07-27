import { describe, expect, it } from "vitest";

import { parseKrxListedCompanies } from "../src/update-domestic-stocks.js";

describe("parseKrxListedCompanies", () => {
  it("KIND 상장법인 HTML에서 6자리 종목을 추출한다", () => {
    const html = `
      <table>
        <tr><th>회사명</th><th>시장구분</th><th>종목코드</th></tr>
        <tr>
          <td>한미반도체</td>
          <td>유가증권</td>
          <td style="mso-number-format:'@';text-align:center;">042700</td>
        </tr>
        <tr>
          <td>우선주아님</td>
          <td>코스닥</td>
          <td>0039P0</td>
        </tr>
      </table>
    `;

    expect(parseKrxListedCompanies(html)).toEqual([
      { code: "042700", name: "한미반도체", market: "유가증권" },
    ]);
  });
});
