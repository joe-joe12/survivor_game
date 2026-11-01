// ============================================================
//  account.js － 帳號設定：暱稱 / 頭像 / 稱號展示 / 好友 / 好友連機
//  ★ 放在 index.html 最底部：<script src="characters.js"></script> 的下一行
//  ★ 好友與連機需要 Google 登入（cloud.js）＋ 在 Firebase 貼上 firestore.rules
//  連機（2～4 人）：同一張地圖、打同一批怪。房主的手機計算怪物，經 Realtime Database 每 0.1 秒同步；
//  隊友都還活著時全員傷害 +10%，結算時各得連機獎勵。★ 需要在 Firebase 開 Realtime Database（見 database.rules.json）
// ============================================================
(function () {
'use strict';
const db = () => firebase.firestore();
const me = () => (window.Cloud && Cloud.user) ? Cloud.user.uid : null;
const online = () => !!(window.firebase && firebase.apps && firebase.apps.length && me());

// ---------- 1. 基本資料 ----------
const AV_EMOJI = ['🦊', '🐼', '🐯', '🐸', '🐙', '🦄', '🐲', '🦉', '🐧', '🦖', '🚀', '👾'];
const items = () => S.uc.length + S.uw.length + S.up.length;
const TITLES = [
    { id: 0,  name: '新手倖存者', desc: '預設稱號',               ok: () => true },
    { id: 1,  name: '初出茅廬',   desc: '累積擊殺 100 隻',        ok: () => (S.kills || 0) >= 100 },
    { id: 2,  name: '百戰老將',   desc: '累積擊殺 1,000 隻',      ok: () => (S.kills || 0) >= 1000 },
    { id: 3,  name: '虛空獵手',   desc: '累積擊殺 5,000 隻',      ok: () => (S.kills || 0) >= 5000 },
    { id: 4,  name: '撐過五分鐘', desc: '單場存活 5 分鐘',        ok: () => (S.best || 0) >= 300 },
    { id: 5,  name: '生存大師',   desc: '單場存活 15 分鐘',       ok: () => (S.best || 0) >= 900 },
    { id: 6,  name: 'BOSS 獵人',  desc: '擊敗 BOSS 1 次',         ok: () => (S.bossKills || 0) >= 1 },
    { id: 7,  name: '屠龍者',     desc: '擊敗 BOSS 10 次',        ok: () => (S.bossKills || 0) >= 10 },
    { id: 8,  name: '收藏家',     desc: '圖鑑收集 30 件',         ok: () => items() >= 30 },
    { id: 9,  name: '圖鑑達人',   desc: '圖鑑收集 100 件',        ok: () => items() >= 100 },
    { id: 10, name: '傳說見證者', desc: '擁有 1 隻傳說以上角色',  ok: () => S.uc.some(id => CHARACTERS[id] && CHARACTERS[id].r >= 3) },
    { id: 11, name: '虛空之子',   desc: '擁有 1 隻秘密角色',      ok: () => S.uc.some(id => CHARACTERS[id] && CHARACTERS[id].r === 4) },
    { id: 12, name: '社交達人',   desc: '擁有 3 位好友',          ok: () => A.friends.length >= 3 },
    { id: 13, name: '並肩作戰',   desc: '完成 1 場好友連機',      ok: () => (S.coopRuns || 0) >= 1 }
];
const prof = () => S.profile || (S.profile = { name: '', avatar: { t: 'e', e: '🦊' }, title: 0 });
const displayName = () => prof().name || (window.Cloud && Cloud.user && Cloud.user.displayName) || '玩家';
const titleOf = () => { const t = TITLES[prof().title]; return t && t.ok() ? t : TITLES[0]; };
const avText = (av) => (av && av.t === 'e') ? av.e : '🔷';
function avatarObj(s, x, y, av, size) {           // 頭像：角色用遊戲內的模型，其餘用表情符號
    if (av && av.t === 'c' && s.textures.exists('hero' + av.id)) return s.add.image(x, y, 'hero' + av.id).setScale(size / 52);
    return s.add.text(x, y, (av && av.e) || '🦊', { fontSize: size + 'px' }).setOrigin(0.5);
}

// ---------- 2. 雲端：名片 / 好友 / 邀請 ----------
const A = { friends: [], fships: [], reqs: [], invites: [], unsubs: [] };
const fire = () => window.dispatchEvent(new CustomEvent('acctchange'));
const onErr = (e) => { A.err = e.message; };
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

async function ensureCode() {                      // 產生唯一的 6 碼好友碼
    if (S.friendCode) return;
    for (let i = 0; i < 8; i++) {
        const c = Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
        const q = await db().collection('profiles').where('code', '==', c).limit(1).get();
        if (q.empty) { S.friendCode = c; save(); return; }
    }
}
async function pushProfile() {                     // 把公開名片寫到雲端（改暱稱 / 頭像 / 稱號時、登入時、每 45 秒）
    if (!online()) return;
    try {
        const p = prof(), t = titleOf();
        await db().collection('profiles').doc(me()).set({
            name: displayName(), avatar: p.avatar, titleId: t.id, title: t.name, code: S.friendCode || '',
            best: Math.floor(S.best || 0), kills: S.kills || 0, bossKills: S.bossKills || 0, items: items(), lastSeen: Date.now()
        }, { merge: true });
    } catch (e) { onErr(e); }
}
async function refreshFriends() {                  // 重新讀取好友名片（取得最新上線狀態）
    if (!online()) return;
    const ps = await Promise.all(A.fships.map(o => db().collection('profiles').doc(o.uid).get().then(d => d.exists ? d.data() : null).catch(() => null)));
    A.friends = A.fships.map((o, i) => Object.assign({ name: '(未知)' }, ps[i] || {}, { fid: o.fid, uid: o.uid }));
    fire();
}
function stopListeners() { A.unsubs.forEach(u => { try { u(); } catch (e) {} }); A.unsubs = []; A.friends = []; A.fships = []; A.reqs = []; A.invites = []; fire(); }
function startListeners() {
    stopListeners();
    const uid = me(); if (!uid) return;
    const d = db();
    A.unsubs.push(d.collection('friendReqs').where('to', '==', uid).onSnapshot(s => {
        A.reqs = s.docs.map(x => Object.assign({ id: x.id }, x.data())).filter(r => r.status === 'pending'); fire();
    }, onErr));
    A.unsubs.push(d.collection('friendships').where('users', 'array-contains', uid).onSnapshot(s => {
        A.fships = s.docs.map(x => ({ fid: x.id, uid: x.data().users.find(u => u !== uid) })); refreshFriends();
    }, onErr));
    A.unsubs.push(d.collection('rooms').where('inv', 'array-contains', uid).onSnapshot(s => {
        A.invites = s.docs.map(x => Object.assign({ id: x.id }, x.data())).filter(r => r.status === 'lobby' && r.host !== uid && Date.now() - r.ts < 15 * 60 * 1000); fire();
    }, onErr));
}
window.addEventListener('cloudchange', async () => {
    if (online()) { try { await ensureCode(); } catch (e) { onErr(e); } await pushProfile(); startListeners(); } else stopListeners();
});
setInterval(() => { if (online()) pushProfile(); }, 45000);

async function addFriend(code) {
    code = (code || '').trim().toUpperCase();
    if (!online()) return '請先 Google 登入';
    if (!code) return '請輸入好友碼';
    if (code === S.friendCode) return '不能加自己為好友';
    const q = await db().collection('profiles').where('code', '==', code).limit(1).get();
    if (q.empty) return '找不到這個好友碼';
    const u = q.docs[0].id;
    if (A.friends.some(f => f.uid === u)) return '你們已經是好友了';
    await db().collection('friendReqs').doc(u + '__' + me()).set({ from: me(), to: u, fromName: displayName(), fromAvatar: prof().avatar, status: 'pending', ts: Date.now() });
    return '已送出好友邀請給「' + q.docs[0].data().name + '」';
}
async function acceptReq(r) { const a = [r.from, r.to].sort(); await db().collection('friendships').doc(a.join('_')).set({ users: a, ts: Date.now() }); await db().collection('friendReqs').doc(r.id).delete(); }
const declineReq = (r) => db().collection('friendReqs').doc(r.id).delete();
const removeFriend = (f) => db().collection('friendships').doc(f.fid).delete();
async function createRoom(f) {                     // 房主建立房間並邀請第一位好友（進大廳後還能再邀請）
    const ref = db().collection('rooms').doc(), id = me();
    await ref.set({
        host: id, hostName: displayName(), hostAvatar: prof().avatar, hostTitle: titleOf().name,
        inv: [id, f.uid], m: { [id]: { name: displayName(), avatar: prof().avatar, title: titleOf().name, j: Date.now() } },
        status: 'lobby', ts: Date.now()
    });
    return ref.id;
}

// ============================================================
//  帳號設定畫面
// ============================================================
class AccountScene extends Phaser.Scene {
    constructor() { super('AccountScene'); }
    create(data) {
        makeTextures(this); menuBg(this); title(this, '👤 帳號設定');
        this.tab = (data && data.tab) || 0; this.page = 0; this.fpage = 0; this.dyn = []; this.msg = '';
        btn(this, 60, 36, '‹ 返回', () => this.scene.start('MenuScene'), '#444a5a', 14);
        const on = () => { if (this.scene.isActive()) this.render(); };
        window.addEventListener('acctchange', on);
        this.events.once('shutdown', () => window.removeEventListener('acctchange', on));
        this.time.addEvent({ delay: 30000, loop: true, callback: refreshFriends });
        refreshFriends(); this.render();
    }
    D(o) { this.dyn.push(o); return o; }
    say(m) { this.msg = m; this.render(); }
    render() {
        this.dyn.forEach(o => o.destroy()); this.dyn = [];
        this.drawProfile();
        const n = A.reqs.length + A.invites.length;
        ['🏅 稱號', '🖼 頭像', '👥 好友' + (n ? ` ❗${n}` : '')].forEach((t, i) =>
            this.D(btn(this, 440 + i * 150, 104, t, () => { this.tab = i; this.page = 0; this.fpage = 0; this.msg = ''; this.render(); }, i === this.tab ? '#2a7de1' : '#2a3558', 15, { w: 138 })));
        [this.drawTitles, this.drawAvatars, this.drawFriends][this.tab].call(this);
    }
    // ---- 左：個人名片 ----
    drawProfile() {
        const p = prof(), t = titleOf(), cx = 180, D = (o) => this.D(o);
        const g = D(this.add.graphics().setDepth(1)); drawPanel(g, 30, 80, 300, 430, { stroke: 0x4a6fb5, glow: true, fill: 0x121b31 });
        D(this.add.circle(cx, 160, 46, 0x0b1226).setStrokeStyle(3, 0xffd24a).setDepth(2));
        D(avatarObj(this, cx, 160, p.avatar, p.avatar.t === 'c' ? 64 : 56).setDepth(3));
        D(this.add.text(cx, 225, displayName(), { fontSize: '22px', color: '#fff', fontStyle: 'bold', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5).setDepth(3));
        D(this.add.text(cx, 254, `「${t.name}」`, { fontSize: '15px', color: '#ffd24a', fontStyle: 'bold' }).setOrigin(0.5).setDepth(3));
        D(btn(this, cx, 290, '✏ 更改暱稱', () => {
            const n = window.prompt('輸入暱稱（最多 12 字）', displayName());
            if (n !== null) { prof().name = n.trim().slice(0, 12); save(); pushProfile(); this.render(); }
        }, '#3a4a7a', 13, { w: 130 }));
        D(this.add.text(cx, 332, online() ? `好友碼　${S.friendCode || '產生中…'}` : '好友碼　（登入後產生）', { fontSize: '15px', color: '#9fe3ff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(3));
        if (online() && S.friendCode) D(btn(this, cx, 366, '📋 複製好友碼', () => {
            try { navigator.clipboard.writeText(S.friendCode); this.say('已複製好友碼：' + S.friendCode); } catch (e) { this.say('請手動記下好友碼：' + S.friendCode); }
        }, '#3a4a7a', 13, { w: 150 }));
        D(this.add.text(cx, 430, `⏱ 最佳存活 ${fmtT(S.best || 0)}　💀 擊殺 ${S.kills || 0}\n👹 BOSS ${S.bossKills || 0}　📖 收藏 ${items()}/${CHARACTERS.length + WEAPONS.length + PASSIVES.length}\n🤝 連機 ${S.coopRuns || 0} 場　👥 好友 ${A.friends.length}`,
            { fontSize: '13px', color: '#c8d4ee', align: 'center', lineSpacing: 6 }).setOrigin(0.5).setDepth(3));
        D(this.add.text(cx, 487, online() ? '☁ 已登入' : '☁ 未登入：好友與連機需要 Google 登入', { fontSize: '11px', color: online() ? '#7fe3a0' : '#ff9a9a' }).setOrigin(0.5).setDepth(3));
    }
    // ---- 右：稱號 ----
    drawTitles() {
        TITLES.forEach((t, i) => {
            const x = 350 + (i % 2) * 292, y = 140 + Math.floor(i / 2) * 52, w = 282, h = 44, ok = t.ok(), cur = prof().title === t.id;
            const g = this.D(this.add.graphics().setDepth(2));
            drawPanel(g, x, y, w, h, { r: 10, fill: ok ? 0x1a2744 : 0x0e1320, stroke: cur ? 0xffd700 : ok ? 0x4a6fb5 : 0x2a3040, glow: cur });
            this.D(this.add.text(x + 12, y + 14, t.name, { fontSize: '15px', color: ok ? (cur ? '#ffd700' : '#fff') : '#666', fontStyle: 'bold' }).setOrigin(0, 0.5).setDepth(3));
            this.D(this.add.text(x + 12, y + 32, t.desc, { fontSize: '11px', color: ok ? '#9fe3ff' : '#555' }).setOrigin(0, 0.5).setDepth(3));
            this.D(this.add.text(x + w - 12, y + h / 2, cur ? '✓ 使用中' : ok ? '點擊裝備' : '🔒', { fontSize: '12px', color: cur ? '#ffd700' : '#8da2cc' }).setOrigin(1, 0.5).setDepth(3));
            if (ok && !cur) this.D(this.add.zone(x + w / 2, y + h / 2, w, h).setDepth(5).setInteractive({ useHandCursor: true })
                .on('pointerdown', () => { prof().title = t.id; save(); pushProfile(); this.render(); }));
        });
    }
    // ---- 右：頭像 ----
    drawAvatars() {
        const list = AV_EMOJI.map(e => ({ t: 'e', e })).concat(S.uc.map(id => ({ t: 'c', id }))), PER = 18, pages = Math.ceil(list.length / PER);
        this.page = Math.min(this.page, pages - 1);
        const cur = prof().avatar, same = (a) => a.t === cur.t && (a.t === 'e' ? a.e === cur.e : a.id === cur.id);
        list.slice(this.page * PER, this.page * PER + PER).forEach((a, i) => {
            const x = 350 + 46 + (i % 6) * 96, y = 140 + 46 + Math.floor(i / 6) * 96, sel = same(a);
            const g = this.D(this.add.graphics().setDepth(2));
            drawPanel(g, x - 44, y - 44, 88, 88, { r: 12, fill: sel ? 0x24396a : 0x141d33, stroke: sel ? 0xffd700 : 0x3b5a96, glow: sel });
            this.D(avatarObj(this, x, y - 6, a, a.t === 'c' ? 46 : 40).setDepth(3));
            if (a.t === 'c') this.D(this.add.text(x, y + 32, CHARACTERS[a.id].name, { fontSize: '10px', color: hex(RAR[CHARACTERS[a.id].r].c) }).setOrigin(0.5).setDepth(3));
            this.D(this.add.zone(x, y, 88, 88).setDepth(5).setInteractive({ useHandCursor: true }).on('pointerdown', () => { prof().avatar = a; save(); pushProfile(); this.render(); }));
        });
        this.D(this.add.text(640, 468, '可選擇表情頭像，或使用你已擁有角色的外型', { fontSize: '12px', color: '#8da2cc' }).setOrigin(0.5).setDepth(3));
        if (pages > 1) {
            this.D(btn(this, 540, 498, '◀', () => { this.page = (this.page + pages - 1) % pages; this.render(); }, '#3a4a7a', 15, { w: 50 }));
            this.D(btn(this, 740, 498, '▶', () => { this.page = (this.page + 1) % pages; this.render(); }, '#3a4a7a', 15, { w: 50 }));
            this.D(this.add.text(640, 498, `${this.page + 1} / ${pages}`, { fontSize: '14px', color: '#9bb4ee' }).setOrigin(0.5).setDepth(3));
        }
    }
    // ---- 右：好友 ----
    drawFriends() {
        if (!online()) {
            this.D(panel(this, 640, 300, 520, 160, { stroke: 0xff9a9a, fill: 0x1a1220, d: 2 }));
            this.D(this.add.text(640, 270, '好友與連機需要先登入 Google 帳號', { fontSize: '17px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(3));
            this.D(btn(this, 640, 330, '🔐 Google 登入', () => Cloud.login(), '#4285f4', 18, { w: 200, d: 3 }));
            return;
        }
        this.D(btn(this, 460, 150, '＋ 輸入好友碼加好友', async () => {
            const c = window.prompt('輸入對方的 6 碼好友碼'); if (c === null) return;
            try { this.say(await addFriend(c)); } catch (e) { this.say('失敗：' + e.message); }
        }, '#2a9d5c', 14, { w: 210 }));
        this.D(this.add.text(580, 150, this.msg || (A.err ? '⚠ ' + A.err : ''), { fontSize: '12px', color: '#ffd24a', wordWrap: { width: 340 } }).setOrigin(0, 0.5).setDepth(3));
        const rows = A.invites.map(r => ({ k: 'inv', r })).concat(A.reqs.map(r => ({ k: 'req', r })), A.friends.map(f => ({ k: 'fr', f })));
        const PER = 5, pages = Math.max(1, Math.ceil(rows.length / PER)); this.fpage = Math.min(this.fpage, pages - 1);
        if (!rows.length) this.D(this.add.text(640, 300, '還沒有好友\n把你的好友碼分享給朋友，或輸入對方的好友碼', { fontSize: '14px', color: '#8da2cc', align: 'center', lineSpacing: 6 }).setOrigin(0.5).setDepth(3));
        rows.slice(this.fpage * PER, this.fpage * PER + PER).forEach((row, i) => {
            const y = 198 + i * 56, x = 350, w = 580, h = 48, fr = row.k === 'fr';
            const on = fr && Date.now() - (row.f.lastSeen || 0) < 90000;
            const g = this.D(this.add.graphics().setDepth(2));
            drawPanel(g, x, y - h / 2, w, h, { r: 10, fill: 0x141d33, stroke: row.k === 'fr' ? (on ? 0x44dd77 : 0x3b5a96) : 0xffd24a, bw: 1 });
            const av = fr ? row.f.avatar : (row.k === 'inv' ? row.r.hostAvatar : row.r.fromAvatar);
            this.D(avatarObj(this, x + 30, y, av, 28).setDepth(3));
            const nm = fr ? row.f.name : (row.k === 'inv' ? row.r.hostName : row.r.fromName);
            this.D(this.add.text(x + 58, y - 9, (fr ? (on ? '🟢 ' : '⚫ ') : '') + nm, { fontSize: '15px', color: '#fff', fontStyle: 'bold' }).setOrigin(0, 0.5).setDepth(3));
            this.D(this.add.text(x + 58, y + 11, fr ? `「${row.f.title || '新手倖存者'}」　最佳 ${fmtT(row.f.best || 0)}　收藏 ${row.f.items || 0}` : row.k === 'inv' ? '邀請你一起連機！' : '想加你為好友', { fontSize: '11px', color: fr ? '#9fe3ff' : '#ffd24a' }).setOrigin(0, 0.5).setDepth(3));
            if (row.k === 'inv') {
                this.D(btn(this, x + w - 130, y, '加入', () => this.scene.start('RoomScene', { rid: row.r.id, role: 'guest' }), '#2a9d5c', 13, { w: 80, d: 3 }));
                this.D(btn(this, x + w - 44, y, '拒絕', () => db().collection('rooms').doc(row.r.id).update({ inv: firebase.firestore.FieldValue.arrayRemove(me()) }), '#7a3a3a', 13, { w: 70, d: 3 }));
            } else if (row.k === 'req') {
                this.D(btn(this, x + w - 130, y, '接受', async () => { try { await acceptReq(row.r); this.say('已成為好友！'); } catch (e) { this.say('失敗：' + e.message); } }, '#2a9d5c', 13, { w: 80, d: 3 }));
                this.D(btn(this, x + w - 44, y, '拒絕', () => declineReq(row.r), '#7a3a3a', 13, { w: 70, d: 3 }));
            } else {
                this.D(btn(this, x + w - 140, y, on ? '🤝 邀請連機' : '邀請連機（離線）', async () => {
                    try { const rid = await createRoom(row.f); this.scene.start('RoomScene', { rid, role: 'host' }); } catch (e) { this.say('失敗：' + e.message); }
                }, on ? '#b0508a' : '#5a4a5a', 13, { w: 150, d: 3 }));
                this.D(btn(this, x + w - 30, y, '✕', () => { if (window.confirm('確定要刪除好友「' + row.f.name + '」嗎？')) removeFriend(row.f); }, '#7a3a3a', 13, { w: 42, d: 3 }));
            }
        });
        if (pages > 1) {
            this.D(btn(this, 540, 498, '◀', () => { this.fpage = (this.fpage + pages - 1) % pages; this.render(); }, '#3a4a7a', 15, { w: 50 }));
            this.D(btn(this, 740, 498, '▶', () => { this.fpage = (this.fpage + 1) % pages; this.render(); }, '#3a4a7a', 15, { w: 50 }));
            this.D(this.add.text(640, 498, `${this.fpage + 1} / ${pages}`, { fontSize: '14px', color: '#9bb4ee' }).setOrigin(0.5).setDepth(3));
        }
    }
}

// ============================================================
//  Realtime Database 載入（連機戰鬥用；每秒傳 10 次怪物位置，Firestore 撐不住）
// ============================================================
let rtdbP = null;
function loadRTDB() {
    if (window.firebase && firebase.database) return Promise.resolve();
    if (rtdbP) return rtdbP;
    rtdbP = new Promise((res, rej) => {
        const sc = Array.from(document.scripts).find(x => /firebase-app/.test(x.src));
        const src = sc ? sc.src.replace('firebase-app', 'firebase-database') : 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js';
        const el = document.createElement('script');
        el.src = src; el.onload = () => res();
        el.onerror = () => { rtdbP = null; rej(new Error('無法載入 Realtime Database 程式庫')); };
        document.head.appendChild(el);
    });
    return rtdbP;
}
const rdb = () => firebase.database();

// ============================================================
//  連機大廳（2～4 人）：房主邀請好友，到齊後由房主開始，3 秒倒數後同時進入戰鬥
// ============================================================
class RoomScene extends Phaser.Scene {
    constructor() { super('RoomScene'); }
    create(data) {
        makeTextures(this); menuBg(this); title(this, '🤝 好友連機（2～4 人）');
        this.rid = data.rid; this.role = data.role; this.r = null; this.started = false; this.dyn = []; this.fp = 0; this.rt = 'loading'; this.msg = '';
        const ref = this.ref = db().collection('rooms').doc(this.rid);
        if (this.role === 'guest') ref.update({ ['m.' + me()]: { name: displayName(), avatar: prof().avatar, title: titleOf().name, j: Date.now() } }).catch(onErr);
        this.unsub = ref.onSnapshot(sn => { this.r = sn.exists ? sn.data() : { status: 'cancelled' }; this.render(); }, onErr);
        const on = () => { if (this.scene.isActive()) this.render(); };
        window.addEventListener('acctchange', on);
        this.events.once('shutdown', () => { if (this.unsub) this.unsub(); window.removeEventListener('acctchange', on); });
        loadRTDB().then(() => {
            try { rdb(); this.rt = 'ok'; } catch (e) { this.rt = 'err'; this.msg = '尚未設定 databaseURL：' + e.message; }
            if (this.scene.isActive()) this.render();
        }).catch(e => { this.rt = 'err'; this.msg = e.message; if (this.scene.isActive()) this.render(); });
        btn(this, 60, 36, '‹ 離開', () => this.leave(), '#444a5a', 14);
        this.render();
    }
    leave() {
        const r = this.r;
        if (r && r.status === 'lobby') {
            if (this.role === 'host') this.ref.update({ status: 'cancelled' }).catch(() => {});
            else this.ref.update({ ['m.' + me()]: firebase.firestore.FieldValue.delete() }).catch(() => {});
        }
        this.scene.start('AccountScene', { tab: 2 });
    }
    render() {
        this.dyn.forEach(o => o.destroy()); this.dyn = [];
        const r = this.r, D = (o) => { this.dyn.push(o); return o; }; if (!r) return;
        const T = (x, y, s, st) => D(this.add.text(x, y, s, st).setOrigin(0.5).setDepth(3));
        if (r.status === 'cancelled') {
            T(W / 2, H / 2, '房間已關閉', { fontSize: '26px', color: '#ff9a9a', fontStyle: 'bold' });
            if (!this.closing) { this.closing = true; this.time.delayedCall(1200, () => this.scene.start('AccountScene', { tab: 2 })); }
            return;
        }
        const m = r.m || {}, isHost = r.host === me();
        const mem = Object.keys(m).map(u => Object.assign({ uid: u }, m[u])).sort((a, b) => (a.j || 0) - (b.j || 0));
        const pend = (r.inv || []).filter(u => !m[u]).map(u => { const f = A.friends.find(x => x.uid === u); return { uid: u, name: f ? f.name : '好友', avatar: f && f.avatar }; });
        if (r.status === 'playing') {
            if (!(r.order || []).includes(me())) { T(W / 2, H / 2, '遊戲已經開始了，你沒有加入這一場', { fontSize: '20px', color: '#ffd24a', fontStyle: 'bold' }); return; }
            T(W / 2, H / 2 - 20, this.rt === 'ok' ? '連機即將開始…' : this.rt === 'err' ? '⚠ ' + this.msg : '連線伺服器中…', { fontSize: '24px', color: '#ffd700', fontStyle: 'bold' });
            if (this.rt === 'ok' && !this.started) { this.started = true; this.countdown(r); }
            return;
        }
        // ---- 四個位置 ----
        const slots = mem.map(x => ({ k: 'm', x })).concat(pend.map(x => ({ k: 'p', x })));
        for (let i = 0; i < 4; i++) {
            const cx = W / 2 + (i - 1.5) * 214, s = slots[i], cy = 235;
            const ok = s && s.k === 'm';
            D(panel(this, cx, cy, 200, 250, { stroke: ok ? 0x44dd77 : 0x3b5a96, glow: ok, fill: 0x121b31, d: 1 }));
            D(this.add.circle(cx, cy - 55, 40, 0x0b1226).setStrokeStyle(3, ok ? 0xffd24a : 0x3b5a96).setDepth(2));
            if (ok) D(avatarObj(this, cx, cy - 55, s.x.avatar, s.x.avatar && s.x.avatar.t === 'c' ? 56 : 48).setDepth(3));
            else T(cx, cy - 55, s ? '⏳' : '＋', { fontSize: '36px' });
            T(cx, cy + 8, s ? (s.x.name || '玩家') : '空位', { fontSize: '17px', color: s ? '#fff' : '#667794', fontStyle: 'bold' });
            T(cx, cy + 34, ok ? `「${s.x.title || '新手倖存者'}」` : '', { fontSize: '12px', color: '#ffd24a' });
            T(cx, cy + 74, ok ? (s.x.uid === r.host ? '👑 房主　✓' : '✓ 已就緒') : s ? '等待接受邀請…' : '', { fontSize: '14px', color: ok ? '#7fe3a0' : '#8da2cc', fontStyle: 'bold' });
        }
        // ---- 房主：邀請更多好友 ----
        if (isHost) {
            const used = new Set(r.inv || []);
            const cand = A.friends.filter(f => !used.has(f.uid));
            if (slots.length < 4 && cand.length) {
                const PER = 4, pages = Math.ceil(cand.length / PER); this.fp = Math.min(this.fp, pages - 1);
                cand.slice(this.fp * PER, this.fp * PER + PER).forEach((f, i) => {
                    const on = Date.now() - (f.lastSeen || 0) < 90000;
                    D(btn(this, W / 2 + (i - 1.5) * 214, 392, `${on ? '🟢' : '⚫'} 邀請 ${(f.name || '好友').slice(0, 6)}`,
                        () => this.ref.update({ inv: firebase.firestore.FieldValue.arrayUnion(f.uid) }).catch(onErr), on ? '#b0508a' : '#5a4a5a', 13, { w: 190 }));
                });
                if (pages > 1) {
                    D(btn(this, 70, 392, '◀', () => { this.fp = (this.fp + pages - 1) % pages; this.render(); }, '#3a4a7a', 14, { w: 44 }));
                    D(btn(this, W - 70, 392, '▶', () => { this.fp = (this.fp + 1) % pages; this.render(); }, '#3a4a7a', 14, { w: 44 }));
                }
            } else if (slots.length >= 4) T(W / 2, 392, '人數已滿', { fontSize: '14px', color: '#9bb4ee' });
            else T(W / 2, 392, '沒有可邀請的好友了（先到【帳號設定 → 好友】加好友）', { fontSize: '13px', color: '#8da2cc' });
        }
        const ip = infoPill(this, W / 2, 446, '大家在同一張地圖、打同一批怪（由房主的手機運算）　隊友都存活時全員傷害 +10%　隊友倒下時存活者回復 25% 血量\n人數越多怪越多、越硬　全員陣亡才結束　結算各得 🎟+1 🪙+100　將使用你在【出發準備】裝備的角色、武器與被動',
            { fontSize: '12px', color: '#9bb4ee', align: 'center', lineSpacing: 5 }, { w: 880 });
        D(ip.g); D(ip.t);
        // ---- 開始 / 等待 ----
        const ready = mem.length >= 2 && this.rt === 'ok';
        if (isHost) {
            const label = this.rt === 'err' ? '⚠ ' + this.msg : this.rt !== 'ok' ? '連線伺服器中…' : mem.length < 2 ? '等待隊友加入…' : `▶ 開始連機（${mem.length} 人）`;
            D(btn(this, W / 2, 498, label, async () => {
                if (!ready) return;
                const order = [r.host].concat(mem.filter(x => x.uid !== r.host).map(x => x.uid));
                try { await this.ref.update({ status: 'playing', order }); } catch (e) { this.msg = e.message; this.render(); }
            }, ready ? '#2a7de1' : '#444a5a', 20, { w: 300 }));
        } else T(W / 2, 498, this.rt === 'err' ? '⚠ ' + this.msg : '等待房主開始…', { fontSize: '18px', color: '#9bb4ee', fontStyle: 'bold' });
    }
    countdown(r) {
        const t = this.add.text(W / 2, 498, '', { fontSize: '30px', color: '#ffd700', fontStyle: 'bold', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5).setDepth(10);
        const go = Date.now() + 3000, m = r.m || {};
        const ev = this.time.addEvent({ delay: 100, loop: true, callback: () => {
            const left = go - Date.now();
            if (left > 0) { t.setText('連機開始 ' + Math.ceil(left / 1000)); return; }
            ev.remove();
            const names = {}; (r.order || []).forEach(u => { names[u] = m[u] || { name: '玩家' }; });
            this.scene.start('GameScene', { c: S.sel.c, w: S.sel.w, p: S.sel.p, coop: { rid: this.rid, role: r.host === me() ? 'host' : 'guest', uids: r.order, names } });
        } });
    }
}

// ============================================================
//  多人戰鬥引擎：房主的手機計算怪物 / 星球 / 飛船 / 衛星 / BOSS，其他人看到同一批
//   ‧ 每個人：自己的移動、攻擊、升級、血量都在自己手機上算（操作不會有延遲）
//   ‧ 隊友：看得到位置、名字、血量、射出的子彈
//   ‧ 隊友打到怪：把傷害回報給房主，房主扣血；怪死掉時每個人都掉經驗寶石
//   ‧ 有人倒下：變成觀戰；全員陣亡才結算
//   ‧ 連機中沒有信使與時空裂縫；BOSS 改成每 30 秒有機會直接降臨
// ============================================================
const KINDS = Object.keys(ENEMY_TYPES).concat('boss');
const TICK = 100, STALE = 8000;
const r1 = (v) => Math.round(v);
const mpPush = (s, o) => { const mp = s.mp; o.n = ++mp.evN; mp.evlog.push({ ts: Date.now(), o }); };

// ---------- 隊友 ----------
function peerOf(s, uid) {
    const mp = s.mp; let p = mp.peers[uid];
    if (!p) {
        const nm = mp.names[uid] || {};
        p = mp.peers[uid] = { uid, name: nm.name || '隊友', avatar: nm.avatar, title: nm.title, c: 0, x: 0, y: 0, hp: 1, mhp: 1, lv: 1, k: 0, alive: true, recv: Date.now(), q: -1, spr: null, lbl: null, wasAlive: true, offline: false };
    }
    return p;
}
function applyPeer(s, uid, v) {
    if (!v) return;
    const p = peerOf(s, uid);
    p.recv = Date.now(); p.x = v.x || 0; p.y = v.y || 0; p.hp = v.h || 0; p.mhp = v.m || 1; p.lv = v.l || 1; p.k = v.k || 0; p.alive = !!v.a; p.c = v.c || 0;
    if (!p.alive) p.offline = false;
    if (!p.spr) {
        p.spr = s.add.image(p.x, p.y, s.textures.exists('hero' + p.c) ? 'hero' + p.c : 'hero0').setDepth(10);
        p.lbl = s.add.text(p.x, p.y - 52, p.name, { fontSize: '12px', color: '#9fe3ff', fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(21);
    }
    if (v.s && v.q !== p.q) v.s.forEach(sh => remoteShot(s, sh));
    p.q = v.q;
}
function remoteShot(s, sh) {                       // 隊友射出的子彈：只是畫面效果，不會碰撞
    const mp = s.mp; if (mp.vis > 40) return;
    const x = sh[0], y = sh[1], a = sh[2], col = sh[3], spd = sh[4] || 600, rng = sh[5] || 400;
    const b = s.add.circle(x, y, 8, col).setStrokeStyle(2, 0xffffff).setDepth(149).setAlpha(0.85); mp.vis++;
    s.tweens.add({ targets: b, x: x + Math.cos(a) * rng, y: y + Math.sin(a) * rng, duration: Math.max(100, rng / spd * 1000), onComplete: () => { b.destroy(); mp.vis--; } });
}
function smoothPeers(s, delta) {
    const k = 1 - Math.exp(-delta / 80), now = Date.now();
    Object.values(s.mp.peers).forEach(p => {
        if (!p.spr) return;
        const show = p.alive && now - p.recv < STALE;
        p.spr.setVisible(show); p.lbl.setVisible(show);
        p.spr.x += (p.x - p.spr.x) * k; p.spr.y += (p.y - p.spr.y) * k;
        p.lbl.setPosition(p.spr.x, p.spr.y - 52);
    });
}
const alivePeers = (s) => { const now = Date.now(); return Object.values(s.mp.peers).filter(p => p.alive && now - p.recv < STALE); };
const aliveOthers = (s) => alivePeers(s).length > 0;
// 所有還活著的玩家位置（房主用來決定怪物追誰、在誰附近生成）
function targetsPos(s) {
    const mp = s.mp, out = [];
    if (!mp.dead) out.push({ x: s.player.x, y: s.player.y });
    alivePeers(s).forEach(p => { if (p.spr) out.push({ x: p.spr.x, y: p.spr.y }); });
    return out;
}
function nearestOf(list, x, y) {
    let best = null, min = 1e12;
    list.forEach(q => { const d = (q.x - x) * (q.x - x) + (q.y - y) * (q.y - y); if (d < min) { min = d; best = q; } });
    return best;
}
const pickPos = (s) => { const l = targetsPos(s); return l.length ? l[Math.floor(Math.random() * l.length)] : null; };
// 讓原本「以玩家為中心」的生成函式改以指定玩家為中心（暫時換掉 s.player，只讀 x / y）
function withTarget(s, fn) {
    const tg = pickPos(s); if (!tg) return;
    const real = s.player, up = s.isUpgrading;
    s.player = { x: tg.x, y: tg.y }; s.isUpgrading = false;
    try { fn(); } finally { s.player = real; s.isUpgrading = up; }
}

// ---------- 初始化 ----------
function initMP(s, c) {
    const myId = me(), isHost = c.role === 'host', ref = rdb().ref('games/' + c.rid);
    const mp = s.mp = {
        rid: c.rid, me: myId, host: isHost, ref, uids: c.uids || [myId], names: c.names || {}, peers: {},
        evN: 0, evlog: [], lastEv: 0, nid: 0, seq: 0, lastN: 0, q: 0, byId: new Map(), vis: 0,
        g: { e: new Map(), s: new Map(), pl: new Map(), sh: new Map(), b: new Map() }, deadB: new Set(),
        hitBuf: [], shots: [], dead: false, finished: false, finalT: null, buff: false, hostT: 0, lastSnap: Date.now() + 6000, unsubs: []
    };
    mp.uids.forEach(u => { if (u !== myId) peerOf(s, u); });
    const idx = Math.max(0, mp.uids.indexOf(myId)), a0 = idx * Math.PI / 2;
    s.player.setPosition(Math.cos(a0) * 50, Math.sin(a0) * 50);

    // 隊友資訊面板
    mp.hudG = s.add.graphics().setScrollFactor(0).setDepth(199);
    mp.hudT = [0, 1, 2].map(() => s.add.text(0, 0, '', { fontSize: '12px', color: '#e6eeff' }).setScrollFactor(0).setDepth(200));

    // 訂閱：所有人的位置 / 血量
    const onP = (sn) => { if (sn.key !== myId) applyPeer(s, sn.key, sn.val()); };
    ref.child('p').on('child_added', onP); ref.child('p').on('child_changed', onP);
    mp.unsubs.push(() => { ref.child('p').off('child_added', onP); ref.child('p').off('child_changed', onP); });
    ref.child('p/' + myId).onDisconnect().remove();

    if (isHost) {
        ref.child('host').set(myId).catch(() => {});
        mp.uids.forEach(u => {                       // 接收隊友回報的傷害
            if (u === myId) return;
            const r = ref.child('hit/' + u), h = (sn) => {
                const v = sn.val(); sn.ref.remove().catch(() => {});
                if (!v || !v.h) return;
                v.h.forEach(it => hostApplyHit(s, mp.byId.get(it[0]), Math.min(+it[1] || 0, 5000), u));
            };
            r.on('child_added', h); mp.unsubs.push(() => r.off('child_added', h));
        });
    } else {
        const h = (sn) => applySnap(s, sn.val());
        ref.child('snap').on('value', h); mp.unsubs.push(() => ref.child('snap').off('value', h));
    }
    s.time.addEvent({ delay: TICK, loop: true, callback: () => mpTick(s) });
    s.events.once('shutdown', () => {
        mp.unsubs.forEach(f => { try { f(); } catch (e) {} });
        try { ref.child('p/' + myId).remove(); if (isHost) ref.child('snap').remove(); } catch (e) {}
        s.mp = null;
    });
}

// ---------- 每 0.1 秒的同步 ----------
function pushSelf(s) {
    const mp = s.mp, p = s.player;
    const v = { x: r1(p.x), y: r1(p.y), h: Math.max(0, Math.ceil(s.hp)), m: s.maxHp, l: s.level, k: s.kills, a: mp.dead ? 0 : 1, c: s.char.id, q: ++mp.q };
    if (mp.shots.length) { v.s = mp.shots; mp.shots = []; }
    mp.ref.child('p/' + mp.me).set(v).catch(onErr);
}
function mpTick(s) {
    const mp = s.mp; if (!mp) return;
    const now = Date.now();
    pushSelf(s);
    if (mp.host) { if (!mp.finished) sendSnap(s); }
    else {
        if (mp.hitBuf.length) mp.ref.child('hit/' + mp.me).push({ h: mp.hitBuf.splice(0, 80) }).catch(onErr);
        if (!mp.finished && now - mp.lastSnap > STALE) { s.banner('房主已離線', '#ff9a9a'); finishCoop(s); }
    }
    Object.values(mp.peers).forEach(p => {
        if (p.alive && now - p.recv > STALE) { p.alive = false; p.offline = true; }
        if (p.wasAlive && !p.alive) {
            p.wasAlive = false;
            if (!s.isGameOver) { s.banner(p.offline ? p.name + ' 已離線' : p.name + ' 倒下了！堅持住！', '#ff9a9a'); if (!mp.dead) s.hp = Math.min(s.maxHp, s.hp + s.maxHp * 0.25); }
        }
    });
    const list = Object.values(mp.peers);
    mp.buff = !mp.dead && list.length > 0 && list.every(p => p.alive && now - p.recv < STALE);
    updateCoHud(s);
    if (mp.dead && !mp.finished && !aliveOthers(s)) finishCoop(s);
}
function updateCoHud(s) {
    const mp = s.mp, g = mp.hudG, list = Object.values(mp.peers).slice(0, 3);
    g.clear(); mp.hudT.forEach(t => t.setText(''));
    if (!list.length) return;
    drawPanel(g, W - 244, 20, 232, 10 + list.length * 38, { r: 10, a: 0.74, bw: 1, stroke: mp.buff ? 0x44dd77 : 0x3b5a96 });
    list.forEach((p, i) => {
        const y = 28 + i * 38, ratio = Phaser.Math.Clamp(p.hp / (p.mhp || 1), 0, 1);
        g.fillStyle(0x000000, 0.7).fillRect(W - 232, y + 18, 150, 7).fillStyle(ratio > 0.5 ? 0x44dd55 : ratio > 0.25 ? 0xffcc22 : 0xff3333, 1).fillRect(W - 232, y + 18, 150 * ratio, 7);
        const st = !p.alive ? (p.offline ? '⚠離線' : '☠陣亡') : '';
        mp.hudT[i].setPosition(W - 232, y).setText(`${avText(p.avatar)} ${(p.name || '').slice(0, 6)}　Lv${p.lv}　💀${p.k}　${st}`);
    });
}

// ---------- 房主：打包世界狀態送出 ----------
function sendSnap(s) {
    const mp = s.mp, pos = targetsPos(s), now = Date.now();
    const near = (o) => { if (!pos.length) return true; const q = nearestOf(pos, o.x, o.y); return Math.hypot(o.x - q.x, o.y - q.y) < 1300; };
    mp.byId.clear();
    const E = [], SA = [], PL = [], SH = [], B = [];
    s.enemies.getChildren().forEach(e => {
        if (!e.active || !near(e) || E.length >= 220) return;
        if (!e.id) e.id = ++mp.nid; mp.byId.set(e.id, e);
        E.push([e.id, e.isBoss ? KINDS.length - 1 : KINDS.indexOf(e.kind), r1(e.x), r1(e.y), Math.max(1, r1(e.hp / e.maxHp * 100))]);
    });
    s.sats.getChildren().forEach(o => {
        if (!o.active || !near(o)) return;
        if (!o.id) o.id = ++mp.nid; mp.byId.set(o.id, o);
        SA.push([o.id, r1(o.x), r1(o.y), Math.max(1, r1(o.hp / o.maxHp * 100))]);
    });
    s.planets.getChildren().forEach(o => {
        if (!o.active) return;
        if (!o.id) o.id = ++mp.nid;
        PL.push([o.id, +o.texture.key.slice(6), r1(o.x), r1(o.y)]);
    });
    s.ships.getChildren().forEach(o => {
        if (!o.active) return;
        if (!o.id) o.id = ++mp.nid;
        SH.push([o.id, r1(o.x), r1(o.y), Math.round(o.rotation * 100) / 100]);
    });
    s.eBullets.getChildren().forEach(b => {
        if (!b.active || B.length >= 160) return;
        if (!b.id) b.id = ++mp.nid;
        B.push([b.id, r1(b.x), r1(b.y), b.radius, b.fillColor, b.dmg, b.slow ? 1 : 0]);
    });
    mp.evlog = mp.evlog.filter(x => now - x.ts < 1600);
    const snap = { t: r1(s.elapsed), n: ++mp.seq, e: E, s: SA, pl: PL, sh: SH, b: B, v: mp.evlog.map(x => x.o) };
    mp.ref.child('snap').set(snap).catch(onErr);
}
function hostApplyHit(s, e, dmg, uid) {
    if (!e || !e.active || !(dmg > 0)) return;
    e.lastBy = uid; e.hp -= dmg;
    e.setTintFill(0xffffff); s.time.delayedCall(60, () => { if (e.active) e.clearTint(); });
    if (e.hp <= 0) s.killEnemy(e);
}

// ---------- 隊友：把房主的世界畫出來 ----------
function applySnap(s, d) {
    const mp = s.mp; if (!d || d.n <= mp.lastN) return;
    mp.lastN = d.n; mp.lastSnap = Date.now(); mp.hostT = d.t;
    if (Math.abs(s.elapsed - d.t) > 600) s.elapsed = d.t;
    const t = d.t / 1000, dm = 1 + t / DMG_GROWTH_SEC;
    const place = (o, x, y) => { o.tx = x; o.ty = y; };
    // 敵人（含 BOSS）
    (function () {
        const map = mp.g.e, seen = new Set();
        (d.e || []).forEach(en => {
            const id = en[0]; seen.add(id); let o = map.get(id);
            if (o && !o.active) { map.delete(id); o = null; }
            if (!o) {
                const kind = KINDS[en[1]]; if (!kind) return;
                if (kind === 'boss') {
                    o = s.enemies.create(en[2], en[3], 'boss').setDepth(12); o.body.setCircle(52, 28, 28);
                    Object.assign(o, { isBoss: true, r: 54, gem: 10, maxHp: 100, contact: Math.round(20 * dm), keep: 0, speed: 0 }); s.boss = o; s.bossActive = true;
                } else {
                    const T = ENEMY_TYPES[kind], S2 = T.r * 2 + 18;
                    o = s.enemies.create(en[2], en[3], 'e_' + kind).setDepth(10); o.body.setCircle(T.r, S2 / 2 - T.r, S2 / 2 - T.r);
                    Object.assign(o, { kind, r: T.r, gem: T.gem, maxHp: 100, contact: Math.max(1, Math.round(T.contact * dm)), dmg: Math.round(T.dmg * dm), keep: 0, speed: 0 });
                }
                o.id = id; map.set(id, o);
            }
            o.hp = en[4]; place(o, en[2], en[3]);
        });
        map.forEach((o, id) => { if (!seen.has(id)) { if (o.active) { if (o.isBoss) { s.boss = null; s.bossActive = false; } o.destroy(); } map.delete(id); } });
    })();
    // 衛星
    (function () {
        const map = mp.g.s, seen = new Set();
        (d.s || []).forEach(en => {
            const id = en[0]; seen.add(id); let o = map.get(id);
            if (o && !o.active) { map.delete(id); o = null; }
            if (!o) {
                o = s.sats.create(en[1], en[2], 'sat').setDepth(8); o.body.setCircle(14, 10, 10);
                Object.assign(o, { maxHp: 100, r: 14, gem: SAT_EXP, isSat: true, id }); map.set(id, o);
            }
            o.hp = en[3]; place(o, en[1], en[2]);
        });
        map.forEach((o, id) => { if (!seen.has(id)) { if (o.active) o.destroy(); map.delete(id); } });
    })();
    // 星球（引力在隊友自己的手機上計算）
    (function () {
        const map = mp.g.pl, seen = new Set();
        (d.pl || []).forEach(en => {
            const id = en[0]; seen.add(id); let o = map.get(id);
            if (o && !o.active) { map.delete(id); o = null; }
            if (!o) {
                const P = PLANETS[en[1]]; if (!P) return;
                o = s.planets.create(en[2], en[3], 'planet' + en[1]).setDepth(3); const br = P.r * 0.9;
                o.body.setCircle(br, P.T / 2 - br, P.T / 2 - br);
                Object.assign(o, { pr: P.r, str: planetStrength(P.r), reach: planetReach(P.r), dmg: Math.round(12 * (1 + t / DMG_GROWTH_SEC)), id }); map.set(id, o);
            }
            place(o, en[2], en[3]);
        });
        map.forEach((o, id) => { if (!seen.has(id)) { if (o.active) o.destroy(); map.delete(id); } });
    })();
    // 飛船
    (function () {
        const map = mp.g.sh, seen = new Set();
        (d.sh || []).forEach(en => {
            const id = en[0]; seen.add(id); let o = map.get(id);
            if (o && !o.active) { map.delete(id); o = null; }
            if (!o) {
                o = s.ships.create(en[1], en[2], 'ship').setDepth(12); o.body.setCircle(12, 20, 20); o.setRotation(en[3]);
                o.dmg = Math.round(10 * (1 + t / DMG_GROWTH_SEC)); o.id = id; map.set(id, o);
            }
            place(o, en[1], en[2]);
        });
        map.forEach((o, id) => { if (!seen.has(id)) { if (o.active) o.destroy(); map.delete(id); } });
    })();
    // 敵方子彈（被我擋掉的子彈記在 deadB，不再重畫）
    (function () {
        const map = mp.g.b, seen = new Set();
        (d.b || []).forEach(en => {
            const id = en[0]; seen.add(id); let o = map.get(id);
            if (o && !o.active) { map.delete(id); mp.deadB.add(id); return; }
            if (!o) {
                if (mp.deadB.has(id)) return;
                o = s.add.circle(en[1], en[2], en[3], en[4]).setStrokeStyle(2, 0xffffff).setDepth(40);
                s.physics.add.existing(o); o.body.setCircle(en[3]);
                o.dmg = en[5]; o.slow = !!en[6]; o.id = id; s.eBullets.add(o); map.set(id, o);
            }
            place(o, en[1], en[2]);
        });
        map.forEach((o, id) => { if (!seen.has(id)) { if (o.active) o.destroy(); map.delete(id); } });
        if (mp.deadB.size > 600) mp.deadB.clear();
    })();
    (d.v || []).forEach(ev => { if (ev.n > mp.lastEv) { mp.lastEv = ev.n; handleEv(s, ev); } });
}
function smoothGhosts(s, delta) {
    const k = 1 - Math.exp(-delta / 70), g = s.mp.g;
    [g.e, g.s, g.pl, g.sh, g.b].forEach(m => m.forEach(o => {
        if (!o.active || o.tx === undefined) return;
        o.x += (o.tx - o.x) * k; o.y += (o.ty - o.y) * k;
    }));
}

// ---------- 事件（怪物死亡 / 法師爆炸 / 預警線 / BOSS）：每個人都會處理 ----------
function creditKill(s, gem, st) {
    s.kills++; s.coinF += st ? 1 : Math.max(1, Math.round(gem));
    if (s.ps.heal) s.hp = Math.min(s.maxHp, s.hp + s.ps.heal);
    if (s.skOn && s.char.trait === 'frenzy' && ++s.frenzyKills % s.frenzyNeed === 0) s.frenzyUntil = s.elapsed + s.frenzyDur;
}
function drawWarn(s, x, y, a, len, w, al) {
    const g = s.add.graphics().setDepth(2);
    g.lineStyle(w, 0xff3333, al).lineBetween(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len);
    s.tweens.add({ targets: g, alpha: { from: 0.4, to: 1 }, yoyo: true, repeat: 2, duration: 140 });
    s.time.delayedCall(850, () => g.destroy());
}
function doMage(s, ev) {
    const ring = s.add.circle(ev.x, ev.y, 70, 0xb066ff, 0.2).setStrokeStyle(2, 0xb066ff).setDepth(4);
    s.tweens.add({ targets: ring, alpha: 0.8, duration: 900 });
    s.time.delayedCall(900, () => {
        ring.destroy();
        const boom = s.add.circle(ev.x, ev.y, 70, 0xffffff, 0.6).setDepth(6);
        s.tweens.add({ targets: boom, alpha: 0, duration: 250, onComplete: () => boom.destroy() });
        if (!s.isGameOver && s.mp && !s.mp.dead && Phaser.Math.Distance.Between(s.player.x, s.player.y, ev.x, ev.y) < 84) s.takeDamage(ev.d);
    });
}
function handleEv(s, ev) {
    const mp = s.mp;
    if (ev.t === 'k') {
        const o = mp.g.e.get(ev.id) || mp.g.s.get(ev.id);
        if (o) { if (o.active) o.destroy(); mp.g.e.delete(ev.id); mp.g.s.delete(ev.id); }
        const fx = s.add.circle(ev.x, ev.y, ev.r, 0xffffff, 0.8).setDepth(6);
        s.tweens.add({ targets: fx, scale: 2.2, alpha: 0, duration: 250, onComplete: () => fx.destroy() });
        if (!mp.dead) {                                                // 每個還活著的人都拿到經驗寶石
            const g = s.add.circle(ev.x, ev.y, ev.st ? 4 : ev.g > 1 ? 9 : 6, ev.st ? 0xffe066 : 0x00ff88).setDepth(5);
            s.physics.add.existing(g); g.val = ev.g; s.gems.add(g);
        }
        if (ev.by === mp.me) creditKill(s, ev.g, !!ev.st);
    } else if (ev.t === 'bd') {
        const fx = s.add.circle(ev.x, ev.y, 54, 0xffffff, 0.8).setDepth(6);
        s.tweens.add({ targets: fx, scale: 2.2, alpha: 0, duration: 250, onComplete: () => fx.destroy() });
        const o = mp.g.e.get(ev.id); if (o) { if (o.active) o.destroy(); mp.g.e.delete(ev.id); }
        if (ev.by === mp.me) creditKill(s, 10, false);
        if (!mp.dead) s.onBossDefeated({ x: ev.x, y: ev.y });
        else { s.bossActive = false; s.boss = null; s.bossTint.setVisible(false); }
    } else if (ev.t === 'm') doMage(s, ev);
    else if (ev.t === 'w') drawWarn(s, ev.x, ev.y, ev.a, 1500, 26, 0.22);
    else if (ev.t === 'bt') drawWarn(s, ev.x, ev.y, ev.a, 900, 34, 0.28);
    else if (ev.t === 'bn') {
        s.bossActive = true; s.bossTint.setVisible(true);
        s.banner(ev.m, ev.c); s.cameras.main.flash(500, 150, 40, 255);
    }
}

// ---------- 倒下 / 結算 ----------
function enterSpectate(s) {
    s.resetJoystick(); s.aimGfx.clear(); s.isInvincible = true;
    s.player.setVisible(false); s.player.body.setVelocity(0, 0); s.player.body.enable = false;
    s.orbs.getChildren().forEach(o => { o.setVisible(false); if (o.body) o.body.enable = false; });
    s.banner('你倒下了，觀戰中…（隊友存活就不會結束）', '#ff9a9a');
}
function spectateTick(s, delta) {
    const mp = s.mp; mp.specT = (mp.specT || 0) + delta;
    if (mp.specT < 800) return; mp.specT = 0;
    if (mp.follow && mp.follow.alive && mp.follow.spr) return;
    const t = alivePeers(s).find(p => p.spr);
    if (t) { mp.follow = t; s.cameras.main.startFollow(t.spr, true, 0.1, 0.1); }
}
function finishCoop(s) {
    const mp = s.mp; if (!mp || mp.finished) return;
    mp.finished = true;
    if (!mp.dead) { mp.dead = true; mp.finalT = Math.floor(s.elapsed / 1000); }
    pushSelf(s);
    s.cfg = { c: s.cfg.c, w: s.cfg.w, p: s.cfg.p };                                  // 「再來一次」改回單人模式
    _gameOver.call(s);
    S.coopRuns = (S.coopRuns || 0) + 1; S.tickets += 1; S.coins += 100; save(); pushProfile();   // 連機獎勵
    const t = s.add.text(W / 2, H - 14, '', { fontSize: '12px', color: '#9fe3ff' }).setOrigin(0.5).setScrollFactor(0).setDepth(999);
    const upd = () => { t.setText('🤝 連機獎勵：🎟+1　🪙+100　' + Object.values(mp.peers).map(p => `${p.name} Lv${p.lv} 💀${p.k}`).join('　')); };
    upd(); s.time.addEvent({ delay: 1000, loop: true, callback: upd });
}

// ---------- 主迴圈（連機時取代原本的 update）----------
function mpUpdate(s, time, delta) {
    const mp = s.mp, cam = s.cameras.main, dt = delta / 1000;
    s.bg.tilePositionX = cam.scrollX * 0.5; s.bg.tilePositionY = cam.scrollY * 0.5;
    s.stars.tilePositionX = cam.scrollX * 0.9; s.stars.tilePositionY = cam.scrollY * 0.9;
    s.drawBars();
    smoothPeers(s, delta);
    if (!mp.host) smoothGhosts(s, delta);
    if (s.isGameOver) { s.player.body.setVelocity(0, 0); return; }
    s.elapsed += delta;                                           // 連機時就算有人在選升級，世界也不會停
    const sec = Math.floor(s.elapsed / 1000);
    if (sec !== s.lastSec) { s.lastSec = sec; if (mp.host) hostCull(s); }
    if (s.elapsed - s.lastUi > 150) { s.lastUi = s.elapsed; s.updateUI(); }
    if (mp.dead) spectateTick(s, delta); else ownTick(s, delta, dt);
    if (mp.host) hostWorld(s);
}
function ownTick(s, delta, dt) {
    const p = s.player, mp = s.mp;
    if (!s.isUpgrading) {
        if (s.ps.regen) s.hp = Math.min(s.maxHp, s.hp + s.ps.regen * dt);
        s.skillTick();
        let want = s.elapsed < s.frenzyUntil ? s.attackDelay * 0.75 : s.attackDelay;
        if (s.spaceKey.isDown) want *= 0.85;
        if (s.attackTimer.delay !== want) s.attackTimer.delay = want;
        const slowed = s.elapsed < s.slowUntil;
        if (slowed) { p.setTint(0x88ccff); s.slowShown = true; } else if (s.slowShown) { p.clearTint(); s.slowShown = false; }
        let vx = 0, vy = 0;
        if (s.cursors.left.isDown || s.wasd.left.isDown) vx -= 1;
        if (s.cursors.right.isDown || s.wasd.right.isDown) vx += 1;
        if (s.cursors.up.isDown || s.wasd.up.isDown) vy -= 1;
        if (s.cursors.down.isDown || s.wasd.down.isDown) vy += 1;
        const mv = new Phaser.Math.Vector2(vx, vy);
        if (mv.lengthSq() > 0) mv.normalize();
        if (s.joystickDir.x !== 0 || s.joystickDir.y !== 0) mv.set(s.joystickDir.x, s.joystickDir.y);
        mv.scale(s.moveSpeed * (slowed ? 0.55 : 1) * (s.elapsed < s.galeUntil ? 1.2 + 0.04 * s.sl : 1));
        const g0 = s.pullAt(p.x, p.y);
        p.body.setVelocity(mv.x + g0.x, mv.y + g0.y);
    } else p.body.setVelocity(0, 0);
    if (s.wp.type === 'orbit') {
        s.orbA += delta * 0.004 * (1 + 0.03 * wmetaOf(s.wp.id).rate);
        s.orbs.getChildren().forEach((o, i) => { const a = s.orbA + i * 2 * Math.PI / s.wn; o.setPosition(p.x + Math.cos(a) * s.orbR, p.y + Math.sin(a) * s.orbR); });
    }
    const bend = (b) => { const g = s.pullAt(b.x, b.y); b.body.velocity.x += g.x * dt * 3; b.body.velocity.y += g.y * dt * 3; };
    s.bullets.getChildren().slice().forEach(b => {
        if (!b.active) return;
        if (Phaser.Math.Distance.Between(b.startX, b.startY, b.x, b.y) >= s.bulletRange) { b.destroy(); return; }
        bend(b);
    });
    if (mp.host) s.eBullets.getChildren().forEach(b => { if (b.active) bend(b); });
    const mg = 120 * (s.ps.magnet || 1);
    s.gems.getChildren().forEach(g => {
        if (!g.active) return;
        if (Phaser.Math.Distance.Between(p.x, p.y, g.x, g.y) < mg) s.physics.moveToObject(g, p, 240); else g.body.setVelocity(0, 0);
        const gp = s.pullAt(g.x, g.y); g.body.velocity.x += gp.x; g.body.velocity.y += gp.y;
    });
}
// 房主：怪物追「最近的活著的玩家」
function hostWorld(s) {
    const pos = targetsPos(s);
    s.enemies.getChildren().forEach(e => {
        if (!e.active) return;
        const tg = pos.length ? nearestOf(pos, e.x, e.y) : null;
        if (!tg) { e.body.setVelocity(0, 0); return; }
        if (e.isBoss) { s.bossUpdate(e, tg); return; }
        const d = Phaser.Math.Distance.Between(e.x, e.y, tg.x, tg.y);
        if (!e.keep) s.physics.moveToObject(e, tg, e.speed);
        else {
            if (d > e.keep + 40) s.physics.moveToObject(e, tg, e.speed);
            else if (d < e.keep - 60) s.physics.velocityFromRotation(Phaser.Math.Angle.Between(tg.x, tg.y, e.x, e.y), e.speed, e.body.velocity);
            else e.body.setVelocity(0, 0);
            if (s.elapsed >= e.nextShot && d < e.range) { s.enemyAttack(e); e.nextShot = s.elapsed + e.rate; }
        }
        const g = s.pullAt(e.x, e.y); e.body.velocity.x += g.x; e.body.velocity.y += g.y;
    });
}
function hostCull(s) {
    const pos = targetsPos(s); if (!pos.length) return;
    [s.planets, s.ships, s.sats].forEach(g => g.getChildren().slice().forEach(o => {
        const q = nearestOf(pos, o.x, o.y);
        if (Math.hypot(o.x - q.x, o.y - q.y) > 1600) o.destroy();
    }));
}

// ============================================================
//  把連機邏輯接到原本的 GameScene（沒有 this.mp 時完全走原本流程，單人模式不受影響）
// ============================================================
const GP = GameScene.prototype;
const _create = GP.create, _update = GP.update, _fire = GP.fire, _dmgNow = GP.dmgNow, _takeDamage = GP.takeDamage;
const _damageEnemy = GP.damageEnemy, _killEnemy = GP.killEnemy, _gameOver = GP.gameOver, _showUpgradeMenu = GP.showUpgradeMenu;
const _spawnEnemy = GP.spawnEnemy, _spawnPlanet = GP.spawnPlanet, _spawnSat = GP.spawnSat, _spawnShip = GP.spawnShip, _spawnBoss = GP.spawnBoss;
const _spawnNpc = GP.spawnNpc, _rollRift = GP.rollRift, _enemyAttack = GP.enemyAttack, _bossAttack = GP.bossAttack;
const _cullFar = GP.cullFar, _shoot = GP.shoot, _drawBars = GP.drawBars;

GP.create = function (data) {
    _create.call(this, data);
    this.mp = null;
    if (data && data.coop && online()) {
        try { initMP(this, data.coop); }
        catch (e) { onErr(e); this.mp = null; this.banner('連機初始化失敗：' + e.message, '#ff9a9a'); }
    }
};
GP.update = function (time, delta) { if (this.mp) mpUpdate(this, time, delta); else _update.call(this, time, delta); };
GP.fire = function () { if (this.mp && this.mp.dead) return; return _fire.call(this); };
GP.dmgNow = function () { const v = _dmgNow.call(this); return this.mp && this.mp.buff ? v * 1.1 : v; };
GP.takeDamage = function (a) { if (this.mp && (this.mp.dead || this.isUpgrading)) return; return _takeDamage.call(this, a); };
GP.shoot = function (angle, dmg, pierce, chain, speed) {
    const r = _shoot.call(this, angle, dmg, pierce, chain, speed);
    const mp = this.mp; if (mp && mp.shots.length < 10) mp.shots.push([r1(this.player.x), r1(this.player.y), Math.round(angle * 1000) / 1000, this.char.color, speed, this.bulletRange]);
    return r;
};
GP.drawBars = function () {
    _drawBars.call(this);
    const mp = this.mp; if (!mp) return;
    alivePeers(this).forEach(p => { if (p.spr) { const r = p.hp / (p.mhp || 1); this.drawBar(p.spr.x, p.spr.y - 36, 46, r, r > 0.5 ? 0x44dd55 : r > 0.25 ? 0xffcc22 : 0xff3333); } });
};
GP.cullFar = function () { if (this.mp) return; return _cullFar.call(this); };
GP.showUpgradeMenu = function () {
    _showUpgradeMenu.call(this);
    if (this.mp && this.mp.host && !this.isGameOver) this.physics.resume();       // 房主選升級時，大家的世界不能停
};
// 打怪：隊友把傷害回報給房主；房主直接扣血
GP.damageEnemy = function (e, dmg) {
    const mp = this.mp; if (!mp) return _damageEnemy.call(this, e, dmg);
    if (!e.active) return;
    if (mp.host) { e.lastBy = mp.me; return _damageEnemy.call(this, e, dmg); }
    if (Math.random() < this.critRate) { dmg *= this.critMul; this.popText(e.x, e.y - e.r - 14, Math.round(dmg * 10) / 10 + '!', '#ffd24a', 14); }
    e.setTintFill(0xffffff); this.time.delayedCall(60, () => { if (e.active) e.clearTint(); });
    if (e.id) mp.hitBuf.push([e.id, Math.round(dmg * 100) / 100]);
};
// 怪物死亡（只有房主會走到這裡）：廣播給所有人，每個人各自掉經驗寶石
GP.killEnemy = function (e) {
    const mp = this.mp; if (!mp) return _killEnemy.call(this, e);
    if (!mp.host) return;
    if (e.isNpc) { e.destroy(); return; }
    const by = e.lastBy || mp.me, x = r1(e.x), y = r1(e.y);
    const ev = e.isBoss ? { t: 'bd', x, y, by, id: e.id || 0 } : { t: 'k', x, y, r: e.r, g: e.gem, st: e.isSat ? 1 : 0, by, id: e.id || 0 };
    mpPush(this, ev); handleEv(this, ev); e.destroy();
};
GP.gameOver = function () {
    const mp = this.mp; if (!mp) return _gameOver.call(this);
    if (mp.dead || mp.finished) return;
    mp.dead = true; this.hp = 0; mp.finalT = Math.floor(this.elapsed / 1000);
    pushSelf(this);
    if (aliveOthers(this)) enterSpectate(this); else finishCoop(this);
};
// 生成（只有房主做；以隨機一位活著的玩家為中心；人數越多怪越多越硬）
GP.spawnEnemy = function () {
    const mp = this.mp; if (!mp) return _spawnEnemy.call(this);
    if (!mp.host || this.isGameOver || this.bossActive) return;
    const n = Math.max(1, mp.uids.length), before = this.enemies.getLength();
    withTarget(this, () => _spawnEnemy.call(this));
    const arr = this.enemies.getChildren();
    if (arr.length > before) { const e = arr[arr.length - 1], k = 1 + 0.35 * (n - 1); e.hp *= k; e.maxHp *= k; e.id = ++mp.nid; }
    this.spawnTimer.delay = Math.max(250, this.spawnTimer.delay / (1 + 0.5 * (n - 1)));
};
GP.spawnPlanet = function () { const mp = this.mp; if (!mp) return _spawnPlanet.call(this); if (mp.host && !this.isGameOver) withTarget(this, () => _spawnPlanet.call(this)); };
GP.spawnSat = function () { const mp = this.mp; if (!mp) return _spawnSat.call(this); if (mp.host && !this.isGameOver) withTarget(this, () => _spawnSat.call(this)); };
GP.spawnShip = function () {
    const mp = this.mp; if (!mp) return _spawnShip.call(this);
    if (!mp.host || this.isGameOver || this.bossActive || this.elapsed < 20000 || this.ships.countActive() >= 2) return;
    const tg = pickPos(this); if (!tg) return;
    const a0 = Math.random() * Math.PI * 2, pt = { x: tg.x + Math.cos(a0) * 650, y: tg.y + Math.sin(a0) * 650 };
    const ang = Phaser.Math.Angle.Between(pt.x, pt.y, tg.x + Phaser.Math.Between(-160, 160), tg.y + Phaser.Math.Between(-160, 160));
    const ev = { t: 'w', x: r1(pt.x), y: r1(pt.y), a: Math.round(ang * 1000) / 1000 };
    mpPush(this, ev); drawWarn(this, ev.x, ev.y, ev.a, 1500, 26, 0.22);
    this.time.delayedCall(800, () => {
        if (this.isGameOver || this.bossActive || !this.mp) return;
        const o = this.ships.create(pt.x, pt.y, 'ship').setDepth(12);
        o.body.setCircle(12, 20, 20); o.setRotation(ang);
        o.dmg = Math.round(10 * (1 + this.elapsed / 1000 / DMG_GROWTH_SEC));
        this.physics.velocityFromRotation(ang, 300, o.body.velocity);
    });
};
GP.spawnBoss = function () {
    const mp = this.mp; if (!mp) return _spawnBoss.call(this);
    if (!mp.host) return;
    withTarget(this, () => _spawnBoss.call(this));
    const b = this.boss; if (b) { const k = 1 + 0.4 * (Math.max(1, mp.uids.length) - 1); b.hp *= k; b.maxHp *= k; b.id = ++mp.nid; }
};
GP.spawnNpc = function () { if (this.mp) return; return _spawnNpc.call(this); };
GP.rollRift = function () {                      // 連機：不開時空裂縫，改成直接降臨 BOSS
    const mp = this.mp; if (!mp) return _rollRift.call(this);
    if (!mp.host || this.isGameOver || this.bossActive || this.elapsed < 90000 || Math.random() >= RIFT_CHANCE * 1.5) return;
    const ev = { t: 'bn', m: '👹 BOSS 降臨！', c: '#ff5577' };
    mpPush(this, ev); handleEv(this, ev);
    withTarget(this, () => this.spawnBoss());
};
// 敵人攻擊：朝最近的玩家射擊；法師的爆炸圈用事件通知每個人（各自判定自己有沒有被炸到）
GP.enemyAttack = function (e) {
    const mp = this.mp; if (!mp) return _enemyAttack.call(this, e);
    if (!mp.host) return;
    const tg = nearestOf(targetsPos(this), e.x, e.y); if (!tg) return;
    if (e.kind === 'mage') { const ev = { t: 'm', x: r1(tg.x), y: r1(tg.y), d: e.dmg }; mpPush(this, ev); doMage(this, ev); return; }
    const rad = e.kind === 'archer' ? 5 : e.kind === 'control' ? 9 : 7;
    this.enemyBullet(e.x, e.y, Phaser.Math.Angle.Between(e.x, e.y, tg.x, tg.y), e.bspeed, e.dmg, e.kind === 'control' ? 0x66ffff : e.color0, rad, e.kind === 'control');
};
GP.bossAttack = function (e, p) {
    _bossAttack.call(this, e, p);
    const mp = this.mp; if (mp && mp.host && e.state === 'tele') mpPush(this, { t: 'bt', x: r1(e.x), y: r1(e.y), a: Math.round(e.dashAng * 1000) / 1000 });
};

// ============================================================
//  主頁：左上角加入「個人名片」入口（顯示頭像 / 暱稱 / 稱號）
// ============================================================
const _menu = MenuScene.prototype.create;
MenuScene.prototype.create = function () {
    _menu.call(this);
    const p = prof(), t = titleOf(), g = this.add.graphics().setDepth(5);
    drawPanel(g, 12, 12, 250, 48, { r: 12, fill: 0x141d33, stroke: 0x4a6fb5, glow: true });
    avatarObj(this, 40, 36, p.avatar, p.avatar.t === 'c' ? 34 : 30).setDepth(6);
    this.add.text(68, 27, displayName(), { fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0, 0.5).setDepth(6);
    this.add.text(68, 46, `「${t.name}」`, { fontSize: '11px', color: '#ffd24a' }).setOrigin(0, 0.5).setDepth(6);
    const badge = this.add.text(250, 22, '', { fontSize: '12px', color: '#fff', backgroundColor: '#e03a3a', padding: { x: 5, y: 1 } }).setOrigin(1, 0.5).setDepth(8);
    const upd = () => { const n = A.reqs.length + A.invites.length; badge.setText(n ? '❗' + n : '').setVisible(n > 0); };
    upd();
    const on = () => { if (this.scene.isActive()) upd(); };
    window.addEventListener('acctchange', on); this.events.once('shutdown', () => window.removeEventListener('acctchange', on));
    this.add.zone(137, 36, 250, 48).setDepth(9).setInteractive({ useHandCursor: true }).on('pointerdown', () => this.scene.start('AccountScene'));
};

game.scene.add('AccountScene', AccountScene);
game.scene.add('RoomScene', RoomScene);
})();
