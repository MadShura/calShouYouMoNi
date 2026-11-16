/**
 * gen-diagnose-trial —— 读当前存档,诊断「首次攻击为何无法击杀当前试炼关卡」.
 * 复用既有模型(与 killcalc.ts 同一套判定口径):
 * - 敌人属性:enemy-stats.ts trialEnemy(LevelToTargetLevel 反编译公式)
 * - 玩家面板:yingling-output.ts buildResourcePanel(按 resource 预算构建最优配队)
 * - 伤害结算:game-formulas.ts oneShotDamage / requiredAtk
 * 判定三件套(meets):
 * first : 我方速度 > 敌方速度 —— 决定谁先出手
 * hit100 : 我方命中+30 >= 敌方闪避 —— 决定首击是否必中(含唐三藏+30)
 * oneshot : 单点非暴击伤害 >= 敌方 HP —— 决定首击能否直接带走
 * 注意:yuanbao-route.ts 的 routeA 推层只用了 atkMultiplier(hpBudget),
 * **完全没检查速度先手**,因此会乐观地假设「能赢」；本脚本补上 first 检查,
 * 也正是「首攻击杀失败」最常见的真实原因——速度不够,敌人先手.
 * buildResourcePanel 不读存档养成,只看 resource 预算；本脚本用「存档里各养成资源的最小值」
 * 作为保守的统一预算估算,可用 --resource=N 覆盖(N 为「每项初始资源」预算值).
 * 用法:pnpm exec tsx src/scripts/gen-diagnose-trial.ts [--resource=N] [--save=1]
 */
import {join} from "node:path";
import {argNumber,argString,getPropNums,loadSave,parseArgs,resolveSaveDir} from "../readSave.ts";
import type {GameRecord} from "../readSave.ts";
import {trialEnemy} from "./enemy-stats.ts";
import type {EnemyStats} from "./enemy-stats.ts";
import {fmtShort,oneShotDamage,requiredAtk} from "./game-formulas.ts";
import {runMain,type ShiLianSave} from "../tools.ts";
import {buildResourcePanel} from "./yingling-output.ts";
import type {ResourcePanel} from "./yingling-output.ts";

const DEFAULT_GAME_DIR = String.raw`D:\game\steam\steamapps\common\MoNiShouYou`;
const TANG_SAN_ZANG_HIT = 30; // 唐三藏 3 技能开战全体 +30 命中(孙悟空配队常驻)

// 养成资源 PropID:寒铁1/五彩神石2/破境石3/御力4/强化石5/神通卷轴6/灵纹7/灵晶8/历史本纪9/忘情水81/三味真火85
const CULTIVATE_PROPS = [1,2,3,4,5,6,7,8,9,81,85];
function buildPanel (resource: number): null | ResourcePanel {
  try {
    return buildResourcePanel(new Map<string,string | true>([["resource",String(resource)]]));
  } catch {
    return null;
  }
}
function diagnose (from: number,panel: ResourcePanel): void {
  const enemy: EnemyStats = trialEnemy(from);
  const reduce = Math.min(enemy.damageReduce,80); // 减伤封顶 80%
  const carryHit = panel.hit + TANG_SAN_ZANG_HIT;
  const opt = {atkPct: 100,dmgAdd: panel.damageAddition,pctBucket: 1,pen: panel.penetration,skillMult: 1};
  const os = oneShotDamage(panel.finalAtk,enemy,opt);
  const isFirst = panel.speed > enemy.speed;
  const isHit100 = carryHit >= enemy.dodge;
  const isOneshot = os >= enemy.hp;
  console.log(`\n=== 当前试炼层 ${from} 的敌人属性（trialEnemy 公式）===`);
  console.log(`  HP        = ${fmtShort(enemy.hp)}`);
  console.log(`  防御      = ${fmtShort(enemy.def)}（穿透后参与伤害系数）`);
  console.log(`  速度      = ${fmtShort(enemy.speed)}`);
  console.log(`  闪避      = ${fmtShort(enemy.dodge)}（我方需 命中+30 >= 此值才 100% 命中）`);
  console.log(`  减伤      = ${enemy.damageReduce}%（封顶 80，实际按 ${reduce}% 计算伤害）`);
  console.log("\n=== 你的面板（按 resource 预算估算；若与游戏内不符请用 --resource=N 校准）===");
  console.log(`  攻击 finalAtk     = ${fmtShort(panel.finalAtk)}`);
  console.log(`  速度 speed        = ${fmtShort(panel.speed)}`);
  console.log(`  命中 hit(+唐三藏) = ${fmtShort(panel.hit)} + ${TANG_SAN_ZANG_HIT} = ${fmtShort(carryHit)}`);
  console.log(`  伤害加成          = ${panel.damageAddition}%   穿透 = ${fmtShort(panel.penetration)}`);
  console.log(`  御灵师 Lv.${panel.yulingshiLevel}  突破 ${panel.breakthroughCount} 次  阵法 Lv.${panel.zhenfaLevel}  图鉴 Lv.${panel.tuJianLevel}`);
  console.log("\n=== 首击三件套判定 ===");
  console.log(`  [${isFirst ? "✓" : "✗"}] 先手    : 我方速度 ${fmtShort(panel.speed)} ${isFirst ? ">" : "<= 需 >"} 敌方速度 ${fmtShort(enemy.speed)}`);
  console.log(`  [${isHit100 ? "✓" : "✗"}] 100%命中: 我方命中 ${fmtShort(carryHit)} ${isHit100 ? ">=" : "< 需 >="} 敌方闪避 ${fmtShort(enemy.dodge)}`);
  console.log(`  [${isOneshot ? "✓" : "✗"}] 一击必杀: 单点非暴击 ${fmtShort(os)} ${isOneshot ? ">=" : "< 需 >="} 敌方HP ${fmtShort(enemy.hp)}`);
  console.log("\n=== 结论：为什么首次攻击无法击杀 ===");
  if (isFirst && isHit100 && isOneshot) {
    console.log("  三件套全过，理论上首击即可击杀。若游戏里仍打不死，检查：暴击/连击/反击等实战加成是否反向，或敌方有「每回合回血/护盾」未建模。");
    return;
  }
  const reasons: string[] = [];
  if (!isFirst) {
    reasons.push(
      `速度先手被抢：敌方速度 ${fmtShort(enemy.speed)} > 你 ${fmtShort(panel.speed)}，` +
      "敌人先出手；你「首次攻击」其实排在敌方之后，且可能先挨打到死/掉血，自然「击杀不了」。" +
      "这正是 routeA 推层时漏掉的速度门槛——它只看攻击倍率假设能赢。"
    );
  }
  if (!isHit100) {
    reasons.push(
      `命中不足：你命中+30=${fmtShort(carryHit)} < 敌闪避 ${fmtShort(enemy.dodge)}，` +
      "首击有概率 miss（命中率 = (100+命中-闪避+30+1)/101，未满 100%）。"
    );
  }
  if (!isOneshot) {
    const need = requiredAtk(enemy,panel.finalAtk,opt);
    const mult = need / Math.max(1,panel.finalAtk);
    reasons.push(
      `一击伤害不足：单点非暴击 ${fmtShort(os)} < 敌HP ${fmtShort(enemy.hp)}（且敌减伤封顶 ${reduce}% 已大幅削减你的伤害）。` +
      `要一击必杀，基础攻击需从 ${fmtShort(panel.finalAtk)} 提到约 ${fmtShort(need)}（约 ${mult.toFixed(2)} 倍）。`
    );
  }
  for (const [i,r] of reasons.entries()) {console.log(`  ${i + 1}. ${r}`);}
  console.log("  → 任一 ✗ 都会导致「首攻击杀失败」；多个 ✗ 同时存在时按先手 > 命中 > 伤害 的战斗顺序依次卡住。");
}
function main (): void {
  type SaveGame = {
    ChouJiangCount?:    number;
    Cur_JiangChiIndex?: number;
    CurYuLingShiLv?:    number;
    ShiLian_Manger?:    ShiLianSave;
  } & GameRecord;
  const args = parseArgs(process.argv.slice(2));
  const gameDir = argString(args,"game-dir") ?? DEFAULT_GAME_DIR;
  const save = loadSave(resolveSaveDir(args));
  const game = save.game as SaveGame;
  const from = game.ShiLian_Manger?.Cur_CengShu ?? 1;
  const curLevel = game.CurYuLingShiLv ?? 1;

  // 默认预算:二分找到「让御灵师等级≈存档真实等级(curLevel)」的 resource,
  // 这样面板接近你当前养成,而非无脑满配.可用 --resource=N 强制覆盖.
  const resource = argNumber(args,"resource") ?? (() => {
    let best = 256_0000,
bestDiff = Infinity,
hi = 256_0000,
lo = 0;
    for (let i = 0; i < 40; i++) {
      const mid = Math.floor((lo + hi) / 2);
      const lvl = buildPanel(mid)?.yulingshiLevel ?? 0;
      const diff = Math.abs(lvl - curLevel);
      if (diff < bestDiff) {bestDiff = diff; best = mid;}
      if (lvl < curLevel) {lo = mid + 1;} else {hi = mid - 1;}
    }
    return best;
  })();
  console.log("=== gen-diagnose-trial：当前存档首击试炼诊断 ===");
  console.log(`存档：${save.dir}`);
  console.log(`试炼当前层 = ${from}；御灵师等级 = Lv.${curLevel}`);
  console.log("养成资源快照（保守预算取最小值）：");
  for (const id of CULTIVATE_PROPS) {
    console.log(`  Prop ${String(id).padStart(3)} = ${fmtShort(getPropNums(game,id))}`);
  }
  console.log(`→ 默认预算 resource（每项初始资源，使御灵师≈Lv.${curLevel}）= ${fmtShort(resource)}${argNumber(args,"resource") === undefined ? "（二分逼近真实等级；若想看满配用 --resource=1e12）" : "（--resource 覆盖）"}`);
  const panel = buildPanel(resource);
  if (panel === null) {
    console.log(`⚠ 资源预算 ${fmtShort(resource)} 下无法构建面板（面板构建异常）。`);
    return;
  }
  diagnose(from,panel);
}
if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) {
  runMain(main);
}