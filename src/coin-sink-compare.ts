/**
 * coin-sink-compare.ts — 同一笔钱币（默认 1 亿）分别买 灵纹 / 御灵宝典 / 春秋蝉，
 * 看哪条对「通天塔 207585 层 · 孙悟空神·人皇印队」的暴击伤害提升最大。
 *
 * 只读存档 + config，价格/产出/升级成本全部按反编译源码：
 *
 * 1. 商店价（PropHelper.cs:40-52 GetCanBuyCount）
 *    价 = Prop.ValueCost × (100 − Mark_Enum.Store_Sell_Price)/100，货币 = AssetType.Money（钱币, 道具80）。
 * 2. 灵纹(7) → 阵法升级（ZhenFaRecorder.cs:34-91）
 *    需求 = Level × 20 灵纹（再按 Mark_Enum.ReDuce_ZhenWen 减免）；
 *    每级给阵法 property_RecordersList 每条 Base_Value += 200 + 35×Level；
 *    阵法属性经 LoadZhenFa 落到主角面板 → 实际增益 = (200+35×Level) × (100+阵法该属性%)/100。
 * 3. 御灵宝典(84) → PropEffect_GetYuLingShiEXP.TrrigerDaily → GameRecorder.ChanYuLi(100)
 *    → **YuLingExp（御灵师经验）** += 100 × (100 + Mark_Enum.AddYuLingShi_EXP)/100；
 *    御灵师升级门槛 CulLevel_Up_Remand() = 100q(q+1) + 20(q+1)r，q=级/10，r=级%10；
 *    每级 ShowAddition 给主角 +等级×250 的生命/攻击/防御/穿透（flat）。
 * 4. 春秋蝉(83) → PropEffect_GetHoursSaoDang.ChuanQiuChan(Params_1×60 = 3600 秒)，
 *    扫荡 48 秒一层 → 75 层/个；每层御力 = GetYuLiDrop(1,false) = ⌊150×1.5⌋×(CurRound+BaseRound+1000)/1000。
 *    注意：御力(道具4/AssetType.YuLi) **不是**御灵师经验，它只用于**英灵升级**
 *    （UIBlock_YingLing_LevelUp：ChangeAssset(AssetType.YuLi, GetLevelUpExp) + Cur_YingLing.LevelUp），
 *    所以这条要按英灵升级算：CharacterHelper.GetLevelUpEXP(级)、ApplyBatchEffects(ATK+24×num)，
 *    且受 Max_Level 上限卡住。
 *
 * 伤害用 damage-formula.ts 的 1:1 管道（同一层、同一队伍、首领 Mark0 暴击期望）重算。
 */

import {readFileSync} from "node:fs";
import {join} from "node:path";
import {BattleDataManager,Prop,formatBigSuoXie} from "./damage-formula.ts";
import {
  damageRangeOf,
  formatSuoXie,
  loadCarryPanel,
  loadSave,
  teamContextOf,
  towerEnemy
} from "./verify-damage.ts";
import type {CarryPanel,SaveBundle} from "./verify-damage.ts";

const SAVE_DIR = String.raw`C:\Users\Administrator\AppData\LocalLow\SkyLight\MoNiShouYou\Save_1`;
const LAYER = 207585;
const MONEY = 1_0000_0000;
const WU_KONG = 26;

const PROP_LING_WEN = 7;
const PROP_CHUN_QIU_CHAN = 83;
const PROP_YU_LING_BAO_DIAN = 84;
const PROP_YU_LI = 4;

// Mark_Enum 索引：11 ReDuce_ZhenWen、17 Reduce_Level_YuLi、29 Store_Sell_Price、33 AddYuLingShi_EXP
const MARK_REDUCE_ZHEN_WEN = 11;
const MARK_REDUCE_LEVEL_YULI = 17;
const MARK_STORE_SELL_PRICE = 29;
const MARK_ADD_YULINGSHI_EXP = 33;

const ZHENFA_COST_PER_LEVEL = 20;
const ZHENFA_ADD_BASE = 200;
const ZHENFA_ADD_PER_LEVEL = 35;
const SAO_DANG_SECONDS_PER_ROUND = 48;
const CHUN_QIU_CHAN_SECONDS = 60 * 60;
const YULINGSHI_ATK_PER_LEVEL = 250;

interface GameRecord {
  CurYuLingShiLv?: number;
  YuLingExp?: number;
  Mark_Manger?: {markRecorders?: {Mark_Enum: number; Count: number}[]};
  assetRecorders?: {AssetType: number; value: number}[];
}

interface YingLingRecord {
  Cur_Level?: number;
  Master_ID?: number;
  Max_Level?: number;
  YingLing_Index?: number;
  zhuanShengManager?: {Cur_ZhuanShenCount?: number; PropertyAddition?: number; ReduceLv_YuLi?: number};
}

function readObjects<T> (file: string): T[] {
  const text = readFileSync(file,"utf8").replace(/^\u{FEFF}/u,"");
  const out: T[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {out.push(JSON.parse(trimmed) as T);}
  }
  return out;
}

/** 道具定义里的 _valueCost = 商店基础价。 */
function valueCostOf (propID: number): number {
  const records = readObjects<{_propID: number; _valueCost: number}>(join(SAVE_DIR,"Prop_Data.Save"));
  return records.find(item => item._propID === propID)?._valueCost ?? 0;
}

/** C# ToolClass.Cul_Percent_ToInt(base, percent, reduce)。 */
function culPercentToInt (base: number,percent: number,reduce: boolean): number {
  return Math.trunc(base * (reduce ? 100 - percent : 100 + percent) / 100);
}

/** GameRecorder.CulLevel_Up_Remand：御灵师升下一级需要的御灵师经验。 */
function yuLingShiLevelUpCost (level: number): number {
  const q = Math.trunc(level / 10);
  const r = level % 10;
  return 100 * q * (q + 1) + 20 * (q + 1) * r;
}

/** CharacterHelper.CalculateValue(level)：英灵升下一级的基础御力需求。 */
function yingLingBaseExp (level: number): number {
  if (level >= 1 && level <= 100) {return 90 + level * 10;}
  if (level > 100 && level <= 1000) {
    const group = Math.trunc(level / 100);
    const value = 1090 * Math.pow(1.5,group - 1);
    const remain = level % 100;
    return remain === 0 ? Math.trunc(value) : Math.trunc(value + remain * (value / 200));
  }
  if (level > 1000) {
    let group = Math.trunc(level / 1000);
    if (group > 25) {group = 25;}
    const value = 41903 * Math.pow(2,group - 1);
    return Math.trunc(value + value * (level % 1000) / 1000);
  }
  return 0;
}

/** Character_YingLing.GetLevelUpExp：再乘两层减免。 */
function yingLingLevelCost (level: number,reduceMark: number,zhuanShengReduce: number): number {
  return Math.trunc(Math.trunc(yingLingBaseExp(level) * (100 - reduceMark) / 100) * (100 - zhuanShengReduce) / 100);
}

/** Character_YingLing.GetLevelUpEffect 的 num：每级属性系数。 */
function yingLingLevelFactor (level: number,zhuanShenCount: number): number {
  const base = Math.trunc(level / 50) + 1;
  return zhuanShenCount > 0 ? Math.trunc(base * (zhuanShenCount * 25 + 100) / 100) : base;
}

/** MapRecorder.GetYuLiDrop(1, false)。 */
function yuLiPerRound (curRound: number,baseRound: number): number {
  return Math.trunc(Math.trunc(150 * (1 + 0.5)) * ((curRound + baseRound + 1000) / 1000));
}

/**
 * TuPoData(属性=速度, Level=御灵师等级/10, PinZhi=4)：速度 flat = 2 + 4×Level×1.75。
 * 源码 TuPoData.cs:42-45；自动升级 UIPanel_AutoLv.cs:107 传 CurYuLingShiLv/10 与品质 4。
 * @param yuLingShiLv 当前御灵师等级.
 * @returns 速度 flat 增量.
 */
function tuPoSpeedGain (yuLingShiLv: number): number {
  return 2 + Math.trunc(4 * Math.trunc(yuLingShiLv / 10) * 1.75);
}

/**
 * 复制面板并给指定面板的攻击/速度 Base_Value 加 flat（模拟升级后的面板）。
 * @param panel 原面板.
 * @param delta 攻击与速度的 flat 增量.
 * @param onMaster true=主角面板，false=孙悟空自身面板.
 * @returns 新面板.
 */
function panelWithAtk (panel: CarryPanel,delta: {atk?: number; speed?: number},onMaster: boolean): CarryPanel {
  const clone = (source: BattleDataManager): BattleDataManager => {
    const manager = new BattleDataManager(panel.percentOf);
    manager.initail(() => 0);
    for (const record of source.list) {
      const target = manager.getData(record.propertyTypeEnum);
      target.baseValue = record.baseValue;
      target.percentAddition = record.percentAddition;
    }
    return manager;
  };
  const master = clone(panel.master);
  const own = clone(panel.source);
  const target = onMaster ? master : own;
  target.getData(Prop.ATK).baseValue += delta.atk ?? 0;
  target.getData(Prop.Speed).baseValue += delta.speed ?? 0;
  return {...panel,master,source:own};
}

/** 图鉴增伤 = 图鉴等级 × 研究54 等级。 */
function tuJianPct (save: SaveBundle,preset: number): number {
  const level = (save.cha.tuJianData_RecordsList ?? []).find(item => item.EnemyIndex === preset)?.Level ?? 0;
  const research = (save.cha.keJi_Recorders ?? []).find(item => item.KeJi_ID === 54)?.KeJi_Level ?? 0;
  return level * research;
}

interface SinkResult {
  /** 面板攻击 flat 增量. */
  atkDelta: number;
  /** 变更说明. */
  detail: string;
  /** 等级变化说明. */
  levels: string;
  /** 加在谁身上. */
  onMaster: boolean;
  /** 面板速度 flat 增量（突破选速度）。 */
  speedDelta: number;
}

function main (): void {
  const save = loadSave(SAVE_DIR);
  const panel = loadCarryPanel(save);
  const team = teamContextOf(save);
  const game = readObjects<GameRecord>(join(SAVE_DIR,"Game_RecordData.Save"))[0];
  if (game === undefined) {throw new Error("读不到 Game_RecordData.Save");}
  const yingLings = readObjects<YingLingRecord>(join(SAVE_DIR,"YingLing_Data.Save"));
  const wuKong = yingLings.find(item => item.YingLing_Index === WU_KONG && item.Master_ID === 1);

  const mark = (index: number): number =>
    (game.Mark_Manger?.markRecorders ?? []).find(item => item.Mark_Enum === index)?.Count ?? 0;
  const discount = mark(MARK_STORE_SELL_PRICE);
  const reduceZhenWen = mark(MARK_REDUCE_ZHEN_WEN);
  const reduceLevelYuLi = mark(MARK_REDUCE_LEVEL_YULI);
  const addYulingShiExp = mark(MARK_ADD_YULINGSHI_EXP);
  const money = (game.assetRecorders ?? []).find(item => item.AssetType === 1)?.value ?? 0;
  const yuLiOwned = (game.assetRecorders ?? []).find(item => item.AssetType === 0)?.value ?? 0;
  const yuLingShiLv = game.CurYuLingShiLv ?? 1;
  const yuLingExp = game.YuLingExp ?? 0;
  const zsCount = wuKong?.zhuanShengManager?.Cur_ZhuanShenCount ?? 0;
  const zsReduce = wuKong?.zhuanShengManager?.ReduceLv_YuLi ?? 0;
  const yingLingLevel = wuKong?.Cur_Level ?? 0;
  const yingLingMax = wuKong?.Max_Level ?? 0;

  const priceOf = (propID: number): number => valueCostOf(propID) * (100 - discount) / 100;

  console.log(`\n=== 钱币去向对比（${formatSuoXie(MONEY)} 钱币 · 通天塔 ${formatSuoXie(LAYER)} 层 · 孙悟空神·人皇印队）===`);
  console.log(
    `存档: 钱币 ${formatSuoXie(money)}  御力 ${formatSuoXie(yuLiOwned)}  商店折扣 ${String(discount)}%  ` +
    `灵纹减免 ${String(reduceZhenWen)}%  御力升级减免 ${String(reduceLevelYuLi)}% + 转生 ${String(zsReduce)}%`
  );
  console.log(
    `孙悟空 Lv.${String(yingLingLevel)} / 上限 Lv.${String(yingLingMax)}  转生 ${String(zsCount)}  御灵师 Lv.${String(yuLingShiLv)}` +
    `（${formatSuoXie(yuLingExp)} 经验，升级需 ${formatSuoXie(yuLingShiLevelUpCost(yuLingShiLv))}）`
  );
  console.log(
    `单价: 灵纹 ${priceOf(PROP_LING_WEN).toFixed(2)}  御灵宝典 ${priceOf(PROP_YU_LING_BAO_DIAN).toFixed(2)}  ` +
    `春秋蝉 ${priceOf(PROP_CHUN_QIU_CHAN).toFixed(2)} 钱币`
  );

  const tuJian = tuJianPct(save,15);
  const baseRange = damageRangeOf("tower",LAYER,panel,towerEnemy(LAYER,3),team,{mark:0,tuJianDamagePct:tuJian});
  console.log(
    `\n基准（首领 Mark0，图鉴增伤 ${String(tuJian)}%）: 面板攻击 ${formatBigSuoXie(baseRange.atkForK)}` +
    `  暴击期望 ${formatBigSuoXie(baseRange.crit)}`
  );

  const results: {detail: string; name: string; result: SinkResult}[] = [];

  // ① 灵纹 → 阵法等级 → 主角面板攻击
  const zhenFaID = save.cha.CurZhenFa ?? 0;
  const zhenFa = (save.cha.zhenFaRecorders ?? []).find(item => item.ZhenFaID === zhenFaID);
  if (zhenFa !== undefined) {
    const atkRecord = (zhenFa.property_RecordersList ?? []).find(item => item.PropertyTypeEnum === Prop.ATK);
    const atkFactor = (100 + (atkRecord?.PercentAddition ?? 0)) / 100;
    let mats = Math.floor(MONEY / priceOf(PROP_LING_WEN));
    const bought = mats;
    let level = zhenFa.Level;
    const startLevel = level;
    let delta = 0;
    while (true) {
      const need = Math.max(1,culPercentToInt(level * ZHENFA_COST_PER_LEVEL,reduceZhenWen,true));
      if (mats < need) {break;}
      mats -= need;
      delta += (ZHENFA_ADD_BASE + ZHENFA_ADD_PER_LEVEL * level) * atkFactor;
      level += 1;
    }
    results.push({
      detail:`${formatSuoXie(bought)} 灵纹（每级 ${String(ZHENFA_COST_PER_LEVEL)}×等级，减${String(reduceZhenWen)}%）→ 阵法属性 ×${atkFactor.toFixed(2)}`,
      name:  `灵纹（${String(zhenFaID)} 号阵升级）`,
      result:{atkDelta:delta,detail:"",levels:`Lv.${String(startLevel)} → Lv.${String(level)}`,onMaster:true,speedDelta:0}
    });
  }

  // ② 御灵宝典 → 御灵师经验 → 御灵师等级（+四维 flat）＋每 10 级一次突破（可选速度）
  {
    const count = Math.floor(MONEY / priceOf(PROP_YU_LING_BAO_DIAN));
    const gain = culPercentToInt(count * 100,addYulingShiExp,false);
    let exp = yuLingExp + gain;
    let level = yuLingShiLv;
    const startLevel = level;
    let atk = 0;
    let speed = 0;
    let tuPo = 0;
    while (exp >= yuLingShiLevelUpCost(level)) {
      exp -= yuLingShiLevelUpCost(level);
      // PinJing：等级是 10 的倍数时先突破，再升级（GameRecorder.cs:671-712）
      if (level % 10 === 0) {
        speed += tuPoSpeedGain(level);
        tuPo += 1;
      }
      atk += level * YULINGSHI_ATK_PER_LEVEL;
      level += 1;
    }
    results.push({
      detail:`${formatSuoXie(count)} 御灵宝典 → ${formatSuoXie(gain)} 御灵师经验（Mark33 +${String(addYulingShiExp)}%）；` +
        `升级 +等级×${String(YULINGSHI_ATK_PER_LEVEL)} 攻击，另 ${String(tuPo)} 次突破（选速度，品质4）`,
      name:  "御灵宝典（御灵师+突破）",
      result:{atkDelta:atk,detail:"",levels:`Lv.${String(startLevel)} → Lv.${String(level)}`,onMaster:true,speedDelta:speed}
    });
  }

  // ③ 春秋蝉 → 扫荡御力 → 英灵升级 → 孙悟空自身面板攻击
  {
    const count = Math.floor(MONEY / priceOf(PROP_CHUN_QIU_CHAN));
    const rounds = count * (CHUN_QIU_CHAN_SECONDS / SAO_DANG_SECONDS_PER_ROUND);
    const perRound = yuLiPerRound(LAYER,1500);
    let yuLi = rounds * perRound;
    let level = yingLingLevel;
    const startLevel = level;
    let delta = 0;
    while (level < yingLingMax) {
      const need = yingLingLevelCost(level,reduceLevelYuLi,zsReduce);
      if (need <= 0 || yuLi < need) {break;}
      yuLi -= need;
      delta += 24 * yingLingLevelFactor(level,zsCount);
      level += 1;
    }
    results.push({
      detail:`${formatSuoXie(count)} 春秋蝉 → ${formatSuoXie(rounds)} 层（每层 ${formatSuoXie(perRound)} 御力）= ${formatSuoXie(rounds * perRound)} 御力；` +
        `英灵升级每级 +24×系数 攻击，但上限 Lv.${String(yingLingMax)}`,
      name:  "春秋蝉（扫荡换御力）",
      result:{atkDelta:delta,detail:"",levels:`Lv.${String(startLevel)} → Lv.${String(level)}`,onMaster:false,speedDelta:0}
    });
  }

  console.log(`\n每层扫荡御力 = ${formatSuoXie(yuLiPerRound(LAYER,1500))}（GetYuLiDrop(1,false)：CurRound ${String(LAYER)} + BaseRound 1500 + 1000）`);
  console.log("\n方案                         等级变化              攻击 flat     速度 flat    面板攻击     暴击期望     提升");
  const baseCrit = Number(baseRange.crit);
  for (const {detail,name,result} of results) {
    const adjusted = panelWithAtk(panel,{atk:result.atkDelta,speed:result.speedDelta},result.onMaster);
    const range = damageRangeOf("tower",LAYER,adjusted,towerEnemy(LAYER,3),team,{mark:0,tuJianDamagePct:tuJian});
    const gain = Number(range.crit) / baseCrit - 1;
    console.log(
      `${name.padEnd(24)}  ${result.levels.padEnd(20)}  ${formatSuoXie(result.atkDelta).padStart(10)}  ` +
      `${formatSuoXie(result.speedDelta).padStart(10)}  ${formatBigSuoXie(range.atkForK).padStart(10)}  ` +
      `${formatBigSuoXie(range.crit).padStart(10)}  ${(gain * 100).toFixed(2).padStart(7)}%`
    );
    console.log(`  ${detail}`);
  }

  console.log(
    "\n注：① 灵纹只加阵法四维里的攻击（生命/防御/穿透对伤害无用），提升率≈攻击面板提升率；" +
    "\n    ② 御灵宝典给的是**御灵师经验**（ChanYuLi→YuLingExp），不是御力；御灵师每 10 级一次突破，" +
    "\n       突破选速度时 TuPoData.cs:42-45 给 2+4×(等级/10)×品质系数 的**速度 base**，" +
    "\n       再被主角 109% 速度% 放大 2.09 倍 —— 这条才是「宝典→速度」的真实通道（脚本按自动升级品质4 计）；" +
    "\n    ③ 春秋蝉的御力只喂英灵升级，而孙悟空已到 Lv." + String(yingLingMax) + " 上限，" +
    "\n       每级还要 3.8e9 御力，所以基本换不出伤害；它真正值钱的是 Map_Data.LouLouDrop 的寒铁（未导出，未计入）；" +
    "\n    ④ 突破需要把自动升级的目标属性设成速度（PlayerSetting_OnGame.ChooseProperty），手动突破是 3 选 1 且品质随机（68%/20%/9%/3%）。"
  );
}

main();
