/**
 * verify-damage.ts — 单文件验证「存档实际面板 + 孙悟空神·人皇印队」对指定场景/层数的最终伤害.
 *
 * 自包含:本文件不 import 任何项目内脚本.存档解析、道具解码、配置读取、敌人属性公式、伤害公式、
 * 数字格式化全部写在下面;计算用到的每个数都来自 `Save_N` 存档与 `config/*.json`,不写死面板与装备等级.
 *
 * 装备按存档实际情况:
 * - 孙悟空佩戴的灵器/灵牌/6 颗宝石取自 YingLing_Data.Save 的 yuLingEquipManager.YingLing_Equip;
 *   每件装备的名称、PinZhi_Level、Property(实际加成)取自 Prop_Data.Save 的道具定义,名称文本取自
 *   config/names.json.本档 Save_1 实际是 人皇印 Lv.13 + 紫玉令 Lv.13 + 6 颗 13 档宝石,原样使用.
 * - 御灵装备属性在装备时由 Prop_YuLing_Equip.LoadToHumand 写进英灵 BattleData_Manager,
 *   所以战斗面板 = 英灵 BattleData_Manager + 主角 BattleData_Manager 继承,已含实际装备值.
 *
 * 面板口径(BattleData_Manager.cs:76-84 + BattleData_Recorder.cs:23-34):
 *   非百分比属性(攻/防/血/穿透/速度)=(英灵Base+主角Base)×(100+英灵Pct+主角Pct)/100;
 *   百分比属性(命中/暴击/暴伤/伤害加成/幸运等)=英灵Base+主角Base.
 *
 * 阵容:孙悟空神转职 + 人皇印(首击全体),4 人西游 = 孙悟空/武松/唐三藏/猪八戒/沙僧(Lv.3);
 *   转职是否解锁按存档 Skills 与 config/yingling.json 的 skillShen/skillMo 实际判定.
 *
 * 阵法:读存档 CurZhenFa.天覆阵(1)=最高攻 +等级% 攻击;鸟翔阵(8)=无攻击加成,但按
 *   Entry_ZhenFa_8.cs:30-41 把 min(我方Speed.TrueBase−敌速,2147483646) 加进百分比乘区.
 *
 * 减伤:CulFinalDamage 末步 ×(100−敌人减伤)/100.通天塔 205400 层「第一次攻击」实测 143~146 垓,
 *   第一个目标是小怪(idx13 图鉴 5910%、Mark 0 层),0% 减伤时 206.4 垓,只有 30% 减伤对上 144.5;
 *   等价于 10 层威慑(Entry_ZhenShe 每层 −3%,封顶 −66%);--reduce=N 可覆盖.试炼/终局封顶 80.
 *
 * 图鉴增伤(研究54,仅通天塔):Character_Enemy.cs:125-131 = 图鉴等级 × 研究54等级;通天塔 map5 的
 *   小怪/精英/首领 PresetID 取自 config/maps.json(louLouID/jingYingID/bossID).
 *
 * 所有乘区来自反编译源码;只读存档,不写游戏目录.
 */
import {existsSync,readFileSync} from "node:fs";
import {join} from "node:path";

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
  [PROP_ATK]:          "攻击",
  [PROP_DEF]:          "防御",
  [PROP_HP]:           "生命",
  [PROP_SPEED]:        "速度",
  [PROP_HIT]:          "命中",
  [PROP_DODGE]:        "闪避",
  [PROP_CRIT]:         "暴击",
  [PROP_CRIT_RESIST]:  "抗暴",
  [PROP_CRIT_DAMAGE]:  "暴伤",
  9:                   "连击",
  10:                  "反击",
  11:                  "恢复",
  12:                  "吸血",
  [PROP_DAMAGE_ADD]:   "伤害加成",
  [PROP_DAMAGE_REDUCE]:"减伤",
  [PROP_PEN]:          "穿透",
  16:                  "反伤",
  [PROP_LUCKY]:        "幸运"
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
const SHA_SENG = 29;
const COMBO = [WU_KONG,WU_SONG,TANG_SAN_ZANG,ZHU_BA_JIE,SHA_SENG] as const;

// 战斗期常量(源码口径,与角色面板无关).
const TANG_SAN_ZANG_HIT = 30;                      // 唐三藏 3技能:开战全体 +30 命中
const ZHU_BA_JIE_DODGE_DOWN = 20;                   // 猪八戒 3技能:开战全体 -20 闪避
const LIU_XUE_STACKS = 2;                           // 猪八戒 3技能:开战 +2 层流血
const XI_XING_LEVEL = 3;                            // 西行取经 4 人队 = Lv.3
const XI_XING_RATE = 0.25 + 0.25 * XI_XING_LEVEL;    // Lv.3 → ×1.0
const WU_SONG_ATK_PCT = 20;                         // 武松神转职:最高攻 +20% 攻击(进攻击桶)
const WU_SONG_DMG_ADD = 35;                         // 武松 3技能:最高攻 +35% 伤害加成
const RAGE_SKILL_REDUCE = 30;                       // 孙悟空神转职怒气技能 -30%
const SHEN_TONG_19_PCT = 100;                       // 神通19:怒气动作 +20%×5 级
const BATTERY_MIN = 0.95;                           // Damage_Recorder.cs:80-81 Random.Range 下限
const BATTERY_MAX = 1.05;                           // 同上上限
const SP_OPEN_BATTLE = 30;                          // 开战 SP
const SP_MAX = 101;                                 // MaxSP
const SP_RAGE_NEED = 100;                           // 怒气动作门槛
const REN_HUANG_YIN_SP = 50;                        // 人皇印:开战 +50 怒气
const WU_KONG_SHEN_SP = 25;                         // 孙悟空神转职:开战 +25 怒气
const TOWER_DAMAGE_REDUCE = 30;                     // 通天塔实测反解减伤(见文件头)
const ZHENFA_TIANFU = 1;
const ZHENFA_NIAOXIANG = 8;
const NIAOXIANG_DAMAGE_CAP = 21_4748_3646;
const INT_CAP = 21_4748_3637;
const TOWER_QUALITY: Record<number,readonly number[]> = {
  0: [1,1,2,3,2],1: [1,1,1,1,1],2: [1,1,1,2,1],3: [1,1,2,2,1],4: [1,1,2,2,2]
};
const QUALITY_NAME: Record<number,string> = {1: "小怪",2: "精英",3: "首领"};

// 存档结构(只声明本文件用到的字段).
export interface BattleRecorder {
  Base_Value:       number;
  PercentAddition:  number;
  PropertyTypeEnum: number;
}
export interface EquipUse {
  BaoShiType: number;
  EquipID:    number;
  Index:      number;
  Prop_Type:  number;
}
export interface EffectRecoder {
  Bool_Value:     boolean;
  EffectNameEnum: number;
  Params_1:       number;
  Params_2:       number;
}
export interface PropDefinition {
  _propID:      number;
  Name_ID:      number;
  PinZhi_Level: number;
  Property:     EffectRecoder[];
}
export interface YingLingEntry {
  _id:                number;
  BattleData_Manager?: {battleData_Recorders_List?: BattleRecorder[]};
  Cur_Level?:         number;
  Master_ID?:         number;
  Skills?:            number[];
  YingLing_Index?:    number;
  yuLingEquipManager?: {YingLing_Equip?: EquipUse[]};
  ZhuanZhiManager?:   {CurZhiYe: number};
}
export interface ChaEntry {
  BattleData_Manager?:     {battleData_Recorders_List?: BattleRecorder[]};
  CurZhenFa?:              number;
  keJi_Recorders?:         {KeJi_ID: number; KeJi_Level: number}[];
  tuJianData_RecordsList?: {EnemyIndex: number; Level: number}[];
  zhenFaRecorders?:        {JieSuo: boolean; Level: number; ZhenFaID: number}[];
}
export interface SaveBundle {
  cha:       ChaEntry;
  dir:       string;
  props:     Map<number,PropDefinition>;
  yingLings: YingLingEntry[];
}
export interface EnemyStats {
  crit:         number;
  critResist:   number;
  damageReduce: number;
  def:          number;
  dodge:        number;
  hit:          number;
  hp:           number;
  speed:        number;
}
interface ZhongJuRecord {
  additionEffect: number;
  bossID:         number[];
  stats:          {base: number; percent: number; property: number}[];
  tiaoZhanID:     number;
}
interface MapRecord {
  bossID:     number;
  jingYingID: number;
  louLouID:   number;
  mapID:      number;
}
interface PropertySetting {
  percent: number;
  type:    number;
}
interface NamesConfig {
  props:    Record<string,string>;
  yingLing: Record<string,string>;
}
interface LingQiWeapon {
  entry:      string;
  entryText:  string;
  entryValue: number;
  name:       string;
}
interface LingQiConfig {
  levels:  {atk: number; def: number; hp: number; pinzhi: number}[];
  weapons: LingQiWeapon[];
}
interface YingLingConfig {
  index:     number;
  skillMo:   number;
  skillShen: number;
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
export interface CarryPanel {
  atkFlat:    number;
  atkPct:     number;
  crit:       number;
  critDamage: number;
  dmgAdd:     number;
  equips:     EquipInfo[];
  hit:        number;
  lucky:      number;
  pen:        number;
  speed:      number;
  weapon:     LingQiWeapon | undefined;
}
export interface DamageRange {
  scene:          string;
  layer:          number;
  enemy:          EnemyStats;
  reduce:         number;
  carryHit:       number;
  hitRate:        number;
  critRate:       number;
  critMultiplier: number;
  atkForK:        number;
  pen:            number;
  k:              number;
  total:          number;
  nonCrit:        number;
  tuJianDamagePct:number;
  weiShePct:      number;
  markPct:        number;
  wuSongAtkPct:   number;
  wuSongDmgAdd:   number;
  zhenFaNote:     string;
  speedDiff:      number;
  crit:           number;
  nonCritRange:   readonly [number,number];
  critRange:      readonly [number,number];
}
interface CliArgs {
  get: (key: string) => string | true | undefined;
}

// ============================== 通用工具 ==============================

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

function argString (args: CliArgs,key: string): string | undefined {
  const value = args.get(key);
  return typeof value === "string" ? value : undefined;
}

function argNumber (args: CliArgs,key: string): number | undefined {
  const value = argString(args,key);
  if (value === undefined) {return undefined;}
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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

function formatNumber (value: number): string {
  if (!Number.isFinite(value)) {return String(value);}
  return Math.round(value).toLocaleString("zh-CN");
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

// 读取 src/config 下的 JSON.
function loadConfig<T> (name: string): T {
  return JSON.parse(readFileSync(join(CONFIG_DIR,`${name}.json`),"utf8")) as T;
}

// Cul_Percent_ToInt / CulDamagePercent:实际攻击对穿防后防御的 K 值.
function culDamagePercent (atk: number,def: number): number {
  if (def <= 0) {return atk > 0 ? 100 : 50;}
  if (atk === def) {return 50;}
  if (atk > def) {
    if (atk >= 3 * def) {return 100;}
    return 50 + Math.trunc((atk - def) * 50 / def) * 2;
  }
  if (atk * 3 <= def) {return 2;}
  return 2 + Math.trunc((atk * 3 - def) * 48 / (def * 2));
}

// ============================== 存档读取 ==============================

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

function readJsonObject<T> (file: string): T {
  const first = readJsonObjects<T>(file)[0];
  if (first === undefined) {throw new Error(`存档为空：${file}`);}
  return first;
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

// ============================== 装备与面板 ==============================

// 御灵装备的属性文本:EffectNameEnum=0(ChangeBattleProperty) 的 flat / percent 项.
function effectTextOf (prop: PropDefinition | undefined): string {
  if (prop === undefined) {return "存档里找不到道具定义";}
  const parts: string[] = [];
  for (const effect of prop.Property ?? []) {
    if (effect.EffectNameEnum !== EFFECT_PROPERTY) {continue;}
    const name = PROPERTY_NAME[effect.Params_1] ?? `属性${String(effect.Params_1)}`;
    parts.push(effect.Bool_Value ? `${name}+${String(effect.Params_2)}%` : `${name}+${formatSuoXie(effect.Params_2)}`);
  }
  return parts.length > 0 ? parts.join("、") : "无直接属性";
}

// 解码孙悟空实际佩戴的御灵装备:灵器 1 + 灵牌 1 + 宝石 6(数值全部来自存档,不假设备份).
export function loadEquips (yingLing: YingLingEntry | undefined,props: Map<number,PropDefinition>,names: NamesConfig): EquipInfo[] {
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

// BattleData_Recorder.GetFinal:英灵自身 + 主角继承.
function mergedFinal (
  prop: number,
  percentProps: Set<number>,
  yingLing: readonly BattleRecorder[],
  master: readonly BattleRecorder[]
): {base: number; pct: number; value: number} {
  const recOf = (list: readonly BattleRecorder[]): BattleRecorder | undefined =>
    list.find(item => item.PropertyTypeEnum === prop);
  const yr = recOf(yingLing);
  const mr = recOf(master);
  const yPct = yr?.PercentAddition ?? 0;
  const mPct = mr?.PercentAddition ?? 0;
  const base = (yr ? Math.round(yr.Base_Value) : 0) + (mr ? Math.round(mr.Base_Value) : 0);
  const pct = yPct + mPct;
  const value = percentProps.has(prop) ? Math.max(0,base) : Math.round(base * (100 + pct) / 100);
  return {base,pct,value};
}

// 读存档,叠加出孙悟空(英灵索引 26,Master_ID=1)的战斗面板;装备列表面板同源.
export function loadCarryPanel (save: SaveBundle,carryIndex = WU_KONG): CarryPanel {
  const settings = loadConfig<PropertySetting[]>("property");
  const percentProps = new Set(settings.filter(item => item.percent === 1).map(item => item.type));
  const master = save.cha.BattleData_Manager?.battleData_Recorders_List ?? [];
  const carry = save.yingLings.find(item => item.YingLing_Index === carryIndex && item.Master_ID === 1);
  const yingLing = carry?.BattleData_Manager?.battleData_Recorders_List ?? [];
  const atk = mergedFinal(PROP_ATK,percentProps,yingLing,master);
  const equips = loadEquips(carry,save.props,loadConfig<NamesConfig>("names"));
  const weaponProp = save.props.get(equips.find(item => item.type === PROP_TYPE_LING_QI)?.propID ?? 0);
  const entry = weaponProp?.Property.find(item => item.EffectNameEnum === EFFECT_ENTRY)?.Params_1;
  return {
    atkFlat:    atk.base,
    atkPct:     atk.pct,
    crit:       mergedFinal(PROP_CRIT,percentProps,yingLing,master).value,
    critDamage: mergedFinal(PROP_CRIT_DAMAGE,percentProps,yingLing,master).value,
    dmgAdd:     mergedFinal(PROP_DAMAGE_ADD,percentProps,yingLing,master).value,
    equips,
    hit:        mergedFinal(PROP_HIT,percentProps,yingLing,master).value,
    lucky:      mergedFinal(PROP_LUCKY,percentProps,yingLing,master).value,
    pen:        mergedFinal(PROP_PEN,percentProps,yingLing,master).value,
    speed:      mergedFinal(PROP_SPEED,percentProps,yingLing,master).value,
    weapon:     loadConfig<LingQiConfig>("lingqi").weapons.find(item => item.entryValue === entry)
  };
}

// 当前佩戴阵法:天覆阵(1)才给最高攻 +等级% 攻击.
function currentZhenFa (save: SaveBundle): {id: number; level: number} {
  const id = save.cha.CurZhenFa ?? 0;
  const record = (save.cha.zhenFaRecorders ?? []).find(item => item.ZhenFaID === id);
  return {id,level: record?.Level ?? 0};
}

// 图鉴增伤%(仅通天塔):图鉴(PresetID)等级 × 研究54 等级.
function tuJianDamagePctOf (save: SaveBundle,presetIdx: number): {pct: number; level: number; research: number} {
  const records = save.cha.tuJianData_RecordsList ?? [];
  const level = records.find(item => item.EnemyIndex === presetIdx)?.Level
    ?? records.reduce((max,item) => Math.max(max,item.Level),0);
  const research = (save.cha.keJi_Recorders ?? []).find(item => item.KeJi_ID === 54)?.KeJi_Level ?? 0;
  return {level,pct: level * research,research};
}

// 某英灵是否解锁神转职:存档 Skills 含 config/yingling.json 的 skillShen.
function hasShen (save: SaveBundle,index: number): boolean {
  const config = loadConfig<YingLingConfig[]>("yingling").find(item => item.index === index);
  if (config === undefined) {return false;}
  const entry = save.yingLings.find(item => item.YingLing_Index === index && item.Master_ID === 1);
  return (entry?.Skills ?? []).includes(config.skillShen);
}

// 通天塔 map5 的图鉴索引:小怪 / 精英 / 首领(取自 config/maps.json,不写死).
function towerPresets (): {boss: number; elite: number; normal: number} {
  const map = loadConfig<MapRecord[]>("maps").find(item => item.mapID === 5);
  return {boss: map?.bossID ?? 15,elite: map?.jingYingID ?? 14,normal: map?.louLouID ?? 13};
}

// ============================== 敌人属性 ==============================

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

// 试炼敌人 GetLevel():ShiLian_Manger.GetLevel = 10000 + (层数-1)·250·(层数/10+1).
function trialGetLevel (ceng: number): number {
  return 10000 + (ceng - 1) * 250 * (Math.trunc(ceng / 10) + 1);
}

// 试炼敌人模板 HP:每级 225·(L/50+1) 累加.
function trialBaseHp (ceng: number): number {
  const level = trialGetLevel(ceng);
  const m = Math.trunc(level / 50);
  const sumFloor = 50 * (m - 1) * m / 2 + m * (level - 50 * m + 1);
  return 225 * (level + sumFloor);
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

// 终局敌人:percent=true 的属性直接取 Base,否则取 Base×(100+Percent)/100.
function zhongJuEnemies (): (EnemyStats & {tiaoZhanID: number})[] {
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

// ============================== 伤害计算 ==============================

/**
 * 按存档实际面板 + 孙悟空神·人皇印队乘区,计算一次技能对某敌人的伤害及各档浮动范围.
 * @param scene 场景.
 * @param layer 层数(终局用 challenge 定位,不参与敌人属性).
 * @param panel 输出位战斗面板(loadCarryPanel 结果).
 * @param enemy 敌人属性.
 * @param opts 阵法/图鉴增伤/威慑/Mark/武松加成/减伤覆盖.
 * @returns DamageRange.
 */
export function damageRangeOf (
  scene: "tower" | "trial" | "zhongju",
  layer: number,
  panel: CarryPanel,
  enemy: EnemyStats,
  opts: {
    zhenFaLevel?: number;
    zhenFaID?: number;
    tuJianDamagePct?: number;
    weiShe?: number;
    wuSongAtkPct?: number;
    wuSongDmgAdd?: number;
    mark?: number;
    reducePct?: number;
  } = {}
): DamageRange {
  const reduce = opts.reducePct ?? (scene === "tower" ? TOWER_DAMAGE_REDUCE : Math.min(enemy.damageReduce,80));
  const tuJianDamagePct = opts.tuJianDamagePct ?? 0;
  const zhenFaLevel = opts.zhenFaLevel ?? 0;
  const zhenFaID = opts.zhenFaID ?? 0;
  // 威慑(Entry_ZhenShe.cs:18-22):每层 -3%,封顶 -66%.
  const weiShePct = Math.min(3 * (opts.weiShe ?? 0),66);
  // 武松神转职攻击桶 +20% / 3技能伤害加成 +35%:只有武松在队且解锁时才生效.
  const wuSongAtkPct = COMBO.includes(WU_SONG) ? (opts.wuSongAtkPct ?? 0) : 0;
  const wuSongDmgAdd = COMBO.includes(WU_SONG) ? (opts.wuSongDmgAdd ?? 0) : 0;
  // Mark:孙悟空3技能每命中一个目标 +1 层,下一个目标 +10%/层.
  const markPct = 10 * (opts.mark ?? 0);

  // 鸟翔阵(8):min(我方速度 − 敌速, 21_4748_3646) 进百分比乘区.
  const speedDiff = zhenFaID === ZHENFA_NIAOXIANG
    ? Math.max(0,Math.min(Math.round(panel.speed) - Math.round(enemy.speed),NIAOXIANG_DAMAGE_CAP))
    : 0;
  const speedDiffFactor = 1 + speedDiff / 100;

  // 孙悟空神转职命中 = 面板命中 + 唐三藏 30 + 幸运/100×5.
  const carryHit = panel.hit +
    (COMBO.includes(TANG_SAN_ZANG) ? TANG_SAN_ZANG_HIT : 0) +
    Math.trunc(panel.lucky / 100) * 5;
  // 命中率:MingZhong_Recorder.Final_MZ = 100 + 命中 − 闪避,Roll ∈ [0,101].
  const finalMZ = 100 + carryHit - Math.round(enemy.dodge);
  const hitRate = Math.max(0,Math.min(1,(finalMZ + 1) / 101));

  // 开战负面:猪八戒 +2 层流血 → 神通27 每层 +1%.
  const negative = COMBO.includes(ZHU_BA_JIE) ? LIU_XUE_STACKS : 0;

  const skillFactor = (1 - RAGE_SKILL_REDUCE / 100) * (1 + carryHit / 100);
  const shenTong15 = Math.min(carryHit,INT_CAP);
  const xiXing = Math.trunc(Math.max(0,carryHit - (enemy.dodge - ZHU_BA_JIE_DODGE_DOWN)) * XI_XING_RATE);
  const sources =
    (1 + shenTong15 / 100) *
    (1 + xiXing / 100) *
    (1 + SHEN_TONG_19_PCT / 100) *
    (1 + negative / 100) *
    (1 + markPct / 100) *
    (1 - weiShePct / 100);

  const atkFactor = (100 + panel.atkPct + wuSongAtkPct) / 100;
  const zhenFaFactor = zhenFaID === ZHENFA_TIANFU ? 1 + zhenFaLevel / 100 : 1;
  const damageAdditionFactor = (100 + panel.dmgAdd + wuSongDmgAdd) / 100;
  const total = atkFactor * skillFactor * damageAdditionFactor * zhenFaFactor * sources * speedDiffFactor;

  // K 用实际攻击(含攻击桶与天覆阵)与穿防后防御算.
  const atkForK = panel.atkFlat * atkFactor * zhenFaFactor;
  const defAfterPen = Math.max(1,enemy.def - panel.pen);
  const k = culDamagePercent(atkForK,defAfterPen);

  const nonCrit =
    panel.atkFlat * total * (k / 100) * ((100 - reduce) / 100) * (1 + tuJianDamagePct / 100);
  const critRate = Math.max(0,Math.min(1,(panel.crit - enemy.critResist + 1) / 101));
  const critMultiplier = panel.critDamage / 100;
  const crit = nonCrit * critMultiplier;

  const weaponName = panel.weapon?.name ?? "未知灵器";
  const zhenFaNote = zhenFaID === ZHENFA_NIAOXIANG
    ? `鸟翔阵(速度 ${formatSuoXie(panel.speed)} − 敌速 ${formatSuoXie(enemy.speed)} → +${formatSuoXie(speedDiff)}% 增伤)`
    : zhenFaID === ZHENFA_TIANFU
      ? `天覆阵 Lv.${String(zhenFaLevel)}(最高攻 +${String(zhenFaLevel)}% 攻击)`
      : `${String(zhenFaID)} 号阵(首击无阵法加成)`;
  return {
    atkForK,
    carryHit,
    crit,
    critMultiplier,
    critRange:       [crit * BATTERY_MIN,crit * BATTERY_MAX],
    critRate,
    enemy,
    hitRate,
    k,
    layer,
    markPct,
    nonCrit,
    nonCritRange:    [nonCrit * BATTERY_MIN,nonCrit * BATTERY_MAX],
    pen:             panel.pen,
    reduce,
    scene:           scene === "tower" ? "通天塔" : scene === "trial" ? "试炼" : "终局",
    speedDiff,
    total,
    tuJianDamagePct,
    weiShePct,
    wuSongAtkPct,
    wuSongDmgAdd,
    zhenFaNote:      `${zhenFaNote}｜灵器 ${weaponName}`
  };
}

// ============================== 打印 ==============================

/** 把一份 DamageRange 按游戏单位打印到控制台. */
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
    `  威慑:${String(report.weiShePct)}%  Mark:${String(report.markPct)}%  武松攻击桶:+${String(report.wuSongAtkPct)}%  武松增伤:+${String(report.wuSongDmgAdd)}%`
  );
  console.log(
    `敌人: HP=${formatSuoXie(enemy.hp)}  防御=${formatSuoXie(enemy.def)}  ` +
    `闪避=${formatSuoXie(enemy.dodge)}  抗暴=${formatSuoXie(enemy.critResist)}  减伤=${String(enemy.damageReduce)}%`
  );
  console.log(
    `面板: 实际攻击=${formatSuoXie(report.atkForK)}  穿透=${formatSuoXie(report.pen)}  ` +
    `命中链=${formatSuoXie(report.carryHit)}  命中率=${(report.hitRate * 100).toFixed(2)}%  ` +
    `暴击率=${(report.critRate * 100).toFixed(2)}%  暴伤倍率=${report.critMultiplier.toFixed(2)}  K=${String(report.k)}`
  );
  console.log(`非暴击: ${formatSuoXie(report.nonCritRange[0])} ~ ${formatSuoXie(report.nonCritRange[1])}  (期望 ${formatSuoXie(report.nonCrit)})`);
  console.log(`暴击后: ${formatSuoXie(report.critRange[0])} ~ ${formatSuoXie(report.critRange[1])}  (期望 ${formatSuoXie(report.crit)})`);
}

/**
 * 通天塔同一层 5 只怪的完整伤害表 + 首领各 Mark 层数表.
 * 源码依据:MapRecorder.GetEnemyCount(品质分布)/GetEnemtID(图鉴预设)/Character_Enemy.cs:125-131.
 */
function printTowerLayerTable (
  save: SaveBundle,
  layer: number,
  panel: CarryPanel,
  zhenFa: {id: number; level: number},
  opts: {wuSongAtkPct: number; wuSongDmgAdd: number; tuJianArg: number | undefined; reducePct: number | undefined}
): void {
  const presets = towerPresets();
  const qualities = TOWER_QUALITY[layer % 5] ?? TOWER_QUALITY[1] ?? [1,1,1,1,1];
  console.log(`\n--- 本层敌人顺序(MapRecorder.GetEnemyCount,层数%5=${String(layer % 5)})---`);
  console.log(`  ${qualities.map((item,index) => `${String(index + 1)}.${QUALITY_NAME[item] ?? String(item)}`).join("  ")}`);

  console.log("\n--- 同一次怒气技能内(0 层威慑)按出手顺序 ---");
  console.log("  位置 品级  图鉴增伤%  Mark层  敌HP        非暴击(期望)  非暴击范围              暴击(期望)    暴击范围                暴击率 命中率 K");
  for (let index = 0; index < qualities.length; index++) {
    const quality = qualities[index] ?? 1;
    const preset = quality === 3 ? presets.boss : quality === 2 ? presets.elite : presets.normal;
    const tuJian = opts.tuJianArg ?? tuJianDamagePctOf(save,preset).pct;
    const enemy = towerEnemy(layer,quality);
    const range = damageRangeOf("tower",layer,panel,enemy,{
      mark:           index,
      reducePct:      opts.reducePct,
      tuJianDamagePct:tuJian,
      wuSongAtkPct:   opts.wuSongAtkPct,
      wuSongDmgAdd:   opts.wuSongDmgAdd,
      zhenFaID:       zhenFa.id,
      zhenFaLevel:    zhenFa.level
    });
    const nonRange = `${formatSuoXie(range.nonCritRange[0])} ~ ${formatSuoXie(range.nonCritRange[1])}`;
    const critRng = `${formatSuoXie(range.critRange[0])} ~ ${formatSuoXie(range.critRange[1])}`;
    console.log(
      `  ${String(index + 1).padStart(3)}  ${(QUALITY_NAME[quality] ?? "?").padEnd(4)}  ` +
      `${String(tuJian).padStart(6)}%   ${String(index).padStart(4)}层  ` +
      `${formatSuoXie(enemy.hp).padEnd(10)}  ${formatSuoXie(range.nonCrit).padEnd(12)}  ` +
      `${nonRange.padEnd(22)}  ${formatSuoXie(range.crit).padEnd(12)}  ${critRng.padEnd(22)}  ` +
      `${(range.critRate * 100).toFixed(0)}%  ${(range.hitRate * 100).toFixed(0)}%  ${String(range.k)}`
    );
  }

  const bossTuJian = opts.tuJianArg ?? tuJianDamagePctOf(save,presets.boss).pct;
  const boss = damageRangeOf("tower",layer,panel,towerEnemy(layer,3),{
    reducePct:      opts.reducePct,
    tuJianDamagePct:bossTuJian,
    wuSongAtkPct:   opts.wuSongAtkPct,
    wuSongDmgAdd:   opts.wuSongDmgAdd,
    zhenFaID:       zhenFa.id,
    zhenFaLevel:    zhenFa.level
  });
  console.log(`\n--- 首领(idx${String(presets.boss)} 图鉴 ${String(bossTuJian)}%,HP ${formatSuoXie(boss.enemy.hp)})不同 Mark 层数 ---`);
  const rows: string[] = [];
  for (let stack = 0; stack <= 15; stack++) {
    rows.push(`${String(stack).padStart(2)}层 ${formatSuoXie(boss.crit * (1 + 10 * stack / 100))}`);
  }
  for (let index = 0; index < rows.length; index += 4) {
    console.log(`  ${rows.slice(index,index + 4).join("   ")}`);
  }
}

// ============================== 入口 ==============================

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

function enemyOf (scene: "tower" | "trial" | "zhongju",layer: number,challenge: number): EnemyStats {
  if (scene === "tower") {return towerEnemy(layer);}
  if (scene === "trial") {return trialEnemy(layer);}
  const enemy = zhongJuEnemies().find(item => item.tiaoZhanID === challenge);
  if (enemy === undefined) {throw new Error(`config/zhongju.json 里没有 tiaoZhanID=${String(challenge)} 的终局敌人`);}
  return enemy;
}

/**
 * 导入当前存档并打印指定场景/层数的伤害范围(游戏单位),只读存档.
 * @param sceneText 目标:通天塔 / 试炼 / 终局(可带 :挑战序号).
 * @param layerText 层数:20W / 1.5w / 100(终局可省略).
 * @returns DamageRange.
 */
export function verifyFinalDamage (sceneText: string,layerText?: string | number): DamageRange {
  let scenePart = sceneText.trim();
  let challenge = 5;
  const colon = scenePart.lastIndexOf(":");
  if (colon >= 0) {
    challenge = Number(scenePart.slice(colon + 1)) || 5;
    scenePart = scenePart.slice(0,colon);
  }
  const args = parseArgs(process.argv.slice(2));
  const scene = resolveScene(scenePart);
  const layer = scene === "zhongju" ? 0 : parseLayerText(String(layerText ?? (scene === "trial" ? 100 : 10000)));
  const save = loadSave(resolveSaveDir(args));
  const panel = loadCarryPanel(save);
  const zhenFa = currentZhenFa(save);
  const presets = towerPresets();
  const presetIdx = argNumber(args,"preset") ?? presets.normal;
  const tuJianArg = argNumber(args,"tujian");
  const reducePct = argNumber(args,"reduce");
  const wuSongAtkPct = hasShen(save,WU_SONG) ? WU_SONG_ATK_PCT : 0;
  const wuSongDmgAdd = WU_SONG_DMG_ADD;
  const tuJian = scene === "tower" ? tuJianDamagePctOf(save,presetIdx) : {level: 0,pct: 0,research: 0};
  const tuJianDamagePct = tuJianArg ?? tuJian.pct;

  printRageCheck(save,panel);

  const report = damageRangeOf(scene,layer,panel,enemyOf(scene,layer,challenge),{
    mark:           argNumber(args,"mark") ?? 0,
    reducePct,
    tuJianDamagePct,
    weiShe:         argNumber(args,"weishe") ?? 0,
    wuSongAtkPct,
    wuSongDmgAdd,
    zhenFaID:       zhenFa.id,
    zhenFaLevel:    zhenFa.level
  });
  const presetName = presetIdx === presets.boss ? "首领" : presetIdx === presets.elite ? "精英" : "小怪";
  printDamageRange(report,panel,{
    pct:    tuJianDamagePct,
    source: scene !== "tower"
      ? "非通天塔无图鉴增伤"
      : tuJianArg !== undefined
        ? "手动 --tujian"
        : `${presetName}(idx${String(presetIdx)}) 图鉴Lv.${String(tuJian.level)}×研究54 Lv.${String(tuJian.research)}`
  });
  if (scene === "tower") {
    printTowerLayerTable(save,layer,panel,zhenFa,{reducePct,tuJianArg,wuSongAtkPct,wuSongDmgAdd});
  }
  return report;
}

// 首回合怒气:孙悟空神转职 +25,人皇印开战 +50,门槛 100;不满则首击不是怒气技能.
function printRageCheck (save: SaveBundle,panel: CarryPanel): void {
  const shen = hasShen(save,WU_KONG);
  const renHuangYin = panel.weapon?.entry === "RenHuangYin";
  const sp = SP_OPEN_BATTLE + (shen ? WU_KONG_SHEN_SP : 0) + (renHuangYin ? REN_HUANG_YIN_SP : 0);
  const ok = sp >= SP_RAGE_NEED;
  console.log(
    `\n首回合怒气: 开战 ${String(SP_OPEN_BATTLE)} + 孙悟空神转职 ${shen ? String(WU_KONG_SHEN_SP) : "0"} + ` +
    `人皇印 ${renHuangYin ? String(REN_HUANG_YIN_SP) : "0"} = ${String(sp)} / ${String(SP_MAX)}` +
    `（门槛 ${String(SP_RAGE_NEED)}）${ok ? " → 首回合可放怒气技能" : " → 首击不是怒气技能，下面的怒气倍率不成立"}`
  );
  if (!shen) {console.log("  ⚠ 存档里孙悟空没有神转职技能，下面按神转职口径计算仅作参考");}
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
