/**
 * dsh-sticky-wall render smoke test.
 *
 * Runs the browser half (client.js) in Node with a tiny React shim and a fake
 * cordis ctx, then calls the registered components directly to assert that the
 * sidebar icon, the empty panel, the card grid and the edit state all render
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

function makeReact(hookQueue) {
  const createElement = (type, props, ...children) => ({
    type: typeof type === 'function' ? type : String(type),
    props: props || {},
    children,
  });
  const React = {
    createElement,
    useState(init) {
      const v = hookQueue.length ? hookQueue.shift() : typeof init === 'function' ? init() : init;
      return [v, () => {}];
    },
    useRef(init) {
      return { current: init };
    },
    useEffect() {},
    useMemo(fn) {
      return fn();
    },
  };
  return React;
}

function boot(hookQueue) {
  const React = makeReact(hookQueue);
  const win = {
    __ModuleLoader__: { load(def) { win.__def = def; } },
    localStorage: { getItem: () => null, setItem() {} },
    setInterval: () => 0,
    clearInterval() {},
  };
  const requireShim = (name) => {
    if (name === 'react') return React;
    throw new Error('unexpected require: ' + name);
  };
  // eslint-disable-next-line no-new-func
  new Function('window', 'require', 'fetch', CODE)(win, requireShim, () =>
    Promise.reject(new Error('no fetch in test')),
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

function walk(node, out) {
  if (node == null) return;
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n, out));
    return;
  }
  if (typeof node !== 'object') return;
  out.push(node.type);
  (node.children || []).forEach((c) => walk(c, out));
}

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
  const mainEl = cap.main.comp({});
  const App = mainEl.type;
  const tree = App({ t: (k) => 'T:' + k });
  const types = [];
  walk(tree, types);
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
  const mainEl = cap.main.comp({});
  const tree = mainEl.type({ t: (k) => 'T:' + k });
  const types = [];
  walk(tree, types);
  const articles = types.filter((t) => t === 'article').length;
  if (articles !== 2) throw new Error('expected 2 article cards, got ' + articles);
  console.log('PASS cards render, articles=', articles);
} catch (e) {
  failures++;
  console.log('FAIL cards render:', e.message);
}

// 4) Edit mode renders a textarea in the card.
try {
  const now = Date.now();
  const notes = [{ id: 'n_abc', text: '可编辑内容', color: 2, createdAt: now, updatedAt: now }];
  // hook order: notes, draft, color, query, editingId, editingText, tick
  const cap = boot([notes, '', 0, '', 'n_abc', '可编辑内容', 0]);
  const tree = cap.main.comp({}).type({ t: (k) => 'T:' + k });
  const types = [];
  walk(tree, types);
  const tas = types.filter((t) => t === 'textarea').length;
  if (tas < 2) throw new Error('expected composer + edit textareas, got ' + tas);
  console.log('PASS edit mode render, textareas=', tas);
} catch (e) {
  failures++;
  console.log('FAIL edit mode render:', e.message);
}

process.exit(failures ? 1 : 0);
