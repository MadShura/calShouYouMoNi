/** 临时脚本:精确复现通天塔伤害(完整乘区),用完删除。 */
import {readFileSync} from "node:fs";
import {join} from "node:path";

const SAVE = String.raw`C:\Users\Administrator\AppData\LocalLow\SkyLight\MoNiShouYou\Save_1`;
const CFG = "d:/code/axl-studio/packages/projects/calShouYouMoNi/src/config";

function objs<T> (file: string): T[] {
  const text = readFileSync(file,"utf8").replace(/^\u{FEFF}/u,"");
  const out: T[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith("{") || t.startsWith("[")) {out.push(JSON.parse(t) as T);}
  }
  return out;
}
const json = <T>(name: string): T => JSON.parse(readFileSync(join(CFG,`${name}.json`),"utf8")) as T;

const cha = objs<any>(join(SAVE,"Cha_Data.Save"))[0];
const yls = objs<any>(join(SAVE,"YingLing_Data.Save"));
const game = objs<any>(join(SAVE,"Game_RecordData.Save"))[0];
const percentProps = new Set<number>(json<any[]>("property").filter(p => p.percent === 1).map(p => p.type));

const carry = yls.find(y => y.YingLing_Index === 26 && y.Master_ID === 1);
const master = cha.BattleData_Manager.battleData_Recorders_List;
const yl = carry.BattleData_Manager.battleData_Recorders_List;
const P = {ADD:13,ATK:0,CRIT:6,CRITD:8,DODGE:5,HIT:4,LUCKY:17,PEN:15,SPEED:3};
const rec = (list: any[],p: number) => list.find((r: any) => r.PropertyTypeEnum === p);
function final (p: number): number {
  const y = rec(yl,p);
  const m = rec(master,p);
  const base = Math.round(y?.Base_Value ?? 0) + Math.round(m?.Base_Value ?? 0);
  const pct = (y?.PercentAddition ?? 0) + (m?.PercentAddition ?? 0);
  return percentProps.has(p) ? Math.max(0,base) : Math.round(base * (100 + pct) / 100);
}
const panel = {
  atkFlat: Math.round((rec(yl,P.ATK)?.Base_Value ?? 0) + (rec(master,P.ATK)?.Base_Value ?? 0)),
  atkPct: (rec(yl,P.ATK)?.PercentAddition ?? 0) + (rec(master,P.ATK)?.PercentAddition ?? 0),
  crit: final(P.CRIT),
  critDamage: final(P.CRITD),
  dmgAdd: final(P.ADD),
  dodge: final(P.DODGE),
  hit: final(P.HIT),
  luckyMaster: Math.round(rec(master,P.LUCKY)?.Base_Value ?? 0),
  pen: final(P.PEN),
  speed: final(P.SPEED)
};

const LAYER = Number(process.argv[2] ?? 207585);
const additionOf = (tr: number): number => {
  if (tr <= 10000) {return 1;}
  let n = Math.trunc(tr / 10000);
  if (n > 200) {n = 200;}
  if (tr < 20000) {return 1 + (tr - 10000) / 10000 * 9;}
  const lo = 10 * 2 ** (n - 2);
  const hi = 10 * 2 ** (n - 1);
  const remain = tr % 10000;
  return remain === 0 ? lo : remain / 10000 * (hi - lo) + lo;
};
function enemyOf (pinzhi: number) {
  const level = LAYER * 16 + 1500;
  const num = Math.trunc(level / 100);
  const roundBase = (num + 1) * 30 * level / 2 + (num + 1) * 30 * (level % 100);
  const add = additionOf(LAYER);
  const num2 = 1 + Math.trunc(LAYER / 500);
  const stat = Math.min(Math.trunc(LAYER / 100),70) + (LAYER >= 11000 ? Math.trunc((LAYER - 11000) / 1000) : 0);
  return {
    crit: stat,
    critResist: stat,
    def: Math.round(roundBase * add * (100 + 2 * num2) / 100),
    dodge: stat,
    hit: stat,
    hp: (8 * roundBase * pinzhi + 100) * add * (100 + 8 * num2) / 100,
    speed: 26 + pinzhi + 1 + Math.trunc(LAYER / 100) + Math.min(Math.trunc(LAYER / 100),70)
  };
}
const culK = (atk: number,def: number): number => {
  if (def <= 0) {return atk > 0 ? 100 : 50;}
  if (atk === def) {return 50;}
  if (atk > def) {return atk >= 3 * def ? 100 : 50 + Math.trunc((atk - def) * 50 / def) * 2;}
  if (atk * 3 <= def) {return 2;}
  return 2 + Math.trunc((atk * 3 - def) * 48 / (def * 2));
};

// 阵容 → 羁绊
const zhenRong: number[] = cha.ZhenRongManager.ZhenRong.ZhenRong.filter((v: number) => v !== 0);
const yingLingCfg = json<any[]>("yingling");
const jibanCfg = json<any[]>("jiban");
const counts = new Map<number,number>();
for (const idx of zhenRong) {
  const e = yingLingCfg.find(y => y.index === idx);
  for (const t of e?.bonds ?? []) {counts.set(t,(counts.get(t) ?? 0) + 1);}
}
const jibanLevels = new Map<number,number>();
for (const [type,count] of counts) {
  const cfg = jibanCfg.find(j => j.type === type);
  const hit = cfg?.levels.find((l: any) => l.count === count);
  if (hit !== undefined) {jibanLevels.set(type as number,hit.level as number);}
}
console.log("阵容",zhenRong,"羁绊人数",[...counts],"羁绊生效(类型:等级)",[...jibanLevels]);

const tuJianLevel = (idx: number): number => cha.tuJianData_RecordsList.find((t: any) => t.EnemyIndex === idx)?.Level ?? 0;
const keji54 = (cha.keJi_Recorders ?? []).find((k: any) => k.KeJi_ID === 54)?.KeJi_Level ?? 0;
const markCount = (game.Mark_Manger.markRecorders ?? []).find((m: any) => m.Mark_Enum === 47)?.Count ?? 0;
const zhenFa = (cha.zhenFaRecorders ?? []).find((z: any) => z.ZhenFaID === cha.CurZhenFa);
const zhenFaID: number = cha.CurZhenFa;
const zhenFaLevel: number = zhenFa?.Level ?? 0;
const PRESET = [13,14,15];

// 孙悟空自身词条等级
const entryLevel = (e: number): number => (carry.BattleEntry ?? []).filter((b: any) => b.EntryNameEnum === e).reduce((s: number,b: any) => s + b.Level,0);
const SHENTONG_3 = entryLevel(37);   // 神通15 命中×Base(1)×等级/10
const SHENTONG_5 = entryLevel(39);   // 神通19 技能动作 +20%/级
const SHENTONG_11 = entryLevel(45);  // 神通27 目标负面层数和
console.log("神通15/19/27 等级",SHENTONG_3,SHENTONG_5,SHENTONG_11,"图鉴研究",keji54,"Mark47",markCount,"阵法",zhenFaID,zhenFaLevel);

const hitChain = panel.hit + 30 + Math.trunc(panel.luckyMaster / 100) * 5;   // 面板 + 唐三藏3技能30 + 孙悟空神转职幸运/100*5
const badStacks = 2;   // 猪八戒3技能 开战给全体敌人 2 层流血
const atkPctTotal = panel.atkPct + 20;   // 武松神转职 最高攻 +20% 攻击
const dmgAddTotal = panel.dmgAdd + 35;   // 武松3技能 最高攻 +35% 伤害加成

function damage (pinzhi: number,mark: number,reduce = 0): {crit: number; nonCrit: number; k: number; mult: number; buckets: number[]} {
  const e = enemyOf(pinzhi);
  const eDodge = e.dodge - 20;   // 猪八戒3技能 -20 闪避
  const speedDiff = zhenFaID === 8 ? Math.max(0,Math.min(panel.speed - e.speed,2147483646)) : 0;
  const xiXing = Math.trunc(Math.max(0,hitChain - eDodge) * (0.25 + 0.25 * (jibanLevels.get(11) ?? 0)));
  const shenGui = Math.trunc(Math.max(0,panel.dodge - e.hit) * (0.2 + 0.2 * (jibanLevels.get(4) ?? 0)));
  const tujianPct = tuJianLevel(PRESET[pinzhi - 1]!) * markCount;
  const buckets = [
    -30,                                        // 孙悟空3技能 70%
    Math.min(hitChain,2147483637),              // 孙悟空3技能 每 1% 命中 +1% 伤害
    SHENTONG_3 > 0 ? Math.min(hitChain * 1 * SHENTONG_3 / 10,2147483637) : 0,   // 神通15
    SHENTONG_5 * 20,                            // 神通19
    SHENTONG_11 > 0 ? badStacks : 0,            // 神通27
    10 * mark,                                  // 孙悟空3技能 Mark
    speedDiff,                                  // 鸟翔阵
    xiXing,                                     // 西行取经
    shenGui,                                    // 神鬼志异
    tujianPct                                   // 图鉴(研究54)
  ];
  let mult = 1;
  for (const b of buckets) {mult *= (100 + b) / 100;}
  const atk = panel.atkFlat * (100 + atkPctTotal) / 100;
  const k = culK(atk,Math.max(1,e.def - panel.pen));
  const nonCrit = Math.floor(atk * mult * (k / 100) * (100 + dmgAddTotal) / 100 * (100 - reduce) / 100);
  return {buckets,crit: Math.floor(nonCrit * panel.critDamage / 100),k,mult,nonCrit};
}

const YI = 1e20;
const fx = (v: number): string => (v / YI).toFixed(1);
console.log(`\n=== ${String(LAYER)} 层:孙悟空神·人皇印 怒气技能暴击伤害(垓) ===`);
console.log("减伤 0% | 图鉴研究 Lv." + String(keji54) + " | 命中链 " + String(hitChain) + " | 暴击率 " + ((panel.crit - enemyOf(3).critResist + 1) / 101 * 100).toFixed(0) + "% | 暴伤 ×" + (panel.critDamage / 100).toFixed(2));
for (const p of [1,2,3]) {
  const row: string[] = [];
  for (let m = 0; m <= 10; m++) {row.push(fx(damage(p,m).crit));}
  console.log(["小怪","精英","首领"][p - 1]! + ": " + row.map((v,i) => `${String(i)}:${v}`).join("  "));
}
console.log("\n=== 本层波次(%5=0)按出手顺序 === 小怪 小怪 精英 首领 精英");
const order = [1,1,2,3,2];
const seen: Record<number,boolean> = {};
for (let i = 0; i < order.length; i++) {
  const p = order[i]!;
  const d = damage(p,i);
  console.log(`  第${String(i + 1)}个 ${["","小怪","精英","首领"][p]!} Mark${String(i)} → 暴击 ${fx(d.crit)} 垓  (K=${String(d.k)}, 乘区 ${d.buckets.join("/")})`);
  seen[p] = true;
}
const d0 = damage(1,6);
console.log("\n小怪 Mark6 =",fx(d0.crit),"垓;精英 Mark4 =",fx(damage(2,4).crit),"垓;首领 Mark2 =",fx(damage(3,2).crit),"垓");
console.log("观测: 小怪 456 / 精英 317 / 首领 142~148");
