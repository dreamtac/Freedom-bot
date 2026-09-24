# 이터널 리턴 게임 결과 실제 응답 표본 감사

생성 시각: 2026-09-22T11:50:22.724Z
표본: 300개 유저 경기 · 등록 유저 5명 · 유저당 최대 6페이지

원본 응답과 API 키·UID는 저장하지 않는다. 이 보고서는 필드의 존재 여부, 타입, 0/결측과 집계된 출처 키만 포함한다.

## 핵심 결론

- 랭크의 `mmrGain`은 247/247 (100.0%), 일반은 0/31 (0.0%)였다. RP는 랭크에서만 표시하고 결측을 0으로 만들지 않는다.
- `crGetAssist` 0건: 일반 31/31, 랭크 247/247. 루미아 모드의 어시스트 수익 상세는 실제로 관측된 `creditSource.KillAssistDivideContribute`를 사용한다.
- 코인 토스는 특성 코드와 수익 키가 함께 확인된 표본 48건, 불일치 0건이었다.
- 현재 실응답 별칭: `totalVFCredits` ← `totalVFCredits`; `usedVFCredits` ← `usedVFCredits`; `transferConsoleFromMaterialUseVFCredit` ← `kioskFromMaterialUseVFCredit`; `transferConsoleFromEscapeKeyUseVFCredit` ← `kioskFromEscapeKeyUseVFCredit`; `transferConsoleFromRevivalUseVFCredit` ← `kioskFromRevivalUseVFCredit`.
- 표시명이 확정되지 않은 크레딧 키: `GetBySkill`, `InfusionStore`, `ItemSkill_ThunderExecution`, `KillAssist`, `ScoreGap`, `TakeOver`. 이 값은 원본 보존 후 `미분류`로 처리한다.

## 모드별 표본

| 모드 | 표본 수 |
|---|---:|
| rank | 247 |
| normal | 31 |
| cobalt | 22 |

## 후보 필드 존재율과 타입

`결측`은 키 자체가 없는 응답이며 `0`은 키가 있고 값이 숫자 0 또는 문자열 `0`인 응답이다.

| 필드 | 전체 존재 | 전체 0 | 전체 결측 | 타입 | 일반 존재/0 | 랭크 존재/0 |
|---|---:|---:|---:|---|---:|---:|
| `matchingMode` | 300/300 (100.0%) | 0 | 0 | number:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 0 |
| `matchingTeamMode` | 300/300 (100.0%) | 0 | 0 | number:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 0 |
| `seasonId` | 300/300 (100.0%) | 53 | 0 | number:300 | 31/31 (100.0%) / 31 | 247/247 (100.0%) / 0 |
| `gameId` | 300/300 (100.0%) | 0 | 0 | number:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 0 |
| `gameRank` | 300/300 (100.0%) | 0 | 0 | number:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 0 |
| `mmrGain` | 247/300 (82.3%) | 1 | 53 | number:247 | 0/31 (0.0%) / 0 | 247/247 (100.0%) / 1 |
| `damageToPlayer` | 300/300 (100.0%) | 0 | 0 | number:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 0 |
| `damageFromPlayer` | 300/300 (100.0%) | 0 | 0 | number:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 0 |
| `damageToMonster` | 300/300 (100.0%) | 4 | 0 | number:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 0 |
| `damageToPlayer_basic` | 300/300 (100.0%) | 4 | 0 | number:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 4 |
| `damageToPlayer_skill` | 300/300 (100.0%) | 0 | 0 | number:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 0 |
| `damageToPlayer_itemSkill` | 300/300 (100.0%) | 47 | 0 | number:300 | 31/31 (100.0%) / 3 | 247/247 (100.0%) / 43 |
| `damageToPlayer_direct` | 300/300 (100.0%) | 142 | 0 | number:300 | 31/31 (100.0%) / 12 | 247/247 (100.0%) / 128 |
| `damageToPlayer_uniqueSkill` | 300/300 (100.0%) | 300 | 0 | number:300 | 31/31 (100.0%) / 31 | 247/247 (100.0%) / 247 |
| `damageToPlayer_trap` | 300/300 (100.0%) | 300 | 0 | number:300 | 31/31 (100.0%) / 31 | 247/247 (100.0%) / 247 |
| `damageToPlayer_Shield` | 300/300 (100.0%) | 300 | 0 | number:300 | 31/31 (100.0%) / 31 | 247/247 (100.0%) / 247 |
| `damageOffsetedByShield_Player` | 300/300 (100.0%) | 89 | 0 | number:300 | 31/31 (100.0%) / 10 | 247/247 (100.0%) / 79 |
| `damageOffsetedByShield_Monster` | 300/300 (100.0%) | 123 | 0 | number:300 | 31/31 (100.0%) / 12 | 247/247 (100.0%) / 94 |
| `ccTimeToPlayer` | 300/300 (100.0%) | 0 | 0 | number:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 0 |
| `healAmount` | 300/300 (100.0%) | 0 | 0 | number:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 0 |
| `teamRecover` | 300/300 (100.0%) | 246 | 0 | number:300 | 31/31 (100.0%) / 27 | 247/247 (100.0%) / 210 |
| `protectAbsorb` | 300/300 (100.0%) | 88 | 0 | number:300 | 31/31 (100.0%) / 10 | 247/247 (100.0%) / 78 |
| `totalDoubleKill` | 300/300 (100.0%) | 288 | 0 | number:300 | 31/31 (100.0%) / 31 | 247/247 (100.0%) / 247 |
| `totalTripleKill` | 300/300 (100.0%) | 298 | 0 | number:300 | 31/31 (100.0%) / 31 | 247/247 (100.0%) / 247 |
| `totalQuadraKill` | 300/300 (100.0%) | 300 | 0 | number:300 | 31/31 (100.0%) / 31 | 247/247 (100.0%) / 247 |
| `totalExtraKill` | 300/300 (100.0%) | 300 | 0 | number:300 | 31/31 (100.0%) / 31 | 247/247 (100.0%) / 247 |
| `clutchCount` | 300/300 (100.0%) | 294 | 0 | number:300 | 31/31 (100.0%) / 30 | 247/247 (100.0%) / 242 |
| `terminateCount` | 300/300 (100.0%) | 177 | 0 | number:300 | 31/31 (100.0%) / 16 | 247/247 (100.0%) / 139 |
| `teamElimination` | 300/300 (100.0%) | 109 | 0 | number:300 | 31/31 (100.0%) / 8 | 247/247 (100.0%) / 83 |
| `teamDown` | 300/300 (100.0%) | 3 | 0 | number:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 3 |
| `viewContribution` | 300/300 (100.0%) | 3 | 0 | number:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 3 |
| `addSurveillanceCamera` | 300/300 (100.0%) | 300 | 0 | number:300 | 31/31 (100.0%) / 31 | 247/247 (100.0%) / 247 |
| `addTelephotoCamera` | 300/300 (100.0%) | 13 | 0 | number:300 | 31/31 (100.0%) / 1 | 247/247 (100.0%) / 9 |
| `removeSurveillanceCamera` | 300/300 (100.0%) | 300 | 0 | number:300 | 31/31 (100.0%) / 31 | 247/247 (100.0%) / 247 |
| `removeTelephotoCamera` | 300/300 (100.0%) | 135 | 0 | number:300 | 31/31 (100.0%) / 10 | 247/247 (100.0%) / 120 |
| `useSecurityConsole` | 300/300 (100.0%) | 87 | 0 | number:300 | 31/31 (100.0%) / 4 | 247/247 (100.0%) / 61 |
| `useReconDrone` | 300/300 (100.0%) | 115 | 0 | number:300 | 31/31 (100.0%) / 7 | 247/247 (100.0%) / 86 |
| `useEmpDrone` | 300/300 (100.0%) | 246 | 0 | number:300 | 31/31 (100.0%) / 27 | 247/247 (100.0%) / 197 |
| `creditRevivalCount` | 300/300 (100.0%) | 252 | 0 | number:300 | 31/31 (100.0%) / 25 | 247/247 (100.0%) / 205 |
| `creditRevivedOthersCount` | 300/300 (100.0%) | 249 | 0 | number:300 | 31/31 (100.0%) / 22 | 247/247 (100.0%) / 205 |
| `totalGainVFCredit` | 300/300 (100.0%) | 0 | 0 | number:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 0 |
| `totalUseVFCredit` | 300/300 (100.0%) | 18 | 0 | number:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 18 |
| `totalVFCredits` | 300/300 (100.0%) | 0 | 0 | array:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 0 |
| `totalVFCredit` | 0/300 (0.0%) | 0 | 300 | - | 0/31 (0.0%) / 0 | 0/247 (0.0%) / 0 |
| `usedVFCredits` | 300/300 (100.0%) | 0 | 0 | array:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 0 |
| `usedVFCredit` | 0/300 (0.0%) | 0 | 300 | - | 0/31 (0.0%) / 0 | 0/247 (0.0%) / 0 |
| `creditSource` | 300/300 (100.0%) | 0 | 0 | object:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 0 |
| `crGetAnimal` | 300/300 (100.0%) | 0 | 0 | number:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 0 |
| `crGetMutant` | 300/300 (100.0%) | 22 | 0 | number:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 0 |
| `crGetPhaseStart` | 300/300 (100.0%) | 300 | 0 | number:300 | 31/31 (100.0%) / 31 | 247/247 (100.0%) / 247 |
| `crGetKill` | 300/300 (100.0%) | 27 | 0 | number:300 | 31/31 (100.0%) / 1 | 247/247 (100.0%) / 26 |
| `crGetAssist` | 300/300 (100.0%) | 278 | 0 | number:300 | 31/31 (100.0%) / 31 | 247/247 (100.0%) / 247 |
| `crGetTimeElapsed` | 300/300 (100.0%) | 0 | 0 | number:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 0 |
| `crGetCreditBonus` | 300/300 (100.0%) | 28 | 0 | number:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 6 |
| `crGetByGuideRobot` | 300/300 (100.0%) | 227 | 0 | number:300 | 31/31 (100.0%) / 24 | 247/247 (100.0%) / 181 |
| `killAlphaGainVFCredit` | 300/300 (100.0%) | 206 | 0 | number:300 | 31/31 (100.0%) / 19 | 247/247 (100.0%) / 165 |
| `killOmegaGainVFCredit` | 300/300 (100.0%) | 253 | 0 | number:300 | 31/31 (100.0%) / 28 | 247/247 (100.0%) / 212 |
| `killGammaGainVFCredit` | 300/300 (100.0%) | 290 | 0 | number:300 | 31/31 (100.0%) / 30 | 247/247 (100.0%) / 240 |
| `killWicklineGainVFCredit` | 300/300 (100.0%) | 255 | 0 | number:300 | 31/31 (100.0%) / 24 | 247/247 (100.0%) / 209 |
| `killItemBountyGainVFCredit` | 300/300 (100.0%) | 125 | 0 | number:300 | 31/31 (100.0%) / 5 | 247/247 (100.0%) / 98 |
| `killDroneGainVFCredit` | 300/300 (100.0%) | 195 | 0 | number:300 | 31/31 (100.0%) / 26 | 247/247 (100.0%) / 169 |
| `killTurretGainVFCredit` | 300/300 (100.0%) | 300 | 0 | number:300 | 31/31 (100.0%) / 31 | 247/247 (100.0%) / 247 |
| `itemShredderGainVFCredit` | 300/300 (100.0%) | 300 | 0 | number:300 | 31/31 (100.0%) / 31 | 247/247 (100.0%) / 247 |
| `kioskExchangeCredit` | 300/300 (100.0%) | 300 | 0 | number:300 | 31/31 (100.0%) / 31 | 247/247 (100.0%) / 247 |
| `remoteDroneUseVFCreditMySelf` | 300/300 (100.0%) | 82 | 0 | number:300 | 31/31 (100.0%) / 9 | 247/247 (100.0%) / 51 |
| `remoteDroneUseVFCreditAlly` | 300/300 (100.0%) | 289 | 0 | number:300 | 31/31 (100.0%) / 30 | 247/247 (100.0%) / 237 |
| `transferConsoleFromMaterialUseVFCredit` | 0/300 (0.0%) | 0 | 300 | - | 0/31 (0.0%) / 0 | 0/247 (0.0%) / 0 |
| `kioskFromMaterialUseVFCredit` | 300/300 (100.0%) | 64 | 0 | number:300 | 31/31 (100.0%) / 3 | 247/247 (100.0%) / 39 |
| `transferConsoleFromEscapeKeyUseVFCredit` | 0/300 (0.0%) | 0 | 300 | - | 0/31 (0.0%) / 0 | 0/247 (0.0%) / 0 |
| `kioskFromEscapeKeyUseVFCredit` | 300/300 (100.0%) | 297 | 0 | number:300 | 31/31 (100.0%) / 31 | 247/247 (100.0%) / 244 |
| `transferConsoleFromRevivalUseVFCredit` | 0/300 (0.0%) | 0 | 300 | - | 0/31 (0.0%) / 0 | 0/247 (0.0%) / 0 |
| `kioskFromRevivalUseVFCredit` | 300/300 (100.0%) | 242 | 0 | number:300 | 31/31 (100.0%) / 22 | 247/247 (100.0%) / 198 |
| `tacticalSkillUpgradeUseVFCredit` | 300/300 (100.0%) | 269 | 0 | number:300 | 31/31 (100.0%) / 27 | 247/247 (100.0%) / 220 |
| `damageToGuideRobot` | 300/300 (100.0%) | 220 | 0 | number:300 | 31/31 (100.0%) / 24 | 247/247 (100.0%) / 174 |
| `useGuideRobot` | 300/300 (100.0%) | 300 | 0 | number:300 | 31/31 (100.0%) / 31 | 247/247 (100.0%) / 247 |
| `crUseRemoteDrone` | 300/300 (100.0%) | 82 | 0 | number:300 | 31/31 (100.0%) / 9 | 247/247 (100.0%) / 51 |
| `crUseUpgradeTacticalSkill` | 300/300 (100.0%) | 300 | 0 | number:300 | 31/31 (100.0%) / 31 | 247/247 (100.0%) / 247 |
| `crUseTreeOfLife` | 300/300 (100.0%) | 234 | 0 | number:300 | 31/31 (100.0%) / 27 | 247/247 (100.0%) / 185 |
| `crUseMeteorite` | 300/300 (100.0%) | 255 | 0 | number:300 | 31/31 (100.0%) / 28 | 247/247 (100.0%) / 205 |
| `crUseMythril` | 300/300 (100.0%) | 223 | 0 | number:300 | 31/31 (100.0%) / 17 | 247/247 (100.0%) / 184 |
| `crUseForceCore` | 300/300 (100.0%) | 86 | 0 | number:300 | 31/31 (100.0%) / 3 | 247/247 (100.0%) / 61 |
| `crUseVFBloodSample` | 300/300 (100.0%) | 243 | 0 | number:300 | 31/31 (100.0%) / 20 | 247/247 (100.0%) / 201 |
| `crUseActivationModule` | 300/300 (100.0%) | 269 | 0 | number:300 | 31/31 (100.0%) / 27 | 247/247 (100.0%) / 220 |
| `crUseRootkit` | 300/300 (100.0%) | 300 | 0 | number:300 | 31/31 (100.0%) / 31 | 247/247 (100.0%) / 247 |
| `tacticalSkillGroup` | 300/300 (100.0%) | 0 | 0 | number:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 0 |
| `tacticalSkillLevel` | 300/300 (100.0%) | 0 | 0 | number:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 0 |
| `tacticalSkillUseCount` | 300/300 (100.0%) | 3 | 0 | number:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 3 |
| `skillLevelInfo` | 300/300 (100.0%) | 0 | 0 | object:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 0 |
| `skillOrderInfo` | 300/300 (100.0%) | 0 | 0 | object:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 0 |
| `routeIdOfStart` | 300/300 (100.0%) | 48 | 0 | number:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 26 |
| `fishingCount` | 300/300 (100.0%) | 287 | 0 | number:300 | 31/31 (100.0%) / 29 | 247/247 (100.0%) / 236 |
| `useEmoticonCount` | 300/300 (100.0%) | 112 | 0 | number:300 | 31/31 (100.0%) / 27 | 247/247 (100.0%) / 85 |
| `useHyperLoop` | 300/300 (100.0%) | 11 | 0 | number:300 | 31/31 (100.0%) / 1 | 247/247 (100.0%) / 10 |
| `airSupplyOpenCount` | 0/300 (0.0%) | 0 | 300 | - | 0/31 (0.0%) / 0 | 0/247 (0.0%) / 0 |
| `foodCraftCount` | 300/300 (100.0%) | 0 | 0 | array:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 0 |
| `beverageCraftCount` | 0/300 (0.0%) | 0 | 300 | - | 0/31 (0.0%) / 0 | 0/247 (0.0%) / 0 |
| `activeInstallation` | 300/300 (100.0%) | 0 | 0 | object:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 0 |
| `useGadget` | 300/300 (100.0%) | 0 | 0 | object:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 0 |
| `getBoriReward` | 300/300 (100.0%) | 0 | 0 | object:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 0 |
| `sumGetBuffCube` | 300/300 (100.0%) | 261 | 0 | number:300 | 31/31 (100.0%) / 26 | 247/247 (100.0%) / 213 |
| `getBuffCubeRed` | 300/300 (100.0%) | 291 | 0 | number:300 | 31/31 (100.0%) / 29 | 247/247 (100.0%) / 240 |
| `getBuffCubePurple` | 300/300 (100.0%) | 300 | 0 | number:300 | 31/31 (100.0%) / 31 | 247/247 (100.0%) / 247 |
| `getBuffCubeGreen` | 300/300 (100.0%) | 287 | 0 | number:300 | 31/31 (100.0%) / 29 | 247/247 (100.0%) / 236 |
| `getBuffCubeGold` | 300/300 (100.0%) | 288 | 0 | number:300 | 31/31 (100.0%) / 31 | 247/247 (100.0%) / 235 |
| `getBuffCubeSkyBlue` | 300/300 (100.0%) | 292 | 0 | number:300 | 31/31 (100.0%) / 30 | 247/247 (100.0%) / 240 |
| `enterDimensionRift` | 300/300 (100.0%) | 192 | 0 | number:300 | 31/31 (100.0%) / 19 | 247/247 (100.0%) / 151 |
| `enterDimensionEmpoweredRift` | 300/300 (100.0%) | 254 | 0 | number:300 | 31/31 (100.0%) / 25 | 247/247 (100.0%) / 207 |
| `winFromDimensionRift` | 300/300 (100.0%) | 213 | 0 | number:300 | 31/31 (100.0%) / 20 | 247/247 (100.0%) / 171 |
| `winFromDimensionEmpoweredRift` | 300/300 (100.0%) | 261 | 0 | number:300 | 31/31 (100.0%) / 25 | 247/247 (100.0%) / 214 |
| `enterTurbulentRift` | 300/300 (100.0%) | 300 | 0 | number:300 | 31/31 (100.0%) / 31 | 247/247 (100.0%) / 247 |
| `gimmickAppleDropped` | 300/300 (100.0%) | 242 | 0 | number:300 | 31/31 (100.0%) / 21 | 247/247 (100.0%) / 199 |
| `gimmickDrumUseCount` | 300/300 (100.0%) | 300 | 0 | number:300 | 31/31 (100.0%) / 31 | 247/247 (100.0%) / 247 |
| `gimmickDrumAttackCount` | 300/300 (100.0%) | 300 | 0 | number:300 | 31/31 (100.0%) / 31 | 247/247 (100.0%) / 247 |
| `gimmickDrumDroppedHitCount` | 300/300 (100.0%) | 300 | 0 | number:300 | 31/31 (100.0%) / 31 | 247/247 (100.0%) / 247 |
| `gimmickEvidenceLockerCount` | 300/300 (100.0%) | 0 | 0 | string:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 0 |
| `gimmickEvidenceLockerItem` | 300/300 (100.0%) | 0 | 0 | string:300 | 31/31 (100.0%) / 0 | 247/247 (100.0%) / 0 |
| `gimmickHospitalDiscountRate` | 300/300 (100.0%) | 292 | 0 | number:300 | 31/31 (100.0%) / 30 | 247/247 (100.0%) / 240 |
| `gimmickGrandfatherClockUseCount` | 300/300 (100.0%) | 300 | 0 | number:300 | 31/31 (100.0%) / 31 | 247/247 (100.0%) / 247 |

## 문서·실응답 별칭

| 내부 이름 | 관측한 응답명 | 동시 등장 |
|---|---|---:|
| `totalVFCredits` | `totalVFCredits` 300 / `totalVFCredit` 0 | 0 |
| `usedVFCredits` | `usedVFCredits` 300 / `usedVFCredit` 0 | 0 |
| `transferConsoleFromMaterialUseVFCredit` | `transferConsoleFromMaterialUseVFCredit` 0 / `kioskFromMaterialUseVFCredit` 300 | 0 |
| `transferConsoleFromEscapeKeyUseVFCredit` | `transferConsoleFromEscapeKeyUseVFCredit` 0 / `kioskFromEscapeKeyUseVFCredit` 300 | 0 |
| `transferConsoleFromRevivalUseVFCredit` | `transferConsoleFromRevivalUseVFCredit` 0 / `kioskFromRevivalUseVFCredit` 300 | 0 |

저장 경계에서는 위 별칭을 내부 이름으로 합치되, 두 이름이 동시에 있고 값이 다르면 조용히 덮어쓰지 않고 오류로 기록한다.

## creditSource 관측 키

| 원본 키 | 한글 표시명 | 방향 | 등장 | 0이 아님 | 타입 |
|---|---|---|---:|---:|---|
| `AcquireLumiCredit` | LUMI 도난 경보 | 획득 | 73 | 73 | number:73 |
| `BoriDeath` | 보리 처치 | 획득 | 49 | 49 | number:49 |
| `BoriIdleDropInterval` | 보리 산책 중 드롭 | 획득 | 15 | 15 | number:15 |
| `BoriRunawayDropInterval` | 보리 도주 중 드롭 | 획득 | 57 | 57 | number:57 |
| `BoriStartRunaway` | 보리 도주 시작 | 획득 | 33 | 33 | number:33 |
| `DoorConsoleAccess` | 문 콘솔 | 획득 | 62 | 62 | number:62 |
| `GetBySkill` | 미분류 | 미확정 | 21 | 21 | number:21 |
| `GoldSecurityConsoleAccess` | 황금 보안 콘솔 | 획득 | 213 | 213 | number:213 |
| `GuideRobotRadial` | LUMI 라디얼 구매 | 사용 | 37 | 37 | number:37 |
| `GuideRobotSignature` | LUMI 시그니처 구매 | 사용 | 40 | 40 | number:40 |
| `InfusionStore` | 미분류 | 미확정 | 22 | 22 | number:22 |
| `ItemBounty` | 현상금 | 획득 | 145 | 145 | number:145 |
| `ItemBountyByItemCode` | 현상금 | 획득 | 78 | 78 | number:78 |
| `ItemExchangeByItemCode` | 판매·교환 | 획득 | 37 | 37 | number:37 |
| `ItemSkill_ThunderExecution` | 미분류 | 미확정 | 12 | 12 | number:12 |
| `KillAlpha` | 알파 | 획득 | 94 | 94 | number:94 |
| `KillAssist` | 미분류 | 미확정 | 22 | 22 | number:22 |
| `KillAssistDivideContribute` | 어시스트 | 획득 | 265 | 265 | number:265 |
| `KillAttackDrone` | 공격 드론 | 획득 | 105 | 105 | number:105 |
| `KillBat` | 박쥐 | 획득 | 276 | 276 | number:276 |
| `KillBear` | 곰 | 획득 | 274 | 274 | number:274 |
| `KillBoar` | 멧돼지 | 획득 | 274 | 274 | number:274 |
| `KillCamera` | 카메라 파괴 | 획득 | 127 | 127 | number:127 |
| `KillChicken` | 닭 | 획득 | 276 | 276 | number:276 |
| `KillGamma` | 감마 | 획득 | 10 | 10 | number:10 |
| `KillMutantBat` | 변이 박쥐 | 획득 | 186 | 186 | number:186 |
| `KillMutantBear` | 변이 곰 | 획득 | 190 | 190 | number:190 |
| `KillMutantBoar` | 변이 멧돼지 | 획득 | 260 | 260 | number:260 |
| `KillMutantChicken` | 변이 닭 | 획득 | 264 | 264 | number:264 |
| `KillMutantRaven` | 변이 까마귀 | 획득 | 172 | 172 | number:172 |
| `KillMutantWildDog` | 변이 들개 | 획득 | 236 | 236 | number:236 |
| `KillMutantWolf` | 변이 늑대 | 획득 | 232 | 232 | number:232 |
| `KillOmega` | 오메가 | 획득 | 47 | 47 | number:47 |
| `KillOrb` | ORB 파괴 | 획득 | 112 | 112 | number:112 |
| `KillPlayerMerge` | 플레이어 킬 | 획득 | 273 | 273 | number:273 |
| `KillPurpleMutantBear` | 자색 변이 곰 | 획득 | 11 | 11 | number:11 |
| `KillPurpleMutantChicken` | 자색 변이 닭 | 획득 | 7 | 7 | number:7 |
| `KillPurpleMutantWildDog` | 자색 변이 들개 | 획득 | 2 | 2 | number:2 |
| `KillPurpleMutantWolf` | 자색 변이 늑대 | 획득 | 12 | 12 | number:12 |
| `KillRaven` | 까마귀 | 획득 | 268 | 268 | number:268 |
| `KillWickline` | 위클라인 | 획득 | 45 | 45 | number:45 |
| `KillWildDog` | 들개 | 획득 | 270 | 270 | number:270 |
| `KillWolf` | 늑대 | 획득 | 276 | 276 | number:276 |
| `KioskEscapeKey` | 루트키트 | 사용 | 3 | 3 | number:3 |
| `KioskRemoteDroneAlly` | 아군 원격 드론 | 사용 | 11 | 11 | number:11 |
| `KioskRemoteDroneMySelf` | 원격 드론 구매(본인) | 사용 | 218 | 218 | number:218 |
| `KioskResurrection` | 아군 부활 | 사용 | 58 | 58 | number:58 |
| `KioskSpecialMaterial` | 재료 구매 | 사용 | 236 | 236 | number:236 |
| `PreliminaryPhase` | 초기 지급 | 획득 | 278 | 278 | number:278 |
| `ScoreGap` | 미분류 | 미확정 | 13 | 13 | number:13 |
| `TacticalSkillUpgrade` | 전술 스킬 강화 모듈 | 사용 | 31 | 31 | number:31 |
| `TakeOver` | 미분류 | 미확정 | 19 | 19 | number:19 |
| `TimeElapsedCompensationByMiliSecond` | 시간 경과 | 획득 | 300 | 300 | number:300 |
| `TimeElapsedCreditBonusByMiliSecond` | 최저 크레딧 보정 | 획득 | 273 | 273 | number:273 |
| `TraitSkillCoinToss` | 코인 토스 | 획득 | 48 | 48 | number:48 |

화이트리스트에 없는 키는 의미를 추측하지 않고 `미분류`로 남긴다.

## 코인 토스 고정 검증

- 특성 코드: `7211101`
- 특성 코드가 포함된 표본: 48
- `TraitSkillCoinToss` 수익이 있는 표본: 48
- 두 조건이 함께 확인된 표본: 48
- 특성은 있으나 수익 0/결측: 0
- 수익은 있으나 특성 코드를 찾지 못함: 0

특성을 선택해도 킬·어시스트가 없다면 수익이 0일 수 있다. 반대로 수익이 있는데 특성 코드가 없으면 특성 필드 형태나 코드 변경을 다시 조사한다.

## 할인 쿠폰 고정 검증

- 특성 코드: `7210801`
- 특성 코드가 포함된 표본: 30
- 재료 구매액이 있는 표본: 28
- 재료별 실제 결제액이 있는 표본: 28
- 할인 절약액 전용 필드가 있는 표본: 0
- 할인 전용 `creditSource` 키가 있는 표본: 0

할인 쿠폰 선택 여부와 할인 후 실제 결제액은 확인할 수 있지만, 절약액 전용 필드는 관측되지 않았다. 절약액은 구매 품목과 해당 패치의 정상 가격이 모두 확인될 때만 계산한다.

## 저장 결정

### 독립 숫자 열

- `damageToPlayer_basic`, `damageToPlayer_skill`, `damageToPlayer_itemSkill`, `damageToPlayer_direct`, `damageToPlayer_uniqueSkill`, `damageToPlayer_trap`, `damageToPlayer_Shield`, `damageOffsetedByShield_Player`
- `damageOffsetedByShield_Monster`, `addTelephotoCamera`, `removeTelephotoCamera`, `useReconDrone`, `useEmpDrone`, `useHyperLoop`, `useSecurityConsole`, `totalDoubleKill`
- `totalTripleKill`, `totalQuadraKill`, `totalExtraKill`, `clutchCount`, `terminateCount`, `teamElimination`, `teamDown`, `totalGainVFCredit`
- `totalUseVFCredit`, `crGetAnimal`, `crGetMutant`, `crGetPhaseStart`, `crGetKill`, `crGetAssist`, `crGetTimeElapsed`, `crGetCreditBonus`
- `crGetByGuideRobot`, `killAlphaGainVFCredit`, `killOmegaGainVFCredit`, `killGammaGainVFCredit`, `killWicklineGainVFCredit`, `killItemBountyGainVFCredit`, `itemShredderGainVFCredit`, `kioskExchangeCredit`
- `remoteDroneUseVFCreditMySelf`, `remoteDroneUseVFCreditAlly`, `kioskFromMaterialUseVFCredit`, `kioskFromEscapeKeyUseVFCredit`, `kioskFromRevivalUseVFCredit`, `creditRevivalCount`, `creditRevivedOthersCount`, `tacticalSkillUpgradeUseVFCredit`
- `fishingCount`, `useEmoticonCount`, `useGuideRobot`, `crUseRemoteDrone`, `crUseUpgradeTacticalSkill`, `crUseTreeOfLife`, `crUseMeteorite`, `crUseMythril`
- `crUseForceCore`, `crUseVFBloodSample`, `crUseActivationModule`, `crUseRootkit`, `damageToGuideRobot`, `tacticalSkillUseCount`, `enterDimensionRift`, `enterDimensionEmpoweredRift`
- `winFromDimensionRift`, `winFromDimensionEmpoweredRift`, `enterTurbulentRift`, `getBuffCubeRed`, `getBuffCubePurple`, `getBuffCubeGreen`, `getBuffCubeGold`, `getBuffCubeSkyBlue`
- `sumGetBuffCube`, `gimmickAppleDropped`, `gimmickDrumUseCount`, `gimmickDrumAttackCount`, `gimmickDrumDroppedHitCount`, `gimmickHospitalDiscountRate`, `gimmickGrandfatherClockUseCount`

### 원본 JSON 열

- `creditSource`, `totalVFCredits`, `usedVFCredits`, `masteryLevel`, `skillLevelInfo`, `skillOrderInfo`, `foodCraftCount`, `beverageCraftCount`
- `airSupplyOpenCount`, `getBoriReward`, `activeInstallation`, `useGadget`, `gimmickEvidenceLockerCount`, `gimmickEvidenceLockerItem`, `itemTransferredConsole`, `itemTransferredDrone`

화면 계산·검색·집계에 직접 쓰는 안정적인 숫자는 독립 열로 저장한다. 키가 늘어날 수 있는 출처·스킬 순서·가젯·환경 변수·보리 보상과 시즌 기믹은 JSON 원본을 보존한다.
- 총 획득·사용은 `totalGainVFCredit`·`totalUseVFCredit`을 기준으로 하고 상세 출처를 다시 더해 총액을 만들지 않는다.
- 일반·랭크에서 결측인 필드는 0으로 강제하지 않고 `undefined`로 유지한다.
