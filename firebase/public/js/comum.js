// =====================================================================
// Dados de referencia e funcoes usadas pelo site e pelo painel.
// =====================================================================

const UBS = [
  { id: "ubs-sq12", nome: "UBS Família SQ 12 - Centro", endereco: "SQ 10 QD 27 A E, S/N - Centro", horario: "07:30 às 17:00" },
  { id: "ubs-ocidental-park", nome: "UBS Família Ocidental Park", endereco: "Rua 32 QD 27 A E 17 - Ocidental Park", horario: "07:30 às 17:00" },
  { id: "ubs-friburgo-a", nome: "UBS Família Friburgo A", endereco: null, horario: "07:30 às 17:00" },
  { id: "ubs-parque-araguari", nome: "UBS Família Parque Araguari", endereco: null, horario: "07:30 às 17:00" },
  { id: "ubs-jardim-abc", nome: "UBS Família Jardim ABC", endereco: null, horario: "07:30 às 17:00" },
  { id: "ubs-estrela-dalva-3", nome: "UBS Família Parque Estrela Dalva III", endereco: "Quadra 109, Lote 09 - Estrela Dalva III", horario: "07:30 às 17:00" }
];

const SERVICOS = [
  { id: "consulta-especializada", nome: "Consulta Médica Especializada", descricao: "Cardiologia, ortopedia, oftalmologia e outras especialidades." },
  { id: "exames", nome: "Exames de Imagem e Laboratório", descricao: "Ultrassonografia, raio-X e sangue." },
  { id: "tfd", nome: "Transporte Sanitário (TFD)", descricao: "Viagens para tratamento em Goiânia/DF." },
  { id: "medicamentos", nome: "Medicamentos da Farmácia Básica", descricao: "Remédios de uso contínuo na farmácia." },
  // aberta somente pela equipe (atendimento presencial), a partir de encaminhamento médico
  { id: "cirurgia-eletiva", nome: "Cirurgia Eletiva", descricao: "Cirurgias programadas (não urgentes).", somenteEquipe: true }
];

// Sugestoes para o atendimento presencial (o servidor pode digitar outro valor)
const PROCEDIMENTOS_CIRURGIA = ["Catarata", "Hérnia inguinal", "Retirada de vesícula (colecistectomia)", "Laqueadura",
  "Vasectomia", "Retirada de amígdalas", "Varizes", "Prótese de joelho", "Prótese de quadril", "Correção de fimose"];
const HOSPITAIS_REFERENCIA = ["Hospital Municipal de Cidade Ocidental", "Hospital Regional de Luziânia",
  "Hospital Estadual de Formosa", "Hospital Regional do Gama (DF)", "HUB - Hospital Universitário de Brasília (DF)"];
// Especialidades oferecidas no cadastro de profissionais (o regulador pode digitar outra)
const ESPECIALIDADES = ["Cardiologia", "Ortopedia", "Oftalmologia", "Dermatologia", "Neurologia", "Pediatria",
  "Ginecologia e Obstetrícia", "Psiquiatria", "Endocrinologia", "Urologia", "Otorrinolaringologia", "Gastroenterologia",
  "Pneumologia", "Reumatologia", "Nefrologia", "Geriatria", "Angiologia / Vascular", "Oncologia", "Infectologia",
  "Mastologia", "Proctologia", "Cirurgia geral", "Clínica médica", "Psicologia", "Nutrição", "Fisioterapia",
  "Fonoaudiologia", "Odontologia", "Ultrassonografia", "Raio-X", "Tomografia", "Mamografia", "Eletrocardiograma", "Laboratório"];
const ITENS_PREOP = { exames: "Exames pré-operatórios", riscoCirurgico: "Risco cirúrgico", termo: "Termo de consentimento", orientado: "Paciente orientado" };

// exigeRegulador: somente REGULADOR/ADMIN podem aplicar (as regras do Firestore conferem).
const STATUS = {
  RECEBIDA: { rotulo: "Recebida", cor: "bg-secondary", exigeRegulador: false, mensagem: "Solicitação recebida. Aguardando triagem." },
  EM_TRIAGEM: { rotulo: "Em Triagem", cor: "bg-warning text-dark", exigeRegulador: false, mensagem: "Solicitação em triagem pela equipe da UBS." },
  EM_ANALISE_REGULACAO: { rotulo: "Em Regulação", cor: "bg-info text-dark", exigeRegulador: false, mensagem: "Solicitação em análise pela regulação médica." },
  AGENDADA: { rotulo: "Agendada", cor: "bg-primary", exigeRegulador: true, mensagem: "Atendimento agendado. Aguarde contato da UBS." },
  CONCLUIDA: { rotulo: "Concluída", cor: "bg-success", exigeRegulador: true, mensagem: "Atendimento concluído." },
  NEGADA: { rotulo: "Não autorizada", cor: "bg-danger", exigeRegulador: true, mensagem: "Solicitação não autorizada. Procure sua UBS de referência." },
  CANCELADA: { rotulo: "Cancelada", cor: "bg-dark", exigeRegulador: false, mensagem: "Solicitação cancelada." },
  FALTOU: { rotulo: "Não compareceu", cor: "bg-danger-subtle text-danger-emphasis border border-danger-subtle", exigeRegulador: false,
    mensagem: "Você não compareceu ao atendimento marcado. Procure sua UBS para remarcar." }
};

// Pedido "em aberto" = ainda não foi marcado nem finalizado (o cidadão pode cancelar).
const STATUS_ABERTOS = ["RECEBIDA", "EM_TRIAGEM", "EM_ANALISE_REGULACAO"];
const MSG_CANCELADO_MUNICIPE = "Cancelado a pedido do munícipe.";
const MAX_DOCS_EXTRAS = 3;

const PERFIS = { ATENDENTE: "Atendente", REGULADOR: "Regulador", ADMIN: "Administrador" };

function esc(t) {
  const d = document.createElement("div");
  d.textContent = t == null ? "" : String(t);
  return d.innerHTML;
}

function soDigitos(v) {
  return String(v == null ? "" : v).replace(/\D/g, "");
}

function mascararSus(s) {
  return s ? String(s).replace(/^(\d{3})(\d{4})(\d{4})(\d{4})$/, "$1.$2.$3.$4") : "";
}

function mascararCpf(c) {
  return c ? String(c).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4") : "";
}

/**
 * CPF: por enquanto aceita QUALQUER sequencia de 11 numeros (projeto de demonstracao).
 * Para exigir CPF real, voltar a conferir os digitos verificadores aqui.
 */
function cpfValido(v) {
  return soDigitos(v).length === 11;
}

/** Aplica a mascara 000.000.000-00 enquanto a pessoa digita. */
function ligarMascaraCpf(input) {
  input.addEventListener("input", function () {
    if (/[a-z@]/i.test(this.value)) return; // campo "CPF ou e-mail": e-mail fica como digitado
    const d = this.value.replace(/\D/g, "").slice(0, 11);
    this.value = d.replace(/^(\d{3})(\d{0,3})(\d{0,3})(\d{0,2}).*/, (m, a, b, c, e) =>
      a + (b ? "." + b : "") + (c ? "." + c : "") + (e ? "-" + e : ""));
  });
}

// ---------------------------------------------------------------------
// Login por CPF sem servidor: o e-mail da conta fica salvo CIFRADO com uma
// chave derivada da senha (PBKDF2 + AES-GCM). Quem so sabe o CPF nao
// consegue ver o e-mail; com CPF + senha certa, o navegador decifra o
// e-mail e entra normalmente pelo Firebase Authentication.
// ---------------------------------------------------------------------
const LOGIN_ITERACOES = 150000;

function paraB64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function deB64(s) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function chaveDaSenha(senha, sal) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: sal, iterations: LOGIN_ITERACOES, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** Devolve { cifra, iv, sal } (base64) para gravar em logins/{cpf}. */
async function cifrarEmail(email, senha) {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const chave = await chaveDaSenha(senha, sal);
  const cifra = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, chave, new TextEncoder().encode(email));
  return { cifra: paraB64(cifra), iv: paraB64(iv), sal: paraB64(sal) };
}

/** E-mail decifrado, ou null se a senha estiver errada. */
async function decifrarEmail(reg, senha) {
  try {
    const chave = await chaveDaSenha(senha, deB64(reg.sal));
    const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: deB64(reg.iv) }, chave, deB64(reg.cifra));
    return new TextDecoder().decode(bytes);
  } catch (e) {
    return null;
  }
}

function mascararTelefone(t) {
  const d = soDigitos(t);
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3");
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, "($1) $2-$3");
  return d;
}

function dataParaTexto(v) {
  if (!v) return "";
  const d = v.toDate ? v.toDate() : new Date(v);
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function nascimentoParaTexto(iso) {
  return iso ? iso.split("-").reverse().join("/") : "";
}

/** Data AAAA-MM-DD real, nao futura e >= 1900. */
function dataNascimentoValida(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCDate() === +m[3] && d.getUTCMonth() === +m[2] - 1 && +m[1] >= 1900 && d.getTime() <= Date.now();
}

function badgeStatus(s) {
  const st = STATUS[s] || { rotulo: s, cor: "bg-secondary" };
  return `<span class="badge ${st.cor}">${esc(st.rotulo)}</span>`;
}

/** Protocolo no formato 2026-K7F3QZ (sem letras/numeros que confundem: O, 0, I, 1). */
function gerarProtocolo() {
  const letras = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const n = new Uint32Array(6);
  crypto.getRandomValues(n);
  return new Date().getFullYear() + "-" + Array.from(n, (x) => letras[x % letras.length]).join("");
}

/**
 * Servidor so entra no painel com aprovado === true (booleano) e perfil valido,
 * exatamente como as regras do Firestore conferem. Devolve null se ok, ou o motivo.
 */
function motivoServidorBloqueado(dados) {
  if (!dados) return "Esta conta não é de servidor. Use a aba Solicitar acesso.";
  const perfilMalDigitado = !PERFIS[dados.perfil] && PERFIS[String(dados.perfil).trim().toUpperCase()];
  if (typeof dados.aprovado === "string" || perfilMalDigitado) {
    return "Cadastro do servidor com tipo errado no Console: o campo \"aprovado\" deve ser do tipo boolean (true) " +
      "e \"perfil\" deve ser exatamente ATENDENTE, REGULADOR ou ADMIN (maiúsculas, sem espaços).";
  }
  if (dados.aprovado !== true) return "Seu acesso ainda aguarda aprovação de um administrador.";
  if (!PERFIS[dados.perfil]) return "Perfil de servidor inválido. Peça a um administrador para corrigir.";
  return null;
}

const DIAS_SEMANA_LONGO = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

/** "terça-feira, 03/11/2026" a partir de AAAA-MM-DD. */
function dataComDiaSemana(iso) {
  if (!iso) return "";
  return DIAS_SEMANA_LONGO[new Date(iso + "T12:00:00").getDay()] + ", " + nascimentoParaTexto(iso);
}

/** Texto do agendamento: "terça-feira, 03/11/2026 às 08:00 • UBS Centro • Dra. Ana Lima (Cardiologia)". */
function agendamentoParaTexto(a) {
  if (!a || !a.data) return "";
  return [dataComDiaSemana(a.data) + (a.hora ? " às " + a.hora : ""), a.local, a.profissional].filter(Boolean).join(" • ");
}

/** Bloco HTML do agendamento para o munícipe (consulta pública e Minha Área). */
function blocoAgendamento(a) {
  if (!a || !a.data) return "";
  return `<div class="alert alert-primary py-2 px-3 my-2 small mb-0">
      <div class="fw-bold mb-1"><i class="bi bi-calendar-check me-1" aria-hidden="true"></i>Seu atendimento está marcado</div>
      <div><strong>Dia:</strong> ${esc(dataComDiaSemana(a.data))}${a.hora ? " às <strong>" + esc(a.hora) + "</strong>" : ""}</div>
      <div><strong>Local:</strong> ${esc(a.local)}</div>
      ${a.profissional ? `<div><strong>Quem vai atender:</strong> ${esc(a.profissional)}</div>` : ""}
      ${a.orientacoes ? `<div><strong>Orientações:</strong> ${esc(a.orientacoes)}</div>` : ""}
      <div class="mt-1 text-muted">Leve documento com foto, Cartão SUS e a guia original. Chegue 30 minutos antes.</div>
    </div>`;
}

function mensagemErroAuth(e) {
  const texto = String((e && e.message) || "");
  // Servicos do Firebase ainda nao ativados no Console (causa comum de "nada funciona")
  if (/firestore\.googleapis\.com|SERVICE_DISABLED|has not been used in project|database \(default\) does not exist/i.test(texto)) {
    return "O banco de dados (Firestore) ainda não foi criado no Firebase Console. Avise o administrador do site.";
  }
  const mapa = {
    "auth/configuration-not-found": "O login ainda não foi ativado no Firebase (Authentication > Vamos começar > E-mail/senha). Avise o administrador do site.",
    "auth/admin-restricted-operation": "O cadastro por e-mail/senha está desativado no Firebase. Avise o administrador do site.",
    "auth/missing-password": "Digite a senha.",
    "auth/user-disabled": "Esta conta foi desativada.",
    "auth/invalid-credential": "CPF/e-mail ou senha incorretos.",
    "auth/wrong-password": "CPF/e-mail ou senha incorretos.",
    "auth/user-not-found": "CPF/e-mail ou senha incorretos.",
    "auth/invalid-email": "E-mail inválido.",
    "auth/email-already-in-use": "Já existe uma conta com este e-mail. Use a aba Entrar.",
    "auth/weak-password": "A senha precisa ter pelo menos 8 caracteres.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos.",
    "auth/network-request-failed": "Sem conexão com a internet.",
    "auth/operation-not-allowed": "Login por e-mail/senha ainda não foi ativado no Firebase (Authentication > Método de login).",
    "permission-denied": "Você não tem permissão para esta ação.",
    "unavailable": "Sem conexão com o servidor. Tente novamente.",
    "not-found": "Registro não encontrado.",
    "failed-precondition": "O banco de dados não está pronto (índice ou configuração pendente). Tente em alguns minutos."
  };
  return mapa[e && e.code] || "Não foi possível concluir. Tente novamente.";
}

/**
 * Le o anexo e devolve { dados (data URL), tipo, nome }.
 * Fotos sao reduzidas/comprimidas para caber no banco; PDF ate 650 KB.
 */
async function prepararAnexo(arquivo) {
  const tipo = arquivo.type;
  if (tipo === "application/pdf") {
    if (arquivo.size > 650 * 1024) throw new Error("O PDF deve ter no máximo 650 KB. Se puder, envie uma foto da guia.");
    return { dados: await lerComoDataUrl(arquivo), tipo, nome: arquivo.name.slice(0, 120) };
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(tipo)) {
    throw new Error("Envie uma foto (JPG, PNG, WEBP) ou PDF.");
  }
  const img = await carregarImagem(arquivo);
  let lado = 1600;
  let qualidade = 0.8;
  for (let i = 0; i < 8; i++) {
    const escala = Math.min(1, lado / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * escala);
    c.height = Math.round(img.height * escala);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const dados = c.toDataURL("image/jpeg", qualidade);
    if (dados.length < 900000) {
      return { dados, tipo: "image/jpeg", nome: arquivo.name.replace(/\.[^.]+$/, "").slice(0, 110) + ".jpg" };
    }
    qualidade = Math.max(0.5, qualidade - 0.1);
    lado = Math.round(lado * 0.8);
  }
  throw new Error("Não foi possível reduzir a foto. Tente uma foto menor.");
}

function lerComoDataUrl(arquivo) {
  return new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => falha(new Error("Não foi possível ler o arquivo."));
    r.readAsDataURL(arquivo);
  });
}

function carregarImagem(arquivo) {
  return new Promise((ok, falha) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url); falha(new Error("Imagem inválida.")); };
    img.src = url;
  });
}

// Aplicativo instalável (PWA): registra o service worker no site publicado (https).
if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => { /* opcional */ }));
}

/** Abre um data URL (anexo) numa nova aba. */
function abrirDataUrl(dataUrl, janela) {
  const [cab, b64] = dataUrl.split(",");
  const tipo = cab.slice(5, cab.indexOf(";"));
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
  if (janela) janela.location.href = url;
  else window.open(url, "_blank");
}
