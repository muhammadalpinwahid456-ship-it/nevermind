/**
 * ============================================================
 *  CHAT DOODLE SYSTEM v4 - Instagram DM Draw Style (OVERLAY)
 *  File: chat-doodle.js
 *
 *  CARA KERJA BARU:
 *  - Doodle muncul sebagai OVERLAY TRANSPARAN di atas chat
 *  - Coretan langsung terlihat oleh user lain secara realtime
 *  - Tidak ada bubble pesan — coretan muncul di atas tampilan chat
 *  - Mirip persis Instagram DM Draw feature
 *
 *  STRUKTUR FIREBASE  →  doodles/{chatId}/live
 *  {
 *    image   : base64 PNG string,
 *    from    : uid,
 *    ts      : timestamp,
 *    cleared : boolean (optional)
 *  }
 *
 *  INTEGRASI (sama seperti v3):
 *  1. <link rel="stylesheet" href="chat-doodle.css"> di <head>
 *  2. DoodleSystem.init(database, { ref, set, push, onValue, get })
 *  3. DoodleSystem.onSelectUser(userId) di selectUser()
 *  4. <button id="doodleToggleBtn">✏️</button> di input area
 * ============================================================
 */

const DoodleSystem = (() => {

    // ── STATE ────────────────────────────────────────────────
    let _db        = null;
    let _fb        = null;
    let _myUid     = null;
    let _partnerId = null;
    let _isDrawing = false;
    let _eraser    = false;
    let _color     = '#ff3b30';   // default merah seperti Instagram
    let _lineWidth = 6;
    let _history   = [];
    let _redoStack = [];
    let _listener  = null;
    let _syncTimeout = null;

    // DOM refs
    let _overlay, _myCanvas, _myCtx;
    let _partnerCanvas, _partnerCtx;

    const PRESET_COLORS = [
        '#ffffff', '#ff3b30', '#ff9500',
        '#ffcc00', '#34c759', '#007aff',
        '#af52de', '#ff2d55', '#000000',
    ];

    // ── UTIL ─────────────────────────────────────────────────
    function _chatId(a, b) { return [a, b].sort().join('_'); }
    function _livePath()   { return `doodles/${_chatId(_myUid, _partnerId)}/live`; }

    // ── BUILD OVERLAY ────────────────────────────────────────
    function _buildOverlay() {
        if (document.getElementById('doodleOverlay')) return;

        // Container = messages-area parent (chat-window)
        const chatWindow = document.getElementById('chatWindow')
                        || document.querySelector('.chat-window')
                        || document.querySelector('.chat-area');
        if (!chatWindow) return;
        if (getComputedStyle(chatWindow).position === 'static') {
            chatWindow.style.position = 'relative';
        }

        _overlay = document.createElement('div');
        _overlay.id = 'doodleOverlay';
        _overlay.innerHTML = `
            <!-- Partner canvas (bawah, hanya tampil) -->
            <canvas id="doodlePartnerCanvas"></canvas>

            <!-- My canvas (atas, interaktif) -->
            <canvas id="doodleMyCanvas"></canvas>

            <!-- Close button -->
            <button id="doodleCloseBtn" title="Tutup">✕</button>

            <!-- Drawing label -->
            <div id="doodleLabel">✏️ Menggambar...</div>

            <!-- Partner drawing indicator -->
            <div id="doodlePartnerIndicator">🎨 <span id="doodlePartnerName">Partner</span> sedang menggambar...</div>

            <!-- Toolbar -->
            <div id="doodleToolbar">
                <div class="doodle-colors" id="doodleColorSwatches"></div>
                <input type="color" id="doodleColorPicker" value="${_color}" title="Warna custom">

                <div class="doodle-divider"></div>

                <div class="doodle-size-wrap">
                    <span class="doodle-size-icon">•</span>
                    <input type="range" id="doodleSizeSlider" min="2" max="40" value="${_lineWidth}">
                    <span class="doodle-size-icon big">●</span>
                </div>

                <div class="doodle-divider"></div>

                <button class="doodle-tool-btn" id="doodleEraserBtn" title="Eraser">🧹</button>
                <button class="doodle-tool-btn" id="doodleUndoBtn" title="Undo" disabled>↩</button>
                <button class="doodle-tool-btn" id="doodleRedoBtn" title="Redo" disabled>↪</button>
                <button class="doodle-tool-btn" id="doodleClearBtn" title="Hapus semua">🗑️</button>
            </div>
        `;

        chatWindow.appendChild(_overlay);

        _myCanvas      = document.getElementById('doodleMyCanvas');
        _myCtx         = _myCanvas.getContext('2d');
        _partnerCanvas = document.getElementById('doodlePartnerCanvas');
        _partnerCtx    = _partnerCanvas.getContext('2d');

        _resizeCanvases();
        _buildColorSwatches();
        _bindEvents();

        // Full screen doodle viewer (untuk mode buka doodle partner saat overlay tutup)
        if (!document.getElementById('doodleViewer')) {
            const viewer = document.createElement('div');
            viewer.id = 'doodleViewer';
            viewer.innerHTML = `
                <img id="doodleViewerImg" src="" alt="doodle">
                <button id="doodleViewerClose">Tutup</button>`;
            document.body.appendChild(viewer);
            document.getElementById('doodleViewerClose').onclick = () =>
                viewer.classList.remove('open');
            viewer.addEventListener('click', e => {
                if (e.target === viewer) viewer.classList.remove('open');
            });
        }
    }

    // ── CANVAS RESIZE ────────────────────────────────────────
    function _resizeCanvases() {
        if (!_overlay) return;
        const w = _overlay.offsetWidth  || 400;
        const h = _overlay.offsetHeight || 600;

        [_myCanvas, _partnerCanvas].forEach(c => {
            if (!c) return;
            // Preserve drawing
            let saved = null;
            if (c.width > 0 && c.height > 0) {
                try {
                    const ctx = c.getContext('2d');
                    saved = ctx.getImageData(0, 0, c.width, c.height);
                } catch(e) {}
            }
            c.width  = w;
            c.height = h;
            if (saved) {
                try { c.getContext('2d').putImageData(saved, 0, 0); } catch(e) {}
            }
        });
    }

    // ── COLOR SWATCHES ───────────────────────────────────────
    function _buildColorSwatches() {
        const wrap = document.getElementById('doodleColorSwatches');
        if (!wrap) return;
        wrap.innerHTML = '';
        PRESET_COLORS.forEach(c => {
            const s = document.createElement('div');
            s.className = 'doodle-color-swatch' + (c === _color ? ' selected' : '');
            s.style.background = c;
            s.title = c;
            s.addEventListener('click', () => _setColor(c, s));
            wrap.appendChild(s);
        });
    }

    function _setColor(c, el) {
        _color  = c;
        _eraser = false;
        document.getElementById('doodleEraserBtn')?.classList.remove('active');
        _myCanvas?.classList.remove('eraser-mode');
        document.querySelectorAll('.doodle-color-swatch').forEach(s => s.classList.remove('selected'));
        el?.classList.add('selected');
        const picker = document.getElementById('doodleColorPicker');
        if (picker) picker.value = c;
    }

    // ── BIND EVENTS ──────────────────────────────────────────
    function _bindEvents() {
        document.getElementById('doodleCloseBtn').addEventListener('click', closeDoodle);

        document.getElementById('doodleEraserBtn').addEventListener('click', () => {
            _eraser = !_eraser;
            document.getElementById('doodleEraserBtn').classList.toggle('active', _eraser);
            _myCanvas.classList.toggle('eraser-mode', _eraser);
        });

        document.getElementById('doodleUndoBtn').addEventListener('click', _undo);
        document.getElementById('doodleRedoBtn').addEventListener('click', _redo);

        document.getElementById('doodleClearBtn').addEventListener('click', () => {
            _saveHistory();
            _myCtx.clearRect(0, 0, _myCanvas.width, _myCanvas.height);
            _syncCanvas(); // sync clear ke partner
        });

        document.getElementById('doodleSizeSlider').addEventListener('input', e => {
            _lineWidth = parseInt(e.target.value);
        });

        document.getElementById('doodleColorPicker').addEventListener('input', e => {
            _color  = e.target.value;
            _eraser = false;
            document.getElementById('doodleEraserBtn')?.classList.remove('active');
            _myCanvas?.classList.remove('eraser-mode');
            document.querySelectorAll('.doodle-color-swatch').forEach(s => s.classList.remove('selected'));
        });

        // Mouse
        _myCanvas.addEventListener('mousedown',  _startDraw);
        _myCanvas.addEventListener('mousemove',  _draw);
        _myCanvas.addEventListener('mouseup',    _endDraw);
        _myCanvas.addEventListener('mouseleave', _endDraw);

        // Touch
        _myCanvas.addEventListener('touchstart',  _touchStart,  { passive: false });
        _myCanvas.addEventListener('touchmove',   _touchMove,   { passive: false });
        _myCanvas.addEventListener('touchend',    _endDraw);
        _myCanvas.addEventListener('touchcancel', _endDraw);

        window.addEventListener('resize', _resizeCanvases);
    }

    // ── DRAW ─────────────────────────────────────────────────
    function _getPos(e) {
        const rect = _myCanvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (_myCanvas.width / rect.width),
            y: (e.clientY - rect.top)  * (_myCanvas.height / rect.height),
        };
    }

    function _saveHistory() {
        _history.push(_myCtx.getImageData(0, 0, _myCanvas.width, _myCanvas.height));
        if (_history.length > 40) _history.shift();
        _redoStack = [];
        _refreshUndoRedo();
    }

    function _refreshUndoRedo() {
        const u = document.getElementById('doodleUndoBtn');
        const r = document.getElementById('doodleRedoBtn');
        if (u) u.disabled = _history.length === 0;
        if (r) r.disabled = _redoStack.length === 0;
    }

    function _undo() {
        if (!_history.length) return;
        _redoStack.push(_myCtx.getImageData(0, 0, _myCanvas.width, _myCanvas.height));
        _myCtx.putImageData(_history.pop(), 0, 0);
        _refreshUndoRedo();
        _syncCanvas();
    }

    function _redo() {
        if (!_redoStack.length) return;
        _history.push(_myCtx.getImageData(0, 0, _myCanvas.width, _myCanvas.height));
        _myCtx.putImageData(_redoStack.pop(), 0, 0);
        _refreshUndoRedo();
        _syncCanvas();
    }

    function _applyStyle() {
        if (_eraser) {
            _myCtx.globalCompositeOperation = 'destination-out';
            _myCtx.strokeStyle = 'rgba(0,0,0,1)';
            _myCtx.lineWidth   = _lineWidth * 2;
        } else {
            _myCtx.globalCompositeOperation = 'source-over';
            _myCtx.strokeStyle = _color;
            _myCtx.lineWidth   = _lineWidth;
        }
        _myCtx.lineCap  = 'round';
        _myCtx.lineJoin = 'round';
    }

    function _startDraw(e) {
        e.preventDefault();
        _saveHistory();
        _isDrawing = true;
        const pos = _getPos(e);
        _myCtx.beginPath();
        _myCtx.moveTo(pos.x, pos.y);
        _applyStyle();
    }

    function _draw(e) {
        if (!_isDrawing) return;
        e.preventDefault();
        const pos = _getPos(e);
        _myCtx.lineTo(pos.x, pos.y);
        _myCtx.stroke();
    }

    function _endDraw() {
        if (!_isDrawing) return;
        _isDrawing = false;
        _myCtx.closePath();
        _syncCanvas();
    }

    function _touchStart(e) {
        e.preventDefault();
        const t = e.touches[0];
        _startDraw({ clientX: t.clientX, clientY: t.clientY, preventDefault: ()=>{} });
    }
    function _touchMove(e) {
        e.preventDefault();
        const t = e.touches[0];
        _draw({ clientX: t.clientX, clientY: t.clientY, preventDefault: ()=>{} });
    }

    // ── FIREBASE SYNC ─────────────────────────────────────────
    // Sync canvas ke Firebase (debounce 200ms)
    function _syncCanvas() {
        clearTimeout(_syncTimeout);
        _syncTimeout = setTimeout(() => {
            if (!_db || !_myUid || !_partnerId) return;
            const { ref, set } = _fb;
            // Check if blank
            const imageData = _myCtx.getImageData(0, 0, _myCanvas.width, _myCanvas.height);
            const isBlank   = !imageData.data.some(v => v !== 0);
            set(ref(_db, _livePath()), {
                image  : isBlank ? null : _myCanvas.toDataURL('image/png', 0.8),
                from   : _myUid,
                ts     : Date.now(),
                cleared: isBlank,
            }).catch(err => console.error('[Doodle] sync err:', err));
        }, 200);
    }

    // Listen realtime perubahan dari partner
    function _listenLive() {
        if (!_db || !_myUid || !_partnerId) return;
        if (_listener) { _listener(); _listener = null; }

        const { ref, onValue } = _fb;
        _listener = onValue(ref(_db, _livePath()), snap => {
            if (!snap.exists()) {
                _clearPartnerCanvas();
                return;
            }
            const data = snap.val();
            if (!data || data.from === _myUid) return; // ignore own echo

            if (data.cleared || !data.image) {
                _clearPartnerCanvas();
                _hidePartnerIndicator();
                return;
            }

            // Show partner drawing indicator (hanya jika overlay tertutup)
            if (!_overlay?.classList.contains('doodle-active')) {
                _showPartnerIndicator();
            }

            // Render ke partner canvas
            const img = new Image();
            img.onload = () => {
                _partnerCtx.clearRect(0, 0, _partnerCanvas.width, _partnerCanvas.height);
                _partnerCtx.drawImage(img, 0, 0, _partnerCanvas.width, _partnerCanvas.height);
            };
            img.src = data.image;
        });
    }

    function _clearPartnerCanvas() {
        if (_partnerCtx && _partnerCanvas) {
            _partnerCtx.clearRect(0, 0, _partnerCanvas.width, _partnerCanvas.height);
        }
    }

    // ── PARTNER INDICATOR ────────────────────────────────────
    // Muncul di atas chat saat partner menggambar tapi overlay kita belum buka
    function _showPartnerIndicator() {
        // Pastikan overlay ada dan tampilkan partial (hanya partner canvas + indicator)
        if (!_overlay) return;

        // Show overlay in "view-only" mode jika belum aktif
        if (!_overlay.classList.contains('doodle-active')) {
            _overlay.classList.add('doodle-view-only');
        }

        const ind = document.getElementById('doodlePartnerIndicator');
        if (ind) ind.classList.add('visible');

        // Set nama partner
        const nameEl = document.getElementById('doodlePartnerName');
        if (nameEl) {
            const partnerUser = window.allUsers?.find(u => u.uid === _partnerId);
            nameEl.textContent = partnerUser?.name || 'Partner';
        }
    }

    function _hidePartnerIndicator() {
        const ind = document.getElementById('doodlePartnerIndicator');
        if (ind) ind.classList.remove('visible');
        _overlay?.classList.remove('doodle-view-only');
    }

    // ── OPEN / CLOSE ─────────────────────────────────────────
    function openDoodle() {
        if (!_partnerId) {
            alert('⚠️ Pilih chat terlebih dahulu!');
            return;
        }
        if (!document.getElementById('doodleOverlay')) {
            _buildOverlay();
        }
        _resizeCanvases();
        _overlay.classList.add('doodle-active');
        _overlay.classList.remove('doodle-view-only');
        document.getElementById('doodleToggleBtn')?.classList.add('active');
        _listenLive();
    }

    function closeDoodle() {
        if (!_overlay) return;
        _overlay.classList.remove('doodle-active');
        document.getElementById('doodleToggleBtn')?.classList.remove('active');

        // Clear my canvas + sync (coretan hilang saat tutup)
        _myCtx?.clearRect(0, 0, _myCanvas?.width || 0, _myCanvas?.height || 0);
        _history   = [];
        _redoStack = [];
        _refreshUndoRedo();
        _syncCanvas(); // beritahu partner bahwa kita hapus

        // Stop listener
        if (_listener) { _listener(); _listener = null; }

        // Jika partner masih menggambar, tetap tampilkan view-only
        // (listener akan direstart dari _showPartnerIndicator jika ada update baru)
    }

    // ── ON SELECT USER ───────────────────────────────────────
    function onSelectUser(userId) {
        const prev = _partnerId;
        _partnerId = userId;

        if (prev !== userId) {
            // Reset
            _myCtx?.clearRect(0, 0, _myCanvas?.width || 0, _myCanvas?.height || 0);
            _clearPartnerCanvas();
            _history   = [];
            _redoStack = [];
            if (_overlay) {
                _overlay.classList.remove('doodle-active', 'doodle-view-only');
                document.getElementById('doodleToggleBtn')?.classList.remove('active');
            }
        }

        if (_overlay?.classList.contains('doodle-active')) {
            _listenLive();
        } else {
            // Selalu listen untuk notif partner menggambar
            _listenLive();
        }
    }

    // ── OPEN VIEWER (legacy, kept for compatibility) ──────────
    function openViewer(src) {
        const viewer = document.getElementById('doodleViewer');
        const img    = document.getElementById('doodleViewerImg');
        if (!viewer || !img) return;
        img.src = src;
        viewer.classList.add('open');
    }

    // renderDoodleBubble kept for backward compatibility (existing doodle messages in DB)
    function renderDoodleBubble(msg, isMine) {
        const wrap = document.createElement('div');
        wrap.className = `message-bubble ${isMine ? 'sent' : 'received'}`;
        wrap.innerHTML = `
            <div class="doodle-bubble" onclick="DoodleSystem.openViewer('${msg.image}')">
                <img src="${msg.image}" alt="Doodle" loading="lazy">
            </div>
            <div class="doodle-bubble-label">🎨 Doodle</div>`;
        return wrap;
    }

    // ── INIT ─────────────────────────────────────────────────
    function init(db, firebaseModules) {
        _db  = db;
        _fb  = firebaseModules;
        _myUid = window._myUid || null;

        const _waitUid = setInterval(() => {
            if (window._myUid) { _myUid = window._myUid; clearInterval(_waitUid); }
        }, 300);

        const toggleBtn = document.getElementById('doodleToggleBtn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                if (_overlay?.classList.contains('doodle-active')) {
                    closeDoodle();
                } else {
                    openDoodle();
                }
            });
        }

        console.log('[DoodleSystem v4] ✅ Initialized — overlay mode');
    }

    return {
        init,
        onSelectUser,
        openDoodle,
        closeDoodle,
        openViewer,
        renderDoodleBubble,
    };

})();

window.DoodleSystem = DoodleSystem;
