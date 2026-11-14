/**
 * zhanli-panel.ts — 存档主角面板 → 终局第 5 层输出的共享计算,被 coin-to-zhanli / composite-compare 复用.
 * 把存档主角(Cha_Data.Save,默认 Save_1,支持 --save=N / --dir)的 BattleData_Manager 摊成 18 项
 * Base_Value / PercentAddition 两层,再以终局第 5 层(tiaoZhanID=5)敌人为目标算单次输出.
 * 不写游戏目录(DESIGN.md:80,83);敌人属性由 enemy-stats.ts 按反编译口径算好(DESIGN.md:90),不另写常量;
 * 命中率固定 1(默认能打中),不算敌方 HP;暴击率按 (暴击−敌抗暴+1)/101 计算,
 * 只有 ≥100% 必暴时才乘暴伤,否则按非暴击,不做暴击率期望(DESIGN.md:96).
 */
import {readFileSync} from "node:fs";
import {PROPERTY_TO_KEY} from "./data.ts";
import {loadSave,parseArgs,resolveSaveDir} from "./readSave.ts";
import {ZHONG_JU} from "./scripts/enemy-stats.ts";
import {oneShotDamage} from "./scripts/game-formulas.ts";

export const PROP_COUNT = 18;
export const PROPERTY_CONFIG = JSON.parse(
  readFileSync(new URL("./config/property.json",import.meta.url),"utf8")
) as {percent: number; type: number}[];
export const PERCENT_PROPS = new Set(PROPERTY_CONFIG.filter(item => item.percent === 1).map(item => item.type));
export const KEY_TO_PROP: Record<string,number> = Object.fromEntries(
  Object.entries(PROPERTY_TO_KEY).map(([prop,key]) => [key,Number(prop)])
);

// 终局第 5 层 = config/zhongju.json 的 tiaoZhanID=5;属性由 enemy-stats.ts 按反编译口径算好(DESIGN.md:90).
export function getZhongJu5 (): (typeof ZHONG_JU)[number] {
  const enemy = ZHONG_JU.find(item => item.tiaoZhanID === 5);
  if (enemy === undefined) {
    throw new Error("config/zhongju.json 里没有 tiaoZhanID=5 的终局敌人");
  }
  return enemy;
}
export const ENEMY_5 = getZhongJu5();

export interface MasterPanel {
  base:     number[];
  dir:      string;
  pct:      number[];
  zhenFaID: number;
}

/**
 * 只读存档(默认 Save_1,支持 --save=N / --dir),把主角 Cha_Data 的 BattleData_Manager
 * 摊成 18 项 Base_Value / PercentAddition 两层;不写游戏目录(DESIGN.md:80,83).
 */
export function loadMasterPanel (): MasterPanel {
  const args = parseArgs(process.argv.slice(2));
  const dir = resolveSaveDir(args);
  const save = loadSave(dir);
  const base = new Array<number>(PROP_COUNT).fill(0);
  const pct = new Array<number>(PROP_COUNT).fill(0);
  for (const item of save.cha.BattleData_Manager?.battleData_Recorders_List ?? []) {
    const prop = item.PropertyTypeEnum;
    if (prop < 0 || prop >= PROP_COUNT) {
      continue;
    }
    base[prop] = item.Base_Value;
    pct[prop] = item.PercentAddition;
  }
  return {base,dir,pct,zhenFaID: save.cha.CurZhenFa ?? 0};
}

/**
 * BattleData_Recorder.GetFinal + BattleData_Manager.GetFinalValue(power-value.ts:341-351 同口径):
 * percent=1 的属性直接取 Base_Value,其余取 Base×(100+PercentAddition)/100.
 */
export function finalValue (panel: MasterPanel,prop: number): number {
  const base = panel.base[prop] ?? 0;
  const pct = panel.pct[prop] ?? 0;
  return PERCENT_PROPS.has(prop) ? Math.max(0,base) : Math.round(base * (100 + pct) / 100);
}

/**
 * 把 tozhanli 返回的 18 项增量叠加到 base 层:字段名经 PROPERTY_TO_KEY 反查枚举,
 * 百分比点数(命中/暴击/伤害加成等)与固定值(攻/防/血/速/穿透)都加在 Base_Value 上,
 * 再由 finalValue 统一乘 PercentAddition,避免把固定值增量当成最终值直接相加.
 */
export function panelWithResult (panel: MasterPanel,result: object): MasterPanel {
  const base = [...panel.base];
  for (const [key,value] of Object.entries(result)) {
    const prop = KEY_TO_PROP[key];
    if (prop !== undefined && typeof value === "number" && Number.isFinite(value)) {
      base[prop] = (base[prop] ?? 0) + value;
    }
  }
  return {base,dir: panel.dir,pct: panel.pct,zhenFaID: panel.zhenFaID};
}

/**
 * 单次输出:命中率固定 1、不算敌方 HP;暴击率按 power-value.ts:292 的 (暴击−敌抗暴+1)/101
 * (阵法6 同 :289-291 另给 +30),只有 ≥100% 必暴时才把 暴伤/100 放进百分比乘区,否则按非暴击.
 * atk 已是 final 值,所以 atkPct=100、skillMult=1;K 由 oneShotDamage 内部按实际攻击与敌防御算(DESIGN.md:96).
 */
export function calcOutput (panel: MasterPanel): {damage: number; mustCrit: boolean} {
  const atk = finalValue(panel,0);
  const pen = finalValue(panel,15);
  const baoJi = finalValue(panel,6);
  const baoJiDamage = finalValue(panel,8);
  const dmgAdd = finalValue(panel,13);
  const critAdd = panel.zhenFaID === 6 ? 30 : 0;
  const critRate = Math.max(0,Math.min(1,(baoJi - ENEMY_5.critResist + critAdd + 1) / 101));
  const mustCrit = critRate >= 1;
  const damage = oneShotDamage(atk,ENEMY_5,{
    atkPct:    100,
    dmgAdd,
    pctBucket: mustCrit ? baoJiDamage / 100 : 1,
    skillMult: 1,
    pen
  });
  return {damage,mustCrit};
}
