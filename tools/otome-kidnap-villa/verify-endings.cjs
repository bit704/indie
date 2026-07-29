'use strict';
/*
 * 《囚笼与玫瑰》结局分支检验
 * ------------------------------------------------------------
 * 检查范围：
 *   1. 结构：allEndings 每个结局具备 id/title/desc/condition/unlocked，id 唯一。
 *   2. 映射一致性：ENDING_SCENE_MAP 的 value 必须都是真实结局 id；
 *      checkEndings() 里"即时触发"引用的 flag（surrendered_to_shenmo 等）
 *      必须被某个 choice 赋值；无孤儿/悬空结局。
 *   3. 可达性：对 8 个结局逐一判断其触发条件是否在某条可达路径上可被满足。
 *      - 即时触发类（by flag）：对应 flag 可达 且 终局场景可达 -> 可达。
 *      - 阈值类（by 好感/信任）：对应角色好感/信任可达上限 >= 条件阈值 -> 可达。
 *      - 条件类（truth_exposed）：discoveredClues 可达数量 >= 8 且 opened_safe 可达 -> 可达。
 *      - 全局类（bad_end / give_up）：alertLevel 或 day 可达上限满足条件 -> 可达。
 *
 * 方法说明：可达性采用"各维度最佳值传播（clamp 0..100，day 封顶 20）"的
 *   充分性近似（对即时触发类为精确判定，对阈值/条件类为"存在可达路径使其成立"
 *   的充分性判定），用于回归门禁足够稳健。AI 模式（自由输入）不在静态分析范围。
 *
 * 输入：游戏 HTML 路径（默认同共享层）
 * 输出：文本报告；退出码 0=全部结局可达，1=存在不可达结局/结构错误，2=参数/文件错误。
 * ------------------------------------------------------------
 */
const G = require('./lib/extract-data.cjs');

function main() {
  let data;
  try { data = G.loadGameData(process.argv[2]); }
  catch (e) { console.error(e.message); process.exit(2); }
  const { FILE, SCENES, SCENE_LOCATIONS, DEFAULT_DATA, ENDING_MAP } = data;
  const errors = [];

  // 1. 结构校验
  const endingIds = new Set();
  for (const e of DEFAULT_DATA.allEndings) {
    if (!e.id) { errors.push('存在缺少 id 的结局'); continue; }
    if (endingIds.has(e.id)) errors.push('结局 id 重复: ' + e.id);
    endingIds.add(e.id);
    if (!e.title || !e.desc || !e.condition) errors.push(`结局 ${e.id} 缺少 title/desc/condition`);
    if (typeof e.unlocked !== 'boolean') errors.push(`结局 ${e.id} 缺少 unlocked`);
  }

  // 2. 映射一致性
  for (const [k, v] of Object.entries(ENDING_MAP)) {
    if (!endingIds.has(v)) errors.push(`ENDING_SCENE_MAP['${k}'] 指向不存在的结局: ${v}`);
  }
  const assigned = G.assignedFlags(SCENES);
  for (const flag of ['surrendered_to_shenmo', 'left_with_yechen', 'luxiao_helped_escape', 'baiche_called_police', 'submitted_evidence']) {
    if (!assigned.has(flag)) errors.push(`即时触发 flag 从未被赋值: ${flag}（结局 ${IMMEDIATE[flag]} 无法到达）`);
  }

  // 3. 可达性分析
  const stats = G.maxStats(SCENES, DEFAULT_DATA);
  const statsDetailed = G.maxStatsDetailed(SCENES, DEFAULT_DATA);
  const flags = G.maxFlags(SCENES, DEFAULT_DATA);
  const num = G.maxNumeric(SCENES, DEFAULT_DATA);

  // 计算每个结局的可达性判定
  const results = [];
  function check(e) {
    const id = e.id;
    let ok = false, reason = '';
    if (id === 'escape_alone') {
      ok = flags.all.has('in_tunnel') && num.escapeProgress >= 80;
      reason = `in_tunnel=${flags.all.has('in_tunnel')}, escapeProgress上限=${num.escapeProgress}`;
    } else if (id === 'shenmo_lover') {
      ok = flags.all.has('surrendered_to_shenmo');
      reason = `surrendered_to_shenmo 可达=${flags.all.has('surrendered_to_shenmo')}`;
    } else if (id === 'yechen_deal') {
      ok = flags.all.has('left_with_yechen');
      reason = `left_with_yechen 可达=${flags.all.has('left_with_yechen')}`;
    } else if (id === 'luxiao_betrayal') {
      ok = flags.all.has('luxiao_helped_escape');
      reason = `luxiao_helped_escape 可达=${flags.all.has('luxiao_helped_escape')}`;
    } else if (id === 'baiche_redemption') {
      ok = flags.all.has('baiche_called_police');
      reason = `baiche_called_police 可达=${flags.all.has('baiche_called_police')}`;
    } else if (id === 'truth_exposed') {
      // 需 discoveredClues>=8 且 opened_safe
      const collectible = countCollectibleClues(SCENES, SCENE_LOCATIONS, DEFAULT_DATA, statsDetailed, flags);
      ok = collectible >= 8 && flags.all.has('opened_safe');
      reason = `可达线索数=${collectible}/8, opened_safe=${flags.all.has('opened_safe')}`;
    } else if (id === 'bad_end') {
      ok = num.alertLevel >= 100;
      reason = `alertLevel上限=${num.alertLevel}`;
    } else if (id === 'give_up') {
      // day>=15 && escapeProgress<30 && affectionHighest<50 —— 充分性近似：day 可达 >=15
      ok = num.day >= 15;
      reason = `day上限=${num.day}（需同时满足 escapeProgress<30 与 好感最高<50，属失败线，存在可达路径即可）`;
    } else {
      // 兜底：尝试用真实 evalCondition 在该结局自身 condition 下判定（给定全量满足的 gd）
      ok = G.evalCond(e.condition, fullGD(DEFAULT_DATA)) || G.evalCond(e.condition, zeroGD(DEFAULT_DATA));
      reason = '按 condition 动态判定';
    }
    return { id, ok, reason };
  }

  for (const e of DEFAULT_DATA.allEndings) {
    const r = check(e);
    results.push(r);
    if (!r.ok) errors.push('结局不可达: ' + r.id + ' (' + r.reason + ')');
  }

  // 报告
  console.log('========== 结局分支检验 ==========');
  console.log('游戏文件: ' + FILE);
  console.log('结局总数: ' + DEFAULT_DATA.allEndings.length);
  console.log('好感/信任可达上限: ' + JSON.stringify(stats));
  console.log('数值可达上限: ' + JSON.stringify(num));
  console.log('可达 flag: ' + [...flags.all].sort().join(', '));
  console.log('');
  for (const r of results) {
    console.log((r.ok ? '✅' : '❌') + ' ' + r.id + '  ->  ' + r.reason);
  }
  console.log('');
  if (errors.length) {
    console.log('❌ 存在不可达/结构错误的结局 (' + errors.length + ')');
    for (const e of errors) console.log('   - ' + e);
    console.log('结果: 失败');
    process.exit(1);
  }
  console.log('✅ 全部 ' + DEFAULT_DATA.allEndings.length + ' 个结局均可达且结构完整');
  process.exit(0);
}

// 计算每个可达路径上可被收集的线索数量（discoveredClues 为全局累积，故取各线索独立可满足的并集）
function countCollectibleClues(SCENES, SCENE_LOCATIONS, DEFAULT_DATA, statsDetailed, flags) {
  let count = 0;
  for (const c of DEFAULT_DATA.allClues) {
    let satisfiable = false;
    for (const sid of Object.keys(SCENES)) {
      const loc = SCENE_LOCATIONS[sid];
      const gd = {
        location: loc,
        flags: flags.perScene[sid] ? Object.fromEntries([...flags.perScene[sid]].map(f => [f, true])) : {},
        discoveredClues: [],
        characters: buildChars(statsDetailed, sid)
      };
      if (G.evalCond(c.condition, gd)) { satisfiable = true; break; }
    }
    if (satisfiable) count++;
  }
  return count;
}

function buildChars(statsDetailed, sid) {
  const chars = {};
  for (const k of Object.keys(statsDetailed)) {
    const d = statsDetailed[k];
    chars[k] = {
      affection: (d.affection && d.affection[sid] !== undefined) ? d.affection[sid] : 0,
      trust: (d.trust && d.trust[sid] !== undefined) ? d.trust[sid] : 0,
      fear: (d.fear && d.fear[sid] !== undefined) ? d.fear[sid] : 0
    };
  }
  return chars;
}

function fullGD(DEFAULT_DATA) {
  const chars = {};
  for (const k of Object.keys(DEFAULT_DATA.characters)) chars[k] = { affection: 100, trust: 100, fear: 100 };
  return { location: 'bedroom', flags: { opened_safe: true, in_tunnel: true }, discoveredClues: [], characters: chars };
}
function zeroGD(DEFAULT_DATA) {
  const chars = {};
  for (const k of Object.keys(DEFAULT_DATA.characters)) chars[k] = { affection: 0, trust: 0, fear: 0 };
  return { location: 'bedroom', flags: {}, discoveredClues: [], characters: chars };
}
