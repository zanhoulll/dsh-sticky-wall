/**
 * dsh-sticky-wall render smoke test.
 *
 * Runs the browser half (client.js) in Node with a tiny React shim and a fake
 * cordis ctx, then calls the registered components directly to assert that the
 * sidebar icon, the empty panel, the waterfall wall (with per-span minimum
 * heights), the ratio controls, the copy button, the edit state and the
 * composer's draft (restored from localStorage, re-saved per keystroke, dropped
 * once the note reaches the wall) all behave without throwing. Stateful hooks
 * and controllable timers also cover menu/lock/hydration interactions, exact
 * 400ms drag activation, pointer cleanup/translation and adjacent/filtered
 * reordering. No real DOM, browser or third-party dependency is needed.
 *
 *   node test/smoke.mjs
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(__dirname, '..', 'client.js');
const CODE = fs.readFileSync(CLIENT, 'utf8');

/**
 * @param {Array} hookQueue seeded state values, consumed positionally
 * @param {{ effects?: boolean, localStorage?: object, fetchImpl?: Function, onSet?: Function }} [opts]
 *   effects: run useEffect bodies (needed to observe the load effect);
 *   onSet: records every state setter call.
 */
function makeReact(hookQueue, opts = {}) {
  const createElement = (type, props, ...children) => ({
    type: typeof type === 'function' ? type : String(type),
    props: props || {},
    children,
  });
  const React = {
    createElement,
    useState(init) {
      const v = hookQueue.length ? hookQueue.shift() : typeof init === 'function' ? init() : init;
      return [
        v,
        (next) => {
          if (opts.onSet) opts.onSet(next);
        },
      ];
    },
    useRef(init) {
      return { current: init };
    },
    useLayoutEffect() {},
    useEffect(fn) {
      if (opts.effects && typeof fn === 'function') fn();
    },
    useMemo(fn) {
      return fn();
    },
  };
  return React;
}

function boot(hookQueue, opts = {}) {
  const React = opts.React || makeReact(hookQueue, opts);
  const fetchCalls = [];
  const win = {
    __ModuleLoader__: { load(def) { win.__def = def; } },
    localStorage: opts.localStorage || { getItem: () => null, setItem() {} },
    setInterval: () => 0,
    clearInterval() {},
    setTimeout: opts.setTimeout || (() => 0),
    clearTimeout: opts.clearTimeout || (() => {}),
  };
  const requireShim = (name) => {
    if (name === 'react') return React;
    throw new Error('unexpected require: ' + name);
  };
  // eslint-disable-next-line no-new-func
  new Function('window', 'require', 'fetch', 'document', CODE)(win, requireShim, (...args) => {
    fetchCalls.push(args);
    return opts.fetchImpl ? opts.fetchImpl(...args) : Promise.reject(new Error('no fetch in test'));
  }, opts.document);
  const def = win.__def;
  if (!def) throw new Error('module did not register');
  const captured = {};
  let currentName = '';
  const ctx = {
    effect() {
      return () => {};
    },
    locale: {
      register(ns, dicts) {
        captured.dicts = dicts;
        return () => {};
      },
      bind() {
        return (k) => (captured.dicts && captured.dicts.en && captured.dicts.en[k]) || k;
      },
    },
    slots: {
      inject(name, fn) {
        currentName = name;
        fn();
      },
      register(desc) {
        captured[currentName] = { desc, comp: arguments[1] };
        return desc;
      },
    },
  };
  def.factory(requireShim).apply(ctx);
  captured.win = win;
  captured.fetchCalls = fetchCalls;
  return captured;
}

/** Flatten a rendered tree into the list of element nodes. */
function collect(node, out = []) {
  if (node == null) return out;
  if (Array.isArray(node)) {
    node.forEach((n) => collect(n, out));
    return out;
  }
  if (typeof node !== 'object') return out;
  out.push(node);
  (node.children || []).forEach((c) => collect(c, out));
  return out;
}

const byClass = (nodes, cls) =>
  nodes.filter((n) => typeof n.props.className === 'string' && n.props.className.split(/\s+/).includes(cls));
const textOf = (node) => (node.children || []).filter((c) => typeof c === 'string' || typeof c === 'number').join('');

/** Stateful hooks for interaction tests: setters update values, render() is explicit. */
function makeStatefulReact(seeds = []) {
  const hooks = [];
  const initialized = [];
  let cursor = 0;
  const createElement = (type, props, ...children) => ({
    type: typeof type === 'function' ? type : String(type),
    props: props || {},
    children,
  });
  const React = {
    createElement,
    useState(init) {
      const index = cursor++;
      if (!initialized[index]) {
        hooks[index] = Object.prototype.hasOwnProperty.call(seeds, index)
          ? seeds[index]
          : typeof init === 'function' ? init() : init;
        initialized[index] = true;
      }
      return [hooks[index], (next) => {
        hooks[index] = typeof next === 'function' ? next(hooks[index]) : next;
      }];
    },
    useRef(init) {
      const index = cursor++;
      if (!initialized[index]) {
        hooks[index] = { current: init };
        initialized[index] = true;
      }
      return hooks[index];
    },
    useLayoutEffect() {},
    useEffect() {},
    useMemo(fn) { return fn(); },
  };
  return { React, hooks, reset() { cursor = 0; } };
}

function makeClock() {
  let now = 0;
  let sequence = 0;
  const tasks = [];
  return {
    setTimeout(fn, delay = 0) {
      const task = { id: ++sequence, at: now + Math.max(0, Number(delay) || 0), fn };
      tasks.push(task);
      return task.id;
    },
    clearTimeout(id) {
      const index = tasks.findIndex((task) => task.id === id);
      if (index >= 0) tasks.splice(index, 1);
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        tasks.sort((a, b) => a.at - b.at || a.id - b.id);
        const task = tasks[0];
        if (!task || task.at > target) break;
        tasks.shift();
        now = task.at;
        task.fn();
      }
      now = target;
    },
    pending() { return tasks.length; },
  };
}

function fixture(id, text, order, extra = {}) {
  return {
    id, text, color: 0, ratio: 1, locked: false, order,
    createdAt: 1000 - order, updatedAt: 1000 - order,
    ...extra,
  };
}

function clickEvent() {
  return {
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
  };
}

function makeHarness(notes, opts = {}) {
  const seeds = [notes, '', 0, 1, opts.query || '', opts.editingId ?? null, opts.editingText || '', 0];
  const react = makeStatefulReact(seeds);
  const values = { ...(opts.store || {}) };
  const storageWrites = [];
  const localStorage = opts.localStorage || {
    getItem(key) { return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null; },
    setItem(key, value) { values[key] = String(value); storageWrites.push({ key, value: String(value) }); },
    removeItem(key) { delete values[key]; },
  };
  const cap = boot([], { ...opts, React: react.React, localStorage });
  const App = cap.main.comp({}).type;
  let tree;
  function render() {
    react.reset();
    tree = App({ t: (key) => 'T:' + key });
    return tree;
  }
  function slot(id) {
    return collect(tree).find((node) => node.props['data-sticky-id'] === id) || null;
  }
  function card(id) {
    const found = slot(id);
    if (!found) throw new Error('card not rendered: ' + id);
    return collect(found);
  }
  function menuButton(id) {
    const found = card(id).find((node) => String(node.props.className || '').includes('dsw-sticky-menu-button'));
    if (!found) throw new Error('menu button not found: ' + id);
    return found;
  }
  function openMenu(id) {
    menuButton(id).props.onClick(clickEvent());
    render();
  }
  function lockButton(id) {
    const found = card(id).find((node) => node.type === 'button' &&
      (node.props['aria-label'] === 'T:lockNote' || node.props['aria-label'] === 'T:unlockNote'));
    if (!found) throw new Error('lock button not found: ' + id);
    return found;
  }
  function dragButton(id) {
    const found = card(id).find((node) => String(node.props.className || '').includes('dsw-sticky-drag-handle'));
    if (!found) throw new Error('drag handle not found: ' + id);
    return found;
  }
  render();
  return {
    cap, react, render, slot, card, menuButton, openMenu, lockButton, dragButton, values, storageWrites,
    nodes: () => collect(tree),
    notes: () => react.hooks[0],
    posts: () => cap.fetchCalls.filter((args) => args[1] && args[1].method === 'POST'),
  };
}

let failures = 0;
let newAssertions = 0;
function check(condition, message) {
  newAssertions++;
  if (!condition) throw new Error(message);
}

// 1) Sidebar icon renders.
try {
  const cap = boot([]);
  if (!cap['sidebar.panellist']) throw new Error('no sidebar.panellist registration');
  const icon = cap['sidebar.panellist'].comp({ size: 18, active: true });
  if (!icon || icon.type !== 'svg') throw new Error('icon not svg: ' + JSON.stringify(icon));
  console.log('PASS sidebar icon svg');
} catch (e) {
  failures++;
  console.log('FAIL sidebar icon:', e.message);
}

// 2) Main panel empty state renders.
try {
  const cap = boot([]);
  const App = cap.main.comp({}).type;
  const nodes = collect(App({ t: (k) => 'T:' + k }));
  const types = nodes.map((n) => n.type);
  if (!types.includes('textarea')) throw new Error('no composer textarea');
  if (!types.includes('h1')) throw new Error('no header h1');
  console.log('PASS main empty render, nodes=', types.length);
} catch (e) {
  failures++;
  console.log('FAIL main empty render:', e.message);
}

// 3) Cards render (read-only view).
try {
  const now = Date.now();
  const notes = [
    { id: 'n_abc', text: '给每个想法，一个落脚的地方。', color: 0, createdAt: now, updatedAt: now },
    { id: 'n_def', text: '一键小工具，日常好帮手。', color: 4, createdAt: now - 3600_000, updatedAt: now - 3600_000 },
  ];
  const cap = boot([notes]);
  const nodes = collect(cap.main.comp({}).type({ t: (k) => 'T:' + k }));
  const articles = nodes.filter((n) => n.type === 'article');
  if (articles.length !== 2) throw new Error('expected 2 article cards, got ' + articles.length);
  console.log('PASS cards render, articles=', articles.length);
} catch (e) {
  failures++;
  console.log('FAIL cards render:', e.message);
}

// 4) Edit mode renders a textarea in the card.
try {
  const now = Date.now();
  const notes = [{ id: 'n_abc', text: '可编辑内容', color: 2, createdAt: now, updatedAt: now }];
  // hook order: notes, draft, color, ratio, query, editingId, editingText, tick
  const cap = boot([notes, '', 0, 1, '', 'n_abc', '可编辑内容', 0]);
  const nodes = collect(cap.main.comp({}).type({ t: (k) => 'T:' + k }));
  const tas = nodes.filter((n) => n.type === 'textarea').length;
  if (tas < 2) throw new Error('expected composer + edit textareas, got ' + tas);
  console.log('PASS edit mode render, textareas=', tas);
} catch (e) {
  failures++;
  console.log('FAIL edit mode render:', e.message);
}

// 5) Waterfall wall: every card sits in an absolutely placed slot, and the
//    wall reserves the packed height instead of flowing the cards itself.
try {
  const now = Date.now();
  const notes = [
    { id: 'n_1', text: '方形便签', color: 0, ratio: 1, createdAt: now, updatedAt: now },
    { id: 'n_2', text: '2:1', color: 1, ratio: 2, createdAt: now - 1, updatedAt: now - 1 },
    { id: 'n_3', text: '3:1', color: 2, ratio: 3, createdAt: now - 2, updatedAt: now - 2 },
    { id: 'n_4', text: '4:1', color: 3, ratio: 4, createdAt: now - 3, updatedAt: now - 3 },
    { id: 'n_5', text: '老便签没有比例字段', color: 4, createdAt: now - 4, updatedAt: now - 4 },
  ];
  const cap = boot([notes]);
  const nodes = collect(cap.main.comp({}).type({ t: (k) => 'T:' + k }));
  const walls = byClass(nodes, 'dsw-sticky-wall');
  if (walls.length !== 1) throw new Error('expected one waterfall wall, got ' + walls.length);
  if (!('height' in walls[0].props.style)) throw new Error('wall does not reserve a packed height');
  const slots = byClass(nodes, 'dsw-sticky-slot');
  if (slots.length !== notes.length) throw new Error('expected ' + notes.length + ' slots, got ' + slots.length);
  if (!slots.every((s) => /^\d+px$/.test(s.props.style.width))) throw new Error('slot width not pinned');
  const articles = nodes.filter((n) => n.type === 'article');
  // Minimum height = column width / span, so 1:1 stays square and 2:1/3:1/4:1
  // get flatter instead of every card being one cell tall. The fixture wall is
  // four columns of 236px, so the floors are 236 / 118 / 79 / 59 / (missing
  // ratio -> 1) 236.
  const mins = articles.map((a) => a.props.style.minHeight);
  const expected = ['236px', '118px', '79px', '59px', '236px'];
  if (mins.join(',') !== expected.join(',')) {
    throw new Error('min heights ' + mins.join(',') + ' != ' + expected.join(','));
  }
  console.log('PASS waterfall slots + min heights, slots=', slots.length, 'mins=', mins.join(','));
} catch (e) {
  failures++;
  console.log('FAIL waterfall slots:', e.message);
}

// 6) The composer offers all four ratios and the hover control shows the
//    current one, so a note can be re-shaped after it is on the wall.
try {
  const now = Date.now();
  const notes = [{ id: 'n_abc', text: 'x', color: 0, ratio: 2, createdAt: now, updatedAt: now }];
  const cap = boot([notes]);
  const nodes = collect(cap.main.comp({}).type({ t: (k) => 'T:' + k }));
  const chips = nodes.filter((n) => n.props.title && /^T:ratio \d:1 · T:ratioSpan$/.test(String(n.props.title)));
  const labels = chips.map(textOf);
  if (labels.join(',') !== '1:1,2:1,3:1,4:1') throw new Error('composer ratios ' + labels.join(','));
  const pressed = chips.filter((n) => n.props['aria-pressed'] === true).map(textOf);
  if (pressed.join(',') !== '1:1') throw new Error('default composer ratio should be 1:1, got ' + pressed.join(','));
  // The card's ratio switch now lives in the ... popup (test 11 covers it),
  // so there is no always-rendered ratio chip on the card any more.
  console.log('PASS ratio controls, composer=', labels.join(' '));
} catch (e) {
  failures++;
  console.log('FAIL ratio controls:', e.message);
}

// 7) Loading merges the host's notes with this browser's mirror: a note whose
//    stored ratio went missing (old data, or a host half that predates the
//    field and strips it on save) keeps the ratio the browser already knows,
//    while an explicit stored ratio always wins.
try {
  const now = Date.now();
  const server = [
    { id: 'n_old', text: '服务端没有比例', color: 0, createdAt: now, updatedAt: now },
    { id: 'n_new', text: '服务端有比例', color: 1, ratio: 2, createdAt: now - 1, updatedAt: now - 1 },
  ];
  const mirror = [
    { id: 'n_old', text: '服务端没有比例', color: 0, ratio: 3, createdAt: now, updatedAt: now },
    { id: 'n_new', text: '服务端有比例', color: 1, ratio: 4, createdAt: now - 1, updatedAt: now - 1 },
  ];
  const sets = [];
  const cap = boot([], {
    effects: true,
    localStorage: {
      getItem: (k) => (k === 'dsh-sticky-wall:notes' ? JSON.stringify(mirror) : null),
      setItem() {},
    },
    fetchImpl: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ notes: server }) }),
    onSet: (v) => sets.push(v),
  });
  cap.main.comp({}).type({ t: (k) => 'T:' + k });
  await new Promise((r) => setTimeout(r, 0));
  const loaded = sets.find((v) => Array.isArray(v) && v.length === 2);
  if (!loaded) throw new Error('load effect never set the notes, sets=' + JSON.stringify(sets));
  const [old, fresh] = loaded;
  if (old.ratio !== 3) throw new Error('mirror ratio not recovered, got ' + old.ratio);
  if (fresh.ratio !== 2) throw new Error('stored ratio should win, got ' + fresh.ratio);
  console.log('PASS ratio recovery, recovered=', old.ratio, 'stored=', fresh.ratio);
} catch (e) {
  failures++;
  console.log('FAIL ratio recovery:', e.message);
}

// 8) Every card exposes a copy button that copies the note's text.
try {
  const now = Date.now();
  const notes = [{ id: 'n_abc', text: '复制我', color: 0, ratio: 1, createdAt: now, updatedAt: now }];
  const cap = boot([notes]);
  const nodes = collect(cap.main.comp({}).type({ t: (k) => 'T:' + k }));
  const copyBtn = nodes.find(
    (n) =>
      n.type === 'button' &&
      (n.props.title === 'T:copyNote' || n.props['aria-label'] === 'T:copyNote'),
  );
  if (!copyBtn) throw new Error('no copy button in card actions');
  if (typeof copyBtn.props.onClick !== 'function') throw new Error('copy button has no onClick handler');
  console.log('PASS copy button present');
} catch (e) {
  failures++;
  console.log('FAIL copy button:', e.message);
}

// 9) The composer restores an unposted draft and mirrors every keystroke, so a
//    refresh (or a panel switch) brings the text back into the box.
try {
  const stored = {};
  const cap = boot([], {
    localStorage: {
      getItem: (k) => (k === 'dsh-sticky-wall:draft' ? '还没贴到墙上的草稿' : null),
      setItem: (k, v) => {
        stored[k] = v;
      },
      removeItem: (k) => {
        delete stored[k];
      },
    },
  });
  const nodes = collect(cap.main.comp({}).type({ t: (k) => 'T:' + k }));
  const ta = nodes.find(
    (n) => n.type === 'textarea' && String(n.props.className).includes('dsw-sticky-ta'),
  );
  if (!ta) throw new Error('no composer textarea');
  if (ta.props.value !== '还没贴到墙上的草稿') {
    throw new Error('draft not restored, got ' + JSON.stringify(ta.props.value));
  }
  const addBtn = byClass(nodes, 'dsw-sticky-add')[0];
  if (!addBtn) throw new Error('no add button');
  if (addBtn.props.disabled) throw new Error('add button disabled for a restored draft');
  ta.props.onChange({ target: { value: '改成新的草稿' } });
  if (stored['dsh-sticky-wall:draft'] !== '改成新的草稿') {
    throw new Error('keystroke not mirrored, stored=' + JSON.stringify(stored));
  }
  console.log('PASS draft restore + mirror, value=', JSON.stringify(ta.props.value));
} catch (e) {
  failures++;
  console.log('FAIL draft restore:', e.message);
}

// 10) Adding the draft to the wall drops it from the box and from the mirror,
//     so the next open starts empty instead of resurrecting the posted text.
try {
  const now = Date.now();
  const notes = [{ id: 'n_abc', text: '已有便签', color: 0, ratio: 1, createdAt: now, updatedAt: now }];
  const removed = [];
  // hook order: notes, draft, color, ratio, query, editingId, editingText, tick
  const cap = boot([notes, '要贴到墙上的草稿', 2, 1, '', null, '', 0], {
    localStorage: {
      getItem: () => '要贴到墙上的草稿',
      setItem() {},
      removeItem: (k) => removed.push(k),
    },
  });
  const nodes = collect(cap.main.comp({}).type({ t: (k) => 'T:' + k }));
  const addBtn = byClass(nodes, 'dsw-sticky-add')[0];
  if (!addBtn) throw new Error('no add button');
  if (addBtn.props.disabled) throw new Error('add button disabled with a non-empty draft');
  addBtn.props.onClick();
  if (!removed.includes('dsh-sticky-wall:draft')) {
    throw new Error('draft not cleared after adding, removed=' + JSON.stringify(removed));
  }
  console.log('PASS draft cleared after add');
} catch (e) {
  failures++;
  console.log('FAIL draft cleared:', e.message);
}


// 11) Menu toggling and every menu action target only their own card.
try {
  const h = makeHarness([fixture('n_a', 'A', 0), fixture('n_b', 'B', 1, { color: 1, ratio: 2 })]);
  h.menuButton('n_b').props.onClick(clickEvent()); h.render();
  check(h.menuButton('n_b').props['aria-expanded'] === true, 'target menu did not open');
  check(h.menuButton('n_a').props['aria-expanded'] === false, 'sibling menu also opened');
  check(h.nodes().filter((n) => n.props.role === 'menu').length === 1, 'expected exactly one menu');
  h.menuButton('n_b').props.onClick(clickEvent()); h.render();
  check(h.nodes().filter((n) => n.props.role === 'menu').length === 0, 'second click did not close menu');
  for (let color = 0; color < 6; color++) {
    h.openMenu('n_b');
    const items = h.card('n_b').filter((n) => n.props.role === 'menuitemradio' && String(n.props['aria-label']).startsWith('T:color'));
    check(items.length === 6, 'menu does not expose six colors');
    items[color].props.onClick(); h.render();
    check(h.notes().find((n) => n.id === 'n_b').color === color, 'wrong color target/value at ' + color);
    check(h.notes().find((n) => n.id === 'n_a').color === 0, 'color leaked to sibling at ' + color);
  }
  // The popup is one centred column: six colours then four ratio choices.
  // Lock stays out of the popup, in the bottom action row.
  function ensureMenu(id) { if (!h.menuButton(id).props['aria-expanded']) h.openMenu(id); }
  ensureMenu('n_b');
  check(h.card('n_b').filter((n) => n.props.role === 'menuitemcheckbox').length === 0, 'menu should not contain the lock action');
  check(!!h.lockButton('n_b'), 'bottom action row has no lock button');
  for (let ratio = 1; ratio <= 4; ratio++) {
    ensureMenu('n_b');
    const items = h.card('n_b').filter((n) => n.props.role === 'menuitemradio' && String(n.props['aria-label']).startsWith('T:ratio '));
    check(items.length === 4, 'menu does not expose four ratios');
    check(h.card('n_b').filter((n) => n.props.role === 'menuitemradio').length === 10, 'menu should offer six colours + four ratios');
    items[ratio - 1].props.onClick(); h.render();
    check(h.notes().find((n) => n.id === 'n_b').ratio === ratio, 'wrong ratio at ' + ratio);
    check(h.notes().find((n) => n.id === 'n_a').ratio === 1, 'ratio leaked to sibling at ' + ratio);
  }
  const lock = h.lockButton('n_b');
  lock.props.onClick(); h.render();
  check(h.notes().find((n) => n.id === 'n_b').locked === true, 'lock did not affect target');
  check(h.notes().find((n) => n.id === 'n_a').locked === false, 'lock leaked to sibling');
  console.log('PASS menu toggle + six colors + four ratios in popup + lock target');
} catch (e) { failures++; console.log('FAIL menu interactions:', e.message); }

// 12) locked persists and guards direct, empty-commit, and unlocked paths.
try {
  const h = makeHarness([fixture('n_lock', 'protected', 3)]);
  h.openMenu('n_lock');
  h.lockButton('n_lock').props.onClick(); h.render();
  check(h.notes()[0].locked === true, 'lock state not stored');
  check(h.lockButton('n_lock').props['aria-pressed'] === true, 'lock button does not reflect locked state');
  check(JSON.parse(h.posts().at(-1)[1].body).notes[0].locked === true, 'locked missing from POST');
  check(JSON.parse(h.storageWrites.at(-1).value)[0].locked === true, 'locked missing from local mirror');
  const editButton = h.card('n_lock').find((n) => n.props['aria-label'] === 'T:editNote');
  const deleteButton = h.card('n_lock').find((n) => n.props['aria-label'] === 'T:deleteNote');
  check(editButton.props.disabled === true && deleteButton.props.disabled === true, 'locked actions not disabled');
  const postsAfterLock = h.posts().length;
  h.card('n_lock').find((n) => n.props.title === 'T:editHint').props.onDoubleClick();
  editButton.props.onClick(); h.render();
  check(h.react.hooks[5] == null, 'locked beginEdit opened an editor');
  deleteButton.props.onClick(); h.render();
  check(h.notes().length === 1 && h.notes()[0].text === 'protected', 'locked removeNote deleted text');
  check(h.posts().length === postsAfterLock, 'locked edit/delete caused persistence');
  const editing = makeHarness([fixture('n_edit_locked', 'do not clear', 0, { locked: true })], { editingId: 'n_edit_locked', editingText: '   ' });
  const editTa = editing.card('n_edit_locked').find((n) => n.props.className === 'dsw-sticky-edit');
  check(!!editTa, 'locked edit fixture did not render editor');
  editTa.props.onBlur(); editing.render();
  check(editing.notes().length === 1 && editing.notes()[0].text === 'do not clear', 'empty commit deleted locked note');
  check(editing.posts().length === 0, 'locked empty commit persisted a deletion');
  h.openMenu('n_lock');
  h.lockButton('n_lock').props.onClick(); h.render();
  check(h.notes()[0].locked === false, 'unlock did not restore unlocked state');
  check(h.lockButton('n_lock').props['aria-pressed'] === false, 'unlock did not reset the lock button state');
  h.card('n_lock').find((n) => n.props.title === 'T:editHint').props.onDoubleClick(); h.render();
  const unlockedTa = h.card('n_lock').find((n) => n.props.className === 'dsw-sticky-edit');
  check(!!unlockedTa, 'unlock did not restore editing');
  unlockedTa.props.onChange({ target: { value: 'editable again' } }); h.render();
  h.card('n_lock').find((n) => n.props.className === 'dsw-sticky-edit').props.onBlur(); h.render();
  check(h.notes()[0].text === 'editable again', 'unlocked edit did not save');
  h.card('n_lock').find((n) => n.props['aria-label'] === 'T:deleteNote').props.onClick(); h.render();
  check(h.notes().length === 0, 'unlock did not restore deletion');
  console.log('PASS locked persistence + all edit/delete guards + unlock');
} catch (e) { failures++; console.log('FAIL lock guards:', e.message); }

// 13) Menu updates and editing retain locked/order fields.
try {
  const h = makeHarness([fixture('n_keep', 'keep fields', 7, { locked: true }), fixture('n_other', 'other', 8)]);
  h.openMenu('n_keep');
  h.card('n_keep').filter((n) => String(n.props['aria-label']).startsWith('T:color'))[4].props.onClick(); h.render();
  let kept = h.notes().find((n) => n.id === 'n_keep');
  check(kept.color === 4 && kept.locked === true && kept.order === 7, 'color update dropped locked/order');
  h.openMenu('n_keep');
  const ratioItems = h.card('n_keep').filter((n) => n.props.role === 'menuitemradio' && String(n.props['aria-label']).startsWith('T:ratio '));
  check(ratioItems.length === 4, 'popup ratio choices missing');
  ratioItems[1].props.onClick(); h.render();
  kept = h.notes().find((n) => n.id === 'n_keep');
  check(kept.ratio === 2 && kept.locked === true && kept.order === 7, 'ratio change dropped locked/order');
  check(h.notes().find((n) => n.id === 'n_other').order === 8, 'menu update changed sibling order');
  const editing = makeHarness([fixture('n_edit', 'before', -2, { locked: false }), fixture('n_rest', 'rest', 0)]);
  editing.card('n_edit').find((n) => n.props.title === 'T:editHint').props.onDoubleClick(); editing.render();
  const ta = editing.card('n_edit').find((n) => n.props.className === 'dsw-sticky-edit');
  ta.props.onChange({ target: { value: 'after' } }); editing.render();
  editing.card('n_edit').find((n) => n.props.className === 'dsw-sticky-edit').props.onBlur(); editing.render();
  const edited = editing.notes().find((n) => n.id === 'n_edit');
  check(edited.text === 'after', 'edit fixture did not commit');
  check(Object.prototype.hasOwnProperty.call(edited, 'locked') && edited.locked === false, 'edit dropped locked=false');
  check(Object.prototype.hasOwnProperty.call(edited, 'order') && edited.order === -3, 'edit dropped/miscalculated order');
  check(editing.notes().find((n) => n.id === 'n_rest').order === 0, 'edit changed sibling order');
  console.log('PASS color/ratio/edit preserve locked/order fields');
} catch (e) { failures++; console.log('FAIL field preservation:', e.message); }

// 14) Hydration prioritizes explicit server values and fills missing fields
// from the mirror. A separate all-legacy load verifies automatic migration;
// separating it avoids intentionally triggering the whole-list order rebuild.
try {
  const now = Date.now();
  const server = [
    { id: 'n_explicit', text: 'server wins', color: 0, ratio: 1, locked: false, order: 0, createdAt: now, updatedAt: now },
    { id: 'n_mirror', text: 'mirror fills', color: 1, ratio: 2, createdAt: now - 1, updatedAt: now - 1 },
  ];
  const mirror = [
    { id: 'n_explicit', text: 'server wins', color: 0, ratio: 1, locked: true, order: 8 },
    { id: 'n_mirror', text: 'mirror fills', color: 1, ratio: 2, locked: true, order: 4 },
  ];
  const sets = [];
  const cap = boot([], { effects: true,
    localStorage: { getItem: (key) => key === 'dsh-sticky-wall:notes' ? JSON.stringify(mirror) : null, setItem() {} },
    fetchImpl: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ notes: server }) }),
    onSet: (value) => sets.push(value),
  });
  cap.main.comp({}).type({ t: (key) => 'T:' + key });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const loaded = sets.find((value) => Array.isArray(value) && value.length === 2);
  check(!!loaded, 'hydration did not set server/mirror notes');
  const explicit = loaded.find((n) => n.id === 'n_explicit');
  const recovered = loaded.find((n) => n.id === 'n_mirror');
  check(explicit.locked === false && explicit.order === 0, 'mirror overrode explicit server values');
  check(recovered.locked === true && recovered.order === 4, 'mirror did not fill locked/order');

  const legacySets = [];
  const legacyCap = boot([], { effects: true,
    localStorage: { getItem: () => null, setItem() {} },
    fetchImpl: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ notes: [
      { id: 'n_legacy', text: 'legacy defaults', color: 2, createdAt: now - 2, updatedAt: now - 2 },
    ] }) }),
    onSet: (value) => legacySets.push(value),
  });
  legacyCap.main.comp({}).type({ t: (key) => 'T:' + key });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const legacyLoaded = legacySets.find((value) => Array.isArray(value) && value.length === 1);
  check(!!legacyLoaded, 'legacy hydration did not set a note');
  check(legacyLoaded[0].locked === false && Number.isFinite(legacyLoaded[0].order), 'legacy locked/order migration missing');
  console.log('PASS hydrate server priority + mirror recovery + migration');
} catch (e) { failures++; console.log('FAIL locked/order hydration:', e.message); }


// 15) 399ms stays a short press; 400ms activates drag from the top three dots.
// Pointerup/cancel clean up, and the menu button is independent of the handle.
try {
  const clock = makeClock();
  const h = makeHarness([fixture('n_a', 'A', 0), fixture('n_b', 'B', 1)], { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  const captures = { set: 0, release: 0 };
  const target = { setPointerCapture() { captures.set++; }, releasePointerCapture() { captures.release++; } };
  const event = (extra = {}) => ({ button: 0, pointerId: 7, clientX: 10, clientY: 20, currentTarget: target, target, ...extra });
  h.dragButton('n_a').props.onPointerDown(event()); clock.advance(399); h.render();
  check(!String(h.slot('n_a').props.className).includes('dsw-sticky-dragging'), 'drag started before 400ms');
  h.dragButton('n_a').props.onPointerUp(event()); h.render();
  check(clock.pending() === 0 && captures.release === 1, 'pointerup before hold did not clean up');
  h.menuButton('n_a').props.onClick(clickEvent()); h.render();
  check(h.menuButton('n_a').props['aria-expanded'] === true, 'menu button did not open');
  h.menuButton('n_a').props.onClick(clickEvent()); h.render();
  h.dragButton('n_a').props.onPointerDown(event()); clock.advance(400); h.render();
  check(String(h.slot('n_a').props.className).includes('dsw-sticky-dragging'), 'drag did not start at 400ms');
  h.dragButton('n_a').props.onPointerUp(event()); h.render();
  check(clock.pending() === 0 && captures.release === 2, 'active pointerup did not clean up');
  check(!String(h.slot('n_a').props.className).includes('dsw-sticky-dragging'), 'drag view remained after pointerup');
  h.menuButton('n_a').props.onClick(clickEvent()); h.render();
  check(h.menuButton('n_a').props['aria-expanded'] === true, 'menu click wrongly suppressed after drag');
  h.menuButton('n_a').props.onClick(clickEvent()); h.render();
  h.dragButton('n_a').props.onPointerDown(event()); clock.advance(400);
  h.dragButton('n_a').props.onPointerCancel(event()); h.render();
  check(clock.pending() === 0 && captures.release === 3, 'pointercancel did not clean up');
  check(!String(h.slot('n_a').props.className).includes('dsw-sticky-dragging'), 'drag view remained after cancel');
  check(h.posts().length === 0, 'timing/cancel gestures unexpectedly persisted');
  console.log('PASS 399/400ms hold from top dots + pointerup/cancel cleanup + independent menu');
} catch (e) { failures++; console.log('FAIL drag timing/cleanup:', e.message); }

// 16) Active movement must produce pointer deltas or equivalent translation,
// and the hovered drop target must show a high-contrast dashed outline + halo.
try {
  const clock = makeClock();
  const hitB = { closest: () => ({ getAttribute: () => 'n_b' }) };
  const h = makeHarness([fixture('n_a', 'A', 0), fixture('n_b', 'B', 1)], {
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    document: { elementFromPoint: () => hitB },
  });
  const target = { setPointerCapture() {}, releasePointerCapture() {} };
  const event = (x, y) => ({ button: 0, pointerId: 1, clientX: x, clientY: y, currentTarget: target, target, preventDefault() {} });
  h.dragButton('n_a').props.onPointerDown(event(10, 20)); clock.advance(400);
  h.dragButton('n_a').props.onPointerMove(event(42, 68)); h.render();
  const drag = h.react.hooks[12];
  const transform = h.slot('n_a').props.style.transform;
  const hasDeltas = drag && drag.id === 'n_a' && drag.dx === 32 && drag.dy === 48;
  const hasTranslation = transform === 'translate3d(32px,48px,0)';
  check(!!(hasDeltas || hasTranslation), 'active pointer move produced no dx/dy or equivalent card translation');
  const article = h.card('n_a').find((n) => n.type === 'article');
  check(!!article && article.props.style.transition === 'box-shadow .12s ease', 'drag did not disable the transform transition');
  const targetArticle = h.card('n_b').find((n) => n.type === 'article');
  check(!!targetArticle && targetArticle.props.style.outline === '3px dashed #1D4ED8', 'drop target outline is not high contrast');
  check(String(targetArticle.props.style.boxShadow).includes('rgba(37,99,235,0.16)'), 'drop target halo missing');
  console.log('PASS active drag follows pointer deltas + obvious drop target');
} catch (e) { failures++; console.log('FAIL drag pointer translation:', e.message); }

// 17) Dropping A onto its immediate successor B must produce B,A.
try {
  const clock = makeClock();
  const hit = { closest: () => ({ getAttribute: () => 'n_b' }) };
  const h = makeHarness([fixture('n_a', 'A', 0), fixture('n_b', 'B', 1)], {
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, document: { elementFromPoint: () => hit },
  });
  const target = { setPointerCapture() {}, releasePointerCapture() {} };
  const event = { button: 0, pointerId: 1, clientX: 1, clientY: 1, currentTarget: target, target };
  h.dragButton('n_a').props.onPointerDown(event); clock.advance(400); h.dragButton('n_a').props.onPointerUp(event); h.render();
  check(h.posts().length === 1, 'adjacent drop should persist exactly once');
  const ids = h.notes().slice().sort((a, b) => a.order - b.order).map((n) => n.id);
  check(ids.join(',') === 'n_b,n_a', 'adjacent drop must reorder to B,A; got ' + ids.join(','));
  console.log('PASS adjacent A->B drop reorders to B,A');
} catch (e) { failures++; console.log('FAIL adjacent reorder:', e.message); }

// 18) A filtered drop persists once and retains every hidden note and field.
try {
  const clock = makeClock();
  const hit = { closest: () => ({ getAttribute: () => 'n_c' }) };
  const h = makeHarness([
    fixture('n_a', 'alpha', 0, { locked: true }), fixture('n_b', 'secret', 1, { color: 5 }), fixture('n_c', 'charlie', 2),
  ], { query: 'a', setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, document: { elementFromPoint: () => hit } });
  check(!!h.slot('n_a') && !!h.slot('n_c') && !h.slot('n_b'), 'search fixture did not hide B');
  const target = { setPointerCapture() {}, releasePointerCapture() {} };
  const event = { button: 0, pointerId: 1, clientX: 1, clientY: 1, currentTarget: target, target };
  h.dragButton('n_a').props.onPointerDown(event); clock.advance(400); h.dragButton('n_a').props.onPointerUp(event); h.render();
  check(h.posts().length === 1, 'filtered drop did not persist exactly once');
  check(h.storageWrites.filter((w) => w.key === 'dsh-sticky-wall:notes').length === 1, 'filtered drop mirrored more than once');
  check(h.notes().length === 3, 'filtered drop lost a note');
  const hidden = h.notes().find((n) => n.id === 'n_b');
  check(!!hidden && hidden.text === 'secret' && hidden.color === 5, 'hidden note was lost or mutated');
  check(!h.slot('n_b'), 'hidden note appeared without clearing search');
  const ordered = h.notes().slice().sort((a, b) => a.order - b.order);
  check(ordered.map((n) => n.order).join(',') === '0,1,2', 'drop did not write continuous order values');
  check(ordered.every((n) => Object.prototype.hasOwnProperty.call(n, 'locked')), 'drop stripped locked fields');
  check(ordered.map((n) => n.id).join(',') === 'n_b,n_c,n_a', 'A dropped after C should produce B,C,A; got ' + ordered.map((n) => n.id).join(','));
  console.log('PASS filtered reorder persists once and retains hidden notes');
} catch (e) { failures++; console.log('FAIL filtered reorder:', e.message); }


// 19) S2/S3 coalesce behind S1; rejection releases S3 and a drained queue
// permits an immediate S4. Every snapshot is mirrored synchronously.
try {
  const pending = [];
  const h = makeHarness([fixture('n_queue', 'queue', 0)], { fetchImpl: () => {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    pending.push({ resolve, reject });
    return promise;
  } });
  const select = (color) => {
    h.openMenu('n_queue');
    h.card('n_queue').filter((n) => String(n.props['aria-label']).startsWith('T:color'))[color].props.onClick();
    h.render();
  };
  const posted = () => h.posts().map((args) => JSON.parse(args[1].body).notes[0].color);
  const mirrored = () => h.storageWrites.map((write) => JSON.parse(write.value)[0].color);
  select(1);
  check(pending.length === 1 && posted().join(',') === '1', 'S1 did not start immediately');
  select(2);
  check(pending.length === 1 && mirrored().join(',') === '1,2', 'S2 was not immediately mirrored');
  select(3);
  check(pending.length === 1, 'S2/S3 should wait for S1');
  check(mirrored().join(',') === '1,2,3', 'snapshots were not synchronously mirrored');
  pending[0].reject(new Error('intentional S1 rejection'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  check(pending.length === 2, 'S1 rejection did not release queued write');
  check(posted().join(',') === '1,3', 'queue sent stale S2 instead of newest S3');
  pending[1].resolve({ ok: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  check(pending.length === 2, 'settled S3 unexpectedly started another write');
  select(4);
  check(pending.length === 3, 'S4 did not start immediately after queue drained');
  check(posted().join(',') === '1,3,4', 'S4 was not the next host snapshot');
  check(mirrored().join(',') === '1,2,3,4', 'S4 was not immediately mirrored');
  pending[2].resolve({ ok: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  console.log('PASS persistence queue coalescing + rejection recovery');
} catch (e) { failures++; console.log('FAIL persistence queue:', e.message); }

console.log('SUMMARY original=10 newCases=9 newAssertions=' + newAssertions + ' failures=' + failures);

process.exit(failures ? 1 : 0);
