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
admin.initializeApp({ projectId: "demo-agiliza" });
const db = admin.firestore();

async function usuario(email, senha, nome) {
  try {
    return await admin.auth().getUserByEmail(email);
  } catch (e) {
    return admin.auth().createUser({ email, password: senha, displayName: nome });
  }
}

async function main() {
  const agora = admin.firestore.Timestamp.now();

  const adm = await usuario("servidor@cidadeocidental.go.gov.br", "saude2026", "Servidor Demonstração");
  await db.collection("servidores").doc(adm.uid).set({
    nome: "Servidor Demonstração", email: adm.email, matricula: "0001",
    perfil: "ADMIN", aprovado: true, criadoEm: agora,
  });

  // Segundo login do Painel CRM (e-mail ficticio, so existe no emulador)
  const crm = await usuario("agiliza.crm.teste@gmail.com", "12345678", "Equipe CRM Teste");
  await db.collection("servidores").doc(crm.uid).set({
    nome: "Equipe CRM Teste", email: crm.email, matricula: "0002",
    perfil: "ADMIN", aprovado: true, criadoEm: agora,
  });

  const cpf = "52998224725"; // CPF de teste (valido, ficticio)
  const pac = await usuario("lucas@exemplo.com", "saude2026", "Lucas Ferreira Mendes");
  await db.collection("pacientes").doc(pac.uid).set({
    nome: "Lucas Ferreira Mendes", cpf, sus: "700123456789012", nascimento: "1998-05-14",
    telefone: "61987123456", email: pac.email, consentimentoLgpd: true, criadoEm: agora, atualizadoEm: agora,
  });
  await db.collection("logins").doc(cpf).set(Object.assign({ uid: pac.uid }, await cifrarEmail(pac.email, "saude2026")));

  const prot = "2026-DEMO42";
  const ref = db.collection("solicitacoes").doc(prot);
  await ref.set({
    protocolo: prot, uid: pac.uid, paciente: "Lucas Ferreira Mendes", cpf, sus: "700123456789012",
    nascimento: "1998-05-14", telefone: "61987123456",
    ubsId: "ubs-sq12", ubs: "UBS Família SQ 12 - Centro",
    servicoId: "consulta-especializada", servico: "Consulta Médica Especializada",
    status: "EM_TRIAGEM", mensagemPublica: "Solicitação em triagem pela equipe da UBS.",
    temAnexo: false, consentimentoLgpd: true, criadoEm: agora, atualizadoEm: agora,
  });
  await ref.collection("historico").add({
    usuario: pac.uid, usuarioNome: "Lucas Ferreira Mendes", statusAnterior: null, statusNovo: "RECEBIDA",
    observacao: "Solicitação criada pelo munícipe", criadoEm: agora,
  });
  await db.collection("consultas").doc(cpf).collection("pedidos").doc(prot).set({
    protocolo: prot, status: "EM_TRIAGEM", primeiroNome: "Lucas",
    servico: "Consulta Médica Especializada", ubs: "UBS Família SQ 12 - Centro",
    mensagem: "Solicitação em triagem pela equipe da UBS.", atualizadoEm: agora,
  });

  // Pedidos com datas antigas para demonstrar o "tempo de espera" no painel
  const diasAtras = (d) => admin.firestore.Timestamp.fromMillis(Date.now() - d * 24 * 60 * 60 * 1000);
  const extras = [
    { prot: "2026-ESP003", dias: 3, status: "RECEBIDA", servicoId: "exames", servico: "Exames de Imagem e Laboratório" },
    { prot: "2026-ESP020", dias: 20, status: "EM_TRIAGEM", servicoId: "tfd", servico: "Transporte Sanitário (TFD)" },
    { prot: "2026-ESP045", dias: 45, status: "EM_ANALISE_REGULACAO", servicoId: "consulta-especializada", servico: "Consulta Médica Especializada" },
    { prot: "2026-ESP012", dias: 12, status: "AGENDADA", servicoId: "exames", servico: "Exames de Imagem e Laboratório", ateDias: 4,
      agendamento: { data: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10), hora: "08:00", local: "UBS Família SQ 12 - Centro" } },
    { prot: "2026-ESP060", dias: 60, status: "CONCLUIDA", servicoId: "medicamentos", servico: "Medicamentos da Farmácia Básica", ateDias: 25 },
    { prot: "2026-ESP090", dias: 90, status: "FALTOU", servicoId: "consulta-especializada", servico: "Consulta Médica Especializada", ateDias: 50 },
    { prot: "2026-ESP075", dias: 75, status: "CONCLUIDA", servicoId: "exames", servico: "Exames de Imagem e Laboratório", ateDias: 55 },
  ];
  for (const e of extras) {
    const atualizado = diasAtras(e.ateDias != null ? e.ateDias : e.dias);
    const dados = {
      protocolo: e.prot, uid: pac.uid, paciente: "Lucas Ferreira Mendes", cpf, sus: "700123456789012",
      nascimento: "1998-05-14", telefone: "61987123456", ubsId: "ubs-sq12", ubs: "UBS Família SQ 12 - Centro",
      servicoId: e.servicoId, servico: e.servico, status: e.status, mensagemPublica: "Pedido de demonstração.",
      temAnexo: false, consentimentoLgpd: true, criadoEm: diasAtras(e.dias), atualizadoEm: atualizado,
    };
    if (e.agendamento) dados.agendamento = e.agendamento;
    await db.collection("solicitacoes").doc(e.prot).set(dados);
    await db.collection("consultas").doc(cpf).collection("pedidos").doc(e.prot).set({
      protocolo: e.prot, status: e.status, primeiroNome: "Lucas", servico: e.servico, ubs: dados.ubs,
      mensagem: dados.mensagemPublica, atualizadoEm: atualizado,
    });
  }

  // Prioridade interna (so a equipe ve)
  await db.collection("triagem").doc("2026-ESP020").set({
    prioridade: "URGENTE", motivo: "Oncologia", definidoPor: adm.uid, definidoPorNome: "Servidor Demonstração", definidoEm: agora,
  });
  await db.collection("triagem").doc("2026-ESP003").set({
    prioridade: "PRIORITARIO", motivo: "Gestante", definidoPor: adm.uid, definidoPorNome: "Servidor Demonstração", definidoEm: agora,
  });

  // ---------------------------------------------------------------- 100 perfis ficticios
  const { gerarPerfis, SERVIDORES_FAKES } = require("./perfis-fakes");
  const TS = (d) => admin.firestore.Timestamp.fromDate(d);
  const pessoas = gerarPerfis(100);
  for (let i = 0; i < pessoas.length; i += 10) {
    await Promise.all(pessoas.slice(i, i + 10).map(async (p) => {
      const u = await usuario(p.email, "saude2026", p.nome);
      const batch = db.batch();
      const criado = TS(p.pedidos[p.pedidos.length - 1].criadoEm);
      batch.set(db.collection("pacientes").doc(u.uid), {
        nome: p.nome, cpf: p.cpf, sus: p.sus, nascimento: p.nascimento, telefone: p.telefone, email: p.email,
        consentimentoLgpd: true, criadoEm: criado, atualizadoEm: criado,
      });
      batch.set(db.collection("logins").doc(p.cpf), Object.assign({ uid: u.uid }, await cifrarEmail(p.email, "saude2026")));
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
          observacao: "Solicitação criada pelo munícipe", criadoEm: TS(s.criadoEm),
        });
        const cons = {
          protocolo: s.protocolo, status: s.status, primeiroNome: p.nome.split(" ")[0], servico: s.servico.nome,
          ubs: s.ubs.nome, mensagem: s.mensagem, atualizadoEm: TS(s.atualizadoEm),
        };
        if (s.agendamento) cons.agendamento = s.agendamento;
        batch.set(db.collection("consultas").doc(p.cpf).collection("pedidos").doc(s.protocolo), cons);
        if (s.prioridade !== "NORMAL") {
          batch.set(db.collection("triagem").doc(s.protocolo), {
            prioridade: s.prioridade, motivo: s.motivo, definidoPor: adm.uid,
            definidoPorNome: "Servidor Demonstração", definidoEm: TS(new Date(s.criadoEm.getTime() + 864e5)),
          });
        }
      }
      await batch.commit();
    }));
  }
  for (const s of SERVIDORES_FAKES) {
    const u = await usuario(s.email, "saude2026", s.nome);
    await db.collection("servidores").doc(u.uid).set({
      nome: s.nome, email: s.email, matricula: s.matricula, perfil: s.perfil, aprovado: s.aprovado, criadoEm: agora,
    });
  }

  // ---------------------------------------------------------------- profissionais e agendas ficticios
  const PROFS = [
    { id: "ana-lima", nome: "Dra. Ana Lima", especialidade: "Cardiologia", registro: "CRM-GO 12345", servicoId: "consulta-especializada", local: "Policlínica Municipal", diasSemana: [2, 4], horaInicio: "07:00", horaFim: "11:00", duracaoMin: 20 },
    { id: "joao-pereira", nome: "Dr. João Pereira", especialidade: "Ortopedia", registro: "CRM-GO 23456", servicoId: "consulta-especializada", local: "Policlínica Municipal", diasSemana: [1, 3], horaInicio: "13:00", horaFim: "17:00", duracaoMin: 20 },
    { id: "carla-mendes", nome: "Dra. Carla Mendes", especialidade: "Oftalmologia", registro: "CRM-GO 34567", servicoId: "consulta-especializada", local: "Policlínica Municipal", diasSemana: [5], horaInicio: "07:00", horaFim: "12:00", duracaoMin: 15 },
    { id: "beatriz-rocha", nome: "Dra. Beatriz Rocha", especialidade: "Pediatria", registro: "CRM-GO 56789", servicoId: "consulta-especializada", local: "UBS Família Ocidental Park", diasSemana: [1, 4], horaInicio: "08:00", horaFim: "12:00", duracaoMin: 20 },
    { id: "marcos-tavares", nome: "Dr. Marcos Tavares", especialidade: "Neurologia", registro: "CRM-GO 67890", servicoId: "consulta-especializada", local: "Policlínica Municipal", diasSemana: [2], horaInicio: "13:00", horaFim: "17:00", duracaoMin: 30 },
    { id: "juliana-castro", nome: "Dra. Juliana Castro", especialidade: "Ginecologia e Obstetrícia", registro: "CRM-GO 78901", servicoId: "consulta-especializada", local: "UBS Família SQ 12 - Centro", diasSemana: [3, 5], horaInicio: "07:30", horaFim: "11:30", duracaoMin: 20 },
    { id: "renato-alves", nome: "Dr. Renato Alves", especialidade: "Dermatologia", registro: "CRM-GO 89012", servicoId: "consulta-especializada", local: "Policlínica Municipal", diasSemana: [4], horaInicio: "13:00", horaFim: "16:00", duracaoMin: 20 },
    { id: "fernanda-lopes", nome: "Dra. Fernanda Lopes", especialidade: "Psiquiatria", registro: "CRM-GO 90123", servicoId: "consulta-especializada", local: "CAPS - Centro de Atenção Psicossocial", diasSemana: [1, 3], horaInicio: "08:00", horaFim: "12:00", duracaoMin: 40 },
    { id: "ricardo-nunes", nome: "Dr. Ricardo Nunes", especialidade: "Endocrinologia", registro: "CRM-GO 01234", servicoId: "consulta-especializada", local: "Policlínica Municipal", diasSemana: [5], horaInicio: "13:00", horaFim: "17:00", duracaoMin: 20 },
    { id: "imagem-municipal", nome: "Centro de Imagem Municipal", especialidade: "Ultrassonografia", registro: "", servicoId: "exames", local: "Policlínica Municipal", diasSemana: [2, 4], horaInicio: "13:00", horaFim: "16:00", duracaoMin: 15 },
    { id: "lab-municipal", nome: "Laboratório Municipal", especialidade: "Laboratório", registro: "", servicoId: "exames", local: "UBS Família SQ 12 - Centro", diasSemana: [1, 2, 3, 4, 5], horaInicio: "07:00", horaFim: "09:00", duracaoMin: 10 },
    { id: "paulo-souza", nome: "Dr. Paulo Souza", especialidade: "Cirurgia geral", registro: "CRM-GO 45678", servicoId: "cirurgia-eletiva", local: "Hospital Regional de Luziânia", diasSemana: [3], horaInicio: "07:00", horaFim: "13:00", duracaoMin: 120 },
  ];
  const min = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3));
  const nomeServico = { "consulta-especializada": "Consulta Médica Especializada", exames: "Exames de Imagem e Laboratório", "cirurgia-eletiva": "Cirurgia Eletiva" };
  let qtdAgendas = 0;
  // demonstracao: um medico com ferias na semana que vem e um que nao trabalha mais (desativado, dados guardados)
  const iso = (dias) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + dias); return d.toISOString().slice(0, 10); };
  PROFS.find((p) => p.id === "renato-alves").ferias = { feriasInicio: iso(7), feriasFim: iso(20), feriasMotivo: "Férias" };
  PROFS.push({ id: "antonio-silva", nome: "Dr. Antônio Silva", especialidade: "Urologia", registro: "CRM-GO 11223", servicoId: "consulta-especializada",
    local: "Policlínica Municipal", diasSemana: [2], horaInicio: "08:00", horaFim: "12:00", duracaoMin: 20, inativo: true });
  for (const p of PROFS) {
    const { id, ferias, inativo, ...dados } = p;   // o id vira o nome do documento (nao um campo)
    await db.collection("profissionais").doc(p.id).set(Object.assign({}, dados,
      { feriasInicio: "", feriasFim: "", feriasMotivo: "" }, ferias || {},
      { ativo: !inativo, inativoDesde: inativo ? iso(-30) : "", atualizadoPor: adm.uid, atualizadoEm: agora }));
    if (inativo) continue;
    for (let i = 1; i <= 14; i++) {
      const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + i);
      if (!p.diasSemana.includes(d.getDay())) continue;
      const data = d.toISOString().slice(0, 10);
      if (ferias && data >= ferias.feriasInicio && data <= ferias.feriasFim) continue;
      await db.collection("agendas").doc(`prof-${p.id}-${data}`).set({
        servicoId: p.servicoId, servico: nomeServico[p.servicoId], local: p.local, data, horaInicio: p.horaInicio,
        intervaloMin: p.duracaoMin, vagas: Math.floor((min(p.horaFim) - min(p.horaInicio)) / p.duracaoMin),
        profissionalId: p.id, profissionalNome: p.nome, especialidade: p.especialidade, orientacoes: "",
        criadoPor: adm.uid, criadoPorNome: "Servidor Demonstração", criadoEm: agora,
      });
      qtdAgendas++;
    }
  }
  // mutirão (agenda avulsa) de ultrassom no próximo sábado, para demonstrar "Preencher com a fila"
  const sab = new Date(); sab.setHours(12, 0, 0, 0); sab.setDate(sab.getDate() + ((6 - sab.getDay() + 7) % 7 || 7));
  await db.collection("agendas").doc("mutirao-ultrassom").set({
    servicoId: "exames", servico: "Exames de Imagem e Laboratório", local: "UBS Família Ocidental Park",
    data: sab.toISOString().slice(0, 10), horaInicio: "07:00", intervaloMin: 15, vagas: 20,
    profissionalId: "", profissionalNome: "", especialidade: "", orientacoes: "Mutirão de ultrassonografia. Jejum de 6 horas.",
    criadoPor: adm.uid, criadoPorNome: "Servidor Demonstração", criadoEm: agora,
  });
  qtdAgendas++;

  console.log("Seed concluido:");
  console.log(`  + ${PROFS.length} profissionais ficticios e ${qtdAgendas} agendas (proximas 2 semanas + mutirao de ultrassom no sabado)`);
  console.log(`  + ${pessoas.length} cidadaos ficticios (${pessoas.reduce((t, p) => t + p.pedidos.length, 0)} pedidos) e ${SERVIDORES_FAKES.length} servidores ficticios`);
  console.log("    lista completa: dados-demo/perfis-fakes.csv (todos com a senha saude2026)");
  console.log("  Servidor ADMIN: servidor@cidadeocidental.go.gov.br / saude2026");
  console.log("  Painel CRM 2:   agiliza.crm.teste@gmail.com / 12345678");
  console.log("  Municipe:       CPF 529.982.247-25 (ou lucas@exemplo.com) / saude2026");
  console.log("  Consulta:       CPF 529.982.247-25");
}

/** Mesmo algoritmo de public/js/comum.js (PBKDF2 + AES-GCM). */
async function cifrarEmail(email, senha) {
  const { subtle } = globalThis.crypto;
  const b64 = (b) => Buffer.from(b).toString("base64");
  const sal = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const base = await subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveKey"]);
  const chave = await subtle.deriveKey({ name: "PBKDF2", salt: sal, iterations: 150000, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const cifra = await subtle.encrypt({ name: "AES-GCM", iv }, chave, new TextEncoder().encode(email));
  return { cifra: b64(cifra), iv: b64(iv), sal: b64(sal) };
}

main().catch((e) => {
  console.error("Falhou. Os emuladores estao ligados? (npm run emuladores)\n", e.message);
  process.exit(1);
});
