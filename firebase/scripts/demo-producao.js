"use strict";

/**
 * Cria ou apaga PERFIS DE DEMONSTRACAO no Firebase de verdade (projeto do site publicado).
 *
 *   node scripts/demo-producao.js criar 10      cria 10 cidadaos ficticios com pedidos
 *   node scripts/demo-producao.js apagar        apaga TODOS os perfis de demonstracao
 *   (acrescente --emulador para testar no emulador local)
 *
 * Precisa da chave da conta de servico (Console > Configuracoes do projeto > Contas de servico >
 * Gerar nova chave privada), indicada em GOOGLE_APPLICATION_CREDENTIALS. Use o atalho demo-producao.cmd.
 *
 * Como os perfis de demonstracao sao reconhecidos (para apagar sem tocar nos dados reais):
 *   e-mail terminado em @example.com  (dominio reservado, nao existe)  e  protocolo comecando com 2026-D
 */
const readline = require("readline");
const admin = require("firebase-admin");
const { gerarPerfis, cifrarEmail } = require("./perfis-fakes");

const DOMINIO = "@example.com";
const SENHA = "saude2026";
const emulador = process.argv.includes("--emulador");
const [acao, qtdTexto] = process.argv.slice(2).filter((a) => !a.startsWith("--"));

if (emulador) {
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8085";
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
  admin.initializeApp({ projectId: "demo-agiliza" });
} else {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error("Falta a chave da conta de servico (GOOGLE_APPLICATION_CREDENTIALS). Use o atalho demo-producao.cmd.");
    process.exit(1);
  }
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
}
const db = admin.firestore();
const TS = (d) => admin.firestore.Timestamp.fromDate(d);
const projeto = emulador ? "demo-agiliza (EMULADOR)" : (admin.app().options.credential && require(process.env.GOOGLE_APPLICATION_CREDENTIALS).project_id);

function perguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((ok) => rl.question(texto, (r) => { rl.close(); ok(r.trim()); }));
}

async function criar(qtd) {
  const pessoas = gerarPerfis(qtd);
  let pedidos = 0;
  for (const p of pessoas) {
    let u;
    try {
      u = await admin.auth().getUserByEmail(p.email);
    } catch (e) {
      u = await admin.auth().createUser({ email: p.email, password: SENHA, displayName: p.nome });
    }
    const batch = db.batch();
    const criado = TS(p.pedidos[p.pedidos.length - 1].criadoEm);
    batch.set(db.collection("pacientes").doc(u.uid), {
      nome: p.nome, cpf: p.cpf, sus: p.sus, nascimento: p.nascimento, telefone: p.telefone, email: p.email,
      consentimentoLgpd: true, criadoEm: criado, atualizadoEm: criado,
    });
    batch.set(db.collection("logins").doc(p.cpf), Object.assign({ uid: u.uid }, await cifrarEmail(p.email, SENHA)));
    for (const s of p.pedidos) {
      const dados = {
        protocolo: s.protocolo, uid: u.uid, paciente: p.nome, cpf: p.cpf, sus: p.sus, nascimento: p.nascimento,
        telefone: p.telefone, ubsId: s.ubs.id, ubs: s.ubs.nome, servicoId: s.servico.id, servico: s.servico.nome,
        status: s.status, mensagemPublica: s.mensagem, temAnexo: false, qtdExtras: 0, consentimentoLgpd: true,
        criadoEm: TS(s.criadoEm), atualizadoEm: TS(s.atualizadoEm),
      };
      if (s.agendamento) dados.agendamento = s.agendamento;
      const ref = db.collection("solicitacoes").doc(s.protocolo);
      batch.set(ref, dados);
      batch.set(ref.collection("historico").doc(), {
        usuario: u.uid, usuarioNome: p.nome, statusAnterior: null, statusNovo: "RECEBIDA",
        observacao: "Solicitação criada pelo munícipe (demonstração)", criadoEm: TS(s.criadoEm),
      });
      const cons = {
        protocolo: s.protocolo, status: s.status, primeiroNome: p.nome.split(" ")[0], servico: s.servico.nome,
        ubs: s.ubs.nome, mensagem: s.mensagem, atualizadoEm: TS(s.atualizadoEm),
      };
      if (s.agendamento) cons.agendamento = s.agendamento;
      batch.set(db.collection("consultas").doc(p.cpf).collection("pedidos").doc(s.protocolo), cons);
      if (s.prioridade !== "NORMAL") {
        batch.set(db.collection("triagem").doc(s.protocolo), {
          prioridade: s.prioridade, motivo: s.motivo, definidoPor: "carga-demonstracao",
          definidoPorNome: "Carga de demonstração", definidoEm: TS(new Date(s.criadoEm.getTime() + 864e5)),
        });
      }
      pedidos++;
    }
    await batch.commit();
    console.log(`  ok  ${p.nome.padEnd(36)} CPF ${p.cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4")}  ${p.pedidos.length} pedido(s)`);
  }
  console.log(`\nCriados ${pessoas.length} cidadaos de demonstracao e ${pedidos} pedidos. Senha de todos: ${SENHA}`);
}

async function apagarConsulta(q) {
  let total = 0;
  for (;;) {
    const snap = await q.limit(200).get();
    if (snap.empty) return total;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    total += snap.size;
  }
}

async function apagar() {
  // 1) contas de demonstracao (somente e-mails @example.com)
  const demo = [];
  let pagina;
  do {
    const r = await admin.auth().listUsers(1000, pagina);
    r.users.filter((u) => (u.email || "").endsWith(DOMINIO)).forEach((u) => demo.push(u));
    pagina = r.pageToken;
  } while (pagina);
  // servidores ficticios do emulador tambem usam @example.com: nao apaga quem tiver cadastro de servidor
  const cidadaos = [];
  for (const u of demo) {
    if (!(await db.collection("servidores").doc(u.uid).get()).exists) cidadaos.push(u);
  }
  let docs = 0;
  for (const u of cidadaos) {
    const pac = await db.collection("pacientes").doc(u.uid).get();
    const cpf = pac.exists ? pac.get("cpf") : null;
    const sols = await db.collection("solicitacoes").where("uid", "==", u.uid).get();
    for (const s of sols.docs) {
      if (!s.id.startsWith("2026-D")) continue; // seguranca extra: so protocolos de demonstracao
      docs += await apagarConsulta(s.ref.collection("historico"));
      await db.collection("triagem").doc(s.id).delete();
      await db.collection("anexos").doc(s.id).delete();
      await s.ref.delete();
      docs += 3;
    }
    if (cpf) {
      docs += await apagarConsulta(db.collection("consultas").doc(cpf).collection("pedidos"));
      await db.collection("logins").doc(cpf).delete();
    }
    if (pac.exists) await pac.ref.delete();
    await admin.auth().deleteUser(u.uid);
    console.log(`  apagado ${u.displayName || u.email}`);
  }
  console.log(`\nApagados ${cidadaos.length} cidadaos de demonstracao (${docs}+ documentos). Dados reais nao foram tocados.`);
}

(async () => {
  if (acao !== "criar" && acao !== "apagar") {
    console.log("Uso: node scripts/demo-producao.js criar 10   |   node scripts/demo-producao.js apagar   [--emulador]");
    process.exit(1);
  }
  const qtd = Math.max(1, Math.min(100, Number(qtdTexto) || 10));
  console.log(`Projeto: ${projeto}`);
  console.log(acao === "criar"
    ? `Vai CRIAR ${qtd} cidadaos FICTICIOS (e-mails @example.com, protocolos 2026-D...) com pedidos.`
    : "Vai APAGAR todos os cidadaos de demonstracao (e-mails @example.com) e os pedidos deles.");
  if (!emulador && !process.argv.includes("--sim")) {
    const r = await perguntar('Digite SIM para continuar: ');
    if (r.toUpperCase() !== "SIM") { console.log("Cancelado."); process.exit(0); }
  }
  if (acao === "criar") await criar(qtd);
  else await apagar();
  process.exit(0);
})().catch((e) => {
  console.error("Falhou:", e.message);
  process.exit(1);
});
