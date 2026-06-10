/* F-001 Architecture Report — standalone viewer.
   Vanilla JS, no dependencies, inlined verbatim into the exported HTML (imported `?raw` by the
   generator). Boots from the embedded JSON and renders views, layers, audience modes, concerns,
   the change summary and the offline comment loop. All user-provided text is inserted via
   textContent — never innerHTML — so the file is XSS-safe wherever it travels. */
(function () {
  'use strict';

  var data = JSON.parse(document.getElementById('verso-report-data').textContent);
  var root = data.meta.rootPath;
  var LS = {
    state: 'verso.report.state:' + root,
    drafts: 'verso.report.drafts:' + root,
    author: 'verso.report.author',
  };

  // ---------- tiny DOM helpers ----------
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'text') el.textContent = attrs[k];
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  var SVGNS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, children) {
    var el = document.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') el.setAttribute('class', attrs[k]);
      else if (k === 'text') el.textContent = attrs[k];
      else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) { if (c) el.appendChild(c); });
    return el;
  }
  function lsGet(key, fallback) {
    try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
  }
  function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* file:// quota */ } }

  // ---------- model indices ----------
  var elById = {};
  data.model.elements.forEach(function (e) { elById[e.id] = e; });
  var tagById = {};
  (data.model.tags || []).forEach(function (t) { tagById[t.targetId] = t; });
  var CONCERN_KINDS = { question: 1, assumption: 1, risk: 1 };
  var KIND_LABEL = {
    module: 'Module', boundedContext: 'Bounded Context', softwareSystem: 'Software System',
    container: 'Container', person: 'Person', useCase: 'Use Case', capability: 'Capability',
    question: 'Question', assumption: 'Assumption', risk: 'Risk',
  };
  // Kind icons (lucide path data, ISC) + accent colours — same pairs as the canvas ArchNodeView.
  var KIND_ICON = {
    module: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7"/><path d="m7.5 4.27 9 5.15"/>',
    boundedContext: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>',
    softwareSystem: '<rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
    container: '<path d="m21.12 6.4-6.05-4.06a2 2 0 0 0-2.17-.05L2.95 8.41a2 2 0 0 0-.95 1.7v5.82a2 2 0 0 0 .88 1.66l6.05 4.07a2 2 0 0 0 2.17.05l9.95-6.12a2 2 0 0 0 .95-1.7V8.06a2 2 0 0 0-.88-1.66Z"/><path d="M10 22v-8L2.25 9.15"/><path d="m10 14 11.77-6.87"/>',
    person: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    useCase: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    capability: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
    question: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    assumption: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
    risk: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  };
  var KIND_ACCENT = {
    module: '#6366f1', boundedContext: '#8b5cf6', softwareSystem: '#10b981', container: '#34d399',
    person: '#f59e0b', useCase: '#f43f5e', capability: '#0ea5e9', question: '#0ea5e9',
    assumption: '#f59e0b', risk: '#f43f5e',
  };
  /** Inline lucide icon, coloured per kind. The markup is a static constant — never user input. */
  function kindIcon(kind, size) {
    var span = document.createElement('span');
    span.style.display = 'inline-flex';
    span.innerHTML = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="'
      + (KIND_ACCENT[kind] || '#6366f1') + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
      + (KIND_ICON[kind] || KIND_ICON.module) + '</svg>';
    return span.firstChild;
  }
  var REL_TYPE_VALUES = data.relationshipTypes.map(function (t) { return t.value; });
  function linkTypeOf(l) {
    var v = l.kind === 'dataFlow' ? (l.attributes.payload || '') : (l.attributes.kind || 'uses');
    return REL_TYPE_VALUES.indexOf(v) >= 0 ? v : (l.kind === 'dataFlow' ? '(data flow)' : '(other)');
  }
  var STATUS_COLOR = {
    current: '#10b981', target: '#6366f1', 'to-adapt': '#f59e0b',
    'to-be-created': '#f59e0b', deprecated: '#a1a1aa', proposed: '#0ea5e9',
  };
  function statusOf(id) { var t = tagById[id]; return (t && t.lifecycle && t.lifecycle.status) || ''; }
  function phaseOf(id) { var t = tagById[id]; return (t && t.lifecycle && t.lifecycle.phase) || ''; }
  function squadOf(id) { var t = tagById[id]; return (t && t.ownership && t.ownership.squad) || ''; }

  // ---------- state ----------
  var saved = lsGet(LS.state, {});
  var state = {
    page: saved.page || 'moduleMap',
    mode: saved.mode || 'builder',
    theme: saved.theme || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    layersOpen: false,
    layers: saved.layers || null,   // set by applyMode below when null
    selected: null,                 // { type:'element'|'link', id }
    panZoom: {},                    // viewKey -> {x,y,scale-ish viewBox}
  };
  var drafts = lsGet(LS.drafts, []);

  function defaultLayers() {
    var kinds = {}; ['module', 'softwareSystem', 'container', 'person', 'useCase', 'capability'].forEach(function (k) { kinds[k] = true; });
    var rel = {}; REL_TYPE_VALUES.concat(['(data flow)', '(other)']).forEach(function (t) { rel[t] = true; });
    return { kinds: kinds, rel: rel, concerns: true, status: true, bc: true, notes: true, ids: true };
  }
  function applyMode(mode) {
    state.mode = mode;
    var L = defaultLayers();
    if (mode === 'stakeholder') { L.ids = false; L.notes = false; L.concerns = false; state.page = 'summary'; }
    if (mode === 'builder') { L.concerns = false; }
    if (mode === 'reviewer') { L.concerns = true; }
    state.layers = L;
    persistState();
  }
  if (!state.layers) applyMode(state.mode);
  function persistState() {
    lsSet(LS.state, { page: state.page, mode: state.mode, theme: state.theme, layers: state.layers });
  }

  // ---------- view membership ----------
  function viewByKey(key) { for (var i = 0; i < data.views.length; i++) if (data.views[i].key === key) return data.views[i]; return null; }
  function kindAllowedInView(view, kind) {
    if (view.baseView === 'dependencyGraph' || view.key === 'dependencyGraph') {
      return kind === 'module' || kind === 'boundedContext' || kind === 'capability';
    }
    return true;
  }
  function elementsInView(view) {
    return data.model.elements.filter(function (e) {
      if (view.elementIds && view.elementIds.indexOf(e.id) < 0) return false;
      return kindAllowedInView(view, e.kind);
    });
  }
  /** Elements actually drawn given the layer toggles. */
  function visibleElements(view) {
    return elementsInView(view).filter(function (e) {
      if (e.kind === 'boundedContext') return state.layers.bc;
      if (CONCERN_KINDS[e.kind]) return state.layers.concerns;
      return state.layers.kinds[e.kind] !== false;
    });
  }
  function visibleLinks(view, visIds) {
    return data.model.links.filter(function (l) {
      if (view.key === 'dependencyGraph' && l.kind !== 'dependency') return false;
      if (!visIds[l.fromId] || !visIds[l.toId]) return false;
      return state.layers.rel[linkTypeOf(l)] !== false;
    });
  }

  // ---------- geometry ----------
  function nodeSize(e) {
    var st = data.nodeStyles[e.id] || {};
    if (e.kind === 'person') {
      return { w: st.width || Math.max(130, e.name.length * 7 + 70), h: st.height || 42 };
    }
    var w = st.width || 200;
    var hgt = st.height;
    if (!hgt) {
      hgt = 58; // header + name + padding
      if (state.layers.ids) hgt += 14;
      if (e.attributes.contextId && elById[e.attributes.contextId]) hgt += 13;
      if (state.layers.notes) {
        var props = data.customProps[e.id] || {};
        hgt += Math.min(Object.keys(props).length, 2) * 13;
        if (squadOf(e.id)) hgt += 13;
        if (data.notes[e.id]) hgt += 42;
      }
      hgt = Math.max(hgt, 72);
    }
    return { w: w, h: hgt };
  }
  function positionsFor(view) {
    var saved = data.positions[view.key] || {};
    var out = {}, missing = [];
    elementsInView(view).forEach(function (e) {
      if (saved[e.id]) out[e.id] = saved[e.id]; else missing.push(e.id);
    });
    missing.forEach(function (id, i) {  // simple grid fallback for never-placed elements
      out[id] = { x: (i % 5) * 240, y: 600 + Math.floor(i / 5) * 140 };
    });
    return out;
  }
  function dockPoint(e, pos, dock) {
    var sz = nodeSize(e);
    switch (dock) {
      case 't1': return { x: pos.x + sz.w * 0.33, y: pos.y, nx: 0, ny: -1 };
      case 't2': return { x: pos.x + sz.w * 0.67, y: pos.y, nx: 0, ny: -1 };
      case 'b1': return { x: pos.x + sz.w * 0.33, y: pos.y + sz.h, nx: 0, ny: 1 };
      case 'b2': return { x: pos.x + sz.w * 0.67, y: pos.y + sz.h, nx: 0, ny: 1 };
      case 'l': return { x: pos.x, y: pos.y + sz.h / 2, nx: -1, ny: 0 };
      case 'r': return { x: pos.x + sz.w, y: pos.y + sz.h / 2, nx: 1, ny: 0 };
    }
    return null;
  }
  function autoDocks(a, aPos, b, bPos) {
    var as = nodeSize(a), bs = nodeSize(b);
    var ax = aPos.x + as.w / 2, ay = aPos.y + as.h / 2;
    var bx = bPos.x + bs.w / 2, by = bPos.y + bs.h / 2;
    var dx = bx - ax, dy = by - ay;
    if (Math.abs(dx) >= Math.abs(dy)) {
      return {
        s: { x: dx >= 0 ? aPos.x + as.w : aPos.x, y: ay, nx: dx >= 0 ? 1 : -1, ny: 0 },
        t: { x: dx >= 0 ? bPos.x : bPos.x + bs.w, y: by, nx: dx >= 0 ? -1 : 1, ny: 0 },
      };
    }
    return {
      s: { x: ax, y: dy >= 0 ? aPos.y + as.h : aPos.y, nx: 0, ny: dy >= 0 ? 1 : -1 },
      t: { x: bx, y: dy >= 0 ? bPos.y : bPos.y + bs.h, nx: 0, ny: dy >= 0 ? -1 : 1 },
    };
  }
  function edgeEndpoints(view, l, pos) {
    var a = elById[l.fromId], b = elById[l.toId];
    var hp = (data.handles[view.key] || {})[l.id];
    var sp = hp && hp.source ? dockPoint(a, pos[l.fromId], hp.source) : null;
    var tp = hp && hp.target ? dockPoint(b, pos[l.toId], hp.target) : null;
    if (sp && tp) return { s: sp, t: tp };
    var auto = autoDocks(a, pos[l.fromId], b, pos[l.toId]);
    return { s: sp || auto.s, t: tp || auto.t };
  }
  function edgePath(sp, tp, waypoints) {
    var pts = [sp].concat(waypoints || []).concat([tp]);
    if (pts.length === 2) {
      var d = Math.max(40, Math.min(120, Math.hypot(tp.x - sp.x, tp.y - sp.y) / 2));
      var c1 = { x: sp.x + sp.nx * d, y: sp.y + sp.ny * d };
      var c2 = { x: tp.x + tp.nx * d, y: tp.y + tp.ny * d };
      return 'M' + sp.x + ',' + sp.y + ' C' + c1.x + ',' + c1.y + ' ' + c2.x + ',' + c2.y + ' ' + tp.x + ',' + tp.y;
    }
    var path = 'M' + pts[0].x + ',' + pts[0].y;
    for (var i = 1; i < pts.length; i++) {
      var p = pts[i - 1], q = pts[i];
      var mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
      path += ' Q' + p.x + ',' + p.y + ' ' + mx + ',' + my;
      if (i === pts.length - 1) path += ' T' + q.x + ',' + q.y;
    }
    return path;
  }
  function midOf(sp, tp, waypoints) {
    if (waypoints && waypoints.length) return waypoints[Math.floor(waypoints.length / 2)];
    return { x: (sp.x + tp.x) / 2, y: (sp.y + tp.y) / 2 };
  }

  // ---------- comments ----------
  function allComments() { return data.comments.concat(drafts); }
  function commentsFor(targetId) {
    return allComments().filter(function (c) { return c.targetId === targetId; });
  }
  function isDraft(c) { return drafts.indexOf(c) >= 0; }
  function authorName() {
    var a = lsGet(LS.author, '');
    if (!a) {
      a = (window.prompt('Your name (shown on your comments):') || 'anonymous').trim() || 'anonymous';
      lsSet(LS.author, a);
    }
    return a;
  }
  function addDraft(targetKind, targetId, body) {
    drafts.push({
      id: 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      targetKind: targetKind, targetId: targetId,
      author: authorName(), createdAt: new Date().toISOString(),
      body: body, resolved: false, thread: [],
    });
    lsSet(LS.drafts, drafts);
  }
  function exportPack() {
    if (!drafts.length) { toast('No new comments to export yet.'); return; }
    var pack = {
      version: 1, kind: 'verso-comment-pack',
      exportedAt: new Date().toISOString(),
      author: lsGet(LS.author, 'anonymous'),
      workspaceRoot: root,
      comments: drafts,
    };
    var blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = data.meta.workspace + '.comments.verso.json';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Comment pack exported — send it to the architecture owner.');
  }

  // ---------- toast ----------
  var toastEl = h('div', { class: 'vr-toast' });
  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }

  // ---------- shell ----------
  var app = document.getElementById('app');
  function setTheme(t) { state.theme = t; document.body.classList.toggle('vr-dark', t === 'dark'); persistState(); }
  setTheme(state.theme);

  var railEl, mainEl, panelEl, layersBtn, modeBtns = [];
  function buildShell() {
    app.textContent = '';
    var logo = s('svg', { width: '20', height: '20', viewBox: '0 0 24 24' }, [
      s('rect', { x: '2', y: '2', width: '20', height: '20', rx: '5', fill: '#6366f1' }),
      s('path', { d: 'M7 7l5 10 5-10', stroke: '#fff', 'stroke-width': '2.2', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
    ]);
    modeBtns = ['builder', 'stakeholder', 'reviewer'].map(function (m) {
      var b = h('button', {
        class: 'vr-mode' + (state.mode === m ? ' active' : ''),
        text: m.charAt(0).toUpperCase() + m.slice(1),
        title: m === 'builder' ? 'Full detail for implementers' : m === 'stakeholder' ? 'Plain-language summary and status' : 'Everything + concerns for architecture review',
        onclick: function () { applyMode(m); render(); },
      });
      b.dataset.mode = m;
      return b;
    });
    var modes = h('div', { class: 'vr-modes' }, modeBtns);
    layersBtn = h('button', {
      class: 'vr-iconbtn' + (state.layersOpen ? ' active' : ''), title: 'Show / hide layers',
      onclick: function () { state.layersOpen = !state.layersOpen; render(); },
    });
    layersBtn.appendChild(s('svg', { width: '15', height: '15', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, [
      s('path', { d: 'M12 2 2 7l10 5 10-5-10-5z' }), s('path', { d: 'M2 17l10 5 10-5' }), s('path', { d: 'M2 12l10 5 10-5' }),
    ]));
    var themeBtn = h('button', {
      class: 'vr-iconbtn', title: 'Toggle dark / light',
      onclick: function () { setTheme(state.theme === 'dark' ? 'light' : 'dark'); },
    }, ['◐']);
    var top = h('div', { class: 'vr-topbar' }, [
      h('span', { class: 'vr-logo' }, [logo, h('span', { text: 'Verso' })]),
      h('span', { class: 'vr-title', text: data.meta.workspace + ' — Architecture Report' }),
      h('span', { class: 'vr-meta', text: 'exported ' + new Date(data.meta.exportedAt).toLocaleString() }),
      h('div', { class: 'vr-spacer' }),
      modes, layersBtn, themeBtn,
    ]);
    railEl = h('aside', { class: 'vr-rail' });
    mainEl = h('div', { class: 'vr-main' });
    panelEl = null;
    app.appendChild(top);
    app.appendChild(h('div', { class: 'vr-body' }, [railEl, mainEl]));
    app.appendChild(toastEl);
  }

  // ---------- rail ----------
  function navTo(page) { state.selected = null; state.page = page; persistState(); render(); try { location.hash = 'p=' + encodeURIComponent(page); } catch (e) { /* file:// */ } }
  function buildRail() {
    railEl.textContent = '';
    var input = h('input', { placeholder: 'Search elements…  ( / )', 'aria-label': 'Search elements' });
    var results = h('div', { class: 'vr-search-results', style: 'display:none' });
    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      results.textContent = '';
      if (!q) { results.style.display = 'none'; return; }
      var hits = data.model.elements.filter(function (e) {
        return e.name.toLowerCase().indexOf(q) >= 0 || e.id.toLowerCase().indexOf(q) >= 0;
      }).slice(0, 12);
      hits.forEach(function (e) {
        var b = h('button', { onclick: function () { input.value = ''; results.style.display = 'none'; jumpToElement(e.id); } });
        b.appendChild(h('span', { class: 'kind', text: KIND_LABEL[e.kind] || e.kind }));
        b.appendChild(document.createTextNode(e.name));
        results.appendChild(b);
      });
      if (!hits.length) results.appendChild(h('div', { class: 'vr-empty', text: 'No matches' }));
      results.style.display = 'block';
    });
    input.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { input.value = ''; results.style.display = 'none'; input.blur(); } });
    searchInput = input;
    railEl.appendChild(h('div', { class: 'vr-search' }, [input, results]));

    var pagesWrap = h('div', {}, [h('h3', { text: 'Report' })]);
    var concernCount = data.model.elements.filter(function (e) { return CONCERN_KINDS[e.kind]; }).length;
    var commentCount = allComments().length;
    [['summary', 'Summary & changes', null],
     ['concerns', 'Concerns', concernCount],
     ['comments', 'Comments', commentCount]].forEach(function (p) {
      var item = h('button', { class: 'vr-navitem' + (state.page === p[0] ? ' active' : ''), onclick: function () { navTo(p[0]); } }, [
        h('span', { text: p[1] }),
      ]);
      if (p[2] !== null) item.appendChild(h('span', { class: 'count', text: String(p[2]) }));
      pagesWrap.appendChild(item);
    });
    railEl.appendChild(pagesWrap);

    var viewsWrap = h('div', {}, [h('h3', { text: 'Views' })]);
    data.views.forEach(function (v) {
      var n = elementsInView(v).length;
      var item = h('button', { class: 'vr-navitem' + (state.page === v.key ? ' active' : ''), onclick: function () { navTo(v.key); } }, [
        h('span', { text: v.name }),
        h('span', { class: 'count', text: String(n) }),
      ]);
      viewsWrap.appendChild(item);
    });
    railEl.appendChild(viewsWrap);

    railEl.appendChild(h('div', { class: 'vr-hint', style: 'margin-top:auto;padding:0 6px', text: 'Read-only export. Comments you write here stay local until you export the comment pack.' }));
  }

  // ---------- canvas ----------
  var svgEl = null, currentViewKey = null;
  function viewBoxFor(view, pos) {
    if (state.panZoom[view.key]) return state.panZoom[view.key];
    var els = visibleElements(view);
    if (!els.length) return { x: -100, y: -100, w: 1200, h: 800 };
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    els.forEach(function (e) {
      var p = pos[e.id], sz = nodeSize(e);
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + sz.w); maxY = Math.max(maxY, p.y + sz.h);
    });
    var pad = 80;
    return { x: minX - pad, y: minY - pad, w: Math.max(600, maxX - minX + pad * 2), h: Math.max(400, maxY - minY + pad * 2) };
  }
  function fitView() { if (currentViewKey) { delete state.panZoom[currentViewKey]; render(); } }
  function zoomBy(factor) {
    if (!svgEl || !currentViewKey) return;
    var vb = state.panZoom[currentViewKey] || parseVB();
    var cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2;
    vb.w /= factor; vb.h /= factor;
    vb.x = cx - vb.w / 2; vb.y = cy - vb.h / 2;
    state.panZoom[currentViewKey] = vb;
    svgEl.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h);
  }
  function parseVB() {
    var p = svgEl.getAttribute('viewBox').split(' ').map(Number);
    return { x: p[0], y: p[1], w: p[2], h: p[3] };
  }

  function markerId(type, color) { return 'm-' + type + '-' + color.replace(/[^a-z0-9]/gi, ''); }
  function buildMarker(type, color) {
    var m = s('marker', {
      id: markerId(type, color), viewBox: '-10 -10 20 20', markerWidth: '11', markerHeight: '11',
      refX: '0', refY: '0', orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse',
    });
    if (type === 'open') {
      m.appendChild(s('polyline', { points: '-6,-5 0,0 -6,5', fill: 'none', stroke: color, 'stroke-width': '1.6', 'stroke-linecap': 'round' }));
    } else if (type === 'circle') {
      m.appendChild(s('circle', { cx: '-3', cy: '0', r: '3.4', fill: color }));
    } else if (type === 'diamond') {
      m.appendChild(s('path', { d: 'M0 0 L-5 -4 L-10 0 L-5 4 Z', fill: color }));
    } else if (type === 'pipe') {
      m.appendChild(s('path', { d: 'M-1 -5 L-1 5', stroke: color, 'stroke-width': '2' }));
    } else {
      m.appendChild(s('polyline', { points: '-6,-4.5 0,0 -6,4.5 -6,-4.5', fill: color, stroke: color, 'stroke-linejoin': 'round' }));
    }
    return m;
  }

  var STATUS_GLYPH = { current: '●', target: '◆', 'to-adapt': '◇', 'to-be-created': '○', deprecated: '━', proposed: '◌' };
  function statusBadgeEl(status) {
    var b = h('span', { class: 'vrn-badge st-' + status });
    b.appendChild(h('span', { text: (STATUS_GLYPH[status] || '') + ' ' }));
    b.appendChild(document.createTextNode(status));
    return b;
  }

  var SHADOWS = {
    none: 'none',
    soft: 'drop-shadow(0 1px 2px rgba(0,0,0,0.16))',
    raised: 'drop-shadow(0 6px 10px rgba(0,0,0,0.22))',
  };

  /** A node card mirroring the canvas ArchNodeView: header (icon + kind + status badge), body
   *  (name, id, context, props, squad, notes), custom node styles (fills, borders, shadows,
   *  accent bars), lifecycle looks and motion effects. All text via textContent. */
  function buildNodeCard(e) {
    var st = data.nodeStyles[e.id] || {};
    var status = statusOf(e.id);
    var sel = state.selected && state.selected.type === 'element' && state.selected.id === e.id;
    var isPerson = e.kind === 'person';
    var hasCustomStyle = !!(st.fillColor || st.borderColor || st.borderStyle || st.fillStyle || st.shadow);
    var isExternal = e.attributes.external === 'true' || e.attributes.role === 'external';

    var card = h('div', { class: 'vrn' + (isPerson ? ' vrn-person' : '') + (sel ? ' sel' : '') });
    if (!hasCustomStyle && status) card.classList.add('vrn-st-' + status);

    // ---- custom appearance (mirrors ArchNodeView inlineStyle) ----
    var fill = st.fillColor;
    if (st.fillStyle === 'gradient') {
      card.style.background = fill
        ? 'linear-gradient(160deg, color-mix(in srgb, ' + fill + ', white 24%), ' + fill + ')'
        : 'linear-gradient(160deg, rgba(99,102,241,0.14), rgba(99,102,241,0.02))';
    } else if (st.fillStyle === 'glass') {
      card.style.background = fill ? 'color-mix(in srgb, ' + fill + ', transparent 55%)' : 'rgba(255,255,255,0.4)';
      card.style.backdropFilter = 'blur(6px)';
    } else if (st.fillStyle === 'hatch') {
      var hc = fill || 'rgba(148,163,184,0.45)';
      card.style.backgroundImage = 'repeating-linear-gradient(45deg, ' + hc + ' 0 5px, transparent 5px 11px)';
    } else if (fill) {
      card.style.background = fill;
    }
    if (st.borderColor) card.style.borderColor = st.borderColor;
    if (st.borderWidth !== undefined) card.style.borderWidth = st.borderWidth + 'px';
    if (st.borderStyle) card.style.borderStyle = st.borderStyle;
    if (st.radius !== undefined && !isPerson) card.style.borderRadius = st.radius + 'px';
    if (st.opacity !== undefined) card.style.opacity = String(st.opacity);
    if (st.shadow === 'glow') card.style.filter = 'drop-shadow(0 0 6px ' + (st.borderColor || 'rgb(99,102,241)') + ')';
    else if (st.shadow && SHADOWS[st.shadow]) card.style.filter = SHADOWS[st.shadow];
    if (isExternal) {
      if (!st.borderStyle) card.style.borderStyle = 'dashed';
      if (!fill && st.fillStyle === undefined) card.style.background = 'rgba(148, 163, 184, 0.08)';
    }

    // ---- motion (mirrors verso-anim-*) ----
    var anim = st.animation || (st.animated ? 'marching' : 'none');
    var dur = st.animationSpeed === 'slow' ? '2.6s' : st.animationSpeed === 'fast' ? '0.7s' : '1.5s';
    if (anim && anim !== 'none' && anim !== 'marching') {
      card.classList.add('vrn-anim-' + anim);
      card.style.setProperty('--anim-dur', dur);
      if (anim === 'glow') card.style.setProperty('--glow', st.borderColor || 'rgba(99,102,241,0.55)');
    }
    if (anim === 'marching') {
      var march = h('div', { class: 'vrn-march' });
      march.style.setProperty('--march', st.borderColor || 'rgb(99 102 241)');
      card.appendChild(march);
    }
    if (st.accentSide && st.accentSide !== 'none') {
      var bar = h('div', { class: 'vrn-accent ' + st.accentSide });
      bar.style.background = st.accentColor || st.borderColor || 'rgb(99 102 241)';
      card.appendChild(bar);
    }

    // ---- comment indicator ----
    var cc = commentsFor(e.id).length;
    if (cc) card.appendChild(h('span', { class: 'vrn-cdot', text: String(cc) }));

    // ---- title typography ----
    var nameCls = 'vrn-name' + (st.textSize === 'sm' ? ' sm' : st.textSize === 'lg' ? ' lg' : '');
    function nameEl() {
      var n = h('div', { class: nameCls, text: e.name });
      if (st.textColor) n.style.color = st.textColor;
      if (st.textAlign === 'center') n.style.textAlign = 'center';
      return n;
    }

    if (isPerson) {
      card.appendChild(kindIcon('person', 13));
      card.appendChild(nameEl());
      if (state.layers.status && status) card.appendChild(statusBadgeEl(status));
    } else {
      var head = h('div', { class: 'vrn-head' });
      head.appendChild(kindIcon(e.kind, 13));
      head.appendChild(h('span', { class: 'vrn-kind', text: KIND_LABEL[e.kind] || e.kind }));
      if (isExternal) head.appendChild(h('span', { class: 'vrn-ext', text: 'external' }));
      if (state.layers.status && status) head.appendChild(statusBadgeEl(status));
      card.appendChild(head);

      var body = h('div', { class: 'vrn-body' });
      body.appendChild(nameEl());
      if (state.layers.ids) body.appendChild(h('div', { class: 'vrn-sub mono', text: e.id }));
      var ctx = e.attributes.contextId && elById[e.attributes.contextId];
      if (ctx) {
        var ctxRow = h('div', { class: 'vrn-sub' });
        ctxRow.appendChild(document.createTextNode('in '));
        ctxRow.appendChild(h('b', { text: ctx.name }));
        body.appendChild(ctxRow);
      }
      if (state.layers.notes) {
        var props = data.customProps[e.id] || {};
        Object.keys(props).slice(0, 2).forEach(function (k) {
          body.appendChild(h('div', { class: 'vrn-sub', text: k + ': ' + props[k] }));
        });
        var sq = squadOf(e.id);
        if (sq) body.appendChild(h('div', { class: 'vrn-sub', text: '👥 ' + sq }));
        if (data.notes[e.id]) body.appendChild(h('div', { class: 'vrn-notes', text: data.notes[e.id] }));
      }
      card.appendChild(body);
    }

    card.addEventListener('click', function (ev) { ev.stopPropagation(); select('element', e.id); });
    return card;
  }

  function renderView(view) {
    var pos = positionsFor(view);
    var els = visibleElements(view);
    var visIds = {}; els.forEach(function (e) { visIds[e.id] = true; });
    var links = visibleLinks(view, visIds);
    var vb = viewBoxFor(view, pos);

    svgEl = s('svg', { class: 'vr-canvas', viewBox: vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h, role: 'img', 'aria-label': view.name });
    var defs = s('defs');
    var markerSeen = {};
    svgEl.appendChild(defs);
    var dotPattern = s('pattern', { id: 'vr-dots', width: '22', height: '22', patternUnits: 'userSpaceOnUse' }, [
      s('circle', { cx: '1', cy: '1', r: '1', fill: 'var(--vr-canvas-dot)' }),
    ]);
    defs.appendChild(dotPattern);
    svgEl.appendChild(s('rect', { x: vb.x - 4000, y: vb.y - 4000, width: vb.w + 8000, height: vb.h + 8000, fill: 'url(#vr-dots)', class: 'vr-pane' }));

    // Bounded-context boxes behind everything.
    if (state.layers.bc) {
      els.filter(function (e) { return e.kind === 'boundedContext'; }).forEach(function (bc) {
        var members = els.filter(function (e) { return e.attributes.contextId === bc.id; });
        var bx, by, bw, bh;
        if (members.length) {
          var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
          members.forEach(function (m) {
            var p = pos[m.id], sz = nodeSize(m);
            minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x + sz.w); maxY = Math.max(maxY, p.y + sz.h);
          });
          bx = minX - 26; by = minY - 40; bw = maxX - minX + 52; bh = maxY - minY + 66;
        } else {
          var p0 = pos[bc.id], s0 = nodeSize(bc);
          bx = p0.x; by = p0.y; bw = s0.w; bh = s0.h;
        }
        var g = s('g', { class: 'vr-bc' }, [
          s('rect', { x: bx, y: by, width: bw, height: bh }),
        ]);
        // Header chip like the canvas BcContainer (icon + name + member count).
        var chipFo = s('foreignObject', { x: bx + 10, y: by - 11, width: bw - 20, height: 24 });
        var chip = h('span', { class: 'vr-bc-chip' });
        chip.appendChild(kindIcon('boundedContext', 11));
        chip.appendChild(h('span', { text: bc.name }));
        if (members.length) chip.appendChild(h('span', { class: 'n', text: '· ' + members.length }));
        chip.addEventListener('click', function (ev) { ev.stopPropagation(); select('element', bc.id); });
        chipFo.appendChild(chip);
        g.appendChild(chipFo);
        g.addEventListener('click', function (ev) { ev.stopPropagation(); select('element', bc.id); });
        svgEl.appendChild(g);
      });
    }

    // Edges under nodes.
    links.forEach(function (l) {
      var st = data.edgeStyles[l.id] || {};
      var color = st.color || '#94a3b8';
      var thickness = st.thickness || 1.5;
      var isFlow = l.kind === 'dataFlow';
      var wps = (data.waypoints[view.key] || {})[l.id];
      var dash = st.lineStyle === 'dashed' ? '8 4' : st.lineStyle === 'dotted' ? '2 4' : (st.lineStyle === 'solid' ? null : (isFlow ? null : '4 4'));
      // Flow animation — same default rule as the canvas: dependencies with a plain solid line
      // and no waypoints march by default; explicit `animated` wins either way.
      var animated = st.animated != null ? st.animated
        : (!isFlow && (st.lineStyle || 'solid') === 'solid' && !(wps && wps.length));
      if (animated) dash = '5';
      var ends = edgeEndpoints(view, l, pos);
      var d = edgePath(ends.s, ends.t, wps);
      var aEnd = st.arrowEnd != null ? st.arrowEnd : (st.arrow != null ? st.arrow : 'closed');
      var aStart = st.arrowStart || 'none';
      [aEnd, aStart].forEach(function (a) {
        if (a && a !== 'none' && !markerSeen[markerId(a, color)]) { defs.appendChild(buildMarker(a, color)); markerSeen[markerId(a, color)] = 1; }
      });
      var sel = state.selected && state.selected.type === 'link' && state.selected.id === l.id;
      var lineClass = 'line' + (animated ? ' vr-flow' + (st.animSpeed === 'slow' ? ' slow' : st.animSpeed === 'fast' ? ' fast' : '') : '');
      var attrs = { d: d, class: lineClass, stroke: color, 'stroke-width': sel ? thickness + 1 : thickness };
      if (dash) attrs['stroke-dasharray'] = dash;
      if (aEnd && aEnd !== 'none') attrs['marker-end'] = 'url(#' + markerId(aEnd, color) + ')';
      if (aStart && aStart !== 'none') attrs['marker-start'] = 'url(#' + markerId(aStart, color) + ')';
      var g = s('g', { class: 'vr-edge' + (sel ? ' sel' : '') }, [
        s('path', attrs),
        s('path', { d: d, class: 'hit' }),
      ]);
      var label = isFlow ? (l.attributes.payload || '') : (l.attributes.kind || 'uses');
      if (label) {
        var mid = midOf(ends.s, ends.t, wps);
        var lw = label.length * 5.9 + 10;
        g.appendChild(s('g', { class: 'vr-edgelabel' + (sel ? ' sel' : '') }, [
          s('rect', { x: mid.x - lw / 2, y: mid.y - 8.5, width: lw, height: 16 }),
          s('text', { x: mid.x, y: mid.y + 3.5, 'text-anchor': 'middle', text: label }),
        ]));
      }
      g.addEventListener('click', function (ev) { ev.stopPropagation(); select('link', l.id); });
      svgEl.appendChild(g);
    });

    // Concern "about" links.
    if (state.layers.concerns) {
      els.filter(function (e) { return CONCERN_KINDS[e.kind] && e.attributes.aboutId && visIds[e.attributes.aboutId]; }).forEach(function (c) {
        var ends = autoDocks(c, pos[c.id], elById[c.attributes.aboutId], pos[c.attributes.aboutId]);
        svgEl.appendChild(s('path', {
          d: edgePath(ends.s, ends.t, null), fill: 'none', stroke: '#a1a1aa',
          'stroke-dasharray': '3 4', 'stroke-width': '1.2', opacity: '0.75',
        }));
      });
    }

    // Nodes — HTML cards inside foreignObjects, styled like the canvas ArchNodeView.
    els.filter(function (e) { return e.kind !== 'boundedContext'; }).forEach(function (e) {
      var p = pos[e.id], sz = nodeSize(e);
      var fo = s('foreignObject', { x: p.x, y: p.y, width: sz.w, height: sz.h });
      fo.appendChild(buildNodeCard(e));
      svgEl.appendChild(fo);
    });

    // Pan / zoom.
    var panning = null;
    svgEl.addEventListener('mousedown', function (ev) {
      if (ev.button !== 0) return;
      panning = { x: ev.clientX, y: ev.clientY, vb: state.panZoom[view.key] || parseVB() };
      svgEl.classList.add('panning');
    });
    window.addEventListener('mousemove', function (ev) {
      if (!panning) return;
      var rect = svgEl.getBoundingClientRect();
      var vb = panning.vb;
      var k = vb.w / rect.width;
      var nx = vb.x - (ev.clientX - panning.x) * k;
      var ny = vb.y - (ev.clientY - panning.y) * k;
      var cur = { x: nx, y: ny, w: vb.w, h: vb.h };
      state.panZoom[view.key] = cur;
      svgEl.setAttribute('viewBox', nx + ' ' + ny + ' ' + vb.w + ' ' + vb.h);
    });
    window.addEventListener('mouseup', function () { panning = null; if (svgEl) svgEl.classList.remove('panning'); });
    svgEl.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var vb = state.panZoom[view.key] || parseVB();
      var rect = svgEl.getBoundingClientRect();
      var mx = vb.x + (ev.clientX - rect.left) / rect.width * vb.w;
      var my = vb.y + (ev.clientY - rect.top) / rect.height * vb.h;
      var f = ev.deltaY > 0 ? 1.12 : 1 / 1.12;
      vb.w *= f; vb.h *= f;
      vb.x = mx - (mx - vb.x) * f;
      vb.y = my - (my - vb.y) * f;
      state.panZoom[view.key] = vb;
      svgEl.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h);
    }, { passive: false });
    svgEl.addEventListener('click', function () { select(null); });

    var wrap = h('div', { class: 'vr-canvas-wrap' });
    wrap.appendChild(svgEl);
    wrap.appendChild(h('div', { class: 'vr-viewtitle', text: view.name }));
    var zoomctl = h('div', { class: 'vr-zoomctl' }, [
      h('button', { text: '+', title: 'Zoom in', onclick: function () { zoomBy(1.25); } }),
      h('button', { text: '−', title: 'Zoom out', onclick: function () { zoomBy(0.8); } }),
      h('button', { text: '⛶', title: 'Fit view', onclick: fitView }),
    ]);
    wrap.appendChild(zoomctl);
    if (state.layersOpen) wrap.appendChild(buildLayersPanel());
    return wrap;
  }

  function buildLayersPanel() {
    var panel = h('div', { class: 'vr-layers' });
    function check(label, checked, onchange, swatchColor) {
      var cb = h('input', { type: 'checkbox' });
      cb.checked = checked;
      cb.addEventListener('change', function () { onchange(cb.checked); persistState(); render(); });
      var lab = h('label', {}, [cb]);
      if (swatchColor) lab.appendChild(h('span', { class: 'swatch', style: 'border-color:' + swatchColor }));
      lab.appendChild(document.createTextNode(label));
      return lab;
    }
    panel.appendChild(h('h4', { text: 'Elements' }));
    Object.keys(state.layers.kinds).forEach(function (k) {
      panel.appendChild(check(KIND_LABEL[k] || k, state.layers.kinds[k], function (v) { state.layers.kinds[k] = v; }));
    });
    panel.appendChild(check('Bounded contexts', state.layers.bc, function (v) { state.layers.bc = v; }));
    panel.appendChild(h('h4', { text: 'Relationships' }));
    data.relationshipTypes.forEach(function (t) {
      panel.appendChild(check(t.value, state.layers.rel[t.value] !== false, function (v) { state.layers.rel[t.value] = v; }, t.style.color || '#71717a'));
    });
    panel.appendChild(check('data flows (other)', state.layers.rel['(data flow)'] !== false, function (v) { state.layers.rel['(data flow)'] = v; }, '#06b6d4'));
    panel.appendChild(check('other kinds', state.layers.rel['(other)'] !== false, function (v) { state.layers.rel['(other)'] = v; }, '#94a3b8'));
    panel.appendChild(h('h4', { text: 'Overlays' }));
    panel.appendChild(check('Concerns (Q / A / R)', state.layers.concerns, function (v) { state.layers.concerns = v; }));
    panel.appendChild(check('Lifecycle status', state.layers.status, function (v) { state.layers.status = v; }));
    panel.appendChild(check('Notes & properties', state.layers.notes, function (v) { state.layers.notes = v; }));
    panel.appendChild(check('Element ids', state.layers.ids, function (v) { state.layers.ids = v; }));
    return panel;
  }

  // ---------- selection & detail panel ----------
  function select(type, id) {
    state.selected = type ? { type: type, id: id } : null;
    render();
  }
  function jumpToElement(id) {
    var view = viewByKey(state.page);
    var inCurrent = view && elementsInView(view).some(function (e) { return e.id === id; });
    if (!inCurrent) state.page = 'moduleMap';
    state.selected = { type: 'element', id: id };
    persistState();
    render();
    // Centre on the node after layout.
    var v = viewByKey(state.page);
    if (v && svgEl) {
      var pos = positionsFor(v)[id];
      if (pos) {
        var sz = nodeSize(elById[id]);
        var vb = parseVB();
        vb.x = pos.x + sz.w / 2 - vb.w / 2;
        vb.y = pos.y + sz.h / 2 - vb.h / 2;
        state.panZoom[v.key] = vb;
        svgEl.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h);
      }
    }
  }

  function relTimeShort(iso) {
    try { return new Date(iso).toLocaleDateString(); } catch (e) { return iso; }
  }

  function threadCard(c) {
    var card = h('div', { class: 'vr-thread' + (c.resolved ? ' resolved' : '') });
    var head = h('div', { class: 'head' }, [
      h('span', { class: 'author', text: c.author }),
      h('span', { class: 'when', text: relTimeShort(c.createdAt) }),
    ]);
    if (isDraft(c)) head.appendChild(h('span', { class: 'draft-tag', text: 'draft' }));
    else if (c.resolved) head.appendChild(h('span', { class: 'tag', text: '✓ resolved' }));
    card.appendChild(head);
    card.appendChild(h('div', { text: c.body }));
    (c.thread || []).forEach(function (r) {
      card.appendChild(h('div', { class: 'reply' }, [
        h('div', { class: 'head' }, [h('span', { class: 'author', text: r.author }), h('span', { class: 'when', text: relTimeShort(r.createdAt) })]),
        h('div', { text: r.body }),
      ]));
    });
    return card;
  }

  function buildPanel() {
    if (!state.selected) return null;
    var panel = h('aside', { class: 'vr-panel' });
    var close = h('button', { class: 'closebtn', text: '✕', title: 'Close', onclick: function () { select(null); } });
    if (state.selected.type === 'element') {
      var e = elById[state.selected.id];
      if (!e) return null;
      panel.appendChild(h('div', {}, [close, h('span', { class: 'vr-kindchip', text: KIND_LABEL[e.kind] || e.kind })]));
      panel.appendChild(h('h2', { text: e.name }));
      var t = tagById[e.id];
      var fields = h('div', {});
      function field(k, v, mono) {
        if (!v) return;
        fields.appendChild(h('div', { class: 'vr-field' }, [h('span', { class: 'k', text: k }), h('span', { class: 'v' + (mono ? ' mono' : ''), text: v })]));
      }
      field('Id', e.id, true);
      field('Status', statusOf(e.id));
      field('Phase', phaseOf(e.id));
      if (t && t.ownership) { field('Squad', t.ownership.squad || ''); field('Domain', t.ownership.domain || ''); }
      if (e.attributes.contextId && elById[e.attributes.contextId]) field('Context', elById[e.attributes.contextId].name);
      Object.keys(e.attributes).forEach(function (k) {
        if (k === 'contextId' || k === 'aboutId' || k === 'external') return;
        if (e.attributes[k]) field(k, e.attributes[k], true);
      });
      var props = data.customProps[e.id] || {};
      Object.keys(props).forEach(function (k) { field(k, props[k]); });
      panel.appendChild(fields);
      if (data.notes[e.id]) {
        panel.appendChild(h('div', {}, [h('h5', { text: 'Notes' }), h('div', { class: 'vr-notes', text: data.notes[e.id] })]));
      }
      var rels = data.model.links.filter(function (l) { return l.fromId === e.id || l.toId === e.id; });
      if (rels.length) {
        var relWrap = h('div', {}, [h('h5', { text: 'Relationships' })]);
        rels.forEach(function (l) {
          var out = l.fromId === e.id;
          var otherId = out ? l.toId : l.fromId;
          var other = elById[otherId];
          relWrap.appendChild(h('div', { class: 'vr-rel' }, [
            h('span', { text: out ? '→' : '←' }),
            h('span', { class: 't', text: linkTypeOf(l) }),
            h('button', { text: other ? other.name : otherId, onclick: function () { jumpToElement(otherId); } }),
          ]));
        });
        panel.appendChild(relWrap);
      }
      // Comments on this element.
      var cWrap = h('div', {}, [h('h5', { text: 'Comments' })]);
      var cs = commentsFor(e.id);
      cs.forEach(function (c) { cWrap.appendChild(threadCard(c)); });
      if (!cs.length) cWrap.appendChild(h('div', { class: 'vr-hint', text: 'No comments yet — be the first to challenge this.' }));
      var ta = h('textarea', { placeholder: 'Write a comment… it stays in this browser until you export the comment pack.' });
      var send = h('button', { class: 'vr-btn', text: 'Add comment', onclick: function () {
        var body = ta.value.trim();
        if (!body) return;
        addDraft('element', e.id, body);
        ta.value = '';
        toast('Comment saved locally — export the pack from the Comments page when done.');
        render();
      } });
      cWrap.appendChild(h('div', { class: 'vr-composer' }, [ta]));
      cWrap.appendChild(send);
      panel.appendChild(cWrap);
    } else {
      var l = null;
      data.model.links.forEach(function (x) { if (x.id === state.selected.id) l = x; });
      if (!l) return null;
      panel.appendChild(h('div', {}, [close, h('span', { class: 'vr-kindchip', text: l.kind === 'dataFlow' ? 'Data Flow' : 'Dependency' })]));
      var from = elById[l.fromId], to = elById[l.toId];
      panel.appendChild(h('h2', { text: (from ? from.name : l.fromId) + ' → ' + (to ? to.name : l.toId) }));
      var f2 = h('div', {});
      f2.appendChild(h('div', { class: 'vr-field' }, [h('span', { class: 'k', text: 'Type' }), h('span', { class: 'v', text: linkTypeOf(l) })]));
      if (l.kind === 'dataFlow' && l.attributes.payload) f2.appendChild(h('div', { class: 'vr-field' }, [h('span', { class: 'k', text: 'Payload' }), h('span', { class: 'v', text: l.attributes.payload })]));
      f2.appendChild(h('div', { class: 'vr-field' }, [h('span', { class: 'k', text: 'Id' }), h('span', { class: 'v mono', text: l.id })]));
      panel.appendChild(f2);
    }
    return panel;
  }

  // ---------- pages ----------
  function pill(text, color) {
    return h('span', { class: 'vr-pill', style: 'color:' + color + ';border-color:' + color, text: text });
  }
  function buildSummary() {
    var page = h('div', { class: 'vr-page' });
    var inner = h('div', { class: 'vr-page-inner' });
    inner.appendChild(h('h1', { text: data.meta.workspace }));
    inner.appendChild(h('div', { class: 'sub', text: 'Architecture summary — exported ' + new Date(data.meta.exportedAt).toLocaleString() + '. How to read this: boxes are parts of the system, arrows are how they depend on each other or exchange data.' }));

    var counts = {};
    data.model.elements.forEach(function (e) { counts[e.kind] = (counts[e.kind] || 0) + 1; });
    var cards = h('div', { class: 'vr-cards' });
    Object.keys(counts).forEach(function (k) {
      cards.appendChild(h('div', { class: 'vr-stat' }, [h('div', { class: 'n', text: String(counts[k]) }), h('div', { class: 'l', text: KIND_LABEL[k] || k })]));
    });
    cards.appendChild(h('div', { class: 'vr-stat' }, [h('div', { class: 'n', text: String(data.model.links.length) }), h('div', { class: 'l', text: 'Relationships' })]));
    inner.appendChild(cards);

    // Change story (Q7-A): lifecycle distribution + phases + planned/deprecated lists.
    inner.appendChild(h('h2', { text: 'Where the system is heading' }));
    var byStatus = {};
    data.model.elements.forEach(function (e) {
      var st = statusOf(e.id);
      if (!st) return;
      (byStatus[st] = byStatus[st] || []).push(e);
    });
    var stTable = h('table', { class: 'vr-table' }, [
      h('thead', {}, [h('tr', {}, [h('th', { text: 'Status' }), h('th', { text: 'Elements' }), h('th', { text: 'What it means' })])]),
    ]);
    var STATUS_HINT = {
      current: 'Running today', target: 'The intended future shape', 'to-adapt': 'Exists, needs changes',
      'to-be-created': 'Planned — does not exist yet', deprecated: 'Being phased out', proposed: 'Under discussion',
    };
    var stBody = h('tbody');
    Object.keys(byStatus).forEach(function (st) {
      var tr = h('tr');
      var td1 = h('td'); td1.appendChild(pill(st, STATUS_COLOR[st] || '#a1a1aa'));
      tr.appendChild(td1);
      var td2 = h('td');
      byStatus[st].forEach(function (e, i) {
        if (i) td2.appendChild(document.createTextNode(', '));
        td2.appendChild(h('button', { text: e.name, onclick: function () { jumpToElement(e.id); } }));
      });
      tr.appendChild(td2);
      tr.appendChild(h('td', { text: STATUS_HINT[st] || '' }));
      stBody.appendChild(tr);
    });
    stTable.appendChild(stBody);
    if (Object.keys(byStatus).length) inner.appendChild(stTable);
    else inner.appendChild(h('div', { class: 'vr-empty', text: 'No lifecycle statuses set in the model yet.' }));

    var byPhase = {};
    data.model.elements.forEach(function (e) {
      var ph = phaseOf(e.id);
      if (ph) (byPhase[ph] = byPhase[ph] || []).push(e);
    });
    var phases = Object.keys(byPhase).sort();
    if (phases.length) {
      inner.appendChild(h('h2', { text: 'Timeline by phase' }));
      var phTable = h('table', { class: 'vr-table' }, [
        h('thead', {}, [h('tr', {}, [h('th', { text: 'Phase' }), h('th', { text: 'Planned work' })])]),
      ]);
      var phBody = h('tbody');
      phases.forEach(function (ph) {
        var tr = h('tr', {}, [h('td', { text: ph })]);
        var td = h('td');
        byPhase[ph].forEach(function (e, i) {
          if (i) td.appendChild(document.createTextNode(', '));
          td.appendChild(h('button', { text: e.name + (statusOf(e.id) ? ' (' + statusOf(e.id) + ')' : ''), onclick: function () { jumpToElement(e.id); } }));
        });
        tr.appendChild(td);
        phBody.appendChild(tr);
      });
      phTable.appendChild(phBody);
      inner.appendChild(phTable);
    }

    var bcs = data.model.elements.filter(function (e) { return e.kind === 'boundedContext'; });
    if (bcs.length) {
      inner.appendChild(h('h2', { text: 'Areas of the system' }));
      var bcTable = h('table', { class: 'vr-table' }, [
        h('thead', {}, [h('tr', {}, [h('th', { text: 'Area' }), h('th', { text: 'Parts' }), h('th', { text: 'Owned by' })])]),
      ]);
      var bcBody = h('tbody');
      bcs.forEach(function (bc) {
        var members = data.model.elements.filter(function (e) { return e.attributes.contextId === bc.id; });
        var squads = {};
        members.forEach(function (m) { var sq = squadOf(m.id); if (sq) squads[sq] = 1; });
        var tr = h('tr');
        var td1 = h('td'); td1.appendChild(h('button', { text: bc.name, onclick: function () { jumpToElement(bc.id); } })); tr.appendChild(td1);
        tr.appendChild(h('td', { text: String(members.length) }));
        tr.appendChild(h('td', { text: Object.keys(squads).join(', ') || '—' }));
        bcBody.appendChild(tr);
      });
      bcTable.appendChild(bcBody);
      inner.appendChild(bcTable);
    }
    page.appendChild(inner);
    return page;
  }

  function buildConcerns() {
    var page = h('div', { class: 'vr-page' });
    var inner = h('div', { class: 'vr-page-inner' });
    inner.appendChild(h('h1', { text: 'Concerns' }));
    inner.appendChild(h('div', { class: 'sub', text: 'Every open question, working assumption and identified risk in the model — the things to challenge first.' }));
    var TINT = { question: '#0ea5e9', assumption: '#f59e0b', risk: '#f43f5e' };
    var ORDER = ['risk', 'question', 'assumption'];
    var any = false;
    ORDER.forEach(function (kind) {
      var items = data.model.elements.filter(function (e) { return e.kind === kind; });
      if (!items.length) return;
      any = true;
      inner.appendChild(h('h2', { text: KIND_LABEL[kind] + 's (' + items.length + ')' }));
      items.forEach(function (e) {
        var card = h('div', { class: 'vr-concern', style: 'border-left-color:' + TINT[kind] });
        var head = h('div', { class: 'head' }, [h('span', { class: 't', text: e.name })]);
        var cc = commentsFor(e.id).length;
        if (cc) head.appendChild(h('span', { class: 'vr-hint', text: cc + ' comment' + (cc > 1 ? 's' : '') }));
        card.appendChild(head);
        var aboutId = e.attributes.aboutId;
        if (aboutId && elById[aboutId]) {
          var about = h('div', { class: 'about' }, [
            document.createTextNode('about '),
            h('button', { text: elById[aboutId].name, onclick: function () { jumpToElement(aboutId); } }),
          ]);
          card.appendChild(about);
        }
        if (data.notes[e.id]) card.appendChild(h('div', { class: 'body', text: data.notes[e.id] }));
        card.appendChild(h('div', { style: 'margin-top:6px' }, [
          h('button', { class: 'vr-btn ghost', text: 'Open on canvas', onclick: function () { jumpToElement(e.id); } }),
        ]));
        inner.appendChild(card);
      });
    });
    if (!any) inner.appendChild(h('div', { class: 'vr-empty', text: 'No questions, assumptions or risks recorded — either great news or nobody has challenged this yet.' }));
    page.appendChild(inner);
    return page;
  }

  function buildComments() {
    var page = h('div', { class: 'vr-page' });
    var inner = h('div', { class: 'vr-page-inner' });
    inner.appendChild(h('h1', { text: 'Comments' }));
    inner.appendChild(h('div', { class: 'sub', text: 'Threads from the workspace plus the comments you write in this report. Your comments stay in this browser until exported as a pack and sent back to the architecture owner.' }));
    var bar = h('div', { style: 'display:flex;gap:8px;margin-bottom:16px;align-items:center' }, [
      h('button', { class: 'vr-btn', text: 'Export comment pack (' + drafts.length + ')', onclick: exportPack }),
      h('button', { class: 'vr-btn ghost', text: 'Discard my drafts', onclick: function () {
        if (!drafts.length) return;
        if (window.confirm('Discard ' + drafts.length + ' draft comment(s) written in this report?')) {
          drafts = []; lsSet(LS.drafts, drafts); render(); toast('Drafts discarded.');
        }
      } }),
      h('span', { class: 'vr-hint', text: 'Import the pack in Verso: Comments panel → Import pack.' }),
    ]);
    inner.appendChild(bar);
    var cs = allComments();
    if (!cs.length) inner.appendChild(h('div', { class: 'vr-empty', text: 'No comments anywhere yet. Select an element on a view to write the first one.' }));
    var byTarget = {};
    cs.forEach(function (c) { (byTarget[c.targetId] = byTarget[c.targetId] || []).push(c); });
    Object.keys(byTarget).forEach(function (tid) {
      var el = elById[tid];
      var head = h('h2', {});
      if (el) head.appendChild(h('button', { text: el.name, onclick: function () { jumpToElement(tid); }, style: 'color:var(--vr-accent)' }));
      else head.appendChild(document.createTextNode(tid));
      inner.appendChild(head);
      byTarget[tid].forEach(function (c) { var card = threadCard(c); card.style.marginBottom = '8px'; inner.appendChild(card); });
    });
    page.appendChild(inner);
    return page;
  }

  // ---------- render ----------
  var searchInput = null;
  function render() {
    buildRail();
    mainEl.textContent = '';
    if (panelEl && panelEl.parentNode) panelEl.parentNode.removeChild(panelEl);
    panelEl = null;
    currentViewKey = null;
    var view = viewByKey(state.page);
    if (view) {
      currentViewKey = view.key;
      mainEl.appendChild(renderView(view));
    } else if (state.page === 'summary') {
      mainEl.appendChild(buildSummary());
    } else if (state.page === 'concerns') {
      mainEl.appendChild(buildConcerns());
    } else if (state.page === 'comments') {
      mainEl.appendChild(buildComments());
    } else {
      state.page = 'moduleMap';
      render();
      return;
    }
    var p = buildPanel();
    if (p) { panelEl = p; app.querySelector('.vr-body').appendChild(p); }
    if (layersBtn) layersBtn.classList.toggle('active', state.layersOpen);
    modeBtns.forEach(function (b) { b.classList.toggle('active', b.dataset.mode === state.mode); });
  }

  // ---------- keyboard ----------
  window.addEventListener('keydown', function (ev) {
    var tgt = ev.target;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
    if (ev.key === '/') { ev.preventDefault(); if (searchInput) searchInput.focus(); }
    else if (ev.key === 'Escape') { if (state.selected) select(null); }
    else if (ev.key === '+' || ev.key === '=') zoomBy(1.25);
    else if (ev.key === '-') zoomBy(0.8);
    else if (ev.key === '0') fitView();
  });

  // ---------- boot ----------
  try {
    var m = /p=([^&]+)/.exec(location.hash);
    if (m) state.page = decodeURIComponent(m[1]);
  } catch (e) { /* ignore */ }
  buildShell();
  render();
})();
