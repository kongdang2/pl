#!/usr/bin/env node
// 소통 채널(웹 sk_channel)을 PC에서 읽고 쓰는 Codex용 도구. PC 위치: 손익추정시스템\소통\채널.cjs
// 로그인 정보는 저장소·채널 밖, 사용자 폴더의 .sonik-codex.json {"email": "...", "password": "..."} 에 둔다.
// 쓰는 법
//   node 소통/채널.cjs 읽기              나(Codex) 또는 「모두」에게 온 「대기」 글 + 최근 10개
//   node 소통/채널.cjs 전체 [개수]         최근 글(기본 30개)
//   node 소통/채널.cjs 쓰기 --to Claude --topic v310 [--re 3] [--안내] (--body "내용" | --file 경로)
//       --re 로 나에게 온 「대기」 글에 답하면 원글은 「답변」이 된다. --안내 는 답이 필요 없는 글.
//   node 소통/채널.cjs 상태 3 완료         (대기·답변·완료)
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const URL_ = 'https://znqaxyqayxkgqnqnwyez.supabase.co';
const KEY = 'sb_publishable_2dCd3uLHA80B3hY_DflgKA_xMtj4Itl'; // 공개 키. 접근은 로그인 + RLS(sk_agents)로 막는다
const ME = 'Codex';
const LOGIN = process.env.SONIK_CODEX_LOGIN || path.join(os.homedir(), '.sonik-codex.json');

async function token() {
  if (!fs.existsSync(LOGIN)) throw new Error('로그인 파일이 없습니다: ' + LOGIN + ' ({"email":"…","password":"…"})');
  const { email, password } = JSON.parse(fs.readFileSync(LOGIN, 'utf8'));
  const r = await fetch(URL_ + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json();
  if (!r.ok) throw new Error('로그인 실패: ' + (j.error_description || j.msg || r.status));
  return { tok: j.access_token, email: String(j.user.email).toLowerCase() };
}
async function api(auth, method, q, body, prefer) {
  const r = await fetch(URL_ + '/rest/v1/sk_channel' + q, { method, headers: { apikey: KEY, Authorization: 'Bearer ' + auth.tok, 'Content-Type': 'application/json', Prefer: prefer || 'return=representation' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(method + ' 실패 ' + r.status + ': ' + t);
  return t ? JSON.parse(t) : null;
}
const fmt = (m) => {
  const d = new Date(m.at), p = (n) => String(n).padStart(2, '0');
  const t = p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  return '## #' + m.id + ' · ' + t + ' · ' + m.sender + ' → ' + m.recipient + ' · ' + (m.topic || '-') + ' · ' + m.status + (m.reply_to ? ' (↩ #' + m.reply_to + ')' : '') + '\n' + m.body + '\n';
};
function opt(args, name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; }

(async () => {
  const [cmd, ...args] = process.argv.slice(2);
  const auth = await token();
  if (!cmd || cmd === '읽기') {
    const wait = await api(auth, 'GET', '?select=*&status=eq.' + encodeURIComponent('대기') + '&recipient=in.(' + encodeURIComponent(ME + ',모두') + ')&order=at.asc');
    const recent = await api(auth, 'GET', '?select=*&order=at.desc&limit=10');
    console.log('# 나(' + ME + ')에게 온 대기 ' + wait.length + '건\n');
    wait.forEach((m) => console.log(fmt(m)));
    console.log('# 최근 10개(오래된 순)\n');
    recent.reverse().forEach((m) => console.log(fmt(m)));
  } else if (cmd === '전체') {
    const n = Math.min(500, +args[0] || 30);
    (await api(auth, 'GET', '?select=*&order=at.desc&limit=' + n)).reverse().forEach((m) => console.log(fmt(m)));
  } else if (cmd === '쓰기') {
    const to = opt(args, '--to'), file = opt(args, '--file');
    const body = file ? fs.readFileSync(file, 'utf8').trim() : (opt(args, '--body') || '').trim();
    if (!['hong', 'Claude', '모두'].includes(to)) throw new Error('--to 는 hong / Claude / 모두');
    if (!body) throw new Error('--body 또는 --file 로 내용을 주세요');
    const re = opt(args, '--re') ? +opt(args, '--re') : null;
    const [row] = await api(auth, 'POST', '', { sender: ME, recipient: to, topic: opt(args, '--topic') || '', status: args.includes('--안내') ? '안내' : '대기', reply_to: re, body, author_email: auth.email });
    if (re) {
      const [orig] = await api(auth, 'GET', '?select=*&id=eq.' + re);
      if (orig && orig.status === '대기' && (orig.recipient === ME || orig.recipient === '모두')) await api(auth, 'PATCH', '?id=eq.' + re, { status: '답변', updated_at: new Date().toISOString() });
    }
    console.log('보냄\n' + fmt(row));
  } else if (cmd === '상태') {
    const id = +args[0], s = args[1];
    if (!id || !['대기', '답변', '완료'].includes(s)) throw new Error('예: 상태 3 완료');
    const r = await api(auth, 'PATCH', '?id=eq.' + id, { status: s, updated_at: new Date().toISOString() });
    if (!r.length) throw new Error('#' + id + ' 를 찾지 못했습니다');
    console.log(fmt(r[0]));
  } else {
    throw new Error('명령: 읽기 · 전체 · 쓰기 · 상태');
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
