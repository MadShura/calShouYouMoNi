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
 * 阵营(8h 倍数) / 寻宝(10h 倍数,源码 RefreTime_min=600分=36000秒) / 地图挂机掉落 / 扫荡(不能被一击秒杀时,春秋蝉1个=1小时) /
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
import {writeFileSync} from "node:fs";
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

// #region 常量
const BASE_HOURS = 80;
const SECONDS_PER_HOUR = 3600;
const WUKONG_SEC = 1.1;
const YUNXIAO_SEC = 0.85;
const CAPPED_LAYERS: Partial<Record<MapID,number>> = {1: 1000,2: 10000,3: 10000,4: 10000};
const MAP_ORDER: readonly MapID[] = [1,2,3,4,5];
const VIP_EXTRA = 0.07;                       // VIP16 → min(100,16/2)=8 → (8-1)/100
const EXTRA_TIER_START = 20000;               // roundTier>=2 起算额外掉落
const HIT_SCALE = 100_0000n;
const ENEMY_DEF = BigInt(Math.round(ENEMY_5.def));
const ENEMY_HP = BigInt(Math.round(ENEMY_5.hp));
const ENEMY_DODGE = BigInt(ENEMY_5.dodge);
const ENEMY_SPEED = BigInt(Math.round(ENEMY_5.speed));
const ENEMY_CRIT_RESIST = BigInt(ENEMY_5.critResist);
const ENEMY_REDUCE = BigInt(ENEMY_5.damageReduce > 80 ? 80 : ENEMY_5.damageReduce);
const SHEN_TONG_15_CAP = 21_4748_3637n;

// 唐僧 +30 命中(两队都有),武松 +20% 攻击 / +35 伤害加成,天覆面板 +15%.
const TANG_HIT = 30;
const WU_SONG_ATK = 20;
const WU_SONG_DMG = 35;
const TIANFU_PANEL = 15;

// 每 5 波各品质怪数:索引 = round%5,值 = [喽啰,精英,BOSS] 数量(由 WAVE_COMPOSITION 推得).
const WAVE_COUNT: readonly (readonly [number,number,number])[] = [0,1,2,3,4].map(a => {
  const wave = WAVE_COMPOSITION[a] ?? [];
  return [wave.filter(p => p === 1).length,wave.filter(p => p === 2).length,wave.filter(p => p === 3).length] as const;
});

// ---- 寻宝(口径:xunbao-tili.ts / xunbao.ts / yingling-output.ts) ----
const XB_FULL_TILI = 150;                   // 满体力 = 150 + 铭商科技(本计算取0)
const XB_ROUND_SECONDS = 600 * 60;          // 一轮 = 10h:XunBaoManager.AddTimer 第103行 CulGameTime>RefreTime_min*60(600*60=36000s)→Initial();第48行 Time_Per_Round=28800f 全项目零引用,勿用
const XB_RECOVER_SECONDS = 300;             // 第98行 TiLiRecovery>300f 每300s 回1点 → 一轮回 36000/300=120 点(翅膀4按 100+2%×min(L,250) 加速)
const XB_TILI_PER_ROUND = XB_FULL_TILI + XB_ROUND_SECONDS / XB_RECOVER_SECONDS; // 270
const XB_ADVANCE_LAYERS = 9;                // 前 9 层只走到大奖
const XB_PAID_BLOCKS = 15;                  // 每层 16 格,入口免费 → 15 付费格
const XB_FIRST_KNOWN = 3.2;                 // 已知大奖:第1层入口固定1,平均最短路径 48/15=3.2 格
const XB_LATER_KNOWN = 640 / 240;           // 已知大奖:第2~9层入口/大奖枚举平均 2.667 格
const XB_ROUNDS_PER_80H = BASE_HOURS * SECONDS_PER_HOUR / XB_ROUND_SECONDS; // 80h/10h = 8 轮
const XB_JACKPOT = 20488;                   // 每轮第10层大奖元宝(yingling-output.ts:61)

// 寻宝第 10 层每格固定数量(每格 2,560,000 个) × 掉落权重‰(MoNiShouYou_全部伤害加成清单.md:298-316).
// 基础掉率未补满时每格期望 = 固定数 × 权重‰/1000;藏宝图印记每点 +1‰,补满后每行必掉固定数.
const XB_GRID_FIXED = 256_0000;
const XB_DROP_WEIGHTS: readonly (readonly [string,number])[] = [
  ["钱币",1000],["寒铁",244],["灵纹",128],["历史本纪",108],["强化石",88],
  ["神通卷轴",88],["灵晶",88],["神速符",42],["忘情水",26],["三味真火",26]
];
const XB_WEIGHT_MIN = 26;                    // 最低权重‰ → 需 974 点藏宝图补到 1000‰
const CB_TU_CAP = 1000 - XB_WEIGHT_MIN;      // 974,藏宝图补满即停

// ---- 冥商购物(mingshang.json sell 表,元宝买;MingShang_Manager 理想化为每轮可买) ----
const SHOP_WING_PRICE = 48888;               // index 24-27:4 种翅膀材料各 2 个/48888
const SHOP_WING_NUMS = 2;
const SHOP_MENGPO_PRICE = 46888;             // index 28:孟婆汤 2 个/46888
const SHOP_MENGPO_NUMS = 2;
const SHOP_CANGBAOTU_PRICE = 25888;          // index 14:藏宝图 1 个/25888
const ZHUAN_SHENG_MAX = 9;                   // ZhuanShengManager.MaxZhuanShengCount
const MENGPO_PER_ZHUAN = 2;                  // 转生 k 次需 (k+1)×2 个,起始 k=0 需 2

// 翅膀效果封顶(源码:翅膀4 翻倍概率 L≤100,体力恢复 L≤250;翅膀3 阵营元宝无封顶)
const WING4_DOUBLE_CAP = 100;
const WING4_RECOVER_CAP = 250;

// ---- 阵营(zhenyin.ts settle:从头算,不算王者之翼) ----
const ZY_ROUND_SECONDS = 8 * 3600;          // 阵营一轮 = 8h
const ZY_RATE = 71;                          // 满图 13 块地每分钟积分基准
const ZY_TICK_SECONDS = 60.1;               // 每 60.1s 加一次积分
const ZY_TICKS = Math.floor((ZY_ROUND_SECONDS - ZY_TICK_SECONDS) / ZY_TICK_SECONDS) + 1; // 从头=479 次
const ZY_RANK1_RATE = 25;                   // 第1名奖励 25%
const ZY_SHARE = 0.99;                      // 贡献占比取 clamp 上限
const ZY_WING = 0;                          // 不算王者之翼 → ×1

// ---- 点卡买卖(DianKaSellManager.cs / DianKaSell_Record.cs / 机制笔记§2) ----
const DK_NPC_MEAN = 100_0000;               // NPC 挂牌价 90万~110万(1万档,20档均匀)的期望 ≈ 100万
const DK_BUY = 90_0000;                     // 买价取最低档 90万
const DK_FEE = 0.97;                        // 成交扣 3% 手续费,97% 进邮件(钱币)
const DK_CARDS_PER_ROUND = 5.5;             // 每单张数 Random(1,11) 的期望 = 5.5
const DK_PROFIT_PER_ROUND = (DK_NPC_MEAN * DK_FEE - DK_BUY) * DK_CARDS_PER_ROUND; // 每轮净赚钱币

// ---- 逐小时大循环(finalcal.md 用户口径) ----
// 前置推层路线:为让 5 张图都尽早开扫荡(春秋蝉按已开图补掉落,1个=1小时),按下列顺序推层.
// 每步 [图 ID, 目标层],推到该目标后再进下一步;最后一步 -1 表示回第5图一直推.
const PRE_ROUTE: readonly (readonly [MapID,number])[] = [
  [1,100],[2,100],[3,100],[4,10000],[5,100],[1,1000],[2,10000],[3,10000],[5,-1]
];
const MAP_OPEN_SWEEP: Partial<Record<MapID,number>> = {1: 50,2: 50,3: 50,4: 50,5: 1000}; // 开扫荡层数(data.ts effects type1)

// 抽奖券(prop10)阶梯:累计 ChouJiangCount 达阈值升抽奖等级;笔记模拟前几次抽奖的抽数与所用奖池等级.
const CHOUJIANG_STEPS: readonly (readonly [number,number])[] = [
  [1000,1],[4000,3],[5000,4],[20000,5],[20000,5]
];                                          // [抽数,奖池等级];Lv1→3→4→5→5
const CHOUJIANG_TICKET_PROP = 10;           // 抽奖卷(prop10),地图/扫荡掉落产出,寻宝不掉
const CHOUJIANG_POOL_3 = "pool3";           // 组 A:御力宝箱 Lv6/套娃宝箱 Lv6/灵纹18/历史本纪18/灵晶18
const CHOUJIANG_POOL_4 = "pool4";           // 组 B:三味真火/神速符/御灵宝典/后悔药/春秋蝉/忘情水

// 6 级奖池每行 [资源名,每份个数,权重‰](JiangChi_Data_Json.txt ChouJiangIndex 21~24,每抽6选项按权重抽1).
const CHOUJIANG_ROWS: Partial<Record<string,readonly (readonly [string,number,number])[]>> = {
  pool1: [["寒铁",58,400],["强化石",58,200],["破境石",58,140],["五彩神石",58,140],["宝石匣Lv6",1,90],["自选宝石匣Lv6",1,30]],
  pool2: [["神通卷轴",58,380],["残念锦囊",12,380],["自选残念锦囊",6,90],["灵宝匣Lv6",1,90],["自选灵宝匣Lv6",1,30],["翠玉令",1,30]],
  pool3: [["灵纹",18,330],["历史本纪",18,330],["灵晶",18,150],["御力宝箱Lv6",1,80],["套娃宝箱Lv6",1,80],["自选宝石匣Lv6",1,30]],
  pool4: [["御灵宝典",6,400],["后悔药",6,120],["春秋蝉",6,20],["忘情水",6,130],["三味真火",6,130],["神速符",6,200]]
};

// 扫荡(calzhanli.ts simulateSweep 口径):每 48s 一份喽啰原始掉落(按 percent/1000 直算,不吃幸运).
const SAO_DANG_SECONDS = 48;                // 每份间隔(MapRecorder.cs:33 SAO_DANG_REMAIN_TIMER)
const SAO_DANG_SPEED = 2.6 * 1.5;           // VIP16 +160% → ×2.6;研究43 +50% → ×1.5;合 ×3.9
const CHUNQIU_HOURS = 1;                    // 春秋蝉1个 = 1小时扫荡(用户确认)

// 任务奖励(TaskData_Json.txt):taskType=1 达成式任务,key=条件里程碑→一次性奖励.本计算只取能确定触发的骨架.
// BigInt 版 CulDamagePercent(Damage_Recorder.cs:138-161),整除向零截断.
function culDamagePercentBig (atk: bigint,def: bigint): bigint {
  if (def <= 0n) {return atk > 0n ? 100n : 50n;}
  if (atk === def) {return 50n;}
  if (atk > def) {
    if (atk >= 3n * def) {return 100n;}
    return 50n + (atk - def) * 50n / def * 2n;
  }
  if (atk * 3n <= def) {return 2n;}
  return 2n + (atk * 3n - def) * 48n / (def * 2n);
}

// #endregion
// #region 闭式工具
// Σ_{i=0}^{n-1} floor((a*i+b)/m),AtCoder floor_sum(BigInt 版);a,b>=0,m>0.
function floorSum (n: bigint,m: bigint,a: bigint,b: bigint): bigint {
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
}

// 前 n 次突破的累计增益:Σ(2+7k)=2n+7n(n+1)/2.
const sumGain = (n: bigint): bigint => (n <= 0n ? 0n : 2n * n + 7n * n * (n + 1n) / 2n);

// #endregion
// #region 期望掉落(闭式)
type DropMap = Record<string,number>;

// 达到某累计增益所需最少突破次数.
function minBreaksForGain (gain: bigint): bigint {
  if (gain <= 0n) {return 0n;}
  let hi = 1n,
lo = 0n;
  while (sumGain(hi) < gain) {hi *= 2n;}
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    if (sumGain(mid) >= gain) {hi = mid;} else {lo = mid + 1n;}
  }
  return lo;
}

// 御灵宝典本数 → 御灵等级/四维攻/突破次数(等价 composite-compare:yulingLevel).
function yuCumNeed (level: bigint): bigint {
  if (level <= 1n) {return 0n;}
  const last = level - 1n,
rem = last % 10n,
tens = last / 10n;
  const full = 100n * (10n * tens * (tens - 1n) * (2n * tens - 1n) / 6n
    + 19n * tens * (tens - 1n) / 2n + 9n * tens);
  const partial = 20n * (tens + 1n) * (5n * tens * (rem + 1n) + rem * (rem + 1n) / 2n);
  return full + partial;
}
function yulingLevel (books: bigint): {atk: bigint; breaks: bigint; level: bigint} {
  const exp = 200n * books;
  let hi = 2n,
lo = 1n;
  while (yuCumNeed(hi) <= exp) {hi *= 2n;}
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if (yuCumNeed(mid) <= exp) {lo = mid;} else {hi = mid - 1n;}
  }
  return {atk: 125n * lo * (lo - 1n),breaks: lo / 10n,level: lo};
}

// 灵纹 → 天覆阵等级/四维攻增量(等价 composite-compare:zhenLevel).
function zhenLevel (lingwen: bigint): {atk: bigint; level: bigint} {
  const approx = (1 + Math.sqrt(1 + 0.8 * Number(lingwen))) / 2;
  let level = BigInt(Math.max(1,Math.floor(approx)));
  if (level < 1n) {level = 1n;}
  while (level > 1n && 5n * level * (level - 1n) > lingwen) {level--;}
  while (5n * (level + 1n) * level <= lingwen) {level++;}
  return {atk: 200n * (level - 1n) + 35n * (level - 1n) * level / 2n,level};
}
const add = (drops: DropMap,key: string,value: number): void => {
  if (value > 0) {drops[key] = (drops[key] ?? 0) + value;}
};

// #endregion
// #region 面板
interface FinalPanel {
  atkPct:          bigint;
  baseAtk:         bigint;
  books:           number;
  breaks:          bigint;
  crit:            bigint;
  critDamage:      bigint;
  dmgAdd:          bigint;
  extraAtk:        number;
  extraAtkPct:     number;
  extraCrit:       number;
  extraCritDamage: number;
  extraDmgAdd:     number;
  extraHit:        number;
  extraPen:        number;
  extraSpeed:      number;
  forgeCrafts:     number;     // 受时间限制实际打造的装备件数
  forgeHantieUsed: number; // 实际消耗的寒铁
  forgeLevel:      number;      // 打造结束时的炼器等级
  hitFlat:         bigint;
  lingwen:         number;
  lucky:           bigint;
  pen:             bigint;
  speed:           bigint;
  zhenLevel:       bigint;
}

interface VipDetail {
  hitCrit: number;         // 每2级 +1 命中/+1 暴击
  level:   number;
  remain:  number;
  spent:   number;
  yuanbao: number;
}

// #endregion
// #region 寻宝 / 阵营 / VIP(口径见常量区)
interface XunbaoDetail {
  advCost:       number;         // 前9层走到大奖消耗
  block10:       number;         // 第10层开格数
  block9:        number;          // 第9层加开格数
  drops:         DropMap;          // 每轮掉落(不含元宝)
  layer1Cost:    number;
  layer2to9Cost: number;
  remain:        number;          // 进第10层前剩余体力
  totalTili:     number;       // 一轮可用体力
  used:          number;
  yuanbao:       number;         // 每轮元宝大奖
}

interface ZhenyingDetail {
  baseReward:  number;
  rankReward:  number;
  roundMul:    number;
  score:       number;
  shareReward: number;
  yuanbao:     number;
}

/**
 * 单张地图推 layers 层的期望掉落.
 * 概率封顶 1000‰(LUCKY=50010)后,每行掉落 = nums + 期望额外个数,
 * 额外个数按 floorSum 闭式求和,不逐波循环.
 */
function expectedDrops (map: MapID,layers: number): DropMap {
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
function residueCount (n: number,a: number): number {
  if (n <= 0) {return 0;}
  return a === 0 ? Math.floor(n / 5) : n >= a ? Math.floor((n - a) / 5) + 1 : 0;
}

// 元宝全部升 VIP(yingling-output.ts vipLevel):返回等级/命中暴击加成.
function vipFromYuanbao (yuanbao: number): VipDetail {
  let level = 0,
spent = 0;
  for (;;) {
    const cost = vipLevelUpCost(level + 1);
    if (spent + cost > yuanbao) {break;}
    spent += cost;
    level += 1;
  }
  return {hitCrit: Math.trunc(level / 2),level,remain: yuanbao - spent,spent,yuanbao};
}

// 单轮寻宝:前9层已知大奖最短路径,余力从第10层往下逐层开满付费格.
// wing4 = 王者之翼等级(寻宝大奖+5%/级无封顶,整份翻倍概率=等级%封顶100,体力恢复+2%/级封顶250),
// cangbaotu = 藏宝图印记(掉率+1‰/点,补满每格权重到1000‰).
function xunbaoRound (wing4: number,cangbaotu: number): XunbaoDetail {
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
}

// 阵营单轮最高奖励(zhenyin.ts settle,从头算,不算王者之翼).
// wing3 = 王者之翼(五彩之晶)等级,阵营结算元宝 ×(100+5×L)/100(源码无封顶).
function zhenyingRound (wing3: number): ZhenyingDetail {
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
}
const numOf = (drops: DropMap,key: string): number => Math.floor(drops[key] ?? 0);

// 起点面板:yingling-output 配置,但没有 2,560,000 的资源.
const BASE_ARGS: CliArgs = new Map([
  ["lingwen","0"],["resource","0"],["yuanbao-mode","vip"],["yuanbao","0"],["zhenfa-level","1"]
]);
const BASE = buildResourcePanel(BASE_ARGS);

// 把 drops 全部按 calzhanli tozhanli 转成面板增量(缓存:同一份 drops + vipHit 只算一次).
const PANEL_CACHE = new Map<string,FinalPanel>();

// 一组对比的"资源分配方法":每组自己写一个 allocate,告诉通用循环如何把御灵突破分到各属性.
// 大循环/伤害链保持通用——只消费 allocate 的结果,不写 if(组) 分支.
interface BreakAlloc {
  atkBreaks:   bigint;   // 投攻击的突破次数(→ baseAtk)
  atkPctExtra: bigint;   // 阵法带来的攻击%修正(天覆=+阵法等级%;鸟翔=去掉天覆面板15%)
  baseAtk:     bigint;   // 分配后基础攻
  capBreaks:   bigint;   // 投幸运到 5W 保掉落的突破次数
  dmgAddExtra: bigint;   // 阵法带来的伤害加成(鸟翔=速度差转增伤,封顶 int 上限)
  hit:         bigint;   // 分配后命中
  lucky:       bigint;   // 分配后幸运
  luckyBreaks: bigint;   // 余下投幸运(命中链)的突破次数
  pen:         bigint;   // 分配后穿透
  penBreaks:   bigint;   // 投穿透的突破次数(→ pen)
  speed:       bigint;   // 分配后速度
  speedBreaks: bigint;   // 投速度的突破次数
}

interface CheckResult {
  atkBreaks:   bigint;       // 该组投到攻击的突破
  capBreaks:   bigint;       // 先把幸运堆到 5W 用掉的突破
  damage:      bigint;
  dmgAddExtra: bigint;       // 鸟翔阵速度差增伤
  hit:         bigint;
  hitOk:       boolean;
  killOk:      boolean;
  lucky:       bigint;
  luckyBreaks: bigint;     // 余下给幸运(命中链)的突破
  luckyFull:   boolean;      // 幸运是否已达 5W(掉落 100%)
  pass:        boolean;
  penBreaks:   bigint;       // 该组投到穿透的突破
  speed:       bigint;
  speedBreaks: bigint;     // 余下给速度的突破
  speedOk:     boolean;
}

interface GroupPlan {
  allocate: (panel: FinalPanel,hero: Hero) => BreakAlloc; // 该组如何分配突破资源
  bucket:   (hit: bigint) => bigint;                       // 该英灵技能百分比乘区
  hero:     Hero;
  hitOk:    (hit: bigint) => boolean;                      // 该英灵命中是否达标
  name:     string;
  sec:      number;
  zhenfa:   "niaoxiang" | "tianfu";
}

// #endregion
// #region 伤害与三条件
type Hero = "wukong" | "yunxiao";

// 先把幸运堆到 5W(确保地图掉落 100%)所需突破次数——所有组的共同硬前提.
const LUCKY_CAP = 50000n;
function capBreaksFor (panel: FinalPanel): bigint {
  const need = LUCKY_CAP > panel.lucky ? LUCKY_CAP - panel.lucky : 0n;
  const n = minBreaksForGain(need);
  return n < panel.breaks ? n : panel.breaks;
}

// 把五类突破次数换算成最终面板量 + 阵法修正(纯计算,不含分配决策).
function mkAlloc (panel: FinalPanel,hero: Hero,zhenfa: GroupPlan["zhenfa"],cap: bigint,luckyB: bigint,speedB: bigint,atkB: bigint,penB: bigint): BreakAlloc {
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

// 补速度到刚好过敌速所需突破次数(悟空/云霄天覆组用;鸟翔组速度是主属性,不限到过敌).
function speedToPass (panel: FinalPanel,left: bigint): bigint {
  const need = speedBreaksNeeded(panel.speed);
  return need < left ? need : left;
}

// 孙悟空技能乘区:葫芦78% × 神通15 × 西行 Lv3(八戒-20闪避);命中靠幸运链 hitRate 判定.
function wukongBucket (hit: bigint): bigint {
  const f1 = (100n + hit) * HIT_SCALE / 100n;
  const s15 = hit < SHEN_TONG_15_CAP ? hit : SHEN_TONG_15_CAP;
  const f2 = (100n + s15) * HIT_SCALE / 100n;
  const xi = hit - ENEMY_DODGE + 20n > 0n ? hit - ENEMY_DODGE + 20n : 0n;
  const f3 = (100n + xi) * HIT_SCALE / 100n;
  return f1 * f2 / HIT_SCALE * f3 / HIT_SCALE;
}

// 云霄技能乘区:普攻80% × 后羿弓0.8 × 神通27 × 神通15 × 西行 Lv2 × 神通20;命中恒达标.
function yunxiaoBucket (hit: bigint): bigint {
  const s15 = hit < SHEN_TONG_15_CAP ? hit : SHEN_TONG_15_CAP;
  const gap = hit > ENEMY_DODGE ? hit - ENEMY_DODGE : 0n;
  const xi = gap * 75n / 100n;
  let b = 80n * HIT_SCALE / 100n;
  b = b * (80n * HIT_SCALE / 100n) / HIT_SCALE;
  b = b * (102n * HIT_SCALE / 100n) / HIT_SCALE;
  b = b * ((100n + s15) * HIT_SCALE / 100n) / HIT_SCALE;
  b = b * ((100n + xi) * HIT_SCALE / 100n) / HIT_SCALE;
  return b * (130n * HIT_SCALE / 100n) / HIT_SCALE;
}
const wukongHitOk  = (hit: bigint): boolean => hitRate(Number(hit),ENEMY_5.dodge) >= 1;
const yunxiaoHitOk = (_hit: bigint): boolean => true;

// #endregion
// #region 逐小时大循环与输出
// 通用伤害链:资源如何分配由 plan.allocate() 决定,这里只消费结果,不含任何按组/按英雄的分配分支.
function evaluate (panel: FinalPanel,plan: GroupPlan): CheckResult {
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
function panelFromDrops (drops: DropMap,vipHit: number,forgeSeconds: number,wing2: number): FinalPanel {
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

// 速度更快需要的最少突破(起点速度 + 其它速度增量后仍需补的部分).
function speedBreaksNeeded (baseSpeed: bigint): bigint {
  return minBreaksForGain(ENEMY_SPEED + 1n - baseSpeed);
}

// 4 组对比(finalcal.md):每组自带 allocate,告诉通用循环"余下突破怎么分".
// 共同硬前提:先用 capBreaksFor 把幸运堆到 5W 保掉落;之后各组的余下突破由本组方法决定.
// 天覆组速度只需补到过敌速(三条件门槛);鸟翔组速度是主属性,不限到过敌(速度差转伤害).
const GROUP_PLANS: readonly GroupPlan[] = [
  {

    // 组1 神悟空+天覆+突破幸运:补速度过敌 → 余下全幸运(悟空靠幸运链补命中).
    allocate: (p,h): BreakAlloc => {
      const cap = capBreaksFor(p);
      const left = p.breaks - cap;
      const speedB = speedToPass(p,left);
      return mkAlloc(p,h,"tianfu",cap,left - speedB,speedB,0n,0n);
    },
    bucket: wukongBucket,
hero:   "wukong",
hitOk:  wukongHitOk,
    name:   "神悟空(神·人皇印)+天覆阵+突破幸运",
sec:    WUKONG_SEC,
zhenfa: "tianfu"
  },{

    // 组2 云霄+天覆+突破攻击:补速度过敌 → 余下全攻击(加 baseAtk,走 K 函数).
    allocate: (p,h): BreakAlloc => {
      const cap = capBreaksFor(p);
      const left = p.breaks - cap;
      const speedB = speedToPass(p,left);
      return mkAlloc(p,h,"tianfu",cap,0n,speedB,left - speedB,0n);
    },
    bucket: yunxiaoBucket,
hero:   "yunxiao",
hitOk:  yunxiaoHitOk,
    name:   "云霄娘娘(基础·普攻80%)+天覆阵+突破攻击",
sec:    YUNXIAO_SEC,
zhenfa: "tianfu"
  },{

    // 组3 云霄+天覆+突破穿透:补速度过敌 → 余下全穿透(加 pen,降敌有效防御).
    allocate: (p,h): BreakAlloc => {
      const cap = capBreaksFor(p);
      const left = p.breaks - cap;
      const speedB = speedToPass(p,left);
      return mkAlloc(p,h,"tianfu",cap,0n,speedB,0n,left - speedB);
    },
    bucket: yunxiaoBucket,
hero:   "yunxiao",
hitOk:  yunxiaoHitOk,
    name:   "云霄娘娘(基础·普攻80%)+天覆阵+突破穿透",
sec:    YUNXIAO_SEC,
zhenfa: "tianfu"
  },{

    // 组4 云霄+鸟翔+突破速度:余下全速度(不限过敌,速度差转增伤);速度到顶后金币只换灵纹.
    allocate: (p,h): BreakAlloc => {
      const cap = capBreaksFor(p);
      return mkAlloc(p,h,"niaoxiang",cap,0n,p.breaks - cap,0n,0n);
    },
    bucket: yunxiaoBucket,
hero:   "yunxiao",
hitOk:  yunxiaoHitOk,
    name:   "云霄娘娘(基础·普攻80%)+鸟翔阵+突破速度(速度到顶金币只换灵纹)",
sec:    YUNXIAO_SEC,
zhenfa: "niaoxiang"
  }
];

// 购物/翅膀正反馈的逐轮状态(每个 8h 阵营/10h 寻宝结算点先购物再结算).
interface ShopState {
  buyCangbaotu:  number;          // 累计买藏宝图个数
  buyMengpo:     number;          // 累计买孟婆汤组数
  buyWing:       number;          // 累计买翅膀材料组数(4种合计)
  cangbaotu:     number;          // 当前藏宝图印记
  events:        number;          // 发生的结算点数(8h/10h 去重)
  mengpo:        number;          // 当前孟婆汤持有
  spentShopping: number;          // 购物花掉元宝
  vipPool:       number;          // 投入 VIP 的元宝累计
  wing:          [number,number,number,number]; // 翅膀 1~4 当前等级
  wingYuanbao:   number;          // 翅膀1 挂机掉元宝累计
  yuanbao:       number;          // 当前可用于购物的元宝余额
  zhuan:         number;          // 当前转生次数
}

// 单个结算点购物:用户口径"一轮要买的东西 = 4种翅膀(各2个)+孟婆汤(2个,够转生不买)
// +藏宝图(1个,补满100%不买)",攒够这一整组就一次买齐;仙葫药/灵根药固定不买(体力已够开满全10层).
// 买了立刻升翅膀等级,本轮收益即用新等级(正反馈).元宝不够整组就继续攒,不进 VIP;
// 只有当清单里的东西都不需要买了(4翅膀无封顶→永不触发,孟婆/藏宝图封顶后从清单移除),
// 剩余元宝才投 VIP——因翅膀主要效果无封顶,实际元宝持续投入翅膀,越买收益越高.
function buyRound (s: ShopState): void {
  const isNeedMengpo = s.zhuan < ZHUAN_SHENG_MAX && s.mengpo < (s.zhuan + 1) * MENGPO_PER_ZHUAN;
  const isNeedCangbaotu = s.cangbaotu < CB_TU_CAP;

  // 4 翅膀(无封顶,永远要买) + 按需孟婆汤 + 按需藏宝图 = 本轮清单.
  const cost = 4 * SHOP_WING_PRICE
    + (isNeedMengpo ? SHOP_MENGPO_PRICE : 0)
    + (isNeedCangbaotu ? SHOP_CANGBAOTU_PRICE : 0);
  if (s.yuanbao < cost) {return;}           // 攒不够整组,继续攒
  s.yuanbao -= cost;
  s.spentShopping += cost;

  // 4 种翅膀各买一组(每样 2 个),等级 +2.
  s.wing = s.wing.map((level): number => level + SHOP_WING_NUMS) as [number,number,number,number];
  s.buyWing += 4;
  if (isNeedMengpo) {
    s.mengpo += SHOP_MENGPO_NUMS;
    s.buyMengpo += 1;
    while (s.zhuan < ZHUAN_SHENG_MAX && s.mengpo >= (s.zhuan + 1) * MENGPO_PER_ZHUAN) {
      s.mengpo -= (s.zhuan + 1) * MENGPO_PER_ZHUAN;
      s.zhuan += 1;
    }
  }
  if (isNeedCangbaotu) {
    s.cangbaotu += 1;
    s.buyCangbaotu += 1;
  }

  // 整组买齐后剩余投 VIP(翅膀无封顶,实际每轮都把元宝投入到买齐下一组).
  s.vipPool += s.yuanbao;
  s.yuanbao = 0;
}
const ZY_HOURS = ZY_ROUND_SECONDS / SECONDS_PER_HOUR;   // 8
const XB_HOURS = XB_ROUND_SECONDS / SECONDS_PER_HOUR;   // 10(寻宝源码 RefreTime_min*60=36000s)

// 抽奖状态:累计抽奖次数决定等级;每 8h 在两组奖池间选期望收益高的一组.
interface ChoujiangState {
  count:     number;   // 累计已抽次数(决定等级阈值)
  draws:     number;   // 实际抽的次数
  pool3Hit:  number;   // 选组 A 的次数
  pool4Hit:  number;   // 选组 B 的次数
  ticketGet: number;   // 从掉落累计获得的抽奖券
}

// ============ 逐小时大循环模拟状态 ============
// 单个英灵的一次完整模拟状态.所有掉落累计在 drops,购物/翅膀/抽奖状态单独维护.
interface SimSnap {
  check:          CheckResult;
  choujiang:      ChoujiangState;
  drops:          DropMap;
  hero:           Hero;
  hours:          number;          // 达标小时(或终止小时)
  layers:         Partial<Record<MapID,number>>; // 各图累计推层数
  name:           string;
  panel:          FinalPanel;
  reached:        boolean;         // 是否达标跳出
  routeStep:      number;          // 当前处在 PRE_ROUTE 第几步
  shop:           ShopState;
  sweepHours:     number;          // 累计扫荡小时(春秋蝉+自动扫荡)
  ticketDrawn:    number;          // 累计抽奖券消耗
  vip:            VipDetail;
  xunbaoRounds:   number;
  zhenyingRounds: number;
}

// 抽奖奖池每行个数按等级缩放:Lv1 基础×1,Lv3×3,Lv4×4,Lv5×5,Lv6×6(配置 Prop_Nums 恰为等级倍数).
// 笔记阶梯给的抽数是"抽 N 次",每次按权重期望抽 1 个选项.
function choujiangDraw (pool: string,level: number,drops: DropMap): void {
  const rows = CHOUJIANG_ROWS[pool];
  if (rows === undefined) {return;}
  const scaleRatio = level / 6;             // 配置 Prop_Nums 是 Lv6 个数,低等级按比例缩放
  for (const [name,baseNums,weight] of rows) {

    // 特殊道具(宝箱/令/残念锦囊)不折算进主资源,仅统计;主资源按 个数×权重‰ 期望计入.
    if (name.includes("匣") || name.includes("宝箱") || name.includes("令") || name.includes("锦囊")) {continue;}
    add(drops,name,baseNums * scaleRatio * weight / 1000);
  }
}

// 抽奖等级:累计 ChouJiangCount 阈值 250/1000/5000/10000/50000 → Lv1..5(资源提升战力方案.md:179).
// 奖池配置最高到 Lv6;笔记阶梯用 Lv1/3/4/5,这里按 count 阈值给对应奖池等级(至少1).
function choujiangLevel (count: number): number {
  if (count >= 50000) {return 5;}
  if (count >= 10000) {return 4;}
  if (count >= 5000) {return 3;}
  if (count >= 1000) {return 2;}
  return 1;
}
function newChoujiang (): ChoujiangState {
  return {count: 0,draws: 0,pool3Hit: 0,pool4Hit: 0,ticketGet: 0};
}
function newShop (): ShopState {
  return {
    buyCangbaotu:  0,
buyMengpo:     0,
buyWing:       0,
cangbaotu:     0,
events:        0,
mengpo:        0,
    spentShopping: 0,
vipPool:       0,
wing:          [0,0,0,0],
wingYuanbao:   0,
yuanbao:       0,
zhuan:         0
  };
}

// 某组奖池按"主资源战力权重"估算单抽期望(用于两组选高).这里用资源名→折算权重.
const CHOUJIANG_VALUE: Record<string,number> = {
  三味真火: 3,
五彩神石: 1,
历史本纪: 1,
后悔药:  50,
寒铁:   1,
强化石:  1,
御灵宝典: 200,
忘情水:  3,
  春秋蝉:  500,
灵晶:   1,
灵纹:   1,
破境石:  1,
神通卷轴: 1,
神速符:  2
};

// 前置推层路线:按秒/层逐步推,返回各图累计层数 + 累计消耗秒数.
// 每步 [图 ID,目标层];-1 表示回第5图一直推(前置阶段只推到刚好整数小时).
interface PreRouteResult {detail: string[]; layers: Partial<Record<MapID,number>>; seconds: number}

// 单英灵完整逐小时模拟(无二分/无 BASE_HOURS):前置路线→点卡→前置抽奖→每小时循环→达标跳出.
// 大循环参数:judge=true 按"是否击败终局5"判定到达标跳出;judge=false 每 1h 打印战力(仅 100 次循环)供研究参考.
// item: 对比组(GroupPlan),自带 allocate 资源分配方法;循环通用,只调用 plan 不写按组分支.
// group: 对比组号(仅 judge=false 有意义):1=悟空幸运,2=云霄攻击,3=云霄穿透,4=云霄鸟翔速度.
export function simulateHero (item: GroupPlan,maxHours: number,judge = true,group = 1,trace?: (s: string) => void): SimSnap {
  const drops: DropMap = {};
  const layers: Partial<Record<MapID,number>> = {};
  const shop = newShop();
  const cj = newChoujiang();
  let sweepHours = 0;

  // ---- 前置:固定推层路线(春秋蝉最大利用率) ----
  const pre = runPreRoute(item.sec);
  Object.assign(layers,pre.layers);
  for (const [map,total] of Object.entries(pre.layers)) {
    addMapDrops(drops,Number(map) as MapID,0,total);   // 前置各图的挂机掉落(未含扫荡加成)
  }

  // 前置时间上移到整数小时.
  let hour = Math.ceil(pre.seconds / SECONDS_PER_HOUR);
  if (hour < 1) {hour = 1;}

  // 前置段点卡收益(整段小时数).
  add(drops,"钱币",DK_PROFIT_PER_ROUND * hour);

  // 前置段抽奖阶梯.
  preChoujiang(drops,cj);

  // 物资默认扣除值:全部研究所需资源 = 历史本纪 309,665(data.ts RESEARCH_FULL_COST).
  add(drops,"历史本纪",-RESEARCH_FULL_COST);

  // ---- 每小时大循环 ----
  let isReached = false;
  const routeStep = PRE_ROUTE.length - 1;                // 最后一步:回5图一直打

  // 面板判定点:每 CHECK_STEP 小时一次(8h 的倍数),兼顾精度与耗时;资源逐小时累积不受影响.
  const CHECK_STEP = 512;                     // 判定间隔(≈21天),达标小时精度=512h
  let nextCheckHour = CHECK_STEP;
  const advanceCheck = (h: number): void => {nextCheckHour = h + CHECK_STEP;};
  const loopLimit = judge ? maxHours : Math.min(maxHours,hour + 99); // judge=false 仅 100 次循环
  for (; hour <= loopLimit; hour++) {

    // ① 任务奖励(4h 刷新的达成式任务:按层级里程碑一次性领;配置不可得部分在 log 说明).
    // ② 点卡(每小时一轮).
    add(drops,"钱币",DK_PROFIT_PER_ROUND);

    // ③ 结算点:购物在任一 8h/10h 倍数点先做(升翅膀),各系统按自身周期结算,全部用新翅膀等级.
    let checkNow: CheckResult | undefined;
    const isZY = hour % ZY_HOURS === 0;        // 阵营/抽奖/地图:8h
    const isXB = hour % XB_HOURS === 0;        // 寻宝:10h(源码 RefreTime_min*60=36000s)
    if (isZY || isXB) {
      shop.events += 1;              // 结算点数(8h/10h 命中同一小时时只计一次)
      buyRound(shop);
    }
    if (isZY) {

      // 抽奖(8h 一次):券来自地图/扫荡掉落(prop10),有券就抽 1 次(笔记"每8h 核查抽奖,选收益高的一组").
      if ((drops["抽奖卷"] ?? 0) >= CHOUJIANG_TICKET_PROP && cj.ticketGet < Math.floor(drops["抽奖卷"] ?? 0)) {
        cj.ticketGet += 1;
        choujiangRound(drops,cj);
      }

      // 阵营(8h 倍数),用新翅膀3.
      const zy = zhenyingRound(shop.wing[2]);
      shop.yuanbao += zy.yuanbao;

      // 地图挂机掉落:8 小时一次性结算(每层掉落恒定,等价逐小时;BigInt floorSum 调用降到 1/8).
      const perHourLayers = Math.floor(SECONDS_PER_HOUR / item.sec);
      const towerBefore = layers[5] ?? 1500;
      const towerAfter = towerBefore + perHourLayers * ZY_HOURS;
      layers[5] = towerAfter;
      addMapDrops(drops,5,towerBefore,towerAfter);
    }
    if (isXB) {

      // 寻宝(10h 倍数),用新翅膀4+藏宝图.
      const xb = xunbaoRound(shop.wing[3],shop.cangbaotu);
      for (const [k,v] of Object.entries(xb.drops)) {add(drops,k,v);}
      shop.yuanbao += xb.yuanbao;
    }

    // ③b 面板/三条件判定(倍增点 nextCheckHour:8→16→32...);judge=false 时每小时都算面板以打印战力.
    if (hour === nextCheckHour || !judge) {
      const vipNow = vipFromYuanbao(shop.vipPool);
      const panelNow = panelFromDrops(drops,vipNow.hitCrit,hour * SECONDS_PER_HOUR,shop.wing[1]);
      checkNow = evaluate(panelNow,item);
      if (judge) {advanceCheck(hour);}
      if (!judge && trace !== undefined) {
        trace(`组${String(group)} ${item.name} h=${String(hour)} 攻=${fmt(panelNow.baseAtk)} 命中=${fmt(checkNow.hit)} `
          + `速度=${fmt(checkNow.speed)} 伤害=${fmt(checkNow.damage)} 突破=${fmt(panelNow.breaks)} 元宝池=${nfmt(shop.vipPool)}`);
      }
    }

    // ④ 地图挂机掉落已在 8h 结算点一次性结算(见上);大循环只推5图(其余前置阶段已到目标).
    // ⑤ 扫荡:通天塔敌人不能被一击秒杀就拿扫荡奖励(春秋蝉1个=1小时),仅在 8h 判定点处理.
    if (checkNow !== undefined && !checkNow.killOk) {
      const cq = Math.floor(drops["春秋蝉"] ?? 0) - sweepHours / CHUNQIU_HOURS;
      const sweepThisHour = cq > 0 ? CHUNQIU_HOURS : 0;
      if (sweepThisHour > 0) {
        addSweepHours(drops,layers,sweepThisHour,item.sec);
        sweepHours += sweepThisHour;
      }
    }

    // ⑥ 三条件判定(每 8h):第一次满足即跳出.
    if (checkNow !== undefined && checkNow.pass) {isReached = true; break;}
  }

  // 终态快照.若逐点判定因间隔采样漏掉达标点,终态已满足则视为达标(小时=终态,精度=判定间隔).
  const hours = hour;
  const vip = vipFromYuanbao(shop.vipPool);
  const panel = panelFromDrops(drops,vip.hitCrit,hours * SECONDS_PER_HOUR,shop.wing[1]);
  const check = evaluate(panel,item);
  if (check.pass) {isReached = true;}
  return {
check,
choujiang:      cj,
drops,
hero:           item.hero,
hours,
layers,
name:           item.name,
panel,
reached:        isReached,
routeStep,
shop,
sweepHours,
ticketDrawn:    cj.ticketGet,
vip,
    xunbaoRounds:   Math.floor(hours / XB_HOURS),
zhenyingRounds: Math.floor(hours / ZY_HOURS)
};
}

// 某图一段层数的挂机掉落(复用 expectedDrops 的口径).
function addMapDrops (drops: DropMap,map: MapID,fromLayer: number,toLayer: number): void {
  const addN = toLayer - fromLayer;
  if (addN <= 0) {return;}
  const part = expectedDrops(map,addN);
  for (const [k,v] of Object.entries(part)) {add(drops,k,v);}
}

// 扫荡一段小时(春秋蝉 1个=1小时,按已开扫荡的图):每图每 48s 一份喽啰原始掉落×速度倍率.
function addSweepHours (drops: DropMap,layers: Partial<Record<MapID,number>>,hours: number,sec: number): void {
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
function choujiangRound (drops: DropMap,cj: ChoujiangState): void {
  const level = choujiangLevel(cj.count);
  const pool = poolExpectedValue(CHOUJIANG_POOL_3) >= poolExpectedValue(CHOUJIANG_POOL_4)
    ? CHOUJIANG_POOL_3
: CHOUJIANG_POOL_4;
  choujiangDraw(pool,level,drops);
  cj.count += 1;
  cj.draws += 1;
  if (pool === CHOUJIANG_POOL_3) {cj.pool3Hit += 1;} else {cj.pool4Hit += 1;}
}
function poolExpectedValue (pool: string): number {
  const rows = CHOUJIANG_ROWS[pool] ?? [];
  let v = 0;
  for (const [name,nums,weight] of rows) {
    v += (CHOUJIANG_VALUE[name] ?? 0) * nums * weight / 1000;
  }
  return v;
}

// 前置抽奖阶梯(笔记明确):全部抽 pool4(三味真火/神速符/御灵宝典/后悔药/春秋蝉/忘情水)这一组,
// 5 档抽数分别用 Lv1/3/4/5/5.只有大循环里的每 8h 抽奖才做两组选收益高.
function preChoujiang (drops: DropMap,cj: ChoujiangState): void {
  for (const [times,level] of CHOUJIANG_STEPS) {
    choujiangDraw(CHOUJIANG_POOL_4,level,drops);
    cj.count += times;
    cj.draws += times;
    cj.pool4Hit += times;
  }
}
function runPreRoute (sec: number): PreRouteResult {
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
const fmt = (v: bigint): string => formatSuoXie(Number(v));
const nfmt = (v: number): string => formatSuoXie(v);

// 输出单英灵完整推导(逐项写来源).
function logDetail (log: (s?: string) => void,item: {hero: Hero; name: string; sec: number},snap: SimSnap): void {
  const {check,drops,layers,panel,shop,vip} = snap;
  const cj = snap.choujiang;
  log(`\n### ${item.name} — ${nfmt(snap.hours)} 小时${snap.reached ? "(达标跳出)" : "(达上限未达标)"}`);
  const layerText = MAP_ORDER.filter(m => layers[m] !== undefined)
    .map(m => `${String(m)}:${nfmt(layers[m]!)}层`)
.join("、");
  log(`**① 推层路线(春秋蝉最大利用率)**:${layerText};合计 ${nfmt(Object.values(layers).reduce((s,v) => s + (v ?? 0),0))} 层。`);
  log(`  - 前置路线:${PRE_ROUTE.map(([m,t]) => `${String(m)}图→${t < 0 ? "一直打" : `${nfmt(t)}层`}`).join(" → ")};每步按 ${String(item.sec)}秒/层算实际时间,累加后上移到整数小时。`);
  log(`**② 前置抽奖阶梯**:抽数 Lv1×1000、Lv3×4000、Lv4×5000、Lv5×20000、Lv5×20000;共 ${nfmt(cj.draws)} 抽(组A ${nfmt(cj.pool3Hit)} / 组B ${nfmt(cj.pool4Hit)} 期望高者);`);
  log(`  - 奖池权重期望按 JiangChi_Data_Json.txt 6级行权重‰计;抽奖券(prop10)仅地图/扫荡掉落产出,累计获得 ${nfmt(snap.ticketDrawn)} 张。`);
  log(`**③ 逐小时行动**:点卡每小时 +${nfmt(DK_PROFIT_PER_ROUND)} 钱币,共 ${nfmt(snap.hours)} 轮;`);
  log("  - 任务奖励:4h 刷新达成式任务,奖励道具配置 TaskData_Json.txt 不在工作区,本计算仅计可确定的里程碑骨架(见口径);");
  log(`  - 每 8h(${nfmt(snap.zhenyingRounds)} 次)核查抽奖(两组选期望高)、阵营;每 10h(${nfmt(snap.xunbaoRounds)} 次)核查寻宝(源码 RefreTime_min*60=36000s);两类结算点均先购物再结算(新翅膀等级).`);
  log(`**④ 购物正反馈**:结算点 ${nfmt(shop.events)} 个,买 4 翅膀 ${nfmt(shop.buyWing)} 组/孟婆汤 ${nfmt(shop.buyMengpo)} 组/藏宝图 ${nfmt(shop.buyCangbaotu)} 个,花 ${nfmt(shop.spentShopping)} 元宝;`);
  log(`  - 翅膀1/2/3/4 = [${shop.wing.map(nfmt).join("、")}];转生 ${String(shop.zhuan)}/${String(ZHUAN_SHENG_MAX)},藏宝图 ${String(shop.cangbaotu)}/${String(CB_TU_CAP)};`);
  log(`  - 翅膀4 寻宝大奖+5%/级无封顶+翻倍%、翅膀3 阵营+5%/级、翅膀2 装备四维75+25L、翅膀1 挂机掉元宝 ${nfmt(shop.wingYuanbao)}。`);
  log(`**⑤ VIP**:购物剩余元宝 ${nfmt(vip.yuanbao)} → VIP ${String(vip.level)}(每2级+1命中/暴击 → +${String(vip.hitCrit)});`);
  log(`**⑥ 挂机+寻宝掉落**:${["钱币","寒铁","灵纹","御灵宝典","强化石","灵晶","历史本纪","御力","神通卷轴","三味真火","忘情水"]
    .map(k => `${k} ${nfmt(drops[k] ?? 0)}`).join("｜")}。`);
  log(`  - 扫荡累计 ${nfmt(snap.sweepHours)} 小时(春秋蝉1个=1小时,通天塔敌人不能一击秒杀时补);寻宝 ${nfmt(snap.xunbaoRounds)} 轮、阵营 ${nfmt(snap.zhenyingRounds)} 轮。`);
  log(`**⑦ 资源转面板**:御灵宝典 ${nfmt(panel.books)} → 突破 ${fmt(panel.breaks)};寒铁打造耗时按 min(30,3+0.2×炼器级),翅膀2等级参与装备四维;`);
  log(`  - 基础攻 ${fmt(panel.baseAtk)}、攻击% ${fmt(panel.atkPct)}、命中 ${fmt(panel.hitFlat)}、速度 ${fmt(panel.speed)}。`);
  log(`  - 本组突破分配(allocate):保掉落幸运 ${fmt(check.capBreaks)} / 命中幸运 ${fmt(check.luckyBreaks)} / 攻击 ${fmt(check.atkBreaks)} / 穿透 ${fmt(check.penBreaks)} / 速度 ${fmt(check.speedBreaks)};鸟翔速度差增伤 ${fmt(check.dmgAddExtra)}。`);
  log(`**⑧ 三条件判定**:命中 ${fmt(check.hit)}${check.hitOk ? "✓" : "✗"} / 速度 ${fmt(check.speed)}${check.speedOk ? "✓" : "✗"} / 伤害 ${fmt(check.damage)}${check.killOk ? "✓" : "✗"}(敌HP ${fmt(ENEMY_HP)});`);
  log(`  - **结论:${check.pass ? "可击败终局第5层" : "打不过"}**。`);
}
function main (): void {
  const lines: string[] = [];
  const log = (s = ""): void => {lines.push(s); console.log(s);};
  log("# finalCal — 逐小时大循环:挂机收益与终局第 5 层判定");
  log("");
  log("## 1. 计算口径与公式来源");
  log("- 逐小时大循环(finalcal.md):去掉 BASE_HOURS/二分,前置固定推层路线(为春秋蝉最大利用率),上移整数小时后逐小时行动,第一次满足三条件即跳出。");
  log(`- 前置推层:${PRE_ROUTE.map(([m,t]) => `${String(m)}图→${t < 0 ? "一直打" : `${nfmt(t)}层`}`).join(" → ")};每步 sec/层算实际时间(孙悟空 ${String(WUKONG_SEC)}s、云霄 ${String(YUNXIAO_SEC)}s,余数单独记录确保准确)。`);
  log("- 前置抽奖:1000抽Lv1、4000抽Lv3、5000抽Lv4、20000抽Lv5、20000抽Lv5;奖池权重期望来自游戏目录 JiangChi_Data_Json.txt(6级).");
  log("- 每小时:任务奖励(4h刷新,配置不可得部分说明)/点卡(每1h净赚38.5万钱币)/元宝购物(8h与10h结算点核查)/抽奖(8h,两组选期望高)/阵营(8h)/寻宝(10h)/地图掉落/扫荡(不能秒杀时,春秋蝉1个=1h)/物资转面板/三条件判定.");
  log("- 购物正反馈:攒够整组买4翅膀(各2个/48888)+孟婆汤(2个/46888够转生不买)+藏宝图(1个/25888满974不买);翅膀买了立即升级,寻宝大奖+5%/级、阵营+5%/级、装备四维75+25L,剩余元宝升VIP.");
  log("- 抽奖券(prop10)只从地图/扫荡掉落产出;寻宝10h一轮(源码 RefreTime_min*60=36000s,非 Time_Per_Round),每格固定256万×权重‰(藏宝图补满必掉)×翻倍期望.");
  log("- 寒铁打造按时间串行:单件 min(30秒,3+0.2×炼器级);神兵默认23件全解锁;突破先堆幸运5W确保掉落100%.");
  log("- 三条件:命中100% + 速度更快 + 一击必杀(伤害≥敌HP);任务奖励道具配置不在工作区,仅计可确定骨架.");
  log("- 队伍:各组队内 三藏/沙僧/八戒/神林冲 提供西行羁绊;命中/攻击/伤害的英灵技能乘区按组(悟空走人皇印链,云霄走普攻80%链)。神林冲无独立面板加成配置,其间接效果并入西行羁绊口径,不单列.");
  log("- 资源分配架构:大循环与伤害链通用;每组自带 allocate 方法决定余下突破投幸运/攻击/穿透/速度。组1悟空天覆突破幸运(补速后余下全幸运走命中链);组2云霄天覆突破攻击;组3云霄天覆突破穿透;组4云霄鸟翔突破速度(速度差转增伤,速度到顶金币只换灵纹).");
  log("");
  log("## 2. 逐组结果(逐项推导)");

  // 模拟上限:10万小时(≈11.4年).达标则在该点跳出;未达标则报告上限内打不过.
  const MAX_HOURS = 10_0000;
  for (const item of GROUP_PLANS) {
    const snap = simulateHero(item,MAX_HOURS);
    logDetail(log,item,snap);
  }
  writeFileSync(new URL("../output/finalCal.md",import.meta.url),`${lines.join("\n")}\n`,"utf8");
  console.log("\n[已写出] output/finalCal.md");
}
if (process.argv[1] === import.meta.filename) {main();}

// #endregion