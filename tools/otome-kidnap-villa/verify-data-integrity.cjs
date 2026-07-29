'use strict';
/*
 * 《囚笼与玫瑰》数据完整性检验
 * ------------------------------------------------------------
 * 检查范围：
 *   1. 游戏脚本语法可编译（new Function 编译，不执行）。
 *   2. SCENES 每个场景具备 text[] 与 choices[] 结构。
 *   3. 所有 choice.scene（非 ending_*）指向真实存在的场景；
 *      ending_* 引用必须存在于 ENDING_SCENE_MAP；否则为悬空引用（致命）。
 *   4. SCENE_LOCATIONS 覆盖全部场景（缺失仅警告）。
 *   5. allClues / allEndings 字段完整、id 唯一、condition 非空。
 *   6. characters 主键完整（4 位男主），无缺失 bio。
 *   7. choice.effects.characters 引用的角色必须存在（拼写错误是致命 bug）。
 *   8. flag 交叉检查：被条件引用但未在任何 choice 里赋值的 flag（疑似死引用）。
 *
 * 输入：游戏 HTML 路径（默认 tools/otome-kidnap-villa/lib/../../../game/otome-kidnap-villa.html）
 * 输出：文本报告；退出码 0=通过，1=存在致命错误，2=参数/文件错误。
 * ------------------------------------------------------------
 */
const G = require('./lib/extract-data.cjs');

function main() {
  let data;
  try { data = G.loadGameData(process.argv[2]); }
  catch (e) { console.error(e.message); process.exit(2); }
  const { FILE, script, SCENES, SCENE_LOCATIONS, DEFAULT_DATA, ENDING_MAP } = data;
  const errors = [];
  const warnings = [];

  // 1. 语法编译
  try { new Function(script); }
  catch (e) { errors.push('游戏脚本语法编译失败: ' + e.message); }

  // 2. 场景结构
  const sceneIds = Object.keys(SCENES);
  for (const sid of sceneIds) {
    const sc = SCENES[sid];
    if (!sc || !Array.isArray(sc.text)) errors.push(`场景 ${sid} 缺少 text 数组`);
    if (!sc || !Array.isArray(sc.choices)) errors.push(`场景 ${sid} 缺少 choices 数组`);
  }

  // 3. 选择引用完整性 + 角色引用
  const endingKeys = new Set(Object.keys(ENDING_MAP));
  for (const { sceneId, choice } of G.allChoices(SCENES)) {
    if (choice.scene) {
      if (endingKeys.has(choice.scene)) {
        // 合法终局引用
      } else if (!SCENES[choice.scene]) {
        errors.push(`场景 ${sceneId} 的选项指向不存在的场景: ${choice.scene}`);
      }
    }
    if (choice.effects && choice.effects.characters) {
      for (const ch of Object.keys(choice.effects.characters)) {
        if (!DEFAULT_DATA.characters[ch]) {
          errors.push(`场景 ${sceneId} 的选项 effects.characters 引用了不存在的角色: ${ch}`);
        }
      }
    }
  }

  // 4. SCENE_LOCATIONS 覆盖
  const locValues = new Set(Object.values(SCENE_LOCATIONS));
  for (const sid of sceneIds) {
    if (SCENE_LOCATIONS[sid] === undefined) warnings.push(`场景 ${sid} 在 SCENE_LOCATIONS 中无地点映射（将沿用上一场景地点）`);
  }

  // 5. 线索 / 结局结构
  const clueIds = new Set(), endingIds = new Set();
  for (const c of DEFAULT_DATA.allClues) {
    if (!c.id) errors.push('存在缺少 id 的线索');
    else {
      if (clueIds.has(c.id)) errors.push(`线索 id 重复: ${c.id}`);
      clueIds.add(c.id);
    }
    if (!c.title || !c.desc || !c.source) errors.push(`线索 ${c.id || '?'} 缺少 title/desc/source`);
    if (!c.condition) errors.push(`线索 ${c.id} 缺少 condition`);
  }
  for (const e of DEFAULT_DATA.allEndings) {
    if (!e.id) errors.push('存在缺少 id 的结局');
    else {
      if (endingIds.has(e.id)) errors.push(`结局 id 重复: ${e.id}`);
      endingIds.add(e.id);
    }
    if (!e.title || !e.desc || !e.condition) errors.push(`结局 ${e.id || '?'} 缺少 title/desc/condition`);
    if (typeof e.unlocked !== 'boolean') errors.push(`结局 ${e.id} 缺少 unlocked 布尔字段`);
  }

  // 6. 角色完整性
  const EXPECTED = ['shenmo', 'guyechen', 'luxiao', 'baiche'];
  for (const k of EXPECTED) {
    const c = DEFAULT_DATA.characters[k];
    if (!c) { errors.push(`缺少角色: ${k}`); continue; }
    if (!c.name || !c.role || !c.bio) errors.push(`角色 ${k} 缺少 name/role/bio`);
    if (typeof c.affection !== 'number' || c.affection < 0 || c.affection > 100) warnings.push(`角色 ${k}.affection 初值越界: ${c.affection}`);
  }
  for (const k of Object.keys(DEFAULT_DATA.characters)) {
    if (!EXPECTED.includes(k)) warnings.push(`角色 ${k} 不在预期 4 位男主清单中`);
  }

  // 7. flag 交叉检查：被条件引用但未赋值的 flag
  const assigned = G.assignedFlags(SCENES);
  const conds = G.collectConditions(DEFAULT_DATA);
  const refs = G.referencedFlags(conds.map(c => c.cond));
  for (const f of refs) {
    if (!assigned.has(f)) warnings.push(`条件引用了从未被赋值的 flag: ${f}（可能是未设置/拼写错误/运行时 flag）`);
  }

  // 报告
  console.log('========== 数据完整性检验 ==========');
  console.log('游戏文件: ' + FILE);
  console.log('场景数: ' + sceneIds.length + ' | 线索数: ' + clueIds.size + ' | 结局数: ' + endingIds.size + ' | 角色数: ' + Object.keys(DEFAULT_DATA.characters).length);
  console.log('被赋值 flag: ' + [...assigned].sort().join(', ') || '(无)');
  console.log('');
  if (warnings.length) {
    console.log('⚠️ 警告 (' + warnings.length + '):');
    for (const w of warnings) console.log('   - ' + w);
    console.log('');
  }
  if (errors.length) {
    console.log('❌ 致命错误 (' + errors.length + '):');
    for (const e of errors) console.log('   - ' + e);
    console.log('\n结果: 失败（存在致命错误）');
    process.exit(1);
  }
  console.log('✅ 数据完整性检查通过（无致命错误）');
  process.exit(0);
}

main();
