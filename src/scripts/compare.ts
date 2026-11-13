/**
 * compare.ts — 同类对比(库函数版,不读取存档)
 * 每个养成系统的「等级 → 提升属性」公式都[直接写在对应函数体内](含中文注释 + 反编译源码出处),
 * 不再调用 game-formulas.ts 的黑盒函数,方便一眼看懂"升级一次要多少资源,加多少属性".
 * 传入"当前等级 level",返回对象描述的是"从 level 升到 level+1 这一级"的消耗与提升.
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
  costPerLevelUp:   number; // [升级一次所需资源]从 level 升到 level+1 要花多少资源
  dims:             number; // 受益维数
  atk:       number; // [升级一次每维提升]升这一级,每一维属性增加多少
  peratk: number; // 资源效率:每 1 单位资源换到每维多少属性 = atk / costPerLevelUp
  level:            number; // 当前等级(描述从该等级升到下一级的消耗/提升)
  resource:         string; // 消耗的资源名
  system:           string; // 系统名
  totalGain:        number; // [升级一次全维合计提升]= atk × dims
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

// ============================== 3. 制作装备 / 炼器(寒铁,仅攻击 1 维) ==============================
// PropHelper.cs:487-505 GetRemandMat(消耗=炼器等级,封顶 200 万,下限 1)
// :388-405 GenerateEquip 单件装备主攻击 = (30 + 25*L + 6*品质*L) × (0.4*品质+1) × 随机期望(1.05 = Random.Range(1,1.1) 均值) × (1+装备属性%/100)
// 品质(期望) 来自 五彩神石→器鼎等级→品质概率表(内联 EQUIP_PERCENT_TABLE,EquipLevel_PercentTable.GeneratePercent,千分制);
// 装备制造属性% = 研究18(精益求精 +1%/级) + 研究22?器鼎等级 + 研究23?炼器等级(GetEqui_PropertyAddition,PropHelper.cs:424-438).
// 器鼎>1000 仍影响装备:研究22 把 QiLu_Level 直接加进装备属性%,该乘区无上限,随器鼎等级线性放大(品质表 initialLevel 封顶 700 已饱和,但属性%继续涨).
// 翅膀(真):NPC_EquipManager.FinishLianQi(:119-126) 印记 Wing_CB_2(Mark 76),每次制造完成给人物 HP/ATK/DEF/无视防御 各 +(75 + 25×等级) flat.

// 器鼎等级 → 新装备品质概率表(千分制),内联自 config/equip-percent.json(EquipLevel_PercentTable.GeneratePercent)
const EQUIP_PERCENT_TABLE: {pinzhi: number; initialLevel: number; percentLevelAdd: number}[] = [
  {pinzhi: 1,  initialLevel: 0,   percentLevelAdd: 1000},
  {pinzhi: 2,  initialLevel: -1,  percentLevelAdd: 32},
  {pinzhi: 3,  initialLevel: 0,   percentLevelAdd: 27},
  {pinzhi: 4,  initialLevel: 2,   percentLevelAdd: 22},
  {pinzhi: 5,  initialLevel: 10,  percentLevelAdd: 18},
  {pinzhi: 6,  initialLevel: 15,  percentLevelAdd: 15},
  {pinzhi: 7,  initialLevel: 25,  percentLevelAdd: 12},
  {pinzhi: 8,  initialLevel: 35,  percentLevelAdd: 9},
  {pinzhi: 9,  initialLevel: 45,  percentLevelAdd: 6},
  {pinzhi: 10, initialLevel: 60,  percentLevelAdd: 3},
  {pinzhi: 11, initialLevel: 100, percentLevelAdd: 2},
  {pinzhi: 12, initialLevel: 200, percentLevelAdd: 1},
  {pinzhi: 13, initialLevel: 350, percentLevelAdd: 1},
  {pinzhi: 14, initialLevel: 500, percentLevelAdd: 1},
  {pinzhi: 15, initialLevel: 700, percentLevelAdd: 1}
];

// ---- 制作装备 / 品质 常量(数值均来自反编译源码,集中列出便于核对) ----
const PER_MILLE            = 1000;  // 品质概率表为「千分制」(满 PER_MILLE = 100%)
const QIDING_MAX_QUALITY   = 1700;  // 器鼎等级达到此值 → 品质表 100% 最高品质(15)(核验:1000→30%、1600→90%、1700→100%)
const RESEARCH18_MAX_LEVEL = 50;    // 研究18「精益求精」满级 = 50 级,装备属性 +1%/级
const PERCENT_BASE         = 100;   // 百分比基数(装备属性% 转乘区用)

// ---- 单件装备主攻击公式常量(PropHelper.GenerateEquip,反编译 :388-405) ----
// 单件主攻击 = (BASE + PER_LIANQI*炼器等级 + QUALITY_LV*品质*炼器等级)
//              × (QUALITY_FACTOR*品质 + 1) × 随机期望 × (1 + 装备属性%/100)
const EQUIP_ATK_BASE       = 30;    // 基础固定值 30
const EQUIP_ATK_PER_LIANQI = 25;    // 每级炼器 +25
const EQUIP_ATK_QUALITY_LV = 6;     // 品质×炼器等级 ×6
const EQUIP_QUALITY_FACTOR = 0.4;   // 品质系数:(0.4×品质 + 1)
const EQUIP_RANDOM_MIN     = 1.0;   // GenerateEquip 随机乘区 Random.Range(1f, 1.1f) 下限
const EQUIP_RANDOM_MAX     = 1.1;   // 上限(不含)
const EQUIP_RANDOM_AVG     = (EQUIP_RANDOM_MIN + EQUIP_RANDOM_MAX) / 2; // 随机期望 = 1.05(均值)
// 翅膀(Wing_CB_2, Mark 76):NPC_EquipManager.FinishLianQi(:119-126) 每次制造给人物固定值(非百分比)
const WING_CB2_BASE        = 75;    // 翅膀固定值基数
const WING_CB2_PER_LEVEL   = 25;    // 翅膀每级 +25(到 HP/ATK/DEF/无视防御 各)
// 升级消耗(PropHelper.GetRemandMat,反编译 :487-505:消耗 = 炼器等级,封顶 200 万,下限 1)
const MAKE_EQUIP_COST_CAP = 2_000_000; // 升一次炼器消耗寒铁封顶

// 器鼎等级 → 各品质概率(千分制);从最高品质往下填,满 PER_MILLE 即止
function pinZhiDistribution (qiluLevelValue: number): number[] {
  const table = EQUIP_PERCENT_TABLE;
  const percent = new Array<number>(table.length).fill(0);
  for (let index = table.length - 1; index >= 0; index -= 1) {
    const entry = table[index];
    if (!entry) {continue;}
    const used = percent.reduce((sum,value) => sum + value,0);
    if (used >= PER_MILLE) {break;}
    if (entry.initialLevel < qiluLevelValue) {
      percent[index] = Math.min((qiluLevelValue - entry.initialLevel) * entry.percentLevelAdd, PER_MILLE - used);
    }
  }
  return percent;
}

// 器鼎等级 → 新装备品质期望(加权,范围约 1~15)
function expectedQuality (qiluLevelValue: number): number {
  const dist = pinZhiDistribution(qiluLevelValue);
  let pinzhi = 0;
  for (let i = 0; i < dist.length; i += 1) {
    pinzhi += ((dist[i] ?? 0) / PER_MILLE) * (EQUIP_PERCENT_TABLE[i]?.pinzhi ?? 0);
  }
  return pinzhi;
}

// 制作装备=生成一件装备,计算该装备的主攻击数值(含每次制造的翅膀固定加成).
// 器鼎(qiding)决定品质期望(≥1700 即 100% 最高品质);研究22 把器鼎等级计进装备属性%(线性无上限→过1000仍持续加成);
// 翅膀(wingCb2Level)=印记 Wing_CB_2 等级,每次制造给人物固定 +(WING_CB2_BASE + WING_CB2_PER_LEVEL×等级) 到 HP/ATK/DEF/无视防御(各).
export function makeEquip (
  lianqiLevel: number,            // 炼器等级(= 升一次炼器要多少寒铁)
  qiding = QIDING_MAX_QUALITY,    // 器鼎等级(决定新装备品质期望;研究22 把器鼎等级计进装备属性,无上限)
  wingCb2Level = 0,               // 印记 Wing_CB_2(Mark 76)等级:每次制造给人物固定 +(75 + 25×等级) 到 HP/ATK/DEF/无视防御
  research18 = RESEARCH18_MAX_LEVEL, // 精益求精:装备属性 +1%/级(默认点满 50)
  research22 = true,             // 循序渐进:器鼎等级计入装备属性
  research23 = true              // 水涨船高:炼器等级计入装备属性
): SystemGain {
  const quality = expectedQuality(qiding);                            // 器鼎→品质期望(≥1700 = 100% 最高品质)
  const equipPropPct = research18                                     // 研究18:装备属性 +1%/级
    + (research22 ? qiding : 0)                                       // 研究22:器鼎等级计入(线性无上限,过1000仍持续放大装备主属性)
    + (research23 ? lianqiLevel : 0);                                 // 研究23:炼器等级计入
  // 单件主攻击(含随机期望 EQUIP_RANDOM_AVG):见上方常量注释中的公式
  const atk = (EQUIP_ATK_BASE
    + EQUIP_ATK_PER_LIANQI * lianqiLevel
    + EQUIP_ATK_QUALITY_LV * quality * lianqiLevel)
    * (EQUIP_QUALITY_FACTOR * quality + 1)
    * EQUIP_RANDOM_AVG
    * (1 + equipPropPct / PERCENT_BASE);
  // 翅膀(Wing_CB_2):FinishLianQi 每次制造完成,人物 HP/ATK/DEF/无视防御 各 +(基数 + 每级×等级) flat
  const wingFlatAtk = wingCb2Level > 0 ? WING_CB2_BASE + WING_CB2_PER_LEVEL * wingCb2Level : 0;
  const totalAtk = atk + wingFlatAtk;
  const costPerLevelUp = Math.max(1, Math.min(MAKE_EQUIP_COST_CAP, lianqiLevel)); // 升一次炼器要多少寒铁 = 炼器等级(封顶 200 万)
  return {
    costPerLevelUp,
    dims:             1,
    atk:              totalAtk,
    peratk:           totalAtk / costPerLevelUp,
    level:            lianqiLevel,
    resource:         "寒铁",
    system:           "制作装备",
    totalGain:        totalAtk
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
    cost:           309_665,
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
    costPerLevelUp,
    dims:             2,
    atk,
    peratk: atk / costPerLevelUp,
    level,
    resource:         "地图材料",
    system:           "圣兽",
    totalGain:        atk * 2
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
    costPerLevelUp,
    dims:             4,
    atk,
    peratk: atk / costPerLevelUp,
    level,
    resource:         "图鉴道具",
    system:           "图鉴",
    totalGain:        atk * 4
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
    costPerLevelUp,
    dims:             4,
    atk,
    peratk: atk / costPerLevelUp,
    level,
    resource:         "御力",
    system:           "御灵师",
    totalGain:        atk * 4
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
    costPerLevelUp,
    dims:             4,
    atk,
    peratk: atk / costPerLevelUp,
    level,
    resource:         "灵纹",
    system:           "阵法",
    totalGain:        atk * 4
  };
}

// ============================== 9. 转职强化(历史本纪,4 维) ==============================
// ZhuanZhiManager.cs:35-39 GetStrengthRemand(消耗=10+10L) / :16-19 GetNextAddition(每级四维各+20+50L)
// 升级一次消耗(历史本纪) = 10 + 10*L
// 升级一次每维提升 = 20 + 50*L
export function zhuanZhi (level: number): SystemGain {
  const costPerLevelUp = 10 + 10 * level; // 升级一次要多少历史本纪
  const atk = 20 + 50 * level;     // 每维提升 = 20+50L
  return {
    costPerLevelUp,
    dims:             4,
    atk,
    peratk: atk / costPerLevelUp,
    level,
    resource:         "历史本纪",
    system:           "转职强化",
    totalGain:        atk * 4
  };
}