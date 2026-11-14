// Ask AI's math and file helpers (web/ai-files.js and its copy in script.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { latexToMathML, splitMath, texToUnicode, parseBlocks, safeFileName, crc32, zipStore, zipEntries, officeText, makeDocx, makeXlsx, parseCsv, makeFile } from '../web/ai-files.js';

const fixture = (n) => new Uint8Array(fs.readFileSync(new URL('./fixtures/office/' + n, import.meta.url)));
let python = true;
try { execFileSync('python3', ['-c', 'import zipfile, xml.etree.ElementTree']); } catch (e) { python = false; }
// Python (a different XML parser) checks that every string is well-formed XML.
function wellFormed(xmls) {
  if (!python) return xmls.map(() => true);
  const out = execFileSync('python3', ['-c', 'import sys,json,xml.etree.ElementTree as E\nr=[]\nfor x in json.load(sys.stdin):\n  try:\n    E.fromstring(x); r.append(True)\n  except Exception as e: r.append(str(e))\nprint(json.dumps(r))'], { input: JSON.stringify(xmls) });
  return JSON.parse(String(out));
}
const has = (xml, ...parts) => parts.every((p) => xml.includes(p));

test('math: LaTeX becomes MathML the browser draws itself', () => {
  const cases = {
    '\\frac{a+b}{2}': ['<mfrac>', '<mi>a</mi><mo>+</mo><mi>b</mi>', '<mn>2</mn>'],
    'x^2 + y_1^3': ['<msup><mi>x</mi><mn>2</mn></msup>', '<msubsup><mi>y</mi><mn>1</mn><mn>3</mn></msubsup>'],
    '\\sqrt{2}\\,\\sqrt[3]{x}': ['<msqrt><mn>2</mn></msqrt>', '<mroot><mi>x</mi><mn>3</mn></mroot>', '<mspace width="0.17em">'],
    'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}': ['<mo>±</mo>', '<msqrt><mrow><msup><mi>b</mi><mn>2</mn></msup><mo>-</mo><mn>4</mn><mi>a</mi><mi>c</mi></mrow></msqrt>'],
    '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}': ['<munderover><mo movablelimits="true" largeop="true">∑</mo>'],
    '\\int_0^1 x\\,dx': ['<msubsup><mo largeop="true">∫</mo><mn>0</mn><mn>1</mn></msubsup>'],
    '\\lim_{x \\to 0} \\frac{\\sin x}{x}': ['<munder><mi>lim</mi><mrow><mi>x</mi><mo>→</mo><mn>0</mn></mrow></munder>', '<mi>sin</mi><mo>&#x2061;</mo>'],
    '\\alpha + \\beta \\le \\pi \\cdot r^2': ['<mi>α</mi>', '<mi>β</mi>', '<mo>≤</mo>', '<mi>π</mi>', '<mo>·</mo>'],
    '\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}': ['<mo fence="true" stretchy="true">(</mo><mtable><mtr><mtd><mn>1</mn></mtd><mtd><mn>2</mn></mtd></mtr><mtr><mtd><mn>3</mn></mtd><mtd><mn>4</mn></mtd></mtr></mtable><mo fence="true" stretchy="true">)</mo>'],
    'f(x) = \\begin{cases} x^2 & x \\ge 0 \\\\ -x & x < 0 \\end{cases}': ['<mtable columnalign="left left">', '<mo>&lt;</mo>'],
    '\\left( \\frac{1}{2} \\right)^2': ['<mo fence="true" stretchy="true">(</mo>', '<msup><mo fence="true" stretchy="true">)</mo><mn>2</mn></msup>'],
    '\\text{area} = \\pi r^2 \\text{ cm}^2': ['<mtext>area</mtext>', '<mtext> cm</mtext>'],
    '\\vec{v} \\cdot \\hat{n} = \\overline{AB}': ['<mover accent="true"><mi>v</mi><mo stretchy="false">→</mo></mover>', '<mover accent="true"><mrow><mi>A</mi><mi>B</mi></mrow><mo stretchy="true">‾</mo></mover>'],
    '\\binom{n}{k} \\mathbb{R}^n': ['<mfrac linethickness="0">', '<mi>ℝ</mi>'],
    '45^\\circ \\angle ABC': ['<msup><mn>45</mn><mo>∘</mo></msup>', '<mo>∠</mo>'],
    '3.14 \\times 10^{-3}': ['<mn>3.14</mn><mo>×</mo>', '<msup><mn>10</mn><mrow><mo>-</mo><mn>3</mn></mrow></msup>']
  };
  const xmls = [];
  for (const [tex, parts] of Object.entries(cases)) {
    const xml = latexToMathML(tex, false);
    xmls.push(xml);
    assert.ok(xml.startsWith('<math xmlns="http://www.w3.org/1998/Math/MathML">') && xml.endsWith('</math>'), tex);
    for (const p of parts) assert.ok(xml.includes(p), `${tex}\n  missing ${p}\n  in ${xml}`);
  }
  assert.ok(latexToMathML('x', true).startsWith('<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">'));
  const wf = wellFormed(xmls);
  wf.forEach((ok, k) => assert.equal(ok, true, Object.keys(cases)[k] + ': ' + ok));
});

const TAGS = new Set(['math', 'mrow', 'mi', 'mn', 'mo', 'mtext', 'mspace', 'mfrac', 'msqrt', 'mroot', 'msup', 'msub', 'msubsup', 'munder', 'mover', 'munderover', 'mtable', 'mtr', 'mtd', 'mstyle']);
const ATTRS = new Set(['xmlns', 'display', 'width', 'linebreak', 'fence', 'stretchy', 'movablelimits', 'largeop', 'accent', 'accentunder', 'linethickness', 'columnalign', 'displaystyle', 'mathvariant', 'style', 'lspace', 'rspace']);
test('math: hostile or broken input can’t inject markup, and never throws', () => {
  for (const tex of ['<script>alert(1)</script>', '\\text{<img src=x onerror=alert(1)>}', '"><svg onload=alert(1)>', '\\unknowncmd{x}', '{{{{', '}}}', '\\frac', '^_^', '\\begin{pmatrix} 1 &', '\\left(', '\\sqrt[', '\\\\'.repeat(50), '{'.repeat(500), '&<>"\'']) {
    const xml = latexToMathML(tex);
    // Every tag and attribute is one the converter makes: user text only ever appears escaped.
    const tags = [...xml.matchAll(/<\/?([A-Za-z]+)([^>]*)>/g)];
    for (const [, tag, attrs] of tags) {
      assert.ok(TAGS.has(tag), tex + ': unexpected <' + tag + '> in ' + xml);
      for (const [, a] of attrs.matchAll(/\s([\w:-]+)=/g)) assert.ok(ATTRS.has(a), tex + ': unexpected attribute ' + a + ' in ' + xml);
    }
    assert.equal(wellFormed([xml])[0], true, tex + ' → ' + xml);
  }
  assert.ok(latexToMathML('\\unknowncmd').includes('<mtext>\\unknowncmd</mtext>'), 'unknown commands show as text');
});

test('math: finding the math in an answer ($5 stays money)', () => {
  const kinds = (t) => splitMath(t).map((x) => x.t === 'math' ? (x.display ? 'D:' : 'M:') + x.v : 'T:' + x.v);
  assert.deepEqual(kinds('So \\(x^2\\) and \\[\\frac{1}{2}\\] done'), ['T:So ', 'M:x^2', 'T: and ', 'D:\\frac{1}{2}', 'T: done']);
  assert.deepEqual(kinds('$$a+b$$ then $c$.'), ['D:a+b', 'T: then ', 'M:c', 'T:.']);
  assert.deepEqual(kinds('It costs $5 and $10 today.'), ['T:It costs $5 and $10 today.']);
  assert.deepEqual(kinds('Pay $5.'), ['T:Pay $5.']);
  assert.deepEqual(kinds('Escaped \\$ sign'), ['T:Escaped \\$ sign']);
  assert.deepEqual(kinds('Streaming \\(x^'), ['T:Streaming \\(x^'], 'an unclosed formula stays text until it’s finished');
});

test('math → plain Unicode (for Word files)', () => {
  assert.equal(texToUnicode('x^2 + y^{10} = z_1'), 'x² + y¹⁰ = z₁');
  assert.equal(texToUnicode('\\frac{a+b}{2} \\le \\sqrt{x+1}'), '(a+b)/2 ≤ √(x+1)');
  assert.equal(texToUnicode('\\pi r^2 \\cdot \\theta'), 'π r² · θ');
  assert.equal(texToUnicode('\\sqrt[3]{8} = 2'), '∛8 = 2');
  assert.equal(texToUnicode('A = \\frac{1}{2}bh'), 'A = (1/2)bh', 'a fraction right before letters keeps its brackets');
  assert.equal(texToUnicode('\\sin x + \\text{cm}'), 'sin x + cm');
});

test('answer blocks: text, code, and files the AI makes (also while still streaming)', () => {
  const ans = 'Here you go.\n```file name="study-guide.docx"\n# Cells\n- nucleus\n```\nAnd code:\n```python\nprint(1)\n```\n```file:grades.csv\nName,Score\nAna,93\n```\nDone.';
  const b = parseBlocks(ans);
  assert.deepEqual(b.map((x) => x.t + (x.name ? ':' + x.name : x.lang ? ':' + x.lang : '')), ['text', 'file:study-guide.docx', 'text', 'code:python', 'file:grades.csv', 'text']);
  assert.equal(b[1].v, '# Cells\n- nucleus');
  assert.equal(b[4].v, 'Name,Score\nAna,93');
  const partial = parseBlocks('Making it:\n```file name="notes.md"\n# Title\nline');
  assert.deepEqual([partial[1].t, partial[1].done, partial[1].v], ['file', false, '# Title\nline']);
  assert.equal(safeFileName('../../etc/passwd'), 'passwd.txt');
  assert.equal(safeFileName('my <notes>.md'), 'my _notes_.md');
  assert.equal(safeFileName(''), 'file.txt');
});

test('zip: our files are valid zips (CRC checked by Python’s zipfile too)', async () => {
  assert.equal(crc32(new TextEncoder().encode('The quick brown fox jumps over the lazy dog')), 0x414fa339);
  const z = zipStore([{ name: 'a.txt', data: 'hello' }, { name: 'dir/b.txt', data: 'wörld' }]);
  const m = zipEntries(z);
  assert.deepEqual([...m.keys()], ['a.txt', 'dir/b.txt']);
  assert.equal(new TextDecoder().decode(await m.get('dir/b.txt')()), 'wörld');
  if (python) {
    const out = execFileSync('python3', ['-c', 'import sys,io,zipfile\nz=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))\nprint(z.testzip() is None, z.read("dir/b.txt").decode())'], { input: Buffer.from(z) });
    assert.equal(String(out).trim(), 'True wörld');
  }
  assert.throws(() => zipEntries(new TextEncoder().encode('not a zip')), /not a zip/);
});

test('reading Office files someone attaches (made by Python, deflate-compressed)', async () => {
  const docx = await officeText(fixture('worksheet.docx'), 'worksheet.docx');
  assert.equal(docx, 'Unit 4 Quiz\n1. Solve 2x + 3 = 11\nName:\tScore & grade <A>');
  const xlsx = await officeText(fixture('grades.xlsx'), 'grades.xlsx');
  assert.equal(xlsx, 'Sheet "Period 2":\nName,Score\nAna P.,93.5,,"Late, but ok"\n\nSheet "Notes":\nbring calculator,TRUE');
  const pptx = await officeText(fixture('lesson.pptx'), 'lesson.pptx');
  assert.equal(pptx, 'Slide 1:\nCells\nPoint for slide 1\n\nSlide 2:\nPhotosynthesis\nPoint for slide 2\n\nSlide 10:\nReview\nPoint for slide 10');
  assert.equal(await officeText(new TextEncoder().encode('plain text'), 'x.docx'), null, 'not a zip: null');
});

test('making Word and Excel files: they open (Python reads them back) and keep the content', async () => {
  const docx = makeDocx('# Study guide\nSolve **2x + 3 = 11**: \\(x = 4\\), area \\(\\pi r^2\\)\n- first point\n\nEnd & <done>');
  assert.equal(await officeText(docx, 'g.docx'), 'Study guide\nSolve 2x + 3 = 11: x = 4, area π r²\n•\tfirst point\n\nEnd & <done>');
  const xlsx = makeXlsx('Name,Score,Note\nAna,93.5,"Late, but ok"\nBo,-7,=SUM(1)');
  assert.equal(await officeText(xlsx, 'g.xlsx'), 'Sheet "Sheet1":\nName,Score,Note\nAna,93.5,"Late, but ok"\nBo,-7,=SUM(1)');
  assert.deepEqual(parseCsv('a,"b ""q""",c\n1,2'), [['a', 'b "q"', 'c'], ['1', '2']]);
  if (python) {
    const check = (bytes, part) => String(execFileSync('python3', ['-c', 'import sys,io,zipfile,xml.etree.ElementTree as E\nz=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))\nassert z.testzip() is None\n[E.fromstring(z.read(n)) for n in z.namelist() if n.endswith(".xml") or n.endswith(".rels")]\nprint(sorted(z.namelist()))'], { input: Buffer.from(bytes) })).trim();
    assert.match(check(docx), /'word\/document\.xml'/);
    assert.match(check(xlsx), /'xl\/worksheets\/sheet1\.xml'/);
  }
  // The formula-looking cell is text, never a live formula.
  const sheet = new TextDecoder().decode(await zipEntries(xlsx).get('xl/worksheets/sheet1.xml')());
  assert.ok(sheet.includes('<t xml:space="preserve">=SUM(1)</t>') && !sheet.includes('<f>'));
  const f = makeFile('notes.md', '# Hi');
  assert.deepEqual([new TextDecoder().decode(f.bytes), f.type], ['# Hi\n', 'text/markdown; charset=utf-8']);
  assert.equal(makeFile('a.docx', 'x').type, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
});

test('script.js carries an identical copy of web/ai-files.js', () => {
  const mod = fs.readFileSync(new URL('../web/ai-files.js', import.meta.url), 'utf8');
  const lib = mod.slice(mod.indexOf('// ---- Math: LaTeX → MathML'), mod.indexOf('// ---- end of the copied block ----')).trim();
  const script = fs.readFileSync(new URL('../script.js', import.meta.url), 'utf8');
  const a = script.indexOf('// ---- ai-files (copy of web/ai-files.js'), b = script.indexOf('// ---- end ai-files ----');
  assert.ok(a > 0 && b > a, 'markers found in script.js');
  const copy = script.slice(script.indexOf('\n', a) + 1, b).split('\n').map((l) => l.replace(/^ {2}/, '')).join('\n').trim();
  assert.equal(copy, lib);
});
