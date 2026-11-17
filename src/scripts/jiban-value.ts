import {existsSync,mkdirSync,writeFileSync} from "node:fs";
import {dirname,join} from "node:path";
import {argNumber,argString,isArgOn,loadSave,parseArgs,resolveSaveDir} from "../readSave.ts";
import {loadConfig,runMain} from "../tools.ts";
import type {YingLingConfig} from "../tools.ts";
import type {BattleDataRecorder} from "../readSave.ts";

/**
 * 配队输出排名(羁绊 + 15 级御灵装备 + 绝对伤害)
 * 数据来源:
 * - config/yingling.json:每个英灵的羁绊类型(YingLing_SettingData.ZhenRongJiBanTypeEnum)
 * - config/jiban.json:每个羁绊在 2/3/4/5 人时的 Entry 与等级(StreamingAssets/JiBan_Data_Json.txt)
 * - 存档 Cha_Data.Save 的阵型,YingLing_Data.Save 的持有英灵,主角/英灵属性
 * - 御灵装备:Prop_Data_Json.txt(灵牌 100-114,宝石 200-814),YuLing_Equi_LingQi_Data_Config(灵器)
 * 御灵装备按 15 级满级计算(用户口径):
 * - 后羿弓(灵器 #16):生命/攻击/防御 +500000,Entry_HouYiGong Lv.15
 * - 金玉令(灵牌 114):生命/攻击/防御 +500000,且各 +600%
 * - 6 颗宝石(214/314/414/514/714/814):每颗三围 +250000；红暴击+55,蓝命中+55,
 * 绿闪避+55,橙暴伤+200,紫反击+45,黄连击+45
 * 命中口径(用户指定):默认 100 命中,不考虑命中率/闪避判定；
 * 后羿弓 Lv.15 只按伤害 -20%(×0.8)计入.
 * 只统计「直接加伤害」的羁绊(按用户要求,连击/反击/控制/治疗不参与):
 * - 三国群英:伤害% += (100 - 目标血量%) / (4 - 0.5×等级)
 * - 神鬼志异:伤害% += max(0, 我方闪避 - 敌命中) × (0.2 + 0.2×等级)
 * - 万人敌:伤害% += 等级 × 敌方存活人数
 * - 神谋鬼算:暴击伤害 +20×等级
 * - 西行取经:伤害% += max(0, 我方命中 - 敌闪避) × (0.25 + 0.25×等级)
 */
const HERE = import.meta.dirname;

// PropertyTypeEnum
const P = {
  ATK:            0,
  BaoJi:          6,
  BaoJiDamage:    8,
  BaoJiResist:    7,
  DamageAddition: 13,
  DEF:            1,
  FanJi:          10,
  HP:             2,
  IgonoreDEF:     15,
  LianJi:         9,
  MingZhong:      4,
  ShanBi:         5,
  Speed:          3
} as const;
const PROP_COUNT = 18;
const SLOT_COUNT = 5;

// 御灵装备统一按 15 级算
const EQUIP_LEVEL = 15;

// 15 级后羿弓(灵器 #16,lingQiDataSettings[14]):生命/攻击/防御 +500000
const BOW_FLAT = 50_0000;

// 15 级金玉令(灵牌 114):生命/攻击/防御 +500000,且各 +600%
const TOKEN_FLAT = 50_0000;
const TOKEN_PCT = 600;

// 15 级宝石(每颗):生命/攻击/防御 +250000
const GEM_FLAT = 25_0000;

// 6 颗 15 级宝石的颜色词条(Params_1 是 PropertyTypeEnum,Bool_Value=true)
const GEMS: readonly {name: string; prop: number; value: number}[] = [
  {name: "红",prop: P.BaoJi,value: 55},
  {name: "蓝",prop: P.MingZhong,value: 55},
  {name: "绿",prop: P.ShanBi,value: 55},
  {name: "橙",prop: P.BaoJiDamage,value: 200},
  {name: "紫",prop: P.FanJi,value: 45},
  {name: "黄",prop: P.LianJi,value: 45}
];

// 后羿弓 Lv.15:80 - 4×等级 = 20% 伤害降低(剩 80%)；命中率按 100% 口径,不再算转命中
const BOW_HIT_DAMAGE = (100 - (80 - EQUIP_LEVEL * 4)) / 100;

// 羁绊只依赖这几个属性
interface BondContext {
  critMultiplier:   number;
  critRate:         number;
  critValue:        number;
  enemyBaoJiResist: number;
  enemyCount:       number;
  enemyHpPercent:   number;
  enemyMingZhong:   number;
  enemyShanBi:      number;
  mingZhong:        number;
  shanBi:           number;
}

interface ComboResult {
  bondCounts: Map<number,number>;
  bondLevels: Map<number,number>;
  carry?:     {index: number; mode: "怒气" | "普攻"; pct: number};
  combo:      number[];
  damage:     number;
  multiplier: number;
}

interface JiBanConfig {
  id:     number;
  levels: {count: number; entry: number; level: number}[];
  type:   number;
}

interface NamesConfig {
  jiBan:     Record<string,string>;
  maps:      Record<string,string>;
  props:     Record<string,string>;
  shengShou: Record<string,string>;
  yingLing:  Record<string,string>;
}

interface RawStats {
  base: number[];
  pct:  number[];
}

// 一个战斗场景的敌人参数
interface SceneInfo {
  enemyBaoJiResist:  number;
  enemyCount:        number;
  enemyDamageReduce: number;
  enemyDef:          number;
  enemyHpPercent:    number;
  enemyMingZhong:    number;
  enemyShanBi:       number;
  key:               string;
  title:             string;
}

// 羁绊等级:达到哪个 Count 就取那一档(按 ZhenRongJiBanTypeEnum 匹配)
function bondLevel (jiban: JiBanConfig[],bondType: number,count: number): number {
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

// 单个羁绊对期望伤害的倍率(入参是 ZhenRongJiBanTypeEnum:0 三国群英...11 西行取经)
function bondMultiplier (bondType: number,level: number,ctx: BondContext): number {
  if (level <= 0) {
    return 1;
  }
  if (bondType === 0) {
    const gain = Math.trunc((100 - ctx.enemyHpPercent) / (4 - 0.5 * level));
    return 1 + Math.max(0,gain) / 100;
  }
  if (bondType === 11) {
    const gain = Math.max(0,ctx.mingZhong - ctx.enemyShanBi) * (0.25 + 0.25 * level);
    return 1 + gain / 100;
  }
  if (bondType === 4) {
    const gain = Math.max(0,ctx.shanBi - ctx.enemyMingZhong) * (0.2 + 0.2 * level);
    return 1 + gain / 100;
  }
  if (bondType === 5) {
    return 1 + level * ctx.enemyCount / 100;
  }
  if (bondType === 6) {
    const after = ctx.critMultiplier + 20 * level / 100;
    return (1 + ctx.critRate * (after - 1)) / (1 + ctx.critRate * (ctx.critMultiplier - 1));
  }
  return 1;
}
function clamp01 (value: number): number {
  if (value < 0) {
    return 0;
  }
  return Math.min(value,1);
}

// 从有序列表里取 count 个的所有组合(递归,避免深层 for 嵌套触发 max-depth)
function combinationsOf (list: readonly number[],count: number): number[][] {
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

// 组合里的开战增益(武松增伤/加攻；命中按 100% 口径,不再算命中类光环)
function comboSupport (combo: number[]): {atkBuff: number; damageBuff: number} {
  const hasWuSong = combo.includes(6);
  return {
    atkBuff:    hasWuSong ? 20 : 0, // 武松神形态 1011:最高攻 +20% 攻击 3 回合(加到攻击百分比)
    damageBuff: hasWuSong ? 35 : 0 // 武松三技能:最高攻 +35% 增伤 3 回合(加到伤害加成)
  };
}

// Damage_Recorder.CulDamagePercent:攻防比系数
function culDamagePercent (atk: number,def: number): number {
  if (def <= 0) {
    return atk > 0 ? 100 : 50;
  }
  if (atk === def) {
    return 50;
  }
  if (atk > def) {
    if (atk >= 3 * def) {
      return 100;
    }
    return 50 + Math.trunc((atk - def) * 50 / def) * 2;
  }
  if (atk * 3 <= def) {
    return 2;
  }
  return 2 + Math.trunc((atk * 3 - def) * 48 / (def * 2));
}

// Character_Enemy.GetAddition:TrueRound 成长倍率
function enemyAddition (trueRound: number): number {
  if (trueRound <= 10000) {
    return 1;
  }
  const num = Math.min(Math.trunc(trueRound / 10000),200);
  if (trueRound < 20000) {
    return 1 + (trueRound - 10000) / 10000 * 9;
  }
  const low = 10 * 2 ** (num - 2);
  const high = 10 * 2 ** (num - 1);
  const rem = trueRound % 10000;
  return rem === 0 ? low : rem / 10000 * (high - low) + low;
}
function evaluateCombo (
  combo: number[],
  bondOf: Map<number,number[]>,
  jiban: JiBanConfig[],
  ctx: BondContext
): Omit<ComboResult,"carry" | "damage"> {
  const bondCounts = new Map<number,number>();
  for (const index of combo) {
    const bonds = bondOf.get(index);
    if (!bonds) {continue;}
    for (const bond of bonds) {
      bondCounts.set(bond,(bondCounts.get(bond) ?? 0) + 1);
    }
  }
  const bondLevels = new Map<number,number>();
  let multiplier = 1;
  for (const [bondType,count] of bondCounts) {
    const level = bondLevel(jiban,bondType,count);
    bondLevels.set(bondType,level);
    multiplier *= bondMultiplier(bondType,level,ctx);
  }
  return {bondCounts,bondLevels,combo,multiplier};
}

// BattleData_Recorder.GetFinal:百分比属性直接相加,其余走 (base)×(100+%)/100
function finalValue (prop: number,own: RawStats,master: RawStats,percentProps: Set<number>): number {
  const base = (own.base[prop] ?? 0) + (master.base[prop] ?? 0);
  if (percentProps.has(prop)) {
    return Math.max(0,base);
  }
  return Math.round(base * (100 + (own.pct[prop] ?? 0) + (master.pct[prop] ?? 0)) / 100);
}

// 伤害数值格式化:亿 / 万
function formatDamage (value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  if (Math.abs(value) >= 1_0000_0000_0000) {
    return `${(value / 1_0000_0000_0000).toFixed(2)} 万亿`;
  }
  if (Math.abs(value) >= 1_0000_0000) {
    return `${(value / 1_0000_0000).toFixed(2)} 亿`;
  }
  if (Math.abs(value) >= 10000) {
    return `${(value / 10000).toFixed(2)} 万`;
  }
  return Math.round(value).toString();
}
function main (): void {
  const args = parseArgs(process.argv.slice(2));
  if (isArgOn(args,"help")) {
    console.log(
      [
        "用法：pnpm exec tsx src/scripts/jiban-value.ts [参数]",
        "",
        "  --save=1               存档槽位（默认 1）",
        "  --dir=路径             直接指定存档目录",
        "  --scene=both           场景：both=通天塔+试炼（默认）、tower=只算通天塔、shilian=只算试炼、manual=手动",
        "  --round=10000          通天塔层数（默认 10000）",
        "  --ceng=100             试炼层数（默认 100）",
        "  --enemy-def=0          manual 场景的敌方防御",
        "  --enemy-reduce=0       manual 场景的敌方减伤（封顶 80）",
        "  --enemy-hp=100         目标血量百分比（三国群英用，默认满血=0 收益）",
        "  --enemy-count=5        敌方存活人数（万人敌用）",
        "  --enemy-mingzhong=100  敌方命中（神鬼志异用）",
        "  --enemy-shanbi=30      敌方闪避（西行取经用）",
        "  --target-resist=0      manual 场景的敌方抗暴",
        "  --out=路径             结果输出文件（默认 ../output/羁绊排名.md）",
        "  --no-aoe               不要求队伍里有群攻英灵",
        "  --top=20               输出前多少名"
      ].join("\n")
    );
    return;
  }
  const dir = resolveSaveDir(args);
  const save = loadSave(dir);
  const yingLingConfig = loadConfig<YingLingConfig[]>("yingling");
  const jiban = loadConfig<JiBanConfig[]>("jiban");
  const names = loadConfig<NamesConfig>("names");
  const propertyConfig = loadConfig<{percent: number; type: number}[]>("property");
  const mapsConfig = loadConfig<{
    baseRound: number;
    growth:    number;
    mapID:     number;
  }[]>("maps");
  const percentProps = percentPropsOf(propertyConfig);
  const shenTong = loadConfig<{
    effectName: number;
    id:         number;
    maxLevel:   number;
    params1:    number;
    pinzhi:     number;
  }[]>("shentong");
  const shenTongBase: Record<number,number> = {1: 20,2: 50,3: 150,4: 500,5: 1000,6: 1500};
  const shenTongCostOf = (item: {maxLevel: number; pinzhi: number}): number => (shenTongBase[item.pinzhi] ?? 0) * item.maxLevel;
  const shenTongTotal = shenTong.reduce((sum,item) => sum + shenTongCostOf(item),0);

  // 怒气上限 +100 的神通(EntryNameEnum 40 = ShenTong_6)会让怒气技门槛从 100 变成 200
  const maxSpShenTong = shenTong.find(
    item => item.effectName === 1 && item.params1 === 40
  );
  const shenTongWithoutMaxSp =
    shenTongTotal - (maxSpShenTong ? shenTongCostOf(maxSpShenTong) : 0);

  // 持有英灵:Master_ID = 1
  const owned = new Set<number>();
  for (const record of save.yingLings) {
    if (record.Master_ID !== 1) {
      continue;
    }
    const index = record.YingLing_Index ?? record._id - 1000;
    if (index > 0) {
      owned.add(index);
    }
  }
  if (owned.size < SLOT_COUNT) {
    throw new Error(`存档里属于主角的英灵只有 ${String(owned.size)} 个，不够 ${String(SLOT_COUNT)} 个上阵`);
  }
  const bondOf = new Map<number,number[]>();
  for (const config of yingLingConfig) {
    bondOf.set(config.index,config.bonds);
  }

  // 我方属性:主角 + 攻击最高的英灵；15 级御灵装备算在这名英灵身上
  const master = rawFromBattleData(save.cha.BattleData_Manager?.battleData_Recorders_List);
  let unitRaw = rawFromBattleData();
  let maxAtk = -1;
  for (const record of save.yingLings) {
    if (record.Master_ID !== 1) {
      continue;
    }
    const raw = rawFromBattleData(record.BattleData_Manager?.battleData_Recorders_List);
    const atk = finalValue(P.ATK,raw,master,percentProps);
    if (!(atk > maxAtk)) {
      continue;
    }
    maxAtk = atk;
    unitRaw = raw;
  }
  unitRaw = withEquipment(unitRaw);
  const critValue = finalValue(P.BaoJi,unitRaw,master,percentProps);
  const critMultiplier = finalValue(P.BaoJiDamage,unitRaw,master,percentProps) / 100;
  const mingZhong = finalValue(P.MingZhong,unitRaw,master,percentProps);
  const shanBi = finalValue(P.ShanBi,unitRaw,master,percentProps);
  const ignoreDef = finalValue(P.IgonoreDEF,unitRaw,master,percentProps);
  const damageAddition = finalValue(P.DamageAddition,unitRaw,master,percentProps);
  const atkBase = (unitRaw.base[P.ATK] ?? 0) + (master.base[P.ATK] ?? 0);
  const atkPct = (unitRaw.pct[P.ATK] ?? 0) + (master.pct[P.ATK] ?? 0);

  // 阵法 1:战斗开始时给全场最高攻单位加 阵法等级% 的攻击(Entry_ZhenFa_1)
  const zhenFaId = save.cha.CurZhenFa ?? 0;
  const zhenFaLevel =
    save.cha.zhenFaRecorders?.find(item => item.ZhenFaID === zhenFaId)?.Level ?? 0;
  const zhenFaAtkPct = zhenFaId === 1 ? zhenFaLevel : 0;
  const baseAtk = Math.round(atkBase * (100 + atkPct) / 100);
  const atkWithZhenFa = baseAtk + Math.trunc(baseAtk * zhenFaAtkPct / 100);
  const ownedList = [...owned].toSorted((left,right) => left - right);

  // 群攻/怒气判定:普攻全体直接能当输出；怒气全体要看全队开局怒气(初始30,怒气技需要100)
  const skillTexts = loadConfig<Record<string,string>>("skill-text");
  interface SkillClass {
    fill:        boolean;
    normalAoe:   boolean;
    pct:         number;
    rageAoe:     boolean;
    selfRoundSp: number;
    teamRoundSp: number;
    teamStartSp: number;
  }
  const skillClassCache = new Map<number,SkillClass>();
  const classOf = (skill: number): SkillClass => {
    const cached = skillClassCache.get(skill);
    if (cached) {
      return cached;
    }
    const text = skillTexts[String(skill)] ?? "";
    const isHitsAll = (/(全部|全体|所有)敌人/).test(text) && text.includes("造成");
    const isNormal = text.includes("普攻") || text.includes("普通攻击");
    const isRage = text.includes("怒气") || !isNormal && isHitsAll;

    // 「变更为全体」这类描述没有"造成",单独识别
    const isNormalAoe = isHitsAll && isNormal || text.includes("普通攻击变为全体攻击");
    const isRageAoe =
      (isHitsAll && isRage && !isNormal || (/怒气技(?:能)?变为全体攻击/).test(text)) && !isNormalAoe;
    const teamStartMatch = (/进入战斗时[^。]*?友军\+(\d+)怒气/).exec(text);
    const teamRoundMatch = (/回合开始时我方全员恢复(\d+)怒气/).exec(text);
    const selfRoundMatch =
      (/额外(?:恢复|获得)(\d+)点?怒气/).exec(text) ?? (/每回合开始时回复(\d+)点怒气/).exec(text);
    const isFill =
      (/进入战斗[^。]*(满额怒气|满怒气)|怒气上限\+500[^。]*满怒气|怒气将不会被消耗/).test(text);
    const pctMatch =
      (/造成(\d+)%/).exec(text) ??
      (/(\d+)%攻击力/).exec(text) ??
      (/伤害提升为(\d+)%/).exec(text);
    const pct = pctMatch?.[1] ? Number(pctMatch[1]) : 0;
    const result: SkillClass = {
      fill:        isFill,
      normalAoe:   isNormalAoe,
      pct,
      rageAoe:     isRageAoe,
      selfRoundSp: selfRoundMatch?.[1] ? Number(selfRoundMatch[1]) : 0,
      teamRoundSp: teamRoundMatch?.[1] ? Number(teamRoundMatch[1]) : 0,
      teamStartSp: teamStartMatch?.[1] ? Number(teamStartMatch[1]) : 0
    };
    skillClassCache.set(skill,result);
    return result;
  };
  interface CarryInfo {
    fill:        boolean;
    normalAoe:   boolean;
    normalPct:   number;
    rageAoe:     boolean;
    ragePct:     number;
    selfRoundSp: number;
    teamRoundSp: number;
    teamStartSp: number;
  }
  const carryCache = new Map<number,CarryInfo>();
  const carryOf = (index: number): CarryInfo => {
    const cached = carryCache.get(index);
    if (cached) {
      return cached;
    }
    const config = yingLingConfig.find(item => item.index === index);
    const skills = [
      ...config?.skills ?? [],
      config?.skillMo ?? 0,
      config?.skillShen ?? 0
    ].filter(skill => skill > 0);
    const info: CarryInfo = {
      fill:        false,
      normalAoe:   false,
      normalPct:   0,
      rageAoe:     false,
      ragePct:     0,
      selfRoundSp: 0,
      teamRoundSp: 0,
      teamStartSp: 0
    };
    for (const skill of skills) {
      const item = classOf(skill);
      info.normalAoe ||= item.normalAoe;
      info.rageAoe ||= item.rageAoe;
      info.fill ||= item.fill;
      if (item.normalAoe) {
        info.normalPct = Math.max(info.normalPct,item.pct > 0 ? item.pct : 100);
      }
      if (item.rageAoe) {
        info.ragePct = Math.max(info.ragePct,item.pct > 0 ? item.pct : 100);
      }

      // 同一类加成来自互斥的升仙形态,取最大值而不是累加
      info.teamStartSp = Math.max(info.teamStartSp,item.teamStartSp);
      info.teamRoundSp = Math.max(info.teamRoundSp,item.teamRoundSp);
      info.selfRoundSp = Math.max(info.selfRoundSp,item.selfRoundSp);
    }
    carryCache.set(index,info);
    return info;
  };

  // 组合里能打全体的最佳输出位:普攻全体直接可用；怒气全体需要开局怒 ≥100
  const bestCarryOf = (
    combo: number[]
  ): {index: number; mode: "怒气" | "普攻"; pct: number} | undefined => {
    const teamStart = Math.max(0,...combo.map(index => carryOf(index).teamStartSp));
    const teamRound = Math.max(0,...combo.map(index => carryOf(index).teamRoundSp));
    let best: {index: number; mode: "怒气" | "普攻"; pct: number} | undefined;
    for (const index of combo) {
      const info = carryOf(index);
      if (info.normalAoe) {
        const candidate = {index,mode: "普攻" as const,pct: info.normalPct};
        if (!best || candidate.pct > best.pct) {
          best = candidate;
        }
      }
      if (!info.rageAoe) {continue;}
      const startSp = info.fill ? 100 : 30 + teamStart + teamRound + info.selfRoundSp;
      if (startSp < 100) {continue;}
      const candidate = {index,mode: "怒气" as const,pct: info.ragePct};
      if (!best || candidate.pct > best.pct) {
        best = candidate;
      }
    }
    return best;
  };

  // 场景:通天塔只算 5 的倍数层,只算首领；试炼敌人按 LevelToTargetLevel 重写属性
  const sceneArg = argString(args,"scene") ?? "both";
  const scenes: SceneInfo[] = [];
  if (sceneArg === "tower" || sceneArg === "both") {
    const round = argNumber(args,"round") ?? 10000;
    const mapConfig = mapsConfig.find(item => item.mapID === 5);
    if (mapConfig) {
      const trueRound = round * mapConfig.growth + mapConfig.baseRound;
      const value =
        Math.min(Math.trunc(trueRound / 100),70) + Math.max(0,Math.trunc((trueRound - 11000) / 1000));
      scenes.push({
        enemyBaoJiResist:  value,
        enemyCount:        5,
        enemyDamageReduce: 0,
        enemyDef:          towerEnemyDef(round,trueRound),
        enemyHpPercent:    argNumber(args,"enemy-hp") ?? 100,
        enemyMingZhong:    value,
        enemyShanBi:       value,
        key:               "tower",
        title:             `通天塔第 ${String(round)} 层（TrueRound=${String(trueRound)}）`
      });
    }
  }
  if (sceneArg === "shilian" || sceneArg === "both") {
    const ceng = argNumber(args,"ceng") ?? 100;
    scenes.push({
      enemyBaoJiResist:  100 + ceng * 3,
      enemyCount:        5,
      enemyDamageReduce: 100 + ceng * 3,
      enemyDef:          shiLianEnemyDef(ceng),
      enemyHpPercent:    argNumber(args,"enemy-hp") ?? 100,
      enemyMingZhong:    100 + ceng * 3,
      enemyShanBi:       100 + ceng * 3,
      key:               "shilian",
      title:             `试炼第 ${String(ceng)} 层`
    });
  }
  if (sceneArg === "manual") {
    const critResist = argNumber(args,"target-resist") ?? 0;
    scenes.push({
      enemyBaoJiResist:  critResist,
      enemyCount:        argNumber(args,"enemy-count") ?? 5,
      enemyDamageReduce: argNumber(args,"enemy-reduce") ?? 0,
      enemyDef:          argNumber(args,"enemy-def") ?? 0,
      enemyHpPercent:    argNumber(args,"enemy-hp") ?? 100,
      enemyMingZhong:    argNumber(args,"enemy-mingzhong") ?? 100,
      enemyShanBi:       argNumber(args,"enemy-shanbi") ?? 30,
      key:               "manual",
      title:             "手动场景"
    });
  } else if (scenes.length === 0) {
    throw new Error(`未知场景：${sceneArg}（可用 tower / shilian / both / manual）`);
  }
  const contextOf = (scene: SceneInfo): BondContext => ({
    critMultiplier,
    critRate:         clamp01((critValue - scene.enemyBaoJiResist + 1) / 101),
    critValue,
    enemyBaoJiResist: scene.enemyBaoJiResist,
    enemyCount:       scene.enemyCount,
    enemyHpPercent:   scene.enemyHpPercent,
    enemyMingZhong:   scene.enemyMingZhong,
    enemyShanBi:      scene.enemyShanBi,
    mingZhong,
    shanBi
  });
  const isRequireAoe = !isArgOn(args,"no-aoe");
  const rankScene = (scene: SceneInfo): {ctx: BondContext; results: ComboResult[]} => {
    const ctx = contextOf(scene);
    const results: ComboResult[] = [];
    for (const combo of combinationsOf(ownedList,SLOT_COUNT)) {
      const carry = bestCarryOf(combo);
      if (isRequireAoe && !carry) {
        continue;
      }
      const evaluated = evaluateCombo(combo,bondOf,jiban,ctx);
      const support = comboSupport(combo);

      // 武松 +20% 攻击是加 PercentAddition,不是乘 1.2
      const atk = Math.round(atkBase * (100 + atkPct + support.atkBuff) / 100);
      const atkWithSkill = atk + Math.trunc(atk * zhenFaAtkPct / 100);
      const defEff = Math.max(1,scene.enemyDef - ignoreDef);
      const k = culDamagePercent(atkWithSkill,defEff);
      const baseDamage = Math.max(1,atkWithSkill * k / 100);
      const damage =
        baseDamage *
        withBowHit() *
        (1 + ctx.critRate * (critMultiplier - 1)) *
        (1 + (damageAddition + support.damageBuff) / 100) *
        evaluated.multiplier *
        (1 - Math.min(scene.enemyDamageReduce,80) / 100) *
        ((carry?.pct ?? 0) / 100);
      results.push({...evaluated,carry,damage});
    }
    results.sort((left,right) => right.damage - left.damage);
    return {ctx,results};
  };
  const sceneRanks = scenes.map(scene => ({scene,...rankScene(scene)}));
  const first = sceneRanks[0];
  if (!first) {
    throw new Error("没有可计算的场景");
  }
  const currentZhenRong = save.cha.ZhenRongManager?.ZhenRong?.ZhenRong ?? [];
  const currentCombo = currentZhenRong.filter(index => index > 0).toSorted((left,right) => left - right);
  const currentResult =
    currentCombo.length === SLOT_COUNT
      ? evaluateCombo(currentCombo,bondOf,jiban,first.ctx)
      : undefined;
  const currentKey = currentCombo.join(",");
  const bondName = (bondType: number): string => names.jiBan[String(bondType + 1)] ?? `羁绊${String(bondType + 1)}`;
  const yingLingName = (index: number): string => names.yingLing[String(index)] ?? `英灵${String(index)}`;
  const describe = (result: Pick<ComboResult,"bondCounts" | "bondLevels">): string => {
    const parts: string[] = [];
    const sortedBonds = [...result.bondCounts].toSorted((left,right) => left[0] - right[0]);
    for (const [bondId,count] of sortedBonds) {
      const level = result.bondLevels.get(bondId) ?? 0;
      parts.push(`${bondName(bondId)}×${String(count)}(Lv.${String(level)})`);
    }
    return parts.length > 0 ? parts.join(" ") : "无羁绊";
  };
  const equipmentText =
    `15 级后羿弓（+${String(BOW_FLAT)} 三围）｜15 级金玉令（+${String(TOKEN_FLAT)} 三围、+${String(TOKEN_PCT)}% 三围）｜` +
    `6 颗 15 级宝石（+${String(GEM_FLAT * GEMS.length)} 三围、${GEMS.map(gem => `${gem.name}${String(gem.value)}`).join("/")}）`;
  const lines: string[] = [
    "=== 配队输出排名（15 级御灵装备 + 两场景每击伤害）===","说明：本文件按存档面板计算，未含威慑/魅惑/流血/怯懦等负面层数联动；全量英灵组合排名见 output/输出英灵排名.md",`存档：${save.dir}`,`装备：${equipmentText}`,`      后羿弓 Lv.${String(EQUIP_LEVEL)}：命中按 100% 口径，伤害 ×${BOW_HIT_DAMAGE.toFixed(2)}`,`我方（主角+最高攻英灵）：攻击 ${formatDamage(baseAtk)}${zhenFaAtkPct > 0 ? `（阵法 ${String(zhenFaId)} Lv.${String(zhenFaLevel)} → ${formatDamage(atkWithZhenFa)}）` : ""}｜穿透 ${formatDamage(ignoreDef)}｜命中 ${String(mingZhong)}｜闪避 ${String(shanBi)}｜暴击 ${String(critValue)}｜暴伤 ${(critMultiplier * 100).toFixed(0)}%｜伤害加成 ${String(damageAddition)}%`,`持有英灵：${String(ownedList.length)} 个`,`初始怒气 30 / 上限 101；神通 ${String(shenTong.length)} 个全点满 ${String(shenTongTotal)} 卷轴；怒气输出需放弃 #${String(maxSpShenTong?.id ?? "?")}（怒气上限 +100）→ ${String(shenTong.length - 1)} 个共 ${String(shenTongWithoutMaxSp)} 卷轴（未计折扣）`,"","--- 各羁绊单独收益（按 5 人满羁绊算，取第一个场景）---"
];
  for (const config of jiban) {
    const maxLevel = bondLevel(jiban,config.type,SLOT_COUNT);
    const single = bondMultiplier(config.type,maxLevel,first.ctx);
    const tag = single > 1.0001 ? `×${single.toFixed(3)}` : "不计入输出";
    lines.push(`${bondName(config.type)}（类型 ${String(config.type)}）：5 人 Lv.${String(maxLevel)} → ${tag}`);
  }
  lines.push("");
  if (currentResult) {
    const currentCarry = bestCarryOf(currentCombo);
    lines.push("--- 当前阵型 ---",`[${currentCombo.join(",")}] ${currentCombo.map(index => yingLingName(index)).join("、")}：${describe(currentResult)}`);
    for (const {results,scene} of sceneRanks) {
      const rank = results.findIndex(item => item.combo.join(",") === currentKey) + 1;
      const item = results[rank - 1];
      lines.push(
        `  ${scene.title}：${item ? `每击 ${formatDamage(item.damage)}，排第 ${String(rank)} 名` : "没有可用的全体输出位或未进榜"}${currentCarry ? `（输出位 ${yingLingName(currentCarry.index)}，${currentCarry.mode}${String(currentCarry.pct)}%）` : ""}`
      );
    }
    lines.push("");
  }
  const top = argNumber(args,"top") ?? 20;
  for (const {ctx,results,scene} of sceneRanks) {
    lines.push(`--- ${scene.title} ---`,`敌人：命中/闪避/抗暴 ${String(scene.enemyMingZhong)}/${String(scene.enemyShanBi)}/${String(scene.enemyBaoJiResist)}｜防御 ${formatDamage(scene.enemyDef)}｜减伤 ${String(Math.min(scene.enemyDamageReduce,80))}%｜一波 ${String(scene.enemyCount)} 人`,`命中口径：100%｜后羿弓伤害 ×${BOW_HIT_DAMAGE.toFixed(2)}｜暴击率 ${(ctx.critRate * 100).toFixed(1)}%｜候选组合 ${String(results.length)} 种`);
    for (const [index,result] of results.slice(0,top).entries()) {
      const carryText = result.carry
        ? `${yingLingName(result.carry.index)}(${result.carry.mode}${String(result.carry.pct)}%)`
        : "无输出位";
      lines.push(
        `${String(index + 1).padStart(2," ")}. 每击 ${formatDamage(result.damage)}｜羁绊 ×${result.multiplier.toFixed(3)}｜输出 ${carryText}  [${result.combo.join(",")}] ${describe(result)}`,
       `     ${result.combo.map(yingLingName).join("、")}`);
    }
    lines.push("");
  }
  lines.push("说明：","1、每击伤害 = 攻击 × 攻防系数 / 100 × 命中系数 × 暴击期望 × 伤害加成 × 羁绊倍率 × 技能倍率 × (1-减伤)。","2、御灵装备按 15 级后羿弓 + 15 级金玉令 + 6 颗 15 级宝石，全部加在“主角+最高攻英灵”这名输出位身上。","3、命中按默认 100% 口径，只把后羿弓的伤害 ×0.8 计入；命中/闪避类光环不再参与计算。","4、武松 +35 增伤加到“伤害加成”，+20% 攻击加到“攻击百分比”，都只对输出位生效。","5、连击/反击/流血/控制/治疗类羁绊按你的要求不计入。");
  const text = lines.join("\n");
  const outPath = argString(args,"out") ?? join(HERE,"..","output","羁绊排名.md");
  if (!existsSync(dirname(outPath))) {
    mkdirSync(dirname(outPath),{recursive: true});
  }
  writeFileSync(outPath,`${text}\n`,"utf8");
  console.log(text);
  console.log(`\n结果已写入：${outPath}`);
}

// 属性是否属于百分比类(property.json 里的 Percent 标记)
function percentPropsOf (propertyConfig: {percent: number; type: number}[]): Set<number> {
  return new Set(propertyConfig.filter(item => item.percent === 1).map(item => item.type));
}
function rawFromBattleData (list?: BattleDataRecorder[]): RawStats {
  const raw: RawStats = {
    base: Array.from({length: PROP_COUNT},() => 0),
    pct:  Array.from({length: PROP_COUNT},() => 0)
  };
  if (list !== undefined) {
    for (const item of list) {
      if (item.PropertyTypeEnum < 0 || item.PropertyTypeEnum >= PROP_COUNT) {
        continue;
      }
      raw.base[item.PropertyTypeEnum] = item.Base_Value;
      raw.pct[item.PropertyTypeEnum] = item.PercentAddition;
    }
  }
  return raw;
}

// CharacterHelper.GetRoundBaseValue:按层数算的敌人基础值
function roundBaseValue (level: number): number {
  const hundred = Math.trunc(level / 100);
  return (hundred + 1) * 30 * level / 2 + (hundred + 1) * 30 * (level % 100);
}

/**
 * 试炼敌人(Character_YingLing.LevelToTargetLevel)的防御.
 * 目标等级 = 10000 + (层数-1)×250×(层数/10+1),升级成长每级 +15 防御,
 * 防御 PercentAddition = 10000 + 层数×500.基础按初始 400 起算(实际取玩家自己的英灵,
 * 但升级成长项占 99.9% 以上,基础差异小于 0.1%).
 * @param ceng 试炼层数.
 * @returns number.
 */
function shiLianEnemyDef (ceng: number): number {
  const targetLevel = 10000 + (ceng - 1) * 250 * (Math.trunc(ceng / 10) + 1);
  let totalBase = 0;
  for (let level = 1; level < targetLevel; level += 1) {
    totalBase += Math.trunc(level / 50) + 1;
  }
  return (400 + 15 * totalBase) * (100 + 10000 + ceng * 500) / 100;
}

// 通天塔敌人(Character_Enemy)的防御:基础值 × GetAddition,再走 RefineProperty
function towerEnemyDef (level: number,trueRound: number): number {
  const def = roundBaseValue(level) * enemyAddition(trueRound);
  const refine = 1 + Math.trunc(trueRound / 500);
  return def + def * 2 * refine / 100;
}

/**
 * 命中口径(用户指定):默认 100 命中,不考虑命中率/闪避判定；
 * 后羿弓 Lv.15 只按伤害 ×0.8 计入.
 * @returns number.
 */
function withBowHit (): number {
  return BOW_HIT_DAMAGE;
}

/**
 * 把 15 级御灵装备(后羿弓 + 金玉令 + 6 颗宝石)加到英灵属性上.
 * BattleData_Recorder.ChangeValue:百分比属性一律加 Base_Value；其它属性 percent 时加 PercentAddition.
 * @param raw 基础属性面板.
 * @returns RawStats.
 */
function withEquipment (raw: RawStats): RawStats {
  const base = [...raw.base];
  const pct = [...raw.pct];
  const flat = BOW_FLAT + TOKEN_FLAT + GEM_FLAT * GEMS.length;
  base[P.ATK] = (base[P.ATK] ?? 0) + flat;
  base[P.DEF] = (base[P.DEF] ?? 0) + flat;
  base[P.HP] = (base[P.HP] ?? 0) + flat;
  pct[P.ATK] = (pct[P.ATK] ?? 0) + TOKEN_PCT;
  pct[P.DEF] = (pct[P.DEF] ?? 0) + TOKEN_PCT;
  pct[P.HP] = (pct[P.HP] ?? 0) + TOKEN_PCT;
  for (const gem of GEMS) {
    base[gem.prop] = (base[gem.prop] ?? 0) + gem.value;
  }
  return {base,pct};
}
runMain(main);