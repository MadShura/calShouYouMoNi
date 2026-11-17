/**
 * finalCal-report.ts — finalCal 的打印/写文件逻辑(从 finalCal.ts 拆出).
 * 只负责把 simulateHero 的结果格式化并写入 output,不含任何计算.
 */
import {writeFileSync} from "node:fs";
import {
  CB_TU_CAP,DK_PROFIT_PER_ROUND,ENEMY_HP,fmt,GROUP_PLANS,MAP_ORDER,
  nfmt,PRE_ROUTE,simulateHero,WUKONG_SEC,YUNXIAO_SEC,ZHUAN_SHENG_MAX
} from "./finalCal.ts";
import {cacheFlush,cacheSize} from "./calc-cache.ts";
import type {GroupPlan,HourRecord,SimSnap} from "./types.ts";

const MAX_HOURS = 10_0000; // 模拟上限(≈11.4年)

// judge=false 单小时记录格式化:面板摘要 + 每个步骤的执行/变化明细.
export function formatHourRecord (rec: HourRecord): string {
  const {check: c,panel: p} = rec;
  const head = `h=${String(rec.hour)} 面板[基础攻 ${fmt(p.baseAtk)} 攻% ${fmt(p.atkPct)} 命中 ${fmt(c.hit)} `
    + `速度 ${fmt(c.speed)} 伤害 ${fmt(c.damage)} 突破 ${fmt(p.breaks)} 御灵宝典 ${nfmt(p.books)}] `
    + `三条件[命中${c.hitOk ? "✓" : "✗"} 速度${c.speedOk ? "✓" : "✗"} 秒杀${c.killOk ? "✓" : "✗"}]`;
  const steps = rec.steps.map(s => `    ${s.fired ? "●" : "○"} ${s.step}: ${s.detail}`).join("\n");
  return `${head}\n${steps}`;
}
export function main (): void {
  writeSummary();
  writeDetail();
  console.log(`[缓存] ${String(cacheSize())} 条 → output/calc-cache.json`);
  cacheFlush();
}

// 输出单组完整推导(逐项写来源).
function logDetail (log: (s: string) => void,item: GroupPlan,snap: SimSnap): void {
  const {check,drops,layers,panel,shop,vip} = snap;
  const cj = snap.choujiang;
  log(`\n### ${item.name} — ${nfmt(snap.hours)} 小时${snap.reached ? "(达标跳出)" : "(达上限未达标)"}`);
  const layerText = MAP_ORDER.filter(m => layers[m] !== undefined)
    .map(m => `${String(m)}:${nfmt(layers[m] ?? 0)}层`)
.join("、");
  log(`**① 推层路线(春秋蝉最大利用率)**:${layerText};合计 ${nfmt(Object.values(layers).reduce((s,v) => s + v,0))} 层。`);
  log(`  - 前置路线:${PRE_ROUTE.map(([m,t]) => `${String(m)}图→${t < 0 ? "一直打" : `${nfmt(t)}层`}`).join(" → ")};每步按 ${String(item.sec)}秒/层算实际时间,累加后上移到整数小时。`);
  log(`**② 前置抽奖阶梯**:抽数 Lv1×1000、Lv3×4000、Lv4×5000、Lv5×20000、Lv5×20000;共 ${nfmt(cj.draws)} 抽(组A ${nfmt(cj.pool3Hit)} / 组B ${nfmt(cj.pool4Hit)} 期望高者);`);
  log(`  - 奖池权重期望按 JiangChi_Data_Json.txt 6级行权重‰计;抽奖券(prop10)仅地图/扫荡掉落产出,累计获得 ${nfmt(snap.ticketDrawn)} 张。`);
  log(`**③ 逐小时行动**:点卡每小时 +${nfmt(DK_PROFIT_PER_ROUND)} 钱币,共 ${nfmt(snap.hours)} 轮;`);
  log("  - 任务奖励:4h 刷新达成式任务,奖励道具配置 TaskData_Json.txt 不在工作区,本计算仅计可确定的里程碑骨架(见口径);");
  log(`  - 每 8h(${nfmt(snap.zhenyingRounds)} 次)核查抽奖(两组选期望高)、阵营;每 10h(${nfmt(snap.xunbaoRounds)} 次)核查寻宝(源码 RefreTime_min*60=36000s);两类结算点均先购物再结算(新翅膀等级).`);
  log(`**④ 购物正反馈**:结算点 ${nfmt(shop.events)} 个,买 4 翅膀 ${nfmt(shop.buyWing)} 组/孟婆汤 ${nfmt(shop.buyMengpo)} 组/藏宝图 ${nfmt(shop.buyCangbaotu)} 个,花 ${nfmt(shop.spentShopping)} 元宝;`);
  log(`  - 翅膀1/2/3/4 = [${shop.wing.map(nfmt).join("、")}];转生 ${String(shop.zhuan)}/${String(ZHUAN_SHENG_MAX)},藏宝图 ${String(shop.cangbaotu)}/${String(CB_TU_CAP)};`);
  log(`  - 翅膀4 寻宝大奖+5%/级无封顶+翻倍%、翅膀3 阵营+5%/级、翅膀2 装备四维75+25L、翅膀1 挂机掉元宝 ${nfmt(shop.wingYuanbao)}。`);
  log(`**⑤ VIP**:购物剩余元宝 ${nfmt(vip.yuanbao)} → VIP ${String(vip.level)}(每2级+1命中/暴击 → +${String(vip.hitCrit)});`);
  log(`**⑥ 挂机+寻宝掉落**:${["钱币","寒铁","灵纹","御灵宝典","强化石","灵晶","历史本纪","御力","神通卷轴","三味真火","忘情水"]
    .map(k => `${k} ${nfmt(drops[k] ?? 0)}`).join("｜")}。`);
  log(`  - 扫荡累计 ${nfmt(snap.sweepHours)} 小时(春秋蝉1个=1小时,通天塔敌人不能一击秒杀时补);寻宝 ${nfmt(snap.xunbaoRounds)} 轮、阵营 ${nfmt(snap.zhenyingRounds)} 轮。`);
  log(`**⑦ 资源转面板**:御灵宝典 ${nfmt(panel.books)} → 突破 ${fmt(panel.breaks)};寒铁打造耗时按 min(30,3+0.2×炼器级),翅膀2等级参与装备四维;`);
  log(`  - 基础攻 ${fmt(panel.baseAtk)}、攻击% ${fmt(panel.atkPct)}、命中 ${fmt(panel.hitFlat)}、速度 ${fmt(panel.speed)}。`);
  log(`  - 本组突破分配(allocate):保掉落幸运 ${fmt(check.capBreaks)} / 命中幸运 ${fmt(check.luckyBreaks)} / 攻击 ${fmt(check.atkBreaks)} / 穿透 ${fmt(check.penBreaks)} / 速度 ${fmt(check.speedBreaks)};鸟翔速度差增伤 ${fmt(check.dmgAddExtra)}。`);
  log(`**⑧ 三条件判定**:命中 ${fmt(check.hit)}${check.hitOk ? "✓" : "✗"} / 速度 ${fmt(check.speed)}${check.speedOk ? "✓" : "✗"} / 伤害 ${fmt(check.damage)}${check.killOk ? "✓" : "✗"}(敌HP ${fmt(ENEMY_HP)});`);
  log(`  - **结论:${check.pass ? "可击败终局第5层" : "打不过"}**。`);
}
function writeDetail (): void {
  const detail: string[] = [
    "# finalCal — 逐小时详细执行记录(judge=false,每组前100小时)",
    "- 每小时输出当前面板/三条件 + 每个步骤(点卡/购物/抽奖/阵营/寻宝/地图/属性/扫荡)的触发与资源变化。●触发 ○未触发。",
    "- 周期:点卡/购物/扫荡/属性/判定每小时;抽奖/阵营/地图8h;寻宝10h。"
  ];
  for (const [idx,item] of GROUP_PLANS.entries()) {
    detail.push("",`## 组${String(idx + 1)} ${item.name}`);
    simulateHero(item,MAX_HOURS,false,idx + 1,(rec): void => {detail.push(formatHourRecord(rec));});
  }
  writeFileSync(new URL("../output/finalCal-detail.md",import.meta.url),`${detail.join("\n")}\n`,"utf8");
  console.log("[已写出] output/finalCal-detail.md");
}
function writeSummary (): void {
  const lines: string[] = [];
  const log = (s: string): void => {lines.push(s); console.log(s);};
  log("# finalCal — 逐小时大循环:挂机收益与终局第 5 层判定");
  log("");
  log("## 1. 计算口径与公式来源");
  log("- 逐小时大循环(finalcal.md):去掉 BASE_HOURS/二分,前置固定推层路线(为春秋蝉最大利用率),上移整数小时后逐小时行动,第一次满足三条件即跳出。");
  log(`- 前置推层:${PRE_ROUTE.map(([m,t]) => `${String(m)}图→${t < 0 ? "一直打" : `${nfmt(t)}层`}`).join(" → ")};每步 sec/层算实际时间(孙悟空 ${String(WUKONG_SEC)}s、云霄 ${String(YUNXIAO_SEC)}s,余数单独记录确保准确)。`);
  log("- 前置抽奖:1000抽Lv1、4000抽Lv3、5000抽Lv4、20000抽Lv5、20000抽Lv5;奖池权重期望来自游戏目录 JiangChi_Data_Json.txt(6级).");
  log("- 每小时:任务奖励(4h刷新,配置不可得部分说明)/点卡(每1h净赚38.5万钱币)/元宝购物(8h与10h结算点核查)/抽奖(8h,两组选期望高)/阵营(8h)/寻宝(10h)/地图掉落/扫荡(每1h判定,不能秒杀时春秋蝉1个=1h)/物资转面板/三条件判定.");
  log("- 购物正反馈:攒够整组买4翅膀(各2个/48888)+孟婆汤(2个/46888够转生不买)+藏宝图(1个/25888满974不买);翅膀买了立即升级,寻宝大奖+5%/级、阵营+5%/级、装备四维75+25L,剩余元宝升VIP.");
  log("- 抽奖券(prop10)只从地图/扫荡掉落产出;寻宝10h一轮(源码 RefreTime_min*60=36000s,非 Time_Per_Round),每格固定256万×权重‰(藏宝图补满必掉)×翻倍期望.");
  log("- 寒铁打造按时间串行:单件 min(30秒,3+0.2×炼器级);神兵默认23件全解锁;突破先堆幸运5W确保掉落100%.");
  log("- 三条件:命中100% + 速度更快 + 一击必杀(伤害≥敌HP);任务奖励道具配置不在工作区,仅计可确定骨架.");
  log("- 队伍:各组队内 三藏/沙僧/八戒/神林冲 提供西行羁绊;命中/攻击/伤害的英灵技能乘区按组(悟空走人皇印链,云霄走普攻80%链)。神林冲无独立面板加成配置,其间接效果并入西行羁绊口径,不单列.");
  log("- 资源分配架构:大循环与伤害链通用;每组自带 allocate 方法决定余下突破投幸运/攻击/穿透/速度。组1悟空天覆突破幸运(补速后余下全幸运走命中链);组2云霄天覆突破攻击;组3云霄天覆突破穿透;组4云霄鸟翔突破速度(速度差转增伤,速度到顶金币只换灵纹).");
  log("");
  log("## 2. 逐组结果(逐项推导)");
  for (const item of GROUP_PLANS) {
    logDetail(log,item,simulateHero(item,MAX_HOURS));
  }
  writeFileSync(new URL("../output/finalCal.md",import.meta.url),`${lines.join("\n")}\n`,"utf8");
  console.log("\n[已写出] output/finalCal.md");
}