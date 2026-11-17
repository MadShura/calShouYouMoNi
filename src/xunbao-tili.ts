import {argNumber,parseArgs} from "../readSave.ts";

/**
 * 寻宝期望体力
 * 代码依据(反编译 YingLing.KeJinSystem/XunBaoManager.cs):
 * - MaxTiLi = 150 + Mark_Manger.GetMakeCount(MingShang_XunBao_TiLi_Limit),默认 150
 * - 开一格消耗 Cur_CengShu_Index 点体力:GetOpenReward 里 Cur_TuLi -= Cur_CengShu_Index
 * - 每层 4×4=16 格,入口格由 Initial/EnterNext 免费放入 OpenBlock,所以每层付费格是 15
 * - 大奖 DaJiang_Seat 在 MayDajiangSeat 的 16 个位置里随机,且不在已开格里
 * - 第 10 层要跑满,前 9 层只要求走到下层
 * 输出四种口径:
 * 1. 已知大奖:每层走最短曼哈顿路径
 * 2. 隐藏大奖:按固定顺序逐格开,直到开到奖
 * 3. 每开一格有 p 概率下层(默认 0.5,对应你记的 400 多)
 * 4. 每层全开
 */
const POSITIONS = [
  1,11,12,13,
  14,2,21,22,
  23,24,3,31,
  32,33,34,4
] as const;
const LAYERS = 10;
const ADVANCE_LAYERS = 9;
const PAID_BLOCKS = POSITIONS.length - 1;
interface Coord {
  col: number;
  row: number;
}

function format (value: number): string {
  return value.toFixed(1);
}

// 隐藏大奖:固定顺序开 15 个付费格,目标在顺序里均匀分布
function hiddenLayers (): number {
  return (PAID_BLOCKS + 1) / 2;
}

// 已知大奖:入口固定为 1 的第一层
function knownFirstLayer (): number {
  let sum = 0;
  let count = 0;
  for (const target of POSITIONS) {
    if (target === 1) {
      continue;
    }
    sum += manhattan(1,target);
    count += 1;
  }
  return sum / count;
}

// 已知大奖:第 2~9 层,入口是上一层大奖位置,按均匀分布枚举
function knownLaterLayers (): number {
  let sum = 0;
  let count = 0;
  for (const entry of POSITIONS) {
    for (const target of POSITIONS) {
      if (entry === target) {
        continue;
      }
      sum += manhattan(entry,target);
      count += 1;
    }
  }
  return sum / count;
}
function main (): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.get("help") === true) {
    console.log(
      [
        "用法：pnpm exec tsx src/scripts/xunbao-tili.ts [参数]",
        "",
        "  --advance-prob=0.5  每开一格走到下层的概率（默认 0.5）",
        "  --cap=150           体力上限（默认 150）",
        "  --seconds=300       每点体力恢复秒数（默认 300）",
        "  --last-full=false   第 10 层不跑满，只走到下层"
      ].join("\n")
    );
    return;
  }
  const advanceProb = argNumber(args,"advance-prob") ?? 0.5;
  const cap = argNumber(args,"cap") ?? 150;
  const seconds = argNumber(args,"seconds") ?? 300;
  const isLastFull = args.get("last-full") !== "false";
  const knownFirst = knownFirstLayer();
  const knownLater = knownLaterLayers();
  const hidden = hiddenLayers();
  const probability = probabilityLayers(advanceProb);
  const full = PAID_BLOCKS;
  const firstSum = ADVANCE_LAYERS * (ADVANCE_LAYERS + 1) / 2;
  const models = [
    {
      first9:   knownFirst + knownLater * (firstSum - 1),
      name:     "已知大奖/最短路径",
      perLayer: knownLater
    },
    {first9: hidden * firstSum,name: "隐藏大奖/固定顺序",perLayer: hidden},
    {
      first9:   probability * firstSum,
      name:     `每开一格 ${(advanceProb * 100).toFixed(0)}% 下层`,
      perLayer: probability
    },
    {first9: full * firstSum,name: "每层全开",perLayer: full}
  ];
  console.log("寻宝期望体力（入口格免费，每层付费 15 格）");
  console.log(
    `参数：前 ${String(ADVANCE_LAYERS)} 层走到下层，第 10 层${isLastFull ? "跑满" : "只走到下层"}；体力上限 ${String(cap)}；${String(seconds)} 秒/点`
  );
  console.log("");
  console.log("模型                    前9层    第10层   合计     +上限   满管数  耗时(小时)");
  for (const model of models) {
    const last = (isLastFull ? full : model.perLayer) * LAYERS;
    const total = model.first9 + last;
    const withCap = total + cap;
    const bars = Math.ceil(total / cap);
    const hours = total * seconds / 3600;
    console.log(
      `${model.name.padEnd(22)} ${format(model.first9).padStart(7)} ${format(last).padStart(8)} ${format(total).padStart(8)} ${format(withCap).padStart(8)} ${String(bars).padStart(7)} ${format(hours).padStart(9)}`
    );
  }
  console.log("");
  console.log(
    `你记的“400 多 + 150”：已知大奖最短路径 = ${format(knownFirst + knownLater * (firstSum - 1) + full * LAYERS)} + ${String(cap)}；`
  );
  console.log(
    `或按 50% 且把入口格也算进去 = ${format(probability * firstSum + (full + 1) * LAYERS)} + ${String(cap)}。`
  );
  console.log(
    `按代码隐藏大奖、固定顺序开：${format(hidden * firstSum + full * LAYERS)} + ${String(cap)}，这是不提前知道大奖位置的实际期望。`
  );
  console.log("");
  console.log("代码依据：XunBaoManager.MaxTiLi=150；GetOpenReward 扣 Cur_CengShu_Index；第 10 层跑满 15 个付费格。");
}
function manhattan (a: number,b: number): number {
  const left = toCoord(a);
  const right = toCoord(b);
  return Math.abs(left.row - right.row) + Math.abs(left.col - right.col);
}

// 每开一格有 p 概率下层:几何分布,最多 15 格
function probabilityLayers (probability: number): number {
  if (probability <= 0) {
    return PAID_BLOCKS;
  }
  return Math.min(1 / probability,PAID_BLOCKS);
}
function toCoord (index: number): Coord {
  const value = index - 1;
  return {col: value % 10,row: Math.floor(value / 10)};
}
main();