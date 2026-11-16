/**
 * tools.ts — 本项目脚本公共辅助(业务私有,非跨项目通用工具).
 * 集中各分析脚本重复的配置读取,入口错误处理与共享配置类型.
 */
import {readFileSync} from "node:fs";
import {join} from "node:path";

const CONFIG_DIR = join(import.meta.dirname,"config");

// 试炼存档字段:gen-diagnose-trial 与 yuanbao-route 共用.
export interface ShiLianSave {
  Count?:       number;
  Cur_CengShu?: number;
  Cur_PiLao?:   number;
  JinDu?:       number;
}

// 英灵配置(yingling.json 条目):jiban-value 与 yingling-output 共用.
export interface YingLingConfig {
  bonds:        number[];
  index:        number;
  skillMo:      number;
  skills:       number[];
  skillShen:    number;
  yingLingType: number;
}

// 读取 src/config 下的 JSON 配置(等价各脚本原本地 loadConfig).
export function loadConfig<T> (name: string): T {
  return JSON.parse(readFileSync(join(CONFIG_DIR,`${name}.json`),"utf8")) as T;
}

// 脚本入口统一错误处理(等价各脚本原本地 try{main()}catch).
export function runMain (main: () => void): void {
  try {
    main();
  } catch (error) {
    const message = Error.isError(error) ? error.message : String(error);
    console.error(`错误：${message}`);
    process.exitCode = 1;
  }
}