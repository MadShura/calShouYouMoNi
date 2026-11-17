import {formatSuoXie,getPropNums,isArgOn,loadSave,parseArgs,resolveSaveDir} from "./readSave.ts";
import {runMain} from "./tools.ts";

/**
 * 器鼎升级计算器 口径来自 yingling-output.ts:2157 qiLuLevel:
 * - 器鼎等级 = 五彩神石(Prop 2)投入换算;存档 EquipManager.QiLu_Level 为当前等级
 * - 每 5 级一档,升到 level+1 消耗 10×(⌊(level-1)/5⌋+1) 五彩神石
 * - 研究20「省吃俭用」按项目分析口径点满=50 → 消耗 ×0.5
 */
const STONE_PROP = 2;
const DEFAULT_TARGET = 1000;
function main (): void {
  const args = parseArgs(process.argv.slice(2));
  if (isArgOn(args,"help")) {
    console.log(
      [
        "用法：pnpm lianqi [目标等级] [参数]",
        "",
        "  1000                 第一个位置参数=目标器鼎等级（默认 1000）",
        "  --save=1             存档槽位（默认 1）",
        "  --dir=路径           直接指定存档目录"
      ].join("\n")
    );
    return;
  }
  const targetArg = process.argv.slice(2).find(item => !item.startsWith("--"));
  const target = targetArg === undefined ? DEFAULT_TARGET : Number(targetArg);
  if (!Number.isSafeInteger(target) || target < 1) {
    throw new Error(`第一个参数应为目标等级，收到：${String(targetArg)}`);
  }
  const dir = resolveSaveDir(args);
  const save = loadSave(dir);
  const {game} = save;
  const mgr = save.cha.EquipManager;
  if (!mgr) {
    throw new Error("存档里没有 EquipManager（炼器/器鼎数据），可能存档未初始化");
  }
  const curLevel = mgr.QiLu_Level;
  if (curLevel < 1) {
    throw new Error("存档里没有器鼎等级（QiLu_Level），可能存档未初始化");
  }
  if (target <= curLevel) {
    console.log(`当前器鼎 Lv.${String(curLevel)} 已达到目标 Lv.${String(target)}，够了`);
    return;
  }

  // 研究20(省吃俭用)按项目分析口径点满=50
  const reducePercent = 50;
  const heldStones = getPropNums(game,STONE_PROP);
  const stoneForTarget = qiLuTotalStone(target,reducePercent);
  const stoneForCurrent = qiLuTotalStone(curLevel,reducePercent);
  const needStones = Math.max(0,stoneForTarget - stoneForCurrent - heldStones);
  if (needStones <= 0) {
    console.log(`够了（持有五彩神石 ${formatSuoXie(heldStones)} 已够升到器鼎 Lv.${String(target)}）`);
    return;
  }
  const lines: string[] = [
    "=== 器鼎升级计算 ===",
    `结论：还差 ${formatSuoXie(needStones)} 个五彩神石（持有 ${formatSuoXie(heldStones)}）`,
    `存档：${dir}`,
    `当前：器鼎 Lv.${String(curLevel)}；目标：Lv.${String(target)}（需升 ${String(target - curLevel)} 级）`,"",
    "--- 五彩神石 ---",
    `升到 Lv.${String(target)} 共需 ${formatSuoXie(stoneForTarget)} 石（研究20 满 -50%）`,
    `已投入到当前等级的石头折合 ${formatSuoXie(stoneForCurrent)}，扣除后还需 ${formatSuoXie(stoneForTarget - stoneForCurrent)}`,
    `持有 ${formatSuoXie(heldStones)}，最终还差 ${formatSuoXie(needStones)}`,"",
    "说明：器鼎每 5 级一档，升档消耗翻倍；研究20 按项目分析口径点满（50 级）。"
  ];
  console.log(lines.join("\n"));
}

// 升到 level+1 所需的五彩神石(含研究20 减免)
function qiLuCost (level: number,reducePercent = 0): number {
  return Math.max(
    1,
    Math.round(10 * (Math.trunc((level - 1) / 5) + 1) * (100 - reducePercent) / 100)
  );
}

// 从 1 级升到 levelTo(不含)共需五彩神石
function qiLuTotalStone (levelTo: number,reducePercent = 0): number {
  let total = 0;
  for (let level = 1; level < levelTo; level += 1) {
    total += qiLuCost(level,reducePercent);
  }
  return total;
}
runMain(main);