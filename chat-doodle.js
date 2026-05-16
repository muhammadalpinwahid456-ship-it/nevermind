/**
 * ============================================================
 *  CHAT DOODLE SYSTEM v7 - Instagram Draw Style
 *  File: chat-doodle.js
 *
 *  PERUBAHAN UTAMA v7:
 *  ──────────────────────────────────────────────────────────
 *  1. OVERLAY = position:absolute di dalam .chat-window
 *     → Tidak ikut scroll, tidak perlu RAF loop, tidak geser
 *     → .chat-window diberi position:relative otomatis saat init
 *
 *  2. PENGIRIM JUGA BISA LIHAT HASIL SENDIRI
 *     → Setelah "Selesai", overlay tetap muncul dalam mode view-only
 *     → Pengirim melihat gambarnya di atas chat
 *     → Penerima juga melihat gambar pengirim
 *     → Kedua user bisa dismiss dengan klik X
 *
 *  3. FIREBASE - 2 NODE TERPISAH PER USER
 *     doodles/{chatId}/draw_{uidA}  ← coretan user A
 *     doodles/{chatId}/draw_{uidB}  ← coretan user B
 *     → Masing-masing listen ke node partner
 *     → Tidak bentrok saat keduanya menggambar bersamaan
 *
 *  STRUKTUR DATA FIREBASE → doodles/{chatId}/draw_{uid}
 *  {
 *    image    : base64 PNG | null,
 *    from     : uid,
 *    ts       : timestamp,
 *    cleared  : boolean,
 *    published: boolean,   // true = sudah "Selesai" / frozen
 *    viewedBy : { [uid]: true }  // siapa saja yang sudah dismiss
 *  }
 *
 *  INTEGRASI (sama seperti v6):
 *  1. <link rel="stylesheet" href="chat-doodle.css">
 *  2. DoodleSystem.init(database, { ref, get, set, onValue })
 *  3. DoodleSystem.onSelectUser(userId) saat buka chat
 *  4. Tombol doodleToggleBtn otomatis terhubung
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
    let _listenerPartner = null;  // listen node partner
    let _listenerSelf    = null;  // listen node sendiri (agar pengirim juga lihat)

    const PRESET_COLORS = [
        '#ffffff', '#ff3b30', '#ff9500',
        '#ffcc00', '#34c759', '#007aff',
        '#af52de', '#ff2d55', '#000000',
    ];

    // ── UTIL ─────────────────────────────────────────────────
    function _chatId(a, b) { return [a, b].sort().join('_'); }

    /** Path node coretan milik uid tertentu */
    function _drawPath(uid) {
        return `doodles/${_chatId(_myUid, _partnerId)}/draw_${uid}`;
    }

    // ── BUILD OVERLAY (di dalam .chat-window) ─────────────────
    function _buildOverlay() {
        if (document.getElementById('doodleOverlay')) return;

        // Pastikan .chat-window punya position:relative DAN overflow:hidden
        // supaya overlay tidak ikut scroll bersama .messages-area
        const chatWin = _getChatWindow();
        if (chatWin) {
            chatWin.style.position = 'relative';
            chatWin.style.overflow = 'hidden';
        }

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

        // Pasang di dalam chat-window, bukan di body
        if (chatWin) {
            chatWin.appendChild(_overlay);
        } else {
            document.body.appendChild(_overlay);
        }

        _myCanvas      = document.getElementById('doodleMyCanvas');
        _myCtx         = _myCanvas.getContext('2d');
        _partnerCanvas = document.getElementById('doodlePartnerCanvas');
        _partnerCtx    = _partnerCanvas.getContext('2d');

        _resizeCanvases();
        _buildColorSwatches();
        _bindEvents();

        // Resize canvas saat window resize
        window.addEventListener('resize', _resizeCanvases);

        // Viewer fullscreen
        if (!document.getElementById('doodleViewer')) {
            const viewer = document.createElement('div');
            viewer.id = 'doodleViewer';
            viewer.innerHTML = '<img id="doodleViewerImg" src="" alt="doodle"><button id="doodleViewerClose">Tutup</button>';
            document.body.appendChild(viewer);
            document.getElementById('doodleViewerClose').onclick = () => viewer.classList.remove('open');
            viewer.addEventListener('click', e => { if (e.target === viewer) viewer.classList.remove('open'); });
        }
    }

    function _getChatWindow() {
        // Overlay HARUS dipasang di .chat-window (bukan .messages-area).
        // .chat-window punya position:relative + overflow:hidden → overlay
        // tidak ikut scroll karena yang scroll hanya .messages-area (child-nya).
        return document.getElementById('chatWindow')
            || document.querySelector('.chat-window');
    }

    // ── CANVAS RESIZE ─────────────────────────────────────────
    function _resizeCanvases() {
        if (!_overlay) return;
        // Ukur dari .chat-window (parent), bukan dari overlay itu sendiri.
        // Saat overlay display:none, offsetWidth/Height-nya 0 — hasilnya canvas kosong.
        const chatWin = _getChatWindow();
        const w = (chatWin ? chatWin.offsetWidth  : _overlay.offsetWidth)  || 400;
        const h = (chatWin ? chatWin.offsetHeight : _overlay.offsetHeight) || 600;

        [_myCanvas, _partnerCanvas].forEach(c => {
            if (!c) return;
            // Simpan gambar lama sebelum resize
            let saved = null;
            if (c.width > 0 && c.height > 0) {
                try {
                    const tmp = document.createElement('canvas');
                    tmp.width  = c.width;
                    tmp.height = c.height;
                    tmp.getContext('2d').drawImage(c, 0, 0);
                    saved = tmp;
                } catch(e) {}
            }
            c.width  = w;
            c.height = h;
            if (saved) {
                try { c.getContext('2d').drawImage(saved, 0, 0, w, h); } catch(e) {}
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

        // Mouse events
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

    // ── FIREBASE SYNC (node sendiri) ──────────────────────────
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

    // ── FINISH: publish lalu switch ke view-only ───────────────
    function finishDoodle() {
        const imageData = _myCtx.getImageData(0, 0, _myCanvas.width, _myCanvas.height);
        const isBlank   = !imageData.data.some(v => v !== 0);
        if (isBlank) {
            alert('Canvas kosong, gambar sesuatu dulu!');
            return;
        }

        _hasPublished = true;
        _syncMyCanvas(true);   // published = true

        const btn = document.getElementById('doodleFinishBtn');
        if (btn) {
            btn.textContent = '✓ Terkirim!';
            btn.disabled    = true;
        }

        // Setelah 600ms: matikan mode aktif, TETAPI overlay tetap tampil
        // dalam mode view-only agar PENGIRIM bisa lihat hasil sendiri
        setTimeout(() => {
            _overlay?.classList.remove('doodle-active');
            _overlay?.classList.add('doodle-view-only');
            document.getElementById('doodleToggleBtn')?.classList.remove('active');

            // Tampilkan gambar sendiri di partnerCanvas (lapisan bawah) agar
            // terlihat di view-only (myCanvas tidak interaktif di mode ini)
            // Salin myCanvas ke partnerCanvas area agar dua layer merge
            // Sebenarnya myCanvas tetap tampil karena masih ada di DOM
            // → overlay view-only sudah cukup tampilkan myCanvas (pointer-events:none)

            if (btn) { btn.textContent = 'Selesai ✓'; btn.disabled = false; }

            // Mulai listen node sendiri juga, agar jika ada update dari Firebase konsisten
            _listenSelfNode();
        }, 600);
    }

    // ── DISMISS: tutup view-only, tandai sudah dilihat ─────────
    function _dismissDoodle() {
        if (!_overlay) return;
        _overlay.classList.remove('doodle-active', 'doodle-view-only');
        document.getElementById('doodleToggleBtn')?.classList.remove('active');
        _hidePartnerIndicator();

        // Bersihkan canvas
        _myCtx?.clearRect(0, 0, _myCanvas?.width || 0, _myCanvas?.height || 0);
        _partnerCtx?.clearRect(0, 0, _partnerCanvas?.width || 0, _partnerCanvas?.height || 0);

        _history   = [];
        _redoStack = [];
        _refreshUndoRedo();
        _hasPublished = false;

        // Hapus node sendiri dari Firebase (clear)
        if (_db && _myUid && _partnerId) {
            const { ref, set } = _fb;
            set(ref(_db, _drawPath(_myUid)), {
                image: null, from: _myUid, ts: Date.now(),
                cleared: true, published: false, viewedBy: {},
            }).catch(() => {});
        }

        // Re-listen tanpa overlay aktif
        _listenPartnerNode();
    }

    // ── CLOSE saat user batal sebelum finish ──────────────────
    function closeDoodle() {
        if (!_overlay) return;
        const wasActive = _overlay.classList.contains('doodle-active');
        _overlay.classList.remove('doodle-active', 'doodle-view-only');
        document.getElementById('doodleToggleBtn')?.classList.remove('active');

        if (wasActive && !_hasPublished) {
            // Batal menggambar → hapus canvas & node Firebase
            _myCtx?.clearRect(0, 0, _myCanvas?.width || 0, _myCanvas?.height || 0);
            _syncMyCanvas(false);
        }

        _history   = [];
        _redoStack = [];
        _refreshUndoRedo();
    }

    // ── LISTEN: node PARTNER (melihat coretan partner) ─────────
    function _listenPartnerNode() {
        if (!_db || !_myUid || !_partnerId) return;
        if (_listenerPartner) { _listenerPartner(); _listenerPartner = null; }

        const { ref, onValue } = _fb;

        _listenerPartner = onValue(ref(_db, _drawPath(_partnerId)), snap => {
            if (!snap.exists()) {
                _clearPartnerCanvas();
                return;
            }
            const data = snap.val();
            if (!data) { _clearPartnerCanvas(); return; }

            if (data.cleared || !data.image) {
                _clearPartnerCanvas();
                _hidePartnerIndicator();
                // Jika overlay hanya view-only dari partner dan sudah clear → sembunyikan
                if (!_overlay?.classList.contains('doodle-active') && !_hasPublished) {
                    _overlay?.classList.remove('doodle-view-only');
                }
                return;
            }

            // Render gambar partner ke partnerCanvas
            if (!_overlay) _buildOverlay();

            const img = new Image();
            img.onload = () => {
                if (!_partnerCtx || !_partnerCanvas) return;
                _partnerCtx.clearRect(0, 0, _partnerCanvas.width, _partnerCanvas.height);
                _partnerCtx.drawImage(img, 0, 0, _partnerCanvas.width, _partnerCanvas.height);
            };
            img.src = data.image;

            if (data.published) {
                // Partner sudah selesai → tampilkan view-only untuk kita
                _hidePartnerIndicator();
                if (!_overlay?.classList.contains('doodle-active')) {
                    _overlay?.classList.add('doodle-view-only');
                    _showPublishToast();
                }
            } else {
                // Partner sedang menggambar live
                if (!_overlay?.classList.contains('doodle-active')) {
                    _showPartnerIndicator();
                    _overlay?.classList.add('doodle-view-only');
                }
            }
        });
    }

    // ── LISTEN: node SENDIRI (agar pengirim lihat hasil di view-only) ──
    function _listenSelfNode() {
        if (!_db || !_myUid || !_partnerId) return;
        if (_listenerSelf) { _listenerSelf(); _listenerSelf = null; }

        const { ref, onValue } = _fb;

        _listenerSelf = onValue(ref(_db, _drawPath(_myUid)), snap => {
            if (!snap.exists()) return;
            const data = snap.val();
            if (!data || !data.image || !data.published) return;
            // Pastikan myCanvas menampilkan gambar terbaru (dari Firebase)
            // Ini berguna jika terjadi reload atau multi-device
            if (data.from !== _myUid) return;  // harusnya selalu dari sendiri
            // Overlay view-only sudah menampilkan myCanvas yang terakhir digambar
            // Tidak perlu render ulang kecuali canvas kosong (misal reload)
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
        if (_partnerCtx && _partnerCanvas) {
            _partnerCtx.clearRect(0, 0, _partnerCanvas.width, _partnerCanvas.height);
        }
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

    // ── OPEN DOODLE (mode menggambar) ─────────────────────────
    function openDoodle() {
        if (!_partnerId) { alert('Pilih chat terlebih dahulu!'); return; }

        // Pastikan overlay ada di dalam chat-window yang aktif
        const chatWin = _getChatWindow();
        let existingOverlay = document.getElementById('doodleOverlay');

        // Jika overlay ada tapi di parent yang salah (pindah chat), rebuild
        if (existingOverlay && chatWin && existingOverlay.parentElement !== chatWin) {
            existingOverlay.remove();
            existingOverlay = null;
        }

        if (!existingOverlay) _buildOverlay();

        // Pastikan chat-window punya position:relative + overflow:hidden
        if (chatWin) {
            chatWin.style.position = 'relative';
            chatWin.style.overflow = 'hidden';
        }

        _overlay.classList.add('doodle-active');
        _overlay.classList.remove('doodle-view-only');
        document.getElementById('doodleToggleBtn')?.classList.add('active');

        _hasPublished = false;
        _resizeCanvases();

        // Reset canvas sendiri
        _myCtx?.clearRect(0, 0, _myCanvas?.width || 0, _myCanvas?.height || 0);
        _history   = [];
        _redoStack = [];
        _refreshUndoRedo();

        const btn = document.getElementById('doodleFinishBtn');
        if (btn) { btn.textContent = 'Selesai ✓'; btn.disabled = false; btn.style.background = ''; }

        _listenPartnerNode();
    }

    // ── ON SELECT USER (ganti chat) ───────────────────────────
    function onSelectUser(userId) {
        const prev = _partnerId;
        _partnerId = userId;
        _hasPublished = false;

        if (prev !== userId) {
            // Bersihkan state dari chat sebelumnya
            if (_listenerPartner) { _listenerPartner(); _listenerPartner = null; }
            if (_listenerSelf)    { _listenerSelf();    _listenerSelf    = null; }

            _myCtx?.clearRect(0, 0, _myCanvas?.width || 0, _myCanvas?.height || 0);
            _clearPartnerCanvas();
            _history   = [];
            _redoStack = [];

            if (_overlay) {
                _overlay.classList.remove('doodle-active', 'doodle-view-only');
                document.getElementById('doodleToggleBtn')?.classList.remove('active');
            }
        }

        // Mulai listen node partner baru
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

    function renderDoodleBubble(msg, isMine) {
        const wrap = document.createElement('div');
        wrap.className = 'message-bubble ' + (isMine ? 'sent' : 'received');
        wrap.innerHTML =
            `<div class="doodle-bubble" onclick="DoodleSystem.openViewer('${msg.image}')">` +
            `<img src="${msg.image}" alt="Doodle" loading="lazy"></div>` +
            `<div class="doodle-bubble-label">🎨 Doodle</div>`;
        return wrap;
    }

    // ── INIT ──────────────────────────────────────────────────
    function init(db, firebaseModules) {
        _db  = db;
        _fb  = firebaseModules;
        _myUid = window._myUid || null;

        // Tunggu uid tersedia jika belum login
        if (!_myUid) {
            const _waitUid = setInterval(() => {
                if (window._myUid) {
                    _myUid = window._myUid;
                    clearInterval(_waitUid);
                    console.log('[DoodleSystem v7] UID resolved:', _myUid);
                }
            }, 300);
        }

        // Pasang listener toggle button
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

        // Pastikan chat-window punya position:relative + overflow:hidden
        const chatWin = _getChatWindow();
        if (chatWin) {
            chatWin.style.position = 'relative';
            chatWin.style.overflow = 'hidden';
        }

        console.log('[DoodleSystem v7] ✅ Init — overlay absolute, pengirim lihat hasil sendiri');
    }

    // ── PUBLIC API ────────────────────────────────────────────
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
