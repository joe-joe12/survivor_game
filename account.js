// ============================================================
//  account.js － 帳號設定：暱稱 / 頭像 / 稱號展示 / 好友 / 好友連機
//  ★ 放在 index.html 最底部：<script src="characters.js"></script> 的下一行
//  ★ 好友與連機需要 Google 登入（cloud.js）＋ 在 Firebase 貼上 firestore.rules
//  連機採「同步協力」：雙方各自的戰場，每秒同步狀態，互相看到隊友血量 / 等級 / 擊殺，
//  隊友都還活著時全員傷害 +10%，結算時雙方各得連機獎勵。
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
    A.unsubs.push(d.collection('rooms').where('guest', '==', uid).onSnapshot(s => {
        A.invites = s.docs.map(x => Object.assign({ id: x.id }, x.data())).filter(r => r.status === 'invite' && Date.now() - r.ts < 10 * 60 * 1000); fire();
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
async function createRoom(f) {                     // 房主建立房間並邀請好友
    const ref = db().collection('rooms').doc();
    await ref.set({ host: me(), guest: f.uid, hostName: displayName(), guestName: f.name || '', hostAvatar: prof().avatar, hostTitle: titleOf().name, status: 'invite', ts: Date.now() });
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
                this.D(btn(this, x + w - 44, y, '拒絕', () => db().collection('rooms').doc(row.r.id).update({ status: 'cancelled' }), '#7a3a3a', 13, { w: 70, d: 3 }));
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
//  連機大廳：雙方到齊後由房主開始，3 秒倒數後同時進入戰鬥
// ============================================================
class RoomScene extends Phaser.Scene {
    constructor() { super('RoomScene'); }
    create(data) {
        makeTextures(this); menuBg(this); title(this, '🤝 好友連機');
        this.rid = data.rid; this.role = data.role; this.r = null; this.started = false; this.dyn = [];
        const ref = this.ref = db().collection('rooms').doc(this.rid);
        if (this.role === 'guest') ref.update({ status: 'ready', guestName: displayName(), guestAvatar: prof().avatar, guestTitle: titleOf().name }).catch(onErr);
        this.unsub = ref.onSnapshot(sn => { this.r = sn.data(); this.render(); }, onErr);
        this.events.once('shutdown', () => this.unsub && this.unsub());
        btn(this, 60, 36, '‹ 離開', () => this.leave(), '#444a5a', 14);
        this.render();
    }
    leave() {
        if (this.r && this.r.status !== 'playing') this.ref.update({ status: 'cancelled' }).catch(() => {});
        this.scene.start('AccountScene', { tab: 2 });
    }
    render() {
        this.dyn.forEach(o => o.destroy()); this.dyn = [];
        const r = this.r, D = (o) => { this.dyn.push(o); return o; }; if (!r) return;
        if (r.status === 'cancelled') { D(this.add.text(W / 2, H / 2, '房間已關閉', { fontSize: '26px', color: '#ff9a9a', fontStyle: 'bold' }).setOrigin(0.5)); this.time.delayedCall(1200, () => this.scene.start('AccountScene', { tab: 2 })); return; }
        const ready = r.status === 'ready' || r.status === 'playing';
        const card = (cx, name, av, ttl, ok, label) => {
            D(panel(this, cx, 255, 340, 250, { stroke: ok ? 0x44dd77 : 0x3b5a96, glow: ok, fill: 0x121b31, d: 1 }));
            D(this.add.circle(cx, 200, 44, 0x0b1226).setStrokeStyle(3, 0xffd24a).setDepth(2));
            if (ok) D(avatarObj(this, cx, 200, av, av && av.t === 'c' ? 62 : 54).setDepth(3));
            else D(this.add.text(cx, 200, '❓', { fontSize: '48px' }).setOrigin(0.5).setDepth(3));
            D(this.add.text(cx, 262, ok ? name : '等待中…', { fontSize: '22px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(3));
            D(this.add.text(cx, 292, ok ? `「${ttl || '新手倖存者'}」` : '', { fontSize: '14px', color: '#ffd24a' }).setOrigin(0.5).setDepth(3));
            D(this.add.text(cx, 340, label, { fontSize: '15px', color: ok ? '#7fe3a0' : '#8da2cc', fontStyle: 'bold' }).setOrigin(0.5).setDepth(3));
        };
        card(250, r.hostName, r.hostAvatar, r.hostTitle, true, '房主　✓ 已就緒');
        card(710, r.guestName, r.guestAvatar, r.guestTitle, ready, ready ? '隊友　✓ 已就緒' : '等待隊友接受邀請…');
        D(this.add.text(W / 2, 255, '🤝', { fontSize: '44px' }).setOrigin(0.5).setDepth(3));
        const ip = infoPill(this, W / 2, 430, '同步協力：雙方各自的戰場，每秒同步狀態　隊友都存活時全員傷害 +10%　結算各得 🎟+1 🪙+100\n將使用你在【出發準備】裝備的角色、武器與被動',
            { fontSize: '12px', color: '#9bb4ee', align: 'center', lineSpacing: 5 }, { w: 780 });
        D(ip.g); D(ip.t);
        if (r.status === 'playing') {
            if (!this.started) { this.started = true; this.countdown(r.startAt); }
        } else if (this.role === 'host') {
            D(btn(this, W / 2, 485, ready ? '▶ 開始連機' : '等待隊友…', () => { if (ready) this.ref.update({ status: 'playing', startAt: Date.now() + 3000 }); }, ready ? '#2a7de1' : '#444a5a', 22, { w: 240 }));
        } else D(this.add.text(W / 2, 485, '等待房主開始…', { fontSize: '18px', color: '#9bb4ee' }).setOrigin(0.5));
    }
    countdown(startAt) {
        const t = this.add.text(W / 2, 485, '', { fontSize: '30px', color: '#ffd700', fontStyle: 'bold', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5).setDepth(10);
        const ev = this.time.addEvent({ delay: 100, loop: true, callback: () => {
            const left = (startAt || 0) - Date.now();
            if (left <= 0) { ev.remove(); this.scene.start('GameScene', { c: S.sel.c, w: S.sel.w, p: S.sel.p, coop: { rid: this.rid, role: this.role } }); }
            else t.setText('連機開始 ' + Math.ceil(left / 1000));
        } });
    }
}

// ============================================================
//  戰鬥中的連機功能（包裝原本的 GameScene，不改 index.html）
// ============================================================
const _create = GameScene.prototype.create;
GameScene.prototype.create = function (data) {
    _create.call(this, data);
    this.co = null;
    if (data && data.coop && online()) initCoop(this, data.coop);
};
function initCoop(s, c) {
    const co = s.co = { rid: c.rid, mate: null, buff: false, done: false, downShown: false };
    const ref = db().collection('rooms').doc(c.rid), me_ = c.role === 'host' ? 'st_host' : 'st_guest', mate_ = c.role === 'host' ? 'st_guest' : 'st_host';
    co.unsub = ref.onSnapshot(sn => { const d = sn.data() || {}; co.mate = d[mate_] || null; }, onErr);
    co.push = (extra) => ref.set({ [me_]: Object.assign({
        name: displayName(), avatar: prof().avatar, title: titleOf().name,
        hp: Math.max(0, Math.ceil(s.hp)), maxHp: s.maxHp, lv: s.level, kills: s.kills, t: Math.floor(s.elapsed / 1000), alive: !s.isGameOver, ts: Date.now()
    }, extra || {}) }, { merge: true }).catch(onErr);
    s.coGfx = s.add.graphics().setScrollFactor(0).setDepth(199);
    s.coTxt = s.add.text(W - 236, 26, '🤝 連機中…', { fontSize: '12px', color: '#e6eeff', lineSpacing: 4 }).setScrollFactor(0).setDepth(200);
    co.timer = s.time.addEvent({ delay: 1000, loop: true, callback: () => { co.push(); updateCoHud(s); } });
    co.push();
    s.events.once('shutdown', () => { if (co.unsub) co.unsub(); });
}
function updateCoHud(s) {
    const co = s.co, m = co.mate, fresh = m && Date.now() - m.ts < 15000, g = s.coGfx;
    co.buff = !!(fresh && m.alive && !s.isGameOver);                                  // 隊友都還活著 → 傷害 +10%
    if (m && fresh && !m.alive && !co.downShown && !s.isGameOver) {                    // 隊友倒下：存活者回復 25% 血量
        co.downShown = true; s.banner('隊友倒下了！堅持住！', '#ff9a9a'); s.hp = Math.min(s.maxHp, s.hp + s.maxHp * 0.25);
    }
    g.clear(); drawPanel(g, W - 248, 20, 236, 76, { r: 10, a: 0.74, bw: 1, stroke: co.buff ? 0x44dd77 : 0x3b5a96 });
    if (!m) { s.coTxt.setText('🤝 等待隊友連線…'); return; }
    const ratio = Phaser.Math.Clamp(m.hp / (m.maxHp || 1), 0, 1);
    g.fillStyle(0x000000, 0.7).fillRect(W - 236, 42, 150, 7).fillStyle(ratio > 0.5 ? 0x44dd55 : ratio > 0.25 ? 0xffcc22 : 0xff3333, 1).fillRect(W - 236, 42, 150 * ratio, 7);
    s.coTxt.setText(`${avText(m.avatar)} ${m.name}　「${m.title || ''}」\n\nLv ${m.lv}　💀 ${m.kills}　⏱ ${fmtT(m.t)}\n` + (!fresh ? '⚠ 隊友已離線' : !m.alive ? '☠ 隊友已陣亡' : '✓ 協力加成：傷害 +10%'));
}
const _dmgNow = GameScene.prototype.dmgNow;
GameScene.prototype.dmgNow = function () { return _dmgNow.call(this) * (this.co && this.co.buff ? 1.1 : 1); };

const _gameOver = GameScene.prototype.gameOver;
GameScene.prototype.gameOver = function () {
    _gameOver.call(this);
    const co = this.co; if (!co || co.done) return; co.done = true;
    co.push({ alive: false, done: true, finalT: Math.floor(this.elapsed / 1000) });
    S.coopRuns = (S.coopRuns || 0) + 1; S.tickets += 1; S.coins += 100; save(); pushProfile();   // 連機獎勵
    this.cfg = { c: this.cfg.c, w: this.cfg.w, p: this.cfg.p };                                   // 「再來一次」改回一般模式
    const base = '🤝 連機獎勵：🎟+1　🪙+100', t = this.add.text(W / 2, H / 2 + 204, base + '　（隊友成績等待中…）', { fontSize: '12px', color: '#9fe3ff' }).setOrigin(0.5).setScrollFactor(0).setDepth(999);
    this.time.addEvent({ delay: 1000, loop: true, callback: () => { const m = co.mate; if (m && m.done) t.setText(`${base}　隊友 ${m.name}：存活 ${fmtT(m.finalT || m.t)} · Lv${m.lv} · 💀${m.kills}`); } });
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
