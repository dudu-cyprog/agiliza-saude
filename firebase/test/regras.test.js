"use strict";

// Testes das regras do Firestore (rodam no emulador):  npm test
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const firebase = require("firebase/compat/app");
require("firebase/compat/firestore");

const TS = () => firebase.firestore.FieldValue.serverTimestamp();
let env;

const PAC = { nome: "Lucas Ferreira Mendes", cpf: "52998224725", sus: "700123456789012", nascimento: "1998-05-14", telefone: "61987123456" };
const CONS = "consultas/52998224725/pedidos/";
const LOGIN = { cifra: "Y2lmcmE=", iv: "aXY=", sal: "c2Fs" };

function dbDe(uid, email) {
  return env.authenticatedContext(uid, { email: email || uid + "@teste.com" }).firestore();
}

async function semRegras(fn) {
  await env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));
}

function perfilPaciente(extra) {
  return Object.assign({}, PAC, { email: "lucas@teste.com", consentimentoLgpd: true, criadoEm: TS(), atualizadoEm: TS() }, extra);
}

/** Cadastro como o site faz: perfil + login por CPF no mesmo batch. */
function criarPerfil(db, uid, extra) {
  const p = perfilPaciente(extra);
  const b = db.batch();
  b.set(db.doc("pacientes/" + uid), p);
  b.set(db.doc("logins/" + p.cpf), Object.assign({ uid }, LOGIN));
  return b.commit();
}

/** Batch completo que o site faz ao criar um pedido. */
function batchPedido(db, uid, prot, alterar) {
  const b = db.batch();
  const sol = Object.assign({
    protocolo: prot, uid, paciente: PAC.nome, cpf: PAC.cpf, sus: PAC.sus, nascimento: PAC.nascimento, telefone: PAC.telefone,
    ubsId: "ubs-sq12", ubs: "UBS Família SQ 12 - Centro", servicoId: "exames", servico: "Exames",
    status: "RECEBIDA", mensagemPublica: "Recebida", temAnexo: true, consentimentoLgpd: true,
    criadoEm: TS(), atualizadoEm: TS(),
  }, alterar);
  b.set(db.collection("solicitacoes").doc(prot), sol);
  b.set(db.collection("solicitacoes").doc(prot).collection("historico").doc(), {
    usuario: uid, usuarioNome: PAC.nome, statusAnterior: null, statusNovo: "RECEBIDA", observacao: "criada", criadoEm: TS(),
  });
  b.set(db.collection("anexos").doc(prot), { uid, dados: "data:image/jpeg;base64,AAAA", tipo: "image/jpeg", nome: "guia.jpg", criadoEm: TS() });
  b.set(db.doc("consultas/" + sol.cpf + "/pedidos/" + prot), {
    protocolo: prot, status: "RECEBIDA", primeiroNome: "Lucas", servico: "Exames", ubs: "UBS", mensagem: "Recebida", atualizadoEm: TS(),
  });
  return b;
}

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-agiliza",
    firestore: { host: "127.0.0.1", port: 8085, rules: fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8") },
  });
});
test.after(async () => env && env.cleanup());
test.beforeEach(async () => {
  await env.clearFirestore();
  await semRegras(async (db) => {
    await db.doc("servidores/adm").set({ nome: "Adm", email: "adm@teste.com", matricula: "1", perfil: "ADMIN", aprovado: true });
    await db.doc("servidores/ate").set({ nome: "Ate", email: "ate@teste.com", matricula: "2", perfil: "ATENDENTE", aprovado: true });
    await db.doc("servidores/pend").set({ nome: "Pend", email: "pend@teste.com", matricula: "3", perfil: "ATENDENTE", aprovado: false });
  });
});

test("municipe cria o proprio perfil; nao cria o de outro; dados invalidos falham", async () => {
  await assertSucceeds(criarPerfil(dbDe("lucas"), "lucas"));
  await assertFails(dbDe("lucas").doc("pacientes/outro").set(perfilPaciente({ cpf: "11144477735" })));
  await assertFails(criarPerfil(dbDe("x"), "x", { cpf: "11144477735", sus: "123" }));
  await assertFails(criarPerfil(dbDe("y"), "y", { cpf: "11144477735", consentimentoLgpd: false }));
  // perfil sem o registro de login por CPF nao e aceito
  await assertFails(dbDe("z").doc("pacientes/z").set(perfilPaciente({ cpf: "11144477735" })));
  // CPF nao pode ser trocado depois
  await assertFails(dbDe("lucas").doc("pacientes/lucas").update({ cpf: "11144477735" }));
});

test("conta antiga sem CPF inclui o CPF uma vez, junto com o login", async () => {
  await semRegras((d) => d.doc("pacientes/antigo").set(perfilPaciente({ cpf: null })));
  await semRegras((d) => d.doc("pacientes/antigo").update({ cpf: firebase.firestore.FieldValue.delete() }));
  const db = dbDe("antigo");
  await assertFails(db.doc("pacientes/antigo").update({ cpf: "11144477735" })); // sem o registro de login
  const b = db.batch();
  b.update(db.doc("pacientes/antigo"), { cpf: "11144477735", atualizadoEm: TS() });
  b.set(db.doc("logins/11144477735"), Object.assign({ uid: "antigo" }, LOGIN));
  await assertSucceeds(b.commit());
  await assertFails(db.doc("pacientes/antigo").update({ cpf: "52998224725" }));
});

test("login por CPF: CPF unico, leitura so pelo CPF exato, ninguem altera o de outro", async () => {
  await criarPerfil(dbDe("lucas"), "lucas");
  // outra pessoa com o mesmo CPF nao consegue se cadastrar
  await assertFails(criarPerfil(dbDe("copia"), "copia"));
  const anon = env.unauthenticatedContext().firestore();
  await assertSucceeds(anon.doc("logins/52998224725").get());
  await assertFails(anon.collection("logins").get());
  await assertFails(dbDe("intruso").doc("logins/52998224725").update({ cifra: "eA==" }));
  await assertSucceeds(dbDe("lucas").doc("logins/52998224725").update({ cifra: "bm92YQ==", iv: "aXY=", sal: "c2Fs" }));
  await assertFails(dbDe("lucas").doc("logins/52998224725").update({ uid: "outro" }));
});

test("municipe faz pedido completo (solicitacao + historico + anexo + consulta)", async () => {
  const db = dbDe("lucas");
  await criarPerfil(db, "lucas");
  await assertSucceeds(batchPedido(db, "lucas", "2026-ABC234").commit());
  // le o proprio pedido e o anexo
  await assertSucceeds(db.doc("solicitacoes/2026-ABC234").get());
  await assertSucceeds(db.collection("solicitacoes").where("uid", "==", "lucas").get());
  await assertSucceeds(db.doc("anexos/2026-ABC234").get());
});

test("pedido falha sem perfil, com dados de outra pessoa, ou status diferente de RECEBIDA", async () => {
  await assertFails(batchPedido(dbDe("semperfil"), "semperfil", "2026-AAA111").commit());
  const db = dbDe("lucas");
  await criarPerfil(db, "lucas");
  await assertFails(batchPedido(db, "lucas", "2026-AAA222", { sus: "700000000000009" }).commit());
  await assertFails(batchPedido(db, "lucas", "2026-AAA333", { status: "AGENDADA" }).commit());
  await assertFails(batchPedido(db, "outro", "2026-AAA444").commit());
});

test("protocolo repetido nao sobrescreve pedido existente", async () => {
  const db = dbDe("lucas");
  await criarPerfil(db, "lucas");
  await batchPedido(db, "lucas", "2026-DUP111").commit();
  await assertFails(batchPedido(db, "lucas", "2026-DUP111").commit());
});

test("outro municipe e visitante nao leem pedido/anexo alheio", async () => {
  const db = dbDe("lucas");
  await criarPerfil(db, "lucas");
  await batchPedido(db, "lucas", "2026-PRV111").commit();
  await assertFails(dbDe("intruso").doc("solicitacoes/2026-PRV111").get());
  await assertFails(dbDe("intruso").doc("anexos/2026-PRV111").get());
  await assertFails(dbDe("intruso").doc("pacientes/lucas").get());
  await assertFails(dbDe("intruso").collection("solicitacoes").get());
  await assertFails(env.unauthenticatedContext().firestore().doc("solicitacoes/2026-PRV111").get());
  await assertFails(dbDe("pend").collection("solicitacoes").get()); // servidor nao aprovado
});

test("consulta publica: lista os pedidos so com o CPF; nao lista todos; nao altera", async () => {
  const db = dbDe("lucas");
  await criarPerfil(db, "lucas");
  await batchPedido(db, "lucas", "2026-PUB111").commit();
  await batchPedido(db, "lucas", "2026-PUB222").commit();
  const anon = env.unauthenticatedContext().firestore();
  const lista = await assertSucceeds(anon.collection("consultas/52998224725/pedidos").get());
  if (lista.size !== 2) throw new Error("esperava 2 pedidos, veio " + lista.size);
  await assertFails(anon.collection("consultas").get());
  await assertFails(anon.collectionGroup("pedidos").get());
  await assertFails(anon.doc(CONS + "2026-PUB111").update({ status: "AGENDADA" }));
  // pedido nao pode ser gravado no CPF de outra pessoa
  const b = batchPedido(db, "lucas", "2026-PUB333");
  b.set(db.doc("consultas/11144477735/pedidos/2026-PUB333"), {
    protocolo: "2026-PUB333", status: "RECEBIDA", primeiroNome: "X", servico: "X", ubs: "X", mensagem: "X", atualizadoEm: TS(),
  });
  await assertFails(b.commit());
});

test("atendente muda status permitido; regulacao exige REGULADOR/ADMIN", async () => {
  const db = dbDe("lucas");
  await criarPerfil(db, "lucas");
  await batchPedido(db, "lucas", "2026-STA111").commit();

  function mudar(dbS, uid, status) {
    const b = dbS.batch();
    b.update(dbS.doc("solicitacoes/2026-STA111"), { status, mensagemPublica: "x", atualizadoEm: TS(), atualizadoPor: uid });
    b.update(dbS.doc(CONS + "2026-STA111"), { status, mensagem: "x", atualizadoEm: TS() });
    b.set(dbS.collection("solicitacoes/2026-STA111/historico").doc(), {
      usuario: uid, usuarioNome: uid, statusAnterior: "RECEBIDA", statusNovo: status, observacao: null, criadoEm: TS(),
    });
    return b.commit();
  }
  await assertSucceeds(mudar(dbDe("ate"), "ate", "EM_TRIAGEM"));
  await assertFails(mudar(dbDe("ate"), "ate", "AGENDADA"));
  await assertSucceeds(mudar(dbDe("adm"), "adm", "AGENDADA"));
  await assertFails(mudar(dbDe("lucas"), "lucas", "CONCLUIDA")); // municipe nao muda status
  await assertFails(mudar(dbDe("pend"), "pend", "EM_TRIAGEM")); // nao aprovado
  // servidor nao pode alterar dados do paciente
  await assertFails(dbDe("adm").doc("solicitacoes/2026-STA111").update({ paciente: "Outro" }));
});

test("marcacao: regulador grava data/hora/local; atendente e dados invalidos falham", async () => {
  const db = dbDe("lucas");
  await criarPerfil(db, "lucas");
  await batchPedido(db, "lucas", "2026-AGE111").commit();
  await semRegras((d) => d.doc("servidores/reg").set({ nome: "Reg", email: "reg@teste.com", matricula: "4", perfil: "REGULADOR", aprovado: true }));

  function marcar(dbS, uid, agendamento) {
    const b = dbS.batch();
    b.update(dbS.doc("solicitacoes/2026-AGE111"), { status: "AGENDADA", mensagemPublica: "Marcado", agendamento, atualizadoEm: TS(), atualizadoPor: uid });
    b.update(dbS.doc(CONS + "2026-AGE111"), { status: "AGENDADA", mensagem: "Marcado", agendamento, atualizadoEm: TS() });
    b.set(dbS.collection("solicitacoes/2026-AGE111/historico").doc(), {
      usuario: uid, usuarioNome: uid, statusAnterior: "RECEBIDA", statusNovo: "AGENDADA", observacao: null, criadoEm: TS(),
    });
    return b.commit();
  }
  const ok = { data: "2026-11-30", hora: "08:00", local: "UBS Família SQ 12 - Centro", profissional: "Cardiologia" };
  await assertFails(marcar(dbDe("ate"), "ate", ok));
  await assertFails(marcar(dbDe("reg"), "reg", Object.assign({}, ok, { hora: "8h" })));
  await assertFails(marcar(dbDe("reg"), "reg", Object.assign({}, ok, { extra: "x" })));
  await assertSucceeds(marcar(dbDe("reg"), "reg", ok));
  // visitante ve a marcacao na consulta publica
  const c = await env.unauthenticatedContext().firestore().doc(CONS + "2026-AGE111").get();
  if (c.get("agendamento.hora") !== "08:00") throw new Error("agendamento nao apareceu na consulta");
  // atendente pode mudar status sem mexer na marcacao, mas nao pode alterar a marcacao
  await assertSucceeds(dbDe("ate").doc("solicitacoes/2026-AGE111").update({ status: "CANCELADA", mensagemPublica: "x", atualizadoEm: TS(), atualizadoPor: "ate" }));
  await assertFails(dbDe("ate").doc("solicitacoes/2026-AGE111").update({ agendamento: null, atualizadoEm: TS() }));
});

test("prioridade da fila: so servidor aprovado le e grava; municipe nao ve nem do proprio pedido", async () => {
  const db = dbDe("lucas");
  await criarPerfil(db, "lucas");
  await batchPedido(db, "lucas", "2026-PRI111").commit();
  const prio = (uid, extra) => Object.assign({
    prioridade: "URGENTE", motivo: "Oncologia", definidoPor: uid, definidoPorNome: uid, definidoEm: TS(),
  }, extra);
  await assertSucceeds(dbDe("ate").doc("triagem/2026-PRI111").set(prio("ate")));
  await assertSucceeds(dbDe("adm").doc("triagem/2026-PRI111").get());
  // municipe (dono do pedido), visitante e servidor nao aprovado: nao leem nem gravam
  await assertFails(db.doc("triagem/2026-PRI111").get());
  await assertFails(db.collection("triagem").get());
  await assertFails(env.unauthenticatedContext().firestore().doc("triagem/2026-PRI111").get());
  await assertFails(db.doc("triagem/2026-PRI111").set(prio("lucas", { prioridade: "NORMAL" })));
  await assertFails(dbDe("pend").doc("triagem/2026-PRI111").set(prio("pend")));
  // valor invalido, autor falso ou pedido inexistente
  await assertFails(dbDe("ate").doc("triagem/2026-PRI111").set(prio("ate", { prioridade: "MAXIMA" })));
  await assertFails(dbDe("ate").doc("triagem/2026-PRI111").set(prio("adm")));
  await assertFails(dbDe("ate").doc("triagem/2026-NAOEXI").set(prio("ate")));
  // a consulta publica nao traz a prioridade
  const c = await env.unauthenticatedContext().firestore().doc(CONS + "2026-PRI111").get();
  if (c.get("prioridade") !== undefined) throw new Error("prioridade vazou na consulta publica");
});

test("municipe cancela o proprio pedido em aberto; nao cancela marcado nem pedido alheio", async () => {
  const db = dbDe("lucas");
  await criarPerfil(db, "lucas");
  await batchPedido(db, "lucas", "2026-CAN111").commit();
  await batchPedido(db, "lucas", "2026-CAN222").commit();
  function cancelar(dbX, uid, prot, statusAnterior, extra) {
    const b = dbX.batch();
    b.update(dbX.doc("solicitacoes/" + prot), Object.assign({ status: "CANCELADA", mensagemPublica: "Cancelado a pedido do munícipe.", atualizadoEm: TS() }, extra));
    b.update(dbX.doc(CONS + prot), { status: "CANCELADA", mensagem: "Cancelado a pedido do munícipe.", atualizadoEm: TS() });
    b.set(dbX.collection("solicitacoes/" + prot + "/historico").doc(), {
      usuario: uid, usuarioNome: uid, statusAnterior, statusNovo: "CANCELADA", observacao: "Cancelado pelo munícipe", criadoEm: TS(),
    });
    return b.commit();
  }
  await assertFails(cancelar(dbDe("intruso"), "intruso", "2026-CAN111", "RECEBIDA"));
  await assertFails(cancelar(db, "lucas", "2026-CAN111", "RECEBIDA", { ubs: "Outra" })); // nao pode mexer em outros campos
  await assertSucceeds(cancelar(db, "lucas", "2026-CAN111", "RECEBIDA"));
  // municipe nao pode "reabrir" nem mudar para outro status
  await assertFails(db.doc("solicitacoes/2026-CAN111").update({ status: "RECEBIDA", mensagemPublica: "x", atualizadoEm: TS() }));
  // depois de marcado, o cancelamento e com a UBS
  await semRegras((d) => d.doc("solicitacoes/2026-CAN222").update({ status: "AGENDADA" }));
  await assertFails(cancelar(db, "lucas", "2026-CAN222", "AGENDADA"));
});

test("status 'Nao compareceu' (FALTOU): qualquer servidor aprovado registra; municipe nao", async () => {
  const db = dbDe("lucas");
  await criarPerfil(db, "lucas");
  await batchPedido(db, "lucas", "2026-FAL111").commit();
  const faltou = (dbS, uid) => dbS.doc("solicitacoes/2026-FAL111").update({ status: "FALTOU", mensagemPublica: "x", atualizadoEm: TS(), atualizadoPor: uid });
  await assertFails(faltou(db, "lucas"));
  await assertSucceeds(faltou(dbDe("ate"), "ate"));
});

test("documentos extras: ate 3, so junto com o pedido, so dono e equipe leem", async () => {
  const db = dbDe("lucas");
  await criarPerfil(db, "lucas");
  const doc = { uid: "lucas", dados: "data:image/jpeg;base64,AAAA", tipo: "image/jpeg", nome: "exame.jpg", criadoEm: TS() };
  const b = batchPedido(db, "lucas", "2026-EXT111", { qtdExtras: 2 });
  b.set(db.doc("anexos/2026-EXT111/extras/1"), doc);
  b.set(db.doc("anexos/2026-EXT111/extras/2"), doc);
  await assertSucceeds(b.commit());
  await assertSucceeds(db.doc("anexos/2026-EXT111/extras/2").get());
  await assertSucceeds(dbDe("ate").collection("anexos/2026-EXT111/extras").get());
  await assertFails(dbDe("intruso").doc("anexos/2026-EXT111/extras/1").get());
  // depois de criado o pedido, nao da para acrescentar; e no maximo 3 (ids 1..3)
  await assertFails(db.doc("anexos/2026-EXT111/extras/3").set(doc));
  const b2 = batchPedido(db, "lucas", "2026-EXT222", { qtdExtras: 1 });
  b2.set(db.doc("anexos/2026-EXT222/extras/4"), doc);
  await assertFails(b2.commit());
  await assertFails(batchPedido(db, "lucas", "2026-EXT333", { qtdExtras: 9 }).commit());
});

// ---------------------------------------------------------------- atendimento presencial (balcao)
const BAL = { nome: "Dona Benedita Souza", cpf: "12312312312", sus: "", nascimento: "1940-02-10", telefone: "" };

function perfilBalcao(uidServidor, extra) {
  return Object.assign({}, BAL, {
    semConta: true, consentimentoLgpd: true, consentimentoPresencial: true,
    cadastradoPor: uidServidor, cadastradoPorNome: uidServidor, ubsCadastro: "UBS Família SQ 12 - Centro",
    criadoEm: TS(), atualizadoEm: TS(),
  }, extra);
}

/** O que o painel grava no balcao: (cadastro) + pedido + historico + consulta (+ prioridade). */
function batchBalcao(dbS, uidServidor, prot, pid, pessoa, opcoes) {
  const o = Object.assign({ criarPerfil: false, servicoId: "exames", cirurgia: undefined, anexo: false, prioridade: false }, opcoes);
  const b = dbS.batch();
  if (o.criarPerfil) b.set(dbS.doc("pacientes/" + pid), perfilBalcao(uidServidor));
  const sol = {
    protocolo: prot, uid: pid, paciente: pessoa.nome, cpf: pessoa.cpf, sus: pessoa.sus, nascimento: pessoa.nascimento,
    telefone: pessoa.telefone, ubsId: "ubs-sq12", ubs: "UBS Família SQ 12 - Centro",
    servicoId: o.servicoId, servico: o.servicoId === "cirurgia-eletiva" ? "Cirurgia Eletiva" : "Exames",
    status: "RECEBIDA", mensagemPublica: "Recebida", temAnexo: o.anexo, qtdExtras: 0, consentimentoLgpd: true,
    canal: "BALCAO", criadoPor: uidServidor, criadoPorNome: uidServidor, criadoEm: TS(), atualizadoEm: TS(),
  };
  if (o.cirurgia !== undefined) sol.cirurgia = o.cirurgia;
  b.set(dbS.doc("solicitacoes/" + prot), sol);
  b.set(dbS.collection("solicitacoes/" + prot + "/historico").doc(), {
    usuario: uidServidor, usuarioNome: uidServidor, statusAnterior: null, statusNovo: "RECEBIDA", observacao: "Atendimento presencial", criadoEm: TS(),
  });
  b.set(dbS.doc("consultas/" + pessoa.cpf + "/pedidos/" + prot), {
    protocolo: prot, status: "RECEBIDA", primeiroNome: pessoa.nome.split(" ")[0], servico: sol.servico, ubs: sol.ubs, mensagem: "Recebida", atualizadoEm: TS(),
  });
  if (o.anexo) b.set(dbS.doc("anexos/" + prot), { uid: pid, dados: "data:image/jpeg;base64,AAAA", tipo: "image/jpeg", nome: "guia.jpg", criadoEm: TS() });
  if (o.prioridade) b.set(dbS.doc("triagem/" + prot), { prioridade: "PRIORITARIO", motivo: "Idoso 80+", definidoPor: uidServidor, definidoPorNome: uidServidor, definidoEm: TS() });
  return b.commit();
}

test("balcao: servidor cadastra pessoa sem conta e faz o pedido por ela (com anexo e prioridade)", async () => {
  const dbA = dbDe("ate");
  await assertSucceeds(batchBalcao(dbA, "ate", "2026-BAL111", "balcao-12312312312", BAL, { criarPerfil: true, anexo: true, prioridade: true }));
  // a pessoa (ou familiar) acompanha pelo CPF, sem conta
  await assertSucceeds(env.unauthenticatedContext().firestore().doc("consultas/12312312312/pedidos/2026-BAL111").get());
  // segundo pedido para a mesma pessoa, ja cadastrada
  await assertSucceeds(batchBalcao(dbA, "ate", "2026-BAL222", "balcao-12312312312", BAL));
  // servidor corrige o telefone do cadastro de balcao
  await assertSucceeds(dbA.doc("pacientes/balcao-12312312312").update({ telefone: "61999990000", atualizadoEm: TS() }));
});

test("balcao: municipe e servidor nao aprovado nao usam; nao duplica quem ja tem conta; ID amarrado ao CPF", async () => {
  await assertFails(dbDe("lucas").doc("pacientes/balcao-12312312312").set(perfilBalcao("lucas")));
  await assertFails(dbDe("pend").doc("pacientes/balcao-12312312312").set(perfilBalcao("pend")));
  await assertFails(dbDe("ate").doc("pacientes/balcao-99999999999").set(perfilBalcao("ate"))); // ID != CPF
  await assertFails(dbDe("ate").doc("pacientes/balcao-12312312312").set(perfilBalcao("adm"))); // autor falso
  // quem ja tem conta no site: o servidor deve usar a conta, nao criar outro cadastro
  await criarPerfil(dbDe("lucas"), "lucas");
  await assertFails(dbDe("ate").doc("pacientes/balcao-52998224725").set(perfilBalcao("ate", { cpf: "52998224725" })));
  // ...e pode fazer o pedido presencial NA conta da pessoa
  await assertSucceeds(batchBalcao(dbDe("ate"), "ate", "2026-BAL333", "lucas", Object.assign({}, PAC)));
  // municipe nao finge ser balcao
  await assertFails(batchBalcao(dbDe("lucas"), "lucas", "2026-BAL444", "lucas", Object.assign({}, PAC)));
});

test("cirurgia eletiva: so a equipe abre, com procedimento e hospital; checklist do pre-operatorio", async () => {
  const db = dbDe("lucas");
  await criarPerfil(db, "lucas");
  // municipe nao abre cirurgia pelo site
  await assertFails(batchPedido(db, "lucas", "2026-CIR000", { servicoId: "cirurgia-eletiva", servico: "Cirurgia Eletiva" }).commit());
  const cir = { procedimento: "Catarata - olho direito", hospital: "Hospital Regional", preOp: { exames: false, riscoCirurgico: false, termo: false, orientado: false } };
  // sem os dados da cirurgia: falha; com: ok
  await assertFails(batchBalcao(dbDe("ate"), "ate", "2026-CIR111", "lucas", PAC, { servicoId: "cirurgia-eletiva" }));
  await assertSucceeds(batchBalcao(dbDe("ate"), "ate", "2026-CIR222", "lucas", PAC, { servicoId: "cirurgia-eletiva", cirurgia: cir }));
  // servidor marca o checklist do pre-operatorio
  const preOk = Object.assign({}, cir, { preOp: { exames: true, riscoCirurgico: true, termo: true, orientado: true } });
  await assertSucceeds(dbDe("ate").doc("solicitacoes/2026-CIR222").update({ status: "EM_TRIAGEM", mensagemPublica: "x", cirurgia: preOk, atualizadoEm: TS(), atualizadoPor: "ate" }));
  // nao pode apagar os dados da cirurgia nem por campo estranho
  await assertFails(dbDe("ate").doc("solicitacoes/2026-CIR222").update({ status: "EM_TRIAGEM", mensagemPublica: "x", cirurgia: null, atualizadoEm: TS(), atualizadoPor: "ate" }));
  await assertFails(dbDe("ate").doc("solicitacoes/2026-CIR222").update({ status: "EM_TRIAGEM", mensagemPublica: "x", cirurgia: Object.assign({}, cir, { valor: 1 }), atualizadoEm: TS(), atualizadoPor: "ate" }));
});

test("quem foi atendido no balcao e depois cria conta (mesmo CPF e nascimento) ve os pedidos da UBS", async () => {
  await batchBalcao(dbDe("ate"), "ate", "2026-VIN111", "balcao-12312312312", BAL, { criarPerfil: true });
  // Dona Benedita cria conta com o mesmo CPF e nascimento
  const db = dbDe("benedita");
  await assertSucceeds(criarPerfil(db, "benedita", { nome: BAL.nome, cpf: BAL.cpf, nascimento: BAL.nascimento }));
  await assertSucceeds(db.collection("solicitacoes").where("uid", "==", "balcao-12312312312").where("nascimento", "==", BAL.nascimento).get());
  // outra pessoa com nascimento diferente nao ve
  const intr = dbDe("intruso");
  await semRegras((d) => d.doc("pacientes/intruso").set(perfilPaciente({ cpf: "12312312312", nascimento: "1990-01-01" })));
  await assertFails(intr.collection("solicitacoes").where("uid", "==", "balcao-12312312312").where("nascimento", "==", BAL.nascimento).get());
});

// ---------------------------------------------------------------- profissionais, agendas e vagas
const PROF = {
  nome: "Dra. Ana Lima", especialidade: "Cardiologia", registro: "CRM-GO 12345", servicoId: "consulta-especializada",
  local: "Policlínica Municipal", diasSemana: [2, 4], horaInicio: "07:00", horaFim: "11:00", duracaoMin: 20, ativo: true,
};
const AGENDA = {
  servicoId: "consulta-especializada", servico: "Consulta Médica Especializada", local: "Policlínica Municipal",
  data: "2026-11-10", horaInicio: "07:00", intervaloMin: 20, vagas: 2, profissionalId: "ana", profissionalNome: "Dra. Ana Lima",
  especialidade: "Cardiologia", orientacoes: "",
};

/** Marca o pedido na vaga n da agenda (o que o painel grava). */
function marcar(dbS, uid, prot, aid, n, extraAg) {
  const b = dbS.batch();
  const ag = Object.assign({ data: "2026-11-10", hora: "07:00", local: "Policlínica Municipal", profissional: "Dra. Ana Lima", agendaId: aid, vaga: n }, extraAg);
  b.update(dbS.doc("solicitacoes/" + prot), { status: "AGENDADA", mensagemPublica: "Marcado", agendamento: ag, atualizadoEm: TS(), atualizadoPor: uid });
  b.set(dbS.doc("agendas/" + aid + "/vagas/" + n), { protocolo: prot, paciente: "Lucas", hora: "07:00", marcadoPor: uid, marcadoEm: TS() });
  return b.commit();
}

test("profissionais e agendas: so regulador/admin cadastram; atendente so le", async () => {
  await semRegras((d) => d.doc("servidores/reg").set({ nome: "Reg", email: "reg@teste.com", matricula: "4", perfil: "REGULADOR", aprovado: true }));
  const prof = (uid) => Object.assign({}, PROF, { atualizadoPor: uid, atualizadoEm: TS() });
  await assertFails(dbDe("ate").doc("profissionais/ana").set(prof("ate")));
  await assertSucceeds(dbDe("reg").doc("profissionais/ana").set(prof("reg")));
  await assertFails(dbDe("reg").doc("profissionais/x").set(Object.assign(prof("reg"), { duracaoMin: 1 })));
  await assertSucceeds(dbDe("ate").doc("profissionais/ana").get());
  await assertFails(dbDe("lucas").doc("profissionais/ana").get());
  const ag = (uid) => Object.assign({}, AGENDA, { criadoPor: uid, criadoPorNome: uid, criadoEm: TS() });
  await assertFails(dbDe("ate").doc("agendas/a1").set(ag("ate")));
  await assertSucceeds(dbDe("reg").doc("agendas/a1").set(ag("reg")));
  await assertFails(dbDe("reg").doc("agendas/a2").set(Object.assign(ag("reg"), { vagas: 0 })));
  await assertFails(env.unauthenticatedContext().firestore().doc("agendas/a1").get());
});

test("profissionais: editar, ferias e desativar; nunca apagar", async () => {
  await semRegras((d) => d.doc("servidores/reg").set({ nome: "Reg", email: "reg@teste.com", matricula: "4", perfil: "REGULADOR", aprovado: true }));
  const prof = (extra) => Object.assign({}, PROF, { atualizadoPor: "reg", atualizadoEm: TS() }, extra);
  await assertSucceeds(dbDe("reg").doc("profissionais/ana").set(prof({})));
  await assertSucceeds(dbDe("reg").doc("profissionais/ana").set(prof({ local: "UBS Centro", feriasInicio: "2026-12-01", feriasFim: "2026-12-20", feriasMotivo: "Férias" })));
  await assertFails(dbDe("reg").doc("profissionais/ana").set(prof({ feriasInicio: "01/12/2026" })));
  await assertSucceeds(dbDe("reg").doc("profissionais/ana").set(prof({ ativo: false, inativoDesde: "2026-11-01" })));
  await assertFails(dbDe("reg").doc("profissionais/ana").delete());
  await assertFails(dbDe("adm").doc("profissionais/ana").delete());
});

test("vagas: marca o pedido na vaga; nao repete vaga; nao passa do limite; libera a vaga", async () => {
  await semRegras(async (d) => {
    await d.doc("servidores/reg").set({ nome: "Reg", email: "reg@teste.com", matricula: "4", perfil: "REGULADOR", aprovado: true });
    await d.doc("agendas/a1").set(Object.assign({}, AGENDA, { criadoPor: "reg", criadoPorNome: "reg", criadoEm: new Date() }));
  });
  const db = dbDe("lucas");
  await criarPerfil(db, "lucas");
  await batchPedido(db, "lucas", "2026-VAG111").commit();
  await batchPedido(db, "lucas", "2026-VAG222").commit();
  await batchPedido(db, "lucas", "2026-VAG333").commit();
  await assertFails(marcar(dbDe("ate"), "ate", "2026-VAG111", "a1", 0));           // atendente nao marca
  await assertSucceeds(marcar(dbDe("reg"), "reg", "2026-VAG111", "a1", 0));
  await assertFails(marcar(dbDe("reg"), "reg", "2026-VAG222", "a1", 0));            // vaga 0 ja ocupada
  await assertFails(marcar(dbDe("reg"), "reg", "2026-VAG222", "a1", 2));            // agenda tem 2 vagas (0 e 1)
  await assertFails(marcar(dbDe("reg"), "reg", "2026-VAG222", "a1", 1, { vaga: 0 })); // pedido aponta outra vaga
  await assertSucceeds(marcar(dbDe("reg"), "reg", "2026-VAG222", "a1", 1));
  // liberar a vaga 0 e marcar outra pessoa nela
  await assertSucceeds(dbDe("reg").doc("agendas/a1/vagas/0").delete());
  await assertSucceeds(marcar(dbDe("reg"), "reg", "2026-VAG333", "a1", 0));
  await assertFails(dbDe("lucas").doc("agendas/a1/vagas/1").get());
});

test("pedido de acesso de servidor entra como nao aprovado; so ADMIN aprova", async () => {
  const novo = dbDe("novo", "novo@prefeitura.gov.br");
  const pedido = { nome: "Novo Servidor", email: "novo@prefeitura.gov.br", matricula: "99", perfil: "ATENDENTE", aprovado: false, criadoEm: TS() };
  await assertFails(novo.doc("servidores/novo").set(Object.assign({}, pedido, { aprovado: true })));
  await assertFails(novo.doc("servidores/novo").set(Object.assign({}, pedido, { perfil: "ADMIN" })));
  await assertSucceeds(novo.doc("servidores/novo").set(pedido));
  await assertFails(novo.doc("servidores/novo").update({ aprovado: true }));
  await assertFails(dbDe("ate").doc("servidores/novo").update({ aprovado: true }));
  await assertFails(dbDe("ate").collection("servidores").get());
  await assertSucceeds(dbDe("adm").collection("servidores").get());
  await assertSucceeds(dbDe("adm").doc("servidores/novo").update({ aprovado: true, perfil: "REGULADOR", aprovadoPor: "adm", atualizadoEm: TS() }));
});
