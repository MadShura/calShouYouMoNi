/**
 * damage-formula.ts — 把反编译源码里的伤害计算 1:1 换成 TS,不做任何"等价变形".
 *
 * 数值语义约定(与 C# / .NET 对齐,这是本文件存在的唯一目的):
 * 1. `BigInteger` / `long` → `bigint`.绝不用 `number` 承接,
 *    否则超过 2^53(9.007e15) 就会静默丢精度,而本游伤害在 1e21~1e23 量级.
 * 2. `double` → `number`,但**必须按 C# 的求值顺序逐步算**,不许合并成式子
 *    (浮点乘法不满足结合律,合并会改变末位).
 * 3. `float`(Unity 的 `Random.Range(0.95f,1.05f)` 等) → `Math.fround`.
 * 4. `Math.Round(double)` 是**银行家舍入**(MidpointRounding.ToEven),
 *    不是 JS 的 `Math.round`(0.5 向上且远离零).这里用 `roundToEven`.
 * 5. `(long)double` 向零截断;超出 long 范围时 x64 的 `cvttsd2si` 给 `long.MinValue`,
 *    这正是源码 `if (num < 0) num = 9223372036854775806L` 想兜的溢出,这里照做.
 * 6. `(int)` / `int` 运算溢出按 32 位回绕(`toInt32`).
 * 7. `BigInteger` 除法向零截断(JS `bigint` 的 `/` 同语义).
 *
 * 每个方法都在注释里标了源码位置,方便逐行核对.
 */

// ============================== 常量 ==============================

/** PropertyTypeEnum(顺序与源码一致). */
export const Prop = {
  ATK: 0,
  DEF: 1,
  HP: 2,
  Speed: 3,
  MingZhong: 4,
  ShanBi: 5,
  BaoJi: 6,
  BaoJi_Resist: 7,
  BaoJi_Damage: 8,
  LianJi: 9,
  FanJi: 10,
  Recovery: 11,
  XiXue: 12,
  DamageAddition: 13,
  DamageReduce: 14,
  Igonore_DEF: 15,
  RetrunDamage: 16,
  Lucky: 17
} as const;
export type PropType = number;

/** DamageType(源码 Damage_Recorder.cs / DamageType.cs). */
export const DamageType = {
  Attack: 0,
  Recorvery: 1,
  ReLife: 2,
  Gain: 3
} as const;

/** ToolClass.Units(18 个,万进制). */
export const UNITS: readonly string[] = [
  "","万","亿","兆","京","垓","秭","穰","沟","涧","正","载","极","恒河沙","阿僧祗","那由他","不可思议","无量大"
];

export const LONG_MAX = 9223372036854775807n;
export const LONG_MIN = -9223372036854775808n;
export const INT_MAX = 2147483647n;
export const INT_MIN = -2147483648n;
/** 源码里用来兜溢出的常量:9223372036854775806L / 2147483637. */
export const LONG_NEAR_MAX = 9223372036854775806n;
export const INT_NEAR_MAX = 2147483637n;

// ============================== 数值语义 ==============================

/**
 * C# `Math.Round(double)` 默认的银行家舍入.
 * @param value 待舍入值.
 * @returns 最近的整数,恰好在 .5 时取偶数.
 */
export function roundToEven (value: number): number {
  if (!Number.isFinite(value)) {return value;}
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) {return floor + 1;}
  if (diff < 0.5) {return floor;}
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * C# `(long)double`:向零截断;越界按 x64 cvttsd2si 语义给 long.MinValue.
 * @param value 待转换值.
 * @returns long 值.
 */
export function doubleToLong (value: number): bigint {
  if (!Number.isFinite(value)) {return LONG_MIN;}
  if (value >= 9223372036854775808) {return LONG_MIN;}
  if (value < -9223372036854775808) {return LONG_MIN;}
  return BigInt(Math.trunc(value));
}

/**
 * C# `(int)long` / int 运算溢出:取低 32 位按有符号解释.
 * @param value 输入.
 * @returns int32 值.
 */
export function toInt32 (value: bigint | number): number {
  const normalized = typeof value === "bigint"
    ? Number(BigInt.asUintN(32,value))
    : Number(BigInt.asUintN(32,BigInt(Math.trunc(value))));
  return normalized >= 2147483648 ? normalized - 4294967296 : normalized;
}

/**
 * C# `long` 溢出回绕(源码里 long 乘法没有 checked,溢出按二进制补码).
 * @param value 输入.
 * @returns int64 值.
 */
export function toLong (value: bigint): bigint {
  return BigInt.asIntN(64,value);
}

/**
 * Unity `Random.Range(float min, float max)` 的结果:float32 精度.
 * 这里只负责把给定值搬成 float32,随机源由调用方给(便于固定 0.95/1.0/1.05 掐范围).
 * @param value 原始值.
 * @returns float32 值(提升回 number).
 */
export function asFloat (value: number): number {
  return Math.fround(value);
}

/**
 * NumsHelper.PlusFloat_Biginteger: `bigInteger * (BigInteger)Math.Round(value*10000) / 10000`.
 * @param value 原 BigInteger.
 * @param ratio 浮点倍数.
 * @returns 截断后的 BigInteger.
 */
export function plusFloatBigInteger (value: bigint,ratio: number): bigint {
  const factor = BigInt(roundToEven(ratio * 10000.0));
  return value * factor / 10000n;
}

/**
 * ToolClass.CulFinalValuePercentArray:基数 100 起,逐项 `num = num * (100+p) / 100.0`,
 * 全程 double,最后 `(long)`.
 * 源码:FrameWorkHelper/ToolClass.cs:312-320(以及 Damage_Recorder.cs:61 用 Base=100 调用).
 * @param base 基数.
 * @param percentAddition 百分比数组(顺序即源码 List 顺序,不可排序).
 * @returns long 结果,已含越界回退.
 */
export function culFinalValuePercentArray (base: bigint,percentAddition: readonly number[]): bigint {
  let value = Number(base);
  for (const pct of percentAddition) {
    value = value * (100 + pct) / 100.0;
  }
  return doubleToLong(value);
}

/**
 * ToolClass.TranslateNumsToSuoXie(BigInteger):10 万以下整数,之后万/亿/兆… 每四位递进,
 * 大数按 1/2/3 位小数截断(不是四舍五入).
 * @param value 数值.
 * @returns 游戏内单位字符串.
 */
export function formatBigSuoXie (value: bigint): string {
  const negative = value < 0n;
  let abs = negative ? -value : value;
  if (abs < 100000n) {return `${negative ? "-" : ""}${abs.toString()}`;}
  let unitIndex = 0;
  let unitValue = 1n;
  while (abs / unitValue >= 10000n && unitIndex < UNITS.length - 1) {
    unitValue *= 10000n;
    unitIndex += 1;
  }
  const high = abs / unitValue;
  const low = abs % unitValue;
  let text: string;
  if (high >= 1000n) {
    text = high.toString();
  } else if (high >= 100n) {
    text = `${high.toString()}.${(low * 10n / unitValue).toString()}`;
  } else if (high >= 10n) {
    text = `${high.toString()}.${(low * 100n / unitValue).toString().padStart(2,"0")}`;
  } else {
    text = `${high.toString()}.${(low * 1000n / unitValue).toString().padStart(3,"0")}`;
  }
  return `${negative ? "-" : ""}${text}${UNITS[unitIndex] ?? ""}`;
}

// ============================== BattleData_Recorder / Manager ==============================

/** 属性是不是"百分比型"(config/property.json 的 percent 字段,运行期由 PropertySetting 提供). */
export interface PropertySetting {
  percent: boolean;
}

/** BattleData_Recorder.cs:7-70. */
export class BattleDataRecorder {
  readonly propertyTypeEnum: PropType;
  /** C# 字段是 double,这里保持 double(number),交给 True_Base_Value 取整. */
  baseValue: number;
  /** C# 字段是 long. */
  percentAddition: bigint;

  constructor (propertyTypeEnum: PropType,baseValue: number) {
    this.propertyTypeEnum = propertyTypeEnum;
    this.baseValue = baseValue;
    this.percentAddition = 0n;
  }

  /**
   * `True_Base_Value => (BigInteger)Math.Round(Base_Value)`.
   * 注意:这是 double → BigInteger 的转换(BigInteger 无上限),**不是** →long,
   * 所以敌方 1e21 量级的 HP/防御 不会被截成 long.MinValue.
   */
  get trueBaseValue (): bigint {
    return BigInt(Math.trunc(roundToEven(this.baseValue)));
  }

  /**
   * BattleData_Recorder.GetFinal(BigInteger OtherBase = 0, long LongerPercentAddition = 0).
   * @param percent 是否百分比型属性.
   * @param otherBase 主角继承的 base.
   * @param longerPercentAddition 主角继承的百分比.
   * @returns 终值.
   */
  getFinal (percent: boolean,otherBase = 0n,longerPercentAddition = 0n): bigint {
    if (percent) {
      const sum = this.trueBaseValue + otherBase;
      return sum < 0n ? 0n : sum;
    }
    return (this.trueBaseValue + otherBase) * (100n + this.percentAddition + longerPercentAddition) / 100n;
  }

  /**
   * BattleData_Recorder.ChangeValue.
   * @param value 数值.
   * @param isPercent 是否按百分比加(仅非百分比型属性有效).
   * @param percent 属性是否百分比型.
   * @param add 加还是减.
   */
  changeValue (value: number,isPercent: boolean,percent: boolean,add: boolean): void {
    if (percent) {
      this.baseValue += add ? value : -value;
      return;
    }
    if (add) {
      if (!isPercent) {
        this.baseValue += value;
      } else {
        this.percentAddition += toLong(BigInt(roundToEven(value)));
      }
      return;
    }
    if (!isPercent) {
      this.baseValue -= value;
    } else {
      this.percentAddition -= toLong(BigInt(roundToEven(value)));
    }
  }
}

/** BattleData_Manager.cs:9-86. */
export class BattleDataManager {
  readonly list: BattleDataRecorder[] = [];
  private readonly percentOf: (prop: PropType) => boolean;

  constructor (percentOf: (prop: PropType) => boolean) {
    this.percentOf = percentOf;
  }

  /** 按枚举顺序补齐 18 个属性(源码 `foreach (PropertyTypeEnum value in Enum.GetValues(...))`). */
  initail (initialOf: (prop: PropType) => number): void {
    this.list.length = 0;
    for (const prop of Object.values(Prop)) {
      this.list.push(new BattleDataRecorder(prop,initialOf(prop)));
    }
  }

  getData (prop: PropType): BattleDataRecorder {
    const found = this.list.find(item => item.propertyTypeEnum === prop);
    if (found === undefined) {throw new Error(`找不到属性 ${String(prop)}`);}
    return found;
  }

  /**
   * BattleData_Manager.ChangeProprtyValue.
   * @param prop 属性.
   * @param value 数值.
   * @param isPercent 是否按百分比加.
   * @param add 加还是减.
   */
  changePropertyValue (prop: PropType,value: number,isPercent: boolean,add: boolean): void {
    this.getData(prop).changeValue(value,isPercent,this.percentOf(prop),add);
  }

  /**
   * BattleData_Manager.GetFinalValue(prop, character = null).
   * @param prop 属性.
   * @param master 主角的面板(英灵继承用,源码 GetMasterPropertyFinal).
   * @returns 终值.
   */
  getFinalValue (prop: PropType,master?: BattleDataManager): bigint {
    if (master === undefined) {
      return this.getData(prop).getFinal(this.percentOf(prop));
    }
    const masterRecorder = master.getData(prop);
    return this.getData(prop).getFinal(this.percentOf(prop),masterRecorder.trueBaseValue,masterRecorder.percentAddition);
  }

  /**
   * BattleData_Manager.InitailForBattle:清零后写入 character.GetFinalValue(每个属性).
   * @param source 角色自身面板.
   * @param master 主角面板.
   */
  initailForBattle (source: BattleDataManager,master?: BattleDataManager): void {
    for (const recorder of this.list) {
      recorder.baseValue = 0;
      recorder.percentAddition = 0n;
    }
    for (const recorder of this.list) {
      recorder.baseValue = Number(source.getFinalValue(recorder.propertyTypeEnum,master));
    }
  }
}

// ============================== 命中 / 暴击 / 伤害 ==============================

/** 随机源:只为把 Unity 的 Random 变成可注入的一次取值. */
export interface RandomSource {
  /** `Random.Range(min, max)`(float 版). */
  rangeFloat: (min: number,max: number) => number;
  /** `Random.Range(min, max)`(int 版,[min,max) 或 [min,max],只用于命中/暴击判定). */
  rangeInt: (min: number,max: number) => number;
}

/** 固定随机源:伤害浮动系数写死,用来掐 0.95 / 1.0 / 1.05 三档. */
export function fixedRandom (damageRatio: number,roll = 0): RandomSource {
  return {
    rangeFloat: () => asFloat(damageRatio),
    rangeInt:   () => roll
  };
}

/** MingZhong_Recorder.cs:7-36. */
export class MingZhongRecorder {
  readonly finalMz: bigint;
  /** 命中判定:`Random.Range(0, 101) <= Final_MZ`. */
  readonly mingZhong: boolean;

  constructor (baseMz: bigint,baseShanBi: bigint,mzAddition: bigint,random: RandomSource) {
    this.finalMz = 100n + baseMz - baseShanBi + mzAddition;
    this.mingZhong = BigInt(random.rangeInt(0,101)) <= this.finalMz;
  }

  /** 命中概率(clamp 到 0~100%). */
  get chance (): number {
    const value = Number(this.finalMz) + 1;
    return Math.max(0,Math.min(1,value / 101));
  }
}

/** BaoJiRecorder.cs:7-36. */
export class BaoJiRecorder {
  readonly finalBaoJi: bigint;
  readonly baoJi: boolean;

  constructor (baseBaoJi: bigint,baseResist: bigint,addition: bigint,random: RandomSource) {
    this.finalBaoJi = baseBaoJi - baseResist + addition;
    this.baoJi = BigInt(random.rangeInt(0,101)) <= this.finalBaoJi;
  }
}

/** Damage_Recorder.cs:9-162. */
export class DamageRecorder {
  damageType: number = DamageType.Attack;
  baseAttack: bigint = 0n;
  /** List<int>,插入顺序就是源码触发顺序. */
  readonly percentAddition: number[] = [];
  mz = false;
  baoJi = false;
  finalDamage = 0n;

  constructor (base?: DamageRecorder) {
    if (base !== undefined) {
      this.damageType = base.damageType;
      this.baseAttack = base.baseAttack;
      this.percentAddition = [...base.percentAddition];
    }
  }

  /**
   * Damage_Recorder.CulDamagePercent.
   * @param atk 攻击.
   * @param def 防御.
   * @returns K.
   */
  static culDamagePercent (atk: bigint,def: bigint): bigint {
    if (def <= 0n) {return atk > 0n ? 100n : 50n;}
    if (atk === def) {return 50n;}
    if (atk > def) {
      if (atk >= 3n * def) {return 100n;}
      return 50n + (atk - def) * 50n / def * 2n;
    }
    if (atk * 3n <= def) {return 2n;}
    return 2n + (atk * 3n - def) * 48n / (def * 2n);
  }

  /**
   * Damage_Recorder.CulFinalDamage(Attacker, Behiter).
   * @param attacker 攻击方面板.
   * @param attackerProp 取攻击方终值.
   * @param behiter 受击方面板.
   * @param behiterProp 取受击方终值.
   * @param random 随机源.
   */
  culFinalDamage (
    attackerProp: (prop: PropType) => bigint,
    behiterProp: (prop: PropType) => bigint,
    random: RandomSource
  ): void {
    if (this.damageType === DamageType.Gain) {return;}
    let num = culFinalValuePercentArray(100n,this.percentAddition);
    if (num < 0n) {num = LONG_NEAR_MAX;}
    if (this.damageType !== DamageType.Attack) {
      this.finalDamage = this.baseAttack * num / 100n;
      return;
    }
    let def = behiterProp(Prop.DEF) - attackerProp(Prop.Igonore_DEF);
    if (def < 1n) {def = 1n;}
    const k = DamageRecorder.culDamagePercent(this.baseAttack,def);
    let base = this.baseAttack * k / 100n;
    if (base < 1n) {base = 1n;}
    const rand = random.rangeFloat(0.95,1.05);
    let damage = plusFloatBigInteger(base * num / 100n,rand);
    if (this.baoJi) {
      damage = damage * attackerProp(Prop.BaoJi_Damage) / 100n;
    }
    const damageAddition = attackerProp(Prop.DamageAddition);
    damage = damage * (100n + damageAddition) / 100n;
    let damageReduce = behiterProp(Prop.DamageReduce);
    if (damageReduce > 80n) {damageReduce = 80n;}
    damage = damage * (100n - damageReduce) / 100n;
    if (damage < 1n) {damage = 1n;}
    this.finalDamage = damage;
  }
}

// ============================== 角色 / 敌人 ==============================

/** CharacterHelper.GetRoundBaseValue: `(count/100+1)*30*count/2 + (count/100+1)*30*(count%100)`,long 运算. */
export function getRoundBaseValue (count: number): bigint {
  const group = Math.trunc(count / 100);
  const head = toLong(BigInt(group + 1) * 30n * BigInt(count) / 2n);
  const tail = toLong(BigInt(group + 1) * 30n * BigInt(count % 100));
  return toLong(head + tail);
}

/** Character_Enemy.GetAddition(TrueRound). */
export function getAddition (trueRound: number): number {
  if (trueRound <= 10000) {return 1.0;}
  let group = Math.trunc(trueRound / 10000);
  if (group > 200) {group = 200;}
  if (trueRound < 20000) {return 1.0 + (trueRound - 10000) * 1.0 / 10000.0 * 9.0;}
  const low = 10.0 * Math.pow(2.0,group - 2);
  const high = 10.0 * Math.pow(2.0,group - 1);
  const remain = trueRound % 10000;
  if (remain === 0) {return low;}
  return remain * 1.0 / 10000.0 * (high - low) + low;
}

/** Character_Enemy.GetAdd_2: `(True_Round-11000)/1000`,小于 11000 为 0. */
export function getEnemyAdd2 (trueRound: number): bigint {
  if (trueRound < 11000) {return 0n;}
  return BigInt(Math.trunc((trueRound - 11000) / 1000));
}

/** MapRecorder.GetEnemyCount:一层 5 只,CurRound%5 决定品级分布. */
export function getEnemyCount (curRound: number): number[] {
  const array = [0,0,0,0,0];
  switch (curRound % 5) {
    case 0:
      array[0] = 1; array[1] = 1; array[2] = 2; array[4] = 2; array[3] = 3;
      break;
    case 1:
      array[0] = 1; array[1] = 1; array[2] = 1; array[3] = 1; array[4] = 1;
      break;
    case 2:
      array[0] = 1; array[1] = 1; array[2] = 1; array[4] = 1; array[3] = 2;
      break;
    case 3:
      array[0] = 1; array[1] = 1; array[4] = 1; array[2] = 2; array[3] = 2;
      break;
    case 4:
      array[0] = 1; array[1] = 1; array[2] = 2; array[3] = 2; array[4] = 2;
      break;
    default:
      break;
  }
  return array;
}

/** MapRecorder.GetEnemtID:3 → 首领 / 2 → 精英 / 其他 → 小怪(返回图鉴预设 ID). */
export function getEnemyPreset (index: number,presets: {boss: number; elite: number; normal: number}): number {
  if (index === 3) {return presets.boss;}
  if (index === 2) {return presets.elite;}
  return presets.normal;
}

/** MapRecorder.GetTrueRound: `CurRound * ChengZhangSpeed + BaseRound`. */
export function getTrueRound (curRound: number,chengZhangSpeed: number,baseRound: number): number {
  return Math.trunc(curRound * chengZhangSpeed + baseRound);
}

/** 建好的一只敌人:面板 + 品级 + 预设. */
export interface TowerEnemy {
  curRound: number;
  level: number;
  manager: BattleDataManager;
  pinzhi: number;
  preset: number;
  trueRound: number;
}

/**
 * Character_Enemy.Initail_Data + RefineProperty(Character_Enemy.cs:36-99),完全按源码顺序与公式.
 * @param pinzhi 品级(1 小怪 / 2 精英 / 3 首领).
 * @param level `_level = GetTrueRound()`.
 * @param trueRound `True_Round = CurRound`.
 * @param preset 图鉴预设.
 * @param curRound 当前层.
 * @param percentOf 属性是否百分比型.
 * @returns 敌人面板.
 */
export function createTowerEnemy (
  pinzhi: number,
  level: number,
  trueRound: number,
  preset: number,
  curRound: number,
  percentOf: (prop: PropType) => boolean
): TowerEnemy {
  const manager = new BattleDataManager(percentOf);
  manager.initail(() => 0);
  const roundBase = getRoundBaseValue(level);
  const addition = getAddition(trueRound);
  // HP:(8*roundBase*PinZhi + 100) 在 long 里算,再转 double 乘 addition.
  manager.changePropertyValue(Prop.HP,Number(toLong(8n * roundBase * BigInt(pinzhi) + 100n)) * addition,false,true);
  manager.changePropertyValue(Prop.ATK,Number(toLong(3n * roundBase + 195n)) * addition,false,true);
  manager.changePropertyValue(Prop.DEF,Number(roundBase) * addition,false,true);
  manager.changePropertyValue(Prop.BaoJi_Damage,140.0,false,true);
  manager.changePropertyValue(Prop.Speed,26 + pinzhi,false,true);
  refineEnemyProperty(manager,trueRound);
  return {curRound,level,manager,pinzhi,preset,trueRound};
}

/** Character_Enemy.RefineProperty(Character_Enemy.cs:80-99). */
export function refineEnemyProperty (manager: BattleDataManager,trueRound: number): void {
  const group = Math.trunc(trueRound / 100);
  const num2 = 1 + Math.trunc(trueRound / 500);
  let capped = group;
  const add2 = getEnemyAdd2(trueRound);
  if (capped > 70) {capped = 70;}
  // HP/ATK/DEF 的百分比项:GetFinalValue(...) 先取 BigInteger,再转 double 参与乘法.
  manager.changePropertyValue(Prop.HP,Number(manager.getFinalValue(Prop.HP)) * 8.0 * num2 / 100.0,false,true);
  manager.changePropertyValue(Prop.ATK,Number(manager.getFinalValue(Prop.ATK)) * 4.0 * num2 / 100.0,false,true);
  manager.changePropertyValue(Prop.DEF,Number(manager.getFinalValue(Prop.DEF)) * 2.0 * num2 / 100.0,false,true);
  manager.changePropertyValue(Prop.Speed,1 + group + capped,false,true);
  // `num3 + add_` 是 int + long → long
  const stat = Number(BigInt(capped) + add2);
  manager.changePropertyValue(Prop.MingZhong,stat,true,true);
  manager.changePropertyValue(Prop.ShanBi,stat,true,true);
  manager.changePropertyValue(Prop.BaoJi,stat,true,true);
  manager.changePropertyValue(Prop.BaoJi_Resist,stat,true,true);
}

// ============================== 词条(伤害相关) ==============================

/** EntryNameEnum(只列出本文件用到的). */
export const Entry = {
  RenHuangYin: 13,
  ShenTong_1: 35,
  ShenTong_2: 36,
  ShenTong_3: 37,
  ShenTong_4: 38,
  ShenTong_5: 39,
  ShenTong_6: 40,
  ShenTong_7: 41,
  ShenTong_8: 42,
  ShenTong_9: 43,
  ShenTong_10: 44,
  ShenTong_11: 45,
  ShenTong_12: 46,
  ShenTong_13: 47,
  Add_MingZhong: 155,
  Add_BeDamage: 159,
  WanHunFan: 17,
  Skill_76: 255,
  Skill_77: 256,
  Skill_78: 257,
  Skill_81: 260,
  Skill_84: 263,
  Skill_87: 266,
  Skill_1051: 268,
  Skill_1011: 203,
  Skill_18: 65,
  Add_ATK: 153,
  Add_Damage: 157,
  XiXingQuJing: 275,
  ShenGuiZhiYi: 5,
  ZhenFa_8: 130
} as const;

/** 攻击动作类型(源码 ActionType). */
export const ActionKind = {
  CommonAttack: 0,
  Skill: 1,
  Recovery: 2,
  Gain: 3,
  FanJi: 4,
  LianJi: 5
} as const;

/** 一条状态词条. */
export interface StateEntry {
  name: number;
  level: number;
  stayRound: number;
}

/** 一次攻击的上下文(交给各词条 handler). */
export interface AttackContext {
  actionKind: number;
  attackerHit: bigint;
  attackerDodge: bigint;
  attackerSpeedBase: bigint;
  behiterHit: bigint;
  behiterDodge: bigint;
  behiterSpeedBase: bigint;
  badLevelSum: number;
  /** 是否学了 Skill_1050(孙悟空没学 → 3技能吃 -30). */
  hasSkill1050: boolean;
  mark: bigint;
  percent: number[];
}

/**
 * EntryMotherClass.WhenAttack_Cul_1 的派发:按源码各词条实现,只写 `PercentAddition.Add`.
 * 源码位置见每行注释.
 * @param entry 词条.
 * @param ctx 攻击上下文.
 */
export function entryWhenAttackCul1 (entry: StateEntry,ctx: AttackContext): void {
  const level = entry.level;
  switch (entry.name) {
    // Entry_ShenTong_3(神通15):命中×Base(1)×等级/10,超过 2147483647 钳到 2147483637.
    case Entry.ShenTong_3: {
      const value = toLong(ctx.attackerHit * 1n * BigInt(level) / 10n);
      const clamped = value > 2147483647n ? INT_NEAR_MAX : value;
      ctx.percent.push(toInt32(clamped));
      break;
    }
    // Entry_ShenTong_5(神通19):技能动作 +20×等级.
    case Entry.ShenTong_5: {
      if (ctx.actionKind === ActionKind.Skill) {ctx.percent.push(toInt32(BigInt(20 * level)));}
      break;
    }
    // Entry_ShenTong_11(神通27):目标 Bad 词条等级之和.
    case Entry.ShenTong_11: {
      if (ctx.badLevelSum > 0) {ctx.percent.push(toInt32(BigInt(ctx.badLevelSum)));}
      break;
    }
    // Entry_ShenTong_1(神通13):连击动作 +5×等级.
    case Entry.ShenTong_1: {
      if (ctx.actionKind === ActionKind.LianJi) {ctx.percent.push(toInt32(BigInt(5 * level)));}
      break;
    }
    // Entry_ShenTong_2(神通14):反击动作 +5×等级.
    case Entry.ShenTong_2: {
      if (ctx.actionKind === ActionKind.FanJi) {ctx.percent.push(toInt32(BigInt(5 * level)));}
      break;
    }
    // Entry_Skill_76(孙悟空3技能):无 Skill_1050 → -30;再按自身 Mark 层数 +10/层.
    case Entry.Skill_76: {
      if (ctx.actionKind === ActionKind.Skill) {
        if (!ctx.hasSkill1050) {ctx.percent.push(-30);}
        ctx.percent.push(toInt32(BigInt(toInt32(ctx.mark)) * 10n));
      }
      break;
    }
    // Entry_Skill_77:普攻/连击/反击 -75.
    case Entry.Skill_77: {
      if (ctx.actionKind === ActionKind.CommonAttack || ctx.actionKind === ActionKind.LianJi || ctx.actionKind === ActionKind.FanJi) {
        ctx.percent.push(-75);
      }
      break;
    }
    // Entry_Skill_78:直接把命中面板加进乘区.
    case Entry.Skill_78: {
      if (ctx.attackerHit > 0n) {ctx.percent.push(toInt32(ctx.attackerHit));}
      break;
    }
    // Entry_XiXingQuJing(西行取经):(命中−敌闪避)×(0.25+0.25×等级),float 乘法后 PlusFloat.
    case Entry.XiXingQuJing: {
      const diff = ctx.attackerHit - ctx.behiterDodge;
      if (diff > 0n) {
        const ratio = asFloat(asFloat(0.25) + asFloat(asFloat(0.25) * asFloat(level)));
        ctx.percent.push(toInt32(plusFloatBigInteger(diff,ratio)));
      }
      break;
    }
    // Entry_ShenGuiZhiYi(神鬼志异):(我方闪避−敌命中)×(0.2+0.2×等级).
    case Entry.ShenGuiZhiYi: {
      const diff = ctx.attackerDodge - ctx.behiterHit;
      if (diff > 0n) {
        const ratio = asFloat(asFloat(0.2) + asFloat(asFloat(0.2) * asFloat(level)));
        ctx.percent.push(toInt32(plusFloatBigInteger(diff,ratio)));
      }
      break;
    }
    // Entry_ZhenFa_8(鸟翔阵):min(我方Speed.TrueBase − 敌方Speed.TrueBase, 2147483646).
    case Entry.ZhenFa_8: {
      let diff = ctx.attackerSpeedBase - ctx.behiterSpeedBase;
      if (diff > 0n) {
        if (diff > 2147483646n) {diff = 2147483646n;}
        ctx.percent.push(Number(diff));
      }
      break;
    }
    // Entry_Add_BeDamage(图鉴增伤):命中时加到伤害方乘区.
    case Entry.Add_BeDamage: {
      ctx.percent.push(toInt32(BigInt(level)));
      break;
    }
    default:
      break;
  }
}

/**
 * Action_Skill.Excute(Action_Skill.cs:21-36) 的 1:1 版:一次动作打完整张 TargetList.
 * @param base 动作模板(AttackData.Damage_Recorder_Base).
 * @param targets 目标列表(顺序即源码 List 顺序).
 * @param attacker 攻方面板.
 * @param random 随机源.
 * @param percentOfTarget 每个目标先算出自己的 PercentAddition(图鉴增伤等).
 * @param attackerPercent 攻方词条产生的 PercentAddition.
 * @returns 每个目标的 DamageRecorder.
 */
export function executeActionSkill (
  base: DamageRecorder,
  targets: readonly BattleDataManager[],
  attacker: BattleDataManager,
  random: RandomSource,
  attackerPercent: readonly number[],
  percentOfTarget: (target: BattleDataManager) => number[]
): DamageRecorder[] {
  const results: DamageRecorder[] = [];
  for (const target of targets) {
    const recorder = new DamageRecorder(base);
    recorder.percentAddition.push(...attackerPercent);
    recorder.percentAddition.push(...percentOfTarget(target));
    // CulMZ_And_BZ
    recorder.mz = new MingZhongRecorder(
      attacker.getData(Prop.MingZhong).trueBaseValue,
      target.getData(Prop.ShanBi).trueBaseValue,
      0n,
      random
    ).mingZhong;
    recorder.baoJi = new BaoJiRecorder(
      attacker.getFinalValue(Prop.BaoJi),
      target.getFinalValue(Prop.BaoJi_Resist),
      0n,
      random
    ).baoJi;
    recorder.culFinalDamage(
      prop => attacker.getFinalValue(prop),
      prop => target.getFinalValue(prop),
      random
    );
    results.push(recorder);
  }
  return results;
}
