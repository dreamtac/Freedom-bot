import { describe, expect, it } from "vitest";

import {
  analyzeReceiptSamples,
  COIN_TOSS_TRAIT_CODE,
  CREDIT_SOURCE_LABELS,
  DISCOUNT_COUPON_TRAIT_CODE,
  renderReceiptSampleAudit,
} from "../src/services/eternal-return-receipt-audit.js";

describe("Eternal Return receipt response audit", () => {
  it("separates missing, zero and raw response types by matching mode", () => {
    const audit = analyzeReceiptSamples([
      { matchingMode: 2, damageToPlayer: 0, creditSource: {} },
      { matchingMode: 3, damageToPlayer: "1200", creditSource: null },
      { matchingMode: 3 },
    ]);

    expect(audit.modes.normal?.sampleCount).toBe(1);
    expect(audit.modes.rank?.sampleCount).toBe(2);
    expect(audit.modes.all?.fields.damageToPlayer).toEqual({
      present: 2,
      missing: 1,
      zero: 1,
      null: 0,
      types: { number: 1, string: 1 },
    });
    expect(audit.modes.rank?.fields.creditSource).toMatchObject({ present: 1, null: 1 });
  });

  it("detects discount coupon purchases without inventing a savings field", () => {
    const audit = analyzeReceiptSamples([
      {
        traitFirstSub: [DISCOUNT_COUPON_TRAIT_CODE],
        kioskFromMaterialUseVFCredit: 510,
        crUseTreeOfLife: 180,
        crUseForceCore: 330,
        creditSource: { KioskSpecialMaterial: 510 },
      },
      {
        traitSecondSub: [DISCOUNT_COUPON_TRAIT_CODE],
        kioskFromMaterialUseVFCredit: 0,
        creditSource: {},
      },
    ]);

    expect(audit.discountCoupon).toEqual({
      traitCode: DISCOUNT_COUPON_TRAIT_CODE,
      traitSamples: 2,
      materialPurchaseSamples: 1,
      materialBreakdownSamples: 1,
      dedicatedSavingsFieldSamples: 0,
      creditSourceSamples: 0,
    });
  });

  it("reports aliases without silently choosing between simultaneous values", () => {
    const audit = analyzeReceiptSamples([
      { totalVFCredit: [1], totalVFCredits: [2] },
      { totalVFCredits: [3] },
    ]);
    const alias = audit.aliases.find(entry => entry.canonical === "totalVFCredits");
    expect(alias?.observed).toEqual({ totalVFCredits: 2, totalVFCredit: 1 });
    expect(alias?.simultaneous).toBe(1);
  });

  it("collects credit source keys and validates the coin toss trait against its income", () => {
    const fixedCoinTossSamples = [
      {
        matchingMode: 3,
        traitFirstSub: [COIN_TOSS_TRAIT_CODE],
        creditSource: { TraitSkillCoinToss: 166, UnknownFutureSource: 3 },
      },
      {
        matchingMode: 3,
        traitSecondSub: [COIN_TOSS_TRAIT_CODE],
        creditSource: { TraitSkillCoinToss: 170 },
      },
      {
        matchingMode: 3,
        traitSecondSub: [COIN_TOSS_TRAIT_CODE],
        creditSource: {},
      },
    ] as const;
    const audit = analyzeReceiptSamples(fixedCoinTossSamples);

    expect(audit.coinToss).toMatchObject({
      traitSamples: 3,
      incomeSamples: 2,
      matchingSamples: 2,
      traitWithoutIncome: 1,
      incomeWithoutTrait: 0,
    });
    expect(audit.creditSources.find(source => source.key === "TraitSkillCoinToss"))
      .toMatchObject({ label: "코인 토스", direction: "gain", nonZero: 2 });
    expect(audit.creditSources.find(source => source.key === "UnknownFutureSource")?.label)
      .toBeUndefined();
    expect(CREDIT_SOURCE_LABELS.TraitSkillCoinToss).toEqual({ label: "코인 토스", direction: "gain" });
    expect(CREDIT_SOURCE_LABELS.KioskSpecialMaterial?.label).toBe("재료 구매");
    expect(CREDIT_SOURCE_LABELS.KioskRemoteDroneMySelf?.label).toBe("원격 드론 구매(본인)");
    expect(CREDIT_SOURCE_LABELS.TacticalSkillUpgrade?.label).toBe("전술 스킬 강화 모듈");
  });

  it("renders an aggregate report without storing player identifiers", () => {
    const audit = analyzeReceiptSamples([{ matchingMode: 2, gameId: 1, creditSource: {} }]);
    const report = renderReceiptSampleAudit(audit, {
      generatedAt: new Date("2026-09-22T00:00:00.000Z"), userCount: 1, pagesPerUser: 1,
    });
    expect(report).toContain("이터널 리턴 게임 결과 실제 응답 표본 감사");
    expect(report).toContain("등록 유저 1명");
    expect(report).toContain("`gameId`");
    expect(report).not.toContain("userId");
    expect(report).not.toContain("nickname");
  });
});
