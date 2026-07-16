// ─── Firebase — COMENTADO (pausado por cuota/testing) ───────────────────────
// Descomentar cuando se activen las credenciales reales de Firebase Console.
//
// import { initializeApp } from 'firebase/app';
// import { getAuth } from 'firebase/auth';
// import { getFirestore } from 'firebase/firestore';
//
// const firebaseConfig = {
//   apiKey:            "AIzaSyMOCK_KEY_REPLACE_WITH_REAL",
//   authDomain:        "dashboard-superadmin.firebaseapp.com",
//   projectId:         "dashboard-superadmin",
//   storageBucket:     "dashboard-superadmin.appspot.com",
//   messagingSenderId: "000000000000",
//   appId:             "1:000000000000:web:mock0000000000000000",
// };
//
// const app  = initializeApp(firebaseConfig);
// export const auth = getAuth(app);
// export const db   = getFirestore(app);
// export default app;
// ────────────────────────────────────────────────────────────────────────────

// Exportaciones vacías para que los imports existentes no rompan durante el
// modo simulado. Reemplazar por las líneas de arriba al reactivar Firebase.
export const auth = null;
export const db   = null;
export default null;
