/**
 * verify-damage.ts — 验证「存档真实面板 + 孙悟空神·人皇印队」对指定场景/层数的最终伤害.
 *
 * 用途:导入当前存档,输入目标场景与层数(如 `pnpm verify 通天塔 20W`),打印该层敌人受到的
 * 伤害范围(源码 Damage_Recorder.cs:80-81 的 Random.Range(0.95f,1.05f)),按游戏单位
 * formatSuoXie(ToolClass.TranslateNumsToSuoXie)输出,并打印暴击率与暴击后的浮动范围,
 * 便于与游戏里实际打出的数字核对.
 *
 * 口径(用户确认:复刻游戏实际伤害):
 * - 面板:输出位「孙悟空」英灵在战斗中的真实面板.源码 BattleData_Manager.cs:76-84 +
 *   BattleData_Recorder.cs:23-34:英灵最终面板 = 英灵自身 + 主角继承:
 *     非百分比属性(攻/防/血/穿透/速度)=(英灵Base+主角Base)×(100+英灵Pct+主角Pct)/100;
 *     百分比属性(命中/暴击/暴伤/伤害加成/幸运等)=英灵Base+主角Base(直接相加).
 *   此前用主角面板会得出暴击率 0%,与游戏不符,已按此源码公式修正.
 * - 输出位:孙悟空神转职 + 人皇印(首击全体);阵容固定 孙悟空/武松/唐三藏/猪八戒/沙僧(西行取经 Lv.3).
 * - 乘区:严格复刻 yingling-output.ts:1354-1534 outputMultiplier 与 1598-1620 evalVariant 的
 *   分桶结构(攻击桶/技能倍率/武器/羁绊/伤害加成桶/神通与负面乘区),只是面板数据源换成存档.
 * - 范围:非暴击 ×0.95~1.05,暴击 = 非暴击 × 暴伤倍率 后再 ×0.95~1.05.
 * - 阵法:读存档 CurZhenFa.天覆阵(1)=最高攻 +等级% 攻击进攻击桶;
 *   鸟翔阵(8)=无攻击加成,但按源码 Entry_ZhenFa_8.cs:30-41 把 min(我方Speed.TrueBase−敌速,2147483646)
 *   加进百分比乘区(速度差增伤,这是垓级伤害的大头).
 * - 减伤:通天塔按 yingling-output 场景口径为 0;试炼/终局按敌人 damageReduce 封顶 80.
 * - 图鉴增伤(研究54,通天塔):源码 Character_Enemy.cs:125-131 = GetTuJian(PresetID).Level×研究54等级,
 *   进百分比乘区.通天塔 map5:小怪 PresetID13/精英14/首领15(MapRecorder.GetEnemtID + config/maps.json).
 *   一层有 5 只怪,品级由 MapRecorder.GetEnemyCount() 按 层数%5 决定,所以同一层有 3 种不同伤害;
 *   脚本按品级逐行打印,不再用「首领属性 + 精英图鉴」混算.--preset=15/14/13 只看单只,--tujian=N 覆盖.
 * - 威慑(Entry_ZhenShe.cs:18-22):通天塔敌人 Enemy_Skill_13/14 命中后给目标挂 1/2 层,每层 -3% 封顶 -66%;
 *   首击(我方速度更快、先手)时为 0 层,--weishe=N 可看带 N 层的伤害.
 * - 武松攻击桶 +20% 只在武松有神转职技能 Skill_1011 时才有;存档里武松是基础转职(Skills=[16,17,18]),
 *   该项为 0.
 *
 * 所有乘区来自反编译源码,不写死结果;只读存档,不写游戏目录.
 */
import {argNumber,formatSuoXie,loadSave,parseArgs,resolveSaveDir} from "./readSave.ts";
import type {BattleDataRecorder,SaveBundle} from "./readSave.ts";
import {towerEnemy,trialEnemy,ZHONG_JU} from "./enemy-stats.ts";
import type {EnemyStats} from "./enemy-stats.ts";
import {culDamagePercent} from "./game-formulas.ts";
import {loadConfig} from "./tools.ts";

// 与 enemy-stats.ts 一致的场景别名.
const SCENE_ALIAS = new Map<string,"tower" | "trial" | "zhongju">([
  ["tower","tower"],["trial","trial"],["zhongju","zhongju"],
  ["终","zhongju"],["终局","zhongju"],["试","trial"],["试炼","trial"],
  ["通","tower"],["通天","tower"],["通天塔","tower"]
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
// 阵法:1=天覆阵(最高攻 +等级% 攻击),8=鸟翔阵(无攻击加成,速度差进伤害加成桶).
// data.ts:617/618 + Entry_ZhenFa_8.cs:30-41:伤害加成 += min(我方速度−敌速, 21_4748_3646).
const ZHENFA_TIANFU = 1;
const ZHENFA_NIAOXIANG = 8;
const NIAOXIANG_PANEL_SPEED = 15;   // 鸟翔阵面板速度固定 +15
const NIAOXIANG_DAMAGE_CAP = 21_4748_3646;

// 输出位在战斗中的最终面板(已按源码叠加英灵自身+主角继承).
// 非百分比属性(攻/穿透)保留 base 与 pct 分桶,供攻击桶/K 复刻;
// 百分比属性(命中/暴击/暴伤/伤害加成/幸运)为已叠加的最终值.
export interface CarryPanel {
  atkFlat:   number;
  atkPct:    number;
  pen:       number;
  hit:       number;
  crit:      number;
  critDamage:number;
  dmgAdd:    number;
  lucky:     number;
  speed:     number;  // 非百分比属性,已叠加英灵+主角,供鸟翔速度差增伤
}

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
  tuJianDamagePct:number;   // 图鉴增伤%(研究54,仅通天塔).
  weiShePct:      number;   // 威慑减伤%(每层 -3%,封顶 -66%).
  markPct:        number;   // 孙悟空3技能 Mark 增伤%(每层 +10%).
  wuSongAtkPct:   number;   // 武松神转职攻击桶 +20%(基础转职为 0).
  zhenFaNote:     string;   // 阵法说明(天覆/鸟翔).
  speedDiff:      number;   // 鸟翔阵速度差增伤%;非鸟翔为 0.
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

// BattleData_Recorder.GetFinal(BattleData_Recorder.cs:23-34):英灵自身+主角继承叠加.
// 百分比属性(percent=1):Base英灵+Base主角;其余:(Base英灵+Base主角)×(100+Pct英灵+Pct主角)/100.
function mergedFinal (
  prop: number,
  percentProps: Set<number>,
  yingLing: readonly BattleDataRecorder[],
  master: readonly BattleDataRecorder[]
): {base: number; pct: number; value: number} {
  const recOf = (list: readonly BattleDataRecorder[]): BattleDataRecorder | undefined =>
    list.find(item => item.PropertyTypeEnum === prop);
  const yr = recOf(yingLing);
  const mr = recOf(master);
  const yBase = yr ? Math.round(yr.Base_Value) : 0;
  const mBase = mr ? Math.round(mr.Base_Value) : 0;
  const yPct = yr?.PercentAddition ?? 0;
  const mPct = mr?.PercentAddition ?? 0;
  const base = yBase + mBase;
  const pct = yPct + mPct;
  const value = percentProps.has(prop) ? Math.max(0,base) : Math.round(base * (100 + pct) / 100);
  return {base,pct,value};
}

// 读存档,按源码叠加出孙悟空(英灵索引26,Master_ID=1)的战斗面板.
export function loadCarryPanel (save: SaveBundle,carryIndex = WU_KONG): CarryPanel {
  const settings = loadConfig<{percent: number; type: number}[]>("property");
  const percentProps = new Set(settings.filter(item => item.percent === 1).map(item => item.type));
  const master = save.cha.BattleData_Manager?.battleData_Recorders_List ?? [];
  const carry = save.yingLings.find(item => item.YingLing_Index === carryIndex && item.Master_ID === 1);
  const yingLing = carry?.BattleData_Manager?.battleData_Recorders_List ?? [];
  const atk = mergedFinal(0,percentProps,yingLing,master);
  return {
    atkFlat:    atk.base,
    atkPct:     atk.pct,
    pen:        mergedFinal(15,percentProps,yingLing,master).value,
    hit:        mergedFinal(4,percentProps,yingLing,master).value,
    crit:       mergedFinal(6,percentProps,yingLing,master).value,
    critDamage: mergedFinal(8,percentProps,yingLing,master).value,
    dmgAdd:     mergedFinal(13,percentProps,yingLing,master).value,
    lucky:      mergedFinal(17,percentProps,yingLing,master).value,
    speed:      mergedFinal(3,percentProps,yingLing,master).value
  };
}

// 当前佩戴阵法等级:天覆阵(1)才给最高攻 +等级% 攻击;其余阵法首击无攻击加成.
function currentZhenFa (save: SaveBundle): {id: number; level: number} {
  const id = save.cha.CurZhenFa ?? 0;
  const record = (save.cha.zhenFaRecorders ?? []).find(item => item.ZhenFaID === id);
  return {id,level: record?.Level ?? 0};
}

// 图鉴增伤%(仅通天塔):源码 Character_Enemy.cs:125-131 = GetTuJian(PresetID).Level × 研究54等级.
// 通天塔在 map5:小怪 PresetID=13 / 精英=14 / 首领=15(MapRecorder.GetEnemtID + config/maps.json).
// 默认首领(idx15);--preset=N 指定图鉴 idx;--tujian=N 直接指定增伤%.
function autoTuJianDamagePct (presetIdx = 14,saveArg?: SaveBundle): {pct: number; level: number; research: number; idx: number} {
  const save = saveArg ?? loadSave(resolveSaveDir(parseArgs(process.argv.slice(2))));
  const records = save.cha.tuJianData_RecordsList ?? [];
  const level = records.find(item => item.EnemyIndex === presetIdx)?.Level
    ?? records.reduce((max,item) => Math.max(max,item.Level),0);
  const keJi = (save.cha as unknown as {keJi_Recorders?: {KeJi_ID: number; KeJi_Level: number}[]}).keJi_Recorders ?? [];
  const research = keJi.find(item => item.KeJi_ID === 54)?.KeJi_Level ?? 0;
  return {pct: level * research,level,research,idx: presetIdx};
}

// 武松攻击桶 +20% 只在武松拿到神转职技能(Skill_1011)时存在;基础/魔转职都没有该入口,
// 参考存档 YingLing_Data.Save 的 Skills 字段(武松 CurZhiYe=0 时为 [16,17,18]).
function wuSongAtkPctOf (save: SaveBundle): number {
  const wuSong = save.yingLings.find(item => item.YingLing_Index === WU_SONG);
  const skills = (wuSong as unknown as {Skills?: number[]} | undefined)?.Skills ?? [];
  return skills.includes(1011) ? WU_SONG_ATK_PCT : 0;
}

// 通天塔一层 5 只怪,品质由 MapRecorder.GetEnemyCount() 按 层数%5 决定:
// 0 → [小怪,小怪,精英,精英,首领]、1 → 全小怪、2 → 4小怪+1精英、3 → 3小怪+2精英、4 → 2小怪+3精英.
const TOWER_QUALITY: Record<number, readonly number[]> = {
  0: [1,1,2,3,2],1: [1,1,1,1,1],2: [1,1,1,2,1],3: [1,1,2,2,1],4: [1,1,2,2,2]
};
const QUALITY_NAME: Record<number, string> = {1: "小怪",2: "精英",3: "首领"};
const QUALITY_PRESET: Record<number, number> = {1: 13,2: 14,3: 15};


/**
 * 核心:按存档真实面板 + 孙悟空神·人皇印队乘区,计算对某敌人的一次伤害及各档范围.
 * 除读面板外无副作用,可被其他模块直接 import;打印交给 printDamageRange.
 * @param scene 场景.
 * @param layer 层数(终局用 challenge 定位,不参与敌人属性).
 * @param panel 输出位战斗面板(loadCarryPanel 的结果,已按源码叠加英灵+主角).
 * @param enemy 敌人属性.
 * @param opts 阵法等级与图鉴增伤%(研究54,仅通天塔;默认 0).
 * @returns DamageRange.
 */
export function damageRangeOf (
  scene: "tower" | "trial" | "zhongju",
  layer: number,
  panel: CarryPanel,
  enemy: EnemyStats,
  opts: {zhenFaLevel?: number; zhenFaID?: number; tuJianDamagePct?: number; weiShe?: number; wuSongAtkPct?: number; mark?: number} = {}
): DamageRange {
  const reduce = scene === "tower" ? 0 : Math.min(enemy.damageReduce,80);
  const tuJianDamagePct = opts.tuJianDamagePct ?? 0;
  const zhenFaLevel = opts.zhenFaLevel ?? 0;
  const zhenFaID = opts.zhenFaID ?? 0;
  // 威慑(Entry_ZhenShe.cs:18-22):每层 -3%,封顶 -66%;由通天塔敌人 Enemy_Skill_13/14 命中后挂到被攻击者身上.
  const weiShePct = Math.min(3 * (opts.weiShe ?? 0),66);
  // 武松攻击桶 +20% 只在他有神转职(Skill_1011)时存在,基础转职没有该入口.
  const wuSongAtkPct = opts.wuSongAtkPct ?? 0;
  // Mark 层数:孙悟空3技能每命中一个目标 +1 层(Entry_Skill_76.AfterAttakEnemy),
  // 下一目标 WhenAttack_Cul_1 读 GetMarkCount(Skill_76) → PercentAddition += mark×10.
  const markPct = 10 * (opts.mark ?? 0);

  const {atkFlat,atkPct,pen,hit,critPanel,critDamage,dmgAdd,lucky,speed} = {
    atkFlat: panel.atkFlat,atkPct: panel.atkPct,pen: panel.pen,hit: panel.hit,
    critPanel: panel.crit,critDamage: panel.critDamage,dmgAdd: panel.dmgAdd,lucky: panel.lucky,
    speed: panel.speed
  };

  // 鸟翔阵(8)速度差增伤:源码 Entry_ZhenFa_8.cs:30-41 = min(我方Speed.TrueBase−敌Speed.TrueBase, 21_4748_3646),
  // 加进 PercentAddition(乘区 num),即 ×(100+速度差)/100.天覆阵无此项.
  // 注意:敌速用 GetData(Speed).True_Base_Value(enemy.speed);我方用战斗面板 speed(InitailForBattle 后=英灵GetFinal含主角).
  const speedDiff =
    zhenFaID === ZHENFA_NIAOXIANG
      ? Math.max(0,Math.min(Math.round(speed) - Math.round(enemy.speed),NIAOXIANG_DAMAGE_CAP))
      : 0;
  const speedDiffFactor = 1 + speedDiff / 100;

  // 孙悟空神转职命中 = 面板命中 + 唐三藏 30 + 幸运/100×5.
  const carryHit =
    hit +
    (COMBO.includes(TANG_SAN_ZANG) ? TANG_SAN_ZANG_HIT : 0) +
    Math.trunc(lucky / 100) * 5;
  // 命中率:源码 MingZhong_Recorder.cs:19-21,Final_MZ = 100 + 命中TrueBase − 闪避TrueBase + 加成,
  // Random.Range(0,101) <= Final_MZ;夹到 [0,1].命中值远大于闪避时为 100%.
  const finalMZ = 100 + carryHit - Math.round(enemy.dodge);
  const hitRate = Math.max(0,Math.min(1,(finalMZ + 1) / 101));

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
    (1 + negative / 100) *
    (1 + markPct / 100) *
    (1 - weiShePct / 100);

  // 攻击桶:(100 + 面板攻击% + 武松20)/100;天覆阵最高攻 +等级%(战斗期,不在面板内).
  const atkFactor = (100 + atkPct + wuSongAtkPct) / 100;
  const zhenFaFactor = zhenFaID === 1 ? 1 + zhenFaLevel / 100 : 1;
  // 伤害加成桶:(100 + 面板伤害加成 + 武松35)/100.
  const damageAdditionFactor = (100 + dmgAdd + (COMBO.includes(WU_SONG) ? WU_SONG_DMG_ADD : 0)) / 100;
  // 后羿弓:孙悟空神命中100%,不触发 ×0.8.
  const bowFactor = 1;
  // 羁绊:本队无万人敌(type5)增伤乘区,bond=1.
  const bond = 1;

  // 总乘区(不含 K 与减伤),对齐 yingling-output:1526-1534.
  const total = atkFactor * skillFactor * bowFactor * bond * damageAdditionFactor * zhenFaFactor * sources * speedDiffFactor;

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

  const zhenFaNote = zhenFaID === ZHENFA_NIAOXIANG
    ? `鸟翔阵(速度 ${formatSuoXie(speed)} − 敌速 ${formatSuoXie(enemy.speed)} → +${formatSuoXie(speedDiff)}% 增伤)`
    : zhenFaID === ZHENFA_TIANFU
      ? `天覆阵 Lv.${String(zhenFaLevel)}(最高攻 +${String(zhenFaLevel)}% 攻击)`
      : `${String(zhenFaID)} 号阵(首击无阵法加成)`;
  return {
    scene: SCENE_NAME[scene],layer,enemy,reduce,carryHit,hitRate,critRate,critMultiplier,
    atkForK,pen,k,total,tuJianDamagePct,weiShePct,markPct,wuSongAtkPct,zhenFaNote,speedDiff,nonCrit,crit,
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
  const args = parseArgs(process.argv.slice(2));
  const save = loadSave(resolveSaveDir(args));
  const panel = loadCarryPanel(save);
  const presetIdx = argNumber(args,"preset") ?? 14; // 默认精英(idx14);首领15/小怪13
  const tuJianArg = argNumber(args,"tujian");
  const weiShe = argNumber(args,"weishe") ?? 0;
  const wuSongAtkPct = wuSongAtkPctOf(save);
  const zhenFa = currentZhenFa(save);
  const baseTuJian = scene === "tower" ? autoTuJianDamagePct(presetIdx,save) : {pct: 0,level: 0,research: 0,idx: 0};
  const tuJianDamagePct = tuJianArg ?? baseTuJian.pct;
  const report = damageRangeOf(scene,layer,panel,enemyOf(scene,layer,challenge),{
    zhenFaLevel: zhenFa.level,
    zhenFaID: zhenFa.id,
    tuJianDamagePct,
    weiShe,
    wuSongAtkPct,
    mark: argNumber(args,"mark") ?? 0
  });
  const presetName = presetIdx === 15 ? "首领" : presetIdx === 14 ? "精英" : presetIdx === 13 ? "小怪" : `idx${String(presetIdx)}`;
  printDamageRange(report,zhenFa,{
    pct: tuJianDamagePct,
    source: tuJianArg !== undefined
      ? "手动 --tujian"
      : `${presetName}(idx${String(baseTuJian.idx)}) 图鉴Lv.${String(baseTuJian.level)}×研究54 Lv.${String(baseTuJian.research)}`
  });
  if (scene === "tower") {printTowerLayerTable(save,layer,panel,zhenFa,wuSongAtkPct,tuJianArg);}
  return report;
}

/**
 * 通天塔同一层 5 只怪的完整伤害表 + 威慑层数表.
 * 源码依据:MapRecorder.GetEnemyCount()(品质分布)、MapRecorder.GetEnemtID(map5 = 小怪13/精英14/首领15)、
 * Character_Enemy.cs:125-131(图鉴增伤 = 图鉴等级×研究54)、Entry_ZhenShe.cs:18-22(威慑每层 -3%,封顶 -66%).
 */
function printTowerLayerTable (
  save: SaveBundle,
  layer: number,
  panel: CarryPanel,
  zhenFa: {id: number; level: number},
  wuSongAtkPct: number,
  tuJianArg: number | undefined
): void {
  const qualities = TOWER_QUALITY[layer % 5] ?? TOWER_QUALITY[1] ?? [1,1,1,1,1];

  console.log("\n--- 本层敌人顺序(MapRecorder.GetEnemyCount,层数%5=" + String(layer % 5) + ")---");
  console.log("  " + qualities.map((item,index) => `${String(index + 1)}.${QUALITY_NAME[item] ?? String(item)}`).join("  "));

  // 同一次怒气技能内 Mark 逐目标递增:Entry_Skill_76.AfterAttakEnemy 每命中一个目标 +1 层,
  // 下一个目标 WhenAttack_Cul_1 读 mark → PercentAddition += mark×10,所以第 n 个目标带 n-1 层.
  console.log("\n--- 同一次怒气技能内(0 层威慑)按出手顺序 ---");
  console.log("  位置  品级   图鉴增伤%  Mark层数  该目标暴击伤害(期望)   浮动范围");
  for (let index = 0; index < qualities.length; index++) {
    const quality = qualities[index] ?? 1;
    const preset = QUALITY_PRESET[quality] ?? 14;
    const tuJian = tuJianArg ?? autoTuJianDamagePct(preset,save).pct;
    const range = damageRangeOf("tower",layer,panel,towerEnemy(layer,quality),{
      zhenFaLevel: zhenFa.level,zhenFaID: zhenFa.id,tuJianDamagePct: tuJian,wuSongAtkPct,mark: index
    });
    console.log(
      `  ${String(index + 1).padStart(3)}   ${(QUALITY_NAME[quality] ?? "?").padEnd(4)}  ` +
      `${String(tuJian).padStart(6)}%    ${String(index).padStart(6)}层   ` +
      `${formatSuoXie(range.crit).padEnd(20)}  ${formatSuoXie(range.critRange[0])} ~ ${formatSuoXie(range.critRange[1])}`
    );
  }

  // 首领在不同 Mark 层数下的伤害(第一段之后 Mark 会继续累加,第二段起首领的层数更高).
  const bossPreset = QUALITY_PRESET[3] ?? 15;
  const bossTuJian = tuJianArg ?? autoTuJianDamagePct(bossPreset,save).pct;
  const boss = damageRangeOf("tower",layer,panel,towerEnemy(layer,3),{
    zhenFaLevel: zhenFa.level,zhenFaID: zhenFa.id,tuJianDamagePct: bossTuJian,wuSongAtkPct
  });
  console.log(`\n--- 首领(idx${String(bossPreset)} 图鉴 ${String(bossTuJian)}%,HP ${formatSuoXie(boss.enemy.hp)})不同 Mark 层数 ---`);
  const rows: string[] = [];
  for (let stack = 0; stack <= 15; stack++) {
    const damage = boss.crit * (1 + 10 * stack / 100);
    rows.push(`${String(stack).padStart(2)}层 ${formatSuoXie(damage)}`);
  }
  for (let index = 0; index < rows.length; index += 4) {
    console.log("  " + rows.slice(index,index + 4).join("   "));
  }
}

/** 把一份 DamageRange 按游戏单位打印到控制台. */
export function printDamageRange (
  report: DamageRange,
  zhenFa: {id: number; level: number} = {id: 0,level: 0},
  tuJian: {pct: number; source: string} = {pct: 0,source: "0"}
): void {
  const {enemy} = report;
  console.log(`\n=== ${report.scene}${report.layer > 0 ? ` ${formatSuoXie(report.layer)} 层` : ""} 最终伤害验证(存档真实面板 · 孙悟空神·人皇印队)===`);
  console.log(
    `阵法:${report.zhenFaNote}  减伤:${String(report.reduce)}%  图鉴增伤:${String(tuJian.pct)}%（${tuJian.source}）` +
    `  威慑:${String(report.weiShePct)}%  Mark:${String(report.markPct)}%  武松攻击桶:+${String(report.wuSongAtkPct)}%`
  );
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
