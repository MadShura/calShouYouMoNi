import {argFlag,argNumber,formatSuoXie,getMarkCount,getPropNums,loadSave,parseArgs,resolveSaveDir} from "./save-data.ts";

/**
 * 御灵师升级计算器 公式全部来自反编译代码:
 * - 等级与经验:GameRecorder.CurYuLingShiLv / YuLingExp(第 60 行,初始 1 级)
 * - 每级消耗:GameRecorder.CulLevel_Up_Remand() 第 659-669 行
 * 100 × (L/10) × (L/10 + 1) + 20 × (L/10 + 1) × (L%10),L/10 为整除
 * - 突破:等级是 10 的倍数且经验够时必须突破(UIPanel_AutoLv.cs 第 101-108 行),
 * 每次消耗 500 个突破丹(Prop 81)后才能继续升级
 * - 书的经验:御灵宝典(Prop 84)PropEffect_GetYuLingShiEXP → ChanYuLi(Params_1),
 * ChanYuLi 第 644-646 行再乘 (100 + 研究 AddYuLingShi_EXP)/100
 * - 书价:批量购买走 PropHelper.GetPropValue 第 29-38 行 = Cul_Percent_ToInt(ValueCost × 本数),
 * 即整批一次取整(52.5 的折合单价不会被单独取整成 53);Cul_Percent_ToInt 用四舍五入远离零
 * (ToolClass.cs 第 107-117 行);商店 Special 列表含 84(PropHelper.cs 第 172 行),用钱币(Prop 80)购买
 */
const BOOK_PROP = 84;
const DEFAULT_TARGET = 1000;
const MONEY_PROP = 80;
const SELL_PRICE_MARK = 29;
const TUPO_COST = 500;
const TUPO_PROP = 81;
const YULING_EXP_MARK = 33;

// CulLevel_Up_Remand()
function levelCost (level: number): number {
  const tens = Math.floor(level / 10);
  return 100 * tens * (tens + 1) + 20 * (tens + 1) * (level % 10);
}
function main (): void {
  const args = parseArgs(process.argv.slice(2));
  if (argFlag(args,"help")) {
    console.log(
      [
        "用法：pnpm yuling [目标等级] [参数]",
        "",
        "  1000                 第一个位置参数=目标等级（默认 1000）",
        "  --save=1             存档槽位（默认 1）",
        "  --dir=路径           直接指定存档目录"
      ].join("\n")
    );
    return;
  }
  const targetArg = process.argv.slice(2).find(item => !item.startsWith("--"));
  const target = targetArg === undefined ? DEFAULT_TARGET : Number(targetArg);
  if (!Number.isInteger(target) || target < 1) {
    throw new Error(`第一个参数应为目标等级，收到：${targetArg}`);
  }
  const dir = resolveSaveDir(args);
  const save = loadSave(dir);
  const {game} = save;
  const curLevel = game.CurYuLingShiLv ?? 0;
  const curExp = game.YuLingExp ?? 0;
  if (curLevel < 1) {
    throw new Error("存档里没有御灵师等级（CurYuLingShiLv），可能存档未初始化");
  }
  if (target <= curLevel) {
    console.log(`当前 Lv.${curLevel} 已达到目标 Lv.${target}，不需要升级`);
    return;
  }
  const book = save.props.get(BOOK_PROP);
  if (!book) {
    throw new Error("存档里没有御灵宝典（Prop 84）的定义，无法读取每本经验与单价");
  }
  const expMark = getMarkCount(game,YULING_EXP_MARK);
  const sellMark = getMarkCount(game,SELL_PRICE_MARK);

  // ChanYuLi 用浮点乘,不取整
  const expPerBook = (book.params1 ?? 0) * (100 + expMark) / 100;
  const rawPrice = book.valueCost * (100 - sellMark) / 100;
  let totalExp = 0;
  let breakthroughs = 0;
  for (let level = curLevel; level < target; level += 1) {
    totalExp += levelCost(level);
    if (level % 10 === 0) {
      breakthroughs += 1;
    }
  }
  const remainExp = Math.max(0,totalExp - curExp);
  const books = expPerBook > 0 ? Math.ceil(remainExp / expPerBook) : 0;
  const haveBooks = getPropNums(game,BOOK_PROP);
  const haveMoney = getPropNums(game,MONEY_PROP);
  const haveTupo = getPropNums(game,TUPO_PROP);
  const needBooks = Math.max(0,books - haveBooks);

  // 批量购买整批一次取整
  const buyMoney = percentToInt(book.valueCost * needBooks,sellMark,true);
  const needMoney = Math.max(0,buyMoney - haveMoney);
  const needTupo = breakthroughs * TUPO_COST;
  const lines: string[] = [];
  lines.push(
    "=== 御灵师升级计算 ===",
    `结论：还差 ${formatSuoXie(remainExp)} 经验 → 御灵宝典 ${formatSuoXie(needBooks)} 本 → 钱币 ${formatSuoXie(needMoney)}`,
    `存档：${dir}`,
    `当前：Lv.${curLevel}，经验 ${formatSuoXie(curExp)}；目标：Lv.${target}（需升 ${target - curLevel} 级）`,"",
    "--- 经验 ---",
    `逐级合计：Lv.${curLevel} → Lv.${target} 共需 ${formatSuoXie(totalExp)} 经验`,
    `单级消耗：Lv.${curLevel} 需 ${formatSuoXie(levelCost(curLevel))}，Lv.${target - 1} 需 ${formatSuoXie(levelCost(target - 1))}`,
    `扣除现有经验后还差：${formatSuoXie(totalExp)} − ${formatSuoXie(curExp)} = ${formatSuoXie(remainExp)}`,"",
    "--- 御灵宝典 ---",
    `每本经验：${formatSuoXie(book.params1 ?? 0)} × (100 + 研究 ${expMark})% = ${formatSuoXie(expPerBook)}`,
    `需要本数：${formatSuoXie(books)} 本（剩余经验 ÷ 每本 ${formatSuoXie(expPerBook)}，向上取整）`,
    `已持有 ${formatSuoXie(haveBooks)} 本，还差 ${formatSuoXie(needBooks)} 本`,"",
    "--- 钱币（整批购买一次取整）---",
    `一次买 ${formatSuoXie(needBooks)} 本 → 整批结算 ${formatSuoXie(buyMoney)} 钱币（折合 ${rawPrice}/本）`,
    `已持有 ${formatSuoXie(haveMoney)} 钱币，还差 ${formatSuoXie(needMoney)}`,"",
    "--- 突破 ---",
    `需要突破 ${breakthroughs} 次（Lv.${curLevel} → Lv.${target} 之间所有 10 的倍数等级）`,
    `消耗：${breakthroughs} × ${TUPO_COST} = ${formatSuoXie(needTupo)} 突破丹（Prop ${TUPO_PROP}），已持有 ${formatSuoXie(haveTupo)}`,"",
    "说明：突破不消耗经验，但等级卡在 10 的倍数且突破丹不足时无法继续升级。"
  );
  console.log(lines.join("\n"));
}

// ToolClass.Cul_Percent_ToInt:四舍五入远离零
function percentToInt (baseValue: number,percentage: number,reduce: boolean): number {
  const factor = reduce ? 100 - percentage : 100 + percentage;
  const value = baseValue * factor / 100;
  return value < 0 ? -Math.round(-value) : Math.round(value);
}
try {
  main();
} catch (error) {
  const message = Error.isError(error) ? error.message : String(error);
  console.error(`错误：${message}`);
  process.exitCode = 1;
}