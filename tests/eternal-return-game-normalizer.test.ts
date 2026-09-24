import { describe, expect, it } from "vitest";

import { normalizeEternalReturnGame } from "../src/services/eternal-return-game-normalizer.js";
import { getGameResults } from "../src/sources/eternal-return.js";

describe("Eternal Return game response normalization", () => {
  it("normalizes numeric strings while preserving real zero and missing values", () => {
    const game = normalizeEternalReturnGame({
      gameId: "123", gameRank: 0, playerKill: "0", damageToPlayer: "321.5",
      damageFromPlayer: "invalid", damageToMonster: undefined,
    });

    expect(game).toMatchObject({ gameId: 123, gameRank: 0, playerKill: 0, damageToPlayer: 321.5 });
    expect(game).not.toHaveProperty("damageFromPlayer");
    expect(game).not.toHaveProperty("damageToMonster");
    expect(game?.normalizationWarnings).toContain("damageFromPlayer: 유효한 숫자가 아님");
  });

  it("merges documented and live aliases without hiding a conflict", () => {
    const game = normalizeEternalReturnGame({
      totalVFCredit: ["1", 2],
      usedVFCredits: [0, "3"],
      transferConsoleFromMaterialUseVFCredit: "510",
      kioskFromMaterialUseVFCredit: 999,
      kioskFromRevivalUseVFCredit: "200",
    });

    expect(game).toMatchObject({
      totalVFCredits: [1, 2], usedVFCredits: [0, 3],
      transferConsoleFromMaterialUseVFCredit: 510,
      transferConsoleFromRevivalUseVFCredit: 200,
    });
    expect(game?.normalizationWarnings).toContain(
      "transferConsoleFromMaterialUseVFCredit: 별칭 값이 서로 다름 (transferConsoleFromMaterialUseVFCredit, kioskFromMaterialUseVFCredit)",
    );
  });

  it("keeps every credit source key and preserves unknown future fields", () => {
    const game = normalizeEternalReturnGame({
      gameId: 7,
      creditSource: { TraitSkillCoinToss: 166, FutureCreditSource: "3" },
      futureReceiptMetric: { nested: [0, "kept"] },
    });

    expect(game?.creditSource).toEqual({ TraitSkillCoinToss: 166, FutureCreditSource: 3 });
    expect(game?.extra).toEqual({ futureReceiptMetric: { nested: [0, "kept"] } });
  });

  it("rejects malformed array shapes without shifting time-series positions", () => {
    const game = normalizeEternalReturnGame({
      totalVFCredits: [1, "bad", 3],
      traitFirstSub: { 0: 7210801 },
      itemTransferredDrone: ["502207", 502208],
    });

    expect(game).not.toHaveProperty("totalVFCredits");
    expect(game).not.toHaveProperty("traitFirstSub");
    expect(game?.itemTransferredDrone).toEqual([502207, 502208]);
    expect(game?.normalizationWarnings).toEqual(expect.arrayContaining([
      "traitFirstSub: 숫자 배열이 아님",
      "totalVFCredits: 별칭 값의 형식이 잘못됨",
    ]));
  });

  it("normalizes every game returned by the API result helper", () => {
    const games = getGameResults({ code: 200, userGames: [
      { gameId: "10", damageToPlayer: "100" } as never,
    ] });
    expect(games).toEqual([{ gameId: 10, damageToPlayer: 100 }]);
  });
});
