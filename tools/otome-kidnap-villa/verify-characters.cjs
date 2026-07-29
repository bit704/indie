'use strict';
/*
 * 《囚笼与玫瑰》角色交互检验
 * ------------------------------------------------------------
 * 检查范围：
 *   1. 角色定义完整：4 位男主（shenmo/guyechen/luxiao/baiche）均具备
 *      name/role/avatar/affection/fear/trust/bio，数值在 0..100。
 *   2. 引用一致性：choices.effects.characters 与条件串（clue/ending）
 *      里出现的角色键、属性键（affection/trust/fear）必须真实存在。
 *   3. 可交互性：每位角色至少存在一条能增加其 affection 的选项（可达交互）。
 *   4. 路线可达：各男主线结局所需的好感/信任上限，沿可达路径是否真能达到。
 *
 * 输入：游戏 HTML 路径（默认同共享层）
 * 输出：文本报告；退出码 0=通过，1=存在角色相关错误，2=参数/文件错误。
 * ------------------------------------------------------------
 */
const G = require('./lib/extract-data.cjs');

const EXPECTED = ['shenmo', 'guyechen', 'luxiao', 'baiche'];
const STAT_KEYS = ['affection', 'trust', 'fear'];

function main() {
  let data;
  try { data = G.loadGameData(process.argv[2]); }
  catch (e) { console.error(e.message); process.exit(2); }
  const { FILE, SCENES, DEFAULT_DATA } = data;
  const errors = [];
  const warnings = [];

  // 1. 定义完整
  for (const k of EXPECTED) {
    const c = DEFAULT_DATA.characters[k];
    if (!c) { errors.push(`缺少角色定义: ${k}`); continue; }
    for (const f of ['name', 'role', 'avatar', 'affection', 'fear', 'trust', 'bio']) {
      if (c[f] === undefined) errors.push(`角色 ${k} 缺少字段: ${f}`);
    }
    for (const s of STAT_KEYS) {
      if (typeof c[s] === 'number' && (c[s] < 0 || c[s] > 100)) errors.push(`角色 ${k}.${s} 初值越界: ${c[s]}`);
    }
  }
  for (const k of Object.keys(DEFAULT_DATA.characters)) {
    if (!EXPECTED.includes(k)) warnings.push(`角色 ${k} 不在预期 4 位男主清单中`);
  }

  // 2. 引用一致性
  const charRe = /characters\.(\w+)\.(\w+)/g;
  const conds = G.collectConditions(DEFAULT_DATA);
  const charRefs = new Set();
  for (const { kind, id, cond } of conds) {
    let m; while ((m = charRe.exec(cond))) {
      const [_, ch, stat] = m;
      charRefs.add(ch);
      if (!DEFAULT_DATA.characters[ch]) errors.push(`${kind} ${id} 引用了不存在的角色: characters.${ch}`);
      else if (!STAT_KEYS.includes(stat)) errors.push(`${kind} ${id} 引用了角色 ${ch} 的未知属性: ${stat}`);
    }
  }
  for (const { sceneId, choice } of G.allChoices(SCENES)) {
    if (choice.effects && choice.effects.characters) {
      for (const ch of Object.keys(choice.effects.characters)) {
        if (!DEFAULT_DATA.characters[ch]) errors.push(`场景 ${sceneId} 引用了不存在的角色: ${ch}`);
      }
    }
  }

  // 3+4. 可达好感/信任 + 路线可达
  const detailed = G.maxStatsDetailed(SCENES, DEFAULT_DATA);
  const summary = G.maxStats(SCENES, DEFAULT_DATA);
  // 每位角色是否存在 +affection 选项
  const hasAffectionGain = {};
  for (const k of EXPECTED) {
    hasAffectionGain[k] = false;
    for (const { choice } of G.allChoices(SCENES)) {
      const d = choice.effects && choice.effects.characters && choice.effects.characters[k];
      if (d && typeof d.affection === 'number' && d.affection > 0) { hasAffectionGain[k] = true; break; }
    }
    if (!hasAffectionGain[k]) errors.push(`角色 ${k} 没有任何可增加 affection 的选项（无法发展好感线）`);
  }

  // 路线阈值
  const routeChecks = [
    { id: 'shenmo_lover', char: 'shenmo', need: { affection: 80 }, label: '沈墨线' },
    { id: 'yechen_deal', char: 'guyechen', need: { affection: 80 }, label: '顾夜辰线' },
    { id: 'luxiao_betrayal', char: 'luxiao', need: { affection: 80, trust: 50 }, label: '陆骁线' },
    { id: 'baiche_redemption', char: 'baiche', need: { affection: 80, trust: 50 }, label: '白澈线' }
  ];
  const routeResult = [];
  for (const r of routeChecks) {
    const cur = summary[r.char] || {};
    let ok = true;
    const parts = [];
    for (const [stat, thr] of Object.entries(r.need)) {
      const mx = cur[stat] || 0;
      const reach = mx >= thr;
      if (!reach) ok = false;
      parts.push(`${stat}上限=${mx}/${thr}`);
    }
    routeResult.push({ label: r.label, ok, parts: parts.join(', ') });
    if (!ok) errors.push(`路线不可达: ${r.label}（${r.id}）需要 ${r.need ? JSON.stringify(r.need) : ''}`);
  }

  // 报告
  console.log('========== 角色交互检验 ==========');
  console.log('游戏文件: ' + FILE);
  console.log('角色数: ' + Object.keys(DEFAULT_DATA.characters).length);
  console.log('');
  console.log('--- 各角色可达数值上限 ---');
  for (const k of EXPECTED) {
    const s = summary[k] || {};
    console.log(`  ${k}（${DEFAULT_DATA.characters[k] ? DEFAULT_DATA.characters[k].name : '?'}）: affection=${s.affection || 0}, trust=${s.trust || 0}, fear=${s.fear || 0}`);
  }
  console.log('');
  console.log('--- 男主线可达性 ---');
  for (const r of routeResult) {
    console.log(`  ${r.ok ? '✅' : '❌'} ${r.label}  [${r.parts}]`);
  }
  if (warnings.length) {
    console.log('');
    console.log('⚠️ 警告:');
    for (const w of warnings) console.log('   - ' + w);
  }
  console.log('');
  if (errors.length) {
    console.log('❌ 角色相关错误 (' + errors.length + '):');
    for (const e of errors) console.log('   - ' + e);
    console.log('结果: 失败');
    process.exit(1);
  }
  console.log('✅ 角色交互检查通过（定义完整 / 引用一致 / 4 条男主线均可达）');
  process.exit(0);
}

main();
