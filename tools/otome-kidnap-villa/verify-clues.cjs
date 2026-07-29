'use strict';
/*
 * 《囚笼与玫瑰》线索可达性 BFS 校验器
 * ------------------------------------------------------------
 * 作用：在不运行浏览器、不依赖 DOM 的前提下，把游戏脚本里的
 *   SCENES / SCENE_LOCATIONS / DEFAULT_DATA / ENDING_SCENE_MAP
 *   四个纯数据对象抽出来，复刻「进入场景 -> 设 location -> updateClues()」
 *   的真实语义，做全场景 BFS，确认每一条线索都能被某条可达路径收集并
 *   被 evalCondition 正确解锁。
 *
 * 用法：
 *   node tools/otome-kidnap-villa/verify-clues.cjs
 *   node tools/otome-kidnap-villa/verify-clues.cjs path/to/otome-kidnap-villa.html
 *
 * 退出码：全部线索可达 -> 0；有任意线索不可达 -> 1。
 *   可作为提交前的本地校验门禁使用。
 * ------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');

// 目标 HTML：默认相对仓库根目录的 game/otome-kidnap-villa.html
const DEFAULT_HTML = path.join(__dirname, '..', '..', 'game', 'otome-kidnap-villa.html');
const FILE = process.argv[2] || DEFAULT_HTML;

if (!fs.existsSync(FILE)) {
  console.error('找不到游戏文件: ' + FILE);
  console.error('用法: node tools/otome-kidnap-villa/verify-clues.cjs [path/to/otome-kidnap-villa.html]');
  process.exit(2);
}

const html = fs.readFileSync(FILE, 'utf8');

// 抽取包含 const SCENES 的那个 <script>
function extractScript(h) {
  const re = /<script[^>]*>([\s\S]*?)<\/script>/g;
  let m, best = null;
  while ((m = re.exec(h))) { if (m[1].includes('const SCENES')) best = m[1]; }
  return best;
}
const script = extractScript(html);
if (!script) { console.error('未在文件中找到游戏脚本'); process.exit(2); }

// 字符串感知的括号匹配：从 marker 后的第一个 { 匹配到配对的 }
function extractObject(marker) {
  const idx = script.indexOf(marker);
  if (idx < 0) throw new Error('marker 未找到: ' + marker);
  let i = script.indexOf('{', idx);
  let start = i, depth = 0, inStr = false, strCh = null, esc = false;
  for (; i < script.length; i++) {
    const c = script[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === strCh) { inStr = false; continue; }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = true; strCh = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return script.slice(start, i + 1); }
  }
  throw new Error('括号未闭合: ' + marker);
}

const SCENES = eval('(' + extractObject('const SCENES =') + ')');
const SCENE_LOCATIONS = eval('(' + extractObject('const SCENE_LOCATIONS =') + ')');
const DEFAULT_DATA = eval('(' + extractObject('const DEFAULT_DATA =') + ')');
const ENDING_MAP = eval('(' + extractObject('const ENDING_SCENE_MAP =') + ')');
const endingScenes = new Set(Object.keys(ENDING_MAP));

// 复刻游戏里修复后的 evalCondition 语义（with(gameData)）
function evalCond(cond, gd) {
  if (!cond) return true;
  try {
    return new Function('gameData', 'characters', 'with(gameData){ return (' + cond + '); }')(gd, gd.characters);
  } catch (e) { return false; }
}

// 从线索条件里抽取依赖的 flags（共享变量集合）
const CLUE_FLAGS = [];
const flagRe = /flags\.(\w+)/g;
for (const c of DEFAULT_DATA.allClues) {
  let m; while ((m = flagRe.exec(c.condition))) { if (!CLUE_FLAGS.includes(m[1])) CLUE_FLAGS.push(m[1]); }
}
const flagBit = {};
CLUE_FLAGS.forEach((f, i) => { flagBit[f] = i; });

function makeGD(loc, mask, baiche) {
  const flags = {};
  CLUE_FLAGS.forEach((f, i) => { if (mask & (1 << i)) flags[f] = true; });
  return {
    location: loc,
    flags,
    discoveredClues: [],
    characters: { baiche: { affection: baiche } }
  };
}

const ALL_CLUES = DEFAULT_DATA.allClues;
const reachedClues = new Set();
const maxBaiche = { v: DEFAULT_DATA.characters.baiche.affection };

function evalCluesAt(loc, mask, baiche) {
  const gd = makeGD(loc, mask, baiche);
  for (const c of ALL_CLUES) {
    if (reachedClues.has(c.id)) continue;
    if (evalCond(c.condition, gd)) reachedClues.add(c.id);
  }
}

// BFS over (scene, flagMask, baicheAffection, loc)
const START = DEFAULT_DATA.currentScene || 'prologue';
const visited = new Set();
const queue = [];
let edgesTotal = 0;
const dangling = [];
const seenViaEnding = new Set();

function encode(scene, mask, baiche) { return scene + '|' + mask + '|' + baiche; }

// 起点：advanceScene(START) —— 设 location + updateClues
const startLoc = SCENE_LOCATIONS[START] || 'unknown';
queue.push({ scene: START, mask: 0, baiche: DEFAULT_DATA.characters.baiche.affection, loc: startLoc });
evalCluesAt(startLoc, 0, DEFAULT_DATA.characters.baiche.affection);

while (queue.length) {
  const node = queue.shift();
  const key = encode(node.scene, node.mask, node.baiche);
  if (visited.has(key)) continue;
  visited.add(key);
  if (node.baiche > maxBaiche.v) maxBaiche.v = node.baiche;

  const scene = SCENES[node.scene];
  if (!scene) continue;
  const choices = Array.isArray(scene.choices) ? scene.choices : [];

  for (const ch of choices) {
    edgesTotal++;
    // 应用 effects（与游戏 applyEffects 一致）
    let nmask = node.mask;
    if (ch.effects && ch.effects.flags) {
      for (const [f, v] of Object.entries(ch.effects.flags)) {
        if (v && flagBit[f] !== undefined) nmask |= (1 << flagBit[f]);
      }
    }
    let nbaiche = node.baiche;
    if (ch.effects && ch.effects.characters && ch.effects.characters.baiche &&
        ch.effects.characters.baiche.affection !== undefined) {
      nbaiche = Math.max(0, Math.min(100, nbaiche + ch.effects.characters.baiche.affection));
    }

    if (!ch.scene) {
      evalCluesAt(node.loc, nmask, nbaiche);
      continue;
    }

    if (endingScenes.has(ch.scene)) {
      seenViaEnding.add(ch.scene);
      continue;
    }

    if (!SCENES[ch.scene]) {
      if (!dangling.includes(ch.scene)) dangling.push(ch.scene);
      continue;
    }

    const nloc = SCENE_LOCATIONS[ch.scene] !== undefined ? SCENE_LOCATIONS[ch.scene] : node.loc;
    evalCluesAt(nloc, nmask, nbaiche);
    queue.push({ scene: ch.scene, mask: nmask, baiche: nbaiche, loc: nloc });
  }
}

// 报告
const totalScenes = Object.keys(SCENES).length;
const totalClues = ALL_CLUES.length;
const reached = ALL_CLUES.filter(c => reachedClues.has(c.id));
const unreached = ALL_CLUES.filter(c => !reachedClues.has(c.id));

console.log('========== 线索可达性 BFS 报告 ==========');
console.log('游戏文件: ' + FILE);
console.log('场景总数: ' + totalScenes);
console.log('选择边总数: ' + edgesTotal);
console.log('BFS 探索状态数: ' + visited.size);
console.log('可达线索: ' + reached.length + ' / ' + totalClues);
console.log('依赖的 flags: ' + CLUE_FLAGS.join(', '));
console.log('白澈好感可达上限: ' + maxBaiche.v + ' (线索要求 >= 30)');
console.log('');
console.log('--- 每条线索 ---');
for (const c of ALL_CLUES) {
  const ok = reachedClues.has(c.id);
  console.log((ok ? '✅' : '❌') + ' ' + c.id + '  [' + c.source + ']  condition: ' + c.condition);
}
console.log('');
if (unreached.length) {
  console.log('❌ 不可达线索: ' + unreached.map(c => c.id).join(', '));
} else {
  console.log('✅ 全部 ' + totalClues + ' 条线索均可经本地剧情路径收集并正确解锁');
}
console.log('');
if (dangling.length) {
  console.log('⚠️ 指向不存在场景的选择: ' + dangling.join(', '));
} else {
  console.log('✅ 无悬空场景引用');
}
console.log('');
console.log('说明: 仅验证本地预设剧情(LOCAL 模式)。AI 模式为玩家自由输入、动态生成，不在此 BFS 范围内。');

process.exit(unreached.length ? 1 : 0);
