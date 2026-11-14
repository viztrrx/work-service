// Ask AI's pure helpers: math (LaTeX → MathML, rendered natively by the
// browser), the blocks an answer is made of (text, code, files the AI
// creates), and reading / writing Office files (a small ZIP reader and
// writer, .docx / .xlsx / .pptx text, .docx and .xlsx output).
//
// No DOM and no network: the same code runs in the console (script.js holds
// a verbatim copy, checked by tests/ai-files.test.mjs) and in Node's tests.

// ---- Math: LaTeX → MathML --------------------------------------------------
const MX_ESC = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// name → [character, element]: 'i' = identifier, 'o' = operator.
const MX_SYM = {
  alpha: ['α', 'i'], beta: ['β', 'i'], gamma: ['γ', 'i'], delta: ['δ', 'i'], epsilon: ['ϵ', 'i'], varepsilon: ['ε', 'i'], zeta: ['ζ', 'i'], eta: ['η', 'i'],
  theta: ['θ', 'i'], vartheta: ['ϑ', 'i'], iota: ['ι', 'i'], kappa: ['κ', 'i'], lambda: ['λ', 'i'], mu: ['μ', 'i'], nu: ['ν', 'i'], xi: ['ξ', 'i'], pi: ['π', 'i'],
  varpi: ['ϖ', 'i'], rho: ['ρ', 'i'], varrho: ['ϱ', 'i'], sigma: ['σ', 'i'], varsigma: ['ς', 'i'], tau: ['τ', 'i'], upsilon: ['υ', 'i'], phi: ['ϕ', 'i'],
  varphi: ['φ', 'i'], chi: ['χ', 'i'], psi: ['ψ', 'i'], omega: ['ω', 'i'],
  Gamma: ['Γ', 'i'], Delta: ['Δ', 'i'], Theta: ['Θ', 'i'], Lambda: ['Λ', 'i'], Xi: ['Ξ', 'i'], Pi: ['Π', 'i'], Sigma: ['Σ', 'i'], Upsilon: ['Υ', 'i'],
  Phi: ['Φ', 'i'], Psi: ['Ψ', 'i'], Omega: ['Ω', 'i'],
  infty: ['∞', 'i'], partial: ['∂', 'i'], nabla: ['∇', 'i'], emptyset: ['∅', 'i'], varnothing: ['∅', 'i'], ell: ['ℓ', 'i'], hbar: ['ℏ', 'i'],
  aleph: ['ℵ', 'i'], Re: ['ℜ', 'i'], Im: ['ℑ', 'i'], triangle: ['△', 'i'], angle: ['∠', 'o'], measuredangle: ['∡', 'o'], degree: ['°', 'o'], circ: ['∘', 'o'],
  cdot: ['·', 'o'], times: ['×', 'o'], div: ['÷', 'o'], pm: ['±', 'o'], mp: ['∓', 'o'], ast: ['∗', 'o'], star: ['⋆', 'o'], bullet: ['∙', 'o'], oplus: ['⊕', 'o'], otimes: ['⊗', 'o'],
  le: ['≤', 'o'], leq: ['≤', 'o'], ge: ['≥', 'o'], geq: ['≥', 'o'], ne: ['≠', 'o'], neq: ['≠', 'o'], approx: ['≈', 'o'], equiv: ['≡', 'o'], cong: ['≅', 'o'],
  sim: ['∼', 'o'], simeq: ['≃', 'o'], propto: ['∝', 'o'], ll: ['≪', 'o'], gg: ['≫', 'o'], lt: ['<', 'o'], gt: ['>', 'o'],
  to: ['→', 'o'], rightarrow: ['→', 'o'], leftarrow: ['←', 'o'], gets: ['←', 'o'], leftrightarrow: ['↔', 'o'], Rightarrow: ['⇒', 'o'], Leftarrow: ['⇐', 'o'],
  Leftrightarrow: ['⇔', 'o'], implies: ['⟹', 'o'], iff: ['⟺', 'o'], mapsto: ['↦', 'o'], uparrow: ['↑', 'o'], downarrow: ['↓', 'o'], longrightarrow: ['⟶', 'o'],
  in: ['∈', 'o'], notin: ['∉', 'o'], ni: ['∋', 'o'], subset: ['⊂', 'o'], subseteq: ['⊆', 'o'], supset: ['⊃', 'o'], supseteq: ['⊇', 'o'], cup: ['∪', 'o'], cap: ['∩', 'o'],
  setminus: ['∖', 'o'], forall: ['∀', 'o'], exists: ['∃', 'o'], nexists: ['∄', 'o'], neg: ['¬', 'o'], lnot: ['¬', 'o'], land: ['∧', 'o'], wedge: ['∧', 'o'],
  lor: ['∨', 'o'], vee: ['∨', 'o'], perp: ['⊥', 'o'], parallel: ['∥', 'o'], mid: ['∣', 'o'], nmid: ['∤', 'o'], therefore: ['∴', 'o'], because: ['∵', 'o'],
  ldots: ['…', 'o'], cdots: ['⋯', 'o'], vdots: ['⋮', 'o'], ddots: ['⋱', 'o'], dots: ['…', 'o'], prime: ['′', 'o'],
  langle: ['⟨', 'o'], rangle: ['⟩', 'o'], lceil: ['⌈', 'o'], rceil: ['⌉', 'o'], lfloor: ['⌊', 'o'], rfloor: ['⌋', 'o'], vert: ['|', 'o'], Vert: ['‖', 'o'],
  '{': ['{', 'o'], '}': ['}', 'o'], '|': ['‖', 'o'], '%': ['%', 'o'], '$': ['$', 'o'], '&': ['&', 'o'], '#': ['#', 'o'], '_': ['_', 'o']
};
const MX_BIG = { sum: '∑', prod: '∏', coprod: '∐', bigcup: '⋃', bigcap: '⋂', int: '∫', iint: '∬', iiint: '∭', oint: '∮' };
const MX_FN = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'log', 'ln', 'lg', 'exp', 'det', 'gcd', 'deg', 'dim', 'arg', 'ker', 'hom', 'Pr']);
const MX_LIM = new Set(['lim', 'max', 'min', 'sup', 'inf', 'liminf', 'limsup', 'argmax', 'argmin']);
const MX_ACCENT = { hat: '^', widehat: '^', bar: '‾', overline: '‾', vec: '→', overrightarrow: '→', dot: '˙', ddot: '¨', tilde: '~', widetilde: '~' };
const MX_SPACE = { ',': '0.17em', ':': '0.22em', '>': '0.22em', ';': '0.28em', ' ': '0.28em', quad: '1em', qquad: '2em', '!': '0', enspace: '0.5em' };
const MX_BB = { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', P: 'ℙ', H: 'ℍ' };
const MX_OPS = '+-=<>,;:!/|()[]*\'.?';
const MX_ENVS = { matrix: ['', ''], pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['{', '}'], vmatrix: ['|', '|'], Vmatrix: ['‖', '‖'], cases: ['{', ''], array: ['', ''],
  aligned: ['', ''], align: ['', ''], 'align*': ['', ''], gathered: ['', ''], split: ['', ''], eqnarray: ['', ''], smallmatrix: ['', ''] };

function latexToMathML(tex, display) {
  const s = String(tex || '').slice(0, 6000);
  let i = 0, depth = 0;
  const node = (xml, kind) => ({ xml, kind: kind || '' });
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const readName = () => {
    if (i < s.length && /[A-Za-z]/.test(s[i])) { let n = ''; while (i < s.length && /[A-Za-z]/.test(s[i])) n += s[i++]; if (s[i] === '*') { n += '*'; i++; } return n; }
    return i < s.length ? s[i++] : '';
  };
  // A brace group as raw text (for \text{…}, \begin{…}).
  const readRaw = () => {
    ws();
    if (s[i] !== '{') { const c = s[i] || ''; i++; return c; }
    let d = 0, out = '';
    for (; i < s.length; i++) {
      const c = s[i];
      if (c === '\\' && i + 1 < s.length) { out += c + s[++i]; continue; }
      if (c === '{') { if (d++ === 0) continue; }
      else if (c === '}') { if (--d === 0) { i++; break; } }
      out += c;
    }
    return out;
  };
  const row = (nodes) => (nodes.length === 1 ? nodes[0].xml : '<mrow>' + nodes.map((n) => n.xml).join('') + '</mrow>');
  const fenceMo = (c) => (c && c !== '.' ? '<mo fence="true" stretchy="true">' + MX_ESC(c) + '</mo>' : '');
  // A delimiter after \left, \right, \big…
  const delim = () => {
    ws();
    if (s[i] === '\\') { i++; const n = readName(); return n === '{' ? '{' : n === '}' ? '}' : n === '|' ? '‖' : (MX_SYM[n] ? MX_SYM[n][0] : n === '.' ? '.' : ''); }
    return s[i++] || '';
  };
  // stop(): true at a terminator for the current list (left in place).
  function parseList(stop) {
    if (++depth > 60) { depth--; return [node('<mtext>…</mtext>')]; }
    const out = [];
    while (i < s.length) {
      ws();
      if (i >= s.length || stop()) break;
      const c = s[i];
      if (c === '^' || c === '_') {
        i++;
        const base = out.pop() || node('<mrow></mrow>');
        let sub = null, sup = null;
        if (c === '_') sub = atom(); else sup = atom();
        ws();
        if (s[i] === '^' && !sup) { i++; sup = atom(); } else if (s[i] === '_' && !sub) { i++; sub = atom(); }
        const b = base.xml, under = base.kind === 'big' || base.kind === 'lim';
        const tag = under ? (sub && sup ? 'munderover' : sub ? 'munder' : 'mover') : (sub && sup ? 'msubsup' : sub ? 'msub' : 'msup');
        out.push(node('<' + tag + '>' + b + (sub ? sub.xml : '') + (sup ? sup.xml : '') + '</' + tag + '>'));
        continue;
      }
      const n = atom();
      if (n) out.push(n);
    }
    depth--;
    return out;
  }
  function group(term) { const nodes = parseList(() => s[i] === term); if (s[i] === term) i++; return node(row(nodes)); }
  function atom() {
    ws();
    if (i >= s.length) return node('<mrow></mrow>');
    const c = s[i];
    if (c === '{') { i++; return group('}'); }
    if (c === '\\') { i++; return command(readName()); }
    if (/[0-9]/.test(c)) { let n = ''; while (i < s.length && /[0-9.]/.test(s[i])) n += s[i++]; return node('<mn>' + n + '</mn>'); }
    i++;
    if (/[A-Za-z]/.test(c)) return node('<mi>' + c + '</mi>');
    if (c === '}') return null;
    if (c === '~') return node('<mspace width="0.28em"></mspace>');
    if (c === "'") return node('<mo>′</mo>');
    if (c === '&') return null;
    if (MX_OPS.includes(c)) return node('<mo>' + MX_ESC(c) + '</mo>');
    return node('<mi>' + MX_ESC(c) + '</mi>');
  }
  function env(name) {
    if (name === 'array') readRaw();
    const [l, r] = MX_ENVS[name] || ['', ''];
    const rows = [];
    let cells = [];
    const atEnd = () => s.startsWith('\\end', i);
    for (;;) {
      const nodes = parseList(() => s[i] === '&' || s.startsWith('\\\\', i) || atEnd());
      cells.push('<mtd>' + row(nodes) + '</mtd>');
      if (s[i] === '&') { i++; continue; }
      if (s.startsWith('\\\\', i)) { i += 2; ws(); if (s[i] === '[') { while (i < s.length && s[i] !== ']') i++; i++; } rows.push(cells); cells = []; if (atEnd()) break; continue; }
      if (cells.length > 1 || cells[0] !== '<mtd><mrow></mrow></mtd>') rows.push(cells);
      break;
    }
    if (atEnd()) { i += 4; readRaw(); }
    const align = /^(aligned|align\*?|split|eqnarray)$/.test(name) ? ' columnalign="right left right left"' : name === 'cases' ? ' columnalign="left left"' : '';
    const table = '<mtable' + align + '>' + rows.filter((x) => x.length).map((x) => '<mtr>' + x.join('') + '</mtr>').join('') + '</mtable>';
    return node('<mrow>' + fenceMo(l) + table + fenceMo(r) + '</mrow>');
  }
  function command(name) {
    if (MX_SPACE[name] !== undefined) return node('<mspace width="' + MX_SPACE[name] + '"></mspace>');
    if (name === '\\') return node('<mspace linebreak="newline"></mspace>');
    if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac') {
      const a = atom(), b = atom();
      const f = '<mfrac>' + a.xml + b.xml + '</mfrac>';
      return node(name === 'dfrac' || name === 'cfrac' ? '<mstyle displaystyle="true">' + f + '</mstyle>' : f);
    }
    if (name === 'binom' || name === 'dbinom' || name === 'tbinom') { const a = atom(), b = atom(); return node('<mrow><mo>(</mo><mfrac linethickness="0">' + a.xml + b.xml + '</mfrac><mo>)</mo></mrow>'); }
    if (name === 'sqrt') {
      ws();
      if (s[i] === '[') { i++; const idx = parseList(() => s[i] === ']'); i++; const a = atom(); return node('<mroot>' + a.xml + row(idx) + '</mroot>'); }
      return node('<msqrt>' + atom().xml + '</msqrt>');
    }
    if (/^(text|textrm|textnormal|mbox|mathrm|textit|textbf|mathbf|mathit|mathsf|texttt|mathtt|operatorname|mathcal|mathscr|mathfrak|boldsymbol|bm|mathbb)$/.test(name)) {
      const raw = readRaw();
      if (name === 'mathbb') return node('<mi>' + MX_ESC(raw.split('').map((ch) => MX_BB[ch] || ch).join('')) + '</mi>');
      if (name === 'operatorname') return node('<mi>' + MX_ESC(raw) + '</mi><mo>&#x2061;</mo>');
      const bold = /bf|boldsymbol|bm/.test(name);
      if (/^(text|textrm|textnormal|mbox|textit|textbf|texttt)$/.test(name)) return node('<mtext' + (bold ? ' style="font-weight:bold"' : '') + '>' + MX_ESC(raw.replace(/\\([{}%$&#_ ])/g, '$1')) + '</mtext>');
      // \mathbf{x} etc.: the letters as math, styled.
      return node('<mrow' + (bold ? ' style="font-weight:bold"' : '') + '>' + raw.split('').map((ch) => (/[A-Za-z]/.test(ch) ? '<mi mathvariant="normal">' + ch + '</mi>' : /\d/.test(ch) ? '<mn>' + ch + '</mn>' : /\s/.test(ch) ? '' : '<mo>' + MX_ESC(ch) + '</mo>')).join('') + '</mrow>');
    }
    if (name === 'left' || name === 'right' || /^(big|Big|bigg|Bigg)[lrm]?$/.test(name)) { const d = delim(); return d === '.' ? null : node('<mo fence="true" stretchy="' + (name === 'left' || name === 'right' ? 'true' : 'false') + '">' + MX_ESC(d) + '</mo>'); }
    if (name === 'begin') { const e = readRaw(); return env(e); }
    if (name === 'end') { readRaw(); return null; }
    if (MX_ACCENT[name]) { const a = atom(); return node('<mover accent="true">' + a.xml + '<mo stretchy="' + (/wide|over/.test(name) ? 'true' : 'false') + '">' + MX_ACCENT[name] + '</mo></mover>'); }
    if (name === 'underline') return node('<munder accentunder="true">' + atom().xml + '<mo stretchy="true">_</mo></munder>');
    if (name === 'overbrace' || name === 'underbrace') { const a = atom(); return node(name === 'overbrace' ? '<mover>' + a.xml + '<mo stretchy="true">⏞</mo></mover>' : '<munder>' + a.xml + '<mo stretchy="true">⏟</mo></munder>', 'lim'); }
    if (name === 'boxed' || name === 'fbox') return node('<mrow style="border:1px solid currentColor;padding:2px 4px">' + atom().xml + '</mrow>');
    if (name === 'cancel' || name === 'bcancel' || name === 'xcancel') return node('<mrow style="text-decoration:line-through">' + atom().xml + '</mrow>');
    if (name === 'color' || name === 'textcolor') { readRaw(); return name === 'textcolor' ? atom() : null; }
    if (name === 'pmod') { const a = atom(); return node('<mrow><mspace width="0.4em"></mspace><mo>(</mo><mi>mod</mi><mspace width="0.28em"></mspace>' + a.xml + '<mo>)</mo></mrow>'); }
    if (name === 'not') { const a = atom(); return node('<mrow style="text-decoration:line-through">' + a.xml + '</mrow>'); }
    if (/^(displaystyle|textstyle|scriptstyle|limits|nolimits|nonumber|notag|label|tag|qquad|hfill|middle|phantom)$/.test(name)) { if (/label|tag|phantom/.test(name)) readRaw(); return null; }
    if (MX_BIG[name]) return node('<mo' + (/int$/.test(name) ? ' largeop="true"' : ' movablelimits="true" largeop="true"') + '>' + MX_BIG[name] + '</mo>', /int$/.test(name) ? '' : 'big');
    if (MX_LIM.has(name)) return node('<mi>' + name + '</mi>', 'lim');
    if (MX_FN.has(name)) return node('<mrow><mi>' + name + '</mi><mo>&#x2061;</mo></mrow>');
    if (name === 'mod' || name === 'bmod') return node('<mo lspace="0.28em" rspace="0.28em">mod</mo>');
    if (MX_SYM[name]) { const [ch, t] = MX_SYM[name]; return node(t === 'i' ? '<mi>' + MX_ESC(ch) + '</mi>' : '<mo>' + MX_ESC(ch) + '</mo>'); }
    return node('<mtext>' + MX_ESC('\\' + name) + '</mtext>');
  }
  const nodes = parseList(() => false);
  return '<math xmlns="http://www.w3.org/1998/Math/MathML"' + (display ? ' display="block"' : '') + '>' + row(nodes.length ? nodes : [node('<mrow></mrow>')]) + '</math>';
}

// Text → [{ t: 'text', v } | { t: 'math', v, display }]. Delimiters: \( \),
// \[ \], $$ $$, and $…$ when it looks like math (not "$5 and $10").
function splitMath(text) {
  const s = String(text || ''), out = [];
  let i = 0, buf = '';
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  while (i < s.length) {
    const two = s.slice(i, i + 2);
    let open = '', close = '', display = false;
    if (two === '\\(') { open = '\\('; close = '\\)'; }
    else if (two === '\\[') { open = '\\['; close = '\\]'; display = true; }
    else if (two === '$$') { open = '$$'; close = '$$'; display = true; }
    else if (s[i] === '$' && s[i - 1] !== '\\') { open = '$'; close = '$'; }
    if (open) {
      const start = i + open.length;
      let end = s.indexOf(close, start);
      if (open === '$') {
        while (end > -1 && s[end - 1] === '\\') end = s.indexOf('$', end + 1);
        const inner = end > -1 ? s.slice(start, end) : '';
        if (end === -1 || !inner || /^\s|\s$/.test(inner) || /\n\n/.test(inner) || /[0-9]/.test(s[end + 1] || '')) { buf += s[i]; i++; continue; }
      }
      if (end > -1) { flush(); out.push({ t: 'math', v: s.slice(start, end), display }); i = end + close.length; continue; }
    }
    buf += s[i]; i++;
  }
  flush();
  return out;
}

// LaTeX → plain Unicode text (for Word files and copying): \frac{a}{b} → (a)/(b), x^2 → x², \sqrt{x} → √(x).
const MX_SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ' };
const MX_SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎' };
function texToUnicode(tex) {
  let t = String(tex || '');
  const arg = '\\{((?:[^{}]|\\{[^{}]*\\})*)\\}';
  for (let k = 0; k < 4; k++) {
    t = t.replace(new RegExp('\\\\[dt]?frac\\s*' + arg + '\\s*' + arg, 'g'), (m, a, b, off, str) => {
      const f = (/^\w+$/.test(a) ? a : '(' + a + ')') + '/' + (/^\w+$/.test(b) ? b : '(' + b + ')');
      return /^[\w(\\]/.test(str.slice(off + m.length)) ? '(' + f + ')' : f;   // ½bh would read as 1/(2bh)
    });
    t = t.replace(new RegExp('\\\\sqrt\\s*\\[([^\\]]*)\\]\\s*' + arg, 'g'), (m, n, a) => (n === '3' ? '∛' : n === '4' ? '∜' : n + '√') + (/^\w+$/.test(a) ? a : '(' + a + ')'));
    t = t.replace(new RegExp('\\\\sqrt\\s*' + arg, 'g'), (m, a) => '√' + (/^\w+$/.test(a) ? a : '(' + a + ')'));
    t = t.replace(new RegExp('\\\\(?:text|mathrm|textrm|textbf|mathbf|operatorname|mbox)\\s*' + arg, 'g'), '$1');
  }
  t = t.replace(/\\left|\\right|\\big|\\Big|\\displaystyle/g, '');
  t = t.replace(/\\([A-Za-z]+)/g, (m, n) => (MX_SYM[n] ? MX_SYM[n][0] : MX_BIG[n] || (MX_FN.has(n) || MX_LIM.has(n) ? n + ' ' : MX_SPACE[n] !== undefined ? ' ' : m)));
  const script = (map) => (m, a) => (a.split('').every((ch) => map[ch]) ? a.split('').map((ch) => map[ch]).join('') : null);
  t = t.replace(/\^\{([^{}]*)\}|\^(\w)/g, (m, a, b) => script(MX_SUP)(m, a || b) || '^(' + (a || b) + ')');
  t = t.replace(/_\{([^{}]*)\}|_(\w)/g, (m, a, b) => script(MX_SUB)(m, a || b) || '_(' + (a || b) + ')');
  return t.replace(/\\[,;:! ]/g, ' ').replace(/[{}]/g, '').replace(/\\\\/g, '; ').replace(/\s{2,}/g, ' ').trim();
}

// ---- The blocks of an answer -------------------------------------------------
// ```file name="study-guide.docx"   → a file the AI made (closed by ```)
// ```python                         → code
// everything else                   → text. An unclosed block (still
// streaming) comes back with done: false.
function parseBlocks(text) {
  const lines = String(text || '').split('\n'), out = [];
  let cur = null, buf = [];
  const flushText = () => { if (buf.length) { out.push({ t: 'text', v: buf.join('\n') }); buf = []; } };
  for (const line of lines) {
    if (!cur) {
      const m = /^\s*```\s*([A-Za-z0-9_+.#-]*)\s*(.*)$/.exec(line);
      if (m) {
        flushText();
        const file = /^file$/i.test(m[1]) || /^file:/i.test(m[1] + m[2]);
        let name = '';
        if (file) { const n = /name\s*=\s*"([^"]+)"|name\s*=\s*'([^']+)'|name\s*=\s*(\S+)|file:\s*(\S+)/i.exec(m[1] + m[2]); name = n ? (n[1] || n[2] || n[3] || n[4]) : 'file.txt'; }
        cur = file ? { t: 'file', name: safeFileName(name), lines: [] } : { t: 'code', lang: m[1].toLowerCase(), lines: [] };
        continue;
      }
      buf.push(line);
    } else if (/^\s*```\s*$/.test(line)) {
      out.push(cur.t === 'file' ? { t: 'file', name: cur.name, v: cur.lines.join('\n'), done: true } : { t: 'code', lang: cur.lang, v: cur.lines.join('\n'), done: true });
      cur = null;
    } else cur.lines.push(line);
  }
  flushText();
  if (cur) out.push(cur.t === 'file' ? { t: 'file', name: cur.name, v: cur.lines.join('\n'), done: false } : { t: 'code', lang: cur.lang, v: cur.lines.join('\n'), done: false });
  return out;
}
function safeFileName(n) {
  const base = String(n || '').split(/[\\/]/).pop().replace(/[^\w.\- ()]/g, '_').replace(/^\.+/, '').slice(0, 80).trim();
  return base && /\.[A-Za-z0-9]{1,8}$/.test(base) ? base : (base || 'file') + '.txt';
}

// ---- ZIP (store-only writer, reader with deflate) -------------------------------
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xffffffff; for (let k = 0; k < bytes.length; k++) c = CRC_TABLE[(c ^ bytes[k]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const utf8 = (str) => new TextEncoder().encode(str);
// entries: [{ name, data: string | Uint8Array }] → Uint8Array (a .zip)
function zipStore(entries) {
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = utf8(e.name), data = typeof e.data === 'string' ? utf8(e.data) : e.data, crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, 0, true); local.setUint16(12, 0x21, true); local.setUint32(14, crc, true); local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
    cd.setUint16(12, 0, true); cd.setUint16(14, 0x21, true); cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true); cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}
// .zip bytes → Map(name → async () => Uint8Array). Deflate via DecompressionStream.
function zipEntries(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let k = b.length - 22; k >= Math.max(0, b.length - 66000); k--) if (dv.getUint32(k, true) === 0x06054b50) { eocd = k; break; }
  if (eocd < 0) throw new Error('not a zip file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const map = new Map(), dec = new TextDecoder();
  for (let n = 0; n < count && p + 46 <= b.length; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    map.set(name, async () => {
      const ln = dv.getUint16(lho + 26, true), lx = dv.getUint16(lho + 28, true);
      const data = b.subarray(lho + 30 + ln + lx, lho + 30 + ln + lx + csize);
      if (method === 0) return data;
      if (method !== 8) throw new Error('unsupported compression');
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    });
  }
  return map;
}
const xmlText = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

// The text of a .docx / .xlsx / .pptx (bytes) → string, or null when it isn't one.
async function officeText(bytes, name) {
  let z;
  try { z = zipEntries(bytes); } catch (e) { return null; }
  const read = async (n) => (z.has(n) ? new TextDecoder().decode(await z.get(n)()) : '');
  const ext = String(name || '').toLowerCase().split('.').pop();
  if (z.has('word/document.xml') || ext === 'docx') {
    const xml = await read('word/document.xml');
    let out = '';
    for (const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>|<\/w:p>/g)) out += m[1] !== undefined ? xmlText(m[1]) : m[0] === '<w:tab/>' ? '\t' : '\n';
    return out.replace(/\n{3,}/g, '\n\n').trim();
  }
  if (z.has('ppt/presentation.xml') || ext === 'pptx') {
    const slides = [...z.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
    const out = [];
    for (const n of slides) {
      const xml = await read(n);
      let t = '';
      for (const m of xml.matchAll(/<a:t>([^<]*)<\/a:t>|<\/a:p>/g)) t += m[1] !== undefined ? xmlText(m[1]) : '\n';
      out.push('Slide ' + n.match(/\d+/)[0] + ':\n' + t.trim());
    }
    return out.join('\n\n');
  }
  if (z.has('xl/workbook.xml') || ext === 'xlsx') {
    const shared = [];
    for (const m of (await read('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push([...m[1].matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((x) => xmlText(x[1])).join(''));
    const names = [...(await read('xl/workbook.xml')).matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => xmlText(m[1]));
    const sheets = [...z.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
    const out = [];
    for (let k = 0; k < sheets.length; k++) {
      const xml = await read(sheets[k]);
      const rows = [];
      for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells = [];
        for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const attrs = c[1], inner = c[2] || '', type = (/\bt="([^"]+)"/.exec(attrs) || [])[1];
          const v = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
          let val = type === 's' ? shared[+v] || '' : type === 'inlineStr' ? [...inner.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((x) => xmlText(x[1])).join('') : type === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : xmlText(v || '');
          const ref = (/\br="([A-Z]+)\d+"/.exec(attrs) || [])[1];
          if (ref) { const col = ref.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1; while (cells.length < col) cells.push(''); }
          cells.push(/[",\n]/.test(val) ? '"' + val.replace(/"/g, '""') + '"' : val);
        }
        rows.push(cells.join(','));
      }
      out.push('Sheet "' + (names[k] || 'Sheet' + (k + 1)) + '":\n' + rows.join('\n'));
    }
    return out.join('\n\n');
  }
  return null;
}

// Plain text (with "# Heading", "- bullet", **bold**, LaTeX math) → a .docx (bytes).
function makeDocx(text) {
  const runs = (line, extra) => {
    const parts = [];
    String(line).split(/(\*\*[^*]+\*\*)/).forEach((seg) => {
      if (!seg) return;
      const bold = /^\*\*[^*]+\*\*$/.test(seg);
      const plain = splitMath(bold ? seg.slice(2, -2) : seg).map((x) => (x.t === 'math' ? texToUnicode(x.v) : x.v)).join('');
      parts.push('<w:r><w:rPr>' + (bold || extra.bold ? '<w:b/>' : '') + (extra.size ? '<w:sz w:val="' + extra.size + '"/>' : '') + '</w:rPr><w:t xml:space="preserve">' + xmlEsc(plain) + '</w:t></w:r>');
    });
    return parts.join('');
  };
  const paras = String(text || '').replace(/\r/g, '').split('\n').map((line) => {
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) return '<w:p><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>' + runs(h[2], { bold: true, size: [0, 36, 30, 26][h[1].length] }) + '</w:p>';
    const b = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (b) return '<w:p><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>' + runs('•\t' + b[1], {}) + '</w:p>';
    return '<w:p>' + (line ? runs(line, {}) : '') + '</w:p>';
  }).join('');
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  return zipStore([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: 'word/document.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + W + '><w:body>' + paras + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>' }
  ]);
}
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const s = String(text || '').replace(/\r\n?/g, '\n');
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (q) { if (c === '"') { if (s[k + 1] === '"') { cell += '"'; k++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
// CSV text → a .xlsx (bytes): numbers stay numbers.
function makeXlsx(csv) {
  const col = (n) => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const rows = parseCsv(csv).map((r, ri) => '<row r="' + (ri + 1) + '">' + r.map((v, ci) => {
    const ref = col(ci) + (ri + 1), t = v.trim();
    return /^-?\d+(\.\d+)?$/.test(t) && t.length < 16 ? '<c r="' + ref + '"><v>' + t + '</v></c>' : '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>';
  }).join('') + '</row>').join('');
  const S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"', R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  return zipStore([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ' + S + ' ' + R + '><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ' + S + '><sheetData>' + rows + '</sheetData></worksheet>' }
  ]);
}
// A file block → { bytes, type } ready to download.
const AI_FILE_TYPES = { txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript',
  py: 'text/x-python', java: 'text/x-java', c: 'text/x-c', cpp: 'text/x-c++', tex: 'application/x-tex', svg: 'image/svg+xml', xml: 'application/xml', rtf: 'application/rtf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
function makeFile(name, content) {
  const ext = String(name).toLowerCase().split('.').pop();
  if (ext === 'docx') return { bytes: makeDocx(content), type: AI_FILE_TYPES.docx };
  if (ext === 'xlsx') return { bytes: makeXlsx(content), type: AI_FILE_TYPES.xlsx };
  return { bytes: utf8(String(content || '') + (/\n$/.test(content) ? '' : '\n')), type: (AI_FILE_TYPES[ext] || 'text/plain') + '; charset=utf-8' };
}
// ---- end of the copied block ----

export { latexToMathML, splitMath, texToUnicode, parseBlocks, safeFileName, crc32, zipStore, zipEntries, officeText, makeDocx, makeXlsx, parseCsv, makeFile };
