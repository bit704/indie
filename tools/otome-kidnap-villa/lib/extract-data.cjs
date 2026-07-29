'use strict';
/*
 * 《囚笼与玫瑰》检验工具共享数据层
 * ------------------------------------------------------------
 * 职责：从游戏 HTML 中抽取纯数据对象（SCENES / SCENE_LOCATIONS /
 *   DEFAULT_DATA / ENDING_SCENE_MAP），并复刻游戏内关键纯函数
 *   （evalCondition / applyEffects）与若干静态分析辅助函数。
 *
 * 设计原则：
 *  - 不运行浏览器、不依赖 DOM，只抽取并解析数据，保证可在 Node 下独立跑。
 *  - 复刻的语义与游戏源码保持一致（含 with(gameData) 修复版 evalCondition）。
 *  - 所有工具都 require 本模块，保证解析口径统一，避免重复实现漂移。
 *
 * 用法：
 *   const G = require('./lib/extract-data.cjs');
 *   const data = G.loadGameData();            // 或传文件路径
 *   G.evalCond(cond, gd);
 * ------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');

// 默认游戏文件：tools/otome-kidnap-villa/lib -> ../../../game/otome-kidnap-villa.html
function defaultHtmlPath() {
  return path.join(__dirname, '..', '..', '..', 'game', 'otome-kidnap-villa.html');
}

// 抽取包含游戏脚本的 <script>（包含 const SCENES 或 function saveGame 的那段）
function extractScript(h) {
  const re = /<script[^>]*>([\s\S]*?)<\/script>/g;
  let m, best = null;
  while ((m = re.exec(h))) {
    if (m[1].includes('const SCENES') || m[1].includes('function saveGame')) best = m[1];
  }
  return best;
}

// 字符串感知的括号匹配：从 marker 后的第一个 { 匹配到配对的 }
function extractObject(script, marker) {
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

function loadGameData(file) {
  const FILE = file || defaultHtmlPath();
  if (!fs.existsSync(FILE)) {
    throw new Error('找不到游戏文件: ' + FILE + '\n用法: node verify-xxx.cjs [path/to/otome-kidnap-villa.html]');
  }
  const html = fs.readFileSync(FILE, 'utf8');
  const script = extractScript(html);
  if (!script) throw new Error('未在文件中找到游戏脚本');
  const SCENES = eval('(' + extractObject(script, 'const SCENES =') + ')');
  const SCENE_LOCATIONS = eval('(' + extractObject(script, 'const SCENE_LOCATIONS =') + ')');
  const DEFAULT_DATA = eval('(' + extractObject(script, 'const DEFAULT_DATA =') + ')');
  const ENDING_MAP = eval('(' + extractObject(script, 'const ENDING_SCENE_MAP =') + ')');
  return { FILE, html, script, SCENES, SCENE_LOCATIONS, DEFAULT_DATA, ENDING_MAP };
}

// 复刻游戏内修复后的 evalCondition 语义（with(gameData) 包裹）
function evalCond(cond, gd) {
  if (!cond) return true;
  try {
    return new Function('gameData', 'characters', 'with(gameData){ return (' + cond + '); }')(gd, gd.characters);
  } catch (e) { return false; }
}

// 复刻游戏内 applyEffects（纯函数版，直接修改传入 gd）
function applyEffects(gd, effects) {
  if (!effects) return gd;
  if (effects.characters) {
    for (const [char, deltas] of Object.entries(effects.characters)) {
      if (!gd.characters[char]) continue;
      for (const [stat, delta] of Object.entries(deltas)) {
        if (gd.characters[char][stat] !== undefined) {
          gd.characters[char][stat] = Math.max(0, Math.min(100, gd.characters[char][stat] + delta));
        }
      }
    }
  }
  if (effects.escapeProgress) gd.escapeProgress = Math.max(0, Math.min(100, gd.escapeProgress + effects.escapeProgress));
  if (effects.alertLevel) gd.alertLevel = Math.max(0, Math.min(100, gd.alertLevel + effects.alertLevel));
  if (effects.flags) {
    for (const [k, v] of Object.entries(effects.flags)) gd.flags[k] = v;
  }
  return gd;
}

// 扁平化所有选择项：[{ sceneId, choice }]
function allChoices(SCENES) {
  const list = [];
  for (const [sid, scene] of Object.entries(SCENES)) {
    const choices = Array.isArray(scene.choices) ? scene.choices : [];
    for (const ch of choices) list.push({ sceneId: sid, choice: ch });
  }
  return list;
}

// 所有被 choice.effects.flags 设置过的 flag
function assignedFlags(SCENES) {
  const set = new Set();
  for (const { choice } of allChoices(SCENES)) {
    if (choice.effects && choice.effects.flags) {
      for (const k of Object.keys(choice.effects.flags)) set.add(k);
    }
  }
  return set;
}

// 从一组条件串中抽取被引用的 flags（flags.xxx）
function referencedFlags(conds) {
  const set = new Set();
  const re = /flags\.(\w+)/g;
  for (const c of conds) {
    if (!c) continue;
    let m; while ((m = re.exec(c))) set.add(m[1]);
  }
  return set;
}

// 从开场可达的所有场景（仅跟随真实 scene 边；ending_* 视为终局不展开）
function reachableScenes(SCENES, start) {
  const seen = new Set([start]);
  const q = [start];
  while (q.length) {
    const s = q.shift();
    const scene = SCENES[s];
    if (!scene) continue;
    const choices = Array.isArray(scene.choices) ? scene.choices : [];
    for (const ch of choices) {
      if (!ch.scene || !SCENES[ch.scene]) continue;
      if (!seen.has(ch.scene)) { seen.add(ch.scene); q.push(ch.scene); }
    }
  }
  return seen;
}

// 每个角色在各场景下可达的最大数值（affection / trust / fear），clamp 0..100
// 返回详细结构：best[char][stat][scene] = 值
function maxStatsDetailed(SCENES, DEFAULT_DATA) {
  const chars = Object.keys(DEFAULT_DATA.characters);
  const stats = ['affection', 'trust', 'fear'];
  const best = {};
  for (const c of chars) { best[c] = {}; for (const s of stats) best[c][s] = {}; }
  const start = DEFAULT_DATA.currentScene || 'prologue';
  for (const c of chars) for (const s of stats) best[c][s][start] = DEFAULT_DATA.characters[c][s] || 0;
  let changed = true, guard = 0;
  while (changed && guard < 200000) {
    changed = false; guard++;
    for (const [sid, scene] of Object.entries(SCENES)) {
      const choices = Array.isArray(scene.choices) ? scene.choices : [];
      for (const ch of choices) {
        if (!ch.scene || !SCENES[ch.scene]) continue;
        const nxt = ch.scene;
        for (const c of chars) {
          const deltas = (ch.effects && ch.effects.characters && ch.effects.characters[c]) || {};
          for (const s of stats) {
            const cur = best[c][s][sid];
            if (cur === undefined) continue;
            // 好感/信任/恐惧在场景中持续存在：即使当前选项未改变该属性，也要把当前值"带过去"（clamp）。
            const d = (deltas[s] !== undefined) ? deltas[s] : 0;
            const nv = Math.max(0, Math.min(100, cur + d));
            if (best[c][s][nxt] === undefined || nv > best[c][s][nxt]) { best[c][s][nxt] = nv; changed = true; }
          }
        }
      }
    }
  }
  return best;
}

// 由详细结构汇总每个角色的标量上限：res[char][stat] = max
function maxStats(SCENES, DEFAULT_DATA) {
  const detailed = maxStatsDetailed(SCENES, DEFAULT_DATA);
  const res = {};
  for (const c of Object.keys(detailed)) {
    res[c] = {};
    for (const s of Object.keys(detailed[c])) {
      let mx = 0;
      for (const v of Object.values(detailed[c][s])) mx = Math.max(mx, v);
      res[c][s] = mx;
    }
  }
  return res;
}

// 每个场景下可达的 flags 集合（传播并集），并返回全局并集
function maxFlags(SCENES, DEFAULT_DATA) {
  const start = DEFAULT_DATA.currentScene || 'prologue';
  const best = {}; best[start] = new Set();
  let changed = true, guard = 0;
  while (changed && guard < 200000) {
    changed = false; guard++;
    for (const [sid, scene] of Object.entries(SCENES)) {
      if (!best[sid]) continue;
      const choices = Array.isArray(scene.choices) ? scene.choices : [];
      for (const ch of choices) {
        if (!ch.scene || !SCENES[ch.scene]) continue;
        const nxt = ch.scene;
        const nf = new Set(best[sid]);
        if (ch.effects && ch.effects.flags) for (const k of Object.keys(ch.effects.flags)) if (ch.effects.flags[k]) nf.add(k);
        if (!best[nxt]) { best[nxt] = nf; changed = true; }
        else {
          for (const k of nf) if (!best[nxt].has(k)) { best[nxt].add(k); changed = true; }
        }
      }
    }
  }
  const all = new Set();
  for (const s of Object.keys(best)) for (const k of best[s]) all.add(k);
  return { perScene: best, all };
}

// 每个场景下可达的数值字段（escapeProgress / alertLevel / hour / day），clamp 并封顶 day<=20
function maxNumeric(SCENES, DEFAULT_DATA) {
  const start = DEFAULT_DATA.currentScene || 'prologue';
  const best = {};
  best[start] = { escapeProgress: DEFAULT_DATA.escapeProgress || 0, alertLevel: DEFAULT_DATA.alertLevel || 0, hour: DEFAULT_DATA.hour || 8, day: DEFAULT_DATA.day || 1 };
  let changed = true, guard = 0;
  while (changed && guard < 200000) {
    changed = false; guard++;
    for (const [sid, scene] of Object.entries(SCENES)) {
      if (!best[sid]) continue;
      const choices = Array.isArray(scene.choices) ? scene.choices : [];
      for (const ch of choices) {
        if (!ch.scene || !SCENES[ch.scene]) continue;
        const nxt = ch.scene;
        const cur = best[sid];
        const nv = { escapeProgress: cur.escapeProgress, alertLevel: cur.alertLevel, hour: cur.hour, day: cur.day };
        if (ch.effects && ch.effects.escapeProgress) nv.escapeProgress = Math.max(0, Math.min(100, nv.escapeProgress + ch.effects.escapeProgress));
        if (ch.effects && ch.effects.alertLevel) nv.alertLevel = Math.max(0, Math.min(100, nv.alertLevel + ch.effects.alertLevel));
        if (ch.advanceTime) {
          let h = nv.hour + ch.advanceTime;
          let d = nv.day;
          while (h >= 24) { h -= 24; d++; }
          nv.hour = h; nv.day = Math.min(20, d);
        }
        if (!best[nxt]) { best[nxt] = nv; changed = true; }
        else {
          let up = false;
          for (const k of ['escapeProgress', 'alertLevel', 'hour', 'day']) {
            if (nv[k] > best[nxt][k]) { best[nxt][k] = nv[k]; up = true; }
          }
          if (up) changed = true;
        }
      }
    }
  }
  const res = { escapeProgress: 0, alertLevel: 0, hour: 0, day: 1 };
  for (const s of Object.keys(best)) {
    for (const k of ['escapeProgress', 'alertLevel', 'hour', 'day']) res[k] = Math.max(res[k], best[s][k]);
  }
  return res;
}

// 严格条件检查：用 with(gameData) + Proxy「has」陷阱记录条件里解析到的顶层标识符，
// 用于发现"引用了不存在的变量"这类 bug（如修复前的裸 flags/location）。
function strictCheck(cond) {
  const looked = new Set();
  const handler = {
    has(t, prop) { looked.add(String(prop)); return true; },
    get(t, prop) {
      if (prop === Symbol.unscopables) return undefined;
      if (prop === 'then') return undefined;
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === 'length') return 0;
      return new Proxy(function () {}, handler);
    },
    apply() { return new Proxy(function () {}, handler); }
  };
  const gameData = new Proxy({}, handler);
  const characters = {};
  for (const k of ['shenmo', 'guyechen', 'luxiao', 'baiche']) {
    characters[k] = { affection: 100, fear: 100, trust: 100 };
  }
  try {
    new Function('gameData', 'characters', 'with(gameData){ return (' + cond + '); }')(gameData, characters);
  } catch (e) {
    return { ok: false, error: e.message, looked: [...looked] };
  }
  return { ok: true, looked: [...looked] };
}

// 收集游戏里所有"条件串"：线索条件 + 结局条件
function collectConditions(DEFAULT_DATA) {
  const conds = [];
  for (const c of (DEFAULT_DATA.allClues || [])) if (c.condition) conds.push({ kind: 'clue', id: c.id, cond: c.condition });
  for (const e of (DEFAULT_DATA.allEndings || [])) if (e.condition) conds.push({ kind: 'ending', id: e.id, cond: e.condition });
  return conds;
}

module.exports = {
  defaultHtmlPath, extractScript, extractObject, loadGameData,
  evalCond, applyEffects,
  allChoices, assignedFlags, referencedFlags,
  reachableScenes, maxStats, maxStatsDetailed, maxFlags, maxNumeric,
  strictCheck, collectConditions
};
