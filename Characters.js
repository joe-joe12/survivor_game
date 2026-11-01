// ============================================================
//  characters.js － 5 個角色卡池 × 每池 40 隻（共 200 隻）＋ 抽獎 / 圖鑑介面升級
//  ★ 放在 index.html 最底部：<script src="cloud.js"></script> 的下一行
//  （必須在主遊戲 <script> 之後載入，index.html 本身不需要其他修改）
// ============================================================

// ---------- 1. 五個系列（卡池） ----------
const POOLS = [
    { name: '星域', hue: 210, bias: {},
      A: ['星塵', '流光', '銀河', '彗尾', '月影', '日冕', '極光', '天穹'], B: ['旅人', '衛士', '術士', '獵手', '先鋒'] },
    { name: '烈焰', hue: 8, bias: { dmg: 1.12, hp: 0.92 },
      A: ['赤炎', '熔岩', '餘燼', '爆焰', '烈陽', '煉獄', '火羽', '焚風'], B: ['戰士', '刀客', '祭司', '騎士', '狂徒'] },
    { name: '深海', hue: 190, bias: { hp: 1.15, spd: 0.95 },
      A: ['潮汐', '珊瑚', '深淵', '碧波', '冰川', '鯨歌', '海霧', '蒼浪'], B: ['潛行者', '歌者', '守望', '漁獵', '領航'] },
    { name: '森靈', hue: 120, bias: { rng: 1.12, spd: 1.05 },
      A: ['青藤', '古樹', '苔蘚', '花影', '林間', '晨露', '蘑菇', '翠葉'], B: ['精靈', '行者', '守衛', '醫者', '射手'] },
    { name: '機械', hue: 280, bias: { dly: 0.92, hp: 1.05 },
      A: ['齒輪', '電路', '鋼鐵', '脈衝', '量子', '核心', '霓虹', '協議'], B: ['單元', '機體', '哨兵', '工程師', '終端'] }
];
const POOL_COUNTS = [14, 12, 8, 5, 1];        // 每池各稀有度數量（常見/稀有/史詩/傳說/秘密）＝ 40

function hsv2hex(h, s, v) {                   // h: 0~360, s/v: 0~1
    const f = (n, k = (n + h / 60) % 6) => v - v * s * Math.max(Math.min(k, 4 - k, 1), 0);
    return (Math.round(f(5) * 255) << 16) | (Math.round(f(3) * 255) << 8) | Math.round(f(1) * 255);
}

// base = 原本的 7 隻（歸在第 1 池，id 不變）；回傳「新增的」角色陣列
function genCharacters(base) {
    base.forEach(c => { c.pool = 0; });
    const out = [];
    POOLS.forEach((P, pi) => {
        const counts = POOL_COUNTS.slice();
        if (pi === 0) base.forEach(c => counts[c.r]--);              // 第 1 池扣掉原本就有的
        const names = []; P.A.forEach(a => P.B.forEach(b => names.push(a + b)));
        let n = 0;
        counts.forEach((cnt, r) => {
            for (let k = 0; k < cnt; k++, n++) {
                // 技能原型：史詩以上用 7 種（天生技能），其餘只用 4 種（需養成）
                const t = base[(n + pi) % (r >= 2 ? base.length : 4)];
                const v = (m) => 1 + (((n * 37 + pi * 11) % 11) - 5) * m;      // 固定小差異（每次載入都一樣）
                const h = ((P.hue + (n * 23) % 60 - 30) + 360) % 360, b = P.bias;
                out.push({
                    name: names[n], r, pool: pi, color: hsv2hex(h, 0.5 + 0.04 * r, 0.95),
                    sides: 3 + ((n + pi) % 8), rot: -Math.PI / 2, ey: 0, angry: pi === 1 || !!t.angry,
                    hp: Math.round((90 + 12 * r) * v(0.02) * (b.hp || 1)),
                    speed: Math.round((175 + 4 * r) * v(0.015) * (b.spd || 1)),
                    dmg: +((1 + 0.06 * r) * v(0.02) * (b.dmg || 1)).toFixed(2),
                    delay: Math.round((820 - 12 * r) * (b.dly || 1)),
                    range: Math.round((440 + 10 * r) * v(0.02) * (b.rng || 1)),
                    trait: t.trait, innate: r >= 2, sk: t.sk,
                    desc: `【${P.name}系列】${t.sk.name}型・` + (r >= 2 ? '天生技能' : '技能需養成')
                });
            }
        });
    });
    return out;
}

// ---------- 2. 把新角色併入遊戲（就地修改原本的 CHARACTERS 陣列） ----------
(function () {
    genCharacters(CHARACTERS.slice()).forEach(c => { c.id = CHARACTERS.length; CHARACTERS.push(c); });
    const ALL = CHARACTERS.length + WEAPONS.length + PASSIVES.length;
    MILESTONES.splice(5, 0, { n: 50, t: 2 }, { n: 100, t: 3 }, { n: 150, t: 4 });   // 中間檔位
    MILESTONES[MILESTONES.length - 1].n = ALL;                                        // 全收集

    // 新角色的貼圖（原 makeTextures 只畫舊的）
    const _mk = makeTextures;
    window.makeTextures = function (scene) {
        _mk(scene);
        CHARACTERS.forEach(c => {
            if (scene.textures.exists('hero' + c.id)) return;
            const g = scene.make.graphics({ x: 0, y: 0, add: false }), cx = 26, cy = 26;
            if (c.r >= 2) g.lineStyle(2, RAR[c.r].c, 0.9).strokeCircle(cx, cy, 25);
            g.fillStyle(c.color, 1).lineStyle(3, 0xffffff, 1); poly(g, cx, cy, 21, c.sides, c.rot);
            eyes(g, cx, cy + c.ey, 6, 4);
            if (c.angry) g.lineStyle(2, 0x111111, 1).lineBetween(cx - 11, cy - 8, cx - 2, cy - 4).lineBetween(cx + 11, cy - 8, cx + 2, cy - 4);
            g.generateTexture('hero' + c.id, 52, 52); g.destroy();
        });
    };

    // ---------- 3. 抽獎：角色卡池切換 ----------
    const _gc = GachaScene.prototype.create;
    GachaScene.prototype.create = function () { this.pool = 0; _gc.call(this); this.drawPools(); this.refreshInfo(); };
    GachaScene.prototype.drawPools = function () {
        (this.poolBtns || []).forEach(b => b.destroy()); this.poolBtns = [];
        POOLS.forEach((P, i) => this.poolBtns.push(btn(this, 150 + i * 125, 156, `${P.name}池`,
            () => { this.pool = i; this.drawPools(); this.refreshInfo(); }, i === this.pool ? '#b0508a' : '#2a3558', 12, { w: 112 })));
    };
    GachaScene.prototype.roll = function (cat, minR) {           // 抽角色時只從選中的卡池抽
        let r = rollRarity(minR); S.pity = r >= 2 ? 0 : S.pity + 1;
        let pool = [];
        while (!pool.length) { pool = cat.list.filter(it => it.r === r && (cat.key !== 'c' || it.pool === this.pool)); if (!pool.length) r--; }
        return Phaser.Utils.Array.GetRandom(pool);
    };
    GachaScene.prototype.refreshInfo = function () {
        const p = this.pool || 0, got = S.uc.filter(id => CHARACTERS[id] && CHARACTERS[id].pool === p).length;
        this.info.setText(`🪙 ${S.coins}　🎟 ${S.tickets}　星塵 ${S.dust}/10　保底 ${S.pity}/30　${POOLS[p].name}池 ${got}/40　總收藏 ${S.uc.length + S.uw.length + S.up.length}/${ALL}`);
    };

    // ---------- 4. 圖鑑：系列篩選 + 分頁 ----------
    CodexScene.prototype.create = function () {
        makeTextures(this); menuBg(this); title(this, '📖 圖鑑');
        this.tab = 0; this.dyn = []; this.picked = -1; this.pool = 0; this.page = 0;
        const tot = S.uc.length + S.uw.length + S.up.length;
        infoPill(this, W / 2, 84, `收集 ${tot}/${ALL}　` + MILESTONES.map(m => `${m.n}件${S.claimed.includes(m.n) ? '✓' : '🎟' + m.t}`).join('　'),
            { fontSize: '12px', color: '#aac4ff', align: 'center', fontStyle: 'bold' }, { w: 920 });
        this.detail = infoPill(this, 770, 300, '點選卡片查看詳情', { fontSize: '14px', color: '#d6e0f5', align: 'center', lineSpacing: 5, wordWrap: { width: 300 } }, { w: 340, minH: 330, d: 5 }).t;
        btn(this, 60, 36, '‹ 返回', () => this.scene.start('MenuScene'), '#444a5a', 14);
        this.draw();
    };
    CodexScene.prototype.draw = function () {
        this.dyn.forEach(o => o.destroy()); this.dyn = [];
        const cat = CATS[this.tab], cw = 130, ch = 120, cols = 4, sx = 25 + cw / 2, PER = 8;
        const all = cat.key === 'c' ? cat.list.filter(it => it.pool === this.pool) : cat.list;
        const pages = Math.max(1, Math.ceil(all.length / PER)); this.page = Math.min(this.page, pages - 1);
        const list = all.slice(this.page * PER, this.page * PER + PER);
        CATS.forEach((c, i) => this.dyn.push(btn(this, 90 + i * 140, 124, c.label, () => { this.tab = i; this.picked = -1; this.page = 0; this.detail.setText('點選卡片查看詳情'); this.draw(); }, i === this.tab ? '#2a7de1' : '#2a3558', 15, { w: 118 })));
        if (cat.key === 'c') POOLS.forEach((P, i) => this.dyn.push(btn(this, 470 + i * 90, 124, P.name, () => { this.pool = i; this.page = 0; this.picked = -1; this.draw(); }, i === this.pool ? '#b0508a' : '#2a3558', 12, { w: 82 })));
        list.forEach((it, i) => {
            let x = sx + (i % cols) * (cw + 10), y = 170 + Math.floor(i / cols) * (ch + 10) + ch / 2, got = S[cat.u].includes(it.id);
            let rc = RAR[it.r].c, sel = this.picked === it.id;
            const g = this.add.graphics().setDepth(1);
            drawPanel(g, x - cw / 2, y - ch / 2, cw, ch, { r: 12, fill: got ? 0x1a2744 : 0x0e1320, stroke: sel ? 0xffffff : got ? rc : 0x2a3040, glow: got || sel });
            if (got) g.fillStyle(rc, 0.9).fillRoundedRect(x - cw / 2 + 10, y + ch / 2 - 10, cw - 20, 3, 1.5);
            let zone = this.add.zone(x, y, cw, ch).setDepth(6).setInteractive({ useHandCursor: true }).on('pointerdown', () => { this.picked = it.id; this.show(cat, it, got); this.draw(); });
            let icon = cat.key === 'c' ? this.add.image(x, y - 20, 'hero' + it.id).setDepth(2) : this.add.text(x, y - 20, it.ic, { fontSize: '36px' }).setOrigin(0.5).setDepth(2);
            if (!got) { if (icon.setTintFill) icon.setTintFill(0x1b2130); else icon.setAlpha(0.15); }
            this.dyn.push(g, zone, icon,
                this.add.text(x, y + 28, got ? it.name : '???', { fontSize: '15px', color: got ? '#fff' : '#555', fontStyle: 'bold' }).setOrigin(0.5).setDepth(2),
                this.add.text(x, y + 47, RAR[it.r].n + (got ? ' ' + starStr(cat.key, it.id) : ''), { fontSize: '11px', color: hex(got ? rc : 0x444444) }).setOrigin(0.5).setDepth(2));
        });
        if (pages > 1) this.dyn.push(
            btn(this, 100, 490, '◀', () => { this.page = (this.page + pages - 1) % pages; this.draw(); }, '#3a4a7a', 16, { w: 52 }),
            btn(this, 310, 490, '▶', () => { this.page = (this.page + 1) % pages; this.draw(); }, '#3a4a7a', 16, { w: 52 }),
            this.add.text(205, 490, `${this.page + 1} / ${pages}`, { fontSize: '14px', color: '#9bb4ee' }).setOrigin(0.5).setDepth(3));
    };
})();
