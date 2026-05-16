/**
 * ============================================================
 *  CHAT DOODLE SYSTEM v6 - In-Chat Canvas (Scroll & Persistent)
 *  File: chat-doodle.js
 *
 *  CARA KERJA:
 *  - Saat menggambar: coretan live tampil di elemen DALAM messagesArea
 *  - Coretan ikut scroll seperti pesan biasa (bukan overlay layar)
 *  - Tombol "Selesai" → coretan di-freeze & simpan ke Firebase
 *  - KEDUA user (pengirim & penerima) bisa lihat coretan
 *  - Coretan baru replace coretan lama (satu coretan aktif per chat)
 *
 *  FIREBASE STRUCTURE:
 *  doodles/{chatId}/canvas  ← live drawing (realtime)
 *  {
 *    image     : base64 PNG,
 *    from      : uid,
 *    fromName  : string,
 *    ts        : timestamp,
 *    live      : boolean,   ← true = sedang digambar, false = selesai/frozen
 *    cleared   : boolean
 *  }
 * ============================================================
 */

const DoodleSystem = (() => {

    let _db         = null;
    let _fb         = null;
    let _myUid      = null;
    let _myName     = '';
    let _partnerId  = null;
    let _isDrawing  = false;
    let _eraser     = false;
    let _color      = '#ff3b30';
    let _lineWidth  = 6;
    let _history    = [];
    let _redoStack  = [];
    let _listener   = null;
    let _syncTimeout = null;
    let _isPublished = false;

    // DOM refs - drawing overlay (untuk menggambar saja)
    let _drawOverlay, _drawCanvas, _drawCtx;

    // DOM ref - elemen di dalam messagesArea (hasil final + live preview)
    let _chatDoodleEl = null;

    const PRESET_COLORS = [
        '#ffffff', '#ff3b30', '#ff9500',
        '#ffcc00', '#34c759', '#007aff',
        '#af52de', '#ff2d55', '#000000',
    ];

    // ── UTIL ─────────────────────────────────────────────────
    function _chatId(a, b) { return [a, b].sort().join('_'); }
    function _canvasPath() { return `doodles/${_chatId(_myUid, _partnerId)}/canvas`; }

    // ── BUILD DRAW OVERLAY (untuk input menggambar) ───────────
    // Overlay ini hanya muncul saat mode gambar aktif, BUKAN di atas chat
    function _buildDrawOverlay() {
        if (document.getElementById('doodleDrawOverlay')) return;

        const chatWindow = document.getElementById('chatWindow')
                        || document.querySelector('.chat-window');
        if (!chatWindow) return;
        if (getComputedStyle(chatWindow).position === 'static') {
            chatWindow.style.position = 'relative';
        }

        _drawOverlay = document.createElement('div');
        _drawOverlay.id = 'doodleDrawOverlay';
        _drawOverlay.innerHTML = `
            <canvas id="doodleDrawCanvas"></canvas>
            <button id="doodleCloseBtn" title="Batal">✕</button>
            <div id="doodleLabel">✏️ Menggambar...</div>
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
                <div class="doodle-divider"></div>
                <button id="doodleFinishBtn">Selesai ✓</button>
            </div>
        `;
        chatWindow.appendChild(_drawOverlay);

        _drawCanvas = document.getElementById('doodleDrawCanvas');
        _drawCtx    = _drawCanvas.getContext('2d');

        _resizeDrawCanvas();
        _buildColorSwatches();
        _bindDrawEvents();
    }

    // ── RESIZE DRAW CANVAS ───────────────────────────────────
    function _resizeDrawCanvas() {
        if (!_drawOverlay || !_drawCanvas) return;
        const w = _drawOverlay.offsetWidth  || 400;
        const h = _drawOverlay.offsetHeight || 500;
        let saved = null;
        if (_drawCanvas.width > 0 && _drawCanvas.height > 0) {
            try { saved = _drawCtx.getImageData(0, 0, _drawCanvas.width, _drawCanvas.height); } catch(e) {}
        }
        _drawCanvas.width  = w;
        _drawCanvas.height = h;
        if (saved) {
            try { _drawCtx.putImageData(saved, 0, 0); } catch(e) {}
        }
    }

    // ── GET/CREATE CHAT DOODLE ELEMENT ───────────────────────
    // Elemen ini hidup di dalam messagesArea, ikut scroll
    function _getChatDoodleEl() {
        const messagesArea = document.getElementById('messagesArea');
        if (!messagesArea) return null;

        let el = document.getElementById('chatDoodleEl');
        if (!el) {
            el = document.createElement('div');
            el.id = 'chatDoodleEl';
            el.className = 'chat-doodle-wrapper';
            el.innerHTML = `
                <div class="chat-doodle-inner">
                    <canvas id="chatDoodleCanvas" class="chat-doodle-canvas"></canvas>
                    <div class="chat-doodle-meta" id="chatDoodleMeta"></div>
                    <div class="chat-doodle-live-badge" id="chatDoodleLiveBadge">✏️ sedang menggambar...</div>
                </div>
            `;
            // Sisipkan SEBELUM pesan pertama (paling atas di area chat)
            // atau append — posisi selalu di bawah semua pesan
            messagesArea.appendChild(el);
        }
        _chatDoodleEl = el;
        return el;
    }

    // ── UPDATE CHAT DOODLE ELEMENT ───────────────────────────
    function _renderChatDoodle(imageDataUrl, fromName, isLive, ts) {
        const el = _getChatDoodleEl();
        if (!el) return;

        const canvas = document.getElementById('chatDoodleCanvas');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');

        // Set ukuran canvas sesuai container
        const wrapper = el.querySelector('.chat-doodle-inner');
        const maxW = wrapper ? wrapper.clientWidth || 320 : 320;
        canvas.width  = maxW;
        canvas.height = Math.round(maxW * 0.65); // rasio 3:2

        // Fill background hitam (doodle style)
        ctx.fillStyle = '#111118';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (imageDataUrl) {
            const img = new Image();
            img.onload = () => {
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            };
            img.src = imageDataUrl;
        }

        // Meta info
        const meta = document.getElementById('chatDoodleMeta');
        if (meta) {
            const timeStr = ts ? new Date(ts).toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' }) : '';
            meta.innerHTML = `<span class="chat-doodle-author">🎨 ${escSafe(fromName || 'User')}</span><span class="chat-doodle-time">${timeStr}</span>`;
        }

        // Live badge
        const badge = document.getElementById('chatDoodleLiveBadge');
        if (badge) {
            badge.style.display = isLive ? 'flex' : 'none';
        }

        el.style.display = 'block';

        // Auto scroll ke bawah
        const messagesArea = document.getElementById('messagesArea');
        if (messagesArea) {
            setTimeout(() => { messagesArea.scrollTop = messagesArea.scrollHeight; }, 50);
        }
    }

    function _hideChatDoodle() {
        const el = document.getElementById('chatDoodleEl');
        if (el) el.style.display = 'none';
    }

    function escSafe(s) {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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
            s.addEventListener('click', () => _setColor(c, s));
            wrap.appendChild(s);
        });
    }

    function _setColor(c, el) {
        _color  = c;
        _eraser = false;
        document.getElementById('doodleEraserBtn')?.classList.remove('active');
        _drawCanvas?.classList.remove('eraser-mode');
        document.querySelectorAll('.doodle-color-swatch').forEach(s => s.classList.remove('selected'));
        el?.classList.add('selected');
        const picker = document.getElementById('doodleColorPicker');
        if (picker) picker.value = c;
    }

    // ── BIND DRAW EVENTS ─────────────────────────────────────
    function _bindDrawEvents() {
        document.getElementById('doodleCloseBtn').addEventListener('click', cancelDoodle);
        document.getElementById('doodleFinishBtn').addEventListener('click', finishDoodle);

        document.getElementById('doodleEraserBtn').addEventListener('click', () => {
            _eraser = !_eraser;
            document.getElementById('doodleEraserBtn').classList.toggle('active', _eraser);
            _drawCanvas.classList.toggle('eraser-mode', _eraser);
        });

        document.getElementById('doodleUndoBtn').addEventListener('click', _undo);
        document.getElementById('doodleRedoBtn').addEventListener('click', _redo);

        document.getElementById('doodleClearBtn').addEventListener('click', () => {
            _saveHistory();
            _drawCtx.clearRect(0, 0, _drawCanvas.width, _drawCanvas.height);
            _syncLive();
        });

        document.getElementById('doodleSizeSlider').addEventListener('input', e => {
            _lineWidth = parseInt(e.target.value);
        });

        document.getElementById('doodleColorPicker').addEventListener('input', e => {
            _color  = e.target.value;
            _eraser = false;
            document.getElementById('doodleEraserBtn')?.classList.remove('active');
            _drawCanvas?.classList.remove('eraser-mode');
            document.querySelectorAll('.doodle-color-swatch').forEach(s => s.classList.remove('selected'));
        });

        _drawCanvas.addEventListener('mousedown',  _startDraw);
        _drawCanvas.addEventListener('mousemove',  _draw);
        _drawCanvas.addEventListener('mouseup',    _endDraw);
        _drawCanvas.addEventListener('mouseleave', _endDraw);
        _drawCanvas.addEventListener('touchstart',  _touchStart,  { passive: false });
        _drawCanvas.addEventListener('touchmove',   _touchMove,   { passive: false });
        _drawCanvas.addEventListener('touchend',    _endDraw);
        _drawCanvas.addEventListener('touchcancel', _endDraw);

        window.addEventListener('resize', _resizeDrawCanvas);
    }

    // ── DRAW ─────────────────────────────────────────────────
    function _getPos(e) {
        const rect = _drawCanvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (_drawCanvas.width / rect.width),
            y: (e.clientY - rect.top)  * (_drawCanvas.height / rect.height),
        };
    }

    function _saveHistory() {
        _history.push(_drawCtx.getImageData(0, 0, _drawCanvas.width, _drawCanvas.height));
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
        _redoStack.push(_drawCtx.getImageData(0, 0, _drawCanvas.width, _drawCanvas.height));
        _drawCtx.putImageData(_history.pop(), 0, 0);
        _refreshUndoRedo();
        _syncLive();
    }

    function _redo() {
        if (!_redoStack.length) return;
        _history.push(_drawCtx.getImageData(0, 0, _drawCanvas.width, _drawCanvas.height));
        _drawCtx.putImageData(_redoStack.pop(), 0, 0);
        _refreshUndoRedo();
        _syncLive();
    }

    function _applyStyle() {
        if (_eraser) {
            _drawCtx.globalCompositeOperation = 'destination-out';
            _drawCtx.strokeStyle = 'rgba(0,0,0,1)';
            _drawCtx.lineWidth   = _lineWidth * 2;
        } else {
            _drawCtx.globalCompositeOperation = 'source-over';
            _drawCtx.strokeStyle = _color;
            _drawCtx.lineWidth   = _lineWidth;
        }
        _drawCtx.lineCap  = 'round';
        _drawCtx.lineJoin = 'round';
    }

    function _startDraw(e) {
        e.preventDefault();
        _saveHistory();
        _isDrawing = true;
        const pos = _getPos(e);
        _drawCtx.beginPath();
        _drawCtx.moveTo(pos.x, pos.y);
        _applyStyle();
    }

    function _draw(e) {
        if (!_isDrawing) return;
        e.preventDefault();
        const pos = _getPos(e);
        _drawCtx.lineTo(pos.x, pos.y);
        _drawCtx.stroke();
    }

    function _endDraw() {
        if (!_isDrawing) return;
        _isDrawing = false;
        _drawCtx.closePath();
        _syncLive();
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
    function _syncLive() {
        clearTimeout(_syncTimeout);
        _syncTimeout = setTimeout(() => {
            if (!_db || !_myUid || !_partnerId) return;
            const { ref, set } = _fb;
            const imageData = _drawCtx.getImageData(0, 0, _drawCanvas.width, _drawCanvas.height);
            const isBlank   = !imageData.data.some(v => v !== 0);
            set(ref(_db, _canvasPath()), {
                image    : isBlank ? null : _drawCanvas.toDataURL('image/png', 0.82),
                from     : _myUid,
                fromName : _myName || window.currentUserName || 'User',
                ts       : Date.now(),
                live     : true,
                cleared  : isBlank,
            }).catch(err => console.error('[Doodle] sync err:', err));
        }, 180);
    }

    function _syncFinish(imageDataUrl) {
        if (!_db || !_myUid || !_partnerId) return Promise.resolve();
        const { ref, set } = _fb;
        return set(ref(_db, _canvasPath()), {
            image    : imageDataUrl,
            from     : _myUid,
            fromName : _myName || window.currentUserName || 'User',
            ts       : Date.now(),
            live     : false,   // frozen
            cleared  : false,
        });
    }

    function _syncClear() {
        if (!_db || !_myUid || !_partnerId) return;
        const { ref, set } = _fb;
        set(ref(_db, _canvasPath()), {
            image  : null,
            from   : _myUid,
            ts     : Date.now(),
            live   : false,
            cleared: true,
        }).catch(()=>{});
    }

    // ── LISTEN REALTIME ──────────────────────────────────────
    function _listenCanvas() {
        if (!_db || !_myUid || !_partnerId) return;
        if (_listener) { _listener(); _listener = null; }

        const { ref, onValue } = _fb;
        _listener = onValue(ref(_db, _canvasPath()), snap => {
            if (!snap.exists()) { _hideChatDoodle(); return; }
            const d = snap.val();
            if (!d || d.cleared || !d.image) { _hideChatDoodle(); return; }

            // Render ke elemen dalam chat (kedua user lihat)
            _renderChatDoodle(d.image, d.fromName, d.live === true, d.ts);

            // Jika partner yang menggambar dan ini live → tampilkan di chat-doodle-el
            // Jika saya yang menggambar (from === myUid) → juga tampil (mirror)
        });
    }

    // ── TOMBOL SELESAI ───────────────────────────────────────
    async function finishDoodle() {
        const imageData = _drawCtx.getImageData(0, 0, _drawCanvas.width, _drawCanvas.height);
        if (!imageData.data.some(v => v !== 0)) {
            alert('⚠️ Canvas kosong, gambar sesuatu dulu!');
            return;
        }

        const dataUrl = _drawCanvas.toDataURL('image/png', 0.85);

        // Animasi tombol
        const btn = document.getElementById('doodleFinishBtn');
        if (btn) {
            btn.textContent = '✅ Terkirim!';
            btn.disabled    = true;
            btn.classList.add('finish-sent');
        }

        try {
            await _syncFinish(dataUrl);  // simpan frozen ke Firebase
        } catch(e) {
            console.error('[Doodle] finish err:', e);
        }

        _isPublished = true;

        // Tutup draw overlay setelah animasi
        setTimeout(() => {
            _closeDrawOverlay(false); // false = jangan clear Firebase
        }, 700);
    }

    // ── BATAL (✕) ────────────────────────────────────────────
    function cancelDoodle() {
        // Hapus coretan jika belum publish
        if (!_isPublished) {
            _drawCtx?.clearRect(0, 0, _drawCanvas?.width || 0, _drawCanvas?.height || 0);
            _syncClear();
        }
        _closeDrawOverlay(false);
    }

    function _closeDrawOverlay(clearFirebase) {
        _drawOverlay?.classList.remove('doodle-draw-active');
        document.getElementById('doodleToggleBtn')?.classList.remove('active');
        _history   = [];
        _redoStack = [];
        _refreshUndoRedo();
        _isPublished = false;

        // Reset tombol Selesai
        const btn = document.getElementById('doodleFinishBtn');
        if (btn) {
            btn.textContent = 'Selesai ✓';
            btn.disabled    = false;
            btn.classList.remove('finish-sent');
        }
    }

    // ── OPEN DRAW MODE ───────────────────────────────────────
    function openDoodle() {
        if (!_partnerId) { alert('⚠️ Pilih chat terlebih dahulu!'); return; }
        if (!document.getElementById('doodleDrawOverlay')) _buildDrawOverlay();
        _resizeDrawCanvas();

        // Reset canvas baru
        _drawCtx?.clearRect(0, 0, _drawCanvas?.width || 0, _drawCanvas?.height || 0);
        _history   = [];
        _redoStack = [];
        _refreshUndoRedo();
        _isPublished = false;

        _drawOverlay.classList.add('doodle-draw-active');
        document.getElementById('doodleToggleBtn')?.classList.add('active');
    }

    function closeDoodle() {
        cancelDoodle();
    }

    // ── ON SELECT USER ───────────────────────────────────────
    function onSelectUser(userId) {
        const prev = _partnerId;
        _partnerId = userId;
        _isPublished = false;

        if (_listener) { _listener(); _listener = null; }

        if (prev !== userId) {
            _drawCtx?.clearRect(0, 0, _drawCanvas?.width || 0, _drawCanvas?.height || 0);
            _history = []; _redoStack = [];
            _closeDrawOverlay(false);
            // Hapus elemen chat doodle lama
            const old = document.getElementById('chatDoodleEl');
            if (old) old.remove();
        }

        _listenCanvas();
    }

    // ── OPEN VIEWER (legacy) ──────────────────────────────────
    function openViewer(src) {
        let viewer = document.getElementById('doodleViewer');
        if (!viewer) {
            viewer = document.createElement('div');
            viewer.id = 'doodleViewer';
            viewer.innerHTML = `<img id="doodleViewerImg" src="" alt="doodle"><button id="doodleViewerClose">Tutup</button>`;
            document.body.appendChild(viewer);
            document.getElementById('doodleViewerClose').onclick = () => viewer.classList.remove('open');
            viewer.addEventListener('click', e => { if (e.target === viewer) viewer.classList.remove('open'); });
        }
        document.getElementById('doodleViewerImg').src = src;
        viewer.classList.add('open');
    }

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
        _myUid  = window._myUid || null;
        _myName = window.currentUserName || '';

        const _waitUid = setInterval(() => {
            if (window._myUid) {
                _myUid  = window._myUid;
                _myName = window.currentUserName || _myName;
                clearInterval(_waitUid);
            }
        }, 300);

        const toggleBtn = document.getElementById('doodleToggleBtn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                if (_drawOverlay?.classList.contains('doodle-draw-active')) {
                    cancelDoodle();
                } else {
                    openDoodle();
                }
            });
        }
        console.log('[DoodleSystem v6] ✅ In-chat canvas mode');
    }

    return { init, onSelectUser, openDoodle, closeDoodle, openViewer, renderDoodleBubble };

})();

window.DoodleSystem = DoodleSystem;
