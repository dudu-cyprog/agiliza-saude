"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../lib/validacao");
const RateLimiter = require("../lib/ratelimit");

const formOk = {
  nome: "Lucas Ferreira Mendes",
  sus: "700.1234.5678.9012",
  nascimento: "1998-05-14",
  telefone: "(61) 98712-3456",
  ubsId: "ubs-sq12",
  servicoId: "tfd",
  lgpd: "true",
};

test("parseData aceita datas reais e rejeita invalidas", () => {
  assert.equal(V.parseData("1998-05-14"), "1998-05-14");
  assert.equal(V.parseData("1998-02-30"), null);
  assert.equal(V.parseData("2999-01-01"), null);
  assert.equal(V.parseData("1800-01-01"), null);
  assert.equal(V.parseData("14/05/1998"), null);
  assert.equal(V.parseData(undefined), null);
});

test("identificarConsulta separa protocolo de cartao SUS", () => {
  assert.deepEqual(V.identificarConsulta("2026-0842"), { tipo: "protocolo", valor: "2026-0842" });
  assert.deepEqual(V.identificarConsulta("#2026-00042"), { tipo: "protocolo", valor: "2026-00042" });
  assert.deepEqual(V.identificarConsulta("700.1234.5678.9012"), { tipo: "sus", valor: "700123456789012" });
  assert.equal(V.identificarConsulta("123"), null);
  assert.equal(V.identificarConsulta(""), null);
});

test("validarNovaSolicitacao aceita formulario correto e normaliza", () => {
  const r = V.validarNovaSolicitacao(formOk);
  assert.equal(r.erro, undefined);
  assert.equal(r.dados.sus, "700123456789012");
  assert.equal(r.dados.telefone, "61987123456");
  assert.equal(r.dados.ubs.nome, "UBS Família SQ 12 - Centro");
  assert.equal(r.dados.servico.nome, "Transporte Sanitário (TFD)");
});

test("validarNovaSolicitacao rejeita cada campo invalido", () => {
  const casos = [
    [{ nome: "Al" }, /nome/i],
    [{ sus: "123" }, /SUS/],
    [{ nascimento: "2999-01-01" }, /nascimento/i],
    [{ telefone: "123" }, /telefone/i],
    [{ ubsId: "inexistente" }, /UBS/],
    [{ servicoId: "x" }, /servi/i],
    [{ lgpd: "false" }, /LGPD/],
  ];
  for (const [alteracao, regex] of casos) {
    const r = V.validarNovaSolicitacao({ ...formOk, ...alteracao });
    assert.match(r.erro, regex, JSON.stringify(alteracao));
  }
});

test("detectarTipo usa o conteudo e nao o nome", () => {
  assert.equal(V.detectarTipo(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])).mime, "image/jpeg");
  assert.equal(V.detectarTipo(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])).mime, "image/png");
  assert.equal(V.detectarTipo(Buffer.from("%PDF-1.7 ...")).mime, "application/pdf");
  assert.equal(V.detectarTipo(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")).mime, "image/webp");
  assert.equal(V.detectarTipo(Buffer.from("<script>alert(1)</script>")), null);
  assert.equal(V.detectarTipo(Buffer.from("MZ executavel")), null);
});

test("limparNome remove caminho e caracteres perigosos", () => {
  assert.equal(V.limparNome("C:\\fakepath\\guia médica.pdf"), "guia m_dica.pdf");
  assert.equal(V.limparNome("../../etc/passwd"), "passwd");
  assert.equal(V.limparNome(""), "anexo");
});

test("RateLimiter bloqueia apos o maximo", () => {
  const r = new RateLimiter(2, 1000);
  assert.equal(r.permitir("a"), true);
  assert.equal(r.permitir("a"), true);
  assert.equal(r.permitir("a"), false);
  assert.equal(r.permitir("b"), true);
});
