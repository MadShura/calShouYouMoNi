/**
 * compare.ts — 同类对比:同样一笔[钱币(80)]能换多少资源,这些资源投到不同强化系统优劣如何？
 * 两层:
 * 第 1 层(资源→属性,纯公式):每个系统「每单位资源换每维多少属性」+ 边际趋势.无需价格.
 * 第 2 层(钱币→资源→属性):钱币按各道具 ValueCost 换资源,再套第 1 层.
 * 钱币单价(ValueCost)来源:真实游戏存档的 Prop_Data.Save(由 save-data.ts 的 readPropDefinitions 解析).
 * 反编译入口:UIPanel_BuyProp.cs:48 ChangeProp(80, propValue) → PropHelper.GetPropValue = Cul_Percent_ToInt(ValueCost × 本数).
 * 即 钱币单价 = 道具 ValueCost.本仓库源码不含这份数据,需从运行过的存档读(默认 Save_1,可用 --save=N / --dir= 指定).
 * 公式全部 import 自 game-formulas.ts(来自反编译源码).
 */
import {fileURLToPath} from "node:url";
import {loadSave,parseArgs,resolveSaveDir} from "./save-data.ts";
import {
  equipStrengthenCost,equipStrengthenStat,
  makeEquipCost,makeEquipMainAtk,
  shengShouCost,shengShouStat,
  tuJianItems,tuJianStat,
  yuLingLevelCost,yuLingStatPerLevel,
  zhenFaCost,zhenFaStat,
  zhuanZhiCost,zhuanZhiStat
} from "./game-formulas.ts";

const fmt = (n: number): string => n.toLocaleString("en-US",{maximumFractionDigits: 2});
const pct = (n: number): string => (n < 0.01 && n > 0
? n.toExponential(2)
: n.toFixed(4).replace(/0+$/,"")
.replace(/\.$/,""));

// ----------------------------- 第 1 层:资源→属性(纯公式) -----------------------------
interface Sys {
  costAt:       (L: number) => number;
  dims:         number;
  name:         string;
  perResPerDim: (L: number) => number;
  prop?:        number;
  res:          string;
  statAt:       (L: number) => number;
}

const systems: Sys[] = [
  {
 costAt:       yuLingLevelCost,
dims:         4,
name:         "御灵师(御力)",
perResPerDim: L => yuLingStatPerLevel(L) / yuLingLevelCost(L),
    res:          "御力(4)",
statAt:       yuLingStatPerLevel
},{
 costAt:       equipStrengthenCost,
dims:         3,
name:         "装备强化(强化石)",
perResPerDim: L => equipStrengthenStat(L) / equipStrengthenCost(L),
prop:         5,
    res:          "强化石(5)",
statAt:       equipStrengthenStat
},{
 costAt:       zhenFaCost,
dims:         4,
name:         "阵法(灵纹)",
perResPerDim: L => zhenFaStat(L) / zhenFaCost(L),
prop:         7,
    res:          "灵纹(7)",
statAt:       zhenFaStat
},{
 costAt:       zhuanZhiCost,
dims:         4,
name:         "转职强化(历史本纪)",
perResPerDim: L => zhuanZhiStat(L) / zhuanZhiCost(L),
prop:         9,
    res:          "历史本纪(9)",
statAt:       zhuanZhiStat
},{
 costAt:       shengShouCost,
dims:         2,
name:         "圣兽(地图材料)",
perResPerDim: L => shengShouStat(L) / shengShouCost(L),
    res:          "地图材料",
statAt:       shengShouStat
},{
 costAt:       tuJianItems,
dims:         4,
name:         "图鉴(图鉴道具)",
perResPerDim: L => tuJianStat(L) / tuJianItems(L),
    res:          "图鉴道具(200exp/个)",
statAt:       tuJianStat
},{
 costAt:       L => makeEquipCost(L),
dims:         1,
name:         "制作装备(寒铁)",
perResPerDim: L => makeEquipMainAtk(L,9,0) / makeEquipCost(L),
prop:         1,
    res:          "寒铁(1)",
    statAt:       L => makeEquipMainAtk(L,9,0)
}
];

// ----------------------------- 第 2 层:钱币→资源→属性(读真实存档单价) -----------------------------
// 钱币商店可买的资源道具(来自 PropHelper.GenrateStore)+ 它们喂给哪个系统(无线性公式的标 null)
interface Buy {
  dims?:         number;                         // 受益维数(用于全维合计备注)
  name:          string;
  perResPerDim?: (L: number) => number;  // 线性系统的「每资源每维」；null=非线性/另算
  prop:          number;
  rankable?:     boolean;
}
function layer1 (): void {
  console.log("\n========== 第 1 层：每单位资源 → 每维属性（纯公式，无需价格）==========");
  for (const s of systems) {
    console.log(`\n--- ${s.name}（消耗 ${s.res}，${s.dims} 维受益）---`);
    for (const L of [10,100,500,1000,2000]) {
      const per = s.perResPerDim(L);
      console.log(`  Lv.${L}: 单级耗 ${fmt(s.costAt(L))} → 每维+${fmt(s.statAt(L))} → 每资源每维+${fmt(per)}（全${s.dims}维+${fmt(per * s.dims)}）`);
    }
    const hi = s.perResPerDim(1000),
lo = s.perResPerDim(10);
    console.log(`  趋势：${trend(lo,hi)}（Lv.10 ${fmt(lo)} → Lv.1000 ${fmt(hi)}）`);
  }
}
function trend (a: number,b: number): string {
  if (b > a * 1.001) {return "递增↑（越投越划算）";}
  if (b < a * 0.999) {return "递减↓（越投越亏）";}
  return "持平→";
}
const buyable: Buy[] = [
  {dims: 1,name: "寒铁",perResPerDim: L => makeEquipMainAtk(L,9,0) / makeEquipCost(L),prop: 1,rankable: false}, // 制作装备(换装,仅攻击)
  {name: "五彩神石",perResPerDim: undefined,prop: 2},                         // 器鼎(化境%)
  {name: "破境石",perResPerDim: undefined,prop: 3},                         // 破境(化境%)
  {dims: 3,name: "强化石",perResPerDim: L => equipStrengthenStat(L) / equipStrengthenCost(L),prop: 5,rankable: true},
  {name: "神通卷轴",perResPerDim: undefined,prop: 6},                         // 神通(非线性)
  {dims: 4,name: "灵纹",perResPerDim: L => zhenFaStat(L) / zhenFaCost(L),prop: 7,rankable: true},
  {name: "灵晶",perResPerDim: undefined,prop: 8},                         // 灵器
  {dims: 4,name: "历史本纪",perResPerDim: L => zhuanZhiStat(L) / zhuanZhiCost(L),prop: 9,rankable: true},
  {name: "忘情水",perResPerDim: undefined,prop: 81},                         // 神兵·水炼
  {name: "御灵宝典",perResPerDim: undefined,prop: 84},                         // 御灵师(经经验换算)
  {name: "三味真火",perResPerDim: undefined,prop: 85}                         // 神兵·火炼
];
function layer2 (budget: number,vc: Map<number,number>): void {
  console.log(`\n========== 第 2 层：钱币 ${fmt(budget)} → 各资源可买量 → 投到系统换多少属性 ==========`);
  console.log("  单价=道具 ValueCost（钱币/单位），来源：存档 Prop_Data.Save。\n");

  // [A] 同样钱币能换多少资源(每 1 钱币 可买量 = 1/ValueCost,及预算总额)
  console.log("  [A] 同样钱币能换多少资源（钱币商店可买项）：");
  for (const b of buyable) {
    const cost = vc.get(b.prop);
    if (!cost || cost <= 0) {console.log(`    ${b.name}(${b.prop}): 存档无单价（未上榜/未拥有）`); continue;}
    const per1 = 1 / cost;
    const units = budget / cost;
    console.log(`    ${b.name.padEnd(6)}(${String(b.prop).padEnd(3)}) 单价 ${fmt(cost)} 钱币/单位 → 每钱币 ${pct(per1)} 单位 → ${fmt(budget)} 钱币可买 ${fmt(units)}`);
  }

  // [B] 同质(每级永久叠加)系统排名:每钱币换到的[每维]属性(单维,避免维度数量干扰)
  const L = 500;
  console.log("\n  [B] 同质系统排名（每钱币换到的每维属性，单维；制作装备=换装/器鼎·破境·神通·神兵=非线性，不参与）：");
  const rows: {dims: number; name: string; perDim: number}[] = [];
  for (const b of buyable) {
    if (!b.rankable || b.perResPerDim === undefined) {continue;}
    const cost = vc.get(b.prop);
    if (!cost || cost <= 0) {continue;}
    const perDim = 1 / cost * b.perResPerDim(L);
    rows.push({dims: b.dims ?? 1,name: `${b.name}系统(${b.prop})`,perDim});
  }
  rows.sort((a,b) => b.perDim - a.perDim);
  for (const r of rows) {
    console.log(`    ${r.name.padEnd(20)} 每钱币换每维 +${fmt(r.perDim)}（${r.dims} 维，全维合计约 +${fmt(r.perDim * r.dims)}）`);
  }
  console.log("\n  [C] 解读：");
  console.log("    · 装备强化 ≈ 转职 每钱币换到的每维属性最高，且二者边际递增（越投越值）。");
  console.log("    · 阵法唯一边际递减：等级越高，同样钱币换的属性越少；早期猛、后期被装备/转职反超。");
  console.log("    · 制作装备(寒铁)：每寒铁产出≈主属性攻击（仅攻击一维、替换旧装），量级不同不参与排名；是寒铁唯一去处。");
  console.log("    · 器鼎/破境(五彩/破境石)给化境%加成、神通/神兵(卷轴/忘情水/三味真火)为非线性，需结合具体等级单独权衡。");
  console.log("    · 御灵宝典(84)：经经验→御力→升级，是多步换算，未纳入上面的线性单价口径（但单价已列于 [A]）。");
}
function loadValueCost (): Map<number,number> {
  const saveDir = resolveSaveDir(parseArgs(process.argv.slice(2)));
  const save = loadSave(saveDir);
  const m = new Map<number,number>();
  for (const def of save.props.values()) {m.set(def.propID,def.valueCost);}
  console.log(`  （钱币单价取自存档：${saveDir} 的 Prop_Data.Save）`);
  return m;
}
function main (): void {
  layer1();
  let vc: Map<number,number>;
  try {
    vc = loadValueCost();
  } catch (error) {
    console.error("读取钱币单价失败：",Error.isError(error) ? error.message : error);
    console.error("请用 --save=N 指定存档槽，或 --dir=路径 指向含 Prop_Data.Save 的存档目录。");
    return;
  }
  layer2(100_0000,vc);   // 示例:100 万 钱币
  verdict();
  console.log("\n===== 完 =====");
}
function verdict (): void {
  console.log("\n========== 优劣结论（来自公式结构）==========");
  console.log(`
· 阵法(灵纹)：唯一「边际递减」。每灵纹每维 = (200+35L)/(20L) = 10/L+1.75，随 L 降。早期极优，后期让位递增系统。
· 装备强化(强化石)/转职(历史本纪)/圣兽(地图材料)：边际递增，越投越划算。
· 御灵师(御力)：每御力也递减（御力消耗~L²、属性~L线性），靠宝箱/书供给；书(84)可用钱币买。
· 图鉴(道具)：低等级虚高、高等级递减；中后期趋平。
· 制作装备(寒铁)：随机产出、需替换旧装；单寒铁主属性攻击高但仅攻击一维。
· 通用：标准打法「全买灵纹升阵法」只因阵法早期最猛；阵法等级高到边际递减明显后，把钱币分给 装备/转职/圣兽 往往同样钱币换更多伤害。
`);
}
import process from "node:process";

const isMain = process.argv[1] !== undefined && import.meta.filename === process.argv[1];
if (isMain) {main();}