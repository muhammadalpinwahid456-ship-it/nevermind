/**
 * ============================================================
 *  CHAT STREAK SYSTEM - Per Hari Kalender  [v3]
 *  File: chat-streak.js
 *
 *  LOGIKA:
 *  - Streak dihitung per HARI KALENDER (00:00 – 23:59 waktu lokal).
 *  - Streak +1 jika kedua user saling chat di hari yang SAMA
 *    dan hari itu adalah hari BERIKUTNYA dari streak sebelumnya.
 *  - Contoh: chat Senin → streak 1, Selasa → streak 2,
 *    Rabu → streak 3, Kamis → streak 4.
 *  - Jika satu hari terlewat tanpa saling chat → streak reset ke 0.
 *  - Banyaknya pesan per hari tidak berpengaruh (1 pesan sudah cukup).
 *
 *  STRUKTUR DATA FIREBASE  →  streaks/{chatId}
 *  {
 *    count    : number,   // streak hari ini
 *    lastDay  : string,   // "YYYY-MM-DD" hari terakhir streak dihitung
 *    senderA  : string,   // uid (sorted[0])
 *    senderB  : string,   // uid (sorted[1])
 *    sentDayA : string,   // "YYYY-MM-DD" hari terakhir A kirim pesan
 *    sentDayB : string,   // "YYYY-MM-DD" hari terakhir B kirim pesan
 *  }
 *
 *  CARA INTEGRASI (sama seperti versi sebelumnya, tidak ada perubahan):
 *  1. <link rel="stylesheet" href="chat-streak.css"> di <head>
 *  2. StreakSystem.init(database, user.uid, { ref, get, set, onValue })
 *  3. StreakSystem.listenStreak(partnerId) di loop displayUsers()
 *  4. StreakSystem.recordSend(selectedUserId) setelah push pesan
 *  5. StreakSystem.renderHeaderStreak(userId) di selectUser()
 * ============================================================
 */

const StreakSystem = (() => {

    // ── CONFIG ────────────────────────────────────────────────
    const WARN_HOUR      = 22;   // mulai tampilkan ⌛ setelah jam 22:00
    const MILESTONE_DAYS = [3, 7, 14, 30, 50, 100, 365];
    const HEADER_WRAP_ID = 'chatStreakHeaderWrap';
    // ─────────────────────────────────────────────────────────

    let _db          = null;
    let _myUid       = null;
    let _streakCache = {};   // { [partnerId]: data }
    let _listeners   = {};   // { [partnerId]: unsubscribeFn }

    // ── UTIL TANGGAL ──────────────────────────────────────────

    /** String "YYYY-MM-DD" berdasarkan waktu lokal device */
    function _today() {
        const d  = new Date();
        const y  = d.getFullYear();
        const m  = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${dd}`;
    }

    /** Selisih hari: berapa hari dari a ke b (positif = b lebih baru) */
    function _dayDiff(a, b) {
        if (!a || !b) return Infinity;
        const msA = new Date(a + 'T00:00:00').getTime();
        const msB = new Date(b + 'T00:00:00').getTime();
        return Math.round((msB - msA) / 86400000);
    }

    /** Sisa waktu hingga tengah malam (ms) */
    function _msUntilMidnight() {
        const now      = new Date();
        const midnight = new Date();
        midnight.setHours(24, 0, 0, 0);
        return Math.max(0, midnight - now);
    }

    function _fmt(ms) {
        const h = Math.floor(ms / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        return h > 0 ? `${h}j ${m}m` : `${m} menit`;
    }

    // ── KEY HELPER ────────────────────────────────────────────
    function _chatId(a, b) { return [a, b].sort().join('_'); }
    function _path(a, b)   { return `streaks/${_chatId(a, b)}`; }

    function _myKey(d, uid) {
        return d.senderA === uid ? 'sentDayA' : 'sentDayB';
    }
    function _partnerKey(d, uid) {
        return d.senderA === uid ? 'sentDayB' : 'sentDayA';
    }

    // ── WARNING CHECK ─────────────────────────────────────────
    /** Tampilkan ⌛ jika streak aktif, hari ini belum selesai, dan jam >= WARN_HOUR */
    function _isWarning(d) {
        if (!d || d.count === 0) return false;
        const today = _today();
        // Jika lastDay bukan kemarin atau hari ini, streak sudah mati anyway
        const diff = _dayDiff(d.lastDay, today);
        if (diff > 1) return false;
        // Cek apakah hari ini sudah keduanya kirim
        const myKey      = _myKey(d, _myUid);
        const partnerKey = _partnerKey(d, _myUid);
        if (d[myKey] === today && d[partnerKey] === today) return false;
        // Warning aktif jika jam sudah >= WARN_HOUR
        return new Date().getHours() >= WARN_HOUR;
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

        const warn       = _isWarning(d);
        const icon       = warn ? '⌛' : '🔥';
        const warnCls    = warn ? 'streak-warn-header' : '';
        const today      = _today();
        const myKey      = _myKey(d, _myUid);
        const partnerKey = _partnerKey(d, _myUid);
        const meDone     = d[myKey]      === today;
        const partnerDone= d[partnerKey] === today;
        const left       = _msUntilMidnight();

        let statusLine;
        if (meDone && partnerDone) {
            statusLine = '✅ Streak hari ini selesai!';
        } else if (meDone) {
            statusLine = `⏳ Menunggu balasan · sisa ${_fmt(left)}`;
        } else if (partnerDone) {
            statusLine = `⚠️ Balas sekarang! Sisa ${_fmt(left)}`;
        } else {
            statusLine = `Belum chat hari ini · sisa ${_fmt(left)}`;
        }

        wrap.innerHTML = `
            <div id="chatStreakHeader" class="${warnCls}">
                <span>${icon}</span>
                <span>${d.count}</span>
                <div class="streak-tooltip">
                    ${d.count} hari streak berturut-turut 🔥<br>${statusLine}
                </div>
            </div>`;
    }

    // ── TOAST ─────────────────────────────────────────────────
    function _showToast(msg) {
        let t = document.getElementById('streakToast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'streakToast';
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.classList.add('toast-show');
        setTimeout(() => t.classList.remove('toast-show'), 3500);
    }

    // ── LISTEN REALTIME ───────────────────────────────────────
    function listenStreak(partnerId) {
        if (!_db || !_myUid) return;
        if (_listeners[partnerId]) _listeners[partnerId]();

        const { ref, onValue, set } = window._firebaseDB;
        const path = _path(_myUid, partnerId);

        const unsubscribe = onValue(ref(_db, path), (snap) => {
            let d = snap.exists() ? snap.val() : null;

            if (d && d.count > 0) {
                // Jika lastDay lebih dari 1 hari lalu → streak sudah mati
                const diff = _dayDiff(d.lastDay, _today());
                if (diff > 1) {
                    d = { ...d, count: 0, lastDay: '', sentDayA: '', sentDayB: '' };
                    set(ref(_db, path), d).catch(() => {});
                }
            }

            _streakCache[partnerId] = d || { count: 0 };
            _updateSidebarBadge(partnerId, _streakCache[partnerId]);
            if (window._selectedUserId === partnerId) _renderHeader(partnerId);
        });

        _listeners[partnerId] = unsubscribe;
    }

    // ── RECORD SEND ───────────────────────────────────────────
    /**
     * Dipanggil setiap kali user mengirim pesan.
     *
     * ALUR:
     * 1. Tandai sentDayA/B = hari ini.
     * 2. Jika partner juga sudah kirim hari ini (sentDayX = today):
     *    - Hitung diff antara lastDay dan hari ini.
     *    - diff == 1  → streak berturut-turut → count++
     *    - diff == 0  → sudah dihitung hari ini → skip
     *    - diff > 1 atau lastDay kosong → streak baru / terputus → count = 1
     *    - Simpan lastDay = today.
     */
    async function recordSend(partnerId) {
        if (!_db || !_myUid || !partnerId) return;

        const { ref, get, set } = window._firebaseDB;
        const path  = _path(_myUid, partnerId);
        const today = _today();

        try {
            const snap = await get(ref(_db, path));
            let d = snap.exists() ? snap.val() : null;

            // Inisialisasi data baru
            if (!d || !d.senderA) {
                const [a, b] = [_myUid, partnerId].sort();
                d = {
                    count    : 0,
                    lastDay  : '',
                    senderA  : a,
                    senderB  : b,
                    sentDayA : '',
                    sentDayB : '',
                };
            }

            const myKey      = _myKey(d, _myUid);
            const partnerKey = _partnerKey(d, _myUid);

            // Tandai saya sudah kirim hari ini
            d[myKey] = today;

            // Cek apakah partner juga sudah kirim hari ini
            const partnerSentToday = d[partnerKey] === today;

            if (partnerSentToday && d.lastDay !== today) {
                // Keduanya sudah chat hari ini, dan hari ini belum dihitung
                const diff = _dayDiff(d.lastDay, today);

                if (diff === 1) {
                    // Hari berturut-turut → streak naik
                    d.count = (d.count || 0) + 1;
                } else {
                    // Baru mulai atau ada hari yang terputus → mulai dari 1
                    d.count = 1;
                }

                d.lastDay = today;

                if (MILESTONE_DAYS.includes(d.count)) {
                    _showToast(`🔥 Streak ${d.count} hari! Luar biasa!`);
                }
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
        window._firebaseDB     = firebaseModules;
        window._selectedUserId = window._selectedUserId || null;

        if (!document.getElementById('streakToast')) {
            const t = document.createElement('div');
            t.id = 'streakToast';
            document.body.appendChild(t);
        }

        // Refresh badge & header setiap menit
        setInterval(() => {
            Object.keys(_streakCache).forEach(pid => {
                _updateSidebarBadge(pid, _streakCache[pid]);
            });
            const openId = window._selectedUserId;
            if (openId) _renderHeader(openId);
        }, 60 * 1000);

        console.log('[StreakSystem] ✅ Initialized (per-calendar-day) for', myUid);
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
