 import {existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {dirname,join} from "node:path";
import {argString,formatSuoXie,parseArgs} from "../readSave.ts";
import {runMain} from "../tools.ts";
import {towerAddition} from "./game-formulas.ts";

/**
 * 三个场景的敌人属性(全部来自反编译).
 * - 通天塔:MapRecorder.GetEnemy_Single → new Character_Enemy(品质, GetTrueRound(), 预设, 地图, CurRound)
 * _level = 层数×16+1500,True_Round = 层数;RefineProperty 用 True_Round 算命中/闪避/速度
 * - 试炼:ShiLian_Manger.GetCurCengShuYingLinglist → Character_YingLing.LevelToTargetLevel
 * - 终局:ZhongJu_Config_Data.BattleData_Manager(config/zhongju.json)
 * 命中率:MingZhong_Recorder.Final_MZ = 100 + 命中 - 闪避 + MZ_Addition
 * 判定 Random.Range(0,101) <= Final_MZ,所以命中率 = clamp((Final_MZ+1)/101, 0, 1)
 */
const HERE = import.meta.dirname;
const CONFIG_DIR = join(HERE,"..","config");
const OUT_DIR = join(HERE,"..","output");
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
export interface ZhongJuEnemy extends EnemyStats {
  additionEffect: number;
  bossID:         number[];
  tiaoZhanID:     number;
}
interface PropertySetting {
  percent: number;
  type:    number;
}

interface ZhongJuRecord {
  additionEffect: number;
  bossID:         number[];
  stats:          {base: number; percent: number; property: number}[];
  tiaoZhanID:     number;
}
const propertySettings = JSON.parse(
  readFileSync(join(CONFIG_DIR,"property.json"),"utf8")
) as PropertySetting[];
const zhongJuRecords = JSON.parse(
  readFileSync(join(CONFIG_DIR,"zhongju.json"),"utf8")
) as ZhongJuRecord[];

/**
 * 命中率.源码:MingZhong_Recorder.Final_MZ = 100 + 命中 - 闪避 + MZ_Addition,
 * 判定 Random.Range(0,101) <= Final_MZ,所以命中率是 (Final_MZ+1)/101,上限 100%.
 * floor 是 MZ_Addition 形成的下限(红拂女神转职:Final_MZ 至少 65).
 * @param attackerHit 攻击方命中.
 * @param defenderDodge 防守方闪避.
 * @param floor 命中下限.
 * @returns number.
 */
export function hitRate (
  attackerHit: number,
  defenderDodge: number,
  floor = -Infinity
): number {
  const finalMz = Math.max(100 + attackerHit - defenderDodge,floor);
  return Math.max(0,Math.min(1,(finalMz + 1) / 101));
}

// 通天塔某一层的敌人属性.品质:1 小怪 / 2 精英 / 3 首领
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
    damageReduce: stat,
    def:          Math.round(roundBase * addition * (100 + 2 * refine) / 100),
    dodge:        stat,
    hit:          stat,
    hp:           (8 * roundBase * pinzhi + 100) * addition * (100 + 8 * refine) / 100,
    speed:        26 + pinzhi + 1 + hundred + capped
  };
}

// 试炼某一层的敌人属性.LevelToTargetLevel 把命中/闪避/暴击/抗暴/暴伤/连击/反击/伤害加成/减伤/幸运都设成 100+层数×3
export function trialEnemy (layer: number): EnemyStats {
  const stat = 100 + layer * 3;
  return {
    crit:         stat,
    critResist:   stat,
    damageReduce: stat,
    def:          trialEnemyDef(layer),
    dodge:        stat,
    hit:          stat,
    hp:           trialEnemyHp(layer),
    speed:        Math.trunc(layer * 35 * (150 + layer) / 100)
  };
}

// 试炼敌人防御:LevelToTargetLevel → (400 + 15·GetLevel) × 601
export function trialEnemyDef (layer: number): number {
  return (400 + 15 * trialGetLevel(layer)) * 601;
}
export function trialEnemyHp (layer: number): number {
  const base = trialBaseHp(layer);
  const percent = 100_0000 + layer * 10000;
  return base * (100 + percent) / 100;
}

// 终局:percent=true 的属性直接取 Base,percent=false 的属性取 Base×(100+Percent)/100
function propertyValue (record: ZhongJuRecord,property: number): number {
  const entry = record.stats.find(item => item.property === property);
  if (!entry) {
    return 0;
  }
  const isPercent = propertySettings.find(item => item.type === property)?.percent === 1;
  return isPercent
    ? Math.round(entry.base)
    : Math.trunc(entry.base * (100 + entry.percent) / 100);
}

// Character_Enemy.GetAddition:按 True_Round(层数)算 HP/ATK/DEF 的额外倍率
// 试炼敌人 HP:LevelToTargetLevel 把 HP.PercentAddition 设为 1000000+层数×10000;
// GetFinalValue(HP)=Base·(100+Percent)/100,Base=模板英灵升到 GetLevel() 的累计 HP(每级 225·(L/50+1),可解析求和)
function trialBaseHp (ceng: number): number {
  const N = trialGetLevel(ceng);
  const m = Math.trunc(N / 50);
  const sumFloor = 50 * (m - 1) * m / 2 + m * (N - 50 * m + 1); // Σ_{L=1..N} floor(L/50)
  return 225 * (N + sumFloor);
}

// 试炼敌人 GetLevel():ShiLian_Manger.GetLevel = 10000+(层数-1)·250·(层数/10+1)
function trialGetLevel (ceng: number): number {
  const num = Math.trunc(ceng / 10) + 1;
  return 10000 + (ceng - 1) * 250 * num;
}
export const ZHONG_JU: readonly ZhongJuEnemy[] = zhongJuRecords.map(record => ({
  additionEffect: record.additionEffect,
  bossID:         record.bossID,
  crit:           propertyValue(record,6),
  critResist:     propertyValue(record,7),
  damageReduce:   propertyValue(record,14),
  def:            propertyValue(record,1),
  dodge:          propertyValue(record,5),
  hit:            propertyValue(record,4),
  hp:             propertyValue(record,2),
  speed:          propertyValue(record,3),
  tiaoZhanID:     record.tiaoZhanID
}));
export const TRIAL_ENEMY_100 = trialEnemy(100);
export const TOWER_ENEMY_10000 = towerEnemy(10000);
type Scene = "tower" | "trial" | "zhongju";
const SCENE_ALIAS = new Map<string,Scene>([
  ["tower","tower"],["trial","trial"],["zhongju","zhongju"],
  ["终","zhongju"],["终局","zhongju"],["试","trial"],["试炼","trial"],["通","tower"],["通天塔","tower"]
]);
const SCENE_DEFAULT_LEVEL: Record<Scene,number> = {tower: 10000,trial: 100,zhongju: 0};
function main (): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.get("help") === true) {
    console.log(
      [
        "用法：pnpm enemy [场景] [层数...] [参数]",
        "",
        "  通 1w            通天塔 1 万层（首领，品质 3）",
        "  通 100 200       通天塔 100 / 200 层",
        "  试 1.5w          试炼 1.5 万层",
        "  终               终局全部挑战（不需要层数）",
        "  不带场景          输出完整表并写入 ../output/敌人属性.md",
        "  --out=路径        指定输出文件（默认 ../output/敌人属性.md，仅不带场景时写）"
      ].join("\n")
    );
    return;
  }
  const positionals = process.argv.slice(2).filter(item => !item.startsWith("--"));
  const sceneText = positionals[0];
  const scene = sceneText === undefined ? undefined : SCENE_ALIAS.get(sceneText);
  if (sceneText !== undefined && scene === undefined) {
    throw new Error(`未知场景：${sceneText}（可用 通 / 终 / 试）`);
  }
  const levels = positionals.slice(1).map(value => parseLevel(value));
  const lines: string[] = ["=== 敌人属性（全部按反编译公式计算）===","","命中率公式：Final_MZ = 100 + 我方命中 - 敌闪避；命中率 = (Final_MZ+1)/101，封顶 100%",""];
  if (scene === undefined) {
    lines.push(...sceneLines("trial",Array.from({length: 10},(_,index) => (index + 1) * 100)),"",...sceneLines("tower",Array.from({length: 10},(_,index) => (index + 1) * 10000)),"",...sceneLines("zhongju",[]),"","说明：","1、通天塔 `Character_Enemy` 的构造参数是 `(品质, GetTrueRound(), 预设, 地图, CurRound)`，所以 `True_Round` = 层数；命中/闪避 = `min(层数/100,70) + max(0,(层数-11000)/1000)`，速度 = `26+品质+1+层数/100+min(层数/100,70)`。",`2、试炼按 \`LevelToTargetLevel(层数)\`：命中/闪避/暴击/抗暴 = \`100+层数×3\`，速度 = \`层数×35×(150+层数)/100\`；100 层命中/闪避 ${String(TRIAL_ENEMY_100.dodge)}、速度 ${String(TRIAL_ENEMY_100.speed)}。`,"3、终局按 `ZhongJu_Config_Data.BattleData_Manager`：`percent=true` 的属性直接取 Base，`percent=false` 的属性取 `Base×(100+Percent)/100`。","4、红拂女神转职给全队 `Final_MZ >= 65` 的下限，所以命中率最低 65/101 ≈ 65.3%。");
  } else {
    const queryLevels = levels.length > 0 ? levels : [SCENE_DEFAULT_LEVEL[scene]];
    lines.push(...sceneLines(scene,queryLevels));
  }
  const text = lines.join("\n");
  const outPath = argString(args,"out") ?? (scene === undefined ? join(OUT_DIR,"敌人属性.md") : undefined);
  if (outPath !== undefined) {
    if (!existsSync(dirname(outPath))) {
      mkdirSync(dirname(outPath),{recursive: true});
    }
    writeFileSync(outPath,`${text}\n`,"utf8");
  }
  console.log(text);
  if (outPath !== undefined) {
    console.log(`\n结果已写入：${outPath}`);
  }
}

// 1w / 1.5w / 100 → 层数
function parseLevel (text: string): number {
  const matched = (/^(\d+(?:\.\d+)?)([wW万]?)$/).exec(text);
  if (!matched?.[1]) {
    throw new Error(`层数写法不对：${text}（可用 100 / 1w / 1.5w）`);
  }
  const level = Math.round(Number(matched[1]) * (matched[2] ? 10000 : 1));
  if (!Number.isFinite(level) || level < 1) {
    throw new Error(`层数必须大于 0：${text}`);
  }
  return level;
}
function sceneLines (scene: Scene,levels: readonly number[]): string[] {
  if (scene === "zhongju") {
    const rows = [" 终局 ","| 挑战 | BossID | 命中 | 闪避 | 暴击 | 抗暴 | 速度 | 减伤(封顶80) |"];
    for (const enemy of ZHONG_JU) {
      rows.push(
        `| ${String(enemy.tiaoZhanID)} | ${enemy.bossID.join("/")} | ${formatSuoXie(enemy.hit)} | ${formatSuoXie(enemy.dodge)} | ${formatSuoXie(enemy.crit)} | ${formatSuoXie(enemy.critResist)} | ${formatSuoXie(enemy.speed)} | ${formatSuoXie(enemy.damageReduce)} |`
      );
    }
    return rows;
  }
  const isTower = scene === "tower";
  const rows = [
    isTower ? " 通天塔（首领，品质 3）" : " 试炼 ",
    "  层数   命中   闪避   暴击   抗暴   速度     减伤(封顶80)  "
  ];
  for (const level of levels) {
    const enemy = isTower ? towerEnemy(level) : trialEnemy(level);
    rows.push(
      `  ${formatSuoXie(level)}    ${formatSuoXie(enemy.hit)}    ${formatSuoXie(enemy.dodge)}    ${formatSuoXie(enemy.crit)}    ${formatSuoXie(enemy.critResist)}    ${formatSuoXie(enemy.speed)}    ${formatSuoXie(enemy.damageReduce)}  `
    );
  }
  return rows;
}
if (process.argv[1] === import.meta.filename) {
  runMain(main);
}