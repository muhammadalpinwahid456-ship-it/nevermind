/**
 * ============================================================
 *  CHAT THEME SYSTEM
 *  File: chat-theme.js
 *
 *  FITUR:
 *  - 6 tema visual: Sunset, Ocean, Midnight, Forest, Rose Gold, Mono
 *  - Tema disimpan per chatId di localStorage
 *  - Panel pemilih tema dengan preview visual
 *  - Tema hanya mempengaruhi .chat-window (bukan sidebar/header global)
 *  - Tidak bergantung pada Firebase — murni client-side
 *
 *  INTEGRASI:
 *  1. <link rel="stylesheet" href="chat-theme.css"> di <head>
 *  2. Tambahkan tombol di header chat:
 *       <button id="themeToggleBtn" title="Ganti Tema">🎨</button>
 *  3. ThemeSystem.init()  → di DOMContentLoaded atau setelah login
 *  4. ThemeSystem.onSelectUser(userId)  → di selectUser()
 *  5. ThemeSystem.getCurrentTheme()     → untuk keperluan lain
 * ============================================================
 */

const ThemeSystem = (() => {

    const STORAGE_KEY = 'alvin_chat_themes';   // { [chatId]: themeName }
    const DEFAULT     = 'default';             // tidak pakai atribut → CSS bawaan

    // Definisi semua tema (id, label, warna preview)
    const THEMES = [
        {
            id      : 'sunset',
            label   : '🌅 Sunset',
            bg      : 'linear-gradient(160deg,#ff9a56,#ff6b9d,#c44dff)',
            sent    : 'linear-gradient(135deg,#ff3c8e,#ff6a3d)',
            recv    : 'rgba(255,255,255,0.22)',
        },
        {
            id      : 'ocean',
            label   : '🌊 Ocean',
            bg      : 'linear-gradient(160deg,#0f2c6b,#1565c0,#00897b)',
            sent    : 'linear-gradient(135deg,#0288d1,#00897b)',
            recv    : 'rgba(255,255,255,0.18)',
        },
        {
            id      : 'midnight',
            label   : '🌙 Midnight',
            bg      : 'linear-gradient(160deg,#1a0533,#2d0a5e,#0d1b4b)',
            sent    : 'linear-gradient(135deg,#7c3aed,#4f46e5)',
            recv    : 'rgba(255,255,255,0.1)',
        },
        {
            id      : 'forest',
            label   : '🌿 Forest',
            bg      : 'linear-gradient(160deg,#0a2e1a,#1b5e20,#33691e)',
            sent    : 'linear-gradient(135deg,#2e7d32,#558b2f)',
            recv    : 'rgba(255,255,255,0.13)',
        },
        {
            id      : 'rosegold',
            label   : '🌸 Rose',
            bg      : 'linear-gradient(160deg,#3b1f2b,#7b3f5e,#c27b8a)',
            sent    : 'linear-gradient(135deg,#c2185b,#e91e63)',
            recv    : 'rgba(255,255,255,0.15)',
        },
        {
            id      : 'mono',
            label   : '🖤 Mono',
            bg      : 'linear-gradient(160deg,#0a0a0a,#1a1a1a,#242424)',
            sent    : 'linear-gradient(135deg,#e0e0e0,#bdbdbd)',
            recv    : 'rgba(255,255,255,0.08)',
        },
    ];

    let _myUid      = null;
    let _partnerId  = null;
    let _isOpen     = false;

    // ── STORAGE ───────────────────────────────────────────────
    function _load() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
        catch { return {}; }
    }
    function _save(data) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
        catch {}
    }
    function _chatId(a, b) { return [a, b].sort().join('_'); }

    function _getTheme(partnerId) {
        if (!_myUid || !partnerId) return DEFAULT;
        const key = _chatId(_myUid, partnerId);
        return _load()[key] || DEFAULT;
    }
    function _setTheme(partnerId, theme) {
        if (!_myUid || !partnerId) return;
        const key  = _chatId(_myUid, partnerId);
        const data = _load();
        if (theme === DEFAULT) { delete data[key]; }
        else                   { data[key] = theme; }
        _save(data);
    }

    // ── APPLY ─────────────────────────────────────────────────
    function _applyTheme(theme) {
        const cw = document.querySelector('.chat-window') ||
                   document.getElementById('chatWindow');
        if (!cw) return;
        if (theme === DEFAULT) {
            cw.removeAttribute('data-theme');
        } else {
            cw.setAttribute('data-theme', theme);
        }
    }

    // ── BUILD PANEL ───────────────────────────────────────────
    function _buildPanel() {
        if (document.getElementById('themePicker')) return;

        const panel = document.createElement('div');
        panel.id = 'themePicker';

        // Judul
        const title = document.createElement('div');
        title.className = 'theme-picker-title';
        title.textContent = 'Tema Chat';
        panel.appendChild(title);

        // Grid kartu
        const grid = document.createElement('div');
        grid.className = 'theme-grid';

        THEMES.forEach(t => {
            const card = document.createElement('div');
            card.className = 'theme-card';
            card.dataset.themeId = t.id;
            card.title = t.label;

            // Preview visual
            const preview = document.createElement('div');
            preview.className = 'theme-preview';
            preview.style.background = t.bg;

            ['recv', 'sent', 'recv', 'sent2'].forEach((cls, i) => {
                const b = document.createElement('div');
                b.className = `tp-bubble ${cls === 'sent2' ? 'sent' : cls}`;
                b.style.background = cls.startsWith('sent') ? t.sent : t.recv;
                b.style.width = ['55%','65%','45%','50%'][i];
                preview.appendChild(b);
            });

            const name = document.createElement('div');
            name.className = 'theme-name';
            name.textContent = t.label;

            card.appendChild(preview);
            card.appendChild(name);
            card.addEventListener('click', () => _selectTheme(t.id));
            grid.appendChild(card);
        });
        panel.appendChild(grid);

        // Tombol reset
        const resetBtn = document.createElement('button');
        resetBtn.id = 'themeResetBtn';
        resetBtn.textContent = '↩ Kembalikan ke Default';
        resetBtn.addEventListener('click', () => _selectTheme(DEFAULT));
        panel.appendChild(resetBtn);

        // Toast
        if (!document.getElementById('themeToast')) {
            const toast = document.createElement('div');
            toast.id = 'themeToast';
            document.body.appendChild(toast);
        }

        document.body.appendChild(panel);

        // Tutup saat klik di luar
        document.addEventListener('click', _onOutsideClick);
    }

    function _selectTheme(themeId) {
        if (!_partnerId) return;
        _setTheme(_partnerId, themeId);
        _applyTheme(themeId);
        _updateCardSelection(themeId);
        _showToast(themeId);
        // Tutup panel setelah pilih
        setTimeout(_closePanel, 300);
    }

    function _updateCardSelection(themeId) {
        document.querySelectorAll('.theme-card').forEach(c => {
            c.classList.toggle('selected', c.dataset.themeId === themeId);
        });
        // Reset card: tidak ada yang selected
        if (themeId === DEFAULT) {
            document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('selected'));
        }
    }

    function _showToast(themeId) {
        const toast = document.getElementById('themeToast');
        if (!toast) return;
        const t = THEMES.find(x => x.id === themeId);
        toast.textContent = t ? `${t.label} diterapkan ✓` : 'Tema dikembalikan ke default';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2200);
    }

    // ── PANEL OPEN / CLOSE ────────────────────────────────────
    function _openPanel() {
        _buildPanel();
        const panel = document.getElementById('themePicker');
        if (!panel) return;
        // Posisikan di dekat tombol toggle
        const btn = document.getElementById('themeToggleBtn');
        if (btn) {
            const rect = btn.getBoundingClientRect();
            panel.style.right  = (window.innerWidth - rect.right) + 'px';
            panel.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
            panel.style.left   = 'auto';
            panel.style.top    = 'auto';
        }
        // Update selection sesuai tema chat aktif
        const current = _getTheme(_partnerId);
        _updateCardSelection(current);
        panel.classList.add('open');
        document.getElementById('themeToggleBtn')?.classList.add('active');
        _isOpen = true;
    }

    function _closePanel() {
        const panel = document.getElementById('themePicker');
        if (panel) panel.classList.remove('open');
        document.getElementById('themeToggleBtn')?.classList.remove('active');
        _isOpen = false;
    }

    function _togglePanel() {
        if (_isOpen) _closePanel();
        else          _openPanel();
    }

    function _onOutsideClick(e) {
        if (!_isOpen) return;
        const panel  = document.getElementById('themePicker');
        const toggle = document.getElementById('themeToggleBtn');
        if (!panel) return;
        if (!panel.contains(e.target) && e.target !== toggle && !toggle?.contains(e.target)) {
            _closePanel();
        }
    }

    // ── ON SELECT USER ────────────────────────────────────────
    function onSelectUser(partnerId) {
        _partnerId = partnerId;
        _closePanel();
        const theme = _getTheme(partnerId);
        _applyTheme(theme);
    }

    // ── INIT ─────────────────────────────────────────────────
    function init(myUid) {
        // myUid opsional — bisa dipasok langsung atau diambil dari window._myUid
        if (myUid)           _myUid = myUid;
        else if (window._myUid) _myUid = window._myUid;

        if (!_myUid) {
            // Tunggu UID tersedia
            const _wait = setInterval(() => {
                if (window._myUid) {
                    _myUid = window._myUid;
                    clearInterval(_wait);
                }
            }, 300);
        }

        // Pasang tombol toggle
        const btn = document.getElementById('themeToggleBtn');
        if (btn) {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                if (!_partnerId) return; // belum pilih chat
                _togglePanel();
            });
        }

        // Reset tema saat window resize (panel bisa geser)
        window.addEventListener('resize', () => {
            if (_isOpen) _closePanel();
        });

        console.log('[ThemeSystem] ✅ Initialized');
    }

    // ── PUBLIC ────────────────────────────────────────────────
    return {
        init,
        onSelectUser,
        getCurrentTheme: () => _getTheme(_partnerId),
        applyTheme: (t) => { _setTheme(_partnerId, t); _applyTheme(t); },
    };

})();

window.ThemeSystem = ThemeSystem;
