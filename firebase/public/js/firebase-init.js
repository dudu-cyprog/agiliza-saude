// =====================================================================
// CONFIGURACAO DO FIREBASE (front end)
//
// Estes valores NAO sao segredos: a seguranca vem das regras do Firestore
// (firestore.rules) e do login. Em localhost usa os emuladores.
// =====================================================================

// Projeto agiliza-saude-5ab0e (app Web "Agiliza Saude Web").
const firebaseConfigProducao = {
  apiKey: "AIzaSyBxJvLaCXTxvmxwQSUIUN5cyJEr3BHVmNU",
  authDomain: "agiliza-saude-5ab0e.firebaseapp.com",
  projectId: "agiliza-saude-5ab0e",
  storageBucket: "agiliza-saude-5ab0e.firebasestorage.app",
  appId: "1:98213275408:web:1ad2115431ca7cd1fd6795"
};

const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const firebaseConfig = local
  ? { apiKey: "demo-key", authDomain: "demo-agiliza.firebaseapp.com", projectId: "demo-agiliza", appId: "demo-app" }
  : firebaseConfigProducao;

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
auth.languageCode = "pt-BR";

if (local) {
  auth.useEmulator("http://" + location.hostname + ":9099", { disableWarnings: true });
  db.useEmulator(location.hostname, 8085);
}
