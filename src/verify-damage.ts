/**
 * verify-damage.ts — 验证「存档真实面板 + 孙悟空神·人皇印队」对指定场景/层数的最终伤害.
 *
 * 用途:导入当前存档,输入目标场景与层数(如 `pnpm verify 通天塔 20W`),打印该层敌人受到的
 * 伤害范围(源码 Damage_Recorder.cs:80-81 的 Random.Range(0.95f,1.05f)),按游戏单位
 * formatSuoXie(ToolClass.TranslateNumsToSuoXie)输出,并打印暴击率与暴击后的浮动范围,
 * 便于与游戏里实际打出的数字核对.
 *
 * 口径(用户确认):
 * - 面板:存档主角 BattleData_Manager(主角属性继承给英灵),游戏显示什么就用什么;
 *   默认研究全满 = 技能/神通/羁绊按满配排名口径(与 yingling-output.ts 一致),面板基础值取存档真实值.
 * - 输出位:孙悟空神转职 + 人皇印(首击全体);阵容固定 孙悟空/武松/唐三藏/猪八戒/沙僧(西行取经 Lv.3).
 * - 乘区:严格复刻 yingling-output.ts:1354-1534 outputMultiplier 与 1598-1620 evalVariant 的
 *   分桶结构(攻击桶/技能倍率/武器/羁绊/伤害加成桶/神通与负面乘区),只是面板数据源换成存档.
 * - 范围:非暴击 ×0.95~1.05,暴击 = 非暴击 × 暴伤倍率 后再 ×0.95~1.05.
 * - 减伤:通天塔按 yingling-output 场景口径为 0;试炼/终局按敌人 damageReduce 封顶 80.
 * - 图鉴增伤(研究54,通天塔)需按敌人对应图鉴等级,默认 0,可用 --tujian=N 指定.
 *
 * 所有乘区来自反编译源码,不写死结果;只读存档,不写游戏目录.
 */
import {argNumber,formatSuoXie,loadSave,parseArgs,resolveSaveDir} from "./readSave.ts";
import {towerEnemy,trialEnemy,ZHONG_JU} from "./enemy-stats.ts";
import type {EnemyStats} from "./enemy-stats.ts";
import {culDamagePercent} from "./game-formulas.ts";
import {finalValue,loadMasterPanel} from "./zhanli-panel.ts";
import type {MasterPanel} from "./zhanli-panel.ts";

// 与 enemy-stats.ts 一致的场景别名.
const SCENE_ALIAS = new Map<string,"tower" | "trial" | "zhongju">([
  ["tower","tower"],["trial","trial"],["zhongju","zhongju"],
  ["终","zhongju"],["终局","zhongju"],["试","trial"],["试炼","trial"],["通","tower"],["通天塔","tower"]
]);
const SCENE_NAME: Record<"tower" | "trial" | "zhongju",string> = {
  tower: "通天塔",trial: "试炼",zhongju: "终局"
};

// 孙悟空神·人皇印队固定阵容(英灵索引见 config/names.json).
const WU_KONG = 26;
const WU_SONG = 6;
const TANG_SAN_ZANG = 27;
const ZHU_BA_JIE = 28;
const SHA_SENG = 29;
const COMBO = [WU_KONG,WU_SONG,TANG_SAN_ZANG,ZHU_BA_JIE,SHA_SENG] as const;

// 战斗期常量(与 yingling-output.ts:111-134 同口径).
const TANG_SAN_ZANG_HIT = 30;       // 唐三藏 3技能:开战全体 +30 命中
const ZHU_BA_JIE_DODGE_DOWN = 20;   // 猪八戒 3技能:开战全体 -20 闪避
const LIU_XUE_STACKS = 2;           // 猪八戒 3技能:开战 +2 层流血
const XI_XING_LEVEL = 3;            // 西行取经 4 人队 = Lv.3(关卡 count 4)
const XI_XING_RATE = 0.25 + 0.25 * XI_XING_LEVEL; // Lv.3 → ×1.0
const WU_SONG_ATK_PCT = 20;         // 武松:最高攻 +20% 攻击(进攻击桶)
const WU_SONG_DMG_ADD = 35;         // 武松 3技能:最高攻 +35% 伤害加成(进伤害加成桶)
const RAGE_SKILL_REDUCE = 30;       // 孙悟空神转职怒气技能 -30%(skill76)
const SHEN_TONG_19_PCT = 100;       // 神通19:怒气动作 +20% × 5 级 = +100%
const BATTERY_MIN = 0.95;           // Damage_Recorder.cs:80-81 Random.Range 下限
const BATTERY_MAX = 1.05;           // 同上上限

export interface DamageRange {
  scene:          string;
  layer:          number;
  enemy:          EnemyStats;
  reduce:         number;
  carryHit:       number;
  hitRate:        number;
  critRate:       number;
  critMultiplier: number;
  atkForK:        number;
  pen:            number;
  k:              number;
  total:          number;
  nonCrit:        number;
  crit:           number;
  nonCritRange:   readonly [number,number];
  critRange:      readonly [number,number];
}

// 中文层数:20W / 20w / 20万 / 1.5w → 200000 / 15000(与 enemy-stats.ts:212 parseLevel 同口径).
export function parseLayerText (text: string): number {
  const matched = (/^(\d+(?:\.\d+)?)([wW万]?)$/).exec(text.trim());
  if (!matched?.[1]) {
    throw new Error(`层数写法不对:${text}(可用 100 / 1w / 1.5w / 20W)`);
  }
  const layer = Math.round(Number(matched[1]) * (matched[2] ? 10000 : 1));
  if (!Number.isFinite(layer) || layer < 1) {
    throw new Error(`层数必须大于 0:${text}`);
  }
  return layer;
}

function resolveScene (text: string): "tower" | "trial" | "zhongju" {
  const scene = SCENE_ALIAS.get(text.trim());
  if (scene === undefined) {
    throw new Error(`未知目标:${text}(可用 通天塔 / 试炼 / 终局 或 tower / trial / zhongju)`);
  }
  return scene;
}

function enemyOf (scene: "tower" | "trial" | "zhongju",layer: number,challenge: number): EnemyStats {
  if (scene === "tower") {return towerEnemy(layer);}
  if (scene === "trial") {return trialEnemy(layer);}
  const enemy = ZHONG_JU.find(item => item.tiaoZhanID === challenge);
  if (enemy === undefined) {
    throw new Error(`config/zhongju.json 里没有 tiaoZhanID=${String(challenge)} 的终局敌人`);
  }
  return enemy;
}

// 当前佩戴阵法等级:天覆阵(1)才给最高攻 +等级% 攻击;其余阵法首击无攻击加成.
function currentZhenFa (panel: MasterPanel): {id: number; level: number} {
  const save = loadSave(resolveSaveDir(parseArgs(process.argv.slice(2))));
  const record = (save.cha.zhenFaRecorders ?? []).find(item => item.ZhenFaID === panel.zhenFaID);
  return {id: panel.zhenFaID,level: record?.Level ?? 0};
}

/**
 * 核心:按存档真实面板 + 孙悟空神·人皇印队乘区,计算对某敌人的一次伤害及各档范围.
 * 除读面板外无副作用,可被其他模块直接 import;打印交给 printDamageRange.
 * @param scene 场景.
 * @param layer 层数(终局用 challenge 定位,不参与敌人属性).
 * @param panel 存档面板(loadMasterPanel 的结果).
 * @param enemy 敌人属性.
 * @param opts 阵法等级与图鉴增伤%(研究54,仅通天塔;默认 0).
 * @returns DamageRange.
 */
export function damageRangeOf (
  scene: "tower" | "trial" | "zhongju",
  layer: number,
  panel: MasterPanel,
  enemy: EnemyStats,
  opts: {zhenFaLevel?: number; tuJianDamagePct?: number} = {}
): DamageRange {
  const reduce = scene === "tower" ? 0 : Math.min(enemy.damageReduce,80);
  const tuJianDamagePct = opts.tuJianDamagePct ?? 0;
  const zhenFaLevel = opts.zhenFaLevel ?? 0;

  // 面板基础值:裸攻击与攻击%分桶,对齐 yingling-output 的 atkFlat / atkPct.
  const atkFlat = panel.base[0] ?? 0;
  const atkPct = panel.pct[0] ?? 0;
  const pen = finalValue(panel,15);
  const hit = finalValue(panel,4);
  const critPanel = finalValue(panel,6);
  const critDamage = finalValue(panel,8);
  const dmgAdd = finalValue(panel,13);
  const lucky = finalValue(panel,17);

  // 孙悟空神转职命中 = 面板命中 + 唐三藏 30 + 幸运/100×5.
  const carryHit =
    hit +
    (COMBO.includes(TANG_SAN_ZANG) ? TANG_SAN_ZANG_HIT : 0) +
    Math.trunc(lucky / 100) * 5;
  const hitRate = Math.max(0,Math.min(1,(100 + carryHit - enemy.dodge + 1) / 101));

  // 开战负面:猪八戒 +2 层流血 → 神通27 每层 +1%.
  const negative = COMBO.includes(ZHU_BA_JIE) ? LIU_XUE_STACKS : 0;

  // 各百分比乘区(Π(1+p/100)),与 yingling-output:1451-1479 同口径.
  // 孙悟空 3技能 +命中值%;神转职怒气倍率 -30%(skill76).
  const skillFactor = (1 - RAGE_SKILL_REDUCE / 100) * (1 + carryHit / 100);
  // 神通15 点满 = +命中值%(夹 int 上限).
  const shenTong15 = Math.min(carryHit,21_4748_3637);
  // 西行取经:max(0, 命中 - (敌闪避 - 猪八戒20)) × 1.0.
  const xiXing = Math.trunc(Math.max(0,carryHit - (enemy.dodge - ZHU_BA_JIE_DODGE_DOWN)) * XI_XING_RATE);
  const sources =
    (1 + shenTong15 / 100) *
    (1 + xiXing / 100) *
    (1 + SHEN_TONG_19_PCT / 100) *
    (1 + negative / 100);

  // 攻击桶:(100 + 面板攻击% + 武松20)/100;天覆阵最高攻 +等级%(战斗期,不在面板内).
  const atkFactor = (100 + atkPct + (COMBO.includes(WU_SONG) ? WU_SONG_ATK_PCT : 0)) / 100;
  const zhenFaFactor = panel.zhenFaID === 1 ? 1 + zhenFaLevel / 100 : 1;
  // 伤害加成桶:(100 + 面板伤害加成 + 武松35)/100.
  const damageAdditionFactor = (100 + dmgAdd + (COMBO.includes(WU_SONG) ? WU_SONG_DMG_ADD : 0)) / 100;
  // 后羿弓:孙悟空神命中100%,不触发 ×0.8.
  const bowFactor = 1;
  // 羁绊:本队无万人敌(type5)增伤乘区,bond=1.
  const bond = 1;

  // 总乘区(不含 K 与减伤),对齐 yingling-output:1526-1534.
  const total = atkFactor * skillFactor * bowFactor * bond * damageAdditionFactor * zhenFaFactor * sources;

  // K 用实际攻击(含攻击桶与天覆阵加成)与穿防后防御算(DESIGN.md: 不得写死).
  const atkForK = atkFlat * atkFactor * zhenFaFactor;
  const defAfterPen = Math.max(1,enemy.def - pen);
  const k = culDamagePercent(atkForK,defAfterPen);

  // 非暴击单点伤害 = 裸攻击 × total × K/100 × 减伤 × 图鉴增伤.
  const nonCrit =
    atkFlat * total * (k / 100) * ((100 - reduce) / 100) * (1 + tuJianDamagePct / 100);

  // 暴击率:(暴击 - 敌抗暴 + 1)/101 夹到 [0,1];暴伤倍率 = 面板暴伤/100(神谋鬼算未入队).
  const critRate = Math.max(0,Math.min(1,(critPanel - enemy.critResist + 1) / 101));
  const critMultiplier = critDamage / 100;
  const crit = nonCrit * critMultiplier;

  return {
    scene: SCENE_NAME[scene],layer,enemy,reduce,carryHit,hitRate,critRate,critMultiplier,
    atkForK,pen,k,total,nonCrit,crit,
    nonCritRange: [nonCrit * BATTERY_MIN,nonCrit * BATTERY_MAX],
    critRange:    [crit * BATTERY_MIN,crit * BATTERY_MAX]
  };
}

/**
 * 导入当前存档并打印指定场景/层数的伤害范围(游戏单位).
 * @param sceneText 目标:通天塔 / 试炼 / 终局(或 tower / trial / zhongju).
 * @param layerText 层数:20W / 1.5w / 100(终局可省略);终局可用「终局:5」指定挑战.
 */
export function verifyFinalDamage (sceneText: string,layerText?: string | number): DamageRange {
  let scenePart = sceneText.trim();
  let challenge = 5;
  const colon = scenePart.lastIndexOf(":");
  if (colon >= 0) {
    challenge = Number(scenePart.slice(colon + 1)) || 5;
    scenePart = scenePart.slice(0,colon);
  }
  const scene = resolveScene(scenePart);
  const layer = scene === "zhongju" ? 0 : parseLayerText(String(layerText ?? (scene === "trial" ? 100 : 10000)));
  const panel = loadMasterPanel();
  const args = parseArgs(process.argv.slice(2));
  const tuJianDamagePct = argNumber(args,"tujian") ?? 0;
  const zhenFa = currentZhenFa(panel);
  const report = damageRangeOf(scene,layer,panel,enemyOf(scene,layer,challenge),{
    zhenFaLevel: zhenFa.level,
    tuJianDamagePct
  });
  printDamageRange(report,zhenFa);
  return report;
}

/** 把一份 DamageRange 按游戏单位打印到控制台. */
export function printDamageRange (report: DamageRange,zhenFa: {id: number; level: number} = {id: 0,level: 0}): void {
  const {enemy} = report;
  const zhenFaNote = zhenFa.id === 1 ? `天覆阵 Lv.${String(zhenFa.level)}(最高攻+${String(zhenFa.level)}%攻击)` : `${String(zhenFa.id)} 号阵 Lv.${String(zhenFa.level)}(首击无攻击加成)`;
  console.log(`\n=== ${report.scene}${report.layer > 0 ? ` ${formatSuoXie(report.layer)} 层` : ""} 最终伤害验证(存档真实面板 · 孙悟空神·人皇印队)===`);
  console.log(`阵法:${zhenFaNote}  减伤:${String(report.reduce)}%  图鉴增伤参数:--tujian`);
  console.log(
    `敌人: HP=${formatSuoXie(enemy.hp)}  防御=${formatSuoXie(enemy.def)}  ` +
    `闪避=${formatSuoXie(enemy.dodge)}  抗暴=${formatSuoXie(enemy.critResist)}  减伤=${String(enemy.damageReduce)}%`
  );
  console.log(
    `面板: 实际攻击=${formatSuoXie(report.atkForK)}  穿透=${formatSuoXie(report.pen)}  ` +
    `命中链=${formatSuoXie(report.carryHit)}  命中率=${(report.hitRate * 100).toFixed(2)}%  ` +
    `暴击率=${(report.critRate * 100).toFixed(2)}%  暴伤倍率=${report.critMultiplier.toFixed(2)}  K=${String(report.k)}`
  );
  console.log(`非暴击: ${formatSuoXie(report.nonCritRange[0])} ~ ${formatSuoXie(report.nonCritRange[1])}  (期望 ${formatSuoXie(report.nonCrit)})`);
  console.log(`暴击后: ${formatSuoXie(report.critRange[0])} ~ ${formatSuoXie(report.critRange[1])}  (期望 ${formatSuoXie(report.crit)})`);
}

// 命令行入口:供 `pnpm verify 通天塔 20W` 调用;作为模块 import 时不执行.
if (process.argv[1] === import.meta.filename) {
  const positionals = process.argv.slice(2).filter(item => !item.startsWith("--"));
  const target = positionals[0] ?? "通天塔";
  const layer = positionals[1];
  verifyFinalDamage(target,layer);
}
