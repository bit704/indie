'use strict';
/*
 * 《囚笼与玫瑰》事件触发条件检验
 * ------------------------------------------------------------
 * 检查范围（针对所有"条件串"：线索条件 + 结局条件）：
 *   1. 每个条件都能被修复后的 evalCondition（with(gameData)）正确解析，
 *      不会抛 ReferenceError（即不存在"引用了不存在的变量"这类 bug，
 *      这正是此前 flags/location 裸标识符崩溃的根因）。
 *   2. 用 strictCheck（with + Proxy has 陷阱）提取条件里解析到的顶层标识符，
 *      验证它们都是游戏已知上下文（flags / location / discoveredClues /
 *      characters / 数值字段 / affectionHighest()），无未知变量。
 *   3. 条件里引用的 flag 在"全量满足"态下能求值（dynamic sanity）。
 *   4. 条件里引用的 flag 至少在某个 choice 里被赋值（交叉校验，避免死引用）；
 *      仅做警告（运行时 flag 也合法）。
 *
 * 输入：游戏 HTML 路径（默认同共享层）
 * 输出：文本报告；退出码 0=全部条件合法，1=存在非法条件，2=参数/文件错误。
 * ------------------------------------------------------------
 */
const G = require('./lib/extract-data.cjs');

// 条件里允许的顶层标识符（经 with(gameData) 解析）
const ALLOWED_TOP = new Set([
  'flags', 'location', 'discoveredClues', 'characters',
  'day', 'hour', 'alertLevel', 'escapeProgress',
  'affectionHighest' // 游戏内已定义的全局函数
]);

function main() {
  let data;
  try { data = G.loadGameData(process.argv[2]); }
  catch (e) { console.error(e.message); process.exit(2); }
  const { FILE, DEFAULT_DATA, SCENES } = data;
  const errors = [];
  const warnings = [];

  const conds = G.collectConditions(DEFAULT_DATA);
  const assigned = G.assignedFlags(SCENES);

  // 全量满足态 gd（用于 dynamic sanity）
  const fullChars = {};
  for (const k of Object.keys(DEFAULT_DATA.characters)) fullChars[k] = { affection: 100, trust: 100, fear: 100 };
  const fullGD = { location: 'bedroom', flags: Object.fromEntries([...assigned].map(f => [f, true])), discoveredClues: [], characters: fullChars };

  console.log('========== 事件触发条件检验 ==========');
  console.log('游戏文件: ' + FILE);
  console.log('待检条件总数: ' + conds.length);
  console.log('');

  for (const { kind, id, cond } of conds) {
    // 1. 能否被 evalCondition 解析（不抛错）
    let parsed;
    try { parsed = G.evalCond(cond, fullGD); }
    catch (e) { errors.push(`${kind} ${id} 条件解析抛错: ${e.message}  [${cond}]`); continue; }
    if (typeof parsed !== 'boolean') {
      errors.push(`${kind} ${id} 条件未返回布尔值（得到 ${typeof parsed}）  [${cond}]`);
      continue;
    }
    // 2. strictCheck 提取顶层标识符
    const sc = G.strictCheck(cond);
    if (!sc.ok) { errors.push(`${kind} ${id} 条件执行异常: ${sc.error}  [${cond}]`); continue; }
    const unknown = sc.looked.filter(v => !ALLOWED_TOP.has(v));
    if (unknown.length) {
      errors.push(`${kind} ${id} 条件引用了未知标识符: ${unknown.join(', ')}  [${cond}]`);
    }
    // 4. flag 交叉校验
    const flagRe = /flags\.(\w+)/g; let m;
    while ((m = flagRe.exec(cond))) {
      if (!assigned.has(m[1])) warnings.push(`${kind} ${id} 引用了从未赋值的 flag: ${m[1]}  [${cond}]`);
    }
  }

  if (warnings.length) {
    console.log('⚠️ 警告 (' + warnings.length + '):');
    for (const w of warnings) console.log('   - ' + w);
    console.log('');
  }
  // 汇总每个条件
  for (const { kind, id, cond } of conds) {
    console.log(`  • [${kind}] ${id}: ${cond}`);
  }
  console.log('');
  if (errors.length) {
    console.log('❌ 存在非法条件 (' + errors.length + '):');
    for (const e of errors) console.log('   - ' + e);
    console.log('结果: 失败');
    process.exit(1);
  }
  console.log('✅ 全部 ' + conds.length + ' 个触发条件均可被正确解析，无未知变量引用');
  process.exit(0);
}

main();
