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

export const BASE_HOURS = 80;
export const SECONDS_PER_HOUR = 3600;
export const WUKONG_SEC = 1.1;
export const YUNXIAO_SEC = 0.85;
export const CAPPED_LAYERS: Partial<Record<MapID,number>> = {1: 1000,2: 10000,3: 10000,4: 10000};
export const MAP_ORDER: readonly MapID[] = [1,2,3,4,5];
export const VIP_EXTRA = 0.07;                       // VIP16 → min(100,16/2)=8 → (8-1)/100
export const EXTRA_TIER_START = 20000;               // roundTier>=2 起算额外掉落
export const HIT_SCALE = 100_0000n;
export const ENEMY_DEF = BigInt(Math.round(ENEMY_5.def));
export const ENEMY_HP = BigInt(Math.round(ENEMY_5.hp));
export const ENEMY_DODGE = BigInt(ENEMY_5.dodge);
export const ENEMY_SPEED = BigInt(Math.round(ENEMY_5.speed));
export const ENEMY_CRIT_RESIST = BigInt(ENEMY_5.critResist);
export const ENEMY_REDUCE = BigInt(ENEMY_5.damageReduce > 80 ? 80 : ENEMY_5.damageReduce);
export const SHEN_TONG_15_CAP = 21_4748_3637n;

// 唐僧 +30 命中(两队都有),武松 +20% 攻击 / +35 伤害加成,天覆面板 +15%.
export const TANG_HIT = 30;
export const WU_SONG_ATK = 20;
export const WU_SONG_DMG = 35;
export const TIANFU_PANEL = 15;

// 每 5 波各品质怪数:索引 = round%5,值 = [喽啰,精英,BOSS] 数量(由 WAVE_COMPOSITION 推得).
export const WAVE_COUNT: readonly (readonly [number,number,number])[] = [0,1,2,3,4].map(a => {
  const wave = WAVE_COMPOSITION[a] ?? [];
  return [wave.filter(p => p === 1).length,wave.filter(p => p === 2).length,wave.filter(p => p === 3).length] as const;
});

// ---- 寻宝(口径:xunbao-tili.ts / xunbao.ts / yingling-output.ts) ----
export const XB_FULL_TILI = 150;                   // 满体力 = 150 + 铭商科技(本计算取0)
export const XB_ROUND_SECONDS = 600 * 60;          // 一轮 = 10h:XunBaoManager.AddTimer 第103行 CulGameTime>RefreTime_min*60(600*60=36000s)→Initial();第48行 Time_Per_Round=28800f 全项目零引用,勿用
export const XB_RECOVER_SECONDS = 300;             // 第98行 TiLiRecovery>300f 每300s 回1点 → 一轮回 36000/300=120 点(翅膀4按 100+2%×min(L,250) 加速)
export const XB_TILI_PER_ROUND = XB_FULL_TILI + XB_ROUND_SECONDS / XB_RECOVER_SECONDS; // 270
export const XB_ADVANCE_LAYERS = 9;                // 前 9 层只走到大奖
export const XB_PAID_BLOCKS = 15;                  // 每层 16 格,入口免费 → 15 付费格
export const XB_FIRST_KNOWN = 3.2;                 // 已知大奖:第1层入口固定1,平均最短路径 48/15=3.2 格
export const XB_LATER_KNOWN = 640 / 240;           // 已知大奖:第2~9层入口/大奖枚举平均 2.667 格
export const XB_ROUNDS_PER_80H = BASE_HOURS * SECONDS_PER_HOUR / XB_ROUND_SECONDS; // 80h/10h = 8 轮
export const XB_JACKPOT = 20488;                   // 每轮第10层大奖元宝(yingling-output.ts:61)

// 寻宝第 10 层每格固定数量(每格 2,560,000 个) × 掉落权重‰(MoNiShouYou_全部伤害加成清单.md:298-316).
// 基础掉率未补满时每格期望 = 固定数 × 权重‰/1000;藏宝图印记每点 +1‰,补满后每行必掉固定数.
export const XB_GRID_FIXED = 256_0000;
export const XB_DROP_WEIGHTS: readonly (readonly [string,number])[] = [
  ["钱币",1000],["寒铁",244],["灵纹",128],["历史本纪",108],["强化石",88],
  ["神通卷轴",88],["灵晶",88],["神速符",42],["忘情水",26],["三味真火",26]
];
export const XB_WEIGHT_MIN = 26;                    // 最低权重‰ → 需 974 点藏宝图补到 1000‰
export const CB_TU_CAP = 1000 - XB_WEIGHT_MIN;      // 974,藏宝图补满即停

// ---- 冥商购物(mingshang.json sell 表,元宝买;MingShang_Manager 理想化为每轮可买) ----
export const SHOP_WING_PRICE = 48888;               // index 24-27:4 种翅膀材料各 2 个/48888
export const SHOP_WING_NUMS = 2;
export const SHOP_MENGPO_PRICE = 46888;             // index 28:孟婆汤 2 个/46888
export const SHOP_MENGPO_NUMS = 2;
export const SHOP_CANGBAOTU_PRICE = 25888;          // index 14:藏宝图 1 个/25888
export const ZHUAN_SHENG_MAX = 9;                   // ZhuanShengManager.MaxZhuanShengCount
export const MENGPO_PER_ZHUAN = 2;                  // 转生 k 次需 (k+1)×2 个,起始 k=0 需 2

// 翅膀效果封顶(源码:翅膀4 翻倍概率 L≤100,体力恢复 L≤250;翅膀3 阵营元宝无封顶)
export const WING4_DOUBLE_CAP = 100;
export const WING4_RECOVER_CAP = 250;

// ---- 阵营(zhenyin.ts settle:从头算,不算王者之翼) ----
export const ZY_ROUND_SECONDS = 8 * 3600;          // 阵营一轮 = 8h
export const ZY_RATE = 71;                          // 满图 13 块地每分钟积分基准
export const ZY_TICK_SECONDS = 60.1;               // 每 60.1s 加一次积分
export const ZY_TICKS = Math.floor((ZY_ROUND_SECONDS - ZY_TICK_SECONDS) / ZY_TICK_SECONDS) + 1; // 从头=479 次
export const ZY_RANK1_RATE = 25;                   // 第1名奖励 25%
export const ZY_SHARE = 0.99;                      // 贡献占比取 clamp 上限
export const ZY_WING = 0;                          // 不算王者之翼 → ×1

// ---- 点卡买卖(DianKaSellManager.cs / DianKaSell_Record.cs / 机制笔记§2) ----
export const DK_NPC_MEAN = 100_0000;               // NPC 挂牌价 90万~110万(1万档,20档均匀)的期望 ≈ 100万
export const DK_BUY = 90_0000;                     // 买价取最低档 90万
export const DK_FEE = 0.97;                        // 成交扣 3% 手续费,97% 进邮件(钱币)
export const DK_CARDS_PER_ROUND = 5.5;             // 每单张数 Random(1,11) 的期望 = 5.5
export const DK_PROFIT_PER_ROUND = (DK_NPC_MEAN * DK_FEE - DK_BUY) * DK_CARDS_PER_ROUND; // 每轮净赚钱币

// ---- 逐小时大循环(finalcal.md 用户口径) ----
// 前置推层路线:为让 5 张图都尽早开扫荡(春秋蝉按已开图补掉落,1个=1小时),按下列顺序推层.
// 每步 [图 ID, 目标层],推到该目标后再进下一步;最后一步 -1 表示回第5图一直推.
export const PRE_ROUTE: readonly (readonly [MapID,number])[] = [
  [1,100],[2,100],[3,100],[4,10000],[5,100],[1,1000],[2,10000],[3,10000],[5,-1]
];
export const MAP_OPEN_SWEEP: Partial<Record<MapID,number>> = {1: 50,2: 50,3: 50,4: 50,5: 1000}; // 开扫荡层数(data.ts effects type1)

// 抽奖券(prop10)阶梯:累计 ChouJiangCount 达阈值升抽奖等级;笔记模拟前几次抽奖的抽数与所用奖池等级.
export const CHOUJIANG_STEPS: readonly (readonly [number,number])[] = [
  [1000,1],[4000,3],[5000,4],[20000,5],[20000,5]
];                                          // [抽数,奖池等级];Lv1→3→4→5→5
export const CHOUJIANG_TICKET_PROP = 10;           // 抽奖卷(prop10),地图/扫荡掉落产出,寻宝不掉
export const CHOUJIANG_POOL_3 = "pool3";           // 组 A:御力宝箱 Lv6/套娃宝箱 Lv6/灵纹18/历史本纪18/灵晶18
export const CHOUJIANG_POOL_4 = "pool4";           // 组 B:三味真火/神速符/御灵宝典/后悔药/春秋蝉/忘情水

// 6 级奖池每行 [资源名,每份个数,权重‰](JiangChi_Data_Json.txt ChouJiangIndex 21~24,每抽6选项按权重抽1).
export const CHOUJIANG_ROWS: Partial<Record<string,readonly (readonly [string,number,number])[]>> = {
  pool1: [["寒铁",58,400],["强化石",58,200],["破境石",58,140],["五彩神石",58,140],["宝石匣Lv6",1,90],["自选宝石匣Lv6",1,30]],
  pool2: [["神通卷轴",58,380],["残念锦囊",12,380],["自选残念锦囊",6,90],["灵宝匣Lv6",1,90],["自选灵宝匣Lv6",1,30],["翠玉令",1,30]],
  pool3: [["灵纹",18,330],["历史本纪",18,330],["灵晶",18,150],["御力宝箱Lv6",1,80],["套娃宝箱Lv6",1,80],["自选宝石匣Lv6",1,30]],
  pool4: [["御灵宝典",6,400],["后悔药",6,120],["春秋蝉",6,20],["忘情水",6,130],["三味真火",6,130],["神速符",6,200]]
};

// 扫荡(calzhanli.ts simulateSweep 口径):每 48s 一份喽啰原始掉落(按 percent/1000 直算,不吃幸运).
export const SAO_DANG_SECONDS = 48;                // 每份间隔(MapRecorder.cs:33 SAO_DANG_REMAIN_TIMER)
export const SAO_DANG_SPEED = 2.6 * 1.5;           // VIP16 +160% → ×2.6;研究43 +50% → ×1.5;合 ×3.9
export const CHUNQIU_HOURS = 1;                    // 春秋蝉1个 = 1小时扫荡(用户确认)

// 任务奖励(TaskData_Json.txt):taskType=1 达成式任务,key=条件里程碑→一次性奖励.本计算只取能确定触发的骨架.
// BigInt 版 CulDamagePercent(Damage_Recorder.cs:138-161),整除向零截断.
export function culDamagePercentBig (atk: bigint,def: bigint): bigint {
  return CALC_CACHE.get("culDamagePercentBig",[atk,def],(): bigint => {
    if (def <= 0n) {return atk > 0n ? 100n : 50n;}
    if (atk === def) {return 50n;}
    if (atk > def) {
      if (atk >= 3n * def) {return 100n;}
      return 50n + (atk - def) * 50n / def * 2n;
    }
    if (atk * 3n <= def) {return 2n;}
    return 2n + (atk * 3n - def) * 48n / (def * 2n);
  });
}

// #endregion
// #region 闭式工具
// Σ_{i=0}^{n-1} floor((a*i+b)/m),AtCoder floor_sum(BigInt 版);a,b>=0,m>0.
export function floorSum (n: bigint,m: bigint,a: bigint,b: bigint): bigint {
  return CALC_CACHE.get("floorSum",[n,m,a,b],(): bigint => {
    let ans = 0n;
    let aa = a,
bb = b,
mm = m,
nn = n;
    for (;;) {
      if (aa >= mm) {
        ans += (nn - 1n) * nn * (aa / mm) / 2n;
        aa %= mm;
      }
      if (bb >= mm) {
        ans += nn * (bb / mm);
        bb %= mm;
      }
      const y = aa * nn + bb;
      if (y < mm) {break;}
      nn = y / mm;
      bb = y % mm;
      [mm,aa] = [aa,mm];
    }
    return ans;
  });
}

// 前 n 次突破的累计增益:Σ(2+7k)=2n+7n(n+1)/2.
export const sumGain = (n: bigint): bigint => CALC_CACHE.get("sumGain",[n],(): bigint =>
  n <= 0n ? 0n : 2n * n + 7n * n * (n + 1n) / 2n);

// #endregion
// #region 面板
// 面板/寻宝/阵营/VIP 的类型定义已搬至 ./types.ts
// #endregion
// #region 寻宝 / 阵营 / VIP(口径见常量区)

/**
 * 单张地图推 layers 层的期望掉落.
 * 概率封顶 1000‰(LUCKY=50010)后,每行掉落 = nums + 期望额外个数,
 * 额外个数按 floorSum 闭式求和,不逐波循环.
 */
export function expectedDrops (map: MapID,layers: number): DropMap {
  return CALC_CACHE.get("expectedDrops",[map,Math.floor(layers)],(): DropMap => expectedDropsUncached(map,layers));
}
export function expectedDropsUncached (map: MapID,layers: number): DropMap {
  const cfg = MAPS[map];
  const n = Math.floor(layers);
  const drops: DropMap = {};
  if (n <= 0 || cfg === undefined) {return drops;}

  // ① 各品质怪总数 + 加权额外掉落个数 / 加权波次系数(御力).
  const monsterCountByQuality: number[] = [0,0,0,0];
  const extraByQuality: number[] = [0,0,0,0];
  const tierByQuality: number[] = [0,0,0,0];
  const baseRound = cfg.baseRound;
  for (let a = 0; a < 5; a++) {
    const cnt = residueCount(n,a);
    if (cnt <= 0) {continue;}
    const wave = WAVE_COUNT[a] as readonly [number,number,number];
    const t0 = Math.max(0,Math.ceil((EXTRA_TIER_START + 1 - a) / 5));
    const extraCnt = cnt - t0;
    for (let p = 1; p <= 3; p++) {
      const q = wave[p - 1] ?? 0;
      monsterCountByQuality[p] = monsterCountByQuality[p]! + q * cnt;
      extraByQuality[p] = extraByQuality[p]! + q * VIP_EXTRA * cnt;
      if (extraCnt > 0) {
        extraByQuality[p] = extraByQuality[p]! + q / 100 * Number(floorSum(
          BigInt(extraCnt),10000n,5n,BigInt(5 * t0 + a - EXTRA_TIER_START)
        ));
      }

      // 御力 tier=floor((r+baseRound+1000)/1000);r=5t+a(t 起点:a=0 从 1,其余从 0).
      const tStart = a === 0 ? 1 : 0;
      const tCnt = cnt - tStart;
      if (tCnt > 0) {
        tierByQuality[p] = tierByQuality[p]! + q * Number(floorSum(
          BigInt(tCnt),1000n,5n,BigInt(5 * tStart + a + baseRound + 1000)
        ));
      }
    }
  }

  // ② 逐品质结算掉落表 + 研究附加掉落 + 御力.
  for (let p = 1; p <= 3; p++) {
    const count = monsterCountByQuality[p] ?? 0;
    if (count <= 0) {continue;}
    const table = p === 1 ? cfg.louLouDrops : p === 2 ? cfg.jingYingDrops : cfg.bossDrops;
    for (const [propID,nums] of table) {
      const key = PROP_NAMES[propID] ?? String(propID);
      add(drops,key,nums * count + extraByQuality[p]!);
    }
    const enemyID = p === 3 ? cfg.bossID : p === 2 ? cfg.jingYingID : cfg.louLouID;
    add(drops,"御灵师经验",p * count);
    for (const key of ["钱币","历史本纪","寒铁","灵纹","残念锦囊","御灵宝典","炼器宝典"]) {
      add(drops,key,count);
    }
    add(drops,PROP_NAMES[900 + enemyID] ?? `Prop${String(900 + enemyID)}`,count);
    add(drops,"钱币",count); // 研究56:掉落钱币概率 +20 ×2 → 固定 2 枚
    const yuBase = Math.trunc(150 * (1 + p * 0.5));
    add(drops,"御力",yuBase * tierByQuality[p]! * 2 * 4.2); // 研究31 ×2,VIP16 ×4.2
  }

  // ③ 地图到达指定层的 getProp 一次性道具.
  for (const [effectRound,effectType,value,value1] of cfg.effects) {
    if (effectType === 4 && effectRound <= n) {
      add(drops,PROP_NAMES[value] ?? String(value),value1);
    }
  }
  return drops;
}

// 余数 a 在 1..n 中出现的次数(a=0 表示 5/10/...).
export function residueCount (n: number,a: number): number {
  if (n <= 0) {return 0;}
  return a === 0 ? Math.floor(n / 5) : n >= a ? Math.floor((n - a) / 5) + 1 : 0;
}

// 元宝全部升 VIP(yingling-output.ts vipLevel):返回等级/命中暴击加成.
export function vipFromYuanbao (yuanbao: number): VipDetail {
  return CALC_CACHE.get("vipFromYuanbao",[yuanbao],(): VipDetail => {
    let level = 0,
spent = 0;
    for (;;) {
      const cost = vipLevelUpCost(level + 1);
      if (spent + cost > yuanbao) {break;}
      spent += cost;
      level += 1;
    }
    return {hitCrit: Math.trunc(level / 2),level,remain: yuanbao - spent,spent,yuanbao};
  });
}

// 单轮寻宝:前9层已知大奖最短路径,余力从第10层往下逐层开满付费格.
// wing4 = 王者之翼等级(寻宝大奖+5%/级无封顶,整份翻倍概率=等级%封顶100,体力恢复+2%/级封顶250),
// cangbaotu = 藏宝图印记(掉率+1‰/点,补满每格权重到1000‰).
export function xunbaoRound (wing4: number,cangbaotu: number): XunbaoDetail {
  return CALC_CACHE.get("xunbaoRound",[wing4,cangbaotu],(): XunbaoDetail => {
    const layer1Cost = XB_FIRST_KNOWN;                       // 第1层:3.2 格 × 1点
    let layer2to9Cost = 0;
    for (let layer = 2; layer <= XB_ADVANCE_LAYERS; layer++) {
      layer2to9Cost += XB_LATER_KNOWN * layer;                   // 第 k 层:2.667 格 × k 点
    }
    const advCost = layer1Cost + layer2to9Cost;

    // 每轮体力:满 150 + 一轮自然恢复 36000/300=120 × 翅膀4恢复倍率(1+2%×min(L,250)).
    const recoverMul = 1 + 0.02 * Math.min(wing4,WING4_RECOVER_CAP);
    const totalTili = XB_FULL_TILI + XB_ROUND_SECONDS / XB_RECOVER_SECONDS * recoverMul;

    // 余力从第10层往下逐层开满付费格:每层15格,每格扣当前层数点体力.
    let remain = Math.max(0,totalTili - advCost);
    let block10 = 0,
block9 = 0,
extraBlocks = 0;
    for (let layer = 10; layer >= 1; layer--) {
      const n = Math.min(XB_PAID_BLOCKS,Math.floor(remain / layer));
      remain -= n * layer;
      if (layer === 10) {block10 = n;} else if (layer === 9) {block9 = n;}
      extraBlocks += n;
    }
    const used = totalTili - remain;
    const drops: DropMap = {};

    // 每格期望 = 固定数 × min(1000, 权重‰ + 藏宝图)/1000 × 整份翻倍期望(1 + 等级%/100).
    const dropBonus = 1 + Math.min(wing4,WING4_DOUBLE_CAP) / 100;
    for (const [key,weight] of XB_DROP_WEIGHTS) {
      const rate = Math.min(1000,weight + cangbaotu) / 1000;
      add(drops,key,XB_GRID_FIXED * rate * dropBonus * extraBlocks);
    }

    // 大奖 = 20488 × (100 + 5×翅膀4)/100,再乘整份翻倍期望.
    const yuanbao = XB_JACKPOT * (100 + 5 * wing4) / 100 * dropBonus;
    return {
advCost,
block10,
block9,
drops,
      layer1Cost,
layer2to9Cost,
remain: Math.max(0,totalTili - advCost),
totalTili,
used,
yuanbao
    };
  });
}

// 阵营单轮最高奖励(zhenyin.ts settle,从头算,不算王者之翼).
// wing3 = 王者之翼(五彩之晶)等级,阵营结算元宝 ×(100+5×L)/100(源码无封顶).
export function zhenyingRound (wing3: number): ZhenyingDetail {
  return CALC_CACHE.get("zhenyingRound",[wing3],(): ZhenyingDetail => {
    const score = ZY_TICKS * ZY_RATE;                            // 479 × 71 = 34009
    const rankReward = Math.floor(score * ZY_RANK1_RATE / 100);  // 第1名 25%
    const halfScore = Math.floor(score / 2);
    const shareReward = Math.floor(halfScore * ZY_SHARE);        // 50% 分润 × 0.99
    const baseReward = rankReward + shareReward;
    const roundMul = (10 + 1) / 10;                              // Round=1,(10+R)/10
    const wingMul = 1 + ZY_WING * 5 / 100;                       // 不算王者之翼 ×1
    const base = Math.floor(baseReward * roundMul * wingMul);
    const yuanbao = base * (100 + 5 * wing3) / 100;              // 翅膀3 阵营元宝加成
    return {baseReward,rankReward,roundMul,score,shareReward,yuanbao};
  });
}
export const numOf = (drops: DropMap,key: string): number => Math.floor(drops[key] ?? 0);

// 起点面板:yingling-output 配置,但没有 2,560,000 的资源.
export const BASE_ARGS: CliArgs = new Map([
  ["lingwen","0"],["resource","0"],["yuanbao-mode","vip"],["yuanbao","0"],["zhenfa-level","1"]
]);
export const BASE = buildResourcePanel(BASE_ARGS);

// 把 drops 全部按 calzhanli tozhanli 转成面板增量(缓存:同一份 drops + vipHit 只算一次).
export const PANEL_CACHE = new Map<string,FinalPanel>();

// BreakAlloc/CheckResult/GroupPlan/Hero 类型定义已搬至 ./types.ts
// #endregion
// #region 伤害与三条件

// 先把幸运堆到 5W(确保地图掉落 100%)所需突破次数——所有组的共同硬前提.
export const LUCKY_CAP = 50000n;
export function capBreaksFor (panel: FinalPanel): bigint {
  const need = LUCKY_CAP > panel.lucky ? LUCKY_CAP - panel.lucky : 0n;
  const n = minBreaksForGain(need);
  return n < panel.breaks ? n : panel.breaks;
}

// 把五类突破次数换算成最终面板量 + 阵法修正(纯计算,不含分配决策).
export function mkAlloc (panel: FinalPanel,hero: Hero,zhenfa: GroupPlan["zhenfa"],cap: bigint,luckyB: bigint,speedB: bigint,atkB: bigint,penB: bigint): BreakAlloc {
  const lucky = panel.lucky + sumGain(cap + luckyB);
  const speedBase = panel.speed + sumGain(speedB);
  let atkPctExtra = 0n,
dmgAddExtra = 0n,
speed = speedBase;
  if (zhenfa === "tianfu") {
    atkPctExtra = panel.zhenLevel;                 // 天覆战斗期 +阵法等级% 攻击
  } else {

    // 鸟翔阵:面板 +15 速度(而非天覆+15%攻,故减回 TIANFU_PANEL),速度差→对敌增伤(封顶 2147483646).
    atkPctExtra = -BigInt(TIANFU_PANEL);
    speed = speedBase + 15n;
    const diff = speed > ENEMY_SPEED ? speed - ENEMY_SPEED : 0n;
    dmgAddExtra = diff > 21_4748_3646n ? 21_4748_3646n : diff;
  }
  return {
atkBreaks:   atkB,
atkPctExtra,
baseAtk:     panel.baseAtk + sumGain(atkB),
capBreaks:   cap,
dmgAddExtra,
hit:         panel.hitFlat + (hero === "wukong" ? lucky / 100n * 5n : 0n),
lucky,
luckyBreaks: luckyB,
pen:         panel.pen + sumGain(penB),
penBreaks:   penB,
speed,
speedBreaks: speedB
  };
}

// 速度更快需要的最少突破(起点速度 + 其它速度增量后仍需补的部分).
export function speedBreaksNeeded (baseSpeed: bigint): bigint {
  return CALC_CACHE.get("speedBreaksNeeded",[baseSpeed],(): bigint =>
    minBreaksForGain(ENEMY_SPEED + 1n - baseSpeed));
}
// 补速度到刚好过敌速所需突破次数(悟空/云霄天覆组用;鸟翔组速度是主属性,不限到过敌).
export function speedToPass (panel: FinalPanel,left: bigint): bigint {
  const need = speedBreaksNeeded(panel.speed);
  return need < left ? need : left;
}

// 孙悟空技能乘区:葫芦78% × 神通15 × 西行 Lv3(八戒-20闪避);命中靠幸运链 hitRate 判定.
export function wukongBucket (hit: bigint): bigint {
  return CALC_CACHE.get("wukongBucket",[hit],(): bigint => {
    const f1 = (100n + hit) * HIT_SCALE / 100n;
    const s15 = hit < SHEN_TONG_15_CAP ? hit : SHEN_TONG_15_CAP;
    const f2 = (100n + s15) * HIT_SCALE / 100n;
    const xi = hit - ENEMY_DODGE + 20n > 0n ? hit - ENEMY_DODGE + 20n : 0n;
    const f3 = (100n + xi) * HIT_SCALE / 100n;
    return f1 * f2 / HIT_SCALE * f3 / HIT_SCALE;
  });
}

// 云霄技能乘区:普攻80% × 后羿弓0.8 × 神通27 × 神通15 × 西行 Lv2 × 神通20;命中恒达标.
export function yunxiaoBucket (hit: bigint): bigint {
  return CALC_CACHE.get("yunxiaoBucket",[hit],(): bigint => {
    const s15 = hit < SHEN_TONG_15_CAP ? hit : SHEN_TONG_15_CAP;
    const gap = hit > ENEMY_DODGE ? hit - ENEMY_DODGE : 0n;
    const xi = gap * 75n / 100n;
    let b = 80n * HIT_SCALE / 100n;
    b = b * (80n * HIT_SCALE / 100n) / HIT_SCALE;
    b = b * (102n * HIT_SCALE / 100n) / HIT_SCALE;
    b = b * ((100n + s15) * HIT_SCALE / 100n) / HIT_SCALE;
    b = b * ((100n + xi) * HIT_SCALE / 100n) / HIT_SCALE;
    return b * (130n * HIT_SCALE / 100n) / HIT_SCALE;
  });
}
export const wukongHitOk  = (hit: bigint): boolean => hitRate(Number(hit),ENEMY_5.dodge) >= 1;
export const yunxiaoHitOk = (_hit: bigint): boolean => true;

// #endregion