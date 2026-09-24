export type ReceiptSample = Readonly<Record<string, unknown>>;

export interface ReceiptFieldStats {
  present: number;
  missing: number;
  zero: number;
  null: number;
  types: Readonly<Record<string, number>>;
}

export interface ReceiptModeAudit {
  sampleCount: number;
  fields: Readonly<Record<string, ReceiptFieldStats>>;
}

export interface ReceiptAliasAudit {
  canonical: string;
  names: readonly string[];
  observed: Readonly<Record<string, number>>;
  simultaneous: number;
}

export interface ReceiptCreditSourceAudit {
  key: string;
  label?: string;
  direction?: "gain" | "use";
  occurrences: number;
  nonZero: number;
  types: Readonly<Record<string, number>>;
}

export interface ReceiptCoinTossAudit {
  traitCode: number;
  traitSamples: number;
  incomeSamples: number;
  matchingSamples: number;
  traitWithoutIncome: number;
  incomeWithoutTrait: number;
}

export interface ReceiptDiscountCouponAudit {
  traitCode: number;
  traitSamples: number;
  materialPurchaseSamples: number;
  materialBreakdownSamples: number;
  dedicatedSavingsFieldSamples: number;
  creditSourceSamples: number;
}

export interface ReceiptSampleAudit {
  sampleCount: number;
  modes: Readonly<Record<string, ReceiptModeAudit>>;
  aliases: readonly ReceiptAliasAudit[];
  creditSources: readonly ReceiptCreditSourceAudit[];
  coinToss: ReceiptCoinTossAudit;
  discountCoupon: ReceiptDiscountCouponAudit;
}

export const COIN_TOSS_TRAIT_CODE = 7_211_101;
export const DISCOUNT_COUPON_TRAIT_CODE = 7_210_801;

export const RECEIPT_FIELD_ALIASES = [
  { canonical: "totalVFCredits", names: ["totalVFCredits", "totalVFCredit"] },
  { canonical: "usedVFCredits", names: ["usedVFCredits", "usedVFCredit"] },
  {
    canonical: "transferConsoleFromMaterialUseVFCredit",
    names: ["transferConsoleFromMaterialUseVFCredit", "kioskFromMaterialUseVFCredit"],
  },
  {
    canonical: "transferConsoleFromEscapeKeyUseVFCredit",
    names: ["transferConsoleFromEscapeKeyUseVFCredit", "kioskFromEscapeKeyUseVFCredit"],
  },
  {
    canonical: "transferConsoleFromRevivalUseVFCredit",
    names: ["transferConsoleFromRevivalUseVFCredit", "kioskFromRevivalUseVFCredit"],
  },
] as const;

export const CREDIT_SOURCE_LABELS: Readonly<Record<string, {
  label: string;
  direction: "gain" | "use";
}>> = {
  PreliminaryPhase: { label: "초기 지급", direction: "gain" },
  TimeElapsedCompensationByMiliSecond: { label: "시간 경과", direction: "gain" },
  TimeElapsedCreditBonusByMiliSecond: { label: "최저 크레딧 보정", direction: "gain" },
  KillChicken: { label: "닭", direction: "gain" },
  KillBat: { label: "박쥐", direction: "gain" },
  KillBoar: { label: "멧돼지", direction: "gain" },
  KillWildDog: { label: "들개", direction: "gain" },
  KillWolf: { label: "늑대", direction: "gain" },
  KillBear: { label: "곰", direction: "gain" },
  KillRaven: { label: "까마귀", direction: "gain" },
  KillMutantChicken: { label: "변이 닭", direction: "gain" },
  KillMutantBat: { label: "변이 박쥐", direction: "gain" },
  KillMutantBoar: { label: "변이 멧돼지", direction: "gain" },
  KillMutantWildDog: { label: "변이 들개", direction: "gain" },
  KillMutantWolf: { label: "변이 늑대", direction: "gain" },
  KillMutantBear: { label: "변이 곰", direction: "gain" },
  KillMutantRaven: { label: "변이 까마귀", direction: "gain" },
  KillPurpleMutantChicken: { label: "자색 변이 닭", direction: "gain" },
  KillPurpleMutantBat: { label: "자색 변이 박쥐", direction: "gain" },
  KillPurpleMutantBoar: { label: "자색 변이 멧돼지", direction: "gain" },
  KillPurpleMutantWildDog: { label: "자색 변이 들개", direction: "gain" },
  KillPurpleMutantWolf: { label: "자색 변이 늑대", direction: "gain" },
  KillPurpleMutantBear: { label: "자색 변이 곰", direction: "gain" },
  KillPurpleMutantRaven: { label: "자색 변이 까마귀", direction: "gain" },
  KillAlpha: { label: "알파", direction: "gain" },
  KillOmega: { label: "오메가", direction: "gain" },
  KillGamma: { label: "감마", direction: "gain" },
  KillWickline: { label: "위클라인", direction: "gain" },
  KillPlayerMerge: { label: "플레이어 킬", direction: "gain" },
  KillAssistDivideContribute: { label: "어시스트", direction: "gain" },
  ItemBounty: { label: "현상금", direction: "gain" },
  ItemBountyByItemCode: { label: "현상금", direction: "gain" },
  AcquireLumiCredit: { label: "LUMI 도난 경보", direction: "gain" },
  BoriIdleDropInterval: { label: "보리 산책 중 드롭", direction: "gain" },
  BoriStartRunaway: { label: "보리 도주 시작", direction: "gain" },
  BoriRunawayDropInterval: { label: "보리 도주 중 드롭", direction: "gain" },
  BoriDeath: { label: "보리 처치", direction: "gain" },
  TraitSkillCoinToss: { label: "코인 토스", direction: "gain" },
  ItemExchangeByItemCode: { label: "판매·교환", direction: "gain" },
  ItemShredder: { label: "아이템 판매", direction: "gain" },
  KillAttackDrone: { label: "공격 드론", direction: "gain" },
  KillCamera: { label: "카메라 파괴", direction: "gain" },
  KillOrb: { label: "ORB 파괴", direction: "gain" },
  GoldSecurityConsoleAccess: { label: "황금 보안 콘솔", direction: "gain" },
  DoorConsoleAccess: { label: "문 콘솔", direction: "gain" },
  KioskRemoteDroneMySelf: { label: "원격 드론 구매(본인)", direction: "use" },
  KioskRemoteDroneAlly: { label: "아군 원격 드론", direction: "use" },
  KioskSpecialMaterial: { label: "재료 구매", direction: "use" },
  KioskResurrection: { label: "아군 부활", direction: "use" },
  KioskEscapeKey: { label: "루트키트", direction: "use" },
  TacticalSkillUpgrade: { label: "전술 스킬 강화 모듈", direction: "use" },
  GuideRobotRadial: { label: "LUMI 라디얼 구매", direction: "use" },
  GuideRobotFlagShip: { label: "LUMI 플래그십 구매", direction: "use" },
  GuideRobotSignature: { label: "LUMI 시그니처 구매", direction: "use" },
};

export const RECEIPT_CANDIDATE_FIELDS = [
  "matchingMode", "matchingTeamMode", "seasonId", "gameId", "gameRank", "mmrGain",
  "damageToPlayer", "damageFromPlayer", "damageToMonster", "damageToPlayer_basic",
  "damageToPlayer_skill", "damageToPlayer_itemSkill", "damageToPlayer_direct",
  "damageToPlayer_uniqueSkill", "damageToPlayer_trap", "damageToPlayer_Shield",
  "damageOffsetedByShield_Player", "damageOffsetedByShield_Monster", "ccTimeToPlayer",
  "healAmount", "teamRecover", "protectAbsorb", "totalDoubleKill", "totalTripleKill",
  "totalQuadraKill", "totalExtraKill", "clutchCount", "terminateCount", "teamElimination",
  "teamDown", "viewContribution", "addSurveillanceCamera", "addTelephotoCamera",
  "removeSurveillanceCamera", "removeTelephotoCamera", "useSecurityConsole", "useReconDrone",
  "useEmpDrone", "creditRevivalCount", "creditRevivedOthersCount", "totalGainVFCredit",
  "totalUseVFCredit", "totalVFCredits", "totalVFCredit", "usedVFCredits", "usedVFCredit",
  "creditSource", "crGetAnimal", "crGetMutant", "crGetPhaseStart", "crGetKill",
  "crGetAssist", "crGetTimeElapsed", "crGetCreditBonus", "crGetByGuideRobot",
  "killAlphaGainVFCredit", "killOmegaGainVFCredit", "killGammaGainVFCredit",
  "killWicklineGainVFCredit", "killItemBountyGainVFCredit", "killDroneGainVFCredit",
  "killTurretGainVFCredit", "itemShredderGainVFCredit", "kioskExchangeCredit",
  "remoteDroneUseVFCreditMySelf", "remoteDroneUseVFCreditAlly",
  "transferConsoleFromMaterialUseVFCredit", "kioskFromMaterialUseVFCredit",
  "transferConsoleFromEscapeKeyUseVFCredit", "kioskFromEscapeKeyUseVFCredit",
  "transferConsoleFromRevivalUseVFCredit", "kioskFromRevivalUseVFCredit",
  "tacticalSkillUpgradeUseVFCredit", "damageToGuideRobot", "useGuideRobot",
  "crUseRemoteDrone", "crUseUpgradeTacticalSkill", "crUseTreeOfLife",
  "crUseMeteorite", "crUseMythril", "crUseForceCore", "crUseVFBloodSample",
  "crUseActivationModule", "crUseRootkit",
  "tacticalSkillGroup", "tacticalSkillLevel", "tacticalSkillUseCount", "skillLevelInfo",
  "skillOrderInfo", "routeIdOfStart", "fishingCount", "useEmoticonCount", "useHyperLoop",
  "airSupplyOpenCount", "foodCraftCount", "beverageCraftCount", "activeInstallation",
  "useGadget", "getBoriReward", "sumGetBuffCube", "getBuffCubeRed", "getBuffCubePurple",
  "getBuffCubeGreen", "getBuffCubeGold", "getBuffCubeSkyBlue", "enterDimensionRift",
  "enterDimensionEmpoweredRift", "winFromDimensionRift", "winFromDimensionEmpoweredRift",
  "enterTurbulentRift", "gimmickAppleDropped", "gimmickDrumUseCount",
  "gimmickDrumAttackCount", "gimmickDrumDroppedHitCount", "gimmickEvidenceLockerCount",
  "gimmickEvidenceLockerItem", "gimmickHospitalDiscountRate", "gimmickGrandfatherClockUseCount",
] as const;

export const RECEIPT_INDEPENDENT_NUMBER_FIELDS = [
  "damageToPlayer_basic", "damageToPlayer_skill", "damageToPlayer_itemSkill",
  "damageToPlayer_direct", "damageToPlayer_uniqueSkill", "damageToPlayer_trap",
  "damageToPlayer_Shield", "damageOffsetedByShield_Player", "damageOffsetedByShield_Monster",
  "addTelephotoCamera", "removeTelephotoCamera", "useReconDrone", "useEmpDrone",
  "useHyperLoop", "useSecurityConsole", "totalDoubleKill", "totalTripleKill", "totalQuadraKill",
  "totalExtraKill", "clutchCount", "terminateCount", "teamElimination", "teamDown",
  "totalGainVFCredit", "totalUseVFCredit", "crGetAnimal", "crGetMutant", "crGetPhaseStart",
  "crGetKill", "crGetAssist", "crGetTimeElapsed", "crGetCreditBonus", "crGetByGuideRobot",
  "killAlphaGainVFCredit", "killOmegaGainVFCredit", "killGammaGainVFCredit",
  "killWicklineGainVFCredit", "killItemBountyGainVFCredit", "itemShredderGainVFCredit",
  "kioskExchangeCredit", "remoteDroneUseVFCreditMySelf", "remoteDroneUseVFCreditAlly",
  "kioskFromMaterialUseVFCredit", "kioskFromEscapeKeyUseVFCredit",
  "kioskFromRevivalUseVFCredit", "creditRevivalCount", "creditRevivedOthersCount",
  "tacticalSkillUpgradeUseVFCredit", "fishingCount", "useEmoticonCount", "useGuideRobot",
  "crUseRemoteDrone", "crUseUpgradeTacticalSkill", "crUseTreeOfLife",
  "crUseMeteorite", "crUseMythril", "crUseForceCore", "crUseVFBloodSample",
  "crUseActivationModule", "crUseRootkit",
  "damageToGuideRobot", "tacticalSkillUseCount", "enterDimensionRift",
  "enterDimensionEmpoweredRift", "winFromDimensionRift", "winFromDimensionEmpoweredRift",
  "enterTurbulentRift", "getBuffCubeRed", "getBuffCubePurple", "getBuffCubeGreen",
  "getBuffCubeGold", "getBuffCubeSkyBlue", "sumGetBuffCube", "gimmickAppleDropped",
  "gimmickDrumUseCount", "gimmickDrumAttackCount", "gimmickDrumDroppedHitCount",
  "gimmickHospitalDiscountRate", "gimmickGrandfatherClockUseCount",
] as const;

export const RECEIPT_JSON_FIELDS = [
  "creditSource", "totalVFCredits", "usedVFCredits", "masteryLevel", "skillLevelInfo",
  "skillOrderInfo", "foodCraftCount", "beverageCraftCount", "airSupplyOpenCount",
  "getBoriReward", "activeInstallation", "useGadget", "gimmickEvidenceLockerCount",
  "gimmickEvidenceLockerItem", "itemTransferredConsole", "itemTransferredDrone",
] as const;

export function analyzeReceiptSamples(samples: readonly ReceiptSample[]): ReceiptSampleAudit {
  const modes: Record<string, ReceiptSample[]> = { all: [...samples] };
  for (const sample of samples) {
    const mode = modeName(sample.matchingMode);
    (modes[mode] ??= []).push(sample);
  }
  return {
    sampleCount: samples.length,
    modes: Object.fromEntries(Object.entries(modes).map(([name, values]) => [
      name,
      { sampleCount: values.length, fields: fieldStats(values) },
    ])),
    aliases: RECEIPT_FIELD_ALIASES.map(alias => ({
      canonical: alias.canonical,
      names: alias.names,
      observed: Object.fromEntries(alias.names.map(name => [
        name, samples.filter(sample => hasOwn(sample, name)).length,
      ])),
      simultaneous: samples.filter(sample => alias.names.every(name => hasOwn(sample, name))).length,
    })),
    creditSources: creditSourceStats(samples),
    coinToss: coinTossStats(samples),
    discountCoupon: discountCouponStats(samples),
  };
}

export function renderReceiptSampleAudit(
  audit: ReceiptSampleAudit,
  options: { generatedAt?: Date; userCount?: number; pagesPerUser?: number } = {},
): string {
  const generatedAt = options.generatedAt ?? new Date();
  const lines = [
    "# 이터널 리턴 게임 결과 실제 응답 표본 감사",
    "",
    `생성 시각: ${generatedAt.toISOString()}`,
    `표본: ${audit.sampleCount}개 유저 경기${options.userCount === undefined ? "" : ` · 등록 유저 ${options.userCount}명`}${options.pagesPerUser === undefined ? "" : ` · 유저당 최대 ${options.pagesPerUser}페이지`}`,
    "",
    "원본 응답과 API 키·UID는 저장하지 않는다. 이 보고서는 필드의 존재 여부, 타입, 0/결측과 집계된 출처 키만 포함한다.",
    "",
    "## 핵심 결론",
    "",
    ...keyFindings(audit),
    "",
    "## 모드별 표본",
    "",
    "| 모드 | 표본 수 |",
    "|---|---:|",
    ...Object.entries(audit.modes).filter(([name]) => name !== "all")
      .map(([name, mode]) => `| ${name} | ${mode.sampleCount} |`),
    "",
    "## 후보 필드 존재율과 타입",
    "",
    "`결측`은 키 자체가 없는 응답이며 `0`은 키가 있고 값이 숫자 0 또는 문자열 `0`인 응답이다.",
    "",
    "| 필드 | 전체 존재 | 전체 0 | 전체 결측 | 타입 | 일반 존재/0 | 랭크 존재/0 |",
    "|---|---:|---:|---:|---|---:|---:|",
  ];
  const all = audit.modes.all!;
  const normal = audit.modes.normal;
  const rank = audit.modes.rank;
  for (const field of RECEIPT_CANDIDATE_FIELDS) {
    const stats = all.fields[field]!;
    lines.push(`| \`${field}\` | ${ratio(stats.present, all.sampleCount)} | ${stats.zero} | ${stats.missing} | ${formatTypes(stats.types)} | ${normal ? `${ratio(normal.fields[field]!.present, normal.sampleCount)} / ${normal.fields[field]!.zero}` : "-"} | ${rank ? `${ratio(rank.fields[field]!.present, rank.sampleCount)} / ${rank.fields[field]!.zero}` : "-"} |`);
  }
  lines.push(
    "",
    "## 문서·실응답 별칭",
    "",
    "| 내부 이름 | 관측한 응답명 | 동시 등장 |",
    "|---|---|---:|",
    ...audit.aliases.map(alias => `| \`${alias.canonical}\` | ${alias.names.map(name => `\`${name}\` ${alias.observed[name] ?? 0}`).join(" / ")} | ${alias.simultaneous} |`),
    "",
    "저장 경계에서는 위 별칭을 내부 이름으로 합치되, 두 이름이 동시에 있고 값이 다르면 조용히 덮어쓰지 않고 오류로 기록한다.",
    "",
    "## creditSource 관측 키",
    "",
    "| 원본 키 | 한글 표시명 | 방향 | 등장 | 0이 아님 | 타입 |",
    "|---|---|---|---:|---:|---|",
    ...audit.creditSources.map(source => `| \`${source.key}\` | ${source.label ?? "미분류"} | ${source.direction === "gain" ? "획득" : source.direction === "use" ? "사용" : "미확정"} | ${source.occurrences} | ${source.nonZero} | ${formatTypes(source.types)} |`),
    "",
    "화이트리스트에 없는 키는 의미를 추측하지 않고 `미분류`로 남긴다.",
    "",
    "## 코인 토스 고정 검증",
    "",
    `- 특성 코드: \`${audit.coinToss.traitCode}\``,
    `- 특성 코드가 포함된 표본: ${audit.coinToss.traitSamples}`,
    `- \`TraitSkillCoinToss\` 수익이 있는 표본: ${audit.coinToss.incomeSamples}`,
    `- 두 조건이 함께 확인된 표본: ${audit.coinToss.matchingSamples}`,
    `- 특성은 있으나 수익 0/결측: ${audit.coinToss.traitWithoutIncome}`,
    `- 수익은 있으나 특성 코드를 찾지 못함: ${audit.coinToss.incomeWithoutTrait}`,
    "",
    "특성을 선택해도 킬·어시스트가 없다면 수익이 0일 수 있다. 반대로 수익이 있는데 특성 코드가 없으면 특성 필드 형태나 코드 변경을 다시 조사한다.",
    "",
    "## 할인 쿠폰 고정 검증",
    "",
    `- 특성 코드: \`${audit.discountCoupon.traitCode}\``,
    `- 특성 코드가 포함된 표본: ${audit.discountCoupon.traitSamples}`,
    `- 재료 구매액이 있는 표본: ${audit.discountCoupon.materialPurchaseSamples}`,
    `- 재료별 실제 결제액이 있는 표본: ${audit.discountCoupon.materialBreakdownSamples}`,
    `- 할인 절약액 전용 필드가 있는 표본: ${audit.discountCoupon.dedicatedSavingsFieldSamples}`,
    `- 할인 전용 \`creditSource\` 키가 있는 표본: ${audit.discountCoupon.creditSourceSamples}`,
    "",
    "할인 쿠폰 선택 여부와 할인 후 실제 결제액은 확인할 수 있지만, 절약액 전용 필드는 관측되지 않았다. 절약액은 구매 품목과 해당 패치의 정상 가격이 모두 확인될 때만 계산한다.",
    "",
    "## 저장 결정",
    "",
    "### 독립 숫자 열",
    "",
    ...renderCodeList(RECEIPT_INDEPENDENT_NUMBER_FIELDS),
    "",
    "### 원본 JSON 열",
    "",
    ...renderCodeList(RECEIPT_JSON_FIELDS),
    "",
    "화면 계산·검색·집계에 직접 쓰는 안정적인 숫자는 독립 열로 저장한다. 키가 늘어날 수 있는 출처·스킬 순서·가젯·환경 변수·보리 보상과 시즌 기믹은 JSON 원본을 보존한다.",
    "- 총 획득·사용은 `totalGainVFCredit`·`totalUseVFCredit`을 기준으로 하고 상세 출처를 다시 더해 총액을 만들지 않는다.",
    "- 일반·랭크에서 결측인 필드는 0으로 강제하지 않고 `undefined`로 유지한다.",
    "",
  );
  return lines.join("\n");
}

function fieldStats(samples: readonly ReceiptSample[]): Readonly<Record<string, ReceiptFieldStats>> {
  return Object.fromEntries(RECEIPT_CANDIDATE_FIELDS.map(field => {
    let present = 0;
    let missing = 0;
    let zero = 0;
    let nulls = 0;
    const types: Record<string, number> = {};
    for (const sample of samples) {
      if (!hasOwn(sample, field)) {
        missing += 1;
        continue;
      }
      present += 1;
      const value = sample[field];
      const type = valueType(value);
      types[type] = (types[type] ?? 0) + 1;
      if (value === null) nulls += 1;
      if (value === 0 || value === "0") zero += 1;
    }
    return [field, { present, missing, zero, null: nulls, types }];
  }));
}

function creditSourceStats(samples: readonly ReceiptSample[]): ReceiptCreditSourceAudit[] {
  const stats = new Map<string, { occurrences: number; nonZero: number; types: Record<string, number> }>();
  for (const sample of samples) {
    const source = sample.creditSource;
    if (!source || typeof source !== "object" || Array.isArray(source)) continue;
    for (const [key, value] of Object.entries(source)) {
      const current = stats.get(key) ?? { occurrences: 0, nonZero: 0, types: {} };
      current.occurrences += 1;
      if (value !== 0 && value !== "0" && value !== null && value !== undefined) current.nonZero += 1;
      const type = valueType(value);
      current.types[type] = (current.types[type] ?? 0) + 1;
      stats.set(key, current);
    }
  }
  return [...stats.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => ({
    key,
    ...(CREDIT_SOURCE_LABELS[key] ?? {}),
    ...value,
  }));
}

function coinTossStats(samples: readonly ReceiptSample[]): ReceiptCoinTossAudit {
  let traitSamples = 0;
  let incomeSamples = 0;
  let matchingSamples = 0;
  let traitWithoutIncome = 0;
  let incomeWithoutTrait = 0;
  for (const sample of samples) {
    const hasTrait = [sample.traitFirstCore, sample.traitFirstSub, sample.traitSecondSub]
      .some(value => containsCode(value, COIN_TOSS_TRAIT_CODE));
    const income = numericValue((sample.creditSource as Record<string, unknown> | undefined)?.TraitSkillCoinToss);
    const hasIncome = income !== undefined && income > 0;
    if (hasTrait) traitSamples += 1;
    if (hasIncome) incomeSamples += 1;
    if (hasTrait && hasIncome) matchingSamples += 1;
    if (hasTrait && !hasIncome) traitWithoutIncome += 1;
    if (!hasTrait && hasIncome) incomeWithoutTrait += 1;
  }
  return {
    traitCode: COIN_TOSS_TRAIT_CODE,
    traitSamples, incomeSamples, matchingSamples, traitWithoutIncome, incomeWithoutTrait,
  };
}

function discountCouponStats(samples: readonly ReceiptSample[]): ReceiptDiscountCouponAudit {
  let traitSamples = 0;
  let materialPurchaseSamples = 0;
  let materialBreakdownSamples = 0;
  let dedicatedSavingsFieldSamples = 0;
  let creditSourceSamples = 0;
  for (const sample of samples) {
    const hasTrait = [sample.traitFirstCore, sample.traitFirstSub, sample.traitSecondSub]
      .some(value => containsCode(value, DISCOUNT_COUPON_TRAIT_CODE));
    if (!hasTrait) continue;
    traitSamples += 1;
    if ((numericValue(sample.kioskFromMaterialUseVFCredit)
      ?? numericValue(sample.transferConsoleFromMaterialUseVFCredit)
      ?? 0) > 0) materialPurchaseSamples += 1;
    if (["crUseTreeOfLife", "crUseMeteorite", "crUseMythril", "crUseForceCore", "crUseVFBloodSample"]
      .some(field => (numericValue(sample[field]) ?? 0) > 0)) materialBreakdownSamples += 1;
    if (Object.keys(sample).some(key => /(?:coupon|discount)/i.test(key)
      && key !== "gimmickHospitalDiscountRate")) dedicatedSavingsFieldSamples += 1;
    const source = sample.creditSource;
    if (source && typeof source === "object" && !Array.isArray(source)
      && Object.keys(source).some(key => /(?:coupon|discount)/i.test(key))) creditSourceSamples += 1;
  }
  return {
    traitCode: DISCOUNT_COUPON_TRAIT_CODE,
    traitSamples,
    materialPurchaseSamples,
    materialBreakdownSamples,
    dedicatedSavingsFieldSamples,
    creditSourceSamples,
  };
}

function containsCode(value: unknown, code: number): boolean {
  if (Array.isArray(value)) return value.some(entry => numericValue(entry) === code);
  if (value && typeof value === "object") return Object.values(value).some(entry => numericValue(entry) === code);
  return numericValue(value) === code;
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function modeName(value: unknown): string {
  if (numericValue(value) === 2) return "normal";
  if (numericValue(value) === 3) return "rank";
  if (numericValue(value) === 6) return "cobalt";
  if (numericValue(value) === 9) return "lonewolf";
  return `other(${String(value)})`;
}

function valueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function hasOwn(value: ReceiptSample, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function ratio(value: number, total: number): string {
  if (total === 0) return "-";
  return `${value}/${total} (${(value / total * 100).toFixed(1)}%)`;
}

function formatTypes(types: Readonly<Record<string, number>>): string {
  const values = Object.entries(types);
  return values.length === 0 ? "-" : values.map(([type, count]) => `${type}:${count}`).join(", ");
}

function renderCodeList(values: readonly string[]): string[] {
  const lines: string[] = [];
  for (let index = 0; index < values.length; index += 8) {
    lines.push(`- ${values.slice(index, index + 8).map(value => `\`${value}\``).join(", ")}`);
  }
  return lines;
}

function keyFindings(audit: ReceiptSampleAudit): string[] {
  const normal = audit.modes.normal;
  const rank = audit.modes.rank;
  const mmrNormal = normal?.fields.mmrGain;
  const mmrRank = rank?.fields.mmrGain;
  const assistNormal = normal?.fields.crGetAssist;
  const assistRank = rank?.fields.crGetAssist;
  const unknownCredits = audit.creditSources.filter(source => !source.label).map(source => `\`${source.key}\``);
  const liveAliases = audit.aliases.map(alias => {
    const observed = alias.names.filter(name => (alias.observed[name] ?? 0) > 0);
    return `\`${alias.canonical}\` ← ${observed.length > 0 ? observed.map(name => `\`${name}\``).join(" 또는 ") : "관측 없음"}`;
  });
  return [
    `- 랭크의 \`mmrGain\`은 ${mmrRank ? ratio(mmrRank.present, rank!.sampleCount) : "표본 없음"}, 일반은 ${mmrNormal ? ratio(mmrNormal.present, normal!.sampleCount) : "표본 없음"}였다. RP는 랭크에서만 표시하고 결측을 0으로 만들지 않는다.`,
    `- \`crGetAssist\` 0건: 일반 ${assistNormal?.zero ?? 0}/${normal?.sampleCount ?? 0}, 랭크 ${assistRank?.zero ?? 0}/${rank?.sampleCount ?? 0}. 루미아 모드의 어시스트 수익 상세는 실제로 관측된 \`creditSource.KillAssistDivideContribute\`를 사용한다.`,
    `- 코인 토스는 특성 코드와 수익 키가 함께 확인된 표본 ${audit.coinToss.matchingSamples}건, 불일치 ${audit.coinToss.incomeWithoutTrait + audit.coinToss.traitWithoutIncome}건이었다.`,
    `- 현재 실응답 별칭: ${liveAliases.join("; ")}.`,
    `- 표시명이 확정되지 않은 크레딧 키: ${unknownCredits.length > 0 ? unknownCredits.join(", ") : "없음"}. 이 값은 원본 보존 후 \`미분류\`로 처리한다.`,
  ];
}
