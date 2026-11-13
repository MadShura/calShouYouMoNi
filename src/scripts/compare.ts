/**
 * compare.ts — 同类对比(库函数版,不读取存档)
 * 每个养成系统的「等级 → 提升属性」公式都[直接写在对应函数体内](含中文注释 + 反编译源码出处),
 * 不再调用 game-formulas.ts 的黑盒函数,方便一眼看懂"升级一次要多少资源,加多少属性".
 * 传入"当前等级 level",返回对象描述的是"从 level 升到 level+1 这一级"的消耗与提升.
 * 例外:hantieTozhanli() 描述的是「投入寒铁 + 五彩神石 + 翅膀等级」后的完整制造模拟,不是单级对比,详见该函数注释.
 * 最后 materialCost() 给出「每一个材料消耗多少钱币」的兑换表(资源转换表与数值全部写在本文件内,不 import 其他文件).
 */
// ============================== 2. 装备强化(强化石,3 维) ==============================
// Equip_Using.cs:40-54 GetStrengthRemand(消耗=3+2L,先按研究25 减免取整,再在 L≥1000000 时 ×5)
// :19-22 GetNextAddition(每级三维各+10+10L);×5 分支在 Strength(:28-37)与 ComputeStrengthAddByLevel(:86-98),不在 GetNextAddition
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
  peratk:         number; // 资源效率:每 1 单位资源换到每维多少属性 = atk / costPerLevelUp
  resource:       string; // 消耗的资源名
  system:         string; // 系统名
  totalGain:      number; // [升级一次全维合计提升]= atk × dims
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

// ============================== 寒铁 → 战力(完整制造模拟,18 属性全量 + 词条百分比) ==============================
// 固定口径:研究全部点满(config/keji.json),初始炼器 Lv.1/经验 0,器鼎 Lv.1700,品质 15,10 槽各 1 件.
// 计算顺序:① 五彩神石把器鼎从 1700 继续往上顶 → 最终器鼎等级;
// ② 寒铁按源码逐级模拟制造 → 最终炼器等级 + 制造次数 + 熔炼强化石;
// ③ 10 件装备主属性按最终等级算;④ 翅膀加成按制造次数累计;
// ⑤ 每件装备固定带该槽全部 5 条词条(共 50 条):13 项固定值合并,5 项百分比单列.
// 本文件零 import;所有数值只取反编译源码与 config 导出,出处逐条标注.
// ---- 研究全满(固定值:config/keji.json 的 maxLevel × perLevel = 50) ----
const RESEARCH_15_HANTIE_REDUCE = 50; // id15 节衣缩食:寒铁消耗 -1%/级×50(keji.json:183-193)
const RESEARCH_16_EXP_ADD = 50; // id16 日积月累:炼器经验 +1%/级×50(keji.json:195-205)
const RESEARCH_18_EQUIP_ADD = 50; // id18 精益求精:装备属性 +1%/级×50(keji.json:219-229)
const RESEARCH_20_WUCAI_REDUCE = 50; // id20 省吃俭用:五彩神石 -1%/级×50(keji.json)
const RESEARCH_24_RONGLIAN_ADD = 50; // id24 聚沙成塔:熔炼强化石产出 +1%/级×50(keji.json:291-301)
const RESEARCH_25_STRENGTH_REDUCE = 50; // id25 精打细算:强化石消耗 -1%/级×50(keji.json:302-312)

// 研究22/23 是印记开关(>0 即生效):GetEqui_PropertyAddition 把 QiLu_Level / LianQiLevel 计进装备属性%(PropHelper.cs:424-438)
// ---- 固定口径 ----
const LIANQI_START_LEVEL = 1;      // NPC_EquipManager.cs:36-41 构造函数 LianQiLevel = 1
const LIANQI_START_EXP = 0;      // 同上,初始 LianQiExp = 0
const QIDING_START_LEVEL = 1700;   // 器鼎默认等级(品质概率表到此级 100% 品质 15)
const EQUIP_PINZHI = 15;     // 固定最高品质(config/equip-percent.json 最高档 pinzhi 15)
const EQUIP_SLOT_COUNT = 10;     // EquipType.cs:6-18 共 10 个槽位
const PERCENT_BASE = 100;    // 百分比基数

// ---- 装备主属性公式固定值(PropHelper.cs:395-405 GenerateEquip) ----
const EQUIP_BASE = 30;   // (30 + 25×L + 6×品质×L) 基础值
const EQUIP_PER_LEVEL = 25;   // 每级炼器 +25
const EQUIP_PINZHI_PER_LEVEL = 6;    // 品质×炼器等级 ×6
const EQUIP_PINZHI_FACTOR = 0.4;  // 品质系数 (0.4×品质 + 1)
const EQUIP_RANDOM_MIN = 1;    // Random.Range(1f, 1.1f) 下限
const EQUIP_RANDOM_MAX = 1.1;  // 上限(不含)
const EQUIP_RANDOM_AVG = (EQUIP_RANDOM_MIN + EQUIP_RANDOM_MAX) / 2; // 随机期望 1.05

// ---- 经验 / 翅膀 / 器鼎公式固定值 ----
const CRAFT_EXP_BASE = 2;   // PropHelper.cs:478-485 CulExp_Single = 2 + 炼器等级
const WING_FLAT_BASE = 75;  // NPC_EquipManager.cs:119-126 翅膀固定值基数
const WING_FLAT_PER_LEVEL = 25;  // 同上,翅膀每级 +25
const WING_EXP_PER_LEVEL = 3;   // :145-149 翅膀每级给经验倍率 +3%(整行覆盖研究16)
const QILU_COST_BASE = 10;  // lianqi.ts:72-76 / yingling-output.ts:2157 器鼎每档消耗基数
const QILU_TIER_SIZE = 5;   // 每 5 级一档

// ---- 分解(熔炼)→ 强化石固定值(GameRecorder.cs:386-407 GetRongLianEnding / PropHelper.cs:324-335 RongLianEuip) ----
const RONGLIAN_LEVEL_DIVISOR = 5;   // 每件贡献 ⌊装备等级/5⌋ + 品质(装备等级 = 制造当时的炼器等级);强化石 PropID=5(config/names.json:7)

// 整批求和后一次性乘 (100+研究24)/100,只取整一次(Cul_Percent_ToInt,ToolClass.cs:113-117,正数等价于 Math.round)
// ---- 强化提升 / 消耗固定值(Equip_Using.cs:19-22,28-37,40-54,62-98,100-122,125-163) ----
const STRENGTH_COST_BASE = 3;    // 每级消耗 3 + 2L 颗强化石
const STRENGTH_COST_PER_LEVEL = 2;
const STRENGTH_ADD_BASE = 10;   // 每级 HP/ATK/DEF 各 +(10 + 10L) 固定值(L 从 0 起算)
const STRENGTH_ADD_PER_LEVEL = 10;
const STRENGTH_HIGH_THRESHOLD = 100_0000; // L≥100 万时该级消耗与提升各 ×5
const STRENGTH_HIGH_MULTIPLIER = 5;
const STRENGTH_COST_CAP = 2147483646; // 消耗上限(Equip_Using.cs:107,123)
const STRENGTH_COST_MIN = 1;          // 批量路径下限 1(:79-82)

// 强化只加 HP/ATK/DEF 三条固定值,无穿透/速度/百分比(:159-161)
// 属性全集:PropertyTypeEnum.cs:6-26 的 18 个枚举值,按枚举顺序排列,一个都不省略.
// 低级(基础)RandomBaseProperty = 攻击/防御/生命/无视防御(Character_NPC.cs:52-58);
// 高级 RandomMaxProperty = 命中/闪避/暴击/抗暴/暴伤/连击/反击/伤害加成/伤害减免(Character_NPC.cs:60-71).
export interface AllProperties {
  atk:            number; // 0 ATK 攻击[低级]
  baoJi:          number; // 6 BaoJi 暴击[高级]
  baoJiDamage:    number; // 8 BaoJi_Damage 暴伤[高级]
  baoJiResist:    number; // 7 BaoJi_Resist 抗暴[高级]
  damageAddition: number; // 13 DamageAddition 伤害加成[高级]
  damageReduce:   number; // 14 DamageReduce 伤害减免[高级]
  def:            number; // 1 DEF 防御[低级]
  fanJi:          number; // 10 FanJi 反击[高级]
  hp:             number; // 2 HP 生命[低级]
  ignoreDef:      number; // 15 Igonore_DEF 无视防御/穿透[低级]
  lianJi:         number; // 9 LianJi 连击[高级]
  lucky:          number; // 17 Lucky 幸运
  mingZhong:      number; // 4 MingZhong 命中[高级]
  recovery:       number; // 11 Recovery 恢复
  returnDamage:   number; // 16 RetrunDamage 反弹伤害
  shanBi:         number; // 5 ShanBi 闪避[高级]
  speed:          number; // 3 Speed 速度
  xiXie:          number; // 12 XiXie 吸血
}

// 词条候选池:每槽固定 5 条(用户口径:每件装备默认都有该槽全部 5 条,不按品质/随机抽取).
// 来自 MayEquipPropertyDic(PropHelper.cs:69-148),按 EquipType.cs 的 0~9 顺序排列.
// 词条值固定 = 品质 15(PropHelper.cs:418 的 Params_2 = PinZhi, Bool_Value = true).
const EQUIP_CI_TIAO_POOL: readonly (readonly (keyof AllProperties)[])[] = [
  ["atk","baoJi","baoJiDamage","damageAddition","ignoreDef"],  // 0 Weapon 武器
  ["def","hp","shanBi","baoJiResist","returnDamage"],          // 1 Cloth 衣服
  ["def","hp","shanBi","damageReduce","lucky"],                // 2 Cape 披风
  ["def","hp","mingZhong","baoJiResist","recovery"],           // 3 Belt 腰带
  ["atk","def","baoJiDamage","lianJi","damageAddition"],       // 4 HuWan 护腕
  ["atk","def","hp","mingZhong","fanJi"],                      // 5 XiangLian 项链
  ["atk","def","hp","mingZhong","lucky"],                      // 6 GuaZhui 挂坠
  ["atk","hp","xiXie","ignoreDef","lucky"],                    // 7 JieZhi 戒指
  ["atk","def","hp","speed","ignoreDef"],                      // 8 XieZi 鞋子
  ["atk","def","hp","baoJi","damageReduce"]                    // 9 HuFu 护符
];

// 18 项里走「真百分比」的 5 项(property.json 中 percent=0):
// ChangeValue 走 PercentAddition += 15(BattleData_Recorder.cs:50-59),GetFinal 再乘 (100+百分比)/100(:34).
// 其余 13 项在 property.json 里 percent=1,ChangeValue 直接 Base_Value += 15(:39-49),GetFinal 不乘百分比(:25-33),
// 即它们虽然 UI 显示 "15%",源码实际是每条 +15 固定值.
const CI_TIAO_PERCENT_KEYS = ["atk","def","hp","ignoreDef","speed"] as const;
type CiTiaoPercentKey = typeof CI_TIAO_PERCENT_KEYS[number];
const isCiTiaoPercentKey = (key: keyof AllProperties): key is CiTiaoPercentKey => key === "atk" || key === "def" || key === "hp" || key === "speed" || key === "ignoreDef";

// 单层返回:18 项固定值(与 AllProperties 同名同序)+ 5 项词条百分比 + 过程量,全部平铺,不嵌套.
// 固定值只加固定值(装备主属性 + 翅膀 + 高级词条),百分比只放百分比,两者不互相换算.
export interface HantieToZhanliResult extends AllProperties {
  atkPercent:       number; // 攻击词条百分比合计:7 槽 × 15 = 105(源码 PercentAddition,不是固定值)
  craftCount:       number; // 制造次数
  defPercent:       number; // 防御词条百分比合计:8 槽 × 15 = 120
  finalLianqiExp:   number; // 最终等级内剩余经验
  finalLianqiLevel: number; // 最终炼器等级
  finalQidingLevel: number; // 最终器鼎等级
  hantieLeft:       number; // 剩余寒铁
  hantieUsed:       number; // 消耗寒铁
  hpPercent:        number; // 生命词条百分比合计:8 槽 × 15 = 120
  ignoreDefPercent: number; // 穿透词条百分比合计:3 槽 × 15 = 45
  ronglianCount:    number; // 被熔炼的装备件数
  ronglianStones:   number; // 制造数 − 10 件(留身上)熔炼出的强化石总数
  speedPercent:     number; // 速度词条百分比合计:1 槽 × 15 = 15
  wucaiLeft:        number; // 剩余五彩神石
  wucaiUsed:        number; // 消耗五彩神石
}

/**
 * 投入寒铁(配合五彩神石,翅膀等级)后的完整制造模拟,单层返回 18 项固定值 + 5 项词条百分比.
 * 词条口径:每件装备固定带该槽全部 5 条(共 50 条),词条值 = 品质 15.
 * - 攻/防/血/速/穿透 这 5 项在源码里走 PercentAddition(真百分比),单独放在 atkPercent 等字段,不乘进固定值;
 * - 其余 13 项在源码里走 Base_Value += 15(固定值,UI 显示的 "%" 只是文案),直接加到同名属性.
 * 固定值 = 装备主属性(10 槽各 1 件) + 翅膀固定值(按制造次数累计) + 高级词条固定值.
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
  const expScale = (wingLevel > 0 ? PERCENT_BASE + WING_EXP_PER_LEVEL * wingLevel : PERCENT_BASE + RESEARCH_16_EXP_ADD) / PERCENT_BASE;

  // ④ 逐级模拟制造:每次按当时的炼器等级扣寒铁,结算经验,连升等级
  // 同时记录每件装备的等级(源码 GenrateRandomEquip 在 AddLianQiExp 之前,故装备等级 = 升级前的炼器等级)
  // 滑动窗口保留最后造的 10 件留身上;更早的每件计入熔炼:⌊等级/5⌋ + 品质(GameRecorder.cs:394)
  let lianqiLevel = LIANQI_START_LEVEL;
  let lianqiExp = LIANQI_START_EXP;
  let hantieLeft = hantie;
  let craftCount = 0;
  let ronglianSum = 0;    // 可熔炼装备的 ⌊等级/5⌋+品质 逐件累计
  let ronglianCount = 0;  // 被熔炼件数
  const wornLevels: number[] = []; // 最后造的 10 件(留身上,不熔炼)
  while (hantieLeft >= hantieCost(lianqiLevel)) {
    hantieLeft -= hantieCost(lianqiLevel);
    craftCount += 1;
    wornLevels.push(lianqiLevel);
    if (wornLevels.length > EQUIP_SLOT_COUNT) {
      const older = wornLevels.shift() ?? 0;
      ronglianSum += Math.trunc(older / RONGLIAN_LEVEL_DIVISOR) + EQUIP_PINZHI;
      ronglianCount += 1;
    }
    lianqiExp += (CRAFT_EXP_BASE + lianqiLevel) * expScale;
    while (lianqiExp >= needExp(lianqiLevel)) {
      lianqiExp -= needExp(lianqiLevel);
      lianqiLevel += 1;
    }
  }

  // 整批求和后一次性乘 (100+研究24)/100,只取整一次(GetRongLianEnding :401-402)
  const ronglianStones = Math.round(ronglianSum * (PERCENT_BASE + RESEARCH_24_RONGLIAN_ADD) / PERCENT_BASE);

  // ⑤ 单件装备主属性(品质固定 15);源码 :399-401 把 HP/DEF 覆盖成与 ATK 相同的 value,故三条数值相同
  const additionPct = RESEARCH_18_EQUIP_ADD + qidingLevel + lianqiLevel; // GetEqui_PropertyAddition(研究18 + 器鼎 + 炼器)
  const equipPropMul = (additionPct + PERCENT_BASE) / PERCENT_BASE;       // :395 num
  const singleValue = (EQUIP_BASE + EQUIP_PER_LEVEL * lianqiLevel
    + EQUIP_PINZHI_PER_LEVEL * EQUIP_PINZHI * lianqiLevel)
    * (EQUIP_PINZHI_FACTOR * EQUIP_PINZHI + 1) * EQUIP_RANDOM_AVG * equipPropMul;
  const slotTotal = singleValue * EQUIP_SLOT_COUNT; // 10 槽各 1 件

  // ⑥ 翅膀:每造 1 件给 HP/ATK/DEF/无视防御 各 +(75 + 25×等级),按制造次数累计(源码 if num>0 才生效)
  const wingFlat = wingLevel > 0 ? craftCount * (WING_FLAT_BASE + WING_FLAT_PER_LEVEL * wingLevel) : 0;

  // ⑦ 词条:每件装备固定带该槽全部 5 条(用户口径),词条值 = 品质 15;10 槽各 1 件 → 共 50 条.
  // 固定值类 13 项直接累加到同名属性;百分比类 5 项单独累加到 xxxPercent,不与固定值相加.
  const ciTiaoFixed: AllProperties = {
    atk:            0,
    baoJi:          0,
    baoJiDamage:    0,
    baoJiResist:    0,
    damageAddition: 0,
    damageReduce:   0,
    def:            0,
    fanJi:          0,
    hp:             0,
    ignoreDef:      0,
    lianJi:         0,
    lucky:          0,
    mingZhong:      0,
    recovery:       0,
    returnDamage:   0,
    shanBi:         0,
    speed:          0,
    xiXie:          0
  };
  const ciTiaoPercent: Record<CiTiaoPercentKey,number> = {atk: 0,def: 0,hp: 0,ignoreDef: 0,speed: 0};
  for (const pool of EQUIP_CI_TIAO_POOL) {
    for (const key of pool) {
      if (isCiTiaoPercentKey(key)) {
        ciTiaoPercent[key] += EQUIP_PINZHI;
      } else {
        ciTiaoFixed[key] += EQUIP_PINZHI;
      }
    }
  }

  // ⑧ 单层返回:18 项固定值 = 装备主属性 + 翅膀固定值 + 高级词条固定值(攻/防/血/穿透词条是百分比,不进固定值)
  return {
    atk:              slotTotal + wingFlat,
    atkPercent:       ciTiaoPercent.atk,
    baoJi:            ciTiaoFixed.baoJi,
    baoJiDamage:      ciTiaoFixed.baoJiDamage,
    baoJiResist:      ciTiaoFixed.baoJiResist,
    craftCount,
    damageAddition:   ciTiaoFixed.damageAddition,
    damageReduce:     ciTiaoFixed.damageReduce,
    def:              slotTotal + wingFlat,
    defPercent:       ciTiaoPercent.def,
    fanJi:            ciTiaoFixed.fanJi,
    finalLianqiExp:   lianqiExp,
    finalLianqiLevel: lianqiLevel,
    finalQidingLevel: qidingLevel,
    hantieLeft,
    hantieUsed:       hantie - hantieLeft,
    hp:               slotTotal + wingFlat,
    hpPercent:        ciTiaoPercent.hp,
    ignoreDef:        wingFlat, // 装备主属性不含穿透,只有翅膀给固定值;穿透词条是百分比,见 ignoreDefPercent
    ignoreDefPercent: ciTiaoPercent.ignoreDef,
    lianJi:           ciTiaoFixed.lianJi,
    lucky:            ciTiaoFixed.lucky,
    mingZhong:        ciTiaoFixed.mingZhong,
    recovery:         ciTiaoFixed.recovery,
    returnDamage:     ciTiaoFixed.returnDamage,
    ronglianCount,
    ronglianStones,
    shanBi:           ciTiaoFixed.shanBi,
    speed:            0,
    speedPercent:     ciTiaoPercent.speed,
    wucaiLeft,
    wucaiUsed:        wucaiStones - wucaiLeft,
    xiXie:            ciTiaoFixed.xiXie
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

/**
 * 强化一个装备:全部强化石投入单个槽,从 Lv.0 起逐级模拟扣石头,直到不够升下一级.
 * 源码 CulMaxStrengthTimes(Equip_Using.cs:100-122) + StrengthBatch(:125-163).
 * @param stones 投入的强化石数量
 * @returns 18 项属性(HP/ATK/DEF 各为累计固定值,其余 15 项为 0)
 */
export function qianghuazhiTozhanli1 (stones: number): AllProperties {
  return strengthProps(simulateStrengthSlot(stones).add);
}

/**
 * 平均强化(模拟源码自动强化多次按下后的平均结果):石头平分 10 份,每槽各自逐级升;
 * 未均分的零头集中给其中一个槽,从该槽当前等级继续升到耗尽.
 * 源码 AutoStrength(NPC_EquipManager.cs:275-289)每次挑 CurStrength 最低的槽批量升,多次按下等价于 10 槽趋于同级.
 * @param stones 投入的强化石数量
 * @returns 18 项属性(HP/ATK/DEF 各为 10 槽累计固定值,其余 15 项为 0)
 */
export function qianghuazhiTozhanli2 (stones: number): AllProperties {
  const perSlot = Math.floor(stones / EQUIP_SLOT_COUNT);   // 每槽平分到的石头
  const slot = simulateStrengthSlot(perSlot);              // 10 槽同级,只需算一次
  const zeroHead = stones - perSlot * EQUIP_SLOT_COUNT     // 未均分完的零头
    + slot.left * EQUIP_SLOT_COUNT;                       // 各槽升不动后剩下的石头

  // 零头集中给一个槽,从它当前等级继续升到耗尽
  const extra = simulateStrengthSlot(zeroHead,slot.level);
  return strengthProps(slot.add * EQUIP_SLOT_COUNT + extra.add);
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
  const LV_10_PER = 20;   // L≤10: L × 20
  const LV_20_BASE = 200;  // 10<L<20: 200 + 50 × (L−10)
  const LV_20_PER = 50;
  const LV_30_BASE = 700;  // 20≤L<30: 700 + 100 × (L−20)
  const LV_30_PER = 100;
  const LV_40_BASE = 1700; // 30≤L<40: 1700 + 200 × (L−30)
  const LV_40_PER = 200;
  const LV_40_PLUS_BASE = 3700; // L≥40: 3700 + 300 × (L−40)
  const LV_40_PLUS_PER = 300;

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

// 一个槽从 startLevel 起,用 stones 颗强化石逐级模拟升级,返回累计每维加成 / 最终等级 / 剩余石头
function simulateStrengthSlot (
  stones: number,
  startLevel = 0
): {add: number; left: number; level: number} {
  let left = stones;
  let level = startLevel;
  let add = 0;
  while (level < STRENGTH_COST_CAP) {
    const cost = strengthCost(level);
    if (left < cost) {break;}
    left -= cost;
    add += strengthAdd(level);
    level += 1;
  }
  return {add,left,level};
}

// 单个槽从 level 升一级,HP/ATK/DEF 每条固定值的增量
function strengthAdd (level: number): number {
  const add = STRENGTH_ADD_BASE + STRENGTH_ADD_PER_LEVEL * level;
  return level >= STRENGTH_HIGH_THRESHOLD ? add * STRENGTH_HIGH_MULTIPLIER : add;
}

// ============================== 强化石 → 战力(18 属性全量) ==============================
// 源码 Equip_Using.cs:62-84 ComputeStrengthCostByLevel / :86-98 ComputeStrengthAddByLevel / :100-122 CulMaxStrengthTimes
// 每级消耗:⌊(3+2L) × (100−研究25)/100⌋(四舍五入) → L≥100万 再 ×5 → 上下限;每级提升:10+10L,L≥100万 ×5
// 单个槽在 level 级时的强化石消耗
function strengthCost (level: number): number {
  const base = STRENGTH_COST_BASE + STRENGTH_COST_PER_LEVEL * level;
  let cost = Math.round(Math.min(STRENGTH_COST_CAP,base)
    * (PERCENT_BASE - RESEARCH_25_STRENGTH_REDUCE) / PERCENT_BASE);
  if (level >= STRENGTH_HIGH_THRESHOLD) {
    cost *= STRENGTH_HIGH_MULTIPLIER;
  }
  return Math.max(STRENGTH_COST_MIN,Math.min(STRENGTH_COST_CAP,cost));
}

// 把「每维累计固定值」铺成 18 项属性:只有 HP/ATK/DEF 三条有值,其余 15 项为 0(一个都不省略)
function strengthProps (add: number): AllProperties {
  return {
    atk:            add,
    baoJi:          0,
    baoJiDamage:    0,
    baoJiResist:    0,
    damageAddition: 0,
    damageReduce:   0,
    def:            add,
    fanJi:          0,
    hp:             add,
    ignoreDef:      0,
    lianJi:         0,
    lucky:          0,
    mingZhong:      0,
    recovery:       0,
    returnDamage:   0,
    shanBi:         0,
    speed:          0,
    xiXie:          0
  };
}