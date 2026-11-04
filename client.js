/**
 * dsh-sticky-wall — browser half.
 *
 * A sticky-note wall that lives on its own panel: a sidebar entry ("便签墙")
 * opens a main view with a composer at the top and a wall of coloured cards
 * below. Notes are persisted by the host half over /sticky-wall/notes, with a
 * localStorage mirror so the wall still paints instantly (and survives a host
 * that has no web route).
 *
 * Written in the lazy-CJS bundle protocol (window.__ModuleLoader__.load with a
 * factory returning cordis-plugin exports): no build step, plain DOM elements
 * and inline styles, no imports from dsh client packages.
 */
window.__ModuleLoader__.load({
  id: 'dsh-sticky-wall',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require('react');
    var h = React.createElement;

    var NS = 'dsh-sticky-wall';
    var API = '/sticky-wall/notes';
    var LS_KEY = 'dsh-sticky-wall:notes';
    var PANEL_ID = 'sticky-wall';

    var FONT =
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", sans-serif';

    // Six pastel papers. `dot` is the swatch in the composer, `card`/`edge`
    // paint the note itself.
    var PALETTE = [
      { key: 'sun', dot: '#F4C752', card: '#FCE8A8', edge: '#F1D588' },
      { key: 'rose', dot: '#F2A2B0', card: '#FBDAE0', edge: '#F3C6CE' },
      { key: 'sky', dot: '#8DC2EE', card: '#D8E9FB', edge: '#C4DEF5' },
      { key: 'mint', dot: '#89D6C1', card: '#D5F2E8', edge: '#BFE9DD' },
      { key: 'violet', dot: '#B7A2EC', card: '#E7DCFC', edge: '#D8C9F6' },
      { key: 'cream', dot: '#D8C49B', card: '#F5ECDB', edge: '#EADFC9' },
    ];

    // A note's ratio is how many columns it claims: 1 is a single cell, 2..4
    // reach out to the right and take slots away from the rest of that row.
    // The height is only a *floor* — text taller than that grows the card, and
    // the masonry packer below gives the taller card room by pushing its
    // neighbours down.
    var RATIOS = [1, 2, 3, 4];
    var GAP = 18;
    var TARGET_COL = 236;
    // Every note is one cell tall, so the shape comes from its width, not from
    // shrinking the type.
    var CARD_PAD = '20px 20px 14px';

    // 1:1 .. 4:1 -> how many columns the note claims on the wall.
    function ratioOf(note) {
      var r = Math.round(Number(note && note.ratio));
      return r >= 1 && r <= 4 ? r : 1;
    }

    var zh = {
      nav: '便签墙',
      title: '便签墙',
      subtitle: '每个灵感，都值得记下。便签自动保存。',
      placeholder: '写下你的下一个灵感…',
      search: '搜索便签',
      add: '+ 添加到墙上',
      hint: '⌘/Ctrl + Enter',
      count: '{n} 张便签',
      empty: '还没有便签，写下你的第一条灵感吧。',
      emptySearch: '没有匹配的便签。',
      justNow: '刚刚',
      minutesAgo: '{n} 分钟前',
      hoursAgo: '{n} 小时前',
      daysAgo: '{n} 天前',
      editNote: '编辑',
      deleteNote: '删除',
      editHint: '双击编辑 · ⌘/Ctrl + Enter 保存 · Esc 取消',
      ratio: '比例',
      ratioSpan: '占 {n} 格',
      ratioCycle: '点击切换占位比例',
    };

    var en = {
      nav: 'Sticky Notes',
      title: 'Sticky Notes',
      subtitle: 'Every spark deserves a place. Notes save automatically.',
      placeholder: 'Write your next idea…',
      search: 'Search notes',
      add: '+ Add to wall',
      hint: '⌘/Ctrl + Enter',
      count: '{n} notes',
      empty: 'No notes yet — write your first idea.',
      emptySearch: 'No matching notes.',
      justNow: 'just now',
      minutesAgo: '{n} min ago',
      hoursAgo: '{n} h ago',
      daysAgo: '{n} d ago',
      editNote: 'Edit',
      deleteNote: 'Delete',
      editHint: 'Double-click to edit · ⌘/Ctrl + Enter to save · Esc to cancel',
      ratio: 'Ratio',
      ratioSpan: 'spans {n} columns',
      ratioCycle: 'Click to cycle how many columns it spans',
    };

    function fallbackText(key) {
      return en[key] != null ? en[key] : key;
    }

    function newId() {
      return 'n_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    function readLocal() {
      try {
        var raw = window.localStorage.getItem(LS_KEY);
        if (!raw) return [];
        var arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
      } catch (e) {
        return [];
      }
    }

    function relTime(ts, t) {
      var diff = Date.now() - (Number(ts) || 0);
      if (!Number.isFinite(diff) || diff < 0) diff = 0;
      var min = Math.floor(diff / 60000);
      if (min < 1) return t('justNow');
      if (min < 60) return t('minutesAgo').replace('{n}', String(min));
      var hrs = Math.floor(min / 60);
      if (hrs < 24) return t('hoursAgo').replace('{n}', String(hrs));
      var days = Math.floor(hrs / 24);
      return t('daysAgo').replace('{n}', String(days));
    }

    function searchIcon() {
      return h(
        'svg',
        {
          width: 16,
          height: 16,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': 'true',
          style: { flexShrink: 0, color: 'var(--dsw-alias-label-secondary, #6b7280)' },
        },
        h('circle', { cx: 11, cy: 11, r: 6.5, stroke: 'currentColor', strokeWidth: 1.8 }),
        h('path', {
          d: 'M16 16l4.5 4.5',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
        }),
      );
    }

    function pencilIcon() {
      return h(
        'svg',
        { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M4 20h4L18 10l-4-4L4 16v4Z',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinejoin: 'round',
        }),
        h('path', { d: 'M13.5 6.5l4 4', stroke: 'currentColor', strokeWidth: 1.7 }),
      );
    }

    function trashIcon() {
      return h(
        'svg',
        { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    // Sidebar icon: a little sticky note with a folded corner.
    function SidebarIcon(props) {
      var size = props && typeof props.size === 'number' ? props.size : 18;
      var active = !!(props && props.active);
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
        },
        h('path', {
          d: 'M5 4.5h9.4L19.5 9.6V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1Z',
          stroke: 'currentColor',
          strokeWidth: active ? 1.9 : 1.7,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M14 4.6V9.9h5.3',
          stroke: 'currentColor',
          strokeWidth: active ? 1.9 : 1.7,
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M7.5 12.5h6M7.5 15.5h4',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
        }),
      );
    }

    var CSS = [
      '.dsw-sticky-root *{box-sizing:border-box}',
      '.dsw-sticky-scroll{scrollbar-width:thin}',
      '.dsw-sticky-scroll::-webkit-scrollbar{width:10px}',
      '.dsw-sticky-scroll::-webkit-scrollbar-thumb{background:rgba(120,120,120,0.32);border-radius:8px;border:3px solid transparent;background-clip:padding-box}',
      '.dsw-sticky-ta::placeholder{color:#8C7A4A;opacity:0.85}',
      '.dsw-sticky-card{transform:rotate(var(--rot,0deg));transition:transform .18s ease, box-shadow .18s ease;animation:dswStickyIn .22s ease both}',
      '.dsw-sticky-card:hover{transform:rotate(0deg) translateY(-3px);box-shadow:0 16px 30px rgba(24,20,12,0.16),0 3px 8px rgba(24,20,12,0.08);z-index:2}',
      '.dsw-sticky-actions{opacity:0;transition:opacity .15s ease}',
      '.dsw-sticky-card:hover .dsw-sticky-actions,.dsw-sticky-card:focus-within .dsw-sticky-actions{opacity:1}',
      '.dsw-sticky-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;border:none;cursor:pointer;background:rgba(255,255,255,0.55);color:#5A5340;padding:0}',
      '.dsw-sticky-iconbtn:hover{background:rgba(255,255,255,0.92)}',
      '.dsw-sticky-add:hover:not(:disabled){filter:brightness(1.1)}',
      '.dsw-sticky-add:active:not(:disabled){transform:translateY(1px)}',
      '.dsw-sticky-add:disabled{opacity:0.45;cursor:not-allowed}',
      '.dsw-sticky-search input::-webkit-search-cancel-button{display:none}',
      '.dsw-sticky-wall{position:relative;transition:height .24s cubic-bezier(.22,.8,.24,1)}',
      // No width transition: the packer measures card heights right after
      // commit, and a mid-flight width would be measured instead of the final
      // one, leaving overlaps behind.
      '.dsw-sticky-slot{position:absolute;top:0;left:0;will-change:transform}',
      // Positions only animate once the first packing has landed, otherwise the
      // whole wall would fly in from the top-left corner on mount.
      '.dsw-sticky-ready .dsw-sticky-slot{transition:transform .26s cubic-bezier(.22,.8,.24,1)}',
      '.dsw-sticky-slot:hover{z-index:3}',
      '.dsw-sticky-ratiochip{font-variant-numeric:tabular-nums}',
      '@keyframes dswStickyIn{from{opacity:0}to{opacity:1}}',
    ].join('\n');

    var ROOT = {
      height: '100%',
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--dsw-alias-bg-base, #ffffff)',
      color: 'var(--dsw-alias-label-primary, #1f2328)',
      overflow: 'hidden',
      fontFamily: FONT,
    };
    var SCROLL = {
      flex: '1 1 auto',
      minHeight: 0,
      overflowY: 'auto',
      overflowX: 'hidden',
      padding: '28px 40px 56px',
    };
    var WRAP = { width: '100%', maxWidth: '1040px', margin: '0 auto' };
    var ADD_BTN = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      height: '40px',
      padding: '0 20px',
      borderRadius: '12px',
      border: 'none',
      cursor: 'pointer',
      background: '#3D362A',
      color: '#FBF3DC',
      fontSize: '14px',
      fontWeight: 600,
      whiteSpace: 'nowrap',
      boxShadow: '0 4px 12px rgba(61,54,42,0.25)',
      fontFamily: 'inherit',
    };
    var CARD_TEXT = {
      fontSize: '17px',
      lineHeight: '1.55',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      cursor: 'text',
      flex: '1 1 auto',
      marginBottom: '14px',
    };
    var CARD_FOOT = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
      minHeight: '26px',
    };
    var CARD_TIME = { fontSize: '12px', color: 'rgba(59,54,43,0.62)' };
    var CARD_ACTIONS = { display: 'flex', alignItems: 'center', gap: '6px' };
    // Metrics deliberately mirror CARD_TEXT (same font, line height, padding and
    // bottom margin) so switching a note into edit mode does not shift a single
    // pixel of the text.
    var EDIT_TA = {
      width: '100%',
      flex: '1 1 auto',
      minHeight: '90px',
      resize: 'none',
      border: 'none',
      outline: 'none',
      background: 'transparent',
      color: '#3B362B',
      fontSize: '17px',
      lineHeight: '1.55',
      fontFamily: 'inherit',
      padding: 0,
      marginBottom: '14px',
      boxSizing: 'border-box',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      overflowY: 'hidden',
    };
    var EMPTY = { padding: '64px 0', textAlign: 'center' };

    function App(props) {
      var t = props.t;
      var useState = React.useState;
      var useEffect = React.useEffect;
      var useRef = React.useRef;
      var useMemo = React.useMemo;

      var notesState = useState([]);
      var notes = notesState[0];
      var setNotes = notesState[1];

      var draftState = useState('');
      var draft = draftState[0];
      var setDraft = draftState[1];

      var colorState = useState(0);
      var color = colorState[0];
      var setColor = colorState[1];

      var ratioState = useState(1);
      var ratio = ratioState[0];
      var setRatio = ratioState[1];

      var queryState = useState('');
      var query = queryState[0];
      var setQuery = queryState[1];

      var editIdState = useState(null);
      var editingId = editIdState[0];
      var setEditingId = editIdState[1];

      var editTextState = useState('');
      var editingText = editTextState[0];
      var setEditingText = editTextState[1];

      var tickState = useState(0);
      var setTick = tickState[1];

      // Masonry state: every card is absolutely placed inside .dsw-sticky-wall,
      // so the wall needs the packed positions and the packed height.
      // cols starts at a guess and is corrected by the packer before paint.
      var layoutState = useState({ width: TARGET_COL, colW: TARGET_COL, cols: 4, height: 0, pos: {} });
      var layout = layoutState[0];
      var setLayout = layoutState[1];

      var colState = useState(TARGET_COL);
      var colW = colState[0];
      var setColW = colState[1];

      var taRef = useRef(null);
      var editRef = useRef(null);
      var editSize = useRef(null);
      var wallRef = useRef(null);
      var cardRefs = useRef({});

      // Layout measurement must settle before the browser paints, otherwise the
      // wall would flash its unpositioned stack.
      var useLayoutEffect = React.useLayoutEffect || React.useEffect || function () {};

      // The stored note may be older than the ratio feature — or written by a
      // host process that still predates it, in which case the field is stripped
      // on every save. The local mirror is written by this browser and does keep
      // it, so recover a missing ratio from there before falling back to square.
      function hydrate(list) {
        var byId = {};
        readLocal().forEach(function (n) {
          if (n && n.id) byId[n.id] = n;
        });
        return list.map(function (n) {
          var mine = byId[n.id];
          var r = n.ratio != null ? ratioOf(n) : mine ? ratioOf(mine) : 1;
          return Object.assign({}, n, { ratio: r });
        });
      }

      // Load once from the host route; fall back to the local mirror.
      useEffect(function () {
        fetch(API, { headers: { accept: 'application/json' }, cache: 'no-store' })
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
          })
          .then(function (data) {
            var list =
              data && Array.isArray(data.notes)
                ? hydrate(
                    data.notes.filter(function (n) {
                      return n && typeof n === 'object';
                    }),
                  )
                : [];
            setNotes(list);
            try {
              window.localStorage.setItem(LS_KEY, JSON.stringify(list));
            } catch (e) {}
          })
          .catch(function () {
            var local = readLocal();
            if (local.length) setNotes(local);
          });
        var timer = window.setInterval(function () {
          setTick(function (x) {
            return x + 1;
          });
        }, 30000);
        return function () {
          window.clearInterval(timer);
        };
      }, []);

      function persist(list) {
        try {
          window.localStorage.setItem(LS_KEY, JSON.stringify(list));
        } catch (e) {}
        fetch(API, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ notes: list }),
        }).catch(function () {});
      }

      function addNote() {
        var text = draft.trim();
        if (!text) return;
        var now = Date.now();
        var note = { id: newId(), text: text, color: color, ratio: ratio, createdAt: now, updatedAt: now };
        var next = [note].concat(notes);
        setNotes(next);
        setDraft('');
        setColor(0);
        persist(next);
        if (taRef.current) taRef.current.focus();
      }

      function removeNote(id) {
        var next = notes.filter(function (n) {
          return n.id !== id;
        });
        setNotes(next);
        persist(next);
        if (editingId === id) setEditingId(null);
      }

      function beginEdit(note) {
        setEditingId(note.id);
        setEditingText(note.text || '');
      }

      function commitEdit() {
        var id = editingId;
        if (id == null) return;
        var text = editingText.trim();
        if (!text) {
          removeNote(id);
          return;
        }
        var now = Date.now();
        var next = notes.map(function (n) {
          return n.id === id
            ? { id: n.id, text: text, color: n.color, ratio: ratioOf(n), createdAt: n.createdAt, updatedAt: now }
            : n;
        });
        setNotes(next);
        setEditingId(null);
        persist(next);
      }

      function cancelEdit() {
        setEditingId(null);
      }

      // Re-shape a note without touching updatedAt: the wall sorts by edit
      // time, and changing a note's proportions is not an edit of its content.
      function cycleRatio(id) {
        var next = notes.map(function (n) {
          if (n.id !== id) return n;
          return {
            id: n.id,
            text: n.text,
            color: n.color,
            ratio: (ratioOf(n) % RATIOS.length) + 1,
            createdAt: n.createdAt,
            updatedAt: n.updatedAt,
          };
        });
        setNotes(next);
        persist(next);
      }

      function onComposerKeyDown(e) {
        if ((e.metaKey || e.ctrlKey) && (e.key === 'Enter' || e.keyCode === 13)) {
          e.preventDefault();
          addNote();
        }
      }

      function onEditKeyDown(e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          cancelEdit();
        } else if ((e.metaKey || e.ctrlKey) && (e.key === 'Enter' || e.keyCode === 13)) {
          e.preventDefault();
          commitEdit();
        }
      }

      var filtered = useMemo(
        function () {
          var list = notes.slice().sort(function (a, b) {
            return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
          });
          var q = query.trim().toLowerCase();
          if (!q) return list;
          return list.filter(function (n) {
            return String(n.text || '')
              .toLowerCase()
              .indexOf(q) !== -1;
          });
        },
        [notes, query],
      );

      // --- Waterfall packing -------------------------------------------------
      // A note's ratio is how many columns it claims: 1:1 takes one cell,
      // 2:1 takes two, 4:1 takes four. The packer drops each card into the
      // topmost place where its span fits, so a wider card takes the room from
      // its neighbours ("that row ends up with one column fewer"), and a card
      // that outgrows its nominal height pushes the rest of its span down.

      function measureLayout() {
        var wall = wallRef.current;
        if (!wall) return null;
        var total = Math.round(wall.clientWidth || 0);
        if (!(total > 0)) return null;
        var cols = Math.max(1, Math.floor((total + GAP) / (TARGET_COL + GAP)));
        var colW = Math.floor((total - GAP * (cols - 1)) / cols);
        if (!(colW > 0)) return null;
        // Per column, the occupied bands as [top, bottom) pairs with the gap
        // already baked into `bottom`. Tracking bands instead of a single
        // column height is what lets a later card drop into a hole left by a
        // wide card that skipped over a short column.
        var occ = [];
        var i, j, k, t;
        for (i = 0; i < cols; i++) occ.push([]);
        var pos = {};
        for (i = 0; i < filtered.length; i++) {
          var note = filtered[i];
          var span = Math.min(ratioOf(note), cols);
          var width = span * colW + (span - 1) * GAP;
          var node = cardRefs.current[note.id];
          // Before a card can be measured (first paint), estimate one cell of
          // height so the wall never stacks everything at the origin.
          var h = (node ? node.offsetHeight : Math.round(width / span) + 24) + GAP;
          var best = null;
          for (k = 0; k + span <= cols; k++) {
            // A band can only start at the top of the wall or at the bottom of
            // a band it has to clear, so those are the only y worth testing.
            var cands = [0];
            for (j = k; j < k + span; j++) {
              for (t = 0; t < occ[j].length; t++) cands.push(occ[j][t][1]);
            }
            cands.sort(function (p, q) {
              return p - q;
            });
            for (t = 0; t < cands.length; t++) {
              var y = cands[t];
              if (t > 0 && y === cands[t - 1]) continue;
              var fits = true;
              for (j = k; j < k + span && fits; j++) {
                var bands = occ[j];
                for (var b = 0; b < bands.length; b++) {
                  if (y < bands[b][1] - 0.5 && bands[b][0] < y + h - 0.5) {
                    fits = false;
                    break;
                  }
                }
              }
              if (fits) {
                if (!best || y < best.y - 0.5) best = { k: k, y: y };
                break;
              }
            }
          }
          if (!best) {
            // Only reachable if every column were full, i.e. never in practice.
            var drop = 0;
            for (j = 0; j < cols; j++) {
              var last = occ[j][occ[j].length - 1];
              if (last && last[1] > drop) drop = last[1];
            }
            best = { k: 0, y: drop };
          }
          pos[note.id] = {
            x: Math.round(best.k * (colW + GAP)),
            y: Math.round(best.y),
            w: width,
            span: span,
          };
          for (j = best.k; j < best.k + span; j++) {
            var band = occ[j];
            band.push([best.y, best.y + h]);
            band.sort(function (p, q) {
              return p[0] - q[0];
            });
          }
        }
        var bottom = 0;
        for (var m = 0; m < cols; m++) {
          var tail = occ[m][occ[m].length - 1];
          if (tail) bottom = Math.max(bottom, tail[1] - GAP);
        }
        return {
          width: colW,
          colW: colW,
          cols: cols,
          height: Math.max(0, Math.round(bottom)),
          pos: pos,
        };
      }

      function sameLayout(a, b) {
        if (!a || !b) return false;
        if (Math.abs((a.height || 0) - (b.height || 0)) > 0.5) return false;
        if (Math.abs((a.width || 0) - (b.width || 0)) > 0.5) return false;
        if ((a.cols || 0) !== (b.cols || 0)) return false;
        var keys = Object.keys(a.pos || {});
        if (keys.length !== Object.keys(b.pos || {}).length) return false;
        for (var i = 0; i < keys.length; i++) {
          var pa = a.pos[keys[i]];
          var pb = b.pos[keys[i]];
          if (!pb || Math.abs(pa.x - pb.x) > 0.5 || Math.abs(pa.y - pb.y) > 0.5) return false;
        }
        return true;
      }

      // A textarea never grows with its content, so a long note would snap back
      // to its nominal cell height the moment it entered edit mode, and then
      // jump again when the edit was committed. Size the editor to its text
      // before the packer measures the wall, and re-pack in the same frame when
      // its height changed (the wall was packed with the pre-resize height).
      useLayoutEffect(function () {
        var el = editRef.current;
        if (!el) {
          editSize.current = null;
          return;
        }
        el.style.height = 'auto';
        var want = Math.max(0, el.scrollHeight);
        el.style.height = want + 'px';
        var prev = editSize.current;
        if (!prev || prev.id !== editingId || Math.abs(prev.h - want) > 0.5) {
          editSize.current = { id: editingId, h: want };
          setTick(function (x) {
            return x + 1;
          });
        }
      });

      // Runs after every commit; it only writes state when the packing actually
      // changed, so the extra pass a width change causes settles in one go.
      useLayoutEffect(function () {
        if (!filtered.length) {
          if (layout.height !== 0 || Object.keys(layout.pos).length) {
            setLayout({
              width: layout.width,
              colW: layout.colW,
              cols: layout.cols,
              height: 0,
              pos: {},
            });
          }
          return;
        }
        var next = measureLayout();
        if (!next) return;
        if (next.width !== colW) setColW(next.width);
        if (!sameLayout(layout, next)) setLayout(next);
      });

      // A sidebar collapse or a window resize changes the wall width without a
      // React update, so keep an observer on it.
      useEffect(function () {
        var wall = wallRef.current;
        if (!wall || typeof window.ResizeObserver !== 'function') return undefined;
        var ro = new window.ResizeObserver(function () {
          setTick(function (x) {
            return x + 1;
          });
        });
        ro.observe(wall);
        return function () {
          ro.disconnect();
        };
      }, [notes.length]);

      function dotEl(idx) {
        var c = PALETTE[idx];
        var active = idx === color;
        return h('button', {
          key: 'dot_' + idx,
          type: 'button',
          className: 'dsw-sticky-dot',
          'aria-label': c.key,
          title: c.key,
          onClick: function () {
            setColor(idx);
          },
          style: {
            width: '22px',
            height: '22px',
            borderRadius: '50%',
            cursor: 'pointer',
            padding: 0,
            background: c.dot,
            border: active ? '2px solid #3D362A' : '2px solid rgba(255,255,255,0.75)',
            boxShadow: active ? '0 0 0 2px rgba(61,54,42,0.18)' : 'inset 0 0 0 1px rgba(0,0,0,0.06)',
            transform: active ? 'scale(1.06)' : 'none',
            transition: 'transform .12s ease, box-shadow .12s ease',
          },
        });
      }

      function spanLabel(n) {
        return t('ratioSpan').replace('{n}', String(n));
      }

      // Composer shape picker: the ratio the next note is born with.
      function ratioChip(r) {
        var active = r === ratio;
        return h(
          'button',
          {
            key: 'ratio_' + r,
            type: 'button',
            className: 'dsw-sticky-ratiochip',
            title: t('ratio') + ' ' + r + ':1 · ' + spanLabel(r),
            'aria-pressed': active,
            onClick: function () {
              setRatio(r);
            },
            style: {
              height: '26px',
              padding: '0 9px',
              borderRadius: '8px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: '11.5px',
              fontWeight: 700,
              letterSpacing: '0.2px',
              background: active ? '#3D362A' : 'rgba(255,255,255,0.5)',
              color: active ? '#FBF3DC' : '#7A6A3C',
              border: '1px solid ' + (active ? '#3D362A' : 'rgba(97,84,50,0.28)'),
              transition: 'background .15s ease, color .15s ease, border-color .15s ease',
            },
          },
          r + ':1',
        );
      }

      function renderCard(note) {
        var c = PALETTE[(note.color | 0) % PALETTE.length] || PALETTE[0];
        var isEditing = editingId === note.id;
        var s = String(note.id || '');
        var seed = 0;
        for (var i = 0; i < s.length; i++) seed = (seed + s.charCodeAt(i)) % 1000;
        var rot = ((seed % 5) - 2) * 0.5;
        var place = layout.pos[note.id];
        // Span: how many columns this note claims. Capped by the wall width so a
        // 4:1 note still fits a narrow panel.
        var cols = Math.max(1, layout.cols || 1);
        var span = Math.min(ratioOf(note), cols);
        var r = span;
        var slotW = span * colW + (span - 1) * GAP;
        var cardStyle = {
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          // The shape is a floor, not a clamp: long text makes the card taller
          // than one cell and the packer pushes the rest of its span down.
          aspectRatio: String(span),
          padding: CARD_PAD,
          borderRadius: '16px',
          background: c.card,
          border: '1px solid ' + c.edge,
          color: '#3B362B',
          boxShadow: '0 10px 22px rgba(24,20,12,0.10), 0 1px 2px rgba(24,20,12,0.06)',
          '--rot': rot + 'deg',
        };
        var textEl = isEditing
          ? h('textarea', {
              key: 'edit',
              className: 'dsw-sticky-edit',
              ref: editRef,
              style: EDIT_TA,
              value: editingText,
              autoFocus: true,
              onChange: function (e) {
                setEditingText(e.target.value);
              },
              onKeyDown: onEditKeyDown,
              onBlur: commitEdit,
            })
          : h(
              'div',
              {
                key: 'text',
                style: CARD_TEXT,
                title: t('editHint'),
                onDoubleClick: function () {
                  beginEdit(note);
                },
              },
              note.text,
            );
        return h(
          'div',
          {
            key: note.id,
            className: 'dsw-sticky-slot',
            style: {
              width: slotW + 'px',
              transform:
                'translate3d(' + (place ? place.x : 0) + 'px,' + (place ? place.y : 0) + 'px,0)',
            },
          },
          h(
            'article',
            {
              key: 'card',
              className: 'dsw-sticky-card',
              'data-ratio': r,
              style: cardStyle,
              ref: function (el) {
                if (el) cardRefs.current[note.id] = el;
                else delete cardRefs.current[note.id];
              },
            },
            textEl,
            h(
              'div',
              { key: 'foot', style: CARD_FOOT },
              h(
                'span',
                { key: 'time', style: CARD_TIME },
                relTime(note.updatedAt || note.createdAt, t),
              ),
              h(
                'div',
                { key: 'actions', className: 'dsw-sticky-actions', style: CARD_ACTIONS },
                h(
                  'button',
                  {
                    key: 'ratio',
                    type: 'button',
                    className: 'dsw-sticky-iconbtn dsw-sticky-ratiochip',
                    title: t('ratioCycle') + ' · ' + r + ':1 · ' + spanLabel(r),
                    'aria-label': t('ratio') + ' ' + r + ':1 · ' + spanLabel(r),
                    style: { width: 'auto', padding: '0 7px', fontSize: '11px', fontWeight: 700 },
                    onClick: function () {
                      cycleRatio(note.id);
                    },
                  },
                  r + ':1',
                ),
                h(
                  'button',
                  {
                    key: 'edit',
                    type: 'button',
                    className: 'dsw-sticky-iconbtn',
                    title: t('editNote'),
                    'aria-label': t('editNote'),
                    style: {},
                    onClick: function () {
                      beginEdit(note);
                    },
                  },
                  pencilIcon(),
                ),
                h(
                  'button',
                  {
                    key: 'del',
                    type: 'button',
                    className: 'dsw-sticky-iconbtn',
                    title: t('deleteNote'),
                    'aria-label': t('deleteNote'),
                    style: {},
                    onClick: function () {
                      removeNote(note.id);
                    },
                  },
                  trashIcon(),
                ),
              ),
            ),
          ),
        );
      }

      var countLabel = t('count').replace('{n}', String(notes.length));

      var header = h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '20px',
            marginBottom: '22px',
            flexWrap: 'wrap',
          },
        },
        h(
          'div',
          { style: { minWidth: 0 } },
          h(
            'h1',
            {
              style: {
                margin: 0,
                fontSize: '26px',
                lineHeight: '1.25',
                fontWeight: 700,
                letterSpacing: '0.2px',
                color: 'var(--dsw-alias-label-primary, #1f2328)',
              },
            },
            t('title'),
          ),
          h(
            'p',
            {
              style: {
                margin: '6px 0 0',
                fontSize: '14px',
                color: 'var(--dsw-alias-label-secondary, #6b7280)',
              },
            },
            t('subtitle'),
          ),
        ),
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              flexShrink: 0,
              paddingTop: '4px',
            },
          },
          h(
            'label',
            {
              className: 'dsw-sticky-search',
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                height: '38px',
                padding: '0 12px',
                borderRadius: '11px',
                border: '1px solid var(--dsw-alias-border-l1, #e3e6ea)',
                background: 'var(--dsw-alias-bg-layer-1, #f7f8fa)',
                minWidth: '210px',
              },
            },
            searchIcon(),
            h('input', {
              type: 'search',
              value: query,
              placeholder: t('search'),
              onChange: function (e) {
                setQuery(e.target.value);
              },
              style: {
                border: 'none',
                outline: 'none',
                background: 'transparent',
                color: 'inherit',
                fontSize: '13.5px',
                width: '100%',
                fontFamily: 'inherit',
              },
            }),
          ),
          h(
            'span',
            {
              style: {
                fontSize: '13px',
                color: 'var(--dsw-alias-label-secondary, #6b7280)',
                whiteSpace: 'nowrap',
                padding: '0 2px',
              },
            },
            countLabel,
          ),
        ),
      );

      var composer = h(
        'div',
        {
          style: {
            borderRadius: '18px',
            background: '#FBE5A0',
            border: '1px solid #F0D37E',
            padding: '18px 20px 14px',
            boxShadow: '0 8px 24px rgba(214,178,64,0.18)',
            marginBottom: '28px',
          },
        },
        h('textarea', {
          ref: taRef,
          className: 'dsw-sticky-ta',
          value: draft,
          placeholder: t('placeholder'),
          onChange: function (e) {
            setDraft(e.target.value);
          },
          onKeyDown: onComposerKeyDown,
          rows: 2,
          style: {
            width: '100%',
            minHeight: '64px',
            resize: 'none',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: '#4A3F22',
            fontSize: '17px',
            lineHeight: '1.6',
            fontFamily: 'inherit',
          },
        }),
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '16px',
              marginTop: '10px',
              flexWrap: 'wrap',
            },
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } },
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '9px' } },
              PALETTE.map(function (_, i) {
                return dotEl(i);
              }),
            ),
            h('span', {
              key: 'sep',
              style: { width: '1px', height: '18px', background: 'rgba(97,84,50,0.22)' },
            }),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
              RATIOS.map(ratioChip),
            ),
          ),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '14px' } },
            h(
              'span',
              { style: { fontSize: '12.5px', color: '#8C7A4A', whiteSpace: 'nowrap' } },
              t('hint'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsw-sticky-add',
                onClick: addNote,
                disabled: !draft.trim(),
                style: ADD_BTN,
              },
              t('add'),
            ),
          ),
        ),
      );

      var grid;
      if (notes.length === 0) {
        grid = h(
          'div',
          { style: EMPTY },
          h(
            'div',
            { style: { fontSize: '15px', color: 'var(--dsw-alias-label-secondary, #6b7280)' } },
            t('empty'),
          ),
        );
      } else if (filtered.length === 0) {
        grid = h(
          'div',
          { style: EMPTY },
          h(
            'div',
            { style: { fontSize: '15px', color: 'var(--dsw-alias-label-secondary, #6b7280)' } },
            t('emptySearch'),
          ),
        );
      } else {
        grid = h(
          'div',
          {
            key: 'wall',
            ref: wallRef,
            className: layout.height > 0 ? 'dsw-sticky-wall dsw-sticky-ready' : 'dsw-sticky-wall',
            style: { height: (layout.height || 0) + 'px' },
          },
          filtered.map(renderCard),
        );
      }

      return h(
        'div',
        { className: 'dsw-sticky-root', style: ROOT },
        h('style', { key: 'css' }, CSS),
        h(
          'div',
          { key: 'scroll', className: 'dsw-sticky-scroll', style: SCROLL },
          h('div', { key: 'wrap', style: WRAP }, header, composer, grid),
        ),
      );
    }

    function apply(ctx) {
      var locale = ctx.locale;
      var slots = ctx.slots;

      if (locale && typeof locale.register === 'function') {
        ctx.effect(function () {
          return locale.register(NS, { zh: zh, en: en });
        }, NS + ': dictionaries');
      }

      var t =
        locale && typeof locale.bind === 'function'
          ? locale.bind(NS)
          : function (key) {
              return fallbackText(key);
            };

      slots.inject('sidebar.panellist', function () {
        return slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 15,
            label: function () {
              return t('nav');
            },
            locale: NS,
          },
          SidebarIcon,
        );
      });

      slots.inject('main', function () {
        return slots.register({ name: 'main', key: PANEL_ID }, function StickyWallPanel() {
          return h(App, { t: t });
        });
      });
    }

    exports.apply = apply;
    exports.inject = ['slots', 'locale'];
    return module.exports;
  },
});
