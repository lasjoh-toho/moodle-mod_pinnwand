/* Formeleditor – Oberfläche. Benötigt KaTeX (global `katex`) und FormelLogik. */
(function (global) {
  'use strict';
  const L = global.FormelLogik;
  let counter = 0;

  const KOPT = {
    throwOnError: true, displayMode: true, strict: 'ignore',
    trust: (c) => c.command === '\\htmlData' || (c.command === '\\htmlClass' && /^(sel|ph)$/.test(c.class))
  };

  const ICON = {
    grip: '<svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><g fill="currentColor"><circle cx="2.5" cy="3" r="1.3"/><circle cx="7.5" cy="3" r="1.3"/><circle cx="2.5" cy="8" r="1.3"/><circle cx="7.5" cy="8" r="1.3"/><circle cx="2.5" cy="13" r="1.3"/><circle cx="7.5" cy="13" r="1.3"/></g></svg>',
    undo: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M7.5 4 3.5 8l4 4M3.5 8H12a4.5 4.5 0 0 1 0 9H8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    redo: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="m12.5 4 4 4-4 4M16.5 8H8a4.5 4.5 0 0 0 0 9h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    next: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M3 10h10m-4-4 4 4-4 4M17 5v10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    kbd: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><rect x="2" y="5" width="16" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 8.5h1M8.5 8.5h1M12 8.5h1M15 8.5h0M6 12h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    copy: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    chev: '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="m5 8 5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    calc: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><rect x="4" y="2.5" width="12" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="6.3" y="5" width="7.4" height="3" rx=".6" fill="currentColor" opacity=".55"/><g fill="currentColor"><circle cx="7.2" cy="11.2" r=".95"/><circle cx="10" cy="11.2" r=".95"/><circle cx="12.8" cy="11.2" r=".95"/><circle cx="7.2" cy="14.4" r=".95"/><circle cx="10" cy="14.4" r=".95"/><circle cx="12.8" cy="14.4" r=".95"/></g></svg>',
    swap: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M3.5 7H16m-3.5-3.5L16 7l-3.5 3.5M16.5 13H4m3.5-3.5L4 13l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  /* ---------- Ribbon-Buttons ---------- */
  const B = {};
  const def = (id, l, t, kind, tpl, extra) => { B[id] = Object.assign({ id, l, t, kind, tpl }, extra || {}); };
  // Aufbau
  def('frac', '\\tfrac{a}{b}', 'Bruch', 'wrap', '\\frac{$S}{$1}', { smart: 'frac' });
  def('sqrt', '\\sqrt{x}', 'Quadratwurzel', 'wrap', '\\sqrt{$S}');
  def('nroot', '\\sqrt[n]{x}', 'n-te Wurzel', 'wrap', '\\sqrt[$1]{$S}');
  def('pow', 'x^{n}', 'Hochzahl (Potenz)', 'script', '^{$1}');
  def('sq', 'x^{2}', 'Quadrat', 'script', '^{2}');
  def('cube', 'x^{3}', 'Hoch drei', 'script', '^{3}');
  def('sub', 'x_{i}', 'Tiefgestellt (Index)', 'script', '_{$1}');
  def('fact', 'n!', 'Fakultät', 'script', '!');
  def('paren', '(x)', 'Runde Klammern, wachsen mit dem Inhalt', 'wrap', '\\left($S\\right)');
  def('brack', '[x]', 'Eckige Klammern', 'wrap', '\\left[$S\\right]');
  def('brace', '\\{x\\}', 'Geschweifte Klammern', 'wrap', '\\left\\{$S\\right\\}');
  def('abs', '|x|', 'Betrag', 'wrap', '\\left|$S\\right|');
  def('norm', '\\|x\\|', 'Norm', 'wrap', '\\left\\|$S\\right\\|');
  def('floor', '\\lfloor x\\rfloor', 'Abrunden', 'wrap', '\\left\\lfloor $S\\right\\rfloor');
  def('ceil', '\\lceil x\\rceil', 'Aufrunden', 'wrap', '\\left\\lceil $S\\right\\rceil');
  def('binom', '\\tbinom{n}{k}', 'Binomialkoeffizient', 'wrap', '\\binom{$S}{$1}');
  def('text', '\\text{Text}', 'Text in der Formel', 'wrap', '\\text{$S}');
  def('cases', '{\\scriptstyle\\begin{cases}a\\\\b\\end{cases}}', 'Gleichungssystem oder Fallunterscheidung', 'wrap', '\\begin{cases} $S \\\\ $1 \\end{cases}');
  def('pmatrix', '{\\scriptstyle\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}}', 'Matrix', 'insert', '\\begin{pmatrix} $1 & $2 \\\\ $3 & $4 \\end{pmatrix}');
  def('vmatrix', '{\\scriptstyle\\begin{vmatrix}a&b\\\\c&d\\end{vmatrix}}', 'Determinante', 'insert', '\\begin{vmatrix} $1 & $2 \\\\ $3 & $4 \\end{vmatrix}');
  def('overline', '\\overline{x}', 'Überstrichen', 'wrap', '\\overline{$S}');
  def('underline', '\\underline{x}', 'Unterstrichen', 'wrap', '\\underline{$S}');
  def('vec', '\\vec{v}', 'Vektorpfeil', 'wrap', '\\vec{$S}');
  def('hat', '\\hat{x}', 'Dach', 'wrap', '\\hat{$S}');
  def('bar', '\\bar{x}', 'Querstrich', 'wrap', '\\bar{$S}');
  def('dotacc', '\\dot{x}', 'Punkt darüber (Zeitableitung)', 'wrap', '\\dot{$S}');
  def('tilde', '\\tilde{x}', 'Tilde', 'wrap', '\\tilde{$S}');
  def('arrowab', '\\overrightarrow{AB}', 'Pfeil über mehreren Zeichen', 'wrap', '\\overrightarrow{$S}');
  // Analysis
  def('sum', '\\sum', 'Summe', 'wrap', '\\sum_{$1=$2}^{$3} $S');
  def('prod', '\\prod', 'Produkt', 'wrap', '\\prod_{$1=$2}^{$3} $S');
  def('int', '\\int_a^b', 'Bestimmtes Integral', 'wrap', '\\int_{$1}^{$2} $S \\,\\mathrm{d}$3');
  def('intu', '\\int', 'Unbestimmtes Integral', 'wrap', '\\int $S \\,\\mathrm{d}$1');
  def('iint', '\\iint', 'Doppelintegral', 'wrap', '\\iint_{$1} $S \\,\\mathrm{d}A');
  def('oint', '\\oint', 'Kurvenintegral (geschlossen)', 'wrap', '\\oint_{$1} $S \\,\\mathrm{d}s');
  def('lim', '\\lim_{x\\to a}', 'Grenzwert', 'wrap', '\\lim_{$1 \\to $2} $S');
  def('deriv', '\\tfrac{\\mathrm{d}}{\\mathrm{d}x}', 'Ableitung nach x', 'wrap', '\\frac{\\mathrm{d}}{\\mathrm{d}$1} $S');
  def('dquot', '\\tfrac{\\mathrm{d}y}{\\mathrm{d}x}', 'Differentialquotient', 'insert', '\\frac{\\mathrm{d}$1}{\\mathrm{d}$2}');
  def('partial', '\\tfrac{\\partial}{\\partial x}', 'Partielle Ableitung', 'wrap', '\\frac{\\partial}{\\partial $1} $S');
  def('fprime', "f'(x)", 'Ableitung f′(x)', 'insert', "f'($1)");
  def('dx', '\\mathrm{d}x', 'Differential dx', 'insert', '\\,\\mathrm{d}$1');
  def('ex', 'e^{x}', 'e-Funktion', 'insert', 'e^{$1}');
  [['sin', 'Sinus'], ['cos', 'Kosinus'], ['tan', 'Tangens'], ['cot', 'Kotangens'], ['arcsin', 'Arkussinus'], ['arccos', 'Arkuskosinus'],
    ['arctan', 'Arkustangens'], ['ln', 'Natürlicher Logarithmus'], ['log', 'Logarithmus'], ['exp', 'Exponentialfunktion']].forEach(([n, t]) => {
    def(n, '\\' + n, t, 'wrap', '\\' + n + '\\left($S\\right)');
  });
  def('logb', '\\log_{b}', 'Logarithmus zur Basis b', 'wrap', '\\log_{$1}\\left($S\\right)');
  // Zeichen
  for (let d = 0; d <= 9; d++) def('d' + d, String(d), 'Ziffer ' + d, 'insert', String(d));
  def('comma', ',', 'Dezimalkomma', 'insert', '{,}');
  def('plus', '+', 'Plus', 'insert', '+');
  def('minus', '-', 'Minus', 'insert', '-');
  def('cdot', '\\cdot', 'Mal (Punkt)', 'insert', '\\cdot');
  def('times', '\\times', 'Mal (Kreuz)', 'insert', '\\times');
  def('div', '\\div', 'Geteilt', 'insert', '\\div');
  def('colon', '\\mathbin{:}', 'Geteilt (Doppelpunkt)', 'insert', '\\mathbin{:}');
  def('pm', '\\pm', 'Plus-Minus', 'insert', '\\pm');
  def('mp', '\\mp', 'Minus-Plus', 'insert', '\\mp');
  def('eq', '=', 'Gleich', 'insert', '=');
  def('neq', '\\neq', 'Ungleich', 'insert', '\\neq');
  def('lt', '<', 'Kleiner', 'insert', '<');
  def('gt', '>', 'Größer', 'insert', '>');
  def('le', '\\le', 'Kleiner gleich', 'insert', '\\le');
  def('ge', '\\ge', 'Größer gleich', 'insert', '\\ge');
  def('approx', '\\approx', 'Ungefähr gleich', 'insert', '\\approx');
  def('lpar', '(', 'Klammer auf', 'insert', '(');
  def('rpar', ')', 'Klammer zu', 'insert', ')');
  def('percent', '\\%', 'Prozent', 'insert', '\\%');
  def('degree', '^{\\circ}', 'Grad', 'insert', '^{\\circ}');
  def('sci', '\\cdot 10^{n}', 'Zehnerpotenz', 'insert', '\\cdot 10^{$1}');
  def('half', '\\tfrac12', 'Bruch 1/2', 'insert', '\\frac{1}{2}');
  def('equiv', '\\equiv', 'Äquivalent / kongruent', 'insert', '\\equiv');
  def('Rightarrow', '\\Rightarrow', 'Daraus folgt', 'insert', '\\Rightarrow');
  def('Leftrightarrow', '\\Leftrightarrow', 'Genau dann, wenn', 'insert', '\\Leftrightarrow');
  def('in', '\\in', 'Element von', 'insert', '\\in');
  def('notin', '\\notin', 'Nicht Element von', 'insert', '\\notin');
  def('subset', '\\subset', 'Teilmenge', 'insert', '\\subset');
  def('subseteq', '\\subseteq', 'Teilmenge oder gleich', 'insert', '\\subseteq');
  def('cup', '\\cup', 'Vereinigung', 'insert', '\\cup');
  def('cap', '\\cap', 'Schnitt', 'insert', '\\cap');
  def('setminus', '\\setminus', 'Mengendifferenz', 'insert', '\\setminus');
  def('emptyset', '\\emptyset', 'Leere Menge', 'insert', '\\emptyset');
  [['R', 'Reelle Zahlen'], ['N', 'Natürliche Zahlen'], ['Z', 'Ganze Zahlen'], ['Q', 'Rationale Zahlen'], ['C', 'Komplexe Zahlen']].forEach(([n, t]) => {
    def(n + 'set', '\\mathbb{' + n + '}', t, 'insert', '\\mathbb{' + n + '}');
  });
  def('forall', '\\forall', 'Für alle', 'insert', '\\forall');
  def('exists', '\\exists', 'Es existiert', 'insert', '\\exists');
  def('neg', '\\neg', 'Nicht', 'insert', '\\neg');
  def('land', '\\land', 'Und', 'insert', '\\land');
  def('lor', '\\lor', 'Oder', 'insert', '\\lor');
  def('infty', '\\infty', 'Unendlich', 'insert', '\\infty');
  def('nabla', '\\nabla', 'Nabla', 'insert', '\\nabla');
  def('dots', '\\ldots', 'Punkte unten', 'insert', '\\ldots');
  def('cdots', '\\cdots', 'Punkte mittig', 'insert', '\\cdots');
  def('vdots', '\\vdots', 'Punkte senkrecht', 'insert', '\\vdots');
  def('ddots', '\\ddots', 'Punkte diagonal', 'insert', '\\ddots');
  const sym = (id, tex, t) => def(id, tex, t, 'insert', tex);
  const GL = [['alpha', 'Alpha'], ['beta', 'Beta'], ['gamma', 'Gamma'], ['delta', 'Delta'], ['epsilon', 'Epsilon'], ['varepsilon', 'Epsilon (Variante)'],
    ['zeta', 'Zeta'], ['eta', 'Eta'], ['theta', 'Theta'], ['vartheta', 'Theta (Variante)'], ['iota', 'Iota'], ['kappa', 'Kappa'], ['lambda', 'Lambda'],
    ['mu', 'My'], ['nu', 'Ny'], ['xi', 'Xi'], ['pi', 'Pi'], ['rho', 'Rho'], ['sigma', 'Sigma'], ['tau', 'Tau'], ['upsilon', 'Ypsilon'], ['phi', 'Phi'],
    ['varphi', 'Phi (Variante)'], ['chi', 'Chi'], ['psi', 'Psi'], ['omega', 'Omega']];
  GL.forEach(([n, t]) => sym(n, '\\' + n, 'Griechisch: ' + t));
  [['Gamma', 'Gamma'], ['Delta', 'Delta'], ['Theta', 'Theta'], ['Lambda', 'Lambda'], ['Xi', 'Xi'], ['Pi', 'Pi'], ['Sigma', 'Sigma'], ['Phi', 'Phi'],
    ['Psi', 'Psi'], ['Omega', 'Omega']].forEach(([n, t]) => sym(n, '\\' + n, 'Griechisch groß: ' + t));
  [['to', 'Pfeil nach rechts'], ['leftarrow', 'Pfeil nach links'], ['leftrightarrow', 'Pfeil in beide Richtungen'], ['Leftarrow', 'Doppelpfeil links'],
    ['mapsto', 'Abbildet auf'], ['longrightarrow', 'Langer Pfeil'], ['uparrow', 'Pfeil hoch'], ['downarrow', 'Pfeil runter'], ['nearrow', 'Pfeil schräg hoch'],
    ['searrow', 'Pfeil schräg runter']].forEach(([n, t]) => sym(n, '\\' + n, t));
  [['sim', 'Ähnlich'], ['propto', 'Proportional zu'], ['ll', 'Viel kleiner'], ['gg', 'Viel größer'], ['perp', 'Senkrecht'], ['parallel', 'Parallel'],
    ['angle', 'Winkel'], ['mid', 'Teilt'], ['partial', 'Partielles d'], ['ell', 'Schreib-l'], ['hbar', 'h quer'], ['Re', 'Realteil'], ['Im', 'Imaginärteil'],
    ['aleph', 'Aleph'], ['prime', 'Strich']].forEach(([n, t]) => sym(n, '\\' + n, t));
  B.partialsym = B.partial; // Alias, wird unter "Sonstiges" genutzt

  const TABS = [
    { id: 'num', name: 'Zahlen', groups: [
      { cap: 'Ziffern', items: ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9', 'd0'] },
      { cap: 'Rechenzeichen', items: ['plus', 'minus', 'cdot', 'times', 'colon', 'pm', 'eq', 'comma', 'lpar', 'rpar'] },
      { cap: 'Vergleich', items: ['lt', 'gt', 'le', 'ge', 'neq', 'approx'] },
      { cap: 'Zahlformen', items: ['half', 'frac', 'percent', 'degree', 'sci', 'sqrt', 'pi', 'infty'] }
    ] },
    { id: 'alg', name: 'Algebra', groups: [
      { cap: 'Bruch & Potenz', items: ['frac', 'sqrt', 'nroot', 'pow', 'sq', 'sub', 'binom', 'fact'] },
      { cap: 'Klammern', items: ['paren', 'brack', 'brace', 'abs', 'norm', 'floor', 'ceil', 'text'] },
      { cap: 'Gleichungen', items: ['eq', 'neq', 'lt', 'gt', 'le', 'ge', 'Rightarrow', 'Leftrightarrow', 'cases', 'pmatrix'] },
      { cap: 'Mengen & Logik', items: ['in', 'notin', 'subset', 'subseteq', 'cup', 'cap', 'setminus', 'emptyset', 'Rset', 'Nset', 'Zset', 'Qset', 'Cset', 'forall', 'exists', 'neg', 'land', 'lor'] }
    ] },
    { id: 'calc', name: 'Analysis / Calculus', groups: [
      { cap: 'Summe & Integral', items: ['sum', 'prod', 'int', 'intu', 'iint', 'oint'] },
      { cap: 'Grenzwert', items: ['lim', 'to', 'infty', 'ex'] },
      { cap: 'Ableitung', items: ['deriv', 'dquot', 'partial', 'fprime', 'nabla', 'dx'] },
      { cap: 'Funktionen', items: ['sin', 'cos', 'tan', 'cot', 'arcsin', 'arccos', 'arctan', 'ln', 'log', 'logb', 'exp'] }
    ] },
    { id: 'sym', name: 'Symbole & Griechische Zeichen', groups: [
      { cap: 'Griechisch klein', items: GL.map((g) => g[0]) },
      { cap: 'Griechisch groß', items: ['Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Phi', 'Psi', 'Omega'] },
      { cap: 'Pfeile', items: ['to', 'leftarrow', 'leftrightarrow', 'Leftarrow', 'Rightarrow', 'Leftrightarrow', 'mapsto', 'longrightarrow', 'uparrow', 'downarrow'] },
      { cap: 'Beziehungen', items: ['sim', 'equiv', 'propto', 'll', 'gg', 'perp', 'parallel', 'angle', 'mid', 'neq'] },
      { cap: 'Akzente', items: ['vec', 'hat', 'bar', 'dotacc', 'tilde', 'overline', 'underline', 'arrowab'] },
      { cap: 'Sonstiges', items: ['partial', 'nabla', 'ell', 'hbar', 'Re', 'Im', 'aleph', 'prime', 'dots', 'cdots', 'vdots', 'ddots'] }
    ] }
  ];

  /* ---------- kleine Helfer ---------- */
  function h(tag, attrs, html) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (k === 'class') e.className = v;
      else if (v === true) e.setAttribute(k, '');
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    if (html != null) e.innerHTML = html;
    return e;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function trimRange(src, a, b) {
    while (a < b && /\s/.test(src[a])) a++;
    while (b > a && /\s/.test(src[b - 1])) b--;
    return { s: a, e: b };
  }

  /* ---------- Editor ---------- */
  function mount(target, options) {
    const host = typeof target === 'string' ? document.querySelector(target) : target;
    if (!host) throw new Error('FormelEditor: Zielelement nicht gefunden');
    host.textContent = '';
    const katex = global.katex;
    if (!katex) {
      host.appendChild(h('p', { class: 'fe-missing' }, 'Der Formeleditor konnte KaTeX nicht laden. Prüfe die Internetverbindung und lade die Seite neu.'));
      return null;
    }
    const o = Object.assign({ value: '', displayMode: true, placeholder: 'Hier erscheint deine Formel', onChange: null, startTab: 'num', transform: true, calculate: false }, options || {});
    const calcOn = !!o.calculate;
    const kopt = Object.assign({}, KOPT, { displayMode: o.displayMode });
    const uid = 'fe' + (++counter);

    const mini = (tex) => {
      try { return katex.renderToString(tex, { throwOnError: false, displayMode: false, strict: 'ignore' }); }
      catch (e) { return '<code>' + esc(tex) + '</code>'; }
    };
    const labelCache = {};
    const label = (id) => labelCache[id] || (labelCache[id] = mini(B[id].l));

    const root = h('div', { class: 'fe' });
    root.innerHTML =
      '<div class="fe-tabs"><div class="fe-tablist" role="tablist" aria-label="Formelzeichen nach Thema"></div>' +
      '<button type="button" class="fe-collapse" aria-expanded="true" aria-controls="' + uid + '-ribbon" title="Ribbon ein- oder ausklappen"><span class="sr">Ribbon ein- oder ausklappen</span>' + ICON.chev + '</button></div>' +
      '<div class="fe-ribbon" id="' + uid + '-ribbon" role="tabpanel"></div>' +
      '<div class="fe-stage"><div class="fe-preview" data-placeholder="' + esc(o.placeholder) + '"></div>' +
      '<div class="fe-result-row" hidden><button type="button" class="fe-result" aria-live="polite"></button></div>' +
      '<div class="fe-error" role="alert" hidden><span class="fe-err-icon" aria-hidden="true">!</span><div class="fe-err-body"><div class="fe-err-title"></div><div class="fe-err-detail"></div><div class="fe-err-actions"></div></div></div></div>' +
      '<div class="fe-blocks"><div class="fe-scope"></div><div class="fe-chips"></div></div>' +
      '<div class="fe-tools">' + (o.transform ? '<button type="button" class="fe-tool primary fe-btn-transform" aria-haspopup="true" aria-expanded="false">' + ICON.swap + '<span class="lbl">Umformen</span>' + ICON.chev + '</button>' : '') +
      (calcOn ? '<span class="fe-calcgrp"><button type="button" class="fe-tool fe-btn-calc" title="Formel oder Auswahl ausrechnen (Strg+Enter)">' + ICON.calc + '<span class="lbl">Rechnen</span></button><button type="button" class="fe-tool fe-btn-calc-caret" aria-haspopup="true" aria-expanded="false" title="Rechenmodus wählen">' + ICON.chev + '<span class="sr">Rechenmodus wählen</span></button></span>' : '') +
      '<button type="button" class="fe-tool fe-btn-undo" title="Rückgängig (Strg+Z)">' + ICON.undo + '<span class="sr">Rückgängig</span></button>' +
      '<button type="button" class="fe-tool fe-btn-redo" title="Wiederholen (Strg+Y)">' + ICON.redo + '<span class="sr">Wiederholen</span></button>' +
      '<button type="button" class="fe-tool fe-btn-next" title="Zur nächsten Lücke □ springen (Tab)">' + ICON.next + '<span class="lbl">Nächste Lücke</span></button>' +
      '<span class="fe-status" role="status"></span><span class="fe-spacer"></span>' +
      '<button type="button" class="fe-tool fe-btn-kbd" aria-pressed="false" title="Bildschirmtastatur im Quelltextfeld ausblenden, wenn du nur mit Ribbon und Blöcken arbeitest">' + ICON.kbd + '<span class="lbl">Tastatur aus</span></button>' +
      '<button type="button" class="fe-tool fe-btn-copy" title="LaTeX-Quelltext kopieren">' + ICON.copy + '<span class="lbl">Kopieren</span></button>' +
      (o.transform ? '<div class="fe-pop" role="dialog" aria-label="Umformungen" hidden></div>' : '') +
      (calcOn ? '<div class="fe-pop fe-cpop" role="menu" aria-label="Rechnen" hidden><button type="button" role="menuitemradio" class="fe-pop-item fe-cmode" data-calc="once"><span class="fe-pop-title"><span>Berechnen</span></span><span class="fe-pop-res">einmalig, verschwindet beim Weiterschreiben</span></button><button type="button" role="menuitemradio" class="fe-pop-item fe-cmode" data-calc="live"><span class="fe-pop-title"><span>Live berechnen</span></span><span class="fe-pop-res">Ergebnis immer aktuell</span></button><button type="button" role="menuitemradio" class="fe-pop-item fe-cmode" data-calc="off"><span class="fe-pop-title"><span>Aus</span></span></button></div>' : '') + '</div>' +
      '<div class="fe-srcwrap"><div class="fe-srchead"><label for="' + uid + '-src">LaTeX-Quelltext</label><span class="fe-hint">Teil antippen · ↑ Auswahl größer, ↓ kleiner · Chips gedrückt halten und ziehen · Tab: nächste Lücke □</span></div>' +
      '<textarea class="fe-src" id="' + uid + '-src" rows="2" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" aria-label="LaTeX-Quelltext"></textarea></div>';
    host.appendChild(root);

    const q = (s) => root.querySelector(s);
    const tablist = q('.fe-tablist'), ribbon = q('.fe-ribbon'), pv = q('.fe-preview'), errBox = q('.fe-error');
    const scopeEl = q('.fe-scope'), chipsEl = q('.fe-chips'), ta = q('.fe-src'), pop = q('.fe-pop:not(.fe-cpop)') || h('div', { hidden: true });
    const cpop = q('.fe-cpop'), btnCalc = q('.fe-btn-calc'), btnCaret = q('.fe-btn-calc-caret'), resRow = q('.fe-result-row'), resBtn = q('.fe-result');
    const statusEl = q('.fe-status');
    const histEl = h('div', { class: 'fe-hist-list', role: 'list', 'aria-label': 'Zuletzt markiert' });
    const btnUndo = q('.fe-btn-undo'), btnRedo = q('.fe-btn-redo'), btnTransform = q('.fe-btn-transform') || h('button', { hidden: true });

    /* Zustand */
    let scopes = [];
    let blocks = [];
    let curSel = null;
    let calcMode = o.calculate === 'live' ? 'live' : 'off'; // 'off' | 'once' | 'live'
    let calcOnce = null, calcShown = null;
    let varMode = 'all';
    let undoStack = [], redoStack = [];
    let snap = null;
    let lastKind = '', lastTypeAt = 0;
    let lastEmitted = null;
    const cache = { src: null, err: null };
    let raf = 0;
    let statusTimer = 0;

    const takeSnap = () => ({ v: ta.value, a: ta.selectionStart, b: ta.selectionEnd, scopes: scopes.map((s) => Object.assign({}, s)) });
    const currentScope = (src) => (scopes.length ? scopes[scopes.length - 1] : { s: 0, e: src.length });
    function toast(msg) {
      statusEl.textContent = msg;
      clearTimeout(statusTimer);
      statusTimer = setTimeout(() => { statusEl.textContent = ''; }, 2600);
    }
    function adjustScopes(list, eds) {
      let cur = list.map((s) => Object.assign({}, s));
      for (const ed of eds) {
        const out = [];
        for (const s of cur) { const r = L.shiftRange(s, ed.x, ed.y, ed.len); if (!r) break; out.push(r); }
        cur = out;
      }
      return cur;
    }
    function emit() {
      if (ta.value !== lastEmitted) {
        lastEmitted = ta.value;
        if (typeof o.onChange === 'function') o.onChange(ta.value);
      }
    }
    function autoGrow() {
      ta.style.height = 'auto';
      ta.style.height = Math.min(Math.max(ta.scrollHeight + 2, 56), 220) + 'px';
    }
    function commit(newSrc, a, b, edits) {
      flushHist();
      undoStack.push(snap);
      if (undoStack.length > 200) undoStack.shift();
      redoStack = [];
      scopes = adjustScopes(scopes, edits || [L.diffEdit(ta.value, newSrc)]);
      ta.value = newSrc;
      ta.setSelectionRange(a, b);
      lastKind = 'cmd';
      snap = takeSnap();
      update();
      emit();
    }
    function restore(s) {
      ta.value = s.v;
      ta.setSelectionRange(s.a, s.b);
      scopes = s.scopes.map((x) => Object.assign({}, x));
      snap = takeSnap();
      lastKind = 'cmd';
      update();
      emit();
    }
    function undo() { if (!undoStack.length) return; redoStack.push(snap); restore(undoStack.pop()); }
    function redo() { if (!redoStack.length) return; undoStack.push(snap); restore(redoStack.pop()); }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (snap) { snap.a = ta.selectionStart; snap.b = ta.selectionEnd; } update(); }); };

    /* ---------- Ribbon ---------- */
    let activeTab = o.startTab;
    TABS.forEach((tab) => {
      const b = h('button', { type: 'button', class: 'fe-tab', role: 'tab', id: uid + '-t-' + tab.id, 'data-tab': tab.id, 'aria-controls': uid + '-ribbon' }, esc(tab.name));
      tablist.appendChild(b);
    });
    /* Ein durchgehendes Band aus allen Abschnitten; die Tabs sind Lesezeichen darauf. */
    TABS.forEach((tab) => {
      const sec = h('div', { class: 'fe-sec', 'data-tab': tab.id });
      tab.groups.forEach((g) => {
        const grp = h('div', { class: 'fe-group', role: 'group', 'aria-label': g.cap });
        const grid = h('div', { class: 'fe-grid' });
        g.items.forEach((id) => {
          const d = B[id];
          grid.appendChild(h('button', { type: 'button', class: 'fe-rb', 'data-id': id, title: d.t, 'aria-label': d.t }, label(id)));
        });
        grp.appendChild(grid);
        grp.appendChild(h('div', { class: 'fe-group-cap' }, esc(g.cap)));
        sec.appendChild(grp);
      });
      ribbon.appendChild(sec);
    });
    let bandLock = 0;
    const secOf = (id) => ribbon.querySelector('.fe-sec[data-tab="' + id + '"]');
    function markTab() {
      const tab = TABS.find((t) => t.id === activeTab) || TABS[0];
      activeTab = tab.id;
      tablist.querySelectorAll('.fe-tab').forEach((b) => {
        const on = b.dataset.tab === tab.id;
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      });
      ribbon.setAttribute('aria-labelledby', uid + '-t-' + tab.id);
    }
    function renderRibbon(instant) {
      markTab();
      const sec = secOf(activeTab);
      if (!sec) return;
      const left = Math.max(0, sec.offsetLeft - 6);
      bandLock = Date.now() + (instant ? 80 : 600);
      if (instant || !ribbon.scrollTo) ribbon.scrollLeft = left;
      else ribbon.scrollTo({ left, behavior: 'smooth' });
    }
    ribbon.addEventListener('scroll', () => {
      if (Date.now() < bandLock) return;
      const secs = Array.from(ribbon.querySelectorAll('.fe-sec'));
      if (!secs.length) return;
      let cur = secs[0];
      const x = ribbon.scrollLeft + 48;
      secs.forEach((sc) => { if (sc.offsetLeft - 6 <= x) cur = sc; });
      if (ribbon.scrollLeft + ribbon.clientWidth >= ribbon.scrollWidth - 2 && ribbon.scrollWidth > ribbon.clientWidth + 2) cur = secs[secs.length - 1];
      if (cur.dataset.tab !== activeTab) { activeTab = cur.dataset.tab; markTab(); }
    }, { passive: true });
    /* Mit der Maus das Band ziehen (Touch scrollt von selbst) */
    let bandDrag = null, bandDragged = false;
    ribbon.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || ribbon.scrollWidth <= ribbon.clientWidth) return;
      bandDrag = { x0: e.clientX, sl: ribbon.scrollLeft, pid: e.pointerId, on: false };
    });
    ribbon.addEventListener('pointermove', (e) => {
      const d = bandDrag; if (!d) return;
      if (!d.on) {
        if (Math.abs(e.clientX - d.x0) < 6) return;
        d.on = true; ribbon.classList.add('is-panning');
        try { ribbon.setPointerCapture(d.pid); } catch (_) { /* ok */ }
      }
      ribbon.scrollLeft = d.sl - (e.clientX - d.x0);
    });
    const bandEnd = () => {
      if (!bandDrag) return;
      if (bandDrag.on) { bandDragged = true; setTimeout(() => { bandDragged = false; }, 0); ribbon.classList.remove('is-panning'); }
      bandDrag = null;
    };
    ribbon.addEventListener('pointerup', bandEnd);
    ribbon.addEventListener('pointercancel', bandEnd);
    ribbon.addEventListener('click', (e) => { if (bandDragged) { e.stopPropagation(); e.preventDefault(); } }, true);
    let tabDrag = null, tabJustDragged = false;
    const tabStart = (x) => {
      const d = tabDrag; if (!d || d.started) return;
      d.started = true;
      d.origLeft = d.b.getBoundingClientRect().left;
      activeTab = d.b.dataset.tab; renderRibbon();
      d.b.classList.add('is-drag');
      try { d.b.setPointerCapture(d.pid); } catch (_) { /* ok */ }
    };
    const tabMove = (x) => {
      const d = tabDrag; if (!d || !d.started) return;
      const b = d.b;
      b.style.transform = '';
      for (let guard = 0; guard < 8; guard++) {
        const prev = b.previousElementSibling, next = b.nextElementSibling;
        const c = (el) => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; };
        if (prev && x < c(prev)) tablist.insertBefore(b, prev);
        else if (next && x > c(next)) tablist.insertBefore(next, b);
        else break;
      }
      const nat = b.getBoundingClientRect().left;
      b.style.transform = 'translateX(' + Math.round((x - d.x0) - (nat - d.origLeft)) + 'px)';
    };
    const tabEnd = () => {
      const d = tabDrag; if (!d) return;
      clearTimeout(d.timer);
      if (d.started) {
        d.b.style.transform = ''; d.b.classList.remove('is-drag');
        Array.from(tablist.children).forEach((t) => { const sc = secOf(t.dataset.tab); if (sc) ribbon.appendChild(sc); });
        renderRibbon(true);
        tabJustDragged = true; setTimeout(() => { tabJustDragged = false; }, 0);
      }
      tabDrag = null;
    };
    tablist.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('.fe-tab');
      if (!b || (e.pointerType === 'mouse' && e.button !== 0)) return;
      tabDrag = { b, pid: e.pointerId, x0: e.clientX, y0: e.clientY, started: false, touch: e.pointerType !== 'mouse', timer: 0 };
      if (tabDrag.touch) tabDrag.timer = setTimeout(() => tabStart(e.clientX), 320);
    });
    tablist.addEventListener('pointermove', (e) => {
      const d = tabDrag; if (!d || e.pointerId !== d.pid) return;
      if (!d.started) {
        const mv = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
        if (d.touch) { if (mv > 10) { clearTimeout(d.timer); tabDrag = null; } return; }
        if (mv > 5) tabStart(e.clientX); else return;
      }
      tabMove(e.clientX);
    });
    tablist.addEventListener('pointerup', tabEnd);
    tablist.addEventListener('pointercancel', tabEnd);
    tablist.addEventListener('touchmove', (e) => { if (tabDrag && tabDrag.started && e.cancelable) e.preventDefault(); }, { passive: false });
    tablist.addEventListener('contextmenu', (e) => { if (tabDrag) e.preventDefault(); });
    tablist.addEventListener('click', (e) => {
      const b = e.target.closest('.fe-tab');
      if (!b || tabJustDragged) return;
      activeTab = b.dataset.tab;
      renderRibbon();
    });
    tablist.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const ids = Array.from(tablist.children).map((x) => x.dataset.tab);
      const i = ids.indexOf(activeTab);
      const n = (i + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length;
      activeTab = ids[n];
      renderRibbon();
      tablist.querySelector('[data-tab="' + activeTab + '"]').focus();
      e.preventDefault();
    });
    q('.fe-collapse').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const collapsed = root.toggleAttribute('data-collapsed');
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      if (!collapsed) renderRibbon(true);
    });
    ribbon.addEventListener('click', (e) => {
      const b = e.target.closest('.fe-rb');
      if (!b) return;
      closePop();
      const d = B[b.dataset.id];
      const r = L.applyTemplate(ta.value, ta.selectionStart, ta.selectionEnd, d);
      commit(r.src, r.a, r.b, [r.edit]);
    });

    // Buttons dürfen den Fokus (und damit die Auswahl) des Quelltexts nicht stehlen
    root.addEventListener('mousedown', (e) => {
      if (e.target.closest('button') && !e.target.closest('input,textarea')) e.preventDefault();
    });

    /* ---------- Rendern ---------- */
    function showError(err, src) {
      const t = L.translateError(err, src);
      errBox.hidden = false;
      q('.fe-err-title').textContent = t.title;
      q('.fe-err-detail').textContent = t.detail;
      const actions = q('.fe-err-actions');
      actions.textContent = '';
      if (t.fix) {
        const f = h('button', { type: 'button', class: 'fe-btn-sm primary' }, esc(t.fix.label));
        f.addEventListener('click', () => commit(t.fix.src, t.fix.src.length, t.fix.src.length));
        actions.appendChild(f);
      }
      if (typeof t.s === 'number' && t.e > t.s) {
        const f = h('button', { type: 'button', class: 'fe-btn-sm' }, 'Stelle zeigen');
        f.addEventListener('click', () => { ta.focus(); ta.setSelectionRange(t.s, t.e); });
        actions.appendChild(f);
      }
    }

    function update() {
      const src = ta.value;
      const a = ta.selectionStart, b = ta.selectionEnd;
      // Bereiche prüfen
      let ok = true;
      scopes = scopes.filter((s, i) => {
        ok = ok && s.s >= 0 && s.e <= src.length && s.s <= s.e && (i === 0 || (s.s >= scopes[i - 1].s && s.e <= scopes[i - 1].e));
        return ok;
      });
      if (cache.src !== src) {
        cache.src = src;
        cache.err = null;
        if (src.trim()) { try { katex.renderToString(src, kopt); } catch (e) { cache.err = e; } }
      }
      curSel = null;
      if (!src.trim()) {
        pv.innerHTML = '';
        pv.classList.remove('is-stale');
        errBox.hidden = true;
      } else if (!cache.err) {
        let sel = b > a ? L.snapRange(src, a, b) : null;
        const draw = (r) => { try { return katex.renderToString(L.markedSource(src, r), kopt); } catch (e) { return null; } };
        let html = draw(sel);
        if (html == null && sel) { sel = null; html = draw(null); }
        if (html == null) {
          try { html = katex.renderToString(L.previewSource(src, null), kopt); } catch (e2) { html = katex.renderToString(src, kopt); }
        }
        curSel = sel;
        pv.innerHTML = html;
        pv.classList.remove('is-stale');
        errBox.hidden = true;
        if (a === b) drawCaret(a);
      } else {
        pv.classList.add('is-stale');
        showError(cache.err, src);
      }
      noteSelection(curSel ? src.slice(curSel.s, curSel.e) : null);
      renderCalc(src);
      renderBlocks(src, a, b);
      btnUndo.disabled = !undoStack.length;
      btnRedo.disabled = !redoStack.length;
      autoGrow();
    }

    /* ---------- Zuletzt markiert (Schlange) ---------- */
    const hist = [];
    let pendingSel = null, histTimer = 0;
    // Zeigt nur, was nicht schon als Block oder Auswahl sichtbar ist
    function renderHist() {
      histEl.textContent = '';
      const shown = new Set();
      blocks.forEach((bl) => { shown.add(bl.text); if (bl.body) shown.add(bl.body); });
      if (curSel) shown.add(ta.value.slice(curSel.s, curSel.e).trim());
      hist.forEach((tex, i) => {
        if (shown.has(tex)) return;
        histEl.appendChild(h('button', { type: 'button', class: 'fe-hchip', role: 'listitem', 'data-i': i, title: 'Antippen: einfügen. Gedrückt halten und ziehen: an eine Stelle setzen. ' + tex, 'aria-label': 'Zuletzt markiertes Teil einfügen: ' + tex }, mini(tex)));
      });
      histEl.scrollLeft = 0;
      return histEl.childElementCount;
    }
    // Erst ab zwei Zeichen (zwei Ziffern, Ziffer und Zeichen, Term) lohnt sich das Merken
    function worthKeeping(t) {
      const toks = L.tokenize(t).filter((x) => x.t !== 'ws');
      if (toks[0] && (toks[0].t === 'sup' || toks[0].t === 'sub')) return false;
      try { katex.renderToString(t, { throwOnError: true, strict: 'ignore' }); } catch (_) { return false; }
      return toks.length >= 2 || (toks.length === 1 && toks[0].t === 'num' && toks[0].e - toks[0].s >= 2);
    }
    function pushHist(t) {
      const i = hist.indexOf(t);
      if (i >= 0) hist.splice(i, 1);
      hist.unshift(t);
      if (hist.length > 12) hist.pop();
      renderBlocks(ta.value, ta.selectionStart, ta.selectionEnd);
    }
    function flushHist() {
      clearTimeout(histTimer);
      if (pendingSel) { const t = pendingSel; pendingSel = null; pushHist(t); }
    }
    // Eine Auswahl wird erst übernommen, wenn sie kurz stehen bleibt oder sich etwas ändert.
    function noteSelection(t) {
      t = t && t.trim() && worthKeeping(t.trim()) ? t.trim() : null;
      if (t === pendingSel) return;
      clearTimeout(histTimer);
      if (pendingSel && (!t || !(t.includes(pendingSel) || pendingSel.includes(t)))) flushHist();
      pendingSel = t;
      if (t) histTimer = setTimeout(flushHist, 600);
    }
    histEl.addEventListener('click', (e) => {
      const c = e.target.closest('.fe-hchip');
      if (!c) return;
      closePop();
      const tex = hist[Number(c.dataset.i)];
      if (tex == null) return;
      const r = L.applyTemplate(ta.value, ta.selectionStart, ta.selectionEnd, { id: 'hist', kind: 'insert', tpl: tex.replace(/\$/g, '\\$') });
      commit(r.src, r.b, r.b, [r.edit]);
      ta.focus({ preventScroll: true });
    });

    /* ---------- Blöcke ---------- */
    function renderBlocks(src, a, b) {
      scopeEl.textContent = '';
      chipsEl.textContent = '';
      blocks = [];
      if (!src.trim()) {
        chipsEl.appendChild(h('span', { class: 'fe-empty' }, 'Sobald eine Formel da ist, erscheinen ihre Teile hier als Blöcke.'));
        return;
      }
      if (cache.err) {
        chipsEl.appendChild(h('span', { class: 'fe-empty' }, 'Die Blöcke erscheinen wieder, sobald die Formel gültig ist.'));
        return;
      }
      const sc = currentScope(src);
      blocks = L.blocksOf(src, sc.s, sc.e);
      const sr = trimRange(src, a, b);
      const selIdx = b > a ? blocks.findIndex((bl) => (bl.kind === 'term'
        ? ((sr.s === bl.bodyS && sr.e === bl.bodyE) || (sr.s === bl.s && sr.e === bl.e))
        : (sr.s === bl.s && sr.e === bl.e))) : -1;

      // Ebene
      const crumbs = [{ name: 'Formel' }].concat(scopes.map((s) => ({ name: s.label })));
      if (scopes.length) scopeEl.appendChild(h('span', { class: 'fe-scope-label' }, 'Ebene'));
      (scopes.length ? crumbs : []).forEach((c, d) => {
        if (d) scopeEl.appendChild(h('span', { class: 'fe-crumb-sep', 'aria-hidden': 'true' }, '›'));
        const last = d === crumbs.length - 1;
        const btn = h('button', { type: 'button', class: 'fe-crumb', 'data-depth': d, 'aria-current': last ? 'location' : false }, esc(c.name));
        if (last) btn.disabled = true;
        scopeEl.appendChild(btn);
      });
      if (selIdx >= 0 && blocks[selIdx].kind === 'term') {
        const kids = L.blockKids(blocks[selIdx]);
        if (kids.length) {
          const wrap = h('span', { class: 'fe-drill' }, '<span class="fe-drill-label">Hinein in</span>');
          kids.forEach((k, n) => {
            const kb = h('button', { type: 'button', class: 'fe-dk', 'data-k': n, title: 'Diesen Teil als eigene Ebene bearbeiten' },
              '<span class="fe-dk-name">' + esc(k.label) + '</span><span class="fe-dk-math">' + mini(src.slice(k.s, k.e)) + '</span>');
            wrap.appendChild(kb);
          });
          scopeEl.appendChild(wrap);
          wrap._kids = kids;
          scopeEl._drill = kids;
        }
      }
      if (!blocks.length) {
        chipsEl.appendChild(h('span', { class: 'fe-empty' }, 'Auf dieser Ebene ist nichts zu sehen.'));
        return;
      }
      blocks.forEach((bl, i) => {
        const fixed = bl.kind === 'fixed';
        const chip = h('div', { class: 'fe-chip' + (fixed ? ' is-fixed' : ''), 'data-i': i });
        if (i === selIdx) chip.setAttribute('data-selected', '');
        chip.appendChild(h('button', { type: 'button', class: 'fe-chip-main', 'aria-pressed': i === selIdx ? 'true' : 'false', 'aria-label': 'Block auswählen: ' + bl.text }, mini(bl.text)));
        if (i === selIdx && !fixed) {
          const mv = h('span', { class: 'fe-mv' });
          const l = h('button', { type: 'button', class: 'fe-mvb', 'data-dir': '-1', title: 'Nach links schieben', 'aria-label': 'Nach links schieben' }, '‹');
          const r = h('button', { type: 'button', class: 'fe-mvb', 'data-dir': '1', title: 'Nach rechts schieben', 'aria-label': 'Nach rechts schieben' }, '›');
          mv.appendChild(l); mv.appendChild(r);
          chip.appendChild(mv);
        }
        chipsEl.appendChild(chip);
      });
      if (renderHist()) chipsEl.appendChild(histEl);
      renderSelCluster(src, a, b, selIdx);
    }

    function selectBlock(i) {
      const bl = blocks[i];
      if (!bl) return;
      const rng = bl.kind === 'term' ? { s: bl.bodyS, e: bl.bodyE } : { s: bl.s, e: bl.e };
      const sr = trimRange(ta.value, ta.selectionStart, ta.selectionEnd);
      if (sr.s === rng.s && sr.e === rng.e) ta.setSelectionRange(rng.e, rng.e);
      else ta.setSelectionRange(rng.s, rng.e);
      update();
    }
    function doReorder(i, gap) {
      const sc = currentScope(ta.value);
      const r = L.reorderBlocks(ta.value, sc, blocks, i, gap);
      if (!r) return;
      const len = blocks[i].body.length;
      commit(r.src, r.select.e - len, r.select.e, [r.edit]);
    }
    const gapPos = (gap) => (gap < blocks.length ? blocks[gap].s : (blocks.length ? blocks[blocks.length - 1].e : currentScope(ta.value).e));
    function moveRange(a, b, pos) {
      const r = L.moveText(ta.value, a, b, pos);
      if (r) commit(r.src, r.select.s, r.select.e);
    }
    function insertAt(tex, pos) {
      const r = L.applyTemplate(ta.value, pos, pos, { id: 'hist', kind: 'insert', tpl: tex.replace(/\$/g, '\\$') });
      commit(r.src, r.b, r.b, [r.edit]);
    }
    function doReplaceVar(tex) {
      if (!curSel) { toast('Die Auswahl ist unvollständig. Prüfe die Klammern.'); return; }
      const src = ta.value;
      const r = L.replaceVariable(src, tex, src.slice(curSel.s, curSel.e), varMode);
      if (!r) { toast('Nichts zu ersetzen.'); return; }
      commit(r.src, r.first.s, r.first.e);
      toast(r.count === 1 ? '1 Stelle ersetzt' : r.count + ' Stellen ersetzt');
    }

    scopeEl.addEventListener('click', (e) => {
      const c = e.target.closest('.fe-crumb');
      if (c) { scopes = scopes.slice(0, Number(c.dataset.depth)); const p = ta.selectionStart; ta.setSelectionRange(p, p); update(); return; }
      const k = e.target.closest('.fe-dk');
      if (k && scopeEl._drill) {
        const kid = scopeEl._drill[Number(k.dataset.k)];
        scopes.push({ s: kid.s, e: kid.e, label: kid.label });
        ta.setSelectionRange(kid.s, kid.s);
        update();
      }
    });
    chipsEl.addEventListener('click', (e) => {
      if (e.target.closest('.fe-sel-up')) { growSelection(); return; }
      if (e.target.closest('.fe-sel-dn')) { shrinkSelection(); return; }
      if (e.target.closest('.fe-sel-x')) { const p = ta.selectionEnd; ta.setSelectionRange(p, p); update(); return; }
      const v = e.target.closest('.fe-var');
      if (v) { doReplaceVar(v.dataset.tex); return; }
      const m = e.target.closest('.fe-seg-b');
      if (m) { varMode = m.dataset.mode; update(); return; }
      const chip = e.target.closest('.fe-chip');
      if (!chip) return;
      const i = Number(chip.dataset.i);
      const mv = e.target.closest('.fe-mvb');
      if (mv) { const d = Number(mv.dataset.dir); doReorder(i, d < 0 ? i - 1 : i + 2); return; }
      if (e.target.closest('.fe-chip-main')) selectBlock(i);
    });

    /* Auswahl: sitzt am Ende der Blockzeile. Ist die Auswahl selbst ein Block, ist dieser eingefärbt. */
    function renderSelCluster(src, a, b, selIdx) {
      const sr = trimRange(src, a, b);
      const text = curSel ? src.slice(curSel.s, curSel.e) : src.slice(sr.s, sr.e);
      if (!text) return;
      const cl = h('span', { class: 'fe-selcl' });
      if (selIdx < 0) {
        const chip = h('span', { class: 'fe-selchip' });
        chip.appendChild(h('span', { class: 'fe-sel-math', title: 'Auswahl. Gedrückt halten und ziehen: verschieben oder Variable ersetzen' }, mini(text)));
        cl.appendChild(chip);
      }
      cl.appendChild(h('button', { type: 'button', class: 'fe-sel-up', title: 'Auswahl vergrößern (Pfeil hoch)', 'aria-label': 'Auswahl vergrößern' }, '↑'));
      cl.appendChild(h('button', { type: 'button', class: 'fe-sel-dn', title: 'Auswahl verkleinern (Pfeil runter)', 'aria-label': 'Auswahl verkleinern' }, '↓'));
      cl.appendChild(h('button', { type: 'button', class: 'fe-sel-x', title: 'Auswahl aufheben', 'aria-label': 'Auswahl aufheben' }, '×'));
      const vars = L.variablesOf(src);
      if (vars.length) {
        cl.appendChild(h('span', { class: 'fe-selrow-label' }, 'ersetzt'));
        const vw = h('span', { class: 'fe-vars' });
        vars.forEach((v) => {
          vw.appendChild(h('button', { type: 'button', class: 'fe-var', 'data-tex': v, title: 'Alle Vorkommen von ' + v + ' durch die Auswahl ersetzen, oder die Auswahl hierher ziehen', 'aria-label': 'Variable ' + v + ' ersetzen' }, mini(v)));
        });
        cl.appendChild(vw);
        const seg = h('span', { class: 'fe-seg', role: 'group', 'aria-label': 'Wie viele Stellen ersetzen' });
        [['all', 'alle'], ['first', 'erste']].forEach(([m, t]) => {
          seg.appendChild(h('button', { type: 'button', class: 'fe-seg-b', 'data-mode': m, 'aria-pressed': varMode === m ? 'true' : 'false' }, t));
        });
        cl.appendChild(seg);
      }
      chipsEl.appendChild(cl);
    }

    /* ---------- Formelteile und Lücken in der Vorschau antippen ---------- */
    const parseP = (n) => {
      const m = /^(\d+)-(\d+)$/.exec(n.getAttribute('data-p') || '');
      return m ? { s: Number(m[1]), e: Number(m[2]) } : null;
    };
    const formulaBox = () => { const base = pv.querySelector('.katex-html .base'); return base ? base.getBoundingClientRect() : null; };
    // Treffer: ein Formelteil (Mitte) oder eine Lücke (Rand eines Teils, Zwischenraum, vor/hinter der Formel)
    function hitAt(x, y) {
      // Rechteck-Test statt elementFromPoint: Wurzelzeichen und Bruchstriche liegen als Grafik über den Zeichen
      let n = null, area = Infinity;
      pv.querySelectorAll('[data-p]').forEach((c) => {
        const r = c.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && r.width * r.height < area) { area = r.width * r.height; n = c; }
      });
      if (n) {
        const p = parseP(n);
        if (p) {
          const r = n.getBoundingClientRect(), cs = getComputedStyle(n);
          const pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0;
          if (x < r.left + pl) return { kind: 'gap', s: p.s, e: p.s };
          if (x > r.right - pr) return { kind: 'gap', s: p.e, e: p.e };
          return { kind: 'leaf', s: p.s, e: p.e, el: n };
        }
      }
      const fb = formulaBox();
      if (!fb) return null;
      const len = ta.value.length;
      if (y >= fb.top - 16 && y <= fb.bottom + 16) {
        if (x < fb.left) return { kind: 'gap', s: 0, e: 0 };
        if (x > fb.right) return { kind: 'gap', s: len, e: len };
      }
      let best = null, bd = 56;
      pv.querySelectorAll('[data-p]').forEach((c) => {
        const p = parseP(c);
        if (!p) return;
        const r = c.getBoundingClientRect();
        const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
        [[r.left, p.s], [r.right, p.e]].forEach((q) => {
          const d = Math.abs(x - q[0]) + dy * 1.5;
          if (d < bd) { bd = d; best = q[1]; }
        });
      });
      return best == null ? null : { kind: 'gap', s: best, e: best };
    }
    // Auswahl so lange vergrößern, bis sie als Gruppe darstellbar ist
    function validRange(r) {
      const src = ta.value;
      for (let g = 0; r && g < 12; g++) {
        try { katex.renderToString(L.markedSource(src, r), kopt); return r; } catch (_) { r = L.expandRange(src, r.s, r.e); }
      }
      return null;
    }
    function selectInSource(r) {
      if (!r) return;
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(r.s, r.e);
      update();
    }
    const growStack = [];
    function growSelection() {
      const src = ta.value;
      const a = ta.selectionStart, b = ta.selectionEnd;
      const cur = b > a ? (curSel || trimRange(src, a, b)) : { s: a, e: a };
      const r = validRange(L.expandRange(src, cur.s, cur.e));
      if (!r) return;
      growStack.push({ from: { s: a, e: b }, to: { s: r.s, e: r.e } });
      if (growStack.length > 30) growStack.shift();
      selectInSource(r);
    }
    function shrinkSelection() {
      const src = ta.value;
      const a = ta.selectionStart, b = ta.selectionEnd;
      if (b <= a) return;
      const cur = curSel || trimRange(src, a, b);
      const top = growStack[growStack.length - 1];
      if (top && top.to.s === cur.s && top.to.e === cur.e) { growStack.pop(); selectInSource(top.from); return; }
      growStack.length = 0;
      let r = L.shrinkRange(src, cur.s, cur.e);
      for (let g = 0; r && g < 12; g++) {
        const v = L.snapRange(src, r.s, r.e);
        if (v) { try { katex.renderToString(L.markedSource(src, v), kopt); selectInSource(v); return; } catch (_) { /* nächster Versuch */ } }
        r = L.shrinkRange(src, r.s, r.e);
      }
      selectInSource({ s: cur.e, e: cur.e });
    }
    // Position eines Quelltext-Indexes in der Vorschau: Cursor und Ablage-Markierung
    function geomAt(p) {
      const fb = formulaBox();
      if (!fb) return null;
      const src = ta.value;
      const leaves = Array.from(pv.querySelectorAll('[data-p]')).map((n) => ({ n, p: parseP(n) })).filter((o) => o.p);
      const at = (o, side) => { const r = o.n.getBoundingClientRect(); return { x: side === 'l' ? r.left : r.right, top: r.top, ht: r.height }; };
      if (!src.slice(0, p).trim()) return { x: fb.left, top: fb.top, ht: fb.height };
      if (!src.slice(p).trim()) return { x: fb.right, top: fb.top, ht: fb.height };
      let o = leaves.find((l) => l.p.s === p);
      if (o) return at(o, 'l');
      o = leaves.find((l) => l.p.e === p);
      if (o) return at(o, 'r');
      let prev = null, next = null;
      leaves.forEach((l) => {
        if (l.p.e <= p && (!prev || l.p.e >= prev.p.e)) prev = l;
        if (l.p.s >= p && (!next || l.p.s < next.p.s)) next = l;
      });
      return prev ? at(prev, 'r') : next ? at(next, 'l') : null;
    }
    function drawBar(p, cls) {
      const old = pv.querySelector('.' + cls);
      if (old) old.remove();
      const g = geomAt(p);
      if (!g) return;
      const pr = pv.getBoundingClientRect();
      const ch = Math.max(g.ht + 4, 22);
      const el = h('span', { class: cls, 'aria-hidden': 'true' });
      el.style.left = (g.x - pr.left + pv.scrollLeft - 1) + 'px';
      el.style.top = (g.top + g.ht / 2 - ch / 2 - pr.top + pv.scrollTop) + 'px';
      el.style.height = ch + 'px';
      pv.appendChild(el);
    }
    function drawCaret(p) {
      const old = pv.querySelector('.fe-caret');
      if (old) old.remove();
      if (document.activeElement !== ta || cache.err) return;
      drawBar(p, 'fe-caret');
    }
    let pdrag = null;
    pv.addEventListener('mousedown', (e) => e.preventDefault());
    pv.addEventListener('pointerdown', (e) => {
      if ((e.button !== undefined && e.button !== 0) || cache.err) return;
      const hit = hitAt(e.clientX, e.clientY);
      if (!hit) return;
      e.preventDefault();
      closePop();
      const a = ta.selectionStart, b = ta.selectionEnd;
      pdrag = { anchor: hit, cur: b > a ? trimRange(ta.value, a, b) : null, moved: false, last: '', pid: e.pointerId };
      try { pv.setPointerCapture(e.pointerId); } catch (_) { /* nicht kritisch */ }
    });
    pv.addEventListener('pointermove', (e) => {
      if (!pdrag || pdrag.pid !== e.pointerId) return;
      const hit = hitAt(e.clientX, e.clientY);
      if (!hit) return;
      const an = pdrag.anchor;
      if (!pdrag.moved && hit.s === an.s && hit.e === an.e) return;
      pdrag.moved = true;
      const s = Math.min(an.s, hit.s), t = Math.max(an.e, hit.e);
      if (pdrag.last === s + '-' + t) return;
      pdrag.last = s + '-' + t;
      if (s === t) { selectInSource({ s, e: s }); return; }
      selectInSource(validRange(L.snapRange(ta.value, s, t)));
    });
    pv.addEventListener('pointerup', (e) => {
      if (!pdrag || pdrag.pid !== e.pointerId) return;
      const d = pdrag;
      pdrag = null;
      try { pv.releasePointerCapture(e.pointerId); } catch (_) { /* nicht kritisch */ }
      if (d.moved) return;
      const an = d.anchor;
      if (an.kind === 'gap') { selectInSource({ s: an.s, e: an.s }); return; }
      const exact = d.cur && d.cur.s === an.s && d.cur.e === an.e;
      if (exact) growSelection();
      else selectInSource(validRange(L.snapRange(ta.value, an.s, an.e)));
    });
    pv.addEventListener('pointercancel', () => { pdrag = null; });
    ta.addEventListener('blur', () => { const c = pv.querySelector('.fe-caret'); if (c) c.remove(); });

    /* ---------- Ziehen: Maus sofort, Touch nach langem Drücken ---------- */
    let suppressClick = false;
    chipsEl.addEventListener('click', (e) => { if (suppressClick) { suppressClick = false; e.stopPropagation(); e.preventDefault(); } }, true);
    chipsEl.addEventListener('contextmenu', (e) => { if (e.target.closest('.fe-chip, .fe-selchip, .fe-hchip')) e.preventDefault(); });

    function armDrag(ev, kind, index, chipEl) {
      const pid = ev.pointerId;
      const sx = ev.clientX, sy = ev.clientY;
      const touch = ev.pointerType !== 'mouse';
      const canVar = kind === 'sel' || chipEl.hasAttribute('data-selected');
      let active = false, ghost = null, drop = null, line = null, timer = 0, lx = sx, ly = sy;
      const clearMarks = () => {
        if (line) { line.remove(); line = null; }
        root.querySelectorAll('.fe-var.is-drop').forEach((n) => n.classList.remove('is-drop'));
        pv.querySelectorAll('.fe-target').forEach((n) => n.classList.remove('fe-target'));
        const m = pv.querySelector('.fe-dropmark');
        if (m) m.remove();
      };
      const blockScroll = (e) => { if (active) e.preventDefault(); };
      function gapAt(x, y) {
        let best = null, bd = 1e9;
        for (const el of chipsEl.querySelectorAll('.fe-chip')) {
          const r = el.getBoundingClientRect();
          const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
          const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
          const d = Math.hypot(dx, dy * 1.6);
          if (d < bd) { bd = d; best = { el, r }; }
        }
        if (!best || bd > 70) return null;
        const after = x > best.r.left + best.r.width / 2;
        return { gap: Number(best.el.dataset.i) + (after ? 1 : 0), r: best.r, after };
      }
      function place(x, y) {
        ghost.style.transform = touch ? 'translate(' + (x - 24) + 'px,' + (y - 64) + 'px)' : 'translate(' + (x + 10) + 'px,' + (y + 10) + 'px)';
      }
      function track(x, y) {
        place(x, y);
        clearMarks();
        drop = null;
        if (canVar) {
          const el = document.elementFromPoint(x, y);
          const v = el && el.closest ? el.closest('.fe-var') : null;
          if (v && root.contains(v)) {
            v.classList.add('is-drop');
            drop = { type: 'var', tex: v.dataset.tex };
            const src = ta.value;
            let first = true;
            pv.querySelectorAll('[data-p]').forEach((n) => {
              const q = parseP(n);
              if (q && src.slice(q.s, q.e) === v.dataset.tex && (varMode !== 'first' || first)) { n.classList.add('fe-target'); first = false; }
            });
          }
        }
        if (!drop) {
          const pr = pv.getBoundingClientRect();
          if (x >= pr.left - 6 && x <= pr.right + 6 && y >= pr.top - 6 && y <= pr.bottom + 6) {
            const hit = hitAt(x, y);
            if (hit) {
              let pos = hit.s;
              if (hit.kind === 'leaf') { const r = hit.el.getBoundingClientRect(); pos = x < r.left + r.width / 2 ? hit.s : hit.e; }
              drop = { type: 'pos', pos };
              drawBar(pos, 'fe-dropmark');
            }
          }
        }
        if (!drop) {
          const g = gapAt(x, y);
          if (g) {
            drop = { type: 'gap', gap: g.gap };
            line = h('span', { class: 'fe-drop', 'aria-hidden': 'true' });
            const cr = chipsEl.getBoundingClientRect();
            line.style.left = (g.after ? g.r.right : g.r.left) - cr.left - 3 + 'px';
            line.style.top = g.r.top - cr.top + 'px';
            line.style.height = g.r.height + 'px';
            chipsEl.appendChild(line);
            drawBar(gapPos(g.gap), 'fe-dropmark');
          }
        }
      }
      function activate() {
        active = true;
        clearTimeout(timer);
        closePop();
        ghost = chipEl.cloneNode(true);
        ghost.classList.add('fe-ghost');
        ghost.removeAttribute('data-i');
        root.appendChild(ghost);
        chipEl.classList.add('is-dragging');
        root.classList.add('is-dragging');
        if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_) { /* nicht kritisch */ } }
        document.addEventListener('touchmove', blockScroll, { passive: false });
        track(lx, ly);
      }
      function move(e) {
        if (e.pointerId !== pid) return;
        lx = e.clientX; ly = e.clientY;
        if (!active) {
          const d = Math.hypot(lx - sx, ly - sy);
          if (touch) { if (d > 10) finish(true); return; }   // Bewegung vor dem langen Drücken: Seite scrollen lassen
          if (d < 6) return;
          activate();
          return;
        }
        track(lx, ly);
      }
      function finish(cancelled) {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', cancel);
        document.removeEventListener('touchmove', blockScroll);
        clearTimeout(timer);
        if (ghost) ghost.remove();
        clearMarks();
        chipEl.classList.remove('is-dragging');
        root.classList.remove('is-dragging');
        if (active) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 60); }
        if (cancelled || !active || !drop) return;
        if (drop.type === 'var') { doReplaceVar(drop.tex); return; }
        const pos = drop.type === 'pos' ? drop.pos : gapPos(drop.gap);
        if (kind === 'block') {
          if (drop.type === 'gap') doReorder(index, drop.gap);
          else if (blocks[index]) moveRange(blocks[index].s, blocks[index].e, pos);
        } else if (kind === 'sel') {
          if (curSel) moveRange(curSel.s, curSel.e, pos);
        } else if (hist[index] != null) insertAt(hist[index], pos);
      }
      function up(e) { if (e.pointerId === pid) finish(false); }
      function cancel(e) { if (e.pointerId === pid) finish(true); }
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', cancel);
      if (touch) timer = setTimeout(activate, 380);
    }
    chipsEl.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target.closest('.fe-mvb, .fe-sel-up, .fe-sel-dn, .fe-sel-x, .fe-var, .fe-seg-b')) return;
      const hc = e.target.closest('.fe-hchip');
      const sc = e.target.closest('.fe-selchip');
      const bc = e.target.closest('.fe-chip');
      if (hc) armDrag(e, 'hist', Number(hc.dataset.i), hc);
      else if (sc) armDrag(e, 'sel', 0, sc);
      else if (bc && !bc.classList.contains('is-fixed')) armDrag(e, 'block', Number(bc.dataset.i), bc);
    });

    /* ---------- Rechnen ---------- */
    const calcScope = (src) => (curSel ? { s: curSel.s, e: curSel.e, sel: true } : { s: 0, e: src.length, sel: false });
    function computeNow(src) {
      const sc = calcScope(src);
      return { src, s: sc.s, e: sc.e, sel: sc.sel, r: L.calc(src.slice(sc.s, sc.e)) };
    }
    function renderCalc(src) {
      if (!calcOn) return;
      let st = null;
      if (calcOnce && calcOnce.src !== src) calcOnce = null;
      if (cache.err || !src.trim()) st = null;
      else if (calcOnce) st = calcOnce;
      else if (calcMode === 'live') {
        const c = computeNow(src);
        if (c.r.ok ? !c.r.trivial : (!c.r.soft && c.r.kind !== 'empty')) st = c;
      }
      calcShown = st;
      btnCalc.classList.toggle('is-live', calcMode === 'live');
      btnCalc.classList.toggle('is-on', calcMode === 'live' || !!calcOnce);
      btnCalc.title = calcMode === 'live' ? 'Live-Berechnung ausschalten' : 'Formel oder Auswahl ausrechnen (Strg+Enter)';
      if (!st) { resRow.hidden = true; resBtn.innerHTML = ''; return; }
      const r = st.r;
      resRow.hidden = false;
      resBtn.className = 'fe-result' + (st.sel ? ' is-sel' : '') + (!r.ok ? (r.soft ? ' is-soft' : ' is-err') : r.kind === 'check' ? (r.truth ? ' is-yes' : ' is-no') : '');
      const insertable = r.ok && r.ins != null;
      resBtn.disabled = !insertable;
      resBtn.title = !r.ok ? (st.sel ? 'Auswahl: ' : '') + r.msg : insertable ? (st.sel ? 'Auswahl durch das Ergebnis ersetzen' : 'Ergebnis hinter die Formel schreiben') : (st.sel ? 'Ergebnis der Auswahl' : 'Ergebnis');
      resBtn.innerHTML = r.ok ? mini(r.tex) : '<span class="fe-result-msg">' + esc(r.msg) + '</span>';
    }
    function closeCpop() {
      if (!cpop || cpop.hidden) return;
      cpop.hidden = true;
      btnCaret.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', cOutside, true);
      document.removeEventListener('keydown', cEsc, true);
    }
    const cOutside = (e) => { if (!cpop.contains(e.target) && !btnCaret.contains(e.target) && !btnCalc.contains(e.target)) closeCpop(); };
    const cEsc = (e) => { if (e.key === 'Escape') { closeCpop(); btnCaret.focus(); } };
    function setCalcMode(m) {
      if (m === 'once') { calcMode = 'once'; calcOnce = computeNow(ta.value); }
      else { calcMode = m; calcOnce = null; }
      renderCalc(ta.value);
    }
    if (calcOn) {
      btnCalc.addEventListener('click', () => { closeCpop(); closePop(); setCalcMode(calcMode === 'live' ? 'off' : 'once'); });
      btnCaret.addEventListener('click', () => {
        if (!cpop.hidden) { closeCpop(); return; }
        closePop();
        cpop.querySelectorAll('.fe-cmode').forEach((b) => {
          const on = b.dataset.calc === calcMode;
          b.setAttribute('aria-checked', on ? 'true' : 'false');
          b.classList.toggle('is-checked', on);
        });
        cpop.hidden = false;
        btnCaret.setAttribute('aria-expanded', 'true');
        document.addEventListener('pointerdown', cOutside, true);
        document.addEventListener('keydown', cEsc, true);
      });
      cpop.addEventListener('click', (e) => {
        const b = e.target.closest('[data-calc]');
        if (!b) return;
        closeCpop();
        setCalcMode(b.dataset.calc);
      });
      resBtn.addEventListener('click', () => {
        const st = calcShown;
        if (!st || !st.r.ok || st.r.ins == null) return;
        const src = ta.value;
        let ins = st.r.ins;
        if (st.sel) {
          if (st.r.wrap && /^\s*[\^_!]/.test(src.slice(st.e))) ins = '(' + ins + ')';
          const out = src.slice(0, st.s) + ins + src.slice(st.e);
          commit(out, st.s, st.s + ins.length);
        } else {
          const t = src.replace(/\s+$/, '');
          const out = /=$/.test(t) ? t + ' ' + ins : t + ' = ' + ins;
          calcOnce = null;
          commit(out, out.length, out.length);
        }
      });
      root.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); setCalcMode('once'); }
      });
    }

    /* ---------- Umformen ---------- */
    function closePop() {
      if (pop.hidden) return;
      pop.hidden = true;
      btnTransform.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escClose, true);
    }
    const outside = (e) => { if (!pop.contains(e.target) && !btnTransform.contains(e.target)) closePop(); };
    const escClose = (e) => { if (e.key === 'Escape') { closePop(); btnTransform.focus(); } };
    function openPop() {
      closeCpop();
      const src = ta.value;
      pop.textContent = '';
      const items = cache.err || !src.trim() ? [] : L.transformations(src, curSel);
      const eq = !cache.err && src.trim() && L.analyzeEquation(src);
      if (!items.length && !eq) {
        pop.appendChild(h('p', { class: 'fe-pop-empty' }, cache.err || !src.trim()
          ? 'Sobald die Formel gültig ist, erscheinen hier passende Umformungen.'
          : 'Für diese Formel fallen mir keine Umformungen ein. Schreibe eine Gleichung oder markiere einen Teil.'));
      }
      let lastGroup = '';
      const list = h('div', { class: 'fe-pop-list' });
      items.forEach((it, n) => {
        if (it.group !== lastGroup) { list.appendChild(h('div', { class: 'fe-pop-group' }, esc(it.group))); lastGroup = it.group; }
        const btn = h('button', { type: 'button', class: 'fe-pop-item', 'data-n': n },
          '<span class="fe-pop-title">' + (it.tex ? '<span class="fe-pop-tex">' + mini(it.tex) + '</span>' : '') + '<span>' + esc(it.title) + '</span></span>' +
          '<span class="fe-pop-res">' + mini(it.src) + '</span>');
        list.appendChild(btn);
      });
      pop.appendChild(list);
      if (eq) {
        const foot = h('div', { class: 'fe-pop-foot' },
          '<span class="fe-pop-foot-label">Auf beiden Seiten</span>' +
          '<input type="text" class="fe-pop-input" id="' + uid + '-both" placeholder="Zahl oder Term" aria-label="Wert für beide Seiten" autocapitalize="off" autocomplete="off" spellcheck="false">' +
          '<button type="button" class="fe-btn-sm" data-op="+" title="Auf beiden Seiten addieren">+</button>' +
          '<button type="button" class="fe-btn-sm" data-op="-" title="Auf beiden Seiten subtrahieren">−</button>' +
          '<button type="button" class="fe-btn-sm" data-op="*" title="Beide Seiten multiplizieren">×</button>' +
          '<button type="button" class="fe-btn-sm" data-op="/" title="Beide Seiten teilen">÷</button>');
        pop.appendChild(foot);
      }
      pop._items = items;
      pop.hidden = false;
      btnTransform.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('keydown', escClose, true);
    }
    if (o.transform) btnTransform.addEventListener('click', () => { if (pop.hidden) openPop(); else closePop(); });
    pop.addEventListener('click', (e) => {
      const it = e.target.closest('.fe-pop-item');
      if (it) {
        const item = pop._items[Number(it.dataset.n)];
        closePop();
        if (item.select) commit(item.src, item.select.s, item.select.e);
        else commit(item.src, item.src.length, item.src.length);
        return;
      }
      const op = e.target.closest('[data-op]');
      if (op) {
        const val = pop.querySelector('.fe-pop-input').value;
        const res = L.bothSides(ta.value, op.dataset.op, val);
        if (!res) return;
        closePop();
        const ph = L.nextPlaceholder(res, 0);
        if (ph && !val.trim()) commit(res, ph.s, ph.e); else commit(res, res.length, res.length);
      }
    });
    pop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('.fe-pop-input')) { e.preventDefault(); pop.querySelector('[data-op="+"]').click(); }
    });

    /* ---------- Werkzeugleiste ---------- */
    btnUndo.addEventListener('click', undo);
    btnRedo.addEventListener('click', redo);
    function jumpPlaceholder() {
      const p = L.nextPlaceholder(ta.value, ta.selectionEnd);
      if (!p) { toast('Keine Lücke □ mehr vorhanden'); return false; }
      ta.setSelectionRange(p.s, p.e);
      update();
      return true;
    }
    q('.fe-btn-next').addEventListener('click', () => { closePop(); jumpPlaceholder(); });
    q('.fe-btn-kbd').addEventListener('click', (e) => {
      const b = e.currentTarget;
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      ta.setAttribute('inputmode', on ? 'none' : 'text');
      b.querySelector('.lbl').textContent = on ? 'Tastatur an' : 'Tastatur aus';
    });
    q('.fe-btn-copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(ta.value);
        toast('LaTeX kopiert');
      } catch (_) {
        ta.focus(); ta.select();
        toast('Alles markiert. Mit Strg+C kopieren.');
      }
    });

    /* ---------- Quelltextfeld ---------- */
    ta.addEventListener('input', () => {
      flushHist();
      const now = Date.now();
      const ed = L.diffEdit(snap.v, ta.value);
      scopes = adjustScopes(scopes, [ed]);
      if (lastKind !== 'type' || now - lastTypeAt > 800) {
        undoStack.push(snap);
        if (undoStack.length > 200) undoStack.shift();
        redoStack = [];
      }
      lastKind = 'type';
      lastTypeAt = now;
      snap = takeSnap();
      closePop();
      update();
      emit();
    });
    ta.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && !e.altKey && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
      if (e.key === 'Tab' && !e.shiftKey && !mod && !e.altKey && /\\square(?![A-Za-z])/.test(ta.value)) {
        if (jumpPlaceholder()) e.preventDefault();
      }
      // Pfeil hoch: Auswahl vergrößern, Pfeil runter: verkleinern (nur in einzeiligem Quelltext, sonst bleibt es die Zeilennavigation)
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !mod && !e.altKey && !e.shiftKey && !cache.err && ta.value.trim() && ta.value.indexOf('\n') < 0) {
        e.preventDefault();
        if (e.key === 'ArrowUp') growSelection(); else shrinkSelection();
      }
    });
    ['keyup', 'pointerup', 'focus', 'select'].forEach((ev) => ta.addEventListener(ev, schedule));
    const onSelChange = () => { if (document.activeElement === ta) schedule(); };
    document.addEventListener('selectionchange', onSelChange);

    /* ---------- Start ---------- */
    ta.value = o.value || '';
    renderRibbon(true);
    snap = takeSnap();
    lastEmitted = ta.value;
    update();

    return {
      el: root,
      getValue: () => ta.value,
      setValue(v) {
        undoStack.push(snap); redoStack = []; scopes = [];
        ta.value = v; ta.setSelectionRange(v.length, v.length);
        snap = takeSnap(); update(); emit();
      },
      focus: () => ta.focus(),
      undo, redo,
      destroy() {
        document.removeEventListener('selectionchange', onSelChange);
        closePop();
        closeCpop();
        host.textContent = '';
      }
    };
  }

  global.FormelEditor = { mount, version: '1.0' };
})(typeof window !== 'undefined' ? window : globalThis);


