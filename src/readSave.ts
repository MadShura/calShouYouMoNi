import {existsSync,readFileSync} from "node:fs";
import {join} from "node:path";

// 默认存档根目录(游戏 SaveInfo 同级)
export const DEFAULT_SAVE_ROOT = String.raw`C:\Users\Administrator\AppData\LocalLow\SkyLight\MoNiShouYou`;

// 单条战斗属性
export interface BattleDataRecorder {
  Base_Value:       number;
  PercentAddition:  number;
  PropertyTypeEnum: number;
}

// 阵营对战管理器
export interface CampData {
  CanOpen:                boolean;
  diKuaiData_Recorders?:  CampTile[];
  EastLingLi:             number;
  Finish:                 boolean;
  First:                  boolean;
  HasOpen:                boolean;
  Jifen_East:             number;
  Jifen_West:             number;
  JifenCulTime:           number;
  OpenGameTime:           number;
  playerZhengDouRecords?: CampPlayerRecord[];
  PlayZhenYing:           number;
  Round:                  number;
  WestLingli:             number;
}

// 阵营里的角色状态
export interface CampPlayerRecord {
  Cha_Cur_Seat: number;
  Cha_ID:       number;
  Cur_HP:       number;
  CurZhengYing: number;
  GongXun:      number;
  PlayerState:  number;
}

// 阵营地块
export interface CampTile {
  ID:             number;
  RemandHP:       number;
  ZhenYingBelong: number;
}

// Cha_Data.Save(主角)
export interface ChaRecord {
  _id:                     number;
  BattleData_Manager?:     {battleData_Recorders_List?: BattleDataRecorder[]};
  CurZhenFa?:              number;
  EquipManager?:           EquipManagerData;
  tuJianData_RecordsList?: TuJianRecord[];
  zhenFaRecorders?:        ZhenFaRecord[];
  ZhenRongManager?:        {ZhenRong?: {ZhenRong?: number[]}};
}

// 命令行参数:--key=value 或 --flag
export type CliArgs = Map<string,string | true>;

// 炼器 / 器鼎
export interface EquipManagerData {
  equip_List?: EquipSlot[];
  LianQiExp:   number;
  LianQiLevel: number;
  QiLu_Level:  number;
}

// 装备强化槽
export interface EquipSlot {
  CurStrength: number;
  EquipType:   number;
}

// Game_RecordData.Save
export interface GameRecord {
  ChouJiangCount?:          number;
  Cur_JiangChiIndex?:       number;
  CurYuLingShiLv?:          number;
  Mark_Manger?:             {markRecorders?: MarkRecorder[]};
  propRecordersList?:       PropCount[];
  ShiLian_Manger?:          {Cur_CengShu?: number; Cur_PiLao?: number};
  YuLingExp?:               number;
  zhenYingZhenDou_Manager?: CampData;
}

// Map_Data.Save(每行一张地图)
export interface MapRecord {
  _id:               number;
  CurRound?:         number;
  MaxRound?:         number;
  shengShou_Record?: {AdditionCur: number; CurStrength: number; special: number};
}

// Mark 计数记录
export interface MarkRecorder {
  Count:     number;
  Mark_Enum: number;
}

// 存档里的道具数量记录
export interface PropCount {
  Nums:   number;
  PropID: number;
}

// 道具定义(Prop_Data.Save 里的 EffectRecoder 决定用途)
export interface PropDefinition {
  effectName?: number;
  params1?:    number;
  params2?:    number;
  propID:      number;
  valueCost:   number;
}

// 一个存档槽读出来的全部数据
export interface SaveBundle {
  cha:       ChaRecord;
  dir:       string;
  game:      GameRecord;
  maps:      MapRecord[];
  props:     Map<number,PropDefinition>;
  yingLings: YingLingRecord[];
}

// 图鉴记录
export interface TuJianRecord {
  EnemyIndex: number;
  Level:      number;
}

// YingLing_Data.Save(每行一个英灵)
export interface YingLingRecord {
  _id:                 number;
  BattleData_Manager?: {battleData_Recorders_List?: BattleDataRecorder[]};
  Cur_Level?:          number;
  Master_ID?:          number;
  Max_Level?:          number;
  YingLing_Index?:     number;
  ZhuanZhiManager?:    {CurStrength: number; CurZhiYe: number};
}

// 阵法记录
export interface ZhenFaRecord {
  JieSuo:   boolean;
  Level:    number;
  ZhenFaID: number;
}

// 取布尔开关
export function argFlag (args: CliArgs,key: string): boolean {
  return args.get(key) === true || argString(args,key) === "1";
}

// 取数字参数
export function argNumber (args: CliArgs,key: string): number | undefined {
  const value = argString(args,key);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// 取字符串参数
export function argString (args: CliArgs,key: string): string | undefined {
  const value = args.get(key);
  return typeof value === "string" ? value : undefined;
}

// C# ToolClass.Cul_Percent_ToInt:四舍五入,远离零
export function culPercentToInt (baseValue: number,percentage: number,reduce: boolean): number {
  const factor = reduce ? 100 - percentage : 100 + percentage;
  const value = baseValue * factor / 100;
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

// 千分位格式化
export function formatNumber (value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  return Math.round(value).toLocaleString("zh-CN");
}

// ToolClass.TranslateNumsToSuoXie:10 万以下直接显示整数,之后按 万/亿/兆/京... 每四位递进
const CN_UNITS = ["","万","亿","兆","京","垓","秭","穰","沟","涧","正","载","极"];

// 输出点格式化(最多 4 位小数,极小的值用科学计数法)
export function formatScore (value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  if (value !== 0 && Math.abs(value) < 0.0001) {
    return value.toExponential(2);
  }
  if (Math.abs(value) >= 100) {
    return formatNumber(value);
  }
  return value.toFixed(4).replace(/0+$/,"")
.replace(/\.$/,"");
}
export function formatSuoXie (value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  const abs = Math.abs(value);
  if (abs < 10_0000) {
    return String(Math.round(value));
  }
  let unit = 0;
  let scaled = abs;
  while (scaled >= 10000 && unit < CN_UNITS.length - 1) {
    scaled /= 10000;
    unit += 1;
  }
  const digits = scaled >= 1000 ? 0 : scaled >= 100 ? 1 : scaled >= 10 ? 2 : 3;
  const text = scaled.toFixed(digits);
  return `${value < 0 ? "-" : ""}${text}${CN_UNITS[unit]}`;
}

// 取 Mark 计数
export function getMarkCount (game: GameRecord,markEnum: number): number {
  const list = game.Mark_Manger?.markRecorders ?? [];
  for (const item of list) {
    if (item.Mark_Enum === markEnum) {
      return item.Count;
    }
  }
  return 0;
}

// 取道具数量
export function getPropNums (game: GameRecord,propID: number): number {
  const list = game.propRecordersList ?? [];
  let total = 0;
  for (const item of list) {
    if (item.PropID === propID) {
      total += item.Nums;
    }
  }
  return total;
}

// 读取一个存档槽的全部数据(只读,不写游戏目录)
export function loadSave (dir: string): SaveBundle {
  const game = readJsonObject<GameRecord>(join(dir,"Game_RecordData.Save"));
  const cha = readJsonObject<ChaRecord>(join(dir,"Cha_Data.Save"));
  const yingLings = existsSync(join(dir,"YingLing_Data.Save"))
    ? readJsonObjects<YingLingRecord>(join(dir,"YingLing_Data.Save"))
    : [];
  const maps = existsSync(join(dir,"Map_Data.Save"))
    ? readJsonObjects<MapRecord>(join(dir,"Map_Data.Save"))
    : [];
  return {cha,dir,game,maps,props: readPropDefinitions(dir),yingLings};
}

// 解析命令行参数
export function parseArgs (argv: string[]): CliArgs {
  const args: CliArgs = new Map();
  for (const raw of argv) {
    if (!raw.startsWith("--")) {
      continue;
    }
    const body = raw.slice(2);
    const eq = body.indexOf("=");
    if (eq === -1) {
      args.set(body,true);
    } else {
      args.set(body.slice(0,eq),body.slice(eq + 1));
    }
  }
  return args;
}

// 解析存档目录:--dir 优先,其次 --save=N
export function resolveSaveDir (args: CliArgs): string {
  const dir = argString(args,"dir");
  if (dir) {
    if (!existsSync(dir)) {
      throw new Error(`存档目录不存在：${dir}`);
    }
    return dir;
  }
  const slot = argNumber(args,"save") ?? 1;
  const saveDir = join(DEFAULT_SAVE_ROOT,`Save_${slot}`);
  if (!existsSync(saveDir)) {
    throw new Error(`存档不存在：${saveDir}（用 --save=N 指定槽位，或 --dir=路径）`);
  }
  return saveDir;
}

// 读取单对象存档
function readJsonObject<T> (file: string): T {
  const objects = readJsonObjects<T>(file);
  const first = objects[0];
  if (first === undefined) {
    throw new Error(`存档为空：${file}`);
  }
  return first;
}

// 读取"每行一个 JSON"的存档文件,自动跳过第一行类名
function readJsonObjects<T> (file: string): T[] {
  const text = readFileSync(file,"utf8").replace(/^\uFEFF/,"");
  const objects: T[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      continue;
    }
    objects.push(JSON.parse(trimmed) as T);
  }
  if (objects.length === 0) {
    const first = text.indexOf("{");
    if (first === -1) {
      throw new Error(`存档内容无法解析：${file}`);
    }
    objects.push(JSON.parse(text.slice(first)) as T);
  }
  return objects;
}

// 解析 Prop_Data.Save 的道具定义
function readPropDefinitions (dir: string): Map<number,PropDefinition> {
  const file = join(dir,"Prop_Data.Save");
  const result = new Map<number,PropDefinition>();
  if (!existsSync(file)) {
    return result;
  }
  for (const raw of readJsonObjects<Record<string,unknown>>(file)) {
    const propID = Number(raw._propID);
    if (!Number.isFinite(propID)) {
      continue;
    }
    const effect = raw.EffectRecoder as Record<string,unknown> | undefined;
    result.set(propID,{
      effectName: effect ? Number(effect.EffectNameEnum) : undefined,
      params1:    effect ? Number(effect.Params_1) : undefined,
      params2:    effect ? Number(effect.Params_2) : undefined,
      propID,
      valueCost:  Number(raw._valueCost ?? 0)
    });
  }
  return result;
}