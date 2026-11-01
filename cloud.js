// ============================================================
//  cloud.js － Google 登入 + Firestore 雲端存檔
//  放在 index.html 的主 <script> 之前載入（見使用說明）
// ============================================================
const FIREBASE_CONFIG = {
    // ↓↓↓ 換成你在 Firebase 後台「專案設定 → 你的應用程式」取得的設定（這些值本來就是公開的，可放心 commit）
    apiKey: 'AIzaSyAK4qovtpWpiaOdt-GC8NDes6y53GaNyl8',
    authDomain: 'surivior.firebaseapp.com',
    projectId: 'surivior',
    appId: '1:554138880772:web:d4ac9b5c56446d7dcade51'
};

const Cloud = (() => {
    const st = { user: null, ready: false, status: '' };   // status：給 UI 顯示用
    let auth = null, db = null, timer = null, pushing = false;
    const LAST_UID = 'void_last_uid';
    const emit = () => window.dispatchEvent(new CustomEvent('cloudchange'));
    const ref = () => db.collection('users').doc(st.user.uid);

    function init() {
        if (!window.firebase || FIREBASE_CONFIG.apiKey.startsWith('YOUR')) { st.status = '尚未設定 Firebase'; return; }
        firebase.initializeApp(FIREBASE_CONFIG);
        auth = firebase.auth(); db = firebase.firestore();
        auth.getRedirectResult().catch(() => {});           // 手機改用 redirect 登入時，回來這裡接結果
        auth.onAuthStateChanged(async (u) => {
            st.user = u; st.ready = true;
            if (u) { try { await pull(); } catch (e) { st.status = '同步失敗：' + e.message; } }
            emit();
        });
        // 切到背景 / 關閉分頁前，把還沒送出的存檔立刻上傳
        document.addEventListener('visibilitychange', () => { if (document.hidden && timer) push(); });
    }

    // 登入：電腦用彈窗，彈窗被擋或手機則改用整頁跳轉
    async function login() {
        if (!auth) { alert('尚未設定 Firebase，請先填入 cloud.js 的 FIREBASE_CONFIG'); return; }
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        try { await auth.signInWithPopup(provider); }
        catch (e) {
            if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) auth.signInWithRedirect(provider);
            else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') alert('登入失敗：' + e.message);
        }
    }

    // 登出：先把最後進度上傳，再清掉本機存檔，避免下一個登入的帳號拿到上一個人的進度
    async function logout() {
        if (!auth) return;
        try { if (timer) await push(); } catch (e) {}
        await auth.signOut();
        try { localStorage.removeItem(SKEY); localStorage.removeItem(LAST_UID); } catch (e) {}
        location.reload();
    }

    // 登入後：比較雲端與本機，誰新就用誰
    async function pull() {
        const snap = await ref().get();
        const sameUser = localStorage.getItem(LAST_UID) === st.user.uid;
        localStorage.setItem(LAST_UID, st.user.uid);
        if (snap.exists) {
            const cloud = JSON.parse(snap.data().save || '{}');
            // 本機是「另一個帳號」或雲端較新 → 以雲端為準；本機較新 → 上傳本機
            if (!sameUser && localStorage.getItem(SKEY) && (cloud._t || 0) <= (S._t || 0) && !hasProgress(cloud)) { await push(); }
            else if (!sameUser || (cloud._t || 0) > (S._t || 0)) {
                localStorage.setItem(SKEY, JSON.stringify(cloud));
                S = loadSave();                              // 重新載入到全域存檔物件
                st.status = '已從雲端載入';
            } else { await push(); }
        } else { await push(); }                             // 雲端還沒有存檔：把本機進度上傳
    }
    const hasProgress = (d) => (d.best || 0) > 0 || (d.kills || 0) > 0;

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
window.addEventListener('load', () => Cloud.init());
