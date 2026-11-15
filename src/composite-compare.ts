/**
 * composite-compare.ts — 复合方案对比(御灵宝典突破方向 × 阵法),独立成文件,只互相比较,不混入基础材料.
 * 复合方案 = 御灵宝典(指定突破方向) 与 阵法(天覆/鸟翔) 在相同钱币下各自全额购买后叠加;
 * 用 zhanli-panel 的 calcOutput 算输出,并用独立的 compositePanel 把百分比字段也计入乘区
 * (基础对比的 panelWithResult 只叠 Base_Value 层,会让攻击方向+天覆的 +15% 攻击被忽略,比较不公平);
 * 鸟翔阵的速度差伤害加成会注入御灵宝典速度方向(9)的固定值速度,体现「速度流」协同.
 * 运行:pnpm --config.verify-deps-before-run=false exec tsx src/composite-compare.ts
 */
import {niaoxiangzhenTozhanli,tianfuzhenTozhanli,yulingbaodianTozhanli} from "./calzhanli.ts";
import {MATERIAL_COST_PER_UNIT} from "./data.ts";
import {formatSuoXie} from "./readSave.ts";
import type {MasterPanel} from "./zhanli-panel.ts";
import {calcOutput,KEY_TO_PROP,loadMasterPanel} from "./zhanli-panel.ts";

interface CompositePlan {
  name:      string;
  yulingDir: number;            // 御灵宝典突破方向(PropertyTypeEnum):0 攻击 / 1 防御 / 2 生命 / 15 穿透 / 9 速度 / 11 幸运
  zhen:      "niaoxiang" | "tianfu"; // 阵法:天覆 / 鸟翔
}

/**
 * 复合方案对比:御灵宝典(突破方向)× 阵法(天覆/鸟翔),相同钱币下各自全额购买后叠加,
 * 按输出降序返回每个方案的结果(含 merged 原始字段 / 输出 / 提升率).
 * 鸟翔阵的速度差伤害加成会注入御灵宝典速度方向(9)的固定值速度,体现「速度流」协同.
 * @param money 投入的钱币总数(默认 1 亿)
 * @param mySpeed 我方速度(默认 0)
 * @param enemySpeed 敌方速度(默认 0)
 */
export function compareComposite (
  money = 1_0000_0000,
  mySpeed = 0,
  enemySpeed = 0
) {
  const books = maxBuyCount(MATERIAL_COST_PER_UNIT["御灵宝典"]!,money);
  const zhen = maxBuyCount(MATERIAL_COST_PER_UNIT["灵纹"]!,money);
  const plans: CompositePlan[] = [
    {name: "御灵宝典(速度)+鸟翔阵",yulingDir: 9,zhen: "niaoxiang"},
    {name: "御灵宝典(攻击)+天覆阵",yulingDir: 0,zhen: "tianfu"}
  ];
  const panel = loadMasterPanel();
  const baseline = calcOutput(panel);
  const rows = plans.map(plan => {
    const yl = yulingbaodianTozhanli(books,plan.yulingDir,4);

    // 速度方向突破给固定值 speed,注入鸟翔阵的速度差,体现协同
    const ylSpeed = plan.yulingDir === 9 ? yl.speed : 0;
    const zf = plan.zhen === "niaoxiang"
      ? niaoxiangzhenTozhanli(zhen,mySpeed + ylSpeed,enemySpeed)
      : tianfuzhenTozhanli(zhen);
    const merged = mergeResults(yl,zf);
    const out = calcOutput(compositePanel(panel,merged));
    const gain = baseline.damage > 0 ? (out.damage - baseline.damage) / baseline.damage : 0;
    return {gain,merged,name: plan.name,out};
  });
  rows.sort((a,b) => b.out.damage - a.out.damage);
  return rows;
}

// 直接打印复合方案对比:每行一条中文,列 攻击/速度/伤害加成%/攻击百分比/输出/提升率,只互相比较.
export function printComposite (
  money = 1_0000_0000,
  mySpeed = 0,
  enemySpeed = 0
): void {
  const books = maxBuyCount(MATERIAL_COST_PER_UNIT["御灵宝典"]!,money);
  const zhen = maxBuyCount(MATERIAL_COST_PER_UNIT["灵纹"]!,money);
  const panel = loadMasterPanel();
  const baseline = calcOutput(panel);
  console.log("=== 复合方案对比(御灵宝典方向 × 阵法,只互相比较) ===");
  console.log(`御灵宝典本数=${formatSuoXie(books)} 灵纹数=${formatSuoXie(zhen)} 我方速度=${String(mySpeed)} 敌方速度=${String(enemySpeed)}`);
  console.log(`存档:${panel.dir} 基准输出=${formatSuoXie(baseline.damage)}`);
  for (const row of compareComposite(money,mySpeed,enemySpeed)) {
    const r = row.merged;
    const fields = [
      `攻击=${formatSuoXie(r.atk ?? 0)}`,
      `速度=${formatSuoXie(r.speed ?? 0)}`,
      `伤害加成%=${formatSuoXie(r.damageAddition ?? 0)}`,
      `攻击百分比=${formatSuoXie(r.atkPercent ?? 0)}`
    ].join(" ");
    console.log(`${row.name} ${fields} 输出=${formatSuoXie(row.out.damage)} 提升=${(row.gain * 100).toFixed(4)}%`);
  }
}

// 独立面板:基础属性(含 percent=1 的百分比点数)进 Base_Value 层,xxxPercent(PercentAddition 类)进 PercentAddition 层,
// 让御灵宝典突破与阵法的百分比加成进入乘区;zhenFaAttackPercent 等非基础百分比字段会被忽略(与基础口径一致).
function compositePanel (panel: MasterPanel,result: object): MasterPanel {
  const base = [...panel.base];
  const pct = [...panel.pct];
  for (const [key,value] of Object.entries(result)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    const propBase = KEY_TO_PROP[key];
    if (propBase !== undefined) {
      base[propBase] = (base[propBase] ?? 0) + value;
      continue;
    }
    if (key.endsWith("Percent")) {
      const core = key.slice(0,-"Percent".length);
      const propPct = KEY_TO_PROP[core];
      if (propPct !== undefined) {
        pct[propPct] = (pct[propPct] ?? 0) + value;
      }
    }
  }
  return {base,dir: panel.dir,pct,zhenFaID: panel.zhenFaID};
}

// 整批一次取整(与基础对比同一口径):求最大 N 使 Math.round(单价×N) ≤ money.
function maxBuyCount (unit: number,money: number): number {
  let low = 0;
  let high = Math.max(1,Math.floor((money + 0.5) / unit) + 1);
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Math.round(unit * mid) <= money) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
}

// 把两个 tozhanli 结果按字段数值相加(固定值与百分比分开累加,过程量也相加但不参与面板).
function mergeResults (a: object,b: object): Record<string,number> {
  const out: Record<string,number> = {};
  for (const [k,v] of Object.entries(a)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = v;
    }
  }
  for (const [k,v] of Object.entries(b)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = (out[k] ?? 0) + v;
    }
  }
  return out;
}

// 直接执行本文件时只打印复合方案对比.
printComposite();