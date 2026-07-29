'use strict';
/*
 * 《囚笼与玫瑰》存档 / 读档检验
 * ------------------------------------------------------------
 * 本工具在 Node 沙箱（vm）中加载游戏真实脚本，mock 掉 DOM 与 localStorage，
 * 直接调用游戏内的 saveGame / loadGame / ensureCompatibility / saveGallery /
 * loadGallery，验证：
 *   1. 存档写入：saveGame() 正确序列化 gameData 到 STORAGE_KEY，并把线索/结局
 *      写入 GALLERY_KEY。
 *   2. 读档还原：清空内存后 loadGame() 能完整还原 flags / 好感 / 信任 / 线索 /
 *      结局图鉴 / 当前场景 / 天数 / 进度 / 剧情日志 / 自定义历史。
 *   3. 图鉴合并：跨周目 loadGallery 对 discoveredClues / unlockedEndings 取并集。
 *   4. 兼容性：ensureCompatibility 面对缺失字段 / 多余字段 / 类型异常的老存档
 *      不抛错，并用 DEFAULT_DATA 兜底。
 *   5. 无存档读档：localStorage 为空时 loadGame() 不崩溃（仅提示）。
 *
 * 输入：游戏 HTML 路径（默认同共享层）
 * 输出：文本报告；退出码 0=通过，1=存档/读档逻辑异常，2=参数/文件错误 / 沙箱加载失败。
 * ------------------------------------------------------------
 */
const fs = require('fs');
const vm = require('vm');
const G = require('./lib/extract-data.cjs');

// ---- DOM / 环境 mock ----
function makeNode() {
  const store = { textContent: '', innerHTML: '', value: '', className: '', id: '' };
  const classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  return new Proxy(store, {
    get(t, p) {
      if (p === 'classList') return classList;
      if (p === 'style') return {};
      if (p === 'dataset') return {};
      if (p === 'value') return t.value || '';
      if (p === 'textContent' || p === 'innerHTML' || p === 'className' || p === 'id') return t[p];
      if (typeof p === 'symbol') return undefined;
      // 方法统一 no-op；querySelectorAll 返回 []
      if (p === 'querySelectorAll') return () => [];
      if (p === 'querySelector') return () => makeNode();
      if (p === 'appendChild' || p === 'removeChild' || p === 'setAttribute' || p === 'getAttribute'
        || p === 'addEventListener' || p === 'removeEventListener' || p === 'focus' || p === 'click'
        || p === 'insertBefore' || p === 'remove') return () => {};
      return () => {};
    },
    set(t, p, v) { t[p] = v; return true; }
  });
}

function makeStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
    _map: map
  };
}

function loadEngine(file) {
  const data = G.loadGameData(file);
  const script = data.script;
  const shim = `
;var __OTOME__ = {
  get gameData(){ return gameData; },
  set gameData(v){ gameData = v; },
  saveGame: saveGame, loadGame: loadGame, ensureCompatibility: ensureCompatibility,
  clone: clone, saveGallery: saveGallery, loadGallery: loadGallery,
  DEFAULT_DATA: DEFAULT_DATA, SCENES: SCENES, SCENE_LOCATIONS: SCENE_LOCATIONS,
  ENDING_SCENE_MAP: ENDING_SCENE_MAP, STORAGE_KEY: STORAGE_KEY, GALLERY_KEY: GALLERY_KEY
};`;
  const sandbox = {
    console,
    JSON, Math, Object, Array, Set, Map, Symbol, Proxy, Date,
    setTimeout: () => {}, clearTimeout: () => {},
    alert: (m) => { sandbox.__alerts__.push(String(m)); },
    __alerts__: [],
    localStorage: makeStorage(),
    document: {
      getElementById: () => makeNode(),
      querySelector: () => makeNode(),
      querySelectorAll: () => [],
      createElement: () => makeNode(),
      addEventListener: () => {},
      body: makeNode()
    },
    window: new Proxy({}, { get: () => () => {}, set: () => true })
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  try {
    vm.runInContext(script + shim, sandbox, { filename: 'otome-engine.js' });
  } catch (e) {
    throw new Error('沙箱加载游戏脚本失败: ' + e.message);
  }
  if (!sandbox.__OTOME__) throw new Error('未能从脚本导出内部函数（__OTOME__ 缺失）');
  return { api: sandbox.__OTOME__, storage: sandbox.localStorage, alerts: sandbox.__alerts__ };
}

function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function main() {
  let eng;
  try { eng = loadEngine(process.argv[2]); }
  catch (e) { console.error(e.message); process.exit(2); }
  const { api, storage } = eng;
  const errors = [];

  // 构造一个明确的"已推进"状态
  function buildProgressed() {
    const gd = api.clone(api.DEFAULT_DATA);
    gd.currentScene = 'study';
    gd.location = 'study';
    gd.flags = { heard_patrol: true, saw_keys: true, found_diary: true, opened_safe: true };
    gd.discoveredClues = ['window_bars', 'guard_rotation', 'safe_code', 'shenmo_sister', 'real_reason'];
    gd.unlockedEndings = ['truth_exposed'];
    gd.characters.shenmo.affection = 75;
    gd.characters.baiche.affection = 60; gd.characters.baiche.trust = 40;
    gd.day = 5; gd.escapeProgress = 40; gd.alertLevel = 20;
    gd.storyLog = [{ type: 'scene', content: '你走进书房', ai: false }, { type: 'choice', content: '翻找日记', ai: false }];
    gd.customHistory = ['第一章摘要'];
    return gd;
  }

  // 1+2. 写入并还原
  api.gameData = buildProgressed();
  api.saveGame();
  const savedRaw = storage.getItem(api.STORAGE_KEY);
  const galleryRaw = storage.getItem(api.GALLERY_KEY);
  if (!savedRaw) errors.push('saveGame() 未写入 STORAGE_KEY');
  if (!galleryRaw) errors.push('saveGame() 未写入 GALLERY_KEY（saveGallery）');

  // 模拟页面重载：用全新 DEFAULT_DATA 覆盖内存
  api.gameData = api.clone(api.DEFAULT_DATA);
  api.loadGame();
  const loaded = api.gameData;

  // 断言还原正确性
  const checks = [
    ['currentScene', loaded.currentScene, 'study'],
    ['location', loaded.location, 'study'],
    ['day', loaded.day, 5],
    ['escapeProgress', loaded.escapeProgress, 40],
    ['alertLevel', loaded.alertLevel, 20],
    ['shenmo.affection', loaded.characters.shenmo.affection, 75],
    ['baiche.affection', loaded.characters.baiche.affection, 60],
    ['baiche.trust', loaded.characters.baiche.trust, 40],
    ['discoveredClues', JSON.stringify(loaded.discoveredClues), JSON.stringify(['window_bars', 'guard_rotation', 'safe_code', 'shenmo_sister', 'real_reason'])],
    ['unlockedEndings', JSON.stringify(loaded.unlockedEndings), JSON.stringify(['truth_exposed'])],
    ['flags.heard_patrol', loaded.flags.heard_patrol, true],
    ['flags.opened_safe', loaded.flags.opened_safe, true],
    ['flags 不应残留未设置项', Object.keys(loaded.flags).filter(f => loaded.flags[f] === undefined).length, 0]
  ];
  for (const [name, got, exp] of checks) {
    if (!eq(got, exp)) errors.push(`读档还原不一致 [${name}]: 得到 ${JSON.stringify(got)}，期望 ${JSON.stringify(exp)}`);
  }
  // 结局图鉴 unlocked 标记同步
  const te = loaded.allEndings.find(e => e.id === 'truth_exposed');
  if (!te || te.unlocked !== true) errors.push('loadGallery 未同步 allEndings.unlocked 标记（truth_exposed 应为 true）');
  // 剧情日志保留
  if (!Array.isArray(loaded.storyLog) || loaded.storyLog.length < 2) errors.push('storyLog 未正确还原: ' + JSON.stringify(loaded.storyLog));
  // 自定义历史保留
  if (!eq(loaded.customHistory, ['第一章摘要'])) errors.push('customHistory 未正确还原: ' + JSON.stringify(loaded.customHistory));
  // 数据结构未被旧存档污染（allEndings 数量应等于 base）
  if (loaded.allEndings.length !== api.DEFAULT_DATA.allEndings.length) errors.push('ensureCompatibility 未用 base 覆盖 allEndings');

  // 3. 图鉴合并（跨周目并集，真实路径：restartGame 会 reset 后再 loadGallery 合并旧图鉴）
  api.gameData = buildProgressed();
  api.saveGame(); // GALLERY_KEY 写入第一周目线索 A + 结局 truth_exposed
  // 模拟"重新开始"：reset 后 loadGallery 把旧 GALLERY 合并进新 gameData（与游戏 restartGame 一致）
  api.gameData = api.clone(api.DEFAULT_DATA);
  api.loadGallery();
  // 模拟第二周目游玩中又发现了新线索 B、解锁新结局
  for (const c of ['phone_line', 'yechen_car']) if (!api.gameData.discoveredClues.includes(c)) api.gameData.discoveredClues.push(c);
  if (!api.gameData.unlockedEndings.includes('yechen_deal')) api.gameData.unlockedEndings.push('yechen_deal');
  api.saveGame(); // 应写出 A∪B
  // 重新读档，验证并集保留
  api.gameData = api.clone(api.DEFAULT_DATA);
  api.loadGame();
  const merged = api.gameData;
  const wantClues = new Set(['window_bars', 'guard_rotation', 'safe_code', 'shenmo_sister', 'real_reason', 'phone_line', 'yechen_car']);
  const gotClues = new Set(merged.discoveredClues);
  for (const c of wantClues) if (!gotClues.has(c)) errors.push('图鉴合并遗漏线索: ' + c);
  if (!merged.unlockedEndings.includes('truth_exposed') || !merged.unlockedEndings.includes('yechen_deal'))
    errors.push('图鉴合并遗漏结局: ' + JSON.stringify(merged.unlockedEndings));

  // 4. 兼容性：异常老存档不抛错
  try {
    const broken = {
      currentScene: 'prologue',
      flags: { heard_patrol: 'yes' }, // 错误类型
      characters: { shenmo: { affection: 'high' } }, // 错误类型
      discoveredClues: 'not-an-array',
      unlockedEndings: null,
      allEndings: 'garbage',
      extraField: { nested: true }
    };
    const fixed = api.ensureCompatibility(broken);
    if (!fixed || typeof fixed.day !== 'number') errors.push('ensureCompatibility 对异常存档未兜底 day');
    if (!Array.isArray(fixed.discoveredClues)) errors.push('ensureCompatibility 未修正 discoveredClues 类型');
    if (!Array.isArray(fixed.unlockedEndings)) errors.push('ensureCompatibility 未修正 unlockedEndings 类型');
    if (fixed.extraField === undefined) errors.push('ensureCompatibility 丢失了老存档的额外字段');
    if (fixed.characters.shenmo.affection !== 0) errors.push('ensureCompatibility 未修正 characters 错误数值类型');
    if (fixed.allEndings.length !== api.DEFAULT_DATA.allEndings.length) errors.push('ensureCompatibility 未恢复 allEndings 定义');
  } catch (e) {
    errors.push('ensureCompatibility 处理异常存档时抛错: ' + e.message);
  }

  // 5. 无存档读档不崩溃
  try {
    storage._map.clear();
    const before = api.gameData;
    api.gameData = api.clone(api.DEFAULT_DATA);
    api.loadGame(); // 应 alert 但不抛错
  } catch (e) {
    errors.push('空存档时 loadGame() 抛错: ' + e.message);
  }

  // 报告
  console.log('========== 存档 / 读档检验 ==========');
  console.log('游戏文件: ' + (process.argv[2] || G.defaultHtmlPath()));
  console.log('STORAGE_KEY: ' + api.STORAGE_KEY + ' | GALLERY_KEY: ' + api.GALLERY_KEY);
  console.log('');
  if (errors.length) {
    console.log('❌ 存档/读档异常 (' + errors.length + '):');
    for (const e of errors) console.log('   - ' + e);
    console.log('结果: 失败');
    process.exit(1);
  }
  console.log('✅ 存档/读档检查通过：');
  console.log('   • saveGame 正确序列化 gameData 与图鉴');
  console.log('   • loadGame 完整还原 flags / 好感 / 信任 / 线索 / 结局 / 场景 / 进度 / 日志');
  console.log('   • loadGallery 跨周目对线索与结局取并集');
  console.log('   • ensureCompatibility 对异常老存档兜底且不抛错');
  console.log('   • 空存档读档安全（仅提示，不崩溃）');
  process.exit(0);
}

main();
