import type { EternalReturnWeaponRoute } from "../sources/eternal-return.js";
import type { EternalReturnReferences } from "../sources/eternal-return-reference.js";
import type { EternalReturnStore, StoredEternalReturnGame } from "../storage/eternal-return-store.js";
import { COIN_TOSS_TRAIT_CODE, DISCOUNT_COUPON_TRAIT_CODE } from "./eternal-return-receipt-audit.js";
import type { EternalReturnRouteService } from "./eternal-return-route.js";

export interface ReceiptMetric {
  key: string;
  label: string;
  value: number;
  details?: readonly ReceiptMetric[];
}

export interface ReceiptCombatView {
  dealt?: number;
  received?: number;
  monster?: number;
  shieldAbsorbed?: number;
  shieldDamage?: number;
  ccSeconds?: number;
  unclassifiedDamage?: number;
  damageTypes: readonly ReceiptMetric[];
  multikills: readonly ReceiptMetric[];
  clutch?: number;
  terminate?: number;
}

export interface ReceiptContributionView {
  support: readonly ReceiptMetric[];
  vision: readonly ReceiptMetric[];
}

export interface ReceiptCreditView {
  totalGain?: number;
  totalUse?: number;
  balance?: number;
  gain: readonly ReceiptMetric[];
  use: readonly ReceiptMetric[];
  coinToss: number;
  coinTossPercent?: number;
  discountCoupon: boolean;
  materialPurchases: readonly ReceiptMetric[];
  droneItems: readonly { code: number; name: string; count: number }[];
  unknownSourceKeys: readonly string[];
  valid: boolean;
  errors: readonly string[];
}

export interface ReceiptActivityView {
  lines: readonly string[];
}

export interface ReceiptBuildView {
  equipment: readonly string[];
  traits: readonly string[];
  skillOrder: readonly string[];
  startArea?: string;
  route?: EternalReturnWeaponRoute;
}

export interface EternalReturnReceiptPlayerView {
  userId: string;
  nickname: string;
  game: StoredEternalReturnGame;
  characterName: string;
  combat: ReceiptCombatView;
  contribution: ReceiptContributionView;
  credits: ReceiptCreditView;
  activity: ReceiptActivityView;
  build: ReceiptBuildView;
  features: readonly string[];
}

export interface EternalReturnReceiptTeamView {
  teamNumber?: number;
  players: readonly EternalReturnReceiptPlayerView[];
  rank?: number;
  teamKill?: number;
  damage: number;
}

export interface EternalReturnReceiptView {
  gameId: number;
  players: readonly EternalReturnReceiptPlayerView[];
  teams: readonly EternalReturnReceiptTeamView[];
  matchingMode?: number;
  matchingTeamMode?: number;
  startedAt?: string;
  duration?: number;
  valid: boolean;
  errors: readonly string[];
  features: readonly string[];
}

export interface ReceiptPlayerInput {
  userId: string;
  nickname: string;
  game: StoredEternalReturnGame;
  previousGames?: readonly StoredEternalReturnGame[];
  route?: EternalReturnWeaponRoute;
}

interface EternalReturnReceiptBuilderOptions {
  store: Pick<EternalReturnStore, "getGameReceipt" | "listGameReceiptPlayers" | "getGame" | "listGames">;
  routes?: Pick<EternalReturnRouteService, "getOptional">;
}

export class EternalReturnReceiptBuilder {
  readonly #store: EternalReturnReceiptBuilderOptions["store"];
  readonly #routes?: EternalReturnReceiptBuilderOptions["routes"];

  constructor(options: EternalReturnReceiptBuilderOptions) {
    this.#store = options.store;
    this.#routes = options.routes;
  }

  async build(receiptId: string, references: EternalReturnReferences): Promise<EternalReturnReceiptView> {
    const receipt = this.#store.getGameReceipt(receiptId);
    if (!receipt) throw new Error(`저장된 게임 결과를 찾지 못했습니다: ${receiptId}`);
    const linkedPlayers = this.#store.listGameReceiptPlayers(receiptId);
    const views = await Promise.all(linkedPlayers.map(async linked => {
      const game = this.#store.getGame(linked.userId, receipt.gameId);
      if (!game) throw new Error(`게임 결과 선수 기록을 찾지 못했습니다: ${linked.nickname}`);
      const route = game.routeIdOfStart && this.#routes
        ? await this.#routes.getOptional(game.routeIdOfStart, { priority: "refresh" })
        : undefined;
      const previousGames = this.#store.listGames(linked.userId, {
        ...(game.matchingMode !== undefined ? { matchingMode: game.matchingMode } : {}),
        limit: 101,
      });
      return buildReceiptPlayerView({
        userId: linked.userId,
        nickname: linked.nickname,
        game,
        previousGames,
        ...(route ? { route } : {}),
      }, references);
    }));
    return buildReceiptView(views);
  }
}

const WILD_KEYS = [
  "KillChicken", "KillBat", "KillBoar", "KillWildDog", "KillWolf", "KillBear", "KillRaven",
] as const;
const BORI_KEYS = [
  "BoriIdleDropInterval", "BoriStartRunaway", "BoriRunawayDropInterval", "BoriDeath",
] as const;
const MUTANT_KEYS = [
  "KillMutantChicken", "KillMutantBat", "KillMutantBoar", "KillMutantWildDog", "KillMutantWolf",
  "KillMutantBear", "KillMutantRaven", "KillPurpleMutantChicken", "KillPurpleMutantBat",
  "KillPurpleMutantBoar", "KillPurpleMutantWildDog", "KillPurpleMutantWolf", "KillPurpleMutantBear",
  "KillPurpleMutantRaven",
] as const;
const OBJECT_KEYS = [
  "KillAttackDrone", "KillCamera", "KillOrb", "GoldSecurityConsoleAccess", "DoorConsoleAccess",
] as const;
const GUIDE_ROBOT_USE_KEYS = ["GuideRobotRadial", "GuideRobotFlagShip", "GuideRobotSignature"] as const;
const RECOGNIZED_SOURCE_KEYS = new Set([
  "PreliminaryPhase", "TimeElapsedCompensationByMiliSecond", "TimeElapsedCreditBonusByMiliSecond",
  ...WILD_KEYS,
  ...MUTANT_KEYS, "KillAlpha", "KillOmega", "KillGamma", "KillWickline", "KillPlayerMerge",
  "KillAssistDivideContribute", "ItemBounty", "ItemBountyByItemCode", "AcquireLumiCredit", ...BORI_KEYS,
  "TraitSkillCoinToss", "ItemExchangeByItemCode", "ItemShredder", ...OBJECT_KEYS,
  "KioskRemoteDroneMySelf", "KioskRemoteDroneAlly", "KioskSpecialMaterial", "KioskResurrection",
  "KioskEscapeKey", "TacticalSkillUpgrade", ...GUIDE_ROBOT_USE_KEYS,
]);

const DAMAGE_TYPES: ReadonlyArray<[keyof StoredEternalReturnGame, string, string]> = [
  ["damageToPlayer_basic", "basic", "기본 공격"],
  ["damageToPlayer_skill", "skill", "스킬"],
  ["damageToPlayer_itemSkill", "item", "아이템 효과"],
  ["damageToPlayer_direct", "direct", "직접 피해"],
  ["damageToPlayer_uniqueSkill", "unique", "고유 효과"],
  ["damageToPlayer_trap", "trap", "함정"],
];

const MATERIAL_FIELDS: ReadonlyArray<[keyof StoredEternalReturnGame, string, string]> = [
  ["crUseTreeOfLife", "tree", "생명의 나무"],
  ["crUseMeteorite", "meteorite", "운석"],
  ["crUseMythril", "mythril", "미스릴"],
  ["crUseForceCore", "force-core", "포스 코어"],
  ["crUseVFBloodSample", "blood-sample", "VF 혈액 샘플"],
];

export function buildReceiptPlayerView(
  input: ReceiptPlayerInput,
  references: EternalReturnReferences,
): EternalReturnReceiptPlayerView {
  const combat = buildCombat(input.game);
  const contribution = buildContribution(input.game);
  const credits = buildCredits(input.game, references);
  const activity = buildActivity(input.game, references);
  const build = buildBuild(input.game, references, input.route);
  return {
    userId: input.userId,
    nickname: input.nickname,
    game: input.game,
    characterName: references.characterName(input.game.characterNum),
    combat,
    contribution,
    credits,
    activity,
    build,
    features: selectFeatures(input.game, credits, input.previousGames ?? []),
  };
}

export function buildReceiptView(players: readonly EternalReturnReceiptPlayerView[]): EternalReturnReceiptView {
  if (players.length === 0) throw new Error("게임 결과를 만들 선수 데이터가 없습니다.");
  const first = players[0]!;
  if (players.some(player => player.game.gameId !== first.game.gameId)) {
    throw new Error("서로 다른 경기의 선수 데이터는 한 게임 결과로 합칠 수 없습니다.");
  }
  const groups = new Map<number | undefined, EternalReturnReceiptPlayerView[]>();
  for (const player of players) {
    const group = groups.get(player.game.teamNumber) ?? [];
    group.push(player);
    groups.set(player.game.teamNumber, group);
  }
  const teams = [...groups.entries()].map(([teamNumber, members]) => {
    const rank = firstDefined(members.map(player => player.game.gameRank));
    const teamKill = firstDefined(members.map(player => player.game.teamKill));
    return {
      ...(teamNumber !== undefined ? { teamNumber } : {}),
      players: members,
      ...(rank !== undefined ? { rank } : {}),
      ...(teamKill !== undefined ? { teamKill } : {}),
      damage: sum(members.map(player => player.game.damageToPlayer)),
    };
  });
  const errors = players.flatMap(player => player.credits.errors.map(error => `${player.nickname}: ${error}`));
  const teamFeatures: string[] = [];
  const teamCoinToss = sum(players.map(player => player.credits.coinToss));
  const teamRevives = sum(players.map(player => player.game.creditRevivedOthersCount));
  if (players.length > 1 && teamCoinToss > 0) teamFeatures.push(`코인 토스 합계 ${format(teamCoinToss)}`);
  if (players.length > 1 && teamRevives > 0) teamFeatures.push(`아군 부활 합계 ${format(teamRevives)}회`);
  const combinedFeatures = unique([...teamFeatures, ...players.flatMap(player => player.features)]).slice(0, 4);
  const duration = gameDuration(first.game);
  return {
    gameId: first.game.gameId,
    players,
    teams,
    ...(first.game.matchingMode !== undefined ? { matchingMode: first.game.matchingMode } : {}),
    ...(first.game.matchingTeamMode !== undefined ? { matchingTeamMode: first.game.matchingTeamMode } : {}),
    ...(first.game.startDtm !== undefined ? { startedAt: first.game.startDtm } : {}),
    ...(duration !== undefined ? { duration } : {}),
    valid: errors.length === 0,
    errors,
    features: combinedFeatures,
  };
}

function buildCombat(game: StoredEternalReturnGame): ReceiptCombatView {
  const damageTypes = DAMAGE_TYPES.flatMap(([field, key, label]) => metric(key, label, game[field]));
  const multikills = [
    metric("double", "더블 킬", game.totalDoubleKill),
    metric("triple", "트리플 킬", game.totalTripleKill),
    metric("quadra", "쿼드라 킬", game.totalQuadraKill),
    metric("extra", "그 이상 다중 킬", game.totalExtraKill),
  ].flat();
  const dealt = positive(game.damageToPlayer);
  const received = positive(game.damageFromPlayer);
  const monster = positive(game.damageToMonster);
  const shieldAbsorbed = positive(game.damageOffsetedByShield_Player);
  const shieldDamage = positive(game.damageToPlayer_Shield);
  const ccSeconds = positive(game.ccTimeToPlayer);
  const classifiedDamage = sum(damageTypes.map(item => item.value));
  const unclassifiedDamage = dealt !== undefined && classifiedDamage > 0 && dealt > classifiedDamage
    ? roundCredit(dealt - classifiedDamage) : undefined;
  const clutch = positive(game.clutchCount);
  const terminate = positive(game.terminateCount);
  return {
    ...(dealt !== undefined ? { dealt } : {}),
    ...(received !== undefined ? { received } : {}),
    ...(monster !== undefined ? { monster } : {}),
    ...(shieldAbsorbed !== undefined ? { shieldAbsorbed } : {}),
    ...(shieldDamage !== undefined ? { shieldDamage } : {}),
    ...(ccSeconds !== undefined ? { ccSeconds } : {}),
    ...(unclassifiedDamage !== undefined ? { unclassifiedDamage } : {}),
    damageTypes,
    multikills,
    ...(clutch !== undefined ? { clutch } : {}),
    ...(terminate !== undefined ? { terminate } : {}),
  };
}

function buildContribution(game: StoredEternalReturnGame): ReceiptContributionView {
  const support = [
    metric("team-recover", "아군 회복", game.teamRecover),
    metric("revive", "아군 부활", game.creditRevivedOthersCount),
    metric("revive-credit", "부활 비용", game.transferConsoleFromRevivalUseVFCredit),
    metric("ally-drone", "아군 원격 드론 지원", game.remoteDroneUseVFCreditAlly),
  ].flat();
  const camerasAdded = sum([game.addSurveillanceCamera, game.addTelephotoCamera]);
  const camerasRemoved = sum([game.removeSurveillanceCamera, game.removeTelephotoCamera]);
  const vision = [
    metric("vision", "시야 기여도", game.viewContribution),
    metric("camera-add", "감시·망원 카메라 설치", camerasAdded),
    metric("camera-remove", "적 카메라 제거", camerasRemoved),
    metric("security", "보안 콘솔(CCTV)", game.useSecurityConsole),
    metric("recon", "정찰 드론", game.useReconDrone),
    metric("emp", "EMP 드론", game.useEmpDrone),
  ].flat();
  return { support, vision };
}

function buildCredits(game: StoredEternalReturnGame, references: EternalReturnReferences): ReceiptCreditView {
  const source = numericRecord(game.creditSource);
  const errors: string[] = [];
  const initial = source.PreliminaryPhase ?? 0;
  const time = firstPositive(positiveOrZero(game.crGetTimeElapsed), source.TimeElapsedCompensationByMiliSecond ?? 0);
  const phase = positiveOrZero(game.crGetPhaseStart);
  const wild = sumKeys(source, WILD_KEYS);
  const mutant = firstPositive(positiveOrZero(game.crGetMutant), sumKeys(source, MUTANT_KEYS));
  const bossDetails = [
    metric("alpha", "알파", firstPositive(positiveOrZero(game.killAlphaGainVFCredit), source.KillAlpha ?? 0)),
    metric("omega", "오메가", firstPositive(positiveOrZero(game.killOmegaGainVFCredit), source.KillOmega ?? 0)),
    metric("gamma", "감마", firstPositive(positiveOrZero(game.killGammaGainVFCredit), source.KillGamma ?? 0)),
    metric("wickline", "위클라인", firstPositive(positiveOrZero(game.killWicklineGainVFCredit), source.KillWickline ?? 0)),
  ].flat();
  const boss = sum(bossDetails.map(item => item.value));
  const bounty = firstPositive(positiveOrZero(game.killItemBountyGainVFCredit),
    sumKeys(source, ["ItemBounty", "ItemBountyByItemCode"]));
  const boriDetails = BORI_KEYS.flatMap(key => metric(key, boriLabel(key), source[key]));
  const bori = sum(boriDetails.map(item => item.value));
  const coinToss = source.TraitSkillCoinToss ?? 0;
  const sale = firstPositive(
    sum([game.itemShredderGainVFCredit, game.kioskExchangeCredit]),
    sumKeys(source, ["ItemExchangeByItemCode", "ItemShredder"]),
  );
  const objectDetails = OBJECT_KEYS.flatMap(key => metric(key, objectLabel(key), source[key]));
  const objects = sum(objectDetails.map(item => item.value));
  const gain = [
    metric("initial", "초기 지급", initial),
    metric("time", "시간 경과", time),
    metric("phase", "페이즈 보정", phase),
    metric("wild", "야생동물", wild),
    metric("mutant", "돌연변이", mutant),
    metric("boss", "보스", boss, bossDetails),
    metric("kill", "플레이어 킬", firstPositive(positiveOrZero(game.crGetKill), source.KillPlayerMerge ?? 0)),
    metric("assist", "어시스트", firstPositive(positiveOrZero(game.crGetAssist), source.KillAssistDivideContribute ?? 0)),
    metric("bounty", "현상금", bounty),
    metric("minimum", "최저 크레딧 보정", firstPositive(positiveOrZero(game.crGetCreditBonus),
      source.TimeElapsedCreditBonusByMiliSecond ?? 0)),
    metric("lumi", "LUMI 도난 경보", firstPositive(positiveOrZero(game.crGetByGuideRobot),
      source.AcquireLumiCredit ?? 0)),
    metric("bori", "보리(B0-R1)", bori, boriDetails),
    metric("coin-toss", "코인 토스", coinToss),
    metric("sale", "판매·교환", sale),
    metric("objects", "오브젝트", objects, objectDetails),
  ].flat();

  const materialPurchases = MATERIAL_FIELDS.flatMap(([field, key, label]) => metric(key, label, game[field]));
  const material = firstPositive(
    positiveOrZero(game.transferConsoleFromMaterialUseVFCredit),
    sum(materialPurchases.map(item => item.value)),
    source.KioskSpecialMaterial ?? 0,
  );
  const remoteSelf = firstPositive(positiveOrZero(game.remoteDroneUseVFCreditMySelf), source.KioskRemoteDroneMySelf ?? 0);
  const remoteAlly = firstPositive(positiveOrZero(game.remoteDroneUseVFCreditAlly), source.KioskRemoteDroneAlly ?? 0);
  const tactical = firstPositive(
    positiveOrZero(game.tacticalSkillUpgradeUseVFCredit),
    positiveOrZero(game.crUseActivationModule),
    positiveOrZero(game.crUseUpgradeTacticalSkill),
    source.TacticalSkillUpgrade ?? 0,
  );
  validateSameValue("재료 구매", [
    positiveOrZero(game.transferConsoleFromMaterialUseVFCredit),
    sum(materialPurchases.map(item => item.value)),
    source.KioskSpecialMaterial ?? 0,
  ], errors);
  validateSameValue("전술 스킬 강화 모듈", [
    positiveOrZero(game.tacticalSkillUpgradeUseVFCredit),
    positiveOrZero(game.crUseActivationModule),
    positiveOrZero(game.crUseUpgradeTacticalSkill),
    source.TacticalSkillUpgrade ?? 0,
  ], errors);
  const rootkit = firstPositive(
    positiveOrZero(game.transferConsoleFromEscapeKeyUseVFCredit),
    positiveOrZero(game.crUseRootkit),
    source.KioskEscapeKey ?? 0,
  );
  const revival = firstPositive(
    positiveOrZero(game.transferConsoleFromRevivalUseVFCredit),
    source.KioskResurrection ?? 0,
  );
  const guideRobot = sumKeys(source, GUIDE_ROBOT_USE_KEYS);
  const use = [
    metric("material", "재료 구매", material, materialPurchases),
    metric("remote-self", "원격 드론 구매(본인)", remoteSelf),
    metric("remote-ally", "아군 원격 드론", remoteAlly),
    metric("tactical", "전술 스킬 강화 모듈", tactical),
    metric("rootkit", "루트키트", rootkit),
    metric("revival", "아군 부활", revival),
    metric("guide-robot", "LUMI 구매", guideRobot),
  ].flat();

  const totalGain = nonNegative(game.totalGainVFCredit);
  const totalUse = nonNegative(game.totalUseVFCredit);
  addRemainder(gain, totalGain, "gain", "획득", errors);
  addRemainder(use, totalUse, "use", "사용", errors);
  const unknownSourceKeys = Object.entries(source)
    .filter(([key, value]) => value > 0 && !RECOGNIZED_SOURCE_KEYS.has(key))
    .map(([key]) => key)
    .sort();
  const droneItems = countItems(game.itemTransferredDrone, references);
  const discountCoupon = hasTrait(game, DISCOUNT_COUPON_TRAIT_CODE);
  return {
    ...(totalGain !== undefined ? { totalGain } : {}),
    ...(totalUse !== undefined ? { totalUse } : {}),
    ...(totalGain !== undefined && totalUse !== undefined ? { balance: totalGain - totalUse } : {}),
    gain,
    use,
    coinToss,
    ...(totalGain && coinToss > 0 ? { coinTossPercent: coinToss / totalGain * 100 } : {}),
    discountCoupon,
    materialPurchases,
    droneItems,
    unknownSourceKeys,
    valid: errors.length === 0,
    errors,
  };
}

function buildActivity(game: StoredEternalReturnGame, references: EternalReturnReferences): ReceiptActivityView {
  const lines: string[] = [];
  if (positive(game.tacticalSkillUseCount) !== undefined) {
    lines.push(`${references.tacticalSkillName(game.tacticalSkillGroup)} ${game.tacticalSkillUseCount}회`);
  }
  if (positive(game.useHyperLoop) !== undefined) lines.push(`하이퍼루프 ${game.useHyperLoop}회`);
  if (positive(game.damageToGuideRobot) !== undefined) lines.push(`LUMI에게 가한 피해 ${format(game.damageToGuideRobot)}`);
  if (positive(game.useGuideRobot) !== undefined) lines.push(`LUMI 채널링 ${game.useGuideRobot}회`);
  if (positive(game.fishingCount) !== undefined) lines.push(`낚시 ${game.fishingCount}회`);
  if (positive(game.useEmoticonCount) !== undefined) lines.push(`이모트 ${game.useEmoticonCount}회`);
  if (positive(game.enterDimensionRift) !== undefined) {
    const detail = [
      `균열 진입 ${format(game.enterDimensionRift)}회`,
      positive(game.winFromDimensionRift) !== undefined ? `승리 ${format(game.winFromDimensionRift)}회` : "",
      positive(game.enterDimensionEmpoweredRift) !== undefined
        ? `강화 ${format(game.enterDimensionEmpoweredRift)}회` : "",
    ].filter(Boolean).join(" · ");
    lines.push(detail);
  }
  if (positive(game.enterTurbulentRift) !== undefined) lines.push(`난류 진입 ${game.enterTurbulentRift}회`);
  if (positive(game.sumGetBuffCube) !== undefined) lines.push(`큐브 ${game.sumGetBuffCube}개`);
  const boriRewards = sum(Object.values(numericRecord(game.getBoriReward)));
  if (boriRewards > 0) lines.push(`보리 보상 상자 ${format(boriRewards)}개`);
  const foodCrafts = sumJsonCounts(game.foodCraftCount);
  const beverageCrafts = sumJsonCounts(game.beverageCraftCount);
  const airSupplies = sumJsonCounts(game.airSupplyOpenCount);
  if (foodCrafts > 0) lines.push(`음식 제작 ${format(foodCrafts)}회`);
  if (beverageCrafts > 0) lines.push(`음료 제작 ${format(beverageCrafts)}회`);
  if (airSupplies > 0) lines.push(`항공 보급 개봉 ${format(airSupplies)}회`);
  for (const [code, count] of Object.entries(numericRecord(game.useGadget))) {
    if (count > 0) lines.push(`${references.gadgetName(code)} ${format(count)}회`);
  }
  for (const [code, count] of Object.entries(numericRecord(game.activeInstallation))) {
    if (count > 0) lines.push(`환경 변수 ${code} ${format(count)}회`);
  }
  const seasonActivities: Array<[unknown, string]> = [
    [game.gimmickAppleDropped, "사과 드롭"],
    [game.gimmickDrumUseCount, "북 사용"],
    [game.gimmickDrumAttackCount, "북 공격"],
    [game.gimmickDrumDroppedHitCount, "북 드롭 적중"],
    [sumJsonCounts(game.gimmickEvidenceLockerCount), "증거 보관함"],
    [game.gimmickGrandfatherClockUseCount, "괘종시계 사용"],
    [game.craftMythic, "신화 아이템 제작"],
  ];
  for (const [value, label] of seasonActivities) {
    if (positive(value) !== undefined) lines.push(`${label} ${format(value)}회`);
  }
  const evidenceItems = countJsonItems(game.gimmickEvidenceLockerItem);
  if (evidenceItems > 0) lines.push(`증거 보관함 아이템 ${format(evidenceItems)}개`);
  if (positive(game.gimmickHospitalDiscountRate) !== undefined) {
    lines.push(`병원 할인율 ${format(game.gimmickHospitalDiscountRate)}%`);
  }
  return { lines };
}

function buildBuild(
  game: StoredEternalReturnGame,
  references: EternalReturnReferences,
  route: EternalReturnWeaponRoute | undefined,
): ReceiptBuildView {
  const equipment = Object.entries(game.equipment ?? {})
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([, code]) => references.itemName(code));
  const traits = [
    game.traitFirstCore,
    ...(game.traitFirstSub ?? []),
    ...(game.traitSecondSub ?? []),
  ].filter((code): code is number => typeof code === "number" && code > 0)
    .map(code => references.traitName(code));
  const skillOrder = parseSkillOrder(game.skillOrderInfo).map(code => references.skillName(code));
  return {
    equipment,
    traits,
    skillOrder,
    ...(game.placeOfStart !== undefined ? { startArea: references.areaName(game.placeOfStart) } : {}),
    ...(route ? { route } : {}),
  };
}

function selectFeatures(
  game: StoredEternalReturnGame,
  credits: ReceiptCreditView,
  previousGames: readonly StoredEternalReturnGame[],
): string[] {
  const candidates: Array<{ priority: number; text: string }> = [];
  if (game.gameRank === 1) candidates.push({ priority: 100, text: "1위 달성" });
  else if (game.gameRank !== undefined && game.gameRank <= 3) {
    candidates.push({ priority: 95, text: `TOP 3 · ${game.gameRank}위` });
  }
  if (positive(game.totalExtraKill) !== undefined) candidates.push({ priority: 92, text: `연속 다중 킬 ${format(game.totalExtraKill)}회` });
  else if (positive(game.totalQuadraKill) !== undefined) candidates.push({ priority: 91, text: `쿼드라 킬 ${format(game.totalQuadraKill)}회` });
  else if (positive(game.totalTripleKill) !== undefined) candidates.push({ priority: 90, text: `트리플 킬 ${format(game.totalTripleKill)}회` });
  if (credits.coinToss > 0) candidates.push({ priority: 88, text: `코인 토스로 ${format(credits.coinToss)} 크레딧 획득` });
  if (positive(game.creditRevivedOthersCount) !== undefined) {
    candidates.push({ priority: 86, text: `아군 부활 ${format(game.creditRevivedOthersCount)}회` });
  }
  if (positive(game.clutchCount) !== undefined) candidates.push({ priority: 84, text: `클러치 ${format(game.clutchCount)}회` });
  const cameras = sum([game.addSurveillanceCamera, game.addTelephotoCamera]);
  if (cameras > 0) candidates.push({ priority: 75, text: `카메라 ${format(cameras)}개 설치` });
  if (positive(game.damageToGuideRobot) !== undefined) {
    candidates.push({ priority: 65, text: `LUMI 피해 ${format(game.damageToGuideRobot)}` });
  }
  if (positive(game.craftMythic) !== undefined) candidates.push({ priority: 65, text: `신화 아이템 제작 ${format(game.craftMythic)}회` });
  addPersonalBest(candidates, game, previousGames, "damageToPlayer", "개인 최고 피해", false);
  addPersonalBest(candidates, game, previousGames, "playerKill", "개인 최고 킬", false);
  addPersonalBest(candidates, game, previousGames, "ccTimeToPlayer", "개인 최고 CC", false);
  addPersonalBest(candidates, game, previousGames, "gameRank", "개인 최고 순위", true);
  if ((game.damageToPlayer ?? 0) >= 30_000) candidates.push({ priority: 55, text: `가한 피해 ${format(game.damageToPlayer)}` });
  return unique(candidates.sort((a, b) => b.priority - a.priority).map(item => item.text)).slice(0, 4);
}

function addPersonalBest(
  candidates: Array<{ priority: number; text: string }>,
  game: StoredEternalReturnGame,
  previousGames: readonly StoredEternalReturnGame[],
  field: "damageToPlayer" | "playerKill" | "ccTimeToPlayer" | "gameRank",
  label: string,
  lowerIsBetter: boolean,
): void {
  const current = finite(game[field]);
  const comparable = previousGames.filter(previous => previous.gameId !== game.gameId
    && previous.matchingMode === game.matchingMode
    && previous.matchingTeamMode === game.matchingTeamMode)
    .map(previous => finite(previous[field])).filter((value): value is number => value !== undefined);
  if (current === undefined || comparable.length < 5) return;
  const best = lowerIsBetter ? Math.min(...comparable) : Math.max(...comparable);
  if ((lowerIsBetter && current < best) || (!lowerIsBetter && current > best)) {
    candidates.push({ priority: 80, text: `${label} ${format(current)}` });
  }
}

function addRemainder(
  metrics: ReceiptMetric[],
  total: number | undefined,
  key: string,
  label: string,
  errors: string[],
): void {
  if (total === undefined) return;
  const known = sum(metrics.map(item => item.value));
  const remainder = roundCredit(total - known);
  if (remainder < -0.01) {
    errors.push(`${label} 상세 합계 ${format(known)}가 총액 ${format(total)}보다 큽니다.`);
  } else if (remainder > 0.01) {
    metrics.push({ key: `${key}-unclassified`, label: "미분류", value: remainder });
  }
}

function validateSameValue(label: string, values: readonly number[], errors: string[]): void {
  const distinct = [...new Set(values.filter(value => value > 0).map(roundCredit))];
  if (distinct.length > 1) errors.push(`${label} 출처 값이 서로 다릅니다: ${distinct.map(format).join(" / ")}`);
}

function parseSkillOrder(value: unknown): Array<string | number> {
  if (Array.isArray(value)) return value.filter(item => typeof item === "string" || typeof item === "number");
  if (!value || typeof value !== "object") return [];
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.every(([, item]) => typeof item === "string" || typeof item === "number")) {
    return entries.sort(([left], [right]) => Number(left) - Number(right)).map(([, item]) => item as string | number);
  }
  const ordered: Array<{ order: number; skill: string }> = [];
  for (const [skill, rawOrders] of entries) {
    if (!Array.isArray(rawOrders)) continue;
    for (const rawOrder of rawOrders) {
      const order = Number(rawOrder);
      if (Number.isFinite(order)) ordered.push({ order, skill });
    }
  }
  return ordered.sort((left, right) => left.order - right.order).map(item => item.skill);
}

function countItems(value: unknown, references: EternalReturnReferences) {
  if (!Array.isArray(value)) return [];
  const counts = new Map<number, number>();
  for (const raw of value) {
    const code = Number(raw);
    if (Number.isSafeInteger(code) && code > 0) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()].map(([code, count]) => ({ code, name: references.itemName(code), count }));
}

function hasTrait(game: StoredEternalReturnGame, code: number): boolean {
  return [game.traitFirstCore, ...(game.traitFirstSub ?? []), ...(game.traitSecondSub ?? [])].includes(code);
}

function numericRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .flatMap(([key, raw]) => finite(raw) !== undefined ? [[key, finite(raw)!]] : []));
}

function sumJsonCounts(value: unknown): number {
  if (Array.isArray(value)) return sum(value);
  return sum(Object.values(numericRecord(value)));
}

function countJsonItems(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  return sumJsonCounts(value);
}

function metric(key: string, label: string, value: unknown, details?: readonly ReceiptMetric[]): ReceiptMetric[] {
  const number = positive(value);
  return number === undefined ? [] : [{ key, label, value: number, ...(details?.length ? { details } : {}) }];
}

function positive(value: unknown): number | undefined {
  const number = finite(value);
  return number !== undefined && number > 0 ? number : undefined;
}

function positiveOrZero(value: unknown): number {
  return positive(value) ?? 0;
}

function nonNegative(value: unknown): number | undefined {
  const number = finite(value);
  return number !== undefined && number >= 0 ? number : undefined;
}

function finite(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function firstPositive(...values: number[]): number {
  return values.find(value => value > 0) ?? 0;
}

function sum(values: readonly unknown[]): number {
  return roundCredit(values.reduce<number>((total, value) => total + (finite(value) ?? 0), 0));
}

function sumKeys(source: Readonly<Record<string, number>>, keys: readonly string[]): number {
  return sum(keys.map(key => source[key]));
}

function firstDefined(values: readonly (number | undefined)[]): number | undefined {
  return values.find(value => value !== undefined);
}

function roundCredit(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function gameDuration(game: StoredEternalReturnGame): number | undefined {
  return positive(game.duration) ?? positive(game.playTime) ?? positive(game.totalTime);
}

function format(value: unknown): string {
  const number = finite(value);
  return number === undefined ? "-" : number.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
}

function boriLabel(key: string): string {
  return ({
    BoriIdleDropInterval: "산책 중 드롭",
    BoriStartRunaway: "도주 시작",
    BoriRunawayDropInterval: "도주 중 드롭",
    BoriDeath: "처치",
  } as Record<string, string>)[key] ?? key;
}

function objectLabel(key: string): string {
  return ({
    KillAttackDrone: "공격 드론",
    KillCamera: "카메라 파괴",
    KillOrb: "ORB 파괴",
    GoldSecurityConsoleAccess: "황금 보안 콘솔",
    DoorConsoleAccess: "문 콘솔",
  } as Record<string, string>)[key] ?? key;
}
