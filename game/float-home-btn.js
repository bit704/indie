/**
 * 悬浮主页按钮 — 公用组件
 * 用法：在任意页面 <body> 末尾引入 <script src="float-home-btn.js"></script>
 * 可选：window.FLOAT_HOME_URL = '/custom/path' 覆盖默认跳转地址
 */
(function () {
  var HOME_URL = window.FLOAT_HOME_URL || '../index.html';
  var CIRC = 175.9, DURATION = 800;
  var KEY = 'floatHomeBtnPos';

  // 创建 DOM
  var btn = document.createElement('div');
  btn.id = 'float-home-btn';
  btn.style.cssText = 'position:fixed;width:48px;height:48px;border-radius:50%;'
    + 'background:radial-gradient(circle at 35% 30%,rgba(255,255,255,0.25),rgba(40,40,50,0.85) 60%,rgba(10,10,15,0.95));'
    + 'backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.25);'
    + 'display:flex;align-items:center;justify-content:center;cursor:grab;'
    + 'z-index:999999;user-select:none;touch-action:none;font-size:22px;overflow:visible;'
    + 'box-shadow:0 4px 12px rgba(0,0,0,0.5),0 2px 4px rgba(0,0,0,0.3),'
    + 'inset 0 1px 1px rgba(255,255,255,0.2),inset 0 -2px 4px rgba(0,0,0,0.4);'
    + 'transition:box-shadow .2s,transform .1s;';

  btn.innerHTML =
    '<svg id="float-home-ring" style="position:absolute;top:50%;left:50%;'
    + 'transform:translate(-50%,-50%) rotate(-90deg);width:60px;height:60px;pointer-events:none;"'
    + ' viewBox="0 0 60 60">'
    + '<circle cx="30" cy="30" r="28" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="2"/>'
    + '<circle id="float-home-ring-fg" cx="30" cy="30" r="28" fill="none" '
    + 'stroke="rgba(255,255,255,0.85)" stroke-width="2.5" stroke-linecap="round" '
    + 'stroke-dasharray="175.9" stroke-dashoffset="175.9" '
    + 'style="transition:stroke-dashoffset .05s linear;filter:drop-shadow(0 0 3px rgba(255,255,255,0.5));"/>'
    + '</svg>'
    + '<span style="position:relative;z-index:1;filter:drop-shadow(0 1px 1px rgba(0,0,0,0.5));">🏠</span>'
    + '<div id="float-home-tip" style="position:absolute;bottom:calc(100% + 8px);left:50%;'
    + 'transform:translateX(-50%) translateY(4px);white-space:nowrap;background:rgba(0,0,0,0.85);'
    + 'color:#fff;font-size:12px;padding:5px 10px;border-radius:6px;pointer-events:none;'
    + 'opacity:0;transition:opacity .2s,transform .2s;z-index:2;">长按返回主页</div>';

  document.body.appendChild(btn);

  var ring = document.getElementById('float-home-ring-fg');
  var tip = document.getElementById('float-home-tip');

  // 恢复位置
  var pos = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (pos) { btn.style.left = pos.x + 'px'; btn.style.top = pos.y + 'px'; }
  else { btn.style.right = '20px'; btn.style.bottom = '20px'; }

  // 状态
  var dragging = false, sx, sy, bx, by, moved = false, pressTimer, rafId, startTime;

  function savePos() {
    var r = btn.getBoundingClientRect();
    var x = Math.max(0, Math.min(window.innerWidth - 48, r.left));
    var y = Math.max(0, Math.min(window.innerHeight - 48, r.top));
    btn.style.left = x + 'px'; btn.style.top = y + 'px';
    btn.style.right = 'auto'; btn.style.bottom = 'auto';
    localStorage.setItem(KEY, JSON.stringify({ x: x, y: y }));
  }

  function animateRing() {
    var elapsed = Date.now() - startTime;
    var progress = Math.min(elapsed / DURATION, 1);
    ring.style.strokeDashoffset = CIRC * (1 - progress);
    btn.style.transform = 'scale(' + (1 + progress * 0.15) + ')';
    btn.style.boxShadow = '0 0 ' + (progress * 20) + 'px rgba(255,255,255,' + (progress * 0.4) + ')';
    if (progress < 1 && dragging && !moved) { rafId = requestAnimationFrame(animateRing); }
  }

  function resetRing() {
    cancelAnimationFrame(rafId);
    ring.style.transition = 'stroke-dashoffset .2s ease, opacity .2s';
    ring.style.strokeDashoffset = CIRC;
    btn.style.transform = '';
    btn.style.boxShadow = '';
    setTimeout(function () { ring.style.transition = ''; }, 200);
  }

  function showTip() { tip.style.opacity = '1'; tip.style.transform = 'translateX(-50%) translateY(0)'; }
  function hideTip() { tip.style.opacity = '0'; tip.style.transform = 'translateX(-50%) translateY(4px)'; }

  function onStart(x, y) {
    sx = x; sy = y; var r = btn.getBoundingClientRect(); bx = r.left; by = r.top;
    moved = false; dragging = true;
    btn.style.cursor = 'grabbing'; btn.style.transition = 'none';
    ring.style.transition = '';
    startTime = Date.now();
    animateRing();
    showTip();
    pressTimer = setTimeout(function () { if (!moved) { window.location.href = HOME_URL; } }, DURATION);
  }

  function onMove(x, y) {
    if (!dragging) return;
    var dx = x - sx, dy = y - sy;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) { moved = true; clearTimeout(pressTimer); resetRing(); hideTip(); }
    btn.style.left = (bx + dx) + 'px'; btn.style.top = (by + dy) + 'px';
    btn.style.right = 'auto'; btn.style.bottom = 'auto';
  }

  function onEnd() {
    if (!dragging) return; dragging = false;
    btn.style.cursor = 'grab'; btn.style.transition = '';
    clearTimeout(pressTimer);
    resetRing();
    hideTip();
    if (moved) savePos();
  }

  // 事件绑定
  btn.addEventListener('mousedown', function (e) { e.preventDefault(); onStart(e.clientX, e.clientY); });
  document.addEventListener('mousemove', function (e) { onMove(e.clientX, e.clientY); });
  document.addEventListener('mouseup', onEnd);
  btn.addEventListener('touchstart', function (e) { e.preventDefault(); var t = e.touches[0]; onStart(t.clientX, t.clientY); }, { passive: false });
  document.addEventListener('touchmove', function (e) { if (dragging) { e.preventDefault(); var t = e.touches[0]; onMove(t.clientX, t.clientY); } }, { passive: false });
  document.addEventListener('touchend', onEnd);
  window.addEventListener('resize', savePos);
})();
