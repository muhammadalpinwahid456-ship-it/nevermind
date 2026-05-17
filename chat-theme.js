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
        _applyIllustration(theme);
    }

    // ── ILLUSTRATION INJECTION ────────────────────────────────
    let _illustResizeObs = null;

    function _applyIllustration(theme) {
        const old = document.getElementById('themeIllustration');
        if (old) old.remove();
        if (_illustResizeObs) { _illustResizeObs.disconnect(); _illustResizeObs = null; }

        if (theme === DEFAULT) return;

        // Inject ke .chat-window agar tidak ikut scroll messages-area
        const cw = document.querySelector('.chat-window') ||
                   document.getElementById('chatWindow');
        if (!cw) return;

        const area = document.getElementById('messagesArea') ||
                     document.querySelector('.messages-area');

        const el = document.createElement('div');
        el.id = 'themeIllustration';
        el.innerHTML = _getSVG(theme);

        function _positionIllus() {
            if (!area) return;
            const cwRect   = cw.getBoundingClientRect();
            const areaRect = area.getBoundingClientRect();
            el.style.top    = (areaRect.top  - cwRect.top)  + 'px';
            el.style.left   = (areaRect.left - cwRect.left) + 'px';
            el.style.width  = areaRect.width  + 'px';
            el.style.height = areaRect.height + 'px';
        }

        cw.appendChild(el);
        _positionIllus();

        _illustResizeObs = new ResizeObserver(_positionIllus);
        _illustResizeObs.observe(cw);
        if (area) _illustResizeObs.observe(area);
    }

    function _getSVG(theme) {
        const svgs = {

            /* ─────────────── SUNSET ─────────────── */
            sunset: `<svg viewBox="0 0 400 700" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
  <!-- Gradasi langit senja -->
  <defs>
    <radialGradient id="sunGlow" cx="50%" cy="72%" r="35%">
      <stop offset="0%" stop-color="#ffdd88" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#ff6b9d" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="sunCore" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffe066" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#ff9a56" stop-opacity="0.3"/>
    </radialGradient>
  </defs>

  <!-- Cahaya matahari -->
  <ellipse cx="200" cy="500" rx="160" ry="90" fill="url(#sunGlow)"/>
  <!-- Matahari -->
  <circle cx="200" cy="500" r="34" fill="url(#sunCore)" style="animation:sunsetPulse 3.5s ease-in-out infinite"/>

  <!-- Ray matahari -->
  <g opacity="0.28" style="transform-origin:200px 500px; animation:sunsetPulse 3.5s ease-in-out infinite">
    <line x1="200" y1="460" x2="200" y2="430" stroke="#ffe066" stroke-width="2" stroke-linecap="round"/>
    <line x1="224" y1="476" x2="244" y2="460" stroke="#ffe066" stroke-width="2" stroke-linecap="round"/>
    <line x1="224" y1="524" x2="244" y2="540" stroke="#ffe066" stroke-width="2" stroke-linecap="round"/>
    <line x1="200" y1="540" x2="200" y2="570" stroke="#ffe066" stroke-width="2" stroke-linecap="round"/>
    <line x1="176" y1="524" x2="156" y2="540" stroke="#ffe066" stroke-width="2" stroke-linecap="round"/>
    <line x1="176" y1="476" x2="156" y2="460" stroke="#ffe066" stroke-width="2" stroke-linecap="round"/>
  </g>

  <!-- Awan 1 -->
  <g style="animation:cloudDrift 7s ease-in-out infinite alternate">
    <ellipse cx="100" cy="180" rx="55" ry="22" fill="rgba(255,200,180,0.35)"/>
    <ellipse cx="130" cy="168" rx="38" ry="18" fill="rgba(255,160,140,0.3)"/>
    <ellipse cx="72"  cy="175" rx="30" ry="16" fill="rgba(255,200,180,0.25)"/>
  </g>
  <!-- Awan 2 -->
  <g style="animation:cloudDrift 9s ease-in-out infinite alternate-reverse">
    <ellipse cx="310" cy="240" rx="62" ry="24" fill="rgba(255,180,200,0.3)"/>
    <ellipse cx="340" cy="228" rx="42" ry="19" fill="rgba(200,100,160,0.2)"/>
    <ellipse cx="282" cy="236" rx="34" ry="17" fill="rgba(255,180,200,0.22)"/>
  </g>
  <!-- Awan 3 kecil -->
  <g style="animation:cloudDrift 11s ease-in-out infinite alternate">
    <ellipse cx="200" cy="120" rx="44" ry="16" fill="rgba(255,220,180,0.22)"/>
    <ellipse cx="220" cy="112" rx="28" ry="13" fill="rgba(255,180,140,0.18)"/>
  </g>

  <!-- Bintang kecil -->
  <circle cx="60"  cy="80"  r="2" fill="#fff" opacity="0.7" style="animation:starTwinkle 2.1s ease-in-out infinite"/>
  <circle cx="150" cy="55"  r="1.5" fill="#fff" opacity="0.5" style="animation:starTwinkle 3.2s ease-in-out infinite 0.5s"/>
  <circle cx="310" cy="70"  r="2" fill="#fff" opacity="0.6" style="animation:starTwinkle 2.7s ease-in-out infinite 1s"/>
  <circle cx="350" cy="130" r="1.5" fill="#fff" opacity="0.5" style="animation:starTwinkle 4s ease-in-out infinite 0.3s"/>
  <circle cx="30"  cy="160" r="1.5" fill="#fff" opacity="0.4" style="animation:starTwinkle 2.8s ease-in-out infinite 1.5s"/>

  <!-- Siluet bukit/gunung -->
  <path d="M0,620 Q60,540 130,580 Q180,560 220,520 Q270,555 330,545 Q370,560 400,590 L400,700 L0,700Z"
        fill="rgba(80,20,40,0.55)"/>
  <path d="M0,660 Q80,620 160,640 Q230,625 300,635 Q350,628 400,645 L400,700 L0,700Z"
        fill="rgba(60,10,30,0.65)"/>

  <!-- Burung kecil -->
  <g opacity="0.6" style="animation:sunsetFloat1 5s ease-in-out infinite">
    <path d="M80,300 Q88,294 96,300" stroke="#ff9a56" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    <path d="M100,298 Q108,292 116,298" stroke="#ff9a56" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  </g>
  <g opacity="0.5" style="animation:sunsetFloat2 6.5s ease-in-out infinite 1s">
    <path d="M260,260 Q268,254 276,260" stroke="#ffc4e8" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    <path d="M280,258 Q288,252 296,258" stroke="#ffc4e8" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  </g>
</svg>`,

            /* ─────────────── OCEAN ─────────────── */
            ocean: `<svg viewBox="0 0 400 700" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
  <defs>
    <radialGradient id="depthGlow" cx="50%" cy="100%" r="60%">
      <stop offset="0%" stop-color="#00bcd4" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#0d47a1" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- Cahaya bawah laut -->
  <ellipse cx="200" cy="700" rx="200" ry="120" fill="url(#depthGlow)"/>

  <!-- Gelombang berlapis (SVG wave shapes) -->
  <g style="animation:waveMove 8s linear infinite" opacity="0.18">
    <path d="M-400,420 Q-340,400 -280,420 Q-220,440 -160,420 Q-100,400 -40,420 Q20,440 80,420 Q140,400 200,420 Q260,440 320,420 Q380,400 440,420 Q500,440 560,420 Q620,400 680,420 Q740,440 800,420 L800,700 L-400,700Z"
          fill="#29b6f6"/>
  </g>
  <g style="animation:waveMove 12s linear infinite reverse" opacity="0.12">
    <path d="M-400,460 Q-320,438 -240,460 Q-160,482 -80,460 Q0,438 80,460 Q160,482 240,460 Q320,438 400,460 Q480,482 560,460 Q640,438 720,460 Q800,482 880,460 L880,700 L-400,700Z"
          fill="#0288d1"/>
  </g>

  <!-- Ikan berenang -->
  <g style="animation:fishSwim 12s linear infinite">
    <ellipse cx="30" cy="380" rx="18" ry="9" fill="rgba(255,200,80,0.75)"/>
    <polygon points="10,380 -4,370 -4,390" fill="rgba(255,180,60,0.75)"/>
    <circle cx="38" cy="377" r="2.5" fill="rgba(0,0,0,0.5)"/>
    <line x1="12" y1="380" x2="28" y2="374" stroke="rgba(200,150,50,0.4)" stroke-width="0.8"/>
    <line x1="12" y1="380" x2="28" y2="386" stroke="rgba(200,150,50,0.4)" stroke-width="0.8"/>
  </g>
  <!-- Ikan kecil ke kiri -->
  <g style="animation:fishSwim 17s linear infinite 6s reverse">
    <ellipse cx="370" cy="280" rx="12" ry="6" fill="rgba(165,214,167,0.8)"/>
    <polygon points="383,280 393,274 393,286" fill="rgba(129,199,132,0.8)"/>
    <circle cx="362" cy="278" r="1.8" fill="rgba(0,0,0,0.5)"/>
  </g>

  <!-- Gelembung naik -->
  <circle cx="80"  cy="600" r="5" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1"
    style="animation:bubbleRise 5s ease-in infinite"/>
  <circle cx="200" cy="620" r="3.5" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1"
    style="animation:bubbleRise 7s ease-in infinite 2s"/>
  <circle cx="310" cy="590" r="4" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1"
    style="animation:bubbleRise 6s ease-in infinite 1s"/>
  <circle cx="150" cy="640" r="2.5" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="0.8"
    style="animation:bubbleRise 8s ease-in infinite 3s"/>
  <circle cx="340" cy="660" r="3" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="0.8"
    style="animation:bubbleRise 5.5s ease-in infinite 4s"/>

  <!-- Rumput laut / Karang -->
  <g style="animation:seaweedSway 3s ease-in-out infinite; transform-origin:60px 700px">
    <path d="M60,700 Q52,660 60,640 Q68,620 58,600" stroke="rgba(67,160,71,0.6)" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path d="M60,680 Q50,665 42,650" stroke="rgba(67,160,71,0.5)" stroke-width="3" fill="none" stroke-linecap="round"/>
  </g>
  <g style="animation:seaweedSway 4s ease-in-out infinite 1s; transform-origin:330px 700px">
    <path d="M330,700 Q322,655 330,630 Q338,605 328,580" stroke="rgba(67,160,71,0.55)" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path d="M330,670 Q316,650 308,635" stroke="rgba(67,160,71,0.45)" stroke-width="3" fill="none" stroke-linecap="round"/>
  </g>
  <g style="animation:seaweedSway 3.5s ease-in-out infinite 0.5s; transform-origin:180px 700px">
    <path d="M180,700 Q174,670 180,650 Q186,630 178,612" stroke="rgba(100,200,100,0.45)" stroke-width="3" fill="none" stroke-linecap="round"/>
  </g>

  <!-- Karang bintang -->
  <g opacity="0.5">
    <polygon points="240,680 245,665 250,680 265,680 253,690 258,705 240,695 222,705 227,690 215,680"
             fill="rgba(255,180,60,0.6)"/>
    <polygon points="130,690 133,680 137,690 147,690 139,697 142,707 130,700 118,707 121,697 113,690"
             fill="rgba(255,120,60,0.5)"/>
  </g>

  <!-- Cahaya dari atas (sinar matahari masuk air) -->
  <line x1="140" y1="0" x2="100" y2="350" stroke="rgba(255,255,255,0.06)" stroke-width="18"/>
  <line x1="220" y1="0" x2="200" y2="400" stroke="rgba(255,255,255,0.04)" stroke-width="25"/>
  <line x1="300" y1="0" x2="320" y2="380" stroke="rgba(255,255,255,0.05)" stroke-width="15"/>
</svg>`,

            /* ─────────────── MIDNIGHT ─────────────── */
            midnight: `<svg viewBox="0 0 400 700" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
  <defs>
    <radialGradient id="nebulaA" cx="30%" cy="25%" r="40%">
      <stop offset="0%" stop-color="#7c3aed" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#4f46e5" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="nebulaB" cx="75%" cy="60%" r="35%">
      <stop offset="0%" stop-color="#0d1b4b" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#7c3aed" stop-opacity="0"/>
    </radialGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- Nebula -->
  <ellipse cx="120" cy="175" rx="160" ry="100" fill="url(#nebulaA)"
    style="animation:fogDrift 9s ease-in-out infinite"/>
  <ellipse cx="300" cy="420" rx="140" ry="90" fill="url(#nebulaB)"
    style="animation:fogDrift 12s ease-in-out infinite 3s"/>

  <!-- Bulan -->
  <circle cx="310" cy="120" r="38" fill="#fffde7" opacity="0.88"
    style="animation:moonGlow 4s ease-in-out infinite" filter="url(#glow)"/>
  <!-- Shadow bulan (sabit) -->
  <circle cx="325" cy="113" r="36" fill="#0d1b4b" opacity="0.88"/>

  <!-- Planet kecil mengorbit bulan -->
  <g style="transform-origin:310px 120px; animation:planetOrbit 18s linear infinite">
    <circle cx="310" cy="78" r="5" fill="#c4b5fd" opacity="0.7" filter="url(#glow)"/>
  </g>

  <!-- Bintang besar + bersinar -->
  <circle cx="60"  cy="90"  r="2.5" fill="#fff" style="animation:starTwinkle 1.8s ease-in-out infinite"/>
  <circle cx="160" cy="60"  r="2"   fill="#c4b5fd" style="animation:starTwinkle 2.4s ease-in-out infinite 0.4s"/>
  <circle cx="230" cy="45"  r="1.8" fill="#fff" style="animation:starTwinkle 3.1s ease-in-out infinite 0.9s"/>
  <circle cx="80"  cy="200" r="1.5" fill="#c4b5fd" style="animation:starTwinkle2 2.2s ease-in-out infinite 0.2s"/>
  <circle cx="360" cy="80"  r="2.2" fill="#fff" style="animation:starTwinkle 1.9s ease-in-out infinite 1.2s"/>
  <circle cx="370" cy="180" r="1.5" fill="#a5b4fc" style="animation:starTwinkle2 2.8s ease-in-out infinite"/>
  <circle cx="40"  cy="320" r="2"   fill="#fff" style="animation:starTwinkle 2.6s ease-in-out infinite 0.7s"/>
  <circle cx="290" cy="300" r="1.8" fill="#c4b5fd" style="animation:starTwinkle 3.4s ease-in-out infinite 0.3s"/>
  <circle cx="140" cy="400" r="1.5" fill="#fff" style="animation:starTwinkle2 2s ease-in-out infinite 1.5s"/>
  <circle cx="380" cy="350" r="2"   fill="#a5b4fc" style="animation:starTwinkle 3s ease-in-out infinite 0.6s"/>
  <circle cx="110" cy="500" r="1.5" fill="#fff" style="animation:starTwinkle 2.3s ease-in-out infinite 1.1s"/>
  <circle cx="330" cy="470" r="1.8" fill="#c4b5fd" style="animation:starTwinkle2 2.7s ease-in-out infinite 0.8s"/>
  <circle cx="200" cy="550" r="1.5" fill="#fff" style="animation:starTwinkle 1.7s ease-in-out infinite 0.5s"/>

  <!-- Bintang kecil latar -->
  <circle cx="20" cy="50" r="1" fill="#fff" opacity="0.4"/>
  <circle cx="185" cy="150" r="1" fill="#fff" opacity="0.35"/>
  <circle cx="250" cy="200" r="0.8" fill="#c4b5fd" opacity="0.4"/>
  <circle cx="350" cy="250" r="1" fill="#fff" opacity="0.3"/>
  <circle cx="75" cy="440" r="0.8" fill="#fff" opacity="0.35"/>
  <circle cx="420" cy="530" r="1" fill="#c4b5fd" opacity="0.3"/>

  <!-- Komet -->
  <line x1="30" y1="30" x2="130" y2="130"
    stroke="rgba(200,180,255,0.7)" stroke-width="1.5" stroke-linecap="round"
    stroke-dasharray="80" stroke-dashoffset="80"
    style="animation:cometShoot 7s ease-in-out infinite"/>
  <line x1="250" y1="400" x2="340" y2="490"
    stroke="rgba(200,180,255,0.5)" stroke-width="1" stroke-linecap="round"
    stroke-dasharray="60" stroke-dashoffset="60"
    style="animation:cometShoot 10s ease-in-out infinite 3.5s"/>

  <!-- Siluet bangunan/kota bawah -->
  <rect x="0"   y="620" width="40"  height="80" fill="rgba(10,5,30,0.7)" rx="2"/>
  <rect x="45"  y="590" width="30"  height="110" fill="rgba(10,5,30,0.65)" rx="2"/>
  <rect x="80"  y="640" width="50"  height="60" fill="rgba(10,5,30,0.6)" rx="2"/>
  <rect x="135" y="610" width="35"  height="90" fill="rgba(10,5,30,0.65)" rx="2"/>
  <rect x="175" y="650" width="45"  height="50" fill="rgba(10,5,30,0.6)" rx="2"/>
  <rect x="225" y="600" width="30"  height="100" fill="rgba(10,5,30,0.7)" rx="2"/>
  <rect x="260" y="630" width="55"  height="70" fill="rgba(10,5,30,0.6)" rx="2"/>
  <rect x="320" y="615" width="35"  height="85" fill="rgba(10,5,30,0.65)" rx="2"/>
  <rect x="360" y="645" width="40"  height="55" fill="rgba(10,5,30,0.6)" rx="2"/>
  <!-- Lampu jendela -->
  <rect x="52"  cy="610" x="52" y="610" width="5" height="4" fill="rgba(255,240,150,0.35)" rx="1"/>
  <rect x="62"  cy="625" x="62" y="625" width="5" height="4" fill="rgba(255,240,150,0.3)" rx="1"/>
  <rect x="230" cy="620" x="230" y="620" width="5" height="4" fill="rgba(255,240,150,0.35)" rx="1"/>
  <rect x="328" cy="635" x="328" y="635" width="5" height="4" fill="rgba(255,240,150,0.3)" rx="1"/>
</svg>`,

            /* ─────────────── FOREST ─────────────── */
            forest: `<svg viewBox="0 0 400 700" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
  <defs>
    <radialGradient id="forestLight" cx="50%" cy="20%" r="50%">
      <stop offset="0%" stop-color="#a5d6a7" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#1b5e20" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- Cahaya dari atas -->
  <ellipse cx="200" cy="0" rx="180" ry="120" fill="url(#forestLight)"/>

  <!-- Pohon besar kiri -->
  <g>
    <rect x="30" y="480" width="18" height="220" fill="rgba(30,20,10,0.55)" rx="4"/>
    <!-- Daun pohon -->
    <ellipse cx="39" cy="460" rx="55" ry="70" fill="rgba(27,94,32,0.55)"/>
    <ellipse cx="39" cy="430" rx="42" ry="55" fill="rgba(46,125,50,0.5)"/>
    <ellipse cx="39" cy="410" rx="30" ry="40" fill="rgba(67,160,71,0.45)"/>
  </g>
  <!-- Pohon besar kanan -->
  <g>
    <rect x="352" y="500" width="16" height="200" fill="rgba(30,20,10,0.55)" rx="4"/>
    <ellipse cx="360" cy="480" rx="50" ry="65" fill="rgba(27,94,32,0.5)"/>
    <ellipse cx="360" cy="452" rx="38" ry="52" fill="rgba(46,125,50,0.45)"/>
    <ellipse cx="360" cy="432" rx="28" ry="38" fill="rgba(67,160,71,0.4)"/>
  </g>
  <!-- Pohon kecil tengah kanan -->
  <g>
    <rect x="272" y="560" width="12" height="140" fill="rgba(30,20,10,0.4)" rx="3"/>
    <ellipse cx="278" cy="545" rx="35" ry="48" fill="rgba(33,113,36,0.45)"/>
    <ellipse cx="278" cy="520" rx="25" ry="36" fill="rgba(56,142,60,0.4)"/>
  </g>

  <!-- Semak bawah -->
  <ellipse cx="80" cy="685" rx="60" ry="28" fill="rgba(27,94,32,0.5)"/>
  <ellipse cx="200" cy="695" rx="80" ry="22" fill="rgba(46,125,50,0.4)"/>
  <ellipse cx="330" cy="688" rx="55" ry="25" fill="rgba(27,94,32,0.45)"/>

  <!-- Kabut hutan -->
  <ellipse cx="200" cy="650" rx="240" ry="55"
    fill="rgba(200,230,200,0.1)" style="animation:fogDrift 10s ease-in-out infinite"/>
  <ellipse cx="200" cy="600" rx="220" ry="40"
    fill="rgba(200,230,200,0.07)" style="animation:fogDrift 13s ease-in-out infinite 2s"/>

  <!-- Daun jatuh -->
  <g style="animation:leafFall1 6s linear infinite; transform-origin:120px 0">
    <ellipse cx="120" cy="80" rx="7" ry="4" fill="rgba(129,199,132,0.75)" transform="rotate(-20,120,80)"/>
  </g>
  <g style="animation:leafFall2 8s linear infinite 1.5s; transform-origin:250px 0">
    <ellipse cx="250" cy="60" rx="6" ry="3.5" fill="rgba(165,214,167,0.7)" transform="rotate(30,250,60)"/>
  </g>
  <g style="animation:leafFall1 7s linear infinite 3s; transform-origin:90px 0">
    <ellipse cx="90" cy="150" rx="5" ry="3" fill="rgba(200,230,150,0.65)" transform="rotate(15,90,150)"/>
  </g>
  <g style="animation:leafFall2 9s linear infinite 0.8s; transform-origin:310px 0">
    <ellipse cx="310" cy="100" rx="7" ry="4" fill="rgba(100,180,80,0.6)" transform="rotate(-30,310,100)"/>
  </g>
  <g style="animation:leafFall1 5.5s linear infinite 2s; transform-origin:190px 0">
    <ellipse cx="190" cy="180" rx="6" ry="3.5" fill="rgba(150,220,120,0.65)" transform="rotate(40,190,180)"/>
  </g>

  <!-- Kunang-kunang -->
  <circle cx="170" cy="400" r="3" fill="#ccff90" opacity="0.7"
    style="animation:firefly 3.5s ease-in-out infinite" filter="url(#glow)"/>
  <circle cx="240" cy="350" r="2.5" fill="#b9f6ca" opacity="0.6"
    style="animation:firefly 4.2s ease-in-out infinite 1s"/>
  <circle cx="130" cy="500" r="2.5" fill="#ccff90" opacity="0.65"
    style="animation:firefly 3.8s ease-in-out infinite 2s"/>
  <circle cx="290" cy="450" r="2" fill="#b9f6ca" opacity="0.55"
    style="animation:firefly 5s ease-in-out infinite 0.5s"/>
  <circle cx="200" cy="300" r="2" fill="#e8f5e9" opacity="0.5"
    style="animation:firefly 4.5s ease-in-out infinite 1.8s"/>

  <!-- Sinar matahari menerobos pohon -->
  <line x1="150" y1="0" x2="100" y2="300" stroke="rgba(255,255,200,0.07)" stroke-width="30"/>
  <line x1="250" y1="0" x2="260" y2="350" stroke="rgba(255,255,200,0.05)" stroke-width="20"/>

  <!-- Daun latar -->
  <ellipse cx="200" cy="350" rx="180" ry="40"
    fill="rgba(46,125,50,0.06)" style="animation:leafSway 5s ease-in-out infinite"/>
</svg>`,

            /* ─────────────── ROSEGOLD ─────────────── */
            rosegold: `<svg viewBox="0 0 400 700" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
  <defs>
    <radialGradient id="roseGlow" cx="50%" cy="40%" r="50%">
      <stop offset="0%" stop-color="#f48fb1" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#880e4f" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- Cahaya tengah -->
  <ellipse cx="200" cy="280" rx="180" ry="160" fill="url(#roseGlow)"/>

  <!-- Hati besar latar, melayang -->
  <g style="animation:heartPulse 4s ease-in-out infinite; transform-origin:200px 320px">
    <path d="M200,360 C200,360 140,310 140,270 C140,245 158,230 180,240 C190,245 200,258 200,258 C200,258 210,245 220,240 C242,230 260,245 260,270 C260,310 200,360 200,360Z"
          fill="rgba(244,143,177,0.12)"/>
  </g>
  <!-- Hati medium -->
  <g style="animation:heartPulse 3.2s ease-in-out infinite 0.8s; transform-origin:100px 500px">
    <path d="M100,530 C100,530 72,508 72,490 C72,478 82,470 93,475 C97,477 100,483 100,483 C100,483 103,477 107,475 C118,470 128,478 128,490 C128,508 100,530 100,530Z"
          fill="rgba(240,98,146,0.15)"/>
  </g>
  <g style="animation:heartPulse 5s ease-in-out infinite 1.5s; transform-origin:320px 200px">
    <path d="M320,230 C320,230 298,210 298,194 C298,183 307,176 316,181 C319,183 320,188 320,188 C320,188 321,183 324,181 C333,176 342,183 342,194 C342,210 320,230 320,230Z"
          fill="rgba(244,143,177,0.18)"/>
  </g>

  <!-- Kelopak bunga jatuh -->
  <g style="animation:petalFloat 7s linear infinite; transform-origin:80px 0">
    <ellipse cx="80" cy="60" rx="10" ry="6" fill="rgba(244,143,177,0.7)" transform="rotate(-20,80,60)"/>
  </g>
  <g style="animation:petalFloat 9s linear infinite 2s; transform-origin:200px 0">
    <ellipse cx="200" cy="40" rx="9" ry="5.5" fill="rgba(240,98,146,0.65)" transform="rotate(15,200,40)"/>
  </g>
  <g style="animation:petalFloat 6.5s linear infinite 1s; transform-origin:300px 0">
    <ellipse cx="300" cy="80" rx="8" ry="5" fill="rgba(248,187,208,0.7)" transform="rotate(-35,300,80)"/>
  </g>
  <g style="animation:petalFloat 8s linear infinite 3.5s; transform-origin:140px 0">
    <ellipse cx="140" cy="120" rx="10" ry="6" fill="rgba(244,143,177,0.6)" transform="rotate(25,140,120)"/>
  </g>
  <g style="animation:petalFloat 10s linear infinite 0.5s; transform-origin:340px 0">
    <ellipse cx="340" cy="50" rx="8" ry="4.5" fill="rgba(240,98,146,0.6)" transform="rotate(-10,340,50)"/>
  </g>
  <g style="animation:petalFloat 7.5s linear infinite 4s; transform-origin:260px 0">
    <ellipse cx="260" cy="160" rx="9" ry="5.5" fill="rgba(248,187,208,0.65)" transform="rotate(40,260,160)"/>
  </g>

  <!-- Kilap / sparkle -->
  <g style="animation:sparkle 2.5s ease-in-out infinite; transform-origin:150px 250px">
    <line x1="146" y1="250" x2="154" y2="250" stroke="#f8bbd0" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="150" y1="246" x2="150" y2="254" stroke="#f8bbd0" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="147" y1="247" x2="153" y2="253" stroke="#f8bbd0" stroke-width="1" stroke-linecap="round"/>
    <line x1="153" y1="247" x2="147" y2="253" stroke="#f8bbd0" stroke-width="1" stroke-linecap="round"/>
  </g>
  <g style="animation:sparkle 3.2s ease-in-out infinite 1s; transform-origin:300px 400px">
    <line x1="296" y1="400" x2="304" y2="400" stroke="#ffcdd2" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="300" y1="396" x2="300" y2="404" stroke="#ffcdd2" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="297" y1="397" x2="303" y2="403" stroke="#ffcdd2" stroke-width="1" stroke-linecap="round"/>
    <line x1="303" y1="397" x2="297" y2="403" stroke="#ffcdd2" stroke-width="1" stroke-linecap="round"/>
  </g>
  <g style="animation:sparkle 2s ease-in-out infinite 1.8s; transform-origin:70px 380px">
    <line x1="66" y1="380" x2="74" y2="380" stroke="#f48fb1" stroke-width="1.2" stroke-linecap="round"/>
    <line x1="70" y1="376" x2="70" y2="384" stroke="#f48fb1" stroke-width="1.2" stroke-linecap="round"/>
  </g>
  <g style="animation:sparkle 3.8s ease-in-out infinite 0.5s; transform-origin:360px 150px">
    <line x1="356" y1="150" x2="364" y2="150" stroke="#f8bbd0" stroke-width="1.2" stroke-linecap="round"/>
    <line x1="360" y1="146" x2="360" y2="154" stroke="#f8bbd0" stroke-width="1.2" stroke-linecap="round"/>
  </g>

  <!-- Bunga mawar sederhana pojok -->
  <g opacity="0.35" style="animation:ribbonFloat 6s ease-in-out infinite; transform-origin:340px 620px">
    <circle cx="340" cy="620" r="18" fill="rgba(194,24,91,0.3)" stroke="rgba(244,143,177,0.4)" stroke-width="1"/>
    <circle cx="340" cy="620" r="10" fill="rgba(233,30,99,0.25)"/>
    <circle cx="340" cy="620" r="5"  fill="rgba(244,143,177,0.35)"/>
    <path d="M322,610 Q330,602 340,608 Q334,595 340,586 Q346,595 340,608 Q350,602 358,610" stroke="rgba(244,143,177,0.4)" stroke-width="1.2" fill="none"/>
  </g>

  <!-- Butiran manik / dot dekoratif -->
  <circle cx="50"  cy="200" r="2.5" fill="rgba(244,143,177,0.45)" style="animation:heartPulse 3s ease-in-out infinite"/>
  <circle cx="370" cy="450" r="2"   fill="rgba(240,98,146,0.4)"   style="animation:heartPulse 4s ease-in-out infinite 1s"/>
  <circle cx="100" cy="600" r="2"   fill="rgba(248,187,208,0.45)" style="animation:heartPulse 3.5s ease-in-out infinite 0.5s"/>
  <circle cx="350" cy="300" r="1.8" fill="rgba(244,143,177,0.4)"  style="animation:heartPulse 2.8s ease-in-out infinite 2s"/>
</svg>`,

            /* ─────────────── MONO ─────────────── */
            mono: `<svg viewBox="0 0 400 700" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
  <!-- Garis scan halus -->
  <rect x="0" y="0" width="400" height="700"
    fill="none" stroke="rgba(255,255,255,0.015)" stroke-width="0"/>
  <!-- Scan line bergerak -->
  <rect x="0" y="0" width="400" height="120"
    fill="rgba(255,255,255,0.03)"
    style="animation:monoScan 8s linear infinite"/>

  <!-- Grid dot latar -->
  <g opacity="0.12">
    <circle cx="40"  cy="80"  r="1.5" style="animation:monoBlink 3s ease-in-out infinite"/>
    <circle cx="120" cy="80"  r="1.5" style="animation:monoBlink 3s ease-in-out infinite 0.4s"/>
    <circle cx="200" cy="80"  r="1.5" style="animation:monoBlink 3s ease-in-out infinite 0.8s"/>
    <circle cx="280" cy="80"  r="1.5" style="animation:monoBlink 3s ease-in-out infinite 1.2s"/>
    <circle cx="360" cy="80"  r="1.5" style="animation:monoBlink 3s ease-in-out infinite 1.6s"/>

    <circle cx="40"  cy="200" r="1.5" style="animation:monoBlink 3.5s ease-in-out infinite 0.2s"/>
    <circle cx="120" cy="200" r="1.5" style="animation:monoBlink 3.5s ease-in-out infinite 0.6s"/>
    <circle cx="200" cy="200" r="1.5" style="animation:monoBlink 3.5s ease-in-out infinite 1s"/>
    <circle cx="280" cy="200" r="1.5" style="animation:monoBlink 3.5s ease-in-out infinite 1.4s"/>
    <circle cx="360" cy="200" r="1.5" style="animation:monoBlink 3.5s ease-in-out infinite 1.8s"/>

    <circle cx="40"  cy="320" r="1.5" style="animation:monoBlink 4s ease-in-out infinite 0.1s"/>
    <circle cx="120" cy="320" r="1.5" style="animation:monoBlink 4s ease-in-out infinite 0.5s"/>
    <circle cx="200" cy="320" r="1.5" style="animation:monoBlink 4s ease-in-out infinite 0.9s"/>
    <circle cx="280" cy="320" r="1.5" style="animation:monoBlink 4s ease-in-out infinite 1.3s"/>
    <circle cx="360" cy="320" r="1.5" style="animation:monoBlink 4s ease-in-out infinite 1.7s"/>

    <circle cx="40"  cy="440" r="1.5" style="animation:monoBlink 3.2s ease-in-out infinite 0.3s"/>
    <circle cx="120" cy="440" r="1.5" style="animation:monoBlink 3.2s ease-in-out infinite 0.7s"/>
    <circle cx="200" cy="440" r="1.5" style="animation:monoBlink 3.2s ease-in-out infinite 1.1s"/>
    <circle cx="280" cy="440" r="1.5" style="animation:monoBlink 3.2s ease-in-out infinite 1.5s"/>
    <circle cx="360" cy="440" r="1.5" style="animation:monoBlink 3.2s ease-in-out infinite 1.9s"/>

    <circle cx="40"  cy="560" r="1.5" style="animation:monoBlink 3.8s ease-in-out infinite 0.25s"/>
    <circle cx="120" cy="560" r="1.5" style="animation:monoBlink 3.8s ease-in-out infinite 0.65s"/>
    <circle cx="200" cy="560" r="1.5" style="animation:monoBlink 3.8s ease-in-out infinite 1.05s"/>
    <circle cx="280" cy="560" r="1.5" style="animation:monoBlink 3.8s ease-in-out infinite 1.45s"/>
    <circle cx="360" cy="560" r="1.5" style="animation:monoBlink 3.8s ease-in-out infinite 1.85s"/>
  </g>

  <!-- Bentuk geometris mengambang -->
  <rect x="50" y="150" width="40" height="40" rx="4"
    fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1.5"
    style="animation:monoFloat 6s ease-in-out infinite"/>
  <rect x="300" y="280" width="32" height="32" rx="4"
    fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"
    style="animation:monoFloat 8s ease-in-out infinite 2s"/>
  <rect x="170" y="480" width="36" height="36" rx="4"
    fill="none" stroke="rgba(255,255,255,0.09)" stroke-width="1.5"
    style="animation:monoFloat 7s ease-in-out infinite 1s"/>

  <!-- Lingkaran geometris -->
  <circle cx="320" cy="150" r="28"
    fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"
    style="animation:monoFloat 9s ease-in-out infinite 3s"/>
  <circle cx="80" cy="420" r="22"
    fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="1.5"
    style="animation:monoFloat 7.5s ease-in-out infinite 1.5s"/>
  <circle cx="220" cy="600" r="18"
    fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"
    style="animation:monoFloat 6.5s ease-in-out infinite 0.8s"/>

  <!-- Garis diagonal tipis -->
  <line x1="0" y1="0" x2="400" y2="700"
    stroke="rgba(255,255,255,0.025)" stroke-width="1"/>
  <line x1="400" y1="0" x2="0" y2="700"
    stroke="rgba(255,255,255,0.02)" stroke-width="1"/>

  <!-- Segitiga outline -->
  <polygon points="200,100 240,170 160,170"
    fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1.5"
    style="animation:monoFloat 10s ease-in-out infinite 4s"/>
  <polygon points="340,500 368,548 312,548"
    fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="1.2"
    style="animation:monoFloat 8.5s ease-in-out infinite 2.5s"/>

  <!-- Tanda plus kecil -->
  <g opacity="0.12" style="animation:monoBlink 4s ease-in-out infinite">
    <line x1="145" y1="340" x2="155" y2="340" stroke="#fff" stroke-width="1.5"/>
    <line x1="150" y1="335" x2="150" y2="345" stroke="#fff" stroke-width="1.5"/>
  </g>
  <g opacity="0.1" style="animation:monoBlink 5s ease-in-out infinite 1.5s">
    <line x1="255" y1="220" x2="265" y2="220" stroke="#fff" stroke-width="1.5"/>
    <line x1="260" y1="215" x2="260" y2="225" stroke="#fff" stroke-width="1.5"/>
  </g>
  <g opacity="0.1" style="animation:monoBlink 3.5s ease-in-out infinite 0.7s">
    <line x1="65" y1="560" x2="75" y2="560" stroke="#fff" stroke-width="1.5"/>
    <line x1="70" y1="555" x2="70" y2="565" stroke="#fff" stroke-width="1.5"/>
  </g>
</svg>`,
        };

        return svgs[theme] || '';
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

            // Preview visual — background gradient + ilustrasi mini + bubble
            const preview = document.createElement('div');
            preview.className = 'theme-preview';
            preview.style.background = t.bg;

            // Ilustrasi mini (SVG dikecilkan dalam preview kartu)
            const miniIllu = document.createElement('div');
            miniIllu.className = 'theme-preview-illus';
            miniIllu.innerHTML = _getPreviewSVG(t.id);
            preview.appendChild(miniIllu);

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
        // Posisikan di bawah tombol toggle, rata kanan dengan tombol
        const btn = document.getElementById('themeToggleBtn');
        if (btn) {
            const rect = btn.getBoundingClientRect();
            // Panel muncul di BAWAH tombol
            const topPos = rect.bottom + 8;
            // Rata kanan: sisi kanan panel sejajar sisi kanan tombol
            const rightPos = window.innerWidth - rect.right;
            panel.style.top    = topPos + 'px';
            panel.style.right  = rightPos + 'px';
            panel.style.left   = 'auto';
            panel.style.bottom = 'auto';
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

        // MutationObserver: re-inject ilustrasi jika messages-area di-clear
        const _area = document.getElementById('messagesArea') ||
                      document.querySelector('.messages-area');
        if (_area) {
            const _obs = new MutationObserver(() => {
                if (_partnerId && !document.getElementById('themeIllustration')) {
                    const theme = _getTheme(_partnerId);
                    if (theme !== DEFAULT) _applyIllustration(theme);
                }
            });
            _obs.observe(_area, { childList: true });
        }

    } // end init

    // ── PREVIEW SVG (mini, untuk kartu picker) ────────────────
    function _getPreviewSVG(themeId) {
        const previews = {
            sunset: `<svg viewBox="0 0 100 130" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="50" cy="105" rx="38" ry="22" fill="rgba(255,220,100,0.35)"/>
  <circle cx="50" cy="105" r="14" fill="rgba(255,200,80,0.7)"/>
  <ellipse cx="20" cy="38" rx="22" ry="9" fill="rgba(255,180,160,0.3)"/>
  <ellipse cx="78" cy="55" rx="18" ry="8" fill="rgba(255,160,180,0.25)"/>
  <path d="M0,120 Q20,108 40,114 Q60,108 80,112 Q90,110 100,116 L100,130 L0,130Z" fill="rgba(80,15,35,0.55)"/>
  <circle cx="15" cy="18" r="1.2" fill="#fff" opacity="0.7"/>
  <circle cx="75" cy="22" r="1" fill="#fff" opacity="0.6"/>
  <circle cx="90" cy="40" r="1.2" fill="#fff" opacity="0.5"/>
</svg>`,
            ocean: `<svg viewBox="0 0 100 130" xmlns="http://www.w3.org/2000/svg">
  <path d="M-10,80 Q10,72 30,80 Q50,88 70,80 Q90,72 110,80 L110,130 L-10,130Z" fill="rgba(41,182,246,0.2)"/>
  <path d="M-10,95 Q15,87 40,95 Q65,103 90,95 Q100,92 110,95 L110,130 L-10,130Z" fill="rgba(2,136,209,0.18)"/>
  <ellipse cx="30" cy="62" rx="14" ry="6" fill="rgba(255,200,80,0.65)"/>
  <polygon points="16,62 8,56 8,68" fill="rgba(255,180,60,0.65)"/>
  <circle cx="35" cy="60" r="2" fill="rgba(0,0,0,0.4)"/>
  <g style="animation:seaweedSway 3s ease-in-out infinite; transform-origin:15px 130px">
    <path d="M15,130 Q10,112 15,100" stroke="rgba(67,160,71,0.55)" stroke-width="3" fill="none" stroke-linecap="round"/>
  </g>
  <circle cx="60" cy="110" r="2.5" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="0.8"
    style="animation:bubbleRise 5s ease-in infinite"/>
  <line x1="38" y1="0" x2="28" y2="65" stroke="rgba(255,255,255,0.05)" stroke-width="12"/>
</svg>`,
            midnight: `<svg viewBox="0 0 100 130" xmlns="http://www.w3.org/2000/svg">
  <circle cx="75" cy="30" r="16" fill="#fffde7" opacity="0.8" style="animation:moonGlow 4s ease-in-out infinite"/>
  <circle cx="82" cy="26" r="15" fill="#1a0533" opacity="0.85"/>
  <circle cx="15" cy="22" r="1.5" fill="#fff" style="animation:starTwinkle 2s ease-in-out infinite"/>
  <circle cx="40" cy="14" r="1.2" fill="#c4b5fd" style="animation:starTwinkle 3s ease-in-out infinite 0.5s"/>
  <circle cx="60" cy="48" r="1" fill="#fff" style="animation:starTwinkle 2.5s ease-in-out infinite 1s"/>
  <circle cx="10" cy="75" r="1.2" fill="#c4b5fd" style="animation:starTwinkle 1.8s ease-in-out infinite 0.3s"/>
  <circle cx="85" cy="70" r="1" fill="#fff" style="animation:starTwinkle 3.2s ease-in-out infinite 0.8s"/>
  <circle cx="30" cy="100" r="1" fill="#a5b4fc" style="animation:starTwinkle 2.2s ease-in-out infinite 1.2s"/>
  <rect x="0" y="105" width="15" height="25" fill="rgba(10,5,30,0.7)" rx="1"/>
  <rect x="18" y="95" width="12" height="35" fill="rgba(10,5,30,0.65)" rx="1"/>
  <rect x="34" y="108" width="18" height="22" fill="rgba(10,5,30,0.6)" rx="1"/>
  <rect x="56" y="98" width="12" height="32" fill="rgba(10,5,30,0.65)" rx="1"/>
  <rect x="72" y="110" width="16" height="20" fill="rgba(10,5,30,0.6)" rx="1"/>
  <rect x="90" y="100" width="12" height="30" fill="rgba(10,5,30,0.65)" rx="1"/>
</svg>`,
            forest: `<svg viewBox="0 0 100 130" xmlns="http://www.w3.org/2000/svg">
  <rect x="5" y="80" width="8" height="50" fill="rgba(30,20,10,0.5)" rx="2"/>
  <ellipse cx="9" cy="72" rx="22" ry="28" fill="rgba(27,94,32,0.55)"/>
  <ellipse cx="9" cy="58" rx="16" ry="22" fill="rgba(46,125,50,0.5)"/>
  <ellipse cx="9" cy="46" rx="12" ry="16" fill="rgba(67,160,71,0.45)"/>
  <rect x="86" y="85" width="7" height="45" fill="rgba(30,20,10,0.5)" rx="2"/>
  <ellipse cx="89" cy="77" rx="20" ry="26" fill="rgba(27,94,32,0.5)"/>
  <ellipse cx="89" cy="63" rx="14" ry="20" fill="rgba(46,125,50,0.45)"/>
  <ellipse cx="89" cy="52" rx="10" ry="14" fill="rgba(67,160,71,0.4)"/>
  <g style="animation:leafFall1 6s linear infinite; transform-origin:35px 0">
    <ellipse cx="35" cy="20" rx="4" ry="2.5" fill="rgba(129,199,132,0.75)" transform="rotate(-20,35,20)"/>
  </g>
  <g style="animation:leafFall2 8s linear infinite 2s; transform-origin:60px 0">
    <ellipse cx="60" cy="35" rx="3.5" ry="2" fill="rgba(165,214,167,0.7)" transform="rotate(30,60,35)"/>
  </g>
  <circle cx="45" cy="90" r="1.5" fill="#ccff90" opacity="0.7" style="animation:firefly 3.5s ease-in-out infinite"/>
  <circle cx="60" cy="70" r="1.2" fill="#b9f6ca" opacity="0.6" style="animation:firefly 4.2s ease-in-out infinite 1s"/>
  <ellipse cx="50" cy="128" rx="55" ry="12" fill="rgba(27,94,32,0.4)"/>
</svg>`,
            rosegold: `<svg viewBox="0 0 100 130" xmlns="http://www.w3.org/2000/svg">
  <g style="animation:heartPulse 4s ease-in-out infinite; transform-origin:50px 60px">
    <path d="M50,80 C50,80 20,58 20,38 C20,24 32,16 44,22 C47,24 50,30 50,30 C50,30 53,24 56,22 C68,16 80,24 80,38 C80,58 50,80 50,80Z" fill="rgba(244,143,177,0.18)"/>
  </g>
  <g style="animation:petalFloat 7s linear infinite; transform-origin:20px 0">
    <ellipse cx="20" cy="15" rx="6" ry="3.5" fill="rgba(244,143,177,0.7)" transform="rotate(-20,20,15)"/>
  </g>
  <g style="animation:petalFloat 9s linear infinite 2s; transform-origin:70px 0">
    <ellipse cx="70" cy="10" rx="5.5" ry="3" fill="rgba(240,98,146,0.65)" transform="rotate(15,70,10)"/>
  </g>
  <g style="animation:petalFloat 6.5s linear infinite 1s; transform-origin:45px 0">
    <ellipse cx="45" cy="25" rx="5" ry="3" fill="rgba(248,187,208,0.7)" transform="rotate(-35,45,25)"/>
  </g>
  <g style="animation:sparkle 2.5s ease-in-out infinite; transform-origin:25px 95px">
    <line x1="22" y1="95" x2="28" y2="95" stroke="#f8bbd0" stroke-width="1.2" stroke-linecap="round"/>
    <line x1="25" y1="92" x2="25" y2="98" stroke="#f8bbd0" stroke-width="1.2" stroke-linecap="round"/>
  </g>
  <g style="animation:sparkle 3.2s ease-in-out infinite 1s; transform-origin:78px 50px">
    <line x1="75" y1="50" x2="81" y2="50" stroke="#ffcdd2" stroke-width="1.2" stroke-linecap="round"/>
    <line x1="78" y1="47" x2="78" y2="53" stroke="#ffcdd2" stroke-width="1.2" stroke-linecap="round"/>
  </g>
  <circle cx="12" cy="50" r="1.5" fill="rgba(244,143,177,0.5)" style="animation:heartPulse 3s ease-in-out infinite"/>
  <circle cx="88" cy="100" r="1.2" fill="rgba(240,98,146,0.45)" style="animation:heartPulse 4s ease-in-out infinite 1s"/>
</svg>`,
            mono: `<svg viewBox="0 0 100 130" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="100" height="30" fill="rgba(255,255,255,0.025)"
    style="animation:monoScan 8s linear infinite"/>
  <circle cx="20" cy="25" r="1" fill="#fff" opacity="0.2" style="animation:monoBlink 3s ease-in-out infinite"/>
  <circle cx="50" cy="25" r="1" fill="#fff" opacity="0.2" style="animation:monoBlink 3s ease-in-out infinite 0.5s"/>
  <circle cx="80" cy="25" r="1" fill="#fff" opacity="0.2" style="animation:monoBlink 3s ease-in-out infinite 1s"/>
  <circle cx="20" cy="65" r="1" fill="#fff" opacity="0.15" style="animation:monoBlink 3.5s ease-in-out infinite 0.3s"/>
  <circle cx="50" cy="65" r="1" fill="#fff" opacity="0.15" style="animation:monoBlink 3.5s ease-in-out infinite 0.8s"/>
  <circle cx="80" cy="65" r="1" fill="#fff" opacity="0.15" style="animation:monoBlink 3.5s ease-in-out infinite 1.3s"/>
  <circle cx="20" cy="105" r="1" fill="#fff" opacity="0.15" style="animation:monoBlink 4s ease-in-out infinite 0.1s"/>
  <circle cx="50" cy="105" r="1" fill="#fff" opacity="0.15" style="animation:monoBlink 4s ease-in-out infinite 0.6s"/>
  <circle cx="80" cy="105" r="1" fill="#fff" opacity="0.15" style="animation:monoBlink 4s ease-in-out infinite 1.1s"/>
  <rect x="12" y="38" width="18" height="18" rx="2" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="1"
    style="animation:monoFloat 6s ease-in-out infinite"/>
  <circle cx="75" cy="48" r="10" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"
    style="animation:monoFloat 9s ease-in-out infinite 2s"/>
  <polygon points="50,78 62,98 38,98" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"
    style="animation:monoFloat 8s ease-in-out infinite 1s"/>
  <line x1="0" y1="0" x2="100" y2="130" stroke="rgba(255,255,255,0.02)" stroke-width="1"/>
  <line x1="100" y1="0" x2="0" y2="130" stroke="rgba(255,255,255,0.018)" stroke-width="1"/>
</svg>`,
        };
        return previews[themeId] || '';
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
