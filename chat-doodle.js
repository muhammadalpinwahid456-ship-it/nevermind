/**
 * ============================================================
 *  CHAT DOODLE SYSTEM - Instagram DM Draw Style
 *  File: chat-doodle.js
 *
 *  CARA INTEGRASI KE chat.html:
 *  ─────────────────────────────
 *  1. Di <head>, tambahkan:
 *       <link rel="stylesheet" href="chat-doodle.css">
 *
 *  2. Sebelum </body>, tambahkan:
 *       <script src="chat-doodle.js"></script>
 *
 *  3. Di dalam input-area (setelah tombol 📎 dan sebelum message-input),
 *     tambahkan tombol doodle:
 *       <button id="doodleToggleBtn" title="Draw / Doodle">✏️</button>
 *
 *  4. Bungkus .chat-area (atau element induk yang memuat messages + input)
 *     dengan position: relative jika belum.
 *
 *  5. Di dalam onAuthStateChanged (setelah StreakSystem.init):
 *       DoodleSystem.init(database, { ref, set, push, onValue, get });
 *
 *  6. Di dalam selectUser():
 *       DoodleSystem.onSelectUser(userId);
 * ============================================================
 */

const DoodleSystem = (() => {

    // ── STATE ───────────────────────────────────────────────
    let _db          = null;
    let _fb          = null;   // firebase modules
    let _myUid       = null;
    let _myName      = '';
    let _partnerId   = null;
    let _isDrawing   = false;
    let _eraser      = false;
    let _color       = '#ffffff';
    let _lineWidth   = 5;
    let _history     = [];      // Array<ImageData> untuk undo
    let _redoStack   = [];
    let _listener    = null;    // Firebase unsubscribe
    let _chatAreaEl  = null;

    // Canvas refs
    let _overlay, _canvas, _ctx;

    // ── PRESET COLORS ───────────────────────────────────────
    const PRESET_COLORS = [
        '#ffffff', '#ff4d4d', '#ff9f43',
        '#ffd32a', '#0be881', '#17c0eb',
        '#7d5fff', '#ff78c4', '#000000',
    ];

    // ── UTIL ────────────────────────────────────────────────
    function _chatId(uid1, uid2) {
        return [uid1, uid2].sort().join('_');
    }

    function _doodlePath() {
        return `doodles/${_chatId(_myUid, _partnerId)}`;
    }

    // Canvas → base64 PNG (compressed)
    function _getDataURL() {
        return _canvas.toDataURL('image/png', 0.85);
    }

    // ── BUILD OVERLAY HTML ───────────────────────────────────
    function _buildOverlay() {
        // Prevent duplicate
        if (document.getElementById('doodleOverlay')) return;

        // Find chat area container
        _chatAreaEl = document.querySelector('.chat-area')
                   || document.querySelector('.chat-container')
                   || document.querySelector('.messages-area')?.parentElement
                   || document.body;

        // Make sure parent is positioned
        if (getComputedStyle(_chatAreaEl).position === 'static') {
            _chatAreaEl.style.position = 'relative';
        }

        // ── Overlay ──
        _overlay = document.createElement('div');
        _overlay.id = 'doodleOverlay';
        _overlay.innerHTML = `
            <span id="doodleLabel">✏️ Mode Menggambar</span>
            <button id="doodleCloseBtn" title="Tutup">✕</button>

            <canvas id="doodleCanvas"></canvas>

            <!-- Cursor size preview -->
            <div id="doodleCursorPreview">
                <div id="doodleCursorDot" style="width:10px;height:10px;"></div>
                <span id="doodleCursorLabel" style="font-size:0.7rem;color:rgba(255,255,255,0.6);">5px</span>
            </div>

            <!-- Toolbar -->
            <div id="doodleToolbar">

                <!-- Colors -->
                <div class="doodle-colors" id="doodleColorSwatches"></div>
                <input type="color" id="doodleColorPicker" value="${_color}" title="Pilih warna">

                <div class="doodle-divider"></div>

                <!-- Brush Size -->
                <div class="doodle-size-wrap">
                    <span class="doodle-size-icon">•</span>
                    <input type="range" id="doodleSizeSlider" min="2" max="40" value="${_lineWidth}">
                    <span class="doodle-size-icon big">●</span>
                </div>

                <div class="doodle-divider"></div>

                <!-- Eraser -->
                <button class="doodle-tool-btn" id="doodleEraserBtn" title="Eraser">🧹</button>

                <!-- Undo / Redo -->
                <button class="doodle-tool-btn" id="doodleUndoBtn" title="Undo" disabled>↩</button>
                <button class="doodle-tool-btn" id="doodleRedoBtn" title="Redo" disabled>↪</button>

                <!-- Clear -->
                <button class="doodle-tool-btn" id="doodleClearBtn" title="Hapus semua">🗑️</button>

                <div class="doodle-divider"></div>

                <!-- Send -->
                <button id="doodleSendBtn">Kirim 🎨</button>
            </div>
        `;
        _chatAreaEl.appendChild(_overlay);

        // ── Canvas ref ──
        _canvas = document.getElementById('doodleCanvas');
        _ctx    = _canvas.getContext('2d');

        _resizeCanvas();

        // ── Build color swatches ──
        const swatchWrap = document.getElementById('doodleColorSwatches');
        PRESET_COLORS.forEach(c => {
            const s = document.createElement('div');
            s.className = 'doodle-color-swatch' + (c === _color ? ' selected' : '');
            s.style.background = c;
            s.title = c;
            s.addEventListener('click', () => _setColor(c, s));
            swatchWrap.appendChild(s);
        });

        // ── Fullscreen viewer ──
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

        _bindEvents();
    }

    // ── CANVAS RESIZE ────────────────────────────────────────
    function _resizeCanvas() {
        if (!_canvas || !_overlay) return;
        const rect = _overlay.getBoundingClientRect();
        // Save current drawing
        let saved = null;
        if (_canvas.width > 0 && _canvas.height > 0) {
            try { saved = _ctx.getImageData(0, 0, _canvas.width, _canvas.height); } catch(e) {}
        }
        _canvas.width  = rect.width  || _overlay.offsetWidth  || 400;
        _canvas.height = rect.height || _overlay.offsetHeight || 600;
        if (saved) {
            try { _ctx.putImageData(saved, 0, 0); } catch(e) {}
        }
    }

    // ── COLOR HELPER ─────────────────────────────────────────
    function _setColor(c, swatchEl) {
        _color = c;
        _eraser = false;
        document.getElementById('doodleEraserBtn')?.classList.remove('active');
        _canvas?.classList.remove('eraser-mode');
        // Update selected swatch
        document.querySelectorAll('.doodle-color-swatch').forEach(s => s.classList.remove('selected'));
        swatchEl?.classList.add('selected');
        // Update picker display (best-effort)
        const picker = document.getElementById('doodleColorPicker');
        if (picker) picker.value = c;
        _updateCursorPreview();
    }

    // ── CURSOR PREVIEW ───────────────────────────────────────
    function _updateCursorPreview() {
        const dot   = document.getElementById('doodleCursorDot');
        const label = document.getElementById('doodleCursorLabel');
        if (!dot) return;
        const sz = Math.min(_lineWidth * 2, 36);
        dot.style.width  = sz + 'px';
        dot.style.height = sz + 'px';
        dot.style.background = _eraser ? 'rgba(255,255,255,0.3)' : _color;
        dot.style.border = _eraser ? '2px dashed rgba(255,255,255,0.5)' : '1px solid rgba(0,0,0,0.2)';
        if (label) label.textContent = _lineWidth + 'px';
    }

    // ── BIND EVENTS ──────────────────────────────────────────
    function _bindEvents() {

        // Close button
        document.getElementById('doodleCloseBtn').addEventListener('click', closeDoodle);

        // Eraser
        document.getElementById('doodleEraserBtn').addEventListener('click', () => {
            _eraser = !_eraser;
            document.getElementById('doodleEraserBtn').classList.toggle('active', _eraser);
            _canvas.classList.toggle('eraser-mode', _eraser);
            _updateCursorPreview();
        });

        // Undo
        document.getElementById('doodleUndoBtn').addEventListener('click', _undo);

        // Redo
        document.getElementById('doodleRedoBtn').addEventListener('click', _redo);

        // Clear
        document.getElementById('doodleClearBtn').addEventListener('click', () => {
            if (!confirm('Hapus semua coretan?')) return;
            _saveHistory();
            _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
            _syncClear();
        });

        // Send
        document.getElementById('doodleSendBtn').addEventListener('click', _sendDoodle);

        // Brush size
        document.getElementById('doodleSizeSlider').addEventListener('input', e => {
            _lineWidth = parseInt(e.target.value);
            _updateCursorPreview();
        });

        // Custom color picker
        document.getElementById('doodleColorPicker').addEventListener('input', e => {
            _color = e.target.value;
            _eraser = false;
            document.getElementById('doodleEraserBtn').classList.remove('active');
            _canvas.classList.remove('eraser-mode');
            document.querySelectorAll('.doodle-color-swatch').forEach(s => s.classList.remove('selected'));
            _updateCursorPreview();
        });

        // ── Drawing: Mouse ──
        _canvas.addEventListener('mousedown',  _startDraw);
        _canvas.addEventListener('mousemove',  _draw);
        _canvas.addEventListener('mouseup',    _endDraw);
        _canvas.addEventListener('mouseleave', _endDraw);

        // ── Drawing: Touch ──
        _canvas.addEventListener('touchstart',  _touchStart,  { passive: false });
        _canvas.addEventListener('touchmove',   _touchMove,   { passive: false });
        _canvas.addEventListener('touchend',    _endDraw);
        _canvas.addEventListener('touchcancel', _endDraw);

        // Resize
        window.addEventListener('resize', _resizeCanvas);
    }

    // ── DRAW HELPERS ─────────────────────────────────────────
    function _getPos(e) {
        const rect = _canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (_canvas.width / rect.width),
            y: (e.clientY - rect.top)  * (_canvas.height / rect.height),
        };
    }

    function _saveHistory() {
        _history.push(_ctx.getImageData(0, 0, _canvas.width, _canvas.height));
        if (_history.length > 40) _history.shift();
        _redoStack = [];
        _refreshUndoRedo();
    }

    function _refreshUndoRedo() {
        const undoBtn = document.getElementById('doodleUndoBtn');
        const redoBtn = document.getElementById('doodleRedoBtn');
        if (undoBtn) undoBtn.disabled = _history.length === 0;
        if (redoBtn) redoBtn.disabled = _redoStack.length === 0;
    }

    function _undo() {
        if (_history.length === 0) return;
        _redoStack.push(_ctx.getImageData(0, 0, _canvas.width, _canvas.height));
        const prev = _history.pop();
        _ctx.putImageData(prev, 0, 0);
        _refreshUndoRedo();
    }

    function _redo() {
        if (_redoStack.length === 0) return;
        _history.push(_ctx.getImageData(0, 0, _canvas.width, _canvas.height));
        const next = _redoStack.pop();
        _ctx.putImageData(next, 0, 0);
        _refreshUndoRedo();
    }

    function _startDraw(e) {
        e.preventDefault();
        _saveHistory();
        _isDrawing = true;
        const pos = _getPos(e);
        _ctx.beginPath();
        _ctx.moveTo(pos.x, pos.y);
        _applyStyle();
    }

    function _draw(e) {
        if (!_isDrawing) return;
        e.preventDefault();
        const pos = _getPos(e);
        _ctx.lineTo(pos.x, pos.y);
        _ctx.stroke();
    }

    function _endDraw() {
        if (!_isDrawing) return;
        _isDrawing = false;
        _ctx.closePath();
        // Realtime sync every stroke end
        _syncStroke();
    }

    // ── Touch ────────────────────────────────────────────────
    function _touchStart(e) {
        e.preventDefault();
        const touch = e.touches[0];
        _startDraw({ clientX: touch.clientX, clientY: touch.clientY, preventDefault: () => {} });
    }
    function _touchMove(e) {
        e.preventDefault();
        const touch = e.touches[0];
        _draw({ clientX: touch.clientX, clientY: touch.clientY, preventDefault: () => {} });
    }

    function _applyStyle() {
        if (_eraser) {
            _ctx.globalCompositeOperation = 'destination-out';
            _ctx.strokeStyle = 'rgba(0,0,0,1)';
            _ctx.lineWidth   = _lineWidth * 2;
        } else {
            _ctx.globalCompositeOperation = 'source-over';
            _ctx.strokeStyle = _color;
            _ctx.lineWidth   = _lineWidth;
        }
        _ctx.lineCap  = 'round';
        _ctx.lineJoin = 'round';
    }

    // ── FIREBASE REALTIME SYNC ───────────────────────────────
    // Realtime "live canvas" — sync tiap stroke selesai (base64 small image)
    let _syncTimeout = null;
    function _syncStroke() {
        // Debounce 300ms agar tidak terlalu banyak write
        clearTimeout(_syncTimeout);
        _syncTimeout = setTimeout(() => {
            if (!_db || !_myUid || !_partnerId) return;
            const { ref, set } = _fb;
            const dataUrl = _getDataURL();
            set(ref(_db, `${_doodlePath()}/live`), {
                image: dataUrl,
                from: _myUid,
                ts: Date.now(),
            }).catch(err => console.error('[Doodle] sync error', err));
        }, 300);
    }

    function _syncClear() {
        if (!_db || !_myUid || !_partnerId) return;
        const { ref, set } = _fb;
        set(ref(_db, `${_doodlePath()}/live`), {
            image: null,
            from: _myUid,
            ts: Date.now(),
        }).catch(() => {});
    }

    // Listen to partner's canvas in realtime
    function _listenLive() {
        if (!_db || !_myUid || !_partnerId) return;
        if (_listener) { _listener(); _listener = null; }
        const { ref, onValue } = _fb;
        _listener = onValue(ref(_db, `${_doodlePath()}/live`), (snap) => {
            if (!snap.exists()) return;
            const data = snap.val();
            // Only apply partner's strokes, not our own (avoid echo)
            if (data.from === _myUid) return;
            if (!data.image) {
                // Partner cleared
                _ctx?.clearRect(0, 0, _canvas?.width || 0, _canvas?.height || 0);
                return;
            }
            // Draw partner's canvas onto ours
            const img = new Image();
            img.onload = () => {
                if (!_overlay?.classList.contains('doodle-active')) {
                    // Overlay not open — show "partner is drawing" indicator
                    _showPartnerDrawingIndicator(data.image);
                } else {
                    // Merge: preserve own strokes, overlay partner
                    // We draw partner's canvas as underlay/overlay
                    _ctx.globalCompositeOperation = 'source-over';
                    _ctx.drawImage(img, 0, 0, _canvas.width, _canvas.height);
                }
            };
            img.src = data.image;
        });
    }

    // Show small "partner is drawing 🎨" badge
    function _showPartnerDrawingIndicator(imgSrc) {
        let badge = document.getElementById('doodlePartnerBadge');
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'doodlePartnerBadge';
            badge.style.cssText = `
                position:fixed;bottom:90px;right:18px;z-index:500;
                background:rgba(20,20,35,0.85);color:#e2e8f0;
                padding:8px 14px;border-radius:20px;font-size:0.78rem;font-weight:600;
                backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.1);
                cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,0.4);
                display:flex;align-items:center;gap:6px;
                animation:slideInRight 0.3s ease;
            `;
            badge.innerHTML = `<span>🎨</span><span>Sedang menggambar...</span>`;
            badge.addEventListener('click', () => {
                openDoodle();
                badge.remove();
            });
            document.body.appendChild(badge);
            setTimeout(() => badge?.remove(), 5000);
        }
    }

    // ── SEND DOODLE as message ───────────────────────────────
    async function _sendDoodle() {
        if (!_myUid || !_partnerId || !_db) return;

        // Check if canvas is blank
        const blank = _isCanvasBlank();
        if (blank) { alert('⚠️ Canvas masih kosong, gambar sesuatu dulu!'); return; }

        const dataUrl = _getDataURL();
        const { ref, push, set } = _fb;

        // Save as message in chat
        const chatId     = _chatId(_myUid, _partnerId);
        const messageRef = ref(_db, `chats/${chatId}/messages`);
        const msgData = {
            type:      'doodle',
            image:     dataUrl,
            senderId:  _myUid,
            senderName: window.currentUserName || 'User',
            timestamp: Date.now(),
            read:      false,
        };

        try {
            await push(messageRef, msgData);
            // Also record for StreakSystem
            if (window.StreakSystem) window.StreakSystem.recordSend(_partnerId);
            // Clear canvas & close
            _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
            _history = [];
            _redoStack = [];
            _refreshUndoRedo();
            _syncClear();
            closeDoodle();
        } catch (err) {
            console.error('[Doodle] send error', err);
            alert('❌ Gagal mengirim: ' + err.message);
        }
    }

    function _isCanvasBlank() {
        const data = _ctx.getImageData(0, 0, _canvas.width, _canvas.height).data;
        return !data.some(v => v !== 0);
    }

    // ── RENDER DOODLE BUBBLE in messages area ────────────────
    // Call this from your renderMessage() function when msg.type === 'doodle'
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

    function openViewer(src) {
        const viewer = document.getElementById('doodleViewer');
        const img    = document.getElementById('doodleViewerImg');
        if (!viewer || !img) return;
        img.src = src;
        viewer.classList.add('open');
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
        _resizeCanvas();
        _overlay.classList.add('doodle-active');
        const btn = document.getElementById('doodleToggleBtn');
        if (btn) btn.classList.add('active');
        _listenLive();
        _updateCursorPreview();
    }

    function closeDoodle() {
        _overlay?.classList.remove('doodle-active');
        const btn = document.getElementById('doodleToggleBtn');
        if (btn) btn.classList.remove('active');
        // Stop live listener when closed
        if (_listener) { _listener(); _listener = null; }
    }

    // ── CALLED FROM selectUser() ─────────────────────────────
    function onSelectUser(userId) {
        _partnerId = userId;
        // Reset canvas if switching partner
        if (_ctx && _canvas) {
            _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
            _history = [];
            _redoStack = [];
            _refreshUndoRedo();
        }
        if (_overlay?.classList.contains('doodle-active')) {
            _listenLive();
        }
    }

    // ── INIT ─────────────────────────────────────────────────
    function init(db, firebaseModules) {
        _db  = db;
        _fb  = firebaseModules;
        _myUid = window._myUid || null;

        // Watch for _myUid to be set (set by StreakSystem.init or onAuthStateChanged)
        const _waitUid = setInterval(() => {
            if (window._myUid) {
                _myUid = window._myUid;
                clearInterval(_waitUid);
            }
        }, 300);

        // Hook toggle button
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

        console.log('[DoodleSystem] ✅ Initialized');
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
