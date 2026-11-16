/**
 * with-timeout.ts — 给任意命令加执行时限(默认 120 秒),超时强制结束整棵进程树.
 * 用于防止分析脚本因死循环/超大搜索空间长期占用 CPU(本项目多次出现二分死循环卡顿).
 * 用法(任选其一):
 * tsx scripts/with-timeout.ts <命令> [参数...] // 超时默认 120000ms
 * tsx scripts/with-timeout.ts <超时毫秒> <命令> [参数...] // 首个参数为纯数字时按超时解析
 * 也可用环境变量 TIMEOUT_MS 指定超时(优先于默认值,低于首个数字参数).
 * 例:tsx scripts/with-timeout.ts 120000 pnpm exec tsx src/composite-compare.ts Windows 用 taskkill /T /F 结束子进程树;其它平台用 SIGKILL.退出码 124 表示超时.
 */
import {spawn} from "node:child_process";

const argv = process.argv.slice(2);
const envLimit = Number(process.env.TIMEOUT_MS);
let limit = Number.isFinite(envLimit) && envLimit > 0 ? envLimit : 12_0000;
let cmdArgs: string[] = argv;
if (argv.length > 1 && (/^\d+$/).test(argv[0]!)) {
  limit = Number(argv[0]);
  cmdArgs = argv.slice(1);
}
if (cmdArgs.length === 0) {
  console.error("用法:tsx scripts/with-timeout.ts [超时毫秒] <命令> [参数...]");
  process.exit(2);
}
const started = Date.now();
const [cmd,...args] = cmdArgs as [string,...string[]];
const child = spawn(cmd,args,{shell: true,stdio: "inherit"});
let isExpired = false;
const timer = setTimeout(() => {
  isExpired = true;
  console.error(`\n[with-timeout] 超过 ${String(limit)} ms,结束进程树: ${cmd} ${args.join(" ")}`);
  if (process.platform === "win32") {
    spawn("taskkill",["/pid",String(child.pid),"/T","/F"],{stdio: "ignore"});
  } else {
    child.kill("SIGKILL");
  }
},limit);
child.on("error",err => {
  clearTimeout(timer);
  console.error(`[with-timeout] 启动失败: ${String(err)}`);
  process.exit(1);
});
child.on("exit",(code,signal) => {
  clearTimeout(timer);
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (isExpired) {
    console.error(`[with-timeout] 已超时终止(耗时 ${secs}s)`);
    process.exit(124);
  }
  console.error(`[with-timeout] 正常结束(耗时 ${secs}s, code=${String(code)}, signal=${signal ?? "无"})`);
  process.exit(code ?? (signal ? 1 : 0));
});