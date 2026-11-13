/**
 * compare.ts — 同类对比(库函数版,不读取存档)
 * 每个养成系统的「等级 → 提升属性」公式都[直接写在对应函数体内](含中文注释 + 反编译源码出处),
 * 不再调用 game-formulas.ts 的黑盒函数,方便一眼看懂"升级一次要多少资源,加多少属性".
 * 传入"当前等级 level",返回对象描述的是"从 level 升到 level+1 这一级"的消耗与提升.
 * 例外:hantieTozhanli() 描述的是「投入寒铁 + 五彩神石 + 翅膀等级」后的完整制造模拟,不是单级对比,详见该函数注释.
 * 最后 materialCost() 给出「每一个材料消耗多少钱币」的兑换表(资源转换表与数值全部写在本文件内,不 import 其他文件).
 */
// ============================== 2. 装备强化(强化石,3 维) ==============================
// Equip_Using.cs:40-71 GetStrengthRemand(消耗=3+2L, L≥1000000 时 ×5)
// :19-22 GetNextAddition(每级三维各+10+10L, L≥1000000 时 ×5)
// 平均强化:角色 10 个装备槽都强化到同等级的合计(yingling-output.ts:2196 注释"10 槽平均强化").
export interface EquipStrengthenResult {
  average: SystemGain; // 平均强化:全部 slots 槽都升级一级的合计(= 单件 × 槽数)
  single:  SystemGain; // 强化单件:单槽装备升级一级的属性增量
}

// 某养成系统"再升一级(L→L+1)"的统一结果.
export interface SystemGain {
  atk:            number; // [升级一次每维提升]升这一级,每一维属性增加多少
  costPerLevelUp: number; // [升级一次所需资源]从 level 升到 level+1 要花多少资源
  dims:           number; // 受益维数
  level:          number; // 当前等级(描述从该等级升到下一级的消耗/提升)
  peratk:    number; // 资源效率:每 1 单位资源换到每维多少属性 = atk / costPerLevelUp
  resource:  string; // 消耗的资源名
  system:    string; // 系统名
  totalGain: number; // [升级一次全维合计提升]= atk × dims
}

// 每一个材料 消耗多少钱币(含 30% 研究减免,保留小数点,不取整)—— 直接写死在此处,
// 无需运行即可看数值;计算 = ValueCost × (100 - 30) / 100 = ValueCost × 0.7:
export const MATERIAL_COST_PER_UNIT: Record<string,number> = {
  三味真火: 1111.6,  // 1588×0.7
  五彩神石: 3.5,    // 5×0.7
  历史本纪: 1.4,    // 2×0.7
  寒铁:   0.7,    // 1×0.7
  强化石:  3.5,    // 5×0.7
  御灵宝典: 52.5,   // 75×0.7
  忘情水:  70,     // 100×0.7
  灵晶:   3.5,    // 5×0.7
  灵纹:   1.4,    // 2×0.7
  破境石:  3.5,    // 5×0.7
  神通卷轴: 1.4    // 2×0.7
};

// ============================== 研究(科技树,消耗 历史本纪) ==============================
// 研究是「节点表驱动」的元系统(yingling-output.ts RESEARCH_STEPS):点满后给各养成系统的[消耗减免]与[属性加成].
// 满研究共消耗 309,665 历史本纪(resource-allocation.ts:140).下面列出满级后各项[减免%]—— 即"研究的减免",
// 可用来把对应系统的 costPerLevelUp 打折(本文件其它养成函数目前未自动叠加减免,需要时按此表乘 (100-减免)/100).
export interface ResearchReduce {
  cost:           number; // 点满研究共需历史本纪
  hanTieReduce:   number; // 15 节衣缩食:寒铁消耗 -50%
  historyReduce:  number; // 55 俭以养德:历史本纪(研究/转职) -20%(-1%/级×20)
  lingWenReduce:  number; // 26 开源节流:灵纹(阵法) -50%
  poJingReduce:   number; // 34 化繁为简:破境石 -30%
  qiangHuaReduce: number; // 25 精打细算:强化石 -50%
  scrollReduce:   number; // 35 删繁就简:神通卷轴 -20%
  shopReduce:     number; // 44 价廉物美:商店买价 -30%(= 多买 Store_Sell_Price 折扣,已用于上面兑换表)
  wucaiReduce:    number; // 20 省吃俭用:五彩神石(器鼎) -50%
  yuLiReduce:     number; // 32 轻车熟路:御力(御灵师) -30%
}

// ---- 制作装备 / 品质 常量(数值均来自反编译源码,集中列出便于核对) ----
const MAKE_EQUIP_COST_CAP = 200_0000; // 升一次炼器消耗寒铁封顶

// ============================== 寒铁 → 战力(完整制造模拟,18 属性全量) ==============================
// 固定口径:研究全部点满(config/keji.json)、初始炼器 Lv.1/经验 0、器鼎 Lv.1700、品质 15、10 槽各 1 件.
// 计算顺序:① 五彩神石把器鼎从 1700 继续往上顶 → 最终器鼎等级;
//          ② 寒铁按源码逐级模拟制造 → 最终炼器等级 + 制造次数;
//          ③ 10 件装备主属性按最终等级算;④ 翅膀加成按制造次数累计.
// 本文件零 import;所有数值只取反编译源码与 config 导出,出处逐条标注.

// ---- 研究全满(固定值:config/keji.json 的 maxLevel × perLevel = 50) ----
const RESEARCH_15_HANTIE_REDUCE = 50; // id15 节衣缩食:寒铁消耗 -1%/级×50(keji.json:183-193)
const RESEARCH_16_EXP_ADD       = 50; // id16 日积月累:炼器经验 +1%/级×50(keji.json:195-205)
const RESEARCH_18_EQUIP_ADD     = 50; // id18 精益求精:装备属性 +1%/级×50(keji.json:219-229)
const RESEARCH_20_WUCAI_REDUCE  = 50; // id20 省吃俭用:五彩神石 -1%/级×50(keji.json)
// 研究22/23 是印记开关(>0 即生效):GetEqui_PropertyAddition 把 QiLu_Level / LianQiLevel 计进装备属性%(PropHelper.cs:424-438)

// ---- 固定口径 ----
const LIANQI_START_LEVEL = 1;      // NPC_EquipManager.cs:36-41 构造函数 LianQiLevel = 1
const LIANQI_START_EXP   = 0;      // 同上,初始 LianQiExp = 0
const QIDING_START_LEVEL = 1700;   // 器鼎默认等级(品质概率表到此级 100% 品质 15)
const EQUIP_PINZHI       = 15;     // 固定最高品质(config/equip-percent.json 最高档 pinzhi 15)
const EQUIP_SLOT_COUNT   = 10;     // EquipType.cs:6-18 共 10 个槽位
const PERCENT_BASE       = 100;    // 百分比基数

// ---- 装备主属性公式固定值(PropHelper.cs:395-405 GenerateEquip) ----
const EQUIP_BASE             = 30;   // (30 + 25×L + 6×品质×L) 基础值
const EQUIP_PER_LEVEL        = 25;   // 每级炼器 +25
const EQUIP_PINZHI_PER_LEVEL = 6;    // 品质×炼器等级 ×6
const EQUIP_PINZHI_FACTOR    = 0.4;  // 品质系数 (0.4×品质 + 1)
const EQUIP_RANDOM_MIN       = 1;    // Random.Range(1f, 1.1f) 下限
const EQUIP_RANDOM_MAX       = 1.1;  // 上限(不含)
const EQUIP_RANDOM_AVG       = (EQUIP_RANDOM_MIN + EQUIP_RANDOM_MAX) / 2; // 随机期望 1.05

// ---- 经验 / 翅膀 / 器鼎公式固定值 ----
const CRAFT_EXP_BASE      = 2;   // PropHelper.cs:478-485 CulExp_Single = 2 + 炼器等级
const WING_FLAT_BASE      = 75;  // NPC_EquipManager.cs:119-126 翅膀固定值基数
const WING_FLAT_PER_LEVEL = 25;  // 同上,翅膀每级 +25
const WING_EXP_PER_LEVEL  = 3;   // :145-149 翅膀每级给经验倍率 +3%(整行覆盖研究16)
const QILU_COST_BASE      = 10;  // lianqi.ts:72-76 / yingling-output.ts:2157 器鼎每档消耗基数
const QILU_TIER_SIZE      = 5;   // 每 5 级一档

// 属性全集:PropertyTypeEnum.cs:6-26 的 18 个枚举值,按枚举顺序排列,一个都不省略.
// 低级(基础)RandomBaseProperty = 攻击/防御/生命/无视防御(Character_NPC.cs:52-58);
// 高级 RandomMaxProperty = 命中/闪避/暴击/抗暴/暴伤/连击/反击/伤害加成/伤害减免(Character_NPC.cs:60-71).
export interface AllProperties {
  atk:            number; // 0  ATK 攻击[低级]
  def:            number; // 1  DEF 防御[低级]
  hp:             number; // 2  HP 生命[低级]
  speed:          number; // 3  Speed 速度
  mingZhong:      number; // 4  MingZhong 命中[高级]
  shanBi:         number; // 5  ShanBi 闪避[高级]
  baoJi:          number; // 6  BaoJi 暴击[高级]
  baoJiResist:    number; // 7  BaoJi_Resist 抗暴[高级]
  baoJiDamage:    number; // 8  BaoJi_Damage 暴伤[高级]
  lianJi:         number; // 9  LianJi 连击[高级]
  fanJi:          number; // 10 FanJi 反击[高级]
  recovery:       number; // 11 Recovery 恢复
  xiXie:          number; // 12 XiXie 吸血
  damageAddition: number; // 13 DamageAddition 伤害加成[高级]
  damageReduce:   number; // 14 DamageReduce 伤害减免[高级]
  ignoreDef:      number; // 15 Igonore_DEF 无视防御/穿透[低级]
  returnDamage:   number; // 16 RetrunDamage 反弹伤害
  lucky:          number; // 17 Lucky 幸运
}

export interface HantieToZhanliResult {
  equipSum:          AllProperties; // 最后获得的 10 件装备的所有属性和(10 槽各 1 件,按最终炼器等级)
  wingSum:           AllProperties; // 翅膀附加的所有加成属性(按制造次数累计)
  total:             AllProperties; // 上面两块逐属性相加
  craftCount:        number;        // 制造次数
  finalLianqiLevel:  number;        // 最终炼器等级
  finalLianqiExp:    number;        // 最终等级内剩余经验
  finalQidingLevel:  number;        // 最终器鼎等级
  hantieUsed:        number;        // 消耗寒铁
  hantieLeft:        number;        // 剩余寒铁
  wucaiUsed:         number;        // 消耗五彩神石
  wucaiLeft:         number;        // 剩余五彩神石
}

/**
 * 投入寒铁(配合五彩神石、翅膀等级)后的完整制造模拟,返回 10 件装备与翅膀的全部 18 项属性.
 * 词条(高级/低级特殊属性)按用户要求暂不计算,相关属性一律为 0,但字段全部保留.
 * @param hantie 投入的寒铁数量
 * @param wingLevel 翅膀 Wing_CB_2 印记等级(0 = 没翅膀)
 * @param wucaiStones 投入的五彩神石数量(把器鼎从 Lv.1700 继续升级;默认 0 即保持 1700)
 */
export function hantieTozhanli (
  hantie: number,
  wingLevel: number,
  wucaiStones = 0
): HantieToZhanliResult {
  // ① 器鼎:从 Lv.1700 起用五彩神石逐级往上顶(lianqi.ts:72-76,研究20 满 -50%)
  const qiluCost = (level: number): number => Math.max(
    1,
    Math.round(QILU_COST_BASE * (Math.trunc((level - 1) / QILU_TIER_SIZE) + 1)
      * (PERCENT_BASE - RESEARCH_20_WUCAI_REDUCE) / PERCENT_BASE)
  );
  let qidingLevel = QIDING_START_LEVEL;
  let wucaiLeft = wucaiStones;
  while (wucaiLeft >= qiluCost(qidingLevel)) {
    wucaiLeft -= qiluCost(qidingLevel);
    qidingLevel += 1;
  }

  // ② 寒铁单次消耗(PropHelper.cs:487-505 GetRemandMat):先 200 万封顶 → 研究15 满 -50% 四舍五入 → 下限 1 → 再 200 万封顶
  // Cul_Percent_ToInt 用 MidpointRounding.AwayFromZero(ToolClass.cs:107-117),对正数等价于 Math.round
  const hantieCost = (level: number): number => {
    const capped = Math.min(MAKE_EQUIP_COST_CAP,level);
    const discounted = Math.round(capped * (PERCENT_BASE - RESEARCH_15_HANTIE_REDUCE) / PERCENT_BASE);
    return Math.max(1,Math.min(MAKE_EQUIP_COST_CAP,discounted));
  };

  // 每级升级门槛(PropHelper.cs:467-476 GetLianQiLevelUpExp)
  const LV_10 = 10; const LV_20 = 20; const LV_30 = 30; const LV_40 = 40;
  const LV_10_PER = 20; const LV_20_BASE = 200; const LV_20_PER = 50;
  const LV_30_BASE = 700; const LV_30_PER = 100;
  const LV_40_BASE = 1700; const LV_40_PER = 200;
  const LV_40_PLUS_BASE = 3700; const LV_40_PLUS_PER = 300;
  const needExp = (level: number): number => {
    if (level <= LV_10) {return level * LV_10_PER;}
    if (level < LV_20) {return LV_20_BASE + LV_20_PER * (level - LV_10);}
    if (level < LV_30) {return LV_30_BASE + LV_30_PER * (level - LV_20);}
    if (level >= LV_40) {return LV_40_PLUS_BASE + LV_40_PLUS_PER * (level - LV_40);}
    return LV_40_BASE + LV_40_PER * (level - LV_30);
  };

  // ③ 经验倍率:翅膀 >0 时整行覆盖研究16(NPC_EquipManager.cs:141-149),不是叠加
  const expScale = wingLevel > 0
    ? (PERCENT_BASE + WING_EXP_PER_LEVEL * wingLevel) / PERCENT_BASE
    : (PERCENT_BASE + RESEARCH_16_EXP_ADD) / PERCENT_BASE;

  // ④ 逐级模拟制造:每次按当时的炼器等级扣寒铁、结算经验、连升等级
  let lianqiLevel = LIANQI_START_LEVEL;
  let lianqiExp = LIANQI_START_EXP;
  let hantieLeft = hantie;
  let craftCount = 0;
  while (hantieLeft >= hantieCost(lianqiLevel)) {
    hantieLeft -= hantieCost(lianqiLevel);
    craftCount += 1;
    lianqiExp += (CRAFT_EXP_BASE + lianqiLevel) * expScale;
    while (lianqiExp >= needExp(lianqiLevel)) {
      lianqiExp -= needExp(lianqiLevel);
      lianqiLevel += 1;
    }
  }

  // ⑤ 单件装备主属性(品质固定 15);源码 :399-401 把 HP/DEF 覆盖成与 ATK 相同的 value,故三条数值相同
  const additionPct = RESEARCH_18_EQUIP_ADD + qidingLevel + lianqiLevel; // GetEqui_PropertyAddition(研究18 + 器鼎 + 炼器)
  const equipPropMul = (additionPct + PERCENT_BASE) / PERCENT_BASE;       // :395 num
  const singleValue = (EQUIP_BASE + EQUIP_PER_LEVEL * lianqiLevel
    + EQUIP_PINZHI_PER_LEVEL * EQUIP_PINZHI * lianqiLevel)
    * (EQUIP_PINZHI_FACTOR * EQUIP_PINZHI + 1) * EQUIP_RANDOM_AVG * equipPropMul;
  const slotTotal = singleValue * EQUIP_SLOT_COUNT; // 10 槽各 1 件

  // ⑥ 翅膀:每造 1 件给 HP/ATK/DEF/无视防御 各 +(75 + 25×等级),按制造次数累计(源码 if num>0 才生效)
  const wingFlat = wingLevel > 0 ? craftCount * (WING_FLAT_BASE + WING_FLAT_PER_LEVEL * wingLevel) : 0;

  // 18 项属性全部列出,一个都不去除;词条暂不算的项置 0
  const equipSum: AllProperties = {
    atk: slotTotal, def: slotTotal, hp: slotTotal,
    speed: 0, mingZhong: 0, shanBi: 0, baoJi: 0, baoJiResist: 0,
    baoJiDamage: 0, lianJi: 0, fanJi: 0, recovery: 0, xiXie: 0,
    damageAddition: 0, damageReduce: 0, ignoreDef: 0, returnDamage: 0, lucky: 0
  };
  const wingSum: AllProperties = {
    atk: wingFlat, def: wingFlat, hp: wingFlat, ignoreDef: wingFlat,
    speed: 0, mingZhong: 0, shanBi: 0, baoJi: 0, baoJiResist: 0,
    baoJiDamage: 0, lianJi: 0, fanJi: 0, recovery: 0, xiXie: 0,
    damageAddition: 0, damageReduce: 0, returnDamage: 0, lucky: 0
  };
  const total: AllProperties = {
    atk:            equipSum.atk + wingSum.atk,
    def:            equipSum.def + wingSum.def,
    hp:             equipSum.hp + wingSum.hp,
    speed:          equipSum.speed + wingSum.speed,
    mingZhong:      equipSum.mingZhong + wingSum.mingZhong,
    shanBi:         equipSum.shanBi + wingSum.shanBi,
    baoJi:          equipSum.baoJi + wingSum.baoJi,
    baoJiResist:    equipSum.baoJiResist + wingSum.baoJiResist,
    baoJiDamage:    equipSum.baoJiDamage + wingSum.baoJiDamage,
    lianJi:         equipSum.lianJi + wingSum.lianJi,
    fanJi:          equipSum.fanJi + wingSum.fanJi,
    recovery:       equipSum.recovery + wingSum.recovery,
    xiXie:          equipSum.xiXie + wingSum.xiXie,
    damageAddition: equipSum.damageAddition + wingSum.damageAddition,
    damageReduce:   equipSum.damageReduce + wingSum.damageReduce,
    ignoreDef:      equipSum.ignoreDef + wingSum.ignoreDef,
    returnDamage:   equipSum.returnDamage + wingSum.returnDamage,
    lucky:          equipSum.lucky + wingSum.lucky
  };

  return {
    equipSum,
    wingSum,
    total,
    craftCount,
    finalLianqiLevel: lianqiLevel,
    finalLianqiExp:   lianqiExp,
    finalQidingLevel: qidingLevel,
    hantieUsed:       hantie - hantieLeft,
    hantieLeft,
    wucaiUsed:        wucaiStones - wucaiLeft,
    wucaiLeft
  };
}

// 通用函数:给定「每材料数量 quantity」(默认 1,即每一个),返回各材料消耗的钱币(含 30% 研究减免,保留小数点,不取整).
// 直接基于已写死的 MATERIAL_COST_PER_UNIT(单价 × 0.7) 推算,无需 COIN_RATE 中间量.
export function materialCost (quantity = 1): Record<string,number> {
  const result: Record<string,number> = {钱币: quantity};  // 钱币本身:1 钱币 = 1 钱币
  for (const [name,unitCost] of Object.entries(MATERIAL_COST_PER_UNIT)) {
    result[name] = unitCost * quantity;
  }
  return result;
}
export function research (): ResearchReduce {
  return {
    cost:           30_9665,
    hanTieReduce:   50,
    historyReduce:  20,
    lingWenReduce:  50,
    poJingReduce:   30,
    qiangHuaReduce: 50,
    scrollReduce:   20,
    shopReduce:     30,
    wucaiReduce:    50,
    yuLiReduce:     30
  };
}

// ============================== 6. 圣兽(地图材料,2 维) ==============================
// ShengShou_Record.cs:49-57 GetStrengthRemand(消耗=min(50000,10+10L)) / :18-21 GetNextAddition(每级两基础各+20+50L)
// 升级一次消耗(地图材料) = min(50000, 10 + 10*L) ← 这就是"升级一次要多少资源"
// 升级一次每维提升 = 20 + 50*L ← 两基础属性各加这么多(合计 ×2)
export function shengShou (level: number): SystemGain {
  const costPerLevelUp = Math.min(50000,10 + 10 * level); // 升级一次要多少地图材料(≥4999级封顶5万)
  const atk = 20 + 50 * level;                      // 每维提升 = 20+50L
  return {
    atk,
    costPerLevelUp,
    dims:      2,
    level,
    peratk:    atk / costPerLevelUp,
    resource:  "地图材料",
    system:    "圣兽",
    totalGain: atk * 2
  };
}

// ============================== 7. 图鉴(图鉴道具,4 维) ==============================
// TuJianData_Record.cs:30-51 升级经验 Exp(L) = 10 + Σ_{i=0}^{L-1}(⌊i/10⌋+1)*10
// 每个图鉴道具 = 200 经验(配置值,PropEffect_AddTuJianEXP.cs),故升级一次需 ⌈Exp(L)/200⌉ 个
// :67-76 LevelUp_AddProperty(每级四维各+50+15L)
export function tuJian (level: number): SystemGain {
  let exp = 10;                                              // 升级到 level 所需累计经验
  for (let i = 0; i < level; i++) {exp += (Math.floor(i / 10) + 1) * 10;}
  const costPerLevelUp = Math.ceil(exp / 200);               // 升级一次要多少个图鉴道具
  const atk = 50 + 15 * level;                       // 每维提升 = 50+15L
  return {
    atk,
    costPerLevelUp,
    dims:      4,
    level,
    peratk:    atk / costPerLevelUp,
    resource:  "图鉴道具",
    system:    "图鉴",
    totalGain: atk * 4
  };
}

// ============================== 1. 御灵师(御力,4 维) ==============================
// GameRecorder.cs:659-669 CulLevel_Up_Remand(消耗) / :697-703 ShowAddition(每级四维各+L*250)
// 升级一次消耗(御力) = 100*tens*(tens+1) + 20*(tens+1)*(L%10),tens = ⌊L/10⌋
// 升级一次每维提升 = L * 250
export function yuLing (level: number): SystemGain {
  const tens = Math.floor(level / 10);
  const costPerLevelUp = 100 * tens * (tens + 1) + 20 * (tens + 1) * (level % 10); // 升级一次要多少御力
  const atk = level * 250;                                                  // 每维提升 = L*250
  return {
    atk,
    costPerLevelUp,
    dims:      4,
    level,
    peratk:    atk / costPerLevelUp,
    resource:  "御力",
    system:    "御灵师",
    totalGain: atk * 4
  };
}

// ============================== 5. 阵法(灵纹,4 维) ==============================
// ZhenFaRecorder.cs:34-40 GetLevlUPRemand(消耗=L*20) / :82-91 LevelUp_AddProperty(每级四维各+200+35L)
// 升级一次消耗(灵纹) = L * 20
// 升级一次每维提升 = 200 + 35*L
export function zhenFa (level: number): SystemGain {
  const costPerLevelUp = level * 20;   // 升级一次要多少灵纹
  const atk = 200 + 35 * level; // 每维提升 = 200+35L
  return {
    atk,
    costPerLevelUp,
    dims:      4,
    level,
    peratk:    atk / costPerLevelUp,
    resource:  "灵纹",
    system:    "阵法",
    totalGain: atk * 4
  };
}

/**
 * 由累计炼器经验反推制造(炼器)等级.
 * 口径:每级门槛 = PropHelper.GetLianQiLevelUpExp(反编译 :467-476),与 NPC_EquipManager.AddLianQiExp(:155-166)
 * 的 while 升级循环,yingling-output.ts:796-801 一致:从 Lv.1 起,经验够当前级门槛就扣掉门槛并升 1 级.
 * @param exp 累计获得的炼器经验(从 Lv.1 起算的总经验,已含研究16/翅膀加成后的实际入账值)
 * @returns 该经验能达到的制造等级(经验不足升 1 级时返回 1)
 */
export function zhizaoLevelUp (exp: number): number {

  // 每级门槛分段公式的全部固定值(GetLianQiLevelUpExp :467-476)
  const LV_10_PER       = 20;   // L≤10: L × 20
  const LV_20_BASE      = 200;  // 10<L<20: 200 + 50 × (L−10)
  const LV_20_PER       = 50;
  const LV_30_BASE      = 700;  // 20≤L<30: 700 + 100 × (L−20)
  const LV_30_PER       = 100;
  const LV_40_BASE      = 1700; // 30≤L<40: 1700 + 200 × (L−30)
  const LV_40_PER       = 200;
  const LV_40_PLUS_BASE = 3700; // L≥40: 3700 + 300 × (L−40)
  const LV_40_PLUS_PER  = 300;

  // 分段边界等级
  const LV_10 = 10;
  const LV_20 = 20;
  const LV_30 = 30;
  const LV_40 = 40;
  const needExp = (level: number): number => {
    if (level <= LV_10) {return level * LV_10_PER;}
    if (level < LV_20) {return LV_20_BASE + LV_20_PER * (level - LV_10);}
    if (level < LV_30) {return LV_30_BASE + LV_30_PER * (level - LV_20);}
    if (level >= LV_40) {return LV_40_PLUS_BASE + LV_40_PLUS_PER * (level - LV_40);}
    return LV_40_BASE + LV_40_PER * (level - LV_30);
  };
  let level = 1;     // 初始等级(NPC_EquipManager 构造函数 LianQiLevel = 1)
  let remain = exp;  // 尚未消耗的累计经验
  while (remain >= needExp(level)) {
    remain -= needExp(level);
    level += 1;
  }
  return level;
}

