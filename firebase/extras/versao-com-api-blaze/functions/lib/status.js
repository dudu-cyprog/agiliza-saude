"use strict";

// exigeRegulador: somente perfis REGULADOR/ADMIN podem aplicar o status.
const STATUS = {
  RECEBIDA: { rotulo: "Recebida", exigeRegulador: false, mensagem: "Solicitação recebida. Aguardando triagem." },
  EM_TRIAGEM: { rotulo: "Em Triagem", exigeRegulador: false, mensagem: "Solicitação em triagem pela equipe da UBS." },
  EM_ANALISE_REGULACAO: { rotulo: "Em Regulação", exigeRegulador: false, mensagem: "Solicitação em análise pela regulação médica." },
  AGENDADA: { rotulo: "Agendada", exigeRegulador: true, mensagem: "Atendimento agendado. Aguarde contato da UBS." },
  CONCLUIDA: { rotulo: "Concluída", exigeRegulador: true, mensagem: "Atendimento concluído." },
  NEGADA: { rotulo: "Não autorizada", exigeRegulador: true, mensagem: "Solicitação não autorizada. Procure sua UBS de referência." },
  CANCELADA: { rotulo: "Cancelada", exigeRegulador: false, mensagem: "Solicitação cancelada." },
};

const PERFIS = ["ATENDENTE", "REGULADOR", "ADMIN"];
const PERFIS_REGULADOR = ["REGULADOR", "ADMIN"];

module.exports = { STATUS, PERFIS, PERFIS_REGULADOR };
