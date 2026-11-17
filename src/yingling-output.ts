import {existsSync,mkdirSync,writeFileSync} from "node:fs";
import {dirname,join} from "node:path";
import {argNumber,argString,parseArgs} from "./readSave.ts";
import {hitRate,TOWER_ENEMY_10000,TRIAL_ENEMY_100,ZHONG_JU} from "./enemy-stats.ts";
import type {CliArgs} from "./readSave.ts";
import {bondLevel,combinationsOf,culDamagePercent,lianQiLevelUpExp,pinZhiDistribution,sceneDamage,vipLevelUpCost} from "./game-formulas.ts";
import type {EquipPercentEntry,JiBanConfig} from "./game-formulas.ts";
import {loadConfig,runMain} from "./tools.ts";
import type {YingLingConfig} from "./tools.ts";

/**
 * 英灵输出潜力排名(不读存档)
 * 口径(用户指定):
 * - 命中率判定按 100% 命中；命中面板按神通15「每 10% 命中提高 10% 对敌伤害」计入伤害%(点满 = +命中值%)；后羿弓 Lv.15 只按伤害 -20%(×0.8)计入
 * - 初始资源全部代入:御灵师,突破,器鼎,炼器,装备,阵法,神通,VIP
 * - 遍历全部英灵的 5 人组合(C(29,5)=118755),每个组合取其中能打全体的最高输出位
 * - 每个英灵的魔/神两个转职分别作为候选(二选一,不能同时生效)
 * 增伤来源(全部来自反编译;命名 = 英灵 + 1/2/3技能 或 魔转职/神转职):
 * - 后羿弓 Lv.15:伤害 ×0.8
 * - 武松:3技能 最高攻 +35% 增伤(加到伤害加成),神转职 最高攻 +20% 攻击
 * - 关羽:1技能 +3 威慑,神转职 再 +3 威慑 → 6 层
 * - 司马懿:3技能 自身每层威慑 +10% 伤害；神转职 全队每层威慑 +10% 伤害
 * - 猪八戒:3技能 开战全体敌人 +2 流血
 * - 张良:魔转职 每层流血 +20% 伤害
 * - 西施:3技能 开战全体敌人 +3 魅惑
 * - 魅惑:每层使受到伤害 +3%(对所有攻击者生效)
 * - 红拂女:2技能 每层魅惑 +10% 伤害
 * - 白素贞:魔转职 每层魅惑 +3% 伤害
 * - 项羽:1技能 每层流血 +3% 攻击
 * - 鲁智深:神转职 开战全体敌人 +2 怯懦
 * - 公孙胜:神转职 全队每层怯懦 +15% 伤害
 * - 孙悟空:魔转职 开局满怒；1技能 怒气动作打全体且 100%(有魔转职时不扣 30)；3技能 每次攻击 +命中值
 * - 神通15:命中 × Base(1) × 等级 / 10,点满 = +命中值%
 * - 神通19:技能动作 +20×等级(怒气位 +200%)
 * - 神通20:当前怒气 × 0.2 × 等级(普攻位 SP=30 → +30%)
 * - 神通27:按目标身上全部负面层数之和增伤
 */
const HERE = import.meta.dirname;
const OUT_DIR = join(HERE,"output");
const SLOT_COUNT = 5;
const EQUIP_SLOT_COUNT = 10;

// 试炼必须带的英灵:孟婆
const MENG_PO = 24;

// 试炼 100 层敌人速度(LevelToTargetLevel:Base 层数×35,Percent 50+层数)
const TRIAL_SPEED = TRIAL_ENEMY_100.speed;

// 神兵火炼命中轨:Fire_Lian=命中 的 8 件神兵
const SHEN_BING_FIRE_HIT_TRACKS = 8;

// 神兵水炼轨:Water_Lian=伤害加成 2 件,=暴伤 6 件
const SHEN_BING_WATER_DAMAGE_TRACKS = 2;
const SHEN_BING_WATER_CRIT_TRACKS = 6;

// 初始资源:寻宝第 10 层每格固定数量 2,560,000；御力宝箱/御灵宝典各 2,560,000/6；元宝按寻宝大奖 20,488
const INITIAL_RESOURCE = 256_0000;

// 寻宝第 10 层每格固定数量:灵纹,灵晶,强化石,神通卷轴,历史本纪都是 2,560,000；抽奖卷不计入
const INITIAL_LINGWEN = 256_0000;
const INITIAL_YUANBAO = 20488;
const INITIAL_LING_JING = 256_0000;
const INITIAL_STRENGTH_STONE = 256_0000;
const INITIAL_SHEN_TONG_SCROLLS = 256_0000;

// 冥商仙葫药:1,888 元宝 → 10 寻宝体力 → 1 格第 10 层(按期望掉落)
const XUNBAO_PILL_COST = 1888;
const XUNBAO_EXPECTED: readonly (readonly [number,number])[] = [
  [1,62_4640],
  [5,22_5280],
  [6,22_5280],
  [7,32_7680],
  [8,22_5280],
  [9,27_6480],
  [80,256_0000],
  [81,66560],
  [85,66560],
  [92,10_7520]
];

// 点满 30 个神通需要 38,200 卷轴(怒气位跳过神通20 时 35,700)
const SHEN_TONG_SCROLLS = 38200;

// 图鉴:15 种(Prop 901-915),每种每个给 200 经验;初始资源按每种 2,560,000/15 个
const TUJIAN_TYPES = 15;
const TUJIAN_EXP_PER_ITEM = 200;

// Prop_Data_Json:PropID 6 神通卷轴,7 灵纹 的 ValueCost 都是 2 钱币
const SHEN_TONG_SCROLL_COST = 2;
const LING_WEN_COST = 2;

// 用到的英灵索引
const Y = {
  BAI_SU_ZHEN:    12,
  GONG_SUN_SHENG: 7,
  GUAN_YU:        1,
  HONG_FU_NV:     13,
  LU_ZHI_SHEN:    10,
  SHI_QIAN:       9,
  SI_MA_YI:       2,
  SUN_WU_KONG:    26,
  TANG_SAN_ZANG:  27,
  WU_SONG:        6,
  XI_SHI:         14,
  XIANG_YU:       16,
  YUN_XIAO:       22,
  ZHANG_LIANG:    17,
  ZHU_BA_JIE:     28
} as const;

// 唐三藏 3技能:开战全体我方 +30 命中(3 回合)；描述写 35%,源码 Add_MingZhong 是 30
const TANG_SAN_ZANG_HIT = 30;

// 猪八戒 3技能:开战全体敌人 +2 流血,-20 闪避(3 回合)
const ZHU_BA_JIE_DODGE_DOWN = 20;

// 通天塔 10000 层 / 试炼 100 层敌人闪避(用于命中率和西行取经)
const TOWER_ENEMY_DODGE = TOWER_ENEMY_10000.dodge;
const TRIAL_ENEMY_DODGE = TRIAL_ENEMY_100.dodge;

// 后羿弓 Lv.15:伤害 ×0.8
const BOW_DAMAGE = 0.8;

// 阵法名:ZhenFaData.Zhen_Fa_Name = "ZhenFa_Name_{ID}",取自游戏 Language/JianTi_CHN.txt
const ZHEN_FA_NAMES: Record<1 | 7,string> = {
  1: "天覆阵",
  7: "法相阵"
};

// 开战即生效的负面层数(有对应英灵时);主动技能/普攻后叠加的不算首击
const ZHEN_SHE_STACKS = 3; // 关羽神转职 1001 开战 +3;1技能 +2 是主动技能,首击不计
const LIU_XUE_STACKS = 2; // 猪八戒 84
const MEI_HUO_STACKS = 3; // 西施 42
const QIE_NUO_STACKS = 2; // 鲁智深神转职

/**
 * 两个敌人的防御与减伤(Damage_Recorder 口径).
 * - 通天塔 10000 层:Character_Enemy 防御 = roundBaseValue(10000) × GetAddition(161500),
 * 再走 RefineProperty(+2×324%)= 21,351,677,952,000；减伤 0.
 * - 试炼 100 层:Character_YingLing.LevelToTargetLevel 防御 = (400 + 15×796797395) × 601
 * = 7,183,128,756,325；减伤 400 → 封顶 80.
 */
interface Scene {
  def:    number;
  key:    string;
  name:   string;
  reduce: number;
}

const SCENES: readonly [Scene,Scene] = [
  {def: TOWER_ENEMY_10000.def,key: "tower",name: "通天塔 10000 层",reduce: 0},
  {def: 7_1831_2875_6325,key: "shilian",name: "试炼 100 层",reduce: 80}
];

// 暴伤基础:property.json 初始 140 + 15 级橙宝石 200 = 340
const BASE_CRIT_DAMAGE = 340;

// 神谋鬼算 Entry_LuanShiMouCheng:每级 +20 暴伤
const SHEN_MOU_CRIT_PER_LEVEL = 20;
export interface ResourcePanel {
  atkFlat: number;
  atkPct:  number;

  // 突破:先幸运到 5 万,之后全速度
  breakthroughCount: number;
  codeYuanbao:       number;

  // 钱币 → 神通卷轴 + 灵纹
  coin:           number;
  crit:           number;
  critDamage:     number;
  damageAddition: number;

  // 河图用:防御 = (御灵师 + 圣兽3 + 阵法 + 图鉴 + 御灵装备 250 万) × (100 + 金玉令 600 + 防御研究%) / 100
  defFlat:             number;
  defPct:              number;
  equipAtkFlat:        number;
  equipAtkPct:         number;
  equipCrit:           number;
  equipCritDamage:     number;
  equipDamageAddition: number;
  equipPenPct:         number;
  finalAtk:            number;
  freeLingwen:         number;
  freeScrolls:         number;
  historyAtk:          number;
  historyLevel:        number;

  // 历史本纪:转职强化(只加输出位自己)
  historyMaterial: number;
  hit:             number;

  // 面板
  hitBase: number;

  // 生命面板:生命基础伤害(鲁智深/秦良玉/岳飞)用
  hpFinal:        number;
  hpFinalZhenfa7: number;
  hpFlat:         number;
  hpPct:          number;
  ironRemain:     number;

  // 炼器 / 寒铁 / 强化石
  ironTotal:    number;
  lianqiCrafts: number;
  lianqiLevel:  number;

  // 灵晶:解锁阵法 + 圣兽3(青龙)
  lingJing:        number;
  lingwen:         number;
  lingwenFromCoin: number;
  lucky:           number;
  luckyCount:      number;
  penetration:     number;
  pinzhi:          number;
  qiluLevel:       number;
  qiluRemain:      number;

  // 器鼎
  qiluStone:  number;
  research:   ResearchResult;
  scrollCost: number;

  // 神兵
  shenBingFireBudget:  number;
  shenBingFireHit:     number;
  shenBingWaterBudget: number;
  shenBingWaterCrit:   number;
  shenBingWaterDamage: number;
  shengShou3Atk:       number;
  shengShou3Level:     number;
  shengShou4Atk:       number;
  shengShou4Level:     number;
  shengShouAtk:        number;
  shengShouPen:        number;

  // 神速符:圣兽4(白虎)
  shenSuFuTotal:   number;
  shenTong3:       number;
  speed:           number;
  speedCount:      number;
  speedOk:         boolean;
  strengthAtkFlat: number;
  strengthStone:   number;

  // 通关点数兑换的属性
  tongGuanAtkPct:     number;
  tongGuanCrit:       number;
  tongGuanCritDamage: number;
  tongGuanHit:        number;
  tongGuanPenPct:     number;
  tongGuanYuanbao:    number;

  // VIP:元宝升级,每 2 级 +1 命中/+1 暴击
  totalYuanbao: number;

  // 图鉴:15 种,研究 49-54 计入攻击/防御/穿透与通天塔增伤
  tuJianAtkFlat:   number;
  tuJianCount:     number;
  tuJianDamagePct: number;
  tuJianDefFlat:   number;
  tuJianExp:       number;
  tuJianLevel:     number;
  tuJianPenFlat:   number;
  vipLevel:        number;
  vipRemain:       number;
  vipSpent:        number;
  vipYuanbao:      number;
  xunbaoPills:     number;
  yuanbaoMode:     string;
  yuliBookCount:   number;

  // 御力:御力宝箱 Lv6 + 御灵宝典(各 2,560,000/6)
  yuliChestCount: number;
  yulingshiAtk:   number;
  yulingshiLevel: number;

  // 升级过程中累计的等级和(用于每级 ×250)
  yulingshiLevelSum: number;
  yulingshiRemain:   number;
  yuliTotal:         number;
  zhenfaAtkFlat:     number;

  // 阵法防御(含研究 28),用于河图
  zhenfaDefFlat: number;
  zhenfaLevel:   number;
}
interface CarryVariant {
  form: Form;

  // 1技能 BaseAttack += 自身生命 × hpBaseAttackPct%(鲁智深/秦良玉/岳飞)
  hpBaseAttackPct?: number;
  index:            number;
  label:            string;

  mode: "怒气" | "普攻";

  // 该动作每次攻击加进 PercentAddition 的来源(按 Entry 代码,不是描述)
  sources: readonly SkillSource[];
}

interface ComboResult {

  // 实际攻击与攻防系数
  atk:       number;
  atkFactor: number;
  bond:      number;
  bowFactor: number;
  carry:     CarryVariant;

  // 该输出位实际命中(孙悟空神转职含幸运转命中)
  carryHit: number;
  combo:    number[];

  // 暴击时的伤害倍率 = (暴伤面板 + 20×神谋等级)/100
  critMultiplier: number;
  critShilian:    number;

  critTower:            number;
  damageAdditionFactor: number;

  // 按伤害公式顺序展开的计算式
  formula:        string;
  heTuAttack:     number;
  hitRateShilian: number;
  hitRateTower:   number;

  hpBaseAttack:   number;
  kShilian:       number;
  kTower:         number;
  mingZhongFloor: number;

  // 神谋鬼算等级(羁绊类型 6)
  shenMouLevel:   number;
  shilianNonCrit: number;
  skillFactor:    number;

  // 该输出位实际使用的技能来源(含孙悟空 78 的动态命中值)
  skillSources: SkillSource[];

  sources:      DamageFactor[];
  total:        number;
  towerNonCrit: number;

  // 输出位使用的灵器(武器)
  weapon:     LingQiWeapon;
  weaponNote: string;

  // 阵法:1=最高攻加攻,7=最高生命加生命
  zhenfaFactor: number;
  zhenfaMode:   "attack" | "hp";
}

// 伤害公式的一个独立乘区
interface DamageFactor {
  detail:  string;
  name:    string;
  percent: number;
  value:   number;
}

// 兑换码配置(DuiHuanConfingData)
interface ExchangeCode {
  code:  string;
  props: [number,number][];
}

interface ExchangeConfig {
  codes:    {entries: ExchangeCode[]; source: string};
  tongGuan: {entries: TongGuanEntry[]; source: string; totalPrice: number};
}
type Form = "base" | "mo" | "shen";

// 把所有初始资源按代码里的最佳用途换成面板
interface KeJiConfig {
  cost:       number;
  effectName: number;
  foreId:     number;
  foreLevel:  number;
  id:         number;
  maxLevel:   number;
  percent:    boolean;
  perLevel:   number;
  property:   number;
}

interface LingQiConfig {
  levels:             {atk: number; def: number; hp: number; pinzhi: number}[];
  levelUpRemandCount: number;
  weapons:            LingQiWeapon[];
}

// 灵器(武器):御灵法宝设置 YuLing_Equi_LingQi_Data_Config
interface LingQiWeapon {
  entry:     string;
  entryText: string;
  index:     number;
  name:      string;
}

interface NamesConfig {
  jiBan:     Record<string,string>;
  maps:      Record<string,string>;
  props:     Record<string,string>;
  shengShou: Record<string,string>;
  yingLing:  Record<string,string>;
}

// 初始资源换算出来的面板；全部公式来自反编译
// 研究(KeJi)结果:效果货币是历史本纪,先点俭降低后续研究消耗,再点资源折扣和输出属性
interface ResearchResult {
  atkPct:           number;
  cost:             number;
  crit:             number;
  critDamage:       number;
  damageAddition:   number;
  defPct:           number;
  equipEntryPct:    number;
  equipExpPct:      number;
  equipPropertyPct: number;
  hanTieReduce:     number;
  hit:              number;

  // 研究 3:生命 +1%/级(鲁智深/秦良玉/岳飞的生命基础伤害用到)
  hpPct: number;

  // 研究 22/23 是否把器鼎等级/炼器等级计进装备主属性倍率
  lianQiToEquip: boolean;

  // 研究 14:幸运加进突破幸运,参与孙悟空神转职的命中换算
  luckyBonus: number;

  // 未研究 / 只点了一部分等级的节点
  partial:        string[];
  qiangHuaReduce: number;
  qiDingToEquip:  boolean;
  shopReduce:     number;
  steps:          number;

  // 研究 49-54:图鉴经验/攻击/防御/穿透/每图鉴增伤
  tuJianAtkPct:         number;
  tuJianDamagePerLevel: number;
  tuJianDefPct:         number;
  tuJianExpPct:         number;
  tuJianHpPct:          number;
  tuJianPenPct:         number;
  unresearched:         string[];
  wucaiReduce:          number;
  yuLiReduce:           number;
  zhenFaAtkPct:         number;
  zhenFaDefPct:         number;
  zhenFaHpPct:          number;
  zhenFaPenPct:         number;
  zhenwenReduce:        number;
}

// 一条技能 PercentAddition 来源:value 是 Entry 加的值,skill 是对应技能 ID(用于打印描述)
interface SkillSource {
  skill: number;
  value: number;
}

// 通关点数兑换(TongGuanReward_Data_Config)
interface TongGuanEntry {
  index:    number;
  nums?:    number;
  percent?: boolean;
  price:    number;
  prop:     number;
  type:     "prop" | "property";
  value?:   number;
}

export function bondMultiplier (combo: number[],bondOf: Map<number,number[]>,jiban: JiBanConfig[]): number {
  const counts = new Map<number,number>();
  for (const index of combo) {
    const bonds = bondOf.get(index);
    if (!bonds) {continue;}
    for (const bond of bonds) {
      counts.set(bond,(counts.get(bond) ?? 0) + 1);
    }
  }
  let multiplier = 1;
  for (const [bondType,count] of counts) {
    const level = bondLevel(jiban,bondType,count);

    // 万人敌:伤害% += 等级 × 敌方存活人数(一波 5 个)
    if (bondType === 5) {
      multiplier *= 1 + level * 5 / 100;
    }
  }
  return multiplier;
}

// 三味真火 → 火炼命中:8 条命中轨平均分配
function allocateShenBingFireHit (budget: number): number {
  let best = 0;
  for (let levels = 0; ; levels += 1) {
    const cost = SHEN_BING_FIRE_HIT_TRACKS * shenBingTrackCost(levels);
    if (cost > budget) {
      break;
    }
    const extra = Math.min(
      SHEN_BING_FIRE_HIT_TRACKS,
      Math.trunc((budget - cost) / (10000 * (levels + 1)))
    );
    best = Math.max(best,SHEN_BING_FIRE_HIT_TRACKS * levels + extra);
  }
  return best;
}

// 最终伤害会超过 2^53,只要求有限数；显示按京/垓近似
function assertFinite (value: number,label: string): number {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} 不是有限数：${String(value)}`);
  }
  return value;
}

// 超过 Number 安全整数就报错,避免静默精度丢失
function assertSafe (value: number,label: string): number {
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
    throw new Error(`${label} 超出 Number 安全整数范围：${String(value)}`);
  }
  return value;
}

// 羁绊等级:达到哪个 Count 就取那一档
// 只保留会直接增伤的羁绊；其余羁绊在首击不计
// 只点影响首回合第一下攻击的研究;俭先点,它每升一级立刻降低下一级研究消耗
// 17/21/36-48/56-62 只影响时间/掉落/抽奖/御灵石经验,按用户要求点满但不进面板
const RESEARCH_STEPS: readonly {id: number; level: number}[] = [
  {id: 55,level: 20}, // 俭以养德:研究历史本纪消耗 -1%/级
  {id: 15,level: 50}, // 节衣缩食:寒铁消耗 -50%
  {id: 16,level: 50}, // 日积月累:炼器经验 +50%
  {id: 18,level: 50}, // 精益求精:装备属性 +50%
  {id: 19,level: 20}, // 画龙点睛:额外词条概率 +20%
  {id: 20,level: 50}, // 省吃俭用:五彩神石消耗 -50%
  {id: 22,level: 1},  // 循序渐进:器鼎等级计入装备属性
  {id: 23,level: 1},  // 水涨船高:炼器等级计入装备属性
  {id: 24,level: 10}, // 聚沙成塔(解锁精打细算)
  {id: 25,level: 50}, // 精打细算:强化石消耗 -50%
  {id: 26,level: 50}, // 开源节流:灵纹消耗 -50%
  {id: 27,level: 100}, // 锐不可当:阵法攻击 +100%
  {id: 28,level: 100}, // 固若金汤:阵法防御 +100%
  {id: 29,level: 100}, // 无坚不摧:阵法穿透 +100%
  {id: 17,level: 50}, // 天工开物:炼器速度(只省时间,不进面板)
  {id: 21,level: 50}, // 日新月异:器鼎升级速度(只省时间,不进面板)
  {id: 31,level: 10}, // 满载而归(解锁轻车熟路)
  {id: 32,level: 30}, // 轻车熟路:御力升级消耗 -30%
  {id: 33,level: 30}, // 因陋就简:残念消耗 -30%
  {id: 34,level: 30}, // 化繁为简:破境石消耗 -30%
  {id: 35,level: 20}, // 删繁为简:神通卷轴消耗 -20%
  {id: 36,level: 90}, // 一刻千金:抽奖刷新时间(不进面板)
  {id: 37,level: 3},  // 多多益善:试炼抽奖次数(不进面板)
  {id: 38,level: 5},  // 歪打正着:抽奖刷新道具(不进面板)
  {id: 39,level: 100}, // 遍地开花:全敌掉落概率(不进面板)
  {id: 40,level: 50}, // 鹤立鸡群:精英掉落概率(不进面板)
  {id: 41,level: 50}, // 独树一帜:首领掉落概率(不进面板)
  {id: 42,level: 50}, // 硕果累累:楼楼掉落概率(不进面板)
  {id: 43,level: 50}, // 事半功倍:扫荡收益(不进面板)
  {id: 44,level: 30}, // 价廉物美:商店买价 -30%
  {id: 45,level: 300}, // 分秒必争:商店刷新时间(不进面板)
  {id: 46,level: 3},  // 挥金如土:商店折扣 +3
  {id: 48,level: 100}, // 一闻千悟:御灵石经验(按用户要求点满,不进面板)
  {id: 47,level: 5},  // 百战增勋:突破免费刷新(不进面板)
  {id: 49,level: 100}, // 见多识广:图鉴经验 +100%
  {id: 50,level: 100}, // 攻无不克:图鉴攻击 +100%
  {id: 51,level: 100}, // 鉴如磐石:图鉴防御 +100%
  {id: 52,level: 100}, // 穿云裂石:图鉴穿透 +100%
  {id: 54,level: 5},  // 知己知彼:每图鉴增伤 +5
  {id: 53,level: 100}, // 生龙活虎:图鉴生命 +100%(生命不计入)
  {id: 56,level: 5},  // 意外收获:掉落钱币(不进面板)
  {id: 57,level: 5},  // 偶有所得:掉落历史本纪(不进面板)
  {id: 58,level: 5},  // 天降陨铁:掉落寒铁(不进面板)
  {id: 59,level: 5},  // 严阵以待:掉落灵纹(不进面板)
  {id: 60,level: 5},  // 念兹在兹:掉落随机锦囊(不进面板)
  {id: 61,level: 5},  // 灵心慧性:掉落御灵宝典(不进面板)
  {id: 62,level: 5},  // 枭蛇鬼怪:掉落怪物图鉴(不进面板)
  {id: 1,level: 50},  // 克敌制胜:攻击 +50%
  {id: 2,level: 50},  // 千锤百炼:防御 +50%
  {id: 14,level: 10}, // 洪福齐天:幸运 +10(参与孙悟空神转职命中换算)
  {id: 4,level: 10},  // 风驰电掣:速度 +10(解锁百步穿扬)
  {id: 5,level: 50},  // 百步穿扬:命中 +50
  {id: 7,level: 10},  // 雷霆万钧:暴击 +10(解锁排山倒海/火上浇油)
  {id: 9,level: 50},  // 排山倒海:暴伤 +50
  {id: 12,level: 10}  // 火上浇油:伤害加成 +10
];
const RESEARCH_EFFECT: Record<number,string> = {
  1:   "攻击 +1%/级",
  10:  "连击 +1%/级",
  100: "吸血 +1%/级",
  11:  "反击 +1%/级",
  12:  "伤害加成 +1%/级",
  13:  "减伤 +1%/级",
  14:  "幸运 +1/级",
  15:  "寒铁消耗 -1%/级",
  16:  "炼器经验 +1%/级",
  17:  "炼器速度 +1%/级",
  18:  "装备属性 +1%/级",
  19:  "额外词条概率 +1%/级",
  2:   "防御 +1%/级",
  20:  "五彩神石消耗 -1%/级",
  21:  "器鼎升级速度 +1%/级",
  22:  "器鼎等级计入装备属性",
  23:  "炼器等级计入装备属性",
  24:  "熔炼强化石收益 +1/级",
  25:  "强化石消耗 -1%/级",
  26:  "灵纹消耗 -1%/级",
  27:  "阵法攻击 +1%/级",
  28:  "阵法防御 +1%/级",
  29:  "阵法穿透 +1%/级",
  3:   "生命 +1%/级",
  30:  "阵法生命 +1%/级",
  31:  "御力掉落 +1/级",
  32:  "御力升级消耗 -1%/级",
  33:  "残念消耗 -1%/级",
  34:  "破境石消耗 -1%/级",
  35:  "神通卷轴消耗 -1%/级",
  36:  "抽奖刷新时间 -1/级",
  37:  "试炼抽奖次数 +1/级",
  38:  "抽奖刷新道具 +1/级",
  39:  "全敌掉落概率 +1%/级",
  4:   "速度 +1/级",
  40:  "精英掉落概率 +1%/级",
  41:  "首领掉落概率 +1%/级",
  42:  "楼楼掉落概率 +1%/级",
  43:  "扫荡收益 +1%/级",
  44:  "商店买价 -1%/级",
  45:  "商店刷新时间 -1/级",
  46:  "商店折扣 +1/级",
  47:  "突破免费刷新 +1/级",
  48:  "御灵石经验 +1%/级",
  49:  "图鉴经验 +1%/级",
  5:   "命中 +1/级",
  50:  "图鉴攻击 +1%/级",
  51:  "图鉴防御 +1%/级",
  52:  "图鉴穿透 +1%/级",
  53:  "图鉴生命 +1%/级",
  54:  "每图鉴增伤 +1/级",
  55:  "研究历史本纪消耗 -1%/级",
  56:  "掉落钱币概率 +2%/级",
  57:  "掉落历史本纪概率 +2%/级",
  58:  "掉落寒铁概率 +2%/级",
  59:  "掉落灵纹概率 +2%/级",
  6:   "闪避 +1/级",
  60:  "掉落随机锦囊概率 +2%/级",
  61:  "掉落御灵宝典概率 +1%/级",
  62:  "掉落怪物图鉴概率 +1%/级",
  63:  "掉落炼器宝典概率 +1%/级",
  7:   "暴击 +1%/级",
  8:   "抗暴 +1%/级",
  9:   "暴伤 +1%/级"
};

// 未研究节点的原因;没有条目的节点统一写"对首回合第一下攻击无收益"
const RESEARCH_SKIP_REASON: Record<number,string> = {
  10:  "连击不在首回合第一下结算",
  100: "吸血不影响首回合伤害",
  11:  "反击不在首回合第一下结算",
  13:  "减伤不影响我方输出",
  3:   "生命不计入输出",
  30:  "阵法生命不计入输出",
  6:   "闪避不影响首回合伤害",
  63:  "只加掉落炼器宝典概率",
  8:   "抗暴不影响首回合伤害"
};

// 已点但没点满的原因
const RESEARCH_PARTIAL_REASON: Record<number,string> = {
  24: "只加熔炼强化石收益，本表不熔炼",
  31: "只加御力掉落，本表御力按初始资源",
  4:  "速度 3,675,816 已远超试炼 100 层的 8,750，继续点只加速度",
  7:  "本表按暴击时伤害计算，不乘暴击率"
};
export function buildResourcePanel (args: CliArgs): ResourcePanel {
  const resource = argNumber(args,"resource") ?? INITIAL_RESOURCE;
  const baseYuanbao = argNumber(args,"yuanbao") ?? INITIAL_YUANBAO;
  const research = buildResearchPlan();
  const equipPercent = loadConfig<EquipPercentEntry[]>("equip-percent");
  const exchange = loadConfig<ExchangeConfig>("exchange");
  const extra = new Map<number,number>();
  let codeYuanbao = 0;
  for (const entry of exchange.codes.entries) {
    for (const [prop,nums] of entry.props) {
      extra.set(prop,(extra.get(prop) ?? 0) + nums);
      if (prop === 95) {
        codeYuanbao += nums;
      }
    }
  }
  let tongGuanYuanbao = 0;
  const tongGuanProperty = new Map<number,number>();
  for (const entry of exchange.tongGuan.entries) {
    if (entry.type === "prop") {
      const nums = entry.nums ?? 0;
      extra.set(entry.prop,(extra.get(entry.prop) ?? 0) + nums);
      if (entry.prop === 95) {
        tongGuanYuanbao += nums;
      }
    } else {
      tongGuanProperty.set(entry.prop,(tongGuanProperty.get(entry.prop) ?? 0) + (entry.value ?? 0));
    }
  }
  const extraOf = (prop: number): number => extra.get(prop) ?? 0;
  const tgProperty = (prop: number): number => tongGuanProperty.get(prop) ?? 0;

  // 御力宝箱 Lv6 / 御灵宝典各 2,560,000/6
  const yuliChestCount = Math.floor(resource / 6);
  const yuliBookCount = Math.floor(resource / 6);
  const yuliTotal =
    yuliChestCount * 60_0000 +
    yuliBookCount * 100 +
    extraOf(4) +
    extraOf(21) * 20_0000 +
    extraOf(29) * 100_0000;
  const yulingshi = yuLingShiLevel(yuliTotal,research.yuLiReduce);
  const yulingshiLevelSum = (yulingshi.level - 1) * yulingshi.level / 2;
  const yulingshiAtk = yulingshiLevelSum * 250;

  // 突破:先幸运到 5 万,之后全速度
  const breakthroughCount = Math.trunc(yulingshi.level / 10);
  let luckyCount = 0;
  let lucky = 0;
  let speedCount = 0;
  let speed = 0;
  for (let index = 1; index <= breakthroughCount; index += 1) {
    const value = 2 + Math.trunc(4 * index * 1.75);
    if (lucky < 50000) {
      lucky += value;
      luckyCount += 1;
    } else {
      speed += value;
      speedCount += 1;
    }
  }
  const isSpeedOk = speed > TRIAL_SPEED;

  // 研究 14:幸运 +10,和突破幸运一起参与孙悟空神转职的 floor(幸运/100)×5 命中换算
  const luckyTotal = lucky + research.luckyBonus;

  // 元宝 = 初始 + 兑换码 + 通关点数；--yuanbao-mode=shop 时先买仙葫药换寻宝
  const totalYuanbao = baseYuanbao + codeYuanbao + tongGuanYuanbao;
  const yuanbaoMode = argString(args,"yuanbao-mode") ?? "shop";
  let xunbaoPills = 0;
  let vipYuanbao = totalYuanbao;
  if (yuanbaoMode === "shop") {
    xunbaoPills = Math.floor(totalYuanbao / XUNBAO_PILL_COST);
    vipYuanbao = totalYuanbao - xunbaoPills * XUNBAO_PILL_COST;
    for (const [prop,nums] of XUNBAO_EXPECTED) {
      extra.set(prop,(extra.get(prop) ?? 0) + nums * xunbaoPills);
    }
  }
  const vip = vipLevel(vipYuanbao);

  // 五彩神石 → 器鼎 → 装备品质
  const qiluStone = resource + extraOf(2);
  const qilu = qiLuLevel(qiluStone,research.wucaiReduce);
  const distribution = pinZhiDistribution(qilu.level,equipPercent);
  let pinzhi = 0;
  for (const [index,element] of distribution.entries()) {
    pinzhi += element / 1000 * (equipPercent[index]?.pinzhi ?? 0);
  }

  // 寒铁 → 制作装备；炼器宝典(兑换码)额外给经验；日积月累研究(16)放大每次经验
  const lianqiExpScale = (100 + research.equipExpPct) / 100;
  let lianqiLevel = 1;
  let lianqiExp = extraOf(86) * 100 * lianqiExpScale;
  while (lianqiExp >= lianQiLevelUpExp(lianqiLevel)) {
    lianqiExp -= lianQiLevelUpExp(lianqiLevel);
    lianqiLevel += 1;
  }
  const ironTotal = resource + extraOf(1);
  let ironRemain = ironTotal;
  let lianqiCrafts = 0;
  while (ironRemain >= Math.max(1,Math.round(lianqiLevel * (100 - research.hanTieReduce) / 100))) {
    const craftCost = Math.max(1,Math.round(lianqiLevel * (100 - research.hanTieReduce) / 100));
    ironRemain -= craftCost;
    lianqiExp += (lianqiLevel + 2) * lianqiExpScale;
    lianqiCrafts += 1;
    while (lianqiExp >= lianQiLevelUpExp(lianqiLevel)) {
      lianqiExp -= lianQiLevelUpExp(lianqiLevel);
      lianqiLevel += 1;
    }
  }

  // 研究 18/22/23:GetEqui_PropertyAddition = 装备属性等级 + 器鼎等级(22) + 炼器等级(23)
  const equipPropertyAddition =
    research.equipPropertyPct +
    (research.qiDingToEquip ? qilu.level : 0) +
    (research.lianQiToEquip ? lianqiLevel : 0);
  const equipValue = Math.trunc(
    (30 + 25 * lianqiLevel + 6 * pinzhi * lianqiLevel) * (0.4 * pinzhi + 1) * 1.05 *
    (100 + equipPropertyAddition) / 100
  );
  const equipAtkFlat = equipValue * EQUIP_SLOT_COUNT;

  // 输出向 10 槽:攻击% 7 条,伤害加成/暴伤/暴击/穿透% 各 2 条；研究 19 的额外词条按期望条数放大
  const equipEntryScale = (4 + research.equipEntryPct / 100) / 4;
  const equipAtkPct = pinzhi * 7 * equipEntryScale;
  const equipDamageAddition = pinzhi * 2 * equipEntryScale;
  const equipCritDamage = pinzhi * 2 * equipEntryScale;
  const equipCrit = pinzhi * 2 * equipEntryScale;
  const equipPenPct = pinzhi * 2 * equipEntryScale;

  // 强化石:初始 256,000 + 兑换码/通关点数
  const strengthStone = INITIAL_STRENGTH_STONE + extraOf(5);
  const strengthAtkFlat = strengthAtkFromStones(strengthStone,research.qiangHuaReduce);

  // 钱币 → 先补足神通卷轴,剩余买灵纹
  const coin = resource + extraOf(80);
  const freeScrolls = INITIAL_SHEN_TONG_SCROLLS + extraOf(6);
  const buyScrolls = Math.max(0,SHEN_TONG_SCROLLS - freeScrolls);
  const shopScale = (100 - research.shopReduce) / 100;
  const scrollCost = buyScrolls * SHEN_TONG_SCROLL_COST * shopScale;
  const lingwenPrice = LING_WEN_COST * shopScale;
  const freeLingwen = extraOf(7);
  const lingwen =
    argNumber(args,"lingwen") ??
    INITIAL_LINGWEN + freeLingwen + Math.floor((coin - scrollCost) / lingwenPrice);
  let zhenfaLevel = 1;
  let remainLingwen = lingwen;
  const zhenfaCost = (level: number): number => Math.max(1,Math.round(level * 20 * (100 - research.zhenwenReduce) / 100));
  while (remainLingwen >= zhenfaCost(zhenfaLevel)) {
    remainLingwen -= zhenfaCost(zhenfaLevel);
    zhenfaLevel += 1;
  }
  zhenfaLevel = argNumber(args,"zhenfa-level") ?? zhenfaLevel;

  // 阵法:每级 HP/ATK/DEF/穿透 各 +200+35×等级；研究 27/28/29 给 ATK/DEF/穿透 PercentAddition +100
  let zhenfaBase = 0;
  for (let level = 1; level < zhenfaLevel; level += 1) {
    zhenfaBase += 200 + 35 * level;
  }
  const zhenfaAtkFlat = Math.trunc(zhenfaBase * (100 + research.zhenFaAtkPct) / 100);
  const zhenfaDefFlat = Math.trunc(zhenfaBase * (100 + research.zhenFaDefPct) / 100);
  const zhenfaPenFlat = Math.trunc(zhenfaBase * (100 + research.zhenFaPenPct) / 100);
  const lingJing = INITIAL_LING_JING + extraOf(8);

  // 灵晶:先 900 解锁全部阵法,剩余升圣兽3(青龙:攻击/防御)
  const shengShou3 = shengShouUpgrade(Math.max(0,lingJing - 900));

  // 神速符:升圣兽4(白虎:攻击/穿透)
  const shenSuFuTotal = resource + extraOf(92);
  const shengShou4 = shengShouUpgrade(shenSuFuTotal);
  const shengShouAtk = shengShou3.atk + shengShou4.atk;
  const shengShouPen = shengShou4.atk;

  // 图鉴:15 种,每种 floor(2,560,000/15) 个 × 200 经验;研究 49 放大经验
  const tuJianCount = Math.floor(resource / TUJIAN_TYPES);
  const tuJianExp = tuJianCount * TUJIAN_EXP_PER_ITEM * (100 + research.tuJianExpPct) / 100;
  const tuJianLevelValue = tuJianLevel(tuJianExp);
  const tuJianBasePerType =
    50 * tuJianLevelValue + 15 * tuJianLevelValue * (tuJianLevelValue - 1) / 2;
  const tuJianAtkFlat = Math.trunc(
    tuJianBasePerType * TUJIAN_TYPES * (100 + research.tuJianAtkPct) / 100
  );
  const tuJianDefFlat = Math.trunc(
    tuJianBasePerType * TUJIAN_TYPES * (100 + research.tuJianDefPct) / 100
  );
  const tuJianPenFlat = Math.trunc(
    tuJianBasePerType * TUJIAN_TYPES * (100 + research.tuJianPenPct) / 100
  );
  const tuJianHpFlat = Math.trunc(
    tuJianBasePerType * TUJIAN_TYPES * (100 + research.tuJianHpPct) / 100
  );

  // 生命面板:御灵师 + 阵法 HP + 御灵装备 250万 + 神通1 + 图鉴 HP
  // 金玉令 +600% 生命；阵法7 再给全队 +30% 生命,并给最高生命单位 +阵法等级% 当前生命
  const zhenfaHpFlat = Math.trunc(zhenfaBase * (100 + research.zhenFaHpPct) / 100);
  const hpFlat = yulingshiAtk + zhenfaHpFlat + 250_0000 + 20 + tuJianHpFlat;
  const hpPct = 600 + research.hpPct;
  const hpFinal = hpFlat * (100 + hpPct) / 100;
  const hpFinalZhenfa7 =
    hpFlat * (100 + hpPct + 30) / 100 * (1 + zhenfaLevel / 100);

  // 研究 54:Character_Enemy 开战获得 Add_BeDamage = 图鉴等级 × 5,只作用通天塔
  const tuJianDamagePct = tuJianLevelValue * research.tuJianDamagePerLevel;

  // 历史本纪 → 先付研究消耗,剩余转职强化(与圣兽同公式:10+10L 材料,20+50L 攻击/穿透)
  const historyMaterial = Math.max(0,resource + extraOf(9) - research.cost);
  const history = shengShouUpgrade(historyMaterial);

  // 通关点数兑换的永久属性
  const tongGuanAtkPct = tgProperty(0);
  const tongGuanCritDamage = tgProperty(8);
  const tongGuanHit = tgProperty(4);
  const tongGuanCrit = tgProperty(6);
  const tongGuanPenPct = tgProperty(15);

  // 面板:15 级御灵装备(金玉令 +600% 三围,后羿弓/金玉令/6 宝石各 +250 万,橙宝石暴伤 +200)
  const vipHit = Math.trunc(vip.level / 2);
  const hitBase = 55 + 10 + tongGuanHit + vipHit + research.hit;
  const crit = 55 + 10 + equipCrit + tongGuanCrit + vipHit + research.crit;
  const damageAdditionBase = equipDamageAddition + 15 + research.damageAddition;
  const critDamageBase =
    BASE_CRIT_DAMAGE + equipCritDamage + 70 + tongGuanCritDamage + research.critDamage;

  // 神兵:速度超过试炼 100 层后,火炼才能选命中；否则只能选速度
  const shenBingFireBudget = resource + extraOf(85);
  const shenBingWaterBudget = resource + extraOf(81);
  const shenBingFireHit = isSpeedOk ? allocateShenBingFireHit(shenBingFireBudget) : 0;
  const water = optimizeShenBingWater(
    shenBingWaterBudget,
    100 + damageAdditionBase,
    critDamageBase
  );
  const hit = hitBase + shenBingFireHit;
  const damageAddition = damageAdditionBase + water.damage;
  const critDamage = critDamageBase + water.crit;
  const atkFlat =
    yulingshiAtk +
    zhenfaAtkFlat +
    equipAtkFlat +
    250_0000 +
    20 +
    strengthAtkFlat +
    shengShouAtk +
    tuJianAtkFlat +
    history.atk;
  const atkPct = 600 + equipAtkPct + 15 + tongGuanAtkPct + research.atkPct;
  const defFlat = yulingshiAtk + shengShou3.atk + zhenfaDefFlat + tuJianDefFlat;
  const penetration =
    (yulingshiAtk + zhenfaPenFlat + tuJianPenFlat + 20 + shengShouPen + history.atk) *
    (1 + tongGuanPenPct / 100);
  const finalAtk = atkFlat * ((100 + atkPct) / 100) * (1 + zhenfaLevel / 100);
  const shenTong3 = Math.min(hit,21_4748_3637);
  return {
    atkFlat,
    atkPct,
    breakthroughCount,
    codeYuanbao,
    coin,
    crit,
    critDamage,
    damageAddition,
    defFlat,
    defPct:              research.defPct,
    equipAtkFlat,
    equipAtkPct,
    equipCrit,
    equipCritDamage,
    equipDamageAddition,
    equipPenPct,
    finalAtk,
    freeLingwen,
    freeScrolls,
    historyAtk:          history.atk,
    historyLevel:        history.level,
    historyMaterial,
    hit,
    hitBase,
    hpFinal,
    hpFinalZhenfa7,
    hpFlat,
    hpPct,
    ironRemain,
    ironTotal,
    lianqiCrafts,
    lianqiLevel,
    lingJing,
    lingwen,
    lingwenFromCoin:     Math.floor((coin - scrollCost) / lingwenPrice),
    lucky:               luckyTotal,
    luckyCount,
    penetration,
    pinzhi,
    qiluLevel:           qilu.level,
    qiluRemain:          qilu.remain,
    qiluStone,
    research,
    scrollCost,
    shenBingFireBudget,
    shenBingFireHit,
    shenBingWaterBudget,
    shenBingWaterCrit:   water.crit,
    shenBingWaterDamage: water.damage,
    shengShou3Atk:       shengShou3.atk,
    shengShou3Level:     shengShou3.level,
    shengShou4Atk:       shengShou4.atk,
    shengShou4Level:     shengShou4.level,
    shengShouAtk,
    shengShouPen,
    shenSuFuTotal,
    shenTong3,
    speed,
    speedCount,
    speedOk:             isSpeedOk,
    strengthAtkFlat,
    strengthStone,
    tongGuanAtkPct,
    tongGuanCrit,
    tongGuanCritDamage,
    tongGuanHit,
    tongGuanPenPct,
    tongGuanYuanbao,
    totalYuanbao,
    tuJianAtkFlat,
    tuJianCount,
    tuJianDamagePct,
    tuJianDefFlat,
    tuJianExp,
    tuJianLevel:         tuJianLevelValue,
    tuJianPenFlat,
    vipLevel:            vip.level,
    vipRemain:           vip.remain,
    vipSpent:            vip.spent,
    vipYuanbao,
    xunbaoPills,
    yuanbaoMode,
    yuliBookCount,
    yuliChestCount,
    yulingshiAtk,
    yulingshiLevel:      yulingshi.level,
    yulingshiLevelSum,
    yulingshiRemain:     yulingshi.remain,
    yuliTotal,
    zhenfaAtkFlat,
    zhenfaDefFlat,
    zhenfaLevel
  };
}
function buildResearchPlan (): ResearchResult {
  const configs = loadConfig<KeJiConfig[]>("keji");
  const names = loadConfig<{keJiName: Record<string,string>}>("names");
  const byId = new Map(configs.map(item => [item.id,item]));
  const levels = new Map<number,number>();
  let reduceLiShi = 0;
  let cost = 0;

  // 逐级扣费:俭每升 1 级,下一级研究立刻少 1% 历史本纪
  for (const step of RESEARCH_STEPS) {
    const config = byId.get(step.id);
    if (!config) {
      continue;
    }
    const start = levels.get(step.id) ?? 0;
    for (let level = start; level < step.level; level += 1) {
      cost += Math.round(config.cost * (100 - reduceLiShi) / 100);
      if (step.id === 55) {
        reduceLiShi = Math.min(20,level + 1);
      }
    }
    levels.set(step.id,step.level);
  }
  const levelOf = (id: number): number => levels.get(id) ?? 0;
  const per = (id: number): number => (byId.get(id)?.perLevel ?? 0) * levelOf(id);
  const nameOf = (id: number): string => names.keJiName[String(id)] ?? `研究${String(id)}`;
  const planned = new Set(RESEARCH_STEPS.map(step => step.id));
  const unresearched: string[] = [];
  const partial: string[] = [];
  const sortedConfigs = [...configs].toSorted((left,right) => left.id - right.id);
  for (const config of sortedConfigs) {
    const effect = RESEARCH_EFFECT[config.id] ?? `效果 ${String(config.effectName)}/${String(config.property)}`;
    if (!planned.has(config.id)) {
      unresearched.push(
        `  - ${nameOf(config.id)}（${effect}）：${RESEARCH_SKIP_REASON[config.id] ?? "对首回合第一下攻击无收益"}`
      );
      continue;
    }
    const level = levelOf(config.id);
    if (level < config.maxLevel) {
      partial.push(
        `  - ${nameOf(config.id)} Lv.${String(level)}/${String(config.maxLevel)}（${effect}）：${RESEARCH_PARTIAL_REASON[config.id] ?? "已满足需求，继续点无收益"}`
      );
    }
  }
  return {
    atkPct:               per(1),
    cost,
    crit:                 per(7),
    critDamage:           per(9),
    damageAddition:       per(12),
    defPct:               per(2),
    equipEntryPct:        per(19),
    equipExpPct:          per(16),
    equipPropertyPct:     per(18),
    hanTieReduce:         per(15),
    hit:                  per(5),
    hpPct:                per(3),
    lianQiToEquip:        levelOf(23) > 0,
    luckyBonus:           per(14),
    partial,
    qiangHuaReduce:       per(25),
    qiDingToEquip:        levelOf(22) > 0,
    shopReduce:           per(44),
    steps:                RESEARCH_STEPS.length,
    tuJianAtkPct:         per(50),
    tuJianDamagePerLevel: per(54),
    tuJianDefPct:         per(51),
    tuJianExpPct:         per(49),
    tuJianHpPct:          per(53),
    tuJianPenPct:         per(52),
    unresearched,
    wucaiReduce:          per(20),
    yuLiReduce:           per(32),
    zhenFaAtkPct:         per(27),
    zhenFaDefPct:         per(28),
    zhenFaHpPct:          per(30),
    zhenFaPenPct:         per(29),
    zhenwenReduce:        per(26)
  };
}
function formatInt (value: number): string {
  return Math.round(value).toLocaleString("zh-CN");
}
function formatWan (value: number): string {
  if (Math.abs(value) >= 1e20) {
    return `${(value / 1e20).toFixed(2)} 垓`;
  }
  if (Math.abs(value) >= 1e16) {
    return `${(value / 1e16).toFixed(2)} 京`;
  }
  if (Math.abs(value) >= 1e12) {
    return `${(value / 1e12).toFixed(2)} 万亿`;
  }
  if (Math.abs(value) >= 1e8) {
    return `${(value / 1e8).toFixed(2)} 亿`;
  }
  if (Math.abs(value) >= 1e4) {
    return `${(value / 1e4).toFixed(2)} 万`;
  }
  return Math.round(value).toString();
}

// PropHelper.GetLianQiLevelUpExp:炼器每级所需经验
function main (): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.get("help") === true) {
    console.log(
      [
        "用法：pnpm exec tsx src/scripts/yingling-output.ts [参数]",
        "",
        "  --top=30         每个输出位显示前几名组合（默认 30）",
        "  --resource=2560000 每项初始资源数量（默认 2,560,000）",
        "  --yuanbao=20488  初始元宝（默认 20,488）",
        "  --yuanbao-mode=vip|shop 元宝用途：全升 VIP / 先买仙葫药换寻宝",
        "  --lingwen=N      覆盖初始灵纹（默认=寻宝第10层期望+钱币购买）",
        "  --zhenfa-level=N 直接指定阵法等级（默认按灵纹推算）",
        "  --out=路径       结果输出文件（默认 ../output/输出英灵排名.md）"
      ].join("\n")
    );
    return;
  }
  const yingLingConfig = loadConfig<YingLingConfig[]>("yingling");
  const jiban = loadConfig<JiBanConfig[]>("jiban");
  const names = loadConfig<NamesConfig>("names");
  const lingQi = loadConfig<LingQiConfig>("lingqi");
  const skillTexts = loadConfig<Record<string,string>>("skill-text");
  const bowWeapon = lingQi.weapons.find(weapon => weapon.entry === "HouYiGong");
  if (!bowWeapon) {
    throw new Error("lingqi.json 里找不到后羿弓");
  }
  const WEAPON_LEVEL = 15;
  const bondOf = new Map<number,number[]>();
  for (const config of yingLingConfig) {
    bondOf.set(config.index,config.bonds);
  }
  const nameOf = (index: number): string => names.yingLing[String(index)] ?? `英灵${String(index)}`;

  // 队友转职要求:只标模型实际依赖的转职；没列出的队友不需要转职
  // 关羽神/鲁智深神给开战威慑/怯懦,司马懿神/公孙胜神给全队光环,
  // 张良神给全队怒气,红拂女神给命中保底,武松神给最高攻 +20% 攻击
  const TEAM_TRANSFER: Partial<Record<number,"神" | "魔">> = {
    [Y.GONG_SUN_SHENG]: "神",
    [Y.GUAN_YU]:        "神",
    [Y.HONG_FU_NV]:     "神",
    [Y.LU_ZHI_SHEN]:    "神",
    [Y.SI_MA_YI]:       "神",
    [Y.WU_SONG]:        "神",
    [Y.ZHANG_LIANG]:    "神"
  };
  const comboText = (combo: number[],carryIndex?: number,shouldExcludeCarry = false): string => combo
      .filter(index => !shouldExcludeCarry || index !== carryIndex)
      .map(index => {
        const transfer = index === carryIndex ? undefined : TEAM_TRANSFER[index];
        return `${nameOf(index)}${transfer ? `（${transfer}）` : ""}`;
      })
      .join("、");

  // 技能 ID → 可读名(英灵 + 1/2/3技能 或 魔转职/神转职)；同一技能 ID 会被多个英灵复用,按输出位解析
  const skillSlots = new Map<string,{name: string; text: string}>();
  for (const config of yingLingConfig) {
    const owner = nameOf(config.index);
    for (const [slot,id] of config.skills.entries()) {
      skillSlots.set(`${String(config.index)}:${String(id)}`,{
        name: `${owner}${String(slot + 1)}技能`,
        text: skillTexts[String(id)] ?? "无描述"
      });
    }
    skillSlots.set(`${String(config.index)}:${String(config.skillMo)}`,{
      name: `${owner}魔转职`,
      text: skillTexts[String(config.skillMo)] ?? "无描述"
    });
    skillSlots.set(`${String(config.index)}:${String(config.skillShen)}`,{
      name: `${owner}神转职`,
      text: skillTexts[String(config.skillShen)] ?? "无描述"
    });
  }
  const skillSlotOf = (ownerIndex: number,skill: number): {name: string; text: string} => skillSlots.get(`${String(ownerIndex)}:${String(skill)}`) ?? {
      name: `英灵${String(ownerIndex)}技能${String(skill)}`,
      text: skillTexts[String(skill)] ?? "无描述"
    };

  // 初始资源全部代入:御灵师 / 突破 / 器鼎 / 炼器 / 装备 / 阵法 / 神通 / VIP
  const panel = buildResourcePanel(args);

  // 阵法 1:面板攻击 +15%(已算进 panel.atkPct)；Entry_ZhenFa_1 给最高攻单位 +阵法等级% 攻击
  // 组合里某个羁绊类型的等级
  const comboBondLevel = (combo: number[],bondType: number): number => {
    let count = 0;
    for (const index of combo) {
      if ((bondOf.get(index) ?? []).includes(bondType)) {
        count += 1;
      }
    }
    return bondLevel(jiban,bondType,count);
  };

  /**
   * 群攻输出位表:全部按 Entry 代码核对(不按技能描述).
   * sources 是每次攻击对每个目标加进 PercentAddition 的来源,最终技能倍率 = Π(100+source)/100.
   * - 司马懿:2技能 普攻 -20,魔转职 让目标=5 且 +20；怒气 1技能 全体,无伤害来源,魔转职 +20
   * - 公孙胜:2技能 普攻 -10,魔转职 让目标=全体且 +20；怒气 1技能 全体,魔转职 +20
   * - 时迁:2技能 在魔转职时目标=全体,无伤害来源；怒气 1技能 -65
   * - 白素贞:2技能 -35；1技能 +20
   * - 张良:2技能 -40；1技能 无伤害来源
   * - 云霄:2技能 -20；1技能 +40
   * - 孙悟空:1技能 在无魔转职时 -30,魔转职时 0
   * - 荆轲:1技能 每次攻击 300×num/目标数-100,5 目标=0.6；魔转职 num=2 -> 1.2
   * - 二郎神:1技能 无魔转职时 -20/3 目标,有魔转职时 -35/5 目标
   * - 猪八戒:1技能 有魔转职时 5 目标,-50
   * - 项羽:1技能 +60；魔转职 让目标=5
   * - 鲁智深/秦良玉/岳飞:1技能 -50,且 BaseAttack += 自身生命×20%(未建模)
   */
  const CARRIES: Record<
    number,
    readonly {
      form:             Form;
      hpBaseAttackPct?: number;
      label:            string;
      mode:             "怒气" | "普攻";
      sources:          readonly SkillSource[];
    }[]
  > = {
    10: [{form: "base",hpBaseAttackPct: 20,label: "怒气50%+生命20%基础伤害",mode: "怒气",sources: [{skill: 28,value: -50}]}],
    12: [
      {form: "mo",label: "普攻65%",mode: "普攻",sources: [{skill: 35,value: -35}]},
      {form: "mo",label: "怒气120%",mode: "怒气",sources: [{skill: 34,value: 20}]},
      {form: "shen",label: "普攻65%",mode: "普攻",sources: [{skill: 35,value: -35}]},
      {form: "shen",label: "怒气120%",mode: "怒气",sources: [{skill: 34,value: 20}]}
    ],
    15: [{form: "base",hpBaseAttackPct: 20,label: "怒气50%+生命20%基础伤害",mode: "怒气",sources: [{skill: 43,value: -50}]}],
    16: [{form: "mo",label: "怒气160%(5目标)",mode: "怒气",sources: [{skill: 46,value: 60}]}],
    17: [
      {form: "mo",label: "普攻60%",mode: "普攻",sources: [{skill: 50,value: -40}]},
      {form: "mo",label: "怒气100%",mode: "怒气",sources: []},
      {form: "shen",label: "普攻60%",mode: "普攻",sources: [{skill: 50,value: -40}]},
      {form: "shen",label: "怒气100%",mode: "怒气",sources: []}
    ],
    18: [{form: "mo",label: "怒气120%/目标(5目标)",mode: "怒气",sources: [{skill: 52,value: 20}]}],
    2:  [
      {form: "mo",label: "普攻全体",mode: "普攻",sources: [{skill: 5,value: -20},{skill: 1002,value: 20}]},
      {form: "mo",label: "怒气100%",mode: "怒气",sources: [{skill: 1002,value: 20}]},
      {form: "shen",label: "怒气100%",mode: "怒气",sources: []}
    ],
    20: [{form: "base",hpBaseAttackPct: 20,label: "怒气50%+生命20%基础伤害",mode: "怒气",sources: [{skill: 58,value: -50}]}],
    21: [{form: "mo",label: "怒气65%(5目标)",mode: "怒气",sources: [{skill: 61,value: -35}]}],
    22: [
      {form: "base",label: "普攻80%",mode: "普攻",sources: [{skill: 65,value: -20}]},
      {form: "base",label: "怒气140%",mode: "怒气",sources: [{skill: 64,value: 40}]}
    ],

    // 孙悟空:1技能只有怒气动作才把目标改成全体；普攻是单体,不能作为群攻输出位.
    // 3技能每次攻击 +命中值(动态,神转职含幸运命中)；神转职没有满怒,怒气 -30.
    26: [
      {form: "mo",label: "怒气100%(满怒)+命中",mode: "怒气",sources: []},
      {form: "shen",label: "怒气70%(无满怒-30%)+命中",mode: "怒气",sources: [{skill: 76,value: -30}]}
    ],
    28: [{form: "mo",label: "怒气50%(5目标)",mode: "怒气",sources: [{skill: 82,value: -50}]}],
    7:  [
      {form: "mo",label: "普攻全体",mode: "普攻",sources: [{skill: 20,value: -10},{skill: 1012,value: 20}]},
      {form: "mo",label: "怒气100%",mode: "怒气",sources: [{skill: 1012,value: 20}]}
    ],
    9: [
      {form: "mo",label: "普攻全体100%",mode: "普攻",sources: []},
      {form: "mo",label: "怒气35%",mode: "怒气",sources: [{skill: 25,value: -65}]}
    ]
  };
  const carriesOf = (index: number): CarryVariant[] => (CARRIES[index] ?? []).map(item => ({index,...item}));

  // 孙悟空神转职命中 100%,可以自由选择武器；其他输出位必须带后羿弓
  const weaponsOf = (carry: CarryVariant): LingQiWeapon[] => (carry.index === Y.SUN_WU_KONG && carry.form === "shen"
      ? lingQi.weapons
      : [bowWeapon]);

  /**
   * 该组合首回合第一次行动前能否攒到 100 怒气.
   * 开战:时迁3技能 全队 +30;张良3技能 全队 +10(神转职 +20)
   * 回合开始(先于第一次行动):孙悟空神转职 +25,孟婆魔转职 +50,项羽魔转职 +15;张良自己额外 +10/+20
   * 满怒:孙悟空魔转职;项羽3技能把 MaxSP 降到 51,门槛变 50
   * @param combo 组合.
   * @param carry 输出位.
   * @param weapon 武器.
   * @returns 能否攒满怒气.
   */
  const canRage = (combo: number[],carry: CarryVariant,weapon: LingQiWeapon): boolean => {
    if (carry.mode !== "怒气") {
      return true;
    }
    if (carry.index === Y.SUN_WU_KONG && carry.form === "mo") {
      return true;
    }
    let sp = 30;
    if (weapon.entry === "RenHuangYin") {
      sp += 50;
    }
    if (combo.includes(Y.SHI_QIAN)) {
      sp += 30;
    }
    if (combo.includes(Y.ZHANG_LIANG)) {
      const isZhangLiangShen = !(carry.index === Y.ZHANG_LIANG && carry.form === "mo");
      sp += isZhangLiangShen ? 20 : 10;
      if (carry.index === Y.ZHANG_LIANG && carry.form === "shen") {
        sp += 20;
      }
    }
    if (carry.index === Y.SUN_WU_KONG && carry.form === "shen") {
      sp += 25;
    }
    if (carry.index === MENG_PO && carry.form === "mo") {
      sp += 50;
    }
    if (carry.index === Y.XIANG_YU && carry.form === "mo") {
      sp += 15;
    }
    const threshold = carry.index === Y.XIANG_YU ? 50 : 100;
    return sp >= threshold;
  };

  /**
   * 输出倍率,严格按伤害公式分桶:
   * 攻击桶 = (100 + 资源攻击% + 武松20%) / 100
   * 基础伤害 = 实际攻击 × K / 100
   * 最终 = 基础伤害 × 技能% × 后羿弓 × Π(各 PercentAddition 来源) × 羁绊 × (100 + 伤害加成 + 武松35)/100
   * 注意:武松 20% 攻击进攻击桶,35% 增伤进伤害加成桶；其余每一条 PercentAddition 都是独立乘区.
   * @param combo 组合.
   * @param carry 输出位.
   * @param bond 羁绊倍率.
   * @param weapon 武器.
   * @param zhenfaMode 阵法模式.
   * @returns 输出倍率结果.
   */
  const outputMultiplier = (
    combo: number[],
    carry: CarryVariant,
    bond: number,
    weapon: LingQiWeapon,
    zhenfaMode: "attack" | "hp"
  ): Pick<
    ComboResult,
    | "atkFactor"
    | "bowFactor"
    | "carryHit"
    | "damageAdditionFactor"
    | "formula"
    | "heTuAttack"
    | "hpBaseAttack"
    | "skillFactor"
    | "skillSources"
    | "sources"
    | "total"
    | "weaponNote"
    | "zhenfaFactor"
  > => {
    const isInCombo = (index: number): boolean => combo.includes(index);

    // 唐三藏3技能:全体我方 +30 命中；孙悟空神转职:按幸运/100×5 加自己命中
    const carryHit =
      panel.hit +
      (isInCombo(Y.TANG_SAN_ZANG) ? TANG_SAN_ZANG_HIT : 0) +
      (carry.index === Y.SUN_WU_KONG && carry.form === "shen"
        ? Math.trunc(panel.lucky / 100) * 5
        : 0);
    const skillSources: SkillSource[] = [...carry.sources];
    if (carry.index === Y.SUN_WU_KONG) {
      skillSources.push({skill: 78,value: carryHit});
    }
    const zhenShe = isInCombo(Y.GUAN_YU) ? ZHEN_SHE_STACKS : 0;
    const liuXue = isInCombo(Y.ZHU_BA_JIE) ? LIU_XUE_STACKS : 0;
    const meiHuo = isInCombo(Y.XI_SHI) ? MEI_HUO_STACKS : 0;
    const qieNuo = isInCombo(Y.LU_ZHI_SHEN) ? QIE_NUO_STACKS : 0;
    const hasSiMa = isInCombo(Y.SI_MA_YI);

    // 司马懿做队友时按神转职提供全队光环；自己做输出位时按所选转职算
    const isSiMaAura = hasSiMa && (carry.index !== Y.SI_MA_YI || carry.form === "shen");
    const isSiMaSelf = hasSiMa && carry.index === Y.SI_MA_YI;

    // 攻击桶:资源面板攻击%(御灵装备 600 + 装备 + 阵法1 面板 15 + 突破)+ 武松 1011 +20%
    // 阵法7 没有阵法1 的 +15% 攻击面板,也没有阵法1 的最高攻 +等级% 攻击
    const isHpZhenfa = zhenfaMode === "hp";
    const zhenFaFactor = isHpZhenfa ? 1 : 1 + panel.zhenfaLevel / 100;
    const atkPct = panel.atkPct + (isInCombo(Y.WU_SONG) ? 20 : 0) - (isHpZhenfa ? 15 : 0);
    const atkFactor = (100 + atkPct) / 100;

    // 伤害加成桶:资源面板伤害加成(装备 + 神通25)+ 武松3技能 +35%
    const damageAddition = panel.damageAddition + (isInCombo(Y.WU_SONG) ? 35 : 0);
    const damageAdditionFactor = (100 + damageAddition) / 100;
    const sources: DamageFactor[] = [];
    const addSource = (name: string,percent: number,detail: string): void => {
      if (percent !== 0) {
        sources.push({detail,name,percent,value: 1 + percent / 100});
      }
    };

    // 魅惑:每层使受到伤害 +3%,对所有攻击者生效
    addSource("魅惑增伤",3 * meiHuo,`每层受到伤害 +3% × ${String(meiHuo)} 层`);

    // 司马懿:神转职 全队每层威慑 +10%；3技能 自身每层威慑 +10%
    if (isSiMaAura) {
      addSource("司马懿神转职增伤",10 * zhenShe,`每层威慑 +10% × ${String(zhenShe)} 层`);
    }
    if (isSiMaSelf) {
      addSource("司马懿3技能增伤",10 * zhenShe,`自身每层威慑 +10% × ${String(zhenShe)} 层`);
    }

    // 公孙胜:神转职 全队每层怯懦 +15%；3技能 自身每层怯懦 +15%(两形态都有)
    if (isInCombo(Y.GONG_SUN_SHENG) && carry.index !== Y.GONG_SUN_SHENG) {
      addSource("公孙胜神转职增伤",15 * qieNuo,`每层怯懦 +15% × ${String(qieNuo)} 层`);
    }
    if (carry.index === Y.GONG_SUN_SHENG) {
      addSource("公孙胜3技能增伤",15 * qieNuo,`自身每层怯懦 +15% × ${String(qieNuo)} 层`);
    }

    // 张良:魔转职 每层流血 +20%
    if (carry.index === Y.ZHANG_LIANG && carry.form === "mo") {
      addSource("张良魔转职增伤",20 * liuXue,`每层流血 +20% × ${String(liuXue)} 层`);
    }

    // 红拂女:2技能 每层魅惑 +10%
    if (carry.index === Y.HONG_FU_NV) {
      addSource("红拂女2技能增伤",10 * meiHuo,`每层魅惑 +10% × ${String(meiHuo)} 层`);
    }

    // 白素贞:魔转职 每层魅惑 +3%
    if (carry.index === Y.BAI_SU_ZHEN && carry.form === "mo") {
      addSource("白素贞魔转职增伤",3 * meiHuo,`每层魅惑 +3% × ${String(meiHuo)} 层`);
    }

    // 神通27:目标身上全部负面层数之和,每层 +1%
    addSource(
      "神通27增伤",
      zhenShe + liuXue + meiHuo + qieNuo,
      `负面 ${String(zhenShe + liuXue + meiHuo + qieNuo)} 层 × 1%`
    );

    // 神通15:命中 × Base(1) × 等级 / 10；点满 10 级就是 +命中值%
    const shenTong15 = Math.min(carryHit,21_4748_3637);
    addSource("神通15增伤",shenTong15,`命中面板 ${String(shenTong15)} → +${String(shenTong15)}%`);

    // 西行取经:伤害% += max(0, 命中 - 敌闪避) × (0.25 + 0.25×等级)
    const xiXingLevel = comboBondLevel(combo,11);
    const dodgeDown = isInCombo(Y.ZHU_BA_JIE) ? ZHU_BA_JIE_DODGE_DOWN : 0;
    const towerDodge = TOWER_ENEMY_DODGE - dodgeDown;
    const xiXingTower = Math.max(0,carryHit - towerDodge);
    const xiXingRate = 0.25 + 0.25 * xiXingLevel;
    const xiXingPct = Math.trunc(xiXingTower * xiXingRate);
    addSource(
      "西行取经增伤",
      xiXingPct,
      `(命中 ${String(carryHit)} - 敌闪避 ${String(towerDodge)}) × ${xiXingRate.toFixed(2)}`
    );

    // 神通19:技能动作 +20×等级(5 级满 = +100)；神通20:当前怒气 ×0.2×等级(普攻开局 30,5 级满 = +30)
    if (carry.mode === "怒气") {
      addSource("神通19增伤",100,"怒气动作 +20% × 5 级");
    } else {
      addSource("神通20增伤",30,"当前怒气 30 × 0.2 × 5 级");
    }

    // 伏羲琴:攻击时敌人身上每种负面状态 +2×等级% 伤害(15 级 = +30%/种)
    if (weapon.entry === "FuXiQin") {
      const badTypes = [zhenShe,liuXue,meiHuo,qieNuo].filter(value => value > 0).length;
      addSource(
        "伏羲琴增伤",
        2 * WEAPON_LEVEL * badTypes,
        `每种负面 +${String(2 * WEAPON_LEVEL)}% × ${String(badTypes)} 种`
      );
    }

    // 技能倍率:每个来源各自 ×(100+p)/100(源码里就是多条 PercentAddition)
    let skillFactor = 1;
    const skillParts: string[] = [];
    for (const source of skillSources) {
      skillFactor *= 1 + source.value / 100;
      skillParts.push(
        `${skillSlotOf(carry.index,source.skill).name} ${source.value >= 0 ? "+" : ""}${String(source.value)}→×${(1 + source.value / 100).toFixed(3)}`
      );
    }

    // 后羿弓 Lv.15 只在「本来会 miss」时触发:非孙悟空神按 ×0.8 计;
    // 孙悟空神命中 100%,后羿弓的转命中分支不会触发,任何武器都不乘 0.8
    const isWukongShen = carry.index === Y.SUN_WU_KONG && carry.form === "shen";
    if (!isWukongShen && weapon.entry !== "HouYiGong") {
      throw new Error("非孙悟空神必须带后羿弓");
    }
    const bowFactor = isWukongShen ? 1 : BOW_DAMAGE;

    // 河图:攻击时把 防御×8×等级/100 直接加到 BaseAttack.
    // 防御要按 GetFinalValue(DEF) 算:御灵装备(灵器/灵牌/宝石)flat + 金玉令 +600% + 防御研究
    const heTuDef =
      (panel.defFlat + 50_0000 + 50_0000 + 6 * 25_0000) *
      (100 + 600 + panel.defPct) / 100;
    const heTuAttack = weapon.entry === "HeTu"
      ? Math.trunc(heTuDef * 8 * WEAPON_LEVEL / 100)
      : 0;

    // 鲁智深/秦良玉/岳飞:1技能 BaseAttack += 自身生命 × 20%
    // 阵法7 时生命 = 面板生命 × (100+600+生命研究+30)/100 × (1+阵法等级/100)
    const hpBaseAttack = carry.hpBaseAttackPct
      ? Math.trunc(
          (isHpZhenfa ? panel.hpFinalZhenfa7 : panel.hpFinal) * carry.hpBaseAttackPct / 100
        )
      : 0;
    const extraBaseAttack = heTuAttack + hpBaseAttack;
    let total =
      atkFactor * skillFactor * bowFactor * bond * damageAdditionFactor * zhenFaFactor;
    for (const source of sources) {
      total *= source.value;
    }
    if (extraBaseAttack > 0) {
      const atkBase = panel.atkFlat * atkFactor * zhenFaFactor;
      total *= (atkBase + extraBaseAttack) / atkBase;
    }
    const weaponNoteMap: Record<string,string> = {
      FuXiQin:       "每种负面 +30%",
      HouYiGong:     "命中 100% 时不触发",
      HunYuanJinDou: "闪避后才加命中（不触发）",
      KunLunJing:    "攻击后 90% +1 魅惑（首击不计）",
      LeiGongChui:   "攻击后 45% 麻痹（首击不计）",
      PanGuanBi:     "回合开始 45% 行动+1（首击不计）",
      RenHuangYin:   "开战 +50 怒气，回合结束 +45",
      WuJinHuoHuLu:  "仅连击/反击（首击不计）",
      XingTianDun:   "仅反击/反伤（首击不计）",
      XuanYuanJian:  "回合结束 +45% 攻击（首击不计）",
      YingLongLin:   "仅连击/反击（首击不计）"
    };
    const weaponNote = weapon.entry === "HeTu"
      ? `防御 ${String(Math.trunc(heTuDef))} ×8×15% = +${String(heTuAttack)}`
      : weaponNoteMap[weapon.entry] ?? "首击无增伤";
    const formula = [
      `攻击桶(基础100+资源${panel.atkPct.toFixed(3)}${isHpZhenfa ? "-阵法1面板15" : ""}+武松${String(isInCombo(Y.WU_SONG) ? 20 : 0)})/100=${atkFactor.toFixed(3)}`,
      `技能来源[${skillParts.length > 0 ? `${skillParts.join("，")}，小计=${skillFactor.toFixed(3)}` : "无来源，100%=1.000"}]`,
      `武器=${weapon.name}（${weaponNote}）`,
      bowFactor === 1 ? "后羿弓不触发(命中100%)" : `后羿弓(100-20)/100=${bowFactor.toFixed(3)}`,
      ...heTuAttack > 0 ? [`河图+${String(heTuAttack)}`] : [],
      ...hpBaseAttack > 0 ? [`生命基础伤害+${String(hpBaseAttack)}`] : [],
      isHpZhenfa ? "阵法7(最高生命+等级%生命)" : `阵法1最高攻+${String(panel.zhenfaLevel)}%→×${zhenFaFactor.toFixed(3)}`,
      ...sources.map(source => `${source.name}+${String(source.percent)}%→×${source.value.toFixed(3)}`),
      `羁绊×${bond.toFixed(3)}`,
      `伤害加成桶(基础100+资源${panel.damageAddition.toFixed(3)}+武松${String(damageAddition - panel.damageAddition)})/100=${damageAdditionFactor.toFixed(3)}`,
      `乘区倍率=${total.toFixed(3)}`
    ].join(" × ");
    return {
      atkFactor,
      bowFactor,
      carryHit,
      damageAdditionFactor,
      formula,
      heTuAttack,
      hpBaseAttack,
      skillFactor,
      skillSources,
      sources,
      total:        assertSafe(total,"outputMultiplier"),
      weaponNote,
      zhenfaFactor: zhenFaFactor
    };
  };

  // 组合池 = 全部英灵,不按是否增伤过滤；输出位限制只作用在 carriesOf
  const indexes = yingLingConfig.map(item => item.index).toSorted((left,right) => left - right);
  const resultsTower: ComboResult[] = [];
  const resultsShilian: ComboResult[] = [];

  // 每个"输出位 + 转职"单独记录自己的最好组合(通天塔不限制；试炼必须带孟婆)
  const bestByCarryTower = new Map<string,ComboResult>();
  const bestByCarryShilian = new Map<string,ComboResult>();

  // 每个"输出位 + 转职形态"各记一份,用于转职对比(按通天塔)
  const bestByForm = new Map<string,ComboResult>();

  // 孙悟空神转职:每种武器各记一份最好组合
  const bestByWeaponTower = new Map<string,ComboResult>();
  const bestByWeaponShilian = new Map<string,ComboResult>();

  // 单个(输出位×武器×阵法)变体:求值并更新各最优表;best 汇总该组合的 tower/shilian 最优
  const evalVariant = (
    combo: number[],bond: number,hasMengPo: boolean,index: number,
    carry: CarryVariant,weapon: LingQiWeapon,zhenfaMode: "attack" | "hp",
    best: {shilian?: ComboResult; tower?: ComboResult}
  ): void => {
    if (!canRage(combo,carry,weapon)) {return;}
    const calc = outputMultiplier(combo,carry,bond,weapon,zhenfaMode);

    // 带后羿弓的输出位按 100% 命中(伤害已经乘 0.8)；孙悟空神命中 100%,用实际命中和红拂女下限
    const hasBow = !(carry.index === Y.SUN_WU_KONG && carry.form === "shen");
    const mingZhongFloor =
      combo.includes(Y.HONG_FU_NV) && !(carry.index === Y.HONG_FU_NV && carry.form === "mo")
        ? 65
: -Infinity;
    const hitRateTower = hasBow ? 1 : hitRate(calc.carryHit,TOWER_ENEMY_DODGE,mingZhongFloor);
    const hitRateShilian = hasBow ? 1 : hitRate(calc.carryHit,TRIAL_ENEMY_DODGE,mingZhongFloor);
    const shenMouLevel = comboBondLevel(combo,6);
    const critMultiplier = (panel.critDamage + SHEN_MOU_CRIT_PER_LEVEL * shenMouLevel) / 100;
    const atk = panel.atkFlat * calc.atkFactor * calc.zhenfaFactor + calc.heTuAttack + calc.hpBaseAttack;
    const kTower = culDamagePercent(atk,Math.max(1,SCENES[0].def - panel.penetration));
    const kShilian = culDamagePercent(atk,Math.max(1,SCENES[1].def - panel.penetration));
    const towerNonCrit = sceneDamage(panel.atkFlat,calc.total,kTower,SCENES[0]) * (1 + panel.tuJianDamagePct / 100);
    const shilianNonCrit = sceneDamage(panel.atkFlat,calc.total,kShilian,SCENES[1]);
    const result = {
      bond,
carry,
combo,
...calc,
atk,
critMultiplier,
      critShilian: assertFinite(shilianNonCrit * critMultiplier,"critShilian"),
      critTower:   assertFinite(towerNonCrit * critMultiplier,"critTower"),
      hitRateShilian,
hitRateTower,
kShilian,
kTower,
mingZhongFloor,
shenMouLevel,
      shilianNonCrit,
towerNonCrit,
weapon,
zhenfaMode
    };
    if (hitRateTower > 0) {
      const carryKey = `${String(index)}:${carry.form}`;
      const currentTower = bestByCarryTower.get(carryKey);
      if (!currentTower || result.total > currentTower.total) {bestByCarryTower.set(carryKey,result);}
    }
    if (hasMengPo && hitRateShilian > 0) {
      const carryKey = `${String(index)}:${carry.form}`;
      const currentShilian = bestByCarryShilian.get(carryKey);
      if (!currentShilian || result.total > currentShilian.total) {bestByCarryShilian.set(carryKey,result);}
    }
    if (hitRateTower > 0) {
      const formKey = `${String(index)}:${carry.form}`;
      const formCurrent = bestByForm.get(formKey);
      if (!formCurrent || result.total > formCurrent.total) {bestByForm.set(formKey,result);}
    }
    if (hitRateTower > 0 && (!best.tower || result.total > best.tower.total)) {best.tower = result;}
    if (hasMengPo && hitRateShilian > 0 && (!best.shilian || result.total > best.shilian.total)) {
      best.shilian = result;
    }
    if (!(carry.index === Y.SUN_WU_KONG && carry.form === "shen")) {return;}
    if (hitRateTower > 0) {
      const weaponKey = `${String(weapon.index)}:${weapon.entry}`;
      const weaponTower = bestByWeaponTower.get(weaponKey);
      if (!weaponTower || result.total > weaponTower.total) {bestByWeaponTower.set(weaponKey,result);}
    }
    if (!hasMengPo || hitRateShilian <= 0) {return;}
    const weaponKey = `${String(weapon.index)}:${weapon.entry}`;
    const weaponShilian = bestByWeaponShilian.get(weaponKey);
    if (!weaponShilian || result.total > weaponShilian.total) {bestByWeaponShilian.set(weaponKey,result);}
  };

  // 遍历一个组合的全部(输出位×武器×阵法)变体
  const evalComboVariants = (
    combo: number[],bond: number,hasMengPo: boolean,
    best: {shilian?: ComboResult; tower?: ComboResult}
  ): void => {
    for (const index of combo) {
      for (const carry of carriesOf(index)) {
        for (const weapon of weaponsOf(carry)) {
          for (const zhenfaMode of zhenfaModesFor(carry)) {
            evalVariant(combo,bond,hasMengPo,index,carry,weapon,zhenfaMode,best);
          }
        }
      }
    }
  };
  for (const combo of combinationsOf(indexes,SLOT_COUNT)) {
    const hasMengPo = combo.includes(MENG_PO);
    const bond = bondMultiplier(combo,bondOf,jiban);
    const best: {shilian?: ComboResult; tower?: ComboResult} = {};
    evalComboVariants(combo,bond,hasMengPo,best);
    if (best.tower) {resultsTower.push(best.tower);}
    if (best.shilian) {resultsShilian.push(best.shilian);}
  }
  resultsTower.sort((left,right) => right.total - left.total);
  resultsShilian.sort((left,right) => right.total - left.total);
  const formName: Record<Form,string> = {base: "基础",mo: "魔",shen: "神"};

  // 阵法:1=天覆阵(面板攻击 +15%,最高攻 +等级%),7=法相阵(面板生命 +30%,最高生命 +等级%)
  const zhenFaIdOf = (result: ComboResult): 1 | 7 => (result.zhenfaMode === "hp" ? 7 : 1);
  const zhenFaName = (result: ComboResult): string => `${ZHEN_FA_NAMES[zhenFaIdOf(result)]}（阵法${String(zhenFaIdOf(result))}）Lv.${String(panel.zhenfaLevel)}`;
  const zhenFaText = (result: ComboResult): string => `${zhenFaName(result)}（${zhenFaIdOf(result) === 7 ? `面板生命 +30%、最高生命 +${String(panel.zhenfaLevel)}%` : `面板攻击 +15%、最高攻 +${String(panel.zhenfaLevel)}%`}）`;

  // 队伍:输出位自己标转职(基础转职不标),队友按模型依赖标
  const teamText = (result: ComboResult): string => result.combo
      .map(index => {
        if (index === result.carry.index) {
          return result.carry.form === "base"
            ? nameOf(index)
            : `${nameOf(index)}（${formName[result.carry.form]}）`;
        }
        const transfer = TEAM_TRANSFER[index];
        return `${nameOf(index)}${transfer ? `（${transfer}）` : ""}`;
      })
      .join("、");

  // 把一个组合展开成 TS 伪代码
  const pseudoCodeLines = (result: ComboResult): string[] => {
    const wusongAtk = Math.round(result.atkFactor * 100 - 100 - panel.atkPct);
    const wusongDamage = Math.round(
      result.damageAdditionFactor * 100 - 100 - panel.damageAddition
    );
    const out: string[] = [
      `// [${result.combo.join(",")}] ${nameOf(result.carry.index)} ${formName[result.carry.form]}·${result.carry.label}`,
      `// 队友：${comboText(result.combo,result.carry.index,true)}`,
      `// 武器：${result.weapon.name}（${result.weaponNote}）`,
     `// 资源面板：御灵师 Lv.${String(panel.yulingshiLevel)}（幸运 ${String(panel.lucky)} / 速度 ${String(panel.speed)}）、器鼎 Lv.${String(panel.qiluLevel)}（品质 ${panel.pinzhi.toFixed(3)}）、炼器 Lv.${String(panel.lianqiLevel)}、阵法 ${zhenFaName(result)}、VIP ${String(panel.vipLevel)}`,`let 基础攻击 = ${String(panel.atkFlat)} // 御灵师 ${String(panel.yulingshiAtk)} + 阵法 ${String(panel.zhenfaAtkFlat)} + 装备 ${String(panel.equipAtkFlat)} + 御灵装备 2,500,000 + 强化 ${String(panel.strengthAtkFlat)} + 图鉴 ${String(panel.tuJianAtkFlat)} + 神通 20`,"let 御灵装备攻击百分比 = 600",`let 装备攻击百分比 = ${round3(panel.equipAtkPct)}`,"let 阵法面板攻击百分比 = 15",`let 通关攻击百分比 = ${String(panel.tongGuanAtkPct)}`,`let 武松攻击加成 = ${String(wusongAtk)}`,`let 攻击桶 = (100 + 御灵装备攻击百分比 + 装备攻击百分比 + 阵法面板攻击百分比 + 通关攻击百分比 + 武松攻击加成) / 100 // ${result.atkFactor.toFixed(3)}`
];
    if (result.skillSources.length > 0) {
      out.push(
        `// 技能描述：${result.skillSources
          .map(source => {
            const slot = skillSlotOf(result.carry.index,source.skill);
            return `${slot.name}「${slot.text}」→ ${String(source.value)}`;
          })
          .join("；")}`
      );
      for (const source of result.skillSources) {
        out.push(`let ${skillSlotOf(result.carry.index,source.skill).name} = ${String(source.value)}`);
      }
      const expr = result.skillSources
        .map(source => `((100 + ${skillSlotOf(result.carry.index,source.skill).name}) / 100)`)
        .join(" * ");
      out.push(`let 技能倍率 = ${expr} // ${result.skillFactor.toFixed(3)}`);
      if (result.skillSources.some(source => source.skill === 78)) {
        out.push(
          `// 孙悟空3技能按源码是把命中面板值 ${String(result.carryHit)} 直接加进伤害%；描述里的“命中+10%”已在命中面板里，不在这里重复加`
        );
      }
    } else {
      out.push("// 技能描述：没有额外伤害来源（100%）","let 技能倍率 = 1 // 1.000");
    }
    const mzTower = Math.max(100 + result.carryHit - TOWER_ENEMY_DODGE,result.mingZhongFloor);
    const mzShilian = Math.max(
      100 + result.carryHit - TRIAL_ENEMY_DODGE,
      result.mingZhongFloor
    );
    out.push(
      `let 命中 = ${String(result.carryHit)}`,
      result.bowFactor === 1
        ? `let 命中率_通天塔 = 100.0% // ${result.weapon.name} + 命中 ${String(result.carryHit)}，Final_MZ ${String(mzTower)}`
        : "let 命中率_通天塔 = 100.0% // 后羿弓把 miss 转成命中",
      result.bowFactor === 1
        ? `let 命中率_试炼 = 100.0% // ${result.weapon.name} + 命中 ${String(result.carryHit)}，Final_MZ ${String(mzShilian)}`
        : "let 命中率_试炼 = 100.0% // 后羿弓把 miss 转成命中"
    );
    if (result.combo.includes(Y.TANG_SAN_ZANG) || result.combo.includes(Y.ZHU_BA_JIE)) {
      const dodgeDown = result.combo.includes(Y.ZHU_BA_JIE) ? ZHU_BA_JIE_DODGE_DOWN : 0;
      const xiXingLevel = comboBondLevel(result.combo,11);
      const towerDodge = TOWER_ENEMY_DODGE - dodgeDown;
      const trialDodge = TRIAL_ENEMY_DODGE - dodgeDown;
      const towerPct = Math.trunc(
        Math.max(0,result.carryHit - towerDodge) * (0.25 + 0.25 * xiXingLevel)
      );
      const trialPct = Math.trunc(
        Math.max(0,result.carryHit - trialDodge) * (0.25 + 0.25 * xiXingLevel)
      );
      out.push(
        `// 西行取经 Lv.${String(xiXingLevel)}：通天塔 命中${String(result.carryHit)}-闪避${String(towerDodge)}=${String(result.carryHit - towerDodge)}→${String(towerPct)}%；试炼 命中${String(result.carryHit)}-闪避${String(trialDodge)}=${String(result.carryHit - trialDodge)}→${String(trialPct)}%`
      );
    }
    out.push(
      result.bowFactor === 1
        ? `let 后羿弓 = 1 // ${result.weapon.name} 不触发后羿弓（命中 100%）`
        : `let 后羿弓 = (100 - 20) / 100 // ${result.bowFactor.toFixed(3)}`
    );
    for (const source of result.sources) {
      out.push(
        `let ${source.name} = (100 ${source.percent >= 0 ? "+" : "-"} ${String(Math.abs(source.percent))}) / 100 // ${source.value.toFixed(3)}｜${source.detail}`
      );
    }
    const bondCounts = new Map<number,number>();
    for (const comboIndex of result.combo) {
      const bonds = bondOf.get(comboIndex);
      if (!bonds) {continue;}
      for (const bond of bonds) {
        bondCounts.set(bond,(bondCounts.get(bond) ?? 0) + 1);
      }
    }
    const bondParts: string[] = [];
    for (const [bondType,count] of bondCounts) {
      const level = bondLevel(jiban,bondType,count);
      if (level <= 0) {
        continue;
      }
      const bondName = names.jiBan[String(bondType + 1)] ?? `羁绊${String(bondType + 1)}`;
      let effect = "，首击不计";
      if (bondType === 5) {
        effect = `，+${String(level * 5)}%`;
      } else if (bondType === 6) {
        effect = `，暴伤+${String(SHEN_MOU_CRIT_PER_LEVEL * level)}（暴击时生效）`;
      } else if (bondType === 11) {
        effect = "，计入西行取经增伤";
      }
      bondParts.push(`${bondName}×${String(count)}(Lv.${String(level)}${effect})`);
    }
    out.push(`// 羁绊：${bondParts.length > 0 ? bondParts.join("；") : "无"}`,`let 羁绊 = ${result.bond.toFixed(3)}`,`// 神谋鬼算：${result.shenMouLevel > 0 ? `Lv.${String(result.shenMouLevel)}，+${String(SHEN_MOU_CRIT_PER_LEVEL * result.shenMouLevel)} 暴伤` : "未激活"}`,`let 神谋等级 = ${String(result.shenMouLevel)}`,`let 暴伤 = (${round3(panel.critDamage)} + ${String(SHEN_MOU_CRIT_PER_LEVEL)} * 神谋等级) / 100 // ${result.critMultiplier.toFixed(3)}`,`let 伤害加成 = ${round3(panel.damageAddition)}`,`let 武松增伤 = ${String(wusongDamage)}`,`let 伤害加成桶 = (100 + 伤害加成 + 武松增伤) / 100 // ${result.damageAdditionFactor.toFixed(3)}`);
    const atkBaseDoc = panel.atkFlat * result.atkFactor * result.zhenfaFactor;
    const extraBaseDoc = result.heTuAttack + result.hpBaseAttack;
    const percentZone =
      result.total / (result.atkFactor * result.damageAdditionFactor * result.zhenfaFactor) *
      atkBaseDoc / (atkBaseDoc + extraBaseDoc);
    const percentMultiply = [
      "技能倍率",
      "后羿弓",
      ...result.sources.map(source => source.name),
      "羁绊"
    ];
    out.push(`let 阵法等级 = ${String(panel.zhenfaLevel)}`,`let 阵法攻击加成 = ${result.zhenfaFactor.toFixed(3)}${result.zhenfaMode === "hp" ? " // 法相阵不加攻击" : " // 天覆阵最高攻+等级%"}`,`let 百分比乘区 = ${percentMultiply.join(" * ")} // ${percentZone.toFixed(3)}`,`let 乘区倍率 = 攻击桶 * 阵法攻击加成 * 百分比乘区 * 伤害加成桶 * (基础攻击*攻击桶*阵法攻击加成+额外基础攻击)/(基础攻击*攻击桶*阵法攻击加成) // ${result.total.toFixed(3)}`,"// 实际伤害顺序：攻击 → 防御系数 K → 百分比乘区 → 暴击 → 伤害加成 → 减伤","// 防御系数 K：攻击 ≥ 3×防御 时固定 100，否则按攻击/防御比（源码 CulDamagePercent）");
    if (result.heTuAttack > 0) {
      out.push(`let 河图 = ${String(result.heTuAttack)} // 防御×8×15/100，直接加到 BaseAttack`);
    }
    if (result.hpBaseAttack > 0) {
      out.push(
        result.zhenfaMode === "hp"
          ? `let 法相阵生命 = ${String(Math.trunc(panel.hpFinalZhenfa7))} // ×(100+600+生命研究+30)%×(1+阵法等级/100)`
          : `let 生命 = ${String(Math.trunc(panel.hpFinal))} // ×(100+600+生命研究)%`,
        `let 生命基础伤害 = ${String(result.hpBaseAttack)} // 生命×20%，直接加到 BaseAttack`
      );
    }
    const extraTerms = [
      ...result.heTuAttack > 0 ? ["河图"] : [],
      ...result.hpBaseAttack > 0 ? ["生命基础伤害"] : []
    ];
    out.push(
      `let 攻击 = 基础攻击 * 攻击桶 * 阵法攻击加成${extraTerms.length > 0 ? ` + ${extraTerms.join(" + ")}` : ""} // ${result.atk.toExponential(3)}`,
     `let 穿透 = ${String(panel.penetration)}`,`let 通天塔防御 = ${String(SCENES[0].def)}`,`let 通天塔防御系数 = CulDamagePercent(攻击, 通天塔防御 - 穿透) // ${String(result.kTower)}`,"let 通天塔基础伤害 = 攻击 * 通天塔防御系数 / 100",`let 图鉴54增伤 = (100 + ${String(panel.tuJianDamagePct)}) / 100 // 图鉴 Lv.${String(panel.tuJianLevel)} × ${String(panel.research.tuJianDamagePerLevel)}%/级，仅通天塔 Character_Enemy 生效`,`let 通天塔非暴击 = 通天塔基础伤害 * 百分比乘区 * 伤害加成桶 * (100 - ${String(SCENES[0].reduce)}) / 100 * 图鉴54增伤 // ${formatWan(result.towerNonCrit)}`,`let 试炼防御 = ${String(SCENES[1].def)}`,`let 试炼防御系数 = CulDamagePercent(攻击, 试炼防御 - 穿透) // ${String(result.kShilian)}`,"let 试炼基础伤害 = 攻击 * 试炼防御系数 / 100",`let 试炼非暴击 = 试炼基础伤害 * 百分比乘区 * 伤害加成桶 * (100 - ${String(SCENES[1].reduce)}) / 100 // ${formatWan(result.shilianNonCrit)}`,`let 通天塔暴击伤害 = 通天塔非暴击 * 暴伤 // ${formatWan(result.critTower)}`,`let 试炼暴击伤害 = 试炼非暴击 * 暴伤 // ${formatWan(result.critShilian)}`);
    return out;
  };

  // 组合总数 = C(29,5)
  let allCombos = 1;
  for (let i = 0; i < SLOT_COUNT; i += 1) {
    allCombos = allCombos * (indexes.length - i) / (i + 1);
  }
  const ironShengShou = shengShouUpgrade(panel.ironTotal);
  const lines: string[] = [
    "=== 英灵输出潜力排名（不读存档，遍历全部 5 人组合）===","--- 初始资源与最佳用途 ---",`御力宝箱Lv6 ${formatInt(panel.yuliChestCount)} × 600,000 御力 = ${formatInt(panel.yuliChestCount * 60_0000)}`,`御灵宝典 ${formatInt(panel.yuliBookCount)} × 100 御力 = ${formatInt(panel.yuliBookCount * 100)}`,`兑换码/通关点数额外御力 ${formatInt(panel.yuliTotal - panel.yuliChestCount * 60_0000 - panel.yuliBookCount * 100)}`,`合计御力 ${formatInt(panel.yuliTotal)} → 御灵师 Lv.${formatInt(panel.yulingshiLevel)}（累计等级和 ${formatInt(panel.yulingshiLevelSum)}，轻车熟路 -${String(panel.research.yuLiReduce)}% 消耗）`,`→ 生命/攻击/防御/穿透 各 +${formatInt(panel.yulingshiAtk)}`,`突破 ${formatInt(panel.breakthroughCount)} 次：先幸运 ${formatInt(panel.luckyCount)} 次到 ${formatInt(panel.lucky)}，之后 ${formatInt(panel.speedCount)} 次全速度`,`→ 速度 ${formatInt(panel.speed)}，${panel.speedOk ? "已超过" : "未超过"}试炼 100 层 ${formatInt(TRIAL_SPEED)}；${panel.speedOk ? "神兵可选命中/伤害/暴伤" : "神兵只能选速度"}`,`五彩神石 ${formatInt(panel.qiluStone)} → 器鼎 Lv.${formatInt(panel.qiluLevel)}，品质期望 ${panel.pinzhi.toFixed(3)}`,`寒铁 ${formatInt(panel.ironTotal)} → 制作装备；炼器 Lv.${formatInt(panel.lianqiLevel)}（打造 ${formatInt(panel.lianqiCrafts)} 件，剩 ${formatInt(panel.ironRemain)}，研究 -${String(panel.research.hanTieReduce)}%）`,`  → 10 槽主属性攻击 +${formatInt(panel.equipAtkFlat)}；攻击% +${round3(panel.equipAtkPct)}、伤害加成 +${round3(panel.equipDamageAddition)}、暴伤 +${round3(panel.equipCritDamage)}、暴击 +${round3(panel.equipCrit)}、穿透% +${round3(panel.equipPenPct)}`,`强化石 ${formatInt(panel.strengthStone)} → 10 槽强化，攻击 +${formatInt(panel.strengthAtkFlat)}`,`灵晶 ${formatInt(panel.lingJing)} → 900 解锁全部阵法，剩余升圣兽3（青龙）Lv.${formatInt(panel.shengShou3Level)}，攻击/防御 +${formatInt(panel.shengShou3Atk)}`,`神速符 ${formatInt(panel.shenSuFuTotal)} → 圣兽4（白虎）Lv.${formatInt(panel.shengShou4Level)}，攻击/穿透 +${formatInt(panel.shengShou4Atk)}`,`历史本纪 ${formatInt(panel.historyMaterial + panel.research.cost)} → 研究 ${formatInt(panel.research.cost)} + 转职强化 Lv.${formatInt(panel.historyLevel)}，攻击/穿透 +${formatInt(panel.historyAtk)}（只加输出位自己）；抽奖卷不计入`,`图鉴 15 种 × ${formatInt(panel.tuJianCount)} 个 = ${formatInt(panel.tuJianExp)} 经验 → Lv.${formatInt(panel.tuJianLevel)}；攻击 +${formatInt(panel.tuJianAtkFlat)}、防御 +${formatInt(panel.tuJianDefFlat)}、穿透 +${formatInt(panel.tuJianPenFlat)}；研究54 通天塔受到伤害 +${formatInt(panel.tuJianDamagePct)}%（试炼不生效）`,`钱币 ${formatInt(panel.coin)} → 神通卷轴共 ${formatInt(panel.freeScrolls)}（远超 38,200 需求）；商店价 -${String(panel.research.shopReduce)}%，全部钱币买灵纹 ${formatInt(panel.lingwen)} → 阵法 Lv.${formatInt(panel.zhenfaLevel)}（灵纹研究 -${String(panel.research.zhenwenReduce)}%）`,panel.yuanbaoMode === "shop"
      ? `元宝 ${formatInt(panel.totalYuanbao)} = 初始 20,488 + 兑换码 ${formatInt(panel.codeYuanbao)} + 通关点数 ${formatInt(panel.tongGuanYuanbao)} → 仙葫药 ${formatInt(panel.xunbaoPills)} 份（${formatInt(panel.xunbaoPills * XUNBAO_PILL_COST)} 元宝）→ 余 ${formatInt(panel.vipYuanbao)} 升 VIP ${String(panel.vipLevel)} → 命中 +${String(Math.trunc(panel.vipLevel / 2))}`
      : `元宝 ${formatInt(panel.totalYuanbao)} = 初始 20,488 + 兑换码 ${formatInt(panel.codeYuanbao)} + 通关点数 ${formatInt(panel.tongGuanYuanbao)} → VIP ${String(panel.vipLevel)}（消耗 ${formatInt(panel.vipSpent)}，剩 ${formatInt(panel.vipRemain)}）→ 命中 +${String(Math.trunc(panel.vipLevel / 2))}、暴击 +${String(Math.trunc(panel.vipLevel / 2))}`,"元宝对比：只比命中，VIP 35,592 元宝换 +11 命中；冥商蟠桃 +1 命中要 52,888 元宝，35,592 连一颗都买不起，所以命中口径 VIP 更划算。比最终伤害，18 份仙葫药（1,888×18=33,984）→ 18 格寻宝，期望 +46.08M 钱币、+5.90M 灵纹、+11.24M 寒铁、+1.20M 三味真火/忘情水；阵法约 624→1,811，孙悟空最终伤害约 ×2.6，但冥商一次只刷 6 件、每件 1 个，需要多次刷新。","","--- 研究（未研究节点）---",`已点 ${String(panel.research.steps)} 个节点、合计 ${formatInt(panel.research.cost)} 历史本纪；下面是没研究的节点：`,...panel.research.unresearched,"","已点但没点满：",...panel.research.partial.length > 0 ? panel.research.partial : ["  - 无"],"--- 多用途资源对比 ---",`寒铁 → 炼器（主属性攻击 +${formatInt(panel.equipAtkFlat)}，折合最终攻击 +${formatWan(panel.equipAtkFlat * (100 + panel.atkPct) / 100 * (1 + panel.zhenfaLevel / 100))}）vs 圣兽1 玄武 Lv.${formatInt(ironShengShou.level)}（防御 +${formatInt(ironShengShou.atk)} → 河图攻击 +${formatInt(Math.trunc(ironShengShou.atk * (100 + panel.defPct) / 100 * 8 * 15 / 100))}）；炼器更高`,"五彩神石 → 器鼎（品质影响装备词条）优于直接卖；灵纹/灵晶/神速符都没有器鼎这条品质路线",`强化石 ${formatInt(panel.strengthStone)} → 10 槽强化攻击 +${formatInt(panel.strengthAtkFlat)}；无其他输出用途`,"神通卷轴 → 先点满 38,200 个神通；剩余可升圣兽2，但只加穿透/暴击，本表通天塔 K=100，边际接近 0",`灵纹 → 阵法 Lv.${formatInt(panel.zhenfaLevel)}（阵法1 ×${(1 + panel.zhenfaLevel / 100).toFixed(2)}，研究 -${String(panel.research.zhenwenReduce)}% 消耗）；无其他输出用途`,`灵晶 ${formatInt(panel.lingJing)} → 900 解锁阵法 + 圣兽3 Lv.${formatInt(panel.shengShou3Level)}（攻击/防御 +${formatInt(panel.shengShou3Atk)}）；优于卖店`,`神速符 ${formatInt(panel.shenSuFuTotal)} → 圣兽4 Lv.${formatInt(panel.shengShou4Level)}（攻击/穿透 +${formatInt(panel.shengShou4Atk)}）优于直接吃加速`,`历史本纪 → 研究 ${formatInt(panel.research.cost)} + 转职强化 Lv.${formatInt(panel.historyLevel)}（攻击/穿透 +${formatInt(panel.historyAtk)}）优于卖店`,`忘情水 ${formatInt(panel.shenBingWaterBudget)} → 神兵水炼（伤害加成 +${String(panel.shenBingWaterDamage)}、暴伤 +${String(panel.shenBingWaterCrit)}）；突破重随不给攻击%，不选`,`三味真火 ${formatInt(panel.shenBingFireBudget)} → 神兵火炼（命中 +${String(panel.shenBingFireHit)}）；器鼎加速只省时间，炼器经验只加装备主属性，均低于命中`,"元宝分子：仙葫路线相对 VIP 路线，每个输出位的最终伤害都更高（约 ×2.7~2.8）；只比命中则 VIP 更高。","","--- 兑换码与通关点数兑换 ---","兑换码 23 个（DuiHuanConfingData）：元宝 6,216、钱币 91,494、御力 8,978,442、寒铁 1,776、五彩神石 176、灵纹 88、神通卷轴 88、强化石 176、历史本纪 176、忘情水 911、三味真火 8、炼器宝典 10、升仙令 3、神速符 2、图鉴 5","通关点数 35 项（总价 2,223,302，全部按已兑换）：元宝 8,888、钱币 6,666、寒铁 18,888、五彩神石 5,888、灵纹 8,888、神通卷轴 3,888、强化石 5,888、历史本纪 8,888、御力宝箱Lv10×1",`通关点数永久属性：攻击 +${String(panel.tongGuanAtkPct)}%、命中 +${String(panel.tongGuanHit)}、暴伤 +${String(panel.tongGuanCritDamage)}、暴击 +${String(panel.tongGuanCrit)}、穿透 +${String(panel.tongGuanPenPct)}%、速度 +15；其余生命/防御/闪避/抗暴/连击/反击/恢复/吸血/幸运不计入首击输出`,"","--- 资源面板 ---",`基础攻击 ${formatInt(panel.atkFlat)} = 御灵师 ${formatInt(panel.yulingshiAtk)} + 阵法 ${formatInt(panel.zhenfaAtkFlat)} + 装备 ${formatInt(panel.equipAtkFlat)} + 御灵装备 2,500,000 + 强化 ${formatInt(panel.strengthAtkFlat)} + 圣兽 ${formatInt(panel.shengShouAtk)} + 图鉴 ${formatInt(panel.tuJianAtkFlat)} + 历史本纪 ${formatInt(panel.historyAtk)} + 神通 20`,`图鉴 15 种 × ${formatInt(panel.tuJianCount)} 个 = ${formatInt(panel.tuJianExp)} 经验 → Lv.${formatInt(panel.tuJianLevel)}；攻击 +${formatInt(panel.tuJianAtkFlat)}、防御 +${formatInt(panel.tuJianDefFlat)}、穿透 +${formatInt(panel.tuJianPenFlat)}；研究54 让通天塔敌人受到伤害 +${formatInt(panel.tuJianDamagePct)}%（试炼敌人是 Character_YingLing，不生效）`,`攻击% ${panel.atkPct.toLocaleString("zh-CN",{maximumFractionDigits: 3})} = 御灵装备 600 + 装备 ${round3(panel.equipAtkPct)} + 阵法 15 + 通关 ${String(panel.tongGuanAtkPct)} + 研究 ${String(panel.research.atkPct)}`,`最终攻击 ${panel.finalAtk.toExponential(4)} = 基础攻击 × 攻击桶 × 阵法1(1+${String(panel.zhenfaLevel)}/100)`,`命中 ${String(panel.hitBase)} = 蓝宝石 55 + 神通9 的 10 + 通关 15 + VIP ${String(Math.trunc(panel.vipLevel / 2))} + 研究 ${String(panel.research.hit)}；再加神兵火炼 ${String(panel.shenBingFireHit)} = ${String(panel.hit)} → 神通15「每 10% 命中提高 10% 对敌伤害」+${String(panel.shenTong3)}%`,`孙悟空神转职额外：幸运 ${formatInt(panel.lucky)} → 「每 100% 御灵师幸运提升 5% 命中」+${String(Math.trunc(panel.lucky / 100) * 5)} 命中，命中变为 ${String(panel.hit + Math.trunc(panel.lucky / 100) * 5)}`,`伤害加成面板 ${round3(panel.damageAddition)} = 装备 ${round3(panel.equipDamageAddition)} + 神通 25 的 15 + 研究 ${String(panel.research.damageAddition)} + 神兵水炼 ${String(panel.shenBingWaterDamage)}（武松再 +35）`,`暴伤面板 ${round3(panel.critDamage)} = 基础 340 + 装备 ${round3(panel.equipCritDamage)} + 神通 70 + 通关 50 + 研究 ${String(panel.research.critDamage)} + 神兵水炼 ${String(panel.shenBingWaterCrit)}（神谋鬼算另 +20×等级）`,`穿透 ${formatInt(panel.penetration)}；通天塔 10000 层防御 ${formatInt(SCENES[0].def)} → K=${String(culDamagePercent(panel.finalAtk,Math.max(1,SCENES[0].def - panel.penetration)))}；试炼 100 层防御 ${formatInt(SCENES[1].def)} → K=${String(culDamagePercent(panel.finalAtk,Math.max(1,SCENES[1].def - panel.penetration)))}`,`河图防御 ${formatInt(panel.defFlat + 250_0000)} = 御灵师 ${formatInt(panel.yulingshiAtk)} + 圣兽3 ${formatInt(panel.shengShou3Atk)} + 阵法 ${formatInt(panel.zhenfaDefFlat)} + 图鉴 ${formatInt(panel.tuJianDefFlat)} + 御灵装备 2,500,000；× (100 + 金玉令 600 + 防御研究 ${String(panel.defPct)})% → 河图攻击 ${formatInt(Math.trunc((panel.defFlat + 250_0000) * (100 + 600 + panel.defPct) / 100 * 8 * 15 / 100))}`
  ];
  const top = argNumber(args,"top") ?? 30;
  const pushCarrySection = (
    title: string,
    map: Map<string,ComboResult>,
    scene: "shilian" | "tower"
  ): void => {
    lines.push(title);
    const ranked = [...map].toSorted((left,right) => right[1].total - left[1].total);
    for (const [rank,[,result]] of ranked.slice(0,top).entries()) {
      const damage =
        scene === "tower"
          ? `通天塔 非暴击 ${formatWan(result.towerNonCrit)} / 暴击 ${formatWan(result.critTower)}`
          : `试炼 非暴击 ${formatWan(result.shilianNonCrit)} / 暴击 ${formatWan(result.critShilian)}`;
      const hit = scene === "tower" ? result.hitRateTower : result.hitRateShilian;
      lines.push(
        `${String(rank + 1).padStart(2," ")}. 队伍 [${result.combo.join(",")}] ${teamText(result)}`,
        `     ${nameOf(result.carry.index)}（${formName[result.carry.form]}·${result.carry.label}）｜阵法：${zhenFaText(result)}｜乘区倍率 ×${result.total.toFixed(3)}（含资源攻击%，不含基础攻击/K）｜暴伤 ${result.critMultiplier.toFixed(3)}｜命中率 ${(hit * 100).toFixed(1)}%｜${damage}`,
        "     ```ts"
      );
      for (const line of pseudoCodeLines(result)) {
        lines.push(`     ${line}`);
      }
      lines.push("     ```");
    }
    lines.push("");
  };
  const pushComboSection = (
    title: string,
    list: ComboResult[],
    scene: "shilian" | "tower"
  ): void => {
    lines.push(title);
    for (const [rank,result] of list.slice(0,top).entries()) {
      const damage =
        scene === "tower"
          ? `通天塔 ${formatWan(result.towerNonCrit)}→${formatWan(result.critTower)}（暴击）`
          : `试炼 ${formatWan(result.shilianNonCrit)}→${formatWan(result.critShilian)}（暴击）`;
      const hit = scene === "tower" ? result.hitRateTower : result.hitRateShilian;
      lines.push(
        `${String(rank + 1).padStart(2," ")}. 队伍 [${result.combo.join(",")}] ${teamText(result)}`,
        `     输出位：${nameOf(result.carry.index)}（${formName[result.carry.form]}·${result.carry.label}）｜阵法：${zhenFaText(result)}｜乘区 ×${result.total.toFixed(3)}（含资源攻击%，不含基础攻击/K）｜暴伤 ${result.critMultiplier.toFixed(3)}｜命中率 ${(hit * 100).toFixed(1)}%｜${damage}`,
        "     ```ts"
      );
      for (const line of pseudoCodeLines(result)) {
        lines.push(`     ${line}`);
      }
      lines.push("     ```");
    }
    lines.push("");
  };
  pushCarrySection("--- 通天塔 每个输出位（魔/神转职分开）的最好组合 ---",bestByCarryTower,"tower");
  pushCarrySection(
    `--- 试炼 每个输出位（魔/神转职分开）的最好组合（必须带孟婆 ${String(MENG_PO)}）---`,
    bestByCarryShilian,
    "shilian"
  );
  pushComboSection(`--- 通天塔 前 ${String(top)} 名组合 ---`,resultsTower,"tower");
  pushComboSection(
    `--- 试炼 前 ${String(top)} 名组合（必须带孟婆 ${String(MENG_PO)}）---`,
    resultsShilian,
    "shilian"
  );
  lines.push("--- 转职（魔/神）对比（只列首回合能打全体的；没列出的转职没有可用群攻或开局怒气不足）---");
  const formIndexes = [...new Set([...bestByForm.keys()].map(key => Number(key.split(":",1)[0])))].toSorted((left,right) => left - right);
  for (const index of formIndexes) {
    const both = (["mo","shen"] as const)
      .map(form => ({form,result: bestByForm.get(`${String(index)}:${form}`)}))
      .filter((item): item is {form: "mo" | "shen"; result: ComboResult} => item.result !== undefined);
    if (both.length === 0) {
      continue;
    }
    const text = both
      .map(
        item => `${formName[item.form]} ×${item.result.total.toFixed(3)}（${item.result.carry.label}；${zhenFaName(item.result)}）`
      )
      .join("｜");
    lines.push(`${nameOf(index)}：${text}`);
  }
  lines.push("","--- 孙悟空神转职 全武器对比（首回合第一下，其他 4 人重新枚举） ---",`口径：全部武器按 15 级；孙悟空神转职命中 100%，不带后羿弓也不吃后羿弓的 -20%；每把武器都重新枚举 5 人组合，取该武器下乘区倍率最高的组合。首击不生效的武器在“首击效果”里注明；阵法统一用天覆阵（阵法1）Lv.${String(panel.zhenfaLevel)}（面板攻击 +15%、最高攻 +${String(panel.zhenfaLevel)}%）。`);
  const weaponRanked = lingQi.weapons
    .map(weapon => ({
      shilian: bestByWeaponShilian.get(`${String(weapon.index)}:${weapon.entry}`),
      tower:   bestByWeaponTower.get(`${String(weapon.index)}:${weapon.entry}`),
      weapon
    }))
    .toSorted((left,right) => (right.tower?.total ?? -1) - (left.tower?.total ?? -1));
  for (const [rank,item] of weaponRanked.entries()) {
    const tower = item.tower;
    if (!tower) {
      continue;
    }
    lines.push(
      `${String(rank + 1).padStart(2," ")}. ${item.weapon.name}｜首击效果：${tower.weaponNote}｜阵法：${zhenFaText(tower)}｜乘区 ×${tower.total.toFixed(3)}｜通天塔 非暴击 ${formatWan(tower.towerNonCrit)} / 暴击 ${formatWan(tower.critTower)}｜队伍 [${tower.combo.join(",")}] ${teamText(tower)}`,
      item.shilian
        ? `     试炼（带孟婆）：阵法：${zhenFaText(item.shilian)}｜乘区 ×${item.shilian.total.toFixed(3)}｜非暴击 ${formatWan(item.shilian.shilianNonCrit)} / 暴击 ${formatWan(item.shilian.critShilian)}｜队伍 [${item.shilian.combo.join(",")}] ${teamText(item.shilian)}`
        : "     试炼（带孟婆）：无可用组合"
    );
  }
  const kTowerScene = culDamagePercent(panel.finalAtk,Math.max(1,SCENES[0].def - panel.penetration));
  const kShilianScene = culDamagePercent(panel.finalAtk,Math.max(1,SCENES[1].def - panel.penetration));
  lines.push("","--- 每一部分的上限 ---","伤害 = 基础攻击 × 攻击桶 × 阵法1 × K/100 × 百分比乘区 × 暴伤 × 伤害加成桶 × (100-min(减伤,80))/100",`K：2 ~ 约 248，攻击 ≥ 3×防御时硬切成 100；本资源面板下通天塔 K=${String(kTowerScene)}、试炼 K=${String(kShilianScene)}。`,`命中率：带后羿弓的输出位按 100% 命中（伤害已经乘 0.8）；孙悟空神转职命中 100%，可自由选择灵器，后羿弓不触发；命中 ${String(panel.hit + Math.trunc(panel.lucky / 100) * 5)} 对通天塔 10000 层闪避 ${String(TOWER_ENEMY_DODGE)} 和试炼 100 层闪避 ${String(TRIAL_ENEMY_DODGE)} 都是 100%。命中面板 ${String(panel.hit)} 只用于 神通15（每 10% 命中 +10% 对敌伤害）和 孙悟空3技能（每 1% 命中 +1% 伤害）；暴击伤害按“暴击时”直接算，不乘暴击率；连击/反击不计。`,`试炼队伍必须包含孟婆（${String(MENG_PO)}）；孟婆转职不计队友增伤。`,"伤害减免：封顶 80%（试炼 100 层就是 400→80）。","单个伤害乘区来源：int 上限 21.47 亿；连乘结果：long 上限 9.22e18。","司马懿威慑增伤：每层 +10%，无层数上限（威慑自身降攻打到 66% 封顶，但不影响这条增伤）。","魅惑：每层受到伤害 +3%，无上限；≥7 层跳过行动（控制，不影响本表伤害）。","流血：每回合按全场最高攻/10 结算，无上限；张良魔转职每层 +20% 无上限。","神通27：按负面层数之和，int 范围。万人敌：等级×敌人数，int 范围。","","--- 数值安全 ---",`本场景最大精确整数是通天塔防御 ${formatInt(SCENES[0].def)}、试炼防御 ${formatInt(SCENES[1].def)}，都小于 Number.MAX_SAFE_INTEGER(9.007e15)。`,"最终伤害可能超过 2^53；JS Number 与游戏 BigInteger 的 double 口径一致，显示按京近似，不保证个位精确。","游戏里伤害百分比累乘的 long 上限 9.22e18 未触及；后续 BigInteger 无上限。","","说明：","1、只统计开战即生效的负面层数；倾国倾城（命中后 12%×等级加魅惑）、千古流芳（命中后 15%×等级加流血）、关羽1技能（主动 +2 威慑）、关羽2技能（普攻 50% +1 威慑）、司马懿1技能（怒气 50% +2 威慑）都属于行动后叠加，首击不计。","2、羁绊里首击直接增伤的只有万人敌（等级×敌人数）；西行/神鬼/三国群英需要面板或残血目标；神谋鬼算走暴伤，只体现在“暴击伤害”列。","3、司马懿：魔转职「普攻变为全体攻击，且司马懿的全部伤害提高20%」，神转职「队友攻击时，敌人的每层【威慑】会使伤害额外+10%。司马懿也享受此效果」；公孙胜：魔转职「对敌伤害提高20%，普攻变为全体攻击」，神转职「队友攻击时，敌人的每层【怯懦】会使伤害额外+15%。公孙胜也享受此效果」。做队友时取收益更高的神转职。","4、怒气按首回合第一次行动前判定：开战 SP=30；时迁3技能 +30、张良3技能每回合开始 +10（神转职 +20）、人皇印开战 +50（15 级回合结束再 +45）；孙悟空神转职 +25、孟婆魔转职 +50、项羽魔转职 +15；孙悟空魔转职/哪吒魔转职满怒；项羽3技能把怒气上限降到 51，门槛变 50。首回合放不出怒气的输出位不参与排名。",`5、资源面板已代入：基础攻击 ${formatInt(panel.atkFlat)}，攻击% ${panel.atkPct.toLocaleString("zh-CN",{maximumFractionDigits: 3})}；突破没有攻击%，攻击桶来自御灵装备 600 + 装备 + 阵法 15 + 通关 30 + 研究 ${String(panel.research.atkPct)}。`,`6、K 由 culDamagePercent(实际攻击, 敌防御-穿透) 计算：通天塔 10000 层防御 ${formatInt(SCENES[0].def)} → K=${String(kTowerScene)}；试炼 100 层防御 ${formatInt(SCENES[1].def)} → K=${String(kShilianScene)}。`,"7、项羽1技能在魔转职 Skill_1030 存在时目标改为 5 个（Entry_Skill_46.WhenCulTarget），且技能本身 +60% 伤害，所以项羽魔转职是全体输出位；1技能「敌人每层流血使项羽攻击提高3%」是攻击后加基础值，首击不享受。",`8、元宝按 ${panel.yuanbaoMode === "shop" ? `仙葫 ${String(panel.xunbaoPills)} 份 + VIP ${String(panel.vipLevel)}` : `VIP ${String(panel.vipLevel)}`} 计算；命中通过 神通15 对所有输出位生效，孙悟空神转职（幸运转命中）和 3技能（每 1% 命中 +1% 伤害）额外受益。`,"9、忘情水 → 神兵水炼，三味真火 → 神兵火炼；寒铁只用于制作装备，翅膀消耗五彩之晶。",`10、寻宝给的神通卷轴 2,560,000 已远超需求，钱币全部买灵纹；强化石 ${formatInt(panel.strengthStone)} 已计入 10 槽强化；灵晶 ${formatInt(panel.lingJing)} 扣 900 解锁阵法后升圣兽3；神速符升圣兽4。`,`11、突破顺序：先幸运到 5 万（实际 ${formatInt(panel.lucky)}），之后全部速度；速度 ${formatInt(panel.speed)} ${panel.speedOk ? ">" : "≤"} 试炼 100 层 ${formatInt(TRIAL_SPEED)}，${panel.speedOk ? "神兵可选命中/伤害/暴伤" : "神兵只能选速度"}。`,`12、孙悟空神转职「每回合开始时额外获得25点怒气。战斗开始时，将幸运转化为孙悟空的命中，每100%御灵师幸运提升孙悟空5%的命中」：幸运 ${formatInt(panel.lucky)} → +${String(Math.trunc(panel.lucky / 100) * 5)} 命中，只加自己。首回合怒气：带人皇印时 30+50+25=105；不带人皇印时靠时迁3技能（+30）和张良神转职（每回合 +20）凑到 105。孙悟空神命中 100%，后羿弓不触发；武器按 23 把灵器逐一枚举，首击最优为人皇印（开战 +50、回合结束 +45 怒气），其次是伏羲琴（每种负面 +30%）、河图（防御×8×15/100 加到 BaseAttack）。`,"13、孙悟空只有怒气动作是群攻：1技能「对全部敌人造成70%伤害…」只在怒气动作时把目标改成全体，普攻仍是单体，不能当群攻输出位。",`14、唐三藏3技能「进入战斗给予我方全体队友35%命中，持续3回合」按源码开战全体我方 +${String(TANG_SAN_ZANG_HIT)} 命中；猪八戒3技能「进入战斗敌人全队+2流血，敌人全队-20%闪避，持续2回合」开战全体敌人 -${String(ZHU_BA_JIE_DODGE_DOWN)} 闪避。西行取经按 max(0, 命中-敌闪避)×(0.25+0.25×等级) 计算：通天塔 10000 层敌闪避 ${String(TOWER_ENEMY_DODGE)}，命中 ${String(panel.hit)} 已经超过；试炼 100 层敌闪避 ${String(TRIAL_ENEMY_DODGE)}，带后羿弓的输出位按 100% 命中，孙悟空神转职的 ${String(panel.hit + TANG_SAN_ZANG_HIT + Math.trunc(panel.lucky / 100) * 5)} 命中也是 100%。`,"15、命中公式：英灵最终命中 = (英灵 Base + 主角 Base) × (100 + 英灵命中% + 主角命中%) / 100。主角命中已经包含在英灵最终命中里，不能再把主角命中加一次。本表是 15 级御灵装备参考，不是存档实际值；存档实际值可用 jiban-value.ts 读取。","16、流血 DoT 伤害不计；猪八戒的 2 层流血只作为负面层数，用于 神通27（按负面层数增伤）和张良魔转职（每层流血 +20%）。","17、神通按游戏内配置编号：神通15 = 每 10% 命中提高 10% 对敌伤害（10 级满 = +命中值%）；神通19 = 技能动作伤害 +20%/级（5 级满 = +100%）；神通20 = 怒气上限 +100、当前怒气 ×0.2×等级（5 级满 = 当前SP×1.0，怒气动作先扣100怒气，所以怒气位不学）；神通27 = 按目标负面层数之和增伤。",`18、敌人命中/闪避/速度由 enemy-stats.ts 按反编译公式计算（结果见 output/敌人属性.md）：通天塔 10000 层闪避 ${String(TOWER_ENEMY_DODGE)}、试炼 100 层闪避 ${String(TRIAL_ENEMY_DODGE)}、终局闪避 ${String(ZHONG_JU[0]?.dodge ?? 0)}。`,`19、研究按源码逐级扣费（俭每升 1 级，下一级研究立刻 -1% 历史本纪）：先点俭以养德 Lv.20，再点资源折扣（寒铁/五彩神石/强化石/灵纹/御力/残念/破境石/神通卷轴/商店价），再点攻击/防御/命中/暴伤/伤害加成/幸运、阵法攻击/防御/穿透、装备制作线（炼器经验/装备属性/额外词条/器鼎等级与炼器等级转装备属性）、图鉴（经验/攻击/防御/穿透/生命/每图鉴增伤）；纯时间、掉落、抽奖、御灵石经验、扫荡类节点也点满但不进面板；生命/吸血/闪避/抗暴/减伤/连击/反击不点。研究共消耗 ${formatInt(panel.research.cost)} 历史本纪，剩余给转职强化；完整未研究清单见上文。`,"20、孙悟空神转职命中 100%，后羿弓的转命中分支不触发，所以可以自由选择灵器。23 把灵器逐一枚举 5 人组合后的首击排名：人皇印 > 伏羲琴 > 河图 > 其余并列。人皇印靠开战 +50 怒气让孙悟空不带时迁/张良也能首回合怒气，空出的位置给武松+沙僧：武松 +20% 攻击/+35% 增伤，沙僧把西行取经从 3 人 Lv.2（×0.75）提到 4 人 Lv.3（×1.00）。关羽1技能 +2 威慑是主动技能、首击不计，开战只有神转职 +3，所以 3 层威慑的光环（×1.3）低于 4 人西游（×1.3176）。伏羲琴按敌方负面“种类”每种 +30%（15 级），首击最多吃 1 种；河图把防御×8×15/100 加到 BaseAttack，但最终攻击已达 3.86 万亿，占比约 3%。判官笔/轩辕剑/昆仑镜/雷公锤/斩仙飞刀只影响后续回合或非首击，详见上方“孙悟空神转职 全武器对比”。");

  // Markdown 大纲:一级标题 + 目录 + 二级标题
  const mode = argString(args,"yuanbao-mode") ?? "shop";
  const headings: string[] = [];
  const body = lines
    .filter(line => !(line.startsWith("===") && line.endsWith("===")))
    .map(line => {
      const match = (/^---\s*(.+?)\s*---$/).exec(line.trim());
      if (match) {
        const heading = match[1] ?? "";
        headings.push(heading);
        return `## ${heading}`;
      }
      if (line.trim() === "说明：") {
        headings.push("说明");
        return "## 说明";
      }
      return line;
    });
  const title = `# 英灵输出潜力排名（${mode === "vip" ? "VIP" : "仙葫"}路线）`;
  const toc = [
    "## 目录",
    ...headings.map((heading,index) => `${String(index + 1)}. ${heading}`),
    ""
  ];
  const text = [
    title,
    "",
    "> 不读存档，遍历全部 5 人组合；每个输出位按首回合第一下伤害排序。",
    "",
    ...toc,
    ...body
  ].join("\n");
  const outPath = argString(args,"out") ?? join(OUT_DIR,"输出英灵排名.md");
  if (!existsSync(dirname(outPath))) {
    mkdirSync(dirname(outPath),{recursive: true});
  }
  writeFileSync(outPath,`${text}\n`,"utf8");
  console.log(text);
  console.log(`\n结果已写入：${outPath}`);
}

// 在 tracks 条同价值轨上分配 points 点所需的最小消耗
function minShenBingCost (points: number,tracks: number): number {
  const base = Math.trunc(points / tracks);
  const remain = points % tracks;
  return (tracks - remain) * shenBingTrackCost(base) + remain * shenBingTrackCost(base + 1);
}

// 忘情水 → 水炼:2 条伤害加成 + 6 条暴伤,按边际收益取最优
function optimizeShenBingWater (
  budget: number,
  damageBase: number,
  critBase: number
): {crit: number; damage: number} {
  let best = {crit: 0,damage: 0,product: -1};
  for (let damage = 0; damage < 300; damage += 1) {
    const damageCost = minShenBingCost(damage,SHEN_BING_WATER_DAMAGE_TRACKS);
    if (damageCost > budget) {
      break;
    }
    for (let crit = 0; crit < 600; crit += 1) {
      const critCost = minShenBingCost(crit,SHEN_BING_WATER_CRIT_TRACKS);
      if (damageCost + critCost > budget) {
        break;
      }
      const product = (damageBase + damage) * (critBase + crit);
      if (product > best.product) {
        best = {crit,damage,product};
      }
    }
  }
  return {crit: best.crit,damage: best.damage};
}

// EquipLevel_PercentTable.GeneratePercent:器鼎等级对应的品质概率(千分制)
// 器鼎升级:每 5 级一档,消耗 10×档位 五彩神石
function qiLuLevel (stones: number,reducePercent = 0): {level: number; remain: number} {
  let level = 1;
  let remain = stones;
  for (;;) {
    const cost = Math.max(
      1,
      Math.round(10 * (Math.trunc((level - 1) / 5) + 1) * (100 - reducePercent) / 100)
    );
    if (remain < cost) {
      return {level,remain};
    }
    remain -= cost;
    level += 1;
  }
}

// 保留 3 位小数,用于伪代码里的面板百分比
function round3 (value: number): string {
  return (Math.round(value * 1000) / 1000).toString();
}

// 神兵单轨升 n 级的总消耗:10,000 × (1+2+...+n)
function shenBingTrackCost (levels: number): number {
  return 10000 * levels * (levels + 1) / 2;
}

// 圣兽升级:每级消耗 10+10×当前等级,给两条属性各 20+50×当前等级
function shengShouUpgrade (material: number): {atk: number; level: number; spent: number} {
  let level = 0;
  let atk = 0;
  let spent = 0;
  while (spent + 10 + 10 * level <= material) {
    spent += 10 + 10 * level;
    atk += 20 + 50 * level;
    level += 1;
  }
  return {atk,level,spent};
}

// 强化石:10 槽平均强化,返回总攻击加成
function strengthAtkFromStones (stones: number,reducePercent = 0): number {
  const scale = (100 - reducePercent) / 100;
  let levels = 0;
  while (10 * ((levels + 1) * (levels + 1) + 4 * (levels + 1)) * scale <= stones) {
    levels += 1;
  }
  return 10 * (5 * levels * levels + 15 * levels);
}

// 图鉴升级:TuJianData_Record.GetLevelUpEXPDic(L) = 10 + 10×Σ(i<L)(floor(i/10)+1)
function tuJianLevel (exp: number): number {
  let level = 0;
  let remain = exp;
  let costSum = 0;
  for (;;) {
    if (remain < 10 + 10 * costSum) {
      return level;
    }
    remain -= 10 + 10 * costSum;
    level += 1;
    costSum += Math.trunc((level - 1) / 10) + 1;
  }
}

// 元宝全部升 VIP
function vipLevel (yuanbao: number): {level: number; remain: number; spent: number} {
  let level = 0;
  let spent = 0;
  for (;;) {
    const cost = vipLevelUpCost(level + 1);
    if (spent + cost > yuanbao) {
      return {level,remain: yuanbao - spent,spent};
    }
    spent += cost;
    level += 1;
  }
}

// VIPHelper.GetLevelUpRemandProp:升到 nextLevel 需要的元宝
// 御灵师升级:消耗 100*(L/10)*(L/10+1)+20*(L/10+1)*(L%10) 御力
function yuLingShiLevel (
  yuli: number,
  reducePercent = 0
): {level: number; remain: number} {
  let level = 1;
  let remain = yuli;
  for (;;) {
    const tens = Math.trunc(level / 10);
    const ones = level % 10;
    const cost = Math.max(
      1,
      Math.round(
        (100 * tens * (tens + 1) + 20 * (tens + 1) * ones) * (100 - reducePercent) / 100
      )
    );
    if (remain < cost) {
      return {level,remain};
    }
    remain -= cost;
    level += 1;
  }
}

// 整数千分位
// 鲁智深/秦良玉/岳飞的生命基础伤害要比较阵法1(加攻)和阵法7(加生命)
function zhenfaModesFor (carry: CarryVariant): ("attack" | "hp")[] {
  return carry.hpBaseAttackPct ? ["attack","hp"] : ["attack"];
}
if (process.argv[1] === import.meta.filename) {
  runMain(main);
}