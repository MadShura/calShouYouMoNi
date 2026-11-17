/**
 * game-formulas.ts — <英灵>数值公式库:唯一公式入口(纯函数,无副作用,可直接 import)
 * 这个文件放的是「游戏本身怎么算」:伤害结算 + 各养成系统「资源 → 属性」的消耗/产出公式.
 * 每个函数上方都标了反编译源码出处(类名.方法名 + 行号).不读存档,可独立
 * `pnpm exec tsx scripts/game-formulas.ts` 运行看逐档表.
 * ── 源码核对结论(2026-11-13,逐条比对 反编译/*.cs)────────────────────────────
 * 函数 源码出处 判定
 * culDamagePercent Damage_Recorder.cs:138-161 CulDamagePercent ✓ 逐行吻合(C#整数除法=Math.trunc)
 * sceneDamage Damage_Recorder.cs:55-110 CulFinalDamage ✓ 减伤封顶80(:89-93),结构吻合
 * oneShotDamage 同上 + ToolClass.cs:445-453 ✓ 已修正伤害加成桶为(100+x)/100
 * equipStrengthenCost/Stat Equip_Using.cs:19-22,24-38,40-71 ✓ 吻合
 * makeEquipCost PropHelper.cs:487-505 GetRemandMat ✓ 吻合(补 num<1→1 下限)
 * makeEquipMainAtk PropHelper.cs:388-405 GenerateEquip ~ 按 DESIGN.md 取随机期望 1.05
 * qiDingCost NPC_EquipManager.cs:250-256 ✓ 吻合
 * shengShouCost/Stat ShengShou_Record.cs:18-21,49-57 ✓ 吻合
 * shengShouSpecialPct ShengShou_Record.cs:311,343 ✓ 已修正为升阶后 L≡1(mod 250)
 * tuJianLevelUpExp/Stat TuJianData_Record.cs:30-51,67-76 ✓ 吻合
 * tuJianItems PropEffect_AddTuJianEXP.cs:25-30 △ 200经验是配置值(DESIGN.md§图鉴口径)
 * yuLingLevelCost GameRecorder.cs:659-669 CulLevel_Up_Remand ✓ 吻合
 * yuLingStatPerLevel GameRecorder.cs:697-703 ShowAddition ✓ 吻合
 * yuLingBreakthroughs GameRecorder.cs:680-687 PinJing ✓ 吻合(L%10==0)
 * zhenFaCost/Stat ZhenFaRecorder.cs:34-40,82-91 ✓ 吻合
 * zhuanZhiCost/Stat ZhuanZhiManager.cs:16-19,21-33,35-39 ✓ 吻合(不是 ZhuanShengManager)
 * poJingCost Character_YingLing.cs:352-358 ✓ 已对齐原式 Max_Level/100*10
 * shenBingCost ShenBingRecorder.cs:28-36 ✓ 吻合
 * YULING_EQUIP_15_TOTAL YuLing_Equi_LingQi_Data_Config.cs △ 配置汇总,.cs 无硬编码
 * XUNBAO_LAYER10_YIELD DESIGN.md §初始资源口径 △ 配置/契约值
 * COIN_COST/RES_NAME/coin compare.ts loadValueCost() 存档 ValueCost △ 展示工具,非游戏公式
 * fmtShort/requiredAtk — ○ 本项目求解/格式化工具,非游戏机制
 * ── 统一口径(源码有,本库未建模,勿误当错误)────────────────────────────────
 * 1. 装备强化/炼器/器鼎/阵法/破境 的消耗都叠加 Mark_Enum.Reduce_* 科技减免,经
 * ToolClass.Cul_Percent_ToInt(ToolClass.cs:107-111,(100-p)/100 四舍五入远离零).
 * 本库给「未减免基准值」,即 DESIGN.md §研究口径 打折前的公式.
 * 2. Damage_Recorder.cs:80-81 有 Random.Range(0.95f,1.05f) 伤害浮动,本库取期望 1.0.
 * 3. PropHelper.cs:396 有 Random.Range(1f,1.1f) 装备主属性浮动,本库按 DESIGN.md §装备口径 取期望 1.05；
 * 源码结果还经 (long) 截断,且 :400-401 把 DEF/HP 覆盖成 ATK 值,本库只算攻击主属性.
 * 4. 源码另有 2147483646 上限截断,批量路径下限 1 等边界,见各函数注释.
 * 5. oneShotDamage 的 skillReduce / extraBeDamage / tuJianDamagePct 是本项目扩展桶:
 * 源码只有单一 DamageReduce(封顶80),这三个来自 DESIGN.md §图鉴口径(研究54)等,按倍率外挂.
 * 资源 PropID 速查:寒铁1 / 五彩神石2 / 破境石3 / 御力4 / 强化石5 / 神通卷轴6 / 灵纹7 / 灵晶8 / 历史本纪9 / 抽奖卷10 / 升仙令93 / 元宝95 / 御灵宝典84 / 忘情水81 / 三味真火85 / 炼器宝典86 / 神速符92 / 图鉴道具901-915.
 */
import process from "node:process";
import type {EnemyStats} from "./enemy-stats.ts";

const fmt = (n: number): string => n.toLocaleString("en-US");
export interface ShotOpt {
  atkPct:           number;           // 攻击% 桶(单位 %).源码 BaseAttack 已含攻击%,传 finalAtk 时应填 100
  dmgAdd:           number;           // 伤害加成%(单位 %),源码乘 (100+dmgAdd)/100
  pctBucket:        number;        // 百分比乘区连乘结果 Π(1+p/100),ToolClass.cs:445-453
  pen?:             number;             // 穿透,源码 DEF' = max(1, 敌 DEF - Igonore_DEF)
  skillMult:        number;        // 技能/转职倍率(对应源码 PercentAddition 的技能项)
  tuJianDamagePct?: number; // 图鉴增伤%(本项目扩展桶,DESIGN.md §图鉴口径)
}

// Damage_Recorder.CulDamagePercent(:138-161).C# 的 BigInteger/long 除法向零截断 = Math.trunc.
// 逐行吻合:DEF<=0→(ATK>0?100:50)；ATK==DEF→50；ATK>=3DEF→100；ATK*3<=DEF→2；
// 两段中间值分别 50+(ATK-DEF)*50/DEF*2 与 2+(ATK*3-DEF)*48/(DEF*2).
export function culDamagePercent (atk: number,def: number): number {
  if (def <= 0) {return atk > 0 ? 100 : 50;}
  if (atk === def) {return 50;}
  if (atk > def) {
    if (atk >= 3 * def) {return 100;}
    return 50 + Math.trunc((atk - def) * 50 / def) * 2;
  }
  if (atk * 3 <= def) {return 2;}
  return 2 + Math.trunc((atk * 3 - def) * 48 / (def * 2));
}

// 单点非暴击伤害.修正记录:此前误写 (dmgAdd/100),与源码 (:86-87) 及 yingling-output.ts:1470
// 的 (100+damageAddition)/100 不符,已改回 (100+dmgAdd)/100.
export function oneShotDamage (atk: number,enemy: EnemyStats,opt: ShotOpt,skillReduce = 0,extraBeDamage = 0): number {
  const def = Math.max(1,enemy.def - (opt.pen ?? 0));
  const k = culDamagePercent(atk,def);
  const reduce = Math.min(enemy.damageReduce,80);
  return atk * (opt.atkPct / 100) * opt.skillMult * (k / 100) *
    opt.pctBucket * (100 + opt.dmgAdd) / 100 * (1 + (opt.tuJianDamagePct ?? 0) / 100) *
    (100 + extraBeDamage) / 100 * (100 - reduce) / 100 * (100 - skillReduce) / 100;
}

// 求解工具(非游戏机制):二分最小基础攻击使一击必杀
export function requiredAtk (enemy: EnemyStats,baseAtk: number,opt: ShotOpt,skillReduce = 0,extraBeDamage = 0): number {
  let hi = 1e40,
lo = baseAtk;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (oneShotDamage(mid,enemy,opt,skillReduce,extraBeDamage) >= enemy.hp) {hi = mid;} else {lo = mid;}
  }
  return hi;
}

// Damage_Recorder.CulFinalDamage(:55-110) 的场景口径:
// DEF' = max(1, 敌 DEF - 穿透) (:70-74)；基础伤害 = BaseAttack × CulDamagePercent(BaseAttack, DEF') / 100 (:75)
// 百分比乘区 = ToolClass.CulFinalValuePercentArray(100, PercentAddition) (:61, ToolClass.cs:445-453)
// 伤害加成桶 ×(100+DamageAddition)/100 (:86-87)；减伤 ×(100-DamageReduce)/100 且减伤封顶 80 (:88-93)
// 本函数把「百分比乘区」整体作为 total 传入,防御系数作为 k 传入,取随机浮动期望 1.0,不计暴击.
// 调用方负责按源码口径算 k = culDamagePercent(实际攻击, max(1,敌防御-穿透)).
export function sceneDamage (atkFlat: number,total: number,k: number,scene: {reduce: number}): number {
  return assertFinite(atkFlat * total * (k / 100) * (1 - scene.reduce / 100),"sceneDamage");
}

// GameRecorder.cs:680-687 PinJing():CurYuLingShiLv % 10 == 0 时须突破
export function yuLingBreakthroughs (fromL: number,toL: number): number {
  let c = 0;
  for (let L = fromL; L < toL; L++) {if (L % 10 === 0) {c++;}}
  return c;
}

// ============================== 1. 御灵师升级 ==============================
// GameRecorder.cs:659-669 CulLevel_Up_Remand():
// num2 = L/10 (C# long 整数除法)；num3 = L%10；
// return 100*num2*(num2+1) + 20*(num2+1)*num3 → 完全吻合
export function yuLingLevelCost (L: number): number {
  const tens = Math.floor(L / 10);
  return 100 * tens * (tens + 1) + 20 * (tens + 1) * (L % 10);
}

// GameRecorder.cs:697-703 ShowAddition():每级 生命/攻击/防御/穿透 各 +CurYuLingShiLv*250
export function yuLingStatPerLevel (L: number): number {
  return L * 250;
}

// ============================== 战斗伤害结算 ==============================
// 源码:反编译/YingLing.BattleSystem/Damage_Recorder.cs
function assertFinite (value: number,label: string): number {
  if (!Number.isFinite(value)) {throw new TypeError(`${label} 不是有限数：${String(value)}`);}
  return value;
}

// 自动突破路径每次 500 忘情水(81):UIPanel_AutoLv.cs:101-108.
// 注意手动突破不扣 500(UIPanel_LevelUp_TuPo.cs:201-209 直接 Trriger 属性),
// 这里按 DESIGN.md §御灵师升级口径 的「每次 500 突破丹」取自动升级口径.
export const YULING_TUPO_COST = 500;

// ============================== 2. 装备强化 ==============================
// Equip_Using.cs:40-71 GetStrengthRemand() → int baseValue = 3 + CurStrength*2；>=1000000 时 *5
// Equip_Using.cs:19-22 GetNextAddition() → return 10 + CurStrength*10
// Equip_Using.cs:24-38 Strength() → >=1000000 时属性 *5,HP/ATK/DEF 各加一份
// 注:源码另有 Reduce_QiangHuaStore 减免,2147483646 上限截断(Cul_Percent_ToInt, ToolClass.cs:107-111)；
// 本库给未减免基准值.EquipStrengthRecorder.cs 的 5+2L 是无人引用的死代码,勿抄.
export function equipStrengthenCost (L: number): number {
  const base = 3 + 2 * L;
  return L >= 100_0000 ? base * 5 : base;
}
export function equipStrengthenStat (L: number): number {
  const base = 10 + 10 * L;
  return L >= 100_0000 ? base * 5 : base;
}

// ============================== 3. 制作装备 / 炼器 ==============================
// PropHelper.cs:487-505 GetRemandMat(LianQiLevel):num=LianQiLevel,>2000000 截断,减免后 <1 则取 1.
export function makeEquipCost (lianQiLevel: number): number {
  return Math.max(1,Math.min(200_0000,lianQiLevel));
}

// PropHelper.cs:388-405 GenerateEquip(EquipType, Level, PinZhi) 的 ATK 主属性:
// value = (long)[(30 + 25*Level + 6*PinZhi*Level) × (0.4*PinZhi+1) × Random.Range(1f,1.1f) × num]
// num = (GetEqui_PropertyAddition()+100)/100 = 1 + 装备制造属性%/100
// 按 DESIGN.md §装备口径 取随机期望 1.05；源码结果有 (long) 截断,且 :400-401 把 DEF/HP 覆盖成 ATK 值.
export function makeEquipMainAtk (L: number,quality: number,equipPropPct: number): number {
  return (30 + 25 * L + 6 * quality * L) * (0.4 * quality + 1) * 1.05 * (1 + equipPropPct / 100);
}

// ============================== 4. 器鼎 ==============================
// NPC_EquipManager.cs:250-256 GetLevelUpRemandProp():((QiLu_Level-1)/5 + 1)*10,道具 2 五彩神石.
// C# int 除法即 floor；另有 Reduce_WuCaiShenShi 减免,本库给未减免基准值.
export function qiDingCost (L: number): number {
  return (Math.floor((L - 1) / 5) + 1) * 10;
}

// ============================== 6. 圣兽(5 张地图) ==============================
// ShengShou_Record.cs:49-57 GetStrengthRemand() → 10 + CurStrength*10,>50000 截断
// ShengShou_Record.cs:18-21 GetNextAddition() → 20 + CurStrength*50,两条基础属性各加
export function shengShouCost (L: number): number {
  return Math.min(50000,10 + 10 * L);
}

// ShengShou_Record.cs:311 单阶 Strength() 判 (CurStrength+249)%250==0(CurStrength 已自增),
// 批量版 :343 判 num4%250==1 → 升阶后等级 L≡1(mod 250) 时 +1%,即 L=1,251,501...(第 1 阶就 +1%).
// 修正记录:此前写 floor(L/250),在 L=1/251/501 处少算一次.
export function shengShouSpecialPct (L: number): number {
  return Math.floor((L + 249) / 250);
}
export function shengShouStat (L: number): number {
  return 20 + 50 * L;
}

// ============================== 7. 图鉴(15 种) ==============================
// TuJianData_Record.cs:30-51 GetLevelUpEXPDic(Level):num=10; for i<Level: num += (i/10+1)*10
// (C# int 除法 = floor)；GetLevlUPRemand() 直接返回它.完全吻合.
export function tuJianLevelUpExp (L: number): number {
  let total = 10;
  for (let i = 0; i < L; i++) {total += (Math.floor(i / 10) + 1) * 10;}
  return total;
}

// TuJianData_Record.cs:67-76 LevelUp_AddProperty():int num = 50 + 15*Level,四维各加
export function tuJianStat (L: number): number {
  return 50 + 15 * L;
}

// ============================== 5. 阵法 ==============================
// ZhenFaRecorder.cs:34-40 GetLevlUPRemand() → Level*20 灵纹(7),叠加 ReDuce_ZhenWen 减免
// ZhenFaRecorder.cs:82-91 LevelUp_AddProperty() → long num = 200 + 35*Level,四维(HP/ATK/DEF/穿透)各加
// ZhenFaRecorder.cs:207-214 InitalBaseProperty() → 四维初始各 500
export function zhenFaCost (L: number): number {
  return L * 20;
}
export function zhenFaStat (L: number): number {
  return 200 + 35 * L;
}

// 每个图鉴道具 200 经验:DESIGN.md §图鉴口径(Prop 901-915 给 200 经验).
// 反编译源码 PropEffect_AddTuJianEXP.cs:25-30 只把 EffectRecoder.Params_2 传给 AddExp,
// 数值来自外部配置表,.cs 内无硬编码 200 → 这是配置/契约值,不是源码公式.
export const TUJIAN_ITEM_EXP = 200;
export function tuJianItems (L: number): number {
  return Math.ceil(tuJianLevelUpExp(L) / TUJIAN_ITEM_EXP);
}

// ============================== 8. 科技研究(历史本纪) ==============================
// DESIGN.md §研究口径:逐节点消耗历史本纪(9),先点满「俭以养德」后整体 -85%.
// 覆盖:攻击/防御/命中/暴伤/伤害加成/幸运,阵法攻防穿透,装备制作线,图鉴线,资源折扣,纯时间/掉落/抽奖等.
// 不点:生命/吸血/闪避/抗暴/减伤/连击/反击.源码为节点表驱动(非闭式公式),故此处不提供函数.
// ============================== 9. 转职强化(单英灵) ==============================
// ZhuanZhiManager.cs:35-39 GetStrengthRemand() → 10 + CurStrength*10,历史本纪(9)
// ZhuanZhiManager.cs:16-19 GetNextAddition() → 20 + CurStrength*50
// ZhuanZhiManager.cs:21-33 Strength() → 四维各加,速度每级 +1
// ZhuanZhiManager.cs:132-137 ZhuanZhi() → 初始转职另耗 升仙令(93) ×1
// 注:是 ZhuanZhiManager,不是 ZhuanShengManager(后者是「转生」,消耗孟婆汤,与本公式无关).
export function zhuanZhiCost (L: number): number {
  return 10 + 10 * L;
}
export function zhuanZhiStat (L: number): number {
  return 20 + 50 * L;
}

// ============================== 10. 神通(30 个) ==============================
// DESIGN.md §神通口径:全 30 神通点满共 38200 神通卷轴(6)(不含神通20).
// 关键:神通3 命中→伤害%,神通6 SP→伤害%,神通11 负面层数→伤害%,神通15 命中%,神通19 动作+20%/级.
// 逐神通独立消耗(品质1→20 ... 品质6→1500),节点表驱动,故此处不提供函数.
// ============================== 11. 御灵装备(单英灵装备位) ==============================
// DESIGN.md §御灵装备口径:15 级后羿弓 + 金玉令 + 6 颗 15 级宝石,数值取自
// Prop_Data_Json.txt 与 YuLing_Equi_LingQi_Data_Config.cs(配置类只有字段,无硬编码常量).
// 918 个 .cs 中未找到这组数值的硬编码 → 配置汇总值,非源码公式.
export const YULING_EQUIP_15_TOTAL = {
  三围:    250_0000,
  三围Pct: 600,
  反击:    45,
  命中:    55,
  暴伤:    200,
  暴击:    55,
  连击:    45,
  闪避:    55
};

// ============================== 13. 英灵等级上限(破境石) ==============================
// Character_YingLing.cs:352-358 GetMaxLevelRemand():int baseValue = Max_Level / 100 * 10；
// :360-367 AddMaxLevel():Max_Level += 500；:92 初始 Max_Level=500.
// C# 的 /100 是整数除法(截断),故写 Math.trunc(Max/100)*10,不写 Max/10
// (Max 恒为 500 倍数时数值恰好相等,但非 100 倍数时两者不同)；另有 Reduce_PoJingShi 减免.
export function poJingCost (curMaxLevel: number): number {
  return Math.trunc(curMaxLevel / 100) * 10;
}

// ============================== 12. 神兵(忘情水 / 三味真火 竞争) ==============================
// ShenBingRecorder.cs:28-36 GetStrengthRemand():num=(Cur_Lv+1)*10000,>1000000 截断；
// Fire_Lian→85 三味真火,否则→81 忘情水.完全吻合.
// 忘情水(81) 同时是御灵师自动突破材料(每次 500),与神兵·水炼抢同一资源.
export function shenBingCost (L: number): number {
  return Math.min(100_0000,(L + 1) * 10000);
}

// ============================== 14. 升仙 / 转职 ==============================
// 升仙令(93):ZhuanZhiManager.ZhuanZhi() 消耗 ×1.
// 英灵残念(600):升仙/养成货币(具体属性转化待核查 §五).
// ============================== 15. 元宝(多系统枢纽) ==============================
// DESIGN.md §初始资源口径:寻宝第 10 层每格固定 2,560,000(钱币/寒铁/灵纹/历史本纪/
// 强化石/神通卷轴/灵晶/神速符/忘情水/三味真火),另加御灵宝典,御力宝箱 Lv6,元宝大奖.
// 这是配置/契约值,反编译 .cs 不含该产出公式.
export const XUNBAO_LAYER10_YIELD = 256_0000;

// ============================== 展示工具(非游戏公式) ==============================
// 钱币商店单价:来源不是反编译源码,而是存档 Prop_Data.Save 的道具 ValueCost,
// 见 compare.ts loadValueCost() 与 UIPanel_BuyProp.cs:48 → PropHelper.GetPropValue.
// 这里是一份快照,仅用于把资源量换算成钱币做展示；精确值请从存档读.
export const COIN_COST: Record<number,number> = {1: 1,2: 5,3: 5,5: 5,6: 2,7: 2,8: 5,81: 100,84: 75,85: 1588,9: 2};
export const RES_NAME: Record<number,string> = {
  1:  "寒铁",
2:  "五彩神石",
3:  "破境石",
5:  "强化石",
6:  "神通卷轴",
  7:  "灵纹",
8:  "灵晶",
81: "忘情水",
84: "御灵宝典",
85: "三味真火",
9:  "历史本纪"
};
export const coin = (propId: number,amount: number): string => `${amount.toFixed(0)} ${String(RES_NAME[propId] ?? propId)} ≈ ${(amount * (COIN_COST[propId] ?? 0)).toLocaleString("en-US")} 钱币(兑换)`;

// 缩短单位:万亿/亿/万(本项目展示工具,非游戏机制)
export const fmtShort = (n: number): string => {
  if (!Number.isFinite(n)) {return "∞";}
  if (n >= 1e12) {return `${(n / 1e12).toFixed(2)}万亿`;}
  if (n >= 1e8) {return `${(n / 1e8).toFixed(2)}亿`;}
  if (n >= 1e4) {return `${(n / 1e4).toFixed(2)}万`;}
  return n.toFixed(0);
};

// 装备品质概率表条目.
export interface EquipPercentEntry {
  initialLevel:    number;
  percentLevelAdd: number;
  pinzhi:          number;
}

// 羁绊配置(各脚本共用):levels 按 count 阈值给 level.
export interface JiBanConfig {
  id:     number;
  levels: {count: number; entry: number; level: number}[];
  type:   number;
}

// 取羁绊在 count 人下的等级(取所有满足 count 阈值中的最大 level).
export function bondLevel (jiban: JiBanConfig[],bondType: number,count: number): number {
  const config = jiban.find(item => item.type === bondType);
  if (!config) {return 0;}
  let level = 0;
  for (const item of config.levels) {
    if (count >= item.count && item.level > level) {
      level = item.level;
    }
  }
  return level;
}

// 夹到 [0,1].
export function clamp01 (value: number): number {
  if (value < 0) {
    return 0;
  }
  return Math.min(value,1);
}

// ============================== 各分析脚本共用函数(原散落多文件,集中于此) ==============================
// 组合生成:C(n,k),从 list 取 count 个的有序组合(list 内下标递增).
export function combinationsOf (list: readonly number[],count: number): number[][] {
  const out: number[][] = [];
  const walk = (start: number,picked: number[]): void => {
    if (picked.length === count) {
      out.push([...picked]);
      return;
    }
    for (let i = start; i < list.length; i += 1) {
      const value = list[i];
      if (value === undefined) {continue;}
      picked.push(value);
      walk(i + 1,picked);
      picked.pop();
    }
  };
  walk(0,[]);
  return out;
}

// 炼器升级一级所需经验(研究口径按满 50 级,每本 150).
export function lianQiLevelUpExp (level: number): number {
  if (level <= 10) {
    return level * 20;
  }
  if (level < 20) {
    return 200 + 50 * (level - 10);
  }
  if (level < 30) {
    return 700 + 100 * (level - 20);
  }
  if (level >= 40) {
    return 3700 + 300 * (level - 40);
  }
  return 1700 + 200 * (level - 30);
}

// 按器鼎等级从高到低分配 1000‰ 品质概率.
export function pinZhiDistribution (qiLuLevel: number,table: EquipPercentEntry[]): number[] {
  const percent = Array.from({length: table.length},() => 0);
  for (let index = table.length - 1; index >= 0; index -= 1) {
    const entry = table[index];
    if (!entry) {
      continue;
    }
    const used = percent.reduce((sum,value) => sum + value,0);
    if (used >= 1000) {
      break;
    }
    if (entry.initialLevel >= qiLuLevel) {continue;}
    const remain = 1000 - used;
    const add = Math.min((qiLuLevel - entry.initialLevel) * entry.percentLevelAdd,remain);
    percent[index] = add;
  }
  return percent;
}

// 通天塔层数加成(MapRecorder.cs,层数/100 每万层翻倍的连续段).
export function towerAddition (layer: number): number {
  if (layer <= 10000) {
    return 1;
  }
  const bucket = Math.min(Math.trunc(layer / 10000),200);
  if (layer < 20000) {
    return 1 + (layer - 10000) / 10000 * 9;
  }
  const low = 10 * 2 ** (bucket - 2);
  const high = 10 * 2 ** (bucket - 1);
  const remain = layer % 10000;
  return remain === 0 ? low : remain / 10000 * (high - low) + low;
}

// VIP 升级所需元宝.
export function vipLevelUpCost (nextLevel: number): number {
  return (1 + Math.trunc(nextLevel / 10)) * nextLevel * 60 + 8;
}

// ============================== 演示:逐档表 ==============================
function main (): void {
  console.log("===== 所有资源→战力 系统公式逐档表 =====");
  table("1. 御灵师升级（御力；每10级+500忘情水）",[
    ["Lv.1→2",`${fmt(yuLingLevelCost(1))} 御力`],
    ["Lv.9→10",`${fmt(yuLingLevelCost(9))} 御力`],
    ["Lv.10→11",`${fmt(yuLingLevelCost(10))} 御力 (+突破500忘情水)`],
    ["Lv.50→51",`${fmt(yuLingLevelCost(50))} 御力 (+突破)`],
    ["Lv.100→101",`${fmt(yuLingLevelCost(100))} 御力 (+突破)`],
    ["Lv.1000→1001",`${fmt(yuLingLevelCost(1000))} 御力 (+突破)`],
    ["每级四维增益",`各 +${fmt(yuLingStatPerLevel(100))} (L×250)`]
  ]);
  table("2. 装备强化（强化石5；L≥1e6 花费×5）",[
    ["Lv.0→1",`${fmt(equipStrengthenCost(0))} 强化石`],
    ["Lv.10→11",`${fmt(equipStrengthenCost(10))} 强化石`],
    ["Lv.100→101",`${fmt(equipStrengthenCost(100))} 强化石`],
    ["Lv.1000000→..",`${fmt(equipStrengthenCost(100_0000))} 强化石 (x5档)`],
    ["每级三维增益",`各 +${fmt(equipStrengthenStat(100))} (10+10L)`]
  ]);
  table("3. 制作装备/炼器（寒铁1 = 炼器等级，上限200万）",[
    ["炼器 Lv.1",`${fmt(makeEquipCost(1))} 寒铁`],
    ["炼器 Lv.683",`${fmt(makeEquipCost(683))} 寒铁`],
    ["炼器 Lv.10000",`${fmt(makeEquipCost(10000))} 寒铁`],
    ["炼器 Lv.2000000",`${fmt(makeEquipCost(200_0000))} 寒铁 (上限)`]
  ]);
  table("4. 器鼎（五彩神石2）",[
    ["Lv.1→2",fmt(qiDingCost(1))],
    ["Lv.5→6",fmt(qiDingCost(5))],
    ["Lv.50→51",fmt(qiDingCost(50))],
    ["Lv.237→238",fmt(qiDingCost(237))],
    ["Lv.3998→3999",fmt(qiDingCost(3998))]
  ]);
  table("5. 阵法（灵纹7；四维各+200+35L）",[
    ["Lv.1→2",`${fmt(zhenFaCost(1))} 灵纹`],
    ["Lv.1195→1196",`${fmt(zhenFaCost(1195))} 灵纹`],
    ["Lv.5000→5001",`${fmt(zhenFaCost(5000))} 灵纹`],
    ["每级四维增益",`各 +${fmt(zhenFaStat(100))} (200+35L)`]
  ]);
  table("6. 圣兽（材料；上限5万；升阶后 L≡1 mod 250 时 +1%特殊）",[
    ["第0→1阶",fmt(shengShouCost(0))],
    ["第629→630阶",fmt(shengShouCost(629))],
    ["第1616→1617阶",fmt(shengShouCost(1616))],
    ["第5000→5001阶",`${fmt(shengShouCost(5000))} (上限)`],
    ["每阶两基础增益",`各 +${fmt(shengShouStat(100))} (20+50L)`],
    ["特殊属性",`第500阶 +${String(shengShouSpecialPct(500))}%`]
  ]);
  table("7. 图鉴（图鉴道具=200经验/个，配置值；四维各+50+15L）",[
    ["Lv.1→2",`${String(tuJianItems(1))} 个`],
    ["Lv.50→51",`${String(tuJianItems(50))} 个`],
    ["Lv.63→64",`${String(tuJianItems(63))} 个`],
    ["Lv.1000→1001",`${fmt(tuJianItems(1000))} 个`],
    ["每级四维增益",`各 +${fmt(tuJianStat(100))} (50+15L)`]
  ]);
  table("9. 转职强化（历史本纪9；初始转职+升仙令×1）",[
    ["Lv.0→1",`${fmt(zhuanZhiCost(0))} 历史本纪`],
    ["Lv.50→51",`${fmt(zhuanZhiCost(50))} 历史本纪`],
    ["Lv.1000→1001",`${fmt(zhuanZhiCost(1000))} 历史本纪`],
    ["每级四维增益",`各 +${fmt(zhuanZhiStat(100))} (20+50L)`]
  ]);
  table("12. 神兵炼（忘情水81 / 三味真火85；单级上限100万）",[
    ["Lv.0→1",fmt(shenBingCost(0))],
    ["Lv.9→10",fmt(shenBingCost(9))],
    ["Lv.50→51",fmt(shenBingCost(50))],
    ["Lv.99→100",`${fmt(shenBingCost(99))} (上限)`]
  ]);
  table("13. 英灵等级上限（破境石3 = trunc(Max_Level/100)×10）",[
    ["上限5000→+500",`${fmt(poJingCost(5000))} 破境石`],
    ["上限20000→+500",`${fmt(poJingCost(20000))} 破境石`]
  ]);
  table("11/14/15. 固定/枢纽项",[
    ["御灵装备15级合计",`三围+${fmt(YULING_EQUIP_15_TOTAL.三围)} 三围%+${String(YULING_EQUIP_15_TOTAL.三围Pct)} 暴伤+${String(YULING_EQUIP_15_TOTAL.暴伤)}`],
    ["神通满级总计","38200 神通卷轴(6)"],
    ["科技研究","节点累计历史本纪(9)；俭以养德后整体-85%"],
    ["寻宝第10层产出",`各资源 ${fmt(XUNBAO_LAYER10_YIELD)} 期望（仙葫药155→元宝95）`],
    ["升仙/转职","升仙令(93) ×1；残念(600) 养成"]
  ]);
  console.log("\n===== 完 =====");
}
function table (title: string,rows: [string,string][]): void {
  console.log(`\n=== ${title} ===`);
  for (const [k,v] of rows) {console.log(`  ${k.padEnd(22)} ${v}`);}
}

// 直接运行则演示；被 import 时只导出函数
const isMain = process.argv[1] !== undefined && import.meta.filename === process.argv[1];
if (isMain) {
  main();
}