/**
 * ============================================================
 *  CHAT DOODLE SYSTEM v9 - Fix Scroll Bug
 *  File: chat-doodle.js
 *
 *  PERBAIKAN v9:
 *  ──────────────────────────────────────────────────────────
 *  FIX UTAMA: OVERLAY TIDAK IKUT SCROLL
 *    ROOT CAUSE v8: overlay pakai position:fixed di body +
 *    RAF loop untuk update top/left. Saat halaman/window
 *    di-scroll, getBoundingClientRect() ikut berubah, tapi
 *    update RAF tidak sinkron sehingga overlay terlihat
 *    "ngikut scroll" dengan glitch.
 *
 *    SOLUSI v9: overlay dipasang sebagai child langsung dari
 *    .chat-window (position:relative + overflow:hidden) dengan
 *    position:absolute + inset:0. Hasilnya:
 *    - Overlay otomatis cover seluruh chat-window tanpa JS
 *    - Overlay tidak ikut scroll apapun (baik scroll halaman
 *      maupun scroll .messages-area), karena .chat-window
 *      adalah containing block-nya
 *    - RAF positioning loop dihapus sepenuhnya
 *    - Tidak ada dependency ke getBoundingClientRect()
 *
 *  CATATAN:
 *    .chat-window HARUS punya position:relative + overflow:hidden
 *    (sudah ada di chat_style.css — tidak perlu diubah)
 * ============================================================
 */

const DoodleSystem = (() => {

    let _db        = null;
    let _fb        = null;
    let _myUid     = null;
    let _partnerId = null;

    let _isDrawing    = false;
    let _eraser       = false;
    let _color        = '#ff3b30';
    let _lineWidth    = 6;
    let _history      = [];
    let _redoStack    = [];
    let _syncTimeout  = null;
    let _hasPublished = false;

    let _overlay, _myCanvas, _myCtx;
    let _partnerCanvas, _partnerCtx;
    let _listenerPartner = null;
    let _listenerSelf    = null;

    // Map untuk menyimpan state doodle per partner
    // Key: partnerId, Value: { mode, myImageSrc, partnerImgSrc, hasPublished }
    const _chatStates = new Map();

    const PRESET_COLORS = [
        '#ffffff', '#ff3b30', '#ff9500',
        '#ffcc00', '#34c759', '#007aff',
        '#af52de', '#ff2d55', '#000000',
    ];

    // ── UTIL ─────────────────────────────────────────────────
    function _chatId(a, b) { return [a, b].sort().join('_'); }

    function _drawPath(uid) {
        return `doodles/${_chatId(_myUid, _partnerId)}/draw_${uid}`;
    }

    // ── AMBIL CHAT-WINDOW (container utama, BUKAN scroll area) ──
    function _getChatWindow() {
        return document.getElementById('chatWindow')
            || document.querySelector('.chat-window');
    }

    // ── POSISI OVERLAY ────────────────────────────────────────
    // Overlay adalah position:absolute di dalam .chat-window (position:relative).
    // Tidak perlu RAF loop atau JS positioning — CSS inset:0 sudah menangani.
    // Fungsi-fungsi ini dijadikan no-op agar tidak ada error dari kode lain.
    function _positionOverlay() { /* no-op: CSS position:absolute + inset:0 */ }
    function _startPositionLoop() { /* no-op */ }
    function _stopPositionLoop() { /* no-op */ }

    // ── BUILD OVERLAY ─────────────────────────────────────────
    function _buildOverlay() {
        const old = document.getElementById('doodleOverlay');
        if (old) old.remove();

        const chatWin = _getChatWindow();
        if (!chatWin) return;

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

        // Pasang di dalam chatWindow — bukan di body — agar tidak ikut scroll halaman.
        // Karena .chat-window punya position:relative + overflow:hidden,
        // overlay (position:absolute + inset:0) akan menempel tepat di dalamnya.
        chatWin.appendChild(_overlay);

        _myCanvas      = document.getElementById('doodleMyCanvas');
        _myCtx         = _myCanvas.getContext('2d');
        _partnerCanvas = document.getElementById('doodlePartnerCanvas');
        _partnerCtx    = _partnerCanvas.getContext('2d');

        _resizeCanvases();
        _buildColorSwatches();
        _bindEvents();

        // Auto-resize canvas saat ukuran chatWindow berubah (resize window, orientasi, dsb)
        if (window.ResizeObserver) {
            const ro = new ResizeObserver(() => _resizeCanvasesKeepContent());
            ro.observe(chatWin);
        } else {
            window.addEventListener('resize', _resizeCanvasesKeepContent);
        }

        // Fullscreen viewer
        if (!document.getElementById('doodleViewer')) {
            const viewer = document.createElement('div');
            viewer.id = 'doodleViewer';
            viewer.innerHTML = '<img id="doodleViewerImg" src="" alt="doodle"><button id="doodleViewerClose">Tutup</button>';
            document.body.appendChild(viewer);
            document.getElementById('doodleViewerClose').onclick = () => viewer.classList.remove('open');
            viewer.addEventListener('click', e => { if (e.target === viewer) viewer.classList.remove('open'); });
        }
    }

    // ── CANVAS RESIZE ─────────────────────────────────────────
    // Ukuran canvas = ukuran chatWindow (containing block overlay).
    // openDoodle() dipanggil setelah chatWindow visible, jadi offsetWidth/Height valid.
    function _resizeCanvases() {
        if (!_overlay) return;
        const chatWin = _getChatWindow();
        const w = chatWin?.offsetWidth  || 400;
        const h = chatWin?.offsetHeight || 600;
        [_myCanvas, _partnerCanvas].forEach(c => {
            if (!c) return;
            c.width  = w;
            c.height = h;
        });
    }

    function _resizeCanvasesKeepContent() {
        if (!_overlay) return;
        const chatWin = _getChatWindow();
        const w = (chatWin?.offsetWidth  > 0 ? chatWin.offsetWidth  : (_overlay.offsetWidth  || 400));
        const h = (chatWin?.offsetHeight > 0 ? chatWin.offsetHeight : (_overlay.offsetHeight || 600));

        [
            { canvas: _myCanvas,      ctx: _myCtx      },
            { canvas: _partnerCanvas, ctx: _partnerCtx },
        ].forEach(({ canvas, ctx }) => {
            if (!canvas || !ctx) return;
            if (canvas.width === w && canvas.height === h) return;
            let saved = null;
            if (canvas.width > 0 && canvas.height > 0) {
                try {
                    const tmp = document.createElement('canvas');
                    tmp.width  = canvas.width;
                    tmp.height = canvas.height;
                    tmp.getContext('2d').drawImage(canvas, 0, 0);
                    saved = tmp;
                } catch(e) {}
            }
            canvas.width  = w;
            canvas.height = h;
            if (saved) {
                try { ctx.drawImage(saved, 0, 0, w, h); } catch(e) {}
            }
        });
    }

    // ── COLOR SWATCHES ────────────────────────────────────────
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

    // ── BIND EVENTS ───────────────────────────────────────────
    function _bindEvents() {
        document.getElementById('doodleCloseBtn').addEventListener('click', _dismissDoodle);
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
            _syncMyCanvas(false);
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
    }

    // ── DRAW ──────────────────────────────────────────────────
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
        _syncMyCanvas(false);
    }

    function _redo() {
        if (!_redoStack.length) return;
        _history.push(_myCtx.getImageData(0, 0, _myCanvas.width, _myCanvas.height));
        _myCtx.putImageData(_redoStack.pop(), 0, 0);
        _refreshUndoRedo();
        _syncMyCanvas(false);
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
        _syncMyCanvas(false);
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
    function _syncMyCanvas(published) {
        clearTimeout(_syncTimeout);
        _syncTimeout = setTimeout(() => {
            if (!_db || !_myUid || !_partnerId) return;
            const { ref, set } = _fb;
            const imageData = _myCtx.getImageData(0, 0, _myCanvas.width, _myCanvas.height);
            const isBlank   = !imageData.data.some(v => v !== 0);

            set(ref(_db, _drawPath(_myUid)), {
                image    : isBlank ? null : _myCanvas.toDataURL('image/png', 0.82),
                from     : _myUid,
                ts       : Date.now(),
                cleared  : isBlank,
                published: published === true,
                viewedBy : {},
            }).catch(err => console.error('[Doodle] sync err:', err));
        }, published ? 0 : 200);
    }

    // ── SIMPAN STATE KE MAP ───────────────────────────────────
    function _saveCurrentState() {
        if (!_partnerId || !_overlay) return;

        const mode = _overlay.classList.contains('doodle-active')
            ? 'active'
            : _overlay.classList.contains('doodle-view-only')
                ? 'view-only'
                : null;

        let myImageSrc    = null;
        let partnerImgSrc = null;

        try {
            const d = _myCtx?.getImageData(0, 0, _myCanvas?.width || 1, _myCanvas?.height || 1);
            if (d && d.data.some(v => v !== 0)) myImageSrc = _myCanvas.toDataURL('image/png');
        } catch(e) {}

        try {
            const d = _partnerCtx?.getImageData(0, 0, _partnerCanvas?.width || 1, _partnerCanvas?.height || 1);
            if (d && d.data.some(v => v !== 0)) partnerImgSrc = _partnerCanvas.toDataURL('image/png');
        } catch(e) {}

        _chatStates.set(_partnerId, { mode, myImageSrc, partnerImgSrc, hasPublished: _hasPublished });
    }

    // ── PULIHKAN STATE DARI MAP ───────────────────────────────
    function _restoreState(partnerId) {
        const state = _chatStates.get(partnerId);

        if (!state || !state.mode) {
            if (_overlay) _overlay.classList.remove('doodle-active', 'doodle-view-only');
            _hasPublished = false;
            _history = []; _redoStack = [];
            _refreshUndoRedo();
            return;
        }

        _hasPublished = state.hasPublished || false;

        setTimeout(() => {
            if (state.myImageSrc && _myCanvas && _myCtx) {
                const img = new Image();
                img.onload = () => {
                    _myCtx.clearRect(0, 0, _myCanvas.width, _myCanvas.height);
                    _myCtx.drawImage(img, 0, 0, _myCanvas.width, _myCanvas.height);
                };
                img.src = state.myImageSrc;
            }

            if (state.partnerImgSrc && _partnerCanvas && _partnerCtx) {
                const img = new Image();
                img.onload = () => {
                    _partnerCtx.clearRect(0, 0, _partnerCanvas.width, _partnerCanvas.height);
                    _partnerCtx.drawImage(img, 0, 0, _partnerCanvas.width, _partnerCanvas.height);
                };
                img.src = state.partnerImgSrc;
            }

            if (_overlay) {
                _overlay.classList.remove('doodle-active', 'doodle-view-only');
                if (state.mode === 'active') {
                    _overlay.classList.add('doodle-active');
                    document.getElementById('doodleToggleBtn')?.classList.add('active');
                } else if (state.mode === 'view-only') {
                    _overlay.classList.add('doodle-view-only');
                    document.getElementById('doodleToggleBtn')?.classList.remove('active');
                }
            }
        }, 50);
    }

    // ── PASTIKAN OVERLAY ADA DI DALAM CHATWINDOW ─────────────
    // Overlay (position:absolute) harus menjadi child dari .chat-window
    // (position:relative) agar tidak ikut scroll halaman.
    function _ensureOverlayInChatWindow() {
        const chatWin = _getChatWindow();
        if (!chatWin) return;

        let existing = document.getElementById('doodleOverlay');
        if (!existing) {
            _buildOverlay();
        } else {
            // Pindahkan ke chatWindow jika belum di sana
            if (existing.parentElement !== chatWin) {
                chatWin.appendChild(existing);
            }
            _overlay       = existing;
            _myCanvas      = document.getElementById('doodleMyCanvas');
            _myCtx         = _myCanvas?.getContext('2d');
            _partnerCanvas = document.getElementById('doodlePartnerCanvas');
            _partnerCtx    = _partnerCanvas?.getContext('2d');
        }
    }

    // ── OPEN DOODLE ───────────────────────────────────────────
    function openDoodle() {
        if (!_partnerId) { alert('Pilih chat terlebih dahulu!'); return; }

        _ensureOverlayInChatWindow();

        // Tambahkan class active DULU agar overlay display:block,
        // baru resize canvas — karena offsetWidth/Height = 0 saat display:none
        _overlay.classList.add('doodle-active');
        _overlay.classList.remove('doodle-view-only');
        document.getElementById('doodleToggleBtn')?.classList.add('active');

        _hasPublished = false;
        // Resize setelah overlay visible
        _resizeCanvases();

        _myCtx?.clearRect(0, 0, _myCanvas?.width || 0, _myCanvas?.height || 0);
        _history   = [];
        _redoStack = [];
        _refreshUndoRedo();

        const btn = document.getElementById('doodleFinishBtn');
        if (btn) { btn.textContent = 'Selesai ✓'; btn.disabled = false; btn.style.background = ''; }

        _listenPartnerNode();
    }

    // ── FINISH ────────────────────────────────────────────────
    function finishDoodle() {
        const imageData = _myCtx.getImageData(0, 0, _myCanvas.width, _myCanvas.height);
        const isBlank   = !imageData.data.some(v => v !== 0);
        if (isBlank) { alert('Canvas kosong, gambar sesuatu dulu!'); return; }

        _hasPublished = true;
        _syncMyCanvas(true);

        const btn = document.getElementById('doodleFinishBtn');
        if (btn) { btn.textContent = '✓ Terkirim!'; btn.disabled = true; }

        setTimeout(() => {
            _overlay?.classList.remove('doodle-active');
            _overlay?.classList.add('doodle-view-only');
            document.getElementById('doodleToggleBtn')?.classList.remove('active');
            if (btn) { btn.textContent = 'Selesai ✓'; btn.disabled = false; }
            _listenSelfNode();
            // Simpan state view-only ke Map
            _saveCurrentState();
        }, 600);
    }

    // ── DISMISS ───────────────────────────────────────────────
    function _dismissDoodle() {
        if (!_overlay) return;
        _stopPositionLoop();
        _overlay.classList.remove('doodle-active', 'doodle-view-only');
        document.getElementById('doodleToggleBtn')?.classList.remove('active');
        _hidePartnerIndicator();

        _myCtx?.clearRect(0, 0, _myCanvas?.width || 0, _myCanvas?.height || 0);
        _partnerCtx?.clearRect(0, 0, _partnerCanvas?.width || 0, _partnerCanvas?.height || 0);

        _history   = [];
        _redoStack = [];
        _refreshUndoRedo();
        _hasPublished = false;

        // Hapus state tersimpan
        _chatStates.delete(_partnerId);

        if (_db && _myUid && _partnerId) {
            const { ref, set } = _fb;
            set(ref(_db, _drawPath(_myUid)), {
                image: null, from: _myUid, ts: Date.now(),
                cleared: true, published: false, viewedBy: {},
            }).catch(() => {});
        }

        _listenPartnerNode();
    }

    // ── CLOSE (batal sebelum selesai) ─────────────────────────
    function closeDoodle() {
        if (!_overlay) return;
        _stopPositionLoop();
        const wasActive = _overlay.classList.contains('doodle-active');
        _overlay.classList.remove('doodle-active', 'doodle-view-only');
        document.getElementById('doodleToggleBtn')?.classList.remove('active');

        if (wasActive && !_hasPublished) {
            _myCtx?.clearRect(0, 0, _myCanvas?.width || 0, _myCanvas?.height || 0);
            _syncMyCanvas(false);
            _chatStates.delete(_partnerId);
        }

        _history   = [];
        _redoStack = [];
        _refreshUndoRedo();
    }

    // ── LISTEN: node PARTNER ──────────────────────────────────
    function _listenPartnerNode() {
        if (!_db || !_myUid || !_partnerId) return;
        if (_listenerPartner) { _listenerPartner(); _listenerPartner = null; }

        const { ref, onValue } = _fb;

        _listenerPartner = onValue(ref(_db, _drawPath(_partnerId)), snap => {
            if (!snap.exists()) { _clearPartnerCanvas(); return; }
            const data = snap.val();
            if (!data) { _clearPartnerCanvas(); return; }

            if (data.cleared || !data.image) {
                _clearPartnerCanvas();
                _hidePartnerIndicator();
                if (!_overlay?.classList.contains('doodle-active') && !_hasPublished) {
                    _overlay?.classList.remove('doodle-view-only');
                }
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
                }
            }
        });
    }

    // ── LISTEN: node SENDIRI ──────────────────────────────────
    function _listenSelfNode() {
        if (!_db || !_myUid || !_partnerId) return;
        if (_listenerSelf) { _listenerSelf(); _listenerSelf = null; }

        const { ref, onValue } = _fb;

        _listenerSelf = onValue(ref(_db, _drawPath(_myUid)), snap => {
            if (!snap.exists()) return;
            const data = snap.val();
            if (!data || !data.image || !data.published) return;
            if (data.from !== _myUid) return;

            const imageData = _myCtx?.getImageData(0, 0, _myCanvas?.width || 1, _myCanvas?.height || 1);
            const isBlank   = !imageData?.data.some(v => v !== 0);
            if (isBlank && data.image) {
                const img = new Image();
                img.onload = () => {
                    _myCtx.clearRect(0, 0, _myCanvas.width, _myCanvas.height);
                    _myCtx.drawImage(img, 0, 0, _myCanvas.width, _myCanvas.height);
                    _overlay?.classList.add('doodle-view-only');
                };
                img.src = data.image;
            }
        });
    }

    // ── HELPER ────────────────────────────────────────────────
    function _clearPartnerCanvas() {
        if (_partnerCtx && _partnerCanvas)
            _partnerCtx.clearRect(0, 0, _partnerCanvas.width, _partnerCanvas.height);
    }

    function _showPartnerIndicator() {
        const ind = document.getElementById('doodlePartnerIndicator');
        if (ind) {
            ind.innerHTML = `&#127912; <span id="doodlePartnerName">${_getPartnerName()}</span> sedang menggambar...`;
            ind.classList.add('visible');
            ind.classList.remove('published');
        }
    }

    function _hidePartnerIndicator() {
        document.getElementById('doodlePartnerIndicator')?.classList.remove('visible', 'published');
    }

    function _showPublishToast() {
        const ind = document.getElementById('doodlePartnerIndicator');
        if (ind) {
            ind.innerHTML = `<span>${_getPartnerName()}</span> mengirim doodle! 🎨`;
            ind.classList.add('visible', 'published');
            setTimeout(() => _hidePartnerIndicator(), 4000);
        }
    }

    function _getPartnerName() {
        const u = window.allUsers?.find(u => u.uid === _partnerId);
        return u?.name || u?.displayName || 'Partner';
    }

    // ── ON SELECT USER (ganti chat) ───────────────────────────
    function onSelectUser(userId) {
        const prev = _partnerId;

        if (prev === userId) {
            // Partner sama: pastikan overlay masih di chatWindow yang benar
            _ensureOverlayInChatWindow();
            return;
        }

        // Simpan state chat sebelumnya ke Map
        if (prev) {
            _saveCurrentState();
        }

        // Hentikan listener lama
        if (_listenerPartner) { _listenerPartner(); _listenerPartner = null; }
        if (_listenerSelf)    { _listenerSelf();    _listenerSelf    = null; }

        _partnerId = userId;

        // Pastikan overlay ada di chatWindow yang aktif
        _ensureOverlayInChatWindow();

        // Sembunyikan overlay dulu
        if (_overlay) _overlay.classList.remove('doodle-active', 'doodle-view-only');
        document.getElementById('doodleToggleBtn')?.classList.remove('active');
        _hidePartnerIndicator();

        // Bersihkan canvas sementara
        _myCtx?.clearRect(0, 0, _myCanvas?.width || 0, _myCanvas?.height || 0);
        _clearPartnerCanvas();
        _history   = [];
        _redoStack = [];
        _refreshUndoRedo();

        // Pulihkan state jika pernah buka doodle dengan partner ini
        if (_chatStates.has(userId)) {
            _resizeCanvasesKeepContent();
            _restoreState(userId);
        } else {
            _hasPublished = false;
        }

        // Mulai listen partner baru
        _listenPartnerNode();
    }

    // ── VIEWER FULLSCREEN ─────────────────────────────────────
    function openViewer(src) {
        const viewer = document.getElementById('doodleViewer');
        const img    = document.getElementById('doodleViewerImg');
        if (!viewer || !img) return;
        img.src = src;
        viewer.classList.add('open');
    }

    // ── INIT ──────────────────────────────────────────────────
    function init(db, firebaseModules) {
        _db    = db;
        _fb    = firebaseModules;
        _myUid = window._myUid || null;

        if (!_myUid) {
            const _waitUid = setInterval(() => {
                if (window._myUid) {
                    _myUid = window._myUid;
                    clearInterval(_waitUid);
                    console.log('[DoodleSystem v8] UID resolved:', _myUid);
                }
            }, 300);
        }

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

        console.log('[DoodleSystem v9] ✅ Init — overlay:absolute in chatWindow, no RAF loop, no scroll bug');
    }

    // ── PUBLIC API ────────────────────────────────────────────
    return {
        init,
        onSelectUser,
        openDoodle,
        closeDoodle,
        openViewer,
    };

})();

window.DoodleSystem = DoodleSystem;
