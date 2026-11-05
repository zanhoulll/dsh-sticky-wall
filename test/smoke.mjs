/**
 * dsh-sticky-wall render smoke test.
 *
 * Runs the browser half (client.js) in Node with a tiny React shim and a fake
 * cordis ctx, then calls the registered components directly to assert that the
 * sidebar icon, the empty panel, the waterfall wall (with per-span minimum
 * heights), the ratio controls, the copy button and the edit state all render
 * without throwing. No real DOM or browser needed.
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
  const React = makeReact(hookQueue, opts);
  const win = {
    __ModuleLoader__: { load(def) { win.__def = def; } },
    localStorage: opts.localStorage || { getItem: () => null, setItem() {} },
    setInterval: () => 0,
    clearInterval() {},
  };
  const requireShim = (name) => {
    if (name === 'react') return React;
    throw new Error('unexpected require: ' + name);
  };
  // eslint-disable-next-line no-new-func
  new Function('window', 'require', 'fetch', CODE)(win, requireShim, (...args) =>
    opts.fetchImpl ? opts.fetchImpl(...args) : Promise.reject(new Error('no fetch in test')),
  );
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

let failures = 0;

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
  const cardChip = nodes.find((n) => n.props.title === 'T:ratioCycle · 2:1 · T:ratioSpan');
  if (!cardChip) throw new Error('card has no ratio cycle control');
  if (textOf(cardChip) !== '2:1') throw new Error('card chip label ' + textOf(cardChip));
  console.log('PASS ratio controls, composer=', labels.join(' '), 'card=', textOf(cardChip));
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

process.exit(failures ? 1 : 0);
