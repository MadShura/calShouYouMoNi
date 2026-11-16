/**
 * composite-compare.ts — 反推金币:求满足「命中100% + 一击必杀 + 速度更快」的最小钱币.
 * 只算两种方案(从零面板,不读存档,队伍加成照人皇印队保留):
 * ① 全速度+鸟翔阵(补命中):先分配最少突破选幸运把命中补到100%,其余突破全速度给鸟翔;
 * ② 全幸运+天覆阵(补速度):先分配最少突破选速度超过敌速,其余突破全幸运走命中增伤链.
 * 目标终局第 5 层(ENEMY_5);命中率用 enemy-stats.ts 的 hitRate 判定,必须 =100%.
 * 运行:pnpm --config.verify-deps-before-run=false exec tsx src/composite-compare.ts
 */
import {yulingbaodianTozhanli} from "./calzhanli.ts";
import {MATERIAL_COST_PER_UNIT} from "./data.ts";
import {formatSuoXie} from "./readSave.ts";
import {hitRate} from "./scripts/enemy-stats.ts";
import {oneShotDamage} from "./scripts/game-formulas.ts";
import {ENEMY_5} from "./zhanli-panel.ts";

// ====================== 孙悟空神 + 4 人西游 Lv.3(人皇印队)反推金币 ======================
// 口径(全部来自反编译源码,见 src/反编译):
// - 突破:每 10 级一次(calzhanli.ts:yulingbaodianTozhanli 的 level%10===0),突破才选方向;
//   第 k 次突破增益 ⌊2+4×k×1.75⌋=2+7k(applyYuLingTuPo,pinZhi=4),前 n 次累计 2n+7n(n+1)/2.
// - 命中 = 唐三藏 30 + ⌊幸运/100⌋×5(Entry_Skill_1051.cs,BigInteger 整除,无上限);
//   命中率 = hitRate(命中, 敌闪避),必须 =100%(源码 (100+命中-闪避+1)/101 封顶 1).
// - 命中喂三条独立乘区(都进 PercentAddition,各自 1+p/100):
//   · 孙悟空3技能 skill78:+(int)命中(Entry_Skill_78.cs,无显式上限);
//   · 神通15:命中×Base×等级/10,源码 if>2147483647 夹到 2147483637(Entry_ShenTong_3.cs);
//   · 西行取经 Lv.3:max(0,命中-敌闪避+猪八戒20)×(0.25+0.25×3),无显式上限(Entry_XiXingQuJing.cs);
//   skill78/西行取经靠 (int) 强转,千亿级命中会整数溢出,此处照源码公式保留数学值.
// - 鸟翔阵速度差 = min(我方速度-敌方速度, 2147483646)(Entry_ZhenFa_8.cs),进伤害加成加法桶.
// - 人皇印队含武松:攻击桶 +20%、伤害加成桶 +35;唐三藏 +30 命中;猪八戒 -20 敌闪避;
// - 面板从零起步(18 项全 0),队伍加成照人皇印队保留;一击必杀 = 伤害 ≥ 敌HP.
const WUKONG_TANG_HIT = 30;
const WUKONG_ZHU_DODGE_DOWN = 20;
const XI_XING_LV3_RATE = 0.25 + 0.25 * 3;
const SHEN_TONG_15_CAP = 21_4748_3637;
const WU_SONG_ATK_PERCENT = 20;
const WU_SONG_DAMAGE_ADD = 35;
const BIRD_DAMAGE_CAP = 21_4748_3646;
const MAX_COIN = 1e20;

// 御灵师单次突破增益:第 k 次 2+⌊4k×1.75⌋=2+7k;前 n 次累计(解析式,避免循环).
const wukongBreakSum = (n: number): number => n <= 0 ? 0 : 2 * n + 7 * n * (n + 1) / 2;
// 命中 = 唐三藏 30 + ⌊幸运/100⌋×5
const hitOf = (lucky: number): number => WUKONG_TANG_HIT + Math.trunc(lucky / 100) * 5;
// 命中100%所需最小幸运:逐个累加 100 的倍数,用 hitRate 判定(命中3105仅99.01%,3106才100%).
function minLuckyForFullHit (): number {
  for (let lucky = 0;lucky <= 1e8;lucky += 100) {
    if (hitRate(hitOf(lucky),ENEMY_5.dodge) >= 1) {return lucky;}
  }
  return 1e8;
}
const LUCKY_FOR_FULL_HIT = minLuckyForFullHit();
// 速度更快所需最小突破次数:sumGain(s)>敌速 的二分(范围 0..totalBreaks,有限).
function minBreaksForSpeed (totalBreaks: number): number {
  if (wukongBreakSum(totalBreaks) <= ENEMY_5.speed) {return -1;}
  let lo = 0;
  let hi = totalBreaks;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (wukongBreakSum(mid) > ENEMY_5.speed) {hi = mid;} else {lo = mid + 1;}
  }
  return lo;
}

interface ReverseRow {
  name:         string;
  feasible:     boolean;        // 三条件(命中100%+速度更快+一击必杀)是否同时满足
  coin:         number;         // 最小金币;-1 表示在 MAX_COIN 内无解
  books:        number;
  totalBreaks:  number;
  shortBreaks:  number;         // 补短板用的突破次数(鸟翔=幸运突破,天覆=速度突破)
  lucky:        number;
  speed:        number;
  hit:          number;
  hitRateValue: number;
  zhenSpeedDmg: number;
  damage:       number;
}

// 给定金币与方案,算三条件与伤害.bird=true 鸟翔(补命中),false 天覆(补速度).
function evalCoin (coin: number,bird: boolean): Omit<ReverseRow,"name"> {
  const books = Math.floor(coin / MATERIAL_COST_PER_UNIT["御灵宝典"]!);
  const upgraded = yulingbaodianTozhanli(books,11,4); // 升级给的攻/穿透与突破方向无关
  const baseAtk = upgraded.atk ?? 0;
  const basePen = upgraded.ignoreDef ?? 0;
  const totalBreaks = Math.trunc((upgraded.finalLevel ?? 0) / 10);
  let shortBreaks: number,lucky: number,speed: number;
  if (bird) {
    // 补命中:最少幸运突破使命中100%,其余突破全速度
    if (hitOf(wukongBreakSum(totalBreaks)) < ENEMY_5.dodge || totalBreaks === 0) {
      return {books,coin,damage: 0,feasible: false,hit: 0,hitRateValue: 0,lucky: 0,
        shortBreaks: -1,speed: 0,totalBreaks,zhenSpeedDmg: 0};
    }
    let lo = 0,hi = totalBreaks;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (wukongBreakSum(mid) >= LUCKY_FOR_FULL_HIT) {hi = mid;} else {lo = mid + 1;}
    }
    shortBreaks = lo;
    lucky = wukongBreakSum(lo);
    speed = wukongBreakSum(totalBreaks) - wukongBreakSum(lo);
  } else {
    // 补速度:最少速度突破超过敌速,其余突破全幸运
    const s = minBreaksForSpeed(totalBreaks);
    if (s < 0) {
      return {books,coin,damage: 0,feasible: false,hit: 0,hitRateValue: 0,lucky: 0,
        shortBreaks: -1,speed: 0,totalBreaks,zhenSpeedDmg: 0};
    }
    shortBreaks = s;
    speed = wukongBreakSum(s);
    lucky = wukongBreakSum(totalBreaks) - wukongBreakSum(s);
  }
  const hit = hitOf(lucky);
  const rate = hitRate(hit,ENEMY_5.dodge);
  const xiXingPct = Math.trunc(
    Math.max(0,hit - (ENEMY_5.dodge - WUKONG_ZHU_DODGE_DOWN)) * XI_XING_LV3_RATE
  );
  const shenTong15 = Math.min(hit,SHEN_TONG_15_CAP);
  const pctBucket = (1 + hit / 100) * (1 + shenTong15 / 100) * (1 + xiXingPct / 100);
  const zhenSpeedDmg = bird
    ? Math.min(Math.max(0,speed - ENEMY_5.speed),BIRD_DAMAGE_CAP)
    : 0;
  const damage = oneShotDamage(baseAtk * (bird ? 1 : 1.15),ENEMY_5,{
    atkPct:    100 + WU_SONG_ATK_PERCENT,
    dmgAdd:    WU_SONG_DAMAGE_ADD + zhenSpeedDmg,
    pctBucket,
    pen:       basePen,
    skillMult: 1
  });
  const feasible = rate >= 1 && speed > ENEMY_5.speed && damage >= ENEMY_5.hp;
  return {
    books,coin,damage,feasible,hit,hitRateValue: rate,lucky,speed,shortBreaks,
    totalBreaks,zhenSpeedDmg
  };
}

// 反推满足三条件的最小金币;MAX_COIN 内无解则 coin=-1.
export function reverseWukongCoin (bird: boolean): ReverseRow {
  const name = bird ? "全速度+鸟翔阵(补命中)" : "全幸运+天覆阵(补速度)";
  if (!evalCoin(MAX_COIN,bird).feasible) {
    return {name,...evalCoin(MAX_COIN,bird),coin: -1};
  }
  let lo = 1e6;
  let hi = MAX_COIN;
  // 二分:金币越多越容易达标(ok 单调);floor 取中点保证区间严格收缩(ceil 会死循环).
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (evalCoin(mid,bird).feasible) {hi = mid;} else {lo = mid + 1;}
  }
  return {name,...evalCoin(lo,bird)};
}

// 打印反推结果:两种方案的最小金币与三条件明细;无解时给出原因.
export function printReverseCoin (): void {
  console.log("=== 反推金币(命中100% + 一击必杀 + 速度更快,从零面板,终局第5层) ===");
  console.log(`敌闪避=${String(ENEMY_5.dodge)} 敌速=${formatSuoXie(ENEMY_5.speed)} 敌HP=${formatSuoXie(ENEMY_5.hp)}`);
  for (const bird of [true,false]) {
    const row = reverseWukongCoin(bird);
    if (row.coin < 0) {
      console.log(`${row.name}: 命中100%下无解(命中${formatSuoXie(row.hit)}、命中率${(row.hitRateValue * 100).toFixed(2)}%;鸟翔速度差封顶${formatSuoXie(BIRD_DAMAGE_CAP)}%走加法桶,金币再增也追不上敌HP)`);
      continue;
    }
    const fields = [
      `总突破=${formatSuoXie(row.totalBreaks)}`,
      `${bird ? "补命中幸运突破" : "补速度速度突破"}=${formatSuoXie(row.shortBreaks)}`,
      `幸运=${formatSuoXie(row.lucky)}`,
      `速度=${formatSuoXie(row.speed)}`,
      `命中=${formatSuoXie(row.hit)}`,
      `命中率=${(row.hitRateValue * 100).toFixed(2)}%`,
      `鸟翔速度差=${formatSuoXie(row.zhenSpeedDmg)}%`,
      `伤害=${formatSuoXie(row.damage)}`
    ].join(" ");
    console.log(`${row.name} 最小金币=${formatSuoXie(row.coin)} (${row.coin}) ${fields}`);
  }
}

// 直接执行本文件时只打印反推金币结果.
printReverseCoin();
