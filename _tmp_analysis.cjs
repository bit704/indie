'use strict';
/*
 * 临时分析脚本：从游戏 HTML 抽取 SCENES / DEFAULT_DATA，计算
 * - 每位男主在场景文本/选项/条件中被引用的频次与“戏份”体量
 * - 每位男主的好感/信任可达上限（复刻 maxStats）
 * - 每条男主线（+affection / +trust）选项数量
 * - 场景文本体量分布（找“薄场景”）
 * - 各男主相关场景清单（按 location 与 id 归类，辅助判断路线深度）
 * 仅只读分析，不修改游戏文件。
 */
const G = require('D:/code/Projects/indie/tools/otome-kidnap-villa/lib/extract-data.cjs');

const CHARS = ['shenmo', 'guyechen', 'luxiao', 'baiche'];
const NAME = { shenmo: '沈墨', guyecher: '顾夜辰', luxiao: '陆骁', baiche: '白澈' };

function main() {
  const { FILE, SCENES, SCENE_LOCATIONS, DEFAULT_DATA, ENDING_MAP } = G.loadGameData(
    'D:/code/Projects/indie/game/otome-kidnap-villa.html'
  );

  const sceneIds = Object.keys(SCENES);
  const stats = G.maxStats(SCENES, DEFAULT_DATA);

  // 每位男主的引用统计
  const mention = {}; // char -> { scenes:Set, textChars:0, +aff:0, +trust:0, +fear:0, choices:0 }
  for (const c of CHARS) mention[c] = { scenes: new Set(), textChars: 0, aff: 0, trust: 0, fear: 0, choices: 0 };

  // 场景体量
  const sceneLen = {};
  const thin = [];

  for (const sid of sceneIds) {
    const sc = SCENES[sid];
    const texts = Array.isArray(sc.text) ? sc.text : [];
    const fullText = texts.join('\n');
    let len = fullText.length;
    // 选项文本也计入体量
    const choices = Array.isArray(sc.choices) ? sc.choices : [];
    for (const ch of choices) {
      if (ch.text) len += ch.text.length;
      if (ch.condition) len += 0; // 条件不直接贡献叙事体量
    }
    sceneLen[sid] = { loc: SCENE_LOCATIONS[sid], len, nText: texts.length, nChoice: choices.length };
    if (len < 60 && choices.length > 0) thin.push({ sid, len, loc: SCENE_LOCATIONS[sid] });

    // 角色引用：扫描 text + 选项 text + condition + effects
    const hay = fullText + ' ' + choices.map(c => (c.text || '') + ' ' + (c.condition || '')).join(' ');
    for (const c of CHARS) {
      const key = c;
      const nm = NAME[c];
      const hit = hay.includes(nm) || hay.includes(key);
      if (hit) {
        mention[c].scenes.add(sid);
        mention[c].textChars += fullText.length;
      }
    }
    // 选项 effects 中对各角色的数值影响
    for (const ch of choices) {
      if (ch.effects && ch.effects.characters) {
        for (const c of CHARS) {
          const d = ch.effects.characters[c];
          if (!d) continue;
          mention[c].choices++;
          if (typeof d.affection === 'number' && d.affection > 0) mention[c].aff += 1;
          if (typeof d.trust === 'number' && d.trust > 0) mention[c].trust += 1;
          if (typeof d.fear === 'number' && d.fear > 0) mention[c].fear += 1;
        }
      }
    }
  }

  // 各男主相关场景（提及且该场景 id 或 location 暗示归属）
  const routeScenes = {};
  for (const c of CHARS) routeScenes[c] = [];
  for (const sid of sceneIds) {
    const hay = (SCENES[sid].text || []).join(' ') + (SCENES[sid].choices || []).map(x => x.text || '').join(' ');
    for (const c of CHARS) {
      if (hay.includes(NAME[c]) && !routeScenes[c].includes(sid)) {
        routeScenes[c].push(sid);
      }
    }
  }

  // 输出
  const out = [];
  out.push('====== 角色戏份 / 路线体量分析 ======');
  out.push('文件: ' + FILE);
  out.push('场景总数: ' + sceneIds.length + ' | 结局数: ' + DEFAULT_DATA.allEndings.length + ' | 线索数: ' + DEFAULT_DATA.allClues.length);
  out.push('');
  out.push('--- 每位男主：可达数值上限 / 戏份场景数 / 文本字符(提及场景) / +aff 选项 / +trust 选项 ---');
  for (const c of CHARS) {
    const m = mention[c];
    const s = stats[c] || {};
    out.push(
      `  ${c}(${NAME[c]}): 上限 affection=${s.affection || 0} trust=${s.trust || 0} fear=${s.fear || 0}` +
      ` | 提及场景=${m.scenes.size} | 文本字符≈${m.textChars} | +aff选项=${m.aff} | +trust选项=${m.trust} | +fear选项=${m.fear}`
    );
  }
  out.push('');
  out.push('--- 各男主相关场景清单（id 含名字提及）---');
  for (const c of CHARS) {
    out.push(`  ${NAME[c]}: ${routeScenes[c].length} 个 -> ${routeScenes[c].join(', ')}`);
  }
  out.push('');
  out.push('--- 薄场景（叙事体量 < 60 字且有选项）---');
  out.push('  共 ' + thin.length + ' 个:');
  for (const t of thin) out.push(`    ${t.sid} [${t.loc}] 字数≈${t.len}`);
  out.push('');
  out.push('--- 场景文本体量排序（最长 25 / 最短 15）---');
  const sorted = sceneIds.map(s => ({ sid: s, ...sceneLen[s] })).sort((a, b) => b.len - a.len);
  out.push('  最长:');
  for (const x of sorted.slice(0, 25)) out.push(`    ${x.sid} [${x.loc}] 字数≈${x.len} (text:${x.nText}, choice:${x.nChoice})`);
  out.push('  最短(>0):');
  for (const x of sorted.filter(s => s.len > 0).slice(-15)) out.push(`    ${x.sid} [${x.loc}] 字数≈${x.len}`);

  console.log(out.join('\n'));
}

main();
