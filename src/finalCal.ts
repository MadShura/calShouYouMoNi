/**
 * finalCal.ts — 挂机掉落收益 → 面板 → 终局第 5 层三条件判定.
 *
 * 口径(与 composite-compare / yingling-output 同源):
 * - 起点面板 = yingling-output 的 buildResourcePanel,但 resource=0(没有寻宝第 10 层每格 2,560,000 的白送资源),
 *   兑换码/通关点数永久属性/研究/15 级御灵装备等"配置"部分照留(见 RESOURCE=0 说明).
 * - 推层:孙悟空怒气 1.1 秒/层、云霄普攻 0.85 秒/层;矿洞封顶 1000 层,遗迹/寒潭/桃园各封顶 1W 层,
 *   前面的层数到了就转通天塔,最后一直通天塔(共享时间预算).
 * - 掉落:研究附加掉落(KeJiDrop:87/80/9/1/7/18/84/86/900+ID)与地图掉落表(MAPS)全部计入;
 *   幸运 50010 + 掉率研究使所有掉落表行概率封顶 1000‰,故每行按 (nums + 期望额外个数) 确定性结算;
 *   每 1W 层的额外掉落(getExpectedExtraCount:roundTier>=2 时 (tier-1)/100)按期望计算,用闭式 floorSum 求和,
 *   不逐波循环,避免大层数卡死.
 * - 资源转面板:全部资源按 calzhanli 的 tozhanli 公式转成面板增量(寒铁/灵纹/御灵宝典/钱币/强化石/灵晶/
 *   历史本纪/五彩/破境石/神通卷轴/三味真火/忘情水),再套 composite-compare 的 BigInt 伤害公式.
 * - 御灵突破:先留最少突破补速度(>敌速),余下全给幸运(孙悟空走 唐三藏30+⌊幸运/100⌋×5 命中链;
 *   云霄基础职业命中不走幸运,全突破给速度).
 * - 三条件:命中 100% + 一击必杀(伤害≥敌 HP) + 速度更快,与 composite-compare 完全一致.
 * - 时间搜索:从 80 小时起按 16 倍翻倍圈定区间,再几何二分找最小能打过的倍数;
 *   寒铁大(逐级模拟极慢)时只做有限次二分并返回已验证能打过的上界,结果写 output/finalCal.md.
 *
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
// #endregion

// #region 闭式工具
/** Σ_{i=0}^{n-1} floor((a*i+b)/m),AtCoder floor_sum(BigInt 版);a,b>=0,m>0. */
function floorSum (n: bigint,m: bigint,a: bigint,b: bigint): bigint {
  let ans = 0n;
  let nn = n,mm = m,aa = a,bb = b;
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

/** BigInt 版 CulDamagePercent(Damage_Recorder.cs:138-161),整除向零截断. */
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

/** 前 n 次突破的累计增益:Σ(2+7k)=2n+7n(n+1)/2. */
const sumGain = (n: bigint): bigint => (n <= 0n ? 0n : 2n * n + 7n * n * (n + 1n) / 2n);

/** 达到某累计增益所需最少突破次数. */
function minBreaksForGain (gain: bigint): bigint {
  if (gain <= 0n) {return 0n;}
  let hi = 1n,lo = 0n;
  while (sumGain(hi) < gain) {hi *= 2n;}
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    if (sumGain(mid) >= gain) {hi = mid;} else {lo = mid + 1n;}
  }
  return lo;
}

/** 御灵宝典本数 → 御灵等级/四维攻/突破次数(等价 composite-compare:yulingLevel). */
function yuCumNeed (level: bigint): bigint {
  if (level <= 1n) {return 0n;}
  const last = level - 1n,rem = last % 10n,tens = last / 10n;
  const full = 100n * (10n * tens * (tens - 1n) * (2n * tens - 1n) / 6n
    + 19n * tens * (tens - 1n) / 2n + 9n * tens);
  const partial = 20n * (tens + 1n) * (5n * tens * (rem + 1n) + rem * (rem + 1n) / 2n);
  return full + partial;
}
function yulingLevel (books: bigint): {atk: bigint; breaks: bigint; level: bigint} {
  const exp = 200n * books;
  let hi = 2n,lo = 1n;
  while (yuCumNeed(hi) <= exp) {hi *= 2n;}
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if (yuCumNeed(mid) <= exp) {lo = mid;} else {hi = mid - 1n;}
  }
  return {atk: 125n * lo * (lo - 1n),breaks: lo / 10n,level: lo};
}

/** 灵纹 → 天覆阵等级/四维攻增量(等价 composite-compare:zhenLevel). */
function zhenLevel (lingwen: bigint): {atk: bigint; level: bigint} {
  const approx = (1 + Math.sqrt(1 + 0.8 * Number(lingwen))) / 2;
  let level = BigInt(Math.max(1,Math.floor(approx)));
  if (level < 1n) {level = 1n;}
  while (level > 1n && 5n * level * (level - 1n) > lingwen) {level--;}
  while (5n * (level + 1n) * level <= lingwen) {level++;}
  return {atk: 200n * (level - 1n) + 35n * (level - 1n) * level / 2n,level};
}
// #endregion

// #region 期望掉落(闭式)
type DropMap = Record<string,number>;
const add = (drops: DropMap,key: string,value: number): void => {
  if (value > 0) {drops[key] = (drops[key] ?? 0) + value;}
};

/** 余数 a 在 1..n 中出现的次数(a=0 表示 5/10/...). */
function residueCount (n: number,a: number): number {
  if (n <= 0) {return 0;}
  return a === 0 ? Math.floor(n / 5) : (n >= a ? Math.floor((n - a) / 5) + 1 : 0);
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
  for (let a = 0;a < 5;a++) {
    const cnt = residueCount(n,a);
    if (cnt <= 0) {continue;}
    const wave = WAVE_COUNT[a] as readonly [number,number,number];
    const t0 = Math.max(0,Math.ceil((EXTRA_TIER_START + 1 - a) / 5));
    const extraCnt = cnt - t0;
    for (let p = 1;p <= 3;p++) {
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
  for (let p = 1;p <= 3;p++) {
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

/** 按"前面层数到了就转通天塔"分配时间,返回每层地图的掉落与层数. */
function farmAll (hours: number,secondsPerLayer: number): {layers: Partial<Record<MapID,number>>; drops: DropMap} {
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
  return {layers,drops};
}
// #endregion

// #region 面板
interface FinalPanel {
  baseAtk: bigint;
  atkPct: bigint;
  pen: bigint;
  hitFlat: bigint;
  lucky: bigint;
  speed: bigint;
  dmgAdd: bigint;
  crit: bigint;
  critDamage: bigint;
  zhenLevel: bigint;
  breaks: bigint;
  extraAtk:    number;
  extraPen:    number;
  extraAtkPct: number;
  extraDmgAdd: number;
  extraHit:    number;
  extraSpeed:  number;
  extraCrit:   number;
  extraCritDamage: number;
  books:  number;
  lingwen: number;
}

const numOf = (drops: DropMap,key: string): number => Math.floor(drops[key] ?? 0);

/** 起点面板:yingling-output 配置,但没有 2,560,000 的资源. */
const BASE_ARGS: CliArgs = new Map([
  ["resource","0"],["yuanbao","0"],["lingwen","0"],["zhenfa-level","1"],["yuanbao-mode","vip"]
]);
const BASE = buildResourcePanel(BASE_ARGS);

/** 把 drops 全部按 calzhanli tozhanli 转成面板增量(缓存:同一份 drops 只算一次). */
const PANEL_CACHE = new Map<string,FinalPanel>();
function panelFromDrops (drops: DropMap): FinalPanel {
  const books = numOf(drops,"御灵宝典");
  const money = numOf(drops,"钱币");
  // 钱币按 yingling-output 口径先买灵纹(研究44 -30% → 1.4 钱币/灵纹),钱与灵纹不重复计价.
  const lingwen = numOf(drops,"灵纹") + Math.floor(money / 1.4);
  const key = `${String(books)}|${String(lingwen)}|${String(numOf(drops,"寒铁"))}|${String(numOf(drops,"强化石"))}|${String(numOf(drops,"灵晶"))}|${String(numOf(drops,"历史本纪"))}|${String(numOf(drops,"五彩神石"))}|${String(numOf(drops,"破境石"))}|${String(numOf(drops,"神通卷轴"))}|${String(numOf(drops,"三味真火"))}|${String(numOf(drops,"忘情水"))}`;
  const hit = PANEL_CACHE.get(key);
  if (hit !== undefined) {return hit;}

  const yu = yulingLevel(BigInt(books));
  const zhen = zhenLevel(BigInt(lingwen));
  let extraAtk = 0,extraPen = 0,extraAtkPct = 0,extraDmgAdd = 0;
  let extraHit = 0,extraSpeed = 0,extraCrit = 0,extraCritDamage = 0;
  const take = (r: Partial<Record<"atk" | "ignoreDef" | "atkPercent" | "damageAddition" |
    "mingZhong" | "speed" | "baoJi" | "baoJiDamage",number>>): void => {
    extraAtk += r.atk ?? 0;
    extraPen += r.ignoreDef ?? 0;
    extraAtkPct += r.atkPercent ?? 0;
    extraDmgAdd += r.damageAddition ?? 0;
    extraHit += r.mingZhong ?? 0;
    extraSpeed += r.speed ?? 0;
    extraCrit += r.baoJi ?? 0;
    extraCritDamage += r.baoJiDamage ?? 0;
  };
  take(hantieTozhanli(numOf(drops,"寒铁"),0));
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
    baseAtk:         BigInt(Math.round(BASE.atkFlat + extraAtk)) + yu.atk + zhen.atk,
    atkPct:          BigInt(Math.round(BASE.atkPct + WU_SONG_ATK + TIANFU_PANEL + extraAtkPct)),
    pen:             BigInt(Math.round(BASE.penetration + extraPen)),
    hitFlat:         BigInt(Math.round(BASE.hit + TANG_HIT + extraHit)),
    lucky:           BigInt(Math.round(BASE.lucky)),
    speed:           BigInt(Math.round(BASE.speed + extraSpeed)),
    dmgAdd:          BigInt(Math.round(BASE.damageAddition + WU_SONG_DMG + extraDmgAdd)),
    crit:            BigInt(Math.round(BASE.crit + extraCrit)),
    critDamage:      BigInt(Math.round(BASE.critDamage + extraCritDamage)),
    zhenLevel:       zhen.level,
    breaks:          yu.breaks,
    extraAtk,extraPen,extraAtkPct,extraDmgAdd,extraHit,extraSpeed,extraCrit,extraCritDamage,
    books,lingwen
  };
  PANEL_CACHE.set(key,panel);
  return panel;
}
// #endregion

// #region 伤害与三条件
type Hero = "wukong" | "yunxiao";
interface CheckResult {
  damage: bigint;
  hit: bigint;
  speed: bigint;
  luckyBreaks: bigint;
  speedBreaks: bigint;
  hitOk: boolean;
  speedOk: boolean;
  killOk: boolean;
  pass: boolean;
}

/** 速度更快需要的最少突破(起点速度 + 其它速度增量后仍需补的部分). */
function speedBreaksNeeded (baseSpeed: bigint): bigint {
  return minBreaksForGain(ENEMY_SPEED + 1n - baseSpeed);
}

/** 按 composite-compare 伤害公式 + 英灵专属乘区算单次输出与三条件. */
function evaluate (panel: FinalPanel,hero: Hero): CheckResult {
  const needSpeed = speedBreaksNeeded(panel.speed);
  let luckyBreaks: bigint,speedBreaks: bigint,lucky: bigint,speed: bigint;
  if (hero === "wukong") {
    speedBreaks = needSpeed;
    luckyBreaks = panel.breaks > speedBreaks ? panel.breaks - speedBreaks : 0n;
    lucky = panel.lucky + sumGain(luckyBreaks);
    speed = panel.speed + sumGain(speedBreaks);
  } else {
    speedBreaks = panel.breaks;
    luckyBreaks = 0n;
    lucky = panel.lucky;
    speed = panel.speed + sumGain(speedBreaks);
  }
  const hit = panel.hitFlat + (hero === "wukong" ? lucky / 100n * 5n : 0n);

  // 百分比乘区(定点 1e6):孙悟空 = skill78 × 神通15 × 西行Lv3;云霄 = 0.8 × 后羿弓0.8 × 神通27 × 神通15 × 西行Lv2 × 神通20.
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

  const hitOk = hero === "wukong" ? hitRate(Number(hit),ENEMY_5.dodge) >= 1 : true;
  const speedOk = speed > ENEMY_SPEED;
  const killOk = damage >= ENEMY_HP;
  return {damage,hit,speed,luckyBreaks,speedBreaks,hitOk,speedOk,killOk,
    pass: hitOk && speedOk && killOk};
}
// #endregion

// #region 时间搜索与输出
interface Row {
  hero: Hero;
  name: string;
  secondsPerLayer: number;
  hours: number;
  multiple: number;
  layers: Partial<Record<MapID,number>>;
  drops: DropMap;
  panel: FinalPanel;
  check: CheckResult;
}

const HEROES: readonly {hero: Hero; name: string; sec: number}[] = [
  {hero: "wukong",name: "孙悟空(神·人皇印)+天覆阵",sec: WUKONG_SEC},
  {hero: "yunxiao",name: "云霄娘娘(基础·普攻80%)+天覆阵",sec: YUNXIAO_SEC}
];

const EVAL_CACHE = new Map<string,{panel: FinalPanel; check: CheckResult}>();
function evalHours (hero: Hero,sec: number,hours: number): {panel: FinalPanel; check: CheckResult} {
  const key = `${String(hero)}|${String(hours)}`;
  const cached = EVAL_CACHE.get(key);
  if (cached !== undefined) {return cached;}
  const {drops} = farmAll(hours,sec);
  const panel = panelFromDrops(drops);
  const check = evaluate(panel,hero);
  const result = {panel,check};
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
  let lo = 1,hi = 16;
  while (hi <= MAX_MULTIPLE && !evalHours(hero,sec,BASE_HOURS * hi).check.pass) {
    lo = hi;
    hi *= 16;
  }
  if (hi > MAX_MULTIPLE) {return -1;}
  const upperHantie = farmAll(BASE_HOURS * hi,sec).drops["寒铁"] ?? 0;
  const maxIter = upperHantie > 1e11 ? 4 : 100;
  for (let i = 0;i < maxIter && hi - lo > 1;i++) {
    const mid = Math.floor(Math.sqrt(lo) * Math.sqrt(hi));
    if (mid <= lo) {break;}
    if (evalHours(hero,sec,BASE_HOURS * mid).check.pass) {hi = mid;} else {lo = mid;}
  }
  return BASE_HOURS * hi;
}

const fmt = (v: bigint): string => formatSuoXie(Number(v));

function main (): void {
  const lines: string[] = [];
  const log = (s = ""): void => {lines.push(s);console.log(s);};
  log("# finalCal — 挂机掉落收益与终局第 5 层判定");
  log("");
  log("## 目录");
  log("1. 计算口径");
  log("2. 起点面板(yingling-output 配置,无 2560000 资源)");
  log("3. 80 小时结果(两英灵)");
  log("4. 达到三条件所需时间");
  log("");
  log("## 1. 计算口径");
  log(`- 推层:孙悟空 ${String(WUKONG_SEC)} 秒/层,云霄 ${String(YUNXIAO_SEC)} 秒/层;矿洞 ${formatSuoXie(1000)} 层、遗迹/寒潭/桃园各 1W 层封顶,到顶后剩余时间全推通天塔。`);
  log("- 掉落:研究附加掉落 + 5 图掉落表全部计入;幸运 50010 使掉落概率封顶,每行按 (nums+期望额外个数) 结算;每 1W 层额外掉落按期望闭式求和。");
  log("- 资源转面板:全部资源按 calzhanli tozhanli 公式转增量(钱币按 1.4/灵纹先买灵纹),再套 composite-compare BigInt 伤害公式。");
  log("- 三条件:命中 100% + 速度更快 + 一击必杀(伤害≥敌 HP)。");
  log("");
  log("## 2. 起点面板(yingling-output 配置,无 2560000 资源)");
  log(`基础攻击 ${formatSuoXie(BASE.atkFlat)}｜攻击% ${BASE.atkPct.toFixed(2)}｜命中 ${String(BASE.hit)}｜幸运 ${String(BASE.lucky)}｜穿透 ${formatSuoXie(BASE.penetration)}｜VIP ${String(BASE.vipLevel)}。`);
  log("说明:resource=0 去掉寻宝第 10 层每格 2,560,000 白送资源;兑换码/通关点数永久属性/研究/15 级御灵装备等配置按 yingling-output 原样保留。");
  log("");

  const results: Row[] = [];
  log("## 3. 80 小时结果(两英灵)");
  for (const item of HEROES) {
    const {drops} = farmAll(BASE_HOURS,item.sec);
    const {layers} = farmAll(BASE_HOURS,item.sec);
    const {panel,check} = evalHours(item.hero,item.sec,BASE_HOURS);
    results.push({hero: item.hero,name: item.name,secondsPerLayer: item.sec,hours: BASE_HOURS,
      multiple: 1,layers,drops,panel,check});
    log(`\n### ${item.name}`);
    const layerText = MAP_ORDER.filter(m => layers[m] !== undefined)
      .map(m => `${String(m)}:${formatSuoXie(layers[m]!)}层`).join("、");
    log(`推层:${layerText};层数合计 ${formatSuoXie(Object.values(layers).reduce((s,v) => s + (v ?? 0),0))} 层。`);
    log(`掉落:${["钱币","寒铁","灵纹","御灵宝典","强化石","灵晶","历史本纪","御力","神通卷轴","三味真火","忘情水"]
      .map(k => `${k} ${formatSuoXie(drops[k] ?? 0)}`).join("｜")}。`);
    log(`面板:御灵宝典 ${formatSuoXie(panel.books)} 本、灵纹 ${formatSuoXie(panel.lingwen)} 个、突破 ${formatSuoXie(Number(panel.breaks))} 次;基础攻 ${fmt(panel.baseAtk)}、攻击% ${fmt(panel.atkPct)}、阵法 ${fmt(panel.zhenLevel)} 级、穿透 ${fmt(panel.pen)}。`);
    log(`三条件:命中 ${fmt(check.hit)}(${check.hitOk ? "100%" : "不足"})｜速度 ${fmt(check.speed)}>敌速 ${fmt(ENEMY_SPEED)}(${check.speedOk ? "✓" : "✗"})｜伤害 ${fmt(check.damage)}≥敌HP ${fmt(ENEMY_HP)}(${check.killOk ? "✓" : "✗"}) → ${check.pass ? "可击败" : "打不过"}。`);
  }
  log("");

  log("## 4. 达到三条件所需时间");
  for (const item of HEROES) {
    const hours = findMinHours(item.hero,item.sec);
    if (hours < 0) {
      log(`- ${item.name}:80 小时倍数递增到 ${formatSuoXie(BASE_HOURS * MAX_MULTIPLE)} 小时仍打不过。`);
      continue;
    }
    const {drops} = farmAll(hours,item.sec);
    const {panel,check} = evalHours(item.hero,item.sec,hours);
    log(`- ${item.name}:最小 ${formatSuoXie(hours)} 小时(${(hours / BASE_HOURS).toFixed(0)} × 80h)。
  - 资源:${["钱币","寒铁","灵纹","御灵宝典","强化石","灵晶","历史本纪","御力"]
    .map(k => `${k} ${formatSuoXie(drops[k] ?? 0)}`).join("｜")}。`);
    log(`  - 面板:御灵宝典 ${formatSuoXie(panel.books)} 本、灵纹 ${formatSuoXie(panel.lingwen)} 个、突破 ${formatSuoXie(Number(panel.breaks))} 次(补速度 ${fmt(check.speedBreaks)} / 幸运 ${fmt(check.luckyBreaks)})。`);
    log(`  - 三条件:命中 ${fmt(check.hit)}｜速度 ${fmt(check.speed)}｜伤害 ${fmt(check.damage)} → 全部达标。`);
  }

  writeFileSync(new URL("../output/finalCal.md",import.meta.url),`${lines.join("\n")}\n`,"utf8");
  console.log("\n[已写出] output/finalCal.md");
}
if (process.argv[1] === import.meta.filename) {main();}
// #endregion
