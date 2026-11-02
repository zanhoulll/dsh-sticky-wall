/**
 * dsh-sticky-wall — Host half.
 *
 * The browser half renders the sticky-note wall; this half only persists the
 * notes so they survive a page refresh, a changed port, or a full restart.
 * Notes are stored as JSON in the user's home directory and served to the
 * browser over one small same-origin route:
 *
 *   GET  /sticky-wall/notes   -> { notes: StickyNote[] }
 *   POST /sticky-wall/notes   -> { ok: true, count: number }   body: { notes: StickyNote[] }
 *
 * `webServer` exists only under the web profile, so the route is registered
 * through an optional scoped inject: a headless profile simply keeps this half
 * dormant instead of failing. Node's built-in fs is enough here, so the plugin
 * stays dependency-free.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const NOTES_FILE = join(homedir(), '.dsh', 'sticky-wall', 'notes.json');
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_NOTES = 2000;
const MAX_TEXT = 20000;
const MAX_COLOR = 11;

/** Clamp whatever the browser sent into a well-formed note, or drop it. */
function normalizeNote(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = typeof raw.text === 'string' ? raw.text.slice(0, MAX_TEXT) : '';
  if (!text.trim()) return null;
  const id =
    typeof raw.id === 'string' && raw.id
      ? raw.id.slice(0, 120)
      : `n_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const color = Number.isInteger(raw.color) ? Math.max(0, Math.min(MAX_COLOR, raw.color)) : 0;
  const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now();
  const updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt;
  return { id, text, color, createdAt, updatedAt };
}

function readNotes() {
  try {
    const data = JSON.parse(readFileSync(NOTES_FILE, 'utf8'));
    const list = Array.isArray(data) ? data : Array.isArray(data?.notes) ? data.notes : [];
    return list.map(normalizeNote).filter(Boolean);
  } catch {
    return [];
  }
}

/** Write atomically: a crash mid-write never leaves a truncated notes file. */
function writeNotes(notes) {
  mkdirSync(dirname(NOTES_FILE), { recursive: true });
  const tmp = `${NOTES_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ notes }, null, 2)}\n`);
  renameSync(tmp, NOTES_FILE);
}

function registerNotesRoute(ctx) {
  const route = {
    name: 'sticky-wall-notes',
    kind: 'exact',
    path: '/sticky-wall/notes',
    handler: async (req, res) => {
      const send = (status, body) => {
        res.writeHead(status, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        });
        res.end(JSON.stringify(body));
      };
      if (req.method === 'GET') {
        send(200, { notes: readNotes() });
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }
      try {
        const chunks = [];
        let total = 0;
        for await (const chunk of req) {
          total += chunk.length;
          if (total > MAX_BYTES) {
            send(413, { error: 'notes payload too large' });
            req.destroy();
            return;
          }
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        const incoming = Array.isArray(body?.notes) ? body.notes : [];
        const notes = incoming.slice(0, MAX_NOTES).map(normalizeNote).filter(Boolean);
        writeNotes(notes);
        send(200, { ok: true, count: notes.length });
      } catch (error) {
        send(400, { error: String(error?.message ?? error) });
      }
    },
  };
  // Holding the route in an effect ties its lifetime to the plugin: switching
  // the bundle off removes it, so the next switch-on is not a duplicate.
  ctx.effect(() => ctx.webServer.register(route), 'dsh-sticky-wall: notes route');
}

export function apply(ctx) {
  if (typeof ctx.inject !== 'function') return;
  ctx.inject(['webServer'], (scope) => {
    try {
      registerNotesRoute(scope);
    } catch (error) {
      console.error(`[dsh-sticky-wall] notes route skipped: ${error}`);
    }
  });
}
