/**
 * xunbao.ts — 寻宝体力核查:读当前存档,按当前层数/大奖/已开格状态算走完本轮还需多少体力与仙葫芦.
 * 源码依据(src/源码/YingLing.KeJinSystem/XunBaoManager.cs, YingLing.UI/UIPanel_XunBao.cs):
 * - MaxTiLi = 150 + 铭商科技 MingShang_XunBao_TiLi_Limit 的 makeCount(:70-74)
 * - AddTimer:TiLiRecovery += timer×(100+min(Wing_CB_4,250)×2)/100;超过 300 则 Cur_TuLi++ 且归零(:86-102)
 * - CulGameTime > 36000s → 结算 Initial() 补满到 MaxTiLi 且层数重置为 1(:103-107,:178-188),属下一轮;本轮须在结算前走完
 * - 开一格扣当前层数点体力:GetOpenReward 里 Cur_TuLi -= Cur_CengShu_Index(:117)
 * - 入口格免费(Initial/EnterNext 放进 OpenBlock),每层付费 15 格;开到大奖格才能进下一层(UIPanel_XunBao.cs:186-197)
 * - 仙葫药(prop 155)每个 +10 寻宝体力(PropEffect_Add_XunBaoTiLi.cs:23-26)
 * - 仙葫芦需求逐项算:①当前存档只走保底 ②逐层清单从第10层倒序写到当前层,已走过低层跳过(每层=保底+开满该层非大奖格),÷10向上取整,不抵扣已有仙葫芦
 * 运行:pnpm xunbao
 */
import {argNumber,getMarkCount,getPropNums,loadSave,parseArgs,resolveSaveDir} from "./readSave.ts";
import {runMain} from "./tools.ts";

const REFRE_SECONDS = 600 * 60;       // 一次计时周期 36000s
const RECOVER_SECONDS = 300;          // 无翼加速时每 300s 回 1 点
const BASE_MAX_TILI = 150;
const MINGSHANG_XUNBAO_TILI_LIMIT = 62;  // Mark_Enum 序号
const WING_CB_4 = 71;                     // 恢复加速 Mark 序号
const XIANHU_PROP_ID = 155;               // 仙葫药
const TILI_PER_XIANHU = 10;
const PAID_BLOCKS = 15;                   // 每层付费格(16格减入口格)
const LAST_LAYER = 10;
const HIDDEN_EXPECT_BLOCKS = 8;           // (15+1)/2,隐藏大奖固定顺序每层走到大奖的期望格数
interface XunBaoManagerSave {
  CulGameTime?:       number;
  Cur_CengShu_Index?: number;
  Cur_TuLi?:          number;
  DaJiang_Seat?:      number;
  Open?:              boolean;
  OpenBlock?:         number[];
  OverTen?:           boolean;
  TiLiRecovery?:      number;
}

function main (): void {
  const args = parseArgs(process.argv.slice(2));
  const dir = resolveSaveDir(args);
  const save = loadSave(dir);
  const game = save.game as unknown as Record<string,unknown>;
  const xb = game.XunBaoManager as undefined | XunBaoManagerSave;
  console.log(`存档：${dir}`);
  if (!xb) {
    console.log("未找到 XunBaoManager 字段，无法核查寻宝体力。");
    return;
  }
  const curTuli = xb.Cur_TuLi ?? 0;
  const gameTime = xb.CulGameTime ?? 0;
  const recovery = xb.TiLiRecovery ?? 0;
  const layer = xb.Cur_CengShu_Index ?? 1;
  const openBlock = xb.OpenBlock ?? [];
  const daJiangSeat = xb.DaJiang_Seat ?? 0;
  const isDaJiangOpened = openBlock.includes(daJiangSeat);
  const maxTili = BASE_MAX_TILI + getMarkCount(game,MINGSHANG_XUNBAO_TILI_LIMIT);
  const wing = getMarkCount(game,WING_CB_4);
  const recoveryRate = wing > 0 ? (100 + Math.min(wing,250) * 2) / 100 : 1;
  const xianhuNums = getPropNums(game,XIANHU_PROP_ID);
  const remainSeconds = Math.max(0,REFRE_SECONDS - gameTime);
  const remainHours = remainSeconds / 3600;

  // 本轮结算前还能自然回的体力:(当前累加值 + 剩余秒×倍率) 每满 300 回 1 点
  const gainBeforeEnd = Math.floor((recovery + remainSeconds * recoveryRate) / RECOVER_SECONDS);
  const tiliAtEnd = curTuli + gainBeforeEnd;

  // 从当前状态走完本轮(打到第10层全开)还需要的体力.
  // 开一格扣当前层数点体力;入口格免费;开到大奖才能进下一层.
  let remainNeed = 0;
  const stepNotes: string[] = [];
  if (layer >= LAST_LAYER) {
    const openedPaid = Math.max(0,openBlock.length - 1);   // 去掉入口格
    const remainBlocks = Math.max(0,PAID_BLOCKS - openedPaid);
    remainNeed = remainBlocks * LAST_LAYER;
    stepNotes.push(`已在第${String(LAST_LAYER)}层:还差 ${String(remainBlocks)} 个付费格 × ${String(LAST_LAYER)} = ${String(remainNeed)} 体力`);
  } else {
    if (isDaJiangOpened) {
      stepNotes.push(`第${String(layer)}层大奖 ${seatCoord(daJiangSeat)} 已开 → 直接进下一层,本层剩余 0 体力`);
    } else {
      const step = HIDDEN_EXPECT_BLOCKS * layer;
      remainNeed += step;
      stepNotes.push(`第${String(layer)}层大奖 ${seatCoord(daJiangSeat)} 未开 → 按期望 ${String(HIDDEN_EXPECT_BLOCKS)} 格 × ${String(layer)} = ${String(step)} 体力`);
    }
    for (let next = layer + 1; next < LAST_LAYER; next += 1) {
      const step = HIDDEN_EXPECT_BLOCKS * next;
      remainNeed += step;
      stepNotes.push(`第${String(next)}层走到大奖:期望 ${String(HIDDEN_EXPECT_BLOCKS)} 格 × ${String(next)} = ${String(step)} 体力`);
    }
    const lastCost = PAID_BLOCKS * LAST_LAYER;
    remainNeed += lastCost;
    stepNotes.push(`第${String(LAST_LAYER)}层全开:${String(PAID_BLOCKS)} 格 × ${String(LAST_LAYER)} = ${String(lastCost)} 体力`);
  }
  let baseNeed = remainNeed;   // 保底消耗:每层只走到大奖 + 第10层全开
  const overrideNeed = argNumber(args,"need");
  if (overrideNeed !== undefined) {baseNeed = overrideNeed;}
  console.log("\n=== 当前寻宝状态 ===");
  console.log(`  层数 第${String(layer)}/${String(LAST_LAYER)}层，大奖位 ${seatCoord(daJiangSeat)}（座位号 ${String(daJiangSeat)}，${isDaJiangOpened ? "已开" : "未开"}）`);
  console.log(`  已开格 ${String(openBlock.length)}/16：${openBlock.map(seatCoord).join(" ")}`);
  console.log(`  当前体力 ${String(curTuli)} / 上限 ${String(maxTili)}`);
  console.log(`  已计时 ${gameTime.toFixed(1)}s / 周期 ${String(REFRE_SECONDS)}s，剩余 ${remainSeconds.toFixed(1)}s（${remainHours.toFixed(2)} 小时）`);
  console.log(`  恢复累加 TiLiRecovery = ${recovery.toFixed(1)} / ${String(RECOVER_SECONDS)}；Wing_CB_4 = ${String(wing)}，恢复倍率 ×${recoveryRate.toFixed(2)}`);
  console.log("\n=== 本轮结算前还能补多少 ===");

    // 逐项算仙葫芦需求:体力缺口 ÷10 向上取整,不用已有仙葫芦抵扣.
  const usableTili = tiliAtEnd;   // 本轮结算前体力,不含仙葫芦
  console.log(`  自然恢复 +${String(gainBeforeEnd)} → 体力 ${String(tiliAtEnd)}  可用体力 = ${String(usableTili)}（本轮结算前，不含仙葫芦）`);
}

// 座位号 → 横纵坐标:源码 MayDajiangSeat 用 row*10+col+1 编码(如 21 = 第3行第1列).
// 源码 CheckCanOpen 用 ±1 左右,±10 上下,与 row/col 一一对应.
function seatCoord (seat: number): string {
  return `(行${String(Math.floor((seat - 1) / 10) + 1)},列${String((seat - 1) % 10 + 1)})`;
}
runMain(main);