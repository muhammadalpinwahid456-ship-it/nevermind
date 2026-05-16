/**
 * ============================================================
 *  CHAT DOODLE SYSTEM v6 - Instagram Draw Style (FIXED OVERLAY)
 *  File: chat-doodle.js
 *
 *  PERUBAHAN v6 vs v5:
 *  - Overlay dipasang di <body> dengan position:fixed, dikunci ke
 *    bounding rect .chat-window → TIDAK ikut scroll pesan
 *  - Kedua user (A & B) melihat hasil akhir yang sama setelah publish
 *  - Cara kerja tetap sama: live draw → publish → freeze di kedua layar
 *
 *  STRUKTUR FIREBASE  →  doodles/{chatId}/live
 *  {
 *    image     : base64 PNG,
 *    from      : uid,
 *    ts        : timestamp,
 *    cleared   : boolean,
 *    published : boolean   ← coretan sudah "selesai" / frozen
 *  }
 * ============================================================
 */

const DoodleSystem = (() => {

    let _db        = null;
    let _fb        = null;
    let _myUid     = null;
    let _partnerId = null;
    let _isDrawing = false;
    let _eraser    = false;
    let _color     = '#ff3b30';
    let _lineWidth = 6;
    let _history   = [];
    let _redoStack = [];
    let _listener  = null;
    let _syncTimeout = null;
    let _hasPublished = false;

    let _overlay, _myCanvas, _myCtx;
    let _partnerCanvas, _partnerCtx;
    let _resizeObserver = null;
    let _rafId = null;

    const PRESET_COLORS = [
        '#ffffff', '#ff3b30', '#ff9500',
        '#ffcc00', '#34c759', '#007aff',
        '#af52de', '#ff2d55', '#000000',
    ];

    // ── UTIL ─────────────────────────────────────────────────
    function _chatId(a, b) { return [a, b].sort().join('_'); }
    function _livePath()   { return `doodles/${_chatId(_myUid, _partnerId)}/live`; }

    // ── POSISI OVERLAY (fixed mengikuti chat-window) ──────────
    function _getChatWindow() {
        return document.getElementById('chatWindow')
            || document.querySelector('.chat-window')
            || document.querySelector('.chat-area');
    }

    function _syncOverlayPosition() {
        if (!_overlay) return;
        const chatWin = _getChatWindow();
        if (!chatWin) return;
        const rect = chatWin.getBoundingClientRect();
        _overlay.style.left   = rect.left   + 'px';
        _overlay.style.top    = rect.top    + 'px';
        _overlay.style.width  = rect.width  + 'px';
        _overlay.style.height = rect.height + 'px';
    }

    function _startPositionLoop() {
        if (_rafId) return;
        const loop = () => {
            _syncOverlayPosition();
            _rafId = requestAnimationFrame(loop);
        };
        _rafId = requestAnimationFrame(loop);
    }

    function _stopPositionLoop() {
        if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    }

    // ── BUILD OVERLAY ────────────────────────────────────────
    function _buildOverlay() {
        if (document.getElementById('doodleOverlay')) return;

        _overlay = document.createElement('div');
        _overlay.id = 'doodleOverlay';
        _overlay.innerHTML = `
            <canvas id="doodlePartnerCanvas"></canvas>
            <canvas id="doodleMyCanvas"></canvas>
            <button id="doodleCloseBtn" title="Tutup">&#10005;</button>
            <div id="doodleLabel">&#9998;&#65039; Menggambar...</div>
            <div id="doodlePartnerIndicator">
                &#127912; <span id="doodlePartnerName">Partner</span> sedang menggambar...
            </div>
            <div id="doodleToolbar">
                <div class="doodle-colors" id="doodleColorSwatches"></div>
                <input type="color" id="doodleColorPicker" value="${_color}" title="Warna custom">
                <div class="doodle-divider"></div>
                <div class="doodle-size-wrap">
                    <span class="doodle-size-icon">&#8226;</span>
                    <input type="range" id="doodleSizeSlider" min="2" max="40" value="${_lineWidth}">
                    <span class="doodle-size-icon big">&#9679;</span>
                </div>
                <div class="doodle-divider"></div>
                <button class="doodle-tool-btn" id="doodleEraserBtn" title="Eraser">&#129529;</button>
                <button class="doodle-tool-btn" id="doodleUndoBtn" title="Undo" disabled>&#8617;</button>
                <button class="doodle-tool-btn" id="doodleRedoBtn" title="Redo" disabled>&#8618;</button>
                <button class="doodle-tool-btn" id="doodleClearBtn" title="Hapus semua">&#128465;&#65039;</button>
                <div class="doodle-divider"></div>
                <button id="doodleFinishBtn">Selesai &#10003;</button>
            </div>
        `;

        document.body.appendChild(_overlay);

        _myCanvas      = document.getElementById('doodleMyCanvas');
        _myCtx         = _myCanvas.getContext('2d');
        _partnerCanvas = document.getElementById('doodlePartnerCanvas');
        _partnerCtx    = _partnerCanvas.getContext('2d');

        _syncOverlayPosition();
        _resizeCanvases();
        _buildColorSwatches();
        _bindEvents();

        _resizeObserver = new ResizeObserver(() => {
            _syncOverlayPosition();
            _resizeCanvases();
        });
        const chatWin = _getChatWindow();
        if (chatWin) _resizeObserver.observe(chatWin);
        _resizeObserver.observe(document.documentElement);

        if (!document.getElementById('doodleViewer')) {
            const viewer = document.createElement('div');
            viewer.id = 'doodleViewer';
            viewer.innerHTML = '<img id="doodleViewerImg" src="" alt="doodle"><button id="doodleViewerClose">Tutup</button>';
            document.body.appendChild(viewer);
            document.getElementById('doodleViewerClose').onclick = () => viewer.classList.remove('open');
            viewer.addEventListener('click', e => { if (e.target === viewer) viewer.classList.remove('open'); });
        }
    }

    // ── CANVAS RESIZE ────────────────────────────────────────
    function _resizeCanvases() {
        if (!_overlay) return;
        const w = _overlay.offsetWidth  || 400;
        const h = _overlay.offsetHeight || 600;
        [_myCanvas, _partnerCanvas].forEach(c => {
            if (!c) return;
            let saved = null;
            if (c.width > 0 && c.height > 0) {
                try {
                    const tmp = document.createElement('canvas');
                    tmp.width = c.width; tmp.height = c.height;
                    tmp.getContext('2d').drawImage(c, 0, 0);
                    saved = tmp;
                } catch(e) {}
            }
            c.width  = w;
            c.height = h;
            if (saved) { try { c.getContext('2d').drawImage(saved, 0, 0, w, h); } catch(e) {} }
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
        document.getElementById('doodleFinishBtn').addEventListener('click', finishDoodle);

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
            _syncCanvas(false);
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

        _myCanvas.addEventListener('mousedown',  _startDraw);
        _myCanvas.addEventListener('mousemove',  _draw);
        _myCanvas.addEventListener('mouseup',    _endDraw);
        _myCanvas.addEventListener('mouseleave', _endDraw);

        _myCanvas.addEventListener('touchstart',  _touchStart,  { passive: false });
        _myCanvas.addEventListener('touchmove',   _touchMove,   { passive: false });
        _myCanvas.addEventListener('touchend',    _endDraw);
        _myCanvas.addEventListener('touchcancel', _endDraw);

        window.addEventListener('resize', () => { _syncOverlayPosition(); _resizeCanvases(); });
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
        _syncCanvas(false);
    }

    function _redo() {
        if (!_redoStack.length) return;
        _history.push(_myCtx.getImageData(0, 0, _myCanvas.width, _myCanvas.height));
        _myCtx.putImageData(_redoStack.pop(), 0, 0);
        _refreshUndoRedo();
        _syncCanvas(false);
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
        _syncCanvas(false);
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
    function _syncCanvas(published) {
        clearTimeout(_syncTimeout);
        _syncTimeout = setTimeout(() => {
            if (!_db || !_myUid || !_partnerId) return;
            const { ref, set } = _fb;
            const imageData = _myCtx.getImageData(0, 0, _myCanvas.width, _myCanvas.height);
            const isBlank   = !imageData.data.some(v => v !== 0);

            set(ref(_db, _livePath()), {
                image    : isBlank ? null : _myCanvas.toDataURL('image/png', 0.82),
                from     : _myUid,
                ts       : Date.now(),
                cleared  : isBlank,
                published: published === true,
            }).catch(err => console.error('[Doodle] sync err:', err));
        }, published ? 0 : 200);
    }

    // ── FINISH ───────────────────────────────────────────────
    function finishDoodle() {
        const imageData = _myCtx.getImageData(0, 0, _myCanvas.width, _myCanvas.height);
        const isBlank   = !imageData.data.some(v => v !== 0);
        if (isBlank) { alert('Canvas kosong, gambar sesuatu dulu!'); return; }

        _hasPublished = true;
        _syncCanvas(true);

        const btn = document.getElementById('doodleFinishBtn');
        if (btn) {
            btn.textContent = 'Terkirim!';
            btn.disabled = true;
            btn.style.background = 'rgba(52,199,89,0.35)';
            setTimeout(() => {
                if (btn) { btn.textContent = 'Selesai'; btn.disabled = false; btn.style.background = ''; }
            }, 2000);
        }

        setTimeout(_closeOverlayKeepCanvas, 800);
    }

    function _closeOverlayKeepCanvas() {
        _overlay?.classList.remove('doodle-active');
        document.getElementById('doodleToggleBtn')?.classList.remove('active');
        _history   = [];
        _redoStack = [];
        _refreshUndoRedo();
        if (_listener) { _listener(); _listener = null; }
        _listenLive();
        // Tetap jalankan position loop karena overlay masih tampil (view-only)
    }

    // ── LISTEN REALTIME ──────────────────────────────────────
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
            if (!data || data.from === _myUid) return;

            if (data.cleared || !data.image) {
                _clearPartnerCanvas();
                _hidePartnerIndicator();
                return;
            }

            if (!_overlay) _buildOverlay();

            const img = new Image();
            img.onload = () => {
                if (!_partnerCtx || !_partnerCanvas) return;
                _partnerCtx.clearRect(0, 0, _partnerCanvas.width, _partnerCanvas.height);
                _partnerCtx.drawImage(img, 0, 0, _partnerCanvas.width, _partnerCanvas.height);
            };
            img.src = data.image;

            if (data.published) {
                _hidePartnerIndicator();
                if (!_overlay?.classList.contains('doodle-active')) {
                    _overlay?.classList.add('doodle-view-only');
                    _startPositionLoop();
                    _showPublishToast();
                }
            } else {
                if (!_overlay?.classList.contains('doodle-active')) {
                    _showPartnerIndicator();
                    _overlay?.classList.add('doodle-view-only');
                    _startPositionLoop();
                }
            }
        });
    }

    function _clearPartnerCanvas() {
        if (_partnerCtx && _partnerCanvas) {
            _partnerCtx.clearRect(0, 0, _partnerCanvas.width, _partnerCanvas.height);
        }
        if (!_overlay?.classList.contains('doodle-active')) {
            _overlay?.classList.remove('doodle-view-only');
        }
    }

    function _showPartnerIndicator() {
        const ind = document.getElementById('doodlePartnerIndicator');
        if (ind) { ind.classList.add('visible'); ind.classList.remove('published'); }
        const nameEl = document.getElementById('doodlePartnerName');
        if (nameEl) {
            const u = window.allUsers?.find(u => u.uid === _partnerId);
            nameEl.textContent = u?.name || 'Partner';
        }
    }

    function _hidePartnerIndicator() {
        const ind = document.getElementById('doodlePartnerIndicator');
        if (ind) ind.classList.remove('visible', 'published');
    }

    function _showPublishToast() {
        const ind = document.getElementById('doodlePartnerIndicator');
        if (ind) {
            const u = window.allUsers?.find(u => u.uid === _partnerId);
            const name = u?.name || 'Partner';
            ind.innerHTML = '<span id="doodlePartnerName">' + name + '</span> mengirim doodle!';
            ind.classList.add('visible', 'published');
            setTimeout(() => _hidePartnerIndicator(), 3500);
        }
    }

    // ── OPEN / CLOSE ─────────────────────────────────────────
    function openDoodle() {
        if (!_partnerId) { alert('Pilih chat terlebih dahulu!'); return; }
        if (!document.getElementById('doodleOverlay')) _buildOverlay();

        _syncOverlayPosition();
        _resizeCanvases();

        _overlay.classList.add('doodle-active');
        _overlay.classList.remove('doodle-view-only');
        document.getElementById('doodleToggleBtn')?.classList.add('active');
        _hasPublished = false;
        _startPositionLoop();

        _myCtx?.clearRect(0, 0, _myCanvas?.width || 0, _myCanvas?.height || 0);
        _history   = [];
        _redoStack = [];
        _refreshUndoRedo();
        _listenLive();
    }

    function closeDoodle() {
        if (!_overlay) return;
        _overlay.classList.remove('doodle-active');
        document.getElementById('doodleToggleBtn')?.classList.remove('active');

        if (!_hasPublished) {
            _myCtx?.clearRect(0, 0, _myCanvas?.width || 0, _myCanvas?.height || 0);
            _syncCanvas(false);
        }

        _history   = [];
        _redoStack = [];
        _refreshUndoRedo();
        if (_listener) { _listener(); _listener = null; }

        if (!_overlay.classList.contains('doodle-view-only')) _stopPositionLoop();
        _listenLive();
    }

    function onSelectUser(userId) {
        const prev = _partnerId;
        _partnerId = userId;
        _hasPublished = false;

        if (prev !== userId) {
            _myCtx?.clearRect(0, 0, _myCanvas?.width || 0, _myCanvas?.height || 0);
            _clearPartnerCanvas();
            _history   = [];
            _redoStack = [];
            if (_overlay) {
                _overlay.classList.remove('doodle-active', 'doodle-view-only');
                document.getElementById('doodleToggleBtn')?.classList.remove('active');
            }
            if (_listener) { _listener(); _listener = null; }
            _stopPositionLoop();
        }

        _listenLive();
    }

    function openViewer(src) {
        const viewer = document.getElementById('doodleViewer');
        const img    = document.getElementById('doodleViewerImg');
        if (!viewer || !img) return;
        img.src = src;
        viewer.classList.add('open');
    }

    function renderDoodleBubble(msg, isMine) {
        const wrap = document.createElement('div');
        wrap.className = 'message-bubble ' + (isMine ? 'sent' : 'received');
        wrap.innerHTML =
            '<div class="doodle-bubble" onclick="DoodleSystem.openViewer(\'' + msg.image + '\')">' +
            '<img src="' + msg.image + '" alt="Doodle" loading="lazy"></div>' +
            '<div class="doodle-bubble-label">Doodle</div>';
        return wrap;
    }

    function init(db, firebaseModules) {
        _db    = db;
        _fb    = firebaseModules;
        _myUid = window._myUid || null;

        const _waitUid = setInterval(() => {
            if (window._myUid) { _myUid = window._myUid; clearInterval(_waitUid); }
        }, 300);

        const toggleBtn = document.getElementById('doodleToggleBtn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                if (_overlay?.classList.contains('doodle-active')) closeDoodle();
                else openDoodle();
            });
        }

        console.log('[DoodleSystem v6] Initialized — fixed overlay, tidak ikut scroll');
    }

    return { init, onSelectUser, openDoodle, closeDoodle, openViewer, renderDoodleBubble };

})();

window.DoodleSystem = DoodleSystem;
