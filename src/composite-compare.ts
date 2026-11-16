/**
 * composite-compare.ts — 反推金币:求满足「命中100% + 一击必杀 + 速度更快」的最小钱币.
 * 全程 BigInt 精确计算(金币/本数/御力/门槛/攻击/伤害均可能超 2^53,Number 会丢精度).
 * 只算两种方案(从零面板,不读存档,队伍加成照人皇印队保留):
 * ① 全速度+鸟翔阵(补命中):先分配最少突破选幸运把命中补到100%,其余突破全速度给鸟翔;
 * ② 全幸运+天覆阵(补速度):先分配最少突破选速度超过敌速,其余突破全幸运走命中增伤链.
 * 金币拆两部分:御灵宝典(御灵等级→四维攻/穿透 + 每10级突破选幸运/速度)
 * + 灵纹升阵法(天覆阵:面板攻+15%与战斗期+阵法等级%攻击;鸟翔阵:四维攻/穿透).
 * 目标终局第 5 层(ENEMY_5);命中率用 hitRate 判定,必须 =100%.
 * 运行:pnpm --config.verify-deps-before-run=false exec tsx src/composite-compare.ts
 */
import {writeFileSync} from "node:fs";
import {MATERIAL_COST_PER_UNIT} from "./data.ts";
import {formatSuoXie} from "./readSave.ts";
import {hitRate} from "./scripts/enemy-stats.ts";
import {ENEMY_5} from "./zhanli-panel.ts";

// 口径(全部来自反编译源码,见 src/反编译):
// - 御灵宝典每本 100 御力 × 研究48 +100% = 200;御灵升级门槛 CulLevel_Up_Remand =
// 100×⌊L/10⌋×(⌊L/10⌋+1)+20×(⌊L/10⌋+1)×(L%10),每级四维各 +L×250;
// 每满 10 级突破一次,第 k 次幸运/速度增益 = 2+⌊4k×1.75⌋ = 2+7k(pinZhi=4),前 n 次累计 sumGain(n).
// - 阵法每级消耗 ⌊L×20×(100-研究26 50)/100⌋ = 10L 灵纹,每级四维各 +(200+35L);
// 天覆阵面板攻击 +15%(PercentAddition)与战斗期 +阵法等级% 攻击(Entry_ZhenFa_1.cs:18-26,同一个攻击%桶);
// 鸟翔阵无面板攻击加成,速度差 min(我方-敌方,2147483646) 进伤害加成桶(Entry_ZhenFa_8.cs:30-41).
// - 命中 = 唐三藏 30 + ⌊幸运/100⌋×5(Entry_Skill_1051.cs,BigInteger 整除,无上限);
// 命中率 = hitRate(命中, 敌闪避),必须 =100%.
// - 命中喂三条独立乘区(都进 PercentAddition,各自 (100+p)/100):孙悟空3技能 +(int)命中,
// 神通15 夹到 2147483637,西行取经 Lv.3 max(0,命中-敌闪避+猪八戒20)×1.0.
// - 人皇印队含武松:攻击桶 +20%,伤害加成桶 +35;唐三藏 +30 命中;猪八戒 -20 敌闪避;
// 一击必杀 = 伤害 ≥ 敌 HP(源码 Damage_Recorder.cs:55-99,全 BigInteger 整除向零截断).
// 金币单位放大 10 倍(单位=0.1钱币),使单价成整数:御灵宝典 52.5→525,灵纹 1.4→14.
const SCALE = 10n;
const BOOK_COST = BigInt(Math.round(MATERIAL_COST_PER_UNIT["御灵宝典"]! * 10));  // 525 (0.1钱币)
const LINGWEN_COST = BigInt(Math.round(MATERIAL_COST_PER_UNIT["灵纹"]! * 10));     // 14
const WUKONG_TANG_HIT = 30n;
const WUKONG_ZHU_DODGE_DOWN = 20n;
const XI_XING_LV3_RATE = 1n;   // (0.25+0.25×3)=1.0
const SHEN_TONG_15_CAP = 21_4748_3637n;
const WU_SONG_ATK_PERCENT = 20n;
const WU_SONG_DAMAGE_ADD = 35n;
const TIANFU_PANEL_ATK = 15n;
const BIRD_DAMAGE_CAP = 21_4748_3646n;
const MAX_COIN = 10n ** 21n;         // 1e20 钱币 ×10
const HIT_SCALE = 100_0000n;   // 命中链乘区定点小数放大 1e6
const ENEMY_DEF = BigInt(Math.round(ENEMY_5.def));   // config JSON 已是 double,取整数基准
const ENEMY_HP = BigInt(Math.round(ENEMY_5.hp));
const ENEMY_DODGE = BigInt(ENEMY_5.dodge);
const ENEMY_SPEED = BigInt(ENEMY_5.speed);
const ENEMY_REDUCE = BigInt(ENEMY_5.damageReduce > 80 ? 80 : ENEMY_5.damageReduce);

// 前 n 次突破累计增益:Σ(2+7k) = 2n + 7n(n+1)/2.
const sumGain = (n: bigint): bigint => (n <= 0n ? 0n : 2n * n + 7n * n * (n + 1n) / 2n);

// 命中 = 唐三藏 30 + ⌊幸运/100⌋×5.
const hitOf = (lucky: bigint): bigint => WUKONG_TANG_HIT + lucky / 100n * 5n;

// 命中率是否 100%(源码 (100+命中-闪避+1)/101≥1 ⇔ 命中≥闪避);值域小用 number 包装 hitRate 判定.
const fullHit = (hit: bigint): boolean => hitRate(Number(hit),ENEMY_5.dodge) >= 1;

// 御灵宝典本数 → 御灵等级/四维攻击/突破次数(等价 calzhanli.ts:yulingbaodianTozhanli).
// 逐级御力门槛闭式:前 N 级门槛之和 = 完整十级组 + 当前十级组部分(BigInt 整除).
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

// 灵纹 → 阵法等级/四维攻击增量(等价 calzhanli.ts:lingwenLevelUp).
// 累计灵纹 = Σ10L = 5Z(Z-1),四维攻击 = Σ(200+35L) = 200(Z-1)+35(Z-1)Z/2.
// 初值用 number 开方估计(仅作起点,后续 BigInt 校正到精确),不参与结果计算.
function zhenLevel (lingwen: bigint): {atk: bigint; level: bigint} {
  let level = BigInt(Math.max(1,Math.floor((1 + Math.sqrt(1 + 0.8 * Number(lingwen))) / 2)));
  if (level < 1n) {level = 1n;}
  while (level > 1n && 5n * level * (level - 1n) > lingwen) {level--;}
  while (5n * (level + 1n) * level <= lingwen) {level++;}
  return {atk: 200n * (level - 1n) + 35n * (level - 1n) * level / 2n,level};
}

// 命中100%所需最小幸运(BigInt 步进100,用 hitRate 判定).
let luckyForFullHit = 0n;
for (let lucky = 0n; lucky <= 1_0000_0000n; lucky += 100n) {
  if (fullHit(hitOf(lucky))) {luckyForFullHit = lucky; break;}
}

// 达到某累计增益所需的最小突破次数.
function minBreaksForGain (gain: bigint): bigint {
  let hi = 1n,
lo = 0n;
  while (sumGain(hi) < gain) {hi *= 2n;}
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    if (sumGain(mid) >= gain) {hi = mid;} else {lo = mid + 1n;}
  }
  return lo;
}
const BIRD_HIT_BREAKS = minBreaksForGain(luckyForFullHit);
const TIANFU_SPEED_BREAKS = minBreaksForGain(ENEMY_SPEED + 1n);

// 买满若干突破所需的最小御灵宝典花费(单位 0.1钱币).
function minBookCostForBreaks (breaks: bigint): bigint {
  let hi = 100_0000n,
lo = 1n;
  while (yulingLevel(hi).breaks < breaks) {hi *= 2n;}
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    if (yulingLevel(mid).breaks >= breaks) {hi = mid;} else {lo = mid + 1n;}
  }
  return lo * BOOK_COST;
}

// 天覆补速度:剩余幸运也要达命中门槛,求最小总突破数.
function minTotalBreaksTianfu (): bigint {
  let hi = TIANFU_SPEED_BREAKS * 2n,
lo = TIANFU_SPEED_BREAKS;
  const ok = (total: bigint): boolean => sumGain(total) - sumGain(TIANFU_SPEED_BREAKS) >= luckyForFullHit;
  while (!ok(hi)) {hi *= 2n;}
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    if (ok(mid)) {hi = mid;} else {lo = mid + 1n;}
  }
  return lo;
}
const MIN_BOOK_BIRD = minBookCostForBreaks(BIRD_HIT_BREAKS + TIANFU_SPEED_BREAKS);
const MIN_BOOK_TIANFU = minBookCostForBreaks(minTotalBreaksTianfu());
interface ReverseRow {
  atkPct:          bigint;        // 攻击%加成
  baseAtk:         bigint;
  books:           bigint;
  coin:            bigint;        // 总金币(单位 0.1钱币);-1n 表示无解
  coinBook:        bigint;
  coinZhen:        bigint;
  damage:          bigint;
  dmgAdd:          bigint;
  feasible:        boolean;
  hit:             bigint;
  hitRateValue:    number;        // 命中率比率 0..1(值域小,用 number)
  lingwen:         bigint;
  lucky:           bigint;
  name:            string;
  pctBucketScaled: bigint;        // 命中链乘区 ×HIT_SCALE(定点)
  pen:             bigint;
  shortBreaks:     bigint;
  speed:           bigint;
  totalBreaks:     bigint;
  yuLevel:         bigint;
  zhenAtk:         bigint;
  zhenLevel:       bigint;
  zhenSpeedDmg:    bigint;
}

// 源码 CulDamagePercent(Damage_Recorder.cs:138-161)的 BigInt 版,整除向零截断.
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
const zeroRow = (coinBook: bigint,coinZhen: bigint,yu: {atk: bigint; breaks: bigint; level: bigint},
  zhen: {atk: bigint; level: bigint}): Omit<ReverseRow,"name"> => ({
  atkPct:          0n,
baseAtk:         yu.atk + zhen.atk,
books:           coinBook / BOOK_COST,
coin:            coinBook + coinZhen,
coinBook,
coinZhen,
  damage:          0n,
dmgAdd:          0n,
feasible:        false,
hit:             0n,
hitRateValue:    0,
lingwen:         coinZhen / LINGWEN_COST,
lucky:           0n,
  pctBucketScaled: 0n,
pen:             yu.atk + zhen.atk,
shortBreaks:     -1n,
speed:           0n,
totalBreaks:     yu.breaks,
yuLevel:         yu.level,
  zhenAtk:         zhen.atk,
zhenLevel:       zhen.level,
zhenSpeedDmg:    0n
});

// 反推满足三条件的最小总金币(单位 0.1钱币);无解则 coin=-1n.
export function reverseWukongCoin (bird: boolean): ReverseRow {
  const name = bird ? "全速度+鸟翔阵(补命中)" : "全幸运+天覆阵(补速度)";
  const maxRow = bestSplitForCoin(bird,MAX_COIN);
  if (!maxRow.feasible) {return {name,...maxRow,coin: -1n};}
  let lo = bird ? MIN_BOOK_BIRD : MIN_BOOK_TIANFU;
  let hi = MAX_COIN;

  // BigInt 二分:金币越多越容易达标(feasible 单调),while(lo<hi) 精确终止,无需浮点补丁.
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    if (bestSplitForCoin(bird,mid).feasible) {hi = mid;} else {lo = mid + 1n;}
  }
  return {name,...bestSplitForCoin(bird,hi)};
}

// 给定总金币,整数三分搜索找伤害最大的御灵宝典/灵纹拆分(伤害关于拆分单峰).
function bestSplitForCoin (bird: boolean,coin: bigint): Omit<ReverseRow,"name"> {
  const minBook = bird ? MIN_BOOK_BIRD : MIN_BOOK_TIANFU;
  let hi = coin,
lo = minBook;
  for (let i = 0; i < 200; i++) {
    const third = (hi - lo) / 3n;
    const m1 = lo + third,
m2 = hi - third;
    if (m1 <= lo || m2 >= hi) {break;}
    if (evalSplit(bird,m1,coin - m1).damage < evalSplit(bird,m2,coin - m2).damage) {lo = m1;} else {hi = m2;}
  }
  const coinBook = (lo + hi) / 2n;
  return evalSplit(bird,coinBook,coin - coinBook);
}

// 给定拆分与方案算三条件与伤害.bird=true 鸟翔(补命中),false 天覆(补速度).
function evalSplit (bird: boolean,coinBook: bigint,coinZhen: bigint): Omit<ReverseRow,"name"> {
  const books = coinBook / BOOK_COST;
  const yu = yulingLevel(books);
  const zhen = zhenLevel(coinZhen / LINGWEN_COST);
  const totalBreaks = yu.breaks;
  let lucky: bigint,shortBreaks: bigint,speed: bigint;
  if (bird) {
    if (totalBreaks < BIRD_HIT_BREAKS + TIANFU_SPEED_BREAKS) {return zeroRow(coinBook,coinZhen,yu,zhen);}
    shortBreaks = BIRD_HIT_BREAKS;
    lucky = sumGain(shortBreaks);
    speed = sumGain(totalBreaks) - sumGain(shortBreaks);
  } else {
    if (totalBreaks < TIANFU_SPEED_BREAKS) {return zeroRow(coinBook,coinZhen,yu,zhen);}
    shortBreaks = TIANFU_SPEED_BREAKS;
    speed = sumGain(shortBreaks);
    lucky = sumGain(totalBreaks) - sumGain(shortBreaks);
  }
  const hit = hitOf(lucky);
  const rate = hitRate(Number(hit),ENEMY_5.dodge);
  const xiXingPct = (hit - ENEMY_DODGE + WUKONG_ZHU_DODGE_DOWN > 0n
    ? hit - ENEMY_DODGE + WUKONG_ZHU_DODGE_DOWN
: 0n) * XI_XING_LV3_RATE;
  const shenTong15 = hit < SHEN_TONG_15_CAP ? hit : SHEN_TONG_15_CAP;

  // 三条命中链乘区连乘,定点放大 HIT_SCALE 保留小数:Π((100+p)*HIT_SCALE/100)/HIT_SCALE^(n-1).
  const f1 = (100n + hit) * HIT_SCALE / 100n;
  const f2 = (100n + shenTong15) * HIT_SCALE / 100n;
  const f3 = (100n + xiXingPct) * HIT_SCALE / 100n;
  const pctBucketScaled = f1 * f2 / HIT_SCALE * f3 / HIT_SCALE;  // = Π(1+p/100)×HIT_SCALE
  const baseAtk = yu.atk + zhen.atk;
  const pen = baseAtk;

  // 攻击%先乘进攻击得 finalAtk(源码 GetFinal),再让 K 用 finalAtk 算.
  const atkPct = bird
    ? WU_SONG_ATK_PERCENT
    : WU_SONG_ATK_PERCENT + TIANFU_PANEL_ATK + zhen.level;
  const finalAtk = baseAtk * (100n + atkPct) / 100n;
  const zhenSpeedDmg = bird
    ? (speed > ENEMY_SPEED ? speed - ENEMY_SPEED : 0n) > BIRD_DAMAGE_CAP
      ? BIRD_DAMAGE_CAP
: speed > ENEMY_SPEED ? speed - ENEMY_SPEED : 0n
    : 0n;
  const dmgAdd = WU_SONG_DAMAGE_ADD + zhenSpeedDmg;

  // 源码 CulFinalDamage: dmg = finalAtk×K/100×num×(100+dmgAdd)/100×(100-reduce)/100,全整除.
  const defAfterPen = ENEMY_DEF > pen ? ENEMY_DEF - pen : 1n;
  const k = culDamagePercentBig(finalAtk,defAfterPen);
  let damage = finalAtk * k / 100n;
  damage = damage * pctBucketScaled / HIT_SCALE;
  damage = damage * (100n + dmgAdd) / 100n;
  damage = damage * (100n - ENEMY_REDUCE) / 100n;
  const isFeasible = rate >= 1 && speed > ENEMY_SPEED && damage >= ENEMY_HP;
  return {
atkPct,
baseAtk,
books,
coin:         coinBook + coinZhen,
coinBook,
coinZhen,
damage,
dmgAdd,
feasible:     isFeasible,
hit,
    hitRateValue: rate,
lingwen:      coinZhen / LINGWEN_COST,
lucky,
pctBucketScaled,
pen,
shortBreaks,
speed,
totalBreaks,
    yuLevel:      yu.level,
zhenAtk:      zhen.atk,
zhenLevel:    zhen.level,
zhenSpeedDmg
};
}

// 展示辅助:游戏单位(万/亿/兆/京/秭) + 精确整数括号.
const coinOf = (v: bigint): bigint => v / SCALE;  // 0.1钱币 → 钱币
const amt = (v: bigint): string => {
  const s = formatSuoXie(Number(v));
  return v >= 10n ** 21n ? s : `${s}(${v.toString()})`;
};
const amtCoin = (v: bigint): string => amt(coinOf(v));

// 逐项拆解伤害公式,每部分标注花了多少钱币;写到根目录 composite-compare.log.
export function logFormulaBreakdown (): void {
  const lines: string[] = [];
  const log = (s = ""): void => {lines.push(s); console.log(s);};
  const ratio = (scaled: bigint): string => (Number(scaled) / Number(HIT_SCALE)).toLocaleString("en-US",{maximumFractionDigits: 3});
  log("########## 伤害公式逐项拆解(Damage_Recorder.cs CulFinalDamage,BigInt精确) ##########");
  log(`敌人: DEF=${amt(ENEMY_DEF)} 减伤=${String(ENEMY_5.damageReduce)}(夹到${String(ENEMY_REDUCE)}) 闪避=${String(ENEMY_DODGE)} 速度=${formatSuoXie(ENEMY_5.speed)} HP=${amt(ENEMY_HP)}`);
  for (const isBird of [true,false]) {
    const r = reverseWukongCoin(isBird);
    log(`\n========== ${r.name} ==========`);
    log(`总花费 ${amtCoin(r.coin)} 金币 = 御灵宝典 ${amtCoin(r.coinBook)} + 灵纹升阵法 ${amtCoin(r.coinZhen)}`);
    log(`  · 御灵宝典 ${amtCoin(r.coinBook)} → ${amt(r.books)}本 → 御灵师Lv.${formatSuoXie(Number(r.yuLevel))} → ${formatSuoXie(Number(r.totalBreaks))}次突破`);
    log(`  · 灵纹 ${amtCoin(r.coinZhen)} → ${amt(r.lingwen)}个 → 阵法Lv.${formatSuoXie(Number(r.zhenLevel))}(四维攻+${amt(r.zhenAtk)})`);
    const yuAtk = 125n * r.yuLevel * (r.yuLevel - 1n);
    const finalAtk = r.baseAtk * (100n + r.atkPct) / 100n;
    const defAfterPen = ENEMY_DEF > r.pen ? ENEMY_DEF - r.pen : 1n;
    const k = culDamagePercentBig(finalAtk,defAfterPen);
    const hit = r.hit;
    const shenTong15 = hit < SHEN_TONG_15_CAP ? hit : SHEN_TONG_15_CAP;
    const xiPct = (hit - ENEMY_DODGE + WUKONG_ZHU_DODGE_DOWN > 0n ? hit - ENEMY_DODGE + WUKONG_ZHU_DODGE_DOWN : 0n) * XI_XING_LV3_RATE;
    log("\n① 攻击来源");
    log(`   [御灵宝典 ${amtCoin(r.coinBook)}] 御灵师攻 = 125×L×(L-1), L=${formatSuoXie(Number(r.yuLevel))} → ${amt(yuAtk)}`);
    log(`   [灵纹 ${amtCoin(r.coinZhen)}] 阵法四维攻, Z=${formatSuoXie(Number(r.zhenLevel))} → ${amt(r.zhenAtk)}`);
    log(`   baseAtk = ${amt(yuAtk)} + ${amt(r.zhenAtk)} = ${amt(r.baseAtk)}`);
    log("\n② 攻击%桶 → finalAtk");
    log(`   [队伍免费] 武松+${String(WU_SONG_ATK_PERCENT)}${isBird ? "" : ` [阵法免费] 天覆面板+${String(TIANFU_PANEL_ATK)} [灵纹] 等级+${formatSuoXie(Number(r.zhenLevel))}`}`);
    log(`   攻击%合计=${formatSuoXie(Number(r.atkPct))}% → finalAtk = ${amt(r.baseAtk)}×(100+${formatSuoXie(Number(r.atkPct))})/100 = ${amt(finalAtk)}`);
    log("\n③ 防御与 K");
    log(`   穿透=${amt(r.pen)} 敌DEF=${amt(ENEMY_DEF)} → DEF'=${amt(defAfterPen)}`);
    log(`   K=CulDamagePercent(finalAtk=${amt(finalAtk)}, DEF'=${amt(defAfterPen)})=${String(k)} → bigInteger2=${amt(finalAtk * k / 100n)}`);
    log("\n④ 命中链乘区(逐项连乘)");
    log(`   命中=${formatSuoXie(Number(hit))}(命中率${(r.hitRateValue * 100).toFixed(2)}%) skill78 +${formatSuoXie(Number(hit))} 神通15 +${formatSuoXie(Number(shenTong15))} 西行 +${formatSuoXie(Number(xiPct))}`);
    log(`   num=${ratio((100n + hit) * HIT_SCALE / 100n)}×${ratio((100n + shenTong15) * HIT_SCALE / 100n)}×${ratio((100n + xiPct) * HIT_SCALE / 100n)} = ${ratio(r.pctBucketScaled)}`);
    log("\n⑤ 伤害加成桶");
    log(`   [队伍免费] 武松+${String(WU_SONG_DAMAGE_ADD)}${isBird ? ` [御灵宝典→速度] 鸟翔速度差=${formatSuoXie(Number(r.zhenSpeedDmg))}` : ""}`);
    log(`   DamageAddition=${formatSuoXie(Number(r.dmgAdd))} → (100+)/100=${ratio((100n + r.dmgAdd) * HIT_SCALE / 100n)}`);
    log(`\n⑥ 减伤 [敌人固有] ${String(ENEMY_5.damageReduce)}→夹${String(ENEMY_REDUCE)} → ×${ratio((100n - ENEMY_REDUCE) * HIT_SCALE / 100n)}`);
    let damage = finalAtk * k / 100n;
    damage = damage * r.pctBucketScaled / HIT_SCALE;
    damage = damage * (100n + r.dmgAdd) / 100n;
    damage = damage * (100n - ENEMY_REDUCE) / 100n;
    log(`\n⑦ 总伤害 = ${amt(finalAtk * k / 100n)} × ${ratio(r.pctBucketScaled)} × ${ratio((100n + r.dmgAdd) * HIT_SCALE / 100n)} × ${ratio((100n - ENEMY_REDUCE) * HIT_SCALE / 100n)}`);
    log(`   = ${amt(damage)} → ${damage >= ENEMY_HP ? "✓ 达标" : "✗ 不足"} (敌HP ${amt(ENEMY_HP)})`);
  }
  writeFileSync(new URL("../composite-compare.log",import.meta.url),`${lines.join("\n")}\n`,"utf8");
  console.log("\n[已写出] 公式逐项拆解 → 项目根目录 composite-compare.log");
}

// 打印结果:两方案最小金币与完整拆解.
export function printReverseCoin (): void {
  console.log("=== 反推金币(命中100% + 一击必杀 + 速度更快;BigInt精确;金币拆御灵宝典+灵纹升阵法;从零面板,终局第5层) ===");
  console.log(`敌闪避=${String(ENEMY_5.dodge)} 敌速=${formatSuoXie(ENEMY_5.speed)} 敌HP=${formatSuoXie(ENEMY_5.hp)}`);
  const line = (r: ReverseRow): void => {
    const pct = (v: bigint): string => `${(Number(v * 1000n / r.coin) / 10).toFixed(1)}%`;
    console.log(`  【资源拆分】总金币=${amtCoin(r.coin)} = 御灵宝典 ${amtCoin(r.coinBook)}(${pct(r.coinBook)}) + 灵纹升阵法 ${amtCoin(r.coinZhen)}(${pct(r.coinZhen)})`);
    console.log(`    御灵宝典 ${amtCoin(r.coinBook)} → ${amt(r.books)}本 → 御灵师Lv.${formatSuoXie(Number(r.yuLevel))}`);
    console.log(`    灵纹 ${amtCoin(r.coinZhen)} → ${amt(r.lingwen)}个 → 阵法Lv.${formatSuoXie(Number(r.zhenLevel))}(四维攻+${amt(r.zhenAtk)})`);
    console.log(`  【突破】总突破=${formatSuoXie(Number(r.totalBreaks))};补短板=${formatSuoXie(Number(r.shortBreaks))}(${r.shortBreaks < 0n ? "未达标" : r.name.includes("鸟翔") ? "幸运突破补命中" : "速度突破补速度"})`);
    console.log(`    幸运=${formatSuoXie(Number(r.lucky))} 速度=${formatSuoXie(Number(r.speed))} 命中=${formatSuoXie(Number(r.hit))} 命中率=${(r.hitRateValue * 100).toFixed(2)}%`);
    const finalAtk = r.baseAtk * (100n + r.atkPct) / 100n;
    console.log(`  【伤害】攻击基数=${amt(r.baseAtk)} 攻击加成=${formatSuoXie(Number(r.atkPct))}% → final攻=${amt(finalAtk)} 穿透=${amt(r.pen)} 命中链乘区=${(Number(r.pctBucketScaled) / Number(HIT_SCALE)).toLocaleString("en-US",{maximumFractionDigits: 3})}`);
    console.log(`    鸟翔速度差=${formatSuoXie(Number(r.zhenSpeedDmg))}% 伤害加成桶=${formatSuoXie(Number(r.dmgAdd))} → 伤害=${amt(r.damage)} (${r.damage >= ENEMY_HP ? "≥" : "<"} 敌HP ${amt(ENEMY_HP)})`);
  };
  for (const isBird of [true,false]) {
    const row = reverseWukongCoin(isBird);
    console.log(`\n--- ${row.name} ---`);
    line(row);
  }
}
printReverseCoin();
logFormulaBreakdown();