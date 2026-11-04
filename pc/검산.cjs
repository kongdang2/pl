// 챗봇 숫자 답 검산(챗봇 답변 개선 C, hong 2026-11-04) — 중계.cjs 가 쓴다. 계산 없이 글자만 다루는 함수들(시험: tests/검산.test.cjs)
// 답의 <<<근거 … 근거>>> 블록(숫자 · 화면 파일 · 행 · 열)을 엔진조회.cjs 가 뽑아 둔 화면 파일과 대조하고,
// 답 본문의 숫자 중 근거가 없는 것을 찾는다.
'use strict';
const fs = require('fs'), path = require('path');

// 숫자 글자 → 수. 1,234 · Δ1,234 · △1,234 · (1,234) · -1,234 · 12.3% · ▲3 (▲ 는 증가 표시라 양수)
function num(t) {
  let s = String(t == null ? '' : t).trim().replace(/[\s,]/g, '').replace(/(원|%|억원?|백만원?|톤|MT|\$)$/i, '');
  let neg = false;
  if (/^[Δ△▼]/.test(s)) { neg = true; s = s.slice(1); } else if (/^▲/.test(s)) s = s.slice(1);
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/^[-−]/.test(s)) { neg = !neg; s = s.slice(1); }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const v = +s;
  return { v: neg ? -v : v, dp: (s.split('.')[1] || '').length };
}
// a(답에 쓴 값, 소수 dp 자리)가 b(화면 값)를 그 자리에서 반올림한 것과 같은가. 부호를 빼고 쓴 경우도 같다고 본다(「영업손실 1,357」)
function same(a, b) {
  if (!a || !b) return false;
  const k = Math.pow(10, a.dp), r = (x) => Math.round(x * k) / k;
  const ok = (x) => Math.abs(r(x) - a.v) < 0.5 / k + 1e-9;
  return ok(b.v) || ok(-b.v);
}
const NUM_RE = /[Δ△▲▼]?\(?[-−]?\d+(?:,\d{3})*(?:\.\d+)?\)?%?/g;
// 칸 값: 칸 전체가 수이면 그 수, 아니면 칸 앞머리의 수(「Δ181 ±0」 「1,234 (12%)」 → 앞 수). 글자 칸은 null
function cellNum(c) {
  const n = num(c);
  if (n) return n;
  const t = String(c || '').trim();
  if (t.length > 40) return null;
  const mm = /^[Δ△▲▼]?\(?[-−]?\d+(?:,\d{3})*(?:\.\d+)?\)?%?/.exec(t);
  return mm ? num(mm[0]) : null;
}
const norm = (t) => String(t || '').replace(/\s+/g, '').replace(/[()（）·・/]/g, '').toLowerCase();

// 답 본문에서 검산할 숫자: 세 자리 이상 수 또는 소수. 연도·날짜·월·글 번호·버전·파일 이름 속 숫자는 뺀다
function bodyNumbers(body) {
  const t = String(body || '')
    .replace(/<<<근거[\s\S]*?근거>>>/g, ' ')
    .replace(/`[^`]*`/g, ' ')                                   // 파일·경로
    .replace(/\bv\d+(?:-\d+)?(?:\s*r\d+)?/gi, ' ')                // 버전
    .replace(/#\d+/g, ' ')                                        // 글·요청 번호
    .replace(/\b(19|20)\d{2}\s*[-./년]\s*\d{1,2}(?:\s*[-./월]\s*\d{1,2}\s*일?)?/g, ' ') // 날짜·연월
    .replace(/\b(19|20)\d{2}\s*년/g, ' ')
    .replace(/\d{1,2}\s*(월|일|분기|시|분|초|개월|년|차|번|개|건|칸|행|열|줄|쪽|곳|가지|명)/g, ' ');
  const out = [];
  for (const mm of t.matchAll(NUM_RE)) {
    const raw = mm[0], n = num(raw);
    if (!n) continue;
    const digits = String(Math.abs(n.v)).replace('.', '').replace(/^0+/, '');
    if (Math.abs(n.v) < 100 && !n.dp) continue;      // 작은 정수(몇 개·몇 %p 아님)는 건너뜀
    if (/^(19|20)\d{2}$/.test(raw)) continue;        // 연도만 따로
    if (digits.length < 2) continue;
    out.push({ raw, n });
  }
  return out;
}

// <<<근거 블록 → [{raw, n, file, row, col, calc}]
function parseBasis(text) {
  const all = [...String(text || '').matchAll(/<<<근거\s*\r?\n([\s\S]*?)\r?\n?\s*근거>>>/g)];
  const L = [];
  for (const b of all) for (const line of b[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const c = line.split('\t').map((x) => x.trim());
    const p = c.length >= 2 ? c : line.split(/\s*\|\s*/).map((x) => x.trim());
    const n = num(p[0]);
    if (!n) continue;
    const calc = /^계산$/.test(p[1] || '');
    L.push({ raw: p[0], n, file: calc ? null : (p[1] || ''), row: calc ? '' : (p[2] || ''), col: calc ? '' : (p[3] || ''), calc, expr: calc ? p.slice(2).join(' ') : '' });
  }
  return L;
}

// 화면 파일 하나 읽기(캐시): [{title, rows:[[셀…]]}]
const fileCache = new Map();
function readScreen(f) {
  if (fileCache.has(f)) return fileCache.get(f);
  const t = fs.readFileSync(f, 'utf8'), tables = [];
  let cur = null;
  for (const line of t.split(/\r?\n/)) {
    const h = /^「(.*)」$/.exec(line);
    if (h) { cur = { title: h[1], rows: [] }; tables.push(cur); continue; }
    if (cur && line.includes('\t')) cur.rows.push(line.split('\t'));
    else if (cur && line.trim() && !line.startsWith('위치:') && !line.startsWith('(엔진')) cur.rows.push([line]);
  }
  const head = (/^위치:\s*(.*)$/m.exec(t) || [])[1] || '';
  const r = { where: head, tables };
  fileCache.set(f, r);
  return r;
}
function findFile(dirs, name) {
  if (!name) return null;
  const base = path.basename(String(name).replace(/\\/g, '/'));
  for (const d of dirs) {
    const f = path.join(d, base);
    if (fs.existsSync(f)) return f;
    // 번호만 맞게 적은 경우(001_…)
    const pre = /^(\d{3})(?:_|$|\.txt$)/.exec(base);
    if (pre) { const g = fs.readdirSync(d).find((x) => x.startsWith(pre[1] + '_')); if (g) return path.join(d, g); }
  }
  return null;
}
// 근거 한 줄 확인: 그 파일 안에서 행 이름이 든 줄에 그 값이 있는가(열 이름이 머리글에 있으면 그 칸까지)
function checkLine(dirs, b) {
  if (b.calc) return { ok: true, calc: true };
  const f = findFile(dirs, b.file);
  if (!f) return { ok: false, why: '화면 파일 없음(' + b.file + ')' };
  const sc = readScreen(f), rn = norm(b.row), cn = norm(b.col);
  let inFile = false, colMiss = null;
  for (const t of sc.tables) {
    // 열 위치: 행 이름이 든 줄보다 위에서 열 이름을 가진 마지막 머리글 줄
    let colIdx = -1;
    for (const row of t.rows) {
      // 열 이름: 똑같은 머리글이 먼저, 없으면 그 이름을 품은 머리글(「12월」이 「12월 누계」보다 「12월」에 붙게)
      let hit = cn ? row.findIndex((c) => norm(c) === cn) : -1;
      if (cn && hit < 0 && cn.length >= 2) hit = row.findIndex((c) => norm(c).includes(cn));
      if (hit >= 0 && !row.some((c) => num(c))) colIdx = hit;
      const vals = row.map(cellNum);
      if (!vals.some((v) => same(b.n, v))) continue;
      inFile = true;
      const rowHit = !rn || row.some((c) => norm(c) === rn || (rn.length >= 2 && norm(c).includes(rn))) || norm(t.title).includes(rn);
      if (!rowHit) continue;
      if (colIdx >= 0 && !same(b.n, vals[colIdx])) { colMiss = colMiss || { col: b.col, got: row[colIdx] }; continue; }
      return { ok: true, where: sc.where, title: t.title, file: f };
    }
  }
  if (colMiss) return { ok: false, why: b.row + '·' + colMiss.col + ' 칸은 ' + colMiss.got + '(답 ' + b.raw + ')' };
  return inFile ? { ok: true, loose: true, where: sc.where, file: f } : { ok: false, why: path.basename(f) + ' 에 ' + b.raw + ' 없음' };
}

// 전체 검산: dirs = 화면 폴더들, text = 실행 출력(근거 블록이 든 글), body = 채널 본문
// 반환 {basis, bad:[{raw, why}], unbacked:[raw], checked, wheres:[…]}
function check(dirs, text, body) {
  fileCache.clear();
  const basis = parseBasis(text);
  const bad = [], wheres = [];
  for (const b of basis) {
    const r = checkLine(dirs, b);
    b.res = r;
    if (!r.ok) bad.push({ raw: b.raw, why: r.why });
    else if (r.where) {
      const w = r.where + (r.title && r.title.length <= 24 ? ' 「' + r.title + '」' : '');
      if (!wheres.includes(w)) wheres.push(w);
    }
  }
  const good = basis.filter((b) => b.res && b.res.ok);
  const unbacked = [];
  for (const x of bodyNumbers(body)) {
    if (good.some((b) => same(x.n, b.n) || same(b.n, x.n))) continue;
    if (!unbacked.includes(x.raw)) unbacked.push(x.raw);
  }
  return { basis, bad, unbacked, checked: good.length, wheres };
}
const stripBasis = (t) => String(t || '').replace(/\n?<<<근거[\s\S]*?근거>>>\n?/g, '\n').trim();

module.exports = { num, cellNum, same, bodyNumbers, parseBasis, check, stripBasis, readScreen };
