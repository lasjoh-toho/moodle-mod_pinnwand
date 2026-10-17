/* Formeleditor – reine Logik (ohne DOM): Zerlegung von LaTeX, Umschließen, Blöcke,
   Umformungen und verständliche Fehlertexte. Läuft im Browser und in Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FormelLogik = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- Wortlisten ---------- */
  const RELS = new Set(['le', 'leq', 'ge', 'geq', 'ne', 'neq', 'approx', 'equiv', 'sim', 'simeq', 'cong', 'propto', 'to',
    'rightarrow', 'leftarrow', 'Rightarrow', 'Leftarrow', 'leftrightarrow', 'Leftrightarrow', 'longrightarrow', 'Longrightarrow',
    'longleftrightarrow', 'Longleftrightarrow', 'implies', 'iff', 'mapsto', 'in', 'notin', 'ni', 'subset', 'supset', 'subseteq',
    'supseteq', 'parallel', 'perp', 'll', 'gg', 'gets', 'mid', 'prec', 'succ', 'vdash']);
  const PMS = new Set(['pm', 'mp']);
  const MULS = new Set(['cdot', 'times', 'div', 'ast', 'star', 'circ', 'cap', 'cup', 'wedge', 'vee', 'land', 'lor', 'oplus',
    'otimes', 'setminus', 'bullet', 'cdotp']);
  const SEP_CMDS = new Set(['quad', 'qquad', '\\']);
  const ARITY = {
    frac: 2, dfrac: 2, tfrac: 2, cfrac: 2, binom: 2, dbinom: 2, tbinom: 2, sqrt: 1, overline: 1, underline: 1, vec: 1, hat: 1,
    bar: 1, dot: 1, ddot: 1, tilde: 1, widehat: 1, widetilde: 1, overrightarrow: 1, overleftarrow: 1, text: 1, textbf: 1,
    textit: 1, mathrm: 1, mathbf: 1, mathit: 1, mathbb: 1, mathcal: 1, mathfrak: 1, mathsf: 1, mathtt: 1, operatorname: 1,
    boxed: 1, cancel: 1, phantom: 1, substack: 1, mathop: 1, mathbin: 1, mathrel: 1, overbrace: 1, underbrace: 1, xrightarrow: 1,
    xleftarrow: 1, textcolor: 2, overset: 2, underset: 2, stackrel: 2, mbox: 1, color: 1
  };
  const FRAC_LIKE = new Set(['frac', 'dfrac', 'tfrac', 'cfrac']);
  const GREEK = new Set(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota',
    'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'varpi', 'rho', 'varrho', 'sigma', 'varsigma', 'tau', 'upsilon', 'phi', 'varphi',
    'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega']);
  const SKIP_ARG_CMDS = new Set(['text', 'textbf', 'textit', 'mathrm', 'operatorname', 'mbox', 'begin', 'end', 'color', 'textcolor', 'htmlClass']);

  const KNOWN_CMDS = ['frac', 'dfrac', 'tfrac', 'sqrt', 'sum', 'prod', 'int', 'iint', 'oint', 'lim', 'sin', 'cos', 'tan', 'cot',
    'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'ln', 'log', 'lg', 'exp', 'max', 'min', 'sup', 'inf', 'det', 'gcd',
    'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota', 'kappa', 'lambda',
    'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta',
    'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega', 'left', 'right', 'cdot', 'times', 'div', 'pm', 'mp', 'le',
    'leq', 'ge', 'geq', 'ne', 'neq', 'approx', 'equiv', 'sim', 'propto', 'infty', 'partial', 'nabla', 'to', 'rightarrow',
    'leftarrow', 'leftrightarrow', 'Rightarrow', 'Leftarrow', 'Leftrightarrow', 'mapsto', 'vec', 'hat', 'bar', 'dot', 'ddot',
    'tilde', 'overline', 'underline', 'text', 'mathrm', 'mathbf', 'mathbb', 'mathcal', 'binom', 'begin', 'end', 'quad', 'qquad',
    'dots', 'ldots', 'cdots', 'vdots', 'ddots', 'in', 'notin', 'subset', 'subseteq', 'supset', 'cup', 'cap', 'setminus',
    'emptyset', 'forall', 'exists', 'neg', 'land', 'lor', 'angle', 'circ', 'degree', 'prime', 'square', 'displaystyle', 'limits',
    'operatorname', 'overrightarrow', 'boxed', 'cancel', 'sqrt', 'lfloor', 'rfloor', 'lceil', 'rceil', 'langle', 'rangle', 'perp',
    'parallel', 'ell', 'hbar', 'Re', 'Im', 'aleph', 'mid', 'colon', 'tag'];

  /* ---------- Zerlegung in Token ---------- */
  function tokenize(src, from, to) {
    from = from || 0;
    if (to == null) to = src.length;
    const out = [];
    let i = from;
    const isDigit = (ch) => ch >= '0' && ch <= '9';
    while (i < to) {
      const c = src[i];
      if (/\s/.test(c)) {
        let j = i + 1;
        while (j < to && /\s/.test(src[j])) j++;
        out.push({ t: 'ws', s: i, e: j });
        i = j;
        continue;
      }
      if (c === '%') {
        let j = i;
        while (j < to && src[j] !== '\n') j++;
        out.push({ t: 'ws', s: i, e: j, comment: true });
        i = j;
        continue;
      }
      if (c === '\\') {
        let j = i + 1;
        if (j < to && /[A-Za-z]/.test(src[j])) {
          while (j < to && /[A-Za-z]/.test(src[j])) j++;
          out.push({ t: 'cmd', s: i, e: j, v: src.slice(i + 1, j) });
        } else if (j < to) {
          out.push({ t: 'cmd', s: i, e: j + 1, v: src[j] });
          j++;
        } else {
          out.push({ t: 'char', s: i, e: j, v: '\\' });
        }
        i = j;
        continue;
      }
      if (c === '{') { out.push({ t: 'lb', s: i, e: i + 1 }); i++; continue; }
      if (c === '}') { out.push({ t: 'rb', s: i, e: i + 1 }); i++; continue; }
      if (c === '^') { out.push({ t: 'sup', s: i, e: i + 1 }); i++; continue; }
      if (c === '_') { out.push({ t: 'sub', s: i, e: i + 1 }); i++; continue; }
      if (isDigit(c)) {
        let j = i + 1;
        while (j < to && isDigit(src[j])) j++;
        if (src[j] === '.' && j + 1 < to && isDigit(src[j + 1])) {
          j++;
          while (j < to && isDigit(src[j])) j++;
        } else if (src.startsWith('{,}', j) && j + 3 < to && isDigit(src[j + 3])) {
          j += 3;
          while (j < to && isDigit(src[j])) j++;
        }
        out.push({ t: 'num', s: i, e: j });
        i = j;
        continue;
      }
      if (/[A-Za-z]/.test(c)) { out.push({ t: 'letter', s: i, e: i + 1, v: c }); i++; continue; }
      out.push({ t: 'char', s: i, e: i + 1, v: c });
      i++;
    }
    return out;
  }

  /* ---------- Parser: Atome auf einer Ebene ---------- */
  function makeParser(src, from, to) {
    let toks = tokenize(src, from, to).filter((t) => t.t !== 'ws');
    // Nach ^ oder _ gilt nur die erste Ziffer als Argument
    const fixed = [];
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      fixed.push(t);
      if ((t.t === 'sup' || t.t === 'sub') && toks[k + 1] && toks[k + 1].t === 'num' && toks[k + 1].e - toks[k + 1].s > 1) {
        const n = toks[k + 1];
        fixed.push({ t: 'num', s: n.s, e: n.s + 1 });
        toks[k + 1] = { t: 'num', s: n.s + 1, e: n.e };
      }
    }
    toks = fixed;
    return { src, toks };
  }

  function findRb(toks, i, end) {
    let d = 0;
    for (let k = i; k < end; k++) {
      if (toks[k].t === 'lb') d++;
      else if (toks[k].t === 'rb') { d--; if (d === 0) return k; }
    }
    return -1;
  }
  function findRight(toks, i, end) {
    let d = 0;
    for (let k = i; k < end; k++) {
      const t = toks[k];
      if (t.t === 'cmd' && t.v === 'left') d++;
      else if (t.t === 'cmd' && t.v === 'right') { d--; if (d === 0) return k; }
    }
    return -1;
  }
  function findEnd(toks, i, end) {
    let d = 0;
    for (let k = i; k < end; k++) {
      const t = toks[k];
      if (t.t === 'cmd' && t.v === 'begin') d++;
      else if (t.t === 'cmd' && t.v === 'end') { d--; if (d === 0) return k; }
    }
    return -1;
  }
  function isDelimOpener(t) {
    return t.t === 'cmd' && (t.v === 'left' || t.v === 'right' || /^(big|Big|bigg|Bigg)[lrm]?$/.test(t.v));
  }
  function findCloseChar(toks, i, end, open, close) {
    let d = 0, br = 0;
    for (let k = i; k < end; k++) {
      const t = toks[k];
      if (isDelimOpener(t)) { k++; continue; }
      if (t.t === 'lb') br++;
      else if (t.t === 'rb') { br--; if (br < 0) return -1; }
      else if (br === 0 && t.t === 'char') {
        if (t.v === open) d++;
        else if (t.v === close) { d--; if (d === 0) return k; }
      }
    }
    return -1;
  }
  function findNextBar(toks, i, end) {
    let br = 0;
    for (let k = i + 1; k < end; k++) {
      const t = toks[k];
      if (isDelimOpener(t)) { k++; continue; }
      if (t.t === 'lb') br++;
      else if (t.t === 'rb') { br--; if (br < 0) return -1; }
      else if (br === 0 && t.t === 'char' && t.v === '|') return k;
    }
    return -1;
  }

  function parseBase(P, i, end) {
    const { toks, src } = P;
    const t = toks[i];
    switch (t.t) {
      case 'lb': {
        const j = findRb(toks, i, end);
        if (j < 0) {
          const e = toks[end - 1].e;
          return { atom: { type: 'group', s: t.s, e, inner: { s: t.e, e }, bad: true }, next: end };
        }
        return { atom: { type: 'group', s: t.s, e: toks[j].e, inner: { s: t.e, e: toks[j].s } }, next: j + 1 };
      }
      case 'rb':
        return { atom: { type: 'ord', s: t.s, e: t.e, bad: true }, next: i + 1 };
      case 'num':
      case 'letter':
        return { atom: { type: 'ord', s: t.s, e: t.e, kind: t.t }, next: i + 1 };
      case 'cmd':
        return parseCmd(P, i, end);
      case 'sup':
      case 'sub':
        return { atom: { type: 'ord', s: t.s, e: t.s, empty: true }, next: i };
      default:
        return parseChar(P, i, end);
    }
  }

  function parseCmd(P, i, end) {
    const { toks, src } = P;
    const t = toks[i];
    const v = t.v;
    if (v === 'left') {
      const j = findRight(toks, i, end);
      const d1 = toks[i + 1];
      if (j < 0 || !d1 || i + 1 >= j) return { atom: { type: 'ord', s: t.s, e: t.e, bad: true }, next: i + 1 };
      const d2 = toks[j + 1] && j + 1 < end ? toks[j + 1] : null;
      return {
        atom: {
          type: 'left', s: t.s, e: d2 ? d2.e : toks[j].e, inner: { s: d1.e, e: toks[j].s },
          open: src.slice(d1.s, d1.e), close: d2 ? src.slice(d2.s, d2.e) : ''
        },
        next: d2 ? j + 2 : j + 1
      };
    }
    if (v === 'begin') {
      const j = findEnd(toks, i, end);
      const rb = toks[i + 1] && toks[i + 1].t === 'lb' ? findRb(toks, i + 1, end) : -1;
      if (j < 0 || rb < 0 || rb > j) return { atom: { type: 'ord', s: t.s, e: t.e, bad: true }, next: i + 1 };
      let k = j + 1;
      let e = toks[j].e;
      if (toks[k] && toks[k].t === 'lb' && k < end) {
        const r2 = findRb(toks, k, end);
        if (r2 >= 0) { e = toks[r2].e; k = r2 + 1; }
      }
      return {
        atom: { type: 'env', name: src.slice(toks[i + 1].e, toks[rb].s), s: t.s, e, inner: { s: toks[rb].e, e: toks[j].s } },
        next: k
      };
    }
    if (v === 'right' || v === 'end') return { atom: { type: 'ord', s: t.s, e: t.e, bad: true }, next: i + 1 };

    const n = ARITY[v];
    if (n) {
      let k = i + 1;
      let opt = null;
      if ((v === 'sqrt' || v === 'xrightarrow' || v === 'xleftarrow') && toks[k] && toks[k].t === 'char' && toks[k].v === '[') {
        const m = findCloseChar(toks, k, end, '[', ']');
        if (m > 0) { opt = { s: toks[k].e, e: toks[m].s }; k = m + 1; }
      }
      const args = [];
      let e = opt ? toks[k - 1].e : t.e;
      let missing = 0;
      for (let a = 0; a < n; a++) {
        if (k >= end || toks[k].t === 'sup' || toks[k].t === 'sub' || toks[k].t === 'rb') { missing++; continue; }
        const r = parseBase(P, k, end);
        args.push(r.atom);
        e = r.atom.e;
        k = r.next;
      }
      return { atom: { type: 'cmd', name: v, s: t.s, e, args, opt, missing }, next: k };
    }
    let type = 'ord';
    if (RELS.has(v)) type = 'rel';
    else if (PMS.has(v)) type = 'pm';
    else if (MULS.has(v)) type = 'mul';
    else if (SEP_CMDS.has(v)) type = 'sep';
    return { atom: { type, name: v, s: t.s, e: t.e, cmd: true }, next: i + 1 };
  }

  function parseChar(P, i, end) {
    const { toks } = P;
    const t = toks[i];
    const c = t.v;
    const mk = (type, extra) => Object.assign({ type, s: t.s, e: t.e, ch: c }, extra || {});
    if ('=<>'.includes(c)) return { atom: mk('rel'), next: i + 1 };
    if ('+-'.includes(c)) return { atom: mk('pm'), next: i + 1 };
    if ('*/'.includes(c)) return { atom: mk('mul'), next: i + 1 };
    if (',;&'.includes(c)) return { atom: mk('sep'), next: i + 1 };
    if (c === '(' || c === '[') {
      const close = c === '(' ? ')' : ']';
      const j = findCloseChar(toks, i, end, c, close);
      if (j > 0) {
        return {
          atom: { type: 'paren', open: c, close, s: t.s, e: toks[j].e, inner: { s: t.e, e: toks[j].s } },
          next: j + 1
        };
      }
    }
    if (c === '|') {
      const j = findNextBar(toks, i, end);
      if (j > 0) {
        return { atom: { type: 'paren', open: '|', close: '|', s: t.s, e: toks[j].e, inner: { s: t.e, e: toks[j].s } }, next: j + 1 };
      }
    }
    return { atom: mk('ord'), next: i + 1 };
  }

  function parseAtom(P, i, end) {
    const { toks } = P;
    const r = parseBase(P, i, end);
    const atom = r.atom;
    let next = r.next;
    atom.base = { s: atom.s, e: atom.e };
    atom.scripts = [];
    while (next < end && (toks[next].t === 'sup' || toks[next].t === 'sub')) {
      const st = toks[next];
      const kind = st.t === 'sup' ? '^' : '_';
      const k = next + 1;
      if (k >= end) {
        atom.scripts.push({ kind, s: st.s, e: st.e, missing: true });
        atom.e = st.e;
        next = k;
        break;
      }
      const ar = parseBase(P, k, end);
      atom.scripts.push({
        kind, s: st.s, e: ar.atom.e, arg: ar.atom,
        inner: ar.atom.type === 'group' && !ar.atom.bad ? ar.atom.inner : null
      });
      atom.e = ar.atom.e;
      next = ar.next;
    }
    atom.kids = computeKids(atom);
    return { atom, next };
  }

  function computeKids(atom) {
    const kids = [];
    const add = (label, r) => { if (r && r.e >= r.s) kids.push({ label, s: r.s, e: r.e }); };
    if (!atom.bad) {
      switch (atom.type) {
        case 'group': add('Inhalt', atom.inner); break;
        case 'paren': case 'left': add('In der Klammer', atom.inner); break;
        case 'env': add('Inhalt', atom.inner); break;
        case 'cmd': {
          const gi = (a) => (a && a.type === 'group' && !a.bad ? a.inner : a ? { s: a.s, e: a.e } : null);
          if (FRAC_LIKE.has(atom.name)) { add('Zähler', gi(atom.args[0])); add('Nenner', gi(atom.args[1])); }
          else if (atom.name === 'binom' || atom.name === 'dbinom' || atom.name === 'tbinom') { add('Oben', gi(atom.args[0])); add('Unten', gi(atom.args[1])); }
          else if (atom.name === 'sqrt') { if (atom.opt) add('Wurzelexponent', atom.opt); add('Radikand', gi(atom.args[0])); }
          else atom.args.forEach((a, n) => { if (a.type === 'group') add(atom.args.length > 1 ? 'Teil ' + (n + 1) : 'Inhalt', gi(a)); });
          break;
        }
        default:
      }
    }
    for (const s of atom.scripts || []) if (s.inner) add(s.kind === '^' ? 'Hochzahl' : 'Index', s.inner);
    return kids;
  }

  function parseRange(src, s, e) {
    if (s == null) s = 0;
    if (e == null) e = src.length;
    const P = makeParser(src, s, e);
    const atoms = [];
    let i = 0;
    const end = P.toks.length;
    while (i < end) {
      const r = parseAtom(P, i, end);
      atoms.push(r.atom);
      i = r.next;
    }
    return atoms;
  }

  function findAtoms(src, pred, s, e, out) {
    out = out || [];
    const atoms = parseRange(src, s, e);
    for (const a of atoms) {
      if (pred(a)) out.push(a);
      for (const k of a.kids || []) findAtoms(src, pred, k.s, k.e, out);
    }
    return out;
  }

  /* ---------- Blöcke (Terme) ---------- */
  function blocksOf(src, s, e) {
    if (s == null) s = 0;
    if (e == null) e = src.length;
    const atoms = parseRange(src, s, e);
    const blocks = [];
    let cur = null;
    const flush = () => {
      if (!cur) return;
      const body = cur.atoms;
      const first = body[0];
      const b = {
        kind: 'term', s: cur.signAtom ? cur.signAtom.s : (first ? first.s : cur.s), e: body.length ? body[body.length - 1].e : cur.signAtom.e,
        sign: cur.signAtom ? src.slice(cur.signAtom.s, cur.signAtom.e) : '',
        bodyS: first ? first.s : cur.signAtom.e, atoms: body
      };
      b.bodyE = b.e;
      b.body = src.slice(b.bodyS, b.bodyE);
      b.text = src.slice(b.s, b.e);
      blocks.push(b);
      cur = null;
    };
    for (const a of atoms) {
      if (a.type === 'rel' || a.type === 'sep') {
        flush();
        blocks.push({ kind: 'fixed', type: a.type, s: a.s, e: a.e, text: src.slice(a.s, a.e) });
      } else if (a.type === 'pm') {
        const operand = cur && cur.atoms.length > 0;
        const lastIsOp = operand && ['mul', 'pm'].includes(cur.atoms[cur.atoms.length - 1].type);
        if (operand && !lastIsOp) {
          flush();
          cur = { signAtom: a, atoms: [] };
        } else if (!cur) {
          cur = { signAtom: a, atoms: [] };
        } else {
          cur.atoms.push(a);
        }
      } else {
        if (!cur) cur = { signAtom: null, atoms: [] };
        cur.atoms.push(a);
      }
    }
    flush();
    blocks.forEach((b, n) => { b.index = n; });
    return blocks;
  }

  /** Drill-Ziele (Unterbereiche) eines Blocks. */
  function blockKids(block) {
    const kids = [];
    for (const a of block.atoms || []) for (const k of a.kids || []) kids.push(k);
    return kids.slice(0, 8);
  }

  function flipSign(sign) {
    if (sign === '' || sign === '+') return '-';
    if (sign === '-') return '+';
    if (sign === '\\pm') return '\\mp';
    if (sign === '\\mp') return '\\pm';
    return '-';
  }
  function mkTerm(sign, body) {
    return { kind: 'term', sign, body, text: (sign ? sign + ' ' : '') + body, atoms: [] };
  }
  function flipTerm(t) { return mkTerm(flipSign(t.sign), t.body); }

  /** Setzt Blöcke wieder zu Text zusammen. Rückgabe: {text, ranges[]} */
  function joinBlocks(blocks) {
    let out = '';
    const ranges = [];
    let runFirst = true;
    for (const b of blocks) {
      if (b.kind === 'fixed') {
        out += (out && !/^[,;]$/.test(b.text) ? ' ' : '') + b.text;
        ranges.push({ s: out.length - b.text.length, e: out.length });
        runFirst = true;
        continue;
      }
      let sign = b.sign;
      if (runFirst) { if (sign === '+') sign = ''; }
      else if (sign === '') sign = '+';
      let piece;
      if (!sign) piece = b.body;
      else if (runFirst && sign === '-') piece = '-' + b.body;
      else piece = sign + ' ' + b.body;
      out += (out ? ' ' : '') + piece;
      ranges.push({ s: out.length - piece.length, e: out.length });
      runFirst = false;
    }
    return { text: out, ranges };
  }

  /** Verschiebt Block `from` vor die Lücke `gap` (0..n). */
  function reorderBlocks(src, scope, blocks, from, gap) {
    const moving = blocks[from];
    if (!moving || moving.kind !== 'term') return null;
    if (gap === from || gap === from + 1) return null;
    const order = blocks.slice();
    order.splice(from, 1);
    const target = gap > from ? gap - 1 : gap;
    order.splice(target, 0, moving);
    const joined = joinBlocks(order);
    const range = joined.ranges[target];
    return {
      src: src.slice(0, scope.s) + joined.text + src.slice(scope.e),
      edit: { x: scope.s, y: scope.e, len: joined.text.length },
      select: { s: scope.s + range.s, e: scope.s + range.e }
    };
  }

  /** Verschiebt den markierten Text [a,b) vor die Position `pos`. */
  function moveText(src, a, b, pos) {
    if (pos >= a && pos <= b) return null;
    const text = src.slice(a, b);
    let ra = a, rb = b;
    if (rb < src.length && /\s/.test(src[rb]) && (a === 0 || /\s/.test(src[a - 1]))) rb++;
    else if (rb === src.length && a > 0 && /\s/.test(src[a - 1])) ra--;
    const rest = src.slice(0, ra) + src.slice(rb);
    const p = pos >= rb ? pos - (rb - ra) : pos > b ? ra : pos;
    const prev = rest[p - 1];
    const next = rest[p];
    let ins = text.trim();
    if (prev && !/[\s{(\[]/.test(prev)) ins = ' ' + ins;
    if (next && !/[\s})\]^_]/.test(next)) ins = ins + ' ';
    const out = rest.slice(0, p) + ins + rest.slice(p);
    const lead = ins.length - ins.trimStart().length;
    return { src: out, select: { s: p + lead, e: p + lead + text.trim().length }, removed: { s: a, e: b }, insertedAt: p, insLen: ins.length };
  }

  /* ---------- Auswahl & Klammern ---------- */
  function matchTokens(toks) {
    const map = new Map();
    const bad = new Set();
    const st = { lb: [], left: [], begin: [] };
    toks.forEach((t, k) => {
      if (t.t === 'lb') st.lb.push(k);
      else if (t.t === 'rb') { const o = st.lb.pop(); if (o === undefined) bad.add(k); else { map.set(o, k); map.set(k, o); } }
      else if (t.t === 'cmd' && t.v === 'left') st.left.push(k);
      else if (t.t === 'cmd' && t.v === 'right') { const o = st.left.pop(); if (o === undefined) bad.add(k); else { map.set(o, k); map.set(k, o); } }
      else if (t.t === 'cmd' && t.v === 'begin') st.begin.push(k);
      else if (t.t === 'cmd' && t.v === 'end') { const o = st.begin.pop(); if (o === undefined) bad.add(k); else { map.set(o, k); map.set(k, o); } }
    });
    for (const k of [...st.lb, ...st.left, ...st.begin]) bad.add(k);
    return { map, bad };
  }

  /** Erweitert eine Textauswahl so, dass sie als Gruppe markiert werden kann. */
  function snapRange(src, a, b) {
    if (a > b) { const t = a; a = b; b = t; }
    while (a < b && /\s/.test(src[a])) a++;
    while (b > a && /\s/.test(src[b - 1])) b--;
    if (a >= b) return null;
    const toks = tokenize(src, 0, src.length).filter((t) => t.t !== 'ws');
    let i = toks.findIndex((t) => t.e > a);
    let j = -1;
    toks.forEach((t, k) => { if (t.s < b) j = k; });
    if (i < 0 || j < i) return null;
    const origI = i, origJ = j;
    const { map, bad } = matchTokens(toks);
    let guard = 0, changed = true;
    while (changed && guard++ < 500) {
      changed = false;
      for (let k = i; k <= j; k++) {
        if (bad.has(k)) return null;
        const m = map.get(k);
        if (m === undefined) continue;
        if (m < i) { i = m; changed = true; }
        else if (m > j) { j = m; changed = true; }
      }
    }
    // Zu \right gehört die Klammer dahinter, zu \end der Umgebungsname.
    if (toks[j].t === 'cmd' && toks[j].v === 'right' && toks[j + 1]) j++;
    else if (toks[j].t === 'cmd' && toks[j].v === 'end' && toks[j + 1] && toks[j + 1].t === 'lb' && map.get(j + 1) !== undefined) j = map.get(j + 1);
    // Befehle werden immer ganz genommen, angeschnittene Zahlen bleiben exakt.
    const s = i === origI && toks[i].t === 'num' ? Math.max(toks[i].s, a) : toks[i].s;
    const e = j === origJ && toks[j].t === 'num' ? Math.min(toks[j].e, b) : toks[j].e;
    if (s >= e) return null;
    return { s, e };
  }

  const PH_RE = /\\square(?![A-Za-z])/g;
  function phWrap(t) { return t.replace(PH_RE, '\\htmlClass{ph}{\\square}'); }

  /** Quelltext für die Vorschau (mit Hervorhebung der Auswahl). */
  function previewSource(src, sel) {
    if (!sel) return phWrap(src);
    return phWrap(src.slice(0, sel.s)) + '\\htmlClass{sel}{' + phWrap(src.slice(sel.s, sel.e)) + '}' + phWrap(src.slice(sel.e));
  }

  function nextPlaceholder(src, from) {
    const re = new RegExp(PH_RE.source, 'g');
    re.lastIndex = Math.max(0, from || 0);
    let m = re.exec(src);
    if (!m) { re.lastIndex = 0; m = re.exec(src); }
    return m ? { s: m.index, e: m.index + m[0].length } : null;
  }

  /* ---------- Umschließen (Select & Wrap) ---------- */
  function contextStart(src, a) {
    const toks = tokenize(src, 0, a).filter((t) => t.t !== 'ws');
    const stack = [];
    toks.forEach((t, k) => {
      if (t.t === 'lb') stack.push({ k, kind: 'lb' });
      else if (t.t === 'rb') { for (let n = stack.length - 1; n >= 0; n--) if (stack[n].kind === 'lb') { stack.splice(n, 1); break; } }
      else if (t.t === 'cmd' && t.v === 'left') stack.push({ k, kind: 'left' });
      else if (t.t === 'cmd' && t.v === 'right') { for (let n = stack.length - 1; n >= 0; n--) if (stack[n].kind === 'left') { stack.splice(n, 1); break; } }
    });
    if (!stack.length) return 0;
    const top = stack[stack.length - 1];
    const t = toks[top.k];
    if (top.kind === 'left') return toks[top.k + 1] ? toks[top.k + 1].e : t.e;
    return t.e;
  }

  function isOperandAtom(a) {
    if (!a || a.empty) return false;
    if (['rel', 'pm', 'mul', 'sep'].includes(a.type)) return false;
    if (a.type === 'ord' && a.ch && '([{,;:.'.includes(a.ch)) return false;
    return true;
  }

  function stripOuterGroup(text) {
    const atoms = parseRange(text, 0, text.length);
    if (atoms.length === 1 && atoms[0].type === 'group' && !atoms[0].bad && !atoms[0].scripts.length) {
      return text.slice(atoms[0].inner.s, atoms[0].inner.e).trim();
    }
    return text;
  }
  function stripOuterParens(text) {
    const atoms = parseRange(text, 0, text.length);
    if (atoms.length === 1 && !atoms[0].scripts.length) {
      const a = atoms[0];
      if (a.type === 'paren' && a.open === '(') return text.slice(a.inner.s, a.inner.e).trim();
      if (a.type === 'left' && a.open === '(') return text.slice(a.inner.s, a.inner.e).trim();
    }
    return stripOuterGroup(text);
  }

  function scriptBaseText(selText, kind) {
    const atoms = parseRange(selText, 0, selText.length);
    if (atoms.length === 0) return null;
    if (atoms.length === 1) {
      const a = atoms[0];
      if (a.scripts.some((s) => s.kind === kind)) return '{' + selText + '}';
      return selText;
    }
    return '\\left(' + selText + '\\right)';
  }

  const PH = '\u0001';

  /**
   * Wendet einen Ribbon-Button an.
   * def: {kind:'insert'|'wrap'|'script', tpl, smart?}
   * Rückgabe: {src, a, b, edit:{x,y,len}}
   */
  function applyTemplate(src, a, b, def) {
    if (a > b) { const t = a; a = b; b = t; }
    const raw = src.slice(a, b);
    const hasSel = raw.trim().length > 0;
    let x = a, y = b;
    let text;
    let fills = [];

    if (def.kind === 'script') {
      const kind = def.tpl[0] === '^' ? '^' : def.tpl[0] === '_' ? '_' : '!';
      if (hasSel) {
        const base = scriptBaseText(raw.trim(), kind);
        text = (base == null ? PH : base) + def.tpl;
        const lead = raw.length - raw.trimStart().length;
        x = a + lead; y = b - (raw.length - raw.trimEnd().length);
      } else {
        const ctx = contextStart(src, a);
        const atoms = parseRange(src, ctx, a);
        const last = atoms[atoms.length - 1];
        if (last && isOperandAtom(last) && src.slice(last.e, a).trim() === '') {
          if (last.scripts.some((s) => s.kind === kind)) {
            x = last.s; y = a;
            text = '{' + src.slice(last.s, last.e) + '}' + def.tpl;
          } else {
            x = y = last.e;
            text = def.tpl;
          }
        } else {
          text = PH + def.tpl;
        }
      }
    } else {
      let tpl = def.tpl;
      let body = null;
      if (hasSel) {
        const t = raw.trim();
        const lead = raw.length - raw.trimStart().length;
        x = a + lead; y = b - (raw.length - raw.trimEnd().length);
        if (def.smart === 'frac') {
          const atoms = parseRange(t, 0, t.length);
          const slashes = atoms.filter((q) => q.type === 'mul' && q.ch === '/');
          if (slashes.length === 1) {
            const sl = slashes[0];
            const n = t.slice(0, sl.s).trim(), d = t.slice(sl.e).trim();
            if (n && d) { body = stripOuterParens(n); fills = [stripOuterParens(d)]; }
          }
        }
        if (body == null) body = stripOuterGroup(t);
      }
      if (/\$S/.test(tpl)) {
        text = tpl.replace(/\$S/g, () => (hasSel ? body : PH));
      } else if (hasSel && /\$1/.test(tpl)) {
        text = tpl.replace(/\$1/, () => body);
      } else {
        text = tpl;
      }
    }
    let fi = 0;
    text = text.replace(/\$\d/g, () => (fi < fills.length ? fills[fi++] : PH));

    let before = src.slice(0, x), after = src.slice(y);
    if (/\\[A-Za-z]+$/.test(before) && /^[A-Za-z]/.test(text)) text = ' ' + text;
    if (/\\[A-Za-z]+$/.test(text) && /^[A-Za-z]/.test(after)) text = text + ' ';

    // Platzhalter einsetzen
    const parts = text.split(PH);
    let out = parts[0];
    const stops = [];
    for (let n = 1; n < parts.length; n++) {
      stops.push(before.length + out.length);
      out += '\\square' + parts[n];
    }
    const full = before + out + after;
    let sa, sb;
    if (stops.length) { sa = stops[0]; sb = sa + 7; }
    else { sa = sb = before.length + out.length; }
    return { src: full, a: sa, b: sb, edit: { x, y, len: out.length } };
  }

  /* ---------- Variablen ---------- */
  function variableTokens(src) {
    const toks = tokenize(src, 0, src.length).filter((t) => t.t !== 'ws');
    const out = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.t === 'cmd' && SKIP_ARG_CMDS.has(t.v)) {
        let k = i + 1;
        const groups = t.v === 'textcolor' ? 2 : 1;
        for (let g = 0; g < groups; g++) {
          if (toks[k] && toks[k].t === 'lb') { const r = findRb(toks, k, toks.length); if (r > 0) k = r + 1; else break; }
        }
        i = k - 1;
        continue;
      }
      let tex = null;
      if (t.t === 'letter') tex = t.v;
      else if (t.t === 'cmd' && GREEK.has(t.v)) tex = '\\' + t.v;
      if (tex) out.push({ tex, s: t.s, e: t.e, prev: toks[i - 1] || null, next: toks[i + 1] || null, src, prevPrev: toks[i - 2] || null });
    }
    return out;
  }
  function variablesOf(src) {
    const seen = new Set();
    const list = [];
    for (const v of variableTokens(src)) if (!seen.has(v.tex)) { seen.add(v.tex); list.push(v.tex); }
    return list.slice(0, 14);
  }

  function isCompound(text) {
    const atoms = parseRange(text, 0, text.length);
    return atoms.length > 1;
  }

  function replaceVariable(src, tex, repl, mode) {
    repl = repl.trim();
    if (!repl) return null;
    let occ = variableTokens(src).filter((v) => v.tex === tex);
    if (!occ.length) return null;
    if (mode === 'first') occ = occ.slice(0, 1);
    const compound = isCompound(repl);
    const singleAtom = !compound && parseRange(repl, 0, repl.length)[0];
    let out = src;
    let count = 0;
    let first = null;
    for (let n = occ.length - 1; n >= 0; n--) {
      const o = occ[n];
      let text = repl;
      const p = o.prev, q = o.next;
      const pv = p && p.t === 'char' ? src[p.s] : p && p.t === 'lb' ? '{' : p && p.t === 'cmd' ? '\\' : p ? 'x' : '';
      const nv = q && q.t === 'char' ? src[q.s] : q && q.t === 'rb' ? '}' : q && (q.t === 'sup' || q.t === 'sub') ? '^' : q && q.t === 'cmd' ? '\\' : q ? 'x' : '';
      const prevOk = !p || pv === '{' || pv === '(' || pv === '[' || pv === '=' || pv === '<' || pv === '>' || pv === ',' || pv === '+' ||
        (p.t === 'cmd' && (RELS.has(p.v) || p.v === 'left'));
      const nextOk = !q || nv === '}' || nv === ')' || nv === ']' || nv === '=' || nv === '<' || nv === '>' || nv === ',' || nv === '+' || nv === '-' ||
        (q.t === 'cmd' && (RELS.has(q.v) || q.v === 'right' || PMS.has(q.v)));
      const hasScript = q && (q.t === 'sup' || q.t === 'sub');
      if (compound && (hasScript || !prevOk || !nextOk)) text = '\\left(' + repl + '\\right)';
      else if (!compound && singleAtom && hasScript && singleAtom.scripts && singleAtom.scripts.length) text = '{' + repl + '}';
      if (/\\[A-Za-z]+$/.test(text) && /[A-Za-z]/.test(out[o.e] || '')) text += ' ';
      if (/^\\[A-Za-z]/.test(text) === false && /^[A-Za-z]/.test(text) && /\\[A-Za-z]+$/.test(out.slice(0, o.s))) text = ' ' + text;
      out = out.slice(0, o.s) + text + out.slice(o.e);
      count++;
      if (n === 0) first = { s: o.s, e: o.s + text.trimEnd().length };
    }
    return { src: out, count, first };
  }

  /* ---------- Umformungen ---------- */
  const REL_FLIP = { '<': '>', '>': '<', '\\le': '\\ge', '\\leq': '\\geq', '\\ge': '\\le', '\\geq': '\\leq', '=': '=', '\\neq': '\\neq', '\\ne': '\\ne', '\\approx': '\\approx', '\\equiv': '\\equiv' };

  function wrapSum(text) {
    const terms = blocksOf(text).filter((b) => b.kind === 'term');
    if (terms.length > 1 || (terms[0] && terms[0].sign)) return '\\left(' + text + '\\right)';
    return text;
  }

  function analyzeEquation(src) {
    const blocks = blocksOf(src);
    const rels = blocks.filter((b) => b.kind === 'fixed' && b.type === 'rel');
    const seps = blocks.filter((b) => b.kind === 'fixed' && b.type !== 'rel');
    if (rels.length !== 1 || seps.length) return null;
    const ri = blocks.indexOf(rels[0]);
    const L = blocks.slice(0, ri), R = blocks.slice(ri + 1);
    if (!L.length || !R.length || L.some((b) => b.kind !== 'term') || R.some((b) => b.kind !== 'term')) return null;
    return { L, R, rel: rels[0].text };
  }
  const isZero = (terms) => terms.length === 1 && terms[0].body.trim() === '0' && (terms[0].sign === '' || terms[0].sign === '+');
  const eqText = (L, rel, R) => joinBlocks(L).text + ' ' + rel + ' ' + joinBlocks(R).text;

  function singleFrac(terms) {
    if (terms.length !== 1 || terms[0].sign) return null;
    const at = terms[0].atoms;
    if (at.length !== 1) return null;
    const a = at[0];
    if (a.type === 'cmd' && FRAC_LIKE.has(a.name) && !a.scripts.length && a.args.length === 2 && !a.missing) return a;
    return null;
  }

  /**
   * Liefert sinnvolle Umformungen. sel = {s,e} oder null.
   * Item: {group, title, tex?, src, select?}
   */
  function transformations(src, sel) {
    const items = [];
    const seen = new Set([src]);
    const push = (it) => { if (it.src && !seen.has(it.src)) { seen.add(it.src); items.push(it); } };
    if (!src.trim()) return items;

    /* Gleichung umstellen */
    const eq = analyzeEquation(src);
    if (eq && REL_FLIP[eq.rel] !== undefined) {
      const { L, R, rel } = eq;
      const flipped = REL_FLIP[rel];
      push({ group: 'Gleichung umstellen', title: 'Seiten tauschen', src: eqText(R, flipped, L) });
      if (!isZero(R)) {
        push({ group: 'Gleichung umstellen', title: 'Alles auf eine Seite bringen (… = 0)', src: eqText(L.concat(R.map(flipTerm)), rel, [mkTerm('', '0')]) });
      }
      const mover = (side, other, from, label, toRight) => {
        side.slice(0, 4).forEach((t, n) => {
          const rest = side.filter((_, k) => k !== n);
          const sideNew = rest.length ? rest : [mkTerm('', '0')];
          const otherNew = isZero(other) ? [flipTerm(t)] : other.concat([flipTerm(t)]);
          const src2 = toRight ? eqText(sideNew, rel, otherNew) : eqText(otherNew, rel, sideNew);
          push({ group: 'Gleichung umstellen', tex: t.text, title: label, src: src2 });
        });
      };
      mover(L, R, 'L', 'nach rechts bringen', true);
      mover(R, L, 'R', 'nach links bringen', false);
      const negL = L.map(flipTerm), negR = R.map(flipTerm);
      push({ group: 'Gleichung umstellen', title: 'Beide Seiten mit −1 multiplizieren', src: eqText(negL, REL_FLIP[rel] === rel ? rel : flipped, negR) });
      const fl = singleFrac(L), fr = singleFrac(R);
      if (fl && fr && rel === '=') {
        const g = (at, n) => stripOuterParens(src.slice(at.args[n].type === 'group' ? at.args[n].inner.s : at.args[n].s, at.args[n].type === 'group' ? at.args[n].inner.e : at.args[n].e).trim());
        const w = (t) => wrapSum(t);
        push({ group: 'Gleichung umstellen', title: 'Kreuzweise multiplizieren', src: w(g(fl, 0)) + ' \\cdot ' + w(g(fr, 1)) + ' = ' + w(g(fr, 0)) + ' \\cdot ' + w(g(fl, 1)) });
      }
    }

    /* Auswahl */
    if (sel && src.slice(sel.s, sel.e).trim()) {
      const text = src.slice(sel.s, sel.e);
      const t = text.trim();
      const edit = (title, repl) => push({
        group: 'Auswahl bearbeiten', title, src: src.slice(0, sel.s) + repl + src.slice(sel.e),
        select: { s: sel.s, e: sel.s + repl.length }
      });
      edit('Einklammern', '\\left(' + t + '\\right)');
      const terms = blocksOf(t).filter((b) => b.kind === 'term');
      if (terms.length && blocksOf(t).every((b) => b.kind === 'term')) {
        edit('Vorzeichen umkehren', joinBlocks(terms.map(flipTerm)).text);
      }
      const fa = singleFrac(blocksOf(t));
      if (fa) {
        const n = t.slice(fa.args[0].type === 'group' ? fa.args[0].inner.s : fa.args[0].s, fa.args[0].type === 'group' ? fa.args[0].inner.e : fa.args[0].e);
        const d = t.slice(fa.args[1].type === 'group' ? fa.args[1].inner.s : fa.args[1].s, fa.args[1].type === 'group' ? fa.args[1].inner.e : fa.args[1].e);
        edit('Kehrwert bilden', '\\frac{' + d.trim() + '}{' + n.trim() + '}');
      } else {
        edit('Kehrwert bilden', '\\frac{1}{' + t + '}');
      }
      edit('Quadrieren', (parseRange(t, 0, t.length).length > 1 ? '\\left(' + t + '\\right)' : t) + '^{2}');
    }

    /* Brüche, Wurzeln, Potenzen */
    const inSel = (a) => !sel || (a.s >= sel.s && a.e <= sel.e);
    const useSel = sel && src.slice(sel.s, sel.e).trim();
    const pick = (list) => (useSel ? list.filter(inSel) : list)[0];
    const fracs = findAtoms(src, (a) => a.type === 'cmd' && FRAC_LIKE.has(a.name) && !a.missing && a.args.length === 2 && !a.scripts.length);
    const fr = pick(fracs);
    if (fr) {
      const part = (n) => { const q = fr.args[n]; const r = q.type === 'group' && !q.bad ? q.inner : { s: q.s, e: q.e }; return src.slice(r.s, r.e).trim(); };
      const num = part(0), den = part(1);
      const repl = (title, text) => push({ group: 'Brüche, Wurzeln, Potenzen', title, src: src.slice(0, fr.s) + text + src.slice(fr.e), select: { s: fr.s, e: fr.s + text.length } });
      repl('Kehrwert des Bruchs', '\\frac{' + den + '}{' + num + '}');
      repl('Bruch als Division schreiben', wrapSum(num) + ' \\div ' + wrapSum(den));
      // aufspalten: nur wenn der Bruch ein ganzer Term ist
      const nTerms = blocksOf(num);
      if (nTerms.length > 1 && nTerms.every((b) => b.kind === 'term')) {
        const top = blocksOf(src);
        const host = top.find((b) => b.kind === 'term' && b.atoms.length === 1 && b.atoms[0].s === fr.s && b.atoms[0].e === fr.e);
        if (host && (host.sign === '' || host.sign === '+' || host.sign === '-')) {
          const parts = nTerms.map((t) => {
            const sgn = host.sign === '-' ? flipSign(t.sign) : (t.sign || '');
            return mkTerm(sgn, '\\frac{' + t.body + '}{' + den + '}');
          });
          const rebuilt = top.slice(0, host.index).concat(parts, top.slice(host.index + 1));
          push({ group: 'Brüche, Wurzeln, Potenzen', title: 'Bruch aufspalten', src: joinBlocks(rebuilt).text });
        }
      }
    }
    const roots = findAtoms(src, (a) => a.type === 'cmd' && a.name === 'sqrt' && !a.missing && a.args.length === 1 && !a.scripts.length);
    const rt = pick(roots);
    if (rt) {
      const q = rt.args[0];
      const r = q.type === 'group' && !q.bad ? q.inner : { s: q.s, e: q.e };
      const rad = src.slice(r.s, r.e).trim();
      const idx = rt.opt ? src.slice(rt.opt.s, rt.opt.e).trim() || '2' : '2';
      const base = parseRange(rad, 0, rad.length).length > 1 ? '\\left(' + rad + '\\right)' : rad;
      const text = base + '^{\\frac{1}{' + idx + '}}';
      push({ group: 'Brüche, Wurzeln, Potenzen', title: 'Wurzel als Potenz schreiben', src: src.slice(0, rt.s) + text + src.slice(rt.e), select: { s: rt.s, e: rt.s + text.length } });
    }
    const negPow = findAtoms(src, (a) => a.scripts && a.scripts.length === 1 && a.scripts[0].kind === '^' && a.scripts[0].inner &&
      /^\s*-\s*\S/.test(src.slice(a.scripts[0].inner.s, a.scripts[0].inner.e)));
    const np = pick(negPow);
    if (np) {
      const sc = np.scripts[0];
      const baseT = src.slice(np.base.s, np.base.e);
      const rest = src.slice(sc.inner.s, sc.inner.e).replace(/^\s*-\s*/, '');
      const text = '\\frac{1}{' + baseT + '^{' + rest + '}}';
      push({ group: 'Brüche, Wurzeln, Potenzen', title: 'Negative Hochzahl als Bruch', src: src.slice(0, np.s) + text + src.slice(np.e), select: { s: np.s, e: np.s + text.length } });
    }

    /* Schreibweise */
    {
      const toks = tokenize(src, 0, src.length).filter((t) => t.t !== 'ws');
      const out = [];
      const stack = [];
      toks.forEach((t, k) => {
        if (isDelimOpener(t)) { toks[k + 1] && (toks[k + 1]._skip = true); return; }
        if (t._skip || t.t !== 'char') return;
        if (t.v === '(' || t.v === '[') stack.push({ k, v: t.v });
        else if (t.v === ')' || t.v === ']') {
          const want = t.v === ')' ? '(' : '[';
          for (let n = stack.length - 1; n >= 0; n--) {
            if (stack[n].v === want) { out.push(toks[stack[n].k], t); stack.splice(n, 1); break; }
          }
        }
      });
      if (out.length) {
        out.sort((p, q) => q.s - p.s);
        let s2 = src;
        for (const t of out) {
          const isOpen = t.v === '(' || t.v === '[';
          s2 = s2.slice(0, t.s) + (isOpen ? '\\left' : '\\right') + t.v + s2.slice(t.e);
        }
        push({ group: 'Schreibweise', title: 'Klammern an die Höhe anpassen (\\left … \\right)', src: s2 });
      }
    }
    if (/\d\.\d/.test(src)) push({ group: 'Schreibweise', title: 'Dezimalpunkt durch Komma ersetzen', src: src.replace(/(\d)\.(\d)/g, '$1{,}$2') });
    if (/\d\{,\}\d/.test(src)) push({ group: 'Schreibweise', title: 'Dezimalkomma durch Punkt ersetzen', src: src.replace(/(\d)\{,\}(\d)/g, '$1.$2') });
    if (/\\cdot(?![A-Za-z])/.test(src)) push({ group: 'Schreibweise', title: 'Malpunkt durch Malkreuz ersetzen', src: src.replace(/\\cdot(?![A-Za-z])/g, '\\times') });
    if (/\\times(?![A-Za-z])/.test(src)) push({ group: 'Schreibweise', title: 'Malkreuz durch Malpunkt ersetzen', src: src.replace(/\\times(?![A-Za-z])/g, '\\cdot') });
    if (/\\[dt]?frac/.test(src) && !/^\s*\\displaystyle/.test(src)) push({ group: 'Schreibweise', title: 'Brüche in voller Größe (\\displaystyle)', src: '\\displaystyle ' + src });
    if (/^\s*\\displaystyle\s/.test(src)) push({ group: 'Schreibweise', title: '\\displaystyle entfernen', src: src.replace(/^\s*\\displaystyle\s+/, '') });
    return items;
  }

  /** Beide Seiten einer Gleichung verändern: op = '+', '-', '*', '/' */
  function bothSides(src, op, value) {
    const eq = analyzeEquation(src);
    if (!eq) return null;
    const v = (value || '').trim() || '\\square';
    const L = joinBlocks(eq.L).text, R = joinBlocks(eq.R).text;
    const vv = parseRange(v, 0, v.length).length > 1 ? '\\left(' + v + '\\right)' : v;
    let l, r;
    if (op === '+') { l = L + ' + ' + v; r = R + ' + ' + v; }
    else if (op === '-') { l = L + ' - ' + vv; r = R + ' - ' + vv; }
    else if (op === '*') { l = vv + ' \\cdot ' + wrapSum(L); r = vv + ' \\cdot ' + wrapSum(R); }
    else if (op === '/') { l = '\\frac{' + L + '}{' + v + '}'; r = '\\frac{' + R + '}{' + v + '}'; }
    else return null;
    return l + ' ' + eq.rel + ' ' + r;
  }

  /* ---------- Fehlertexte ---------- */
  function lev(a, b) {
    const d = [];
    for (let i = 0; i <= a.length; i++) { d[i] = [i]; }
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return d[a.length][b.length];
  }
  function suggestCommand(name) {
    let best = null, bestD = 99;
    const lower = name.toLowerCase();
    for (const c of KNOWN_CMDS) {
      let d = lev(lower, c.toLowerCase());
      if (c.toLowerCase().startsWith(lower) && lower.length >= 2) d = Math.min(d, 1);
      if (d < bestD) { bestD = d; best = c; }
    }
    return bestD <= Math.max(1, Math.ceil(name.length / 3)) ? best : null;
  }

  function bracketReport(src) {
    const toks = tokenize(src, 0, src.length).filter((t) => t.t !== 'ws');
    const { map, bad } = matchTokens(toks);
    const unclosedBraces = [], strayBraces = [], unclosedLeft = [], strayRight = [], unclosedBegin = [], strayEnd = [];
    for (const k of bad) {
      const t = toks[k];
      if (t.t === 'lb') unclosedBraces.push(t);
      else if (t.t === 'rb') strayBraces.push(t);
      else if (t.v === 'left') unclosedLeft.push({ t, k });
      else if (t.v === 'right') strayRight.push(t);
      else if (t.v === 'begin') unclosedBegin.push(t);
      else strayEnd.push(t);
    }
    void map;
    return { unclosedBraces, strayBraces, unclosedLeft, strayRight, unclosedBegin, strayEnd, toks };
  }

  const CLOSERS = { '(': ')', '[': ']', '|': '|', '\\{': '\\}', '\\langle': '\\rangle', '\\lfloor': '\\rfloor', '\\lceil': '\\rceil', '.': '.', '\\|': '\\|' };

  function lastIncompleteCommand(src) {
    const found = findAtoms(src, (a) => (a.type === 'cmd' && a.missing > 0) || (a.scripts || []).some((s) => s.missing));
    return found.length ? found[found.length - 1] : null;
  }

  const CMD_HELP = {
    frac: '\\frac braucht zwei Gruppen: \\frac{Zähler}{Nenner}.', dfrac: '\\dfrac braucht zwei Gruppen: \\dfrac{Zähler}{Nenner}.',
    tfrac: '\\tfrac braucht zwei Gruppen: \\tfrac{Zähler}{Nenner}.', binom: '\\binom braucht zwei Gruppen: \\binom{n}{k}.',
    sqrt: '\\sqrt braucht den Ausdruck unter der Wurzel: \\sqrt{x}.', overline: '\\overline braucht einen Ausdruck: \\overline{x}.',
    vec: '\\vec braucht einen Ausdruck: \\vec{v}.', text: '\\text braucht den Text in Klammern: \\text{ und }.'
  };

  /** Übersetzt eine KaTeX-Fehlermeldung. Rückgabe: {title, detail, s, e, fix:{label, src}} */
  function translateError(err, src) {
    const raw = (err && (err.rawMessage || err.message)) || String(err);
    const msg = raw.replace(/^KaTeX parse error:\s*/, '').replace(/ at position \d+.*$/s, '');
    const pos = typeof err.position === 'number' ? err.position : null;
    const len = typeof err.length === 'number' && err.length > 0 ? err.length : 1;
    const rangeAt = () => (pos != null ? { s: Math.min(pos, src.length), e: Math.min(src.length, pos + len) } : null);
    const out = (title, detail, extra) => Object.assign({ title, detail: detail || '', raw: msg }, rangeAt() || {}, extra || {});
    let m;
    const rep = bracketReport(src);

    if (/Expected '\}', got 'EOF'|Unexpected end of input in a macro argument, expected '\}'/.test(msg) && rep.unclosedBraces.length) {
      const n = rep.unclosedBraces.length;
      const t = rep.unclosedBraces[rep.unclosedBraces.length - 1];
      return out('Eine geschweifte Klammer ist nicht geschlossen',
        'Zu jedem { gehört ein }. ' + (n === 1 ? 'Es fehlt ein schließendes }.' : 'Es fehlen ' + n + ' schließende }.'),
        { s: t.s, e: t.e, fix: { label: '} am Ende ergänzen', src: src + '}'.repeat(n) } });
    }
    if ((m = /Expected 'EOF', got '\}'/.exec(msg))) {
      const t = rep.strayBraces[0];
      const fixSrc = t ? src.slice(0, t.s) + src.slice(t.e) : null;
      return out('Eine schließende Klammer } hat kein Gegenstück',
        'Vor diesem } wurde keine { geöffnet. Lösche das } oder setze davor ein {.',
        t ? { s: t.s, e: t.e, fix: { label: 'Überzähliges } löschen', src: fixSrc } } : {});
    }
    if (/Expected '\\right', got 'EOF'/.test(msg)) {
      const ul = rep.unclosedLeft[rep.unclosedLeft.length - 1];
      let close = ')';
      if (ul) {
        const d = rep.toks[ul.k + 1];
        const dtext = d ? src.slice(d.s, d.e) : '(';
        close = CLOSERS[dtext] || '.';
      }
      return out('Zu \\left fehlt das passende \\right',
        'Jede mitwachsende Klammer \\left( braucht am Ende ein \\right).',
        { s: ul ? ul.t.s : 0, e: ul ? ul.t.e : 0, fix: { label: '\\right' + close + ' am Ende ergänzen', src: src + ' \\right' + close } });
    }
    if (/Expected 'EOF', got '\\right'/.test(msg)) {
      return out('Zu \\right fehlt das passende \\left',
        'Vor dieser Klammer wurde kein \\left geöffnet.',
        { fix: { label: '\\left. am Anfang ergänzen', src: '\\left. ' + src } });
    }
    if ((m = /Invalid delimiter '(.*)' after '\\(left|right)'/.exec(msg))) {
      return out('Nach \\' + m[2] + ' fehlt eine Klammer', 'Erlaubt sind zum Beispiel ( ) [ ] | \\{ \\} oder ein Punkt für „unsichtbar“.');
    }
    if ((m = /Expected group after '(\^|_)'/.exec(msg))) {
      return out(m[1] === '^' ? 'Nach ^ fehlt die Hochzahl' : 'Nach _ fehlt der Index',
        m[1] === '^' ? 'Schreibe die Hochzahl dahinter, zum Beispiel x^{2}.' : 'Schreibe den Index dahinter, zum Beispiel x_{i}.');
    }
    if (/Double superscript/.test(msg)) return out('Zwei Hochzahlen an derselben Stelle', 'x^2^3 ist mehrdeutig. Gruppiere mit Klammern: x^{2^3} oder {x^2}^3.');
    if (/Double subscript/.test(msg)) return out('Zwei Indizes an derselben Stelle', 'x_1_2 ist mehrdeutig. Gruppiere mit Klammern: x_{1,2} oder {x_1}_2.');
    if ((m = /Undefined control sequence: \\(\S+)/.exec(msg))) {
      const name = m[1];
      if (name === 'htmlClass') return out('Dieser Befehl ist hier nicht erlaubt', '\\htmlClass wird vom Editor intern für die Markierung genutzt.');
      const sug = suggestCommand(name);
      return out('Unbekannter Befehl \\' + name,
        sug ? 'Meintest du \\' + sug + '? Prüfe sonst die Schreibweise (Groß- und Kleinschreibung zählt).' : 'Prüfe die Schreibweise. Groß- und Kleinschreibung zählt.',
        sug && pos != null ? { fix: { label: '\\' + name + ' → \\' + sug, src: src.slice(0, pos) + '\\' + sug + src.slice(pos + 1 + name.length) } } : {});
    }
    if ((m = /Expected group as argument to '\\(\S+)'/.exec(msg))) {
      return out('Nach \\' + m[1] + ' fehlt das Argument', CMD_HELP[m[1]] || '\\' + m[1] + ' braucht eine Gruppe in geschweiften Klammern.');
    }
    if (/Unexpected end of input in a macro argument, expected '\]'/.test(msg)) {
      return out('Eine eckige Klammer ist nicht geschlossen', 'Bei \\sqrt[n]{x} steht die Wurzelzahl in eckigen Klammern. Es fehlt ein ].',
        { fix: { label: '] und Platz für die Wurzel ergänzen', src: src + ']{\\square}' } });
    }
    if (/Unexpected end of input in a macro argument|Expected '\}', got 'EOF'/.test(msg)) {
      const c = lastIncompleteCommand(src);
      if (c && c.type === 'cmd') {
        const need = ARITY[c.name] || 1;
        return out('Dem Befehl \\' + c.name + ' fehlt ein Teil',
          CMD_HELP[c.name] || '\\' + c.name + ' braucht ' + (need === 1 ? 'eine Gruppe' : need + ' Gruppen') + ' in geschweiften Klammern.',
          { s: c.s, e: c.s + c.name.length + 1 });
      }
      return out('Am Ende der Formel fehlt etwas', 'Ein Befehl oder eine Klammer wurde nicht vollständig geschrieben.');
    }
    if (/Expected & or \\\\ or \\cr or \\end/.test(msg)) {
      const b = rep.unclosedBegin[rep.unclosedBegin.length - 1];
      return out('Matrix oder Tabelle ist nicht abgeschlossen',
        'Zu \\begin{…} fehlt das passende \\end{…}, oder & und \\\\ sind falsch gesetzt.',
        b ? { s: b.s, e: b.e } : {});
    }
    if ((m = /No such environment: (\S+)/.exec(msg))) {
      return out('Unbekannte Umgebung „' + m[1] + '“', 'Bekannt sind zum Beispiel matrix, pmatrix, bmatrix, vmatrix, cases, aligned und array.');
    }
    if ((m = /Mismatch: \\begin\{(.+?)\} matched by \\end\{(.+?)\}/.exec(msg))) {
      return out('\\begin und \\end passen nicht zusammen',
        'Du beginnst mit „' + m[1] + '“ und endest mit „' + m[2] + '“. Beide Namen müssen gleich sein.',
        pos != null ? { fix: { label: 'Ende zu „' + m[1] + '“ ändern', src: src.replace('\\end{' + m[2] + '}', '\\end{' + m[1] + '}') } } : {});
    }
    if (/Expected 'EOF', got '&'/.test(msg)) {
      return out('Das Zeichen & steht außerhalb einer Matrix',
        '& trennt Spalten und funktioniert nur in Umgebungen wie pmatrix, cases oder aligned. Für ein Und-Zeichen schreibe \\&.',
        pos != null ? { fix: { label: '& durch \\& ersetzen', src: src.slice(0, pos) + '\\&' + src.slice(pos + 1) } } : {});
    }
    if (/Expected 'EOF', got '\\end'/.test(msg)) {
      return out('Zu \\end fehlt das passende \\begin', 'Vor diesem \\end wurde keine Umgebung mit \\begin{…} geöffnet.');
    }
    if (/Limit controls must follow a math operator/.test(msg)) {
      return out('\\limits steht an der falschen Stelle', '\\limits passt nur direkt hinter \\sum, \\int, \\lim und ähnliche Operatoren.');
    }
    if (/Can't use function '\$' in math mode/.test(msg)) {
      return out('Dollarzeichen sind nicht nötig', 'Der Editor setzt die Formel schon in den Mathe-Modus. Lösche die $-Zeichen.',
        { fix: { label: '$-Zeichen löschen', src: src.replace(/\$/g, '') } });
    }
    if (/Expected 'EOF', got '#'/.test(msg)) {
      return out('Das Zeichen # ist ein Sonderzeichen', 'Schreibe \\# für eine Raute.',
        pos != null ? { fix: { label: '# durch \\# ersetzen', src: src.slice(0, pos) + '\\#' + src.slice(pos + 1) } } : {});
    }
    if (/only one infix operator per group/.test(msg)) {
      return out('Mehrere \\over in einer Gruppe', 'Nimm besser \\frac{Zähler}{Nenner}, dann ist klar, was oben und unten steht.');
    }
    if (/Unexpected character: '\\'/.test(msg)) {
      return out('Ein einzelner Backslash steht allein', 'Ein \\ leitet einen Befehl ein. Für das Zeichen selbst schreibe \\backslash.',
        pos != null ? { fix: { label: 'Backslash löschen', src: src.slice(0, pos) + src.slice(pos + 1) } } : {});
    }
    if (/\\hline valid only within array environment/.test(msg)) {
      return out('\\hline gehört in eine Tabelle', 'Der Befehl funktioniert nur innerhalb von \\begin{array} … \\end{array}.');
    }
    if ((m = /Expected 'EOF', got '(.+)'/.exec(msg))) {
      return out('Unerwartetes Zeichen „' + m[1] + '“', 'An dieser Stelle kann der Editor das Zeichen nicht lesen. Prüfe die Klammern davor.');
    }
    return out('Die Formel ist noch nicht gültig', 'Prüfe Klammern und Befehle. Technische Meldung: ' + msg);
  }

  /* ---------- Verschiebungen von Bereichen nach einer Änderung ---------- */
  /** Bereichsliste nach Ersetzen von [x,y) durch Text der Länge len anpassen. null = ungültig. */
  function shiftRange(r, x, y, len) {
    const delta = len - (y - x);
    let s, e;
    if (r.s <= x) s = r.s; else if (r.s >= y) s = r.s + delta; else return null;
    if (r.e < x) e = r.e; else if (r.e >= y) e = r.e + delta; else return null;
    if (e < s) return null;
    return Object.assign({}, r, { s, e });
  }
  /** Einzelne Ersetzung aus zwei Textständen bestimmen. */
  function diffEdit(oldS, newS) {
    let p = 0;
    const max = Math.min(oldS.length, newS.length);
    while (p < max && oldS[p] === newS[p]) p++;
    let q = 0;
    while (q < max - p && oldS[oldS.length - 1 - q] === newS[newS.length - 1 - q]) q++;
    return { x: p, y: oldS.length - q, len: newS.length - q - p };
  }

  /* ---------- Anklickbare Formelteile (Vorschau → Quelltext) ---------- */
  const NO_WRAP = new Set(['sum', 'prod', 'coprod', 'int', 'iint', 'iiint', 'oint', 'lim', 'limsup', 'liminf', 'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
    'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'coth', 'ln', 'log', 'lg', 'exp', 'max', 'min', 'sup', 'inf', 'det', 'gcd', 'deg', 'dim', 'ker',
    'Pr', 'arg', 'hom', 'limits', 'nolimits', 'displaystyle', 'textstyle', 'scriptstyle', 'scriptscriptstyle', 'left', 'right', 'big', 'Big', 'bigg', 'Bigg',
    'bigl', 'bigr', 'not', 'color', 'textcolor', 'htmlClass', 'htmlData', 'over', 'atop', 'choose', 'above', 'pmod', 'bmod', 'mod', 'pod', 'tag',
    'nonumber', 'hline', 'mathop', 'mathbin', 'mathrel', 'substack', 'overset', 'underset', 'stackrel', 'begin', 'end', 'prime', 'cdotp', 'mathstrut',
    'relax', 'phantom', 'hphantom', 'vphantom', 'dots', 'ldots', 'cdots', 'vdots', 'ddots', 'quad', 'qquad']);
  const RECURSE_CMDS = new Set([...FRAC_LIKE, 'binom', 'dbinom', 'tbinom', 'sqrt']);

  /** Liefert die kleinsten sicher umschließbaren Teile der Formel (Ziffern, Buchstaben, Zeichen, ganze Befehle). */
  function leafRanges(src) {
    const out = [];
    const symCmd = (a) => /^[A-Za-z]+$/.test(a.name || '') && !NO_WRAP.has(a.name);
    const okLeaf = (a) => {
      if (a.bad || a.empty) return false;
      if (a.type === 'ord') return a.cmd ? symCmd(a) : (a.kind === 'num' || a.kind === 'letter');
      if (a.type === 'rel' || a.type === 'pm' || a.type === 'mul') return a.cmd ? symCmd(a) : '+-=<>*/'.indexOf(a.ch) >= 0;
      return false;
    };
    const walk = (s, e) => { for (const a of parseRange(src, s, e)) atom(a, false); };
    function atom(a, inArg) {
      if (!a || a.bad) return;
      const b = a.base || { s: a.s, e: a.e };
      const push = () => out.push({ s: b.s, e: b.e, arg: inArg });
      switch (a.type) {
        case 'group': if (a.inner) walk(a.inner.s, a.inner.e); break;
        case 'paren': case 'left': case 'env': walk(a.inner.s, a.inner.e); break;
        case 'cmd':
          if (RECURSE_CMDS.has(a.name)) {
            if (a.missing) break;
            if (a.opt) walk(a.opt.s, a.opt.e);
            a.args.forEach((x) => atom(x, true));
          } else if (!NO_WRAP.has(a.name) && !a.missing) push();
          break;
        default: if (okLeaf(a)) push();
      }
      for (const sc of a.scripts || []) if (sc.arg) atom(sc.arg, true);
    }
    walk(0, src.length);
    return out.sort((x, y) => x.s - y.s);
  }

  /** Quelltext für die Vorschau: Auswahl hervorgehoben, jedes Formelteil trägt data-p="von-bis". */
  function markedSource(src, sel) {
    const ins = [];
    for (const l of leafRanges(src)) {
      if (sel && ((l.s < sel.s && l.e > sel.s) || (l.s < sel.e && l.e > sel.e))) continue;
      ins.push({ pos: l.s, ord: 3, text: (l.arg ? '{' : '') + '\\htmlData{p=' + l.s + '-' + l.e + '}{' });
      ins.push({ pos: l.e, ord: 0, text: l.arg ? '}}' : '}' });
    }
    if (sel) {
      ins.push({ pos: sel.s, ord: 2, text: '\\htmlClass{sel}{' });
      ins.push({ pos: sel.e, ord: 1, text: '}' });
    }
    ins.sort((x, y) => x.pos - y.pos || x.ord - y.ord);
    let out = '', at = 0;
    for (const i of ins) { out += src.slice(at, i.pos) + i.text; at = i.pos; }
    return phWrap(out + src.slice(at));
  }

  /** Nächstgrößere sinnvolle Auswahl um a..b (Teil → Argument → Bruch → …). */
  function expandRange(src, a, b) {
    const cands = [];
    const add = (r) => { if (r && r.e > r.s) cands.push({ s: r.s, e: r.e }); };
    for (const x of findAtoms(src, () => true, 0, src.length)) {
      add(x); add(x.base);
      (x.kids || []).forEach(add);
      (x.scripts || []).forEach((sc) => add(sc.arg));
    }
    add({ s: 0, e: src.length });
    let best = null;
    for (const c of cands) {
      let s = c.s, e = c.e;
      while (s < e && /\s/.test(src[s])) s++;
      while (e > s && /\s/.test(src[e - 1])) e--;
      if (s <= a && e >= b && (s < a || e > b) && (!best || e - s < best.e - best.s)) {
        const r = snapRange(src, s, e);
        if (r && r.s <= a && r.e >= b && (r.s < a || r.e > b)) best = r;
      }
    }
    return best;
  }

  /** Größter Teil, der echt innerhalb von a..b liegt (Gegenstück zu expandRange). */
  function shrinkRange(src, a, b) {
    const cands = [];
    const add = (r) => { if (r && r.e > r.s) cands.push({ s: r.s, e: r.e }); };
    for (const x of findAtoms(src, () => true, a, b)) {
      add(x); add(x.base);
      (x.kids || []).forEach(add);
      (x.scripts || []).forEach((sc) => add(sc.arg));
    }
    let best = null;
    for (const c of cands) {
      let s0 = c.s, e0 = c.e;
      while (s0 < e0 && /\s/.test(src[s0])) s0++;
      while (e0 > s0 && /\s/.test(src[e0 - 1])) e0--;
      if (s0 >= a && e0 <= b && (s0 > a || e0 < b) && (!best || e0 - s0 > best.e - best.s)) best = { s: s0, e: e0 };
    }
    return best;
  }

  /* ---------- Taschenrechner: LaTeX lesen und ausrechnen ---------- */
  // Zahlen sind exakt (Bruch aus BigInt), solange es geht, sonst Fließkomma. ± liefert mehrere Werte.
  const C_SKIP = new Set([',', ';', ':', '!', ' ', 'quad', 'qquad', 'enspace', 'thinspace', 'medspace', 'thickspace', 'displaystyle', 'textstyle', 'limits', 'nolimits']);
  const C_FUNCS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'coth', 'ln', 'log', 'lg', 'exp']);
  const C_FACTOR = new Set(['frac', 'dfrac', 'tfrac', 'cfrac', 'sqrt', 'left', 'binom', 'dbinom', 'tbinom', 'pi', 'sum', 'prod', 'lfloor', 'lceil', 'mathrm'].concat(Array.from(C_FUNCS)));
  const C_UNSUP = { int: 'Integrale', iint: 'Integrale', oint: 'Integrale', lim: 'Grenzwerte', infty: '∞ (unendlich)', partial: 'Ableitungen', nabla: 'Ableitungen' };

  const cerr = (kind, msg, extra) => Object.assign({ calc: true, kind, msg: msg || '' }, extra || {});
  const mathErr = (msg) => cerr('math', msg);
  const absB = (x) => (x < 0n ? -x : x);
  function gcdB(a, b) { a = absB(a); b = absB(b); while (b) { const t = a % b; a = b; b = t; } return a; }
  function mkR(n, d) {
    if (d < 0n) { n = -n; d = -d; }
    const g = gcdB(n, d);
    if (g > 1n) { n /= g; d /= g; }
    return { n, d };
  }
  const isEx = (x) => x.f === undefined;
  const ONE = { n: 1n, d: 1n };
  const BIGLIM = 10n ** 400n;
  function lnBig(x) { const s = x.toString(); return Math.log(Number('0.' + s.slice(0, 16))) + s.length * Math.LN10; }
  function ratToFloat(n, d) {
    const neg = n < 0n;
    const a = neg ? -n : n;
    let r = Number(a) / Number(d);
    if (!isFinite(r)) r = a === 0n ? 0 : Math.exp(lnBig(a) - lnBig(d));
    return neg ? -r : r;
  }
  const toF = (x) => (isEx(x) ? ratToFloat(x.n, x.d) : x.f);
  function F(f) {
    if (!isFinite(f)) throw mathErr('Die Zahl ist zu groß oder nicht definiert.');
    return { f };
  }
  const fit = (x) => (isEx(x) && (absB(x.n) > BIGLIM || x.d > BIGLIM) ? F(ratToFloat(x.n, x.d)) : x);
  const isZeroCalc = (x) => (isEx(x) ? x.n === 0n : x.f === 0);
  const negN = (x) => (isEx(x) ? { n: -x.n, d: x.d } : { f: -x.f });
  function addN(a, b) { return isEx(a) && isEx(b) ? fit(mkR(a.n * b.d + b.n * a.d, a.d * b.d)) : F(toF(a) + toF(b)); }
  const subN = (a, b) => addN(a, negN(b));
  function mulN(a, b) { return isEx(a) && isEx(b) ? fit(mkR(a.n * b.n, a.d * b.d)) : F(toF(a) * toF(b)); }
  function divN(a, b) {
    if (isZeroCalc(b)) throw mathErr('Teilen durch 0 ist nicht möglich.');
    return isEx(a) && isEx(b) ? fit(mkR(a.n * b.d, a.d * b.n)) : F(toF(a) / toF(b));
  }
  function decToRat(str) {
    const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(str);
    if (!m) return null;
    let n = BigInt(m[2] + (m[3] || ''));
    const sc = (m[3] ? m[3].length : 0) - (m[4] ? parseInt(m[4], 10) : 0);
    if (m[1]) n = -n;
    return sc >= 0 ? mkR(n, 10n ** BigInt(sc)) : mkR(n * 10n ** BigInt(-sc), 1n);
  }
  // Fließkomma-Ergebnis: wenn es (bis auf Rundungsrauschen) eine glatte Zahl mit höchstens 10 Stellen ist, wird sie exakt
  function snap(f) {
    if (!isFinite(f)) throw mathErr('Die Zahl ist zu groß oder nicht definiert.');
    if (f === 0) return { n: 0n, d: 1n };
    const s = Number(f.toPrecision(10));
    if (Math.abs(f - s) <= 8 * Number.EPSILON * Math.abs(f)) { const r = decToRat(String(s)); if (r) return r; }
    return { f };
  }
  function parseNumStr(s) {
    s = s.replace('{,}', '.');
    const parts = s.split('.');
    const fp = parts[1] || '';
    return mkR(BigInt(parts[0] + fp), 10n ** BigInt(fp.length));
  }
  function iroot(x, k) {
    if (x < 2n) return x;
    const kb = BigInt(k);
    let lo = 0n, hi = 1n << BigInt(Math.ceil(x.toString(2).length / k) + 1);
    while (lo < hi) { const mid = (lo + hi + 1n) >> 1n; if (mid ** kb <= x) lo = mid; else hi = mid - 1n; }
    return lo;
  }
  function rootExact(x, k) {
    const kb = BigInt(k);
    const nr = iroot(absB(x.n), k), dr = iroot(x.d, k);
    if (nr ** kb === absB(x.n) && dr ** kb === x.d) return mkR(x.n < 0n ? -nr : nr, dr);
    return null;
  }
  const NEGROOT = 'Die Wurzel aus einer negativen Zahl gibt es bei reellen Zahlen nicht.';
  function nthRoot(x, kN) {
    if (!isEx(kN) || kN.d !== 1n || kN.n < 1n || kN.n > 1000n) throw cerr('syntax', 'Der Wurzelexponent muss eine ganze Zahl von 1 bis 1000 sein.');
    const k = Number(kN.n);
    if (k === 1) return x;
    const neg = toF(x) < 0;
    if (neg && k % 2 === 0) throw mathErr(NEGROOT);
    if (isEx(x)) { const r = rootExact(x, k); if (r) return r; }
    const fv = toF(x);
    return snap(neg ? -Math.pow(-fv, 1 / k) : Math.pow(fv, 1 / k));
  }
  function powN(a, b) {
    if (isEx(b) && b.d === 1n) {
      const e = b.n, ae = absB(e);
      if (isEx(a) && ae <= 5000n && (a.n.toString().length + a.d.toString().length) * Number(ae) <= 20000) {
        if (a.n === 0n) { if (e < 0n) throw mathErr('Teilen durch 0 ist nicht möglich.'); return e === 0n ? ONE : { n: 0n, d: 1n }; }
        const n = a.n ** ae, d = a.d ** ae;
        return fit(e < 0n ? mkR(d, n) : mkR(n, d));
      }
      const fa0 = toF(a);
      if (fa0 === 0 && e < 0n) throw mathErr('Teilen durch 0 ist nicht möglich.');
      return snap(Math.pow(fa0, Number(e)));
    }
    if (isEx(a) && isEx(b) && b.d <= 1000n) return powN(nthRoot(a, { n: b.d, d: 1n }), { n: b.n, d: 1n });
    const fa = toF(a);
    if (fa < 0) throw mathErr(NEGROOT);
    return snap(Math.pow(fa, toF(b)));
  }
  function factN(x) {
    if (!isEx(x) || x.d !== 1n || x.n < 0n || x.n > 170n) throw mathErr('Die Fakultät gibt es nur für ganze Zahlen von 0 bis 170.');
    let r = 1n;
    for (let k = 2n; k <= x.n; k++) r *= k;
    return { n: r, d: 1n };
  }
  function binomN(a, b) {
    if (!isEx(a) || !isEx(b) || a.d !== 1n || b.d !== 1n || a.n < 0n || b.n < 0n || a.n > 2000n) throw mathErr('Der Binomialkoeffizient braucht ganze Zahlen ab 0 (n bis 2000).');
    const n = a.n;
    let k = b.n;
    if (k > n) return { n: 0n, d: 1n };
    if (k > n - k) k = n - k;
    let r = 1n;
    for (let i = 1n; i <= k; i++) r = (r * (n - k + i)) / i;
    return { n: r, d: 1n };
  }
  const absN = (x) => (isEx(x) ? { n: absB(x.n), d: x.d } : { f: Math.abs(x.f) });
  function floorN(x, up) {
    if (isEx(x)) {
      let q = x.n / x.d;
      if (x.n % x.d !== 0n) { if (x.n < 0n) { if (!up) q -= 1n; } else if (up) q += 1n; }
      return { n: q, d: 1n };
    }
    return snap(up ? Math.ceil(x.f) : Math.floor(x.f));
  }
  function funcN(name, x, base, inv) {
    const f = toF(x);
    const tr = (r) => snap(Math.abs(r) < 1e-14 ? 0 : r);
    const undef = (what) => mathErr(what + ' ist an dieser Stelle nicht definiert.');
    switch (name) {
      case 'sin': if (inv) { if (Math.abs(f) > 1) throw mathErr('arcsin ist nur für Zahlen von −1 bis 1 definiert.'); return snap(Math.asin(f)); } return tr(Math.sin(f));
      case 'cos': if (inv) { if (Math.abs(f) > 1) throw mathErr('arccos ist nur für Zahlen von −1 bis 1 definiert.'); return snap(Math.acos(f)); } return tr(Math.cos(f));
      case 'tan': if (inv) return snap(Math.atan(f)); if (Math.abs(Math.cos(f)) < 1e-14) throw undef('tan'); return tr(Math.tan(f));
      case 'cot': if (inv) return snap(f === 0 ? Math.PI / 2 : Math.atan(1 / f)); if (Math.abs(Math.sin(f)) < 1e-14) throw undef('cot'); return tr(1 / Math.tan(f));
      case 'sec': if (Math.abs(Math.cos(f)) < 1e-14) throw undef('sec'); return tr(1 / Math.cos(f));
      case 'csc': if (Math.abs(Math.sin(f)) < 1e-14) throw undef('csc'); return tr(1 / Math.sin(f));
      case 'arcsin': if (Math.abs(f) > 1) throw mathErr('arcsin ist nur für Zahlen von −1 bis 1 definiert.'); return snap(Math.asin(f));
      case 'arccos': if (Math.abs(f) > 1) throw mathErr('arccos ist nur für Zahlen von −1 bis 1 definiert.'); return snap(Math.acos(f));
      case 'arctan': return snap(Math.atan(f));
      case 'sinh': return snap(Math.sinh(f));
      case 'cosh': return snap(Math.cosh(f));
      case 'tanh': return snap(Math.tanh(f));
      case 'coth': if (f === 0) throw undef('coth'); return snap(1 / Math.tanh(f));
      case 'exp': return snap(Math.exp(f));
      case 'ln': if (!(f > 0)) throw mathErr('Der Logarithmus braucht eine Zahl größer als 0.'); return snap(Math.log(f));
      case 'lg': case 'log': {
        if (!(f > 0)) throw mathErr('Der Logarithmus braucht eine Zahl größer als 0.');
        if (!base) return snap(Math.log10(f));
        const bf = toF(base);
        if (!(bf > 0) || bf === 1) throw mathErr('Die Basis des Logarithmus muss größer als 0 und ungleich 1 sein.');
        return snap(Math.log(f) / Math.log(bf));
      }
      default: throw cerr('unsupported', 'Das kann der Rechner nicht berechnen: \\' + name + '.');
    }
  }

  function calcTokens(src) {
    const raw = tokenize(src).filter((t) => t.t !== 'ws');
    const out = [];
    for (let k = 0; k < raw.length; k++) {
      const t = raw[k];
      if (t.t === 'cmd' && C_SKIP.has(t.v)) continue;
      if (t.t === 'cmd' && (t.v === 'mathbin' || t.v === 'mathrel') && raw[k + 1] && raw[k + 1].t === 'lb' && raw[k + 2] && raw[k + 2].t === 'char' && raw[k + 3] && raw[k + 3].t === 'rb') {
        out.push({ t: 'char', s: t.s, e: raw[k + 3].e, v: raw[k + 2].v });
        k += 3;
        continue;
      }
      out.push(t);
    }
    return out;
  }

  function parseCalc(toks, src) {
    let i = 0;
    let absDepth = 0;
    const cur = () => toks[i];
    const isCh = (t, c) => !!t && t.t === 'char' && t.v === c;
    const isCm = (t, v) => !!t && t.t === 'cmd' && t.v === v;
    const incomplete = () => cerr('incomplete', 'Die Formel ist noch nicht vollständig.');
    const mismatch = () => cerr('syntax', 'Die Klammern passen nicht zusammen.');
    function expectCh(c) {
      const t = cur();
      if (!t) throw incomplete();
      if (!isCh(t, c)) throw mismatch();
      i++;
    }
    function expectRb() {
      const t = cur();
      if (!t) throw incomplete();
      if (t.t !== 'rb') throw mismatch();
      i++;
    }
    function startsFactor(t) {
      switch (t.t) {
        case 'num': case 'letter': case 'lb': return true;
        case 'char': return t.v === '(' || t.v === '[' || (t.v === '|' && absDepth === 0);
        case 'cmd': return C_FACTOR.has(t.v) || GREEK.has(t.v);
        default: return false;
      }
    }
    function expr() {
      let left = term();
      for (;;) {
        const t = cur();
        let op = null;
        if (isCh(t, '+')) op = '+';
        else if (isCh(t, '-')) op = '-';
        else if (isCm(t, 'pm')) op = '±';
        else if (isCm(t, 'mp')) op = '∓';
        if (!op) break;
        i++;
        if (i >= toks.length) throw incomplete();
        left = { t: 'bin', op, a: left, b: term() };
      }
      return left;
    }
    function term() {
      let left = unary();
      for (;;) {
        const t = cur();
        if (!t) break;
        let op = null;
        if (isCm(t, 'cdot') || isCm(t, 'times') || isCm(t, 'ast') || isCh(t, '*')) op = '*';
        else if (isCm(t, 'div') || isCh(t, '/') || isCh(t, ':')) op = '/';
        if (op) {
          i++;
          if (i >= toks.length) throw incomplete();
          left = { t: 'bin', op, a: left, b: unary() };
          continue;
        }
        if (startsFactor(t)) {
          if (left.lit && t.t === 'num') throw cerr('syntax', 'Zwei Zahlen stehen ohne Rechenzeichen nebeneinander.');
          left = { t: 'bin', op: '*', a: left, b: power() };
          continue;
        }
        break;
      }
      return left;
    }
    function unary() {
      const t = cur();
      if (!t) throw incomplete();
      if (isCh(t, '-')) { i++; return { t: 'neg', a: unary() }; }
      if (isCh(t, '+')) { i++; return unary(); }
      if (isCm(t, 'pm')) { i++; return { t: 'pm', a: unary() }; }
      if (isCm(t, 'mp')) { i++; return { t: 'mp', a: unary() }; }
      return power();
    }
    function power() {
      let node = primary();
      let hasPow = false;
      for (;;) {
        const t = cur();
        if (!t) break;
        if (isCh(t, '!')) { i++; node = { t: 'fact', a: node }; continue; }
        if (isCm(t, '%')) { i++; node = { t: 'pct', a: node }; continue; }
        if (t.t === 'sup') {
          if (hasPow) throw cerr('syntax', 'Zwei Hochzahlen übereinander sind nicht eindeutig.');
          i++;
          const ex = argAtom();
          hasPow = true;
          node = ex.t === 'const' && ex.name === 'deg' ? { t: 'bin', op: '*', a: node, b: ex } : { t: 'pow', a: node, b: ex };
          continue;
        }
        if (t.t === 'sub') throw cerr('unsupported', 'Tiefgestellte Zahlen kann der Rechner nur bei Variablen und Summen lesen.');
        break;
      }
      return node;
    }
    function groupExpr() {
      i++;
      if (cur() && cur().t === 'rb') throw cerr('syntax', 'Eine Klammer ist leer.');
      const e = expr();
      expectRb();
      return e;
    }
    function argAtom() {
      const t = cur();
      if (!t) throw incomplete();
      if (t.t === 'lb') return groupExpr();
      if (t.t === 'rb' || t.t === 'sup' || t.t === 'sub') throw incomplete();
      if (t.t === 'num' && /^\d{2,}$/.test(src.slice(t.s, t.e))) toks.splice(i, 1, { t: 'num', s: t.s, e: t.s + 1 }, { t: 'num', s: t.s + 1, e: t.e });
      return primary();
    }
    function findRbIdx(from) {
      let d = 0;
      for (let k = from; k < toks.length; k++) {
        if (toks[k].t === 'lb') d++;
        else if (toks[k].t === 'rb') { d--; if (d === 0) return k; }
      }
      throw incomplete();
    }
    function letterNode(v) {
      let name = v;
      const t = cur();
      if (t && t.t === 'sub') {
        i++;
        const a = cur();
        if (!a) throw incomplete();
        if (a.t === 'lb') {
          const j = findRbIdx(i);
          name += '_' + src.slice(toks[i].e, toks[j].s).replace(/\s+/g, '');
          i = j + 1;
        } else { name += '_' + src.slice(a.s, a.e); i++; }
      }
      return { t: 'var', name };
    }
    function primary() {
      const t = cur();
      if (!t) throw incomplete();
      switch (t.t) {
        case 'num': i++; return { t: 'num', v: parseNumStr(src.slice(t.s, t.e)), lit: true };
        case 'letter': i++; return letterNode(t.v);
        case 'lb': return groupExpr();
        case 'rb': throw incomplete();
        case 'sup': case 'sub': throw cerr('syntax', 'Vor der Hoch- oder Tiefzahl fehlt etwas.');
        case 'char': return charPrimary(t);
        default: return cmdPrimary(t);
      }
    }
    function charPrimary(t) {
      const c = t.v;
      if (c === '(' || c === '[') {
        i++;
        if (isCh(cur(), c === '(' ? ')' : ']')) throw cerr('syntax', 'Eine Klammer ist leer.');
        const e = expr();
        expectCh(c === '(' ? ')' : ']');
        return e;
      }
      if (c === '|') {
        i++;
        absDepth++;
        const e = expr();
        absDepth--;
        expectCh('|');
        return { t: 'abs', a: e };
      }
      if (c === ')' || c === ']') throw incomplete();
      throw cerr('syntax', 'Das Zeichen „' + c + '“ kann der Rechner hier nicht verwenden.');
    }
    function leftRight() {
      i++;
      const d = cur();
      if (!d) throw incomplete();
      let kind;
      if (isCh(d, '(') || isCh(d, '[') || isCh(d, '.')) kind = 'p';
      else if (isCh(d, '|')) kind = 'abs';
      else if (isCm(d, 'lfloor')) kind = 'floor';
      else if (isCm(d, 'lceil')) kind = 'ceil';
      else throw cerr('unsupported', 'Diese Klammer kann der Rechner nicht berechnen.');
      i++;
      if (isCm(cur(), 'right')) throw cerr('syntax', 'Eine Klammer ist leer.');
      const e = expr();
      const r = cur();
      if (!r) throw incomplete();
      if (!isCm(r, 'right')) throw mismatch();
      i++;
      if (!cur()) throw incomplete();
      i++;
      return kind === 'p' ? e : { t: kind, a: e };
    }
    function implicitProduct() {
      let left = power();
      while (cur() && startsFactor(cur()) && !(left.lit && cur().t === 'num') && !(cur().t === 'cmd' && C_FUNCS.has(cur().v))) {
        left = { t: 'bin', op: '*', a: left, b: power() };
      }
      return left;
    }
    function funcCall(name) {
      i++;
      let inv = false, ex = null, base = null;
      for (let n = 0; n < 2; n++) {
        const t = cur();
        if (t && t.t === 'sub' && name === 'log' && !base) { i++; base = argAtom(); }
        else if (t && t.t === 'sup' && !ex) { i++; ex = argAtom(); }
        else break;
      }
      if (ex && ex.t === 'neg' && ex.a.t === 'num' && ex.a.v.n === 1n && ex.a.v.d === 1n && /^(sin|cos|tan|cot)$/.test(name)) { inv = true; ex = null; }
      const t = cur();
      if (!t) throw incomplete();
      const arg = isCh(t, '(') || isCh(t, '[') || isCm(t, 'left') ? primary() : implicitProduct();
      const node = { t: 'fn', name, a: arg, base, inv };
      return ex ? { t: 'pow', a: node, b: ex } : node;
    }
    function bigOp(v) {
      i++;
      let sub = null, sup = null;
      for (let n = 0; n < 2; n++) {
        const t = cur();
        if (t && t.t === 'sub' && !sub) {
          i++;
          if (!cur()) throw incomplete();
          if (cur().t !== 'lb') throw cerr('syntax', 'Die Summe braucht unten eine Laufvariable mit Start, z. B. \\sum_{i=1}^{n}.');
          i++;
          const nm = cur();
          if (!nm) throw incomplete();
          if (nm.t !== 'letter') throw cerr('syntax', 'Die Summe braucht unten eine Laufvariable mit Start, z. B. \\sum_{i=1}^{n}.');
          i++;
          expectCh('=');
          const lo = expr();
          expectRb();
          sub = { v: nm.v, lo };
        } else if (t && t.t === 'sup' && !sup) { i++; sup = argAtom(); }
        else break;
      }
      if (!sub || !sup) throw cerr('syntax', 'Die Summe braucht unten die Laufvariable mit Start und oben das Ende, z. B. \\sum_{i=1}^{n}.');
      return { t: v, v: sub.v, lo: sub.lo, hi: sup, body: term() };
    }
    function cmdPrimary(t) {
      const v = t.v;
      if (v === 'left') return leftRight();
      if (v === 'frac' || v === 'dfrac' || v === 'tfrac' || v === 'cfrac') { i++; const a = argAtom(); const b = argAtom(); return { t: 'bin', op: '/', a, b }; }
      if (v === 'sqrt') {
        i++;
        let k = null;
        if (isCh(cur(), '[')) { i++; k = expr(); expectCh(']'); }
        return { t: 'root', a: argAtom(), k };
      }
      if (v === 'binom' || v === 'dbinom' || v === 'tbinom') { i++; const a = argAtom(); const b = argAtom(); return { t: 'binom', a, b }; }
      if (v === 'pi') { i++; return { t: 'const', name: 'pi' }; }
      if (v === 'circ' || v === 'degree') { i++; return { t: 'const', name: 'deg' }; }
      if (C_FUNCS.has(v)) return funcCall(v);
      if (v === 'sum' || v === 'prod') return bigOp(v);
      if (v === 'lfloor' || v === 'lceil') {
        i++;
        const a = expr();
        const close = cur();
        if (!close) throw incomplete();
        if (!isCm(close, v === 'lfloor' ? 'rfloor' : 'rceil')) throw mismatch();
        i++;
        return { t: v === 'lfloor' ? 'floor' : 'ceil', a };
      }
      if (v === 'mathrm') {
        i++;
        const o = cur(), l = toks[i + 1], c = toks[i + 2];
        if (o && o.t === 'lb' && l && l.t === 'letter' && c && c.t === 'rb') { i += 3; return { t: 'var', name: l.v }; }
        throw cerr('unsupported', 'Dieser Text in der Formel lässt sich nicht berechnen.');
      }
      if (v === 'right' || v === 'rfloor' || v === 'rceil') throw incomplete();
      if (GREEK.has(v)) { i++; return { t: 'var', name: '\\' + v }; }
      if (C_UNSUP[v]) throw cerr('unsupported', 'Das kann der Rechner nicht berechnen: ' + C_UNSUP[v] + '.');
      throw cerr('unsupported', 'Das kann der Rechner nicht berechnen: \\' + v + '.');
    }
    const ast = expr();
    if (i < toks.length) {
      const t = toks[i];
      if (t.t === 'rb' || isCh(t, ')') || isCh(t, ']') || isCm(t, 'right')) throw mismatch();
      throw cerr('syntax', 'Hier kann der Rechner nicht weiterlesen: „' + src.slice(t.s, t.e) + '“.');
    }
    return ast;
  }

  function freeVars(n, bound, out) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach((x) => freeVars(x, bound, out)); return; }
    if (n.t === 'var') { if (!bound.has(n.name) && n.name !== 'e') out.add(n.name); return; }
    if (n.t === 'sum' || n.t === 'prod') {
      freeVars(n.lo, bound, out);
      freeVars(n.hi, bound, out);
      const b2 = new Set(bound);
      b2.add(n.v);
      freeVars(n.body, b2, out);
      return;
    }
    for (const k of Object.keys(n)) if (k !== 't' && n[k] && typeof n[k] === 'object') freeVars(n[k], bound, out);
  }

  function dedupe(list) {
    const seen = new Set();
    const out = [];
    for (const x of list) {
      const k = isEx(x) ? x.n + '/' + x.d : 'f' + x.f;
      if (!seen.has(k)) { seen.add(k); out.push(x); }
    }
    if (out.length > 8) throw cerr('unsupported', 'Durch ± entstehen zu viele Ergebnisse.');
    return out;
  }
  function cross(la, lb, f) {
    const out = [];
    for (const a of la) for (const b of lb) { const r = f(a, b); if (Array.isArray(r)) out.push.apply(out, r); else out.push(r); }
    return dedupe(out);
  }
  function evalNode(n, env) {
    switch (n.t) {
      case 'num': return [n.v];
      case 'var':
        if (Object.prototype.hasOwnProperty.call(env, n.name)) return [env[n.name]];
        if (n.name === 'e') return [{ f: Math.E }];
        throw cerr('var', '', { names: [n.name] });
      case 'const': return [{ f: n.name === 'pi' ? Math.PI : Math.PI / 180 }];
      case 'neg': return evalNode(n.a, env).map(negN);
      case 'pm': return dedupe(evalNode(n.a, env).reduce((acc, x) => acc.concat([x, negN(x)]), []));
      case 'mp': return dedupe(evalNode(n.a, env).reduce((acc, x) => acc.concat([negN(x), x]), []));
      case 'bin': {
        const A = evalNode(n.a, env), B = evalNode(n.b, env);
        return cross(A, B, (x, y) => (n.op === '+' ? addN(x, y) : n.op === '-' ? subN(x, y) : n.op === '*' ? mulN(x, y) : n.op === '/' ? divN(x, y)
          : n.op === '±' ? [addN(x, y), subN(x, y)] : [subN(x, y), addN(x, y)]));
      }
      case 'pow': return cross(evalNode(n.a, env), evalNode(n.b, env), powN);
      case 'fact': return dedupe(evalNode(n.a, env).map(factN));
      case 'pct': return dedupe(evalNode(n.a, env).map((x) => divN(x, { n: 100n, d: 1n })));
      case 'abs': return dedupe(evalNode(n.a, env).map(absN));
      case 'floor': return dedupe(evalNode(n.a, env).map((x) => floorN(x, false)));
      case 'ceil': return dedupe(evalNode(n.a, env).map((x) => floorN(x, true)));
      case 'root': return cross(evalNode(n.a, env), n.k ? evalNode(n.k, env) : [{ n: 2n, d: 1n }], nthRoot);
      case 'binom': return cross(evalNode(n.a, env), evalNode(n.b, env), binomN);
      case 'fn': return cross(evalNode(n.a, env), n.base ? evalNode(n.base, env) : [null], (x, b) => funcN(n.name, x, b, n.inv));
      case 'sum': case 'prod': {
        const lo = evalNode(n.lo, env), hi = evalNode(n.hi, env);
        if (lo.length !== 1 || hi.length !== 1 || !isEx(lo[0]) || !isEx(hi[0]) || lo[0].d !== 1n || hi[0].d !== 1n) throw cerr('syntax', 'Start und Ende der Summe müssen ganze Zahlen sein.');
        if (hi[0].n - lo[0].n > 10000n) throw mathErr('Die Summe hat zu viele Glieder (mehr als 10 000).');
        let acc = n.t === 'sum' ? { n: 0n, d: 1n } : ONE;
        for (let k = lo[0].n; k <= hi[0].n; k++) {
          const env2 = Object.assign({}, env);
          env2[n.v] = { n: k, d: 1n };
          const vals = evalNode(n.body, env2);
          if (vals.length !== 1) throw cerr('unsupported', 'Ein ± in einer Summe kann der Rechner nicht berechnen.');
          acc = n.t === 'sum' ? addN(acc, vals[0]) : mulN(acc, vals[0]);
        }
        return [acc];
      }
      default: throw cerr('unsupported', 'Das kann der Rechner nicht berechnen.');
    }
  }

  /* Anzeige */
  function trimZeros(s) { return s.indexOf('.') >= 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s; }
  function fmtFloat(f) {
    if (f === 0) return '0';
    const a = Math.abs(f);
    if (a >= 1e15 || a < 1e-5) {
      const p = f.toExponential(9).split('e');
      return trimZeros(p[0]).replace('.', '{,}') + ' \\cdot 10^{' + parseInt(p[1], 10) + '}';
    }
    return String(Number(f.toPrecision(10))).replace('.', '{,}');
  }
  function fmtOne(x) {
    if (!isEx(x)) { const s = fmtFloat(x.f); return { pre: '\\approx', body: s, ins: s, plain: '≈ ' + s.replace(/[{}]/g, ''), wrap: x.f < 0 }; }
    const neg = x.n < 0n;
    const an = absB(x.n);
    if (x.d === 1n) {
      const s = x.n.toString();
      if (s.replace('-', '').length > 21) { const t = fmtFloat(toF(x)); return { pre: '\\approx', body: t, ins: t, plain: '≈ ' + t.replace(/[{}]/g, ''), wrap: neg }; }
      return { pre: '=', body: s, ins: s, plain: '= ' + s, wrap: neg };
    }
    let d = x.d, k2 = 0, k5 = 0;
    while (d % 2n === 0n) { d /= 2n; k2++; }
    while (d % 5n === 0n) { d /= 5n; k5++; }
    const k = Math.max(k2, k5);
    if (d === 1n && k <= 10) {
      const scaled = (an * 10n ** BigInt(k)) / x.d;
      const s = scaled.toString().padStart(k + 1, '0');
      const dec = (neg ? '-' : '') + s.slice(0, s.length - k) + '{,}' + s.slice(s.length - k);
      return { pre: '=', body: dec, ins: dec, plain: '= ' + dec.replace(/[{}]/g, ''), wrap: neg };
    }
    const approx = fmtFloat(toF(x));
    if (an < 1000000000n && x.d < 1000000000n) {
      const fr = (neg ? '-' : '') + '\\frac{' + an + '}{' + x.d + '}';
      return { pre: '=', body: fr + ' \\approx ' + approx, ins: fr, plain: '= ' + (neg ? '-' : '') + an + '/' + x.d + ' ≈ ' + approx.replace(/[{}]/g, ''), wrap: true };
    }
    return { pre: '\\approx', body: approx, ins: approx, plain: '≈ ' + approx.replace(/[{}]/g, ''), wrap: neg };
  }
  function packValues(vals, trivial) {
    const parts = vals.map(fmtOne);
    const approx = parts.some((p) => p.pre !== '=');
    const tex = (approx ? '\\approx ' : '= ') + parts.map((p) => p.body).join('\\;\\text{oder}\\;');
    const plain = parts.map((p, k) => (k && p.pre === '=' ? p.plain.replace(/^= /, '') : p.plain)).join(' oder ');
    return { ok: true, kind: 'value', tex, plain, ins: parts.length === 1 ? parts[0].ins : null, wrap: parts.length === 1 && parts[0].wrap, trivial: !!trivial };
  }
  function compareN(a, b) {
    if (isEx(a) && isEx(b)) { const l = a.n * b.d, r = b.n * a.d; return l < r ? -1 : l > r ? 1 : 0; }
    const x = toF(a), y = toF(b);
    if (Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y))) return 0;
    return x < y ? -1 : 1;
  }
  function relOf(t) {
    if (t.t === 'char') return t.v === '=' ? '=' : t.v === '<' ? '<' : t.v === '>' ? '>' : null;
    if (t.t === 'cmd') {
      if (t.v === 'le' || t.v === 'leq') return '<=';
      if (t.v === 'ge' || t.v === 'geq') return '>=';
      if (t.v === 'ne' || t.v === 'neq') return '!=';
    }
    return null;
  }
  function varMsg(names) {
    const nm = names.map((n) => '„' + n.replace(/^\\/, '') + '“');
    return (nm.length === 1 ? nm[0] + ' ist' : nm.join(', ') + ' sind') + ' unbekannt. Der Rechner braucht Zahlen.';
  }

  /** Rechnet einen LaTeX-Ausdruck aus. Ergebnis: {ok, kind:'value'|'check', tex, plain, ins, wrap, trivial} oder {ok:false, kind, msg, soft}. */
  function calc(src) {
    try {
      const toks = calcTokens(src || '');
      if (!toks.length) return { ok: false, kind: 'empty', soft: true, msg: '' };
      const segs = [];
      const rels = [];
      let cur = [], depth = 0;
      for (const t of toks) {
        if (t.t === 'lb' || (t.t === 'cmd' && (t.v === 'left' || t.v === 'begin')) || (t.t === 'char' && t.v === '(')) depth++;
        else if (t.t === 'rb' || (t.t === 'cmd' && (t.v === 'right' || t.v === 'end')) || (t.t === 'char' && t.v === ')')) depth--;
        const rel = depth === 0 ? relOf(t) : null;
        if (rel) { segs.push(cur); rels.push(rel); cur = []; } else cur.push(t);
      }
      segs.push(cur);
      const asts = segs.map((s) => (s.length ? parseCalc(s, src) : null));
      const vars = (a) => { const out = new Set(); freeVars(a, new Set(), out); return Array.from(out); };
      const values = (a) => {
        const v = vars(a);
        if (v.length) throw cerr('var', varMsg(v), { names: v });
        return evalNode(a, {});
      };
      const isNum = (a) => a.t === 'num' || (a.t === 'neg' && a.a.t === 'num');
      if (!rels.length || (rels.length === 1 && asts[1] === null)) {
        if (!asts[0]) throw cerr('incomplete', 'Die Formel ist noch nicht vollständig.');
        return packValues(values(asts[0]), isNum(asts[0]));
      }
      if (asts.some((a) => a === null)) throw cerr('incomplete', 'Die Formel ist noch nicht vollständig.');
      if (rels.length === 1 && asts[0].t === 'var' && !vars(asts[1]).length) return packValues(values(asts[1]), isNum(asts[1]));
      const lists = asts.map(values);
      if (lists.some((l) => l.length !== 1)) throw cerr('unsupported', 'Ein ± in einer Gleichung oder Ungleichung kann der Rechner nicht prüfen.');
      let ok = true;
      rels.forEach((r, k) => {
        const c = compareN(lists[k][0], lists[k + 1][0]);
        ok = ok && (r === '=' ? c === 0 : r === '<' ? c < 0 : r === '>' ? c > 0 : r === '<=' ? c <= 0 : r === '>=' ? c >= 0 : c !== 0);
      });
      return { ok: true, kind: 'check', truth: ok, tex: ok ? '\\text{stimmt}' : '\\text{stimmt nicht}', plain: ok ? 'stimmt' : 'stimmt nicht', ins: null, wrap: false, trivial: false };
    } catch (e) {
      if (e && e.calc) {
        const msg = e.kind === 'var' ? (e.msg || varMsg(e.names || [])) : e.msg;
        return { ok: false, kind: e.kind, soft: e.kind !== 'math', msg };
      }
      return { ok: false, kind: 'error', soft: true, msg: 'Das kann der Rechner nicht berechnen.' };
    }
  }

  return {
    shrinkRange, calc,
    leafRanges, markedSource, expandRange,
    tokenize, parseRange, findAtoms, blocksOf, blockKids, joinBlocks, reorderBlocks, moveText, snapRange, previewSource, nextPlaceholder,
    applyTemplate, variablesOf, variableTokens, replaceVariable, transformations, bothSides, translateError, suggestCommand,
    shiftRange, diffEdit, analyzeEquation, wrapSum, KNOWN_CMDS, flipSign
  };
});


