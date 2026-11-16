/**
 * composite-compare.ts — 复合方案对比(御灵宝典突破方向 × 阵法),独立成文件,只互相比较,不混入基础材料.
 * 复合方案 = 御灵宝典(指定突破方向) 与 阵法(天覆/鸟翔) 在相同钱币下各自全额购买后叠加;
 * 用 zhanli-panel 的 calcOutput 算输出,并用独立的 compositePanel 把百分比字段也计入乘区
 * (基础对比的 panelWithResult 只叠 Base_Value 层,会让攻击方向+天覆的 +15% 攻击被忽略,比较不公平);
 * 鸟翔阵的速度差伤害加成会注入御灵宝典速度方向(9)的固定值速度,体现「速度流」协同.
 * 另含一组「孙悟空神+4人西游 Lv.3(人皇印队)」命中增伤链对比:御灵幸运+天覆阵 vs 御灵速度+鸟翔阵,
 * 目标终局第 5 层,按先手+100% 命中口径只对比伤害;该组从零面板起步(不读存档),队伍加成照人皇印队保留.
 * 运行:pnpm --config.verify-deps-before-run=false exec tsx src/composite-compare.ts
 */
import {niaoxiangzhenTozhanli,tianfuzhenTozhanli,yulingbaodianTozhanli} from "./calzhanli.ts";
import {MATERIAL_COST_PER_UNIT} from "./data.ts";
import {formatSuoXie} from "./readSave.ts";
import {oneShotDamage} from "./scripts/game-formulas.ts";
import type {MasterPanel} from "./zhanli-panel.ts";
import {calcOutput,ENEMY_5,finalValue,KEY_TO_PROP,loadMasterPanel,PROP_COUNT} from "./zhanli-panel.ts";

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

// ====================== 孙悟空神 + 4 人西游 Lv.3(人皇印队)命中增伤链对比 ======================
// 口径(全部来自反编译源码,见 src/反编译):
// - 命中 = 面板命中 + 唐三藏 30 + ⌊幸运/100⌋×5(Entry_Skill_1051.cs,BigInteger 整除,无上限);
// - 命中喂三条独立乘区(都进 PercentAddition,各自 1+p/100):
//   · 孙悟空3技能 skill78:+(int)命中(Entry_Skill_78.cs,无显式上限,此处按源码保留原值);
//   · 神通15:命中×Base×等级/10,源码 if>2147483647 则夹到 2147483637(Entry_ShenTong_3.cs);
//   · 西行取经 Lv.3:max(0,命中-敌闪避+猪八戒20)×(0.25+0.25×3),无显式上限(Entry_XiXingQuJing.cs);
//   skill78/西行取经源码靠 (int) 强转,命中达千亿级会整数溢出,此处照源码公式保留数学值以完成对比.
// - 人皇印队含武松:攻击桶 +20%、伤害加成桶 +35;唐三藏 +30 命中;猪八戒 -20 敌闪避;
// - 面板从零起步(18 项全 0,不读存档),队伍加成照人皇印队保留;目标终局第 5 层(ENEMY_5);
//   先手+100% 命中已满足,只对比伤害,不判命中率;击杀仅作参考.
const WUKONG_TANG_HIT = 30;
const WUKONG_ZHU_DODGE_DOWN = 20;
const XI_XING_LV3_RATE = 0.25 + 0.25 * 3;
const SHEN_TONG_15_CAP = 21_4748_3637;
const WU_SONG_ATK_PERCENT = 20;
const WU_SONG_DAMAGE_ADD = 35;

interface WukongPlan {
  name:      string;
  yulingDir: number;            // 11 幸运 / 9 速度
  zhen:      "tianfu" | "niaoxiang";
}

interface WukongRow {
  name:        string;
  lucky:       number;
  speed:       number;
  hit:         number;
  shenTong15:  number;
  xiXingPct:   number;
  zhenSpeedDmg: number;
  damage:      number;
  kill:        boolean;
}

/**
 * 单条「孙悟空神+西游 Lv.3」方案的伤害:按命中增伤链算 pctBucket,交给 oneShotDamage 打终局第 5 层.
 * panel 为零面板;merged 含御灵突破与阵法增量,compositePanel 把攻/穿透/幸运/伤害加成等计入面板两层.
 */
function wukongDamage (panel: MasterPanel,result: Record<string,number>): Omit<WukongRow,"name"> {
  const p = compositePanel(panel,result);
  const lucky = finalValue(p,17);
  const speed = finalValue(p,3);
  const hit = finalValue(p,4) + WUKONG_TANG_HIT + Math.trunc(lucky / 100) * 5;
  const xiXingPct = Math.trunc(
    Math.max(0,hit - (ENEMY_5.dodge - WUKONG_ZHU_DODGE_DOWN)) * XI_XING_LV3_RATE
  );
  const shenTong15 = Math.min(hit,SHEN_TONG_15_CAP);
  const critAdd = p.zhenFaID === 6 ? 30 : 0;
  const mustCrit = (finalValue(p,6) - ENEMY_5.critResist + critAdd + 1) / 101 >= 1;
  const pctBucket = (mustCrit ? finalValue(p,8) / 100 : 1) *
    (1 + hit / 100) * (1 + shenTong15 / 100) * (1 + xiXingPct / 100);
  const damage = oneShotDamage(finalValue(p,0),ENEMY_5,{
    atkPct:    100 + WU_SONG_ATK_PERCENT,
    dmgAdd:    finalValue(p,13) + WU_SONG_DAMAGE_ADD,
    pctBucket,
    pen:       finalValue(p,15),
    skillMult: 1
  });
  return {
    damage,hit,kill: damage >= ENEMY_5.hp,lucky,shenTong15,speed,
    xiXingPct,zhenSpeedDmg: result.damageAddition ?? 0
  };
}

/**
 * 孙悟空神+西游 Lv.3 对比:御灵幸运+天覆阵 vs 御灵速度+鸟翔阵,相同钱币全额买御灵宝典与灵纹.
 * 从零面板起步(18 项全 0),不读存档;队伍加成照人皇印队保留.
 * @param money 投入的钱币总数(默认一垓 = 1e20)
 */
export function compareWukongSyzygy (money = 1e20): WukongRow[] {
  const books = maxBuyCount(MATERIAL_COST_PER_UNIT["御灵宝典"]!,money);
  const zhen = maxBuyCount(MATERIAL_COST_PER_UNIT["灵纹"]!,money);
  const panel: MasterPanel = {
    base: new Array<number>(PROP_COUNT).fill(0),
    dir: "zero",
    pct: new Array<number>(PROP_COUNT).fill(0),
    zhenFaID: 0
  };
  const plans: WukongPlan[] = [
    {name: "孙悟空神+西游Lv3+御灵幸运+天覆阵",yulingDir: 11,zhen: "tianfu"},
    {name: "孙悟空神+西游Lv3+御灵速度+鸟翔阵",yulingDir: 9,zhen: "niaoxiang"}
  ];
  const rows = plans.map(plan => {
    const yl = yulingbaodianTozhanli(books,plan.yulingDir,4);
    const ylSpeed = plan.yulingDir === 9 ? (yl.speed ?? 0) : 0;
    const zf = plan.zhen === "niaoxiang"
      ? niaoxiangzhenTozhanli(zhen,ylSpeed,ENEMY_5.speed)
      : tianfuzhenTozhanli(zhen);
    return {name: plan.name,...wukongDamage(panel,mergeResults(yl,zf))};
  });
  rows.sort((a,b) => b.damage - a.damage);
  return rows;
}

// 打印孙悟空神命中增伤链对比:列幸运/速度/命中/神通15/西行取经/鸟翔速度差/伤害/是否击杀.
export function printWukongSyzygy (money = 1e20): void {
  const books = maxBuyCount(MATERIAL_COST_PER_UNIT["御灵宝典"]!,money);
  const zhen = maxBuyCount(MATERIAL_COST_PER_UNIT["灵纹"]!,money);
  console.log("=== 孙悟空神+西游Lv3 命中增伤链对比(从零面板,御灵幸运+天覆 vs 速度+鸟翔,终局第5层) ===");
  console.log(`钱币=${formatSuoXie(money)} 御灵宝典=${formatSuoXie(books)} 灵纹=${formatSuoXie(zhen)} 敌闪避=${String(ENEMY_5.dodge)} 敌HP=${formatSuoXie(ENEMY_5.hp)}`);
  for (const row of compareWukongSyzygy(money)) {
    const fields = [
      `幸运=${formatSuoXie(row.lucky)}`,
      `速度=${formatSuoXie(row.speed)}`,
      `命中=${formatSuoXie(row.hit)}`,
      `神通15%=${formatSuoXie(row.shenTong15)}`,
      `西行取经%=${formatSuoXie(row.xiXingPct)}`,
      `鸟翔速度差%=${formatSuoXie(row.zhenSpeedDmg)}`
    ].join(" ");
    console.log(`${row.name} ${fields} 伤害=${formatSuoXie(row.damage)} ${row.kill ? "击杀" : "未击杀"}`);
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

// 直接执行本文件时打印复合方案对比 + 孙悟空神命中增伤链对比.
printComposite();
printWukongSyzygy();