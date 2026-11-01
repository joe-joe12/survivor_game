// ============================================================
//  cloud.js － Google 登入 + Firestore 雲端存檔（完整版）
//  放在 index.html 的 </script> 之後、</body> 之前載入
// ============================================================
const FIREBASE_CONFIG = {
    // ↓↓↓ 與 Firebase「專案設定 → 你的應用程式」的值一致（appId 已更新）
    apiKey: 'AIzaSyAK4qovtpWpiaOdt-GC8NDes6y53GaNyl8',
    authDomain: 'surivior.firebaseapp.com',
    projectId: 'surivior',
    appId: '1:554138880772:web:d059e5c0d552d431cade51'
};

const Cloud = (() => {
    const st = { user: null, ready: false, status: '' };   // status：給主頁顯示用
    let auth = null, db = null, timer = null, pushing = false;
    const LAST_UID = 'void_last_uid';                      // 記錄這台裝置上次登入的帳號
    const emit = () => window.dispatchEvent(new CustomEvent('cloudchange'));
    const ref = () => db.collection('users').doc(st.user.uid);

    function init() {
        if (!window.firebase || FIREBASE_CONFIG.apiKey.startsWith('YOUR')) { st.status = '尚未設定 Firebase'; return; }
        firebase.initializeApp(FIREBASE_CONFIG);
        auth = firebase.auth(); db = firebase.firestore();
        // 手機改用 redirect 登入時，回來這裡接結果；失敗時顯示錯誤碼，方便除錯
        auth.getRedirectResult().catch((e) => {
            st.status = '登入失敗：' + e.code;
            alert('登入失敗：' + e.code + '\n' + e.message);
        });
        auth.onAuthStateChanged(async (u) => {
            st.user = u; st.ready = true;
            if (u) { try { await pull(); } catch (e) { st.status = '同步失敗：' + e.message; } }
            emit();
        });
        // 切到背景 / 關閉分頁前，把還沒送出的存檔立刻上傳
        document.addEventListener('visibilitychange', () => { if (document.hidden && timer) push(); });
    }

    // 登入：先試彈窗；被擋時（iPhone Safari 常見）跳出真正的網頁按鈕，
    // 由使用者再點一次（真實點擊才能開彈窗）。redirect 只當最後手段。
    function popupLogin() {
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        return auth.signInWithPopup(provider);
    }
    function showLoginDialog() {
        if (document.getElementById('cloud-login-dlg')) return;
        const wrap = document.createElement('div');
        wrap.id = 'cloud-login-dlg';
        wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:sans-serif';
        wrap.innerHTML = '<div style="background:#1b1f3a;border:2px solid #4285f4;border-radius:14px;padding:22px 26px;text-align:center;color:#fff;max-width:80%">'
            + '<div style="font-size:16px;margin-bottom:14px">請點下面的按鈕完成 Google 登入</div>'
            + '<button id="cloud-login-go" style="background:#4285f4;color:#fff;border:0;border-radius:10px;padding:12px 26px;font-size:18px;font-weight:bold">🔐 Google 登入</button>'
            + '<div><button id="cloud-login-cancel" style="margin-top:14px;background:none;color:#aaa;border:0;font-size:14px">取消</button></div></div>';
        document.body.appendChild(wrap);
        const close = () => wrap.remove();
        document.getElementById('cloud-login-cancel').onclick = close;
        document.getElementById('cloud-login-go').onclick = async () => {
            try { await popupLogin(); close(); }
            catch (e) {
                close();
                if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) {
                    try { await auth.signInWithRedirect(new firebase.auth.GoogleAuthProvider()); }
                    catch (e2) { alert('登入失敗：' + e2.code + '\n' + e2.message); }
                } else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
                    alert('登入失敗：' + e.code + '\n' + e.message);
                }
            }
        };
    }
    async function login() {
        if (!auth) { alert('尚未設定 Firebase，請先填入 cloud.js 的 FIREBASE_CONFIG'); return; }
        try { await popupLogin(); }
        catch (e) {
            if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) showLoginDialog();
            else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') alert('登入失敗：' + e.code + '\n' + e.message);
        }
    }

    // 登出：先上傳最後進度，再清掉本機存檔，避免下一個帳號拿到上一個人的進度
    async function logout() {
        if (!auth) return;
        try { if (timer) await push(); } catch (e) {}
        await auth.signOut();
        try { localStorage.removeItem(SKEY); localStorage.removeItem(LAST_UID); } catch (e) {}
        location.reload();
    }

    // 登入後：決定用雲端還是本機
    //  - 雲端沒有存檔 → 上傳本機
    //  - 這台裝置上次是別的帳號 → 一律用雲端（避免串檔）
    //  - 否則誰的時間戳新就用誰
    async function pull() {
        const snap = await ref().get();
        const lastUid = localStorage.getItem(LAST_UID);
        const otherAccount = !!lastUid && lastUid !== st.user.uid;
        localStorage.setItem(LAST_UID, st.user.uid);
        if (!snap.exists) { await push(); return; }
        const cloud = JSON.parse(snap.data().save || '{}');
        if (otherAccount || (cloud._t || 0) > (S._t || 0)) {
            localStorage.setItem(SKEY, JSON.stringify(cloud));
            S = loadSave();                                  // 重新載入到全域存檔物件
            st.status = '已從雲端載入';
        } else {
            await push();
        }
    }

    async function push() {
        if (!st.user || !db || pushing) return;
        clearTimeout(timer); timer = null; pushing = true;
        try {
            await ref().set({ save: JSON.stringify(S), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
            st.status = '已同步 ' + new Date().toLocaleTimeString();
        } catch (e) { st.status = '同步失敗：' + e.message; }
        pushing = false;
    }

    // save() 每次呼叫都會進來；合併 3 秒內的多次存檔，只上傳一次
    function queue() { if (!st.user) return; clearTimeout(timer); timer = setTimeout(push, 3000); }

    return { st, init, login, logout, queue, push, get user() { return st.user; } };
})();

window.Cloud = Cloud;                                        // ← 關鍵：讓 index.html 的 window.Cloud 找得到
window.addEventListener('load', () => Cloud.init());
