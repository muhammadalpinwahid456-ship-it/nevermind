/**
 * ============================================================
 *  CHAT STREAK SYSTEM - Snapchat Style  [FIXED v2]
 *  File: chat-streak.js
 *
 *  CARA INTEGRASI (sama seperti sebelumnya):
 *  1. <link rel="stylesheet" href="chat-streak.css"> di <head>
 *  2. StreakSystem.init(database, user.uid, { ref, get, set, onValue })
 *     dipanggil setelah auth berhasil
 *  3. StreakSystem.listenStreak(user.uid) di loop displayUsers()
 *  4. StreakSystem.recordSend(selectedUserId) setelah push pesan
 *  5. StreakSystem.renderHeaderStreak(userId) di selectUser()
 * ============================================================
 *
 *  STRUKTUR DATA DI FIREBASE  →  streaks/{chatId}
 *  {
 *    count        : number,   // jumlah hari streak saat ini
 *    lastStreakAt : number,   // timestamp saat streak terakhir dihitung
 *    deadline     : number,   // timestamp batas 24 jam (deadline kirim balik)
 *    senderA      : string,   // uid pemain pertama
 *    senderB      : string,   // uid pemain kedua
 *    sentA        : boolean,  // apakah A sudah kirim dalam window saat ini
 *    sentB        : boolean   // apakah B sudah kirim dalam window saat ini
 *  }
 *
 *  LOGIKA STREAK (diperbaiki):
 *  - Setiap "window" adalah slot 24 jam yang dimulai saat streak dihitung.
 *  - Streak +1 ketika KEDUA pihak telah mengirim pesan dalam window yang sama.
 *  - Setelah streak naik, window baru dimulai (deadline diperbarui +24 jam).
 *  - Jika deadline terlewat sebelum keduanya kirim → streak reset ke 0.
 * ============================================================
 */

const StreakSystem = (() => {

    // ── CONFIG ──────────────────────────────────────────────
    const STREAK_WINDOW_MS  = 24 * 60 * 60 * 1000;   // 24 jam
    const WARN_THRESHOLD_MS =  2 * 60 * 60 * 1000;   // 2 jam → tampilkan ⌛
    const MILESTONE_DAYS    = [3, 7, 14, 30, 50, 100, 365];
    const HEADER_WRAP_ID    = 'chatStreakHeaderWrap';
    // ────────────────────────────────────────────────────────

    let _db          = null;
    let _myUid       = null;
    let _streakCache = {};   // { [partnerId]: streakData }
    let _listeners   = {};   // { [partnerId]: unsubscribeFn }

    // ── UTIL ─────────────────────────────────────────────────
    function _chatId(a, b)   { return [a, b].sort().join('_'); }
    function _path(a, b)     { return `streaks/${_chatId(a, b)}`; }
    function _now()          { return Date.now(); }

    /** Apakah streak masih hidup (deadline belum lewat)? */
    function _isAlive(d) {
        if (!d || !d.deadline) return false;
        return _now() < d.deadline;
    }

    /** Sisa waktu dalam ms */
    function _timeLeft(d) {
        if (!d || !d.deadline) return 0;
        return Math.max(0, d.deadline - _now());
    }

    function _isWarning(d) {
        const left = _timeLeft(d);
        return left > 0 && left < WARN_THRESHOLD_MS;
    }

    function _fmt(ms) {
        const h = Math.floor(ms / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        return h > 0 ? `${h}j ${m}m` : `${m} menit`;
    }

    // ── KEY PEMAIN ────────────────────────────────────────────
    /** 'sentA' atau 'sentB' milik uid tertentu dalam data streak */
    function _myKey(d, uid) {
        return d.senderA === uid ? 'sentA' : 'sentB';
    }
    function _partnerKey(d, uid) {
        return d.senderA === uid ? 'sentB' : 'sentA';
    }

    // ── BADGE HTML ────────────────────────────────────────────
    function _badgeHtml(d) {
        const count = (d && d.count) || 0;
        if (count === 0) return '';
        const warn = _isWarning(d);
        const icon = warn ? '⌛' : '🔥';
        const cls  = warn ? 'streak-badge streak-warning' : 'streak-badge';
        return `<span class="${cls}">
                    <span class="streak-icon">${icon}</span>
                    <span class="streak-count">${count}</span>
                </span>`;
    }

    // ── UPDATE SIDEBAR ────────────────────────────────────────
    function _updateSidebarBadge(partnerId, d) {
        const el = document.querySelector(`.user-item[data-user-id="${partnerId}"]`);
        if (!el) return;
        el.querySelectorAll('.streak-badge').forEach(b => b.remove());
        const info = el.querySelector('.user-item-info');
        const html = _badgeHtml(d);
        if (info && html) info.insertAdjacentHTML('beforeend', html);
    }

    // ── HEADER STREAK ─────────────────────────────────────────
    function _renderHeader(partnerId) {
        const d = _streakCache[partnerId];
        let wrap = document.getElementById(HEADER_WRAP_ID);

        if (!wrap) {
            const anchor =
                document.querySelector('.chat-header-right') ||
                document.querySelector('.chat-window-header') ||
                document.querySelector('.chat-header') ||
                document.getElementById('chatHeader');
            if (!anchor) return;
            wrap = document.createElement('div');
            wrap.id = HEADER_WRAP_ID;
            wrap.style.cssText = 'display:flex;align-items:center;margin-left:8px;';
            anchor.appendChild(wrap);
        }

        if (!d || d.count === 0) { wrap.innerHTML = ''; return; }

        const warn    = _isWarning(d);
        const icon    = warn ? '⌛' : '🔥';
        const warnCls = warn ? 'streak-warn-header' : '';
        const left    = _timeLeft(d);
        const tooltip = warn
            ? `⚠️ Streak habis dalam ${_fmt(left)}! Kirim pesan sekarang!`
            : `${d.count} hari streak berturut-turut 🔥\nSisa waktu: ${_fmt(left)}`;

        wrap.innerHTML = `
            <div id="chatStreakHeader" class="${warnCls}">
                <span>${icon}</span>
                <span>${d.count}</span>
                <div class="streak-tooltip">${tooltip.replace(/\n/g, '<br>')}</div>
            </div>`;
    }

    // ── TOAST ─────────────────────────────────────────────────
    function _showToast(msg) {
        let t = document.getElementById('streakToast');
        if (!t) { t = document.createElement('div'); t.id = 'streakToast'; document.body.appendChild(t); }
        t.textContent = msg;
        t.classList.add('toast-show');
        setTimeout(() => t.classList.remove('toast-show'), 3500);
    }

    // ── LISTEN REALTIME ───────────────────────────────────────
    function listenStreak(partnerId) {
        if (!_db || !_myUid) return;
        if (_listeners[partnerId]) _listeners[partnerId]();

        const { ref, onValue, set } = window._firebaseDB;

        const unsubscribe = onValue(ref(_db, _path(_myUid, partnerId)), (snap) => {
            let d = snap.exists() ? snap.val() : null;

            // Auto-reset jika deadline sudah lewat
            if (d && d.count > 0 && !_isAlive(d)) {
                d = { count: 0, deadline: 0, senderA: d.senderA, senderB: d.senderB, sentA: false, sentB: false };
                set(ref(_db, _path(_myUid, partnerId)), d).catch(() => {});
            }

            _streakCache[partnerId] = d || { count: 0 };
            _updateSidebarBadge(partnerId, _streakCache[partnerId]);

            if (window._selectedUserId === partnerId) _renderHeader(partnerId);
        });

        _listeners[partnerId] = unsubscribe;
    }

    // ── RECORD SEND ───────────────────────────────────────────
    /**
     * Dipanggil setiap kali currentUser mengirim pesan ke partnerId.
     *
     * Alur logika baru (benar):
     * 1. Baca data streak saat ini.
     * 2. Pastikan field senderA/senderB sudah berisi kedua uid.
     * 3. Tandai bahwa AKU sudah kirim dalam window ini (sentA atau sentB = true).
     * 4. Jika PARTNER juga sudah kirim (partnerKey = true) DAN streak belum
     *    dihitung dalam window ini → streak +1, buka window baru (reset sent flags,
     *    deadline +24 jam dari sekarang).
     * 5. Jika window sudah habis (deadline lewat) dan streak belum bertambah
     *    → streak reset ke 0, mulai window baru dengan hanya aku yang sudah kirim.
     * 6. Tulis kembali ke Firebase.
     */
    async function recordSend(partnerId) {
        if (!_db || !_myUid || !partnerId) return;

        const { ref, get, set } = window._firebaseDB;
        const path = _path(_myUid, partnerId);

        try {
            const snap = await get(ref(_db, path));
            let d = snap.exists() ? snap.val() : null;
            const now = _now();

            // ── Inisialisasi data jika belum ada ─────────────
            if (!d) {
                // Percakapan pertama: tentukan siapa A dan B
                const [a, b] = [_myUid, partnerId].sort();
                d = {
                    count       : 0,
                    lastStreakAt: 0,
                    deadline    : now + STREAK_WINDOW_MS,
                    senderA     : a,
                    senderB     : b,
                    sentA       : false,
                    sentB       : false,
                };
            }

            // Pastikan senderA/senderB terisi (data lama mungkin tidak punya)
            if (!d.senderA || !d.senderB) {
                const [a, b] = [_myUid, partnerId].sort();
                d.senderA = a;
                d.senderB = b;
            }

            // Key milik saya dan partner
            const myKey      = _myKey(d, _myUid);
            const partnerKey = _partnerKey(d, _myUid);

            // ── Cek apakah window 24 jam masih aktif ─────────
            const windowAlive = d.deadline && now < d.deadline;

            if (!windowAlive) {
                // Window habis → cek apakah streak mati
                if (d.count > 0) {
                    // Partner tidak balas dalam 24 jam → streak hilang
                    d.count        = 0;
                    d.lastStreakAt = 0;
                }
                // Mulai window baru, hanya aku yang sudah kirim
                d.sentA    = false;
                d.sentB    = false;
                d[myKey]   = true;
                d.deadline = now + STREAK_WINDOW_MS;

            } else {
                // Window masih aktif
                d[myKey] = true; // tandai aku sudah kirim

                if (d[partnerKey] === true) {
                    // ✅ Keduanya sudah kirim dalam window ini → streak +1
                    const oldCount = d.count || 0;
                    d.count        = oldCount + 1;
                    d.lastStreakAt = now;

                    // Reset flags untuk window BERIKUTNYA
                    d.sentA    = false;
                    d.sentB    = false;
                    d[myKey]   = true;            // aku sudah "kirim" di window baru (sudah kirim barusan)
                    d.deadline = now + STREAK_WINDOW_MS; // buka window baru

                    // Milestone notification
                    if (MILESTONE_DAYS.includes(d.count)) {
                        _showToast(`🔥 Streak ${d.count} hari! Luar biasa!`);
                    }
                }
                // else: partner belum kirim, tetap tunggu dalam window yang sama
            }

            await set(ref(_db, path), d);

        } catch (err) {
            console.error('[StreakSystem] recordSend error:', err);
        }
    }

    // ── INIT ─────────────────────────────────────────────────
    function init(db, myUid, firebaseModules) {
        _db    = db;
        _myUid = myUid;
        window._firebaseDB     = firebaseModules; // { ref, get, set, onValue }
        window._selectedUserId = window._selectedUserId || null;

        if (!document.getElementById('streakToast')) {
            const t = document.createElement('div');
            t.id = 'streakToast';
            document.body.appendChild(t);
        }

        // Refresh countdown setiap menit (untuk warning live di sidebar & header)
        setInterval(() => {
            Object.keys(_streakCache).forEach(pid => {
                _updateSidebarBadge(pid, _streakCache[pid]);
            });
            const openId = window._selectedUserId;
            if (openId) _renderHeader(openId);
        }, 60 * 1000);

        console.log('[StreakSystem] ✅ Initialized for', myUid);
    }

    // ── PUBLIC API ────────────────────────────────────────────
    return {
        init,
        listenStreak,
        recordSend,
        renderHeaderStreak : _renderHeader,
        getBadgeHtml       : _badgeHtml,
    };

})();

window.StreakSystem = StreakSystem;
