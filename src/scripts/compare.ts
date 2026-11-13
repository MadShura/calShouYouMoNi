/**
 * compare.ts — 同类对比(库函数版,不读取存档)
 * 每个养成系统的「等级 → 提升属性」公式都[直接写在对应函数体内](含中文注释 + 反编译源码出处),
 * 不再调用 game-formulas.ts 的黑盒函数,方便一眼看懂"升级一次要多少资源,加多少属性".
 * 传入"当前等级 level",返回对象描述的是"从 level 升到 level+1 这一级"的消耗与提升.
 * 例外:makeEquip() 描述的是"造出 1 件装备"这一次操作(寒铁消耗按当前炼器等级计),不是"升一级",详见该函数 return 处注释.
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
  peratk:         number; // 资源效率:每 1 单位资源换到每维多少属性 = atk / costPerLevelUp
  resource:       string; // 消耗的资源名
  system:         string; // 系统名
  totalGain:      number; // [升级一次全维合计提升]= atk × dims
  // [仅 makeEquip 有]每造出 1 件装备额外获得的内容;其它养成系统没有这一项,故声明为可选
  per?: {
    atk:       number; // 翅膀(Wing_CB_2)每造一件给的固定攻击(炼器等级 >999 才计入)
    ignoreDef: number; // 翅膀每造一件给的无视防御,源码中与 atk 数值相同
    zhizaoExp: number; // 每造一件装备获得的炼器经验(已含研究16/翅膀加成)
  };
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

// 制作装备=生成一件装备,计算该装备的主攻击数值(含每次制造的翅膀固定加成).
export function makeEquip (
  lianqiLevel: number,            // 炼器等级(= 升一次炼器要多少寒铁)
  qidingLevel = 1700,    // 器鼎等级(决定新装备品质期望;研究22 把器鼎等级计进装备属性,无上限) 默认1700级器鼎
  lianqiwingLevel = 0               // 印记 Wing_CB_2(Mark 76)等级:每次制造给人物固定 +(75 + 25×等级) 到 HP/ATK/DEF/无视防御
): SystemGain {

  // 单件主攻击(含随机期望 EQUIP_RANDOM_AVG):见上方常量注释中的公式
  const atk = (30 // 基础固定值 30
    + 25 * lianqiLevel // 每级炼器 +25
    + 6 * 15 * lianqiLevel)  // 品质×炼器等级 ×6 品质最高是 15
    * (0.4 * 15 + 1)  // 品质系数:(0.4×品质 + 1) 品质最高是 15
    * 1.05  // 随机期望 1 - 1.1 也就是 1.05
    * (1 + (50     // 研究18:装备属性 +1%/级 默认 50
      + qidingLevel  // 研究22:器鼎等级计入(线性无上限,过1000仍持续放大装备主属性)
      + lianqiLevel) / 100); // 研究23:炼器等级计入
  const wingFlatAtk = 75    // 翅膀固定值基数
    + 20  // 翅膀每级 +25(到 HP/ATK/DEF/无视防御 各) 固定值
    * lianqiwingLevel;    // 翅膀每级
  const totalAtk = atk + wingFlatAtk;
  const costPerLevelUp = Math.max(1,Math.min(MAKE_EQUIP_COST_CAP,lianqiLevel)); // 造 1 件装备要多少寒铁 = 当前炼器等级(封顶 200 万,下限 1)
  const zhizaoExp = (2 // 固定值
    + lianqiLevel) // 炼器等级
    * (100 // 固定值
      + 30000) / 100; // 固定值
  const ignoreDef = wingFlatAtk; // 一样的
  return {
    atk,                   // 造 1 件装备人物实际拿到的攻击 = 装备主攻击 + 翅膀每造一件给的固定攻击
    dims:      1,                          // 受益维数:本对比表只统计「攻击」1 维(翅膀给的 HP/防御/无视防御不计入)
    level:     lianqiLevel,               // 当前炼器等级:决定寒铁消耗,装备主攻击公式,装备属性%(研究23),每次制造给的经验
    per:       {atk: lianqiLevel > 999 ? wingFlatAtk : 0,ignoreDef,zhizaoExp},       // 每次制造获得
    peratk:    totalAtk / costPerLevelUp, // 资源效率 = atk ÷ 寒铁,即"每 1 寒铁换到多少攻击",用于跨系统横向比大小
    resource:  "寒铁",                    // 消耗资源名:造装备消耗寒铁(GetRemandMat)
    system:    "制作装备",                // 系统名(对比表分组标签)
    totalGain: totalAtk,              // 全维合计提升 = atk × dims;因 dims=1,数值上等于 atk
    zhizaoExp:
      costPerLevelUp                        // 造 1 件装备消耗的寒铁 = 当前炼器等级(GetRemandMat,封顶 200 万,下限 1;未叠加 Reduce_HanTie 研究减免)
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

// ============================== 9. 转职强化(历史本纪,4 维) ==============================
// ZhuanZhiManager.cs:35-39 GetStrengthRemand(消耗=10+10L) / :16-19 GetNextAddition(每级四维各+20+50L)
// 升级一次消耗(历史本纪) = 10 + 10*L
// 升级一次每维提升 = 20 + 50*L
export function zhuanZhi (level: number): SystemGain {
  const costPerLevelUp = 10 + 10 * level; // 升级一次要多少历史本纪
  const atk = 20 + 50 * level;     // 每维提升 = 20+50L
  return {
    atk,
    costPerLevelUp,
    dims:      4,
    level,
    peratk:    atk / costPerLevelUp,
    resource:  "历史本纪",
    system:    "转职强化",
    totalGain: atk * 4
  };
}