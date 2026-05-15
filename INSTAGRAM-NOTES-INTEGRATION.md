<!-- 
    INSTRUKSI INTEGRASI INSTAGRAM NOTES
    Tambahkan kedua import ini di chat.html
-->

<!-- Di bagian <head> setelah link chat.style.css -->
<link rel="stylesheet" href="chat-notes-instagram.css">

<!-- Di bagian </head> atau sebelum </body> -->
<script type="module">
    // Load setelah Firebase sudah initialized
    // Pastikan ditaruh SETELAH script Firebase
    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
    import { getDatabase, ref, get, set, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
    import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

    // Inject script Instagram Notes
    const script = document.createElement('script');
    script.src = 'chat-notes-instagram.js';
    document.body.appendChild(script);
</script>

<!-- PERUBAHAN DI DALAM FIREBASE MODULE (chat.html) -->
<!--
Di dalam onAuthStateChanged, tambahkan expose variables ke global:

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        
        // TAMBAHKAN BARIS INI:
        window.currentUser = currentUser;
        window.database = database;
        
        // ... rest of code ...
    }
});
-->

<!-- PERUBAHAN DI saveMyNote() FUNCTION -->
<!--
Ubah struktur data note untuk kompatibel dengan Instagram viewer:

window.saveMyNote = async function() {
    if (!currentUser) return;
    const text = document.getElementById('noteTextInput').value.trim();
    const youtubeUrl = document.getElementById('noteYoutubeInput').value.trim();

    if (!text && !youtubeUrl) {
        alert('⚠️ Isi catatan atau tambahkan lagu YouTube!');
        return;
    }

    const videoId = extractYoutubeId(youtubeUrl);

    // FETCH SONG METADATA DARI GENIUS (OPTIONAL)
    let songTitle = '';
    let artistName = '';
    
    if (videoId) {
        // Atau ambil dari YouTube title jika diperlukan
        songTitle = text || 'Untitled Song';
        artistName = 'Unknown Artist';
    }

    const now = Date.now();
    const noteData = {
        text: text,
        youtubeUrl: youtubeUrl,
        youtubeId: videoId || null,
        songTitle: songTitle,           // TAMBAH
        artistName: artistName,         // TAMBAH
        userId: currentUser.uid,
        userName: currentUserName,
        userPhoto: currentUserPhoto,
        updatedAt: now,
        expiresAt: now + 24 * 60 * 60 * 1000,
        likes: {},
        replies: {}
    };

    try {
        await set(ref(database, `notes/${currentUser.uid}`), noteData);
        closeNoteModal();
        renderMyNote(noteData);
        loadNotesPanel();
        alert('✅ Catatan berhasil disimpan!');
    } catch (err) {
        alert('❌ Gagal menyimpan: ' + err.message);
        console.error('Error saving note:', err);
    }
};
-->

<!-- PERUBAHAN DI openNoteViewer() - GANTI DENGAN INSTAGRAM VERSION -->
<!--
Ubah function openNoteViewer untuk menggunakan Instagram viewer:

window.openNoteViewer = function(userId) {
    get(ref(database, `notes/${userId}`)).then(snap => {
        if (!snap.exists()) return;
        const note = snap.val();

        // Gunakan Instagram Viewer baru
        instagramNoteViewer.openViewer(userId, note);
    }).catch(err => console.error('Error opening note viewer:', err));
};
-->
