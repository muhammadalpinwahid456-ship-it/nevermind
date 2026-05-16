/**
 * ============================================================
 *  CHAT DOODLE v2 — Instagram DM Style
 *  Canvas overlay LANGSUNG di atas chat messages yang ada.
 *  User menggambar, screenshot canvas+messages, lalu kirim.
 *
 *  CARA INTEGRASI KE chat.html:
 *  ─────────────────────────────
 *  1. Di <head>:
 *       <link rel="stylesheet" href="chat-doodle.css">
 *
 *  2. Sebelum </body>:
 *       <script src="chat-doodle.js"></script>
 *
 *  3. Tambahkan tombol di .input-area (setelah 📎):
 *       <button id="doodleToggleBtn" title="Draw">✏️</button>
 *
 *  4. Di dalam onAuthStateChanged, setelah StreakSystem.init:
 *       if (window.DoodleSystem) DoodleSystem.init(database, { ref, set, push, onValue, get });
 *       else { const t=setInterval(()=>{if(window.DoodleSystem){DoodleSystem.init(database,{ref,set,push,onValue,get});clearInterval(t);}},300); }
 *
 *  5. Di dalam selectUser():
 *       if (window.DoodleSystem) DoodleSystem.onSelectUser(userId);
 *
 *  6. Di render pesan (bagian msg.type check), tambahkan:
 *       if (msg.type === 'doodle') { ... lihat contoh di bawah ... }
 * ============================================================
 */

const DoodleSystem = (() => {

    // ── CONFIG ──────────────────────────────────────────────
    const PRESET_COLORS = [
        '#000000', // hitam
        '#ffffff', // putih
        '#ef4444', // merah
        '#f97316', // oranye
        '#eab308', // kuning
        '#22c55e', // hijau
        '#3b82f6', // biru
        '#a855f7', // ungu
        '#ec4899', // pink
    ];

    // ── STATE ───────────────────────────────────────────────
    let _db        = null;
    let _fb        = null;
    let _myUid     = null;
    let _partnerId = null;
    let _isDrawing = false;
    let _eraser    = false;
    let _color     = '#000000';
    let _lineWidth = 6;
    let _history   = [];    // undo stack
    let _redoStack = [];
    let _liveListener = null;

    // DOM refs
    let _wrap   = null;   // #doodleCanvasWrap
    let _canvas = null;   // #doodleCanvas
    let _ctx    = null;
    let _msgArea = null;  // #messagesArea

    // ── UTIL ────────────────────────────────────────────────
    function _chatId(a, b) { return [a, b].sort().join('_'); }
    function _livePath()   { return `doodles/${_chatId(_myUid, _partnerId)}/live`; }

    // ── BUILD UI ────────────────────────────────────────────
    function _build() {
        if (document.getElementById('doodleCanvasWrap')) return;

        // messages-area harus position:relative agar absolute child bekerja
        _msgArea = document.getElementById('messagesArea');
        if (!_msgArea) return;
        if (getComputedStyle(_msgArea).position === 'static') {
            _msgArea.style.position = 'relative';
        }

        // ── Canvas wrap ──
        _wrap = document.createElement('div');
        _wrap.id = 'doodleCanvasWrap';
        _wrap.innerHTML = `
            <canvas id="doodleCanvas"></canvas>
            <div id="dcCursorRing"></div>
            <span id="doodleModeLabel">✏️ Mode Menggambar</span>
            <button id="doodleCloseBtn" title="Tutup">✕</button>

            <!-- Toolbar -->
            <div id="doodleToolbar">
                <!-- Colors -->
                <div class="dc-colors" id="dcColors"></div>
                <input type="color" id="dcColorInput" value="${_color}" title="Pilih warna">
                <div class="dc-div"></div>

                <!-- Brush size -->
                <div class="dc-size-wrap">
                    <span class="dc-size-dot">•</span>
                    <input type="range" id="dcSizeRange" min="2" max="40" value="${_lineWidth}">
                    <span class="dc-size-dot lg">●</span>
                </div>
                <div class="dc-div"></div>

                <!-- Tools -->
                <button class="dc-btn" id="dcEraserBtn" title="Eraser">🧹</button>
                <button class="dc-btn" id="dcUndoBtn"   title="Undo" disabled>↩</button>
                <button class="dc-btn" id="dcRedoBtn"   title="Redo" disabled>↪</button>
                <button class="dc-btn" id="dcClearBtn"  title="Hapus semua">🗑️</button>
                <div class="dc-div"></div>

                <!-- Send -->
                <button id="dcSendBtn">Kirim 🎨</button>
            </div>
        `;
        _msgArea.appendChild(_wrap);

        // Canvas ref
        _canvas = document.getElementById('doodleCanvas');
        _ctx    = _canvas.getContext('2d');
        _syncCanvasSize();

        // Build swatches
        const swatchWrap = document.getElementById('dcColors');
        PRESET_COLORS.forEach(c => {
            const s = document.createElement('div');
            s.className  = 'dc-swatch' + (c === _color ? ' dc-sel' : '');
            s.style.background = c;
            s.title = c;
            s.addEventListener('click', () => _setColor(c));
            swatchWrap.appendChild(s);
        });

        // Fullscreen viewer
        if (!document.getElementById('doodleViewer')) {
            const v = document.createElement('div');
            v.id = 'doodleViewer';
            v.innerHTML = `<img id="doodleViewerImg" src="" alt="doodle"><button id="doodleViewerClose">Tutup</button>`;
            document.body.appendChild(v);
            document.getElementById('doodleViewerClose').onclick = () => v.classList.remove('dv-open');
            v.addEventListener('click', e => { if (e.target === v) v.classList.remove('dv-open'); });
        }

        _bindEvents();
    }

    // ── CANVAS SIZE ─────────────────────────────────────────
    function _syncCanvasSize() {
        if (!_canvas || !_msgArea) return;
        let saved = null;
        if (_canvas.width > 0 && _canvas.height > 0) {
            try { saved = _ctx.getImageData(0, 0, _canvas.width, _canvas.height); } catch(e){}
        }
        _canvas.width  = _msgArea.offsetWidth  || 400;
        _canvas.height = _msgArea.offsetHeight || 600;
        if (saved) { try { _ctx.putImageData(saved, 0, 0); } catch(e){} }
    }

    // ── COLOR ────────────────────────────────────────────────
    function _setColor(c) {
        _color  = c;
        _eraser = false;
        document.getElementById('dcEraserBtn')?.classList.remove('dc-on');
        _canvas?.classList.remove('eraser-mode');
        document.querySelectorAll('.dc-swatch').forEach(s => s.classList.remove('dc-sel'));
        document.querySelectorAll('.dc-swatch').forEach(s => {
            if (s.style.background === c || s.title === c) s.classList.add('dc-sel');
        });
        const inp = document.getElementById('dcColorInput');
        if (inp) inp.value = c.length === 7 ? c : '#000000';
        _updateCursor();
    }

    function _updateCursor() {
        const ring = document.getElementById('dcCursorRing');
        if (!ring) return;
        const sz = Math.max(8, _lineWidth * (_eraser ? 3 : 2));
        ring.style.width  = sz + 'px';
        ring.style.height = sz + 'px';
        ring.style.borderColor = _eraser ? 'rgba(255,100,100,0.8)' : 'rgba(255,255,255,0.75)';
    }

    // ── EVENTS ───────────────────────────────────────────────
    function _bindEvents() {
        document.getElementById('doodleCloseBtn').addEventListener('click', closeDoodle);

        document.getElementById('dcEraserBtn').addEventListener('click', () => {
            _eraser = !_eraser;
            document.getElementById('dcEraserBtn').classList.toggle('dc-on', _eraser);
            _canvas.classList.toggle('eraser-mode', _eraser);
            _updateCursor();
        });

        document.getElementById('dcUndoBtn').addEventListener('click', _undo);
        document.getElementById('dcRedoBtn').addEventListener('click', _redo);

        document.getElementById('dcClearBtn').addEventListener('click', () => {
            if (!confirm('Hapus semua coretan?')) return;
            _saveH();
            _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
            _pushLive();
        });

        document.getElementById('dcSendBtn').addEventListener('click', _sendDoodle);

        document.getElementById('dcSizeRange').addEventListener('input', e => {
            _lineWidth = parseInt(e.target.value);
            _updateCursor();
        });

        document.getElementById('dcColorInput').addEventListener('input', e => {
            _color  = e.target.value;
            _eraser = false;
            document.getElementById('dcEraserBtn').classList.remove('dc-on');
            _canvas.classList.remove('eraser-mode');
            document.querySelectorAll('.dc-swatch').forEach(s => s.classList.remove('dc-sel'));
            _updateCursor();
        });

        // Mouse
        _canvas.addEventListener('mousedown',  _mDown);
        _canvas.addEventListener('mousemove',  _mMove);
        _canvas.addEventListener('mouseup',    _mUp);
        _canvas.addEventListener('mouseleave', _mUp);

        // Touch
        _canvas.addEventListener('touchstart',  _tStart, { passive: false });
        _canvas.addEventListener('touchmove',   _tMove,  { passive: false });
        _canvas.addEventListener('touchend',    _mUp);
        _canvas.addEventListener('touchcancel', _mUp);

        // Cursor ring follow
        _canvas.addEventListener('mousemove', e => {
            const r   = _canvas.getBoundingClientRect();
            const ring = document.getElementById('dcCursorRing');
            if (ring) {
                ring.style.left = (e.clientX - r.left) + 'px';
                ring.style.top  = (e.clientY - r.top)  + 'px';
            }
        });

        window.addEventListener('resize', _syncCanvasSize);
    }

    // ── DRAWING ─────────────────────────────────────────────
    function _pos(e) {
        const r = _canvas.getBoundingClientRect();
        return {
            x: (e.clientX - r.left) * (_canvas.width  / r.width),
            y: (e.clientY - r.top)  * (_canvas.height / r.height),
        };
    }

    function _saveH() {
        _history.push(_ctx.getImageData(0, 0, _canvas.width, _canvas.height));
        if (_history.length > 40) _history.shift();
        _redoStack = [];
        _refreshBtns();
    }

    function _refreshBtns() {
        const u = document.getElementById('dcUndoBtn');
        const r = document.getElementById('dcRedoBtn');
        if (u) u.disabled = _history.length === 0;
        if (r) r.disabled = _redoStack.length === 0;
    }

    function _undo() {
        if (!_history.length) return;
        _redoStack.push(_ctx.getImageData(0, 0, _canvas.width, _canvas.height));
        _ctx.putImageData(_history.pop(), 0, 0);
        _refreshBtns();
    }

    function _redo() {
        if (!_redoStack.length) return;
        _history.push(_ctx.getImageData(0, 0, _canvas.width, _canvas.height));
        _ctx.putImageData(_redoStack.pop(), 0, 0);
        _refreshBtns();
    }

    function _applyStyle() {
        if (_eraser) {
            _ctx.globalCompositeOperation = 'destination-out';
            _ctx.strokeStyle = 'rgba(0,0,0,1)';
            _ctx.lineWidth   = _lineWidth * 3;
        } else {
            _ctx.globalCompositeOperation = 'source-over';
            _ctx.strokeStyle = _color;
            _ctx.lineWidth   = _lineWidth;
        }
        _ctx.lineCap  = 'round';
        _ctx.lineJoin = 'round';
    }

    function _mDown(e) {
        e.preventDefault();
        _saveH();
        _isDrawing = true;
        const p = _pos(e);
        _ctx.beginPath();
        _ctx.moveTo(p.x, p.y);
        _applyStyle();
    }

    function _mMove(e) {
        if (!_isDrawing) return;
        e.preventDefault();
        const p = _pos(e);
        _ctx.lineTo(p.x, p.y);
        _ctx.stroke();
    }

    function _mUp() {
        if (!_isDrawing) return;
        _isDrawing = false;
        _ctx.closePath();
        _debouncePush();
    }

    function _tStart(e) {
        e.preventDefault();
        const t = e.touches[0];
        _mDown({ clientX: t.clientX, clientY: t.clientY, preventDefault: ()=>{} });
    }
    function _tMove(e) {
        e.preventDefault();
        const t = e.touches[0];
        _mMove({ clientX: t.clientX, clientY: t.clientY, preventDefault: ()=>{} });
    }

    // ── FIREBASE LIVE SYNC ──────────────────────────────────
    // Kirim canvas setiap stroke selesai (debounce 350ms)
    let _pushTimer = null;
    function _debouncePush() {
        clearTimeout(_pushTimer);
        _pushTimer = setTimeout(_pushLive, 350);
    }

    function _pushLive() {
        if (!_db || !_myUid || !_partnerId) return;
        const { ref, set } = _fb;
        // Hanya kirim coretan (alpha), bukan background — supaya partner melihat
        // overlay transparan di atas chat mereka sendiri
        set(ref(_db, _livePath()), {
            image: _canvas.toDataURL('image/png', 0.82),
            from:  _myUid,
            ts:    Date.now(),
        }).catch(e => console.error('[Doodle] push error', e));
    }

    function _listenLive() {
        if (_liveListener) { _liveListener(); _liveListener = null; }
        if (!_db || !_myUid || !_partnerId) return;
        const { ref, onValue } = _fb;
        _liveListener = onValue(ref(_db, _livePath()), snap => {
            if (!snap.exists()) return;
            const d = snap.val();
            if (d.from === _myUid) return;  // echo sendiri, abaikan

            // Gambar coretan partner ke atas canvas kita (realtime overlay)
            const img = new Image();
            img.onload = () => {
                if (!_wrap?.classList.contains('doodle-active')) {
                    // Overlay kita tutup → tampilkan notif kecil
                    _showPartnerBadge();
                } else {
                    // Restore canvas kita + overlay partner di atas
                    _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
                    _ctx.globalCompositeOperation = 'source-over';
                    _ctx.drawImage(img, 0, 0, _canvas.width, _canvas.height);
                }
            };
            img.src = d.image;
        });
    }

    function _showPartnerBadge() {
        if (document.getElementById('dcPartnerBadge')) return;
        const b = document.createElement('div');
        b.id = 'dcPartnerBadge';
        b.style.cssText = `
            position:fixed;bottom:88px;right:16px;z-index:500;
            background:rgba(15,15,30,0.88);color:#e2e8f0;
            padding:8px 14px;border-radius:20px;font-size:0.78rem;font-weight:600;
            backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.1);
            cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,0.45);
            display:flex;align-items:center;gap:6px;
        `;
        b.innerHTML = '<span>🎨</span><span>Sedang menggambar...</span>';
        b.onclick = () => { openDoodle(); b.remove(); };
        document.body.appendChild(b);
        setTimeout(() => b?.remove(), 5000);
    }

    // ── SEND ────────────────────────────────────────────────
    // Instagram style: screenshot messagesArea + canvas digabung → kirim
    async function _sendDoodle() {
        if (!_myUid || !_partnerId || !_db) return;

        // Cek canvas kosong
        const px = _ctx.getImageData(0, 0, _canvas.width, _canvas.height).data;
        const empty = !px.some(v => v !== 0);
        if (empty) { alert('⚠️ Canvas kosong, gambar sesuatu dulu!'); return; }

        // ── Composite: ambil screenshot messagesArea + canvas coretan ──
        // Karena html2canvas mungkin tidak tersedia, kita buat composite manual:
        // 1. Buat offscreen canvas seukuran messagesArea
        // 2. Render background gelap (warna chat) lalu overlay canvas coretan

        const W = _canvas.width;
        const H = _canvas.height;

        const composite = document.createElement('canvas');
        composite.width  = W;
        composite.height = H;
        const cctx = composite.getContext('2d');

        // Background solid (warna bg chat = #0d1117)
        cctx.fillStyle = '#0d1117';
        cctx.fillRect(0, 0, W, H);

        // Overlay coretan user
        cctx.globalCompositeOperation = 'source-over';
        cctx.drawImage(_canvas, 0, 0, W, H);

        const finalDataUrl = composite.toDataURL('image/jpeg', 0.88);

        // Kirim sebagai pesan
        const chatId = _chatId(_myUid, _partnerId);
        const { ref, push } = _fb;
        const msgData = {
            type:      'doodle',
            image:     finalDataUrl,
            senderId:  _myUid,
            senderName: window.currentUserName || 'User',
            timestamp: Date.now(),
            read:      false,
        };

        try {
            await push(ref(_db, `chats/${chatId}/messages`), msgData);
            if (window.StreakSystem) window.StreakSystem.recordSend(_partnerId);

            // Clear canvas & close
            _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
            _history = []; _redoStack = []; _refreshBtns();
            // Clear live
            const { set } = _fb;
            set(ref(_db, _livePath()), { image: null, from: _myUid, ts: Date.now() }).catch(()=>{});
            closeDoodle();
        } catch(err) {
            alert('❌ Gagal kirim: ' + err.message);
        }
    }

    // ── OPEN / CLOSE ────────────────────────────────────────
    function openDoodle() {
        if (!_partnerId) { alert('⚠️ Pilih chat dulu!'); return; }
        _build();
        _syncCanvasSize();
        _wrap.classList.add('doodle-active');
        document.getElementById('doodleToggleBtn')?.classList.add('doodle-on');
        _listenLive();
        _updateCursor();
    }

    function closeDoodle() {
        _wrap?.classList.remove('doodle-active');
        document.getElementById('doodleToggleBtn')?.classList.remove('doodle-on');
        if (_liveListener) { _liveListener(); _liveListener = null; }
    }

    function openViewer(src) {
        const v = document.getElementById('doodleViewer');
        const i = document.getElementById('doodleViewerImg');
        if (!v || !i) return;
        i.src = src;
        v.classList.add('dv-open');
    }

    // ── PUBLIC API ───────────────────────────────────────────
    function onSelectUser(uid) {
        _partnerId = uid;
        if (_ctx && _canvas) {
            _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
            _history = []; _redoStack = []; _refreshBtns();
        }
        if (_wrap?.classList.contains('doodle-active')) _listenLive();
    }

    function init(db, firebaseModules) {
        _db = db;
        _fb = firebaseModules;

        // Wait for _myUid (set oleh StreakSystem.init)
        const t = setInterval(() => {
            if (window._myUid) { _myUid = window._myUid; clearInterval(t); }
        }, 200);

        // Hook toggle button
        const btn = document.getElementById('doodleToggleBtn');
        if (btn) {
            btn.addEventListener('click', () => {
                _wrap?.classList.contains('doodle-active') ? closeDoodle() : openDoodle();
            });
        }

        console.log('[DoodleSystem v2] ✅ Ready');
    }

    return { init, onSelectUser, openDoodle, closeDoodle, openViewer };

})();

window.DoodleSystem = DoodleSystem;
