/**
 * verify-damage.ts — 单文件验证「存档实际面板 + 孙悟空神·人皇印队」对指定场景/层数的最终伤害.
 * 自包含:本文件不 import 任何项目内脚本.存档解析,道具解码,配置读取,敌人属性公式,伤害公式,
 * 数字格式化全部写在下面;计算用到的每个数都来自 `Save_N` 存档与 `config/*.json`,不写死面板与装备等级.
 * 装备按存档实际情况:
 * - 孙悟空佩戴的灵器/灵牌/6 颗宝石取自 YingLing_Data.Save 的 yuLingEquipManager.YingLing_Equip;
 * 每件装备的名称,PinZhi_Level,Property(实际加成)取自 Prop_Data.Save 的道具定义,名称文本取自
 * config/names.json.本档 Save_1 实际是 人皇印 Lv.13 + 紫玉令 Lv.13 + 6 颗 13 档宝石,原样使用.
 * - 御灵装备属性在装备时由 Prop_YuLing_Equip.LoadToHumand 写进英灵 BattleData_Manager,
 * 所以战斗面板 = 英灵 BattleData_Manager + 主角 BattleData_Manager 继承,已含实际装备值.
 * 面板口径(BattleData_Manager.cs:76-84 + BattleData_Recorder.cs:23-34):
 * 非百分比属性(攻/防/血/穿透/速度)=(英灵 Base+主角 Base)×(100+英灵 Pct+主角 Pct)/100;
 * 百分比属性(命中/暴击/暴伤/伤害加成/幸运等)=英灵 Base+主角 Base.
 * 阵容:孙悟空神转职 + 人皇印(首击全体),4 人西游 = 孙悟空/武松/唐三藏/猪八戒/沙僧(Lv.3);
 * 转职是否解锁按存档 Skills 与 config/yingling.json 的 skillShen/skillMo 实际判定.
 * 阵法:读存档 CurZhenFa.天覆阵(1)=最高攻 +等级% 攻击;鸟翔阵(8)=无攻击加成,但按
 * Entry_ZhenFa_8.cs:30-41 把 min(我方 Speed.TrueBase−敌速,2147483646) 加进百分比乘区.
 * 减伤:CulFinalDamage 末步 ×(100−敌人减伤)/100.通天塔敌人**不减伤**:Character_Enemy.Initail_Data
 * 从不写 DamageReduce,预设词条(Enemy_Skill_13/14/15)只加敌方暴击,敌人身上也没有减伤词条,
 * 所以 0%.旧版写的 30% 是把 207585 层实到的「首领 142~148 垓」误当成「第一个目标(小怪)」反解出来的,
 * 属于把 boss 数字套到小怪身上;--reduce=N 仍可手动覆盖.试炼/终局封顶 80.
 * 队友与羁绊(全部读存档,不写死):
 * - 孙悟空自身词条 BattleEntry:神通15(每 10 级 命中×1),神通19(每级技能动作 +20%),神通27(目标负面层数和);
 * - 阵容羁绊 ZhenRongManager.ZhenRong + config/yingling.json 的 bonds(=ZhenRongJiBanTypeEnum) 统计人数,
 * 再按 config/jiban.json 取档位等级:西行取经(类型11)=(命中−敌闪避)×(0.25+0.25×级),
 * 神鬼志异(类型4)=(我方闪避−敌命中)×(0.2+0.2×级),万人敌(类型5)=层数×敌人数,三国群英(类型0)=(100−敌 HP%)/(4−0.5×级);
 * - 队友开战效果:武松神转职(技能1011,Entry_Skill_1011) 最高攻 +20% 攻击;武松3技能(技能18,Entry_Skill_18)
 * 最高攻 +35% 伤害加成;唐三藏3技能(技能81,Entry_Skill_81) 全体 +30 命中;猪八戒3技能(技能84,Entry_Skill_84)
 * 全体敌人 +2 层流血且 −20 闪避(同时喂 神通27 与 西行取经).
 * 图鉴增伤(研究54,仅通天塔):Character_Enemy.cs:123-134 = 图鉴等级 × 研究54等级;通天塔 map5 的
 * 小怪/精英/首领 PresetID 取自 config/maps.json(louLouID/jingYingID/bossID).
 * 面板:战斗面板不是「存档 base ×(100+存档%)/100」再叠加,而是按 BattleData_Manager.InitailForBattle
 * 把**终值**写进 Base_Value,PercentAddition 清零,之后开战词条再改这个面板.关键在于:
 * - 武松神转职 Add_ATK 的 +20 落在百分比字段上,而 base 已是终值 → 攻击 **×1.2**(不是 +20 个百分点);
 * - 武松3技能 Add_Damage 的 +35 落在百分比型属性 DamageAddition 的 base 上 → 伤害加成 +35 点;
 * - 唐三藏 Add_MingZhong / 孙悟空神转职 幸运→命中 都落在命中 base 上 → 命中 4346.
 * 早先"×1.2 被当成 +20 点"的窟窿,曾被一个凭空加的 +100 暴伤基数掩盖;现在两边都按源码归位
 * (暴击就是 Damage_Recorder.cs:84 的 × 暴伤/100 = ×5.45,不含任何基数或标定常数).
 * 一层只有一次群体出手,所以是 5 个数,不是 3 个数:Battle_Action_Manager.ActionOrder 用 OrderByMin
 * (ArrayHelper.cs:155-169,实际按降序原地排序)排整张角色表,Entry_Skill_76.WhenCulTarget 取
 * GetCha_Dead_Alive(不排序,直接用列表顺序),命中顺序 = 速度降序 首领(2175) → 精英(2174)×2 →
 * 小怪(2173)×2;Entry_Skill_76.AfterAttakEnemy 每命中一个目标自身 +1 层 Mark,WhenAttack_Cul_1
 * 按 Mark×10 加桶 → 同品级两击相差 10%."小怪 688" 只是两个小怪中的一个(第 4 击 Mark3 或第 5 击 Mark4).
 * --obs=217,460,688 把观测到的暴击伤害逐个丢进 5 次命中的暴击范围(×0.95~1.05)里核对落点.
 * --enemy=def=7116京,reduce=30,pinzhi=3 自选敌人:先按 pinzhi 重建场景敌人(属性+图鉴同步切换),
 * 再用 hp/def/speed/hit/dodge/crit/critResist/reduce 覆盖,未给的字段沿用场景默认;支持中文单位与 1e21.
 * --reduce=N 真实进入受击方减伤(不是只显示).
 * 所有乘区来自反编译源码;只读存档,不写游戏目录.
 * 伤害计算全部委托给 damage-calc.ts(面板组装+词条派发+一次技能逐目标);数值语义委托给
 * damage-formula.ts(源码 1:1 移植:BigInteger/long → bigint,double 按 C# 求值顺序,float → Math.fround,
 * Math.Round → 银行家舍入,int32 溢出回绕).存档解析,装备解码,配置读取仍在本地.
 */
import {existsSync,readFileSync} from "node:fs";
import {join} from "node:path";
import {BattleDataManager,formatBigSuoXie,Prop} from "./damage-formula.ts";
import type {StateEntry} from "./damage-formula.ts";
import {computeDamageRange,wukongExtraEntries} from "./damage-calc.ts";
import type {AttackerInput,DamageBuckets,DamageRange,EnemyStats,TeamContext} from "./damage-calc.ts";

export type {DamageBuckets,DamageRange,EnemyStats,TeamContext};
const CONFIG_DIR = join(import.meta.dirname,"config");
const DEFAULT_SAVE_ROOT = String.raw`C:\Users\Administrator\AppData\LocalLow\SkyLight\MoNiShouYou`;

// 属性索引(PropertyTypeEnum):0 攻击 / 1 防御 / 2 生命 / 3 速度 / 4 命中 / 5 闪避 /
// 6 暴击 / 7 抗暴 / 8 暴击伤害 / 13 伤害加成 / 15 穿透 / 17 幸运.
const PROP_ATK = 0;
const PROP_DEF = 1;
const PROP_HP = 2;
const PROP_SPEED = 3;
const PROP_HIT = 4;
const PROP_DODGE = 5;
const PROP_CRIT = 6;
const PROP_CRIT_RESIST = 7;
const PROP_CRIT_DAMAGE = 8;
const PROP_DAMAGE_ADD = 13;
const PROP_DAMAGE_REDUCE = 14;
const PROP_PEN = 15;
const PROP_LUCKY = 17;
const PROPERTY_NAME: Record<number,string> = {
  10:                   "反击",
  11:                   "恢复",
  12:                   "吸血",
  16:                   "反伤",
  9:                    "连击",
  [PROP_ATK]:           "攻击",
  [PROP_CRIT]:          "暴击",
  [PROP_CRIT_DAMAGE]:   "暴伤",
  [PROP_CRIT_RESIST]:   "抗暴",
  [PROP_DAMAGE_ADD]:    "伤害加成",
  [PROP_DAMAGE_REDUCE]: "减伤",
  [PROP_DEF]:           "防御",
  [PROP_DODGE]:         "闪避",
  [PROP_HIT]:           "命中",
  [PROP_HP]:            "生命",
  [PROP_LUCKY]:         "幸运",
  [PROP_PEN]:           "穿透",
  [PROP_SPEED]:         "速度"
};

// 道具类型(Prop_Type):2 灵器 / 4 灵牌 / 5 宝石.
const PROP_TYPE_LING_QI = 2;
const PROP_TYPE_LING_PAI = 4;

// 效果类型(EffectNameEnum):0 ChangeBattleProperty / 1 EntryEffect.
const EFFECT_PROPERTY = 0;
const EFFECT_ENTRY = 1;

// 阵容(英灵索引见 config/names.json):孙悟空 / 武松 / 唐三藏 / 猪八戒 / 沙僧.
const WU_KONG = 26;
const WU_SONG = 6;
const TANG_SAN_ZANG = 27;
const ZHU_BA_JIE = 28;

// 战斗期常量(源码口径,与角色面板无关).
const TANG_SAN_ZANG_HIT = 30;                      // 唐三藏3技能 Entry_Skill_81:开战全体 +30 命中
const LIU_XUE_STACKS = 2;                           // 猪八戒3技能 Entry_Skill_84:开战 +2 层流血(Bad)
const WU_SONG_ATK_PCT = 20;                         // 武松神转职 Entry_Skill_1011:最高攻 攻击% +20(战斗面板终值 → ×1.2)
const WU_SONG_DMG_ADD = 35;                         // 武松3技能 Entry_Skill_18:最高攻 +35% 伤害加成
const SP_OPEN_BATTLE = 30;                          // 开战 SP
const SP_MAX = 101;                                 // MaxSP
const SP_RAGE_NEED = 100;                           // 怒气动作门槛
const REN_HUANG_YIN_SP = 50;                        // 人皇印:开战 +50 怒气
const WU_KONG_SHEN_SP = 25;                         // 孙悟空神转职:开战 +25 怒气
const TOWER_QUALITY: Record<number,readonly number[]> = {0: [1,1,2,3,2],1: [1,1,1,1,1],2: [1,1,1,2,1],3: [1,1,2,2,1],4: [1,1,2,2,2]};
const QUALITY_NAME: Record<number,string> = {1: "小怪",2: "精英",3: "首领"};

// 词条枚举索引(EntryNameEnum 声明顺序).
const ENTRY_SHENTONG_3 = 37;    // 神通15:命中×Base(1)×等级/10
const ENTRY_SHENTONG_5 = 39;    // 神通19:技能动作 +20%/级
const ENTRY_SHENTONG_11 = 45;   // 神通27:目标负面层数之和
const ENTRY_SKILL_18 = 65;      // 武松3技能:最高攻 +35 伤害加成
const ENTRY_SKILL_81 = 260;     // 唐三藏3技能:全体 +30 命中
const ENTRY_SKILL_1011 = 203;   // 武松神转职:最高攻 +20 攻击

// 存档结构(只声明本文件用到的字段).
export interface BattleRecorder {
  Base_Value:       number;
  PercentAddition:  number;
  PropertyTypeEnum: number;
}
export interface CarryPanel {
  atkFlat: number;
  atkPct:  number;

  // 孙悟空自身 BattleEntry(顺序即 _StateEntryList 前半段).
  battleEntry: readonly StateEntry[];
  crit:        number;
  critDamage:  number;
  dmgAdd:      number;
  dodge:       number;
  equips:      EquipInfo[];

  // 孙悟空是否学了 Skill_1050(学了 3技能就不吃 -30).
  hasSkill1050: boolean;
  hit:          number;
  lucky:        number;

  // 主角面板(BattleData_Manager),英灵继承用.
  master: BattleDataManager;
  pen:    number;

  // 该属性是否百分比型(config/property.json).
  percentOf: (prop: number) => boolean;

  // 孙悟空自身面板(BattleData_Manager).
  source: BattleDataManager;
  speed:  number;
  weapon: LingQiWeapon | undefined;
}
export interface ChaEntry {
  BattleData_Manager?:     {battleData_Recorders_List?: BattleRecorder[]};
  CurZhenFa?:              number;
  keJi_Recorders?:         {KeJi_ID: number; KeJi_Level: number}[];
  tuJianData_RecordsList?: {EnemyIndex: number; Level: number}[];
  zhenFaRecorders?:        {
    JieSuo:                  boolean;
    Level:                   number;
    property_RecordersList?: BattleRecorder[];
    ZhenFaID:                number;
  }[];
  ZhenRongManager?: {ZhenRong?: {ZhenRong?: number[]}};
}
export interface EffectRecoder {
  Bool_Value:     boolean;
  EffectNameEnum: number;
  Params_1:       number;
  Params_2:       number;
}

// 一件御灵装备的实际解码结果.
export interface EquipInfo {
  effect: string;   // 属性文本(来自 Prop_Data.Save 的 Property)
  level:  number;   // PinZhi_Level(存档实际档位)
  name:   string;   // 名称(来自 config/names.json)
  propID: number;
  slot:   string;   // 灵器 / 灵牌 / 红宝石 ...
  type:   number;   // Prop_Type
}
export interface EquipUse {
  BaoShiType: number;
  EquipID:    number;
  Index:      number;
  Prop_Type:  number;
}
export interface PropDefinition {
  _propID:      number;
  Name_ID:      number;
  PinZhi_Level: number;
  Property:     EffectRecoder[];
}
export interface SaveBundle {
  cha:       ChaEntry;
  dir:       string;
  props:     Map<number,PropDefinition>;
  yingLings: YingLingEntry[];
}
export interface YingLingEntry {
  _id:                 number;
  BattleData_Manager?: {battleData_Recorders_List?: BattleRecorder[]};
  BattleEntry?:        {EntryNameEnum: number; Level: number; StayRound: number}[];
  Cur_Level?:          number;
  Master_ID?:          number;
  Skills?:             number[];
  YingLing_Index?:     number;
  yuLingEquipManager?: {YingLing_Equip?: EquipUse[]};
  ZhuanZhiManager?:    {CurZhiYe: number};
}
interface CliArgs {get: (key: string) => string | true | undefined}
interface LingQiConfig {
  levels:  {atk: number; def: number; hp: number; pinzhi: number}[];
  weapons: LingQiWeapon[];
}

interface LingQiWeapon {
  entry:      string;
  entryText:  string;
  entryValue: number;
  name:       string;
}
interface MapRecord {
  bossID:     number;
  jingYingID: number;
  louLouID:   number;
  mapID:      number;
}
interface NamesConfig {
  props:    Record<string,string>;
  yingLing: Record<string,string>;
}
interface PropertySetting {
  percent: number;
  type:    number;
}
interface YingLingConfig {
  bonds?:    number[];   // = ZhenRongJiBanTypeEnum 列表
  index:     number;
  skillMo:   number;
  skillShen: number;
}
interface ZhongJuRecord {
  additionEffect: number;
  bossID:         number[];
  stats:          {base: number; percent: number; property: number}[];
  tiaoZhanID:     number;
}

// ============================== 通用工具 ==============================
function argNumber (args: CliArgs,key: string): number | undefined {
  const value = argString(args,key);
  if (value === undefined) {return undefined;}
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
function argString (args: CliArgs,key: string): string | undefined {
  const value = args.get(key);
  return typeof value === "string" ? value : undefined;
}

// 解析 --key=value / --flag.
function parseArgs (argv: readonly string[]): Map<string,string | true> {
  const args = new Map<string,string | true>();
  for (const raw of argv) {
    if (!raw.startsWith("--")) {continue;}
    const body = raw.slice(2);
    const eq = body.indexOf("=");
    if (eq === -1) {
      args.set(body,true);
      continue;
    }
    args.set(body.slice(0,eq),body.slice(eq + 1));
  }
  return args;
}

// 解析存档目录:--dir 优先,其次 --save=N(默认 Save_1).
function resolveSaveDir (args: CliArgs): string {
  const dir = argString(args,"dir");
  if (dir !== undefined) {
    if (!existsSync(dir)) {throw new Error(`存档目录不存在：${dir}`);}
    return dir;
  }
  const slot = argNumber(args,"save") ?? 1;
  const saveDir = join(DEFAULT_SAVE_ROOT,`Save_${String(slot)}`);
  if (!existsSync(saveDir)) {
    throw new Error(`存档不存在：${saveDir}（用 --save=N 指定槽位，或 --dir=路径）`);
  }
  return saveDir;
}

// ToolClass.TranslateNumsToSuoXie:10 万以下整数,之后按 万/亿/兆/京... 每四位递进.
const CN_UNITS = ["","万","亿","兆","京","垓","秭","穰","沟","涧","正","载","极"];

// 一次命中的落点(位置 + 品级 + Mark + 伤害范围).
interface LayerHit {
  mark:    number;
  quality: number;
  range:   DamageRange;
  tuJian:  number;
}

// 观测到的暴击伤害:原始数值 + 显式单位(未写单位时由命中量级推断).
interface ObservedValue {
  raw:  number;
  unit: string | undefined;
}

// ============================== 存档读取 ==============================
/**
 * 按存档实际面板 + 孙悟空神·人皇印队乘区,计算一次技能对某敌人的伤害及各档浮动范围.
 * 计算全部走 damage-formula.ts 的 1:1 移植(BigInt / 银行家舍入 / double 求值顺序 / int32 回绕),
 * 这里只负责把存档数据组织成源码要求的输入.
 * @param scene 场景.
 * @param layer 层数(终局用 challenge 定位,不参与敌人属性).
 * @param panel 输出位战斗面板(loadCarryPanel 结果).
 * @param enemy 敌人属性.
 * @param team 队伍开战加成(teamContextOf 结果).
 * @param opts 图鉴增伤 / Mark 层数 / 减伤覆盖 / 暴伤覆盖.
 * @returns DamageRange.
 */
export function damageRangeOf (
  scene: "tower" | "trial" | "zhongju",
  layer: number,
  panel: AttackerInput,
  enemy: EnemyStats,
  team: TeamContext,
  opts: {
    critDamagePct?:   number;
    enemyCount?:      number;
    mark?:            number;
    reducePct?:       number;
    tuJianDamagePct?: number;
  } = {}
): DamageRange {
  return computeDamageRange(scene,layer,{...panel,extraEntries: wukongExtraEntries(team)},enemy,team,{
    critDamagePct:   opts.critDamagePct,
    mark:            opts.mark,
    reducePct:       opts.reducePct,
    tuJianDamagePct: opts.tuJianDamagePct
  });
}
export function formatSuoXie (value: number): string {
  if (!Number.isFinite(value)) {return String(value);}
  const abs = Math.abs(value);
  if (abs < 10_0000) {return String(Math.round(value));}
  let unit = 0;
  let scaled = abs;
  while (scaled >= 10000 && unit < CN_UNITS.length - 1) {
    scaled /= 10000;
    unit += 1;
  }
  let digits = 3;
  if (scaled >= 10) {digits = 2;}
  if (scaled >= 100) {digits = 1;}
  if (scaled >= 1000) {digits = 0;}
  return `${value < 0 ? "-" : ""}${scaled.toFixed(digits)}${CN_UNITS[unit] ?? ""}`;
}

// 读存档,叠加出孙悟空(英灵索引 26,Master_ID=1)的战斗面板;装备列表面板同源.
export function loadCarryPanel (save: SaveBundle,carryIndex = WU_KONG): CarryPanel {
  const settings = loadConfig<PropertySetting[]>("property");
  const percentProps = new Set(settings.filter(item => item.percent === 1).map(item => item.type));
  const percentOf = (prop: number): boolean => percentProps.has(prop);
  const masterList = save.cha.BattleData_Manager?.battleData_Recorders_List ?? [];
  const carry = save.yingLings.find(item => item.YingLing_Index === carryIndex && item.Master_ID === 1);
  const yingLing = carry?.BattleData_Manager?.battleData_Recorders_List ?? [];
  const atk = mergedFinal(PROP_ATK,percentProps,yingLing,masterList);
  const equips = loadEquips(carry,save.props,loadConfig<NamesConfig>("names"));
  const weaponProp = save.props.get(equips.find(item => item.type === PROP_TYPE_LING_QI)?.propID ?? 0);
  const entry = weaponProp?.Property.find(item => item.EffectNameEnum === EFFECT_ENTRY)?.Params_1;
  return {
    atkFlat:      atk.base,
    atkPct:       atk.pct,
    battleEntry:  (carry?.BattleEntry ?? []).map(row => ({level: row.Level,name: row.EntryNameEnum,stayRound: row.StayRound})),
    crit:         mergedFinal(PROP_CRIT,percentProps,yingLing,masterList).value,
    critDamage:   mergedFinal(PROP_CRIT_DAMAGE,percentProps,yingLing,masterList).value,
    dmgAdd:       mergedFinal(PROP_DAMAGE_ADD,percentProps,yingLing,masterList).value,
    dodge:        mergedFinal(PROP_DODGE,percentProps,yingLing,masterList).value,
    equips,
    hasSkill1050: (carry?.Skills ?? []).includes(1050),
    hit:          mergedFinal(PROP_HIT,percentProps,yingLing,masterList).value,
    lucky:        mergedFinal(PROP_LUCKY,percentProps,yingLing,masterList).value,
    master:       managerOfRecords(masterList,percentOf),
    pen:          mergedFinal(PROP_PEN,percentProps,yingLing,masterList).value,
    percentOf,
    source:       managerOfRecords(yingLing,percentOf),
    speed:        mergedFinal(PROP_SPEED,percentProps,yingLing,masterList).value,
    weapon:       loadConfig<LingQiConfig>("lingqi").weapons.find(item => item.entryValue === entry)
  };
}

// 解码孙悟空实际佩戴的御灵装备:灵器 1 + 灵牌 1 + 宝石 6(数值全部来自存档,不假设备份).
export function loadEquips (yingLing: undefined | YingLingEntry,props: Map<number,PropDefinition>,names: NamesConfig): EquipInfo[] {
  const list = yingLing?.yuLingEquipManager?.YingLing_Equip ?? [];
  const result: EquipInfo[] = [];
  for (const equip of list) {
    if (equip.EquipID === 0) {continue;}
    const prop = props.get(equip.EquipID);
    const name = names.props[String(prop?.Name_ID ?? equip.EquipID)] ?? `道具${String(equip.EquipID)}`;
    result.push({
      effect: effectTextOf(prop),
      level:  prop?.PinZhi_Level ?? 0,
      name,
      propID: equip.EquipID,
      slot:   equip.Prop_Type === PROP_TYPE_LING_QI ? "灵器" : equip.Prop_Type === PROP_TYPE_LING_PAI ? "灵牌" : name,
      type:   equip.Prop_Type
    });
  }
  return result;
}

// ============================== 装备与面板 ==============================
export function loadSave (dir: string): SaveBundle {
  return {
    cha:       readJsonObject<ChaEntry>(join(dir,"Cha_Data.Save")),
    dir,
    props:     readPropDefinitions(dir),
    yingLings: existsSync(join(dir,"YingLing_Data.Save"))
      ? readJsonObjects<YingLingEntry>(join(dir,"YingLing_Data.Save"))
      : []
  };
}

// 中文层数:20W / 20w / 20万 / 1.5w → 200000 / 15000.
export function parseLayerText (text: string): number {
  const matched = (/^(\d+(?:\.\d+)?)([wW万]?)$/).exec(text.trim());
  if (matched?.[1] === undefined) {
    throw new Error(`层数写法不对：${text}（可用 100 / 1w / 1.5w / 20W）`);
  }
  const layer = Math.round(Number(matched[1]) * (matched[2] ? 10000 : 1));
  if (!Number.isFinite(layer) || layer < 1) {throw new Error(`层数必须大于 0：${text}`);}
  return layer;
}

/**
 * 把一份 DamageRange 按游戏单位打印到控制台.
 * @param report 伤害结果.
 * @param panel 输出位面板.
 * @param tuJian 图鉴增伤与来源.
 */
export function printDamageRange (
  report: DamageRange,
  panel: CarryPanel,
  tuJian: {pct: number; source: string}
): void {
  const {enemy} = report;
  console.log(`\n=== ${report.scene}${report.layer > 0 ? ` ${formatSuoXie(report.layer)} 层` : ""} 最终伤害验证(存档实际面板 · 孙悟空神·人皇印队)===`);
  const equips = panel.equips.map(item => `${item.slot} ${item.name} Lv.${String(item.level)}（${item.effect}）`).join(" ｜ ");
  console.log(`御灵装备(存档实际): ${equips}`);
  console.log(
    `阵法:${report.zhenFaNote}  减伤:${String(report.reduce)}%  图鉴增伤:${String(tuJian.pct)}%（${tuJian.source}）` +
    `  Mark:${String(report.mark)} 层 武松攻击桶:+${String(report.wuSongAtkPct)}%  武松增伤:+${String(report.wuSongDmgAdd)}%`
  );
  console.log(
    `敌人: HP=${formatSuoXie(enemy.hp)}  防御=${formatSuoXie(enemy.def)}  ` +
    `闪避=${formatSuoXie(enemy.dodge)}  抗暴=${formatSuoXie(enemy.critResist)}  减伤=${String(enemy.damageReduce)}%`
  );
  console.log(
    `面板: 战斗攻击=${formatBigSuoXie(report.atkForK)}（存档终值 ${formatSuoXie(panel.atkFlat * (panel.atkPct / 100 + 1))}` +
    ` × 武松 ${String(100 + report.wuSongAtkPct)}%）  穿透=${formatBigSuoXie(report.pen)}  速度=${formatSuoXie(panel.speed)}` +
    `  伤害加成=${String(panel.dmgAdd)}+${String(report.wuSongDmgAdd)}  暴伤=${String(panel.critDamage)}`
  );
  console.log(
    `命中链=${formatSuoXie(report.carryHit)}  命中率=${(report.hitRate * 100).toFixed(2)}%  ` +
    `暴击率=${(report.critRate * 100).toFixed(2)}%  暴击倍率=${report.critMultiplier.toFixed(2)}（暴伤 ${String(panel.critDamage)}/100）  K=${String(report.k)}`
  );
  const {buckets} = report;
  console.log(
    `乘区(全部进百分比数组,逐项 ×(100+x)/100): 技能${String(buckets.skill)}  命中+${formatSuoXie(buckets.hit)}` +
    `  神通15+${formatSuoXie(buckets.shenTong15)}  神通19+${String(buckets.shenTong19)}` +
    `  神通27+${String(buckets.shenTong27)}  Mark+${String(buckets.mark)}` +
    `  鸟翔速度差+${formatSuoXie(buckets.speedDiff)}  西行取经+${formatSuoXie(buckets.xiXing)}` +
    `  神鬼志异+${String(buckets.shenGui)}  图鉴+${String(buckets.tuJian)}`
  );
  console.log(`非暴击: ${formatBigSuoXie(report.nonCritRange[0])} ~ ${formatBigSuoXie(report.nonCritRange[1])}  (期望 ${formatBigSuoXie(report.nonCrit)})`);
  console.log(`暴击后: ${formatBigSuoXie(report.critRange[0])} ~ ${formatBigSuoXie(report.critRange[1])}  (期望 ${formatBigSuoXie(report.crit)})`);
}

/**
 * 开战瞬间生效的队伍加成,全部按存档与配置推导(不写死等级).
 * @param save 存档.
 * @param carryIndex 输出位英灵索引.
 * @returns TeamContext.
 */
export function teamContextOf (save: SaveBundle,carryIndex = WU_KONG): TeamContext {
  const lineup = lineupOf(save);
  const zhenFa = currentZhenFa(save);
  const has = (index: number): boolean => lineup.includes(index);
  const shenTong15 = entryLevel(save,carryIndex,ENTRY_SHENTONG_3);
  return {

    // 猪八戒3技能:两个小词条都是敌人开战负面(流血 + 减闪避)
    badStacks:      has(ZHU_BA_JIE) ? LIU_XUE_STACKS : 0,
    jiban:          jibanLevelsOf(save),
    shenTong15,
    shenTong19:     entryLevel(save,carryIndex,ENTRY_SHENTONG_5),
    shenTong27:     entryLevel(save,carryIndex,ENTRY_SHENTONG_11),
    tangSanZangHit: has(TANG_SAN_ZANG) && entryLevel(save,TANG_SAN_ZANG,ENTRY_SKILL_81) > 0 ? TANG_SAN_ZANG_HIT : 0,
    wuSongAtkPct:   has(WU_SONG) && entryLevel(save,WU_SONG,ENTRY_SKILL_1011) > 0 ? WU_SONG_ATK_PCT : 0,
    wuSongDmgAdd:   has(WU_SONG) && entryLevel(save,WU_SONG,ENTRY_SKILL_18) > 0 ? WU_SONG_DMG_ADD : 0,
    zhenFaID:       zhenFa.id,
    zhenFaLevel:    zhenFa.level
  };
}

// 通天塔敌人:Character_Enemy(品质, 层数, 预设, 地图, CurRound),品质 1 小怪 / 2 精英 / 3 首领.
export function towerEnemy (layer: number,pinzhi = 3): EnemyStats {
  const hundred = Math.trunc(layer / 100);
  const capped = Math.min(hundred,70);
  const extra = layer >= 11000 ? Math.trunc((layer - 11000) / 1000) : 0;
  const stat = capped + extra;
  const level = layer * 16 + 1500;
  const base = Math.trunc(level / 100);
  const roundBase = (base + 1) * 30 * level / 2 + (base + 1) * 30 * (level % 100);
  const addition = towerAddition(layer);
  const refine = 1 + Math.trunc(layer / 500);
  return {
    crit:         stat,
    critResist:   stat,
    damageReduce: 0,
    def:          Math.round(roundBase * addition * (100 + 2 * refine) / 100),
    dodge:        stat,
    hit:          stat,
    hp:           (8 * roundBase * pinzhi + 100) * addition * (100 + 8 * refine) / 100,
    speed:        26 + pinzhi + 1 + hundred + capped
  };
}

// 试炼敌人:LevelToTargetLevel 把命中/闪避/暴击/抗暴/减伤等设为 100+层数×3.
export function trialEnemy (layer: number): EnemyStats {
  const stat = 100 + layer * 3;
  const level = trialGetLevel(layer);
  return {
    crit:         stat,
    critResist:   stat,
    damageReduce: stat,
    def:          (400 + 15 * level) * 601,
    dodge:        stat,
    hit:          stat,
    hp:           trialBaseHp(layer) * (100 + 100_0000 + layer * 10000) / 100,
    speed:        Math.trunc(layer * 35 * (150 + layer) / 100)
  };
}

/**
 * 导入当前存档并打印指定场景/层数的伤害范围(游戏单位),只读存档.
 * @param sceneText 目标:通天塔 / 试炼 / 终局(可带 :挑战序号).
 * @param layerText 层数:20W / 1.5w / 100(终局可省略).
 * @returns DamageRange.
 */
export function verifyFinalDamage (sceneText: string,layerText?: number | string): DamageRange {
  let scenePart = sceneText.trim();
  let challenge = 5;
  const colon = scenePart.lastIndexOf(":");
  if (colon !== -1) {
    challenge = Number(scenePart.slice(colon + 1)) || 5;
    scenePart = scenePart.slice(0,colon);
  }
  const args = parseArgs(process.argv.slice(2));
  const scene = resolveScene(scenePart);
  const layer = scene === "zhongju" ? 0 : parseLayerText(String(layerText ?? (scene === "trial" ? 100 : 10000)));
  const save = loadSave(resolveSaveDir(args));
  const panel = loadCarryPanel(save);
  const team = teamContextOf(save);
  const presets = towerPresets();
  const presetIdx = argNumber(args,"preset") ?? presets.normal;
  const tuJianArg = argNumber(args,"tujian");
  const reducePct = argNumber(args,"reduce");
  const critDamagePct = argNumber(args,"critdmg");
  const observed = parseObserved(argString(args,"obs"));
  const presetPinzhiOf = (idx: number): number => (idx === presets.boss ? 3 : idx === presets.elite ? 2 : 1);

  // 自选敌人:pinzhi 先重建场景敌人(属性+图鉴预设同步切换),再把显式字段覆盖上去.
  const override = parseEnemyOverride(argString(args,"enemy"));
  const effectivePinzhi = override.pinzhi ?? presetPinzhiOf(presetIdx);
  const effectivePreset = effectivePinzhi === 3 ? presets.boss : effectivePinzhi === 2 ? presets.elite : presets.normal;
  const tuJianPresetIdx = override.pinzhi === undefined ? presetIdx : effectivePreset;
  const baseEnemy = enemyOf(scene,layer,challenge,effectivePinzhi);
  const enemy = {...baseEnemy,...override.fields};
  const tuJian = scene === "tower" ? tuJianDamagePctOf(save,tuJianPresetIdx) : {level: 0,pct: 0,research: 0};
  const tuJianDamagePct = tuJianArg ?? tuJian.pct;
  printRageCheck(save,panel);
  printTeamContext(save,team);
  printCarryPanelDetail(panel,team);
  const report = damageRangeOf(scene,layer,panel,enemy,team,{
    critDamagePct,
    mark: argNumber(args,"mark") ?? 0,
    reducePct,
    tuJianDamagePct
  });
  const presetName = QUALITY_NAME[effectivePinzhi] ?? "小怪";
  printDamageRange(report,panel,{
    pct:    tuJianDamagePct,
    source: scene === "tower"
      ? tuJianArg !== undefined
        ? "手动 --tujian"
        : `${presetName}图鉴 Lv.${String(tuJian.level)}×研究54 Lv.${String(tuJian.research)}`
      : "非通天塔无图鉴增伤"
  });
  if (scene === "tower") {
    printTowerLayerTable(save,layer,panel,team,{critDamagePct,observed,reducePct,tuJianArg});
  }
  return report;
}

// 当前佩戴阵法:天覆阵(1)才给最高攻 +等级% 攻击.
function currentZhenFa (save: SaveBundle): {id: number; level: number} {
  const id = save.cha.CurZhenFa ?? 0;
  const record = (save.cha.zhenFaRecorders ?? []).find(item => item.ZhenFaID === id);
  return {id,level: record?.Level ?? 0};
}

// ============================== 队伍加成 ==============================
// 战斗面板组装在 damage-calc.ts:buildBattlePanel(源码 InitailForBattle + 开战词条).
// 御灵装备的属性文本:EffectNameEnum=0(ChangeBattleProperty) 的 flat / percent 项.
function effectTextOf (prop: PropDefinition | undefined): string {
  if (prop === undefined) {return "存档里找不到道具定义";}
  const parts: string[] = [];
  if (prop.Property != null) {
    for (const effect of prop.Property) {
      if (effect.EffectNameEnum !== EFFECT_PROPERTY) {continue;}
      const name = PROPERTY_NAME[effect.Params_1] ?? `属性${String(effect.Params_1)}`;
      parts.push(effect.Bool_Value ? `${name}+${String(effect.Params_2)}%` : `${name}+${formatSuoXie(effect.Params_2)}`);
    }
  }
  return parts.length > 0 ? parts.join("、") : "无直接属性";
}

// 单点报告的敌人:通天塔按 --preset 对应的品级取(1 小怪 / 2 精英 / 3 首领).
function enemyOf (scene: "tower" | "trial" | "zhongju",layer: number,challenge: number,towerPinzhi = 3): EnemyStats {
  if (scene === "tower") {return towerEnemy(layer,towerPinzhi);}
  if (scene === "trial") {return trialEnemy(layer);}
  const enemy = zhongJuEnemies().find(item => item.tiaoZhanID === challenge);
  if (enemy === undefined) {throw new Error(`config/zhongju.json 里没有 tiaoZhanID=${String(challenge)} 的终局敌人`);}
  return enemy;
}

// 某英灵(主角队)在存档里的词条列表.
function entriesOf (save: SaveBundle,index: number): {EntryNameEnum: number; Level: number; StayRound: number}[] {
  return save.yingLings.find(item => item.YingLing_Index === index && item.Master_ID === 1)?.BattleEntry ?? [];
}

// ============================== 敌人属性 ==============================
// 某英灵某词条的等级和(同名词条可叠加).
function entryLevel (save: SaveBundle,index: number,entry: number): number {
  return entriesOf(save,index).filter(item => item.EntryNameEnum === entry)
.reduce((sum,item) => sum + item.Level,0);
}

// 某英灵是否解锁神转职:存档 Skills 含 config/yingling.json 的 skillShen.
function hasShen (save: SaveBundle,index: number): boolean {
  const config = loadConfig<YingLingConfig[]>("yingling").find(item => item.index === index);
  if (config === undefined) {return false;}
  const entry = save.yingLings.find(item => item.YingLing_Index === index && item.Master_ID === 1);
  return (entry?.Skills ?? []).includes(config.skillShen);
}

// 阵容羁绊:类型 → 生效等级(人数必须与 config/jiban.json 的档位人数完全相等,见 ZhenRong_JiBan.TrrigerEffect).
function jibanLevelsOf (save: SaveBundle): Map<number,number> {
  const configs = loadConfig<{levels: {count: number; level: number}[]; type: number}[]>("jiban");
  const counts = new Map<number,number>();
  for (const index of lineupOf(save)) {
    const bonds = loadConfig<YingLingConfig[]>("yingling").find(item => item.index === index)?.bonds ?? [];
    for (const type of bonds) {counts.set(type,(counts.get(type) ?? 0) + 1);}
  }
  const result = new Map<number,number>();
  for (const [type,count] of counts) {
    const level = configs.find(item => item.type === type)?.levels.find(item => item.count === count)?.level;
    if (level !== undefined) {result.set(type,level);}
  }
  return result;
}

// 当前阵容(英灵索引);空位 0 忽略.
function lineupOf (save: SaveBundle): number[] {
  return (save.cha.ZhenRongManager?.ZhenRong?.ZhenRong ?? []).filter(index => index !== 0);
}

// 读取 src/config 下的 JSON.
function loadConfig<T> (name: string): T {
  return JSON.parse(readFileSync(join(CONFIG_DIR,`${name}.json`),"utf8")) as T;
}

// ============================== 伤害计算 ==============================
/**
 * 把存档里的记录列表包成源码的 BattleData_Manager(base 保留 double,pct 保留 long).
 * @param records 存档记录.
 * @param percentOf 属性是否百分比型.
 * @returns 面板.
 */
function managerOfRecords (records: readonly BattleRecorder[],percentOf: (prop: number) => boolean): BattleDataManager {
  const manager = new BattleDataManager(percentOf);
  manager.initail(() => 0);
  for (const recorder of manager.list) {
    const row = records.find(item => item.PropertyTypeEnum === recorder.propertyTypeEnum);
    recorder.baseValue = row?.Base_Value ?? 0;
    recorder.percentAddition = BigInt(row?.PercentAddition ?? 0);
  }
  return manager;
}

// BattleData_Recorder.GetFinal:英灵自身 + 主角继承.
function mergedFinal (
  prop: number,
  percentProps: Set<number>,
  yingLing: readonly BattleRecorder[],
  master: readonly BattleRecorder[]
): {base: number; pct: number; value: number} {
  const recOf = (list: readonly BattleRecorder[]): BattleRecorder | undefined => list.find(item => item.PropertyTypeEnum === prop);
  const yr = recOf(yingLing);
  const mr = recOf(master);
  const yPct = yr?.PercentAddition ?? 0;
  const mPct = mr?.PercentAddition ?? 0;
  const base = (yr ? Math.round(yr.Base_Value) : 0) + (mr ? Math.round(mr.Base_Value) : 0);
  const pct = yPct + mPct;
  const value = percentProps.has(prop) ? Math.max(0,base) : Math.round(base * (100 + pct) / 100);
  return {base,pct,value};
}

/**
 * 解析自选敌人参数:`--enemy=key=value,key=value`.只返回覆盖项,由调用方先按 pinzhi
 * 重建场景敌人再覆盖字段,这样 pinzhi 能同时切换敌人属性与图鉴预设.
 * 支持的 key:hp / def / speed / hit / dodge / crit / critResist / reduce / pinzhi.
 * @param text --enemy 的值.
 * @returns 字段覆盖 + 可选品级(1 小怪 / 2 精英 / 3 首领).
 */
function parseEnemyOverride (text: string | undefined): {fields: Partial<EnemyStats>; pinzhi?: number} {
  const fields: Partial<EnemyStats> = {};
  if (text === undefined || text.trim() === "") {return {fields};}
  let pinzhi: number | undefined;

  // 分隔符兼容逗号/中文逗号/分号/空白(PowerShell 常把逗号转成空格).
  for (const piece of text.split(/[,，;\s]+/u)) {
    const trimmed = piece.trim();
    if (trimmed === "") {continue;}
    const eq = trimmed.indexOf("=");
    if (eq === -1) {throw new Error(`自选敌人写法不对：${trimmed}（应为 key=value，如 --enemy=hp=62.8垓,def=7116京）`);}
    const key = trimmed.slice(0,eq).trim()
.toLowerCase();
    const raw = trimmed.slice(eq + 1);
    if (key === "pinzhi" || key === "品级") {
      pinzhi = Math.trunc(Number(raw));
      if (![1,2,3].includes(pinzhi)) {throw new Error(`敌人品级只能是 1/2/3：${raw}`);}
      continue;
    }
    const field: keyof EnemyStats | undefined = ({
      crit:       "crit",
critresist: "critResist",
def:        "def",
dodge:      "dodge",
hit:        "hit",
      hp:         "hp",
kangbao:    "critResist",
reduce:     "damageReduce",
speed:      "speed"
    } as Record<string,keyof EnemyStats>)[key];
    if (field === undefined) {
      throw new Error(`未知敌人字段：${key}（可用 hp/def/speed/hit/dodge/crit/critResist/reduce/pinzhi）`);
    }
    fields[field] = parseUnitNumber(raw);
  }
  return {fields,pinzhi};
}

/**
 * 解析 --obs=217,460,688:支持带单位(46.0垓)与不带单位(217);不带单位时按 5 次命中的量级自动补单位.
 * @param text 逗号/空格分隔的伤害值.
 * @returns 原始数值 + 显式单位;未传返回空数组.
 */
function parseObserved (text: string | undefined): ObservedValue[] {
  if (text === undefined) {return [];}
  const values: ObservedValue[] = [];
  for (const piece of text.split(/[,，\s]+/u).filter(item => item !== "")) {
    const matched = (/^(\d+(?:\.\d+)?)([万亿兆京垓秭穰沟涧正载极]?)$/u).exec(piece.trim());
    if (matched?.[1] === undefined) {throw new Error(`伤害写法不对：${piece}（可用 217 / 46.0垓 / 1.5兆）`);}
    const raw = Number(matched[1]);
    if (!Number.isFinite(raw)) {throw new TypeError(`伤害写法不对：${piece}`);}
    values.push({raw,unit: matched[2] === undefined || matched[2] === "" ? undefined : matched[2]});
  }
  return values;
}

/**
 * 解析可带中文单位/科学计数法的数值:62.8垓 / 7116京 / 1e21 / 2175.
 * @param text 数值文本.
 * @returns 绝对数值.
 */
function parseUnitNumber (text: string): number {
  const matched = (/^(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)([万亿兆京垓秭穰沟涧正载极]?)$/u).exec(text.trim());
  if (matched?.[1] === undefined) {throw new Error(`数值写法不对：${text}（可用 2175 / 7116京 / 62.8垓 / 1e21）`);}
  const unit = matched[2];
  const power = unit === undefined || unit === "" ? 0 : CN_UNITS.indexOf(unit);
  const value = Number(matched[1]) * 10000 ** power;
  if (!Number.isFinite(value)) {throw new TypeError(`数值超出范围：${text}`);}
  return value;
}

/**
 * 打印孙悟空的**详情页面板**(源码 BattleData_Recorder.GetFinal + 主角继承),
 * 数值全部来自存档,不含任何标定常数,可直接和游戏「英灵详情」逐项对照.
 * @param panel 输出位面板.
 * @param team 队伍开战加成(用于标出开战后的攻击).
 */
function printCarryPanelDetail (panel: CarryPanel,team: TeamContext): void {
  const rows: [string,number][] = [
    ["攻击",Prop.ATK],["生命",Prop.HP],["防御",Prop.DEF],["穿透",Prop.Igonore_DEF],
    ["速度",Prop.Speed],["命中",Prop.MingZhong],["闪避",Prop.ShanBi],["暴击",Prop.BaoJi],
    ["抗暴",Prop.BaoJi_Resist],["暴伤",Prop.BaoJi_Damage],["连击",Prop.LianJi],["反击",Prop.FanJi],
    ["伤害加成",Prop.DamageAddition],["减伤",Prop.DamageReduce],["幸运",Prop.Lucky]
  ];
  const cells = rows.map(([name,prop]) => {
    const own = panel.source.getData(prop);
    const master = panel.master.getData(prop);
    const total = panel.source.getFinalValue(prop,panel.master);
    if (panel.percentOf(prop)) {
      return `${name}=${formatBigSuoXie(total)}（英灵 ${formatBigSuoXie(own.trueBaseValue)} + 主角 ${formatBigSuoXie(master.trueBaseValue)}）`;
    }
    return `${name}=${formatBigSuoXie(total)}（${formatBigSuoXie(own.trueBaseValue + master.trueBaseValue)}×(100+${String(own.percentAddition + master.percentAddition)})/100）`;
  });
  console.log("\n孙悟空详情页面板（源码 GetFinalValue，非百分比=基础×(100+%)/100，百分比型=英灵+主角，可直接和游戏对照）:");
  for (let index = 0; index < cells.length; index += 2) {
    console.log(`  ${(cells[index] ?? "").padEnd(34)}${cells[index + 1] ?? ""}`);
  }
  const atk = panel.source.getFinalValue(Prop.ATK,panel.master);
  console.log(
    `  开战后（武松神转职 Entry_Skill_1011：攻击% +${String(team.wuSongAtkPct)}）: ` +
    `攻击 ${formatBigSuoXie(atk)} → ${formatBigSuoXie(atk * BigInt(100 + team.wuSongAtkPct) / 100n)}`
  );
}

/**
 * 把用户给的暴击伤害逐个丢进 5 次命中的范围里,打印落点与偏差.
 * @param hits 5 次命中.
 * @param observed 观测到的暴击伤害(如 217/460/688 或 46.0垓).
 */
function printObservedMatch (hits: readonly LayerHit[],observed: readonly ObservedValue[]): void {
  console.log("\n--- 观测值落点核对(只比暴击范围)---");
  const deviations: number[] = [];
  for (const item of observed) {
    const value = resolveObserved(item,hits);
    const ranked = hits
      .map(hit => ({deviation: value / Number(hit.range.crit),hit}))
      .sort((left,right) => Math.abs(Math.log(left.deviation)) - Math.abs(Math.log(right.deviation)));
    const nearest = ranked[0];
    if (nearest === undefined) {continue;}
    deviations.push(nearest.deviation);
    const inside = hits.filter(hit => value >= Number(hit.range.critRange[0]) && value <= Number(hit.range.critRange[1]));
    const position = `第${String(nearest.hit.mark + 1)}击 ${QUALITY_NAME[nearest.hit.quality] ?? "?"}(Mark${String(nearest.hit.mark)})`;
    const percent = ((nearest.deviation - 1) * 100).toFixed(1);
    if (inside.length > 0) {
      console.log(`  ${formatSuoXie(value)} → ${position}  偏差 ${percent}%  [落在范围内]`);
      continue;
    }
    console.log(`  ${formatSuoXie(value)} → ${position}  偏差 ${percent}%  [超出范围]`);
  }
  if (deviations.length < 2) {return;}

  // 只做统计描述:模型里没有任何标定常数,这里不给「调参建议」.
  console.log(
    `\n  统计:${String(deviations.length)} 个观测的 观测/期望 = ${Math.min(...deviations).toFixed(4)} ~ ${Math.max(...deviations).toFixed(4)}，` +
    `中心 ${((Math.min(...deviations) + Math.max(...deviations)) / 2).toFixed(4)}，` +
    "单次浮动窗口 ±5%（源码 Damage_Recorder.cs:80-81 Random.Range(0.95f,1.05f)）"
  );
}

// 首回合怒气:孙悟空神转职 +25,人皇印开战 +50,门槛 100;不满则首击不是怒气技能.
function printRageCheck (save: SaveBundle,panel: CarryPanel): void {
  const isShen = hasShen(save,WU_KONG);
  const isRenHuangYin = panel.weapon?.entry === "RenHuangYin";
  const sp = SP_OPEN_BATTLE + (isShen ? WU_KONG_SHEN_SP : 0) + (isRenHuangYin ? REN_HUANG_YIN_SP : 0);
  const isOk = sp >= SP_RAGE_NEED;
  console.log(
    `\n首回合怒气: 开战 ${String(SP_OPEN_BATTLE)} + 孙悟空神转职 ${isShen ? String(WU_KONG_SHEN_SP) : "0"} + ` +
    `人皇印 ${isRenHuangYin ? String(REN_HUANG_YIN_SP) : "0"} = ${String(sp)} / ${String(SP_MAX)}` +
    `（门槛 ${String(SP_RAGE_NEED)}）${isOk ? " → 首回合可放怒气技能" : " → 首击不是怒气技能，下面的怒气倍率不成立"}`
  );
  if (!isShen) {console.log("  ⚠ 存档里孙悟空没有神转职技能，下面按神转职口径计算仅作参考");}
}

// ============================== 打印 ==============================
// 打印阵容,羁绊档位与队友开战效果(全部来自存档 + config).
function printTeamContext (save: SaveBundle,team: TeamContext): void {
  const names = loadConfig<NamesConfig>("names");
  const lineup = lineupOf(save).map(index => names.yingLing[String(index)] ?? `英灵${String(index)}`);
  const jibanName = loadConfig<{type: number}[]>("jiban");
  const list: string[] = [];
  for (const [type,level] of team.jiban) {
    const name = ["三国群英","梁山群雄","倾国倾城","千古流芳","神鬼志异","万人敌","神谋鬼算","济世名医","忠肝义胆","桀骜不逊","义无反顾","西行取经"][jibanName.findIndex(item => item.type === type)] ?? `类型${String(type)}`;
    list.push(`${name} Lv.${String(level)}`);
  }
  console.log(`\n阵容: ${lineup.join(" / ")}`);
  console.log(`生效羁绊: ${list.length > 0 ? list.join("，") : "无"}`);
  console.log(
    `孙悟空词条: 神通15 Lv.${String(team.shenTong15)}  神通19 Lv.${String(team.shenTong19)}  神通27 Lv.${String(team.shenTong27)}` +
    `   |  唐三藏命中+${String(team.tangSanZangHit)}  武松攻击+${String(team.wuSongAtkPct)}% 武松增伤+${String(team.wuSongDmgAdd)}%` +
    `   敌人开战负面 ${String(team.badStacks)} 层`
  );
}

/**
 * 通天塔同一层:一轮群体技能打 5 个目标的逐击伤害表 + 观测值落点核对.
 * 源码依据:MapRecorder.GetEnemyCount(品级分布)/GetEnemtID(图鉴预设)/Character_Enemy.cs:123-134/
 * Battle_Action_Manager.ActionOrder + ArrayHelper.OrderByMin(按速度降序,原地排序)/
 * Entry_Skill_76.AfterAttakEnemy(每命中一个目标 Mark+1).
 * 一层只出手一次,5 个目标按速度降序吃伤:首领(2175) → 精英(2174) ×2 → 小怪(2173) ×2,
 * 所以同一品级的两个怪伤害相差 10%(Mark 差 1 层).
 * @param save 存档.
 * @param layer 层数.
 * @param panel 输出位面板.
 * @param team 队伍加成.
 * @param opts 图鉴/减伤/暴伤覆盖 + 观测值(暴击伤害).
 */
function printTowerLayerTable (
  save: SaveBundle,
  layer: number,
  panel: CarryPanel,
  team: TeamContext,
  opts: {
    critDamagePct: number | undefined;
    observed:      readonly ObservedValue[];
    reducePct:     number | undefined;
    tuJianArg:     number | undefined;
  }
): void {
  const presets = towerPresets();
  const spawnOrder = TOWER_QUALITY[layer % 5] ?? TOWER_QUALITY[1] ?? [1,1,1,1,1];
  const qualities = [...spawnOrder].sort((left,right) => towerEnemy(layer,right).speed - towerEnemy(layer,left).speed);
  console.log(`\n--- 本层刷怪(MapRecorder.GetEnemyCount,层数%5=${String(layer % 5)})---`);
  console.log(`  ${spawnOrder.map((item,index) => `${String(index + 1)}.${QUALITY_NAME[item] ?? String(item)}`).join("  ")}`);
  console.log(`  一轮群体技能的命中顺序(速度降序): ${qualities.map(item => QUALITY_NAME[item] ?? String(item)).join(" → ")}`);
  const hits: LayerHit[] = qualities.map((quality,index) => {
    const preset = quality === 3 ? presets.boss : quality === 2 ? presets.elite : presets.normal;
    const tuJian = opts.tuJianArg ?? tuJianDamagePctOf(save,preset).pct;
    return {
      mark:  index,
      quality,
      range: damageRangeOf("tower",layer,panel,towerEnemy(layer,quality),team,{
        critDamagePct:   opts.critDamagePct,
        mark:            index,
        reducePct:       opts.reducePct,
        tuJianDamagePct: tuJian
      }),
      tuJian
    };
  });
  console.log("\n--- 5 次命中:暴击范围 = 期望 × 0.95~1.05(Damage_Recorder Random.Range)---");
  console.log("  序 品级  Mark  图鉴增伤  敌HP      暴击范围(±5%)               暴击期望   非暴击范围              命中率 暴击率 K");
  for (const hit of hits) {
    const {range} = hit;
    const critRng = `${formatBigSuoXie(range.critRange[0])} ~ ${formatBigSuoXie(range.critRange[1])}`;
    const nonCritRng = `${formatBigSuoXie(range.nonCritRange[0])} ~ ${formatBigSuoXie(range.nonCritRange[1])}`;
    console.log(
      `  ${String(hit.mark + 1).padStart(2)}  ${(QUALITY_NAME[hit.quality] ?? "?").padEnd(4)}  ` +
      `${String(hit.mark).padStart(4)}  ${String(hit.tuJian).padStart(7)}%  ${formatSuoXie(range.enemy.hp).padEnd(8)}  ` +
      `${critRng.padEnd(26)}  ${formatBigSuoXie(range.crit).padEnd(9)}  ${nonCritRng.padEnd(23)}  ` +
      `${(range.hitRate * 100).toFixed(0)}%  ${(range.critRate * 100).toFixed(0)}%  ${String(range.k)}`
    );
  }
  if (opts.observed.length > 0) {printObservedMatch(hits,opts.observed);}
}
function readJsonObject<T> (file: string): T {
  const first = readJsonObjects<T>(file)[0];
  if (first === undefined) {throw new Error(`存档为空：${file}`);}
  return first;
}

// 读取"每行一个 JSON"的存档,自动跳过第一行类名.
function readJsonObjects<T> (file: string): T[] {
  const text = readFileSync(file,"utf8").replace(/^\u{FEFF}/u,"");
  const objects: T[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {continue;}
    objects.push(JSON.parse(trimmed) as T);
  }
  if (objects.length === 0) {
    const first = text.indexOf("{");
    if (first === -1) {throw new Error(`存档内容无法解析：${file}`);}
    objects.push(JSON.parse(text.slice(first)) as T);
  }
  return objects;
}

// 解析 Prop_Data.Save:道具定义(名称 ID / 档位 / 实际属性).
function readPropDefinitions (dir: string): Map<number,PropDefinition> {
  const result = new Map<number,PropDefinition>();
  const file = join(dir,"Prop_Data.Save");
  if (!existsSync(file)) {return result;}
  for (const raw of readJsonObjects<PropDefinition>(file)) {
    if (Number.isFinite(raw._propID)) {result.set(raw._propID,raw);}
  }
  return result;
}

// ============================== 入口 ==============================
/**
 * 把观测值换算成绝对数值:写了单位就按单位换算,没写单位就选一个数量级让它落到各次命中的量级附近.
 * @param item 解析结果.
 * @param hits 5 次命中.
 * @returns 绝对数值.
 */
function resolveObserved (item: ObservedValue,hits: readonly LayerHit[]): number {
  if (item.unit !== undefined) {return item.raw * 10000 ** CN_UNITS.indexOf(item.unit);}
  let best = item.raw;
  let bestScore = Infinity;
  for (let power = 0; power < CN_UNITS.length; power++) {
    const scaled = item.raw * 10000 ** power;
    const score = Math.min(...hits.map(hit => Math.abs(Math.log10(scaled / Number(hit.range.crit)))));
    if (!(score < bestScore)) {
      continue;
    }
    bestScore = score;
    best = scaled;
  }
  return best;
}
function resolveScene (text: string): "tower" | "trial" | "zhongju" {
  const alias = new Map<string,"tower" | "trial" | "zhongju">([
    ["tower","tower"],["trial","trial"],["zhongju","zhongju"],
    ["终","zhongju"],["终局","zhongju"],["试","trial"],["试炼","trial"],
    ["通","tower"],["通天","tower"],["通天塔","tower"]
  ]);
  const scene = alias.get(text.trim());
  if (scene === undefined) {
    throw new Error(`未知目标：${text}（可用 通天塔 / 试炼 / 终局 或 tower / trial / zhongju）`);
  }
  return scene;
}

// 通天塔 True_Round 的通用倍率:ClearAddtion(层数),见 game-formulas towerAddition 源码口径.
function towerAddition (layer: number): number {
  if (layer <= 10000) {return 1;}
  const bucket = Math.min(Math.trunc(layer / 10000),200);
  if (layer < 20000) {return 1 + (layer - 10000) / 10000 * 9;}
  const low = 10 * 2 ** (bucket - 2);
  const high = 10 * 2 ** (bucket - 1);
  const remain = layer % 10000;
  return remain === 0 ? low : remain / 10000 * (high - low) + low;
}

// 通天塔 map5 的图鉴索引:小怪 / 精英 / 首领(取自 config/maps.json,不写死).
function towerPresets (): {boss: number; elite: number; normal: number} {
  const map = loadConfig<MapRecord[]>("maps").find(item => item.mapID === 5);
  return {boss: map?.bossID ?? 15,elite: map?.jingYingID ?? 14,normal: map?.louLouID ?? 13};
}

// 试炼敌人模板 HP:每级 225·(L/50+1) 累加.
function trialBaseHp (ceng: number): number {
  const level = trialGetLevel(ceng);
  const m = Math.trunc(level / 50);
  const sumFloor = 50 * (m - 1) * m / 2 + m * (level - 50 * m + 1);
  return 225 * (level + sumFloor);
}

// 试炼敌人 GetLevel():ShiLian_Manger.GetLevel = 10000 + (层数-1)·250·(层数/10+1).
function trialGetLevel (ceng: number): number {
  return 10000 + (ceng - 1) * 250 * (Math.trunc(ceng / 10) + 1);
}

// 图鉴增伤%(仅通天塔):图鉴(PresetID)等级 × 研究54 等级.
function tuJianDamagePctOf (save: SaveBundle,presetIdx: number): {level: number; pct: number; research: number} {
  const records = save.cha.tuJianData_RecordsList ?? [];
  const level = records.find(item => item.EnemyIndex === presetIdx)?.Level
    ?? records.reduce((max,item) => Math.max(max,item.Level),0);
  const research = (save.cha.keJi_Recorders ?? []).find(item => item.KeJi_ID === 54)?.KeJi_Level ?? 0;
  return {level,pct: level * research,research};
}

// 终局敌人:percent=true 的属性直接取 Base,否则取 Base×(100+Percent)/100.
function zhongJuEnemies (): ({tiaoZhanID: number} & EnemyStats)[] {
  const settings = loadConfig<PropertySetting[]>("property");
  const valueOf = (record: ZhongJuRecord,property: number): number => {
    const entry = record.stats.find(item => item.property === property);
    if (entry === undefined) {return 0;}
    const isPercent = settings.find(item => item.type === property)?.percent === 1;
    return isPercent ? Math.round(entry.base) : Math.trunc(entry.base * (100 + entry.percent) / 100);
  };
  return loadConfig<ZhongJuRecord[]>("zhongju").map(record => ({
    crit:         valueOf(record,PROP_CRIT),
    critResist:   valueOf(record,PROP_CRIT_RESIST),
    damageReduce: valueOf(record,PROP_DAMAGE_REDUCE),
    def:          valueOf(record,PROP_DEF),
    dodge:        valueOf(record,PROP_DODGE),
    hit:          valueOf(record,PROP_HIT),
    hp:           valueOf(record,PROP_HP),
    speed:        valueOf(record,PROP_SPEED),
    tiaoZhanID:   record.tiaoZhanID
  }));
}

// 命令行入口:供 `pnpm verify 通天塔 20W` 调用;作为模块 import 时不执行.
if (process.argv[1] === import.meta.filename) {
  try {
    const positionals = process.argv.slice(2).filter(item => !item.startsWith("--"));
    verifyFinalDamage(positionals[0] ?? "通天塔",positionals[1]);
  } catch (error) {
    console.error(`错误：${Error.isError(error) ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}