"use strict";

const crypto = require("crypto");
const express = require("express");
const busboy = require("busboy");
const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https");

const { UBS, SERVICOS } = require("./lib/catalogo");
const { STATUS, PERFIS, PERFIS_REGULADOR } = require("./lib/status");
const V = require("./lib/validacao");
const RateLimiter = require("./lib/ratelimit");

admin.initializeApp();
const db = admin.firestore();
const { FieldValue } = require("firebase-admin/firestore");

const LIMITE_ARQUIVO = 5 * 1024 * 1024;
const limiteConsulta = new RateLimiter(15, 10 * 60 * 1000);
const limiteSolicitacao = new RateLimiter(10, 10 * 60 * 1000);

function bucket() {
  const cfg = JSON.parse(process.env.FIREBASE_CONFIG || "{}");
  const nome = cfg.storageBucket || `${process.env.GCLOUD_PROJECT}.appspot.com`;
  return admin.storage().bucket(nome);
}

class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

const rota = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Ano e data conforme o horario de Brasilia (o servidor roda em UTC). */
function anoBrasilia() {
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric" }).format(new Date()));
}

function iso(ts) {
  return ts && ts.toDate ? ts.toDate().toISOString() : null;
}

function lerMultipart(req) {
  return new Promise((resolve, reject) => {
    let bb;
    try {
      bb = busboy({ headers: req.headers, limits: { fileSize: LIMITE_ARQUIVO, files: 1, fields: 20 } });
    } catch (e) {
      return reject(new ErroHttp(400, "Formulário inválido."));
    }
    const campos = {};
    let arquivo = null;
    let estourou = false;
    bb.on("field", (nome, valor) => {
      campos[nome] = valor;
    });
    bb.on("file", (nome, stream, info) => {
      const partes = [];
      stream.on("data", (d) => partes.push(d));
      stream.on("limit", () => {
        estourou = true;
      });
      stream.on("end", () => {
        if (nome === "guia") arquivo = { buffer: Buffer.concat(partes), nome: info.filename };
      });
    });
    bb.on("error", () => reject(new ErroHttp(400, "Formulário inválido.")));
    bb.on("close", () => {
      if (estourou) reject(new ErroHttp(413, "Arquivo muito grande (máximo 5 MB)."));
      else resolve({ campos, arquivo });
    });
    bb.end(req.rawBody);
  });
}

function visaoPainel(d) {
  const x = d.data();
  return {
    id: d.id,
    protocolo: x.protocolo,
    status: x.status,
    statusRotulo: STATUS[x.status] ? STATUS[x.status].rotulo : x.status,
    paciente: x.paciente,
    cartaoSus: x.sus,
    telefone: x.telefone,
    nascimento: x.nascimento,
    servico: x.servico,
    ubs: x.ubs,
    mensagemPublica: x.mensagemPublica,
    temAnexo: !!x.anexo,
    criadoEm: iso(x.criadoEm),
    atualizadoEm: iso(x.atualizadoEm),
  };
}

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));

// ---------------------------------------------------------------- publico
app.get("/api/catalogo", (req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  res.json({ ubs: UBS, servicos: SERVICOS });
});

app.post(
  "/api/consulta",
  rota(async (req, res) => {
    if (!limiteConsulta.permitir(req.ip)) throw new ErroHttp(429, "Muitas tentativas. Aguarde alguns minutos e tente novamente.");

    const ident = V.identificarConsulta((req.body || {}).identificador);
    if (!ident) throw new ErroHttp(400, "Informe o Cartão SUS (15 dígitos) ou o número do protocolo.");
    const nasc = V.parseData((req.body || {}).nascimento);
    if (!nasc) throw new ErroHttp(400, "Data de nascimento inválida.");

    let docs = [];
    if (ident.tipo === "protocolo") {
      const d = await db.collection("solicitacoes").doc(ident.valor).get();
      if (d.exists) docs = [d];
    } else {
      docs = (await db.collection("solicitacoes").where("sus", "==", ident.valor).limit(50).get()).docs;
    }
    // Mesma resposta para "nao existe" e "data errada": nao revela quais cartoes existem.
    docs = docs
      .filter((d) => d.get("nascimento") === nasc)
      .sort((a, b) => b.get("criadoEm").toMillis() - a.get("criadoEm").toMillis())
      .slice(0, 10);
    if (!docs.length) throw new ErroHttp(404, "Nenhuma solicitação encontrada para os dados informados.");

    // Visao publica: sem telefone, cartao SUS ou anexo.
    res.set("Cache-Control", "no-store");
    res.json({
      solicitacoes: docs.map((d) => {
        const x = d.data();
        return {
          protocolo: x.protocolo,
          status: x.status,
          statusRotulo: STATUS[x.status] ? STATUS[x.status].rotulo : x.status,
          paciente: x.paciente,
          servico: x.servico,
          ubs: x.ubs,
          mensagem: x.mensagemPublica,
          criadoEm: iso(x.criadoEm),
          atualizadoEm: iso(x.atualizadoEm),
        };
      }),
    });
  })
);

app.post(
  "/api/solicitacoes",
  rota(async (req, res) => {
    if (!limiteSolicitacao.permitir(req.ip)) throw new ErroHttp(429, "Muitas solicitações em pouco tempo. Tente novamente mais tarde.");

    const { campos, arquivo } = await lerMultipart(req);
    const v = V.validarNovaSolicitacao(campos);
    if (v.erro) throw new ErroHttp(400, v.erro);
    const d = v.dados;

    if (!arquivo || !arquivo.buffer.length) throw new ErroHttp(400, "Anexe a foto ou PDF do pedido/encaminhamento.");
    const tipo = V.detectarTipo(arquivo.buffer);
    if (!tipo) throw new ErroHttp(400, "Arquivo inválido. Envie JPG, PNG, WEBP ou PDF.");

    const caminho = `anexos/${crypto.randomUUID()}${tipo.ext}`;
    await bucket().file(caminho).save(arquivo.buffer, { contentType: tipo.mime, resumable: false });

    try {
      const ano = anoBrasilia();
      const protocolo = await db.runTransaction(async (tx) => {
        const refPac = db.collection("pacientes").doc(d.sus);
        const refCont = db.collection("meta").doc("contador");
        const [pac, cont] = await Promise.all([tx.get(refPac), tx.get(refCont)]);

        if (pac.exists && pac.get("nascimento") !== d.nascimento) {
          throw new ErroHttp(409, "Os dados informados divergem do cadastro existente. Procure sua UBS de referência.");
        }
        const seq = cont.exists && cont.get("ano") === ano ? cont.get("seq") + 1 : 1;
        const prot = `${ano}-${String(seq).padStart(5, "0")}`;

        tx.set(refCont, { ano, seq });
        if (pac.exists) {
          tx.update(refPac, { telefone: d.telefone, atualizadoEm: FieldValue.serverTimestamp() });
        } else {
          tx.set(refPac, { nome: d.nome, nascimento: d.nascimento, telefone: d.telefone, criadoEm: FieldValue.serverTimestamp() });
        }
        const refSol = db.collection("solicitacoes").doc(prot);
        tx.set(refSol, {
          protocolo: prot,
          sus: d.sus,
          nascimento: d.nascimento,
          paciente: d.nome,
          telefone: d.telefone,
          ubs: d.ubs.nome,
          ubsId: d.ubs.id,
          servico: d.servico.nome,
          servicoId: d.servico.id,
          status: "RECEBIDA",
          mensagemPublica: STATUS.RECEBIDA.mensagem,
          anexo: { path: caminho, tipo: tipo.mime, nomeOriginal: V.limparNome(arquivo.nome) },
          consentimentoLgpd: true,
          criadoEm: FieldValue.serverTimestamp(),
          atualizadoEm: FieldValue.serverTimestamp(),
        });
        tx.set(refSol.collection("historico").doc(), {
          usuario: null,
          statusAnterior: null,
          statusNovo: "RECEBIDA",
          observacao: "Solicitação criada pelo munícipe",
          criadoEm: FieldValue.serverTimestamp(),
        });
        return prot;
      });
      res.status(201).json({ protocolo });
    } catch (e) {
      await bucket().file(caminho).delete().catch(() => {});
      throw e;
    }
  })
);

// ---------------------------------------------------------------- painel
async function exigirServidor(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.get("Authorization") || "");
  if (!m) return res.status(401).json({ erro: "Sessão expirada. Faça login novamente." });
  try {
    const t = await admin.auth().verifyIdToken(m[1]);
    // Perfil: custom claim (scripts/criar-servidor.js) ou documento servidores/{uid} criado no Console do Firestore.
    let perfil = t.perfil;
    if (!PERFIS.includes(perfil)) {
      const s = await db.collection("servidores").doc(t.uid).get();
      perfil = s.exists ? s.get("perfil") : null;
    }
    if (!PERFIS.includes(perfil)) return res.status(403).json({ erro: "Seu usuário não tem acesso ao painel." });
    req.usuario = { uid: t.uid, nome: t.name || t.email, email: t.email, perfil };
    return next();
  } catch (e) {
    return res.status(401).json({ erro: "Sessão expirada. Faça login novamente." });
  }
}

const painel = express.Router();
painel.use(exigirServidor);
painel.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

painel.get("/me", (req, res) => res.json({ nome: req.usuario.nome, perfil: req.usuario.perfil }));

painel.get("/status", (req, res) => {
  const mapa = {};
  Object.keys(STATUS).forEach((k) => (mapa[k] = STATUS[k].rotulo));
  res.json(mapa);
});

painel.get(
  "/solicitacoes",
  rota(async (req, res) => {
    const status = V.texto(req.query.status);
    if (status && !STATUS[status]) throw new ErroHttp(400, "Status inválido.");
    const q = V.texto(req.query.q).slice(0, 60).toLowerCase();
    const qDigitos = V.soDigitos(q);

    // Busca as 300 mais recentes e filtra em memoria (evita indices compostos no Firestore).
    const snap = await db.collection("solicitacoes").orderBy("criadoEm", "desc").limit(300).get();
    let lista = snap.docs;
    if (status) lista = lista.filter((d) => d.get("status") === status);
    if (q) {
      lista = lista.filter((d) => {
        const x = d.data();
        return (
          x.protocolo.toLowerCase().includes(q) ||
          String(x.paciente).toLowerCase().includes(q) ||
          (qDigitos.length >= 3 && String(x.sus).includes(qDigitos))
        );
      });
    }
    res.json({ solicitacoes: lista.slice(0, 200).map(visaoPainel) });
  })
);

painel.get(
  "/anexo",
  rota(async (req, res) => {
    const id = V.texto(req.query.id);
    if (!/^\d{4}-\d{4,6}$/.test(id)) throw new ErroHttp(400, "Identificador inválido.");
    const d = await db.collection("solicitacoes").doc(id).get();
    const anexo = d.exists ? d.get("anexo") : null;
    if (!anexo) throw new ErroHttp(404, "Anexo não encontrado.");

    const ext = anexo.path.slice(anexo.path.lastIndexOf("."));
    res.set({
      "Content-Type": anexo.tipo,
      "Content-Disposition": `inline; filename="anexo-${id}${ext}"`,
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
    bucket()
      .file(anexo.path)
      .createReadStream()
      .on("error", () => {
        if (!res.headersSent) res.status(404).json({ erro: "Anexo não encontrado." });
        else res.end();
      })
      .pipe(res);
  })
);

painel.post(
  "/solicitacoes/status",
  rota(async (req, res) => {
    const b = req.body || {};
    const id = V.texto(b.id);
    const novo = STATUS[b.status];
    if (!/^\d{4}-\d{4,6}$/.test(id) || !novo) throw new ErroHttp(400, "Dados incompletos ou status inválido.");
    const msgPublica = V.texto(b.mensagemPublica);
    const obs = V.texto(b.observacao);
    if (msgPublica.length > 500 || obs.length > 500) throw new ErroHttp(400, "Texto muito longo (máximo 500 caracteres).");
    if (novo.exigeRegulador && !PERFIS_REGULADOR.includes(req.usuario.perfil)) {
      throw new ErroHttp(403, "Apenas a regulação pode aplicar este status.");
    }

    const ref = db.collection("solicitacoes").doc(id);
    await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists) throw new ErroHttp(404, "Solicitação não encontrada.");
      tx.update(ref, { status: b.status, mensagemPublica: msgPublica || novo.mensagem, atualizadoEm: FieldValue.serverTimestamp() });
      tx.set(ref.collection("historico").doc(), {
        usuario: req.usuario.uid,
        usuarioNome: req.usuario.nome,
        statusAnterior: s.get("status"),
        statusNovo: b.status,
        observacao: obs || null,
        criadoEm: FieldValue.serverTimestamp(),
      });
    });
    res.json({ ok: true });
  })
);

app.use("/api/painel", painel);

app.use("/api", (req, res) => res.status(404).json({ erro: "Não encontrado." }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof ErroHttp) return res.status(err.status).json({ erro: err.message });
  if (err && err.type === "entity.parse.failed") return res.status(400).json({ erro: "Requisição inválida." });
  console.error("Erro nao tratado:", err);
  return res.status(500).json({ erro: "Erro interno. Tente novamente." });
});

exports.api = onRequest({ region: "southamerica-east1", maxInstances: 10 }, app);
