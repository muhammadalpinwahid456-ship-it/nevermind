/**
 * ============================================================
 *  CHAT MOBILE NAV  —  Instagram DM Layout Helper
 *  File: chat-mobile.js
 *
 *  Cara pakai:
 *  1. <link rel="stylesheet" href="chat-mobile.css">  (di <head>)
 *  2. <script src="chat-mobile.js" defer></script>   (sebelum </body>)
 *
 *  Script ini:
 *  - Handle slide sidebar ↔ chat-main di mobile (≤768px)
 *  - Inject bottom nav bar Instagram-style
 *  - Sync tombol back (.btn-close-chat) agar kembali ke DM list
 * ============================================================
 */

(function () {
    'use strict';

    // ── Cek mobile ───────────────────────────────────────────
    function isMobile() {
        return window.innerWidth <= 768;
    }

    // ── Selector helpers ─────────────────────────────────────
    const sel = (q) => document.querySelector(q);
    const selAll = (q) => document.querySelectorAll(q);

    // ── Buka chat (sembunyikan sidebar, tampilkan chat main) ──
    function openChat() {
        if (!isMobile()) return;
        sel('.chat-sidebar')?.classList.add('mobile-hidden');
        sel('.chat-main')?.classList.add('mobile-visible');
        sel('.chat-main')?.removeAttribute('style');
    }

    // ── Tutup chat (kembali ke DM list) ──────────────────────
    function closeChat() {
        if (!isMobile()) return;
        sel('.chat-sidebar')?.classList.remove('mobile-hidden');
        sel('.chat-main')?.classList.remove('mobile-visible');
    }

    // ── Reset layout desktop ──────────────────────────────────
    function resetDesktopLayout() {
        sel('.chat-sidebar')?.classList.remove('mobile-hidden');
        sel('.chat-main')?.classList.remove('mobile-visible');
    }

    // ── Inject bottom nav bar ─────────────────────────────────
    function injectNavBar() {
        if (document.getElementById('mobileNavBar')) return;

        const nav = document.createElement('div');
        nav.id = 'mobileNavBar';
        nav.innerHTML = `
            <button class="mobile-nav-btn active" id="mNavHome" title="Home">🏠</button>
            <button class="mobile-nav-btn" id="mNavReels" title="Reels">▶</button>
            <button class="mobile-nav-btn" id="mNavDM" title="DM" style="font-size:1.3rem">✉</button>
            <button class="mobile-nav-btn" id="mNavSearch" title="Cari">🔍</button>
            <button class="mobile-nav-btn" id="mNavProfile" title="Profil">👤</button>
        `;

        // Masukkan ke .chat-container (setelah .chat-wrapper)
        const container = sel('.chat-container') || document.body;
        container.appendChild(nav);

        // Active state
        nav.querySelectorAll('.mobile-nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                nav.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        // DM button → kembali ke daftar pesan
        document.getElementById('mNavDM')?.addEventListener('click', closeChat);
        document.getElementById('mNavHome')?.addEventListener('click', closeChat);
    }

    // ── Bind tombol back di chat header ──────────────────────
    function bindBackButton() {
        const backBtn = sel('.btn-close-chat');
        if (backBtn && !backBtn._mobileNavBound) {
            backBtn._mobileNavBound = true;
            backBtn.addEventListener('click', () => {
                if (isMobile()) closeChat();
            });
        }
    }

    // ── Bind user-item click (override dengan slide) ─────────
    function bindUserItems() {
        selAll('.user-item').forEach(item => {
            if (item._mobileBound) return;
            item._mobileBound = true;
            item.addEventListener('click', () => {
                if (isMobile()) openChat();
            });
        });
    }

    // ── MutationObserver: tangkap user-item baru dari Firebase ──
    const observer = new MutationObserver(() => {
        if (isMobile()) bindUserItems();
    });

    function startObserver() {
        const list = sel('.users-list') || sel('#usersList') || sel('.chat-sidebar');
        if (list) {
            observer.observe(list, { childList: true, subtree: true });
        }
    }

    // ── Init ──────────────────────────────────────────────────
    function init() {
        if (isMobile()) {
            injectNavBar();
            bindBackButton();
            bindUserItems();
            startObserver();
        }
    }

    // Jalankan setelah DOM siap
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
        // Delay sedikit agar Firebase selesai render user list
        setTimeout(() => { if (isMobile()) bindUserItems(); }, 1200);
    }

    // Re-init saat resize (desktop ↔ mobile)
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (isMobile()) {
                injectNavBar();
                bindBackButton();
                bindUserItems();
            } else {
                resetDesktopLayout();
                document.getElementById('mobileNavBar')?.remove();
            }
        }, 200);
    });

    // Expose untuk dipakai manual jika perlu
    window.MobileNav = { openChat, closeChat };

})();
