/**
 * Allow-list SVG sanitiser and optimiser for the emoji pack.
 *
 * Pure functions, no dependencies: a small hand-rolled XML tokenizer builds a
 * tree, the tree is walked against an element and attribute allow-list, and
 * the survivors are re-serialised compactly. Anything not explicitly allowed
 * (scripts, styles, foreign content, images, links, filters, comments,
 * doctypes, processing instructions, text) is dropped together with its
 * content. Every id is prefixed so many emoji can be inlined into one SVG
 * document without collisions, and every local reference is rewritten to
 * match. External references of any kind are removed.
 */

const ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline', 'line',
  'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'use',
]);

const ALLOWED_ATTRIBUTES = new Set([
  'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height',
  'points', 'fill', 'fill-rule', 'fill-opacity', 'clip-rule', 'stroke', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-opacity', 'opacity',
  'transform', 'gradientUnits', 'gradientTransform', 'offset', 'stop-color', 'stop-opacity',
  'fx', 'fy', 'clip-path', 'mask', 'maskUnits', 'id', 'href', 'xlink:href', 'viewBox',
  'xmlns', 'xmlns:xlink', 'spreadMethod',
]);

/** Elements that paint something on their own. */
const SHAPES = new Set(['path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline', 'line', 'use']);
/** Elements whose content is never painted directly. */
const NON_RENDERED = new Set(['defs', 'linearGradient', 'radialGradient', 'clipPath', 'mask']);
const GRADIENTS = new Set(['linearGradient', 'radialGradient']);

/** Inherited presentation attributes and their initial values. */
const INHERITED_DEFAULTS = {
  fill: '#000',
  'fill-rule': 'nonzero',
  'fill-opacity': '1',
  'clip-rule': 'nonzero',
  stroke: 'none',
  'stroke-width': '1',
  'stroke-linecap': 'butt',
  'stroke-linejoin': 'miter',
  'stroke-miterlimit': '4',
  'stroke-opacity': '1',
};

/** Non-inherited attributes that are dropped when they hold their initial value. */
const NON_INHERITED_DEFAULTS = { opacity: '1', 'stop-opacity': '1' };

const COORD_ATTRS = new Set(['cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'fx', 'fy']);
const UNIT_ATTRS = new Set(['opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity', 'offset']);
const COLOUR_ATTRS = new Set(['fill', 'stroke', 'stop-color']);
const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const ID_RE = /^[A-Za-z_][\w.:-]*$/;

/* ------------------------------------------------------------------ */
/* Tokenizer                                                          */
/* ------------------------------------------------------------------ */

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[\w:.-]/;
const WS = /\s/;

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);?/g, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e];
  });
}

function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Parses markup into a forest of `{ name, attrs: [name, value][], children }`.
 * Text, comments, CDATA, doctypes (including internal subsets) and processing
 * instructions are consumed and discarded. Malformed input never throws: an
 * unterminated construct simply ends the document.
 */
function parse(src) {
  const root = { name: '#root', attrs: [], children: [] };
  const stack = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    i = lt;
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i + 9);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (src[i + 1] === '!') {
      // DOCTYPE or other declaration; skip quoted strings and a bracketed subset.
      let j = i + 2;
      let depth = 0;
      let quote = '';
      for (; j < n; j++) {
        const ch = src[j];
        if (quote) { if (ch === quote) quote = ''; continue; }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '[') depth++;
        else if (ch === ']') depth = Math.max(0, depth - 1);
        else if (ch === '>' && depth === 0) break;
      }
      i = j + 1;
      continue;
    }
    if (src[i + 1] === '?') {
      const end = src.indexOf('?>', i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (src[i + 1] === '/') {
      const end = src.indexOf('>', i + 2);
      if (end < 0) break;
      const name = src.slice(i + 2, end).trim();
      i = end + 1;
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) { stack.length = k; break; }
      }
      continue;
    }
    if (!NAME_START.test(src[i + 1] ?? '')) { i++; continue; }
    // Start tag.
    let j = i + 1;
    while (j < n && NAME_CHAR.test(src[j])) j++;
    const name = src.slice(i + 1, j);
    const attrs = [];
    let selfClose = false;
    let closed = false;
    while (j < n) {
      while (j < n && WS.test(src[j])) j++;
      if (src[j] === '>') { j++; closed = true; break; }
      if (src[j] === '/' && src[j + 1] === '>') { j += 2; selfClose = true; closed = true; break; }
      if (src[j] === '/') { j++; continue; }
      const a0 = j;
      while (j < n && !WS.test(src[j]) && src[j] !== '=' && src[j] !== '>' && src[j] !== '/') j++;
      const aname = src.slice(a0, j);
      while (j < n && WS.test(src[j])) j++;
      let value = '';
      if (src[j] === '=') {
        j++;
        while (j < n && WS.test(src[j])) j++;
        const q = src[j];
        if (q === '"' || q === "'") {
          const end = src.indexOf(q, j + 1);
          if (end < 0) { j = n; break; }
          value = src.slice(j + 1, end);
          j = end + 1;
        } else {
          const v0 = j;
          while (j < n && !WS.test(src[j]) && src[j] !== '>') j++;
          value = src.slice(v0, j);
        }
      }
      if (aname) attrs.push([aname, decodeEntities(value)]);
      else j++;
    }
    if (!closed) break;
    i = j;
    const node = { name, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root.children;
}

/* ------------------------------------------------------------------ */
/* Numbers                                                            */
/* ------------------------------------------------------------------ */

const NUM_RE = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;

/** Rounds to `decimals` places and prints the shortest equivalent form. */
function fmt(v, decimals) {
  const p = 10 ** decimals;
  let r = Math.round(v * p) / p;
  if (Object.is(r, -0) || r === 0) return '0';
  let s = r.toFixed(decimals);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (s.startsWith('0.')) s = s.slice(1);
  else if (s.startsWith('-0.')) s = '-' + s.slice(2);
  return s;
}

/** Joins formatted numbers with the minimum separators needed to re-parse them. */
function joinNumbers(parts, prev = '') {
  let out = '';
  let last = prev;
  for (const p of parts) {
    if (needsSeparator(last, p)) out += ' ';
    out += p;
    last = p;
  }
  return out;
}

function needsSeparator(last, next) {
  if (!last || !/[\d.]$/.test(last)) return false;
  if (next[0] === '-' || next[0] === '+') return false;
  if (next[0] === '.') return !last.includes('.');
  return true;
}

function roundList(value, decimals) {
  const nums = value.match(NUM_RE);
  if (!nums) return null;
  return joinNumbers(nums.map((x) => fmt(Number(x), decimals)));
}

const PARAMS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/**
 * Parses path data, resolves every segment to absolute coordinates, rounds
 * them to `decimals` places and re-serialises each segment in whichever of
 * its absolute or relative spellings is shorter. Relative offsets are taken
 * from the rounded current point, so rounding never accumulates along a
 * sub-path. Returns null when nothing drawable parsed.
 */
export function compactPathData(d, decimals = 2) {
  let i = 0;
  const n = d.length;
  let cmd = '';
  let cx = 0, cy = 0, sx = 0, sy = 0;
  let lastCmd = '';
  let text = '';
  let lastToken = '';
  const skipSep = () => { while (i < n && (WS.test(d[i]) || d[i] === ',')) i++; };
  const readNum = () => {
    skipSep();
    NUM_RE.lastIndex = i;
    const m = NUM_RE.exec(d);
    if (!m || m.index !== i) return null;
    i += m[0].length;
    return Number(m[0]);
  };
  const readFlag = () => {
    skipSep();
    if (d[i] === '0' || d[i] === '1') return Number(d[i++]);
    return null;
  };
  // The emitted geometry is the rounded absolute geometry. Relative segments
  // are measured from the *rounded* current point, so choosing the shorter of
  // the two spellings per segment never accumulates rounding error.
  const p = 10 ** decimals;
  const rnd = (v) => Math.round(v * p) / p;
  let rx = 0, ry = 0, rsx = 0, rsy = 0;
  const axisOf = (C, k) => {
    if (C === 'H') return 'x';
    if (C === 'V') return 'y';
    if (C === 'A') return k === 5 ? 'x' : k === 6 ? 'y' : '';
    return k % 2 === 0 ? 'x' : 'y';
  };
  const spell = (letter, strs) => {
    let s = '';
    let last = lastToken;
    // A lineto straight after a moveto is implicit.
    const implicit = (letter === 'L' && lastCmd === 'M') || (letter === 'l' && lastCmd === 'm');
    if (!implicit && (letter !== lastCmd || letter === 'M' || letter === 'm')) { s += letter; last = letter; }
    s += joinNumbers(strs, last);
    return s;
  };
  const emit = (C, nums) => {
    if (C === 'Z') {
      text += lastCmd === 'Z' || lastCmd === 'z' ? '' : 'Z';
      lastCmd = 'Z'; lastToken = 'Z';
      rx = rsx; ry = rsy;
      return;
    }
    if (C === 'L' && rnd(nums[0]) === rx) { C = 'V'; nums = [nums[1]]; }
    else if (C === 'L' && rnd(nums[1]) === ry) { C = 'H'; nums = [nums[0]]; }
    const absR = nums.map((v, k) => (C === 'A' && (k === 3 || k === 4) ? v : rnd(v)));
    const relR = absR.map((v, k) => {
      const axis = axisOf(C, k);
      return axis ? rnd(v - (axis === 'x' ? rx : ry)) : v;
    });
    const str = (vals) => vals.map((v, k) => (C === 'A' && (k === 3 || k === 4) ? String(v) : fmt(v, decimals)));
    const absStrs = str(absR);
    const relStrs = str(relR);
    const a = spell(C, absStrs);
    const r = spell(C.toLowerCase(), relStrs);
    const useRel = r.length < a.length;
    text += useRel ? r : a;
    lastCmd = useRel ? C.toLowerCase() : C;
    const strs = useRel ? relStrs : absStrs;
    lastToken = strs.length ? strs[strs.length - 1] : lastCmd;
    for (let k = 0; k < absR.length; k++) {
      const axis = axisOf(C, k);
      if (axis === 'x') rx = absR[k];
      else if (axis === 'y') ry = absR[k];
    }
    if (C === 'M') { rsx = rx; rsy = ry; }
  };
  let drew = false;
  outer: while (true) {
    skipSep();
    if (i >= n) break;
    const ch = d[i];
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(ch)) { cmd = ch; i++; }
    else if (!cmd || cmd === 'Z' || cmd === 'z') break;
    const C = cmd.toUpperCase();
    const rel = cmd !== C;
    if (C === 'Z') {
      emit('Z', []);
      cx = sx; cy = sy;
      continue;
    }
    const count = PARAMS[C];
    const vals = [];
    for (let k = 0; k < count; k++) {
      const v = C === 'A' && (k === 3 || k === 4) ? readFlag() : readNum();
      if (v === null) break outer;
      vals.push(v);
    }
    let abs;
    switch (C) {
      case 'H': abs = [rel ? cx + vals[0] : vals[0]]; cx = abs[0]; break;
      case 'V': abs = [rel ? cy + vals[0] : vals[0]]; cy = abs[0]; break;
      case 'A': {
        const x = rel ? cx + vals[5] : vals[5];
        const y = rel ? cy + vals[6] : vals[6];
        abs = [vals[0], vals[1], vals[2], vals[3], vals[4], x, y];
        cx = x; cy = y;
        break;
      }
      default: {
        abs = vals.map((v, k) => (rel ? v + (k % 2 === 0 ? cx : cy) : v));
        cx = abs[abs.length - 2];
        cy = abs[abs.length - 1];
      }
    }
    emit(C, abs);
    if (C !== 'M') drew = true;
    if (C === 'M') {
      sx = cx; sy = cy;
      // Subsequent implicit pairs after a moveto are linetos.
      cmd = rel ? 'l' : 'L';
    }
  }
  return drew ? text : null;
}

function compactTransform(value) {
  const parts = [];
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(value))) {
    const fn = m[1];
    const nums = (m[2].match(NUM_RE) || []).map(Number);
    const strs = nums.map((v, k) => {
      // Linear terms scale the whole shape, so they keep a third decimal.
      const linear = fn === 'scale' || (fn === 'matrix' && k < 4);
      return fmt(v, linear ? 3 : 2);
    });
    if (fn === 'translate' && strs.every((s) => s === '0')) continue;
    if (fn === 'rotate' && strs[0] === '0') continue;
    if (fn === 'scale' && strs.every((s) => s === '1')) continue;
    parts.push(`${fn}(${strs.join(' ')})`);
  }
  return parts.length ? parts.join('') : '';
}

function shortColour(v) {
  const m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) {
    const h = m[1].toLowerCase();
    if (h[0] === h[1] && h[2] === h[3] && h[4] === h[5]) return `#${h[0]}${h[2]}${h[4]}`;
    return `#${h}`;
  }
  if (/^#[0-9a-f]{3}$/i.test(v)) return v.toLowerCase();
  return v;
}

/* ------------------------------------------------------------------ */
/* Sanitiser                                                          */
/* ------------------------------------------------------------------ */

function hasUse(nodes) {
  return nodes.some((c) => c.name === 'use' || hasUse(c.children));
}

/**
 * Sanitises and optimises one SVG document. Returns null when the input has
 * no `<svg>` root or nothing drawable survives.
 */
export function sanitizeSvg(svg, idPrefix) {
  const warnings = new Set();
  const forest = parse(String(svg));
  const rootNode = forest.find((x) => x.name === 'svg');
  if (!rootNode) return null;
  if (forest.some((x) => x.name !== 'svg')) warnings.add('dropped top-level content outside <svg>');
  const usesUse = hasUse([rootNode]);
  let usesXlink = false;
  let drawable = false;

  const prefixRef = (id) => `${idPrefix}${id}`;

  /** Validates and rewrites one attribute; returns the new value or null to drop it. */
  function cleanAttr(el, name, value, ctx) {
    if (/^on/i.test(name)) { warnings.add(`dropped event attribute ${name}`); return null; }
    if (!ALLOWED_ATTRIBUTES.has(name)) { warnings.add(`dropped attribute ${name}`); return null; }
    const flat = value.toLowerCase().replace(/[\s\u0000-\u001f]/g, '');
    if (flat.includes('javascript:') || flat.includes('data:') || flat.includes('vbscript:')) {
      warnings.add(`dropped unsafe ${name}`);
      return null;
    }
    let v = value.trim().replace(/\s+/g, ' ');
    if (name === 'xmlns' || name === 'xmlns:xlink') return null; // re-added on the root
    if (name === 'href' || name === 'xlink:href') {
      const m = /^#([^\s#]+)$/.exec(v);
      if (!m || !ID_RE.test(m[1])) { warnings.add(`dropped external ${name}`); return null; }
      if (name === 'xlink:href') usesXlink = true;
      return `#${prefixRef(m[1])}`;
    }
    if (name === 'id') {
      if (!ID_RE.test(v)) { warnings.add('dropped malformed id'); return null; }
      return prefixRef(v);
    }
    if (/url\s*\(/i.test(v)) {
      let ok = true;
      const rewritten = v.replace(/url\s*\(\s*(['"]?)([^)'"]*)\1\s*\)/gi, (_, _q, ref) => {
        const m = /^#([^\s#]+)$/.exec(ref.trim());
        if (!m || !ID_RE.test(m[1])) { ok = false; return ''; }
        return `url(#${prefixRef(m[1])})`;
      });
      if (!ok || /url\s*\(/i.test(rewritten.replace(/url\(#[\w.:-]+\)/g, ''))) {
        warnings.add(`dropped external url() in ${name}`);
        return null;
      }
      return rewritten;
    }
    if (name === 'd') return compactPathData(v);
    if (name === 'points') return roundList(v, 2);
    if (name === 'transform' || name === 'gradientTransform') return compactTransform(v);
    if (name === 'viewBox') return roundList(v, 2)?.replace(/(\d)-/g, '$1 -') ?? null;
    if (COORD_ATTRS.has(name)) {
      if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?(%|px)?$/.test(v)) return null;
      const unit = v.endsWith('%') ? '%' : '';
      const decimals = ctx.objectBBox ? 3 : 2;
      return fmt(Number(v.replace(/(%|px)$/, '')), unit ? 2 : decimals) + unit;
    }
    if (UNIT_ATTRS.has(name)) {
      if (/%$/.test(v)) return fmt(Number(v.slice(0, -1)), 2) + '%';
      const num = Number(v);
      return Number.isFinite(num) ? fmt(num, 3) : null;
    }
    if (name === 'stroke-width' || name === 'stroke-miterlimit') {
      const num = Number(v);
      return Number.isFinite(num) ? fmt(num, 2) : null;
    }
    if (COLOUR_ATTRS.has(name)) return shortColour(v);
    return v.replace(/[<>"]/g, '');
  }

  function walk(el, inherited, ctx) {
    if (!ALLOWED_ELEMENTS.has(el.name)) {
      warnings.add(`dropped <${el.name}>`);
      return null;
    }
    const isRoot = el === rootNode;
    const attrs = [];
    const own = { ...inherited };
    const childCtx = { ...ctx };
    if (GRADIENTS.has(el.name)) {
      const units = el.attrs.find(([k]) => k === 'gradientUnits')?.[1];
      childCtx.objectBBox = units !== 'userSpaceOnUse';
    }
    if (el.name === 'clipPath') childCtx.inClip = true;
    if (NON_RENDERED.has(el.name)) childCtx.nonRendered = true;
    const elCtx = { objectBBox: GRADIENTS.has(el.name) ? childCtx.objectBBox : false };
    const seen = new Set();
    for (const [name, raw] of el.attrs) {
      if (seen.has(name)) continue;
      seen.add(name);
      if (isRoot && (name === 'width' || name === 'height')) {
        const num = parseFloat(raw);
        if (Number.isFinite(num) && num > 0) attrs.push([name, fmt(num, 2)]);
        continue;
      }
      const value = cleanAttr(el, name, raw, elCtx);
      if (value === null || value === '') continue;
      if (NON_INHERITED_DEFAULTS[name] === value) continue;
      // Inherited attributes equal to what the element already inherits are
      // redundant. <use> clones inherit from the <use>, not from their place in
      // the tree, so the optimisation is skipped for documents that use it.
      if (!usesUse && name in INHERITED_DEFAULTS) {
        // clip-rule only matters inside a clipPath; on a leaf outside one
        // nothing can inherit it.
        if (name === 'clip-rule' && !ctx.inClip && el.name !== 'clipPath' && el.children.length === 0) continue;
        if (inherited[name] === value) continue;
        own[name] = value;
      }
      attrs.push([name, value]);
    }
    if (el.name === 'path' && !attrs.some(([k]) => k === 'd')) {
      warnings.add('dropped <path> without drawable data');
      return null;
    }
    if (el.name === 'use' && !attrs.some(([k]) => k === 'href' || k === 'xlink:href')) return null;
    const children = [];
    for (const c of el.children) {
      const out = walk(c, own, childCtx);
      if (out) children.push(out);
    }
    if (SHAPES.has(el.name) && !ctx.nonRendered && !childCtx.nonRendered) drawable = true;
    if ((el.name === 'g' || el.name === 'defs') && children.length === 0) return null;
    return { name: el.name, attrs, children };
  }

  const initial = { ...INHERITED_DEFAULTS };
  const tree = walk(rootNode, initial, { objectBBox: false, inClip: false, nonRendered: false });
  if (!tree || !drawable) return null;

  // Root attributes: namespace, viewBox and an intrinsic size for drawImage.
  const get = (k) => tree.attrs.find(([n]) => n === k)?.[1];
  const width = get('width') ?? '32';
  const height = get('height') ?? '32';
  const viewBox = get('viewBox') ?? `0 0 ${width} ${height}`;
  const rest = tree.attrs.filter(([k]) => !['width', 'height', 'viewBox'].includes(k));
  tree.attrs = [['xmlns', SVG_NS], ...(usesXlink ? [['xmlns:xlink', XLINK_NS]] : []), ['width', width], ['height', height], ['viewBox', viewBox], ...rest];

  const ser = (node) => {
    const a = node.attrs.map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join('');
    if (!node.children.length) return `<${node.name}${a}/>`;
    return `<${node.name}${a}>${node.children.map(ser).join('')}</${node.name}>`;
  };
  return { svg: ser(tree), warnings: [...warnings] };
}

/** Lowercase hex code points joined by '-', with every U+FE0F removed. */
export function codeFromSequence(native) {
  const out = [];
  for (const ch of String(native)) {
    const cp = ch.codePointAt(0);
    if (cp === 0xfe0f) continue;
    out.push(cp.toString(16));
  }
  return out.join('-');
}
