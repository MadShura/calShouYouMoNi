import {formatSuoXie,getPropNums,isArgOn,loadSave,parseArgs,resolveSaveDir} from "../readSave.ts";
import {runMain} from "../tools.ts";
import {lianQiLevelUpExp} from "./game-formulas.ts";

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
function main (): void {
  const args = parseArgs(process.argv.slice(2));
  if (isArgOn(args,"help")) {
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
  const curLevel = mgr.LianQiLevel;
  if (curLevel < 1) {
    throw new Error("存档里没有炼器等级（LianQiLevel），可能存档未初始化");
  }
  if (target <= curLevel) {
    console.log(`当前炼器 Lv.${String(curLevel)} 已达到目标 Lv.${String(target)}，够了`);
    return;
  }
  const curExp = mgr.LianQiExp;

  // 研究16(日积月累)按项目分析口径点满=50 → 每本 150 经验
  const expPerBook = 150;
  let totalExp = 0;
  for (let level = curLevel; level < target; level += 1) {
    totalExp += lianQiLevelUpExp(level);
  }
  const remainExp = Math.max(0,totalExp - curExp);
  const books = Math.ceil(remainExp / expPerBook);
  const booksOwned = getPropNums(game,BOOK_PROP);
  const needBooks = Math.max(0,books - booksOwned);
  if (needBooks <= 0) {
    console.log(`够了（持有炼器宝典 ${formatSuoXie(booksOwned)} 本已够升到炼器 Lv.${String(target)}）`);
    return;
  }
  const lines: string[] = [
    "=== 炼器（制作装备）升级计算 ===",
    `结论：还差 ${formatSuoXie(remainExp)} 经验 → 还需炼器宝典 ${formatSuoXie(needBooks)} 本（持有 ${formatSuoXie(booksOwned)} 本）`,
    `存档：${dir}`,
    `当前：Lv.${String(curLevel)}，经验 ${formatSuoXie(curExp)}；目标：Lv.${String(target)}（需升 ${String(target - curLevel)} 级）`,"",
    "--- 经验 ---",
    `逐级合计：Lv.${String(curLevel)} → Lv.${String(target)} 共需 ${formatSuoXie(totalExp)} 经验`,
    `扣除现有经验后还差：${formatSuoXie(totalExp)} − ${formatSuoXie(curExp)} = ${formatSuoXie(remainExp)}`,"",
    "--- 炼器宝典（Prop 86）---",
    `每本经验：100 × (100 + 研究16满50)/100 = ${String(expPerBook)}`,
    `需要本数：${formatSuoXie(books)} 本（剩余经验 ÷ 每本 ${String(expPerBook)}，向上取整）`,
    `已持有 ${formatSuoXie(booksOwned)} 本，还差 ${formatSuoXie(needBooks)} 本`,"",
    "说明：炼器等级也吃寒铁打造给的经验，本脚本仅按炼器宝典来源换算。研究16 按项目分析口径点满（50 级）。"
  ];
  console.log(lines.join("\n"));
}
runMain(main);