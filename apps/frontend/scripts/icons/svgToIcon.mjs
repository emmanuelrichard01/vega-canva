/**
 * Vendor SVG -> compact, sanitised icon geometry.
 *
 * This is the security boundary for icon packs. The output contains only
 * `{ d, fill, stroke ... }` records: no elements, no attributes, no markup. So
 * scripts, event handlers, external references, `<style>`, `foreignObject`,
 * `<image>` and every non-local `href` are dropped by construction, not by
 * pattern matching on text that is about to be drawn.
 *
 * Supported: path, rect, circle, ellipse, line, polygon, polyline, g, use
 * (local `#id` only), linearGradient/radialGradient (flattened to the colour
 * at the gradient's midpoint), inline `style=""` declarations, `transform`.
 * Not supported, and counted in `warnings`: clip-path, mask, filter, pattern,
 * text, image, class-based styling.
 *
 * Pure and dependency-free so the build script and the tests share it.
 */

const DROP_SUBTREE = new Set([
  'script', 'style', 'foreignobject', 'metadata', 'title', 'desc', 'image', 'text', 'switch',
  'animate', 'set', 'animatetransform', 'animatemotion', 'iframe', 'object', 'embed', 'mask',
  'filter', 'pattern', 'marker', 'symbol', 'cliPath', 'sodipodi:namedview', 'rdf:rdf', 'cc:work',
]);
const NAMED = {
  white: '#ffffff', black: '#000000', red: '#ff0000', green: '#008000', blue: '#0000ff',
  yellow: '#ffff00', gray: '#808080', grey: '#808080', orange: '#ffa500', silver: '#c0c0c0',
  transparent: 'none', aqua: '#00ffff',
};

/** Parse markup into a light tree, skipping comments, PIs, doctype and CDATA. */
function parseXml(src) {
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!(?:DOCTYPE|ENTITY)[^>]*(?:\[[\s\S]*?\])?>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[2] === undefined) continue;
    const [, closing, rawName, rawAttrs, selfClose] = m;
    const name = rawName.toLowerCase();
    if (closing) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === name) { stack.length = i; break; }
      }
      continue;
    }
    const attrs = {};
    const ar = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let a;
    while ((a = ar.exec(rawAttrs))) {
      const key = a[1].toLowerCase();
      attrs[key] = a[2] ?? a[3] ?? a[4] ?? '';
    }
    const node = { name, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root;
}

function walk(node, fn) {
  fn(node);
  for (const c of node.children) walk(c, fn);
}

/** Only `#local` references survive. Anything else is `null`. */
function localRef(v) {
  if (!v) return null;
  const m = /^\s*(?:url\(\s*['"]?)?#([\w.:-]+)/.exec(v);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------- matrices
const IDENT = [1, 0, 0, 1, 0, 0];
const mul = (a, b) => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];
const isIdent = (m) => m.every((v, i) => Math.abs(v - IDENT[i]) < 1e-6);

function parseTransform(s) {
  let m = IDENT;
  if (!s) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let t;
  while ((t = re.exec(s))) {
    const n = t[2].split(/[\s,]+/).filter(Boolean).map(Number);
    if (n.some((v) => !Number.isFinite(v))) continue;
    let k = IDENT;
    switch (t[1]) {
      case 'matrix': if (n.length === 6) k = n; break;
      case 'translate': k = [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0]; break;
      case 'scale': k = [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0]; break;
      case 'rotate': {
        const r = ((n[0] ?? 0) * Math.PI) / 180;
        const c = Math.cos(r), sn = Math.sin(r);
        k = [c, sn, -sn, c, 0, 0];
        if (n.length === 3) k = mul(mul([1, 0, 0, 1, n[1], n[2]], k), [1, 0, 0, 1, -n[1], -n[2]]);
        break;
      }
      case 'skewX': k = [1, 0, Math.tan(((n[0] ?? 0) * Math.PI) / 180), 1, 0, 0]; break;
      case 'skewY': k = [1, Math.tan(((n[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]; break;
    }
    m = mul(m, k);
  }
  return m;
}

// ---------------------------------------------------------------- colours
function hex2(n) { return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0'); }

/** `#rrggbb`, `'none'`, or `null` when the colour cannot be understood. */
export function parseColour(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s || s === 'none') return 'none';
  if (s === 'currentcolor' || s === 'inherit') return null;
  if (NAMED[s]) return NAMED[s];
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return '#' + [...m[1]].map((c) => c + c).join('');
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(s);
  if (m) return '#' + m[1];
  m = /^#([0-9a-f]{4})$/.exec(s);
  if (m) return '#' + [...m[1].slice(0, 3)].map((c) => c + c).join('');
  m = /^rgba?\(\s*([\d.]+)(%?)[\s,]+([\d.]+)(%?)[\s,]+([\d.]+)(%?)/.exec(s);
  if (m) {
    const ch = (v2, pct) => (pct ? (Number(v2) * 255) / 100 : Number(v2));
    return '#' + hex2(ch(m[1], m[2])) + hex2(ch(m[3], m[4])) + hex2(ch(m[5], m[6]));
  }
  return null;
}

function mixHex(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return '#' + x.map((v, i) => hex2(v + (y[i] - v) * t)).join('');
}

// ---------------------------------------------------------------- path data
const ARGS = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

function fmt(n, dec) {
  let s = (Math.round(n * 10 ** dec) / 10 ** dec).toString();
  if (s === '-0') s = '0';
  if (s.startsWith('0.')) s = s.slice(1);
  else if (s.startsWith('-0.')) s = '-' + s.slice(2);
  return s;
}

/**
 * Re-serialise path data with rounded numbers. Returns `null` on anything that
 * is not valid path syntax, so a hostile or damaged `d` drops the element
 * instead of reaching `Path2D`.
 */
export function compactPath(d, dec) {
  if (typeof d !== 'string' || d.length > 200000) return null;
  let i = 0;
  const n = d.length;
  const out = [];
  const num = () => {
    while (i < n && /[\s,]/.test(d[i])) i++;
    const m = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(d.slice(i, i + 40));
    if (!m) return null;
    i += m[0].length;
    return Number(m[0]);
  };
  const flag = () => {
    while (i < n && /[\s,]/.test(d[i])) i++;
    const c = d[i];
    if (c !== '0' && c !== '1') return null;
    i++;
    return Number(c);
  };
  let cmd = '';
  let first = true;
  while (true) {
    while (i < n && /[\s,]/.test(d[i])) i++;
    if (i >= n) break;
    if (/[A-Za-z]/.test(d[i])) {
      cmd = d[i++];
      if (!(cmd.toLowerCase() in ARGS)) return null;
      if (first && cmd !== 'M' && cmd !== 'm') return null;
      first = false;
      if (cmd === 'z' || cmd === 'Z') { out.push('z'); cmd = ''; continue; }
      out.push(cmd);
      let k = ARGS[cmd.toLowerCase()];
      const sets = [];
      // one or more parameter sets follow the letter
      while (true) {
        const save = i;
        while (i < n && /[\s,]/.test(d[i])) i++;
        if (i >= n || /[A-Za-z]/.test(d[i])) { i = save; break; }
        const vals = [];
        for (let p = 0; p < k; p++) {
          const isFlag = cmd.toLowerCase() === 'a' && (p === 3 || p === 4);
          const v = isFlag ? flag() : num();
          if (v === null) return null;
          vals.push(v);
        }
        sets.push(vals);
      }
      if (!sets.length) return null;
      let prev = '';
      for (const s of sets) {
        s.forEach((v, idx) => {
          const isFlag = cmd.toLowerCase() === 'a' && (idx === 3 || idx === 4);
          const t = isFlag ? String(v) : fmt(v, dec);
          out.push(prev && !t.startsWith('-') ? ' ' + t : t);
          prev = t;
        });
        // Separate sets so a following `.5` cannot glue to the last number.
        prev = ' ';
      }
      continue;
    }
    return null;
  }
  return out.join('').replace(/ (?=[a-zA-Z])/g, '');
}

function rectPath(x, y, w, h, rx, ry) {
  if (!(w > 0 && h > 0)) return null;
  rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
  if (rx > 0 && ry > 0) {
    return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}z`;
  }
  return `M${x} ${y}H${x + w}V${y + h}H${x}z`;
}
function ellipsePath(cx, cy, rx, ry) {
  if (!(rx > 0 && ry > 0)) return null;
  return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}z`;
}

const PAINT_PROPS = /^(fill|fill-opacity|fill-rule|stroke|stroke-width|stroke-opacity|stroke-linecap|stroke-linejoin|opacity|display|visibility|stop-color|stop-opacity)$/;

/**
 * Class rules from `<style>`, reduced to the paint properties above.
 *
 * The stylesheet itself is discarded. Only `.class { prop: value }` rules are
 * read, only the allow-listed properties survive, and each value is parsed by
 * the same colour/number code as an attribute, so nothing in a stylesheet
 * (`@import`, `url()`, `expression()`) can reach the output.
 */
function classRules(src) {
  const rules = new Map();
  const sheetRe = /<style(?=[\s>])[^>]*>([\s\S]*?)<\/style>/gi;
  let sheet;
  while ((sheet = sheetRe.exec(src))) {
    const css = sheet[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!\[CDATA\[|\]\]>/g, '');
    const ruleRe = /([^{}@]+)\{([^{}]*)\}/g;
    let r;
    while ((r = ruleRe.exec(css))) {
      const decls = {};
      for (const d of r[2].split(';')) {
        const c = d.indexOf(':');
        if (c < 0) continue;
        const k = d.slice(0, c).trim().toLowerCase();
        if (PAINT_PROPS.test(k)) decls[k] = d.slice(c + 1).trim();
      }
      for (const sel of r[1].split(',')) {
        const m = /^\s*\.([\w-]+)\s*$/.exec(sel);
        if (m) rules.set(m[1], { ...(rules.get(m[1]) ?? {}), ...decls });
      }
    }
  }
  return rules;
}

let RULES = new Map();

function styleOf(el) {
  const out = {};
  for (const k of ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'display', 'visibility', 'stop-color', 'stop-opacity']) {
    if (el.attrs[k] !== undefined) out[k] = el.attrs[k].trim();
  }
  if (el.attrs.class) {
    for (const cls of el.attrs.class.split(/\s+/)) Object.assign(out, RULES.get(cls));
  }
  if (el.attrs.style) {
    for (const decl of el.attrs.style.split(';')) {
      const c = decl.indexOf(':');
      if (c < 0) continue;
      const k = decl.slice(0, c).trim().toLowerCase();
      if (k in out || /^(fill|stroke|opacity|display|visibility|stop-)/.test(k)) out[k] = decl.slice(c + 1).trim();
    }
  }
  return out;
}

const num1 = (v, d = 0) => {
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : d;
};
const frac = (v, d) => {
  const x = parseFloat(v);
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : d;
};

/**
 * Convert one SVG document to icon geometry.
 * @returns {{ viewBox:[number,number], paths:object[], warnings:string[] } | null}
 */
export function svgToIcon(svgText) {
  const warnings = [];
  const warn = (w) => { if (!warnings.includes(w)) warnings.push(w); };
  RULES = classRules(String(svgText));
  const doc = parseXml(String(svgText));
  const svg = doc.children.find((c) => c.name === 'svg');
  if (!svg) return null;

  // Index ids and drop forbidden subtrees.
  const byId = new Map();
  const strip = (node) => {
    node.children = node.children.filter((c) => {
      if (DROP_SUBTREE.has(c.name) || c.name.startsWith('sodipodi:') || c.name.startsWith('inkscape:')) {
        if (c.name === 'mask' || c.name === 'filter' || c.name === 'pattern' || c.name === 'text' || c.name === 'image') warn(`dropped <${c.name}>`);
        return false;
      }
      return true;
    });
    node.children.forEach(strip);
  };
  strip(svg);
  walk(svg, (n) => { if (n.attrs.id) byId.set(n.attrs.id, n); });

  // ViewBox.
  let vb = svg.attrs.viewbox?.split(/[\s,]+/).map(Number);
  if (!vb || vb.length !== 4 || vb.some((v) => !Number.isFinite(v)) || !(vb[2] > 0 && vb[3] > 0)) {
    const w = num1(svg.attrs.width, 0), h = num1(svg.attrs.height, 0);
    if (!(w > 0 && h > 0)) return null;
    vb = [0, 0, w, h];
    warn('viewBox derived from width/height');
  }
  const vbW = vb[2], vbH = vb[3];
  const dec = Math.max(vbW, vbH) <= 32 ? 3 : Math.max(vbW, vbH) <= 200 ? 2 : 1;

  // Gradients -> one flat colour.
  const gradColour = (id, seen = new Set()) => {
    const g = byId.get(id);
    if (!g || seen.has(id)) return null;
    seen.add(id);
    let stops = g.children.filter((c) => c.name === 'stop');
    if (!stops.length) {
      const ref = localRef(g.attrs.href ?? g.attrs['xlink:href']);
      return ref ? gradColour(ref, seen) : null;
    }
    const parsed = stops
      .map((s) => {
        const st = styleOf(s);
        const col = parseColour(st['stop-color'] ?? '#000');
        const off = String(s.attrs.offset ?? '0').trim();
        return {
          o: off.endsWith('%') ? parseFloat(off) / 100 : num1(off, 0),
          c: col && col !== 'none' ? col : '#000000',
          a: frac(st['stop-opacity'], 1),
        };
      })
      .sort((p, q) => p.o - q.o);
    let lo = parsed[0], hi = parsed[parsed.length - 1];
    for (const p of parsed) { if (p.o <= 0.5) lo = p; }
    for (const p of [...parsed].reverse()) { if (p.o >= 0.5) hi = p; }
    const t = hi.o === lo.o ? 0 : (0.5 - lo.o) / (hi.o - lo.o);
    return { colour: mixHex(lo.c, hi.c, Math.max(0, Math.min(1, t))), opacity: lo.a + (hi.a - lo.a) * Math.max(0, Math.min(1, t)) };
  };

  const paint = (value, opacity) => {
    if (value === undefined) return undefined;
    const ref = /url\(/i.test(value) ? localRef(value) : null;
    if (/url\(/i.test(value)) {
      if (!ref) { warn('non-local paint dropped'); return { colour: 'none', opacity: 1 }; }
      const g = gradColour(ref);
      if (!g) { warn('unresolved paint'); return { colour: 'none', opacity: 1 }; }
      return { colour: g.colour, opacity: g.opacity };
    }
    const c = parseColour(value);
    if (c === null) { warn(`unknown colour ${value.slice(0, 20)}`); return { colour: '#000000', opacity }; }
    return { colour: c, opacity };
  };

  const leaves = [];
  const emit = (d, ctx, m) => {
    if (!d) return;
    const fillOn = ctx.fill && ctx.fill.colour !== 'none';
    const strokeOn = ctx.stroke && ctx.stroke.colour !== 'none' && ctx.strokeWidth > 0;
    if (!fillOn && !strokeOn) return;
    const compact = compactPath(d, dec);
    if (!compact) { warn('invalid path data dropped'); return; }
    const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    const p = { d: compact };
    if (fillOn) {
      p.f = ctx.fill.colour;
      const fo = ctx.fill.opacity * ctx.fillOpacity * ctx.opacity;
      if (fo < 0.995) p.fo = Math.round(fo * 100) / 100;
      if (ctx.evenodd) p.eo = 1;
    }
    if (strokeOn) {
      p.s = ctx.stroke.colour;
      p.sw = Math.round(ctx.strokeWidth * scale * 1000) / 1000;
      const so = ctx.stroke.opacity * ctx.strokeOpacity * ctx.opacity;
      if (so < 0.995) p.so = Math.round(so * 100) / 100;
      if (ctx.cap && ctx.cap !== 'butt') p.lc = ctx.cap;
      if (ctx.join && ctx.join !== 'miter') p.lj = ctx.join;
    }
    if (!isIdent(m)) p.m = m.map((v) => Math.round(v * 10000) / 10000);
    leaves.push(p);
  };

  const visit = (el, parent, m, depth) => {
    if (depth > 24) return;
    const st = styleOf(el);
    if (st.display === 'none' || st.visibility === 'hidden') return;
    if (el.attrs['clip-path'] || el.attrs.mask || el.attrs.filter) warn('clip/mask/filter ignored');
    const ctx = { ...parent };
    if (st.fill !== undefined) ctx.fill = paint(st.fill, 1);
    if (st.stroke !== undefined) ctx.stroke = paint(st.stroke, 1);
    if (st['fill-opacity'] !== undefined) ctx.fillOpacity = frac(st['fill-opacity'], 1);
    if (st['stroke-opacity'] !== undefined) ctx.strokeOpacity = frac(st['stroke-opacity'], 1);
    if (st['stroke-width'] !== undefined) ctx.strokeWidth = num1(st['stroke-width'], 1);
    if (st['fill-rule'] !== undefined) ctx.evenodd = st['fill-rule'] === 'evenodd';
    if (st['stroke-linecap'] !== undefined) ctx.cap = st['stroke-linecap'];
    if (st['stroke-linejoin'] !== undefined) ctx.join = st['stroke-linejoin'];
    if (st.opacity !== undefined) ctx.opacity = parent.opacity * frac(st.opacity, 1);
    const mm = el.attrs.transform ? mul(m, parseTransform(el.attrs.transform)) : m;
    const a = el.attrs;
    switch (el.name) {
      case 'svg':
      case 'g':
      case 'a':
        for (const c of el.children) visit(c, ctx, mm, depth + 1);
        break;
      case 'path': emit(a.d, ctx, mm); break;
      case 'rect': {
        const w = num1(a.width), h = num1(a.height);
        let rx = num1(a.rx, NaN), ry = num1(a.ry, NaN);
        if (!Number.isFinite(rx)) rx = Number.isFinite(ry) ? ry : 0;
        if (!Number.isFinite(ry)) ry = rx;
        emit(rectPath(num1(a.x), num1(a.y), w, h, rx, ry), ctx, mm);
        break;
      }
      case 'circle': emit(ellipsePath(num1(a.cx), num1(a.cy), num1(a.r), num1(a.r)), ctx, mm); break;
      case 'ellipse': emit(ellipsePath(num1(a.cx), num1(a.cy), num1(a.rx), num1(a.ry)), ctx, mm); break;
      case 'line': emit(`M${num1(a.x1)} ${num1(a.y1)}L${num1(a.x2)} ${num1(a.y2)}`, { ...ctx, fill: undefined }, mm); break;
      case 'polygon':
      case 'polyline': {
        const pts = (a.points ?? '').split(/[\s,]+/).filter(Boolean).map(Number);
        if (pts.length < 4 || pts.length % 2 || pts.some((v) => !Number.isFinite(v))) break;
        let d = `M${pts[0]} ${pts[1]}`;
        for (let i = 2; i < pts.length; i += 2) d += `L${pts[i]} ${pts[i + 1]}`;
        emit(el.name === 'polygon' ? d + 'z' : d, el.name === 'polygon' ? ctx : { ...ctx, fill: undefined }, mm);
        break;
      }
      case 'use': {
        const ref = localRef(a.href ?? a['xlink:href']);
        const target = ref ? byId.get(ref) : null;
        if (!ref && (a.href || a['xlink:href'])) warn('external <use> dropped');
        if (target && target !== el && depth < 8) {
          const shift = mul(mm, [1, 0, 0, 1, num1(a.x), num1(a.y)]);
          visit(target, ctx, shift, depth + 1);
        }
        break;
      }
      default:
        break; // defs, gradients, clipPath and anything unknown draw nothing
    }
  };

  const base = {
    fill: { colour: '#000000', opacity: 1 }, stroke: undefined, fillOpacity: 1, strokeOpacity: 1,
    strokeWidth: 1, evenodd: false, cap: undefined, join: undefined, opacity: 1,
  };
  visit(svg, base, mul(IDENT, [1, 0, 0, 1, -vb[0], -vb[1]]), 0);

  // Merge neighbours that paint identically.
  const merged = [];
  for (const p of leaves) {
    const last = merged[merged.length - 1];
    const key = (q) => JSON.stringify([q.f, q.fo, q.eo, q.s, q.sw, q.so, q.lc, q.lj, q.m]);
    if (last && key(last) === key(p) && !last.s) last.d += p.d;
    else merged.push({ ...p });
  }
  if (!merged.length) return null;
  return { viewBox: [Math.round(vbW * 1000) / 1000, Math.round(vbH * 1000) / 1000], paths: merged, warnings };
}
