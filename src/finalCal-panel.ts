/**
 * finalCal.ts — 挂机掉落收益 → 面板 → 终局第 5 层三条件判定.
 * 口径(与 composite-compare / yingling-output 同源):
 * - 起点面板 = yingling-output 的 buildResourcePanel,但 resource=0(没有寻宝第 10 层每格 2,560,000 的白送资源),
 * 兑换码/通关点数永久属性/研究/15 级御灵装备等"配置"部分照留(见 RESOURCE=0 说明).
 * - 推层:孙悟空怒气 1.1 秒/层,云霄普攻 0.85 秒/层;矿洞封顶 1000 层,遗迹/寒潭/桃园各封顶 1W 层,
 * 前面的层数到了就转通天塔,最后一直通天塔(共享时间预算).
 * - 掉落:研究附加掉落(KeJiDrop:87/80/9/1/7/18/84/86/900+ID)与地图掉落表(MAPS)全部计入;
 * 幸运 50010 + 掉率研究使所有掉落表行概率封顶 1000‰,故每行按 (nums + 期望额外个数) 确定性结算;
 * 每 1W 层的额外掉落(getExpectedExtraCount:roundTier>=2 时 (tier-1)/100)按期望计算,用闭式 floorSum 求和,
 * 不逐波循环,避免大层数卡死.
 * - 资源转面板:全部资源按 calzhanli 的 tozhanli 公式转成面板增量(寒铁/灵纹/御灵宝典/钱币/强化石/灵晶/
 * 历史本纪/五彩/破境石/神通卷轴/三味真火/忘情水),再套 composite-compare 的 BigInt 伤害公式.
 * 寒铁打造按时间串行(hantieTozhanli 的 maxSeconds):单件 min(30秒,3+0.2×炼器等级),时间用完即停,
 * 不一口气全转;打造与推层/寻宝等并行.神兵默认 23 件全部解锁.
 * - 逐小时大循环(用户 finalcal.md 口径,无 BASE_HOURS/二分搜索):
 * ① 前置推层路线(为春秋蝉最大利用率):1图100→2图100→3图100→4图1W→5图100→回1/2/3图到
 * (1000/1W/1W)→回5图一直打;按秒/层算每层实际时间,累加当前时刻并上移到整数小时.
 * ② 前置:拿整段小时数的点卡收益;再按阶梯抽次数(1000抽 Lv1,4000抽 Lv3,5000抽 Lv4,20000抽 Lv5,
 * 20000抽 Lv5)模拟抽奖,奖池取权重期望.
 * ③ 逐小时循环:每小时依次核查 任务奖励 / 点卡 / 元宝购物 / 抽奖(8h 倍数,两组奖池选收益高) /
 * 阵营(8h 倍数) / 寻宝(10h 倍数) / 地图挂机掉落 / 扫荡(每小时判定,不能被一击秒杀时春秋蝉1个=1小时) /
 * 物资转面板 / 三条件判定;第一次满足即跳出,记录达标小时.
 * - 抽奖券(prop10)只从地图/扫荡掉落产出,抽奖消耗券;奖池权重期望来自游戏目录 JiangChi_Data_Json.txt.
 * - 元宝购物正反馈:每结算点攒够整组买 4 翅膀材料(各2个/48888)+孟婆汤(够转生不买)+藏宝图(补满100%不买);
 * 翅膀买了立即升等级,寻宝/阵营/装备收益按新等级结算;剩余元宝升 VIP.
 * - 资源分配架构:大循环/伤害链通用,每组自带 allocate 方法决定余下突破投幸运/攻击/穿透/速度(见 GROUP_PLANS);
 * 共同前提先用突破把幸运堆到 5W(确保地图掉落100%).4组:悟空天覆幸运/云霄天覆攻击/云霄天覆穿透/云霄鸟翔速度.
 * - 三条件:命中 100% + 一击必杀(伤害≥敌 HP) + 速度更快,与 composite-compare 完全一致.
 * - log:逐项写出每个数值来源与公式,结果写 output/finalCal.md.
 * 用法:pnpm exec tsx scripts/with-timeout.ts 30000 pnpm exec tsx src/finalCal.ts
 */
import {
  hantieTozhanli,
  lingjingTozhanli,
  lishibenjiTozhanli,
  pojingshiTozhanli,
  qianghuazhiTozhanli2,
  sanweizhenhuoTozhanli,
  shentongjuanzhouTozhanli,
  wangqingshuiTozhanli,
  wucaishenshiTozhanli
} from "./calzhanli.ts";
import {MAPS,PROP_NAMES,RESEARCH_FULL_COST,WAVE_COMPOSITION} from "./data.ts";
import {vipLevelUpCost} from "./game-formulas.ts";
import {ENEMY_5} from "./zhanli-panel.ts";
import {hitRate} from "./enemy-stats.ts";
import {formatSuoXie} from "./readSave.ts";
import {buildResourcePanel} from "./yingling-output.ts";
import type {CliArgs} from "./readSave.ts";
import type {MapID} from "./data.ts";
import type {
  BreakAlloc,ChoujiangState,CheckResult,DropMap,FinalPanel,GroupPlan,Hero,
  HourRecord,HourStep,PreRouteResult,ShopState,SimSnap,VipDetail,XunbaoDetail,ZhenyingDetail
} from "./types.ts";
import {CALC_CACHE} from "./calc-cache.ts";

import {
  BASE_HOURS,
  SECONDS_PER_HOUR,
  WUKONG_SEC,
  YUNXIAO_SEC,
  CAPPED_LAYERS,
  MAP_ORDER,
  VIP_EXTRA,
  EXTRA_TIER_START,
  HIT_SCALE,
  ENEMY_DEF,
  ENEMY_HP,
  ENEMY_DODGE,
  ENEMY_SPEED,
  ENEMY_CRIT_RESIST,
  ENEMY_REDUCE,
  SHEN_TONG_15_CAP,
  TANG_HIT,
  WU_SONG_ATK,
  WU_SONG_DMG,
  TIANFU_PANEL,
  WAVE_COUNT,
  XB_FULL_TILI,
  XB_ROUND_SECONDS,
  XB_RECOVER_SECONDS,
  XB_TILI_PER_ROUND,
  XB_ADVANCE_LAYERS,
  XB_PAID_BLOCKS,
  XB_FIRST_KNOWN,
  XB_LATER_KNOWN,
  XB_ROUNDS_PER_80H,
  XB_JACKPOT,
  XB_GRID_FIXED,
  XB_DROP_WEIGHTS,
  XB_WEIGHT_MIN,
  CB_TU_CAP,
  SHOP_WING_PRICE,
  SHOP_WING_NUMS,
  SHOP_MENGPO_PRICE,
  SHOP_MENGPO_NUMS,
  SHOP_CANGBAOTU_PRICE,
  ZHUAN_SHENG_MAX,
  MENGPO_PER_ZHUAN,
  WING4_DOUBLE_CAP,
  WING4_RECOVER_CAP,
  ZY_ROUND_SECONDS,
  ZY_RATE,
  ZY_TICK_SECONDS,
  ZY_TICKS,
  ZY_RANK1_RATE,
  ZY_SHARE,
  ZY_WING,
  DK_NPC_MEAN,
  DK_BUY,
  DK_FEE,
  DK_CARDS_PER_ROUND,
  DK_PROFIT_PER_ROUND,
  PRE_ROUTE,
  MAP_OPEN_SWEEP,
  CHOUJIANG_STEPS,
  CHOUJIANG_TICKET_PROP,
  CHOUJIANG_POOL_3,
  CHOUJIANG_POOL_4,
  CHOUJIANG_ROWS,
  SAO_DANG_SECONDS,
  SAO_DANG_SPEED,
  CHUNQIU_HOURS,
  culDamagePercentBig,
  floorSum,
  sumGain,
  expectedDrops,
  expectedDropsUncached,
  residueCount,
  vipFromYuanbao,
  xunbaoRound,
  zhenyingRound,
  numOf,
  BASE_ARGS,
  BASE,
  PANEL_CACHE,
  LUCKY_CAP,
  capBreaksFor,
  mkAlloc,
  speedBreaksNeeded,
  speedToPass,
  wukongBucket,
  yunxiaoBucket,
  wukongHitOk,
  yunxiaoHitOk
} from "./finalCal-core.ts";

// #region 期望掉落(闭式)

// 达到某累计增益所需最少突破次数.
export function minBreaksForGain (gain: bigint): bigint {
  return CALC_CACHE.get("minBreaksForGain",[gain],(): bigint => {
    if (gain <= 0n) {return 0n;}
    let hi = 1n,
lo = 0n;
    while (sumGain(hi) < gain) {hi *= 2n;}
    while (lo < hi) {
      const mid = (lo + hi) / 2n;
      if (sumGain(mid) >= gain) {hi = mid;} else {lo = mid + 1n;}
    }
    return lo;
  });
}

// 御灵宝典本数 → 御灵等级/四维攻/突破次数(等价 composite-compare:yulingLevel).
export function yuCumNeed (level: bigint): bigint {
  return CALC_CACHE.get("yuCumNeed",[level],(): bigint => {
    if (level <= 1n) {return 0n;}
    const last = level - 1n,
rem = last % 10n,
tens = last / 10n;
    const full = 100n * (10n * tens * (tens - 1n) * (2n * tens - 1n) / 6n
      + 19n * tens * (tens - 1n) / 2n + 9n * tens);
    const partial = 20n * (tens + 1n) * (5n * tens * (rem + 1n) + rem * (rem + 1n) / 2n);
    return full + partial;
  });
}
export function yulingLevel (books: bigint): {atk: bigint; breaks: bigint; level: bigint} {
  return CALC_CACHE.get("yulingLevel",[books],(): {atk: bigint; breaks: bigint; level: bigint} => {
    const exp = 200n * books;
    let hi = 2n,
lo = 1n;
    while (yuCumNeed(hi) <= exp) {hi *= 2n;}
    while (lo < hi) {
      const mid = (lo + hi + 1n) / 2n;
      if (yuCumNeed(mid) <= exp) {lo = mid;} else {hi = mid - 1n;}
    }
    return {atk: 125n * lo * (lo - 1n),breaks: lo / 10n,level: lo};
  });
}

// 灵纹 → 天覆阵等级/四维攻增量(等价 composite-compare:zhenLevel).
export function zhenLevel (lingwen: bigint): {atk: bigint; level: bigint} {
  return CALC_CACHE.get("zhenLevel",[lingwen],(): {atk: bigint; level: bigint} => {
    const approx = (1 + Math.sqrt(1 + 0.8 * Number(lingwen))) / 2;
    let level = BigInt(Math.max(1,Math.floor(approx)));
    if (level < 1n) {level = 1n;}
    while (level > 1n && 5n * level * (level - 1n) > lingwen) {level--;}
    while (5n * (level + 1n) * level <= lingwen) {level++;}
    return {atk: 200n * (level - 1n) + 35n * (level - 1n) * level / 2n,level};
  });
}
export const add = (drops: DropMap,key: string,value: number): void => {
  if (value > 0) {drops[key] = (drops[key] ?? 0) + value;}
};

// #endregion
export function evaluate (panel: FinalPanel,plan: GroupPlan): CheckResult {
  const a = plan.allocate(panel,plan.hero);
  const isLuckyFull = a.lucky >= LUCKY_CAP;
  const bucket = plan.bucket(a.hit);                      // 英灵技能百分比乘区(定点 1e6)

  // 暴击:对敌暴击率 = (暴击-敌抗暴+1)/101,≥100% 才乘暴伤,否则 ×1.
  const critScore = panel.crit - ENEMY_CRIT_RESIST + 1n;
  const critBucket = critScore >= 101n ? panel.critDamage * HIT_SCALE / 100n : HIT_SCALE;
  const atkPct = panel.atkPct + a.atkPctExtra;           // 攻击% = 面板 + 组阵法修正(天覆+等级%;鸟翔去掉面板15%)
  const finalAtk = a.baseAtk * (100n + atkPct) / 100n;
  const defAfterPen = ENEMY_DEF > a.pen ? ENEMY_DEF - a.pen : 1n;
  const k = culDamagePercentBig(finalAtk,defAfterPen);
  let damage = finalAtk * k / 100n;
  damage = damage * bucket / HIT_SCALE;
  damage = damage * critBucket / HIT_SCALE;
  damage = damage * (100n + panel.dmgAdd + a.dmgAddExtra) / 100n; // 伤害加成 = 面板 + 组阵法修正(鸟翔速度差)
  damage = damage * (100n - ENEMY_REDUCE) / 100n;
  const isHitOk = plan.hitOk(a.hit);
  const isSpeedOk = a.speed > ENEMY_SPEED;
  const isKillOk = damage >= ENEMY_HP;
  return {
atkBreaks:   a.atkBreaks,
capBreaks:   a.capBreaks,
damage,
dmgAddExtra: a.dmgAddExtra,
hit:         a.hit,
hitOk:       isHitOk,
killOk:      isKillOk,
lucky:       a.lucky,
luckyBreaks: a.luckyBreaks,
luckyFull:   isLuckyFull,
pass:        isHitOk && isSpeedOk && isKillOk,
penBreaks:   a.penBreaks,
speed:       a.speed,
speedBreaks: a.speedBreaks,
    speedOk:     isSpeedOk
};
}
export function panelFromDrops (drops: DropMap,vipHit: number,forgeSeconds: number,wing2: number): FinalPanel {
  const books = numOf(drops,"御灵宝典");
  const money = numOf(drops,"钱币");

  // 钱币按 yingling-output 口径先买灵纹(研究44 -30% → 1.4 钱币/灵纹),钱与灵纹不重复计价.
  const lingwen = numOf(drops,"灵纹") + Math.floor(money / 1.4);
  const hantie = numOf(drops,"寒铁");
  const key = `${String(books)}|${String(lingwen)}|${String(hantie)}|${String(numOf(drops,"强化石"))}|${String(numOf(drops,"灵晶"))}|${String(numOf(drops,"历史本纪"))}|${String(numOf(drops,"五彩神石"))}|${String(numOf(drops,"破境石"))}|${String(numOf(drops,"神通卷轴"))}|${String(numOf(drops,"三味真火"))}|${String(numOf(drops,"忘情水"))}|vip${String(vipHit)}|forge${String(Math.round(forgeSeconds))}|wing2${String(wing2)}`;
  const hit = PANEL_CACHE.get(key);
  if (hit !== undefined) {return hit;}
  const yu = yulingLevel(BigInt(books));
  const zhen = zhenLevel(BigInt(lingwen));
  let extraAtk = 0,
extraAtkPct = 0,
extraDmgAdd = 0,
extraPen = 0;
  let extraCrit = 0,
extraCritDamage = 0,
extraHit = 0,
extraSpeed = 0;
  const take = (r: Partial<Record<"atk" | "atkPercent" | "baoJi" | "baoJiDamage" |
    "damageAddition" | "ignoreDef" | "mingZhong" | "speed",number>>): void => {
    extraAtk += r.atk ?? 0;
    extraPen += r.ignoreDef ?? 0;
    extraAtkPct += r.atkPercent ?? 0;
    extraDmgAdd += r.damageAddition ?? 0;
    extraHit += r.mingZhong ?? 0;
    extraSpeed += r.speed ?? 0;
    extraCrit += r.baoJi ?? 0;
    extraCritDamage += r.baoJiDamage ?? 0;
  };
  const forge = hantieTozhanli(hantie,wing2,0,forgeSeconds); // 翅膀2 每级给装备四维 75+25L
  take(forge);
  take(qianghuazhiTozhanli2(numOf(drops,"强化石")));
  take(lingjingTozhanli(numOf(drops,"灵晶")));
  take(lishibenjiTozhanli(numOf(drops,"历史本纪")));
  take(wucaishenshiTozhanli(numOf(drops,"五彩神石")));
  take(pojingshiTozhanli(numOf(drops,"破境石")));
  take(shentongjuanzhouTozhanli(numOf(drops,"神通卷轴")));
  take(sanweizhenhuoTozhanli(numOf(drops,"三味真火"),["命中"]));
  take(wangqingshuiTozhanli(numOf(drops,"忘情水"),["伤害加成","暴伤"]));

  // 天覆阵面板攻击 +15% 已计入 TIANFU_PANEL;灵纹四维攻/等级来自闭式 zhen(含钱币买的灵纹),不再逐波模拟 tianfuzhenTozhanli.
  const panel: FinalPanel = {
    atkPct:          BigInt(Math.round(BASE.atkPct + WU_SONG_ATK + TIANFU_PANEL + extraAtkPct)),
    baseAtk:         BigInt(Math.round(BASE.atkFlat + extraAtk)) + yu.atk + zhen.atk,
    books,
    breaks:          yu.breaks,
    crit:            BigInt(Math.round(BASE.crit + extraCrit + vipHit)),
    critDamage:      BigInt(Math.round(BASE.critDamage + extraCritDamage)),
    dmgAdd:          BigInt(Math.round(BASE.damageAddition + WU_SONG_DMG + extraDmgAdd)),
    extraAtk,
    extraAtkPct,
    extraCrit,
    extraCritDamage,
    extraDmgAdd,
extraHit,
extraPen,
extraSpeed,
forgeCrafts:     forge.craftCount,
forgeHantieUsed: forge.hantieUsed,
forgeLevel:      forge.finalLianqiLevel,
hitFlat:         BigInt(Math.round(BASE.hit + TANG_HIT + extraHit + vipHit)),
    lingwen,
lucky:           BigInt(Math.round(BASE.lucky)),
    pen:             BigInt(Math.round(BASE.penetration + extraPen)),
speed:           BigInt(Math.round(BASE.speed + extraSpeed)),
zhenLevel:       zhen.level
  };
  PANEL_CACHE.set(key,panel);
  return panel;
}

// 4 组对比(finalcal.md):每组自带 allocate,告诉通用循环"余下突破怎么分".
// 共同硬前提:先用 capBreaksFor 把幸运堆到 5W 保掉落;之后各组的余下突破由本组方法决定.
// 天覆组速度只需补到过敌速(三条件门槛);鸟翔组速度是主属性,不限到过敌(速度差转伤害).
export function addMapDrops (drops: DropMap,map: MapID,fromLayer: number,toLayer: number): void {
  const addN = toLayer - fromLayer;
  if (addN <= 0) {return;}
  const part = expectedDrops(map,addN);
  for (const [k,v] of Object.entries(part)) {add(drops,k,v);}
}

// 扫荡一段小时(春秋蝉 1个=1小时,按已开扫荡的图):每图每 48s 一份喽啰原始掉落×速度倍率.
export function addSweepHours (drops: DropMap,layers: Partial<Record<MapID,number>>,hours: number,sec: number): void {
  for (const map of MAP_ORDER) {
    const open = MAP_OPEN_SWEEP[map];
    if (open === undefined || (layers[map] ?? 0) < open) {continue;}
    const cfg = MAPS[map];
    if (cfg === undefined) {continue;}
    const ticks = Math.floor(hours * SECONDS_PER_HOUR * SAO_DANG_SPEED / SAO_DANG_SECONDS);
    for (const [propID,nums,percent] of cfg.louLouDrops) {
      add(drops,PROP_NAMES[propID] ?? String(propID),nums * percent / 1000 * ticks);
    }
  }
}

// 每 8h 抽奖:选期望收益高的一组(组 A 资源 / 组 B 属性道具),按当前等级抽 1 次(消耗 1 张券).
export function choujiangRound (drops: DropMap,cj: ChoujiangState): void {
  const level = choujiangLevel(cj.count);
  const pool = poolExpectedValue(CHOUJIANG_POOL_3) >= poolExpectedValue(CHOUJIANG_POOL_4)
    ? CHOUJIANG_POOL_3
: CHOUJIANG_POOL_4;
  choujiangDraw(pool,level,drops);
  cj.count += 1;
  cj.draws += 1;
  if (pool === CHOUJIANG_POOL_3) {cj.pool3Hit += 1;} else {cj.pool4Hit += 1;}
}
export function poolExpectedValue (pool: string): number {
  return CALC_CACHE.get("poolExpectedValue",[pool],(): number => {
    const rows = CHOUJIANG_ROWS[pool] ?? [];
    let v = 0;
    for (const [name,nums,weight] of rows) {
      v += (CHOUJIANG_VALUE[name] ?? 0) * nums * weight / 1000;
    }
    return v;
  });
}

// 前置抽奖阶梯(笔记明确):全部抽 pool4(三味真火/神速符/御灵宝典/后悔药/春秋蝉/忘情水)这一组,
// 5 档抽数分别用 Lv1/3/4/5/5.只有大循环里的每 8h 抽奖才做两组选收益高.
export function preChoujiang (drops: DropMap,cj: ChoujiangState): void {
  for (const [times,level] of CHOUJIANG_STEPS) {
    choujiangDraw(CHOUJIANG_POOL_4,level,drops);
    cj.count += times;
    cj.draws += times;
    cj.pool4Hit += times;
  }
}
export function runPreRoute (sec: number): PreRouteResult {
  const layers: Partial<Record<MapID,number>> = {};
  const detail: string[] = [];
  let seconds = 0;
  for (const [map,target] of PRE_ROUTE) {
    const from = layers[map] ?? 0;
    if (target < 0) {break;}          // 最后一步"回5图一直打"交给大循环
    if (target <= from) {continue;}
    const need = target - from;
    layers[map] = target;
    const cost = need * sec;
    seconds += cost;
    detail.push(`${String(map)}图 ${String(from)}→${String(target)}(${nfmt(need)}层/${(cost / 3600).toFixed(2)}h)`);
  }
  return {detail,layers,seconds};
}