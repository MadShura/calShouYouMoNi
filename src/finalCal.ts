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
 * - 时间循环:按小时推进模拟正常游玩,每 8h 阵营结算,每 10h 寻宝一轮,每 1h 点卡一轮;点卡低买高卖
 * 数学期望(90万买→100万×97%卖,每单5.5张)直接得钱币;阵营从头算第1名奖励(25%+50%×0.99,Round=1,
 * 不算王者之翼);寻宝按轮(满150+回120=270体力,前9层知大奖走最短路径,余力开满第10层再多放第9层,
 * 每格按第10层奖池权重‰×固定256万计,大奖20488).
 * - 元宝购物正反馈(用户口径):每个 8h/10h 结算点先核元宝、优先买 4 翅膀材料(各2个/48888)、孟婆汤
 * (2个/46888,够转生则不买)、藏宝图(1个/25888,974个补满掉落100%则不买);仙葫药/灵根药因体力已够
 * 开满全10层不买.翅膀买了立即写印记:翅膀4 寻宝大奖+5%/级(无封顶)、整份翻倍概率=等级%(≤100),
 * 翅膀3 阵营元宝+5%/级(无封顶),翅膀1 挂机掉元宝,翅膀2 装备属性→买了就提升后续结算,越来越多.
 * 购买结算在所有收益结算之前(本轮即用新翅膀等级);所有该买的都买够后剩余元宝才升 VIP(vipLevelUpCost).
 * 逐轮状态(元宝/翅膀等级/藏宝图/孟婆汤)按事件点推进,不做周期闭式聚合.
 * - 御灵突破:先用突破把幸运堆到 5W(确保地图掉落100%),余下孙悟空先补速度再走命中链,云霄全速度.
 * - 三条件:命中 100% + 一击必杀(伤害≥敌 HP) + 速度更快,与 composite-compare 完全一致.
 * - log:每个计算值逐项写出来源与公式(①推层②挂机掉落③寻宝④阵营⑤VIP⑥面板⑦突破⑧三条件).
 * - 时间搜索:从 80 小时起按 16 倍翻倍圈定区间,再几何二分找最小能打过的倍数;
 * 寒铁大(逐级模拟极慢)时只做有限次二分并返回已验证能打过的上界,结果写 output/finalCal.md.
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
import {MAPS,PROP_NAMES,WAVE_COMPOSITION} from "./data.ts";
import {vipLevelUpCost} from "./game-formulas.ts";
import {ENEMY_5} from "./zhanli-panel.ts";
import {hitRate} from "./enemy-stats.ts";
import {formatSuoXie} from "./readSave.ts";
import {buildResourcePanel} from "./yingling-output.ts";
import type {CliArgs} from "./readSave.ts";
import type {MapID} from "./data.ts";

// #region 常量
const BASE_HOURS = 80;
const MAX_MULTIPLE = 1_0000_0000;
const SECONDS_PER_HOUR = 3600;
const WUKONG_SEC = 1.1;
const YUNXIAO_SEC = 0.85;
const CAPPED_LAYERS: Partial<Record<MapID,number>> = {1: 1000,2: 1_0000,3: 1_0000,4: 1_0000};
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
const XB_ROUND_SECONDS = 36000;             // 一轮计时周期 = 10h,结算补满体力
const XB_RECOVER_SECONDS = 300;             // 每 300s 回 1 点 → 一轮回 36000/300=120 点
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
const SHOP_XIANHU_PRICE = 7888;              // index 30:仙葫药 5 个/7888(本计算不买)
const SHOP_LINGGEN_PRICE = 15888;            // index 7:灵根药 1 个/15888(本计算不买)
const ZHUAN_SHENG_MAX = 9;                   // ZhuanShengManager.MaxZhuanShengCount
const MENGPO_PER_ZHUAN = 2;                  // 转生 k 次需 (k+1)×2 个,起始 k=0 需 2

// 翅膀效果封顶(源码:翅膀4 翻倍概率 L≤100、体力恢复 L≤250;翅膀3 阵营元宝无封顶)
const WING4_DOUBLE_CAP = 100;
const WING4_RECOVER_CAP = 250;

// ---- 阵营(zhenyin.ts settle:从头算,不算王者之翼) ----
const ZY_ROUND_SECONDS = 8 * 3600;          // 阵营一轮 = 8h
const ZY_ROUNDS_PER_80H = BASE_HOURS * SECONDS_PER_HOUR / ZY_ROUND_SECONDS; // 80h/8h = 10 轮
const ZY_RATE = 71;                          // 满图 13 块地每分钟积分基准
const ZY_TICK_SECONDS = 60.1;               // 每 60.1s 加一次积分
const ZY_TICKS = Math.floor((ZY_ROUND_SECONDS - ZY_TICK_SECONDS) / ZY_TICK_SECONDS) + 1; // 从头=479 次
const ZY_RANK1_RATE = 25;                   // 第1名奖励 25%
const ZY_SHARE = 0.99;                      // 贡献占比取 clamp 上限
const ZY_WING = 0;                          // 不算王者之翼 → ×1

// ---- 点卡买卖(DianKaSellManager.cs / DianKaSell_Record.cs / 机制笔记§2) ----
const DK_REFRESH_SECONDS = 3600;            // 市场每 60 分钟刷新一次 = 每小时一轮
const DK_NPC_MEAN = 100_0000;               // NPC 挂牌价 90万~110万(1万档,20档均匀)的期望 ≈ 100万
const DK_BUY = 90_0000;                     // 买价取最低档 90万
const DK_FEE = 0.97;                        // 成交扣 3% 手续费,97% 进邮件(钱币)
const DK_CARDS_PER_ROUND = 5.5;             // 每单张数 Random(1,11) 的期望 = 5.5
const DK_PROFIT_PER_ROUND = (DK_NPC_MEAN * DK_FEE - DK_BUY) * DK_CARDS_PER_ROUND; // 每轮净赚钱币

// ---- 寒铁打造时间(PropHelper.cs:507-515 / NPC_EquipManager.cs:102-137) ----
const FORGE_BASE_SECONDS = 3;               // MakeEquiTime_s = 3
const FORGE_PER_LEVEL = 0.2;                // + 炼器等级 × 0.2 秒
const FORGE_CAP_SECONDS = 30;               // 单件封顶 30 秒

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

// 按"前面层数到了就转通天塔"分配时间,返回每层地图的掉落与层数.
function farmAll (hours: number,secondsPerLayer: number): {drops: DropMap; layers: Partial<Record<MapID,number>>} {
  const totalLayers = Math.floor(hours * SECONDS_PER_HOUR / secondsPerLayer);
  let left = totalLayers;
  const layers: Partial<Record<MapID,number>> = {};
  const drops: DropMap = {};
  for (const map of MAP_ORDER) {
    const cap = CAPPED_LAYERS[map];
    const use = cap === undefined ? left : Math.min(cap,left);
    if (use > 0) {
      layers[map] = use;
      const part = expectedDrops(map,use);
      for (const [key,value] of Object.entries(part)) {add(drops,key,value);}
    }
    left -= use;
    if (left <= 0) {break;}
  }
  return {drops,layers};
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
  const layer1Cost = XB_FIRST_KNOWN * 1;                       // 第1层:3.2 格 × 1点
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
remain:    Math.max(0,totalTili - advCost),
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
interface CheckResult {
  capBreaks:   bigint;       // 先把幸运堆到 5W 用掉的突破
  damage:      bigint;
  hit:         bigint;
  hitOk:       boolean;
  killOk:      boolean;
  lucky:       bigint;
  luckyBreaks: bigint;     // 余下给幸运(命中链)的突破
  luckyFull:   boolean;      // 幸运是否已达 5W(掉落 100%)
  pass:        boolean;
  speed:       bigint;
  speedBreaks: bigint;     // 余下给速度的突破
  speedOk:     boolean;
}

// #endregion
// #region 伤害与三条件
type Hero = "wukong" | "yunxiao";

// #endregion
// #region 时间搜索与输出
interface Row {
  check:           CheckResult;
  drops:           DropMap;
  hero:            Hero;
  hours:           number;
  layers:          Partial<Record<MapID,number>>;
  multiple:        number;
  name:            string;
  panel:           FinalPanel;
  secondsPerLayer: number;
}

// 按 composite-compare 伤害公式 + 英灵专属乘区算单次输出与三条件.
function evaluate (panel: FinalPanel,hero: Hero): CheckResult {

  // 硬性前提:不管哪条路线,先用突破把幸运堆到 5W(确保地图掉落 100%).
  const LUCKY_CAP = 50000n;
  const needCapBreaks = minBreaksForGain(LUCKY_CAP > panel.lucky ? LUCKY_CAP - panel.lucky : 0n);
  const capBreaks = needCapBreaks < panel.breaks ? needCapBreaks : panel.breaks;
  const isLuckyFull = panel.lucky + sumGain(capBreaks) >= LUCKY_CAP;
  const left = panel.breaks - capBreaks;
  const needSpeed = speedBreaksNeeded(panel.speed);
  let lucky: bigint,luckyBreaks: bigint,speed: bigint,speedBreaks: bigint;
  if (hero === "wukong") {
    speedBreaks = needSpeed < left ? needSpeed : left;
    luckyBreaks = left - speedBreaks;
    lucky = panel.lucky + sumGain(capBreaks + luckyBreaks);
  } else {
    speedBreaks = left;
    luckyBreaks = 0n;
    lucky = panel.lucky + sumGain(capBreaks);
  }
  speed = panel.speed + sumGain(speedBreaks);
  const hit = panel.hitFlat + (hero === "wukong" ? lucky / 100n * 5n : 0n);

  // 百分比乘区(定点 1e6):孙悟空 = skill78 × 神通15 × 西行 Lv3;云霄 = 0.8 × 后羿弓0.8 × 神通27 × 神通15 × 西行 Lv2 × 神通20.
  let bucket: bigint;
  if (hero === "wukong") {
    const f1 = (100n + hit) * HIT_SCALE / 100n;
    const s15 = hit < SHEN_TONG_15_CAP ? hit : SHEN_TONG_15_CAP;
    const f2 = (100n + s15) * HIT_SCALE / 100n;
    const xi = hit - ENEMY_DODGE + 20n > 0n ? hit - ENEMY_DODGE + 20n : 0n;
    const f3 = (100n + xi) * HIT_SCALE / 100n;
    bucket = f1 * f2 / HIT_SCALE * f3 / HIT_SCALE;
  } else {
    const s15 = hit < SHEN_TONG_15_CAP ? hit : SHEN_TONG_15_CAP;
    const gap = hit > ENEMY_DODGE ? hit - ENEMY_DODGE : 0n;
    const xi = gap * 75n / 100n;
    bucket = 80n * HIT_SCALE / 100n;                       // 云霄2技能 普攻80%
    bucket = bucket * (80n * HIT_SCALE / 100n) / HIT_SCALE; // 后羿弓 miss→命中 ×0.8
    bucket = bucket * (102n * HIT_SCALE / 100n) / HIT_SCALE;// 神通27
    bucket = bucket * ((100n + s15) * HIT_SCALE / 100n) / HIT_SCALE;
    bucket = bucket * ((100n + xi) * HIT_SCALE / 100n) / HIT_SCALE;
    bucket = bucket * (130n * HIT_SCALE / 100n) / HIT_SCALE;// 神通20(普攻 SP30)
  }

  // 暴击:对敌暴击率 = (暴击-敌抗暴+1)/101,≥100% 才乘暴伤,否则 ×1.
  const critScore = panel.crit - ENEMY_CRIT_RESIST + 1n;
  const critBucket = critScore >= 101n ? panel.critDamage * HIT_SCALE / 100n : HIT_SCALE;
  const atkPct = panel.atkPct + panel.zhenLevel;          // 天覆战斗期 +阵法等级% 攻击
  const finalAtk = panel.baseAtk * (100n + atkPct) / 100n;
  const defAfterPen = ENEMY_DEF > panel.pen ? ENEMY_DEF - panel.pen : 1n;
  const k = culDamagePercentBig(finalAtk,defAfterPen);
  let damage = finalAtk * k / 100n;
  damage = damage * bucket / HIT_SCALE;
  damage = damage * critBucket / HIT_SCALE;
  damage = damage * (100n + panel.dmgAdd) / 100n;
  damage = damage * (100n - ENEMY_REDUCE) / 100n;
  const isHitOk = hero === "wukong" ? hitRate(Number(hit),ENEMY_5.dodge) >= 1 : true;
  const isSpeedOk = speed > ENEMY_SPEED;
  const isKillOk = damage >= ENEMY_HP;
  return {
capBreaks,
damage,
hit,
hitOk:     isHitOk,
killOk:    isKillOk,
lucky,
luckyBreaks,
luckyFull: isLuckyFull,
pass:      isHitOk && isSpeedOk && isKillOk,
speed,
speedBreaks,
    speedOk:   isSpeedOk
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
const HEROES: readonly {hero: Hero; name: string; sec: number}[] = [
  {hero: "wukong",name: "孙悟空(神·人皇印)+天覆阵",sec: WUKONG_SEC},
  {hero: "yunxiao",name: "云霄娘娘(基础·普攻80%)+天覆阵",sec: YUNXIAO_SEC}
];
// 购物/翅膀正反馈的逐轮状态(每个 8h/10h 结算点先购物再结算).
interface ShopState {
  buyCangbaotu:    number;          // 累计买藏宝图个数
  buyMengpo:       number;          // 累计买孟婆汤组数
  buyWing:         number;          // 累计买翅膀材料组数(4种合计)
  cangbaotu:       number;          // 当前藏宝图印记
  events:          number;          // 发生的结算点数(8h/10h 去重)
  mengpo:          number;          // 当前孟婆汤持有
  spentShopping:   number;          // 购物花掉元宝
  vipPool:         number;          // 投入 VIP 的元宝累计
  wing:            [number,number,number,number]; // 翅膀 1~4 当前等级
  wingYuanbao:     number;          // 翅膀1 挂机掉元宝累计
  zhuan:           number;          // 当前转生次数
  yuanbao:         number;          // 当前可用于购物的元宝余额
}
interface Income {
  dianka:          number;          // 点卡买卖净赚的钱币
  diankaRounds:    number;
  drops:           DropMap;          // farm + xunbao + 点卡钱币 合计
  farm:            DropMap;           // 挂机推层掉落
  forgeSeconds:    number;    // 可用于打造装备的总秒数(=小时×3600)
  hours:           number;
  shop:            ShopState;        // 购物正反馈终态
  vip:             VipDetail;        // 用剩余元宝(vipPool)升的 VIP
  xunbao:          DropMap;         // 寻宝掉落(不含元宝)
  xunbaoOne:       XunbaoDetail;     // 终态那轮的寻宝(用于 log 展示)
  xunbaoRounds:    number;
  xunbaoYuanbao:   number;           // 寻宝累计元宝
  zhenyingOne:     ZhenyingDetail;   // 终态那轮的阵营
  zhenyingRounds:  number;
  zhenyingYuanbao: number;           // 阵营累计元宝
}

// 翅膀1(挂机掉元宝)每只怪期望元宝(MapRecorder.cs:281-316,getExpectedWingYuanBao 同口径).
function wing1YuanbaoPerMonster (level: number): number {
  if (level <= 0) {return 0;}
  if (level <= 10) {return Math.min(1,level * 10 / 100);}
  const base = Math.trunc((level - 10) / 25) + 1;
  return base + Math.min(1,(level - 10) % 25 * 4 / 100);
}
const AVG_MONSTERS_PER_LAYER = [0,1,2,3,4].reduce((s,a) => {
  const w = WAVE_COUNT[a] ?? [0,0,0];
  return s + w[0] + w[1] + w[2];
},0) / 5;

// 单个结算点购物:用户口径"一轮要买的东西 = 4种翅膀(各2个)+孟婆汤(2个,够转生不买)
// +藏宝图(1个,补满100%不买)",攒够这一整组就一次买齐;仙葫药/灵根药固定不买(体力已够开满全10层).
// 买了立刻升翅膀等级,本轮收益即用新等级(正反馈).元宝不够整组就继续攒,不进 VIP;
// 只有当清单里的东西都不需要买了(4翅膀无封顶→永不触发,孟婆/藏宝图封顶后从清单移除),
// 剩余元宝才投 VIP——因翅膀主要效果无封顶,实际元宝持续投入翅膀,越买收益越高.
function buyRound (s: ShopState): void {
  const needMengpo = s.zhuan < ZHUAN_SHENG_MAX && s.mengpo < (s.zhuan + 1) * MENGPO_PER_ZHUAN;
  const needCangbaotu = s.cangbaotu < CB_TU_CAP;
  // 4 翅膀(无封顶,永远要买) + 按需孟婆汤 + 按需藏宝图 = 本轮清单.
  const cost = 4 * SHOP_WING_PRICE
    + (needMengpo ? SHOP_MENGPO_PRICE : 0)
    + (needCangbaotu ? SHOP_CANGBAOTU_PRICE : 0);
  if (s.yuanbao < cost) {return;}           // 攒不够整组,继续攒
  s.yuanbao -= cost;
  s.spentShopping += cost;

  // 4 种翅膀各买一组(每样 2 个),等级 +2.
  s.wing = s.wing.map((level): number => level + SHOP_WING_NUMS) as [number,number,number,number];
  s.buyWing += 4;
  if (needMengpo) {
    s.mengpo += SHOP_MENGPO_NUMS;
    s.buyMengpo += 1;
    while (s.zhuan < ZHUAN_SHENG_MAX && s.mengpo >= (s.zhuan + 1) * MENGPO_PER_ZHUAN) {
      s.mengpo -= (s.zhuan + 1) * MENGPO_PER_ZHUAN;
      s.zhuan += 1;
    }
  }
  if (needCangbaotu) {
    s.cangbaotu += 1;
    s.buyCangbaotu += 1;
  }
  // 整组买齐后剩余投 VIP(翅膀无封顶,实际每轮都把元宝投入到买齐下一组).
  s.vipPool += s.yuanbao;
  s.yuanbao = 0;
}

const ZY_HOURS = ZY_ROUND_SECONDS / SECONDS_PER_HOUR;   // 8
const XB_HOURS = XB_ROUND_SECONDS / SECONDS_PER_HOUR;   // 10

/**
 * 按时间推进汇总收益(模拟正常游玩),逐事件点状态推进:
 * - 挂机推层掉落按累计小时闭式(与翅膀无关,各图封顶后全推通天塔).
 * - 事件点 = 8h 阵营 / 10h 寻宝的并集;每个事件点先购物(买则立即升翅膀),再用新翅膀等级结算本轮收益.
 * - 寻宝掉落每轮按当时 wing4/cangbaotu 计算并累加;阵营元宝按当时 wing3 计算;两者元宝进购物池.
 * - 翅膀1挂机掉元宝按当时 wing1 折算,单独累计(仅展示,不进购物池:它依赖推层速度).
 * - 每轮购物后剩余元宝全投 VIP 池;点卡每 1h 低买高卖净赚钱币(闭式);打造全程并行.
 */
const INCOME_CACHE = new Map<string,Income>();
function income (hours: number,sec: number): Income {
  const key = `${String(hours)}|${String(sec)}`;
  const cached = INCOME_CACHE.get(key);
  if (cached !== undefined) {return cached;}
  const {drops: farm} = farmAll(hours,sec);

  const shop: ShopState = {
buyCangbaotu: 0,buyMengpo: 0,buyWing: 0,cangbaotu: 0,events: 0,mengpo: 0,
spentShopping: 0,vipPool: 0,wing: [0,0,0,0],wingYuanbao: 0,zhuan: 0,yuanbao: 0
  };
  const xunbao: DropMap = {};
  let xunbaoOne = xunbaoRound(0,0);
  let zhenyingOne = zhenyingRound(0);
  let xunbaoRounds = 0,
zhenyingRounds = 0,
xunbaoYuanbao = 0,
zhenyingYuanbao = 0;

  // 逐事件点推进(时间升序):8h/10h 倍数并集.先购物再结算.
  let nextZy = ZY_HOURS,
nextXb = XB_HOURS;
  while (nextZy <= hours || nextXb <= hours) {
    if (nextZy <= nextXb) {
      buyRound(shop);                              // 先购物(升翅膀)
      zhenyingOne = zhenyingRound(shop.wing[2]);   // 用新翅膀3结算
      shop.yuanbao += zhenyingOne.yuanbao;
      zhenyingYuanbao += zhenyingOne.yuanbao;
      zhenyingRounds += 1;
      shop.events += 1;
      nextZy += ZY_HOURS;
    } else {
      buyRound(shop);
      xunbaoOne = xunbaoRound(shop.wing[3],shop.cangbaotu); // 用新翅膀4+藏宝图结算
      for (const [k,v] of Object.entries(xunbaoOne.drops)) {add(xunbao,k,v);}
      shop.yuanbao += xunbaoOne.yuanbao;
      xunbaoYuanbao += xunbaoOne.yuanbao;
      xunbaoRounds += 1;
      shop.events += 1;
      nextXb += XB_HOURS;
    }
  }
  buyRound(shop);                                  // 末尾元宝(买得起则购物,余者投 VIP)
  // 翅膀1挂机掉元宝(闭式):每推一层 = 元宝/怪 × 每层怪数,总层数 = hours×3600/sec.
  // 按终态 wing1 等级近似(上界),仅展示量级,不进购物池.
  shop.wingYuanbao = wing1YuanbaoPerMonster(shop.wing[0]) * AVG_MONSTERS_PER_LAYER
    * Math.floor(hours * SECONDS_PER_HOUR / sec);

  const diankaRounds = Math.floor(hours * SECONDS_PER_HOUR / DK_REFRESH_SECONDS);
  const dianka = diankaRounds * DK_PROFIT_PER_ROUND;
  const drops: DropMap = {};
  for (const [k,v] of Object.entries(farm)) {add(drops,k,v);}
  for (const [k,v] of Object.entries(xunbao)) {add(drops,k,v);}
  add(drops,"钱币",dianka);                        // 点卡买卖净赚直接进钱币
  const vip = vipFromYuanbao(shop.vipPool);
  const forgeSeconds = hours * SECONDS_PER_HOUR;   // 打造与推层并行,全程可打造
  const result: Income = {
dianka,
diankaRounds,
drops,
farm,
forgeSeconds,
hours,
shop,
vip,
    xunbao,
xunbaoOne,
xunbaoRounds,
xunbaoYuanbao,
zhenyingOne,
zhenyingRounds,
zhenyingYuanbao
};
  INCOME_CACHE.set(key,result);
  return result;
}
const EVAL_CACHE = new Map<string,{check: CheckResult; panel: FinalPanel}>();
function evalHours (hero: Hero,sec: number,hours: number): {check: CheckResult; panel: FinalPanel} {
  const key = `${hero}|${String(hours)}`;
  const cached = EVAL_CACHE.get(key);
  if (cached !== undefined) {return cached;}
  const inc = income(hours,sec);
  const panel = panelFromDrops(inc.drops,inc.vip.hitCrit,inc.forgeSeconds,inc.shop.wing[1]);
  const check = evaluate(panel,hero);
  const result = {check,panel};
  EVAL_CACHE.set(key,result);
  return result;
}

/**
 * 找最小「能打过」的 80 小时倍数:pass 对小时数单调.
 * 先按 16 倍翻倍圈定区间,再几何二分(比值每次开方).
 * hantieTozhanli 逐级模拟的耗时随寒铁量线性增长,区间上端寒铁 >1e11 时单次已达数秒,
 * 这类区间只做有限次几何二分并返回已验证 pass 的上界(符合"按 80h 倍数递增到能打过"),
 * 寒铁小的区间则完整二分到相邻整数求精确最小值;超出 MAX_MULTIPLE 视为无解.
 */
function findMinHours (hero: Hero,sec: number): number {
  if (evalHours(hero,sec,BASE_HOURS).check.pass) {return BASE_HOURS;}
  let hi = 16,
lo = 1;
  while (hi <= MAX_MULTIPLE && !evalHours(hero,sec,BASE_HOURS * hi).check.pass) {
    lo = hi;
    hi *= 16;
  }
  if (hi > MAX_MULTIPLE) {return -1;}
  const upperHantie = farmAll(BASE_HOURS * hi,sec).drops["寒铁"] ?? 0;
  const maxIter = upperHantie > 1e11 ? 4 : 100;
  for (let i = 0; i < maxIter && hi - lo > 1; i++) {
    const mid = Math.floor(Math.sqrt(lo) * Math.sqrt(hi));
    if (mid <= lo) {break;}
    if (evalHours(hero,sec,BASE_HOURS * mid).check.pass) {hi = mid;} else {lo = mid;}
  }
  return BASE_HOURS * hi;
}
const fmt = (v: bigint): string => formatSuoXie(Number(v));
const nfmt = (v: number): string => formatSuoXie(v);

// 输出单英灵在某小时数的完整推导(每一项都写清来源).
function logDetail (log: (s?: string) => void,item: {hero: Hero; name: string; sec: number},hours: number,inc: Income,panel: FinalPanel,check: CheckResult): void {
  const {layers} = farmAll(hours,item.sec);
  log(`\n### ${item.name} — ${nfmt(hours)} 小时`);

  // ① 推层
  const layerText = MAP_ORDER.filter(m => layers[m] !== undefined)
    .map(m => `${String(m)}:${nfmt(layers[m]!)}层`)
.join("、");
  const layerSum = Object.values(layers).reduce((s,v) => s + (v ?? 0),0);
  log(`**① 推层**:${layerText};合计 ${nfmt(layerSum)} 层。`);
  log(`  - 总层数 = ⌊${nfmt(hours)}h × 3600 ÷ ${String(item.sec)}秒/层⌋ = ${nfmt(layerSum)};矿洞封顶 1000、遗迹/寒潭/桃园各封顶 1W,余下全推通天塔。`);

  // ② 挂机掉落
  log("**② 挂机掉落**(研究附加 + 5 图掉落表 + 每 1W 层额外,期望闭式):");
  log(`  - ${["钱币","寒铁","灵纹","御灵宝典","强化石","灵晶","历史本纪","御力","神通卷轴","三味真火","忘情水"]
    .map(k => `${k} ${nfmt(inc.farm[k] ?? 0)}`).join("｜")}。`);
  log("  - 每行掉落 = (基础 nums + 期望额外个数) × 品质怪数;概率因幸运 50010 封顶 1000‰(必掉);每 1W 层额外用 floorSum 闭式求和。");

  // ③ 购物正反馈(每个 8h/10h 结算点先购物再结算)
  const sp = inc.shop;
  log(`**③ 冥元宝购物正反馈**:${nfmt(sp.events)} 个结算点(8h 阵营/10h 寻宝并集);先购物升翅膀,再用新翅膀结算本轮。`);
  log(`  - 买 4 种翅膀材料各 ${String(SHOP_WING_NUMS)} 个/组×${nfmt(SHOP_WING_PRICE)}元宝:共 ${nfmt(sp.buyWing)} 组、花 ${nfmt(sp.buyWing * SHOP_WING_PRICE)} → 翅膀1/2/3/4 等级 = [${sp.wing.map(nfmt).join("、")}]。`);
  log(`  - 孟婆汤 ${String(SHOP_MENGPO_NUMS)}个/${nfmt(SHOP_MENGPO_PRICE)}元宝:买 ${nfmt(sp.buyMengpo)} 组,每次仅当持有 < 下次转生需求(转生数+1)×2;已转生 ${String(sp.zhuan)}/${String(ZHUAN_SHENG_MAX)} 次,现持 ${String(sp.mengpo)} 个。`);
  log(`  - 藏宝图 1个/${nfmt(SHOP_CANGBAOTU_PRICE)}元宝:买 ${nfmt(sp.buyCangbaotu)} 个(上限 ${String(CB_TU_CAP)}),每点掉率+1‰;`);
  log(`  - 仙葫药/灵根药固定不买:一轮体力已够开满全 10 层付费格(藏宝图补掉率后每格必掉),买体力无额外掉落提升。`);
  log(`  - 购物合计花 ${nfmt(sp.spentShopping)} 元宝;每轮购物后剩余元宝全投 VIP 池,累计 ${nfmt(sp.vipPool)}。`);
  log(`  - 翅膀收益:翅膀4 寻宝大奖×(100+5×${String(sp.wing[3])})/100 且整份翻倍概率 min(${String(sp.wing[3])},100)%;翅膀3 阵营×(100+5×${String(sp.wing[2])})/100;翅膀2 装备四维每级75+25L;翅膀1 挂机掉元宝累计 ${nfmt(sp.wingYuanbao)}(仅展示)。`);

  // ③ 寻宝
  const xb = inc.xunbaoOne;
  log(`**③b 寻宝**:${nfmt(inc.xunbaoRounds)} 轮(每轮 10h = ${nfmt(hours)}h ÷ 10h),每轮按当时翅膀4/藏宝图等级结算。`);
  log(`  - 每轮体力 = 满 ${String(XB_FULL_TILI)} + 恢复 36000÷300=${String(XB_RECOVER_SECONDS)}秒/点 × (1+2%×min(翅膀4,250)) → 终态 ${xb.totalTili.toFixed(0)} 点。`);
  log(`  - 前 9 层已知大奖最短路径合计 ${xb.advCost.toFixed(1)} 点;余力从第10层往下逐层开满付费格,终态第10层 ${String(xb.block10)} 格、第9层 ${String(xb.block9)} 格。`);
  log(`  - 每格 = 固定 ${nfmt(XB_GRID_FIXED)} × min(1000,权重‰+藏宝图)/1000 × (1+min(翅膀4,100)/100 翻倍期望);终态藏宝图 ${String(sp.cangbaotu)} → 最低权重行掉率 ${Math.min(1000,XB_WEIGHT_MIN + sp.cangbaotu)}‰。`);
  log(`  - 寻宝掉落合计:${Object.entries(inc.xunbao).map(([k,v]) => `${k} ${nfmt(v)}`)
.join("｜")}。`);
  log(`  - 寻宝元宝 = Σ每轮 20488×(100+5×翅膀4)/100×(1+翻倍期望) = ${nfmt(inc.xunbaoYuanbao)}。`);

  // 点卡买卖
  log(`**③c 点卡买卖**(每 1h 一轮,共 ${nfmt(inc.diankaRounds)} 轮):净赚钱币 ${nfmt(inc.dianka)}。`);
  log(`  - 单轮数学期望 = (买入价90万 → 期望卖出价100万×97%手续费 − 90万) × 每单期望5.5张 = (${nfmt(DK_NPC_MEAN)}×0.97 − ${nfmt(DK_BUY)})×5.5 = ${nfmt(DK_PROFIT_PER_ROUND)} 钱币/轮。`);
  log("  - 依据:DianKaSellManager NPC 挂牌价 90万~110万(1万档均匀,均值100万);DianKaSell_Record 成交 97% 进邮件(钱币 80);每单 GetRandomCount=1~10 张期望5.5;市场每60分钟刷新一轮。点卡收益直接计入钱币。");

  // ④ 阵营
  const zy = inc.zhenyingOne;
  log(`**④ 阵营**:${nfmt(inc.zhenyingRounds)} 轮(每轮 8h = ${nfmt(hours)}h ÷ 8h),从头算、不算王者之翼。`);
  log(`  - 积分 = ${String(ZY_TICKS)} 次 × ${String(ZY_RATE)} 分/分 = ${nfmt(zy.score)}(8h 内每 60.1s 加一次,首次差 60.1s)。`);
  log(`  - 第1名奖励 = ${nfmt(zy.score)} × ${String(ZY_RANK1_RATE)}% = ${nfmt(zy.rankReward)};50%分润 = ⌊${nfmt(zy.score)}÷2⌋ × 0.99 = ${nfmt(zy.shareReward)};基础 = ${nfmt(zy.baseReward)}。`);
  log(`  - Round=1 倍率1.1、不算王者之翼;终态翅膀3等级 ${String(sp.wing[2])} → 每轮元宝 = 基础×1.1×(100+5×${String(sp.wing[2])})/100 = ${nfmt(zy.yuanbao)};累计(逐轮按当时翅膀3) = ${nfmt(inc.zhenyingYuanbao)}。`);

  // ⑤ VIP
  const vip = inc.vip;
  log(`**⑤ 元宝升 VIP**:寻宝 ${nfmt(inc.xunbaoYuanbao)} + 阵营 ${nfmt(inc.zhenyingYuanbao)} 元宝,扣购物 ${nfmt(sp.spentShopping)} 后投入 VIP 池 ${nfmt(vip.yuanbao)}。`);
  log(`  - 各级成本 ⌊(1+L/10)×L×60+8⌋(vipLevelUpCost)逐级累加:升到 VIP ${String(vip.level)} 共花 ${nfmt(vip.spent)},剩 ${nfmt(vip.remain)}。`);
  log(`  - VIP 每 2 级 +1 命中/+1 暴击 → 命中/暴击各 +${String(vip.hitCrit)}。`);

  // ⑥ 面板
  log("**⑥ 资源转面板**(calzhanli tozhanli + 闭式):");
  log(`  - 寒铁打造按时间(不再一口气造完):可用 ${nfmt(inc.forgeSeconds)} 秒,单件耗时 min(30, 3+0.2×炼器等级) 秒串行;实际造 ${nfmt(panel.forgeCrafts)} 件、耗寒铁 ${nfmt(panel.forgeHantieUsed)}、炼器 Lv.${nfmt(panel.forgeLevel)}(上限30秒/件 → 每小时120件封顶)。`);
  log(`  - 御灵宝典 ${nfmt(panel.books)} 本 → 御灵 Lv / 突破 ${fmt(panel.breaks)} 次;灵纹 ${nfmt(panel.lingwen)}(含钱币÷1.4 购买) → 天覆阵 ${fmt(panel.zhenLevel)} 级。`);
  log("  - 寒铁→装备、强化石→强化、灵晶→圣兽、历史本纪→转职、神通卷轴→神通、三味真火/忘情水→神兵(默认23件全解锁) 等各按 calzhanli 公式求和;御灵/阵法四维攻 = 125×L(L-1) / 200(Z-1)+35(Z-1)Z/2。");
  log(`  - 基础攻 ${fmt(panel.baseAtk)} = 起点 ${nfmt(BASE.atkFlat)} + tozhanli增攻 + 御灵四维 + 阵法四维;攻击% ${fmt(panel.atkPct)} = 起点 ${BASE.atkPct.toFixed(2)} + 武松20 + 天覆面板15 + 词条。`);

  // ⑦ 突破分配
  log(`**⑦ 突破分配(先幸运5W)**:总突破 ${fmt(panel.breaks)} = 先堆幸运 ${fmt(check.capBreaks)} + 余下(幸运命中 ${fmt(check.luckyBreaks)} / 速度 ${fmt(check.speedBreaks)})。`);
  log(`  - 堆幸运需补 ${fmt(50000n - panel.lucky)} 点(5W − 起点 ${String(BASE.lucky)}),第k次突破增益 2+7k,累计 2n+7n(n+1)/2 → 需 ${fmt(check.capBreaks)} 次;幸运 ${fmt(check.lucky)}(${check.luckyFull ? "已满5W,掉落100%" : "不足5W"})。`);

  // ⑧ 三条件
  log("**⑧ 三条件判定**:");
  log(`  - 命中 ${fmt(check.hit)}${item.hero === "wukong" ? " = 面板 + 武松队唐僧30 + ⌊幸运÷100⌋×5 + VIP" : " = 面板 + 唐僧30 + VIP(基础职业命中不堆幸运)"} → ${check.hitOk ? "100% ✓" : "不足 ✗"}。`);
  log(`  - 速度 ${fmt(check.speed)} = 起点 + Σ速度突破增益(2+7k) vs 敌速 ${fmt(ENEMY_SPEED)} → ${check.speedOk ? "更快 ✓" : "更慢 ✗"}。`);
  log(`  - 伤害 ${fmt(check.damage)} = 基础攻×(100+攻击%+阵法级)/100 × K(敌防−穿透) × 技能命中乘区 × 暴击桶 × (100+伤害加成)/100 × (100−敌减伤)/100 vs 敌HP ${fmt(ENEMY_HP)} → ${check.killOk ? "必杀 ✓" : "不足 ✗"}。`);
  log(`  - **结论:${check.pass ? "可击败终局第5层" : "打不过"}**。`);
}
function main (): void {
  const lines: string[] = [];
  const log = (s = ""): void => {lines.push(s); console.log(s);};
  log("# finalCal — 挂机掉落收益与终局第 5 层判定");
  log("");
  log("## 目录");
  log("1. 计算口径与公式来源");
  log("2. 起点面板(yingling-output 配置,无 2560000 资源)");
  log("3. 80 小时结果(两英灵,逐项推导)");
  log("4. 达到三条件所需时间(逐项推导)");
  log("");
  log("## 1. 计算口径与公式来源");
  log(`- 推层:孙悟空 ${String(WUKONG_SEC)} 秒/层、云霄 ${String(YUNXIAO_SEC)} 秒/层;矿洞 ${nfmt(1000)} 层、遗迹/寒潭/桃园各 1W 层封顶,到顶后剩余时间全推通天塔。`);
  log("- 掉落:研究附加掉落 + 5 图掉落表 + 每 1W 层额外掉落;幸运 50010 使每行概率封顶 1000‰(必掉),额外个数用 floorSum 闭式求和。");
  log("- 时间循环:逐事件点推进,每 8h 阵营、每 10h 寻宝(并集去重);每个结算点先购物再结算,购物立即升级翅膀,后续结算用新等级形成正反馈;点卡每 1h 一轮。打造与推层并行。");
  log("- 购物正反馈:元宝先买 4 种翅膀材料(各2个/48888,无封顶一直买)+孟婆汤(2个/46888,够转生不买)+藏宝图(1个/25888,974个补满掉率100%);仙葫药/灵根药因体力已够开满全10层不买;剩余元宝才升 VIP。");
  log("- 翅膀收益:翅膀4 寻宝大奖 +5%/级(无封顶)+整份翻倍概率=等级%封顶100+体力恢复2%/级;翅膀3 阵营元宝 +5%/级(无封顶);翅膀2 装备四维 75+25L/级;翅膀1 挂机掉元宝。买了即用新等级结算,越来越多。");
  log("- 寻宝:每格 = 固定256万 × min(1000,权重‰+藏宝图)/1000 × (1+min(翅膀4,100)/100 翻倍);体力满150+恢复(×翅膀4加速),前9层知大奖走最短路径,余力从第10层往下开满;每轮元宝大奖 20488×(100+5×翅膀4)/100。");
  log("- 阵营:一轮 8h,从头算第1名奖励(25%)+50%分润×0.99,Round=1 倍率1.1,不算王者之翼,再×(100+5×翅膀3)/100。");
  log("- 点卡:每 1h 一轮低买高卖,数学期望 (90万买 → 100万×97%卖 − 90万)×每单5.5张 = 38.5万钱币/轮,直接进钱币;神兵默认 23 件全解锁。");
  log("- 元宝:购物后剩余元宝全升 VIP(vipLevelUpCost),每 2 级 +1 命中/+1 暴击。");
  log("- 寒铁打造:按时间串行,单件 min(30秒, 3+0.2×炼器等级) 秒,时间用完即停,不再一口气全转;其余资源按 calzhanli tozhanli + 御灵/阵法四维闭式,套 composite-compare BigInt 伤害公式。");
  log("- 突破:先堆幸运到 5W(确保掉落100%),余下孙悟空先补速度再幸运、云霄全速度。");
  log("- 三条件:命中 100% + 速度更快 + 一击必杀(伤害≥敌 HP)。");
  log("");
  log("## 2. 起点面板(yingling-output 配置,无 2560000 资源)");
  log(`基础攻击 ${nfmt(BASE.atkFlat)}｜攻击% ${BASE.atkPct.toFixed(2)}｜命中 ${String(BASE.hit)}｜幸运 ${String(BASE.lucky)}｜速度 ${String(BASE.speed)}｜穿透 ${nfmt(BASE.penetration)}｜VIP ${String(BASE.vipLevel)}。`);
  log("说明:resource=0 去掉寻宝第 10 层每格 2,560,000 白送资源(这些已由第③步寻宝按轮重新计入);兑换码/通关点数永久属性/研究/15 级御灵装备等配置按 yingling-output 原样保留。");
  log("");
  log("## 3. 80 小时结果(两英灵,逐项推导)");
  for (const item of HEROES) {
    const inc = income(BASE_HOURS,item.sec);
    const {check,panel} = evalHours(item.hero,item.sec,BASE_HOURS);
    logDetail(log,item,BASE_HOURS,inc,panel,check);
  }
  log("");
  log("## 4. 达到三条件所需时间(逐项推导)");
  for (const item of HEROES) {
    const hours = findMinHours(item.hero,item.sec);
    if (hours < 0) {
      log(`\n### ${item.name}:80 小时倍数递增到 ${nfmt(BASE_HOURS * MAX_MULTIPLE)} 小时仍打不过。`);
      continue;
    }
    const inc = income(hours,item.sec);
    const {check,panel} = evalHours(item.hero,item.sec,hours);
    logDetail(log,item,hours,inc,panel,check);
  }
  writeFileSync(new URL("../output/finalCal.md",import.meta.url),`${lines.join("\n")}\n`,"utf8");
  console.log("\n[已写出] output/finalCal.md");
}
if (process.argv[1] === import.meta.filename) {main();}

// #endregion