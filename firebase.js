// ============================================================
// firebase.js — Auth + Firestore + Demo Mode
// ============================================================
// CONFIGURACIÓN:
// 1. Ve a https://console.firebase.google.com → Nuevo proyecto
// 2. Activa Authentication (Email/Password + Google)
// 3. Activa Firestore Database
// 4. Reemplaza las credenciales de FIREBASE_CONFIG abajo
// 5. Cambia DEMO_MODE a false
// ============================================================

import { initializeApp }            from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
         signInWithPopup, GoogleAuthProvider, onAuthStateChanged,
         signOut, updateProfile }    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, doc, setDoc,
         getDoc }                    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── ⚙️ CONFIGURACIÓN ──────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDYxhSPuMRSMcray0HBYfnvDk6hgStuLtk",
  authDomain:        "ahorrapp-pro.firebaseapp.com",
  projectId:         "ahorrapp-pro",
  storageBucket:     "ahorrapp-pro.firebasestorage.app",
  messagingSenderId: "484687357317",
  appId:             "1:484687357317:web:114189a184d6f3131710ec"
};

// Firebase real activo
const DEMO_MODE = false;
// ──────────────────────────────────────────────────────────

let auth, db;

if (!DEMO_MODE) {
  const app = initializeApp(FIREBASE_CONFIG);
  auth = getAuth(app);
  db   = getFirestore(app);
}

// ── AUTH INIT ──────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (DEMO_MODE) {
    const stored = localStorage.getItem('ap_demo_user');
    if (stored) {
      window._onUserReady(JSON.parse(stored));
    }
    // else: auth layer already visible
    return;
  }
  onAuthStateChanged(auth, user => {
    if (user) window._onUserReady({ uid: user.uid, email: user.email, displayName: user.displayName });
    // else auth layer visible by default
  });
});

// ── LOGIN ──────────────────────────────────────────────────
window.doLogin = async () => {
  const email = document.getElementById('loginEmail').value.trim();
  const pass  = document.getElementById('loginPass').value;
  const err   = document.getElementById('loginErr');
  err.style.display = 'none';

  if (!email || !pass) { err.textContent='Completa todos los campos'; err.style.display='block'; return; }

  if (DEMO_MODE) {
    const u = { uid:`demo_${btoa(email).slice(0,12)}`, email, displayName: email.split('@')[0] };
    localStorage.setItem('ap_demo_user', JSON.stringify(u));
    window._onUserReady(u);
    return;
  }
  try {
    const c = await signInWithEmailAndPassword(auth, email, pass);
    window._onUserReady({ uid:c.user.uid, email:c.user.email, displayName:c.user.displayName });
  } catch(e) {
    err.textContent = 'Email o contraseña incorrectos';
    err.style.display = 'block';
  }
};

// ── REGISTER ───────────────────────────────────────────────
window.doRegister = async () => {
  const nombre = document.getElementById('regNombre').value.trim();
  const email  = document.getElementById('regEmail').value.trim();
  const pass   = document.getElementById('regPass').value;
  const err    = document.getElementById('regErr');
  err.style.display = 'none';

  if (!nombre||!email||!pass) { err.textContent='Completa todos los campos'; err.style.display='block'; return; }
  if (pass.length < 6) { err.textContent='La contraseña debe tener mínimo 6 caracteres'; err.style.display='block'; return; }

  if (DEMO_MODE) {
    const u = { uid:`demo_${Date.now()}`, email, displayName:nombre, isNew:true };
    localStorage.setItem('ap_demo_user', JSON.stringify(u));
    window._onUserReady(u);
    return;
  }
  try {
    const c = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(c.user, { displayName: nombre });
    window._onUserReady({ uid:c.user.uid, email, displayName:nombre, isNew:true });
  } catch(e) {
    err.textContent = 'Error: ' + (e.code === 'auth/email-already-in-use' ? 'Email ya registrado' : e.message);
    err.style.display = 'block';
  }
};

// ── GOOGLE ─────────────────────────────────────────────────
window.doGoogleLogin = async () => {
  if (DEMO_MODE) {
    const u = { uid:`demo_google_${Date.now()}`, email:'usuario@gmail.com', displayName:'Usuario', isNew:true };
    localStorage.setItem('ap_demo_user', JSON.stringify(u));
    window._onUserReady(u);
    return;
  }
  try {
    const c = await signInWithPopup(auth, new GoogleAuthProvider());
    window._onUserReady({ uid:c.user.uid, email:c.user.email, displayName:c.user.displayName, isNew:c._tokenResponse?.isNewUser||false });
  } catch(e) { console.warn('Google login:', e); }
};

// ── LOGOUT ─────────────────────────────────────────────────
window.doLogout = async () => {
  if (!confirm('¿Cerrar sesión?')) return;
  if (DEMO_MODE) localStorage.removeItem('ap_demo_user');
  else await signOut(auth);
  location.reload();
};

// ── DATA LAYER (por usuario, aislado) ─────────────────────
function key(uid, k) { return `ap_${uid}_${k}`; }

window._db = {
  async saveProfile(uid, data) {
    if (DEMO_MODE) { localStorage.setItem(key(uid,'profile'), JSON.stringify(data)); return; }
    await setDoc(doc(db,'users',uid,'data','profile'), data);
  },
  async getProfile(uid) {
    if (DEMO_MODE) { const r=localStorage.getItem(key(uid,'profile')); return r?JSON.parse(r):null; }
    const s = await getDoc(doc(db,'users',uid,'data','profile'));
    return s.exists() ? s.data() : null;
  },
  async saveGastos(uid, list) {
    if (DEMO_MODE) { localStorage.setItem(key(uid,'gastos'), JSON.stringify(list)); return; }
    await setDoc(doc(db,'users',uid,'data','gastos'), { list });
  },
  async getGastos(uid) {
    if (DEMO_MODE) { const r=localStorage.getItem(key(uid,'gastos')); return r?JSON.parse(r):[]; }
    const s = await getDoc(doc(db,'users',uid,'data','gastos'));
    return s.exists() ? (s.data().list||[]) : [];
  },
  async saveMetas(uid, list) {
    if (DEMO_MODE) { localStorage.setItem(key(uid,'metas'), JSON.stringify(list)); return; }
    await setDoc(doc(db,'users',uid,'data','metas'), { list });
  },
  async getMetas(uid) {
    if (DEMO_MODE) { const r=localStorage.getItem(key(uid,'metas')); return r?JSON.parse(r):[]; }
    const s = await getDoc(doc(db,'users',uid,'data','metas'));
    return s.exists() ? (s.data().list||[]) : [];
  },
  async saveConfig(uid, data) {
    if (DEMO_MODE) { localStorage.setItem(key(uid,'config'), JSON.stringify(data)); return; }
    await setDoc(doc(db,'users',uid,'data','config'), data);
  },
  async getConfig(uid) {
    if (DEMO_MODE) { const r=localStorage.getItem(key(uid,'config')); return r?JSON.parse(r):null; }
    const s = await getDoc(doc(db,'users',uid,'data','config'));
    return s.exists() ? s.data() : null;
  },
};
