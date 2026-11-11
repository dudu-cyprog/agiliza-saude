"use strict";

/**
 * Popula o EMULADOR com dados de demonstracao (nunca roda em producao).
 * Uso (com os emuladores ligados):  npm run seed
 */
if (!process.argv.includes("--emulador")) {
  console.error("Este script so popula o emulador. Use: npm run seed");
  process.exit(1);
}
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8085";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

const admin = require("firebase-admin");
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "demo-agiliza" });
const db = admin.firestore();

async function main() {
  const email = "servidor@cidadeocidental.go.gov.br";
  let user;
  try {
    user = await admin.auth().getUserByEmail(email);
  } catch (e) {
    user = await admin.auth().createUser({ email, password: "saude2026", displayName: "Servidor Demonstração" });
  }
  await admin.auth().setCustomUserClaims(user.uid, { perfil: "REGULADOR" });

  const agora = admin.firestore.Timestamp.now();
  await db.collection("pacientes").doc("700123456789012").set({
    nome: "Lucas Ferreira Mendes",
    nascimento: "1998-05-14",
    telefone: "61987123456",
    criadoEm: agora,
  });
  const ref = db.collection("solicitacoes").doc("2026-0842");
  await ref.set({
    protocolo: "2026-0842",
    sus: "700123456789012",
    nascimento: "1998-05-14",
    paciente: "Lucas Ferreira Mendes",
    telefone: "61987123456",
    ubs: "UBS Família SQ 12 - Centro",
    ubsId: "ubs-sq12",
    servico: "Consulta Médica Especializada",
    servicoId: "consulta-especializada",
    status: "EM_TRIAGEM",
    mensagemPublica: "Solicitação em análise pela regulação médica.",
    anexo: null,
    consentimentoLgpd: true,
    criadoEm: agora,
    atualizadoEm: agora,
  });
  await ref.collection("historico").add({
    usuario: null,
    statusAnterior: null,
    statusNovo: "RECEBIDA",
    observacao: "Solicitação criada pelo munícipe",
    criadoEm: agora,
  });
  console.log("Seed concluido: servidor@cidadeocidental.go.gov.br / saude2026 e protocolo 2026-0842.");
}

main().catch((e) => {
  console.error("Falhou. Os emuladores estao ligados? (npm run emuladores)\n", e.message);
  process.exit(1);
});
