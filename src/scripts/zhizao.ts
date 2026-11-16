import {argFlag,formatSuoXie,getPropNums,loadSave,parseArgs,resolveSaveDir} from "../readSave.ts";
import {runMain} from "../tools.ts";

/**
 * 炼器(制作装备)升级计算器 口径全部来自反编译源码,与 yingling-output.ts 一致:
 * - 等级/经验:存档 Game_RecordData.Save → EquipManager.LianQiLevel / LianQiExp
 * - 每级经验:PropHelper.GetLianQiLevelUpExp(yingling-output.ts:1157 已对齐)
 * - 炼器宝典(Prop 86)每本经验 = 100 × (100 + 研究16等级)/100;
 * 研究16「日积月累」按项目分析口径点满=50 → 150 经验/本
 * - 注:炼器等级也吃寒铁打造给的经验,本脚本只换算「炼器宝典」这一来源(按用户需求)
 */
const BOOK_PROP = 86;
const DEFAULT_TARGET = 1000;

// PropHelper.GetLianQiLevelUpExp:炼器每级所需经验(从 level 升到 level+1)
function lianQiLevelUpExp (level: number): number {
  if (level <= 10) {
    return level * 20;
  }
  if (level < 20) {
    return 200 + 50 * (level - 10);
  }
  if (level < 30) {
    return 700 + 100 * (level - 20);
  }
  if (level >= 40) {
    return 3700 + 300 * (level - 40);
  }
  return 1700 + 200 * (level - 30);
}
function main (): void {
  const args = parseArgs(process.argv.slice(2));
  if (argFlag(args,"help")) {
    console.log(
      [
        "用法：pnpm zhizao [目标等级] [参数]",
        "",
        "  1000                 第一个位置参数=目标炼器等级（默认 1000）",
        "  --save=1             存档槽位（默认 1）",
        "  --dir=路径           直接指定存档目录"
      ].join("\n")
    );
    return;
  }
  const targetArg = process.argv.slice(2).find(item => !item.startsWith("--"));
  const target = targetArg === undefined ? DEFAULT_TARGET : Number(targetArg);
  if (!Number.isInteger(target) || target < 1) {
    throw new Error(`第一个参数应为目标等级，收到：${String(targetArg)}`);
  }
  const dir = resolveSaveDir(args);
  const save = loadSave(dir);
  const {game} = save;
  const mgr = save.cha.EquipManager;
  if (!mgr) {
    throw new Error("存档里没有 EquipManager（炼器/器鼎数据），可能存档未初始化");
  }
  const curLevel = mgr.LianQiLevel ?? 0;
  const curExp = mgr.LianQiExp ?? 0;
  if (curLevel < 1) {
    throw new Error("存档里没有炼器等级（LianQiLevel），可能存档未初始化");
  }
  if (target <= curLevel) {
    console.log(`当前炼器 Lv.${String(curLevel)} 已达到目标 Lv.${String(target)}，够了`);
    return;
  }

  // 研究16(日积月累)按项目分析口径点满=50 → 每本 150 经验
  const expPerBook = 150;
  let totalExp = 0;
  for (let level = curLevel; level < target; level += 1) {
    totalExp += lianQiLevelUpExp(level);
  }
  const remainExp = Math.max(0,totalExp - curExp);
  const books = expPerBook > 0 ? Math.ceil(remainExp / expPerBook) : 0;
  const haveBooks = getPropNums(game,BOOK_PROP);
  const needBooks = Math.max(0,books - haveBooks);
  if (needBooks <= 0) {
    console.log(`够了（持有炼器宝典 ${formatSuoXie(haveBooks)} 本已够升到炼器 Lv.${String(target)}）`);
    return;
  }
  const lines: string[] = [];
  lines.push(
    "=== 炼器（制作装备）升级计算 ===",
    `结论：还差 ${formatSuoXie(remainExp)} 经验 → 还需炼器宝典 ${formatSuoXie(needBooks)} 本（持有 ${formatSuoXie(haveBooks)} 本）`,
    `存档：${dir}`,
    `当前：Lv.${String(curLevel)}，经验 ${formatSuoXie(curExp)}；目标：Lv.${String(target)}（需升 ${String(target - curLevel)} 级）`,"",
    "--- 经验 ---",
    `逐级合计：Lv.${String(curLevel)} → Lv.${String(target)} 共需 ${formatSuoXie(totalExp)} 经验`,
    `扣除现有经验后还差：${formatSuoXie(totalExp)} − ${formatSuoXie(curExp)} = ${formatSuoXie(remainExp)}`,"",
    "--- 炼器宝典（Prop 86）---",
    `每本经验：100 × (100 + 研究16满50)/100 = ${String(expPerBook)}`,
    `需要本数：${formatSuoXie(books)} 本（剩余经验 ÷ 每本 ${String(expPerBook)}，向上取整）`,
    `已持有 ${formatSuoXie(haveBooks)} 本，还差 ${formatSuoXie(needBooks)} 本`,"",
    "说明：炼器等级也吃寒铁打造给的经验，本脚本仅按炼器宝典来源换算。研究16 按项目分析口径点满（50 级）。"
  );
  console.log(lines.join("\n"));
}
runMain(main);