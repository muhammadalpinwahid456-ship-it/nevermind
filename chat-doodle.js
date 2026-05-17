/**
 * ============================================================
 *  CHAT DOODLE SYSTEM v10 - Fixed: User Bisa Pilih Area Bebas
 *  File: chat-doodle.js
 *
 *  ROOT CAUSE FIX v10:
 *  ──────────────────────────────────────────────────────────
 *  Problem v9: Overlay (position:absolute) di-append ke dalam
 *  .messages-area yang juga merupakan scroll container.
 *  Akibatnya canvas hanya bisa digambar di top:0 karena
 *  getBoundingClientRect canvas bergerak saat scroll, tapi
 *  koordinat drawing tetap dihitung dari ujung atas canvas.
 *
 *  SOLUSI v10:
 *  - Overlay pakai position:FIXED, ukuran = rect messages-area
 *  - Canvas HANYA selebar/setinggi viewport messages-area (bukan scrollHeight)
 *  - Koordinat gambar = posisi mouse di viewport langsung (clientX/Y)
 *    dikurangi bounding rect canvas — tidak perlu scroll offset
 *  - Drawing data disimpan sebagai list of strokes dengan koordinat
 *    ABSOLUT (scrollTop + clientY) agar doodle tetap menempel
 *    di posisi yang benar saat di-publish ke Firebase
 *  - User bebas scroll dulu, lalu mulai menggambar di posisi manapun
 *  - Canvas re-render setiap scroll untuk menampilkan strokes
 *    yang berada di viewport saat itu
 * ============================================================
 */

const DoodleSystem = (() => {

    let _db        = null;
    let _fb        = null;
    let _myUid     = null;
    let _partnerId = null;

    let _isDrawing   = false;
    let _eraser      = false;
    let _color       = '#ff3b30';
    let _lineWidth   = 6;
    let _hasPublished = false;

    // Strokes disimpan sebagai array of path points dengan koordinat ABSOLUT
    // (relatif ke top messages-area sebelum di-scroll)
    // Setiap stroke: { color, lineWidth, eraser, points: [{x, y}] }
    let _myStrokes      = [];   // strokes milik saya
    let _partnerStrokes = [];   // strokes partner (dari Firebase)
    let _currentStroke  = null;
    let _undoStack      = [];   // snapshot _myStrokes sebelum stroke terakhir
    let _redoStack      = [];

    let _overlay       = null;
    let _myCanvas      = null;
    let _myCtx         = null;
    let _partnerCanvas = null;
    let _partnerCtx    = null;

    let _listenerPartner = null;
    let _listenerSelf    = null;
    let _syncTimeout     = null;
    let _scrollRAF       = null;

    // Simpan state per partner (mode, strokes, dll)
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

    function _getMessagesArea() {
        return document.getElementById('messagesArea')
            || document.querySelector('.messages-area');
    }

    function _getChatWindow() {
        return document.getElementById('chatWindow')
            || document.querySelector('.chat-window');
    }

    // ── HITUNG RECT MESSAGES-AREA DI VIEWPORT ────────────────
    function _getMessagesRect() {
        const el = _getMessagesArea();
        if (!el) return { left: 0, top: 0, width: 400, height: 600 };
        return el.getBoundingClientRect();
    }

    // ── BUILD OVERLAY ─────────────────────────────────────────
    // Overlay position:fixed, persis di atas messages-area
    function _buildOverlay() {
        const old = document.getElementById('doodleOverlay');
        if (old) old.remove();

        _overlay = document.createElement('div');
        _overlay.id = 'doodleOverlay';
        _overlay.innerHTML = `
            <canvas id="doodlePartnerCanvas"></canvas>
            <canvas id="doodleMyCanvas"></canvas>
            <button id="doodleCloseBtn" title="Tutup">&#10005;</button>
            <div id="doodleLabel">&#9998;&#65039; Menggambar...
                <span id="doodleLabelSub">Scroll ke area yang ingin digambar, lalu coret!</span>
            </div>
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

        // Append ke body agar position:fixed bekerja bebas dari parent
        document.body.appendChild(_overlay);

        _myCanvas      = document.getElementById('doodleMyCanvas');
        _myCtx         = _myCanvas.getContext('2d');
        _partnerCanvas = document.getElementById('doodlePartnerCanvas');
        _partnerCtx    = _partnerCanvas.getContext('2d');

        _positionOverlay();
        _resizeCanvases();
        _buildColorSwatches();
        _bindEvents();

        // Re-posisi overlay saat window resize
        window.addEventListener('resize', _onResize);

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

    function _onResize() {
        _positionOverlay();
        _resizeCanvases();
        _renderMyStrokes();
        _renderPartnerStrokes();
    }

    // ── POSISI & UKURAN OVERLAY = persis menutupi messages-area ──
    function _positionOverlay() {
        if (!_overlay) return;
        const rect = _getMessagesRect();
        _overlay.style.left   = rect.left + 'px';
        _overlay.style.top    = rect.top  + 'px';
        _overlay.style.width  = rect.width  + 'px';
        _overlay.style.height = rect.height + 'px';
    }

    // ── UKURAN CANVAS = sama dengan overlay (viewport messages-area) ──
    function _resizeCanvases() {
        if (!_overlay) return;
        const rect = _getMessagesRect();
        const w = Math.round(rect.width)  || 400;
        const h = Math.round(rect.height) || 600;
        [_myCanvas, _partnerCanvas].forEach(c => {
            if (!c) return;
            c.width  = w;
            c.height = h;
        });
    }

    // ── SCROLL HANDLER: re-render strokes setiap scroll ──────
    // Strokes punya koordinat absolut → saat scroll berubah,
    // kita render ulang dengan offset = scrollTop saat ini
    function _onScroll() {
        if (!_overlay) return;
        if (_scrollRAF) cancelAnimationFrame(_scrollRAF);
        _scrollRAF = requestAnimationFrame(() => {
            _renderMyStrokes();
            _renderPartnerStrokes();
        });
    }

    // ── RENDER STROKES KE CANVAS ──────────────────────────────
    // scrollTop = berapa pixel messages-area sudah di-scroll ke bawah
    // Koordinat absolut stroke dikurangi scrollTop = koordinat di canvas viewport
    function _renderStrokes(ctx, canvas, strokes) {
        if (!ctx || !canvas) return;
        const container = _getMessagesArea();
        const scrollTop = container ? container.scrollTop : 0;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        strokes.forEach(stroke => {
            if (!stroke.points || stroke.points.length < 2) return;
            ctx.save();
            if (stroke.eraser) {
                ctx.globalCompositeOperation = 'destination-out';
                ctx.strokeStyle = 'rgba(0,0,0,1)';
                ctx.lineWidth   = stroke.lineWidth * 2;
            } else {
                ctx.globalCompositeOperation = 'source-over';
                ctx.strokeStyle = stroke.color;
                ctx.lineWidth   = stroke.lineWidth;
            }
            ctx.lineCap  = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();

            let started = false;
            stroke.points.forEach(pt => {
                // Koordinat y di canvas = koordinat absolut - scrollTop sekarang
                const cx = pt.x;
                const cy = pt.y - scrollTop;
                if (!started) { ctx.moveTo(cx, cy); started = true; }
                else ctx.lineTo(cx, cy);
            });
            ctx.stroke();
            ctx.restore();
        });
    }

    function _renderMyStrokes() {
        _renderStrokes(_myCtx, _myCanvas, _myStrokes);
    }

    function _renderPartnerStrokes() {
        _renderStrokes(_partnerCtx, _partnerCanvas, _partnerStrokes);
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
            _undoStack.push(JSON.parse(JSON.stringify(_myStrokes)));
            _redoStack = [];
            _myStrokes = [];
            _renderMyStrokes();
            _refreshUndoRedo();
            _syncMyStrokes(false);
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

        // Mouse events — koordinat dari clientX/Y langsung
        _myCanvas.addEventListener('mousedown',  _startDraw);
        _myCanvas.addEventListener('mousemove',  _draw);
        _myCanvas.addEventListener('mouseup',    _endDraw);
        _myCanvas.addEventListener('mouseleave', _endDraw);

        // Touch events
        _myCanvas.addEventListener('touchstart',  _touchStart,  { passive: false });
        _myCanvas.addEventListener('touchmove',   _touchMove,   { passive: false });
        _myCanvas.addEventListener('touchend',    _endDraw);
        _myCanvas.addEventListener('touchcancel', _endDraw);
    }

    // ── KOORDINAT ─────────────────────────────────────────────
    // Koordinat di canvas viewport = clientX/Y dikurangi rect overlay
    // Koordinat ABSOLUT (untuk disimpan) = viewport + scrollTop
    function _getCanvasPos(clientX, clientY) {
        const rect      = _overlay.getBoundingClientRect();
        const container = _getMessagesArea();
        const scrollTop = container ? container.scrollTop : 0;
        const cx = clientX - rect.left;   // posisi di canvas (viewport)
        const cy = clientY - rect.top;    // posisi di canvas (viewport)
        return {
            canvasX: cx,
            canvasY: cy,
            absX: cx,                      // x absolut = sama (tidak ada horizontal scroll)
            absY: cy + scrollTop,          // y absolut = viewport y + scroll
        };
    }

    // ── DRAW ──────────────────────────────────────────────────
    function _startDraw(e) {
        e.preventDefault();
        const { canvasX, canvasY, absX, absY } = _getCanvasPos(e.clientX, e.clientY);

        // Simpan snapshot untuk undo
        _undoStack.push(JSON.parse(JSON.stringify(_myStrokes)));
        if (_undoStack.length > 40) _undoStack.shift();
        _redoStack = [];
        _refreshUndoRedo();

        _isDrawing = true;
        _currentStroke = {
            color    : _eraser ? null : _color,
            lineWidth: _lineWidth,
            eraser   : _eraser,
            points   : [{ x: absX, y: absY }],
        };
        _myStrokes.push(_currentStroke);

        // Langsung gambar titik awal
        _myCtx.save();
        _applyStyleToCtx(_myCtx, _currentStroke);
        _myCtx.beginPath();
        _myCtx.moveTo(canvasX, canvasY);
        _myCtx.restore();
    }

    function _draw(e) {
        if (!_isDrawing || !_currentStroke) return;
        e.preventDefault();
        const { canvasX, canvasY, absX, absY } = _getCanvasPos(e.clientX, e.clientY);

        _currentStroke.points.push({ x: absX, y: absY });

        // Gambar incremental — lebih smooth dari re-render penuh
        _myCtx.save();
        _applyStyleToCtx(_myCtx, _currentStroke);
        const pts = _currentStroke.points;
        const prev = pts[pts.length - 2];
        const container = _getMessagesArea();
        const scrollTop = container ? container.scrollTop : 0;
        const prevCanvasY = prev.y - scrollTop;
        _myCtx.beginPath();
        _myCtx.moveTo(prev.x, prevCanvasY);
        _myCtx.lineTo(canvasX, canvasY);
        _myCtx.stroke();
        _myCtx.restore();
    }

    function _endDraw() {
        if (!_isDrawing) return;
        _isDrawing    = false;
        _currentStroke = null;
        _syncMyStrokes(false);
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

    function _applyStyleToCtx(ctx, stroke) {
        if (stroke.eraser) {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.strokeStyle = 'rgba(0,0,0,1)';
            ctx.lineWidth   = stroke.lineWidth * 2;
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = stroke.color;
            ctx.lineWidth   = stroke.lineWidth;
        }
        ctx.lineCap  = 'round';
        ctx.lineJoin = 'round';
    }

    // ── UNDO / REDO ───────────────────────────────────────────
    function _refreshUndoRedo() {
        const u = document.getElementById('doodleUndoBtn');
        const r = document.getElementById('doodleRedoBtn');
        if (u) u.disabled = _undoStack.length === 0;
        if (r) r.disabled = _redoStack.length === 0;
    }

    function _undo() {
        if (!_undoStack.length) return;
        _redoStack.push(JSON.parse(JSON.stringify(_myStrokes)));
        _myStrokes = _undoStack.pop();
        _refreshUndoRedo();
        _renderMyStrokes();
        _syncMyStrokes(false);
    }

    function _redo() {
        if (!_redoStack.length) return;
        _undoStack.push(JSON.parse(JSON.stringify(_myStrokes)));
        _myStrokes = _redoStack.pop();
        _refreshUndoRedo();
        _renderMyStrokes();
        _syncMyStrokes(false);
    }

    // ── FIREBASE SYNC ─────────────────────────────────────────
    // Simpan strokes ke Firebase sebagai JSON (bukan PNG canvas)
    // agar koordinat absolut tetap utuh dan bisa di-render ulang
    function _syncMyStrokes(published) {
        clearTimeout(_syncTimeout);
        _syncTimeout = setTimeout(() => {
            if (!_db || !_myUid || !_partnerId) return;
            const { ref, set } = _fb;
            const isBlank = _myStrokes.length === 0;

            // Untuk published, buat juga PNG dari full canvas virtual
            let imageData = null;
            if (published && !isBlank) {
                imageData = _renderToDataURL(_myStrokes);
            }

            // Update cache lokal
            const s = _chatStates.get(_partnerId) || {};
            _chatStates.set(_partnerId, {
                ...s,
                myStrokes   : JSON.parse(JSON.stringify(_myStrokes)),
                hasPublished: published === true,
            });

            set(ref(_db, _drawPath(_myUid)), {
                strokes  : isBlank ? null : _myStrokes,
                image    : imageData,
                from     : _myUid,
                ts       : Date.now(),
                cleared  : isBlank,
                published: published === true,
                viewedBy : {},
            }).catch(err => console.error('[Doodle] sync err:', err));
        }, published ? 0 : 300);
    }

    // Render semua strokes ke canvas off-screen berukuran penuh scroll
    // Dipakai untuk menghasilkan PNG final saat "Selesai"
    function _renderToDataURL(strokes) {
        try {
            const container = _getMessagesArea();
            const totalH    = container ? container.scrollHeight : 800;
            const totalW    = container ? container.scrollWidth  : 400;
            const offscreen = document.createElement('canvas');
            offscreen.width  = totalW;
            offscreen.height = totalH;
            const ctx = offscreen.getContext('2d');

            strokes.forEach(stroke => {
                if (!stroke.points || stroke.points.length < 2) return;
                ctx.save();
                if (stroke.eraser) {
                    ctx.globalCompositeOperation = 'destination-out';
                    ctx.strokeStyle = 'rgba(0,0,0,1)';
                    ctx.lineWidth   = stroke.lineWidth * 2;
                } else {
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.strokeStyle = stroke.color;
                    ctx.lineWidth   = stroke.lineWidth;
                }
                ctx.lineCap  = 'round';
                ctx.lineJoin = 'round';
                ctx.beginPath();
                stroke.points.forEach((pt, i) => {
                    if (i === 0) ctx.moveTo(pt.x, pt.y);
                    else ctx.lineTo(pt.x, pt.y);
                });
                ctx.stroke();
                ctx.restore();
            });

            return offscreen.toDataURL('image/png', 0.82);
        } catch(e) {
            return null;
        }
    }

    // ── LISTEN: node PARTNER ──────────────────────────────────
    function _listenPartnerNode() {
        if (!_db || !_myUid || !_partnerId) return;
        if (_listenerPartner) { _listenerPartner(); _listenerPartner = null; }

        const { ref, onValue } = _fb;
        _listenerPartner = onValue(ref(_db, _drawPath(_partnerId)), snap => {
            if (!snap.exists()) { _partnerStrokes = []; _renderPartnerStrokes(); return; }
            const data = snap.val();
            if (!data || data.cleared) {
                _partnerStrokes = [];
                _renderPartnerStrokes();
                _hidePartnerIndicator();
                // Update cache
                const s = _chatStates.get(_partnerId) || {};
                _chatStates.set(_partnerId, { ...s, partnerStrokes: [] });
                return;
            }

            if (!_overlay) _buildOverlay();

            if (data.strokes) {
                _partnerStrokes = data.strokes;
                // Update cache
                const s = _chatStates.get(_partnerId) || {};
                _chatStates.set(_partnerId, { ...s, partnerStrokes: data.strokes });
                _renderPartnerStrokes();
            } else if (data.image) {
                // Fallback: partner masih pakai versi lama (PNG)
                _loadPartnerImage(data.image);
            }

            if (data.published) {
                _hidePartnerIndicator();
                if (!_overlay?.classList.contains('doodle-active')) {
                    _overlay?.classList.add('doodle-view-only');
                    _showPublishToast();
                    // Pasang scroll listener agar doodle ikut scroll di view-only
                    _attachScrollForViewOnly();
                }
            } else {
                if (!_overlay?.classList.contains('doodle-active')) {
                    _showPartnerIndicator();
                    _overlay?.classList.add('doodle-view-only');
                    // Pasang scroll listener agar preview partner ikut scroll
                    _attachScrollForViewOnly();
                }
            }
        });
    }

    // Pasang scroll listener ke messages-area untuk mode view-only
    function _attachScrollForViewOnly() {
        const container = _getMessagesArea();
        if (!container) return;
        // Hapus dulu agar tidak double
        container.removeEventListener('scroll', _onScroll);
        container.addEventListener('scroll', _onScroll, { passive: true });
    }

    function _loadPartnerImage(src) {
        // Render image partner ke partnerCanvas (legacy fallback)
        const img = new Image();
        img.onload = () => {
            if (!_partnerCtx || !_partnerCanvas) return;
            _partnerCtx.clearRect(0, 0, _partnerCanvas.width, _partnerCanvas.height);
            _partnerCtx.drawImage(img, 0, 0, _partnerCanvas.width, _partnerCanvas.height);
        };
        img.src = src;
    }

    // ── LISTEN: node SENDIRI ──────────────────────────────────
    function _listenSelfNode() {
        if (!_db || !_myUid || !_partnerId) return;
        if (_listenerSelf) { _listenerSelf(); _listenerSelf = null; }

        const { ref, onValue } = _fb;
        _listenerSelf = onValue(ref(_db, _drawPath(_myUid)), snap => {
            if (!snap.exists()) return;
            const data = snap.val();
            if (!data || !data.published || data.from !== _myUid) return;
            if (data.strokes) {
                _myStrokes = data.strokes;
                // Simpan ke cache
                const s = _chatStates.get(_partnerId) || {};
                _chatStates.set(_partnerId, { ...s, myStrokes: data.strokes, hasPublished: true });
                _renderMyStrokes();
                _overlay?.classList.add('doodle-view-only');
                // Scroll listener agar doodle pengirim juga ikut scroll di view-only
                _attachScrollForViewOnly();
            }
        });
    }

    // ── MUAT STROKES SENDIRI DARI FIREBASE (saat buka tanpa cache) ──
    // Jika ada strokes lama di Firebase (published atau draft), restore
    // agar user bisa melanjutkan / menambah coretan di atas gambar lama.
    function _loadMyStrokesFromFirebase() {
        if (!_db || !_myUid || !_partnerId) {
            _myStrokes    = [];
            _hasPublished = false;
            _renderMyStrokes();
            return;
        }
        const { ref, get } = _fb;
        get(ref(_db, _drawPath(_myUid))).then(snap => {
            if (snap.exists()) {
                const data = snap.val();
                if (data && !data.cleared && Array.isArray(data.strokes) && data.strokes.length > 0) {
                    _myStrokes    = data.strokes;
                    _hasPublished = false;   // siap tambah coretan baru
                    // Update cache
                    const s = _chatStates.get(_partnerId) || {};
                    _chatStates.set(_partnerId, { ...s, myStrokes: _myStrokes, hasPublished: false });
                } else {
                    _myStrokes    = [];
                    _hasPublished = false;
                }
            } else {
                _myStrokes    = [];
                _hasPublished = false;
            }
            _renderMyStrokes();
        }).catch(() => {
            _myStrokes    = [];
            _hasPublished = false;
            _renderMyStrokes();
        });
    }

    // ── HELPER ────────────────────────────────────────────────
    function _showPartnerIndicator() {
        const ind = document.getElementById('doodlePartnerIndicator');
        if (ind) {
            ind.innerHTML = `&#127912; <span>${_getPartnerName()}</span> sedang menggambar...`;
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

    // ── OPEN DOODLE ───────────────────────────────────────────
    function openDoodle() {
        if (!_partnerId) { alert('Pilih chat terlebih dahulu!'); return; }

        if (!_overlay || !document.getElementById('doodleOverlay')) {
            _buildOverlay();
        } else {
            _positionOverlay();
            _resizeCanvases();
        }

        _overlay.classList.add('doodle-active');
        _overlay.classList.remove('doodle-view-only');
        document.getElementById('doodleToggleBtn')?.classList.add('active');

        // ── PERBAIKAN: JANGAN reset _myStrokes saat buka ulang ──
        // Strokes lama tetap dipertahankan (dari cache atau Firebase).
        // Hanya reset jika memang belum pernah ada data sama sekali.
        const saved = _chatStates.get(_partnerId);
        if (!saved || !saved.myStrokes || saved.myStrokes.length === 0) {
            // Tidak ada cache → coba muat dari Firebase dulu
            _loadMyStrokesFromFirebase();
        } else {
            // Ada cache → restore, user bisa lanjut menggambar
            _myStrokes    = JSON.parse(JSON.stringify(saved.myStrokes));
            _hasPublished = false;   // buka ulang = siap tambah gambar baru
        }

        _undoStack    = [];
        _redoStack    = [];
        _refreshUndoRedo();
        _renderMyStrokes();

        const btn = document.getElementById('doodleFinishBtn');
        if (btn) { btn.textContent = 'Selesai ✓'; btn.disabled = false; btn.style.background = ''; }

        // Dengarkan scroll messages-area → re-render strokes setiap scroll
        const container = _getMessagesArea();
        if (container) {
            container.removeEventListener('scroll', _onScroll);
            container.addEventListener('scroll', _onScroll, { passive: true });
        }

        _listenPartnerNode();
    }

    // ── FINISH ────────────────────────────────────────────────
    function finishDoodle() {
        if (_myStrokes.length === 0) { alert('Canvas kosong, gambar sesuatu dulu!'); return; }

        _hasPublished = true;
        _syncMyStrokes(true);

        // Update cache — strokes TETAP disimpan agar bisa di-append berikutnya
        const s = _chatStates.get(_partnerId) || {};
        _chatStates.set(_partnerId, {
            ...s,
            myStrokes   : JSON.parse(JSON.stringify(_myStrokes)),
            hasPublished: true,
        });

        const btn = document.getElementById('doodleFinishBtn');
        if (btn) { btn.textContent = '✓ Terkirim!'; btn.disabled = true; }

        setTimeout(() => {
            _overlay?.classList.remove('doodle-active');
            _overlay?.classList.add('doodle-view-only');
            document.getElementById('doodleToggleBtn')?.classList.remove('active');
            if (btn) { btn.textContent = 'Tambah Doodle ✏️'; btn.disabled = false; }
            // Pasang scroll listener agar doodle pengirim tetap ikut scroll
            _attachScrollForViewOnly();
            _listenSelfNode();
        }, 600);
    }

    // ── DISMISS ───────────────────────────────────────────────
    function _dismissDoodle() {
        if (!_overlay) return;

        // Konfirmasi jika ada strokes yang belum di-publish
        if (_myStrokes.length > 0) {
            const ok = confirm('Hapus semua doodle dan tutup? Gambar yang belum dikirim akan hilang.');
            if (!ok) return;
        }

        _overlay.classList.remove('doodle-active', 'doodle-view-only');
        document.getElementById('doodleToggleBtn')?.classList.remove('active');
        _hidePartnerIndicator();

        _myStrokes      = [];
        _partnerStrokes = [];
        _undoStack      = [];
        _redoStack      = [];
        _hasPublished   = false;
        _renderMyStrokes();
        _renderPartnerStrokes();
        _refreshUndoRedo();

        // Hapus cache partner ini juga
        _chatStates.delete(_partnerId);

        const container = _getMessagesArea();
        if (container) container.removeEventListener('scroll', _onScroll);

        if (_db && _myUid && _partnerId) {
            const { ref, set } = _fb;
            set(ref(_db, _drawPath(_myUid)), {
                strokes: null, image: null, from: _myUid, ts: Date.now(),
                cleared: true, published: false, viewedBy: {},
            }).catch(() => {});
        }

        _listenPartnerNode();
    }

    function closeDoodle() {
        if (!_overlay) return;
        const wasActive = _overlay.classList.contains('doodle-active');
        _overlay.classList.remove('doodle-active', 'doodle-view-only');
        document.getElementById('doodleToggleBtn')?.classList.remove('active');

        const container = _getMessagesArea();
        if (container) container.removeEventListener('scroll', _onScroll);

        // ── PERBAIKAN: saat close, simpan strokes ke cache (JANGAN hapus) ──
        // Strokes hanya di-clear ke Firebase jika user belum pernah menggambar apapun.
        if (wasActive) {
            // Simpan draft ke cache agar bisa dilanjutkan nanti
            const s = _chatStates.get(_partnerId) || {};
            _chatStates.set(_partnerId, {
                ...s,
                myStrokes   : JSON.parse(JSON.stringify(_myStrokes)),
                hasPublished: _hasPublished,
            });
            // Sync draft ke Firebase jika ada strokes (tidak dikirim sebagai "published")
            if (_myStrokes.length > 0) {
                _syncMyStrokes(false);
            }
        }
        _undoStack = [];
        _redoStack = [];
        _refreshUndoRedo();
    }

    // ── ON SELECT USER ────────────────────────────────────────
    function onSelectUser(userId) {
        const prev = _partnerId;
        if (prev === userId) return;

        // ── Simpan state partner sebelumnya ──────────────────
        if (prev) {
            _chatStates.set(prev, {
                myStrokes     : JSON.parse(JSON.stringify(_myStrokes)),
                partnerStrokes: JSON.parse(JSON.stringify(_partnerStrokes)),
                hasPublished  : _hasPublished,
            });
        }

        if (_listenerPartner) { _listenerPartner(); _listenerPartner = null; }
        if (_listenerSelf)    { _listenerSelf();    _listenerSelf    = null; }

        const container = _getMessagesArea();
        if (container) container.removeEventListener('scroll', _onScroll);

        _partnerId = userId;

        if (_overlay) _overlay.classList.remove('doodle-active', 'doodle-view-only');
        document.getElementById('doodleToggleBtn')?.classList.remove('active');
        _hidePartnerIndicator();

        // ── Restore state partner baru jika ada ─────────────
        const saved = _chatStates.get(userId);
        if (saved) {
            _myStrokes      = saved.myStrokes;
            _partnerStrokes = saved.partnerStrokes;
            _hasPublished   = saved.hasPublished;
        } else {
            _myStrokes      = [];
            _partnerStrokes = [];
            _hasPublished   = false;
        }
        _undoStack = [];
        _redoStack = [];
        _refreshUndoRedo();

        // Render ulang jika overlay masih ada
        if (_overlay) {
            _positionOverlay();
            _resizeCanvases();
            _renderMyStrokes();
            _renderPartnerStrokes();
        }

        _listenPartnerNode();
    }

    // ── VIEWER ────────────────────────────────────────────────
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
                    console.log('[DoodleSystem v10] UID resolved:', _myUid);
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

        console.log('[DoodleSystem v10] ✅ Init — position:fixed, stroke-based, scroll-aware');
    }

    // ── PUBLIC API ────────────────────────────────────────────
    return {
        init,
        onSelectUser,
        openDoodle,
        closeDoodle,
        openViewer,
        onMessagesRendered() {
            if (_overlay && (_overlay.classList.contains('doodle-active') ||
                             _overlay.classList.contains('doodle-view-only'))) {
                _positionOverlay();
                _resizeCanvases();
                _renderMyStrokes();
                _renderPartnerStrokes();
            }
        },
    };

})();

window.DoodleSystem = DoodleSystem;
