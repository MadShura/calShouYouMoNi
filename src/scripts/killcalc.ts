import {argNumber,argString,parseArgs} from "./save-data.ts";
import {towerEnemy,trialEnemy,ZHONG_JU} from "./enemy-stats.ts";
import type {EnemyStats} from "./enemy-stats.ts";
import {buildResourcePanel} from "./yingling-output.ts";
import type {ResourcePanel} from "./yingling-output.ts";
import {
  fmtShort,
  oneShotDamage
} from "./game-formulas.ts";

/**
 * killcalc —— 击杀求解器(不读存档).
 * 全部计算都委托给 game-formulas.ts(纯函数库)与 yingling-output.ts(真实配队面板),
 * 本文件只负责:敌人属性 → 判定条件(先手/100%命中/一击必杀) → 二分最小资源预算 → 打印真实搭配.
 * 真实面板来自 yingling-output.buildResourcePanel:已含
 * 御灵师 / 突破(每10级1次,先堆幸运到 50000% 再堆速度) /
 * 阵法(攻击+15% 且 最高攻+等级%) / 装备 / 神通(含神通15 命中→伤害%) /
 * 神兵 / 研究 / VIP.即「孙悟空配队」的 命中/伤害加成/阵法 加成都已在内.
 */
// 孙悟空(魔转职,满怒)配队乘区:技能倍率 & 百分比乘区(羁绊/神通/研究/神兵).
// 注:面板已含 阵法+15%攻击,神通15 命中→伤害%,御灵师/装备/神兵等;此处仅补 配队羁绊/转职 乘区,待按账号校准.
const SUN_WU_KONG = {pctBucket: 1,skillMult: 1};

// 唐三藏固定给全队 +30 命中(孙悟空配队常驻)
const TANG_SAN_ZANG_HIT = 30;

// 敌人技能减伤 / 我方图鉴减益(CLI 覆盖)
let SKILL_REDUCE = 0;
let ADD_BE_DAMAGE = 0;
interface Meets {first: boolean; hit100: boolean; oneshot: boolean}

// 孙悟空 carry 的命中(含唐三藏,+30);魔转职不把幸运换命中(神转职才换)
function carryHit (panel: ResourcePanel): number {
  return panel.hit + TANG_SAN_ZANG_HIT;
}
function meets (panel: ResourcePanel,enemy: EnemyStats,applyTuJian: boolean): Meets {
  return {
    first:   panel.speed > enemy.speed,
    hit100:  carryHit(panel) >= enemy.dodge,
    oneshot: shot(panel,enemy,applyTuJian) >= enemy.hp
  };
}

// 敌方 → 我方 单点非暴击伤害(用真实面板驱动)
function shot (panel: ResourcePanel,enemy: EnemyStats,applyTuJian: boolean): number {
  return oneShotDamage(
    panel.finalAtk,
    enemy,
    {
      atkPct:          100, // finalAtk 已含 攻击桶 + 阵法等级%
      dmgAdd:          panel.damageAddition,
      pctBucket:       SUN_WU_KONG.pctBucket,
      pen:             panel.penetration,
      skillMult:       SUN_WU_KONG.skillMult,
      tuJianDamagePct: applyTuJian ? panel.tuJianDamagePct : 0
    },
    SKILL_REDUCE,
    ADD_BE_DAMAGE
  );
}

// buildResourcePanel 较重(每次读配置),按资源预算缓存避免重复计算
const panelCache = new Map<number,null | ResourcePanel>();
function ok (panel: ResourcePanel,enemy: EnemyStats,applyTuJian: boolean): boolean {
  const m = meets(panel,enemy,applyTuJian);
  return m.first && m.hit100 && m.oneshot;
}
function panelAt (resource: number): null | ResourcePanel {
  const cached = panelCache.get(resource);
  if (cached !== undefined) {return cached;}
  let panel: null | ResourcePanel = null;
  try {
    panel = buildResourcePanel(new Map<string,string | true>([["resource",String(resource)]]));
  } catch {
    panel = null;
  }
  panelCache.set(resource,panel);
  return panel;
}

// 最小资源预算:先指数扩张找上界(只在实际需要的量级上构建面板,避免评估天文数字预算),再窄区间二分
const RES_HI = 5e15;

// ---------- 主入口 ----------
function main (): void {
  const args = parseArgs(process.argv.slice(2));
  SKILL_REDUCE = argNumber(args,"skillReduce") ?? 0;   // 敌人技能减伤%(Reduce_BeDamage Level)
  ADD_BE_DAMAGE = argNumber(args,"addBeDamage") ?? 0;  // 我方图鉴减益%(Add_BeDamage Level)
  const scene = argString(args,"scene") ?? "tower";
  const layers = (argString(args,"layer") ?? "")
    .split(",").map(s => s.trim())
.filter(Boolean)
.map(Number)
.filter(n => !isNaN(n));
  if (scene === "tower") {
    const ls = layers.length > 0 ? layers : [1000,5000,10000,20000,50000,10_0000];
    for (const l of ls) {reportOne(`通天塔 首领 ${fmtShort(l)}层`,towerEnemy(l,3),true);}
  } else if (scene === "trial") {
    const from = argNumber(args,"from") ?? 1;
    const to = argNumber(args,"to") ?? (layers[0] ?? 100);
    for (let l = from; l <= to; l++) {reportOne(`试炼 ${fmtShort(l)}层`,trialEnemy(l),false);}
  } else if (scene === "zhongju") {
    for (const e of ZHONG_JU) {
      reportOne(`终局 挑战${e.tiaoZhanID} (Boss ${e.bossID.join("/")})`,e,false);
    }
  } else {
    console.log("未知场景：tower / trial / zhongju");
  }
  console.log("\n参数：--scene=tower|trial|zhongju  --layer=10000  --from/--to=层数  --skillReduce=N(敌人技能减伤%)  --addBeDamage=N(我方图鉴减益%)  --resource=N(指定预算直接查看,跳过二分)");
  console.log("覆盖规则：通天塔仅算首领(属性最高,且计入图鉴增伤);试炼/终局每波5个敌人共用该属性集(以最强计),满足即整波全部一击必杀。");
}
function minResource (enemy: EnemyStats,applyTuJian: boolean): {panel: null | ResourcePanel; resource: number} {
  let hi = 1,
lo = 0;
  let hiPanel: null | ResourcePanel = null;
  while (hi <= RES_HI) {
    hiPanel = panelAt(hi);
    if (hiPanel !== null && ok(hiPanel,enemy,applyTuJian)) {break;}
    lo = hi;
    hi *= 2;
  }
  let ans = hi,
ansPanel = hiPanel;
  for (let i = 0; i < 60; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const panel = panelAt(mid);
    if (panel !== null && ok(panel,enemy,applyTuJian)) {
      ans = mid; ansPanel = panel; hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return {panel: ansPanel,resource: ans};
}

// ---------- 输出单个敌人 ----------
function reportOne (tag: string,enemy: EnemyStats,applyTuJian: boolean): void {
  console.log(`\n=== ${tag} ===`);
  const reduce = Math.min(enemy.damageReduce,80);
  console.log(`敌人: HP=${fmtShort(enemy.hp)} 防御=${fmtShort(enemy.def)} 速度=${fmtShort(enemy.speed)} 闪避=${fmtShort(enemy.dodge)} 减伤=${reduce}%(封顶80)${SKILL_REDUCE ? ` +技能减伤${SKILL_REDUCE}%` : ""}${ADD_BE_DAMAGE ? ` 我方图鉴减益+${ADD_BE_DAMAGE}%` : ""}`);
  const fixed = argNumber(parseArgs(process.argv.slice(2)),"resource");
  const {panel,resource} = fixed == null
    ? minResource(enemy,applyTuJian)
    : {panel: panelAt(fixed),resource: fixed};
  if (panel === null) {
    console.log(`⚠ 资源预算 ${fmtShort(RES_HI)} 下仍无法构建面板(可能配置/模型异常)。`);
    return;
  }
  const m = meets(panel,enemy,applyTuJian);
  const os = shot(panel,enemy,applyTuJian);
  console.log(`先手    : 我方速度 ${fmtShort(panel.speed)} ${m.first ? "✓" : `✗(需 > ${fmtShort(enemy.speed)})`}`);
  console.log(`100%命中: 我方命中 ${fmtShort(carryHit(panel))} ${m.hit100 ? "✓" : `✗(需 >= ${fmtShort(enemy.dodge)})`}`);
  console.log(`一击必杀: 单点非暴击 ${fmtShort(os)} ${m.oneshot ? "✓" : `✗(需 >= ${fmtShort(enemy.hp)})`}`);
  console.log("—— 最佳资源搭配(最小资源预算;已含御灵师突破[幸运→5万]/阵法/装备/神通/神兵/研究/VIP,孙悟空魔转职满怒) ——");
  console.log(`  资源预算(初始资源/项) ≈ ${resource.toLocaleString("en-US")}`);
  console.log(`  御灵师 Lv.${panel.yulingshiLevel}  突破 ${panel.breakthroughCount} 次(幸运 ${fmtShort(panel.lucky)} / 速度 ${fmtShort(panel.speed)})`);
  console.log(`  阵法 Lv.${panel.zhenfaLevel}  装备品质 ${panel.pinzhi.toFixed(2)}  历史本纪(转职) Lv.${panel.historyLevel}  图鉴 Lv.${panel.tuJianLevel}`);
  console.log(`  攻击 ${fmtShort(panel.finalAtk)}  命中 ${fmtShort(panel.hit)}  伤害加成 ${panel.damageAddition}  穿透 ${fmtShort(panel.penetration)}  图鉴增伤 ${panel.tuJianDamagePct}%`);
  console.log("★ 全部一击必杀:本波敌人共用该属性(以最强计),满足上表即整波全覆盖。");
  console.log(`  (孙悟空配队乘区 skillMult=${SUN_WU_KONG.skillMult} pctBucket=${SUN_WU_KONG.pctBucket} 为待校准占位;面板已含 阵法+15%攻击、神通15 命中→伤害% 等真实加成)`);
}
if (process.argv[1] === import.meta.filename) {
  try {main();} catch (error) {
    const message = Error.isError(error) ? error.message : String(error);
    console.error(`错误：${message}`);
    process.exitCode = 1;
  }
}