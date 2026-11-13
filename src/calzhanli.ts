/**
 * calzhanli.ts — 挂机手游养成模拟与「材料 → 战力」计算(只 import data.ts)
 * 全部映射表,固定口径常量与类型定义已集中到 data.ts,口径出处逐条写在 data.ts 里.
 * 口径来源(反编译)摘要:
 * - 波次构成:MapRecorder.GetEnemyCount(MapRecorder.cs:159-186),按 CurRound % 5 给 5 个站位
 * - 每只怪掉落:MapRecorder.GetDrop(MapRecorder.cs:208-240)；死亡时逐只结算(Battle_Character_Info.cs:281-285)
 * - 幸运/掉率:Drop_Recorder.GetTrueDrop(Drop_Recorder.cs:37-45),概率 = min(1000, round(概率‰×(100+加成)/100))
 * - 御力:MapRecorder.GetYuLiDrop(MapRecorder.cs:326-339)
 * - 研究额外掉落:MapRecorder.KeJiDrop(MapRecorder.cs:242-318)
 * - 扫荡:MapRecorder.AddTimer / CulSaoDangShouYi(MapRecorder.cs:66-97)
 * - VIP:VIPHelper.GetEffect(VIPHelper.cs:15-34)
 * - 万魂帆:Entry_WanHunFan(Entry_WanHunFan.cs:14)
 * - 百分比取整:ToolClass.Cul_Percent_ToInt(ToolClass.cs:107-117)
 * 已确认的初始数值:
 * - CurRound 从 1 起,每清一波 +1
 * - 一次执行 = 清一波 5 只；怒气 1.1 秒/波,普攻 0.85 秒/波(含完整周期,不再加 1 秒)
 * - 研究 64 个节点全部满级
 * - 幸运 = 50000 基础 + 研究 14 的 10 = 50010
 * - VIP 16；翅膀等级,万魂帆等级为参数,默认 0
 * - 5 图 × 3 品质的真实掉落表全部内联；幸运 50010 时所有条目都封顶 1000‰,必掉
 */
import { BOOK_YULI_BASE, CRAFT_EXP_BASE, EMPTY_PERCENT_PROPERTIES, EMPTY_PROPERTIES, EQUIP_BASE, EQUIP_CI_TIAO_POOL, EQUIP_PER_LEVEL, EQUIP_PINZHI, EQUIP_PINZHI_FACTOR, EQUIP_PINZHI_PER_LEVEL, EQUIP_RANDOM_AVG, EQUIP_SLOT_COUNT, LIANQI_START_EXP, LIANQI_START_LEVEL, LUCKY, MAKE_EQUIP_COST_CAP, MAP_EFFECT, MAPS, MATERIAL_COST_PER_UNIT, NORMAL_SECONDS, PERCENT_BASE, POJING_COST_PER_100_LEVEL, POJING_MAX_LEVEL_STEP, POJING_STAR_DIVISOR, POJING_STAR_PCT_CAP, POJING_STAR_PCT_PER_STEP, POJING_START_MAX_LEVEL, POJING_START_STAR, POJING_YINGLING_COUNT, PROP_NAMES, PROPERTY_TO_KEY, QIDING_LEVEL_CAP, QIDING_START_LEVEL, QILU_COST_BASE, QILU_TIER_SIZE, RAGE_SECONDS, RESEARCH, RESEARCH_15_HANTIE_REDUCE, RESEARCH_16_EXP_ADD, RESEARCH_18_EQUIP_ADD, RESEARCH_20_WUCAI_REDUCE, RESEARCH_24_RONGLIAN_ADD, RESEARCH_25_STRENGTH_REDUCE, RESEARCH_26_LINGWEN_REDUCE, RESEARCH_34_POJING_REDUCE, RESEARCH_35_SHENTONG_REDUCE, RESEARCH_48_BOOK_EXP_ADD, RONGLIAN_LEVEL_DIVISOR, SAO_DANG_REMAIN_TIMER, SECONDS_PER_HOUR, SHEN_BING_COST_CAP, SHEN_BING_COST_PER_LEVEL, SHEN_BING_FIRE_HIT_TRACKS, SHEN_BING_MAX_LV, SHEN_BING_WATER_CRIT_TRACKS, SHEN_BING_WATER_DAMAGE_TRACKS, SHEN_TONG_COST_BY_PINZHI, SHEN_TONG_ENTRY_EFFECT, SHEN_TONG_NODES, SHEN_TONG_PROPERTY_EFFECT, SHENG_SHOU_ADD_BASE, SHENG_SHOU_ADD_PER_LEVEL, SHENG_SHOU_COST_BASE, SHENG_SHOU_COST_CAP, SHENG_SHOU_COST_PER_LEVEL, SHENG_SHOU_LEVEL_CAP, SHENG_SHOU_MAX_ROUND, SHENG_SHOU_SPECIAL_CYCLE, SHENG_SHOU_START_LEVEL, START_ROUND, STRENGTH_ADD_BASE, STRENGTH_ADD_PER_LEVEL, STRENGTH_COST_BASE, STRENGTH_COST_CAP, STRENGTH_COST_MIN, STRENGTH_COST_PER_LEVEL, STRENGTH_HIGH_MULTIPLIER, STRENGTH_HIGH_THRESHOLD, VIP_PERCENT_ADD_COUNT, VIP_SAO_DANG_SPEED, VIP_YU_LI_DROP, WAVE_COMPOSITION, WING_EXP_PER_LEVEL, WING_FLAT_BASE, WING_FLAT_PER_LEVEL, YULING_LEVEL_CAP, YULINGSHI_START_EXP, YULINGSHI_START_LEVEL, ZHENFA_ADD_BASE, ZHENFA_ADD_PER_LEVEL, ZHENFA_COST_PER_LEVEL, ZHENFA_LEVEL_CAP, ZHENFA_START_LEVEL, ZHENFA_UNLOCK_COST, ZHENFA_UNLOCK_COUNT, ZHUANZHI_ADD_BASE, ZHUANZHI_ADD_PER_LEVEL, ZHUANZHI_COST_BASE, ZHUANZHI_COST_PER_LEVEL, ZHUANZHI_LEVEL_CAP, ZHUANZHI_SPEED_PER_LEVEL, ZHUANZHI_START_LEVEL } from './data.ts';
import type { AllProperties, CiTiaoPercentKey, DropRow, EquipStrengthenResult, FarmModeResult, FarmResult, HantieToZhanliResult, MapConfig, MapID, ResearchReduce, SweepResult, SystemGain, ToZhanliResult } from './data.ts';

// 保持原有对外类型/常量可用(data.ts 是唯一依赖).
export type {
  AllProperties,EquipStrengthenResult,FarmModeResult,FarmResult,HantieToZhanliResult,
  MapID,ResearchReduce,SweepResult,SystemGain,ToZhanliResult
};
export {MATERIAL_COST_PER_UNIT};

// #endregion
// #region 材料 → 战力(11 个 tozhanli)
// ============================== 寒铁 → 战力(完整制造模拟,18 属性全量 + 词条百分比) ==============================
// 固定口径:研究全部点满(config/keji.json),初始炼器 Lv.1/经验 0,器鼎 Lv.1700,品质 15,10 槽各 1 件.
// 计算顺序:① 五彩神石把器鼎从 1700 继续往上顶 → 最终器鼎等级;
// ② 寒铁按源码逐级模拟制造 → 最终炼器等级 + 制造次数 + 熔炼强化石;
// ③ 10 件装备主属性按最终等级算;④ 翅膀加成按制造次数累计;
// ⑤ 每件装备固定带该槽全部 5 条词条(共 50 条):13 项固定值合并,5 项百分比单列.
// 本文件只 import data.ts;所有数值只取反编译源码与 config 导出,出处逐条标注.
/**
 * 投入寒铁(配合五彩神石,翅膀等级)后的完整制造模拟,单层返回 18 项固定值 + 5 项词条百分比.
 * 词条口径:每件装备固定带该槽全部 5 条(共 50 条),词条值 = 品质 15.
 * - 攻/防/血/速/穿透 这 5 项在源码里走 PercentAddition(真百分比),单独放在 atkPercent 等字段,不乘进固定值;
 * - 其余 13 项在源码里走 Base_Value += 15(固定值,UI 显示的 "%" 只是文案),直接加到同名属性.
 * 固定值 = 装备主属性(10 槽各 1 件) + 翅膀固定值(按制造次数累计) + 高级词条固定值.
 * @param hantie 投入的寒铁数量
 * @param wingLevel 翅膀 Wing_CB_2 印记等级(0 = 没翅膀)
 * @param wucaiStones 投入的五彩神石数量(把器鼎从 Lv.1700 继续升级;默认 0 即保持 1700)
 */
export function hantieTozhanli (
  hantie: number,
  wingLevel: number,
  wucaiStones = 0
): HantieToZhanliResult {

  // ① 器鼎:从 Lv.1700 起用五彩神石逐级往上顶(lianqi.ts:72-76,研究20 满 -50%)
  const qiluCost = (level: number): number => Math.max(
    1,
    Math.round(QILU_COST_BASE * (Math.trunc((level - 1) / QILU_TIER_SIZE) + 1)
      * (PERCENT_BASE - RESEARCH_20_WUCAI_REDUCE) / PERCENT_BASE)
  );
  let qidingLevel = QIDING_START_LEVEL;
  let wucaiLeft = wucaiStones;
  while (wucaiLeft >= qiluCost(qidingLevel)) {
    wucaiLeft -= qiluCost(qidingLevel);
    qidingLevel += 1;
  }

  // ② 寒铁单次消耗(PropHelper.cs:487-505 GetRemandMat):先 200 万封顶 → 研究15 满 -50% 四舍五入 → 下限 1 → 再 200 万封顶
  // Cul_Percent_ToInt 用 MidpointRounding.AwayFromZero(ToolClass.cs:107-117),对正数等价于 Math.round
  const hantieCost = (level: number): number => {
    const capped = Math.min(MAKE_EQUIP_COST_CAP,level);
    const discounted = Math.round(capped * (PERCENT_BASE - RESEARCH_15_HANTIE_REDUCE) / PERCENT_BASE);
    return Math.max(1,Math.min(MAKE_EQUIP_COST_CAP,discounted));
  };

  // 每级升级门槛(PropHelper.cs:467-476 GetLianQiLevelUpExp)
  const LV_10 = 10; const LV_20 = 20; const LV_30 = 30; const LV_40 = 40;
  const LV_10_PER = 20; const LV_20_BASE = 200; const LV_20_PER = 50;
  const LV_30_BASE = 700; const LV_30_PER = 100;
  const LV_40_BASE = 1700; const LV_40_PER = 200;
  const LV_40_PLUS_BASE = 3700; const LV_40_PLUS_PER = 300;
  const needExp = (level: number): number => {
    if (level <= LV_10) {return level * LV_10_PER;}
    if (level < LV_20) {return LV_20_BASE + LV_20_PER * (level - LV_10);}
    if (level < LV_30) {return LV_30_BASE + LV_30_PER * (level - LV_20);}
    if (level >= LV_40) {return LV_40_PLUS_BASE + LV_40_PLUS_PER * (level - LV_40);}
    return LV_40_BASE + LV_40_PER * (level - LV_30);
  };

  // ③ 经验倍率:翅膀 >0 时整行覆盖研究16(NPC_EquipManager.cs:141-149),不是叠加
  const expScale = (wingLevel > 0 ? PERCENT_BASE + WING_EXP_PER_LEVEL * wingLevel : PERCENT_BASE + RESEARCH_16_EXP_ADD) / PERCENT_BASE;

  // ④ 逐级模拟制造:每次按当时的炼器等级扣寒铁,结算经验,连升等级
  // 同时记录每件装备的等级(源码 GenrateRandomEquip 在 AddLianQiExp 之前,故装备等级 = 升级前的炼器等级)
  // 滑动窗口保留最后造的 10 件留身上;更早的每件计入熔炼:⌊等级/5⌋ + 品质(GameRecorder.cs:394)
  let lianqiLevel = LIANQI_START_LEVEL;
  let lianqiExp = LIANQI_START_EXP;
  let hantieLeft = hantie;
  let craftCount = 0;
  let ronglianSum = 0;    // 可熔炼装备的 ⌊等级/5⌋+品质 逐件累计
  let ronglianCount = 0;  // 被熔炼件数
  const wornLevels: number[] = []; // 最后造的 10 件(留身上,不熔炼)
  while (hantieLeft >= hantieCost(lianqiLevel)) {
    hantieLeft -= hantieCost(lianqiLevel);
    craftCount += 1;
    wornLevels.push(lianqiLevel);
    if (wornLevels.length > EQUIP_SLOT_COUNT) {
      const older = wornLevels.shift() ?? 0;
      ronglianSum += Math.trunc(older / RONGLIAN_LEVEL_DIVISOR) + EQUIP_PINZHI;
      ronglianCount += 1;
    }
    lianqiExp += (CRAFT_EXP_BASE + lianqiLevel) * expScale;
    while (lianqiExp >= needExp(lianqiLevel)) {
      lianqiExp -= needExp(lianqiLevel);
      lianqiLevel += 1;
    }
  }

  // 整批求和后一次性乘 (100+研究24)/100,只取整一次(GetRongLianEnding :401-402)
  const ronglianStones = Math.round(ronglianSum * (PERCENT_BASE + RESEARCH_24_RONGLIAN_ADD) / PERCENT_BASE);

  // ⑤ 单件装备主属性(品质固定 15);源码 :399-401 把 HP/DEF 覆盖成与 ATK 相同的 value,故三条数值相同
  const additionPct = RESEARCH_18_EQUIP_ADD + qidingLevel + lianqiLevel; // GetEqui_PropertyAddition(研究18 + 器鼎 + 炼器)
  const equipPropMul = (additionPct + PERCENT_BASE) / PERCENT_BASE;       // :395 num
  const singleValue = (EQUIP_BASE + EQUIP_PER_LEVEL * lianqiLevel
    + EQUIP_PINZHI_PER_LEVEL * EQUIP_PINZHI * lianqiLevel)
    * (EQUIP_PINZHI_FACTOR * EQUIP_PINZHI + 1) * EQUIP_RANDOM_AVG * equipPropMul;
  const slotTotal = singleValue * EQUIP_SLOT_COUNT; // 10 槽各 1 件

  // ⑥ 翅膀:每造 1 件给 HP/ATK/DEF/无视防御 各 +(75 + 25×等级),按制造次数累计(源码 if num>0 才生效)
  const wingFlat = wingLevel > 0 ? craftCount * (WING_FLAT_BASE + WING_FLAT_PER_LEVEL * wingLevel) : 0;

  // ⑦ 词条:每件装备固定带该槽全部 5 条(用户口径),词条值 = 品质 15;10 槽各 1 件 → 共 50 条.
  // 固定值类 13 项直接累加到同名属性;百分比类 5 项单独累加到 xxxPercent,不与固定值相加.
  const ciTiaoFixed: AllProperties = {
    atk:            0,
    baoJi:          0,
    baoJiDamage:    0,
    baoJiResist:    0,
    damageAddition: 0,
    damageReduce:   0,
    def:            0,
    fanJi:          0,
    hp:             0,
    ignoreDef:      0,
    lianJi:         0,
    lucky:          0,
    mingZhong:      0,
    recovery:       0,
    returnDamage:   0,
    shanBi:         0,
    speed:          0,
    xiXie:          0
  };
  const ciTiaoPercent: Record<CiTiaoPercentKey,number> = {atk: 0,def: 0,hp: 0,ignoreDef: 0,speed: 0};
  for (const pool of EQUIP_CI_TIAO_POOL) {
    for (const key of pool) {
      if (isCiTiaoPercentKey(key)) {
        ciTiaoPercent[key] += EQUIP_PINZHI;
      } else {
        ciTiaoFixed[key] += EQUIP_PINZHI;
      }
    }
  }

  // ⑧ 单层返回:18 项固定值 = 装备主属性 + 翅膀固定值 + 高级词条固定值(攻/防/血/穿透词条是百分比,不进固定值)
  return {
    atk:              slotTotal + wingFlat,
    atkPercent:       ciTiaoPercent.atk,
    baoJi:            ciTiaoFixed.baoJi,
    baoJiDamage:      ciTiaoFixed.baoJiDamage,
    baoJiResist:      ciTiaoFixed.baoJiResist,
    craftCount,
    damageAddition:   ciTiaoFixed.damageAddition,
    damageReduce:     ciTiaoFixed.damageReduce,
    def:              slotTotal + wingFlat,
    defPercent:       ciTiaoPercent.def,
    fanJi:            ciTiaoFixed.fanJi,
    finalLianqiExp:   lianqiExp,
    finalLianqiLevel: lianqiLevel,
    finalQidingLevel: qidingLevel,
    hantieLeft,
    hantieUsed:       hantie - hantieLeft,
    hp:               slotTotal + wingFlat,
    hpPercent:        ciTiaoPercent.hp,
    ignoreDef:        wingFlat, // 装备主属性不含穿透,只有翅膀给固定值;穿透词条是百分比,见 ignoreDefPercent
    ignoreDefPercent: ciTiaoPercent.ignoreDef,
    lianJi:           ciTiaoFixed.lianJi,
    lucky:            ciTiaoFixed.lucky,
    mingZhong:        ciTiaoFixed.mingZhong,
    recovery:         ciTiaoFixed.recovery,
    returnDamage:     ciTiaoFixed.returnDamage,
    ronglianCount,
    ronglianStones,
    shanBi:           ciTiaoFixed.shanBi,
    speed:            0,
    speedPercent:     ciTiaoPercent.speed,
    wucaiLeft,
    wucaiUsed:        wucaiStones - wucaiLeft,
    xiXie:            ciTiaoFixed.xiXie
  };
}

// ============================== 灵晶 → 解锁阵法 + 圣兽3(青龙) ==============================
/**
 * 灵晶投入的完整模拟:先按 ZhenFaRecorder.GetJieSuoRemand(:29-32) 每个阵法 100 个解锁 9 个阵法(共 900),
 * 剩余全部投圣兽3 青龙(ShengShou_Record.cs:33-57,65-95),两条属性 = 攻击/防御(DESIGN.md).
 * 圣兽从 Lv.0 起,每级消耗 min(50000,10+10L),每级攻/防各 +(20+50L) 固定值;
 * 每升到 1,251,501... 级给 Property3 +1%(源码 (CurStrength+249)%250==0),记在 specialPercent.
 * 等级上限取通天塔 1 万层 maxRound(CheckMaxOK :166-174);阵法解锁数不单列,消耗已计入 used.
 * @param lingjing 投入的灵晶数量
 */
export function lingjingTozhanli (lingjing: number): ToZhanliResult {
  const result = emptyToZhanli();
  const material = assertMaterial(lingjing,"灵晶");
  let left = material;
  let unlocked = 0;
  while (unlocked < ZHENFA_UNLOCK_COUNT && left >= ZHENFA_UNLOCK_COST) {
    left -= ZHENFA_UNLOCK_COST;
    unlocked += 1;
  }
  let level = SHENG_SHOU_START_LEVEL;
  const cap = Math.min(SHENG_SHOU_MAX_ROUND,SHENG_SHOU_LEVEL_CAP);
  while (level < cap) {
    const cost = Math.max(1,Math.min(SHENG_SHOU_COST_CAP,
      SHENG_SHOU_COST_BASE + SHENG_SHOU_COST_PER_LEVEL * level));
    if (left < cost) {
      break;
    }
    left -= cost;
    const add = SHENG_SHOU_ADD_BASE + SHENG_SHOU_ADD_PER_LEVEL * level;
    result.atk += add;
    result.def += add;
    level += 1;
    if (level % SHENG_SHOU_SPECIAL_CYCLE === 1) {
      result.specialPercent += 1;
    }
  }
  result.count = unlocked + level - SHENG_SHOU_START_LEVEL;
  result.finalLevel = level;
  result.left = left;
  result.maxLevel = cap;
  result.used = material - left;
  return result;
}

// ============================== 灵纹 → 阵法等级 ==============================
/**
 * 灵纹投入阵法升级(ZhenFaRecorder.cs:22-40,82-91,93-129)的完整模拟.
 * 固定口径:阵法 Lv.1,四维初始各 500(初始态,不计入增量),只算 1 个上阵阵法,研究26 满 -50%.
 * 每级消耗 round(L×20×0.5)(CulMaxLevelUpTimes 的 clamp [1,2147483646]),
 * 每级 HP/ATK/DEF/穿透 各 +(200+35L) 固定值(:85-89).
 * 研究 27/28/29 的攻/防/穿 +100% 属初始态 PercentAddition,不重复计入本次增量.
 * @param lingwen 投入的灵纹数量
 */
export function lingwenTozhanli (lingwen: number): ToZhanliResult {
  const result = emptyToZhanli();
  const material = assertMaterial(lingwen,"灵纹");
  let level = ZHENFA_START_LEVEL;
  let left = material;
  let count = 0;
  while (level < ZHENFA_LEVEL_CAP) {
    const cost = Math.max(1,Math.min(ZHENFA_LEVEL_CAP,culPercentToInt(
      Math.min(ZHENFA_LEVEL_CAP,level * ZHENFA_COST_PER_LEVEL),
      -RESEARCH_26_LINGWEN_REDUCE)));
    if (left < cost) {
      break;
    }
    left -= cost;
    const add = ZHENFA_ADD_BASE + ZHENFA_ADD_PER_LEVEL * level;
    result.atk += add;
    result.def += add;
    result.hp += add;
    result.ignoreDef += add;
    level += 1;
    count += 1;
  }
  result.count = count;
  result.finalLevel = level;
  result.left = left;
  result.maxLevel = ZHENFA_LEVEL_CAP;
  result.used = material - left;
  return result;
}

// ============================== 历史本纪 → 转职强化 ==============================
/**
 * 历史本纪投入转职强化(ZhuanZhiManager.cs:16-39,79-130)的完整模拟.
 * 固定口径:研究已点满,不再扣 309,665 研究消耗；转职强化从 Lv.0 起.
 * 每级消耗 10+10L 个历史本纪(源码 GetStrengthRemand 直接 new PropRecorder(9,num),无研究减免),
 * 每级 HP/ATK/DEF/穿透 各 +(20+50L) 固定值,速度 +1(:21-33).
 * @param history 投入的历史本纪数量
 */
export function lishibenjiTozhanli (history: number): ToZhanliResult {
  const result = emptyToZhanli();
  const material = assertMaterial(history,"历史本纪");
  let level = ZHUANZHI_START_LEVEL;
  let left = material;
  let count = 0;
  while (level < ZHUANZHI_LEVEL_CAP) {
    const cost = Math.max(1,Math.min(ZHUANZHI_LEVEL_CAP,
      ZHUANZHI_COST_BASE + ZHUANZHI_COST_PER_LEVEL * level));
    if (left < cost) {
      break;
    }
    left -= cost;
    const add = ZHUANZHI_ADD_BASE + ZHUANZHI_ADD_PER_LEVEL * level;
    result.atk += add;
    result.def += add;
    result.hp += add;
    result.ignoreDef += add;
    result.speed += ZHUANZHI_SPEED_PER_LEVEL;
    level += 1;
    count += 1;
  }
  result.count = count;
  result.finalLevel = level;
  result.left = left;
  result.maxLevel = ZHUANZHI_LEVEL_CAP;
  result.used = material - left;
  return result;
}

// #endregion
// #region 单级对比与兑换
// 通用函数:给定「每材料数量 quantity」(默认 1,即每一个),返回各材料消耗的钱币(含 30% 研究减免,保留小数点,不取整).
// 直接基于已写死的 MATERIAL_COST_PER_UNIT(单价 × 0.7) 推算,无需 COIN_RATE 中间量.
export function materialCost (quantity = 1): Record<string,number> {
  const result: Record<string,number> = {钱币: quantity};  // 钱币本身:1 钱币 = 1 钱币
  for (const [name,unitCost] of Object.entries(MATERIAL_COST_PER_UNIT)) {
    result[name] = unitCost * quantity;
  }
  return result;
}

// ============================== 破境石 → 英灵等级上限 ==============================
/**
 * 破境石投入英灵等级上限突破(Character_YingLing.cs:294-309,352-367)的完整模拟.
 * 固定口径:Max_Level=500,Star=0,单个英灵；每次消耗 round(⌊Max_Level/100⌋×10 × (100-研究34 30)/100),
 * 每次 Max_Level += 500 并触发一次 GetLevelUpStarEffect(Star 不自增,故每次效果相同):
 * HP/ATK/DEF/穿透 各 +min(⌊Star/5⌋+1,20)×5 = 5% 真百分比(value:true → PercentAddition),
 * 速度 +1 固定值,LevelUpStartEffect[Star/5]=暴击 +1 固定值(Character_YingLing.cs:51-61).
 * 破境无硬上限,maxLevel 记本次达到的最终等级上限.
 * @param pojing 投入的破境石数量
 */
export function pojingshiTozhanli (pojing: number): ToZhanliResult {
  const result = emptyToZhanli();
  const material = assertMaterial(pojing,"破境石");
  const starStep = Math.min(POJING_STAR_PCT_CAP,
    Math.trunc(POJING_START_STAR / POJING_STAR_DIVISOR) + 1);
  const starPercent = starStep * POJING_STAR_PCT_PER_STEP * POJING_YINGLING_COUNT;
  let maxLevel = POJING_START_MAX_LEVEL;
  let left = material;
  let count = 0;
  for (;;) {
    const cost = culPercentToInt(Math.trunc(maxLevel / 100) * POJING_COST_PER_100_LEVEL,
      -RESEARCH_34_POJING_REDUCE);
    if (cost <= 0 || left < cost) {
      break;
    }
    left -= cost;
    maxLevel += POJING_MAX_LEVEL_STEP;
    result.atkPercent += starPercent;
    result.baoJi += POJING_YINGLING_COUNT;
    result.defPercent += starPercent;
    result.hpPercent += starPercent;
    result.ignoreDefPercent += starPercent;
    result.speed += POJING_YINGLING_COUNT;
    count += 1;
  }
  result.count = count;
  result.finalLevel = maxLevel;
  result.left = left;
  result.maxLevel = maxLevel;
  result.used = material - left;
  return result;
}

/**
 * 强化一个装备:全部强化石投入单个槽,从 Lv.0 起逐级模拟扣石头,直到不够升下一级.
 * 源码 CulMaxStrengthTimes(Equip_Using.cs:100-122) + StrengthBatch(:125-163).
 * @param stones 投入的强化石数量
 * @returns 18 项属性(HP/ATK/DEF 各为累计固定值,其余 15 项为 0)
 */
export function qianghuazhiTozhanli1 (stones: number): AllProperties {
  return strengthProps(simulateStrengthSlot(stones).add);
}

/**
 * 平均强化(模拟源码自动强化多次按下后的平均结果):石头平分 10 份,每槽各自逐级升;
 * 未均分的零头集中给其中一个槽,从该槽当前等级继续升到耗尽.
 * 源码 AutoStrength(NPC_EquipManager.cs:275-289)每次挑 CurStrength 最低的槽批量升,多次按下等价于 10 槽趋于同级.
 * @param stones 投入的强化石数量
 * @returns 18 项属性(HP/ATK/DEF 各为 10 槽累计固定值,其余 15 项为 0)
 */
export function qianghuazhiTozhanli2 (stones: number): AllProperties {
  const perSlot = Math.floor(stones / EQUIP_SLOT_COUNT);   // 每槽平分到的石头
  const slot = simulateStrengthSlot(perSlot);              // 10 槽同级,只需算一次
  const zeroHead = stones - perSlot * EQUIP_SLOT_COUNT     // 未均分完的零头
    + slot.left * EQUIP_SLOT_COUNT;                       // 各槽升不动后剩下的石头

  // 零头集中给一个槽,从它当前等级继续升到耗尽
  const extra = simulateStrengthSlot(zeroHead,slot.level);
  return strengthProps(slot.add * EQUIP_SLOT_COUNT + extra.add);
}
export function research (): ResearchReduce {
  return {
    cost:           30_9665,
    hanTieReduce:   50,
    historyReduce:  20,
    lingWenReduce:  50,
    poJingReduce:   30,
    qiangHuaReduce: 50,
    scrollReduce:   20,
    shopReduce:     30,
    wucaiReduce:    50,
    yuLiReduce:     30
  };
}

// ============================== 三味真火 → 神兵火炼 ==============================
/**
 * 三味真火投入神兵火炼(8 条 Fire_Lian=命中 轨)的完整模拟,统一返回 18 项固定值 + 百分比字段 + 过程量.
 * 源码 ShenBingRecorder.GetStrengthRemand(:28-36):每级消耗 min(1000000,(Cur_Lv+1)×10000);
 * LevelUp(:93-100) 每级把 Fire_Lian 属性 +1,GetEffectToAdd(:110-123) 会置 Bool_Value=true,
 * 但命中在 property.json 里 percent=1,BattleData_Recorder.ChangeValue(:37-49) 实为 Base_Value += 1 固定值.
 * 初始:8 条轨各 Lv.0,神兵已解封(MaxLv=100),无研究减免；按「等级最低的轨优先」平均分配材料.
 * @param sanwei 投入的三味真火数量
 */
export function sanweizhenhuoTozhanli (sanwei: number): ToZhanliResult {
  const result = emptyToZhanli();
  const material = assertMaterial(sanwei,"三味真火");
  const levels = Array.from({length: SHEN_BING_FIRE_HIT_TRACKS},() => 0);
  let left = material;
  let count = 0;
  for (;;) {
    const target = lowestUpgradableTrack(levels);
    if (target < 0) {
      break;
    }
    const cost = shenBingCost(levels[target] ?? 0);
    if (left < cost) {
      break;
    }
    left -= cost;
    levels[target] = (levels[target] ?? 0) + 1;
    result.mingZhong += 1;
    count += 1;
  }
  result.count = count;
  result.finalLevel = Math.min(...levels);
  result.left = left;
  result.maxLevel = SHEN_BING_MAX_LV;
  result.used = material - left;
  return result;
}

// ============================== 6. 圣兽(地图材料,2 维) ==============================
// ShengShou_Record.cs:49-57 GetStrengthRemand(消耗=min(50000,10+10L)) / :18-21 GetNextAddition(每级两基础各+20+50L)
// 升级一次消耗(地图材料) = min(50000, 10 + 10*L) ← 这就是"升级一次要多少资源"
// 升级一次每维提升 = 20 + 50*L ← 两基础属性各加这么多(合计 ×2)
export function shengShou (level: number): SystemGain {
  const costPerLevelUp = Math.min(50000,10 + 10 * level); // 升级一次要多少地图材料(≥4999级封顶5万)
  const atk = 20 + 50 * level;                      // 每维提升 = 20+50L
  return {
    atk,
    costPerLevelUp,
    dims:      2,
    level,
    peratk:    atk / costPerLevelUp,
    resource:  "地图材料",
    system:    "圣兽",
    totalGain: atk * 2
  };
}

// ============================== 神通卷轴 → 30 个神通 ==============================
/**
 * 神通卷轴投入 30 个神通(config/shentong.json + ShenTong.cs:48-55,95-137)的完整模拟.
 * 固定口径:各神通 Lv.0,按 id 顺序逐个点满(低品阶先满即满足 CheckForeRemand 的前置),研究35 满 -20%.
 * 每级消耗 round(品阶基数 20/50/150/500/1000/1500 × 0.8)(RemandProp :111-137);
 * LearnShenTong(Character_YingLing.cs:462-466) 每级给 effectRecoders.Params_2 固定值到 Params_1 属性,
 * effectName=1 的 EntryEffect 类不进面板属性,进 GetZhanLi 的 Level×PinZhi 战力乘区(:401-411).
 * @param scrolls 投入的神通卷轴数量
 */
export function shentongjuanzhouTozhanli (scrolls: number): ToZhanliResult {
  const result = emptyToZhanli();
  const material = assertMaterial(scrolls,"神通卷轴");
  let left = material;
  let count = 0;
  let fullNodes = 0;
  for (const [,pinzhi,maxLevel,effectName,params1,params2] of SHEN_TONG_NODES) {
    const cost = culPercentToInt(SHEN_TONG_COST_BY_PINZHI[pinzhi] ?? 0,
      -RESEARCH_35_SHENTONG_REDUCE);
    if (cost <= 0) {
      break;
    }
    let level = 0;
    while (level < maxLevel && left >= cost) {
      left -= cost;
      level += 1;
      count += 1;
      if (effectName === SHEN_TONG_PROPERTY_EFFECT) {
        const key = PROPERTY_TO_KEY[params1];
        if (key !== undefined) {
          result[key] += params2;
        }
      } else if (effectName === SHEN_TONG_ENTRY_EFFECT) {
        result.zhanliPercent += pinzhi;
      }
    }
    if (level === maxLevel) {
      fullNodes += 1;
    } else {
      break; // 前置神通未满,更高品阶不能学(CheckForeRemand :95-109)
    }
  }
  result.count = count;
  result.finalLevel = fullNodes;
  result.left = left;
  result.maxLevel = SHEN_TONG_NODES.length;
  result.used = material - left;
  return result;
}

/**
 * compare.ts — 同类对比(库函数版,不读取存档)
 * 每个养成系统的「等级 → 提升属性」公式都[直接写在对应函数体内](含中文注释 + 反编译源码出处),
 * 不再调用 game-formulas.ts 的黑盒函数,方便一眼看懂"升级一次要多少资源,加多少属性".
 * 传入"当前等级 level",返回对象描述的是"从 level 升到 level+1 这一级"的消耗与提升.
 * 例外:hantieTozhanli() 描述的是「投入寒铁 + 五彩神石 + 翅膀等级」后的完整制造模拟,不是单级对比,详见该函数注释.
 * 最后 materialCost() 给出「每一个材料消耗多少钱币」的兑换表(资源转换表与数值全部集中在 data.ts,本文件只 import data.ts).
 */
// #region 挂机掉落模拟(对外)
/**
 * 模拟主动刷怪:按时间算出怒气/普攻两边各能清多少波,并分别给数学期望掉落.
 * 一次执行 = 清一波 5 只怪；次数 = floor(小时×3600/周期),最后一次不足周期直接丢弃.
 * @param useRage true 为怒气(1.1 秒/波),false 为普通攻击(0.85 秒/波)
 * @param hours 限定时间,单位小时,必传
 * @param map 地图 1-5,默认 5 通天塔
 * @param wingLevel 翅膀 1(Wing_CB_1)等级,默认 0；只影响元宝
 * @param wanHunFanLevel 万魂帆 Entry 等级,默认 0；每级给御力掉落 +10%
 * @returns 两份并列结果；主模式由 useRage 标记,两边掉落都完整计算
 */
export function simulateFarm (
  useRage: boolean,
  hours: number,
  map: MapID = 5,
  wingLevel = 0,
  wanHunFanLevel = 0
): FarmResult {
  const safeHours = assertHours(hours);
  const mapConfig = getMapConfig(map);
  const safeWingLevel = assertWholeAtLeast(wingLevel,0,"翅膀等级");
  const safeWanHunFanLevel = assertWholeAtLeast(wanHunFanLevel,0,"万魂帆等级");
  return {
    主模式:  useRage ? "怒气" : "普通攻击",
    怒气:   simulateMode(safeHours,RAGE_SECONDS,mapConfig,safeWingLevel,safeWanHunFanLevel),
    普通攻击: simulateMode(safeHours,NORMAL_SECONDS,mapConfig,safeWingLevel,safeWanHunFanLevel)
  };
}

/**
 * 模拟扫荡:严格按 MapRecorder.AddTimer/CulSaoDangShouYi,每满 48 秒给 1 份喽啰原始掉落.
 * 扫荡不吃幸运,不吃 39-42 掉率研究,不吃 56-63 额外掉落；只吃研究 43,VIP 扫荡速度与阵型战力.
 * @param hours 限定时间,单位小时,必传
 * @param round 层数(CurRound),默认 1；影响御力波次系数与已触发的扫荡加成
 * @param power 扫荡阵容战力,默认 0；按 MapRecorder.GetZhanLiAddition 折算速度
 * @param map 地图 1-5,默认 5 通天塔
 */
export function simulateSweep (
  hours: number,
  round = 1,
  power = 0,
  map: MapID = 5
): SweepResult {
  const safeHours = assertHours(hours);
  const safeRound = assertWholeAtLeast(round,1,"层数");
  const mapConfig = getMapConfig(map);
  const safePower = Number.isFinite(power) ? Math.max(0,power) : 0;
  const sweepAddition = getSweepAdditionPercent(mapConfig,safeRound);
  const speed = (getZhanLiAddition(safePower) + sweepAddition + 100) / 100
    * (100 + RESEARCH.saoDangShouYi) / 100
    * (100 + VIP_SAO_DANG_SPEED) / 100;
  const totalTimer = safeHours * SECONDS_PER_HOUR * speed;

  // 源码 while (SaoDang_Timer > 48):正好 48 的整数倍会少结算一次
  const ticks = totalTimer > 0
    ? Math.max(0,Math.ceil(totalTimer / SAO_DANG_REMAIN_TIMER) - 1)
    : 0;
  const drops: Record<string,number> = {};
  if (ticks <= 0) {
    return {所得: drops,扫荡次数: 0};
  }
  const yuLiPerTick = getYuLiDrop(1,safeRound,mapConfig.baseRound,0,false);
  for (const [propID,nums,percent] of mapConfig.louLouDrops) {
    addDrop(drops,propID,nums * getTrueDrop(percent,0) / 1000 * ticks);
  }
  addDrop(drops,4,yuLiPerTick * ticks);
  return {所得: drops,扫荡次数: ticks};
}

// ============================== 7. 图鉴(图鉴道具,4 维) ==============================
// TuJianData_Record.cs:30-51 升级经验 Exp(L) = 10 + Σ_{i=0}^{L-1}(⌊i/10⌋+1)*10
// 每个图鉴道具 = 200 经验(配置值,PropEffect_AddTuJianEXP.cs),故升级一次需 ⌈Exp(L)/200⌉ 个
// :67-76 LevelUp_AddProperty(每级四维各+50+15L)
export function tuJian (level: number): SystemGain {
  let exp = 10;                                              // 升级到 level 所需累计经验
  for (let i = 0; i < level; i++) {exp += (Math.floor(i / 10) + 1) * 10;}
  const costPerLevelUp = Math.ceil(exp / 200);               // 升级一次要多少个图鉴道具
  const atk = 50 + 15 * level;                       // 每维提升 = 50+15L
  return {
    atk,
    costPerLevelUp,
    dims:      4,
    level,
    peratk:    atk / costPerLevelUp,
    resource:  "图鉴道具",
    system:    "图鉴",
    totalGain: atk * 4
  };
}

// ============================== 忘情水 → 神兵水炼 ==============================
/**
 * 忘情水投入神兵水炼(2 条 Water_Lian=伤害加成 + 6 条 =暴伤)的完整模拟.
 * 消耗与火炼同源 ShenBingRecorder.cs:28-36;每升一级对应属性 +1 固定值(理由同火炼:percent=1 走 Base_Value).
 * 按 DESIGN.md 口径忘情水不用于突破重随；这里 8 条轨各从 Lv.0 起,按「等级最低的轨优先」平均分配.
 * @param water 投入的忘情水数量
 */
export function wangqingshuiTozhanli (water: number): ToZhanliResult {
  const result = emptyToZhanli();
  const material = assertMaterial(water,"忘情水");
  const trackCount = SHEN_BING_WATER_DAMAGE_TRACKS + SHEN_BING_WATER_CRIT_TRACKS;
  const levels = Array.from({length: trackCount},() => 0);
  let left = material;
  let count = 0;
  for (;;) {
    const target = lowestUpgradableTrack(levels);
    if (target < 0) {
      break;
    }
    const cost = shenBingCost(levels[target] ?? 0);
    if (left < cost) {
      break;
    }
    left -= cost;
    levels[target] = (levels[target] ?? 0) + 1;
    if (target < SHEN_BING_WATER_DAMAGE_TRACKS) {
      result.damageAddition += 1;
    } else {
      result.baoJiDamage += 1;
    }
    count += 1;
  }
  result.count = count;
  result.finalLevel = Math.min(...levels);
  result.left = left;
  result.maxLevel = SHEN_BING_MAX_LV;
  result.used = material - left;
  return result;
}

// ============================== 五彩神石 → 器鼎等级 ==============================
/**
 * 五彩神石投入器鼎(NPC_EquipManager.GetLevelUpRemandProp :250-256)的完整模拟.
 * 每级消耗 10×(⌊(L-1)/5⌋+1) 颗,研究20 满 -50% 后 Cul_Percent_ToInt 取整,下限 1;初始器鼎 Lv.1700.
 * 器鼎等级经 GetEqui_PropertyAddition(PropHelper.cs:424-438) 进装备主属性倍率,
 * 故按 hantieTozhanli 同一套主属性公式(固定炼器 Lv.1,品质 15,10 槽)折算攻/防/血三维增量.
 * @param wucai 投入的五彩神石数量
 */
export function wucaishenshiTozhanli (wucai: number): ToZhanliResult {
  const result = emptyToZhanli();
  const material = assertMaterial(wucai,"五彩神石");
  const single = (qiding: number): number => (EQUIP_BASE + EQUIP_PER_LEVEL * LIANQI_START_LEVEL
    + EQUIP_PINZHI_PER_LEVEL * EQUIP_PINZHI * LIANQI_START_LEVEL)
    * (EQUIP_PINZHI_FACTOR * EQUIP_PINZHI + 1) * EQUIP_RANDOM_AVG
    * (PERCENT_BASE + RESEARCH_18_EQUIP_ADD + qiding + LIANQI_START_LEVEL) / PERCENT_BASE;
  let level = QIDING_START_LEVEL;
  let left = material;
  let count = 0;
  while (level < QIDING_LEVEL_CAP && left >= qiluCost(level)) {
    left -= qiluCost(level);
    level += 1;
    count += 1;
  }
  const gain = (single(level) - single(QIDING_START_LEVEL)) * EQUIP_SLOT_COUNT;
  result.atk = gain;
  result.count = count;
  result.def = gain;
  result.finalLevel = level;
  result.hp = gain;
  result.left = left;
  result.maxLevel = QIDING_LEVEL_CAP;
  result.used = material - left;
  return result;
}

// ============================== 1. 御灵师(御力,4 维) ==============================
// GameRecorder.cs:659-669 CulLevel_Up_Remand(消耗) / :697-703 ShowAddition(每级四维各+L*250)
// 升级一次消耗(御力) = 100*tens*(tens+1) + 20*(tens+1)*(L%10),tens = ⌊L/10⌋
// 升级一次每维提升 = L * 250
export function yuLing (level: number): SystemGain {
  const tens = Math.floor(level / 10);
  const costPerLevelUp = 100 * tens * (tens + 1) + 20 * (tens + 1) * (level % 10); // 升级一次要多少御力
  const atk = level * 250;                                                  // 每维提升 = L*250
  return {
    atk,
    costPerLevelUp,
    dims:      4,
    level,
    peratk:    atk / costPerLevelUp,
    resource:  "御力",
    system:    "御灵师",
    totalGain: atk * 4
  };
}

// ============================== 御灵宝典 → 御灵师等级 ==============================
/**
 * 御灵宝典投入御灵师(GameRecorder.cs:632-669,697-711 / PropEffect_GetYuLingShiEXP.cs:23-32)的完整模拟.
 * 固定口径:御灵师 Lv.1 / 经验 0；每本 100 御力经研究48 满 +100% 变 200 御力(ChanYuLi :645).
 * 升级门槛 CulLevel_Up_Remand = 100×⌊L/10⌋×(⌊L/10⌋+1) + 20×(⌊L/10⌋+1)×(L%10),源码无研究减免;
 * 每级 HP/ATK/DEF/穿透 各 +L×250 固定值(:700-703).
 * 每 10 级一次突破需 500 个 prop81(视为已有,不扣本方法材料),突破不消耗经验(PinJing :680-687),
 * 突破属性按 DESIGN.md 属另一套金色品质选择,本方法只统计等级带来的四维增量.
 * @param books 投入的御灵宝典本数
 */
export function yulingbaodianTozhanli (books: number): ToZhanliResult {
  const result = emptyToZhanli();
  const material = assertMaterial(books,"御灵宝典");
  const expPerBook = BOOK_YULI_BASE * (PERCENT_BASE + RESEARCH_48_BOOK_EXP_ADD) / PERCENT_BASE;
  let exp = YULINGSHI_START_EXP + material * expPerBook;
  let level = YULINGSHI_START_LEVEL;
  let count = 0;
  while (level < YULING_LEVEL_CAP) {
    const tens = Math.trunc(level / 10);
    const need = 100 * tens * (tens + 1) + 20 * (tens + 1) * (level % 10);
    if (exp < need) {
      break;
    }
    exp -= need;
    const add = level * 250;
    result.atk += add;
    result.def += add;
    result.hp += add;
    result.ignoreDef += add;
    level += 1;
    count += 1;
  }
  result.count = count;
  result.finalLevel = level;
  result.left = 0; // 御灵宝典一次全部投入,经验留在等级内
  result.maxLevel = YULING_LEVEL_CAP;
  result.used = material;
  return result;
}

// ============================== 5. 阵法(灵纹,4 维) ==============================
// ZhenFaRecorder.cs:34-40 GetLevlUPRemand(消耗=L*20) / :82-91 LevelUp_AddProperty(每级四维各+200+35L)
// 升级一次消耗(灵纹) = L * 20
// 升级一次每维提升 = 200 + 35*L
export function zhenFa (level: number): SystemGain {
  const costPerLevelUp = level * 20;   // 升级一次要多少灵纹
  const atk = 200 + 35 * level; // 每维提升 = 200+35L
  return {
    atk,
    costPerLevelUp,
    dims:      4,
    level,
    peratk:    atk / costPerLevelUp,
    resource:  "灵纹",
    system:    "阵法",
    totalGain: atk * 4
  };
}

/**
 * 由累计炼器经验反推制造(炼器)等级.
 * 口径:每级门槛 = PropHelper.GetLianQiLevelUpExp(反编译 :467-476),与 NPC_EquipManager.AddLianQiExp(:155-166)
 * 的 while 升级循环,yingling-output.ts:796-801 一致:从 Lv.1 起,经验够当前级门槛就扣掉门槛并升 1 级.
 * @param exp 累计获得的炼器经验(从 Lv.1 起算的总经验,已含研究16/翅膀加成后的实际入账值)
 * @returns 该经验能达到的制造等级(经验不足升 1 级时返回 1)
 */
export function zhizaoLevelUp (exp: number): number {

  // 每级门槛分段公式的全部固定值(GetLianQiLevelUpExp :467-476)
  const LV_10_PER = 20;   // L≤10: L × 20
  const LV_20_BASE = 200;  // 10<L<20: 200 + 50 × (L−10)
  const LV_20_PER = 50;
  const LV_30_BASE = 700;  // 20≤L<30: 700 + 100 × (L−20)
  const LV_30_PER = 100;
  const LV_40_BASE = 1700; // 30≤L<40: 1700 + 200 × (L−30)
  const LV_40_PER = 200;
  const LV_40_PLUS_BASE = 3700; // L≥40: 3700 + 300 × (L−40)
  const LV_40_PLUS_PER = 300;

  // 分段边界等级
  const LV_10 = 10;
  const LV_20 = 20;
  const LV_30 = 30;
  const LV_40 = 40;
  const needExp = (level: number): number => {
    if (level <= LV_10) {return level * LV_10_PER;}
    if (level < LV_20) {return LV_20_BASE + LV_20_PER * (level - LV_10);}
    if (level < LV_30) {return LV_30_BASE + LV_30_PER * (level - LV_20);}
    if (level >= LV_40) {return LV_40_PLUS_BASE + LV_40_PLUS_PER * (level - LV_40);}
    return LV_40_BASE + LV_40_PER * (level - LV_30);
  };
  let level = 1;     // 初始等级(NPC_EquipManager 构造函数 LianQiLevel = 1)
  let remain = exp;  // 尚未消耗的累计经验
  while (remain >= needExp(level)) {
    remain -= needExp(level);
    level += 1;
  }
  return level;
}

// #endregion
// #region 内部辅助
function addDrop (drops: Record<string,number>,propID: number,amount: number): void {
  if (!(amount > 0)) {
    return;
  }
  const name = PROP_NAMES[propID];
  if (name === undefined) {
    throw new Error(`未知道具 ID：${propID}`);
  }
  drops[name] = (drops[name] ?? 0) + amount;
}
function addMonsterDrops (
  drops: Record<string,number>,
  mapConfig: MapConfig,
  pinZhi: number,
  round: number,
  extraCount: number,
  wingYuanBao: number,
  wanHunFanLevel: number,
  dropAdditionPercent: number
): void {
  const addition = getDropAddition(pinZhi,dropAdditionPercent);
  for (const [propID,nums,percent] of getDropTable(mapConfig,pinZhi)) {
    addDrop(drops,propID,(nums + extraCount) * getTrueDrop(percent,addition) / 1000);
  }
  addResearchDrops(drops,mapConfig,pinZhi,addition);
  addDrop(drops,4,getYuLiDrop(pinZhi,round,mapConfig.baseRound,wanHunFanLevel,true));
  addDrop(drops,95,wingYuanBao);
}

// MapRecorder.KeJiDrop :242-318；87 御灵师经验按品质给 1/2/3,其余为必掉期望
function addResearchDrops (
  drops: Record<string,number>,
  mapConfig: MapConfig,
  pinZhi: number,
  addition: number
): void {
  addDrop(drops,87,pinZhi);
  addDrop(drops,80,2 * getOkToDropChance(RESEARCH.extalMoney * 2,addition));
  addDrop(drops,9,getOkToDropChance(RESEARCH.extalLiShiBenJi,addition));
  addDrop(drops,1,getOkToDropChance(RESEARCH.extalHanTie,addition));
  addDrop(drops,7,getOkToDropChance(RESEARCH.extalZhenWen,addition));
  addDrop(drops,18,getOkToDropChance(RESEARCH.extalRandomJinNang,addition));
  addDrop(drops,84,getOkToDropChance(RESEARCH.extalYuLingBaoDian,addition));
  addDrop(drops,86,getOkToDropChance(RESEARCH.extalLianQiBaoDian,addition));
  addDrop(drops,900 + getEnemyID(mapConfig,pinZhi),getOkToDropChance(RESEARCH.extalGuaiWuTuJian,addition));
}
function assertHours (hours: number): number {
  if (!Number.isFinite(hours) || hours < 0) {
    throw new Error(`小时必须是非负有限数，收到 ${String(hours)}`);
  }
  return hours;
}
function assertMaterial (amount: number,name: string): number {
  return assertWholeAtLeast(amount,0,`${name}数量`);
}
function assertWholeAtLeast (value: number,min: number,label: string): number {
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${label}必须是 ≥${min} 的整数，收到 ${String(value)}`);
  }
  return value;
}

// ToolClass.Cul_Percent_ToInt :107-117(正数四舍五入远离零);percentage 传负值即减免
function culPercentToInt (baseValue: number,percentage: number): number {
  return Math.round(baseValue * (100 + percentage) / 100);
}

// 9 个新增 tozhanli 方法的全 0 返回骨架(字段与 data.ts 的 EMPTY_* 一一对应)
function emptyToZhanli (): ToZhanliResult {
  return {
    ...EMPTY_PROPERTIES,
    ...EMPTY_PERCENT_PROPERTIES,
    count:          0,
    finalLevel:     0,
    left:           0,
    maxLevel:       0,
    specialPercent: 0,
    used:           0,
    zhanliPercent:  0
  };
}

// MapRecorder.GetDrop_Addition :341-363；LUCKY 已含研究 14
function getDropAddition (pinZhi: number,extraPercent: number): number {
  const qualityMark = pinZhi === 1
    ? RESEARCH.louLouDrop
    : pinZhi === 2
      ? RESEARCH.jingYingDrop
      : RESEARCH.bossDrop;
  return LUCKY + RESEARCH.allEnemyDrop + qualityMark + extraPercent;
}
function getDropTable (mapConfig: MapConfig,pinZhi: number): readonly DropRow[] {
  if (pinZhi === 1) {
    return mapConfig.louLouDrops;
  }
  if (pinZhi === 2) {
    return mapConfig.jingYingDrops;
  }
  return mapConfig.bossDrops;
}
function getEnemyID (mapConfig: MapConfig,pinZhi: number): number {
  if (pinZhi === 3) {
    return mapConfig.bossID;
  }
  if (pinZhi === 2) {
    return mapConfig.jingYingID;
  }
  return mapConfig.louLouID;
}

// 每只怪的额外数量 num(MapRecorder.cs:218-230):
// VIP_PercentAddCount 是 Random.Range(1,101) < 8 → 7%；CurRound/10000 是整数除法
function getExpectedExtraCount (round: number): number {
  const vipChance = Math.max(0,VIP_PERCENT_ADD_COUNT - 1) / 100;
  const roundTier = Math.trunc(round / 10000);
  const roundChance = roundTier >= 2 ? (roundTier - 1) / 100 : 0;
  return vipChance + roundChance;
}

// 翅膀 1 = Wing_CB_1(Wing_Config_Data 的 TargetMark 68),等级直接写入印记
// MapRecorder.KeJiDrop :281-316 的 switch,按期望折算
function getExpectedWingYuanBao (wingLevel: number): number {
  if (wingLevel <= 0) {
    return 0;
  }
  if (wingLevel <= 10) {
    return Math.min(1,wingLevel * 10 / 100);
  }
  const base = Math.trunc((wingLevel - 10) / 25) + 1;
  const remainder = (wingLevel - 10) % 25;
  return base + Math.min(1,remainder * 4 / 100);
}
function getMapConfig (map: number): MapConfig {
  assertWholeAtLeast(map,1,"地图");
  const config = MAPS[map];
  if (config === undefined) {
    throw new Error(`地图只能是 1-5，收到 ${String(map)}`);
  }
  return config;
}

// MapRecorder.OKToDrop :320-324；Random.Range(1,101) <= num,概率 = clamp(num,0,100)/100
function getOkToDropChance (value: number,addition: number): number {
  const threshold = Math.trunc(value * (100 + addition) / 100);
  return Math.min(100,Math.max(0,threshold)) / 100;
}
function getSweepAdditionPercent (mapConfig: MapConfig,round: number): number {
  let value = 0;
  for (const [effectRound,effectType,effectValue] of mapConfig.effects) {
    if (effectType === MAP_EFFECT.saoDangShouYi && effectRound <= round) {
      value += effectValue;
    }
  }
  return value;
}

// Drop_Recorder.GetTrueDrop :37-45
function getTrueDrop (percent: number,addition: number): number {
  return Math.min(1000,roundHalfToEven(percent * (100 + addition) / 100));
}

// MapRecorder.GetYuLiDrop :326-339；御力基数 150×(1+品质×0.5),再乘波次系数
function getYuLiDrop (
  pinZhi: number,
  round: number,
  baseRound: number,
  wanHunFanLevel: number,
  withAddition: boolean
): number {
  let value = Math.trunc(150 * (1 + pinZhi * 0.5));
  value *= Math.trunc((round + baseRound + 1000) / 1000);
  if (withAddition) {
    value = culPercentToInt(value,RESEARCH.addDropYuLi);
    value = culPercentToInt(value,VIP_YU_LI_DROP);
    value = culPercentToInt(value,wanHunFanLevel * 10);
  }
  return value;
}

// MapRecorder.GetZhanLiAddition :120-146；战力 0 → 0
function getZhanLiAddition (power: number): number {
  if (!Number.isFinite(power) || power <= 0) {
    return 0;
  }
  const powerTen = 1000_0000_0000;
  if (power <= powerTen) {
    return Math.trunc(power * 100 / powerTen);
  }
  const powerEleven = 1_0000_0000_0000;
  if (power <= powerEleven) {
    return 100 + Math.trunc((power - powerTen) * 100 / (powerEleven - powerTen));
  }
  const exponent = Math.floor(Math.log10(power / powerEleven));
  const lower = powerEleven * 10 ** exponent;
  const upper = lower * 10;
  return 200 + exponent * 100 + Math.trunc((power - lower) * 100 / (upper - lower));
}
function simulateMode (
  hours: number,
  cycleSeconds: number,
  mapConfig: MapConfig,
  wingLevel: number,
  wanHunFanLevel: number
): FarmModeResult {
  const executions = Math.floor(hours * SECONDS_PER_HOUR / cycleSeconds);
  const drops: Record<string,number> = {};
  if (executions <= 0) {
    return {所得: drops,执行次数: 0};
  }
  const wingYuanBao = getExpectedWingYuanBao(wingLevel);
  let dropAdditionPercent = 0;
  for (let index = 0; index < executions; index += 1) {
    const round = START_ROUND + index;
    const extraCount = getExpectedExtraCount(round);
    const wave = WAVE_COMPOSITION[round % 5];
    if (wave != null) {
      for (const pinZhi of wave) {
        addMonsterDrops(drops,mapConfig,pinZhi,round,extraCount,wingYuanBao,wanHunFanLevel,dropAdditionPercent);
      }
    }

    // AddRound 在本波清完后触发；GetProp 给道具,DropPercent 从下一波开始生效
    for (const [effectRound,effectType,value,value1] of mapConfig.effects) {
      if (effectRound !== round) {
        continue;
      }
      if (effectType === MAP_EFFECT.getProp) {
        addDrop(drops,value,value1);
      }
      if (effectType === MAP_EFFECT.dropPercent) {
        dropAdditionPercent += value;
      }
    }
  }
  return {所得: drops,执行次数: executions};
}

// 18 项里走「真百分比」的 5 项;其余 13 项按源码是固定值
const isCiTiaoPercentKey = (key: keyof AllProperties): key is CiTiaoPercentKey => key === "atk" || key === "def" || key === "hp" || key === "speed" || key === "ignoreDef";

// 在神兵多轨平均分配里,挑当前等级最低且未达 MaxLv 的一条轨;全满返回 -1
function lowestUpgradableTrack (levels: number[]): number {
  let target = -1;
  for (let index = 0; index < levels.length; index += 1) {
    const level = levels[index] ?? 0;
    if (level < SHEN_BING_MAX_LV && (target < 0 || level < (levels[target] ?? 0))) {
      target = index;
    }
  }
  return target;
}

// 器鼎单级消耗(NPC_EquipManager.cs:250-256),与 hantieTozhanli ① 完全同一口径
function qiluCost (level: number): number {
  return Math.max(1,Math.round(QILU_COST_BASE * (Math.trunc((level - 1) / QILU_TIER_SIZE) + 1)
    * (PERCENT_BASE - RESEARCH_20_WUCAI_REDUCE) / PERCENT_BASE));
}

// Mathf.RoundToInt(Drop_Recorder.cs:39)在正数区间是四舍六入五取偶
function roundHalfToEven (value: number): number {
  const lower = Math.floor(value);
  if (value - lower === 0.5) {
    return lower % 2 === 0 ? lower : lower + 1;
  }
  return Math.round(value);
}

// 神兵单级消耗(ShenBingRecorder.cs:28-36)
function shenBingCost (level: number): number {
  return Math.min(SHEN_BING_COST_CAP,(level + 1) * SHEN_BING_COST_PER_LEVEL);
}

// 一个槽从 startLevel 起,用 stones 颗强化石逐级模拟升级,返回累计每维加成 / 最终等级 / 剩余石头
function simulateStrengthSlot (
  stones: number,
  startLevel = 0
): {add: number; left: number; level: number} {
  let left = stones;
  let level = startLevel;
  let add = 0;
  while (level < STRENGTH_COST_CAP) {
    const cost = strengthCost(level);
    if (left < cost) {break;}
    left -= cost;
    add += strengthAdd(level);
    level += 1;
  }
  return {add,left,level};
}

// 单个槽从 level 升一级,HP/ATK/DEF 每条固定值的增量
function strengthAdd (level: number): number {
  const add = STRENGTH_ADD_BASE + STRENGTH_ADD_PER_LEVEL * level;
  return level >= STRENGTH_HIGH_THRESHOLD ? add * STRENGTH_HIGH_MULTIPLIER : add;
}

// ============================== 强化石 → 战力(18 属性全量) ==============================
// 源码 Equip_Using.cs:62-84 ComputeStrengthCostByLevel / :86-98 ComputeStrengthAddByLevel / :100-122 CulMaxStrengthTimes
// 每级消耗:⌊(3+2L) × (100−研究25)/100⌋(四舍五入) → L≥100万 再 ×5 → 上下限;每级提升:10+10L,L≥100万 ×5
// 单个槽在 level 级时的强化石消耗
function strengthCost (level: number): number {
  const base = STRENGTH_COST_BASE + STRENGTH_COST_PER_LEVEL * level;
  let cost = Math.round(Math.min(STRENGTH_COST_CAP,base)
    * (PERCENT_BASE - RESEARCH_25_STRENGTH_REDUCE) / PERCENT_BASE);
  if (level >= STRENGTH_HIGH_THRESHOLD) {
    cost *= STRENGTH_HIGH_MULTIPLIER;
  }
  return Math.max(STRENGTH_COST_MIN,Math.min(STRENGTH_COST_CAP,cost));
}

// 把「每维累计固定值」铺成 18 项属性:只有 HP/ATK/DEF 三条有值,其余 15 项为 0(一个都不省略)
function strengthProps (add: number): AllProperties {
  return {
    atk:            add,
    baoJi:          0,
    baoJiDamage:    0,
    baoJiResist:    0,
    damageAddition: 0,
    damageReduce:   0,
    def:            add,
    fanJi:          0,
    hp:             add,
    ignoreDef:      0,
    lianJi:         0,
    lucky:          0,
    mingZhong:      0,
    recovery:       0,
    returnDamage:   0,
    shanBi:         0,
    speed:          0,
    xiXie:          0
  };
}

// #endregion