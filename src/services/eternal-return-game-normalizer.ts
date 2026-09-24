import type { EternalReturnGame } from "../sources/eternal-return.js";

type JsonPrimitive = string | number | boolean | null;
export type EternalReturnJsonValue = JsonPrimitive | EternalReturnJsonValue[] | {
  [key: string]: EternalReturnJsonValue;
};

const NUMBER_FIELDS = [
  "gameId", "seasonId", "versionSeason", "versionMajor", "versionMinor",
  "matchingMode", "matchingTeamMode", "characterNum", "characterLevel", "gameRank",
  "playerKill", "playerAssistant", "playerDeaths", "teamKill", "mmrGain", "mmrBefore",
  "mmrAfter", "damageToPlayer", "damageFromPlayer", "damageToMonster", "healAmount",
  "teamRecover", "protectAbsorb", "ccTimeToPlayer", "monsterKill", "routeIdOfStart",
  "playTime", "totalTime", "duration", "victory", "escapeState", "viewContribution",
  "addSurveillanceCamera", "removeSurveillanceCamera", "addTelephotoCamera",
  "removeTelephotoCamera", "useReconDrone", "useEmpDrone", "useHyperLoop",
  "useSecurityConsole", "tacticalSkillGroup", "tacticalSkillLevel", "tacticalSkillUseCount",
  "teamNumber", "preMade", "premadeMatchingType", "botAdded", "bestWeapon",
  "bestWeaponLevel", "mmrAvg", "skinCode", "traitFirstCore",
  "damageToPlayer_basic", "damageToPlayer_skill", "damageToPlayer_itemSkill",
  "damageToPlayer_direct", "damageToPlayer_uniqueSkill", "damageToPlayer_trap",
  "damageToPlayer_Shield", "damageOffsetedByShield_Player", "damageOffsetedByShield_Monster",
  "totalDoubleKill", "totalTripleKill", "totalQuadraKill", "totalExtraKill", "clutchCount",
  "terminateCount", "teamElimination", "teamDown", "totalGainVFCredit", "totalUseVFCredit",
  "crGetAnimal", "crGetMutant", "crGetPhaseStart", "crGetKill", "crGetAssist",
  "crGetTimeElapsed", "crGetCreditBonus", "crGetByGuideRobot", "killAlphaGainVFCredit",
  "killOmegaGainVFCredit", "killGammaGainVFCredit", "killWicklineGainVFCredit",
  "killItemBountyGainVFCredit", "killDroneGainVFCredit", "killTurretGainVFCredit",
  "itemShredderGainVFCredit", "kioskExchangeCredit", "remoteDroneUseVFCreditMySelf",
  "remoteDroneUseVFCreditAlly", "transferConsoleFromMaterialUseVFCredit",
  "transferConsoleFromEscapeKeyUseVFCredit", "transferConsoleFromRevivalUseVFCredit",
  "creditRevivalCount", "creditRevivedOthersCount", "tacticalSkillUpgradeUseVFCredit",
  "crUseRemoteDrone", "crUseUpgradeTacticalSkill", "crUseTreeOfLife", "crUseMeteorite",
  "crUseMythril", "crUseForceCore", "crUseVFBloodSample", "crUseActivationModule",
  "crUseRootkit", "damageToGuideRobot", "useGuideRobot", "fishingCount",
  "useEmoticonCount", "craftMythic", "enterDimensionRift", "enterDimensionEmpoweredRift",
  "winFromDimensionRift", "winFromDimensionEmpoweredRift", "enterTurbulentRift",
  "getBuffCubeRed", "getBuffCubePurple", "getBuffCubeGreen", "getBuffCubeGold",
  "getBuffCubeSkyBlue", "sumGetBuffCube", "gimmickAppleDropped", "gimmickDrumUseCount",
  "gimmickDrumAttackCount", "gimmickDrumDroppedHitCount", "gimmickHospitalDiscountRate",
  "gimmickGrandfatherClockUseCount",
] as const;

const STRING_FIELDS = ["gameVersion", "startDtm", "nickname"] as const;

const NUMBER_ARRAY_FIELDS = [
  "traitFirstSub", "traitSecondSub", "totalVFCredits", "usedVFCredits",
  "itemTransferredConsole", "itemTransferredDrone",
] as const;

const JSON_FIELDS = [
  "equipment", "killMonsters", "creditSource", "masteryLevel", "skillLevelInfo",
  "skillOrderInfo", "foodCraftCount", "beverageCraftCount", "airSupplyOpenCount",
  "getBoriReward", "activeInstallation", "useGadget", "gimmickEvidenceLockerCount",
  "gimmickEvidenceLockerItem", "receiptDetails",
] as const;

const MIXED_FIELDS = ["placeOfStart", "placeOfDeath"] as const;

const ALIASES = {
  totalVFCredits: ["totalVFCredits", "totalVFCredit"],
  usedVFCredits: ["usedVFCredits", "usedVFCredit"],
  transferConsoleFromMaterialUseVFCredit: [
    "transferConsoleFromMaterialUseVFCredit", "kioskFromMaterialUseVFCredit",
  ],
  transferConsoleFromEscapeKeyUseVFCredit: [
    "transferConsoleFromEscapeKeyUseVFCredit", "kioskFromEscapeKeyUseVFCredit",
  ],
  transferConsoleFromRevivalUseVFCredit: [
    "transferConsoleFromRevivalUseVFCredit", "kioskFromRevivalUseVFCredit",
  ],
} as const;

const ARRAY_ALIAS_FIELDS = new Set<string>(["totalVFCredits", "usedVFCredits"]);

const ALIAS_NAMES = new Set<string>(Object.values(ALIASES).flat());
const KNOWN_FIELDS = new Set<string>([
  ...NUMBER_FIELDS, ...STRING_FIELDS, ...NUMBER_ARRAY_FIELDS, ...JSON_FIELDS, ...MIXED_FIELDS,
  ...ALIAS_NAMES, "extra", "normalizationWarnings",
]);

export function normalizeEternalReturnGame(value: unknown): EternalReturnGame | undefined {
  if (!isRecord(value)) return undefined;
  const normalized: Record<string, unknown> = {};
  const warnings = Array.isArray(value.normalizationWarnings)
    ? value.normalizationWarnings.filter((entry): entry is string => typeof entry === "string")
    : [];

  for (const field of NUMBER_FIELDS) {
    if (!Object.hasOwn(value, field)) continue;
    const number = finiteNumber(value[field]);
    if (number === undefined) warnings.push(`${field}: 유효한 숫자가 아님`);
    else normalized[field] = number;
  }
  for (const field of STRING_FIELDS) {
    if (!Object.hasOwn(value, field)) continue;
    if (typeof value[field] === "string") normalized[field] = value[field];
    else if (value[field] !== null && value[field] !== undefined) warnings.push(`${field}: 문자열이 아님`);
  }
  for (const field of NUMBER_ARRAY_FIELDS) {
    if (ALIAS_NAMES.has(field)) continue;
    if (!Object.hasOwn(value, field)) continue;
    const array = numberArray(value[field]);
    if (array === undefined) warnings.push(`${field}: 숫자 배열이 아님`);
    else normalized[field] = array;
  }
  for (const field of JSON_FIELDS) {
    if (!Object.hasOwn(value, field)) continue;
    const json = normalizeKnownJson(value[field]);
    if (json === undefined) warnings.push(`${field}: JSON 값이 아님`);
    else normalized[field] = json;
  }
  for (const field of MIXED_FIELDS) {
    if (!Object.hasOwn(value, field)) continue;
    const mixed = numberOrString(value[field]);
    if (mixed === undefined) warnings.push(`${field}: 숫자 또는 문자열이 아님`);
    else normalized[field] = mixed;
  }

  for (const [canonical, names] of Object.entries(ALIASES)) {
    const found = names.filter(name => Object.hasOwn(value, name));
    if (found.length === 0) continue;
    const usable: Array<readonly [string, number | number[]]> = [];
    for (const name of found) {
      const parsed = ARRAY_ALIAS_FIELDS.has(canonical)
        ? numberArray(value[name])
        : finiteNumber(value[name]);
      if (parsed !== undefined) usable.push([name, parsed]);
    }
    if (usable.length === 0) {
      warnings.push(`${canonical}: 별칭 값의 형식이 잘못됨`);
      continue;
    }
    normalized[canonical] = usable[0]![1];
    if (usable.slice(1).some(([, aliasValue]) => !sameValue(aliasValue, usable[0]![1]))) {
      warnings.push(`${canonical}: 별칭 값이 서로 다름 (${usable.map(([name]) => name).join(", ")})`);
    }
  }

  const extra: Record<string, EternalReturnJsonValue> = {};
  if (isRecord(value.extra)) {
    for (const [key, entry] of Object.entries(value.extra)) {
      const json = cloneJson(entry);
      if (json !== undefined) extra[key] = json;
    }
  }
  for (const [key, entry] of Object.entries(value)) {
    if (KNOWN_FIELDS.has(key)) continue;
    const json = cloneJson(entry);
    if (json !== undefined) extra[key] = json;
  }
  if (Object.keys(extra).length > 0) normalized.extra = extra;
  if (warnings.length > 0) normalized.normalizationWarnings = warnings;
  return normalized as EternalReturnGame;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function numberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: number[] = [];
  for (const entry of value) {
    const parsed = finiteNumber(entry);
    if (parsed === undefined) return undefined;
    result.push(parsed);
  }
  return result;
}

function numberOrString(value: unknown): number | string | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const parsed = finiteNumber(value);
  return parsed ?? value;
}

function cloneJson(value: unknown): EternalReturnJsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const result: EternalReturnJsonValue[] = [];
    for (const entry of value) {
      const cloned = cloneJson(entry);
      if (cloned === undefined) return undefined;
      result.push(cloned);
    }
    return result;
  }
  if (!isRecord(value)) return undefined;
  const result: Record<string, EternalReturnJsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    const cloned = cloneJson(entry);
    if (cloned === undefined) return undefined;
    result[key] = cloned;
  }
  return result;
}

function normalizeKnownJson(value: unknown): EternalReturnJsonValue | undefined {
  if (typeof value === "string") return finiteNumber(value) ?? value;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const result: EternalReturnJsonValue[] = [];
    for (const entry of value) {
      const normalized = normalizeKnownJson(entry);
      if (normalized === undefined) return undefined;
      result.push(normalized);
    }
    return result;
  }
  if (!isRecord(value)) return undefined;
  const result: Record<string, EternalReturnJsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalized = normalizeKnownJson(entry);
    if (normalized === undefined) return undefined;
    result[key] = normalized;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameValue(left: number | number[], right: number | number[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
