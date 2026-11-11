"use strict";

/**
 * Cria (ou atualiza) um servidor municipal em PRODUCAO e define o perfil.
 *
 * Uso:
 *   node scripts/criar-servidor.js <email> <senha> <ATENDENTE|REGULADOR|ADMIN> "<Nome>"
 *
 * Requer credenciais: baixe uma chave de servico em
 *   Console Firebase > Configuracoes do projeto > Contas de servico > Gerar nova chave privada
 * e aponte:  GOOGLE_APPLICATION_CREDENTIALS=caminho\da\chave.json
 * (nao envie essa chave para o GitHub).
 */
const admin = require("firebase-admin");

const [email, senha, perfil, nome] = process.argv.slice(2);
const PERFIS = ["ATENDENTE", "REGULADOR", "ADMIN"];

if (!email || !senha || !PERFIS.includes(perfil)) {
  console.error('Uso: node scripts/criar-servidor.js <email> <senha> <ATENDENTE|REGULADOR|ADMIN> "<Nome>"');
  process.exit(1);
}
if (senha.length < 8) {
  console.error("Use uma senha com pelo menos 8 caracteres.");
  process.exit(1);
}

admin.initializeApp();

(async () => {
  let user;
  try {
    user = await admin.auth().getUserByEmail(email);
    await admin.auth().updateUser(user.uid, { password: senha, displayName: nome || user.displayName });
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
    user = await admin.auth().createUser({ email, password: senha, displayName: nome || email });
  }
  await admin.auth().setCustomUserClaims(user.uid, { perfil });
  console.log(`OK: ${email} com perfil ${perfil}. A pessoa precisa sair e entrar de novo para o perfil valer.`);
})().catch((e) => {
  console.error("Falhou:", e.message);
  process.exit(1);
});
