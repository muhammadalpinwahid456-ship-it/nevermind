/**
 * ============================================================
 *  CHAT STREAK SYSTEM - Snapchat Style
 *  File: chat-streak.js
 * 
 *  CARA INTEGRASI:
 *  1. Tambahkan di <head> chat.html:
 *       <link rel="stylesheet" href="chat-streak.css">
 *  
 *  2. Di dalam <script type="module"> chat.html, setelah semua
 *     variabel (currentUser, database, dll) sudah tersedia,
 *     tambahkan di bawah deklarasi variabel:
 *       window._streak = null; // placeholder
 * 
 *  3. TAMBAHKAN di dalam fungsi loadAllUsers() → displayUsers()
 *     → loop allUsers.forEach, setelah listenUserPresence(user.uid):
 *       StreakSystem.listenStreak(user.uid);
 * 
 *  4. TAMBAHKAN di dalam sendMessage(), setelah:
 *       await push(messagesRef, messageData);
 *     tambahkan:
 *       StreakSystem.recordSend(selectedUserId);
 * 
 *  5. TAMBAHKAN di dalam selectUser(), setelah chat dibuka:
 *       StreakSystem.renderHeaderStreak(userId);
 * 
 *  6. Pastikan ada elemen dengan id="chatHeaderRight" atau sesuaikan
 *     HEADER_CONTAINER_ID di config bawah.
 * ============================================================
 */

const StreakSystem = (() => {

    // ── CONFIG ──────────────────────────────────────────────
    const STREAK_WINDOW_MS   = 24 * 60 * 60 * 1000;  // 24 jam
    const WARN_THRESHOLD_MS  = 2  * 60 * 60 * 1000;  // 2 jam  → tampilkan ⌛
    const MILESTONE_DAYS     = [3, 7, 14, 30, 50, 100, 365];
    const HEADER_CONTAINER_ID = 'chatStreakHeaderWrap'; // div yang akan kita inject
    // ────────────────────────────────────────────────────────

    // Refs Firebase – di-set saat init()
    let _db          = null;
    let _myUid       = null;
    let _streakCache = {};          // { [partnerId]: streakData }
    let _listeners   = {};          // { [chatId]: unsubscribe }

    // ── UTIL ─────────────────────────────────────────────────
    function _chatId(uid1, uid2) {
        return [uid1, uid2].sort().join('_');
    }

    function _streakPath(uid1, uid2) {
        return `streaks/${_chatId(uid1, uid2)}`;
    }

    function _now() { return Date.now(); }

    /**
     * Apakah masih dalam window 24 jam?
     * window dimulai dari lastSendAt user terakhir yang kirim.
     */
    function _isAlive(streakData) {
        if (!streakData) return false;
        const deadline = (streakData.lastSendAt || 0) + STREAK_WINDOW_MS;
        return _now() < deadline;
    }

    function _timeLeft(streakData) {
        if (!streakData) return 0;
        const deadline = (streakData.lastSendAt || 0) + STREAK_WINDOW_MS;
        return Math.max(0, deadline - _now());
    }

    function _isWarning(streakData) {
        return _timeLeft(streakData) < WARN_THRESHOLD_MS && _timeLeft(streakData) > 0;
    }

    function _fmt(ms) {
        const h = Math.floor(ms / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        if (h > 0) return `${h}j ${m}m`;
        return `${m} menit`;
    }

    // ── STREAK BADGE HTML ────────────────────────────────────
    function _badgeHtml(streakData) {
        const count = (streakData && streakData.count) || 0;

        if (count === 0) {
            return `<span class="streak-badge streak-zero">
                        <span class="streak-icon">🔥</span>
                        <span class="streak-count">0</span>
                    </span>`;
        }

        const warn    = _isWarning(streakData);
        const icon    = warn ? '⌛' : '🔥';
        const cls     = warn ? 'streak-badge streak-warning' : 'streak-badge';

        return `<span class="${cls}">
                    <span class="streak-icon">${icon}</span>
                    <span class="streak-count">${count}</span>
                </span>`;
    }

    // ── UPDATE DOM user-item di sidebar ─────────────────────
    function _updateUserItemBadge(partnerId, streakData) {
        const el = document.querySelector(`.user-item[data-user-id="${partnerId}"]`);
        if (!el) return;

        // Hapus badge lama
        const old = el.querySelector('.streak-badge');
        if (old) old.remove();

        // Inject ke user-item-info (bawah nama)
        const info = el.querySelector('.user-item-info');
        if (info) {
            info.insertAdjacentHTML('beforeend', _badgeHtml(streakData));
        }
    }

    // ── HEADER STREAK (dalam chat terbuka) ──────────────────
    function _renderHeader(partnerId) {
        const streakData = _streakCache[partnerId];
        let wrap = document.getElementById(HEADER_CONTAINER_ID);

        // Buat container jika belum ada
        if (!wrap) {
            // Coba inject ke area kanan header chat
            const headerRight = document.querySelector('.chat-header-right')
                             || document.querySelector('.chat-header')
                             || document.getElementById('chatHeader');
            if (!headerRight) return;

            wrap = document.createElement('div');
            wrap.id = HEADER_CONTAINER_ID;
            wrap.style.cssText = 'display:flex;align-items:center;margin-left:8px;';
            headerRight.appendChild(wrap);
        }

        if (!streakData || streakData.count === 0) {
            wrap.innerHTML = '';
            return;
        }

        const warn     = _isWarning(streakData);
        const icon     = warn ? '⌛' : '🔥';
        const warnCls  = warn ? 'streak-warn-header' : '';
        const left     = _timeLeft(streakData);
        const tooltip  = warn
            ? `⚠️ Streak habis dalam ${_fmt(left)}! Kirim pesan sekarang!`
            : `${streakData.count} hari streak berturut-turut 🔥\nSisa waktu: ${_fmt(left)}`;

        wrap.innerHTML = `
            <div id="chatStreakHeader" class="${warnCls}">
                <span>${icon}</span>
                <span>${streakData.count}</span>
                <div class="streak-tooltip">${tooltip.replace(/\n/g,'<br>')}</div>
            </div>`;
    }

    // ── TOAST MILESTONE ─────────────────────────────────────
    function _showToast(msg) {
        let toast = document.getElementById('streakToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'streakToast';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.classList.add('toast-show');
        setTimeout(() => toast.classList.remove('toast-show'), 3500);
    }

    // ── LISTEN REALTIME (sidebar live update) ────────────────
    function listenStreak(partnerId) {
        if (!_db || !_myUid) return;
        const path = _streakPath(_myUid, partnerId);
        const { ref, onValue } = window._firebaseDB;

        if (_listeners[partnerId]) {
            _listeners[partnerId](); // unsubscribe lama
        }

        const unsubscribe = onValue(ref(_db, path), (snap) => {
            let data = snap.exists() ? snap.val() : { count: 0, lastSendAt: 0 };

            // Auto-reset jika window 24 jam sudah lewat
            if (!_isAlive(data) && data.count > 0) {
                data = { count: 0, lastSendAt: 0 };
                // Tulis reset ke Firebase
                const { set } = window._firebaseDB;
                set(ref(_db, path), data).catch(() => {});
            }

            _streakCache[partnerId] = data;
            _updateUserItemBadge(partnerId, data);

            // Jika chat partner ini sedang terbuka, update header juga
            const openUserId = window._selectedUserId || null;
            if (openUserId === partnerId) {
                _renderHeader(partnerId);
            }
        });

        _listeners[partnerId] = unsubscribe;
    }

    // ── RECORD SEND (dipanggil saat kirim pesan) ─────────────
    async function recordSend(partnerId) {
        if (!_db || !_myUid || !partnerId) return;

        const path = _streakPath(_myUid, partnerId);
        const { ref, get, set } = window._firebaseDB;

        try {
            const snap = await get(ref(_db, path));
            let data   = snap.exists() ? snap.val() : { count: 0, lastSendAt: 0 };

            const now      = _now();
            const myUid    = _myUid;
            const partner  = partnerId;

            // Apakah partner sudah kirim dalam window ini?
            const partnerSentAt  = data[`lastSendAt_${partner}`] || 0;
            const mySentAt       = data[`lastSendAt_${myUid}`]   || 0;

            // Update waktu kirim saya
            data[`lastSendAt_${myUid}`] = now;

            // Streak bertambah jika:
            // 1. Kedua pihak sudah kirim dalam window 24 jam, DAN
            // 2. Kita belum menambahkan streak di window ini (cegah double-count)
            const windowStart  = now - STREAK_WINDOW_MS;
            const bothSentInWindow =
                partnerSentAt >= windowStart &&
                mySentAt      >= windowStart;

            // Tandai apakah streak sudah dihitung di window ini
            const alreadyCounted = data.lastStreakAt && data.lastStreakAt >= windowStart;

            if (bothSentInWindow && !alreadyCounted) {
                const oldCount = data.count || 0;
                data.count       = oldCount + 1;
                data.lastStreakAt = now;
                data.lastSendAt   = now; // untuk countdown warning

                // Milestone notification
                if (MILESTONE_DAYS.includes(data.count)) {
                    _showToast(`🔥 Streak ${data.count} hari! Luar biasa!`);
                }
            } else if (!_isAlive(data)) {
                // Streak mati (partner tidak balas dalam 24 jam)
                data.count       = 0;
                data.lastStreakAt = 0;
                data.lastSendAt  = now;
            } else {
                // Update lastSendAt untuk refresh countdown
                data.lastSendAt = Math.max(mySentAt, partnerSentAt, data.lastSendAt || 0);
            }

            await set(ref(_db, path), data);

        } catch (err) {
            console.error('[StreakSystem] recordSend error:', err);
        }
    }

    // ── INIT ─────────────────────────────────────────────────
    function init(db, myUid, firebaseModules) {
        _db    = db;
        _myUid = myUid;
        window._firebaseDB = firebaseModules; // { ref, get, set, onValue }
        window._selectedUserId = null;

        // Buat toast container
        if (!document.getElementById('streakToast')) {
            const t = document.createElement('div');
            t.id = 'streakToast';
            document.body.appendChild(t);
        }

        // Refresh countdown setiap menit (untuk warning live)
        setInterval(() => {
            Object.keys(_streakCache).forEach(pid => {
                _updateUserItemBadge(pid, _streakCache[pid]);
            });
            const openId = window._selectedUserId;
            if (openId) _renderHeader(openId);
        }, 60 * 1000);

        console.log('[StreakSystem] ✅ Initialized for', myUid);
    }

    // Public API
    return {
        init,
        listenStreak,
        recordSend,
        renderHeaderStreak: _renderHeader,
        getBadgeHtml: _badgeHtml,
    };

})();

// Export global
window.StreakSystem = StreakSystem;
