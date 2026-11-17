import {argNumber,formatSuoXie,getMarkCount,getPropNums,isArgOn,loadSave,parseArgs,resolveSaveDir} from "./readSave.ts";
import {loadConfig,runMain} from "./tools.ts";
import type {CampData,CampPlayerRecord,SaveBundle} from "./readSave.ts";

interface DiKuaiTile {
  col:      number;
  index:    number;
  level:    number;
  neighbor: number[];
}

interface InvestJump {
  cost: number;
  kind: "rank" | "share";
  net:  number;
  rank: number;
}

interface InvestPlan {
  baseRank:    number;
  bestKind:    "rank" | "share";
  bestNet:     number;
  bestRank:    number;
  bestX:       number;
  bestYuanbao: number;
  cap:         number;
  lingLi:      number;
  rankJumps:   InvestJump[];
  yuanbao:     number;
}

interface Settlement {
  gongXun:     number;
  rank:        number;
  rankReward:  number;
  share:       number;
  shareReward: number;
  total:       number;
  yuanbao:     number;
}

/**
 * 阵营元宝计算器 公式全部来自反编译代码:
 * - 结算:YingLing.KeJinSystem/ZhenYingZhenDou_Manager.cs 第 181-222 行 JieSuan()
 * - 积分:AddJiFen() 每次触发按归属己方的地块加分(第 335-348 行)
 * - 加分节奏:AddTimer 第 244-249 行 JifenCulTime > 60 才加分,加完清零(不是减 60),所以第一次加分
 * 还差 60 - JifenCulTime 秒,此后每 60 秒一次;第 242 行 OpenGameTime > 28800 那一次直接进结算,
 * 不再走 AddJiFen,最后一个不完整分钟不计分
 * - 地块分值:DiKuaiSettingData.GetFenShu()(1→2,2→5,3→9,4→15)
 * - 名次:GetPaiMing() 按贡献降序,GetPlayerPaiMing() 取玩家位置
 * - 分润:GetPlayerJiFenPercent() = 我的贡献 / 己方总贡献
 * - 轮数倍率:(10 + min(Round,20)) / 10
 * - 王者之翼:Mark_Enum.Wing_CB_3(枚举序号 70)每级 +5%
 * - 元宝投入:UIBlockZhenYingBuChongLingLi.cs 第 105-120 行,1 元宝 = 1 贡献 + 10 灵力,
 * 单次上限 (600000 - 己方灵力) / 10 且不大于持有元宝
 * - 用法:pnpm zhenyin [每分钟积分增加值],第一个位置参数默认按当前归属己方地块求和
 * (AddJiFen 只加己方地块,全图 13 块地总分 71 仅作基准显示)
 */
const LINGLI_MAX = 60_0000;
const MY_CHA_ID = 1; // 几号存档
const ROUND_SECONDS = 8 * 60 * 60; // 8小时 = 28800秒
const TICK_SECONDS = 60.1; // 60秒结算一次积分
const WING_MARK = 70; // 王者之翼
const args = parseArgs(process.argv.slice(2));
const dir = resolveSaveDir(args);
const save = loadSave(dir);
const wingLevel = getMarkCount(save.game,WING_MARK); // 王者之翼等级
const wingLevelAddon = (100 + wingLevel * 5) / 100;
const YUANBAO_PROP = 95;

// GetPlayerJiFenPercent():<0 → 0.01,>1 → 0.99
function clampShare (value: number): number {
  if (value < 0) {
    return 0.01;
  }
  if (value > 1) {
    return 0.99;
  }
  return value;
}

// 剩余时间内还能触发几次 AddJiFen
function countTicks (remainSeconds: number,jifenCulTime: number): number {
  const firstTick = TICK_SECONDS - jifenCulTime;
  if (remainSeconds < firstTick) {
    return 0;
  }
  return Math.floor((remainSeconds - firstTick) / TICK_SECONDS) + 1;
}

// 补充灵力买贡献:1 元宝换 1 贡献,只抬高 50% 分润占比和自己的名次,不抬高积分
function investPlan (camp: CampData,save: SaveBundle,score: number,members: readonly CampPlayerRecord[],round: number,wingLevel: number,base: Settlement): InvestPlan {
  const lingLi = camp.PlayZhenYing === 2 ? camp.WestLingli : camp.EastLingLi;
  const yuanbao = getPropNums(save.game,YUANBAO_PROP);
  const cap = Math.max(0,Math.min(yuanbao,Math.floor((LINGLI_MAX - lingLi) / 10)));

  // settle() 含 BigInt 整除与 float32 取整,净收益是整数阶梯函数;
  // 逐点扫描 0..cap 取 net 最大者,自动覆盖名次跳变,不用连续导数近似
  let bestCost = 0;
  let bestNet = 0;
  let bestRank = base.rank;
  let bestYuanbao = base.yuanbao;
  const byRank = new Map<number,InvestJump>();
  for (let cost = 1; cost <= cap; cost += 1) {
    const next = settle(score,members,cost,round,wingLevel);
    const net = next.yuanbao - base.yuanbao - cost;
    if (net > bestNet) {
      bestCost = cost;
      bestNet = net;
      bestRank = next.rank;
      bestYuanbao = next.yuanbao;
    }

    // 每个名次保留最便宜的投入点,供买名次清单展示
    if (next.rank >= base.rank) {continue;}
    const seen = byRank.get(next.rank);
    if (!seen || cost < seen.cost) {
      byRank.set(next.rank,{cost,kind: "rank",net,rank: next.rank});
    }
  }
  const best = byRank.get(bestRank);
  const bestKind: "rank" | "share" = bestRank < base.rank && best?.cost === bestCost ? "rank" : "share";
  return {
    baseRank:  base.rank,
    bestKind,
    bestNet,
    bestRank,
    bestX:       bestCost,
    bestYuanbao,
    cap,
    lingLi,
    rankJumps: [...byRank.values()].toSorted((left,right) => left.cost - right.cost),
    yuanbao
  };
}
function investTable (plan: InvestPlan,score: number,members: readonly CampPlayerRecord[],round: number,wingLevel: number,base: Settlement): string[] {
  const lines: string[] = ["","--- 元宝投入扫描表 ---"," 投入元宝      名次      产出元宝        增量       净收益  每 1 元宝回报"];
  const samples = [...new Set([...[50,100,200,500,1000,2000,5000,10000,20000,50000]
    .filter(item => item <= plan.cap),plan.cap])].toSorted((left,right) => left - right);
  for (const extra of samples) {
    const next = settle(score,members,extra,round,wingLevel);
    const delta = next.yuanbao - base.yuanbao;
    lines.push(
      `${String(extra).padStart(9)}  ${String(next.rank).padStart(5)}  ${formatSuoXie(next.yuanbao).padStart(12)}  ${formatSuoXie(delta).padStart(9)}  ${formatSuoXie(delta - extra).padStart(10)}  ${(delta / extra).toFixed(3)}`
    );
  }
  return lines;
}
function main (): void {
  const args = parseArgs(process.argv.slice(2));
  if (isArgOn(args,"help")) {
    console.log(
      [
        "用法：pnpm zhenyin [每分钟积分增加值] [参数]",
        "",
        "  54                   第一个位置参数=本轮每分钟积分增加值（默认按当前归属己方的地块求和）",
        "  --save=1             存档槽位（默认 1）",
        "  --dir=路径           直接指定存档目录",
        "  --minutes=60         剩余分钟（默认按存档 OpenGameTime 计算）",
        "  --auto               与默认口径相同，显式指定按当前归属己方的地块求和（覆盖第一个位置参数）",
        "  --gongxun=5330       覆盖我的贡献度（用于模拟）",
        "  --invest             输出元宝投入扫描表"
      ].join("\n")
    );
    return;
  }
  const dir = resolveSaveDir(args);
  const save = loadSave(dir);
  const camp = save.game.zhenYingZhenDou_Manager;
  if (!camp) {
    throw new Error("存档里没有 zhenYingZhenDou_Manager，可能还没解锁阵营");
  }
  const tiles = loadConfig<DiKuaiTile[]>("dikuai");
  const mySide = camp.PlayZhenYing;
  const sideTiles = (camp.diKuaiData_Recorders ?? []).filter(
    tile => tile.ZhenYingBelong === mySide
  );
  let autoRate = 0;
  for (const tile of sideTiles) {
    const config = tiles.find(item => item.index === tile.ID);
    if (config) {
      autoRate += tileScore(config.level);
    }
  }

  // 第一个非 -- 参数就是本轮每分钟积分增加值；默认取 AddJiFen 实际会加的己方地块
  const rateArg = process.argv.slice(2).find(item => !item.startsWith("--"));
  const rateInput = rateArg === undefined ? autoRate : Number(rateArg);
  if (!Number.isFinite(rateInput)) {
    throw new TypeError(`第一个参数应为每分钟积分增加值，收到：${rateArg ?? ""}`);
  }
  const minutesOverride = argNumber(args,"minutes");

  // 手工指定剩余分钟时,存档里的 JifenCulTime 相位不再适用
  const jifenCulTime = minutesOverride === undefined ? camp.JifenCulTime : 0;
  const remainMinutes = minutesOverride ?? Math.max(0,ROUND_SECONDS - camp.OpenGameTime) / 60;
  const usedRate = isArgOn(args,"auto") ? autoRate : rateInput;
  const ticks = countTicks(remainMinutes * 60,jifenCulTime);
  const currentScore = mySide === 2 ? camp.Jifen_West : camp.Jifen_East;
  const projectedScore = currentScore + ticks * usedRate;

  // 我方成员(GetPaiMing 只取自己阵营,按贡献降序)
  const members: CampPlayerRecord[] = (camp.playerZhengDouRecords ?? [])
    .filter(record => record.CurZhengYing === mySide)
    .map(record => ({...record}));
  const me = members.find(record => record.Cha_ID === MY_CHA_ID);
  if (!me) {
    throw new Error(`我方阵营里找不到玩家（Cha_ID=${String(MY_CHA_ID)}），存档可能已损坏`);
  }
  const overrideGongXun = argNumber(args,"gongxun");
  if (overrideGongXun !== undefined) {
    me.GongXun = Math.round(overrideGongXun);
  }
  members.sort((left,right) => right.GongXun - left.GongXun);
  const round = camp.Round;
  const result = settle(projectedScore,members,0,round,wingLevel);
  const lines: string[] = ["=== 阵营元宝计算 ===",camp.HasOpen
    ? `本轮状态：进行中，已运行 ${(camp.OpenGameTime / 60).toFixed(1)} 分钟，剩余 ${remainMinutes.toFixed(1)} 分钟`
    : "本轮状态：未开启（不点选阵营不会开始，也不会有积分）"];
  const allRate = 71; // 全部占领 加的积分
  const rateNote = rateArg !== undefined && !isArgOn(args,"auto")
    ? `手工指定；当前归属己方 ${String(sideTiles.length)} 块地实际 ${String(autoRate)}，全图基准 ${String(allRate)}`
    : `默认按当前归属己方的 ${String(sideTiles.length)} 块地求和，全图基准 ${String(allRate)}`;
  lines.push(
    `积分速率：${String(usedRate)} 分/分钟（${rateNote}）`,
    `当前我方积分：${formatSuoXie(currentScore)}`,
    `剩余加分次数：${String(ticks)} 次（距下一次加分 ${(TICK_SECONDS - jifenCulTime).toFixed(1)} 秒，此后每 ${String(TICK_SECONDS)} 秒一次）`,
    `预计结算积分：${formatSuoXie(currentScore)} + ${String(ticks)} × ${String(usedRate)} = ${formatSuoXie(projectedScore)}`,"","--- 我方贡献排名 ---");
  for (const [index,record] of members.entries()) {
    const mark = record.Cha_ID === MY_CHA_ID ? " ← 我" : "";
    const percent = result.total === 0 ? 0 : record.GongXun / result.total * 100;
    lines.push(
      `${String(index + 1).padStart(2," ")}. 角色${String(record.Cha_ID).padStart(2," ")}  贡献 ${formatSuoXie(record.GongXun).padStart(12," ")}  ${percent.toFixed(2)}%${mark}`
    );
  }
  lines.push("","--- 结算明细 ---",`我的排名：第 ${String(result.rank)} 名 / 共 ${String(members.length)} 人，贡献 ${formatSuoXie(result.gongXun)}，占己方 ${(result.share * 100).toFixed(2)}%`,`名次奖励：${formatSuoXie(projectedScore)} × ${String(percentForRank(result.rank))}% = ${formatSuoXie(result.rankReward)}`,`50% 分润：${formatSuoXie(Math.floor(projectedScore / 2))} × ${(result.share * 100).toFixed(2)}% = ${formatSuoXie(result.shareReward)}`,`基础收益：${formatSuoXie(result.rankReward + result.shareReward)}`,`轮数倍率：(10 + ${String(Math.min(round,20))}) / 10 = ×${((10 + Math.min(round,20)) / 10).toFixed(1)}（Round=${String(round)}，封顶 20）`,`王者之翼：${wingLevel > 0 ? `等级 ${String(wingLevel)} → ×${wingLevelAddon.toFixed(2)}` : "未解锁 → ×1.00"}`,`预计元宝：${formatSuoXie(result.yuanbao)}`,"","--- 名次对照（同一积分与贡献占比）---");
  for (const rank of [1,2,3,4]) {
    const label = rank === 4 ? "第 4 名及以后" : `第 ${String(rank)} 名`;
    lines.push(`${label}：${formatSuoXie(settle(projectedScore,members,0,round,wingLevel,rank).yuanbao)} 元宝`);
  }
  const plan = investPlan(camp,save,projectedScore,members,round,wingLevel,result);
  lines.push(...planLines(plan));
  if (isArgOn(args,"invest")) {
    lines.push(...investTable(plan,projectedScore,members,round,wingLevel,result));
  }
  console.log(lines.join("\n"));
}
function percentForRank (rank: number): number {
  if (rank === 1) {
    return 25;
  }
  if (rank === 2) {
    return 15;
  }
  return rank === 3 ? 10 : 0;
}
function planLines (plan: InvestPlan): string[] {
  const lines: string[] = [
    "","--- 元宝投入建议（补充灵力：1 元宝 = 1 贡献 + 10 灵力）---",
    `持有元宝 ${formatSuoXie(plan.yuanbao)}；己方灵力 ${formatSuoXie(plan.lingLi)}/${formatSuoXie(LINGLI_MAX)} → 最多可投 ${formatSuoXie(plan.cap)} 元宝`,
    `扫描 0 ~ ${formatSuoXie(plan.cap)} 元宝逐点试算，取净收益最大的精确整数投入（含取整阶梯与名次跳变）`
  ];
  if (plan.bestX > 0 && plan.bestKind === "rank") {
    lines.push(`建议投入 ${formatSuoXie(plan.bestX)} 元宝（= ${formatSuoXie(plan.bestX)} 贡献）→ 名次 第 ${String(plan.baseRank)} 名 → 第 ${String(plan.bestRank)} 名，净赚 ${formatSuoXie(plan.bestNet)} 元宝，投入后结算可得 ${formatSuoXie(plan.bestYuanbao)} 元宝`);
  } else if (plan.bestX > 0) {
    lines.push(`建议投入 ${formatSuoXie(plan.bestX)} 元宝（= ${formatSuoXie(plan.bestX)} 贡献，净收益最大的精确整数点）→ 名次不变（第 ${String(plan.baseRank)} 名），净赚 ${formatSuoXie(plan.bestNet)} 元宝，投入后结算可得 ${formatSuoXie(plan.bestYuanbao)} 元宝`);
  } else {
    lines.push("建议投入 0 元宝：全区间扫描后没有净收益为正的投入点");
  }
  if (plan.rankJumps.length === 0) {
    lines.push(`没有能靠元宝买到的更高名次（当前第 ${String(plan.baseRank)} 名）`);
  } else {
    lines.push(`买名次：${plan.rankJumps.map(item => `${formatSuoXie(item.cost)} 元宝 → 第 ${String(item.rank)} 名（${item.net >= 0 ? "净赚" : "净亏"} ${formatSuoXie(Math.abs(item.net))}）`).join("；")}`);
  }
  return lines;
}

// JieSuan() 原样复刻;extraGongXun 模拟补充灵力买贡献,rankOverride 用于名次对照
function settle (score: number,members: readonly CampPlayerRecord[],extraGongXun: number,round: number,wingLevel: number,rankOverride?: number): Settlement {
  const list: CampPlayerRecord[] = members.map(record => (record.Cha_ID === MY_CHA_ID
    ? {...record,GongXun: record.GongXun + extraGongXun}
    : {...record}));
  list.sort((left,right) => right.GongXun - left.GongXun);
  const gongXun = list.find(record => record.Cha_ID === MY_CHA_ID)?.GongXun ?? 0;
  const total = list.reduce((sum,record) => sum + record.GongXun,0);
  const rank = rankOverride ?? list.findIndex(record => record.Cha_ID === MY_CHA_ID) + 1;

  // 游戏用 float32 算占比和分润,float32 精度会带来 ±1 元宝差异
  const share = clampShare(total === 0 ? 0 : Math.fround(Math.fround(gongXun) / Math.fround(total)));
  const myScore = BigInt(Math.round(score));
  const rankReward = myScore * BigInt(percentForRank(rank)) / 100n;
  const halfScoreF32 = Math.fround(Number(myScore / 2n));
  const shareReward = BigInt(Math.trunc(Math.fround(halfScoreF32 * share)));
  const scaled = (rankReward + shareReward) * BigInt(10 + Math.min(round,20)) / 10n;
  return {
    gongXun,
    rank,
    rankReward:  Number(rankReward),
    share,
    shareReward: Number(shareReward),
    total,
    yuanbao:     Number(wingLevel > 0 ? scaled * BigInt(100 + wingLevel * 5) / 100n : scaled)
  };
}

// DiKuaiSettingData.GetFenShu()
function tileScore (level: number): number {
  if (level === 1) {
    return 2;
  }
  if (level === 2) {
    return 5;
  }
  if (level === 3) {
    return 9;
  }
  return 15;
}
runMain(main);