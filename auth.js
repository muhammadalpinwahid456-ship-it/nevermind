// ===== TOGGLE AUTH MODAL =====
function toggleAuthModal() {
    const modal = document.getElementById('authModal');
    if (modal) {
        modal.classList.toggle('active'); // PERBAIKAN: 'show' → 'active'
    } else {
        console.error('Modal element tidak ditemukan');
    }
}

// ===== SWITCH TAB =====
function switchTab(tabName) {
    document.querySelectorAll('.auth-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    const targetTab = document.getElementById(tabName + 'Tab');
    if (targetTab) {
        targetTab.classList.add('active');
    }
}

// ===== LOGIN FORM (PERBAIKAN: SAFE EVENT LISTENER) =====
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', function(e) {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;

        // Validasi input
        if (!email || !password) {
            alert('⚠️ Email dan password harus diisi!');
            return;
        }

        // Show loading
        this.querySelector('button').disabled = true;
        this.querySelector('button').textContent = 'Sedang login...';

        firebase.auth().signInWithEmailAndPassword(email, password)
            .then((userCredential) => {
                const user = userCredential.user;
                alert('✅ Login berhasil!');
                displayProfile(user);
                toggleAuthModal();
                this.reset();
            })
            .catch((error) => {
                console.error('Login error:', error);
                // Pesan error yang lebih friendly
                if (error.code === 'auth/user-not-found') {
                    alert('❌ Email tidak terdaftar');
                } else if (error.code === 'auth/wrong-password') {
                    alert('❌ Password salah');
                } else if (error.code === 'auth/invalid-email') {
                    alert('❌ Format email tidak valid');
                } else {
                    alert('❌ Error login: ' + error.message);
                }
            })
            .finally(() => {
                // Reset button state
                this.querySelector('button').disabled = false;
                this.querySelector('button').textContent = 'Login';
            });
    });
}

// ===== REGISTER FORM (PERBAIKAN: SAFE EVENT LISTENER + VALIDATION) =====
const registerForm = document.getElementById('registerForm');
if (registerForm) {
    registerForm.addEventListener('submit', function(e) {
        e.preventDefault();
        const fullname = document.getElementById('registerName').value.trim();
        const email = document.getElementById('registerEmail').value.trim();
        const password = document.getElementById('registerPassword').value;
        const confirmPassword = document.getElementById('registerConfirmPassword').value;

        // Validasi input
        if (!fullname || !email || !password || !confirmPassword) {
            alert('⚠️ Semua field harus diisi!');
            return;
        }

        if (password.length < 6) {
            alert('⚠️ Password minimal 6 karakter!');
            return;
        }

        if (password !== confirmPassword) {
            alert('⚠️ Password tidak cocok!');
            return;
        }

        // Show loading
        this.querySelector('button').disabled = true;
        this.querySelector('button').textContent = 'Sedang mendaftar...';

        firebase.auth().createUserWithEmailAndPassword(email, password)
            .then((userCredential) => {
                const user = userCredential.user;
                
                // Simpan profil ke Realtime Database
                firebase.database().ref('users/' + user.uid).set({
                    fullname: fullname,
                    email: email,
                    createdAt: new Date().toISOString()
                });
                
                alert('✅ Akun berhasil dibuat! Silakan login.');
                switchTab('login');
                this.reset();
            })
            .catch((error) => {
                console.error('Register error:', error);
                // Pesan error yang lebih friendly
                if (error.code === 'auth/email-already-in-use') {
                    alert('❌ Email sudah terdaftar');
                } else if (error.code === 'auth/weak-password') {
                    alert('❌ Password terlalu lemah. Gunakan kombinasi huruf dan angka');
                } else if (error.code === 'auth/invalid-email') {
                    alert('❌ Format email tidak valid');
                } else {
                    alert('❌ Error register: ' + error.message);
                }
            })
            .finally(() => {
                // Reset button state
                this.querySelector('button').disabled = false;
                this.querySelector('button').textContent = 'Daftar';
            });
    });
}

// ===== DISPLAY PROFILE (PERBAIKAN: HANDLE NULL DATA) =====
function displayProfile(user) {
    firebase.database().ref('users/' + user.uid).once('value', (snapshot) => {
        let data = snapshot.val();
        
        // PERBAIKAN: Handle jika data tidak ada
        if (!data) {
            data = {
                fullname: user.displayName || user.email.split('@')[0],
                email: user.email,
                createdAt: new Date().toISOString()
            };
            // Simpan data ke database
            firebase.database().ref('users/' + user.uid).set(data);
        }
        
        // Update profile tab
        const profileName = document.getElementById('profileName');
        const profileEmail = document.getElementById('profileEmail');
        const profileDate = document.getElementById('profileDate');
        
        if (profileName) profileName.textContent = data.fullname;
        if (profileEmail) profileEmail.textContent = data.email;
        if (profileDate) profileDate.textContent = new Date(data.createdAt).toLocaleDateString('id-ID');
        
        // Tampilkan profile tab
        document.querySelectorAll('.auth-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        const profileTab = document.getElementById('profileTab');
        if (profileTab) {
            profileTab.classList.add('active');
        }
        
        // Update button di header
        const headerAuthBtn = document.getElementById('headerAuthBtn');
        if (headerAuthBtn) {
            headerAuthBtn.textContent = data.fullname.split(' ')[0];
            headerAuthBtn.onclick = toggleAuthModal;
        }
    }).catch((error) => {
        console.error('Error loading profile:', error);
    });
}

// ===== LOGOUT =====
function logout() {
    if (confirm('Apakah Anda yakin ingin logout?')) {
        firebase.auth().signOut().then(() => {
            alert('✅ Logout berhasil');
            
            // Reset UI
            const headerAuthBtn = document.getElementById('headerAuthBtn');
            if (headerAuthBtn) {
                headerAuthBtn.textContent = 'SIGNING';
            }
            
            // Close modal jika ada
            const modal = document.getElementById('authModal');
            if (modal) {
                modal.classList.remove('active');
            }
            
            // Reload halaman
            location.reload();
        }).catch((error) => {
            console.error('Logout error:', error);
            alert('❌ Error logout: ' + error.message);
        });
    }
}

// ===== CHECK AUTH STATE SAAT PAGE LOAD =====
firebase.auth().onAuthStateChanged((user) => {
    if (user) {
        console.log('User logged in:', user.email);
        displayProfile(user);
    } else {
        console.log('User not logged in');
    }
});