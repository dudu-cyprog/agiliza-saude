"use strict";

/**
 * Gera perfis FICTICIOS e variados para demonstracao (emulador e MySQL de teste).
 * Sempre gera os mesmos dados (gerador aleatorio com semente fixa), para a
 * apresentacao ser repetivel. NUNCA use estes dados no site publicado.
 *
 *   node scripts/perfis-fakes.js          -> gera dados-demo/perfis-fakes.csv e dados-demo/dados_demo_100.sql
 */
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------- aleatorio com semente
function criarSorteio(semente) {
  let a = semente >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.int = (min, max) => min + Math.floor(r() * (max - min + 1));
  r.item = (lista) => lista[Math.floor(r() * lista.length)];
  r.peso = (pares) => { // [[valor, peso], ...]
    const total = pares.reduce((t, [, p]) => t + p, 0);
    let x = r() * total;
    for (const [v, p] of pares) { if ((x -= p) < 0) return v; }
    return pares[pares.length - 1][0];
  };
  return r;
}

// ---------------------------------------------------------------- nomes (diversos)
const NOMES_F = ["Ana", "Maria", "Francisca", "Antônia", "Adriana", "Juliana", "Márcia", "Fernanda", "Patrícia", "Aline",
  "Sandra", "Camila", "Amanda", "Bruna", "Jéssica", "Letícia", "Júlia", "Luciana", "Vanessa", "Mariana", "Gabriela",
  "Raimunda", "Josefa", "Conceição", "Iracema", "Jaciara", "Potira", "Yasmin", "Kauane", "Thaís", "Beatriz", "Larissa",
  "Keiko", "Akemi", "Samira", "Leila", "Dandara", "Zuleide", "Rosângela", "Lúcia", "Sofia", "Helena", "Valentina", "Alice"];
const NOMES_M = ["José", "João", "Antônio", "Francisco", "Carlos", "Paulo", "Pedro", "Lucas", "Luiz", "Marcos",
  "Luís", "Gabriel", "Rafael", "Daniel", "Marcelo", "Bruno", "Eduardo", "Felipe", "Raimundo", "Rodrigo", "Sebastião",
  "Manoel", "Benedito", "Moacir", "Ubirajara", "Raoni", "Kauã", "Hiroshi", "Kenji", "Jamal", "Samir", "Wellington",
  "Cauã", "Davi", "Arthur", "Heitor", "Miguel", "Enzo", "Thiago", "Severino", "Valdomiro", "Igor", "Otávio", "Bernardo"];
const SOBRENOMES = ["Silva", "Santos", "Oliveira", "Souza", "Rodrigues", "Ferreira", "Alves", "Pereira", "Lima", "Gomes",
  "Costa", "Ribeiro", "Martins", "Carvalho", "Almeida", "Lopes", "Soares", "Fernandes", "Vieira", "Barbosa", "Rocha",
  "Dias", "Nascimento", "Andrade", "Moreira", "Nunes", "Marques", "Machado", "Mendes", "Freitas", "Cardoso", "Ramos",
  "Gonçalves", "Santana", "Teixeira", "Batista", "Guajajara", "Terena", "Tanaka", "Yamamoto", "Haddad", "Nasser",
  "dos Anjos", "de Jesus", "Conceição", "Xavier", "Aragão", "Bezerra", "Cavalcante", "Brandão"];

// ---------------------------------------------------------------- catalogo (mesmos ids do site)
const UBS = [
  { id: "ubs-sq12", idSql: 1, nome: "UBS Família SQ 12 - Centro" },
  { id: "ubs-ocidental-park", idSql: 2, nome: "UBS Família Ocidental Park" },
  { id: "ubs-friburgo-a", idSql: 3, nome: "UBS Família Friburgo A" },
  { id: "ubs-parque-araguari", idSql: 4, nome: "UBS Família Parque Araguari" },
  { id: "ubs-jardim-abc", idSql: 5, nome: "UBS Família Jardim ABC" },
  { id: "ubs-estrela-dalva-3", idSql: 6, nome: "UBS Família Parque Estrela Dalva III" },
];
const SERVICOS = [
  { id: "consulta-especializada", idSql: 1, nome: "Consulta Médica Especializada" },
  { id: "exames", idSql: 2, nome: "Exames de Imagem e Laboratório" },
  { id: "tfd", idSql: 3, nome: "Transporte Sanitário (TFD)" },
  { id: "medicamentos", idSql: 4, nome: "Medicamentos da Farmácia Básica" },
];
const MENSAGENS = {
  RECEBIDA: "Solicitação recebida. Aguardando triagem.",
  EM_TRIAGEM: "Solicitação em triagem pela equipe da UBS.",
  EM_ANALISE_REGULACAO: "Solicitação em análise pela regulação médica.",
  AGENDADA: "Atendimento agendado. Aguarde contato da UBS.",
  CONCLUIDA: "Atendimento concluído.",
  NEGADA: "Solicitação não autorizada. Procure sua UBS de referência.",
  CANCELADA: "Solicitação cancelada.",
  FALTOU: "Você não compareceu ao atendimento marcado. Procure sua UBS para remarcar.",
};
const ESPECIALIDADES = ["Cardiologia", "Ortopedia", "Oftalmologia", "Dermatologia", "Neurologia", "Endocrinologia", "Ginecologia"];

// ---------------------------------------------------------------- CPF ficticio: 11 numeros aleatorios
function gerarCpf(r, usados) {
  for (;;) {
    const cpf = Array.from({ length: 11 }, () => r.int(0, 9)).join("");
    if (!usados.has(cpf)) { usados.add(cpf); return cpf; }
  }
}

function semAcento(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
}

function dataIso(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * @param {number} qtd quantidade de cidadaos
 * @param {Date} hoje data de referencia (para "dias atras")
 */
function gerarPerfis(qtd = 100, hoje = new Date()) {
  const r = criarSorteio(20261030);
  const cpfs = new Set(["52998224725", "11144477735"]); // ja usados nos dados fixos
  const pessoas = [];
  let seqPedido = 0;

  for (let i = 0; i < qtd; i++) {
    const sexo = r() < 0.53 ? "F" : "M";
    const primeiro = r.item(sexo === "F" ? NOMES_F : NOMES_M);
    const sobrenome1 = r.item(SOBRENOMES);
    let sobrenome2 = r.item(SOBRENOMES);
    if (sobrenome2 === sobrenome1) sobrenome2 = r.item(SOBRENOMES);
    const nome = r() < 0.35 ? `${primeiro} ${r.item(sexo === "F" ? NOMES_F : NOMES_M)} ${sobrenome1} ${sobrenome2}` : `${primeiro} ${sobrenome1} ${sobrenome2}`;

    // faixa etaria variada: criancas, adultos, idosos 60+ e 80+
    const idadeAlvo = r.peso([[r.int(1, 11), 10], [r.int(12, 17), 6], [r.int(18, 39), 30], [r.int(40, 59), 24], [r.int(60, 79), 22], [r.int(80, 98), 8]]);
    const nasc = new Date(Date.UTC(hoje.getUTCFullYear() - idadeAlvo, r.int(0, 11), r.int(1, 28)));
    // idade real na data de hoje (o aniversario pode ainda nao ter chegado)
    let idade = hoje.getUTCFullYear() - nasc.getUTCFullYear();
    if (hoje.getUTCMonth() < nasc.getUTCMonth() || (hoje.getUTCMonth() === nasc.getUTCMonth() && hoje.getUTCDate() < nasc.getUTCDate())) idade--;
    const cpf = gerarCpf(r, cpfs);
    const sus = "7" + String(r.int(10000000, 99999999)) + String(r.int(100000, 999999));
    const telefone = "61" + "9" + String(r.int(81000000, 99999999));
    const email = `${semAcento(primeiro)}.${semAcento(sobrenome1)}.${i + 1}@example.com`; // dominio reservado (nao existe)
    const ubs = r.peso([[UBS[0], 25], [UBS[1], 20], [UBS[2], 15], [UBS[3], 12], [UBS[4], 13], [UBS[5], 15]]);
    const gestante = sexo === "F" && idade >= 16 && idade <= 42 && r() < 0.15;
    const pcd = r() < 0.06;

    // 1 a 3 pedidos por pessoa, com datas e situacoes variadas
    const pedidos = [];
    const qtdPedidos = r.peso([[1, 55], [2, 33], [3, 12]]);
    for (let k = 0; k < qtdPedidos; k++) {
      seqPedido++;
      const dias = r.peso([[r.int(0, 7), 30], [r.int(8, 20), 25], [r.int(21, 45), 22], [r.int(46, 90), 15], [r.int(91, 160), 8]]);
      const servico = idade < 12 ? r.item([SERVICOS[0], SERVICOS[1]]) : r.peso([[SERVICOS[0], 35], [SERVICOS[1], 35], [SERVICOS[2], 12], [SERVICOS[3], 18]]);
      // pedidos antigos tendem a estar resolvidos; recentes, em aberto
      const status = dias < 8
        ? r.peso([["RECEBIDA", 60], ["EM_TRIAGEM", 30], ["CANCELADA", 5], ["EM_ANALISE_REGULACAO", 5]])
        : dias < 30
          ? r.peso([["EM_TRIAGEM", 25], ["EM_ANALISE_REGULACAO", 30], ["AGENDADA", 25], ["RECEBIDA", 10], ["NEGADA", 5], ["CANCELADA", 5]])
          : r.peso([["EM_ANALISE_REGULACAO", 18], ["AGENDADA", 17], ["CONCLUIDA", 35], ["FALTOU", 12], ["NEGADA", 8], ["CANCELADA", 5], ["EM_TRIAGEM", 5]]);
      const aberto = ["RECEBIDA", "EM_TRIAGEM", "EM_ANALISE_REGULACAO"].includes(status);
      const diasAteAtualizar = aberto ? r.int(0, dias) : r.int(Math.floor(dias / 3), dias);
      const criadoEm = new Date(hoje.getTime() - dias * 864e5 - r.int(0, 10) * 3600e3);
      const atualizadoEm = status === "RECEBIDA" ? criadoEm : new Date(criadoEm.getTime() + diasAteAtualizar * 864e5);

      // prioridade interna: prioridade legal + alguns casos clinicos
      let prioridade = "NORMAL";
      let motivo = null;
      if (r() < 0.05) { prioridade = "URGENTE"; motivo = r.item(["Oncologia", "Risco clínico (avaliação médica)", "Retorno de tratamento em andamento"]); }
      else if (idade >= 80) { prioridade = "PRIORITARIO"; motivo = "Idoso 80+ (prioridade legal)"; }
      else if (gestante) { prioridade = "PRIORITARIO"; motivo = "Gestante"; }
      else if (pcd) { prioridade = "PRIORITARIO"; motivo = "Pessoa com deficiência"; }
      else if (idade >= 60 && r() < 0.5) { prioridade = "PRIORITARIO"; motivo = "Idoso 60+ (prioridade legal)"; }
      else if (idade <= 1 && r() < 0.6) { prioridade = "PRIORITARIO"; motivo = "Criança de colo"; }

      let agendamento = null;
      if (["AGENDADA", "CONCLUIDA", "FALTOU"].includes(status)) {
        const dAtend = status === "AGENDADA" ? r.int(1, 30) : -r.int(1, Math.max(1, dias - diasAteAtualizar));
        const data = new Date(hoje.getTime() + dAtend * 864e5);
        agendamento = {
          data: dataIso(data),
          hora: String(r.int(7, 16)).padStart(2, "0") + ":" + r.item(["00", "15", "30", "45"]),
          local: servico.id === "tfd" ? "Saída: " + ubs.nome : (servico.id === "consulta-especializada" ? "Policlínica Municipal" : ubs.nome),
          ...(servico.id === "consulta-especializada" ? { profissional: r.item(ESPECIALIDADES) } : {}),
          ...(servico.id === "exames" && r() < 0.5 ? { orientacoes: "Jejum de 8 horas." } : {}),
        };
      }

      pedidos.push({
        protocolo: `2026-D${String(seqPedido).padStart(4, "0")}`,
        ubs, servico, status, mensagem: MENSAGENS[status],
        prioridade, motivo, agendamento,
        criadoEm, atualizadoEm, dias,
      });
    }

    pessoas.push({
      nome, sexo, idade, nascimento: dataIso(nasc), cpf, sus, telefone, email, ubs,
      perfil: [idade >= 80 ? "idoso 80+" : idade >= 60 ? "idoso 60+" : idade < 12 ? "criança" : idade < 18 ? "adolescente" : "adulto",
        gestante ? "gestante" : null, pcd ? "PcD" : null].filter(Boolean).join(", "),
      pedidos,
    });
  }
  return pessoas;
}

// Equipe ficticia (servidores) para demonstrar perfis e aprovacao
const SERVIDORES_FAKES = [
  { nome: "Ana Paula Regulação", email: "ana.regulacao@example.com", matricula: "1101", perfil: "REGULADOR", aprovado: true },
  { nome: "Carlos Atendente", email: "carlos.atendente@example.com", matricula: "1102", perfil: "ATENDENTE", aprovado: true },
  { nome: "Juliana Triagem", email: "juliana.triagem@example.com", matricula: "1103", perfil: "ATENDENTE", aprovado: true },
  { nome: "Roberto Coordenação", email: "roberto.coordenacao@example.com", matricula: "1104", perfil: "ADMIN", aprovado: true },
  { nome: "Fernanda Nova (aguardando)", email: "fernanda.nova@example.com", matricula: "1105", perfil: "ATENDENTE", aprovado: false },
  { nome: "Marcos Novo (aguardando)", email: "marcos.novo@example.com", matricula: "1106", perfil: "ATENDENTE", aprovado: false },
];

// ---------------------------------------------------------------- saidas: CSV e SQL
function sqlTexto(v) {
  return v == null ? "NULL" : "'" + String(v).replace(/\\/g, "\\\\").replace(/'/g, "''") + "'";
}
function sqlData(d) {
  return "'" + d.toISOString().slice(0, 19).replace("T", " ") + "'";
}

function gerarSql(pessoas) {
  const l = [];
  l.push("-- =====================================================================");
  l.push("-- 100 perfis FICTICIOS para demonstracao (gerado por scripts/perfis-fakes.js)");
  l.push("-- Rode DEPOIS do agiliza_saude.sql:  mysql -u root -p agiliza_saude < dados_demo_100.sql");
  l.push("-- CPFs com 11 numeros aleatorios (ficticios); e-mails no dominio reservado example.com.");
  l.push("-- =====================================================================");
  l.push("USE agiliza_saude;");
  l.push("SET NAMES utf8mb4;");
  l.push("START TRANSACTION;");
  l.push("");
  for (const p of pessoas) {
    l.push(`INSERT INTO paciente (nome, cpf, cartao_sus, data_nascimento, telefone) VALUES (${sqlTexto(p.nome)}, '${p.cpf}', '${p.sus}', '${p.nascimento}', '${p.telefone}');`);
    l.push("SET @pac = LAST_INSERT_ID();");
    for (const s of p.pedidos) {
      const prioPor = s.prioridade !== "NORMAL" ? "1" : "NULL";
      const prioEm = s.prioridade !== "NORMAL" ? sqlData(new Date(s.criadoEm.getTime() + 864e5)) : "NULL";
      l.push(`INSERT INTO solicitacao (protocolo, paciente_id, ubs_id, servico_id, status, mensagem_publica, prioridade, prioridade_motivo, prioridade_por, prioridade_em, consentimento_lgpd, data_consentimento, criado_em, atualizado_em) VALUES ('${s.protocolo}', @pac, ${s.ubs.idSql}, ${s.servico.idSql}, '${s.status}', ${sqlTexto(s.mensagem)}, '${s.prioridade}', ${sqlTexto(s.motivo)}, ${prioPor}, ${prioEm}, 1, ${sqlData(s.criadoEm)}, ${sqlData(s.criadoEm)}, ${sqlData(s.atualizadoEm)});`);
      l.push(`INSERT INTO historico_solicitacao (solicitacao_id, usuario_id, status_anterior, status_novo, observacao, criado_em) VALUES (LAST_INSERT_ID(), NULL, NULL, 'RECEBIDA', 'Solicitação criada pelo munícipe', ${sqlData(s.criadoEm)});`);
    }
  }
  l.push("");
  l.push("COMMIT;");
  return l.join("\n") + "\n";
}

function gerarCsv(pessoas) {
  const cab = ["Nome", "Sexo", "Idade", "Perfil", "Nascimento", "CPF", "Cartão SUS", "Telefone", "E-mail (login)", "UBS",
    "Qtd pedidos", "Protocolos", "Situações", "Prioridades"];
  const cel = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const mascCpf = (c) => c.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  const linhas = pessoas.map((p) => [p.nome, p.sexo, p.idade, p.perfil, p.nascimento.split("-").reverse().join("/"), mascCpf(p.cpf),
    p.sus, p.telefone, p.email, p.ubs.nome, p.pedidos.length, p.pedidos.map((s) => s.protocolo).join(" "),
    p.pedidos.map((s) => s.status).join(" "), p.pedidos.map((s) => s.prioridade).join(" ")]);
  return "﻿" + [cab, ...linhas].map((l) => l.map(cel).join(";")).join("\r\n") + "\r\n";
}

/** Mesmo algoritmo de public/js/comum.js (PBKDF2 + AES-GCM): e-mail cifrado para o login por CPF. */
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

module.exports = { gerarPerfis, SERVIDORES_FAKES, gerarSql, gerarCsv, cifrarEmail };

if (require.main === module) {
  const pessoas = gerarPerfis(100);
  const pasta = path.join(__dirname, "..", "dados-demo");
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, "perfis-fakes.csv"), gerarCsv(pessoas));
  fs.writeFileSync(path.join(pasta, "dados_demo_100.sql"), gerarSql(pessoas));
  const pedidos = pessoas.flatMap((p) => p.pedidos);
  const conta = (f) => pedidos.reduce((m, s) => ((m[f(s)] = (m[f(s)] || 0) + 1), m), {});
  console.log(`${pessoas.length} pessoas, ${pedidos.length} pedidos`);
  console.log("faixas:", pessoas.reduce((m, p) => ((m[p.perfil.split(",")[0]] = (m[p.perfil.split(",")[0]] || 0) + 1), m), {}));
  console.log("status:", conta((s) => s.status));
  console.log("prioridade:", conta((s) => s.prioridade));
  console.log("UBS:", conta((s) => s.ubs.nome.replace("UBS Família ", "")));
  console.log("arquivos em dados-demo/: perfis-fakes.csv, dados_demo_100.sql");
}
