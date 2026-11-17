import {argNumber,culPercentToInt,formatNumber,formatScore,getMarkCount,getPropNums,isArgOn,loadSave,parseArgs,resolveSaveDir} from "./readSave.ts";
import {loadConfig,runMain} from "./tools.ts";
import type {BattleDataRecorder} from "./readSave.ts";
import {clamp01,culDamagePercent,pinZhiDistribution} from "./game-formulas.ts";
import type {EquipPercentEntry} from "./game-formulas.ts";

/**
 * 物资性价比:卖冥商换元宝买属性药 VS 直接用来强化 统一口径是「期望伤害变化率」,公式来自反编译代码:
 * - 伤害:YingLing.BattleSystem/Damage_Recorder.cs 第 55-110 行 CulFinalDamage()
 * 伤害 = ATK × 攻防系数 / 100 × 命中率 × (1 + 暴击率 × (暴伤/100 - 1))
 * × (1 + 伤害加成/100) × (1 - min(目标减伤,80)/100)
 * - 攻防系数:同文件第 138-161 行 CulDamagePercent()
 * - 命中/暴击:MingZhong_Recorder.cs / BaoJiRecorder.cs
 * - 属性聚合:BattleData_Recorder.GetFinal() + BattleData_Manager.GetFinalValue()
 * - 主角属性会继承给英灵:BattleData_Manager.InitailForBattle()
 * - 强化公式:ZhuanZhiManager / Equip_Using / ZhenFaRecorder / ShengShou_Record / PropHelper.GenerateEquip / TuJianData_Record
 * - 阵法:Entry_ZhenFa_1 / 6 / 8
 */
// PropertyTypeEnum
const P = {
  ATK:            0,
  BaoJi:          6,
  BaoJiDamage:    8,
  BaoJiResist:    7,
  DamageAddition: 13,
  DamageReduce:   14,
  DEF:            1,
  FanJi:          10,
  HP:             2,
  IgonoreDEF:     15,
  LianJi:         9,
  Lucky:          17,
  MingZhong:      4,
  Recovery:       11,
  RetrunDamage:   16,
  ShanBi:         5,
  Speed:          3,
  XiXie:          12
} as const;
const PROP_COUNT = 18;

// EffectNameEnum
const EFFECT_ADD_YULINGSHI_PROPERTY = 15;
const EFFECT_ADD_TUJIAN_EXP = 10;

// Mark_Enum
const MARK_REDUCE_HANTIE = 0;
const MARK_ADD_EQUIP_PROPERTY = 3;
const MARK_ADD_EQUIP_QI_DING = 7;
const MARK_ADD_EQUIP_LIAN_QI = 8;
const MARK_REDUCE_QIANGHUA = 10;
const MARK_REDUCE_ZHENWEN = 11;
const PROP_NAMES: Record<number,string> = {
  [P.ATK]:            "攻击",
  [P.BaoJi]:          "暴击",
  [P.BaoJiDamage]:    "暴击伤害",
  [P.BaoJiResist]:    "抗暴",
  [P.DamageAddition]: "伤害加成",
  [P.DamageReduce]:   "伤害减免",
  [P.DEF]:            "防御",
  [P.FanJi]:          "反击",
  [P.HP]:             "生命",
  [P.IgonoreDEF]:     "穿透",
  [P.LianJi]:         "连击",
  [P.Lucky]:          "幸运",
  [P.MingZhong]:      "命中",
  [P.Recovery]:       "恢复",
  [P.RetrunDamage]:   "反弹伤害",
  [P.ShanBi]:         "闪避",
  [P.Speed]:          "速度",
  [P.XiXie]:          "吸血"
};

// 参与输出比较的属性(连击/反击按"秒怪"口径不计入)
const OUTPUT_PROPS = new Set<number>([
  P.ATK,
  P.BaoJi,
  P.BaoJiDamage,
  P.DamageAddition,
  P.IgonoreDEF,
  P.MingZhong,
  P.Speed
]);

// 装备类型候选词条(PropHelper.GenerateEquipMayProperty)
const EQUIP_PROPERTIES: readonly (readonly number[])[] = [
  [P.ATK,P.BaoJi,P.BaoJiDamage,P.DamageAddition,P.IgonoreDEF],
  [P.DEF,P.HP,P.ShanBi,P.BaoJiResist,P.RetrunDamage],
  [P.DEF,P.HP,P.ShanBi,P.DamageReduce,P.Lucky],
  [P.DEF,P.HP,P.MingZhong,P.BaoJiResist,P.Recovery],
  [P.ATK,P.DEF,P.BaoJiDamage,P.LianJi,P.DamageAddition],
  [P.ATK,P.DEF,P.HP,P.MingZhong,P.FanJi],
  [P.ATK,P.DEF,P.HP,P.MingZhong,P.Lucky],
  [P.ATK,P.HP,P.XiXie,P.IgonoreDEF,P.Lucky],
  [P.ATK,P.DEF,P.HP,P.Speed,P.IgonoreDEF],
  [P.ATK,P.DEF,P.HP,P.BaoJi,P.DamageReduce]
];

// 没有直接输出,但有确定用途的道具(只写已经核对过的)
const INDIRECT_NOTES = new Map<number,string>([
  [10,"抽奖卷：抽奖消耗，产出随机"],
  [2,"五彩神石：器鼎升级只提高新造装备的品质概率，不直接加属性"],
  [3,"破境石：每次让英灵等级上限 +500，消耗 Max_Level/10 个"],
  [8,"灵晶：100 个解锁一个阵法；阵法的灵纹升级见上"],
  [81,"忘情水：突破自动升级时消耗，每次 500 个"],
  [93,"升仙令：转职消耗 1 个，解锁职业技能"]
]);

// 当前生效的伤害类羁绊等级(0 = 未激活)
interface BondContext {
  sanGuo:  number;
  shenGui: number;
  shenMou: number;
  wanRen:  number;
  xiXing:  number;
}

// 一次属性改动,percent 对应 ChangeProprtyValue 的 percent 参数
interface Gain {
  percent: boolean;
  prop:    number;
  value:   number;
}

interface MapSetting {
  mapID:     number;
  shengShou: {
    index:      number;
    property1:  number;
    property2:  number;
    property3:  number;
    remandProp: number;
  };
}

interface MingShangConfig {
  buy:  MingShangEntry[];
  sell: MingShangEntry[];
}

interface MingShangEntry {
  index: number;
  nums:  number;
  price: number;
  prop:  number;
}

interface NamesConfig {
  maps:      Record<string,string>;
  props:     Record<string,string>;
  shengShou: Record<string,string>;
}

interface PropertySetting {
  percent: number;
  type:    number;
}

// 一组属性:Base_Value 与 PercentAddition,下标是 PropertyTypeEnum
interface RawStats {
  base: number[];
  pct:  number[];
}

// 一条"用材料换输出"的途径
interface Route {
  cost:   number;
  detail: string;
  gains:  Gain[];
  note?:  string;
  propID: number;
  target: "master" | "unit";
  use:    string;
}

// 敌方参数
interface TargetParams {
  baoJiResist:  number;
  count:        number;
  damageReduce: number;
  def:          number;
  hpPercent:    number;
  mingZhong:    number;
  shanBi:       number;
  speed:        number;
}

// 当前佩戴阵法(只用于伤害计算里的战斗期 Entry 效果)
interface ZhenFaContext {
  id:    number;
  level: number;
}

// 按 BattleData_Recorder.ChangeValue 的规则应用一次属性改动
function applyGain (raw: RawStats,gain: Gain,percentProps: Set<number>): void {
  const {percent,prop,value} = gain;
  if (prop < 0 || prop >= PROP_COUNT) {
    return;
  }
  if (percentProps.has(prop)) {
    raw.base[prop] = (raw.base[prop] ?? 0) + value;
    return;
  }
  if (percent) {
    raw.pct[prop] = (raw.pct[prop] ?? 0) + value;
  } else {
    raw.base[prop] = (raw.base[prop] ?? 0) + value;
  }
}

// 词条数量(PropHelper.GetCiTiaoCount)
function ciTiaoCount (pinZhi: number): number {
  let count = 0;
  if (pinZhi > 1) {count += 1;}
  if (pinZhi > 3) {count += 1;}
  if (pinZhi > 6) {count += 1;}
  if (pinZhi > 9) {count += 1;}
  return count;
}

// 复制一份 RawStats
function cloneRaw (raw: RawStats): RawStats {
  return {base: [...raw.base],pct: [...raw.pct]};
}
function emptyRaw (): RawStats {
  return {base: Array.from({length: PROP_COUNT},() => 0),pct: Array.from({length: PROP_COUNT},() => 0)};
}

/**
 * 期望伤害(不含随机浮动 0.95~1.05,固定倍率对比较没有影响)
 * 阵法只实现 1/6/8 三个对输出有直接影响的 Entry
 * @param own 自身属性.
 * @param master 主角属性.
 * @param target 目标参数.
 * @param zhenFa 阵法上下文.
 * @param bond 羁绊上下文.
 * @param percentProps 百分比属性集合.
 * @returns number.
 */
function expectedDamage (
  own: RawStats,
  master: null | RawStats,
  target: TargetParams,
  zhenFa: ZhenFaContext,
  bond: BondContext,
  percentProps: Set<number>
): number {
  const final = (prop: number): number => finalValue(prop,own,master,percentProps);
  let atk = final(P.ATK);

  // 阵法 1:全场最高攻单位额外 + 阵法等级% 攻击(这里把参照单位视为最高攻单位)
  if (zhenFa.id === 1 && zhenFa.level > 0) {
    atk += Math.trunc(atk * zhenFa.level / 100);
  }
  const defEff = Math.max(1,target.def - final(P.IgonoreDEF));
  const k = culDamagePercent(atk,defEff);
  const baseDamage = Math.max(1,atk * k / 100);
  const hitValue = 100 + final(P.MingZhong) - target.shanBi;
  const hitRate = clamp01((hitValue + 1) / 101);
  let critAdd = 0;
  if (zhenFa.id === 6) {
    critAdd += 30;
  }
  const critRate = clamp01((final(P.BaoJi) - target.baoJiResist + critAdd + 1) / 101);
  let critMultiplier = final(P.BaoJiDamage) / 100;
  if (zhenFa.id === 6) {
    critMultiplier *= (100 + final(P.BaoJi) * 10) / 100;
  }

  // 神谋鬼算:暴击伤害 +20×等级
  if (bond.shenMou > 0) {
    critMultiplier += 20 * bond.shenMou / 100;
  }
  let damagePercent = final(P.DamageAddition) / 100;
  if (zhenFa.id === 8) {
    const diff = final(P.Speed) - target.speed;
    if (diff > 0) {
      damagePercent += Math.min(diff,21_4748_3646) / 100;
    }
  }

  // 西行取经:伤害% += (命中 - 敌闪避) × (0.25 + 0.25×等级)
  if (bond.xiXing > 0) {
    damagePercent +=
      Math.max(0,final(P.MingZhong) - target.shanBi) * (0.25 + 0.25 * bond.xiXing) / 100;
  }

  // 神鬼志异:伤害% += (闪避 - 敌命中) × (0.2 + 0.2×等级)
  if (bond.shenGui > 0) {
    damagePercent +=
      Math.max(0,final(P.ShanBi) - target.mingZhong) * (0.2 + 0.2 * bond.shenGui) / 100;
  }

  // 万人敌:伤害% += 等级 × 敌方存活人数
  if (bond.wanRen > 0) {
    damagePercent += bond.wanRen * target.count / 100;
  }

  // 三国群英:伤害% += (100 - 目标血量%) / (4 - 0.5×等级)
  if (bond.sanGuo > 0) {
    damagePercent += Math.trunc((100 - target.hpPercent) / (4 - 0.5 * bond.sanGuo)) / 100;
  }
  const reduce = Math.min(target.damageReduce,80) / 100;
  return (
    baseDamage *
    hitRate *
    (1 + critRate * (critMultiplier - 1)) *
    (1 + damagePercent) *
    (1 - reduce)
  );
}

// BattleData_Recorder.GetFinal + 主角继承
function finalValue (prop: number,own: RawStats,master: null | RawStats,percentProps: Set<number>): number {
  const ownBase = own.base[prop] ?? 0;
  const ownPct = own.pct[prop] ?? 0;
  const masterBase = master?.base[prop] ?? 0;
  const masterPct = master?.pct[prop] ?? 0;
  if (percentProps.has(prop)) {
    return Math.max(0,ownBase + masterBase);
  }
  return Math.round((ownBase + masterBase) * (100 + ownPct + masterPct) / 100);
}

// 百分比格式化:太小的用科学计数法,避免显示成 0.0000
function formatPercent (value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  if (value === 0) {
    return "0";
  }
  if (Math.abs(value) < 0.0001) {
    return value.toExponential(2);
  }
  if (Math.abs(value) >= 1000) {
    return formatNumber(value);
  }
  return value.toFixed(4);
}
function formatRatio (ratio: number): string {
  if (!Number.isFinite(ratio)) {
    return "∞ 倍";
  }
  if (ratio >= 1e6) {
    return `10^${String(Math.round(Math.log10(ratio)))} 倍`;
  }
  if (ratio >= 100) {
    return `${formatNumber(ratio)} 倍`;
  }
  return `${ratio.toFixed(2)} 倍`;
}
function gainText (gains: Gain[],percentProps: Set<number>): string {
  const parts: string[] = [];
  for (const gain of gains) {
    if (gain.value === 0) {
      continue;
    }
    const name = PROP_NAMES[gain.prop] ?? `属性${String(gain.prop)}`;
    const isPercent = gain.percent && !percentProps.has(gain.prop);
    parts.push(`${name}+${formatScore(gain.value)}${isPercent ? "%" : ""}`);
  }
  return parts.length === 0 ? "无输出属性" : parts.join(" ");
}
function main (): void {
  const args = parseArgs(process.argv.slice(2));
  if (isArgOn(args,"help")) {
    console.log(
      [
        "用法：pnpm exec tsx src/scripts/power-value.ts [参数]",
        "",
        "  --save=1               存档槽位（默认 1）",
        "  --dir=路径             直接指定存档目录",
        "  --prop=1,5,9           只看指定道具",
        "  --all                  连持有 0 的材料也显示",
        "  --target-def=数值      目标防御（默认 = 我方最高攻击）",
        "  --target-speed=数值    目标速度（默认 = 我方最高速度）",
        "  --target-shanbi=数值   目标闪避（默认 0）",
        "  --target-resist=数值   目标抗暴（默认 0）",
        "  --target-reduce=数值   目标伤害减免（默认 0，最高按 80 算）",
        "  --enemy-mingzhong=100  敌方命中（神鬼志异羁绊用）",
        "  --enemy-hp=100         目标血量百分比（三国群英羁绊用）",
        "  --enemy-count=5        敌方存活人数（万人敌羁绊用）"
      ].join("\n")
    );
    return;
  }
  const dir = resolveSaveDir(args);
  const save = loadSave(dir);
  const names = loadConfig<NamesConfig>("names");
  const mingshang = loadConfig<MingShangConfig>("mingshang");
  const mapsConfig = loadConfig<MapSetting[]>("maps");
  const equipPercent = loadConfig<EquipPercentEntry[]>("equip-percent");
  const propertyConfig = loadConfig<PropertySetting[]>("property");
  const yingLingConfig = loadConfig<{bonds: number[]; index: number}[]>("yingling");
  const jiBanConfig = loadConfig<{
    id:     number;
    levels: {count: number; level: number}[];
    type:   number;
  }[]>("jiban");
  const percentProps = new Set<number>(
    propertyConfig.filter(setting => setting.percent === 1).map(setting => setting.type)
  );
  const game = save.game;
  const master = rawFromBattleData(save.cha.BattleData_Manager?.battleData_Recorders_List);

  // 选「我方最高输出」:主角阵营里攻击最高的英灵
  const myYingLings = save.yingLings.filter(record => record.Master_ID === 1);
  let unitRecord = myYingLings[0];
  let unitRaw = unitRecord
    ? rawFromBattleData(unitRecord.BattleData_Manager?.battleData_Recorders_List)
    : emptyRaw();
  let bestAtk = -1;
  for (const record of myYingLings) {
    const raw = rawFromBattleData(record.BattleData_Manager?.battleData_Recorders_List);
    const atk = finalValue(P.ATK,raw,master,percentProps);
    if (!(atk > bestAtk)) {
      continue;
    }
    bestAtk = atk;
    unitRecord = record;
    unitRaw = raw;
  }
  if (!unitRecord) {
    throw new Error("存档里没有属于主角（Master_ID=1）的英灵");
  }
  const curZhenFaID = save.cha.CurZhenFa ?? 0;
  const zhenFaRecord = (save.cha.zhenFaRecorders ?? []).find(
    record => record.ZhenFaID === curZhenFaID
  );
  const zhenFa: ZhenFaContext = {id: curZhenFaID,level: zhenFaRecord?.Level ?? 0};
  const myAtk = finalValue(P.ATK,unitRaw,master,percentProps) * (zhenFa.id === 1 ? 1 + zhenFa.level / 100 : 1);
  const target: TargetParams = {
    baoJiResist:  argNumber(args,"target-resist") ?? 0,
    count:        argNumber(args,"enemy-count") ?? 5,
    damageReduce: argNumber(args,"target-reduce") ?? 0,
    def:          argNumber(args,"target-def") ?? Math.round(myAtk),
    hpPercent:    argNumber(args,"enemy-hp") ?? 100,
    mingZhong:    argNumber(args,"enemy-mingzhong") ?? 100,
    shanBi:       argNumber(args,"target-shanbi") ?? 0,
    speed:        argNumber(args,"target-speed") ?? finalValue(P.Speed,unitRaw,master,percentProps)
  };

  // 当前阵型激活的伤害类羁绊
  const bondCounts = new Map<number,number>();
  const zhenRongIndexes = save.cha.ZhenRongManager?.ZhenRong?.ZhenRong ?? [];
  for (const index of zhenRongIndexes) {
    if (index <= 0) {
      continue;
    }
    const config = yingLingConfig.find(item => item.index === index);
    const bonds = config?.bonds ?? [];
    for (const bondType of bonds) {
      bondCounts.set(bondType,(bondCounts.get(bondType) ?? 0) + 1);
    }
  }
  const bondLevelOf = (bondType: number): number => {
    const config = jiBanConfig.find(item => item.type === bondType);
    const count = bondCounts.get(bondType) ?? 0;
    let level = 0;
    const levels = config?.levels ?? [];
    for (const item of levels) {
      if (count >= item.count && item.level > level) {
        level = item.level;
      }
    }
    return level;
  };
  const bond: BondContext = {
    sanGuo:  bondLevelOf(0),
    shenGui: bondLevelOf(4),
    shenMou: bondLevelOf(6),
    wanRen:  bondLevelOf(5),
    xiXing:  bondLevelOf(11)
  };
  const baseDamage = expectedDamage(unitRaw,master,target,zhenFa,bond,percentProps);
  if (isArgOn(args,"debug")) {
    const final = (prop: number): number => finalValue(prop,unitRaw,master,percentProps);
    let atk = final(P.ATK);
    if (zhenFa.id === 1 && zhenFa.level > 0) {
      atk += Math.trunc(atk * zhenFa.level / 100);
    }
    const defEff = Math.max(1,target.def - final(P.IgonoreDEF));
    console.log(
      [
        "[debug]",
        `atk=${String(atk)}`,
        `defEff=${String(defEff)}`,
        `k=${String(culDamagePercent(atk,defEff))}`,
        `命中=${String(final(P.MingZhong))}`,
        `暴击=${String(final(P.BaoJi))}`,
        `暴伤=${String(final(P.BaoJiDamage))}`,
        `伤害加成=${String(final(P.DamageAddition))}`,
        `减伤=${String(final(P.DamageReduce))}`
      ].join(" ")
    );
  }

  // 计算一组属性改动带来的伤害变化率
  const damageDelta = (gains: Gain[],isOnUnit: boolean): {after: number; before: number; percent: number} => {
    const nextMaster = isOnUnit ? master : cloneRaw(master);
    const nextUnit = isOnUnit ? cloneRaw(unitRaw) : unitRaw;
    for (const gain of gains) {
      applyGain(isOnUnit ? nextUnit : nextMaster,gain,percentProps);
    }
    const after = expectedDamage(nextUnit,nextMaster,target,zhenFa,bond,percentProps);
    return {
      after,
      before:  baseDamage,
      percent: baseDamage === 0 ? 0 : (after - baseDamage) / baseDamage * 100
    };
  };
  const routes: Route[] = [];

  // ---- 转职强化(历史本纪):只加单个英灵 ----
  const zhuanZhiLevels = myYingLings.map(record => record.ZhuanZhiManager?.CurStrength ?? 0);
  const zhuanZhiLevel = zhuanZhiLevels.length > 0 ? Math.min(...zhuanZhiLevels) : 0;
  const zhuanZhiAdd = 20 + 50 * zhuanZhiLevel;
  const zhuanZhiGains: Gain[] = [
    {percent: false,prop: P.ATK,value: zhuanZhiAdd},
    {percent: false,prop: P.IgonoreDEF,value: zhuanZhiAdd},
    {percent: false,prop: P.Speed,value: 1}
  ];
  routes.push({
    cost:   10 + 10 * zhuanZhiLevel,
    detail: gainText(zhuanZhiGains,percentProps),
    gains:  zhuanZhiGains,
    note:   "只强化一个英灵；生命/防御不计入伤害",
    propID: 9,
    target: "unit",
    use:    `转职强化（英灵最低 Lv.${String(zhuanZhiLevel)}）`
  });

  // ---- 装备强化(强化石):加主角 ----
  const equipSlots = save.cha.EquipManager?.equip_List ?? [];
  const equipLevels = equipSlots.map(slot => slot.CurStrength);
  const equipLevel = equipLevels.length > 0 ? Math.min(...equipLevels) : 0;
  const equipCostBase = 3 + 2 * equipLevel;
  const equipAddBase = 10 + 10 * equipLevel;
  const isEquipHigh = equipLevel >= 100_0000;
  const equipCost = Math.max(
    1,
    culPercentToInt(isEquipHigh ? equipCostBase * 5 : equipCostBase,getMarkCount(game,MARK_REDUCE_QIANGHUA),true)
  );
  const equipAdd = isEquipHigh ? equipAddBase * 5 : equipAddBase;
  const equipGains: Gain[] = [{percent: false,prop: P.ATK,value: equipAdd}];
  routes.push({
    cost:   equipCost,
    detail: gainText(equipGains,percentProps),
    gains:  equipGains,
    note:   "自动强化先升最低部位；生命/防御不计入",
    propID: 5,
    target: "master",
    use:    `装备强化（最低部位 Lv.${String(equipLevel)}）`
  });

  // ---- 阵法(灵纹):加主角 ----
  const zhenFaLevel = zhenFaRecord?.Level ?? 1;
  const zhenFaAdd = 200 + 35 * zhenFaLevel;
  const zhenFaCost = Math.max(
    1,
    culPercentToInt(zhenFaLevel * 20,getMarkCount(game,MARK_REDUCE_ZHENWEN),true)
  );
  const zhenFaGains: Gain[] = [
    {percent: false,prop: P.ATK,value: zhenFaAdd},
    {percent: false,prop: P.IgonoreDEF,value: zhenFaAdd}
  ];
  routes.push({
    cost:   zhenFaCost,
    detail: gainText(zhenFaGains,percentProps),
    gains:  zhenFaGains,
    note:
      zhenFa.id === 1
        ? `另有战斗期效果：最高攻单位 +${String(zhenFa.level)}% 攻击（不体现在面板）`
        : "只升级当前佩戴的阵法；生命/防御不计入",
    propID: 7,
    target: "master",
    use:    `阵法升级（${String(curZhenFaID)} 号阵 Lv.${String(zhenFaLevel)}）`
  });

  // ---- 圣兽(5 张地图):加主角 ----
  for (const map of mapsConfig) {
    const record = save.maps.find(item => item._id === map.mapID);
    const stage = record?.shengShou_Record?.CurStrength ?? 0;
    const add = 20 + 50 * stage;
    const gains: Gain[] = [
      {percent: false,prop: map.shengShou.property1,value: add},
      {percent: false,prop: map.shengShou.property2,value: add}
    ];
    if (stage % 250 === 0) {
      gains.push({percent: true,prop: map.shengShou.property3,value: 1});
    }
    const mapName = names.maps[String(map.mapID)] ?? `地图${String(map.mapID)}`;
    const beastName = names.shengShou[String(map.shengShou.index)] ?? `圣兽${String(map.shengShou.index)}`;
    routes.push({
      cost:   Math.min(10 + 10 * stage,50000),
      detail: gainText(gains,percentProps),
      gains,
      note:   stage % 250 === 0 ? "本阶额外 +1 点特殊属性（按百分比属性处理）" : undefined,
      propID: map.shengShou.remandProp,
      target: "master",
      use:    `圣兽·${beastName}（${mapName} 第 ${String(stage)} 阶）`
    });
  }

  // ---- 制作装备(寒铁):加主角 ----
  const lianQiLevel = save.cha.EquipManager?.LianQiLevel ?? 1;
  const qiLuLevel = save.cha.EquipManager?.QiLu_Level ?? 1;
  const hantieReduce = getMarkCount(game,MARK_REDUCE_HANTIE);
  const hanTieCost = Math.max(
    1,
    Math.min(200_0000,culPercentToInt(lianQiLevel,hantieReduce,true))
  );
  let equipPropertyAddition = getMarkCount(game,MARK_ADD_EQUIP_PROPERTY);
  if (getMarkCount(game,MARK_ADD_EQUIP_QI_DING) > 0) {
    equipPropertyAddition += qiLuLevel;
  }
  if (getMarkCount(game,MARK_ADD_EQUIP_LIAN_QI) > 0) {
    equipPropertyAddition += lianQiLevel;
  }
  const distribution = pinZhiDistribution(qiLuLevel,equipPercent);
  const totalWeight = distribution.reduce((sum,value) => sum + value,0);
  let expectedAtk = 0;
  let expectedCiTiao = 0;
  if (totalWeight > 0) {
    for (const [index,chance] of distribution.entries()) {
      if (chance <= 0) {
        continue;
      }
      const pinZhi = index + 1;
      const probability = chance / totalWeight;
      const atkValue =
        (30 + 25 * lianQiLevel + 6 * pinZhi * lianQiLevel) *
        (0.4 * pinZhi + 1) *
        1.05 *
        (1 + equipPropertyAddition / 100);
      expectedAtk += probability * atkValue;
      expectedCiTiao += probability * ciTiaoCount(pinZhi) * pinZhi;
    }
  }

  // 词条按候选属性出现频率分摊(每件装备 5 个候选,命中哪条全随机)
  const propWeight = new Map<number,number>();
  for (const candidates of EQUIP_PROPERTIES) {
    for (const prop of candidates) {
      propWeight.set(prop,(propWeight.get(prop) ?? 0) + 1 / candidates.length);
    }
  }
  const weightSum = propWeight.values().reduce((sum,value) => sum + value,0);
  const craftGains: Gain[] = [{percent: false,prop: P.ATK,value: Math.round(expectedAtk)}];
  const ciTiaoDetail: string[] = [];
  if (weightSum > 0 && expectedCiTiao > 0) {
    for (const [prop,weight] of propWeight) {
      const points = expectedCiTiao * weight / weightSum;
      if (points <= 0) {
        continue;
      }
      craftGains.push({percent: true,prop,value: points});
      const name = PROP_NAMES[prop] ?? `属性${String(prop)}`;
      ciTiaoDetail.push(`${name}+${points.toFixed(2)}${percentProps.has(prop) ? "" : "%"}`);
    }
  }
  routes.push({
    cost:   hanTieCost,
    detail: `期望攻击+${formatNumber(Math.round(expectedAtk))}；期望词条：${ciTiaoDetail.join(" ") || "无"}`,
    gains:  craftGains,
    note:   "毛收益：装备随机、要替换旧装备，真实提升取决于当前装备与运气",
    propID: 1,
    target: "master",
    use:    `制作装备（炼器 Lv.${String(lianQiLevel)} / 器鼎 Lv.${String(qiLuLevel)}）`
  });

  // ---- 图鉴道具:加主角 ----
  for (const [propID,definition] of save.props) {
    if (definition.effectName !== EFFECT_ADD_TUJIAN_EXP) {
      continue;
    }
    const enemyIndex = definition.params1 ?? 0;
    const itemExp = definition.params2 ?? 0;
    if (itemExp <= 0) {
      continue;
    }
    const tuJian = (save.cha.tuJianData_RecordsList ?? []).find(
      record => record.EnemyIndex === enemyIndex
    );
    const tuJianLevel = tuJian?.Level ?? 0;
    const needExp = tuJianLevelUpExp(tuJianLevel);
    const perExp = (50 + 15 * tuJianLevel) / needExp;
    const gains: Gain[] = [
      {percent: false,prop: P.ATK,value: Math.round(itemExp * perExp)},
      {percent: false,prop: P.IgonoreDEF,value: Math.round(itemExp * perExp)}
    ];
    routes.push({
      cost:   1,
      detail: gainText(gains,percentProps),
      gains,
      note:   `图鉴每级四维 +${String(50 + 15 * tuJianLevel)}，本级还需 ${formatNumber(needExp)} 经验`,
      propID,
      target: "master",
      use:    `图鉴升级（当前 Lv.${String(tuJianLevel)}）`
    });
  }

  // ---- 冥商属性药 ----
  const pillCandidates: {amount: number; price: number; propID: number; propType: number}[] = [];
  for (const entry of mingshang.sell) {
    const definition = save.props.get(entry.prop);
    if (!definition || definition.effectName !== EFFECT_ADD_YULINGSHI_PROPERTY) {
      continue;
    }
    const propType = definition.params1 ?? -1;
    const amount = definition.params2 ?? 0;
    if (amount <= 0 || propType < 0) {
      continue;
    }
    pillCandidates.push({amount,price: entry.price / entry.nums,propID: entry.prop,propType});
  }
  const pillReports = pillCandidates.map(pill => {
    const delta = damageDelta([{percent: true,prop: pill.propType,value: pill.amount}],false);
    return {...pill,deltaPercent: delta.percent};
  });
  const bestPill = [...pillReports]
    .filter(pill => OUTPUT_PROPS.has(pill.propType))
    .toSorted((left,right) => right.deltaPercent / right.price - left.deltaPercent / left.price)[0];
  if (!bestPill) {
    throw new Error("冥商配置里找不到输出类属性药，请先跑 extract-config.py");
  }
  const sellPriceByProp = new Map<number,number>();
  for (const entry of mingshang.buy) {
    const perUnit = entry.price / entry.nums;
    const old = sellPriceByProp.get(entry.prop) ?? 0;
    if (perUnit > old) {
      sellPriceByProp.set(entry.prop,perUnit);
    }
  }

  // ---- 汇总 ----
  const propFilterArg = args.get("prop");
  const filterProps =
    typeof propFilterArg === "string"
      ? propFilterArg
          .split(",")
          .map(value => Number(value.trim()))
          .filter(value => Number.isFinite(value))
      : undefined;
  const isShowAll = isArgOn(args,"all");
  interface MaterialSummary {
    best?:            {deltaPercent: number; route: Route};
    owned:            number;
    propID:           number;
    sellDeltaPercent: number;
    sellPerUnit:      number;
  }

  const allPropIDs = new Set<number>();
  for (const route of routes) {
    allPropIDs.add(route.propID);
  }
  for (const propID of sellPriceByProp.keys()) {
    allPropIDs.add(propID);
  }
  const summaries: MaterialSummary[] = [];
  for (const propID of allPropIDs) {
    if (filterProps && !filterProps.includes(propID)) {
      continue;
    }
    const owned = getPropNums(game,propID);
    if (!isShowAll && owned <= 0) {
      continue;
    }
    let best: MaterialSummary["best"];
    for (const route of routes) {
      if (route.propID !== propID) {
        continue;
      }
      const delta = damageDelta(route.gains,route.target === "unit");
      const perUnit = delta.percent / route.cost;
      if (!best || perUnit > best.deltaPercent / best.route.cost) {
        best = {deltaPercent: perUnit * route.cost,route};
      }
    }
    const sellPerUnit = sellPriceByProp.get(propID) ?? 0;
    const sellDeltaPercent =
      sellPerUnit > 0 ? sellPerUnit / bestPill.price * bestPill.deltaPercent : 0;
    summaries.push({best,owned,propID,sellDeltaPercent,sellPerUnit});
  }
  summaries.sort(
    (left,right) => (right.best ? right.best.deltaPercent / right.best.route.cost : 0) -
      (left.best ? left.best.deltaPercent / left.best.route.cost : 0)
  );
  const unitStats = {
    ATK:  finalValue(P.ATK,unitRaw,master,percentProps),
    DEF:  finalValue(P.DEF,unitRaw,master,percentProps),
    HP:   finalValue(P.HP,unitRaw,master,percentProps),
    伤害加成: finalValue(P.DamageAddition,unitRaw,master,percentProps),
    命中:   finalValue(P.MingZhong,unitRaw,master,percentProps),
    暴伤:   finalValue(P.BaoJiDamage,unitRaw,master,percentProps),
    暴击:   finalValue(P.BaoJi,unitRaw,master,percentProps),
    穿透:   finalValue(P.IgonoreDEF,unitRaw,master,percentProps),
    连击:   finalValue(P.LianJi,unitRaw,master,percentProps),
    速度:   finalValue(P.Speed,unitRaw,master,percentProps)
  };
  const lines: string[] = [
    "=== 物资性价比（按期望伤害计算）===",
    `存档：${save.dir}`,
    "",
    "--- 我方最高输出单位 ---",
    `英灵 ID：${String(unitRecord._id)}（Master_ID=1）`,
    `攻击 ${formatNumber(unitStats.ATK)}｜穿透 ${formatNumber(unitStats.穿透)}｜速度 ${formatNumber(unitStats.速度)}｜暴击 ${String(unitStats.暴击)}｜暴伤 ${String(unitStats.暴伤)}｜命中 ${String(unitStats.命中)}｜连击 ${String(unitStats.连击)}｜伤害加成 ${String(unitStats.伤害加成)}%`,
    `佩戴阵法：${String(curZhenFaID || "无")} 号（Lv.${String(zhenFa.level)}）${zhenFa.id === 1 ? ` → 战斗开始最高攻单位 +${String(zhenFa.level)}% 攻击` : ""}`,
    `目标参数：防御 ${formatNumber(target.def)}｜速度 ${formatNumber(target.speed)}｜闪避 ${String(target.shanBi)}｜命中 ${String(target.mingZhong)}｜抗暴 ${String(target.baoJiResist)}｜减伤 ${String(target.damageReduce)}%｜血量 ${String(target.hpPercent)}%｜人数 ${String(target.count)}`,
    `生效羁绊：西行取经 Lv.${String(bond.xiXing)}｜神鬼志异 Lv.${String(bond.shenGui)}｜万人敌 Lv.${String(bond.wanRen)}｜神谋鬼算 Lv.${String(bond.shenMou)}｜三国群英 Lv.${String(bond.sanGuo)}（0=未激活）`,
    `基准期望伤害：${formatScore(baseDamage)}`,
    "",
    "--- 冥商属性药（加成是百分比点，收益按当前属性算）---"
  ];
  for (const pill of pillReports) {
    const name = propName(names,pill.propID);
    const label = PROP_NAMES[pill.propType] ?? `属性${String(pill.propType)}`;
    const isOutput = OUTPUT_PROPS.has(pill.propType);
    const suffix = isOutput
      ? pill.deltaPercent === 0
        ? "（已溢出，无收益）"
        : ""
      : "（防御/辅助类，不计入输出）";
    lines.push(
      `  · ${name}：+${String(pill.amount)} ${label}，${formatNumber(pill.price)} 元宝 → 伤害 +${formatPercent(pill.deltaPercent)}%${suffix}`
    );
  }
  lines.push(
    `  → 最佳：${propName(names,bestPill.propID)}，${formatPercent(bestPill.deltaPercent / bestPill.price * 100)} %伤害/100元宝`,
   "","--- 快速结论 ---");
  for (const summary of summaries) {
    const name = propName(names,summary.propID);
    if (summary.best) {
      const perUnit = summary.best.deltaPercent / summary.best.route.cost;
      if (summary.sellPerUnit > 0) {
        let relation: string;
        if (perUnit === 0) {
          relation = "直接使用无输出收益，卖掉更划算";
        } else if (summary.sellDeltaPercent === 0) {
          relation = "卖→药无收益，直接使用更划算";
        } else {
          const ratio = perUnit / summary.sellDeltaPercent;
          relation =
            ratio >= 1 ? `直接使用是卖掉的 ${formatRatio(ratio)}` : `卖掉更划算 ${formatRatio(1 / ratio)}`;
        }
        lines.push(
          `${name}：${summary.best.route.use} ${formatPercent(perUnit)} %伤害/个；卖→药 ${formatPercent(summary.sellDeltaPercent)} %/个 → ${relation}`
        );
      } else {
        lines.push(`${name}：${summary.best.route.use} ${formatPercent(perUnit)} %伤害/个（冥商不收）`);
      }
    } else if (summary.sellPerUnit > 0) {
      lines.push(
        `${name}：无直接输出用途，冥商收购 ${summary.sellPerUnit.toFixed(6)} 元宝/个（卖→药 ${formatPercent(summary.sellDeltaPercent)} %/个）`
      );
    } else {
      lines.push(`${name}：无直接输出用途`);
    }
  }
  lines.push("");
  for (const summary of summaries) {
    const name = propName(names,summary.propID);
    lines.push(`--- ${name}（PropID ${String(summary.propID)}，持有 ${formatNumber(summary.owned)}）---`);
    if (summary.sellPerUnit > 0) {
      lines.push(
        `冥商收购：${summary.sellPerUnit.toFixed(6)} 元宝/个 → 换药后 ${formatPercent(summary.sellDeltaPercent)} %伤害/个`
      );
    } else {
      lines.push("冥商收购：该材料不在收购列表里");
    }
    const materialRoutes = routes
      .filter(route => route.propID === summary.propID)
      .map(route => {
        const delta = damageDelta(route.gains,route.target === "unit");
        return {deltaPercent: delta.percent,route};
      })
      .toSorted((left,right) => right.deltaPercent / right.route.cost - left.deltaPercent / left.route.cost);
    for (const item of materialRoutes) {
      lines.push(
        `  · ${item.route.use}：每次 ${formatNumber(item.route.cost)} 个 → ${item.route.detail} = 伤害 +${formatPercent(item.deltaPercent)}%（${formatPercent(item.deltaPercent / item.route.cost)} %/个）`
      );
      if (item.route.note) {
        lines.push(`      备注：${item.route.note}`);
      }
    }
    const indirect = INDIRECT_NOTES.get(summary.propID);
    if (indirect) {
      lines.push(`  · 间接用途：${indirect}`);
    }
    if (summary.best && summary.sellPerUnit > 0) {
      const perUnit = summary.best.deltaPercent / summary.best.route.cost;
      const ratio = summary.sellDeltaPercent > 0 ? perUnit / summary.sellDeltaPercent : Infinity;
      const verdict =
        perUnit > summary.sellDeltaPercent
          ? `直接使用更划算（${formatRatio(ratio)}）`
          : `卖掉换药更划算（${formatRatio(1 / ratio)}）`;
      lines.push(`  结论：${summary.best.route.use} — ${verdict}`);
    } else if (summary.best) {
      lines.push(`  结论：${summary.best.route.use}`);
    } else if (summary.sellPerUnit > 0) {
      lines.push(
        indirect ? "  结论：不要卖，留给上面对应的间接用途" : "  结论：没有直接输出用途（用途未核对，建议先保留）"
      );
    }
    lines.push("");
  }
  lines.push("--- 说明 ---","1、百分比属性（暴击/暴伤/命中/伤害加成/连击）的收益按当前面板换算，不是“1 点 = 1 点攻击”。","2、命中/暴击/连击/反击的实际概率上限 100%，溢出部分无收益；伤害减免上限 80%。","3、攻防系数在攻击 ≥ 3×有效防御时会从约 250 掉回 100，堆攻击/穿透时要注意这个断点。","4、制作装备是毛收益：产出随机、要替换旧装备；阵法 1 的战斗期 +等级% 攻击不在面板里。","5、冥商收购每个档位只能成交一次，这里取最高单价。");
  console.log(lines.join("\n"));
}
function propName (names: NamesConfig,propID: number): string {
  return names.props[String(propID)] ?? `道具${String(propID)}`;
}
function rawFromBattleData (list: BattleDataRecorder[] | undefined): RawStats {
  const raw = emptyRaw();
  if (list !== undefined) {
    for (const item of list) {
      if (item.PropertyTypeEnum < 0 || item.PropertyTypeEnum >= PROP_COUNT) {
        continue;
      }
      raw.base[item.PropertyTypeEnum] = item.Base_Value;
      raw.pct[item.PropertyTypeEnum] = item.PercentAddition;
    }
  }
  return raw;
}

// 图鉴升级所需经验(TuJianData_Record.GetLevelUpEXPDic)
function tuJianLevelUpExp (level: number): number {
  let total = 10;
  for (let index = 0; index < level; index += 1) {
    total += (Math.floor(index / 10) + 1) * 10;
  }
  return total;
}
runMain(main);