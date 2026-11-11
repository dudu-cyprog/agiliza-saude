"use strict";

// UBS e servicos ficam no codigo: sao dados de referencia que quase nunca mudam.
const UBS = [
  { id: "ubs-sq12", nome: "UBS Família SQ 12 - Centro", endereco: "SQ 10 QD 27 A E, S/N - Centro", horario: "07:30 às 17:00" },
  { id: "ubs-ocidental-park", nome: "UBS Família Ocidental Park", endereco: "Rua 32 QD 27 A E 17 - Ocidental Park", horario: "07:30 às 17:00" },
  { id: "ubs-friburgo-a", nome: "UBS Família Friburgo A", endereco: null, horario: "07:30 às 17:00" },
  { id: "ubs-parque-araguari", nome: "UBS Família Parque Araguari", endereco: null, horario: "07:30 às 17:00" },
  { id: "ubs-jardim-abc", nome: "UBS Família Jardim ABC", endereco: null, horario: "07:30 às 17:00" },
  { id: "ubs-estrela-dalva-3", nome: "UBS Família Parque Estrela Dalva III", endereco: "Quadra 109, Lote 09 - Estrela Dalva III", horario: "07:30 às 17:00" },
];

const SERVICOS = [
  { id: "consulta-especializada", nome: "Consulta Médica Especializada", descricao: "Cardiologia, ortopedia e oftalmologia." },
  { id: "exames", nome: "Exames de Imagem e Laboratório", descricao: "Ultrassonografia, raio-X e sangue." },
  { id: "tfd", nome: "Transporte Sanitário (TFD)", descricao: "Viagens para tratamento em Goiânia/DF." },
  { id: "medicamentos", nome: "Medicamentos da Farmácia Básica", descricao: "Remédios de uso contínuo na farmácia." },
];

module.exports = { UBS, SERVICOS };
