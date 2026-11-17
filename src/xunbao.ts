/**
 * xunbao.ts — 寻宝体力核查:读当前存档,算本次计时结束能回多少体力,
 * 再算「总体力 + 仙葫芦体力」距跑完一次寻宝(488 体力)还差多少.
 * 源码依据(src/源码/YingLing.KeJinSystem/XunBaoManager.cs):
 * - MaxTiLi = 150 + 铭商科技 MingShang_XunBao_TiLi_Limit 的 makeCount(:70-74)
 * - AddTimer:TiLiRecovery += timer×(100+min(Wing_CB_4,250)×2)/100;超过 300 则 Cur_TuLi++ 且归零(:86-102)
 * - CulGameTime > RefreTime_min×60(=600×60=36000s)→ 结算 Initial() 补满到 MaxTiLi 并把层数重置为 1(:103-107,:178-188),属下一轮;本轮按结算前自然恢复值算
 * - 仙葫药(prop 155)每个 +10 寻宝体力(PropEffect_Add_XunBaoTiLi.cs:23-26;config/mingshang.json 1888 元宝/个)
 * - 跑完一次寻宝体力 = 前9层期望 + 第10层全开 = 固定 488(见 src/xunbao-tili.ts)
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
const XUNBAO_NEED_TILI = 488;             // 跑完一次寻宝所需(前9层期望+第10层全开)
interface XunBaoManagerSave {
  CulGameTime?:       number;
  Cur_CengShu_Index?: number;
  Cur_TuLi?:          number;
  Open?:              boolean;
  TiLiRecovery?:      number;
}

function main (): void {
  const args = parseArgs(process.argv.slice(2));
  const needTili = argNumber(args,"need") ?? XUNBAO_NEED_TILI;
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
  const maxTili = BASE_MAX_TILI + getMarkCount(game,MINGSHANG_XUNBAO_TILI_LIMIT);
  const wing = getMarkCount(game,WING_CB_4);
  const recoveryRate = wing > 0 ? (100 + Math.min(wing,250) * 2) / 100 : 1;
  const xianhuNums = getPropNums(game,XIANHU_PROP_ID);
  const xianhuTili = xianhuNums * TILI_PER_XIANHU;
  const remainSeconds = REFRE_SECONDS - gameTime;
  const remainHours = remainSeconds / 3600;

  // 计时结束前还能自然回的体力:(当前累加值 + 剩余秒×倍率) 每满 300 回 1 点
  const gainBeforeEnd = Math.floor((recovery + Math.max(0,remainSeconds) * recoveryRate) / RECOVER_SECONDS);

  // 本轮结束前体力 = 当前 + 自然恢复(源码 Cur_TuLi++ 不检查上限,可超 MaxTiLi).
  // 计时到 36000s 结算时 Initial() 会补满到 MaxTiLi 并把层数重置为 1,那是下一轮;
  // 本轮要走完寻宝必须在结算前,所以这里按结算前的自然恢复值算,不按补满后的数值.
  const tiliAtEnd = curTuli + gainBeforeEnd;
  console.log("\n=== 本次寻宝计时 ===");
  console.log(`  当前体力 Cur_TuLi = ${String(curTuli)} / 上限 ${String(maxTili)}`);
  console.log(`  已计时 ${gameTime.toFixed(1)}s / 周期 ${String(REFRE_SECONDS)}s，剩余 ${remainSeconds.toFixed(1)}s（${remainHours.toFixed(2)} 小时）`);
  console.log(`  恢复累加 TiLiRecovery = ${recovery.toFixed(1)} / ${String(RECOVER_SECONDS)}；Wing_CB_4 = ${String(wing)}，恢复倍率 ×${recoveryRate.toFixed(2)}`);
  console.log(`  本轮结算前自然恢复 +${String(gainBeforeEnd)} → 体力 ${String(tiliAtEnd)}`);
  console.log(`  注:计时满 36000s 会结算 Initial() 补满到 ${String(maxTili)} 并把层数重置为 1(下一轮),本轮寻宝须在结算前走完,故不按补满后的 ${String(maxTili)} 计算`);
  console.log("\n=== 本轮结束前获得的体力 ===");
  console.log(`  当前 ${String(curTuli)} → 本轮结束前可到 ${String(tiliAtEnd)}，本轮还能补 ${String(gainBeforeEnd)}`);
  console.log(`\n=== 距跑完一次寻宝(需 ${String(needTili)} 体力:前9层期望+第10层全开) ===`);
  console.log(`  仙葫药 ${String(xianhuNums)} 个 × ${String(TILI_PER_XIANHU)} = 仙葫芦体力 ${String(xianhuTili)}`);
  const totalTili = tiliAtEnd + xianhuTili;
  console.log(`  总体力(本轮结束前 ${String(tiliAtEnd)}) + 仙葫芦体力(${String(xianhuTili)}) = ${String(totalTili)}`);
  const need = needTili - totalTili;
  if (need > 0) {
    const needPills = Math.ceil(need / TILI_PER_XIANHU);
    console.log(`  走完本轮还差 ${String(need)} 体力 → 需再用 ${String(needPills)} 个仙葫芦（${String(needPills * 1888)} 元宝）`);
  } else {
    console.log(`  已够（多 ${String(-need)} 体力，无需再用仙葫芦）`);
  }
}
runMain(main);