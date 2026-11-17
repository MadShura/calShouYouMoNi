/**
 * resource-allocation.ts — 资源分配求解器(独立新脚本,不修改 yingling-output.ts)
 * 起点「仅有」= config/exchange.json 的 23 个兑换码 + 35 项通关点数兑换.
 * 不含 寻宝第 10 层每格 2,560,000 白送包,不含 元宝 20,488 大奖,不含 仙葫药 18 份, 也不含 15 级御灵装备 / 点满神通 / 已点研究 等既定养成.
 * [追加资源的约束]只能用「钱币」在商店买到的道具:
 * 源码 YingLing.PropSystem/PropHelper.cs:165-172 GenrateStore():
 * Mat : 1, 2, 3, 5, 6, 7, 8, 9
 * Special: 81, 82, 83, 84, 85, 86, 92, 89, 90, 91
 * 买不到:图鉴卡片 901-915(存档虽有 valueCost=50,但不在商店清单),
 * 御力(4),钱币(80),元宝(95),御力宝箱(21/29).
 * 御力靠买「御灵宝典(84)」获得；炼器经验靠买「炼器宝典(86)」.
 * [研究增加的具体收入]借鉴 yingling-output.ts:1052 buildResearchPlan,
 * 见 research-plan.ts:点满 55 节点 / 309,665 历史本纪后
 * 御灵石经验(48)+100% → 御灵宝典每本 100→200 御力(即 DESIGN.md 的 200)
 * 图鉴经验(49)+100% → 图鉴经验 ×2；炼器经验(16)+50% → ×1.5
 * 商店买价(44)-30% → 所有道具单价 ×0.7
 * 寒铁/五彩/强化/灵纹消耗各 -50%,御力升级 -30% → 同等资源升更多级
 * 另有攻击+50%/命中+50/伤害加成+10/阵法攻击+100%/装备属性+50%/图鉴增伤 +5/级
 * 掉落类 12 个节点也点满,但静态模型不模拟挂机掉落,单列不计入.
 * 研究未点满前,以上全部不生效(裸值 100 御力/本,无减免,无加成).
 * 单价:Save_1/Prop_Data.Save 的 _valueCost(UIPanel_BuyProp.cs:45-48).
 * 全部单级公式 import 自 game-formulas.ts(已逐条核对反编译源码).
 * 敌人属性 import 自 enemy-stats.ts.
 * [目标:双敌人同时满足]终局第 5 关(ZHONG_JU tiaoZhanID=5)+ 试炼 1000 层,
 * 两批敌人各自都要「先手 + 100%命中 + 一击必杀」,共 6 项约束同时达标才算解.
 * 两个场景都不计图鉴增伤(DESIGN.md §图鉴口径:研究54 只在通天塔 Character_Enemy 生效).
 * 用法:pnpm source [--save=N | --dir=路径]
 */
import {readFileSync} from "node:fs";
import {join} from "node:path";
import process from "node:process";
import {
  culDamagePercent,
  fmtShort,
  lianQiLevelUpExp,
  makeEquipMainAtk,
  oneShotDamage,
  qiDingCost,
  RES_NAME,
  shenBingCost,
  shengShouCost,
  shengShouStat,
  TUJIAN_ITEM_EXP,
  tuJianStat,
  vipLevelUpCost,
  yuLingLevelCost,
  zhenFaCost,
  zhenFaStat,
  zhuanZhiCost,
  zhuanZhiStat
} from "./game-formulas.ts";
import {trialEnemy,ZHONG_JU} from "./enemy-stats.ts";
import type {EnemyStats} from "./enemy-stats.ts";
import {argString,parseArgs,resolveSaveDir} from "./readSave.ts";
import type {CliArgs} from "./readSave.ts";
import {buildResearchPlan} from "./research-plan.ts";
import type {ResearchResult} from "./research-plan.ts";
import {loadConfig} from "./tools.ts";

interface CodeEntry {code: string; props: [number,number][]}
interface EquipPercentEntry {initialLevel: number; percentLevelAdd: number; pinzhi: number}
interface ExchangeConfig {
  codes:    {entries: CodeEntry[]};
  tongGuan: {entries: PointEntry[]};
}
type PointEntry =
  | {index: number; nums: number; price: number; prop: number; type: "prop"}
  | {index: number; percent: boolean; price: number; prop: number; type: "property"; value: number};
const EQUIP_TABLE = loadConfig<EquipPercentEntry[]>("equip-percent");
const RESEARCH = buildResearchPlan();
const PROP_NAME: Record<number,string> = {
  10:  "抽奖卷",
101: "道具",
104: "道具",
157: "道具",
18:  "灵气",
19:  "残念",
  21:  "御力宝箱",
29:  "御力宝箱Lv6",
30:  "灵石",
32:  "碎片",
34:  "锦囊",
4:   "御力",
41:  "令牌",
  42:  "道具",
52:  "道具",
54:  "道具",
70:  "道具",
79:  "道具",
80:  "钱币",
  82:  "道具",
83:  "道具",
84:  "御灵宝典",
86:  "炼器宝典",
92:  "神速符",
93:  "升仙令",
  94:  "道具",
95:  "元宝",
96:  "道具"
};
for (let p = 901; p <= 915; p += 1) {PROP_NAME[p] = `图鉴卡片${String(p)}`;}
const propName = (p: number): string => RES_NAME[p] ?? PROP_NAME[p] ?? `Prop${String(p)}`;

// ---------------- 商店单价 ----------------
const STORE_PROPS = new Set<number>([1,2,5,6,7,8,81,84,85,86,9,92]);
const PRICE_FALLBACK: Record<number,number> = {
  1:  1,
2:  5,
5:  5,
6:  2,
7:  2,
8:  5,
81: 100,
  84: 75,
85: 1588,
86: 100,
9:  2,
92: 300
};
interface AllocRes {
  baseCost: number;
dest:       string;
minStep:    number;                            // 达到阈值型效果所需的最小数量
 name:      string;
prop:       number;
  scale:    number;
  stepFor?: (amount: number) => number;      // 按当前投入量算「至少升一级」所需数量
}
function buildAlloc (prices: Map<number,number>): AllocRes[] {
  const defs: Omit<AllocRes,"baseCost">[] = [
    {dest: "打造装备 → 炼器等级",minStep: 1,name: "寒铁",prop: 1,scale: 1e6},
    {dest: "器鼎 → 装备品质",minStep: 1,name: "五彩神石",prop: 2,scale: 1e5},
    {dest: "10 槽装备强化",minStep: 1,name: "强化石",prop: 5,scale: 1e6},

    // 神通要 38,200 卷轴才点满,步长小于阈值时边际收益恒为 0
    {dest: "点满 30 神通",minStep: 38200,name: "神通卷轴",prop: 6,scale: 1e4},
    {dest: "阵法等级",minStep: 1,name: "灵纹",prop: 7,scale: 1e6},
    {dest: "解锁阵法 + 圣兽3(青龙)",minStep: 1,name: "灵晶",prop: 8,scale: 1e5},

    // 研究点满需 309,665 历史本纪
    {dest: "研究 → 转职强化(含速度)",minStep: 30_9665,name: "历史本纪",prop: 9,scale: 1e6},

    // 神兵单级消耗 (L+1)×10000,按当前投入量动态给步长,保证至少升一级
    {dest: "御灵师突破 + 神兵水炼",minStep: 1,name: "忘情水",prop: 81,scale: 1e5,stepFor: shenBingNextCost},
    {dest: "御力 → 御灵师等级",minStep: 1,name: "御灵宝典",prop: 84,scale: 1e4},
    {dest: "神兵火炼(命中)",minStep: 1,name: "三味真火",prop: 85,scale: 1e3,stepFor: shenBingNextCost},
    {dest: "炼器经验",minStep: 1,name: "炼器宝典",prop: 86,scale: 1e3},
    {dest: "圣兽4(白虎)",minStep: 1,name: "神速符",prop: 92,scale: 1e4}
  ];
  return defs
    .filter(d => STORE_PROPS.has(d.prop) && (prices.get(d.prop) ?? 0) > 0)
    .map(d => ({...d,baseCost: prices.get(d.prop) ?? 0}));
}
function loadStorePrices (args: CliArgs): {prices: Map<number,number>; source: string} {
  try {
    const file = join(resolveSaveDir(args),"Prop_Data.Save");
    const prices = new Map<number,number>();
    for (const line of readFileSync(file,"utf8").replace(/^\u{FEFF}/u,"")
.split(/\r?\n/)) {
      const t = line.trim();
      if (!t.startsWith("{")) {continue;}
      const o = JSON.parse(t) as {_propID?: number; _valueCost?: number};
      if (o._propID !== undefined && o._valueCost !== undefined) {prices.set(o._propID,o._valueCost);}
    }
    return {prices,source: `${file} 的 _valueCost`};
  } catch {
    return {
prices: new Map(Object.entries(PRICE_FALLBACK).map(([k,v]) => [Number(k),v])),
      source: "内置实测快照（存档不可读）"
};
  }
}

// 神兵下一级消耗:shenBingCost(level) = (level+1)×10000
function shenBingNextCost (amount: number): number {
  const level = curve("sb",0,shenBingCost,shenBingSum).solve(Math.max(0,amount)).level;
  return shenBingCost(level);
}

// 研究 44「价廉物美」:商店买价 -30%(Cul_Percent_ToInt 四舍五入远离零)
const shopPrice = (base: number,isResearchOn: boolean): number => Math.round(base * (100 - (isResearchOn ? RESEARCH.shopReduce : 0)) / 100);

// ---------------- 初始资源池 ----------------
interface PoolRow {amount: number; fromCode: number; fromPoint: number; name: string; prop: number}

// ---------------- 等级求解(成本曲线前缀和 + 二分,按研究减免缓存) ----------------
class CostCurve {
  private readonly sums: number[] = [0];
  public constructor (
    private readonly start: number,
    private readonly costAt: (l: number) => number,
    private readonly sumAt?: (n: number) => number  // 闭式前缀和；给了就不受数组长度限制
  ) {}
  private ensure (n: number): void {
    while (this.sums.length <= n) {
      const i = this.sums.length - 1;
      this.sums.push((this.sums[i] ?? 0) + Math.max(1,this.costAt(this.start + i)));
    }
  }
  private sum (n: number): number {
    if (this.sumAt) {return n <= 0 ? 0 : this.sumAt(n);}
    this.ensure(n);
    return this.sums[n] ?? 0;
  }

  // 升 n 级(到 level = start+n)所需的累计资源,供「硬前置」反解
  public sumOf (n: number): number {
    return this.sum(Math.max(0,n));
  }
  public solve (total: number): {level: number; remain: number} {

    // 有闭式时上界放到 1e15,避免等级被 5e6 硬封顶导致边际收益恒为 0
    const cap = this.sumAt ? 1e15 : 500_0000;
    let hi = 1;
    while (hi < cap && this.sum(hi) <= total) {hi *= 2;}
    let lo = 0;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.sum(mid) <= total) {lo = mid;} else {hi = mid - 1;}
    }
    return {level: this.start + lo,remain: total - this.sum(lo)};
  }
}
function buildInitialPool (): {pointPrice: number; property: Map<number,number>; rows: PoolRow[]; total: Map<number,number>} {
  const cfg = loadConfig<ExchangeConfig>("exchange");
  const acc = new Map<number,{fromCode: number; fromPoint: number}>();
  const add = (prop: number,nums: number,from: "code" | "point"): void => {
    const cur = acc.get(prop) ?? {fromCode: 0,fromPoint: 0};
    if (from === "code") {cur.fromCode += nums;} else {cur.fromPoint += nums;}
    acc.set(prop,cur);
  };
  for (const entry of cfg.codes.entries) {
    for (const [prop,nums] of entry.props) {add(prop,nums,"code");}
  }
  const property = new Map<number,number>();
  let pointPrice = 0;
  for (const entry of cfg.tongGuan.entries) {
    pointPrice += entry.price;
    if (entry.type === "prop") {add(entry.prop,entry.nums,"point");} else {property.set(entry.prop,(property.get(entry.prop) ?? 0) + entry.value);}
  }
  const total = new Map<number,number>();
  const rows: PoolRow[] = [];
  const sortedAcc = [...acc].toSorted((a,b) => a[0] - b[0]);
  for (const [prop,v] of sortedAcc) {
    const amount = v.fromCode + v.fromPoint;
    total.set(prop,amount);
    rows.push({name: propName(prop),prop,...v,amount});
  }
  return {pointPrice,property,rows,total};
}
const curveCache = new Map<string,CostCurve>();
function curve (key: string,start: number,costAt: (l: number) => number,
  sumAt?: (n: number) => number): CostCurve {
  let c = curveCache.get(key);
  if (!c) {
    c = new CostCurve(start,costAt,sumAt);
    curveCache.set(key,c);
  }
  return c;
}

// 各系统累计消耗闭式(Σ_{i=0..n-1} costAt(start+i))
// 阵法 zhenFaCost(l)=c·l (start=1) → c·n(n+1)/2
const zhenFaSum = (c: number) => (n: number): number => c * n * (n + 1) / 2;

// 转职 zhuanZhiCost(l)=10+10l (start=0) → 5n²+5n
const zhuanZhiSum = (n: number): number => 5 * n * n + 5 * n;

// 圣兽 shengShouCost(l)=min(50000,10+10l):l>=4999 起封顶 50000
const shengShouSum = (n: number): number => {
  const m = Math.min(n,4999);
  return 5 * m * m + 5 * m + 50000 * Math.max(0,n - 4999);
};

// 神兵 shenBingCost(l)=min(1e6,(l+1)·10000):l>=99 起封顶 1e6
const shenBingSum = (n: number): number => {
  const m = Math.min(n,99);
  return 10000 * m * (m + 1) / 2 + 1e6 * Math.max(0,n - 99);
};

// 器鼎 qiDingCost(L)=(floor((L-1)/5)+1)·10,研究后 ×f；Σ_{L=1..n} ceil(L/5)=5q(q+1)/2+(q+1)r
const qiluSumFor = (f: number) => (n: number): number => {
  const q = Math.floor(n / 5),
r = n % 5;
  return 10 * f * (5 * q * (q + 1) / 2 + (q + 1) * r);
};

// 御灵师 yuLingLevelCost(L)=(t+1)(100t+20r),t=floor(L/10),r=L%10,研究后 ×f
const yulingshiSumFor = (f: number) => (n: number): number => {
  if (n <= 0) {return 0;}
  const m = Math.min(n,9);          // t=0 段:L=1..9,每级 20L
  let s = 20 * m * (m + 1) / 2;
  if (n <= 9) {return s * f;}
  const rem = n - 9;
  const q = Math.floor(rem / 10),
r = rem % 10;
  s += 1000 * q * (q + 1) * (2 * q + 1) / 6 + 1900 * q * (q + 1) / 2 + 900 * q;
  if (r > 0) {
    const t = q + 1;
    s += (t + 1) * (r * 100 * t + 20 * r * (r - 1) / 2);
  }
  return s * f;
};
function expectedPinZhi (qiluLevel: number): number {
  const percent = Array.from({length: EQUIP_TABLE.length},() => 0);
  let used = 0;
  for (let i = EQUIP_TABLE.length - 1; i >= 0; i -= 1) {
    const e = EQUIP_TABLE[i];
    if (!e) {continue;}
    if (used >= 1000) {break;}
    if (e.initialLevel >= qiluLevel) {continue;}
    const p = Math.min((qiluLevel - e.initialLevel) * e.percentLevelAdd,1000 - used);
    percent[i] = p;
    used += p;
  }
  let pinzhi = 0;
  for (const [i,element] of EQUIP_TABLE.entries()) {
    pinzhi += (percent[i] ?? 0) / 1000 * element.pinzhi;
  }
  return pinzhi;
}

// 突破第 i 次给 2+trunc(4·i·1.75)=2+7i；Σ_{i=1..n}(2+7i)=2n+7n(n+1)/2 (闭式,避免逐次累加)
function sumBreakthrough (n: number): number {
  return 2 * n + 7 * n * (n + 1) / 2;
}
function tuJianLevelFromExp (exp: number): number {
  let costSum = 0,
level = 0,
remain = exp;
  for (;;) {
    const cost = 10 + 10 * costSum;
    if (remain < cost) {return level;}
    remain -= cost;
    level += 1;
    costSum += Math.trunc((level - 1) / 10) + 1;
  }
}
const sumLinear = (from: number,to: number,base: number,step: number): number => {
  if (to <= from) {return 0;}
  const n = to - from;
  return n * base + step * n * (2 * from + n - 1) / 2;
};

// 研究加成对象:未点满时全部归零(裸值)
interface Effects {
  atkPct:             number;
  dmgAdd:             number;
equipAtkPctBonus:     number;
equipEntryPct:        number;
  equipPropertyPct:   number;
expLianqi:            number;
expTujian:            number;
expYuli:              number;
hanTie:               number;
  hit:                number;
lianQiToEquip:        boolean;
on:                   boolean;
  qiangHua:           number;
qiDingToEquip:        boolean;
  tuJianAtkPct:       number;
tuJianDamagePerLevel: number;
tuJianPenPct:         number;
  wucai:              number;
yuLi:                 number;
zhenFaAtkPct:         number;
  zhenFaPenPct:       number;
zhenwen:              number;
}

interface Panel {
  atkFlat:         number;
  atkPct:          number;
  breakdown:       {amount: number; dest: string; gain: string; level: number; resource: string}[];
  damageAddition:  number;
  finalAtk:        number;
  hit:             number;
  isResearchOn:    boolean;
  penetration:     number;
  speed:           number;
  tuJianDamagePct: number;
}
const NO_EFFECTS: Effects = {
  atkPct:               0,
  dmgAdd:               0,
equipAtkPctBonus:     0,
equipEntryPct:        0,
  equipPropertyPct:     0,
expLianqi:            1,
expTujian:            1,
expYuli:              1,
hanTie:               0,
  hit:                  0,
lianQiToEquip:        false,
on:                   false,
  qiangHua:             0,
qiDingToEquip:        false,
  tuJianAtkPct:         0,
tuJianDamagePerLevel: 0,
tuJianPenPct:         0,
  wucai:                0,
yuLi:                 0,
zhenFaAtkPct:         0,
  zhenFaPenPct:         0,
zhenwen:              0
};
function effectsOf (r: ResearchResult): Effects {
  return {
    atkPct:               r.atkPct,
    dmgAdd:               r.damageAddition,
equipAtkPctBonus:     0,
equipEntryPct:        r.equipEntryPct,
    equipPropertyPct:     r.equipPropertyPct,
expLianqi:            r.lianQiExpMult,
expTujian:            r.tuJianExpMult,
    expYuli:              r.yuLingExpMult,
hanTie:               r.hanTieReduce,
    hit:                  r.hit,
lianQiToEquip:        r.lianQiToEquip,
on:                   true,
    qiangHua:             r.qiangHuaReduce,
qiDingToEquip:        r.qiDingToEquip,
    tuJianAtkPct:         r.tuJianAtkPct,
tuJianDamagePerLevel: r.tuJianDamagePerLevel,
tuJianPenPct:         r.tuJianPenPct,
    wucai:                r.wucaiReduce,
yuLi:                 r.yuLiReduce,
    zhenFaAtkPct:         r.zhenFaAtkPct,
    zhenFaPenPct:         r.zhenFaPenPct,
zhenwen:              r.zhenwenReduce
  };
}

// ---------------- 资源量 → 面板 ----------------
function panelOf (final: Map<number,number>,property: Map<number,number>): Panel {
  const get = (p: number): number => final.get(p) ?? 0;
  const breakdown: Panel["breakdown"] = [];
  const push = (resource: string,dest: string,level: number,amount: number,gain: string): void => {
    breakdown.push({amount,dest,gain,level,resource});
  };

  // 研究:历史本纪先付 309,665 点满,剩余才进转职强化
  const isResearchOn = get(9) >= RESEARCH.cost;
  const e = isResearchOn ? effectsOf(RESEARCH) : NO_EFFECTS;

  // 御力 = 初始御力 + 御力宝箱 + 御灵宝典(84)×100×研究48倍率
  const yuliBookExp = 100 * e.expYuli;
  const yuli = get(4) + get(21) * 20_0000 + get(29) * 100_0000 + get(84) * yuliBookExp;
  const yuliFactor = (100 - e.yuLi) / 100;
  const yls = curve(`yls-${String(e.yuLi)}`,1,l => yuLingLevelCost(l) * yuliFactor,
    yulingshiSumFor(yuliFactor)).solve(yuli);
  const yulingshiAtk = (yls.level - 1) * yls.level / 2 * 250;
  const breakthroughCount = Math.trunc(yls.level / 10);

  // 突破增益用模块顶层 sumBreakthrough(闭式;二分极大资源时突破次数可达千万级,不能逐次累加)
  const luckyN = luckyBreakthroughs();
  const luckyCount = Math.min(breakthroughCount,luckyN);
  const breakpointSpeed = breakthroughCount > luckyCount
    ? sumBreakthrough(breakthroughCount) - sumBreakthrough(luckyCount)
    : 0;
  push("御力",`御灵师 Lv.${String(yls.level)} / 突破 ${String(breakthroughCount)} 次`,yls.level,yuli,
    `四维各 +${fmtShort(yulingshiAtk)}，突破速度 +${fmtShort(breakpointSpeed)}`);

  // 五彩神石 → 器鼎(研究20 -50% 消耗)
  const wucaiFactor = (100 - e.wucai) / 100;
  const qilu = curve(`qilu-${String(e.wucai)}`,1,l => qiDingCost(l) * wucaiFactor,
    qiluSumFor(wucaiFactor)).solve(get(2));
  const pinzhi = expectedPinZhi(qilu.level);
  push("五彩神石",`器鼎 Lv.${String(qilu.level)} → 品质期望 ${pinzhi.toFixed(2)}`,qilu.level,get(2),
    `装备品质 ${pinzhi.toFixed(2)}`);

  // 寒铁打造(研究15 -50% 消耗,研究16 炼器经验 ×1.5,研究22/23 器鼎/炼器等级计入装备属性)
  let lianqiLevel = 1;
  let lianqiExp = get(86) * 100 * e.expLianqi;
  while (lianqiExp >= lianQiLevelUpExp(lianqiLevel)) {
    lianqiExp -= lianQiLevelUpExp(lianqiLevel);
    lianqiLevel += 1;
  }

  // 按「当前炼器等级」批量推进:一次算出升到下一级需要多少件,避免逐件循环(寒铁极大时会卡死)
  let crafts = 0,
iron = get(1);
  let levelSteps = 0;
  const MAX_LEVEL_STEPS = 5000; // 极大投入时炼器等级按上限截断；寒铁非主要杠杆,边际表已单列
  while (lianqiLevel < 200_0000 && iron > 0 && levelSteps < MAX_LEVEL_STEPS) {
    const craftCost = Math.max(1,Math.round(lianqiLevel * (100 - e.hanTie) / 100));
    if (iron < craftCost) {break;}
    const expPer = (lianqiLevel + 2) * e.expLianqi;
    const need = Math.max(1,lianQiLevelUpExp(lianqiLevel) - lianqiExp);
    const batch = Math.min(Math.max(1,Math.ceil(need / expPer)),Math.floor(iron / craftCost));
    iron -= batch * craftCost;
    lianqiExp += batch * expPer;
    crafts += batch;
    while (lianqiExp >= lianQiLevelUpExp(lianqiLevel) && lianqiLevel < 200_0000) {
      lianqiExp -= lianQiLevelUpExp(lianqiLevel);
      lianqiLevel += 1;
      levelSteps += 1;
    }
    if (batch < Math.max(1,Math.ceil(need / expPer))) {break;}
  }
  const equipPropPct = e.equipPropertyPct +
    (e.qiDingToEquip ? qilu.level : 0) + (e.lianQiToEquip ? lianqiLevel : 0);
  const equipAtkFlat = makeEquipMainAtk(lianqiLevel,pinzhi,equipPropPct) * 10;
  const equipEntryScale = (4 + e.equipEntryPct / 100) / 4;
  const equipAtkPct = pinzhi * 7 * equipEntryScale + e.equipAtkPctBonus;
  const equipDamageAddition = pinzhi * 2 * equipEntryScale;
  push("寒铁",`打造 ${fmtShort(crafts)} 件 → 炼器 Lv.${String(lianqiLevel)}`,lianqiLevel,get(1),
    `10 槽主属性攻击 +${fmtShort(equipAtkFlat)}，攻击% +${equipAtkPct.toFixed(2)}，伤害加成 +${equipDamageAddition.toFixed(2)}`);

  // 强化石(研究25 -50% 消耗)
  let strengthLevel = 0;
  const qhScale = (100 - e.qiangHua) / 100;
  while (10 * ((strengthLevel + 1) ** 2 + 4 * (strengthLevel + 1)) * qhScale <= get(5)) {strengthLevel += 1;}
  const strengthAtk = 10 * (5 * strengthLevel ** 2 + 15 * strengthLevel);
  push("强化石",`10 槽强化 Lv.${String(strengthLevel)}`,strengthLevel,get(5),`攻击 +${fmtShort(strengthAtk)}`);

  // 灵纹 → 阵法(研究26 -50% 消耗,研究27/29 阵法攻击/穿透 +100%)
  const lingwen = get(7) + Math.floor(get(80) / shopPrice(2,isResearchOn));
  const zhenfaCostC = 20 * (100 - e.zhenwen) / 100;
  const zhenfa = curve(`zf-${String(e.zhenwen)}`,1,l => zhenFaCost(l) * (100 - e.zhenwen) / 100,
    zhenFaSum(zhenfaCostC)).solve(lingwen);
  const zhenfaRaw = sumLinear(1,zhenfa.level,200,35);
  void zhenFaStat;
  const zhenfaAtkFlat = Math.trunc(zhenfaRaw * (100 + e.zhenFaAtkPct) / 100);
  const zhenfaPenFlat = Math.trunc(zhenfaRaw * (100 + e.zhenFaPenPct) / 100);
  push("灵纹",`阵法 Lv.${String(zhenfa.level)}`,zhenfa.level,lingwen,
    `攻击 +${fmtShort(zhenfaAtkFlat)}、穿透 +${fmtShort(zhenfaPenFlat)}，最高攻再 +${String(zhenfa.level)}%`);

  // 灵晶/神速符 → 圣兽(无对应研究减免)
  const sheng3 = curve("ss3",0,shengShouCost,shengShouSum).solve(Math.max(0,get(8) - 900));
  const sheng4 = curve("ss4",0,shengShouCost,shengShouSum).solve(get(92));
  const sheng3Atk = sumLinear(0,sheng3.level,20,50);
  const sheng4Atk = sumLinear(0,sheng4.level,20,50);
  void shengShouStat;
  push("灵晶",`圣兽3(青龙) Lv.${String(sheng3.level)}`,sheng3.level,get(8),`攻击 +${fmtShort(sheng3Atk)}`);
  push("神速符",`圣兽4(白虎) Lv.${String(sheng4.level)}`,sheng4.level,get(92),`攻击/穿透 +${fmtShort(sheng4Atk)}`);

  // 图鉴卡片 901-915 商店不售 → 锁定初始 5 张；研究49 经验 ×2,研究50/52 属性 +100%,研究54 增伤 +5/级
  let tuJianAtk = 0,
tuJianCards = 0,
tuJianLevelMax = 0,
tuJianPen = 0;
  for (let p = 901; p <= 915; p += 1) {
    const cards = get(p);
    tuJianCards += cards;
    const lv = tuJianLevelFromExp(cards * TUJIAN_ITEM_EXP * e.expTujian);
    tuJianLevelMax = Math.max(tuJianLevelMax,lv);
    tuJianAtk += Math.trunc(sumLinear(0,lv,50,15) * (100 + e.tuJianAtkPct) / 100);
    tuJianPen += Math.trunc(sumLinear(0,lv,50,15) * (100 + e.tuJianPenPct) / 100);
    void tuJianStat;
  }
  const tuJianDamagePct = tuJianLevelMax * e.tuJianDamagePerLevel;
  push("图鉴卡片",`仅初始 ${String(tuJianCards)} 张 → 最高 Lv.${String(tuJianLevelMax)}（商店不售，锁定）`,tuJianLevelMax,tuJianCards,
    `攻击 +${fmtShort(tuJianAtk)}、穿透 +${fmtShort(tuJianPen)}，通天塔增伤 +${String(tuJianDamagePct)}%`);

  // 历史本纪 → 研究点满 → 转职强化(研究加成已在 e 中体现)
  const historyMaterial = Math.max(0,get(9) - (isResearchOn ? RESEARCH.cost : 0));
  const history = curve("zz",0,zhuanZhiCost,zhuanZhiSum).solve(historyMaterial);
  const historyAtk = sumLinear(0,history.level,20,50);
  const historySpeed = history.level;
  void zhuanZhiStat;
  push("历史本纪",`研究 ${isResearchOn ? "点满" : "未点满"} → 转职强化 Lv.${String(history.level)}`,history.level,get(9),
    `转职攻击/穿透 +${fmtShort(historyAtk)}、速度 +${fmtShort(historySpeed)}`);

  // 神兵:忘情水先付突破 500/次,余量水炼；三味真火 → 火炼命中
  const waterBudget = Math.max(0,get(81) - breakthroughCount * 500);
  const waterLevel = curve("sb",0,shenBingCost,shenBingSum).solve(waterBudget).level;
  const fireLevel = curve("sb",0,shenBingCost,shenBingSum).solve(get(85)).level;
  push("忘情水",`突破 ${String(breakthroughCount)} 次 + 神兵水炼 Lv.${String(waterLevel)}`,waterLevel,get(81),`伤害加成 +${String(waterLevel)}%`);
  push("三味真火",`神兵火炼 Lv.${String(fireLevel)}`,fireLevel,get(85),`命中 +${fmtShort(fireLevel)}`);
  const isShenTongOk = get(6) >= 38200;
  push("神通卷轴",isShenTongOk ? "点满 30 神通" : "未点满",get(6),get(6),
    "神通9 +10 命中 / 神通25 +15 伤害加成（点满需 38,200）");

  // 元宝(95) 不在商店 → VIP 锁定为初始元宝
  let vipLevel = 0,
vipSpent = 0;
  for (;;) {
    const c = vipLevelUpCost(vipLevel + 1);
    if (vipSpent + c > get(95)) {break;}
    vipSpent += c;
    vipLevel += 1;
  }
  const vipHit = Math.trunc(vipLevel / 2);
  push("元宝",`VIP Lv.${String(vipLevel)}（商店不售，锁定）`,vipLevel,get(95),`命中 +${String(vipHit)}`);
  const tgAtkPct = property.get(0) ?? 0;
  const tgHit = property.get(4) ?? 0;
  const tgPenPct = property.get(15) ?? 0;
  const tgDamage = property.get(12) ?? 0;
  const atkFlat =
    yulingshiAtk + zhenfaAtkFlat + equipAtkFlat + strengthAtk + sheng3Atk + sheng4Atk + tuJianAtk + historyAtk;
  const atkPct = equipAtkPct + 15 + e.atkPct + tgAtkPct;
  const finalAtk = atkFlat * (100 + atkPct) / 100 * (1 + zhenfa.level / 100);
  const penetration =
    (yulingshiAtk + zhenfaPenFlat + tuJianPen + sheng4Atk + historyAtk) * (1 + tgPenPct / 100);
  const hit = 10 + tgHit + vipHit + fireLevel + e.hit + (isShenTongOk ? 10 : 0);
  const speed = breakpointSpeed + historySpeed;
  const damageAddition = equipDamageAddition + e.dmgAdd + waterLevel + (isShenTongOk ? 15 : 0) + tgDamage;
  return {atkFlat,atkPct,breakdown,damageAddition,finalAtk,hit,isResearchOn,penetration,speed,tuJianDamagePct};
}
const TANG_SAN_ZANG_HIT = 30;
const SUN_WU_KONG = {pctBucket: 1,skillMult: 1};

// ---------------- 逐资源逐用途:核查「加的到底是什么属性」并换算钱币 ----------------
interface MarginRow {
  adds:      string;
baseT:       number;
baseZ:       number;
  coins:     number;
count:       number;
  dmgT:      number;
  dmgZ:      number;
feasible:    boolean;
name:        string;
needCoins:   number; // 只追加这一种资源,两敌都击杀所需量
  needCount: number;
perCoinT:    number;
  perCoinZ:  number;
prop:        number;
  use:       string;
}
interface PreReq {
  coins:  number;
count:    number;
effect:   string;
name:     string;
  prop:   number;
unitCost: number;
why:      string;
}
interface SolveResult {
  added:      Map<number,number>;
  cost:       number;
  iterations: number;
  panel:      Panel;
  spent:      Map<number,number>;
  trace:      {margin: number; name: string; step: number}[];
}
interface Target {enemy: EnemyStats; name: string}

// 幸运满后,第 from+1 次起的突破全给速度,求达到 target 速度所需总突破次数
function breakthroughsForSpeed (from: number,target: number): number {
  let i = from,
speed = 0;
  while (speed < target) {
    i += 1;
    speed += breakthroughValue(i);
  }
  return i;
}
function breakthroughValue (i: number): number {
  return 2 + Math.trunc(4 * i * 1.75);
}

// ---------------- 硬前置:必须先做,不可省的投入 ----------------
function computePrerequisites (base: Map<number,number>,property: Map<number,number>,
  prices: Map<number,number>,targets: readonly Target[]): {final: Map<number,number>; reqs: PreReq[]} {
  const final = new Map(base);
  const reqs: PreReq[] = [];
  const push = (name: string,why: string,prop: number,count: number,effect: string): void => {
    const unitCost = shopPriceOf(prices,prop);
    const need = Math.max(0,count);
    reqs.push({coins: need * unitCost,count: need,effect,name,prop,unitCost,why});
    final.set(prop,(final.get(prop) ?? 0) + need);
  };
  const speedTarget = Math.max(...targets.map(t => t.enemy.speed)) + 1;
  const hitTarget = Math.max(...targets.map(t => t.enemy.dodge)) - TANG_SAN_ZANG_HIT;
  const tgHit = property.get(4) ?? 0;

  // ① 研究点满:所有消耗减免/经验倍率/面板加成的前提
  push("研究点满","俭以养德逐级 -1%，其余 54 节点全部收益的前提",9,RESEARCH.cost,
    `攻击+${String(RESEARCH.atkPct)}% 命中+${String(RESEARCH.hit)} 阵法攻击+${String(RESEARCH.zhenFaAtkPct)}% 装备属性+${String(RESEARCH.equipPropertyPct)}%；商店-30%、四类材料-50%、御力-30%`);

  // ② 神通点满 38,200 卷轴
  push("神通点满","神通9 +10 命中、神通25 +15 伤害加成",6,
    Math.max(0,38200 - (final.get(6) ?? 0)),"命中 +10、伤害加成 +15");

  // ③ 御灵宝典 → 御灵师等级:同时满足「突破 5 万幸运」与「先手速度」
  const luckyN = luckyBreakthroughs();
  const totalBt = breakthroughsForSpeed(luckyN,speedTarget);
  const needLevel = totalBt * 10; // 每 10 级一次突破
  const yuliCurve = curve("yls-30",1,l => yuLingLevelCost(l) * 70 / 100,
    yulingshiSumFor(0.7));
  const yuliNeed = yuliCurve.sumOf(needLevel - 1);
  const yuliInit =
    (final.get(4) ?? 0) + (final.get(21) ?? 0) * 20_0000 + (final.get(29) ?? 0) * 100_0000;
  const books = Math.max(0,Math.ceil((yuliNeed - yuliInit) / (100 * RESEARCH.yuLingExpMult)));
  push(`御灵宝典 → 御灵师 Lv.${String(needLevel)}`,
    `前 ${String(luckyN)} 次突破堆幸运到 50000（必须），第 ${String(luckyN + 1)}~${String(totalBt)} 次全给速度以超过 ${fmtShort(speedTarget)}`,
    84,books,`御灵师 Lv.${String(needLevel)} / 突破 ${String(totalBt)} 次；四维各 +${fmtShort((needLevel - 1) * needLevel / 2 * 250)}、速度 +${fmtShort(speedTarget)}`);

  // ④ 三味真火 → 神兵火炼命中(研究/神通/VIP/通关点数的命中是固定的,缺口只能靠火炼)
  const fixedHit = 10 + tgHit + 8 + RESEARCH.hit + 10; // 基础10 + 通关点数 + VIP(初始元宝 Lv.16→8) + 研究 + 神通9
  const fireNeed = Math.max(0,hitTarget - fixedHit);
  const fireCost = shenBingSum(fireNeed);
  push("三味真火 → 神兵火炼","命中是硬门槛，缺口只能靠火炼等级补",85,fireCost,
    `火炼 Lv.${String(fireNeed)} → 命中 +${String(fireNeed)}（固定命中 ${String(fixedHit)}，目标 ${String(hitTarget)}）`);
  return {final,reqs};
}

// 两个场景都不计图鉴增伤(DESIGN.md §图鉴口径:研究54 仅通天塔生效)
function damageOf (p: Panel,enemy: EnemyStats): number {
  return oneShotDamage(p.finalAtk,enemy,{
    atkPct:    100,
    dmgAdd:    p.damageAddition,
    pctBucket: SUN_WU_KONG.pctBucket,
    pen:       p.penetration,
    skillMult: SUN_WU_KONG.skillMult
  });
}
function isAllMeet (p: Panel,targets: readonly Target[]): boolean {
  return targets.every(t => ratiosOf(p,t.enemy).every(r => r >= 1));
}

// 突破先堆幸运到 50000(DESIGN.md §御灵师突破口径),返回需要多少次突破
function luckyBreakthroughs (): number {
  let lucky = 0,
n = 0;
  while (lucky < 50000) {
    n += 1;
    lucky += breakthroughValue(n);
  }
  return n;
}

// 最弱一环:所有敌人,所有三项约束里最小的那个(用于展示)
function marginOf (p: Panel,targets: readonly Target[]): number {
  let worst = Infinity;
  for (const t of targets) {
    for (const r of ratiosOf(p,t.enemy)) {worst = Math.min(worst,r);}
  }
  return worst;
}

// 探测范围(资源「个数」的数值上界)由最难目标的 HP 量级动态给出,不写死常数.
// 伤害对资源大致是平方/立方关系,HP 本身量级已足够覆盖可达标解.
function needProbeMax (targets: readonly Target[]): number {
  return Math.max(...targets.map(t => t.enemy.hp));
}
function ratiosOf (p: Panel,enemy: EnemyStats): [number,number,number] {
  return [
    damageOf(p,enemy) / enemy.hp,
    p.speed / Math.max(1,enemy.speed),
    (p.hit + TANG_SAN_ZANG_HIT) / Math.max(1,enemy.dodge)
  ];
}

// 求解目标:每个敌人三项各自的「对数达标进度」之和.
// 用 log10(比例) 而不是 min(1,比例):目标 HP 量级相差很大时,
// 线性口径会让难目标长期停在 0,贪心只看得到易目标；对数口径下两条曲线都能持续推进.
// 归一化:比例=1 → 0 分(已达标)；比例=1e-9 → -9 分.全部达标时 score=0.
function scoreOf (p: Panel,targets: readonly Target[]): number {
  let sum = 0;
  for (const t of targets) {
    for (const r of ratiosOf(p,t.enemy)) {

      // 下限只防 log10(0),不能把极小的比例提前 clamp 掉,否则最难的目标会被「冻结」而失明
      sum += Math.min(0,Math.log10(Math.max(r,1e-300)));
    }
  }
  return sum;
}
function shopPriceOf (prices: Map<number,number>,id: number): number {
  return shopPrice(prices.get(id) ?? 0,true);
}
function solve (base: Map<number,number>,property: Map<number,number>,targets: readonly Target[],
  alloc: AllocRes[]): SolveResult {
  const added = new Map<number,number>();
  const spent = new Map<number,number>();
  const final = new Map(base);
  let panel = panelOf(final,property);
  let score = scoreOf(panel,targets);
  const trace: SolveResult["trace"] = [];
  let cost = 0,
iterations = 0;
  const MAX_ITER = 600;
  while (!isAllMeet(panel,targets) && iterations < MAX_ITER) {
    let best: {gain: number; price: number; res: AllocRes; step: number} | null = null;
    const isResearchOn = panel.isResearchOn;
    for (const res of alloc) {
      const price = shopPrice(res.baseCost,isResearchOn);
      const cur = added.get(res.prop) ?? 0;
      const spend = Math.max(res.scale * price,cur * price * 0.25);
      const growStep = Math.max(1,Math.floor(spend / price));

      // 阈值型资源:步长必须能跨过「点满/升一级」的门槛,否则边际收益恒为 0
      const dynamic = res.stepFor ? res.stepFor(final.get(res.prop) ?? 0) : 0;
      const step = Math.max(growStep,res.minStep,dynamic);
      const trial = new Map(final);
      trial.set(res.prop,(trial.get(res.prop) ?? 0) + step);
      const gain = (scoreOf(panelOf(trial,property),targets) - score) / (step * price);
      if (gain > 0 && (best === null || gain > best.gain)) {best = {gain,price,res,step};}
    }
    if (best === null) {break;}
    final.set(best.res.prop,(final.get(best.res.prop) ?? 0) + best.step);
    added.set(best.res.prop,(added.get(best.res.prop) ?? 0) + best.step);
    const pay = best.step * best.price;
    spent.set(best.res.prop,(spent.get(best.res.prop) ?? 0) + pay);
    cost += pay;
    panel = panelOf(final,property);
    score = scoreOf(panel,targets);
    trace.push({margin: marginOf(panel,targets),name: best.res.name,step: best.step});
    iterations += 1;
  }
  return {added,cost,iterations,panel,spent,trace};
}

// 单独追加一种资源,二分求「两批敌人都可一击必杀」的最小追加量.
// 前置(速度/命中/研究)已完成,这里只需伤害 >= 两批 HP.
function solveSingleNeed (final: Map<number,number>,property: Map<number,number>,
  targets: readonly Target[],prop: number,_price: number): {count: number; feasible: boolean} {
  const isMeets = (n: number): boolean => {
    const t = new Map(final);
    t.set(prop,(t.get(prop) ?? 0) + n);
    const p = panelOf(t,property);
    return targets.every(x => damageOf(p,x.enemy) >= x.enemy.hp);
  };
  let hi = 1;

  // 探测上限由目标 HP/DEF 动态给出(见 NEED_PROBE_MAX):平方级杠杆可能需要极大资源量.
  // 突破/曲线/寒铁均已闭式化,探测不会卡死.
  while (hi < needProbeMax(targets) && !isMeets(hi)) {hi *= 2;}
  if (!isMeets(hi)) {return {count: Infinity,feasible: false};}
  let lo = 0;

  // 二分次数按区间量级动态给出,保证能收敛到个位
  const steps = Math.ceil(Math.log2(Math.max(2,hi))) + 2;
  for (let i = 0; i < steps; i += 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (isMeets(mid)) {hi = mid;} else {lo = mid + 1;}
  }
  return {count: hi,feasible: true};
}
const PROBE_COUNT = 1e6; // 统一探测量:每种资源追加 100 万个,再归一化到「每钱币」
function buildMarginalTable (final: Map<number,number>,property: Map<number,number>,
  targets: readonly Target[],alloc: AllocRes[],prices: Map<number,number>,
  hasNeed: boolean): {base: Panel; baseT: number; baseZ: number; rows: MarginRow[]} {
  const targetZ = targets[0];
  const targetT = targets[1];
  if (targetZ === undefined || targetT === undefined) {
    throw new Error("边际收益表需要两个目标");
  }
  const base = panelOf(final,property);
  const baseZ = damageOf(base,targetZ.enemy);
  const baseT = damageOf(base,targetT.enemy);
  const rows: MarginRow[] = [];
  for (const res of alloc) {
    const price = shopPriceOf(prices,res.prop);
    const trial = new Map(final);
    trial.set(res.prop,(trial.get(res.prop) ?? 0) + PROBE_COUNT);
    const after = panelOf(trial,property);
    const coins = PROBE_COUNT * price;
    const dmgZ = damageOf(after,targetZ.enemy);
    const dmgT = damageOf(after,targetT.enemy);
    const perCoinZ = (dmgZ - baseZ) / coins;

    // 单独达标量是可选的重计算(--need=1)；默认只出边际表,保持秒级
    const need = hasNeed && perCoinZ > 0
      ? solveSingleNeed(final,property,targets,res.prop,price)
      : {count: Infinity,feasible: false};
    rows.push({
      adds:      describeAdds(base,after),
baseT,
baseZ,
      coins,
count:     PROBE_COUNT,
      dmgT,
      dmgZ,
feasible:  need.feasible,
name:      res.name,
needCoins: need.feasible ? need.count * price : Infinity,
      needCount: need.count,
perCoinT:  (dmgT - baseT) / coins,
      perCoinZ,
prop:      res.prop,
      use:       res.dest
    });
  }
  rows.sort((x,y) => y.perCoinZ - x.perCoinZ);
  return {base,baseT,baseZ,rows};
}
function describeAdds (a: Panel,b: Panel): string {
  const parts: string[] = [];
  const add = (label: string,d: number): void => {
    if (Math.abs(d) > 1e-6) {parts.push(`${label} ${d >= 0 ? "+" : ""}${fmtShort(d)}`);}
  };
  add("最终攻击",b.finalAtk - a.finalAtk);
  add("穿透",b.penetration - a.penetration);
  add("命中",b.hit - a.hit);
  add("速度",b.speed - a.speed);
  add("伤害加成",b.damageAddition - a.damageAddition);
  add("攻击%",b.atkPct - a.atkPct);
  return parts.length > 0 ? parts.join("、") : "无变化（未跨过阈值）";
}
function main (): void {
  const args = parseArgs(process.argv.slice(2));
  const {prices,source: priceSource} = loadStorePrices(args);
  const alloc = buildAlloc(prices);
  const {pointPrice,property,rows,total: base} = buildInitialPool();

  // 两批敌人同时满足:终局第 5 关 + 试炼 1000 层
  const zhongju5 = ZHONG_JU.find(e => e.tiaoZhanID === 5);
  if (zhongju5 === undefined) {
    throw new Error("config/zhongju.json 里找不到 tiaoZhanID=5 的终局关卡");
  }
  const targets: Target[] = [
    {enemy: zhongju5,name: `终局第5关 (Boss ${zhongju5.bossID.join("/")})`},
    {enemy: trialEnemy(1000),name: "试炼 1000层"}
  ];
  console.log("===== 资源分配求解（起点仅：兑换码 + 通关点数）=====");
  console.log("目标：终局第5关 与 试炼1000层 同时满足 先手 / 100%命中 / 一击必杀（共 6 项约束）");
  for (const t of targets) {
    const e = t.enemy;
    console.log(`  ${t.name}：HP=${fmtShort(e.hp)} 防御=${fmtShort(e.def)} 速度=${fmtShort(e.speed)} 闪避=${fmtShort(e.dodge)} 减伤=${String(Math.min(e.damageReduce,80))}%（原始${String(e.damageReduce)}）`);
  }
  console.log(`单价来源：${priceSource}`);
  console.log(`\n--- 一、初始资源池（仅有 23 兑换码 + 35 项通关点数，总价 ${fmtShort(pointPrice)} 点）---`);
  for (const r of rows) {
    console.log(`  Prop${String(r.prop).padEnd(4)} ${r.name.padEnd(12)} 兑换码 ${fmtShort(r.fromCode).padStart(10)} + 点数 ${fmtShort(r.fromPoint).padStart(10)} = ${fmtShort(r.amount)}`);
  }
  console.log("  通关点数永久属性：攻击/防御/穿透/生命 +30%，命中/暴击/暴伤等按 exchange.json property 项计入");
  console.log("\n--- 二、研究增加的具体收入（借鉴 yingling-output.buildResearchPlan，节点来自 config/keji.json）---");
  console.log(`  点满 ${String(RESEARCH.steps)} 节点，共耗 ${fmtShort(RESEARCH.cost)} 历史本纪（俭以养德逐级 -1%）`);
  console.log(`  御灵石经验(48) +100% → 御灵宝典每本 100 → ${fmtShort(100 * RESEARCH.yuLingExpMult)} 御力（DESIGN.md 的 200 由此而来）`);
  console.log(`  图鉴经验(49) ×${String(RESEARCH.tuJianExpMult)}  炼器经验(16) ×${String(RESEARCH.lianQiExpMult)}  商店买价(44) -${String(RESEARCH.shopReduce)}%`);
  console.log(`  消耗减免：寒铁 -${String(RESEARCH.hanTieReduce)}%  五彩神石 -${String(RESEARCH.wucaiReduce)}%  强化石 -${String(RESEARCH.qiangHuaReduce)}%  灵纹 -${String(RESEARCH.zhenwenReduce)}%  御力升级 -${String(RESEARCH.yuLiReduce)}%`);
  console.log(`  面板加成：攻击 +${String(RESEARCH.atkPct)}%  命中 +${String(RESEARCH.hit)}  伤害加成 +${String(RESEARCH.damageAddition)}  阵法攻击 +${String(RESEARCH.zhenFaAtkPct)}%  装备属性 +${String(RESEARCH.equipPropertyPct)}%  图鉴增伤 +${String(RESEARCH.tuJianDamagePerLevel)}/级`);
  console.log(`  另点满 ${String(RESEARCH.dropNodes.length)} 个掉落/扫荡类节点（静态模型不模拟挂机掉落，不计入）：`);
  console.log(`    ${RESEARCH.dropNodes.map(d => `${d.label}(${String(d.id)}) Lv.${String(d.level)}`).join("、")}`);
  console.log("\n--- 三、商店可买项与单价（仅这些可追加）---");
  for (const a of alloc) {
    console.log(`  Prop${String(a.prop).padEnd(4)} ${a.name.padEnd(10)} 原价 ${String(a.baseCost).padStart(5)} → 研究后 ${String(shopPrice(a.baseCost,true)).padStart(5)} 钱币/个  →  ${a.dest}`);
  }
  console.log("  不可购买（锁定为初始水平）：图鉴卡片901-915、御力(4)、钱币(80)、元宝(95)、御力宝箱(21/29)");
  const basePanel = panelOf(base,property);
  console.log("\n--- 四、仅用初始资源的面板（「根本不够」）---");
  console.log(`  研究状态：${basePanel.isResearchOn ? "已点满" : "未点满"}（初始历史本纪 ${fmtShort(base.get(9) ?? 0)} < ${fmtShort(RESEARCH.cost)}）`);
  console.log(`  攻击 ${fmtShort(basePanel.finalAtk)}  命中 ${fmtShort(basePanel.hit + TANG_SAN_ZANG_HIT)}  速度 ${fmtShort(basePanel.speed)}  穿透 ${fmtShort(basePanel.penetration)}`);
  for (const t of targets) {
    const r = ratiosOf(basePanel,t.enemy);
    console.log(`  ${t.name}：伤害比 ${r[0].toExponential(3)}  速度比 ${r[1].toExponential(3)}  命中比 ${r[2].toExponential(3)}`);
  }
  const result = solve(base,property,targets,alloc);
  console.log(`\n--- 五、还需追加的资源分配（贪心 ${String(result.iterations)} 轮，总花费 ${fmtShort(result.cost)} 钱币）---`);
  console.log(`  研究状态：${result.panel.isResearchOn ? "已点满（收入倍率与减免已生效）" : "仍未点满"}`);
  let isAny = false;
  for (const a of alloc) {
    const add = result.added.get(a.prop) ?? 0;
    if (add <= 0) {continue;}
    isAny = true;
    const init = base.get(a.prop) ?? 0;
    const pay = result.spent.get(a.prop) ?? 0;
    console.log(`  ${a.name.padEnd(10)} 初始 ${fmtShort(init).padStart(10)} + 买 ${fmtShort(add).padStart(12)} = ${fmtShort(init + add).padStart(12)}  花费 ${fmtShort(pay).padStart(12)} 钱币（研究前后单价分别计）  →  ${a.dest}`);
  }
  if (!isAny) {console.log("  （无需追加）");}
  console.log("\n--- 六、各系统最终等级与属性贡献 ---");
  for (const b of result.panel.breakdown) {
    console.log(`  ${b.resource.padEnd(10)} → ${b.dest.padEnd(46)} 投入 ${fmtShort(b.amount).padStart(12)}  ${b.gain}`);
  }
  console.log("\n--- 七、最终面板 ---");
  const p = result.panel;
  console.log(`  攻击 ${fmtShort(p.finalAtk)}（攻击% ${String(p.atkPct)}）  命中 ${fmtShort(p.hit + TANG_SAN_ZANG_HIT)}  速度 ${fmtShort(p.speed)}  穿透 ${fmtShort(p.penetration)}  伤害加成 ${String(p.damageAddition)}`);
  console.log("  图鉴增伤不计入（研究54 仅通天塔生效，终局/试炼都不走该入口）");
  console.log("\n--- 八、双敌人达标判定（必须全部 ✓）---");
  for (const t of targets) {
    const e = t.enemy;
    const dmg = damageOf(p,e);
    const isOkFirst = p.speed > e.speed;
    const isOkHit = p.hit + TANG_SAN_ZANG_HIT >= e.dodge;
    const isOkShot = dmg >= e.hp;
    console.log(`  【${t.name}】 ${isOkFirst && isOkHit && isOkShot ? "全部达标 ✓" : "未全部达标 ✗"}`);
    console.log(`    先手    : 我方速度 ${fmtShort(p.speed)} ${isOkFirst ? "✓" : `✗ 需 > ${fmtShort(e.speed)}`}`);
    console.log(`    100%命中: 我方命中 ${fmtShort(p.hit + TANG_SAN_ZANG_HIT)} ${isOkHit ? "✓" : `✗ 需 >= ${fmtShort(e.dodge)}`}`);
    console.log(`    一击必杀: 单点非暴击 ${fmtShort(dmg)} ${isOkShot ? "✓" : `✗ 需 >= ${fmtShort(e.hp)}`}`);
  }
  console.log(`  结论：${isAllMeet(p,targets) ? "★ 6 项约束全部达标，两批敌人可同时击杀" : "✗ 仍有约束未达标（可能已达迭代上限或资源模型无法再提升）"}`);
  console.log(`  最弱一环余量 ${marginOf(p,targets).toExponential(3)}（>=1 即全部达标）`);
  if (result.trace.length > 0) {
    console.log("\n--- 九、边际分配轨迹（前 8 轮 + 末 3 轮）---");
    const head = result.trace.slice(0,8);
    const tail = result.trace.length > 8 ? result.trace.slice(-3) : [];
    for (const t of head) {
      console.log(`  ${t.name.padEnd(10)} 买 ${fmtShort(t.step).padStart(14)} → 最弱余量 ${t.margin.toExponential(3)}`);
    }
    if (tail.length > 0) {
      console.log("  ...");
      for (const t of tail) {
        console.log(`  ${t.name.padEnd(10)} 买 ${fmtShort(t.step).padStart(14)} → 最弱余量 ${t.margin.toExponential(3)}`);
      }
    }
  }
  console.log("\n参数：--save=N | --dir=存档路径");
  console.log("注：孙悟空配队乘区 skillMult/pctBucket 为待校准占位 1.0。");
}

// ---------------- 主输出:公式 → 前置 → 边际收益表 → 结论 ----------------
function printAnalysis (): void {
  const args = parseArgs(process.argv.slice(2));
  const {prices,source: priceSource} = loadStorePrices(args);
  const alloc = buildAlloc(prices);
  const {pointPrice,property,rows: pool,total: base} = buildInitialPool();
  const zhongju5 = ZHONG_JU.find(e => e.tiaoZhanID === 5);
  if (zhongju5 === undefined) {throw new Error("config/zhongju.json 找不到 tiaoZhanID=5");}
  const targets: [Target,Target] = [
    {enemy: zhongju5,name: `终局第5关 (Boss ${zhongju5.bossID.join("/")})`},
    {enemy: trialEnemy(1000),name: "试炼 1000层"}
  ];
  console.log("===== 伤害公式与资源边际收益表（起点仅：兑换码 + 通关点数）=====");
  console.log("\n--- 〇、伤害公式（game-formulas.oneShotDamage，已核对 Damage_Recorder.cs）---");
  console.log("  伤害 = finalAtk × (k/100) × (100+伤害加成)/100 × (100-减伤)/100");
  console.log("  k = culDamagePercent(finalAtk, max(1, 敌防御 - 穿透))");
  console.log("  finalAtk = atkFlat × (100+攻击%)/100 × (1 + 阵法等级/100)");
  console.log("  ⇒ 加 最终攻击/穿透 是平方级杠杆（既进基础伤害，又抬 k）；加 伤害加成 只是线性乘区。");
  console.log(`  单价来源：${priceSource}；起点资源池仅 ${String(pool.length)} 项兑换码+通关点数（总价 ${fmtShort(pointPrice)} 点）`);
  for (const t of targets) {
    const e = t.enemy;
    console.log(`  ${t.name}：HP=${fmtShort(e.hp)} (${e.hp.toExponential(4)}) 防御=${fmtShort(e.def)} (${e.def.toExponential(4)}) 速度=${fmtShort(e.speed)} 闪避=${fmtShort(e.dodge)} 减伤原始=${fmtShort(e.damageReduce)}→结算=${String(Math.min(e.damageReduce,80))}%`);
  }
  const {final,reqs} = computePrerequisites(base,property,prices,targets);
  console.log("\n--- 一、硬前置（必须先做，无法省；已按「达到该等级所需累计资源」反解）---");
  let preCoins = 0;
  for (const r of reqs) {
    preCoins += r.coins;
    console.log(`  ${r.name}`);
    console.log(`    为什么：${r.why}`);
    console.log(`    买 ${String(r.prop)} ${fmtShort(r.count)} 个 × ${String(r.unitCost)} 钱币 = ${fmtShort(r.coins)} 钱币`);
    console.log(`    加的属性：${r.effect}`);
  }
  console.log(`  前置合计 ${fmtShort(preCoins)} 钱币`);
  const prePanel = panelOf(final,property);
  console.log("\n--- 二、前置完成后的基线面板 ---");
  console.log(`  研究 ${prePanel.isResearchOn ? "已点满" : "未点满"}  最终攻击 ${fmtShort(prePanel.finalAtk)}  穿透 ${fmtShort(prePanel.penetration)}  命中 ${fmtShort(prePanel.hit + TANG_SAN_ZANG_HIT)}  速度 ${fmtShort(prePanel.speed)}  伤害加成 ${String(prePanel.damageAddition)}`);
  for (const t of targets) {
    const r = ratiosOf(prePanel,t.enemy);
    console.log(`  ${t.name}：伤害比 ${r[0].toExponential(3)}  速度比 ${r[1].toExponential(3)}  命中比 ${r[2].toExponential(3)}`);
  }

  // 防御系数 k 的实算诊断:全部从敌人 DEF 与面板穿透/攻击得出,不写死任何数值
  console.log("\n--- 二·补、防御系数 k 的实算诊断 ---");
  for (const t of targets) {
    const e = t.enemy;
    const defEff = Math.max(1,e.def - prePanel.penetration);
    const kNow = culDamagePercent(prePanel.finalAtk,defEff);
    const atkToLeave2 = defEff / 3;             // k>2 需 atk > DEF'/3
    const atkToReach100 = 3 * defEff;           // k=100 需 atk >= 3×DEF'
    const penToLeave2 = Math.max(0,e.def - 3 * prePanel.finalAtk); // 或靠穿透压低 DEF'
    console.log(`  ${t.name}：`);
    console.log(`    DEF'=max(1, 敌防御 − 穿透) = ${defEff.toExponential(4)}（敌防御 ${e.def.toExponential(4)} − 我方穿透 ${fmtShort(prePanel.penetration)}）`);
    console.log(`    当前 k = culDamagePercent(我方攻击 ${prePanel.finalAtk.toExponential(4)}, DEF') = ${String(kNow)}`);
    console.log(`    把 k 拉出最低档需：最终攻击 > ${atkToLeave2.toExponential(4)}（现为 ${prePanel.finalAtk.toExponential(4)}，差 ${(atkToLeave2 / Math.max(1,prePanel.finalAtk)).toExponential(3)} 倍）`);
    console.log(`             或 穿透 ≥ ${fmtShort(penToLeave2)}；k 拉满 100 需最终攻击 ≥ ${atkToReach100.toExponential(4)}`);
  }
  const hpRatios = targets.map(t => t.enemy.hp);
  const hpOrder = Math.abs(Math.log10(Math.max(...hpRatios) / Math.min(...hpRatios)));
  console.log(`  两批敌人 HP 相差 ${hpOrder.toFixed(2)} 个数量级 → 达标瓶颈由 HP 最大者决定。`);
  const isWithNeed = argString(args,"need") === "1";
  const {baseT,baseZ,rows} = buildMarginalTable(final,property,targets,alloc,prices,isWithNeed);
  console.log(`\n--- 三、逐资源逐用途边际收益表（每项统一追加 ${fmtShort(PROBE_COUNT)} 个，再归一化）---`);
  console.log(`  基线伤害：${targets.map((t,i) => `${t.name} ${fmtShort(i === 0 ? baseZ : baseT)}`).join(" / ")}`);
  for (const r of rows) {
    console.log(`\n  【${r.name}】→ ${r.use}`);
    console.log(`    追加 ${fmtShort(r.count)} 个 × 单价 ${fmtShort(r.coins / r.count)} = ${fmtShort(r.coins)} 钱币`);
    console.log(`    核查加的属性：${r.adds}`);
    const ratioPairs: [Target,number,number][] = [
      [targets[0],baseZ,r.dmgZ],[targets[1],baseT,r.dmgT]
    ];
    for (const [t,before,after] of ratioPairs) {
      console.log(`    ${t.name} 伤害比 ${(before / t.enemy.hp).toExponential(3)} → ${(after / t.enemy.hp).toExponential(3)}（伤害增量 ${fmtShort(after - before)}）`);
    }
    console.log(`    每 1 钱币伤害增量：${targets[0].name} ${r.perCoinZ.toExponential(3)} / ${targets[1].name} ${r.perCoinT.toExponential(3)}`);
    if (!isWithNeed) {continue;}
    const cap = fmtShort(needProbeMax(targets));
    console.log(`    单独靠它达标：${r.feasible ? `需 ${fmtShort(r.needCount)} 个 = ${fmtShort(r.needCoins)} 钱币` : `追加到 ${cap} 个仍不达标`}`);
  }
  const isSameDamage = Math.abs(baseZ - baseT) < Math.max(baseZ,baseT) * 1e-9;
  const allK = targets.map(t => culDamagePercent(prePanel.finalAtk,Math.max(1,t.enemy.def - prePanel.penetration)));
  const allReduce = targets.map(t => Math.min(t.enemy.damageReduce,80));
  console.log(`  注①：两批敌人当前 k = [${allK.join(", ")}]、结算减伤 = [${allReduce.join(", ")}]%，${isSameDamage ? "故单点伤害相同" : "单点伤害不同"}；但 HP 相差 ${hpOrder.toFixed(2)} 个数量级，达标难度看「伤害比」。`);
  for (const t of targets) {
    const defEff = Math.max(1,t.enemy.def - prePanel.penetration);
    console.log(`  注②：${t.name} 防御 ${t.enemy.def.toExponential(4)}，扣穿透后 DEF'=${defEff.toExponential(4)}；我方最终攻击 ${prePanel.finalAtk.toExponential(4)}，k=${String(culDamagePercent(prePanel.finalAtk,defEff))}。`);
  }
  console.log("       只加「伤害加成/命中」等线性或门槛属性不改变 DEF' 与我方攻击，抬不起 k；");
  console.log("       必须靠「最终攻击 + 穿透」把 k 拉出最低档（见二·补的实算门槛）。");
  if (isWithNeed) {
    console.log("\n--- 四、按「单独达标所需钱币」排序（越少越好）---");
    const byNeed = [...rows].toSorted((x,y) => x.needCoins - y.needCoins);
    for (const [i,element] of byNeed.entries()) {
      const r = element;
      const cost = r.feasible ? `${fmtShort(r.needCoins)} 钱币（${fmtShort(r.needCount)} 个）` : "不可单独达标";
      console.log(`  ${String(i + 1).padStart(2)}. ${r.name.padEnd(10)} ${cost.padEnd(34)} ${r.use}`);
    }
  }
  console.log(`\n--- ${isWithNeed ? "五" : "四"}、按「每钱币伤害增量」排序（边际效率，${targets[0].name} 口径）---`);
  for (const [i,row] of rows.entries()) {
    const r = row;
    console.log(`  ${String(i + 1).padStart(2)}. ${r.name.padEnd(10)} ${r.perCoinZ.toExponential(3)} /钱币   ${r.use}`);
  }
  console.log("\n  结论：优先投排序靠前、且加的是「最终攻击/穿透/阵法等级乘区」的资源；");
  console.log("  纯线性乘区（伤害加成）与硬门槛（命中）在达标后边际最低，不应继续堆。");
  console.log("\n参数：--save=N | --dir=存档路径 | --need=1（额外算单独达标量，较慢） | --mode=greedy（旧贪心）");
}
if (argString(parseArgs(process.argv.slice(2)),"mode") === "greedy") {
  main();
} else {
  printAnalysis();
}