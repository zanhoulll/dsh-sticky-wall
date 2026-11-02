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
      marginBottom: '10px',
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

      var taRef = useRef(null);

      // Load once from the host route; fall back to the local mirror.
      useEffect(function () {
        fetch(API, { headers: { accept: 'application/json' }, cache: 'no-store' })
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
          })
          .then(function (data) {
            var list = data && Array.isArray(data.notes) ? data.notes : [];
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
        var note = { id: newId(), text: text, color: color, createdAt: now, updatedAt: now };
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
            ? { id: n.id, text: text, color: n.color, createdAt: n.createdAt, updatedAt: now }
            : n;
        });
        setNotes(next);
        setEditingId(null);
        persist(next);
      }

      function cancelEdit() {
        setEditingId(null);
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

      function renderCard(note) {
        var c = PALETTE[(note.color | 0) % PALETTE.length] || PALETTE[0];
        var isEditing = editingId === note.id;
        var s = String(note.id || '');
        var seed = 0;
        for (var i = 0; i < s.length; i++) seed = (seed + s.charCodeAt(i)) % 1000;
        var rot = ((seed % 5) - 2) * 0.5;
        var cardStyle = {
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          minHeight: '164px',
          padding: '20px 20px 14px',
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
          'article',
          { key: note.id, className: 'dsw-sticky-card', style: cardStyle },
          textEl,
          h(
            'div',
            { key: 'foot', style: CARD_FOOT },
            h('span', { key: 'time', style: CARD_TIME }, relTime(note.updatedAt || note.createdAt, t)),
            h(
              'div',
              { key: 'actions', className: 'dsw-sticky-actions', style: CARD_ACTIONS },
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
            { style: { display: 'flex', alignItems: 'center', gap: '9px' } },
            PALETTE.map(function (_, i) {
              return dotEl(i);
            }),
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
            style: {
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(232px, 1fr))',
              gap: '18px',
              alignItems: 'start',
            },
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
