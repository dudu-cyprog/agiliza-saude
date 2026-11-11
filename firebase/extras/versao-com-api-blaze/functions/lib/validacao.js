"use strict";

const { UBS, SERVICOS } = require("./catalogo");

function soDigitos(v) {
  return String(v == null ? "" : v).replace(/\D/g, "");
}

function texto(v) {
  return String(v == null ? "" : v).trim();
}

/** Aceita somente AAAA-MM-DD de uma data real, nao futura e >= 1900. Devolve a string ou null. */
function parseData(v) {
  const s = texto(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  if (ano < 1900 || d.getTime() > Date.now()) return null;
  return s;
}

/** Identifica se o texto da consulta e protocolo (2026-00042) ou cartao SUS (15 digitos). */
function identificarConsulta(v) {
  let s = texto(v);
  if (s.startsWith("#")) s = s.slice(1);
  if (/^\d{4}-\d{4,6}$/.test(s)) return { tipo: "protocolo", valor: s };
  const d = soDigitos(s);
  if (d.length === 15) return { tipo: "sus", valor: d };
  return null;
}

/** Valida os campos do formulario de nova solicitacao. Devolve {erro} ou {dados}. */
function validarNovaSolicitacao(c) {
  const nome = texto(c.nome).replace(/\s+/g, " ");
  const sus = soDigitos(c.sus);
  const telefone = soDigitos(c.telefone);
  const nascimento = parseData(c.nascimento);
  const ubs = UBS.find((u) => u.id === texto(c.ubsId));
  const servico = SERVICOS.find((s) => s.id === texto(c.servicoId));

  if (nome.length < 3 || nome.length > 120) return { erro: "Informe o nome completo." };
  if (sus.length !== 15) return { erro: "O Cartão SUS deve ter 15 dígitos." };
  if (!nascimento) return { erro: "Data de nascimento inválida." };
  if (telefone.length < 10 || telefone.length > 11) return { erro: "Informe um telefone com DDD." };
  if (!ubs || !servico) return { erro: "Selecione a UBS e o serviço." };
  if (texto(c.lgpd) !== "true") return { erro: "É necessário aceitar o Termo de Consentimento (LGPD)." };

  return { dados: { nome, sus, nascimento, telefone, ubs, servico } };
}

/** Identifica o tipo pelo CONTEUDO (magic bytes), nunca pelo nome/Content-Type enviados. */
function detectarTipo(b) {
  if (!Buffer.isBuffer(b)) return null;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: ".jpg" };
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: "image/png", ext: ".png" };
  }
  if (b.length >= 5 && b.subarray(0, 5).toString("latin1") === "%PDF-") return { mime: "application/pdf", ext: ".pdf" };
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") {
    return { mime: "image/webp", ext: ".webp" };
  }
  return null;
}

function limparNome(original) {
  if (!original) return "anexo";
  const base = String(original).replace(/\\/g, "/").split("/").pop().replace(/[^\w.\- ]/g, "_");
  return base.slice(0, 100) || "anexo";
}

module.exports = { soDigitos, texto, parseData, identificarConsulta, validarNovaSolicitacao, detectarTipo, limparNome };
