/**
 * yuanbao-route —— 6 级抽奖两条「快速拿元宝」路线的定量对比(只读,不写任何文件)
 * 路线 A:选中含御灵宝典(84)的奖池 → 御灵师等级 → 战力 → 推试炼层数拿元宝
 * 路线 B:选中含套娃宝箱(75)的奖池 → 套娃链开箱 → 合成 Lv15 宝石 → 冥商收购换元宝
 * 口径全部来自反编译源码,游戏 StreamingAssets 配置与真实存档,不写死数值:
 * - 奖池:JiangChi_Data_Json.txt(ChouJiangData.GetDropByCount / Drop_Recorder.GetDropByCount)
 * - 抽奖赠送:UIPanel_ChouJiang.Draw_Open:241-249,Mark_Enum.ShiLianChou_AddCount
 * - 道具/品质/合成链/套娃链:Prop_Data_Json.txt + Prop_Chest_TaoWa.GetOpen:24-51
 * - 灵器候选:PropHelper.GerateFaBao:194-209 + config/lingqi.json(每级每把 1 件)
 * - 冥商收购:config/mingshang.json 的 buy 数组 + MingShang_ShouGouRecord.Recycle:26-32
 * - 试炼元宝/疲劳:ShiLian_Manger.GetRewardCurCengShu:85-89 / WinBattle:178-188 / CheckPiLao:160-168
 * - 试炼敌人 HP:enemy-stats.ts trialEnemyHp(LevelToTargetLevel)
 * - 御灵师:game-formulas.ts yuLingLevelCost + GameRecorder.ShowAddition:697-711 / ChanYuLi:632-656
 * 注意:JiangChi_Data_Json.txt 与 Prop_Data_Json.txt 未被 extract-config.py 导出,
 * 因此本脚本按「只读游戏目录」的方式直接解析(与 decompile.ps1 / extract-config.py 同一口径).
 * 用法:pnpm exec tsx src/scripts/yuanbao-route.ts [--save=1] [--tickets=N] [--atk-share=1]
 */
import {existsSync,readFileSync} from "node:fs";
import {join} from "node:path";
import {argNumber,argString,formatSuoXie,getMarkCount,getPropNums,loadSave,parseArgs,resolveSaveDir} from "../readSave.ts";
import {yuLingLevelCost} from "./game-formulas.ts";
import {trialEnemy,trialEnemyHp} from "./enemy-stats.ts";
import type {ShiLianSave} from "../tools.ts";

// #region 类型与只读数据加载
const DEFAULT_GAME_DIR = String.raw`D:\game\steam\steamapps\common\MoNiShouYou`;
const HERE = import.meta.dirname;
const CONFIG_DIR = join(HERE,"..","config");

// 抽奖等级按用户要求统一取 6 级(GameRecorder.GetChouJiangLevel 阈值 50000)
const POOL_LEVEL = 6;
const PROP_TICKET = 10;
const PROP_YUANBAO = 95;
const PROP_BOOK = 84;
const PROP_TAOWA_LV6 = 75;
const PROP_TAOWA_LV10 = 79;
const PROP_ZIXUAN_BAOSHI_LV6 = 45;
const PROP_TUPO = 81;
const PROP_WUGUI = 157;
const MARK_SHILIANCHOU_ADD = 22;
const MARK_REFRESH_CHOUJIANG_GET = 23;
const MARK_REDUCE_CHOUJIANG_TIME = 21;
const MARK_ADD_YULINGSHI_EXP = 33;
const TUPO_COST = 500;
const TRIAL_BASE_YUANBAO = 450;
const TRIAL_PER_LAYER = 50;
const PILAO_BUY_COST = 10;
const PILAO_RECOVER_MINUTES = 10;
const MINGSHANG_GRIDS = 10;
const NPC_SHOUGOU_SECONDS = 2700;

// #endregion
// #region 两条路线的元宝折算
interface Context {
  bonus:          number;
  bookParams1:    number;
  buy:            MingShangEntry[];
  curExp:         number;
  curLevel:       number;
  lingQiWeapons:  number;
  lv15Price:      number;
  lv15Sellable:   number;
  poolA:          Pool;
  poolB:          Pool;
  props:          Map<number,PropDef>;
  refreshMinutes: number;
  shiLian:        ShiLianSave;
  tuPoAvailable:  number;
  wugui:          number;
  yaoShui:        number;
  yuanbaoHeld:    number;
  yuLingExpMark:  number;
}

interface DropEntry {
  Drop_Percent: number;
  Prop_ID:      number;
  Prop_Nums:    number;
}

interface EquipRemand {
  Nums:   number;
  PropID: number;
}

interface LingQiConfig {
  levels:  unknown[];
  weapons: unknown[];
}

interface MingShangConfig {
  buy:  MingShangEntry[];
  sell: MingShangEntry[];
}

interface MingShangEntry {
  index: number;
  nums:  number;
  price: number;
  prop:  number;
}

interface Pool {
  ChouJiangIndex: number;
  JiangChi:       DropEntry[];
  JiangChi_Index: number;
  Level:          number;
}

interface PropDef {
  _propID:              number;
  className:            string;
  EffectRecoder?:       {Params_1: number};
  LevelUpRemandProp?:   EquipRemand[];
  NextPropID?:          number;
  PinZhi_Level:         number;
  TarGetLevelUpPropID?: number;
  TargteProp?:          number;
  ZiXuan?:              boolean;
}

interface RouteAResult {
  atkMultiplier: number;
  books:         number;
  breakthroughs: number;
  layersFrom:    number;
  layersTo:      number;
  levelTo:       number;
  mibao:         number;
  mibaoYuanbao:  number;
  speedFrom:     number;
  speedTo:       number;
  yuanbaoGross:  number;
  yuanbaoNet:    number;
}

interface RouteBResult {
  boxesLv10:           number;
  lv15Expected:        number;
  lv15Real:            number;
  taowaLv6:            number;
  yuanbaoFromBox:      number;
  yuanbaoFromLv15:     number;
  yuanbaoFromMaterial: number;
  ziXuan:              number;
}

// #endregion
// #region 输出
interface Throughput {
  boxesPerRound:   number;
  expectedGrids:   number;
  hoursAuto:       number;
  manualCost:      number;
  netManual:       number;
  rounds:          number;
  unitLingPrice:   number;
  yuanbaoPerRound: number;
}

// 冥商收购表里某道具的最高单价(元宝/个).
function bestUnitPrice (buy: MingShangEntry[],propID: number): number {
  let best = 0;
  for (const entry of buy) {
    if (entry.prop === propID) {
      best = Math.max(best,entry.price / entry.nums);
    }
  }
  return best;
}

// 品质 p 的开箱候选数:配置文件里的灵牌/宝石 + GerateFaBao 动态生成的灵器.
function candidateCount (pinzhi: number,props: Map<number,PropDef>,lingQiWeapons: number): number {
  let count = 0;
  for (const def of props.values()) {
    if (def.PinZhi_Level === pinzhi && isEquipClass(def.className)) {
      count += 1;
    }
  }
  return count + lingQiWeapons;
}

// #endregion
// #region 源码口径:抽奖 / 套娃 / 合成 / 冥商
// 每张抽奖卷在该奖池抽到指定道具的期望个数,含十连赠送放大系数.
function expectedPerTicket (pool: Pool,propID: number,bonus: number): number {
  let sum = 0;
  for (const drop of pool.JiangChi) {
    if (drop.Prop_ID === propID) {
      sum += drop.Prop_Nums * drop.Drop_Percent / 1000;
    }
  }
  return sum * bonus;
}

// 大数走游戏缩写口径,小数保留有效数字,避免 10 万以下被四舍五入成 0.
function fmt (value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  if (value !== 0 && Math.abs(value) < 1) {
    return value.toPrecision(4);
  }
  if (Math.abs(value) < 10_0000) {
    return String(Number(value.toFixed(2)));
  }
  return formatSuoXie(value);
}

// 只有灵牌(Prop_YuLing_Equip)与宝石(Prop_YuLing_BaoShi)参与开箱候选与冥商收购.
function isEquipClass (className: string): boolean {
  return className.endsWith("Prop_YuLing_Equip") || className.endsWith("Prop_YuLing_BaoShi");
}

// 读取灵器配置:GerateFaBao 为每个品质生成 weapons.length 件灵器.
function loadLingQi (): LingQiConfig {
  return JSON.parse(readFileSync(join(CONFIG_DIR,"lingqi.json"),"utf8")) as LingQiConfig;
}

// 读取冥商配置:buy 是「玩家卖道具得元宝」的收购表(MingShang_ShouGouRecord.Recycle).
function loadMingShang (): MingShangConfig {
  const config = JSON.parse(readFileSync(join(CONFIG_DIR,"mingshang.json"),"utf8")) as MingShangConfig;
  return config;
}

// 解析 6 级奖池,并校验每个奖池概率和为 1000(ChouJiangData.Check).
function loadPools (gameDir: string): Pool[] {
  const pools: Pool[] = [];
  for (const raw of readLines(gameDir,"JiangChi_Data_Json.txt")) {
    const line = raw.trim();
    if (!line.startsWith("{")) {
      continue;
    }
    const pool = JSON.parse(line) as Pool;
    const total = pool.JiangChi.reduce((sum,item) => sum + item.Drop_Percent,0);
    if (total !== 1000) {
      throw new Error(`奖池 ${String(pool.ChouJiangIndex)} 概率和不为 1000：${String(total)}`);
    }
    if (pool.Level === POOL_LEVEL) {
      pools.push(pool);
    }
  }
  if (pools.length === 0) {
    throw new Error(`JiangChi_Data_Json.txt 里没有 Level=${String(POOL_LEVEL)} 的奖池`);
  }
  return pools;
}

// 解析道具配置:类名行分段,后续 JSON 行属于该类名(与 ToolClass.AnalseToDic 一致).
function loadProps (gameDir: string): Map<number,PropDef> {
  const result = new Map<number,PropDef>();
  let className = "";
  for (const raw of readLines(gameDir,"Prop_Data_Json.txt")) {
    const line = raw.trim();
    if (line.startsWith("YingLing.")) {
      className = line;
      continue;
    }
    if (!line.startsWith("{")) {
      continue;
    }
    const def = JSON.parse(line) as PropDef;
    result.set(def._propID,{...def,className});
  }
  return result;
}
function main (): void {
  const args = parseArgs(process.argv.slice(2));
  const gameDir = argString(args,"game-dir") ?? DEFAULT_GAME_DIR;
  const atkShare = argNumber(args,"atk-share") ?? 1;
  if (atkShare <= 0 || atkShare > 1) {
    throw new Error("--atk-share 必须在 (0,1] 之间，1 表示路线 A 最乐观");
  }
  const save = loadSave(resolveSaveDir(args));
  const game = save.game;
  const pools = loadPools(gameDir);
  const props = loadProps(gameDir);
  const mingShang = loadMingShang();
  const lingQi = loadLingQi();
  const poolA = pools.find(pool => pool.JiangChi.some(drop => drop.Prop_ID === PROP_BOOK));
  const poolB = pools.find(pool => pool.JiangChi.some(drop => drop.Prop_ID === PROP_TAOWA_LV6));
  if (!poolA || !poolB) {
    throw new Error(`Level=${String(POOL_LEVEL)} 奖池里找不到御灵宝典池或套娃宝箱池`);
  }

  // 冥商收购表里品质 15 且属于灵牌/宝石的道具,才是能换元宝的 Lv15 装备
  const lv15Prices: number[] = [];
  for (const entry of mingShang.buy) {
    const def = props.get(entry.prop);
    if (def?.PinZhi_Level === 15 && isEquipClass(def.className)) {
      lv15Prices.push(entry.price);
    }
  }
  if (lv15Prices.length === 0) {
    throw new Error("冥商收购表里没有品质 15 的灵牌/宝石");
  }
  const lv15Price = Math.max(...lv15Prices);
  const bookParams1 = props.get(PROP_BOOK)?.EffectRecoder?.Params_1;
  if (!bookParams1) {
    throw new Error("Prop_Data_Json.txt 里读不到御灵宝典的 Params_1");
  }
  const bonusCount = Math.min(getMarkCount(game,MARK_SHILIANCHOU_ADD),19);
  const bonus = 1 + bonusCount / 10;
  const ctx: Context = {
    bonus,
bookParams1,
    buy:            mingShang.buy,
    curExp:         game.YuLingExp ?? 0,
curLevel:       game.CurYuLingShiLv ?? 1,
    lingQiWeapons:  lingQi.weapons.length,
lv15Price,
lv15Sellable:   lv15Prices.length,
    poolA,
    poolB,
    props,
    refreshMinutes: 120 - getMarkCount(game,MARK_REDUCE_CHOUJIANG_TIME),
    shiLian:        game.ShiLian_Manger ?? {},
    tuPoAvailable:  Math.floor(getPropNums(game,PROP_TUPO) / TUPO_COST),
    wugui:          getPropNums(game,PROP_WUGUI),
    yaoShui:        getPropNums(game,PROP_TUPO),
    yuanbaoHeld:    getPropNums(game,PROP_YUANBAO),
    yuLingExpMark:  getMarkCount(game,MARK_ADD_YULINGSHI_EXP)
  };
  const ticketsHeld = getPropNums(game,PROP_TICKET);
  const tickets = argNumber(args,"tickets") ?? ticketsHeld;
  const lines: string[] = [];
  lines.push("=== 6 级抽奖：两条拿元宝路线对比 ===","",`存档：${save.dir}`,`抽奖累计 ${fmt(game.ChouJiangCount ?? 0)} 次 → 6 级；当前奖池 #${String(game.Cur_JiangChiIndex ?? 0)}（奖池 #${String(poolB.ChouJiangIndex)} 是套娃池，#${String(poolA.ChouJiangIndex)} 是御灵宝典池）`,`持有抽奖卷 ${fmt(ticketsHeld)}，元宝 ${fmt(ctx.yuanbaoHeld)}，御灵师 Lv.${String(ctx.curLevel)}，试炼第 ${String(ctx.shiLian.Cur_CengShu ?? 1)} 层，疲劳 ${String(ctx.shiLian.Cur_PiLao ?? 0)}/100`,`十连赠送 Mark=${String(bonusCount)} → 每张卷实际抽 ${fmt(bonus)} 次；御灵宝典每本 ${fmt(bookParams1 * (100 + ctx.yuLingExpMark) / 100)} 御力；奖池每 ${fmt(ctx.refreshMinutes)} 分钟轮换一次，手动刷新需五鬼运财符（持有 ${fmt(ctx.wugui)}）`,`冥商 Lv15 收购 ${String(ctx.lv15Sellable)} 种，单价 ${fmt(lv15Price)} 元宝；收购格子 ${String(MINGSHANG_GRIDS)}/${String(mingShang.buy.length)}，NPC 每 ${fmt(NPC_SHOUGOU_SECONDS / 60)} 分钟收走 1 格`,"","--- 路线 A（御灵宝典 → 战力 → 试炼）---");
  const a = routeA(tickets,ctx,atkShare);
  lines.push(`${fmt(tickets)} 张卷 → 御灵宝典 ${fmt(a.books)} 本 → Lv.${String(ctx.curLevel)} → Lv.${String(a.levelTo)}（突破 ${String(a.breakthroughs)} 次，存档忘情水 ${fmt(ctx.yaoShui)} 可支撑 ${String(ctx.tuPoAvailable)} 次）`,`攻击倍率上界 ${fmt(a.atkMultiplier)}（--atk-share=${fmt(atkShare)}）→ 试炼 ${String(a.layersFrom)} → ${String(a.layersTo)} 层，胜 ${String(a.layersTo - a.layersFrom)} 场`,`敌方速度 ${fmt(a.speedFrom)} → ${fmt(a.speedTo)}（御灵宝典不加速度，只有每 10 级突破给速度；这是 A 的额外硬门槛）`,`元宝：毛 ${fmt(a.yuanbaoGross)}，扣补疲劳 ${fmt(PILAO_BUY_COST)} 元宝/场后净 ${fmt(a.yuanbaoNet)}；试炼秘宝 ${fmt(a.mibao)} 个（自选 Lv15 宝石）再折 ${fmt(a.mibaoYuanbao)}`,`每抽 ${fmt(totalA(a) / tickets)} 元宝，合计 ${fmt(totalA(a))} 元宝`,"");
  const oneLv15Tickets = ticketsForOneLv15(ctx);
  const b = routeB(tickets,ctx);
  const chain = taoWaChain(ctx.props);
  lines.push(`原始投入：${fmt(tickets)} 张卷 → 套娃宝箱Lv6 ${fmt(b.taowaLv6)} 个、自选宝石匣Lv6 ${fmt(b.ziXuan)} 个`,`套娃链（每个 Lv6 宝箱）期望：${[...chain].map(([pinzhi,count]) => `Lv${String(pinzhi)} ${fmt(count)}`).join(" / ")}；共得 Lv10 宝箱 ${fmt(b.boxesLv10)} 个`,"","--- 路线 B（套娃池 → 直接卖 Lv10 套娃宝箱）---",`卖 Lv10 宝箱：${fmt(b.boxesLv10)} 个 × ${fmt(bestUnitPrice(ctx.buy,PROP_TAOWA_LV10))} 元宝/个 = ${fmt(b.yuanbaoFromBox)} 元宝（开箱即卖，不合成）`,`奖池附带基础材料卖冥商 ${fmt(b.yuanbaoFromMaterial)} 元宝`,`每抽 ${fmt(b.yuanbaoFromBox / tickets)} 元宝，合计 ${fmt(b.yuanbaoFromBox + b.yuanbaoFromMaterial)} 元宝`,"","--- 路线 C（套娃池 → 5合1 合成到 Lv15 宝石 → 冥商回收）---",`Lv6→Lv15 需 ${fmt(mergeRatio(ctx.props))} 件同系列（5^9）；开箱候选 ${String(candidateCount(6,ctx.props,ctx.lingQiWeapons))} 种/品质，仅 ${String(ctx.lv15Sellable)} 种 Lv15 能卖`,`连续期望上界：可凑 ${fmt(b.lv15Expected)} 个 Lv15 → ${fmt(b.lv15Expected * ctx.lv15Price)} 元宝（取整实际 ${fmt(b.lv15Real)} 个 → ${fmt(b.yuanbaoFromLv15)} 元宝）`,`每抽 ${fmt(b.lv15Expected * ctx.lv15Price / tickets)} 元宝；但凑出第 1 个完整 Lv15 需约 ${fmt(oneLv15Tickets)} 张卷`,"");
  const enoughCount = mingShang.buy.filter(entry => getPropNums(game,entry.prop) >= entry.nums).length;
  const tp = mingshangThroughput(mingShang.sell,ctx,b.boxesLv10,enoughCount);
  lines.push("--- 冥商变现吞吐（决定「快不快」）---",`收购表 ${String(ctx.buy.length)} 条，存档当前能满足 Enough() 的只有 ${String(enoughCount)} 条；每轮 ${String(MINGSHANG_GRIDS)} 格中套娃Lv10 档位期望 ${fmt(tp.expectedGrids)} 格 → 可卖 ${fmt(tp.boxesPerRound)} 个宝箱 ≈ ${fmt(tp.yuanbaoPerRound)} 元宝`,`卖完 ${fmt(b.boxesLv10)} 个宝箱需约 ${fmt(tp.rounds)} 轮刷新：`,`· 一键回收 + 等 NPC 补满剩余格子 → 约 ${fmt(tp.hoursAuto)} 小时`,`· 手动用冥君令刷新（最低 ${fmt(tp.unitLingPrice)} 元宝/个，存档持有 ${fmt(getPropNums(game,161))} 个）→ 成本 ${fmt(tp.manualCost)} 元宝，B 净剩 ${fmt(tp.netManual + b.yuanbaoFromMaterial)} 元宝`,`关键纠正：套娃宝箱最高只出品质 10 装备，开不出 Lv15 宝石；实际凑出第 1 个可卖 Lv15 需要约 ${fmt(oneLv15Tickets)} 张抽奖卷`,"","--- 不同抽数下的元宝（A 试炼 / B 卖Lv10 / C 合Lv15）---");
  const scales = [...new Set([1e3,1e4,tickets,1e6,1e8].filter(value => value > 0))].toSorted((x,y) => x - y);
  for (const scale of scales) {
    const ra = routeA(scale,ctx,atkShare);
    const rb = routeB(scale,ctx);
    const cYuan = rb.lv15Expected * ctx.lv15Price;
    lines.push(`${fmt(scale)} 张卷：A ${fmt(totalA(ra))}（推到 ${String(ra.layersTo)} 层） / B ${fmt(rb.yuanbaoFromBox + rb.yuanbaoFromMaterial)}（Lv10宝箱 ${fmt(rb.boxesLv10)} 个） / C ${fmt(cYuan)}（Lv15期望 ${fmt(rb.lv15Expected)} 个）`);
  }
  lines.push("");
  const perA = totalA(a) / tickets;
  const perB = (b.yuanbaoFromBox + b.yuanbaoFromMaterial) / tickets;
  const perC = b.lv15Expected * ctx.lv15Price / tickets;
  const target = lv15Price;
  const ticketsA = ticketsForA(target,ctx,atkShare);
  const ticketsB = perB > 0 ? target / perB : Infinity;
  const netBManual = tp.netManual + b.yuanbaoFromMaterial;
  const winner = perB >= perA && perB >= perC ? "套娃池卖Lv10（B）" : perC >= perA ? "合Lv15（C）" : "御灵宝典池（A）";
  lines.push("--- 结论 ---",`口径 1｜每张抽奖卷的毛元宝：A ${fmt(perA)} / B ${fmt(perB)} / C(合Lv15) ${fmt(perC)}`,`→ B 是 A 的 ${perA > 0 ? fmt(perB / perA) : "∞"} 倍、是 C 的 ${perC > 0 ? fmt(perB / perC) : "∞"} 倍；综合最优 = ${winner}`,`口径 2｜扣掉冥商手动刷新成本后的净额：A ${fmt(totalA(a))}（打 ${String(a.layersTo - a.layersFrom)} 场即到账） / B ${fmt(netBManual)}（要 ${fmt(tp.rounds)} 轮刷新，等 NPC 自动约 ${fmt(tp.hoursAuto)} 小时）；C 同样受格子限制且更慢`,`口径 3｜攒到 1 个 Lv15 等额元宝 ${fmt(target)}：A 需 ${fmt(ticketsA)} 张卷，B 需 ${fmt(ticketsB)} 张卷，C 自身凑 1 个完整 Lv15 需 ${fmt(oneLv15Tickets)} 张卷`,`关键结论：套娃池真正能换元宝的是直接卖 Lv10 宝箱（路线 B）；路线 C（硬合 Lv15）因 5^9 合成损耗，每张券期望元宝最低，凑出第 1 个 Lv15 需约 ${fmt(oneLv15Tickets)} 张券，当前及可预见体量下都最差`,`综合：按单位资源产出选 ${winner}；按「立刻到账」A 更快（打 ${String(a.layersTo - a.layersFrom)} 场 vs B 的 ${fmt(tp.rounds)} 轮冥商刷新）。不要走 C 路线`,"","--- 时间/吞吐约束（两条路线共同）---",`· 试炼疲劳每 ${String(PILAO_RECOVER_MINUTES)} 分钟恢复 1 点，或花 ${String(PILAO_BUY_COST)} 元宝补 1 点；每层奖励 ${String(TRIAL_PER_LAYER)}×层数+${String(TRIAL_BASE_YUANBAO)} 元宝且每层只能赢一次`,`· 奖池每 ${fmt(ctx.refreshMinutes)} 分钟自动换到下一个（1→2→3→4→1），刷新还会免费给 ${String(getMarkCount(game,MARK_REFRESH_CHOUJIANG_GET))} 次当前池产出；想固定选中某个池，须在其窗口内一次批量抽完`,`· 冥商收购只有 ${String(MINGSHANG_GRIDS)} 个格子、每格一次性，全部用完才自动刷新；手动刷新要 1 个冥君令，或等 NPC 每 ${fmt(NPC_SHOUGOU_SECONDS / 60)} 分钟收走 1 格`,"· A 的伤害倍率是「攻击全部来自御灵师等级」的乐观上界，且忽略速度/命中门槛；B 的 Lv15 产量已按同系列 5 合 1 向下取整，均未计入收购格子等待时间");
  console.log(lines.join("\n"));
}

// 沿合成链把 1 件品质 6 装备升到 Lv15 需要多少件同级装备(配置里逐级读 Nums).
function mergeRatio (props: Map<number,PropDef>): number {
  const pinzhi = 6;
  let id = 200 + pinzhi - 1;
  let ratio = 1;
  for (let level = pinzhi; level < 15; level += 1) {
    const def = props.get(id);
    const nums = def?.LevelUpRemandProp?.[0]?.Nums;
    const next = def?.TarGetLevelUpPropID;
    if (!def || !nums || !next) {
      throw new Error(`品质 ${String(level)} 的合成链不完整（PropID ${String(id)}）`);
    }
    ratio *= nums;
    id = next;
  }
  return ratio;
}

/**
 * 冥商收购变现吞吐:10 个格子从收购表随机抽取,每格一次性,10 格全满才刷新.
 * MingShang_Manager.RefreShouGou:151-159 / CheckShouGouRefre:79-89 / AddTime:50-61,
 * UIPanel_MingShang.RefreShouGouEvent:283-293 手动刷新消耗 1 个冥君令(161).
  * @param sell 出售记录.
  * @param ctx 上下文.
  * @param boxesLv10 Lv10 宝箱数.
  * @param enoughCount 满足 Enough 的条数.
  * @returns Throughput.
*/
function mingshangThroughput (
  sell: MingShangEntry[],
  ctx: Context,
  boxesLv10: number,
  enoughCount: number
): Throughput {
  const entries = ctx.buy.filter(entry => entry.prop === PROP_TAOWA_LV10);
  if (entries.length === 0) {
    throw new Error("冥商收购表里没有套娃宝箱Lv10(79)");
  }
  const avgNums = entries.reduce((sum,entry) => sum + entry.nums,0) / entries.length;
  const avgPrice = entries.reduce((sum,entry) => sum + entry.price,0) / entries.length;
  const expectedGrids = MINGSHANG_GRIDS * entries.length / ctx.buy.length;
  const boxesPerRound = expectedGrids * avgNums;
  const yuanbaoPerRound = expectedGrids * avgPrice;
  const rounds = boxesLv10 / boxesPerRound;

  // 一键回收只填 Enough() 的格子,其余靠 NPC 每 45 分钟占 1 格
  const enoughRatio = enoughCount / ctx.buy.length;
  const hoursAuto = rounds * MINGSHANG_GRIDS * (1 - enoughRatio) * NPC_SHOUGOU_SECONDS / 3600;
  let unitLingPrice = Infinity;
  for (const entry of sell) {
    if (entry.prop === 161) {
      unitLingPrice = Math.min(unitLingPrice,entry.price / entry.nums);
    }
  }
  const manualCost = rounds * unitLingPrice;
  return {
    boxesPerRound,
expectedGrids,
hoursAuto,
manualCost,
    netManual: boxesLv10 * bestUnitPrice(ctx.buy,PROP_TAOWA_LV10) - manualCost,
    rounds,
unitLingPrice,
yuanbaoPerRound
  };
}

// 读取游戏 StreamingAssets 里「每行一个 JSON」的配置,跳过首行类名与空行.
function readLines (gameDir: string,fileName: string): string[] {
  const path = join(gameDir,"MoNiShouYou_Data","StreamingAssets",fileName);
  if (!existsSync(path)) {
    throw new Error(`找不到游戏配置：${path}（用 --game-dir 指定游戏目录）`);
  }
  return readFileSync(path,"utf8").replace(/^\u{FEFF}/u,"")
.split(/\r?\n/);
}

/**
 * 路线 A:御灵宝典 → 御力 → 御灵师等级 → 攻击 → 推试炼层数 → 元宝.
 * 伤害倍率按「玩家攻击全部来自御灵师等级」计算,并用 --atk-share 缩放, 这是路线 A 的乐观上界:真实面板还有装备/阵法/图鉴/研究,占比越小路线 A 越差.
 * 仅按敌方 HP 门槛推层(忽略速度/命中门槛),同样是上界.
  * @param tickets 参数 tickets.
 * @param ctx 参数 ctx.
 * @param atkShare 参数 atkShare.
 * @returns RouteAResult.
*/
function routeA (tickets: number,ctx: Context,atkShare: number): RouteAResult {
  const books = expectedPerTicket(ctx.poolA,PROP_BOOK,ctx.bonus) * tickets;

  // PropEffect_GetYuLingShiEXP → ChanYuLi(Params_1 × (100 + AddYuLingShi_EXP)/100)
  const yuLi = books * ctx.bookParams1 * (100 + ctx.yuLingExpMark) / 100;
  let level = ctx.curLevel;
  let exp = ctx.curExp + yuLi;
  let breakthroughs = 0;
  const maxLevel = ctx.curLevel + 50_0000;
  while (level < maxLevel) {
    if (level % 10 === 0) {

      // GameRecorder.PinJing:10 的倍数级必须先突破,每次 500 个 Prop 81
      if (breakthroughs >= ctx.tuPoAvailable) {
        break;
      }
      breakthroughs += 1;
    }
    const cost = yuLingLevelCost(level);
    if (exp < cost) {
      break;
    }
    exp -= cost;
    level += 1;
  }

  // GameRecorder.ShowAddition:从 L 升 L+1 给四维各 L×250,累计攻击 = 125×(L-1)×L
  const atkBase = 125 * (ctx.curLevel - 1) * ctx.curLevel;
  const atkNew = 125 * (level - 1) * level;
  const atkMultiplier = 1 + atkShare * (atkNew / atkBase - 1);
  const from = ctx.shiLian.Cur_CengShu ?? 1;
  const hpBudget = atkMultiplier * trialEnemyHp(from);
  let to = from;
  while (to < from + 10000 && trialEnemyHp(to + 1) <= hpBudget) {
    to += 1;
  }
  const wins = to - from;
  let gross = 0;
  for (let layer = from; layer < to; layer += 1) {
    gross += TRIAL_BASE_YUANBAO + TRIAL_PER_LAYER * layer;
  }

  // ShiLian_Manger.CheckPiLao:疲劳为 0 且开自动补充时花 10 元宝补 1 点
  const net = gross - PILAO_BUY_COST * wins;

  // ShiLian_Manger.OpenMiBao:JinDu 每满 100 给 Count 个试炼秘宝(96),秘宝 ZiXuan 可自选 Lv15 宝石
  let jinDu = (ctx.shiLian.JinDu ?? 0) + wins;
  let count = ctx.shiLian.Count ?? 0;
  let mibao = 0;
  while (jinDu >= 100) {
    jinDu -= 100;
    count += 1;
    mibao += count;
  }
  return {
    atkMultiplier,
books,
breakthroughs,
    layersFrom:   from,
layersTo:     to,
levelTo:      level,
    mibao,
mibaoYuanbao: mibao * ctx.lv15Price,
    speedFrom:    trialEnemy(from).speed,
speedTo:      trialEnemy(to).speed,
    yuanbaoGross: gross,
yuanbaoNet:   net
  };
}

/**
 * 路线 B:套娃宝箱 Lv6 → 逐级 50% 套出 Lv10 → 开箱出同品质装备 → 5 合 1 升到 Lv15 → 冥商收购.
 * 开箱候选按品质均匀分布；同系列才能合成,因此按每个系列「等效品质 6 件数」向下取整, 同时给出不做取整的连续期望上界.
  * @param tickets 参数 tickets.
 * @param ctx 参数 ctx.
 * @returns RouteBResult.
*/
function routeB (tickets: number,ctx: Context): RouteBResult {
  const taowaLv6 = expectedPerTicket(ctx.poolB,PROP_TAOWA_LV6,ctx.bonus) * tickets;
  const ziXuan = expectedPerTicket(ctx.poolB,PROP_ZIXUAN_BAOSHI_LV6,ctx.bonus) * tickets;
  const chain = taoWaChain(ctx.props);
  let equivPerSeries = 0;
  for (const [pinzhi,boxes] of chain) {
    const candidates = candidateCount(pinzhi,ctx.props,ctx.lingQiWeapons);

    // 品质 p 的 1 件 = 5^(p-6) 件品质 6 的等效材料
    equivPerSeries += boxes * 5 ** (pinzhi - 6) / candidates;
  }
  const ratio = mergeRatio(ctx.props);
  const equiv = equivPerSeries * taowaLv6;

  // 自选宝石匣可全部指定同一系列,只给该系列叠加
  const lv15Real = (ctx.lv15Sellable - 1) * Math.floor(equiv / ratio) +
    Math.floor((equiv + ziXuan) / ratio);
  const lv15Expected = (ctx.lv15Sellable * equiv + ziXuan) / ratio;
  const boxesLv10 = (chain.get(10) ?? 0) * taowaLv6;
  const yuanbaoFromBox = boxesLv10 * bestUnitPrice(ctx.buy,PROP_TAOWA_LV10);
  let yuanbaoFromMaterial = 0;
  for (const drop of ctx.poolB.JiangChi) {
    if (drop.Prop_ID === PROP_TAOWA_LV6 || drop.Prop_ID === PROP_ZIXUAN_BAOSHI_LV6) {
      continue;
    }
    const unit = bestUnitPrice(ctx.buy,drop.Prop_ID);
    yuanbaoFromMaterial += expectedPerTicket(ctx.poolB,drop.Prop_ID,ctx.bonus) * tickets * unit;
  }
  return {
    boxesLv10,
lv15Expected,
lv15Real,
taowaLv6,
    yuanbaoFromBox,
yuanbaoFromLv15: lv15Real * ctx.lv15Price,
    yuanbaoFromMaterial,
ziXuan
  };
}

// 套娃链:每开 1 个宝箱出 1 件同品质装备,并以 50% 概率再给 1 个 NextPropID 宝箱.
function taoWaChain (props: Map<number,PropDef>): Map<number,number> {
  const boxes = new Map<number,number>();
  const visited = new Set<number>();
  let id: number | undefined = PROP_TAOWA_LV6;
  let expected = 1;
  while (id !== undefined && id !== 0 && !visited.has(id)) {
    visited.add(id);
    const def = props.get(id);
    if (!def) {
      break;
    }
    boxes.set(def.PinZhi_Level,(boxes.get(def.PinZhi_Level) ?? 0) + expected);
    expected *= 0.5;
    id = def.NextPropID;
  }
  return boxes;
}

// 二分求路线 A 达到目标元宝所需的最少抽奖卷数(元宝随抽数单调不减).
function ticketsForA (target: number,ctx: Context,atkShare: number): number {
  let high = 1e10,
low = 0;
  for (let i = 0; i < 50; i += 1) {
    const mid = (low + high) / 2;
    if (totalA(routeA(mid,ctx,atkShare)) >= target) {
      high = mid;
    } else {
      low = mid;
    }
  }
  return high;
}

// 二分求「实际凑出第 1 个可卖 Lv15 装备」所需的最少抽奖卷数.
function ticketsForOneLv15 (ctx: Context): number {
  let high = 1e10,
low = 0;
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    if (routeB(mid,ctx).lv15Real >= 1) {
      high = mid;
    } else {
      low = mid;
    }
  }
  return high;
}

// 路线 A 的总元宝(含试炼秘宝自选 Lv15 宝石的折算).
function totalA (result: RouteAResult): number {
  return result.yuanbaoNet + result.mibaoYuanbao;
}

// #endregion
main();