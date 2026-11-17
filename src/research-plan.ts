/**
 * research-plan.ts — 研究节点计划(借鉴 yingling-output.ts:1052 buildResearchPlan,不修改该文件)
 * 节点数据来自 config/keji.json；节点名来自 config/names.json.
 * 逐级扣费:俭以养德(55) 每升 1 级,下一级研究立刻少 1% 历史本纪(DESIGN.md §研究口径).
 * 与 yingling-output 的差别:本模块额外把「研究带来的资源收入」显式返回,供 resource-allocation.ts 计入可追加资源:
 * - 御灵石经验(48) → 御灵宝典每本经验 ×(100+等级)/100,DESIGN.md 的「每本 200」即 100×2
 * - 图鉴经验(49) → 图鉴道具经验 ×(100+等级)/100
 * - 炼器经验(16) → 打造/炼器宝典经验 ×(100+等级)/100
 * - 各类 -50% 消耗减免(15/20/25/26/32) → 同等资源可升更多级
 * - 商店买价(44) -30% → 同等钱币可买更多道具
 * - 掉落类(39-43/56-62) 与御灵石经验一样「点满但不进面板」,本模块单列,
 * 因资源分配求解是静态模型,不模拟挂机掉落,故只列出不计入.
 */
import {loadConfig} from "./tools.ts";

export interface KeJiConfig {
  cost:      number;
  id:        number;
  maxLevel:  number;
  perLevel?: number;
  property?: number;
}

// 与 yingling-output.ts:561 RESEARCH_STEPS 完全一致
export const RESEARCH_STEPS: readonly {id: number; level: number}[] = [
  {id: 55,level: 20},{id: 15,level: 50},{id: 16,level: 50},{id: 18,level: 50},
  {id: 19,level: 20},{id: 20,level: 50},{id: 22,level: 1},{id: 23,level: 1},
  {id: 24,level: 10},{id: 25,level: 50},{id: 26,level: 50},{id: 27,level: 100},
  {id: 28,level: 100},{id: 29,level: 100},{id: 17,level: 50},{id: 21,level: 50},
  {id: 31,level: 10},{id: 32,level: 30},{id: 33,level: 30},{id: 34,level: 30},
  {id: 35,level: 20},{id: 36,level: 90},{id: 37,level: 3},{id: 38,level: 5},
  {id: 39,level: 100},{id: 40,level: 50},{id: 41,level: 50},{id: 42,level: 50},
  {id: 43,level: 50},{id: 44,level: 30},{id: 45,level: 300},{id: 46,level: 3},
  {id: 48,level: 100},{id: 47,level: 5},{id: 49,level: 100},{id: 50,level: 100},
  {id: 51,level: 100},{id: 52,level: 100},{id: 54,level: 5},{id: 53,level: 100},
  {id: 56,level: 5},{id: 57,level: 5},{id: 58,level: 5},{id: 59,level: 5},
  {id: 60,level: 5},{id: 61,level: 5},{id: 62,level: 5},{id: 1,level: 50},
  {id: 2,level: 50},{id: 14,level: 10},{id: 4,level: 10},{id: 5,level: 50},
  {id: 7,level: 10},{id: 9,level: 50},{id: 12,level: 10}
];
export interface ResearchResult {

  // 面板加成(per(id) = config.perLevel × 等级)
  atkPct:               number;
  cost:                 number;                    // 点满这些节点共消耗多少历史本纪
  crit:                 number;
  critDamage:           number;
  damageAddition:       number;
  defPct:               number;
  dropNodes:            {id: number; label: string; level: number}[];
  equipEntryPct:        number;
  equipExpPct:          number;
  equipPropertyPct:     number;
  hanTieReduce:         number;    // 寒铁消耗 -%
  hit:                  number;
  levels:               Map<number,number>;      // 每个节点点到几级
  lianQiExpMult:        number;    // 炼器经验(16)
  lianQiToEquip:        boolean;
  luckyBonus:           number;
  qiangHuaReduce:       number;    // 强化石消耗 -%
  qiDingToEquip:        boolean;
  shopReduce:           number;    // 商店买价 -%
  steps:                number;
  tuJianAtkPct:         number;
  tuJianDamagePerLevel: number;
  tuJianDefPct:         number;
  tuJianExpMult:        number;    // 图鉴经验(49)
  tuJianExpPct:         number;
  tuJianPenPct:         number;
  wucaiReduce:          number;    // 五彩神石消耗 -%

  // 「研究增加的具体收入」:倍率与减免
  yuLingExpMult: number;    // 御灵石经验(48):御灵宝典每本御力 = 100 × 该倍率
  yuLiReduce:    number;    // 御力升级消耗 -%
  zhenFaAtkPct:  number;
  zhenFaDefPct:  number;
  zhenFaPenPct:  number;
  zhenwenReduce: number;    // 灵纹消耗 -%
}
const DROP_LABEL: Record<number,string> = {
  39: "全敌掉落概率",
40: "精英掉落概率",
41: "首领掉落概率",
42: "楼楼掉落概率",
  43: "扫荡收益",
56: "掉落钱币",
57: "掉落历史本纪",
58: "掉落寒铁",
  59: "掉落灵纹",
60: "掉落随机锦囊",
61: "掉落御灵宝典",
62: "掉落怪物图鉴"
};
export function buildResearchPlan (): ResearchResult {
  const configs = loadConfig<KeJiConfig[]>("keji");
  const byId = new Map(configs.map(item => [item.id,item]));
  const levels = new Map<number,number>();
  let reduceLiShi = 0;
  let cost = 0;
  for (const step of RESEARCH_STEPS) {
    const config = byId.get(step.id);
    if (!config) {continue;}
    const start = levels.get(step.id) ?? 0;
    for (let level = start; level < step.level; level += 1) {
      cost += Math.round(config.cost * (100 - reduceLiShi) / 100);
      if (step.id === 55) {reduceLiShi = Math.min(20,level + 1);}
    }
    levels.set(step.id,step.level);
  }
  const per = (id: number): number => (byId.get(id)?.perLevel ?? 0) * (levels.get(id) ?? 0);
  const mult = (id: number): number => (100 + per(id)) / 100;
  return {
    atkPct:         per(1),
    cost,
    crit:           per(7),
    critDamage:     per(9),
    damageAddition: per(12),
    defPct:         per(2),
    dropNodes:      RESEARCH_STEPS
      .filter(s => DROP_LABEL[s.id] !== undefined)
      .map(s => ({id: s.id,label: DROP_LABEL[s.id] ?? "",level: s.level})),
    equipEntryPct:        per(19),
    equipExpPct:          per(16),
    equipPropertyPct:     per(18),
    hanTieReduce:         per(15),
    hit:                  per(5),
    levels,
    lianQiExpMult:        mult(16),
    lianQiToEquip:        (levels.get(23) ?? 0) > 0,
    luckyBonus:           per(14),
    qiangHuaReduce:       per(25),
    qiDingToEquip:        (levels.get(22) ?? 0) > 0,
    shopReduce:           per(44),
    steps:                RESEARCH_STEPS.length,
    tuJianAtkPct:         per(50),
    tuJianDamagePerLevel: per(54),
    tuJianDefPct:         per(51),
    tuJianExpMult:        mult(49),
    tuJianExpPct:         per(49),
    tuJianPenPct:         per(52),
    wucaiReduce:          per(20),
    yuLingExpMult:        mult(48),
    yuLiReduce:           per(32),
    zhenFaAtkPct:         per(27),
    zhenFaDefPct:         per(28),
    zhenFaPenPct:         per(29),
    zhenwenReduce:        per(26)
  };
}