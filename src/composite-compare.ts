/**
 * composite-compare.ts — 反推金币:求满足「命中100% + 一击必杀 + 速度更快」的最小钱币.
 * 只算两种方案(从零面板,不读存档,队伍加成照人皇印队保留):
 * ① 全速度+鸟翔阵(补命中):先分配最少突破选幸运把命中补到100%,其余突破全速度给鸟翔;
 * ② 全幸运+天覆阵(补速度):先分配最少突破选速度超过敌速,其余突破全幸运走命中增伤链.
 * 金币拆两部分:御灵宝典(御灵等级→四维攻/穿透 + 每10级突破选幸运/速度)
 *             + 灵纹升阵法(天覆阵:面板攻+15%与战斗期+阵法等级%攻击;鸟翔阵:四维攻/穿透).
 * 目标终局第 5 层(ENEMY_5);命中率用 enemy-stats.ts 的 hitRate 判定,必须 =100%.
 * 运行:pnpm --config.verify-deps-before-run=false exec tsx src/composite-compare.ts
 */
import {writeFileSync} from "node:fs";
import {MATERIAL_COST_PER_UNIT} from "./data.ts";
import {formatSuoXie} from "./readSave.ts";
import {hitRate} from "./scripts/enemy-stats.ts";
import {culDamagePercent,oneShotDamage} from "./scripts/game-formulas.ts";
import {ENEMY_5} from "./zhanli-panel.ts";

// 口径(全部来自反编译源码,见 src/反编译):
// - 御灵宝典每本 100 御力 × 研究48 +100% = 200;御灵升级门槛 CulLevel_Up_Remand =
//   100×⌊L/10⌋×(⌊L/10⌋+1)+20×(⌊L/10⌋+1)×(L%10),每级四维各 +L×250;
//   每满 10 级突破一次,第 k 次幸运/速度增益 = 2+⌊4k×1.75⌋ = 2+7k(pinZhi=4),前 n 次累计 sumGain(n).
// - 阵法每级消耗 ⌊L×20×(100-研究26 50)/100⌋ = 10L 灵纹,每级四维各 +(200+35L);
//   天覆阵面板攻击 +15%(PercentAddition)与战斗期 +阵法等级% 攻击(Entry_ZhenFa_1.cs:18-26,同一个攻击%桶);
//   鸟翔阵无面板攻击加成,速度差 min(我方-敌方,2147483646) 进伤害加成桶(Entry_ZhenFa_8.cs:30-41).
// - 命中 = 唐三藏 30 + ⌊幸运/100⌋×5(Entry_Skill_1051.cs,BigInteger 整除,无上限);
//   命中率 = hitRate(命中, 敌闪避),必须 =100%.
// - 命中喂三条独立乘区(都进 PercentAddition,各自 1+p/100):孙悟空3技能 +(int)命中、
//   神通15 夹到 2147483637、西行取经 Lv.3 max(0,命中-敌闪避+猪八戒20)×1.0.
// - 人皇印队含武松:攻击桶 +20%、伤害加成桶 +35;唐三藏 +30 命中;猪八戒 -20 敌闪避;
//   一击必杀 = 伤害 ≥ 敌HP.
const BOOK_COST = MATERIAL_COST_PER_UNIT["御灵宝典"]!;  // 52.5 钱币/本
const LINGWEN_COST = MATERIAL_COST_PER_UNIT["灵纹"]!;   // 1.4 钱币/个
const WUKONG_TANG_HIT = 30;
const WUKONG_ZHU_DODGE_DOWN = 20;
const XI_XING_LV3_RATE = 0.25 + 0.25 * 3;
const SHEN_TONG_15_CAP = 21_4748_3637;
const WU_SONG_ATK_PERCENT = 20;
const WU_SONG_DAMAGE_ADD = 35;
const TIANFU_PANEL_ATK = 15;
const BIRD_DAMAGE_CAP = 21_4748_3646;
const MAX_COIN = 1e20;

// 前 n 次突破累计增益(解析式):Σ(2+7k) = 2n + 7n(n+1)/2.
const sumGain = (n: number): number => n <= 0 ? 0 : 2 * n + 7 * n * (n + 1) / 2;
// 命中 = 唐三藏 30 + ⌊幸运/100⌋×5.
const hitOf = (lucky: number): number => WUKONG_TANG_HIT + Math.trunc(lucky / 100) * 5;

// 御灵宝典本数 → 御灵等级/四维攻击/突破次数(等价 calzhanli.ts:yulingbaodianTozhanli,已交叉验证).
// 逐级累计御力门槛的闭式:前 N 级门槛之和 = 完整十级组 + 当前十级组部分.
function yuCumNeed (level: number): number {
  if (level <= 1) {return 0;}
  const last = level - 1, tens = Math.floor(last / 10), rem = last % 10;
  const full = 100 * (10 * tens * (tens - 1) * (2 * tens - 1) / 6
    + 19 * tens * (tens - 1) / 2 + 9 * tens);
  const partial = 20 * (tens + 1) * (5 * tens * (rem + 1) + rem * (rem + 1) / 2);
  return full + partial;
}
function yulingLevel (books: number): {level: number; atk: number; breaks: number} {
  const exp = 200 * books;
  let lo = 1, hi = Math.max(2, Math.ceil(Math.cbrt(3 * exp)) * 2 + 100);
  while (yuCumNeed(hi) <= exp) {hi *= 2;}
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (yuCumNeed(mid) <= exp) {lo = mid;} else {hi = mid - 1;}
  }
  return {level: lo, atk: 125 * lo * (lo - 1), breaks: Math.floor(lo / 10)};
}
// 灵纹 → 阵法等级/四维攻击增量(等价 calzhanli.ts:lingwenLevelUp,已交叉验证).
// 累计灵纹 = Σ10L = 5Z(Z-1),四维攻击 = Σ(200+35L) = 200(Z-1)+35(Z-1)Z/2.
function zhenLevel (lingwen: number): {level: number; atk: number} {
  let level = Math.max(1, Math.floor((1 + Math.sqrt(1 + 0.8 * lingwen)) / 2));
  while (level > 1 && 5 * level * (level - 1) > lingwen) {level--;}
  while (5 * (level + 1) * level <= lingwen) {level++;}
  return {level, atk: 200 * (level - 1) + 35 * (level - 1) * level / 2};
}

// 命中100%所需最小幸运(逐个 100 的倍数,用 hitRate 判定;命中3105仅99.01%,3106才100%).
let luckyForFullHit = 0;
for (let lucky = 0; lucky <= 1e8; lucky += 100) {
  if (hitRate(hitOf(lucky), ENEMY_5.dodge) >= 1) {luckyForFullHit = lucky; break;}
}
// 达到某累计增益所需的最小突破次数(二分).
function minBreaksForGain (gain: number): number {
  let lo = 0, hi = 1;
  while (sumGain(hi) < gain) {hi *= 2;}
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (sumGain(mid) >= gain) {hi = mid;} else {lo = mid + 1;}
  }
  return lo;
}
const BIRD_HIT_BREAKS = minBreaksForGain(luckyForFullHit);    // 鸟翔补命中所需幸运突破
const TIANFU_SPEED_BREAKS = minBreaksForGain(ENEMY_5.speed + 1); // 天覆补速度所需速度突破
// 买满若干突破所需的最小御灵宝典花费.
function minBookCostForBreaks (breaks: number): number {
  let lo = 1, hi = 1e6;
  while (yulingLevel(hi).breaks < breaks) {hi *= 2;}
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (yulingLevel(mid).breaks >= breaks) {hi = mid;} else {lo = mid + 1;}
  }
  return lo * BOOK_COST;
}
// 天覆补速度:剩余幸运也要达命中门槛,求最小总突破数.
function minTotalBreaksTianfu (): number {
  let lo = TIANFU_SPEED_BREAKS, hi = TIANFU_SPEED_BREAKS * 2;
  const ok = (total: number): boolean =>
    sumGain(total) - sumGain(TIANFU_SPEED_BREAKS) >= luckyForFullHit;
  while (!ok(hi)) {hi *= 2;}
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) {hi = mid;} else {lo = mid + 1;}
  }
  return lo;
}
const MIN_BOOK_BIRD = minBookCostForBreaks(BIRD_HIT_BREAKS + TIANFU_SPEED_BREAKS);
const MIN_BOOK_TIANFU = minBookCostForBreaks(minTotalBreaksTianfu());

interface ReverseRow {
  name:            string;
  feasible:        boolean;       // 三条件(命中100%+速度更快+一击必杀)是否同时满足
  coin:            number;        // 总金币;-1 表示在 MAX_COIN 内无解
  coinBook:        number;        // 买御灵宝典的钱
  books:           number;        // 御灵宝典本数
  yuLevel:         number;        // 御灵师等级
  totalBreaks:     number;        // 总突破次数
  shortBreaks:     number;        // 补短板用的突破次数(鸟翔=幸运突破,天覆=速度突破)
  lucky:           number;
  speed:           number;
  hit:             number;
  hitRateValue:    number;
  coinZhen:        number;        // 买灵纹升阵法的钱
  lingwen:         number;        // 灵纹个数
  zhenLevel:       number;        // 阵法等级
  zhenAtk:         number;        // 阵法四维攻击增量
  baseAtk:         number;        // 御灵+阵法的基础攻击
  pen:             number;        // 穿透(御灵+阵法)
  atkPct:          number;        // 攻击%桶
  pctBucket:       number;        // 命中链乘区
  zhenSpeedDmg:    number;        // 鸟翔速度差加成%
  dmgAdd:          number;        // 伤害加成桶
  damage:          number;
}

// 给定拆分(买御灵宝典的钱、买灵纹的钱)与方案,算三条件与伤害.bird=true 鸟翔(补命中),false 天覆(补速度).
function evalSplit (bird: boolean, coinBook: number, coinZhen: number): Omit<ReverseRow,"name"> {
  const books = Math.floor(coinBook / BOOK_COST);
  const yu = yulingLevel(books);
  const zhen = zhenLevel(Math.floor(coinZhen / LINGWEN_COST));
  const totalBreaks = yu.breaks;
  let shortBreaks: number, lucky: number, speed: number;
  if (bird) {
    if (totalBreaks < BIRD_HIT_BREAKS + TIANFU_SPEED_BREAKS) {
      return {books,coin:coinBook+coinZhen,coinBook,coinZhen,damage:0,feasible:false,hit:0,hitRateValue:0,
        lucky:0,speed:0,shortBreaks:-1,yuLevel:yu.level,totalBreaks,zhenLevel:zhen.level,zhenAtk:zhen.atk,
        baseAtk:0,pen:0,atkPct:0,pctBucket:0,zhenSpeedDmg:0,dmgAdd:0,lingwen:Math.floor(coinZhen/LINGWEN_COST)};
    }
    shortBreaks = BIRD_HIT_BREAKS;
    lucky = sumGain(shortBreaks);
    speed = sumGain(totalBreaks) - sumGain(shortBreaks);
  } else {
    if (totalBreaks < TIANFU_SPEED_BREAKS) {
      return {books,coin:coinBook+coinZhen,coinBook,coinZhen,damage:0,feasible:false,hit:0,hitRateValue:0,
        lucky:0,speed:0,shortBreaks:-1,yuLevel:yu.level,totalBreaks,zhenLevel:zhen.level,zhenAtk:zhen.atk,
        baseAtk:0,pen:0,atkPct:0,pctBucket:0,zhenSpeedDmg:0,dmgAdd:0,lingwen:Math.floor(coinZhen/LINGWEN_COST)};
    }
    shortBreaks = TIANFU_SPEED_BREAKS;
    speed = sumGain(shortBreaks);
    lucky = sumGain(totalBreaks) - sumGain(shortBreaks);
  }
  const hit = hitOf(lucky);
  const rate = hitRate(hit, ENEMY_5.dodge);
  const xiXingPct = Math.trunc(
    Math.max(0,hit - (ENEMY_5.dodge - WUKONG_ZHU_DODGE_DOWN)) * XI_XING_LV3_RATE
  );
  const shenTong15 = Math.min(hit,SHEN_TONG_15_CAP);
  const pctBucket = (1 + hit / 100) * (1 + shenTong15 / 100) * (1 + xiXingPct / 100);
  const baseAtk = yu.atk + zhen.atk;
  const pen = yu.atk + zhen.atk;
  // 攻击% 必须先乘进攻击得到 finalAtk(源码 BattleData_Recorder.cs:34 GetFinal),
  // 再让 K=CulDamagePercent(finalAtk, DEF') 用 finalAtk 算(源码 Damage_Recorder.cs:75).
  // oneShotDamage 传 finalAtk 且 atkPct=100;若传原始攻+非100 atkPct,K 会用原始攻算而低估鸟翔伤害.
  const atkPct = bird
    ? WU_SONG_ATK_PERCENT
    : WU_SONG_ATK_PERCENT + TIANFU_PANEL_ATK + zhen.level;
  const finalAtk = baseAtk * (100 + atkPct) / 100;
  const zhenSpeedDmg = bird
    ? Math.min(Math.max(0,speed - ENEMY_5.speed),BIRD_DAMAGE_CAP)
    : 0;
  const dmgAdd = WU_SONG_DAMAGE_ADD + zhenSpeedDmg;
  const damage = oneShotDamage(finalAtk,ENEMY_5,{
    atkPct: 100, dmgAdd, pctBucket, pen, skillMult: 1
  });
  const feasible = rate >= 1 && speed > ENEMY_5.speed && damage >= ENEMY_5.hp;
  return {books,coin:coinBook+coinZhen,coinBook,coinZhen,damage,feasible,hit,hitRateValue:rate,lucky,speed,
    shortBreaks,yuLevel:yu.level,totalBreaks,zhenLevel:zhen.level,zhenAtk:zhen.atk,baseAtk,pen,atkPct,
    pctBucket,zhenSpeedDmg,dmgAdd,lingwen:Math.floor(coinZhen/LINGWEN_COST)};
}

// 给定总金币,三分搜索找伤害最大的御灵宝典/灵纹拆分(伤害关于拆分单峰).
function bestSplitForCoin (bird: boolean, coin: number): Omit<ReverseRow,"name"> {
  const minBook = bird ? MIN_BOOK_BIRD : MIN_BOOK_TIANFU;
  let lo = minBook, hi = coin;
  for (let i = 0; i < 100; i++) {
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
    if (evalSplit(bird,m1,coin - m1).damage < evalSplit(bird,m2,coin - m2).damage) {lo = m1;} else {hi = m2;}
  }
  const coinBook = (lo + hi) / 2;
  return evalSplit(bird,coinBook,coin - coinBook);
}

// 反推满足三条件的最小总金币;MAX_COIN 内无解则 coin=-1.
export function reverseWukongCoin (bird: boolean): ReverseRow {
  const name = bird ? "全速度+鸟翔阵(补命中)" : "全幸运+天覆阵(补速度)";
  const maxRow = bestSplitForCoin(bird,MAX_COIN);
  if (!maxRow.feasible) {
    return {name,...maxRow,coin: -1};
  }
  let lo = bird ? MIN_BOOK_BIRD : MIN_BOOK_TIANFU;
  let hi = MAX_COIN;
  // 二分:金币越多越容易达标(feasible 单调).金币量级 ~1e17 远超 2^53,
  // lo/hi 的 gap 缩到浮点精度后 mid+1===mid 会死循环,故固定迭代 80 次(已到 double 精度极限).
  for (let i = 0; i < 80; i++) {
    const mid = Math.floor((lo + hi) / 2);
    if (mid === lo || mid === hi) {break;}
    if (bestSplitForCoin(bird,mid).feasible) {hi = mid;} else {lo = mid + 1;}
  }
  return {name,...bestSplitForCoin(bird,hi)};
}

// 打印反推结果:两方案的最小金币与完整拆解(资源拆分、突破、阵法、命中链、伤害).
export function printReverseCoin (): void {
  console.log("=== 反推金币(命中100% + 一击必杀 + 速度更快;金币拆御灵宝典+灵纹升阵法;从零面板,终局第5层) ===");
  console.log(`敌闪避=${String(ENEMY_5.dodge)} 敌速=${formatSuoXie(ENEMY_5.speed)} 敌HP=${formatSuoXie(ENEMY_5.hp)}`);
  const line = (r: ReverseRow): void => {
    const pct = (v: number): string => (v / r.coin * 100).toFixed(1) + "%";
    console.log(`  【资源拆分】总金币=${formatSuoXie(r.coin)}(${Math.round(r.coin)})`);
    console.log(`    御灵宝典: ${formatSuoXie(r.coinBook)}金币(${pct(r.coinBook)}) → ${formatSuoXie(r.books)}本 → 御灵师Lv.${formatSuoXie(r.yuLevel)}`);
    console.log(`    灵纹升阵法: ${formatSuoXie(r.coinZhen)}金币(${pct(r.coinZhen)}) → ${formatSuoXie(r.lingwen)}灵纹 → 阵法Lv.${formatSuoXie(r.zhenLevel)}(四维攻+${formatSuoXie(r.zhenAtk)})`);
    console.log(`  【突破】总突破=${formatSuoXie(r.totalBreaks)};补短板=${formatSuoXie(r.shortBreaks)}(${r.shortBreaks < 0 ? "未达标" : r.name.includes("鸟翔") ? "幸运突破补命中" : "速度突破补速度"})`);
    console.log(`    幸运=${formatSuoXie(r.lucky)} 速度=${formatSuoXie(r.speed)} 命中=${formatSuoXie(r.hit)} 命中率=${(r.hitRateValue * 100).toFixed(2)}%`);
    console.log(`  【伤害】攻击基数=${formatSuoXie(r.baseAtk)} 攻击加成=${formatSuoXie(r.atkPct)}% → final攻=${formatSuoXie(r.baseAtk * (100 + r.atkPct) / 100)} 穿透=${formatSuoXie(r.pen)} 命中链乘区=${formatSuoXie(r.pctBucket)}`);
    console.log(`    鸟翔速度差=${formatSuoXie(r.zhenSpeedDmg)}% 伤害加成桶=${formatSuoXie(r.dmgAdd)} → 伤害=${formatSuoXie(r.damage)} (${r.damage >= ENEMY_5.hp ? "≥" : "<"} 敌HP ${formatSuoXie(ENEMY_5.hp)})`);
  };
  for (const bird of [true,false]) {
    const row = reverseWukongCoin(bird);
    console.log(`\n--- ${row.name} ---`);
    line(row);
  }
}

// 逐项拆解伤害公式,每部分标注用了多少钱币;同时打印到控制台并写入根目录 composite-compare.log.
// 按反编译 Damage_Recorder.cs:55-99 顺序,每个乘区/加区单独列出.
// 大数一律用游戏单位(万/亿/兆/京/秭,formatSuoXie),括号里保留精确整数便于核对.
export function logFormulaBreakdown (): void {
  const f = formatSuoXie;
  // 大数:游戏单位为主,括号里放精确整数(≥1e21 的科学计数法不易读,省略).
  const amt = (v: number): string => Math.abs(v) >= 1e21 ? f(v) : `${f(v)}(${Math.round(v)})`;
  const num = (v: number): string => String(v);
  const lines: string[] = [];
  const log = (s = ""): void => {lines.push(s); console.log(s);};
  log("########## 伤害公式逐项拆解(Damage_Recorder.cs CulFinalDamage) ##########");
  log(`敌人: DEF=${amt(ENEMY_5.def)} 减伤=${ENEMY_5.damageReduce}(源码>80夹到${Math.min(ENEMY_5.damageReduce,80)}) 闪避=${ENEMY_5.dodge} 速度=${amt(ENEMY_5.speed)} HP=${amt(ENEMY_5.hp)}`);
  for (const bird of [true,false]) {
    const r = reverseWukongCoin(bird);
    log(`\n========== ${r.name} ==========`);
    log(`总花费 ${amt(r.coin)} 金币 = 御灵宝典 ${amt(r.coinBook)} + 灵纹升阵法 ${amt(r.coinZhen)}`);
    log(`  · 御灵宝典 ${amt(r.coinBook)} → ${amt(r.books)}本 → 御灵师Lv.${f(r.yuLevel)} → ${f(r.totalBreaks)}次突破(幸运/速度)`);
    log(`  · 灵纹 ${amt(r.coinZhen)} → ${amt(r.lingwen)}个 → 阵法Lv.${f(r.zhenLevel)}(四维攻+${amt(r.zhenAtk)})`);

    // ① 攻击来源
    const yuAtk = 125 * r.yuLevel * (r.yuLevel - 1);
    const zhenAtk = r.zhenAtk;
    log(`\n① 攻击来源`);
    log(`   [御灵宝典 ${amt(r.coinBook)}] 御灵师攻 = 125×L×(L-1), L=${f(r.yuLevel)} → ${amt(yuAtk)}`);
    log(`   [灵纹 ${amt(r.coinZhen)}] 阵法四维攻 = 200(Z-1)+35(Z-1)Z/2, Z=${f(r.zhenLevel)} → ${amt(zhenAtk)}`);
    log(`   基础攻击 baseAtk = ${amt(yuAtk)} + ${amt(zhenAtk)} = ${amt(r.baseAtk)}`);

    // ② 攻击%桶 → finalAtk
    const wuSongAtk = WU_SONG_ATK_PERCENT;
    const tianfuPanel = bird ? 0 : TIANFU_PANEL_ATK;
    const tianfuLevel = bird ? 0 : r.zhenLevel;
    log(`\n② 攻击%桶 → finalAtk (BattleData_Recorder.cs:34 GetFinal)`);
    log(`   [队伍加成 免费] 武松攻击% = +${wuSongAtk}`);
    if (!bird) {
      log(`   [阵法固有 免费] 天覆阵面板攻击% = +${tianfuPanel}`);
      log(`   [灵纹 ${amt(r.coinZhen)}] 天覆阵战斗期等级% = +${f(tianfuLevel)} (阵法等级带来的攻击%)`);
    }
    log(`   攻击%合计 = ${f(r.atkPct)}%`);
    log(`   finalAtk = baseAtk×(100+${f(r.atkPct)})/100 = ${amt(r.baseAtk)}×${num((100+r.atkPct)/100)} = ${amt(r.baseAtk*(100+r.atkPct)/100)}`);

    // ③ 防御与 K
    const finalAtk = r.baseAtk * (100 + r.atkPct) / 100;
    const defAfterPen = Math.max(1,ENEMY_5.def - r.pen);
    const k = culDamagePercent(finalAtk,defAfterPen);
    log(`\n③ 防御与 K (Damage_Recorder.cs:70-75,138-161)`);
    log(`   [御灵宝典+灵纹 ${amt(r.coin)}] 穿透 = ${amt(r.pen)} (=${amt(yuAtk)}御灵+${amt(zhenAtk)}阵法)`);
    log(`   敌DEF = ${amt(ENEMY_5.def)} → DEF' = max(1, DEF-穿透) = ${amt(defAfterPen)}`);
    log(`   K = CulDamagePercent(finalAtk=${amt(finalAtk)}, DEF'=${amt(defAfterPen)}) = ${num(k)} → K/100=${num(k/100)}`);
    log(`   基础伤害 bigInteger2 = finalAtk×K/100 = ${amt(finalAtk*k/100)}`);

    // ④ 命中链三条百分比乘区
    const hit = r.hit;
    const shenTong15 = Math.min(hit,SHEN_TONG_15_CAP);
    const xiXingPct = Math.trunc(Math.max(0,hit - (ENEMY_5.dodge - WUKONG_ZHU_DODGE_DOWN)) * XI_XING_LV3_RATE);
    log(`\n④ 命中链百分比乘区(逐项连乘 Π(100+p)/100, ToolClass.cs:445-453)`);
    log(`   [御灵宝典 ${amt(r.coinBook)}→幸运突破] 命中 = 唐三藏30 + ⌊幸运${f(r.lucky)}/100⌋×5 = ${f(hit)} (命中率${(r.hitRateValue*100).toFixed(2)}%)`);
    log(`   · 孙悟空3技能 skill78: +(int)命中 = +${f(hit)} → 乘区 = ${num((100+hit)/100)}`);
    log(`   · 神通15: min(命中,${SHEN_TONG_15_CAP}) = +${f(shenTong15)} → 乘区 = ${num((100+shenTong15)/100)}`);
    log(`   · 西行取经Lv3: ⌊max(0,命中-(${ENEMY_5.dodge}-${WUKONG_ZHU_DODGE_DOWN}))×${XI_XING_LV3_RATE}⌋ = +${f(xiXingPct)} → 乘区 = ${num((100+xiXingPct)/100)}`);
    log(`   num = Π = ${num((100+hit)/100)}×${num((100+shenTong15)/100)}×${num((100+xiXingPct)/100)} = ${num(r.pctBucket)}`);

    // ⑤ 伤害加成桶
    const wuSongDmg = WU_SONG_DAMAGE_ADD;
    log(`\n⑤ 伤害加成桶 (Damage_Recorder.cs:86-87)`);
    log(`   [队伍加成 免费] 武松伤害加成 = +${wuSongDmg}`);
    if (bird) {
      log(`   [御灵宝典 ${amt(r.coinBook)}→速度突破] 鸟翔速度差 = min(速度${f(r.speed)}-敌速${f(ENEMY_5.speed)}, 上限${BIRD_DAMAGE_CAP}) = ${f(r.zhenSpeedDmg)}`);
    }
    log(`   DamageAddition 合计 = ${f(r.dmgAdd)} → 乘区 = ${num((100+r.dmgAdd)/100)}`);

    // ⑥ 减伤
    const reduce = Math.min(ENEMY_5.damageReduce,80);
    log(`\n⑥ 减伤 (Damage_Recorder.cs:88-93)`);
    log(`   [敌人固有 免费] 敌减伤=${ENEMY_5.damageReduce} → min(,80)=${reduce} → 乘区 = ${num((100-reduce)/100)}`);

    // ⑦ 总伤害
    const calc = finalAtk * (k/100) * r.pctBucket * (100+r.dmgAdd)/100 * (100-reduce)/100;
    log(`\n⑦ 总伤害 = bigInteger2×num×(100+伤害加成)/100×(100-减伤)/100`);
    log(`   = ${amt(finalAtk*k/100)} × ${num(r.pctBucket)} × ${num((100+r.dmgAdd)/100)} × ${num((100-reduce)/100)}`);
    log(`   = ${amt(calc)} → ${calc >= ENEMY_5.hp ? "✓ 达标" : "✗ 不足"} (敌HP ${amt(ENEMY_5.hp)})`);
  }
  // 写入项目根目录的 composite-compare.log.
  writeFileSync(new URL("../composite-compare.log",import.meta.url),lines.join("\n") + "\n","utf8");
  console.log(`\n[已写出] 公式逐项拆解 → 项目根目录 composite-compare.log`);
}

// 直接执行本文件时打印反推金币结果 + 公式逐项拆解.
printReverseCoin();
logFormulaBreakdown();
