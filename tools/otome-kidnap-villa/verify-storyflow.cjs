'use strict';
/*
 * 《囚笼与玫瑰》剧情流程检验
 * ------------------------------------------------------------
 * 检查范围（基于本地预设剧情静态图）：
 *   1. 从开场场景 currentScene 出发，所有 choice.scene 边（ending_* 视为终局）
 *      可达性：报告无法从开局到达的"孤儿场景"（死内容）。
 *   2. 悬空引用：choice.scene 指向不存在的场景且不是合法 ending_*（致命）。
 *   3. 自循环死锁：choice.scene === 当前场景自身（必卡死，致命）。
 *   4. 软锁死胡同：非结局、无 choice、且无法继续推进的场景（致命）。
 *
 * 输入：游戏 HTML 路径（默认同共享层）
 * 输出：文本报告；退出码 0=通过，1=存在致命流程错误，2=参数/文件错误。
 * ------------------------------------------------------------
 */
const G = require('./lib/extract-data.cjs');

function main() {
  let data;
  try { data = G.loadGameData(process.argv[2]); }
  catch (e) { console.error(e.message); process.exit(2); }
  const { FILE, SCENES, SCENE_LOCATIONS, DEFAULT_DATA, ENDING_MAP } = data;
  const errors = [];
  const warnings = [];

  const start = DEFAULT_DATA.currentScene || 'prologue';
  if (!SCENES[start]) { console.error('开场场景不存在: ' + start); process.exit(1); }

  const endingKeys = new Set(Object.keys(ENDING_MAP));
  const sceneIds = Object.keys(SCENES);

  // 1+2+3+4 在一次遍历中收集
  const dangling = [];
  const selfLoops = [];
  const deadEnds = [];
  for (const sid of sceneIds) {
    const sc = SCENES[sid];
    const choices = Array.isArray(sc.choices) ? sc.choices : [];
    if (choices.length === 0) {
      // 没有选项：若它不是某个 ending_* 的入口（即没有任何 choice 指向 scene=ending_* 是在别处），
      // 本地模式下玩家无法推进 -> 软锁。但若是 AI 模式自由输入场景则属正常。此处仅针对无 choices 且非终局触发场景。
      deadEnds.push(sid);
    }
    for (const ch of choices) {
      if (!ch.scene) continue;
      if (endingKeys.has(ch.scene)) continue; // 终局，合法
      if (ch.scene === sid) { selfLoops.push(sid); continue; }
      if (!SCENES[ch.scene]) dangling.push(sid + ' -> ' + ch.scene);
    }
  }

  // 可达性
  const reachable = G.reachableScenes(SCENES, start);
  const orphans = sceneIds.filter(s => !reachable.has(s));
  if (orphans.length) warnings.push('孤儿场景（无法从开局到达）: ' + orphans.join(', '));

  // 报告
  console.log('========== 剧情流程检验 ==========');
  console.log('游戏文件: ' + FILE);
  console.log('开场场景: ' + start);
  console.log('场景总数: ' + sceneIds.length + ' | 可达场景: ' + reachable.size);
  console.log('选择边总数: ' + G.allChoices(SCENES).length);
  console.log('');

  if (selfLoops.length) {
    console.log('❌ 自循环死锁（选项指向自身，必卡死）: ' + selfLoops.join(', '));
    errors.push('self-loop');
  }
  if (dangling.length) {
    console.log('❌ 悬空场景引用（指向不存在的场景）:');
    for (const d of dangling) console.log('   - ' + d);
    errors.push('dangling');
  }
  if (deadEnds.length) {
    console.log('❌ 软锁死胡同（无选项且非结局入口，本地模式无法推进）: ' + deadEnds.join(', '));
    errors.push('dead-end');
  }
  if (orphans.length) {
    console.log('⚠️ 孤儿场景（可能为 AI 模式专用内容）: ' + orphans.join(', '));
  }
  console.log('');

  // 出口判定：悬空/自循环/死胡同都是致命流程缺陷
  if (errors.length) {
    console.log('结果: 失败（存在致命流程错误）');
    process.exit(1);
  }
  console.log('✅ 剧情流程检查通过（无悬空引用 / 自循环 / 软锁）');
  if (orphans.length) console.log('   （注：存在孤儿场景，已作为警告列出，建议确认是否为 AI 模式专用）');
  process.exit(0);
}

main();
