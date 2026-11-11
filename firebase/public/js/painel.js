// =====================================================================
// Agiliza Saude - JavaScript do Painel CRM (painel.html)
// Lista e filtra solicitacoes, muda status, marca atendimento, historico
// e aprovacao de servidores (ADMIN). Usa: js/firebase-init.js e js/comum.js.
// =====================================================================

const { FieldValue } = firebase.firestore;
let eu = null;              // { uid, nome, perfil }
let solicitacoes = [];
let selecionada = null;
let servidores = [];
let triagem = {};           // prioridade interna por protocolo (coleção triagem: só servidores leem)
const modal = new bootstrap.Modal(document.getElementById('modalStatus'));

// Prioridade interna da fila (o cidadão não vê). peso menor = atende antes.
const PRIORIDADES = {
    URGENTE: { rotulo: 'Urgente', cor: 'bg-danger', peso: 0, icone: 'bi-exclamation-octagon-fill' },
    PRIORITARIO: { rotulo: 'Prioritário', cor: 'bg-warning text-dark', peso: 1, icone: 'bi-arrow-up-circle-fill' },
    NORMAL: { rotulo: 'Normal', cor: 'bg-secondary', peso: 2, icone: 'bi-dash-circle' }
};
const MOTIVOS_PRIORIDADE = ['Idoso 80+ (prioridade legal)', 'Idoso 60+ (prioridade legal)', 'Gestante', 'Pessoa com deficiência',
    'Criança de colo', 'Oncologia', 'Risco clínico (avaliação médica)', 'Retorno de tratamento em andamento'];

function prioridadeDe(s) {
    const p = (triagem[s.protocolo] || {}).prioridade;
    return PRIORIDADES[p] ? p : 'NORMAL';
}

function idade(nascimento) {
    if (!nascimento) return null;
    const n = new Date(nascimento + 'T00:00:00');
    const h = new Date();
    let anos = h.getFullYear() - n.getFullYear();
    if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) anos--;
    return anos;
}

function celulaPrioridade(s) {
    const t = triagem[s.protocolo] || {};
    const p = PRIORIDADES[prioridadeDe(s)];
    const anos = idade(s.nascimento);
    return `<span class="badge ${p.cor}"><i class="bi ${p.icone} me-1"></i>${p.rotulo}</span>` +
        (t.motivo ? `<div class="small text-muted text-wrap" style="max-width:140px">${esc(t.motivo)}</div>` : '') +
        (anos >= 60 && !t.prioridade ? `<div class="small text-warning-emphasis"><i class="bi bi-info-circle me-1"></i>${anos} anos</div>` : '');
}

function aviso(id, texto, tipo) {
    const el = document.getElementById(id);
    if (!texto) { el.classList.add('d-none'); return; }
    el.className = 'alert alert-' + tipo;
    el.textContent = texto;
}

function podeAplicar(status) {
    return !STATUS[status].exigeRegulador || eu.perfil === 'REGULADOR' || eu.perfil === 'ADMIN';
}

function semAcesso(titulo, texto) {
    document.getElementById('conteudo').classList.add('d-none');
    document.getElementById('semAcesso').classList.remove('d-none');
    document.getElementById('semAcessoTitulo').textContent = titulo;
    document.getElementById('semAcessoTexto').textContent = texto;
}

// ---------------------------------------------------------------- tempo de espera
// Pedido "em aberto" = ainda não foi marcado nem finalizado (lista em comum.js).
const ABERTOS = STATUS_ABERTOS;
const FINALIZADOS = ['CONCLUIDA', 'NEGADA', 'CANCELADA', 'FALTOU'];
const TAMANHO_PAGINA = 200;
let ultimoDoc = null;       // paginação: último documento carregado
let temMais = false;
const DIA_MS = 24 * 60 * 60 * 1000;
const ESPERA_ATENCAO = 15; // dias: amarelo
const ESPERA_CRITICA = 30; // dias: vermelho

function emMs(ts) {
    return ts && ts.toMillis ? ts.toMillis() : null;
}

/** Dias de espera: em aberto conta até hoje; marcados/finalizados, até a última atualização (marcação ou finalização). */
function diasEspera(s) {
    const inicio = emMs(s.criadoEm);
    if (!inicio) return 0;
    const fim = ABERTOS.includes(s.status) ? Date.now() : (emMs(s.atualizadoEm) || Date.now());
    return Math.max(0, Math.floor((fim - inicio) / DIA_MS));
}

function textoDias(d) {
    return d === 0 ? 'menos de 1 dia' : d === 1 ? '1 dia' : d + ' dias';
}

function corEspera(d) {
    return d >= ESPERA_CRITICA ? 'bg-danger' : d >= ESPERA_ATENCAO ? 'bg-warning text-dark' : 'bg-success';
}

/** Dias até a data marcada (negativo = já passou). */
function diasAteAtendimento(a) {
    if (!a || !a.data) return null;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    return Math.round((new Date(a.data + 'T00:00:00') - hoje) / DIA_MS);
}

function celulaEspera(s) {
    const d = diasEspera(s);
    if (ABERTOS.includes(s.status)) {
        return `<span class="badge ${corEspera(d)} fs-6">${textoDias(d)}</span><div class="small text-muted">esperando</div>`;
    }
    if (s.status === 'AGENDADA') {
        const f = diasAteAtendimento(s.agendamento);
        const quando = f === null ? '' : f > 0 ? `atendimento em ${textoDias(f)}` : f === 0 ? 'atendimento é hoje' : `atendimento foi há ${textoDias(-f)}`;
        return `<span class="badge ${corEspera(d)}">${textoDias(d)}</span>` +
            `<div class="small text-muted">até a marcação${quando ? '<br><strong>' + quando + '</strong>' : ''}</div>`;
    }
    return `<span class="badge bg-light text-dark border">${textoDias(d)}</span><div class="small text-muted">tempo total</div>`;
}

/** Ordem da "fila": em aberto (mais antigo primeiro), depois marcados (data mais próxima), depois finalizados. */
function ordenar(lista) {
    const modo = document.getElementById('ordenar').value;
    const criado = (s) => emMs(s.criadoEm) || 0;
    if (modo === 'recentes') return lista.sort((a, b) => criado(b) - criado(a));
    if (modo === 'antigos') return lista.sort((a, b) => criado(a) - criado(b));
    const grupo = (s) => ABERTOS.includes(s.status) ? 0 : s.status === 'AGENDADA' ? 1 : 2;
    const peso = (s) => PRIORIDADES[prioridadeDe(s)].peso;
    return lista.sort((a, b) => {
        if (grupo(a) !== grupo(b)) return grupo(a) - grupo(b);
        if (grupo(a) === 0) return (peso(a) - peso(b)) || (criado(a) - criado(b));
        if (grupo(a) === 1) return String((a.agendamento || {}).data || '9999').localeCompare(String((b.agendamento || {}).data || '9999'));
        return (emMs(b.atualizadoEm) || 0) - (emMs(a.atualizadoEm) || 0);
    });
}

// ---------------------------------------------------------------- solicitações
async function carregar() {
    try {
        const [snap, snapTriagem] = await Promise.all([
            db.collection('solicitacoes').orderBy('criadoEm', 'desc').limit(TAMANHO_PAGINA).get(),
            db.collection('triagem').get()
        ]);
        solicitacoes = snap.docs.map(d => d.data());
        ultimoDoc = snap.docs[snap.docs.length - 1] || null;
        temMais = snap.docs.length === TAMANHO_PAGINA;
        triagem = {};
        snapTriagem.docs.forEach(d => { triagem[d.id] = d.data(); });
        atualizarRodape();
        if (document.getElementById('abaRelatorios').classList.contains('active')) desenharRelatorios();
        desenharResumo();
        desenhar();
        aviso('avisoPainel', '');
    } catch (e) {
        aviso('avisoPainel', mensagemErroAuth(e), 'danger');
    }
}

/** Paginação: busca os próximos pedidos (do mais recente para o mais antigo). */
async function carregarMais() {
    if (!ultimoDoc) return;
    const btn = document.getElementById('btnCarregarMais');
    btn.disabled = true;
    try {
        const snap = await db.collection('solicitacoes').orderBy('criadoEm', 'desc')
            .startAfter(ultimoDoc).limit(TAMANHO_PAGINA).get();
        solicitacoes = solicitacoes.concat(snap.docs.map(d => d.data()));
        ultimoDoc = snap.docs[snap.docs.length - 1] || ultimoDoc;
        temMais = snap.docs.length === TAMANHO_PAGINA;
        desenharResumo();
        desenhar();
        atualizarRodape();
    } catch (e) {
        aviso('avisoPainel', mensagemErroAuth(e), 'danger');
    } finally {
        btn.disabled = false;
    }
}

function atualizarRodape() {
    document.getElementById('btnCarregarMais').classList.toggle('d-none', !temMais);
    document.getElementById('infoCarregados').textContent = solicitacoes.length + ' pedido(s) carregado(s)' +
        (temMais ? ' — há mais pedidos antigos; use "Carregar mais".' : ' (todos).');
}

/** Exporta a lista que está na tela (com os filtros aplicados) para o Excel. */
function exportarCsv() {
    const lista = ordenar(filtradas());
    const cab = ['Protocolo', 'Prioridade', 'Motivo da prioridade', 'Status', 'Paciente', 'CPF', 'Cartão SUS', 'Telefone',
        'Nascimento', 'Serviço', 'UBS', 'Data do pedido', 'Última atualização', 'Dias de espera', 'Marcação'];
    const linhas = lista.map(s => [
        s.protocolo, PRIORIDADES[prioridadeDe(s)].rotulo, (triagem[s.protocolo] || {}).motivo || '',
        (STATUS[s.status] || {}).rotulo || s.status, s.paciente, mascararCpf(s.cpf), mascararSus(s.sus),
        mascararTelefone(s.telefone), nascimentoParaTexto(s.nascimento), s.servico, s.ubs,
        dataParaTexto(s.criadoEm), dataParaTexto(s.atualizadoEm), diasEspera(s),
        s.status === 'AGENDADA' ? agendamentoParaTexto(s.agendamento) : ''
    ]);
    // aspas + proteção contra "fórmula" no Excel (texto digitado pelo cidadão começando com = + - @)
    const celula = (v) => {
        let t = String(v == null ? '' : v);
        if (/^[=+\-@]/.test(t)) t = "'" + t;
        return '"' + t.replace(/"/g, '""') + '"';
    };
    const csv = '﻿' + [cab, ...linhas].map(l => l.map(celula).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'agiliza-saude-pedidos-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function desenharResumo() {
    const contar = (lista) => solicitacoes.filter(s => lista.includes(s.status)).length;
    const cartoes = [
        ['Aguardando triagem', contar(['RECEBIDA']), 'text-secondary', 'bi-inbox'],
        ['Em andamento', contar(['EM_TRIAGEM', 'EM_ANALISE_REGULACAO']), 'text-warning', 'bi-hourglass-split'],
        ['Agendadas', contar(['AGENDADA']), 'text-primary', 'bi-calendar-check'],
        ['Finalizadas', contar(FINALIZADOS), 'text-success', 'bi-check2-all']
    ];

    // Indicadores de espera (somente pedidos em aberto)
    const abertos = solicitacoes.filter(s => ABERTOS.includes(s.status));
    const dias = abertos.map(diasEspera);
    const media = dias.length ? Math.round(dias.reduce((a, b) => a + b, 0) / dias.length) : 0;
    const maior = dias.length ? Math.max(...dias) : 0;
    const maisAntigo = abertos[dias.indexOf(maior)];
    const criticos = dias.filter(d => d >= ESPERA_CRITICA).length;
    const urgentes = abertos.filter(s => prioridadeDe(s) === 'URGENTE').length;
    const prioritarios = abertos.filter(s => prioridadeDe(s) === 'PRIORITARIO').length;
    const corDias = (d) => d >= ESPERA_CRITICA ? 'text-danger' : d >= ESPERA_ATENCAO ? 'text-warning' : 'text-success';
    const espera = [
        ['Espera média (em aberto)', dias.length ? textoDias(media) : '—', dias.length ? corDias(media) : 'text-muted', 'bi-stopwatch', ''],
        ['Maior espera (em aberto)', dias.length ? textoDias(maior) : '—', dias.length ? corDias(maior) : 'text-muted', 'bi-hourglass-bottom',
            maisAntigo ? `#${esc(maisAntigo.protocolo)} • ${esc(maisAntigo.paciente)} • pedido em ${esc(dataParaTexto(maisAntigo.criadoEm))}` : ''],
        ['Em aberto há 30 dias ou mais', criticos, criticos ? 'text-danger' : 'text-success', 'bi-exclamation-triangle',
            criticos ? `<a href="#" onclick="event.preventDefault(); verCriticos();">ver lista</a>` : 'nenhum pedido atrasado'],
        ['Urgentes em aberto (interno)', urgentes, urgentes ? 'text-danger' : 'text-success', 'bi-sort-up',
            `${prioritarios} prioritário(s)` + (urgentes ? ` • <a href="#" onclick="event.preventDefault(); verUrgentes();">ver lista</a>` : '')]
    ];

    document.getElementById('resumo').innerHTML = cartoes.map(([rotulo, n, cor, icone]) => `
        <div class="col-6 col-md-3">
            <div class="card border-0 shadow-sm"><div class="card-body">
                <div class="small text-muted"><i class="bi ${icone} me-1"></i>${rotulo}</div>
                <div class="cartao-numero ${cor}">${n}</div>
            </div></div>
        </div>`).join('') + espera.map(([rotulo, n, cor, icone, detalhe]) => `
        <div class="col-12 col-md-6 col-xl-3">
            <div class="card border-0 shadow-sm h-100"><div class="card-body">
                <div class="small text-muted"><i class="bi ${icone} me-1"></i>${rotulo}</div>
                <div class="cartao-numero ${cor}">${n}</div>
                ${detalhe ? `<div class="small text-muted">${detalhe}</div>` : ''}
            </div></div>
        </div>`).join('');
}

function verUrgentes() {
    document.getElementById('filtroStatus').value = '';
    document.getElementById('filtroEspera').value = '';
    document.getElementById('filtroPrioridade').value = 'URGENTE';
    document.getElementById('ordenar').value = 'fila';
    desenhar();
    document.getElementById('corpoTabela').scrollIntoView({ behavior: 'smooth' });
}

function verCriticos() {
    document.getElementById('filtroPrioridade').value = '';
    document.getElementById('filtroStatus').value = '';
    document.getElementById('filtroEspera').value = String(ESPERA_CRITICA);
    document.getElementById('ordenar').value = 'fila';
    desenhar();
    document.getElementById('corpoTabela').scrollIntoView({ behavior: 'smooth' });
}

function filtradas() {
    const q = document.getElementById('filtroBusca').value.trim().toLowerCase();
    const qDig = soDigitos(q);
    const st = document.getElementById('filtroStatus').value;
    const ubs = document.getElementById('filtroUbs').value;
    const minDias = Number(document.getElementById('filtroEspera').value) || 0;
    const prio = document.getElementById('filtroPrioridade').value;
    return solicitacoes.filter(s =>
        (!st || s.status === st) &&
        (!prio || prioridadeDe(s) === prio) &&
        (!ubs || s.ubsId === ubs) &&
        (!minDias || (ABERTOS.includes(s.status) && diasEspera(s) >= minDias)) &&
        (!q || s.protocolo.toLowerCase().includes(q) || String(s.paciente).toLowerCase().includes(q) ||
            (qDig.length >= 3 && (String(s.sus).includes(qDig) || String(s.cpf || '').includes(qDig)))));
}

function desenhar() {
    const corpo = document.getElementById('corpoTabela');
    const lista = ordenar(filtradas());
    if (!lista.length) {
        corpo.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">Nenhuma solicitação encontrada.</td></tr>';
        return;
    }
    corpo.innerHTML = lista.map(s => `
        <tr class="${ABERTOS.includes(s.status) && diasEspera(s) >= ESPERA_CRITICA ? 'table-danger' : ''}">
            <td>${celulaPrioridade(s)}</td>
            <td class="fw-bold">#${esc(s.protocolo)}${s.canal === 'BALCAO'
                ? `<div><span class="badge bg-success-subtle text-success-emphasis border border-success-subtle fw-normal" title="Registrado por ${esc(s.criadoPorNome || '')}"><i class="bi bi-person-badge me-1"></i>Balcão</span></div>` : ''}</td>
            <td><a href="#" class="fw-semibold text-decoration-none" title="Abrir a ficha 360° do paciente" onclick="event.preventDefault(); abrirFicha('${esc(s.cpf)}')">${esc(s.paciente)} <i class="bi bi-person-lines-fill small"></i></a><div class="small text-muted">CPF ${esc(mascararCpf(s.cpf))} • SUS ${esc(mascararSus(s.sus))} • ${esc(mascararTelefone(s.telefone))} • nasc. ${esc(nascimentoParaTexto(s.nascimento))}</div></td>
            <td>${esc(s.servico)}${resumoCirurgia(s.cirurgia)}</td>
            <td>${esc(s.ubs)}</td>
            <td>${badgeStatus(s.status)}${s.status === 'AGENDADA' && s.agendamento
                ? `<div class="small text-primary mt-1"><i class="bi bi-calendar-check me-1"></i>${esc(agendamentoParaTexto(s.agendamento))}</div>` : ''}
                <div class="small text-muted mt-1">atualizado ${esc(dataParaTexto(s.atualizadoEm))}</div></td>
            <td class="small text-nowrap">${esc(dataParaTexto(s.criadoEm))}</td>
            <td class="text-nowrap">${celulaEspera(s)}</td>
            <td class="text-end text-nowrap">
                ${numeroWhatsApp(s.telefone) ? `<button class="btn btn-sm btn-outline-success" title="Avisar pelo WhatsApp (${esc(mascararTelefone(s.telefone))})" onclick="whatsAppRapido('${esc(s.protocolo)}')"><i class="bi bi-whatsapp"></i></button>` : ''}
                ${totalDocs(s)
                    ? `<button class="btn btn-sm btn-outline-secondary" title="Ver documentos anexados" onclick="verAnexo('${esc(s.protocolo)}', ${s.temAnexo ? 0 : 1})"><i class="bi bi-paperclip"></i>${totalDocs(s) > 1 ? `<span class="badge bg-secondary ms-1">+${totalDocs(s) - 1}</span>` : ''}</button>`
                    : '<span class="badge bg-light text-muted border me-1" title="Pedido enviado sem documentos">sem anexo</span>'}
                <button class="btn btn-sm btn-primary" onclick="abrirModal('${esc(s.protocolo)}')">
                    <i class="bi bi-pencil-square me-1"></i>Atualizar
                </button>
            </td>
        </tr>`).join('');
}

// ---------------------------------------------------------------- WhatsApp (demonstração)
// "Clique para conversar" (wa.me): abre o WhatsApp com o número e o texto prontos; o envio é manual.
// Integração automática exigiria a WhatsApp Business Platform (Meta) + um servidor (Cloud Functions).
const SITE_PUBLICO = 'https://agiliza-saude-5ab0e.web.app';

function textoWhatsApp(s) {
    const st = STATUS[s.status] || { rotulo: s.status };
    const linhas = [
        `Olá, ${String(s.paciente).split(' ')[0]}! Aqui é da Secretaria Municipal de Saúde de Cidade Ocidental (Agiliza Saúde).`,
        '',
        `Seu pedido *#${s.protocolo}* (${s.servico}) está: *${st.rotulo}*.`,
        s.mensagemPublica || ''
    ];
    if (s.status === 'AGENDADA' && s.agendamento && s.agendamento.data) {
        const a = s.agendamento;
        linhas.push('', `📅 *Data:* ${nascimentoParaTexto(a.data)}${a.hora ? ' às ' + a.hora : ''}`, `📍 *Local:* ${a.local}`);
        if (a.profissional) linhas.push(`👩‍⚕️ ${a.profissional}`);
        if (a.orientacoes) linhas.push(`ℹ️ ${a.orientacoes}`);
        linhas.push('Leve documento com foto, Cartão SUS e a guia original. Chegue 30 minutos antes.');
    }
    linhas.push('', `Acompanhe pelo site (consulta pelo CPF): ${SITE_PUBLICO}`, 'Não responda esta mensagem com dados pessoais.');
    return linhas.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n');
}

/** Número no formato internacional do WhatsApp: 55 + DDD + número. */
function numeroWhatsApp(telefone) {
    const d = soDigitos(telefone);
    return d.length >= 10 && d.length <= 11 ? '55' + d : null;
}

function linkWhatsApp(telefone, texto) {
    const n = numeroWhatsApp(telefone);
    return n ? 'https://wa.me/' + n + '?text=' + encodeURIComponent(texto) : null;
}

/** Botão da tabela: abre direto com a mensagem padrão do status atual. */
function whatsAppRapido(protocolo) {
    const s = solicitacoes.find(x => x.protocolo === protocolo);
    const url = s && linkWhatsApp(s.telefone, textoWhatsApp(s));
    if (url) window.open(url, '_blank', 'noopener');
    else aviso('avisoPainel', 'Telefone do paciente inválido para WhatsApp.', 'warning');
}

/** Botão da janela do pedido: usa o texto (editável) da caixa. */
function abrirWhatsApp() {
    const url = linkWhatsApp(selecionada.telefone, document.getElementById('msgWhatsapp').value);
    if (url) window.open(url, '_blank', 'noopener');
}

/** Guia (opcional) + documentos extras enviados no pedido. */
function totalDocs(s) {
    return (s.temAnexo ? 1 : 0) + (s.qtdExtras || 0);
}

/** n = 0: guia principal; 1..3: documentos extras. */
async function verAnexo(protocolo, n) {
    const janela = window.open('', '_blank');
    try {
        const ref = db.collection('anexos').doc(protocolo);
        const d = await (n ? ref.collection('extras').doc(String(n)) : ref).get();
        if (!d.exists) throw new Error('Anexo não encontrado.');
        abrirDataUrl(d.get('dados'), janela);
    } catch (e) {
        if (janela) janela.close();
        aviso('avisoPainel', e.code ? mensagemErroAuth(e) : e.message, 'danger');
    }
}

async function abrirModal(protocolo) {
    selecionada = solicitacoes.find(s => s.protocolo === protocolo);
    document.getElementById('resumoModal').innerHTML =
        `<strong>#${esc(selecionada.protocolo)}</strong> — ${esc(selecionada.paciente)} ${badgeStatus(selecionada.status)}<br>` +
        `<span class="text-muted">${esc(selecionada.servico)} • ${esc(selecionada.ubs)} • tel. ${esc(mascararTelefone(selecionada.telefone))}</span>`;
    // documentos enviados
    // 0 = guia principal (opcional); 1..3 = documentos extras
    const docs = (selecionada.temAnexo ? [0] : []).concat(Array.from({ length: selecionada.qtdExtras || 0 }, (_, i) => i + 1));
    document.getElementById('docsModal').innerHTML = docs.length
        ? '<i class="bi bi-paperclip me-1"></i>Documentos: ' + docs.map(n =>
            `<button type="button" class="btn btn-sm btn-outline-secondary me-1" onclick="verAnexo('${esc(selecionada.protocolo)}', ${n})">${n ? 'Documento ' + (selecionada.temAnexo ? n + 1 : n) : 'Guia'}</button>`).join('')
        : '<span class="text-muted">Sem documentos anexados.</span>';
    // telefone atualizado pelo cidadão depois do pedido?
    db.collection('pacientes').doc(selecionada.uid).get().then(p => {
        if (selecionada.protocolo !== protocolo) return; // já abriu outro pedido
        if (p.exists && p.get('telefone') && p.get('telefone') !== selecionada.telefone) {
            document.getElementById('docsModal').insertAdjacentHTML('beforeend',
                `<div class="mt-1 text-primary"><i class="bi bi-telephone me-1"></i>Telefone atualizado no cadastro: <strong>${esc(mascararTelefone(p.get('telefone')))}</strong></div>`);
        }
    }).catch(() => { /* sem acesso ao cadastro: mostra só o do pedido */ });
    document.getElementById('novoStatus').innerHTML = Object.entries(STATUS)
        .map(([k, v]) => `<option value="${k}" ${podeAplicar(k) ? '' : 'disabled'}>${esc(v.rotulo)}${podeAplicar(k) ? '' : ' (somente regulação)'}</option>`).join('');
    document.getElementById('novoStatus').value = selecionada.status;
    // prioridade interna
    const t = triagem[protocolo] || {};
    const anos = idade(selecionada.nascimento);
    document.getElementById('novaPrioridade').value = prioridadeDe(selecionada);
    document.getElementById('motivoPrioridade').value = t.motivo || '';
    document.getElementById('infoPrioridade').innerHTML = [
        anos != null ? `Paciente com <strong>${anos} anos</strong>${anos >= 80 ? ' — prioridade legal especial (80+)' : anos >= 60 ? ' — prioridade legal (60+)' : ''}.` : '',
        `Espera atual: <strong>${textoDias(diasEspera(selecionada))}</strong>.`,
        t.definidoPorNome ? `Prioridade definida por ${esc(t.definidoPorNome)} em ${esc(dataParaTexto(t.definidoEm))}.` : 'Prioridade ainda não definida (Normal).'
    ].filter(Boolean).join(' ');
    // cirurgia eletiva: dados e checklist do pré-operatório
    const cirBox = document.getElementById('cirurgiaModal');
    const cir = selecionada.cirurgia;
    cirBox.classList.toggle('d-none', !cir);
    if (cir) {
        cirBox.innerHTML = `<div class="fw-bold small text-primary mb-1"><i class="bi bi-hospital me-1"></i>Cirurgia: ${esc(cir.procedimento)} • ${esc(cir.hospital)}</div>
            <div class="small"><span class="fw-bold">Pré-operatório:</span> ` +
            Object.entries(ITENS_PREOP).map(([k, v]) =>
                `<label class="form-check form-check-inline mb-0"><input class="form-check-input" type="checkbox" id="mPre-${k}" ${cir.preOp && cir.preOp[k] ? 'checked' : ''}> ${esc(v)}</label>`).join('') +
            `</div><div class="form-text">Ao marcar a cirurgia ("Agendada"), o local sugerido é o hospital.</div>`;
    }
    // marcação: pela agenda (médico -> dia -> horário) ou digitada à mão (marcações antigas / fora da agenda)
    const ag = selecionada.agendamento || {};
    const pelaAgenda = ag.agendaId != null;
    const manual = pelaAgenda ? {} : ag;
    document.getElementById('agData').value = manual.data || '';
    document.getElementById('agHora').value = manual.hora || '';
    document.getElementById('agLocal').value = manual.local || (cir ? cir.hospital : '') || selecionada.ubs || '';
    document.getElementById('agProfissional').value = manual.profissional || '';
    document.getElementById('agOrientacoes').value = manual.orientacoes || '';
    bootstrap.Collapse.getOrCreateInstance(document.getElementById('marcacaoManual'), { toggle: false })[ag.data && !pelaAgenda ? 'show' : 'hide']();
    ['mkProf', 'mkDia', 'mkHora'].forEach(id => { document.getElementById(id).innerHTML = '<option value="">Carregando agendas...</option>'; });
    document.getElementById('mkResumo').innerHTML = '';
    seletores.mk = { servicoId: selecionada.servicoId, ignorar: null };
    garantirAgendas().then(() => {
        if (!selecionada || selecionada.protocolo !== protocolo) return; // já abriu outro pedido
        const agAtual = pelaAgenda ? agendas.find(x => x.id === ag.agendaId) : null;
        montarSeletor('mk', selecionada.servicoId, pelaAgenda ? { agendaId: ag.agendaId, vaga: ag.vaga } : null,
            agAtual ? (agAtual.profissionalId || '') : undefined);
    }).catch(() => { /* sem acesso às agendas: só a marcação manual */ });
    mostrarBlocoAgenda();
    document.getElementById('msgPublica').value = selecionada.mensagemPublica || '';
    document.getElementById('obsInterna').value = '';
    // mensagem pronta do WhatsApp (editável)
    document.getElementById('msgWhatsapp').value = textoWhatsApp(selecionada);
    const nWpp = numeroWhatsApp(selecionada.telefone);
    document.getElementById('numeroWhatsapp').textContent = nWpp
        ? 'Para: ' + mascararTelefone(selecionada.telefone) + ' (+' + nWpp.slice(0, 2) + ')'
        : 'Telefone do paciente inválido para WhatsApp.';
    document.getElementById('erroModal').classList.add('d-none');
    modal.show();

    const hist = document.getElementById('historicoModal');
    hist.textContent = 'Carregando...';
    try {
        const snap = await db.collection('solicitacoes').doc(protocolo).collection('historico').orderBy('criadoEm').get();
        hist.innerHTML = snap.docs.map(d => {
            const h = d.data();
            return `<div class="border-start border-3 ps-2 mb-2">
                <strong>${esc(STATUS[h.statusNovo] ? STATUS[h.statusNovo].rotulo : h.statusNovo)}</strong>
                • ${esc(dataParaTexto(h.criadoEm))} • ${esc(h.usuarioNome || '')}
                ${h.observacao ? `<div class="text-dark">${esc(h.observacao)}</div>` : ''}
            </div>`;
        }).join('') || 'Sem histórico.';
    } catch (e) {
        hist.textContent = mensagemErroAuth(e);
    }
}

function mostrarBlocoAgenda() {
    document.getElementById('blocoAgenda').classList.toggle('d-none', document.getElementById('novoStatus').value !== 'AGENDADA');
}

function lerAgendamento() {
    const a = {
        data: document.getElementById('agData').value,
        hora: document.getElementById('agHora').value,
        local: document.getElementById('agLocal').value.trim(),
        profissional: document.getElementById('agProfissional').value.trim(),
        orientacoes: document.getElementById('agOrientacoes').value.trim()
    };
    if (!a.profissional) delete a.profissional;
    if (!a.orientacoes) delete a.orientacoes;
    return a;
}

function sugerirMensagem() {
    const st = document.getElementById('novoStatus').value;
    mostrarBlocoAgenda();
    const r = lerSeletor('mk');
    const a = r ? agendamentoDaVaga(r.agenda, r.n) : lerAgendamento();
    document.getElementById('msgPublica').value = st === 'AGENDADA' && a.data
        ? ('Atendimento marcado: ' + agendamentoParaTexto(a) + '.').slice(0, 500)
        : STATUS[st].mensagem;
}

async function salvarStatus() {
    const erro = document.getElementById('erroModal');
    const btn = document.getElementById('btnSalvarStatus');
    const status = document.getElementById('novoStatus').value;
    const mensagem = document.getElementById('msgPublica').value.trim() || STATUS[status].mensagem;
    let obs = document.getElementById('obsInterna').value.trim();
    erro.classList.add('d-none');

    // O que mudou? (prioridade é gravada à parte, em triagem/{protocolo})
    const tAtual = triagem[selecionada.protocolo] || {};
    const prioridade = document.getElementById('novaPrioridade').value;
    const motivo = document.getElementById('motivoPrioridade').value.trim().slice(0, 200);
    const mudouPrioridade = prioridade !== prioridadeDe(selecionada) || motivo !== (tAtual.motivo || '');
    // checklist do pré-operatório (cirurgia eletiva)
    let novaCirurgia = null;
    if (selecionada.cirurgia) {
        const preOp = {};
        Object.keys(ITENS_PREOP).forEach(k => { preOp[k] = document.getElementById('mPre-' + k).checked; });
        novaCirurgia = Object.assign({}, selecionada.cirurgia, { preOp });
    }
    const mudouCirurgia = !!novaCirurgia &&
        JSON.stringify(novaCirurgia.preOp) !== JSON.stringify(selecionada.cirurgia.preOp || {});
    const mudouAtendimento = status !== selecionada.status || mensagem !== (selecionada.mensagemPublica || '') ||
        !!obs || status === 'AGENDADA' || mudouCirurgia;
    const dadosTriagem = {
        prioridade, motivo, definidoPor: eu.uid, definidoPorNome: eu.nome, definidoEm: FieldValue.serverTimestamp()
    };
    if (!mudouAtendimento) {
        if (!mudouPrioridade) { modal.hide(); return; }
        btn.disabled = true;
        try {
            await db.collection('triagem').doc(selecionada.protocolo).set(dadosTriagem);
            modal.hide();
            await carregar();
            aviso('avisoPainel', 'Prioridade de #' + selecionada.protocolo + ' atualizada para ' + PRIORIDADES[prioridade].rotulo + '.', 'success');
        } catch (e) {
            erro.textContent = mensagemErroAuth(e);
            erro.classList.remove('d-none');
        } finally {
            btn.disabled = false;
        }
        return;
    }

    if (!podeAplicar(status)) {
        erro.textContent = 'Somente Regulador ou Administrador pode aplicar o status "' + STATUS[status].rotulo + '".';
        erro.classList.remove('d-none');
        return;
    }
    // Agendada: data, horário e local são obrigatórios e vão para o munícipe
    const dadosSol = { status, mensagemPublica: mensagem, atualizadoEm: null, atualizadoPor: eu.uid };
    if (mudouCirurgia) {
        dadosSol.cirurgia = novaCirurgia;
        const feitos = Object.values(novaCirurgia.preOp).filter(Boolean).length;
        obs = ['Pré-operatório: ' + feitos + ' de 4', obs].filter(Boolean).join(' • ').slice(0, 500);
    }
    const dadosCons = { status, mensagem, atualizadoEm: null };
    // vaga que o pedido ocupa hoje numa agenda (se tiver)
    const antiga = selecionada.status === 'AGENDADA' && selecionada.agendamento && selecionada.agendamento.agendaId != null
        ? selecionada.agendamento : null;
    let vagaNova = null;        // { agenda, n } escolhida no seletor
    let liberarAntiga = false;
    if (status === 'AGENDADA') {
        const r = lerSeletor('mk');
        const manual = lerAgendamento();
        let a = null;
        if (r) {
            a = agendamentoDaVaga(r.agenda, r.n);
            vagaNova = r;
        } else if (manual.data && manual.hora) {
            if (manual.local.length < 3) {
                erro.textContent = 'Informe o local do atendimento.';
                erro.classList.remove('d-none');
                return;
            }
            a = manual;
        } else if (!(selecionada.status === 'AGENDADA' && selecionada.agendamento)) {
            erro.textContent = 'Para marcar, escolha quem vai atender, o dia e o horário (ou digite a marcação à mão).';
            erro.classList.remove('d-none');
            return;
        }
        if (a) {
            dadosSol.agendamento = a;
            dadosCons.agendamento = a;
            liberarAntiga = !!antiga;
            obs = ['Marcado: ' + agendamentoParaTexto(a) + (antiga ? ' (antes: ' + agendamentoParaTexto(antiga) + ')' : ''), obs]
                .filter(Boolean).join(' • ').slice(0, 500);
        }
    } else if (antiga && [...ABERTOS, 'NEGADA', 'CANCELADA'].includes(status) && podeRegular()) {
        // desmarcou (voltou para a fila, negado ou cancelado): libera a vaga para outra pessoa
        dadosSol.agendamento = null;
        dadosCons.agendamento = null;
        liberarAntiga = true;
        obs = ['Vaga liberada: ' + agendamentoParaTexto(antiga), obs].filter(Boolean).join(' • ').slice(0, 500);
    }
    btn.disabled = true;
    try {
        const agora = FieldValue.serverTimestamp();
        dadosSol.atualizadoEm = agora;
        dadosCons.atualizadoEm = agora;
        const ref = db.collection('solicitacoes').doc(selecionada.protocolo);
        const batch = db.batch();
        batch.update(ref, dadosSol);
        if (liberarAntiga) batch.delete(db.collection('agendas').doc(antiga.agendaId).collection('vagas').doc(String(antiga.vaga)));
        if (vagaNova) {
            batch.set(db.collection('agendas').doc(vagaNova.agenda.id).collection('vagas').doc(String(vagaNova.n)), {
                protocolo: selecionada.protocolo, paciente: selecionada.paciente, hora: dadosSol.agendamento.hora,
                marcadoPor: eu.uid, marcadoEm: agora
            });
        }
        // consulta pública por CPF (pedidos antigos podem não ter: então só atualiza se existir)
        if (selecionada.cpf) {
            const refCons = db.collection('consultas').doc(selecionada.cpf).collection('pedidos').doc(selecionada.protocolo);
            if ((await refCons.get()).exists) batch.update(refCons, dadosCons);
        }
        batch.set(ref.collection('historico').doc(), {
            usuario: eu.uid, usuarioNome: eu.nome,
            statusAnterior: selecionada.status, statusNovo: status,
            observacao: obs || null, criadoEm: agora
        });
        if (mudouPrioridade) batch.set(db.collection('triagem').doc(selecionada.protocolo), dadosTriagem);
        await batch.commit();
        modal.hide();
        await carregar();
        if (vagaNova || liberarAntiga) carregarAgendas();
        aviso('avisoPainel', 'Solicitação #' + selecionada.protocolo + ' atualizada.' +
            (vagaNova ? ' Marcado: ' + agendamentoParaTexto(dadosSol.agendamento) + '.' : ''), 'success');
    } catch (e) {
        erro.textContent = vagaNova ? erroMarcacao(e) : mensagemErroAuth(e);
        erro.classList.remove('d-none');
    } finally {
        btn.disabled = false;
    }
}

// ---------------------------------------------------------------- relatórios
const COR_SERIE = '#2a78d6';          // uma série por gráfico: uma cor só (sem legenda)
const COR_TEXTO = '#52514e';
const COR_GRADE = '#e8e8e4';
const graficos = {};

function contarPor(lista, chave) {
    const mapa = new Map();
    lista.forEach(s => { const k = chave(s); mapa.set(k, (mapa.get(k) || 0) + 1); });
    return mapa;
}

function desenharGrafico(id, rotulos, valores, opcoes) {
    if (typeof Chart === 'undefined') return; // biblioteca não carregou (sem internet): fica só a tabela
    if (graficos[id]) graficos[id].destroy();
    const horizontal = !!(opcoes && opcoes.horizontal);
    graficos[id] = new Chart(document.getElementById(id), {
        type: 'bar',
        data: { labels: rotulos, datasets: [{ data: valores, backgroundColor: COR_SERIE, borderRadius: 4, maxBarThickness: 28, borderSkipped: 'start' }] },
        options: {
            indexAxis: horizontal ? 'y' : 'x',
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (c) => ' ' + c.formattedValue + ((opcoes && opcoes.unidade) || '') } }
            },
            scales: {
                x: { grid: { display: horizontal, color: COR_GRADE }, ticks: { color: COR_TEXTO, precision: 0 }, beginAtZero: true },
                y: { grid: { display: !horizontal, color: COR_GRADE }, ticks: { color: COR_TEXTO, precision: 0 }, beginAtZero: true }
            }
        }
    });
}

function desenharRelatorios() {
    const dias = Number(document.getElementById('relPeriodo').value);
    const ubs = document.getElementById('relUbs').value;
    const limite = dias ? Date.now() - dias * DIA_MS : 0;
    const lista = solicitacoes.filter(s => (emMs(s.criadoEm) || 0) >= limite && (!ubs || s.ubsId === ubs));
    document.getElementById('relBase').textContent = `Base: ${lista.length} pedido(s) do período, entre os ${solicitacoes.length} carregados no painel` +
        (temMais ? ' (use "Carregar mais" na aba Solicitações para incluir pedidos mais antigos).' : '.');

    // números principais
    const conta = (sts) => lista.filter(s => sts.includes(s.status)).length;
    const concluidos = conta(['CONCLUIDA']);
    const faltas = conta(['FALTOU']);
    const taxaFaltas = concluidos + faltas ? Math.round(100 * faltas / (concluidos + faltas)) : null;
    const atendidos = lista.filter(s => ['AGENDADA', 'CONCLUIDA', 'FALTOU'].includes(s.status));
    const esperaMarcacao = atendidos.length ? Math.round(atendidos.reduce((t, s) => t + diasEspera(s), 0) / atendidos.length) : null;
    const numeros = [
        ['Pedidos no período', lista.length, 'bi-inbox'],
        ['Em aberto', conta(ABERTOS), 'bi-hourglass-split'],
        ['Concluídos', concluidos, 'bi-check2-circle'],
        ['Faltas (não compareceu)', taxaFaltas === null ? '—' : taxaFaltas + '%', 'bi-person-x', `${faltas} de ${concluidos + faltas} atendimentos marcados`],
        ['Espera média até a marcação', esperaMarcacao === null ? '—' : textoDias(esperaMarcacao), 'bi-stopwatch', `${atendidos.length} pedido(s) marcados ou atendidos`]
    ];
    document.getElementById('relNumeros').innerHTML = numeros.map(([rotulo, valor, icone, detalhe]) => `
        <div class="col-6 col-lg">
            <div class="card border-0 shadow-sm h-100"><div class="card-body">
                <div class="small text-muted"><i class="bi ${icone} me-1"></i>${rotulo}</div>
                <div class="cartao-numero">${esc(valor)}</div>
                ${detalhe ? `<div class="small text-muted">${esc(detalhe)}</div>` : ''}
            </div></div>
        </div>`).join('');

    // pedidos por mês (últimos meses do período, inclusive meses sem pedidos)
    const porMes = contarPor(lista, s => { const d = s.criadoEm ? s.criadoEm.toDate() : new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); });
    const meses = [...porMes.keys()].sort();
    if (meses.length) {
        const [a0, m0] = meses[0].split('-').map(Number);
        const fim = meses[meses.length - 1];
        meses.length = 0;
        for (let a = a0, m = m0; ; m++) {
            if (m > 12) { m = 1; a++; }
            const k = a + '-' + String(m).padStart(2, '0');
            meses.push(k);
            if (k === fim || meses.length > 36) break;
        }
    }
    const nomeMes = (k) => { const [a, m] = k.split('-'); return ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][m - 1] + '/' + a.slice(2); };
    desenharGrafico('grafMes', meses.map(nomeMes), meses.map(k => porMes.get(k) || 0));

    const porStatus = contarPor(lista, s => s.status);
    const sts = Object.keys(STATUS).filter(k => porStatus.get(k));
    desenharGrafico('grafStatus', sts.map(k => STATUS[k].rotulo), sts.map(k => porStatus.get(k)), { horizontal: true });

    const porUbs = contarPor(lista, s => s.ubs);
    const ubsOrd = [...porUbs.entries()].sort((a, b) => b[1] - a[1]);
    desenharGrafico('grafUbs', ubsOrd.map(([k]) => k.replace('UBS Família ', '')), ubsOrd.map(([, v]) => v), { horizontal: true });

    const porServ = contarPor(lista, s => s.servico);
    const servOrd = [...porServ.entries()].sort((a, b) => b[1] - a[1]);
    desenharGrafico('grafServico', servOrd.map(([k]) => k), servOrd.map(([, v]) => v), { horizontal: true });

    // espera média por serviço (pedidos cancelados/negados ficam de fora)
    const comEspera = lista.filter(s => !['CANCELADA', 'NEGADA'].includes(s.status));
    const esperaServ = SERVICOS.map(sv => {
        const doServ = comEspera.filter(s => s.servicoId === sv.id);
        return [sv.nome, doServ.length ? Math.round(doServ.reduce((t, s) => t + diasEspera(s), 0) / doServ.length) : 0, doServ.length];
    }).filter(([, , n]) => n).sort((a, b) => b[1] - a[1]);
    desenharGrafico('grafEspera', esperaServ.map(([k]) => k), esperaServ.map(([, v]) => v), { horizontal: true, unidade: ' dias' });

    // tabela com os mesmos números (acessível e para quem prefere ler)
    const tabela = (titulo, linhas) => `<table class="table table-sm mb-3"><thead><tr><th>${titulo}</th><th class="text-end">Valor</th></tr></thead><tbody>` +
        linhas.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="text-end">${esc(v)}</td></tr>`).join('') + '</tbody></table>';
    document.getElementById('relTabela').innerHTML = '<div class="row"><div class="col-md-6">' +
        tabela('Mês', meses.map(k => [nomeMes(k), porMes.get(k) || 0])) +
        tabela('Situação', sts.map(k => [STATUS[k].rotulo, porStatus.get(k)])) +
        '</div><div class="col-md-6">' +
        tabela('UBS', ubsOrd) + tabela('Serviço', servOrd) +
        tabela('Espera média por serviço', esperaServ.map(([k, v, n]) => [k + ` (${n} pedidos)`, textoDias(v)])) +
        '</div></div>';
}

// ---------------------------------------------------------------- atendimento presencial (balcão)
// Passo 1: busca pelo CPF (conta do site → cadastro de balcão → cadastro novo).
// Passo 2: pedido feito pelo servidor em nome da pessoa (inclui cirurgia eletiva).
// Passo 3: comprovante impresso + aviso por WhatsApp.
let balPessoa = null;   // { pid, origem: 'conta' | 'balcao' | 'novo', nome, cpf, sus, nascimento, telefone }
let balUltimo = null;   // último pedido registrado (para comprovante/WhatsApp)

function balErro(texto) {
    const el = document.getElementById('balErro');
    el.textContent = texto || '';
    el.classList.toggle('d-none', !texto);
}

function balcaoNovo() {
    balPessoa = null;
    balUltimo = null;
    ['balCpf', 'balNome', 'balNasc', 'balTel', 'balSus', 'balProcedimento', 'balHospital', 'balMotivo', 'balObs', 'balGuia']
        .forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('balLgpd').checked = false;
    document.querySelectorAll('#balPreOp input').forEach(c => { c.checked = false; });
    document.getElementById('balServico').value = SERVICOS[0].id;
    document.getElementById('balPrioridade').value = 'NORMAL';
    document.getElementById('balResultado').innerHTML = '';
    ['balCadastro', 'balPasso2', 'balPasso3', 'balCirurgia'].forEach(id => document.getElementById(id).classList.add('d-none'));
    balErro('');
    document.getElementById('balCpf').focus();
}

async function balcaoBuscar() {
    const cpf = soDigitos(document.getElementById('balCpf').value);
    const res = document.getElementById('balResultado');
    ['balCadastro', 'balPasso2', 'balPasso3'].forEach(id => document.getElementById(id).classList.add('d-none'));
    balErro('');
    if (!cpfValido(cpf)) { res.innerHTML = '<div class="alert alert-warning py-2 mb-0">Digite os 11 números do CPF.</div>'; return; }
    res.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Buscando...';
    try {
        let doc = null;
        let origem = 'novo';
        const login = await db.collection('logins').doc(cpf).get();
        if (login.exists) {
            doc = await db.collection('pacientes').doc(login.get('uid')).get();
            origem = 'conta';
        } else {
            const b = await db.collection('pacientes').doc('balcao-' + cpf).get();
            if (b.exists) { doc = b; origem = 'balcao'; }
        }
        if (doc && doc.exists) {
            balPessoa = Object.assign({ pid: doc.id, origem }, doc.data());
            const anos = idade(balPessoa.nascimento);
            const doCpf = solicitacoes.filter(s => s.cpf === cpf);
            const abertos = doCpf.filter(s => ABERTOS.includes(s.status));
            res.innerHTML = `
                <div class="alert alert-success mb-0">
                    <div class="fw-bold fs-5"><i class="bi bi-person-check me-1"></i>${esc(balPessoa.nome)}</div>
                    <div>${anos} anos • nasc. ${esc(nascimentoParaTexto(balPessoa.nascimento))} • tel. ${esc(mascararTelefone(balPessoa.telefone) || 'não informado')}</div>
                    <div class="small">${origem === 'conta' ? '<span class="badge bg-primary">tem conta no site</span>'
                        : `<span class="badge bg-secondary">cadastrado na UBS</span> por ${esc(balPessoa.cadastradoPorNome || '')}`}
                        • ${doCpf.length} pedido(s), ${abertos.length} em aberto
                        ${abertos.length ? '(' + abertos.map(s => '#' + esc(s.protocolo) + ' ' + esc(s.servico)).join('; ') + ')' : ''}</div>
                </div>`;
        } else {
            balPessoa = { pid: 'balcao-' + cpf, origem: 'novo', cpf };
            res.innerHTML = '<div class="alert alert-warning py-2 mb-0"><i class="bi bi-person-plus me-1"></i>CPF sem cadastro. Preencha os dados abaixo (só leva um minuto).</div>';
            document.getElementById('balCadastro').classList.remove('d-none');
            document.getElementById('balNome').focus();
        }
        document.getElementById('balPasso2').classList.remove('d-none');
        balcaoSugerirPrioridade();
    } catch (e) {
        res.innerHTML = `<div class="alert alert-danger py-2 mb-0">${esc(mensagemErroAuth(e))}</div>`;
    }
}

/** Sugere a prioridade legal pela idade (o servidor pode mudar). */
function balcaoSugerirPrioridade() {
    const nasc = balPessoa && balPessoa.origem !== 'novo' ? balPessoa.nascimento : document.getElementById('balNasc').value;
    const anos = idade(nasc);
    const sel = document.getElementById('balPrioridade');
    const motivo = document.getElementById('balMotivo');
    if (anos >= 80) { sel.value = 'PRIORITARIO'; motivo.value = 'Idoso 80+ (prioridade legal)'; }
    else if (anos >= 60) { sel.value = 'PRIORITARIO'; motivo.value = 'Idoso 60+ (prioridade legal)'; }
}

function balcaoServico() {
    const cir = document.getElementById('balServico').value === 'cirurgia-eletiva';
    document.getElementById('balCirurgia').classList.toggle('d-none', !cir);
}

async function balcaoRegistrar() {
    balErro('');
    if (!balPessoa) { balErro('Busque a pessoa pelo CPF primeiro.'); return; }
    const pessoa = Object.assign({}, balPessoa);
    if (pessoa.origem === 'novo') {
        pessoa.nome = document.getElementById('balNome').value.trim().replace(/\s+/g, ' ');
        pessoa.nascimento = document.getElementById('balNasc').value;
        pessoa.telefone = soDigitos(document.getElementById('balTel').value);
        pessoa.sus = soDigitos(document.getElementById('balSus').value);
        if (pessoa.nome.length < 3 || !pessoa.nome.includes(' ')) return balErro('Informe o nome completo.');
        if (!dataNascimentoValida(pessoa.nascimento)) return balErro('Informe a data de nascimento.');
        if (pessoa.telefone && (pessoa.telefone.length < 10 || pessoa.telefone.length > 11)) return balErro('Telefone com DDD (ou deixe em branco).');
        if (pessoa.sus && pessoa.sus.length !== 15) return balErro('Cartão SUS com 15 números (ou deixe em branco).');
        if (!document.getElementById('balLgpd').checked) return balErro('Marque a autorização (LGPD) depois de ler para a pessoa.');
    }
    const servico = SERVICOS.find(s => s.id === document.getElementById('balServico').value);
    const ubs = UBS.find(u => u.id === document.getElementById('balUbs').value);
    let cirurgia = null;
    if (servico.id === 'cirurgia-eletiva') {
        const preOp = {};
        Object.keys(ITENS_PREOP).forEach(k => { preOp[k] = document.getElementById('balPre-' + k).checked; });
        cirurgia = {
            procedimento: document.getElementById('balProcedimento').value.trim(),
            hospital: document.getElementById('balHospital').value.trim(),
            preOp
        };
        if (cirurgia.procedimento.length < 3) return balErro('Informe o procedimento da cirurgia.');
        if (cirurgia.hospital.length < 3) return balErro('Informe o hospital de referência.');
    }
    const prioridade = document.getElementById('balPrioridade').value;
    const motivo = document.getElementById('balMotivo').value.trim().slice(0, 200);
    const obs = document.getElementById('balObs').value.trim();
    const arquivo = document.getElementById('balGuia').files[0];

    const btn = document.getElementById('balBtnRegistrar');
    btn.disabled = true;
    try {
        const anexo = arquivo ? await prepararAnexo(arquivo) : null;
        let protocolo = null;
        for (let tentativa = 0; tentativa < 3 && !protocolo; tentativa++) {
            const prot = gerarProtocolo();
            const agora = FieldValue.serverTimestamp();
            const batch = db.batch();
            if (pessoa.origem === 'novo') {
                batch.set(db.collection('pacientes').doc(pessoa.pid), {
                    nome: pessoa.nome, cpf: pessoa.cpf, sus: pessoa.sus, nascimento: pessoa.nascimento, telefone: pessoa.telefone,
                    semConta: true, consentimentoLgpd: true, consentimentoPresencial: true,
                    cadastradoPor: eu.uid, cadastradoPorNome: eu.nome, ubsCadastro: ubs.nome,
                    criadoEm: agora, atualizadoEm: agora
                });
            }
            const sol = {
                protocolo: prot, uid: pessoa.pid, paciente: pessoa.nome, cpf: pessoa.cpf, sus: pessoa.sus,
                nascimento: pessoa.nascimento, telefone: pessoa.telefone,
                ubsId: ubs.id, ubs: ubs.nome, servicoId: servico.id, servico: servico.nome,
                status: 'RECEBIDA', mensagemPublica: STATUS.RECEBIDA.mensagem,
                temAnexo: !!anexo, qtdExtras: 0, consentimentoLgpd: true,
                canal: 'BALCAO', criadoPor: eu.uid, criadoPorNome: eu.nome,
                criadoEm: agora, atualizadoEm: agora
            };
            if (cirurgia) sol.cirurgia = cirurgia;
            const ref = db.collection('solicitacoes').doc(prot);
            batch.set(ref, sol);
            batch.set(ref.collection('historico').doc(), {
                usuario: eu.uid, usuarioNome: eu.nome, statusAnterior: null, statusNovo: 'RECEBIDA',
                observacao: ('Atendimento presencial na ' + ubs.nome + (obs ? ' • ' + obs : '')).slice(0, 500), criadoEm: agora
            });
            if (anexo) batch.set(db.collection('anexos').doc(prot), { uid: pessoa.pid, dados: anexo.dados, tipo: anexo.tipo, nome: anexo.nome, criadoEm: agora });
            batch.set(db.collection('consultas').doc(pessoa.cpf).collection('pedidos').doc(prot), {
                protocolo: prot, status: 'RECEBIDA', primeiroNome: pessoa.nome.split(' ')[0],
                servico: servico.nome, ubs: ubs.nome, mensagem: STATUS.RECEBIDA.mensagem, atualizadoEm: agora
            });
            if (prioridade !== 'NORMAL' || motivo) {
                batch.set(db.collection('triagem').doc(prot), {
                    prioridade, motivo, definidoPor: eu.uid, definidoPorNome: eu.nome, definidoEm: agora
                });
            }
            try {
                await batch.commit();
                protocolo = prot;
            } catch (e) {
                if (e.code !== 'permission-denied' || tentativa === 2) throw e;
            }
        }
        balUltimo = { protocolo, pessoa, servico, ubs, cirurgia, quando: new Date() };
        montarComprovante();
        document.getElementById('balProtocolo').textContent = '#' + protocolo;
        document.getElementById('balBtnWpp').classList.toggle('d-none', !numeroWhatsApp(pessoa.telefone));
        document.getElementById('balPasso2').classList.add('d-none');
        document.getElementById('balCadastro').classList.add('d-none');
        document.getElementById('balPasso3').classList.remove('d-none');
        carregar();
    } catch (e) {
        balErro(e.code ? mensagemErroAuth(e) : e.message);
    } finally {
        btn.disabled = false;
    }
}

function montarComprovante() {
    const u = balUltimo;
    document.getElementById('comprovante').innerHTML = `
        <div style="text-align:center;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:12px">
            <img src="img/logo.svg" width="56" height="56" alt=""><br>
            <strong style="font-size:18px">Agiliza Saúde • Cidade Ocidental (GO)</strong><br>
            Comprovante de atendimento presencial
        </div>
        <div style="text-align:center;font-size:28px;font-weight:bold;margin:8px 0">Protocolo #${esc(u.protocolo)}</div>
        <p><strong>Paciente:</strong> ${esc(u.pessoa.nome)}<br>
           <strong>CPF:</strong> ${esc(mascararCpf(u.pessoa.cpf))}<br>
           <strong>Serviço:</strong> ${esc(u.servico.nome)}${u.cirurgia ? ' — ' + esc(u.cirurgia.procedimento) + '<br><strong>Hospital:</strong> ' + esc(u.cirurgia.hospital) : ''}<br>
           <strong>UBS:</strong> ${esc(u.ubs.nome)}<br>
           <strong>Data:</strong> ${esc(u.quando.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }))}<br>
           <strong>Atendido por:</strong> ${esc(eu.nome)}</p>
        <div style="border:1px dashed #000;padding:8px">
            <strong>Como acompanhar:</strong> acesse <strong>agiliza-saude-5ab0e.web.app</strong>,
            clique em "Acompanhar Solicitação" e digite o seu <strong>CPF</strong>.
            Você também pode perguntar na sua UBS.
        </div>
        <p style="font-size:12px;margin-top:10px">Guarde este comprovante. Não é para urgências: em caso de emergência ligue 192 (SAMU).</p>`;
}

function balcaoWhatsApp() {
    const u = balUltimo;
    const texto = textoWhatsApp({
        paciente: u.pessoa.nome, protocolo: u.protocolo, servico: u.servico.nome + (u.cirurgia ? ' — ' + u.cirurgia.procedimento : ''),
        status: 'RECEBIDA', mensagemPublica: 'Seu pedido foi registrado na ' + u.ubs.nome + '.'
    });
    const url = linkWhatsApp(u.pessoa.telefone, texto);
    if (url) window.open(url, '_blank', 'noopener');
}

/** Texto da cirurgia para a tabela/janela: procedimento, hospital e pré-operatório (x de 4). */
function resumoCirurgia(c) {
    if (!c) return '';
    const feitos = Object.keys(ITENS_PREOP).filter(k => c.preOp && c.preOp[k]).length;
    return `<div class="small text-primary"><i class="bi bi-hospital me-1"></i>${esc(c.procedimento)} • ${esc(c.hospital)}</div>` +
        `<div class="small ${feitos === 4 ? 'text-success' : 'text-muted'}">Pré-operatório: ${feitos} de 4</div>`;
}

// ---------------------------------------------------------------- ficha 360° do paciente
// Tudo sobre a pessoa numa tela: dados, indicadores, pedidos (com prioridade e marcação) e linha do tempo.
const modalFicha = new bootstrap.Modal(document.getElementById('modalFicha'));

async function abrirFicha(cpf) {
    const corpo = document.getElementById('corpoFicha');
    corpo.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Carregando a ficha...';
    modalFicha.show();
    try {
        const snap = await db.collection('solicitacoes').where('cpf', '==', cpf).get();
        const pedidos = snap.docs.map(d => d.data())
            .sort((a, b) => (emMs(b.criadoEm) || 0) - (emMs(a.criadoEm) || 0));
        if (!pedidos.length) { corpo.textContent = 'Nenhum pedido para este CPF.'; return; }
        const [pacDoc, prios, historicos] = await Promise.all([
            db.collection('pacientes').doc(pedidos[0].uid).get(),
            Promise.all(pedidos.map(p => db.collection('triagem').doc(p.protocolo).get())),
            Promise.all(pedidos.map(p => db.collection('solicitacoes').doc(p.protocolo).collection('historico').get()))
        ]);
        const pac = pacDoc.exists ? pacDoc.data() : pedidos[0];
        const nome = pac.nome || pedidos[0].paciente;
        const anos = idade(pac.nascimento || pedidos[0].nascimento);
        const telefone = pac.telefone || pedidos[0].telefone;
        const conta = pacDoc.exists && !pac.semConta;
        const conta2 = (lista) => pedidos.filter(p => lista.includes(p.status)).length;
        const faltas = conta2(['FALTOU']);
        const realizados = conta2(['CONCLUIDA']);
        const abertos = pedidos.filter(p => ABERTOS.includes(p.status));
        const maiorEspera = abertos.length ? Math.max(...abertos.map(diasEspera)) : null;
        const prioPorProt = {};
        prios.forEach((d, i) => { if (d.exists) prioPorProt[pedidos[i].protocolo] = d.data(); });

        // linha do tempo: todos os históricos de todos os pedidos, do mais recente para o mais antigo
        const eventos = [];
        historicos.forEach((h, i) => h.docs.forEach(d => eventos.push(Object.assign({ protocolo: pedidos[i].protocolo }, d.data()))));
        eventos.sort((a, b) => (emMs(b.criadoEm) || 0) - (emMs(a.criadoEm) || 0));

        const kpi = (rotulo, valor, cor) => `<div class="col-6 col-md-2"><div class="border rounded-3 p-2 text-center h-100">
            <div class="small text-muted">${rotulo}</div><div class="fs-4 fw-bold ${cor || ''}">${esc(valor)}</div></div></div>`;
        corpo.innerHTML = `
            <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
                <div>
                    <h4 class="fw-bold mb-1">${esc(nome)}</h4>
                    <div class="small">${anos != null ? anos + ' anos • ' : ''}nasc. ${esc(nascimentoParaTexto(pac.nascimento || pedidos[0].nascimento))}
                        • CPF ${esc(mascararCpf(cpf))} • SUS ${esc(mascararSus(pac.sus) || '—')}</div>
                    <div class="small">Telefone: ${esc(mascararTelefone(telefone) || 'não informado')}${pac.email ? ' • E-mail: ' + esc(pac.email) : ''}</div>
                    <div class="mt-1">
                        ${conta ? '<span class="badge bg-primary">tem conta no site</span>' : `<span class="badge bg-secondary">cadastrado na UBS${pac.cadastradoPorNome ? ' por ' + esc(pac.cadastradoPorNome) : ''}</span>`}
                        ${anos >= 80 ? '<span class="badge bg-warning text-dark">prioridade legal 80+</span>' : anos >= 60 ? '<span class="badge bg-warning text-dark">prioridade legal 60+</span>' : ''}
                        ${faltas >= 2 ? `<span class="badge bg-danger">${faltas} faltas</span>` : ''}
                    </div>
                </div>
                <div class="d-flex flex-wrap gap-2">
                    ${numeroWhatsApp(telefone) ? `<a class="btn btn-success btn-sm" target="_blank" rel="noopener" href="${esc(linkWhatsApp(telefone, `Olá, ${nome.split(' ')[0]}! Aqui é da Secretaria Municipal de Saúde de Cidade Ocidental (Agiliza Saúde).`))}"><i class="bi bi-whatsapp me-1"></i>WhatsApp</a>` : ''}
                    <button class="btn btn-outline-success btn-sm" onclick="novoPedidoBalcao('${esc(cpf)}')"><i class="bi bi-person-plus me-1"></i>Novo pedido (balcão)</button>
                </div>
            </div>
            <div class="row g-2 mb-3">
                ${kpi('Pedidos', pedidos.length)}
                ${kpi('Em aberto', abertos.length, abertos.length ? 'text-warning' : '')}
                ${kpi('Marcados', conta2(['AGENDADA']), 'text-primary')}
                ${kpi('Realizados', realizados, 'text-success')}
                ${kpi('Faltas', faltas, faltas ? 'text-danger' : '')}
                ${kpi('Maior espera', maiorEspera == null ? '—' : textoDias(maiorEspera), maiorEspera >= ESPERA_CRITICA ? 'text-danger' : '')}
            </div>
            <div class="row g-3">
                <div class="col-12 col-lg-7">
                    <h6 class="fw-bold">Pedidos</h6>
                    ${pedidos.map(p => {
                        const pr = prioPorProt[p.protocolo];
                        return `<div class="border rounded-3 p-2 mb-2 small">
                            <div class="d-flex justify-content-between"><strong>#${esc(p.protocolo)}</strong>${badgeStatus(p.status)}</div>
                            <div>${esc(p.servico)} • ${esc(p.ubs)} ${p.canal === 'BALCAO' ? '<span class="badge bg-success-subtle text-success-emphasis">Balcão</span>' : ''}</div>
                            ${resumoCirurgia(p.cirurgia)}
                            ${p.status === 'AGENDADA' && p.agendamento ? `<div class="text-primary"><i class="bi bi-calendar-check me-1"></i>${esc(agendamentoParaTexto(p.agendamento))}</div>` : ''}
                            <div class="text-muted">Pedido em ${esc(dataParaTexto(p.criadoEm))} • espera ${esc(textoDias(diasEspera(p)))}
                                ${pr ? ` • <span class="badge ${PRIORIDADES[pr.prioridade].cor}">${esc(PRIORIDADES[pr.prioridade].rotulo)}</span> ${esc(pr.motivo || '')}` : ''}</div>
                        </div>`;
                    }).join('')}
                </div>
                <div class="col-12 col-lg-5">
                    <h6 class="fw-bold">Linha do tempo</h6>
                    <div class="small" style="max-height:420px;overflow:auto">
                        ${eventos.map(e => `<div class="border-start border-3 ps-2 mb-2">
                            <div><strong>${esc((STATUS[e.statusNovo] || {}).rotulo || e.statusNovo)}</strong> <span class="text-muted">#${esc(e.protocolo)}</span></div>
                            <div class="text-muted">${esc(dataParaTexto(e.criadoEm))} • ${esc(e.usuarioNome || '')}</div>
                            ${e.observacao ? `<div>${esc(e.observacao)}</div>` : ''}
                        </div>`).join('') || '<span class="text-muted">Sem eventos.</span>'}
                    </div>
                </div>
            </div>`;
    } catch (e) {
        corpo.textContent = mensagemErroAuth(e);
    }
}

/** Da ficha para o atendimento presencial, já com o CPF buscado. */
function novoPedidoBalcao(cpf) {
    modalFicha.hide();
    bootstrap.Tab.getOrCreateInstance(document.getElementById('abaBalcaoBtn')).show();
    balcaoNovo();
    document.getElementById('balCpf').value = mascararCpf(cpf);
    balcaoBuscar();
}

// ---------------------------------------------------------------- profissionais e agendas (oferta de vagas)
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const modalAgendaUi = new bootstrap.Modal(document.getElementById('modalAgenda'));
let profissionais = [];
let agendas = [];            // próximas agendas, com .ocupadas
let agendaAberta = null;     // { id, ...dados, vagasDocs: {n: doc} }
let propostas = {};          // vaga n -> protocolo (antes de confirmar)
let profSelecionado = null;  // profissional clicado (id), '' = agendas avulsas, null = nenhum
let agendasCarregadas = false;

function podeRegular() {
    return eu && (eu.perfil === 'REGULADOR' || eu.perfil === 'ADMIN');
}

function hojeIso() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function somarMinutos(hora, min) {
    const [h, m] = hora.split(':').map(Number);
    const t = h * 60 + m + min;
    return String(Math.floor(t / 60) % 24).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
}

function avisoAg(id, texto, tipo) {
    const el = document.getElementById(id);
    if (!texto) { el.classList.add('d-none'); return; }
    el.className = 'alert py-2 small alert-' + tipo;
    el.innerHTML = texto;
}

async function carregarAgendas() {
    document.querySelectorAll('.so-regulador').forEach(b => b.classList.toggle('d-none', !podeRegular()));
    document.getElementById('avisoSoLeitura').classList.toggle('d-none', podeRegular());
    try {
        const [snapProf, snapAg] = await Promise.all([
            db.collection('profissionais').get(),
            db.collection('agendas').where('data', '>=', hojeIso()).orderBy('data').limit(120).get()
        ]);
        profissionais = snapProf.docs.map(d => Object.assign({ id: d.id }, d.data())).sort((a, b) => a.nome.localeCompare(b.nome));
        agendas = snapAg.docs.map(d => Object.assign({ id: d.id }, d.data()))
            .sort((a, b) => a.data.localeCompare(b.data) || a.horaInicio.localeCompare(b.horaInicio));
        // ocupação de cada agenda (quantas vagas já têm paciente)
        const ocup = await Promise.all(agendas.map(a => db.collection('agendas').doc(a.id).collection('vagas').get()));
        ocup.forEach((s, i) => {
            agendas[i].ocupadas = s.size;
            agendas[i].ocupadasNums = s.docs.map(v => Number(v.id));
        });
        agendasCarregadas = true;
        desenharProfissionais();
        desenharAgendas();
        avisoAg('avisoAgendas', '');
    } catch (e) {
        avisoAg('avisoAgendas', esc(mensagemErroAuth(e)), 'danger');
    }
}

/** Agendas de um profissional ('' = agendas avulsas / mutirões). */
function agendasDe(profId) {
    return agendas.filter(a => (a.profissionalId || '') === profId);
}

function livresDe(lista) {
    return lista.reduce((t, a) => t + a.vagas - (a.ocupadas || 0), 0);
}

/** Lista de profissionais: clicar em um mostra SÓ a agenda dele ao lado. */
function desenharProfissionais() {
    const el = document.getElementById('listaProfissionais');
    el.classList.remove('text-muted');
    const cartao = (id, conteudo, extra) => {
        const ativo = profSelecionado === id;
        return `<div class="border rounded-3 p-2 mb-2 ${ativo ? 'border-primary border-2 bg-primary-subtle' : ''} ${extra || ''}"
            role="button" tabindex="0" onclick="selecionarProfissional('${esc(id)}')" onkeydown="if(event.key==='Enter')selecionarProfissional('${esc(id)}')">${conteudo}</div>`;
    };
    const resumo = lista => `<span class="badge ${lista.length ? 'bg-primary' : 'bg-secondary'}">${lista.length} dia(s) • ${livresDe(lista)} vaga(s) livre(s)</span>`;
    const avulsas = agendasDe('');
    const ativos = profissionais.filter(p => p.ativo !== false);
    const inativos = profissionais.filter(p => p.ativo === false);
    const dadosProf = p => `<strong>${esc(p.nome)}</strong> <span class="badge bg-light text-dark border">${esc(p.especialidade)}</span>
        <div class="text-muted">${esc(p.registro || '')}${p.registro ? ' • ' : ''}${esc(p.local)}</div>
        <div>${(p.diasSemana || []).map(d => DIAS_SEMANA[d]).join(', ')} • ${esc(p.horaInicio)}–${esc(p.horaFim)} • ${p.duracaoMin} min/paciente
            (${Math.floor((minutosDe(p.horaFim) - minutosDe(p.horaInicio)) / p.duracaoMin)} vagas/dia)</div>`;
    el.innerHTML = (ativos.length ? '' : '<div class="text-muted mb-2">Nenhum profissional ativo.</div>') + ativos.map(p => cartao(p.id, `
            <div class="d-flex justify-content-between align-items-start gap-2">
                <div>${dadosProf(p)}
                    <div class="mt-1 d-flex flex-wrap gap-1">${resumo(agendasDe(p.id))} ${seloFerias(p)}</div>
                </div>
                ${podeRegular() ? `<div class="d-flex flex-column gap-1" onclick="event.stopPropagation()">
                    <button class="btn btn-sm btn-outline-primary text-nowrap" onclick="gerarAgendas('${esc(p.id)}')"><i class="bi bi-calendar-plus me-1"></i>Gerar agendas</button>
                    <div class="btn-group btn-group-sm">
                        <button class="btn btn-outline-secondary" title="Editar cadastro, horários e férias" onclick="editarProfissional('${esc(p.id)}')"><i class="bi bi-pencil me-1"></i>Editar</button>
                        <button class="btn btn-outline-secondary" title="Não trabalha mais: desativa sem apagar os dados" onclick="desativarProfissional('${esc(p.id)}')"><i class="bi bi-moon"></i></button>
                    </div></div>` : ''}
            </div>`)).join('') + cartao('', `<strong><i class="bi bi-people me-1"></i>Agendas avulsas / mutirões</strong>
            <div class="text-muted">Dias extras sem médico fixo (ex.: mutirão de ultrassom)</div><div class="mt-1">${resumo(avulsas)}</div>`);
    // desativados: guardados (adormecidos), com o botão de reativar
    document.getElementById('blocoInativos').classList.toggle('d-none', !inativos.length);
    document.getElementById('qtdInativos').textContent = inativos.length;
    document.getElementById('listaInativos').innerHTML = inativos.map(p => `
        <div class="border rounded-3 p-2 mb-2 bg-light text-muted">
            <div class="d-flex justify-content-between align-items-start gap-2">
                <div>${dadosProf(p)}<div class="mt-1"><span class="badge bg-secondary"><i class="bi bi-moon me-1"></i>Desativado${p.inativoDesde ? ' desde ' + esc(nascimentoParaTexto(p.inativoDesde)) : ''}</span></div></div>
                ${podeRegular() ? `<div class="d-flex flex-column gap-1">
                    <button class="btn btn-sm btn-outline-success text-nowrap" onclick="reativarProfissional('${esc(p.id)}')"><i class="bi bi-sunrise me-1"></i>Reativar</button>
                    <button class="btn btn-sm btn-outline-secondary" onclick="editarProfissional('${esc(p.id)}')"><i class="bi bi-pencil me-1"></i>Editar</button></div>` : ''}
            </div>
        </div>`).join('');
}

function selecionarProfissional(id) {
    profSelecionado = id;
    desenharProfissionais();
    desenharAgendas();
    // no celular a agenda fica embaixo: rola até ela
    if (window.innerWidth < 1200) document.getElementById('tituloAgendas').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function minutosDe(hora) {
    const [h, m] = hora.split(':').map(Number);
    return h * 60 + m;
}

/** Agenda só do profissional escolhido (clique no nome dele à esquerda). */
function desenharAgendas() {
    const el = document.getElementById('listaAgendas');
    const titulo = document.getElementById('tituloAgendas');
    el.classList.remove('text-muted');
    if (profSelecionado === null) {
        titulo.innerHTML = '<i class="bi bi-calendar-week me-1"></i>Agenda';
        el.innerHTML = `<div class="text-center text-muted py-5"><i class="bi bi-hand-index fs-2 d-block mb-2"></i>
            Clique em um <strong>médico ou médica</strong> para ver a agenda dele(a).</div>`;
        return;
    }
    const p = profissionais.find(x => x.id === profSelecionado);
    titulo.innerHTML = '<i class="bi bi-calendar-week me-1"></i>' + (p ? 'Agenda de ' + esc(p.nome) + ' <span class="text-muted fw-normal">(' + esc(p.especialidade) + ')</span>' : 'Agendas avulsas / mutirões');
    const lista = agendasDe(profSelecionado);
    if (!lista.length) {
        el.innerHTML = p
            ? `Nenhum dia de atendimento nas próximas semanas. ${podeRegular() ? `<button class="btn btn-sm btn-primary ms-1" onclick="gerarAgendas('${esc(p.id)}')"><i class="bi bi-calendar-plus me-1"></i>Gerar agendas</button>` : ''}`
            : 'Nenhuma agenda avulsa. Use o botão "Agenda avulsa" para criar um mutirão.';
        return;
    }
    el.innerHTML = lista.map(a => {
        const pct = Math.round(100 * (a.ocupadas || 0) / a.vagas);
        const fim = horaDaVaga(a, a.vagas);
        return `<div class="border rounded-3 p-2 mb-2" role="button" onclick="abrirAgenda('${esc(a.id)}')">
            <div class="d-flex justify-content-between align-items-center gap-2">
                <div><strong>${esc(dataComDiaSemana(a.data).replace(/^./, c => c.toUpperCase()))}</strong> • ${esc(a.horaInicio)}–${esc(fim)}
                    ${deFerias(p, a.data) ? `<span class="badge bg-warning text-dark"><i class="bi bi-airplane me-1"></i>${esc(p.feriasMotivo || 'Férias')}</span>` : ''}
                    <div class="text-muted">${esc(a.servico)} • ${esc(a.local)}</div></div>
                <div class="d-flex align-items-center gap-2">
                    <div class="text-end text-nowrap"><strong>${a.ocupadas || 0}/${a.vagas}</strong> vagas<div class="small text-muted">${a.vagas - (a.ocupadas || 0)} livre(s)</div></div>
                    ${podeRegular() ? `<button class="btn btn-sm btn-outline-danger" title="Apagar esta agenda" onclick="event.stopPropagation(); apagarAgenda('${esc(a.id)}')"><i class="bi bi-trash"></i></button>` : ''}
                </div>
            </div>
            <div class="progress mt-1" style="height:6px"><div class="progress-bar ${pct >= 100 ? 'bg-success' : ''}" style="width:${pct}%"></div></div>
        </div>`;
    }).join('');
}

/** Apaga a agenda do dia sem perguntar; devolve quantos pacientes voltaram para a fila. */
async function apagarAgendaSemPerguntar(id, a) {
    const vagasSnap = await db.collection('agendas').doc(id).collection('vagas').get();
    const msg = 'O dia do seu atendimento foi cancelado pela Secretaria e o pedido voltou para a fila (sem perder o tempo de espera). Aguarde nova marcação.';
    const falhas = [];
    for (const v of vagasSnap.docs) {
        try {
            const batch = db.batch();
            await desmarcarNoLote(batch, id, Number(v.id), v.data().protocolo, msg, 'Agenda de ' + nascimentoParaTexto(a ? a.data : '') + ' apagada; voltou para a fila');
            await batch.commit();
        } catch (e) {
            falhas.push('#' + v.data().protocolo);
        }
    }
    if (falhas.length) throw new Error('Não foi possível desmarcar: ' + falhas.join(', '));
    await db.collection('agendas').doc(id).delete();
    return vagasSnap.size;
}

/** Apaga a agenda do dia. Quem estava marcado volta para a fila (sem perder o tempo de espera). */
async function apagarAgenda(id) {
    const a = agendas.find(x => x.id === id) || (agendaAberta && agendaAberta.id === id ? agendaAberta : null);
    const qtd = (await db.collection('agendas').doc(id).collection('vagas').get()).size;
    const quando = a ? dataComDiaSemana(a.data) + (a.profissionalNome ? ' (' + a.profissionalNome + ')' : '') : 'esta agenda';
    if (!confirm('Apagar a agenda de ' + quando + '?' + (qtd ? '\n\n' + qtd + ' paciente(s) marcado(s) voltarão para a fila, sem perder o tempo de espera.' : ''))) return;
    try {
        await apagarAgendaSemPerguntar(id, a);
        modalAgendaUi.hide();
        await Promise.all([carregar(), carregarAgendas()]);
        avisoAg('avisoAgendas', 'Agenda apagada.' + (qtd ? ' ' + qtd + ' paciente(s) voltaram para a fila — use "Preencher com a fila" em outro dia.' : ''), 'success');
    } catch (e) {
        avisoAg('avisoAgendas', esc(e.message && !e.code ? e.message : mensagemErroAuth(e)), 'danger');
    }
}

/** Pedido pelo protocolo, lido do banco (a lista da tela pode estar desatualizada). */
async function pedidoDe(prot) {
    const d = await db.collection('solicitacoes').doc(prot).get();
    return d.exists ? d.data() : null;
}

/** Adiciona ao lote: libera a vaga e devolve o pedido para a fila (se ainda estiver marcado nela). */
async function desmarcarNoLote(batch, agendaId, n, prot, msg, obs) {
    batch.delete(db.collection('agendas').doc(agendaId).collection('vagas').doc(String(n)));
    // lê do banco (a lista da tela pode estar desatualizada)
    const doc = await db.collection('solicitacoes').doc(prot).get();
    const s = doc.exists ? doc.data() : null;
    if (!s || s.status !== 'AGENDADA' || !s.agendamento || s.agendamento.agendaId !== agendaId) return;
    const agora = FieldValue.serverTimestamp();
    const ref = db.collection('solicitacoes').doc(prot);
    batch.update(ref, { status: 'EM_ANALISE_REGULACAO', mensagemPublica: msg, agendamento: null, atualizadoEm: agora, atualizadoPor: eu.uid });
    batch.set(ref.collection('historico').doc(), {
        usuario: eu.uid, usuarioNome: eu.nome, statusAnterior: 'AGENDADA', statusNovo: 'EM_ANALISE_REGULACAO',
        observacao: obs.slice(0, 500), criadoEm: agora
    });
    const refCons = db.collection('consultas').doc(s.cpf).collection('pedidos').doc(prot);
    if ((await refCons.get()).exists) batch.update(refCons, { status: 'EM_ANALISE_REGULACAO', mensagem: msg, agendamento: null, atualizadoEm: agora });
}

// ---------------------------------------------------------------- seletor "médico -> dia -> horário"
// Usado ao marcar um pedido (janela do pedido) e ao reagendar (janela da agenda).
// Só oferece dias que o profissional atende de verdade e horários ainda livres.
const seletores = {};   // prefixo -> { servicoId, ignorar: {agendaId, vaga} }

async function garantirAgendas() {
    if (!agendasCarregadas) await carregarAgendas();
}

function vagasLivres(a, ignorar) {
    const ocupadas = new Set(a.ocupadasNums || []);
    const agoraMin = new Date().getHours() * 60 + new Date().getMinutes();
    const livres = [];
    for (let n = 0; n < a.vagas; n++) {
        const propria = ignorar && ignorar.agendaId === a.id && ignorar.vaga === n;
        if (ocupadas.has(n) || propria) continue;
        if (a.data === hojeIso() && minutosDe(horaDaVaga(a, n)) <= agoraMin) continue; // já passou
        livres.push(n);
    }
    return livres;
}

function montarSeletor(prefixo, servicoId, ignorar, profInicial) {
    seletores[prefixo] = { servicoId, ignorar };
    const doServico = profissionais.filter(p => p.ativo && p.servicoId === servicoId);
    const outros = profissionais.filter(p => p.ativo && p.servicoId !== servicoId);
    const op = p => `<option value="${esc(p.id)}">${esc(p.nome)} — ${esc(p.especialidade)} (${livresDe(agendasDe(p.id))} livres)</option>`;
    const sel = document.getElementById(prefixo + 'Prof');
    sel.innerHTML = '<option value="">Escolha o médico(a)...</option>' +
        (doServico.length ? `<optgroup label="Atendem este serviço">${doServico.map(op).join('')}</optgroup>` : '') +
        (outros.length ? `<optgroup label="Outros profissionais">${outros.map(op).join('')}</optgroup>` : '') +
        `<optgroup label="Sem médico fixo"><option value="__avulsa">Agenda avulsa / mutirão (${livresDe(agendasDe(''))} livres)</option></optgroup>`;
    sel.value = profInicial === '' ? '__avulsa' : (profInicial || (doServico.length === 1 ? doServico[0].id : ''));
    if (sel.selectedIndex < 0) sel.value = '';
    seletorMudouProf(prefixo);
}

function seletorMudouProf(prefixo) {
    const v = document.getElementById(prefixo + 'Prof').value;
    const dia = document.getElementById(prefixo + 'Dia');
    const ign = seletores[prefixo].ignorar;
    if (!v) {
        dia.innerHTML = '<option value="">—</option>';
    } else {
        const lista = agendasDe(v === '__avulsa' ? '' : v)
            .filter(a => !deFerias(profissionais.find(p => p.id === a.profissionalId), a.data))   // de férias: não oferece
            .map(a => ({ a, livres: vagasLivres(a, ign).length }))
            .filter(x => x.livres > 0);
        dia.innerHTML = lista.length
            ? '<option value="">Escolha o dia...</option>' + lista.map(({ a, livres }) =>
                `<option value="${esc(a.id)}">${DIAS_SEMANA[new Date(a.data + 'T12:00:00').getDay()]} ${esc(nascimentoParaTexto(a.data))} • ${esc(a.horaInicio)} • ${livres} livre(s)${v === '__avulsa' ? ' • ' + esc(a.servico) : ''}</option>`).join('')
            : '<option value="">Sem dias livres — gere mais agendas</option>';
        if (lista.length === 1) dia.value = lista[0].a.id;
    }
    seletorMudouDia(prefixo);
}

function seletorMudouDia(prefixo) {
    const id = document.getElementById(prefixo + 'Dia').value;
    const hora = document.getElementById(prefixo + 'Hora');
    const a = agendas.find(x => x.id === id);
    if (!a) {
        hora.innerHTML = '<option value="">—</option>';
    } else {
        hora.innerHTML = '<option value="">Escolha...</option>' + vagasLivres(a, seletores[prefixo].ignorar)
            .map(n => `<option value="${n}">${esc(horaDaVaga(a, n))}</option>`).join('');
    }
    seletorMudouHora(prefixo);
}

function seletorMudouHora(prefixo) {
    const r = lerSeletor(prefixo);
    const el = document.getElementById(prefixo + 'Resumo');
    const atual = prefixo === 'mk' && selecionada && selecionada.status === 'AGENDADA' ? selecionada.agendamento : null;
    el.innerHTML = r
        ? `<i class="bi bi-calendar-check text-success me-1"></i>Vai ficar: <strong>${esc(agendamentoParaTexto(agendamentoDaVaga(r.agenda, r.n)))}</strong>`
        : (atual && atual.data ? `<i class="bi bi-calendar-event me-1"></i>Marcação atual: <strong>${esc(agendamentoParaTexto(atual))}</strong>. Para mudar, escolha outro médico, dia e horário.` : '');
    if (prefixo === 'mk' && r) sugerirMensagem();
}

/** { agenda, n } escolhidos no seletor, ou null. */
function lerSeletor(prefixo) {
    const a = agendas.find(x => x.id === document.getElementById(prefixo + 'Dia').value);
    const h = document.getElementById(prefixo + 'Hora').value;
    return a && h !== '' ? { agenda: a, n: Number(h) } : null;
}

/** Dados da marcação gravados no pedido: dia, hora certa da vaga, local, quem atende e orientações. */
function agendamentoDaVaga(a, n) {
    const ag = { data: a.data, hora: horaDaVaga(a, n), local: a.local, agendaId: a.id, vaga: n };
    if (a.profissionalNome) ag.profissional = a.profissionalNome + (a.especialidade ? ' (' + a.especialidade + ')' : '');
    if (a.orientacoes) ag.orientacoes = a.orientacoes;
    return ag;
}

// ---------------------------------------------------------------- reagendar (janela da agenda)
let reagendando = null;   // { n, prot }

async function abrirReagendar(n) {
    const a = agendaAberta;
    const vaga = a.vagasDocs[n];
    reagendando = { n, prot: vaga.protocolo };
    await garantirAgendas();
    document.getElementById('rgPaciente').textContent = vaga.paciente + ' (hoje: ' + nascimentoParaTexto(a.data) + ' às ' + horaDaVaga(a, n) + ')';
    montarSeletor('rg', a.servicoId, { agendaId: a.id, vaga: n }, a.profissionalId || '');
    const painel = document.getElementById('painelReagendar');
    painel.classList.remove('d-none');
    painel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function confirmarReagendar() {
    const r = lerSeletor('rg');
    if (!r) { avisoAg('avisoAgenda', 'Escolha o médico, o dia e o horário.', 'warning'); return; }
    const btn = document.getElementById('btnReagendar');
    btn.disabled = true;
    try {
        const s = await pedidoDe(reagendando.prot);
        await gravarMarcacao(s, r.agenda, r.n, 'Reagendado');
        document.getElementById('painelReagendar').classList.add('d-none');
        await carregar();
        await carregarAgendas();
        await abrirAgenda(agendaAberta.id);
        avisoAg('avisoAgenda', 'Reagendado para <strong>' + esc(agendamentoParaTexto(agendamentoDaVaga(r.agenda, r.n))) + '</strong>. Avise o paciente pelo WhatsApp.', 'success');
    } catch (e) {
        avisoAg('avisoAgenda', esc(erroMarcacao(e)), 'danger');
    } finally {
        btn.disabled = false;
    }
}

function erroMarcacao(e) {
    return e && e.code === 'permission-denied'
        ? 'Esse horário acabou de ser ocupado por outra pessoa (ou você não tem permissão). Atualize e escolha outro.'
        : mensagemErroAuth(e);
}

/**
 * Marca o pedido na vaga n da agenda, numa gravação só: pedido "Agendada" com dia/hora/médico,
 * vaga ocupada, consulta pública e histórico. Se ele já tinha outra vaga, ela é liberada (reagendar).
 */
async function gravarMarcacao(s, a, n, motivo) {
    const ag = agendamentoDaVaga(a, n);
    const msg = ('Atendimento marcado: ' + agendamentoParaTexto(ag) + '.').slice(0, 500);
    const agora = FieldValue.serverTimestamp();
    const ref = db.collection('solicitacoes').doc(s.protocolo);
    const batch = db.batch();
    const antiga = s.agendamento && s.agendamento.agendaId != null ? s.agendamento : null;
    if (antiga && s.status === 'AGENDADA' && !(antiga.agendaId === a.id && antiga.vaga === n)) {
        batch.delete(db.collection('agendas').doc(antiga.agendaId).collection('vagas').doc(String(antiga.vaga)));
    }
    batch.update(ref, { status: 'AGENDADA', mensagemPublica: msg, agendamento: ag, atualizadoEm: agora, atualizadoPor: eu.uid });
    batch.set(db.collection('agendas').doc(a.id).collection('vagas').doc(String(n)), {
        protocolo: s.protocolo, paciente: s.paciente, hora: ag.hora, marcadoPor: eu.uid, marcadoEm: agora
    });
    batch.set(ref.collection('historico').doc(), {
        usuario: eu.uid, usuarioNome: eu.nome, statusAnterior: s.status, statusNovo: 'AGENDADA',
        observacao: (motivo + ': ' + agendamentoParaTexto(ag) + (antiga && s.status === 'AGENDADA' ? ' (antes: ' + agendamentoParaTexto(antiga) + ')' : '')).slice(0, 500),
        criadoEm: agora
    });
    const refCons = db.collection('consultas').doc(s.cpf).collection('pedidos').doc(s.protocolo);
    if ((await refCons.get()).exists) batch.update(refCons, { status: 'AGENDADA', mensagem: msg, agendamento: ag, atualizadoEm: agora });
    await batch.commit();
}

// ---------------------------------------------------------------- cadastro do profissional: novo, editar, férias, desativar
/** Está de férias/afastado nesse dia (AAAA-MM-DD)? */
function deFerias(p, data) {
    return !!(p && p.feriasInicio && p.feriasFim && data >= p.feriasInicio && data <= p.feriasFim);
}

/** Selo do cartão: "De férias até 20/12" (agora) ou "Férias marcadas: 01/12 a 20/12" (futuras). */
function seloFerias(p) {
    if (!p.feriasInicio || !p.feriasFim || p.feriasFim < hojeIso()) return '';
    const periodo = nascimentoParaTexto(p.feriasInicio) + ' a ' + nascimentoParaTexto(p.feriasFim);
    const motivo = esc(p.feriasMotivo || 'Férias');
    return deFerias(p, hojeIso())
        ? `<span class="badge bg-warning text-dark"><i class="bi bi-airplane me-1"></i>${motivo} até ${esc(nascimentoParaTexto(p.feriasFim))}</span>`
        : `<span class="badge bg-info-subtle text-info-emphasis border"><i class="bi bi-airplane me-1"></i>${motivo} marcadas: ${esc(periodo)}</span>`;
}

function novoProfissional() {
    document.getElementById('formProfissional').reset();
    document.getElementById('profId').value = '';
    document.getElementById('tituloFormProf').textContent = 'Novo profissional';
    document.querySelectorAll('#profDias input').forEach(c => { c.checked = c.value === '2' || c.value === '4'; });
    bootstrap.Collapse.getOrCreateInstance(document.getElementById('formProfissional')).show();
    document.getElementById('profNome').focus();
}

/** Abre o mesmo formulário já preenchido para atualizar o cadastro (local, dias, horários, férias...). */
function editarProfissional(id) {
    const p = profissionais.find(x => x.id === id);
    const v = (campo, valor) => { document.getElementById(campo).value = valor == null ? '' : valor; };
    v('profId', p.id);
    v('profNome', p.nome); v('profRegistro', p.registro); v('profEspecialidade', p.especialidade);
    v('profServico', p.servicoId); v('profLocal', p.local);
    v('profInicio', p.horaInicio); v('profFim', p.horaFim); v('profDuracao', p.duracaoMin);
    v('profFeriasIni', p.feriasInicio); v('profFeriasFim', p.feriasFim); v('profFeriasMotivo', p.feriasMotivo);
    document.querySelectorAll('#profDias input').forEach(c => { c.checked = (p.diasSemana || []).includes(Number(c.value)); });
    document.getElementById('tituloFormProf').textContent = 'Editar: ' + p.nome;
    const form = document.getElementById('formProfissional');
    bootstrap.Collapse.getOrCreateInstance(form).show();
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function salvarProfissional() {
    const dias = [...document.querySelectorAll('#profDias input:checked')].map(c => Number(c.value));
    if (!dias.length) { avisoAg('avisoAgendas', 'Marque pelo menos um dia da semana.', 'warning'); return; }
    const id = document.getElementById('profId').value;
    const antigo = id ? profissionais.find(x => x.id === id) : null;
    const p = {
        nome: document.getElementById('profNome').value.trim(),
        registro: document.getElementById('profRegistro').value.trim(),
        especialidade: document.getElementById('profEspecialidade').value.trim(),
        servicoId: document.getElementById('profServico').value,
        local: document.getElementById('profLocal').value.trim(),
        diasSemana: dias,
        horaInicio: document.getElementById('profInicio').value,
        horaFim: document.getElementById('profFim').value,
        duracaoMin: Number(document.getElementById('profDuracao').value),
        feriasInicio: document.getElementById('profFeriasIni').value,
        feriasFim: document.getElementById('profFeriasFim').value,
        feriasMotivo: document.getElementById('profFeriasMotivo').value.trim(),
        ativo: antigo ? antigo.ativo !== false : true,
        inativoDesde: antigo ? (antigo.inativoDesde || '') : '',
        atualizadoPor: eu.uid, atualizadoEm: FieldValue.serverTimestamp()
    };
    if (minutosDe(p.horaFim) - minutosDe(p.horaInicio) < p.duracaoMin) { avisoAg('avisoAgendas', 'O horário de fim precisa ser depois do início.', 'warning'); return; }
    if (!!p.feriasInicio !== !!p.feriasFim || (p.feriasInicio && p.feriasFim < p.feriasInicio)) {
        avisoAg('avisoAgendas', 'Férias: preencha "de" e "até" (a data final depois da inicial), ou deixe as duas vazias.', 'warning');
        return;
    }
    if (!p.feriasInicio) p.feriasMotivo = '';
    else if (!p.feriasMotivo) p.feriasMotivo = 'Férias';
    try {
        if (id) await db.collection('profissionais').doc(id).set(p);
        else await db.collection('profissionais').add(p);
        bootstrap.Collapse.getOrCreateInstance(document.getElementById('formProfissional')).hide();
        await carregarAgendas();
        const msg = id ? 'Cadastro de ' + esc(p.nome) + ' atualizado.' : 'Profissional cadastrado. Agora clique em <strong>Gerar agendas</strong>.';
        avisoAg('avisoAgendas', msg, 'success');
        // férias: dias de agenda que já existiam nesse período
        if (id && p.feriasInicio) {
            const afetadas = agendasDe(id).filter(a => deFerias(p, a.data));
            if (afetadas.length) await oferecerApagar(afetadas, `${p.nome} estará de ${p.feriasMotivo.toLowerCase()} de ${nascimentoParaTexto(p.feriasInicio)} a ${nascimentoParaTexto(p.feriasFim)}`, msg);
        }
    } catch (e) {
        avisoAg('avisoAgendas', esc(mensagemErroAuth(e)), 'danger');
    }
}

/** Pergunta se apaga os dias de agenda afetados (os marcados voltam para a fila). */
async function oferecerApagar(lista, motivo, msgAntes) {
    const marcados = lista.reduce((t, a) => t + (a.ocupadas || 0), 0);
    if (!confirm(motivo + '.\n\nJá existem ' + lista.length + ' dia(s) de agenda nesse período' +
        (marcados ? ', com ' + marcados + ' paciente(s) marcado(s)' : '') + '.\nApagar esses dias?' +
        (marcados ? ' Os pacientes voltam para a fila sem perder o tempo de espera.' : ''))) return;
    let devolvidos = 0;
    for (const a of lista) devolvidos += await apagarAgendaSemPerguntar(a.id, a);
    await Promise.all([carregar(), carregarAgendas()]);
    avisoAg('avisoAgendas', (msgAntes ? msgAntes + ' ' : '') + lista.length + ' dia(s) de agenda apagado(s)' +
        (devolvidos ? '; ' + devolvidos + ' paciente(s) voltaram para a fila — use "Preencher com a fila" em outro médico ou dia.' : '.'), 'success');
}

/** "Não trabalha mais": fica desativado (adormecido). Nada é apagado e pode ser reativado. */
async function desativarProfissional(id) {
    const p = profissionais.find(x => x.id === id);
    if (!confirm('Desativar ' + p.nome + '?\n\nO cadastro e o histórico ficam guardados (adormecido). ' +
        'Ele(a) some das marcações e não gera mais agendas. Você pode reativar quando quiser.')) return;
    try {
        await db.collection('profissionais').doc(id).update({
            ativo: false, inativoDesde: hojeIso(), atualizadoPor: eu.uid, atualizadoEm: FieldValue.serverTimestamp()
        });
        if (profSelecionado === id) profSelecionado = null;
        await carregarAgendas();
        avisoAg('avisoAgendas', esc(p.nome) + ' foi desativado(a). Os dados continuam guardados em "Desativados".', 'success');
        const futuras = agendasDe(id);
        if (futuras.length) await oferecerApagar(futuras, p.nome + ' foi desativado(a)', esc(p.nome) + ' foi desativado(a).');
    } catch (e) {
        avisoAg('avisoAgendas', esc(mensagemErroAuth(e)), 'danger');
    }
}

async function reativarProfissional(id) {
    const p = profissionais.find(x => x.id === id);
    try {
        await db.collection('profissionais').doc(id).update({
            ativo: true, inativoDesde: '', atualizadoPor: eu.uid, atualizadoEm: FieldValue.serverTimestamp()
        });
        await carregarAgendas();
        avisoAg('avisoAgendas', esc(p.nome) + ' foi reativado(a). Clique em <strong>Gerar agendas</strong> para abrir vagas.', 'success');
    } catch (e) {
        avisoAg('avisoAgendas', esc(mensagemErroAuth(e)), 'danger');
    }
}

/** Cria as agendas das próximas semanas a partir dos dias/horários do profissional (não duplica). */
async function gerarAgendas(profId, semanas) {
    const p = profissionais.find(x => x.id === profId);
    const sv = SERVICOS.find(s => s.id === p.servicoId) || { nome: p.servicoId };
    const vagas = Math.floor((minutosDe(p.horaFim) - minutosDe(p.horaInicio)) / p.duracaoMin);
    let criadas = 0;
    let pulados = 0;
    try {
        for (let i = 1; i <= (semanas || 4) * 7; i++) {
            const d = new Date();
            d.setHours(12, 0, 0, 0);
            d.setDate(d.getDate() + i);
            if (!p.diasSemana.includes(d.getDay())) continue;
            const data = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            if (deFerias(p, data)) { pulados++; continue; }   // férias/afastamento: não abre vagas
            const ref = db.collection('agendas').doc('prof-' + p.id + '-' + data);
            if ((await ref.get()).exists) continue;
            await ref.set({
                servicoId: p.servicoId, servico: sv.nome, local: p.local, data, horaInicio: p.horaInicio,
                intervaloMin: p.duracaoMin, vagas, profissionalId: p.id, profissionalNome: p.nome, especialidade: p.especialidade,
                orientacoes: '', criadoPor: eu.uid, criadoPorNome: eu.nome, criadoEm: FieldValue.serverTimestamp()
            });
            criadas++;
        }
        avisoAg('avisoAgendas', `${criadas} agenda(s) criada(s) para ${esc(p.nome)} nas próximas ${semanas || 4} semanas (${vagas} vagas por dia).` +
            (pulados ? ` ${pulados} dia(s) pulado(s) por ${esc((p.feriasMotivo || 'férias').toLowerCase())}.` : ''), 'success');
        await carregarAgendas();
    } catch (e) {
        avisoAg('avisoAgendas', esc(mensagemErroAuth(e)), 'danger');
    }
}

async function criarAgendaAvulsa() {
    const sv = SERVICOS.find(s => s.id === document.getElementById('agServico').value);
    const data = document.getElementById('agDataAvulsa').value;
    if (data < hojeIso()) { avisoAg('avisoAgendas', 'Escolha uma data a partir de hoje.', 'warning'); return; }
    try {
        await db.collection('agendas').add({
            servicoId: sv.id, servico: sv.nome, local: document.getElementById('agLocalAvulsa').value.trim(), data,
            horaInicio: document.getElementById('agInicioAvulsa').value,
            intervaloMin: Number(document.getElementById('agIntervalo').value),
            vagas: Number(document.getElementById('agVagas').value),
            profissionalId: '', profissionalNome: '', especialidade: '',
            orientacoes: document.getElementById('agOrient').value.trim(),
            criadoPor: eu.uid, criadoPorNome: eu.nome, criadoEm: FieldValue.serverTimestamp()
        });
        document.getElementById('formAgenda').reset();
        bootstrap.Collapse.getOrCreateInstance(document.getElementById('formAgenda')).hide();
        avisoAg('avisoAgendas', 'Agenda criada. Abra-a e clique em <strong>Preencher com a fila</strong>.', 'success');
        await carregarAgendas();
    } catch (e) {
        avisoAg('avisoAgendas', esc(mensagemErroAuth(e)), 'danger');
    }
}

function horaDaVaga(a, n) {
    return somarMinutos(a.horaInicio, n * (a.intervaloMin || 0));
}

async function abrirAgenda(id) {
    const doc = await db.collection('agendas').doc(id).get();
    const vagasSnap = await db.collection('agendas').doc(id).collection('vagas').get();
    agendaAberta = Object.assign({ id }, doc.data(), { vagasDocs: {} });
    vagasSnap.docs.forEach(v => { agendaAberta.vagasDocs[Number(v.id)] = v.data(); });
    propostas = {};
    document.getElementById('btnConfirmarMarcacoes').classList.add('d-none');
    document.getElementById('painelReagendar').classList.add('d-none');
    avisoAg('avisoAgenda', '');
    const a = agendaAberta;
    const d = new Date(a.data + 'T00:00:00');
    document.getElementById('tituloAgenda').textContent = (a.profissionalNome ? a.profissionalNome + ' • ' : '') + a.servico + ' • ' + DIAS_SEMANA[d.getDay()] + ' ' + nascimentoParaTexto(a.data);
    document.getElementById('agendaInfo').innerHTML = `<strong>Local:</strong> ${esc(a.local)}
        ${a.profissionalNome ? ` • <strong>Profissional:</strong> ${esc(a.profissionalNome)} (${esc(a.especialidade)})` : ''}
        • <strong>Vagas:</strong> ${Object.keys(a.vagasDocs).length}/${a.vagas} ocupadas • de ${a.intervaloMin} em ${a.intervaloMin} min a partir das ${esc(a.horaInicio)}
        ${a.orientacoes ? `<br><strong>Orientações:</strong> ${esc(a.orientacoes)}` : ''}`;
    desenharVagas();
    modalAgendaUi.show();
}

/** Pedidos em aberto do serviço da agenda, na ordem da fila (prioridade e, dentro dela, quem espera há mais tempo). */
function candidatosDaFila(a) {
    const peso = (s) => PRIORIDADES[prioridadeDe(s)].peso;
    return solicitacoes
        .filter(s => s.servicoId === a.servicoId && ABERTOS.includes(s.status))
        .sort((x, y) => (peso(x) - peso(y)) || ((emMs(x.criadoEm) || 0) - (emMs(y.criadoEm) || 0)));
}

function desenharVagas() {
    const a = agendaAberta;
    const candidatos = candidatosDaFila(a);
    const escolhidos = new Set(Object.values(propostas).filter(Boolean));
    const linhas = [];
    for (let n = 0; n < a.vagas; n++) {
        const ocupada = a.vagasDocs[n];
        const hora = horaDaVaga(a, n);
        if (ocupada) {
            const s = solicitacoes.find(x => x.protocolo === ocupada.protocolo);
            linhas.push(`<tr class="table-light"><td class="fw-bold">${esc(hora)}</td>
                <td><a href="#" onclick="event.preventDefault(); abrirFicha('${esc(s ? s.cpf : '')}')">${esc(ocupada.paciente)}</a> <span class="text-muted">#${esc(ocupada.protocolo)}</span></td>
                <td>${s ? `<span class="badge ${PRIORIDADES[prioridadeDe(s)].cor}">${PRIORIDADES[prioridadeDe(s)].rotulo}</span> ${esc(textoDias(diasEspera(s)))}` : ''}</td>
                <td class="text-end text-nowrap">
                    ${s && numeroWhatsApp(s.telefone) ? `<button class="btn btn-sm btn-outline-success" title="Avisar pelo WhatsApp" onclick="whatsAppRapido('${esc(s.protocolo)}')"><i class="bi bi-whatsapp"></i></button>` : ''}
                    ${podeRegular() ? `<button class="btn btn-sm btn-outline-primary" onclick="abrirReagendar(${n})" title="Mudar para outro médico, dia ou horário"><i class="bi bi-arrow-left-right me-1"></i>Reagendar</button>
                    <button class="btn btn-sm btn-outline-danger" onclick="liberarVaga(${n})" title="Desmarcar: a pessoa volta para a fila sem perder o tempo de espera"><i class="bi bi-x-circle me-1"></i>Liberar</button>` : ''}
                </td></tr>`);
        } else if (propostas[n] !== undefined) {
            const atual = propostas[n];
            const opcoes = ['<option value="">(deixar livre)</option>'].concat(candidatos
                .filter(c => c.protocolo === atual || !escolhidos.has(c.protocolo))
                .map(c => `<option value="${esc(c.protocolo)}" ${c.protocolo === atual ? 'selected' : ''}>${esc(c.paciente)} • ${PRIORIDADES[prioridadeDe(c)].rotulo} • ${textoDias(diasEspera(c))} • #${esc(c.protocolo)}</option>`));
            linhas.push(`<tr class="table-success"><td class="fw-bold">${esc(hora)}</td>
                <td colspan="2"><select class="form-select form-select-sm" onchange="propostas[${n}] = this.value; desenharVagas();">${opcoes.join('')}</select></td>
                <td class="text-end small text-success">proposta</td></tr>`);
        } else {
            linhas.push(`<tr><td class="fw-bold">${esc(hora)}</td><td class="text-muted" colspan="2">livre</td><td></td></tr>`);
        }
    }
    document.getElementById('corpoVagas').innerHTML = linhas.join('');
}

/** Sugere os próximos da fila para as vagas livres (o regulador pode trocar ou deixar livre antes de confirmar). */
function preencherComFila() {
    const a = agendaAberta;
    const candidatos = candidatosDaFila(a);
    if (!candidatos.length) {
        avisoAg('avisoAgenda', 'Não há pedidos em aberto de ' + esc(a.servico) + ' na fila (carregados no painel).', 'warning');
        return;
    }
    let i = 0;
    propostas = {};
    for (let n = 0; n < a.vagas; n++) {
        if (a.vagasDocs[n]) continue;
        propostas[n] = i < candidatos.length ? candidatos[i++].protocolo : '';
    }
    desenharVagas();
    const qtd = Object.values(propostas).filter(Boolean).length;
    document.getElementById('btnConfirmarMarcacoes').classList.toggle('d-none', !qtd);
    avisoAg('avisoAgenda', `Sugestão: <strong>${qtd}</strong> pessoa(s) da fila (Urgente → Prioritário → Normal, quem espera há mais tempo primeiro).
        Revise e clique em <strong>Confirmar marcações</strong>.`, 'info');
}

/** Grava cada marcação (pedido "Agendada" + vaga ocupada + consulta pública + histórico). Uma por vez. */
async function confirmarMarcacoes() {
    const a = agendaAberta;
    const btn = document.getElementById('btnConfirmarMarcacoes');
    btn.disabled = true;
    let ok = 0;
    const falhas = [];
    for (const [nStr, prot] of Object.entries(propostas)) {
        if (!prot) continue;
        try {
            await gravarMarcacao(solicitacoes.find(x => x.protocolo === prot), a, Number(nStr), 'Marcado pela agenda');
            ok++;
        } catch (e) {
            falhas.push('#' + prot + ' (' + erroMarcacao(e) + ')');
        }
    }
    btn.disabled = false;
    await carregar();
    await abrirAgenda(a.id);
    carregarAgendas();
    avisoAg('avisoAgenda', `<strong>${ok}</strong> pessoa(s) marcada(s).` +
        (falhas.length ? ' Não marcados: ' + esc(falhas.join('; ')) : ' Use o botão do WhatsApp em cada linha para avisar.'), falhas.length ? 'warning' : 'success');
}

/** Desmarca: libera a vaga e o pedido volta para a fila (o tempo de espera continua contando desde o pedido). */
async function liberarVaga(n) {
    const a = agendaAberta;
    const vaga = a.vagasDocs[n];
    if (!confirm('Desmarcar ' + vaga.paciente + ' (' + horaDaVaga(a, n) + ')? O pedido volta para a fila.')) return;
    const msg = 'Seu atendimento foi desmarcado e o pedido voltou para a fila (sem perder o tempo de espera). Aguarde nova marcação.';
    try {
        const batch = db.batch();
        await desmarcarNoLote(batch, a.id, n, vaga.protocolo, msg,
            'Vaga liberada (' + nascimentoParaTexto(a.data) + ' ' + horaDaVaga(a, n) + '); voltou para a fila');
        await batch.commit();
        await carregar();
        await abrirAgenda(a.id);
        carregarAgendas();
        avisoAg('avisoAgenda', 'Vaga liberada.', 'success');
    } catch (e) {
        avisoAg('avisoAgenda', esc(mensagemErroAuth(e)), 'danger');
    }
}

/** Lista do dia (para a recepção), impressa só ela. */
function imprimirListaDia() {
    const a = agendaAberta;
    const linhas = [];
    for (let n = 0; n < a.vagas; n++) {
        const v = a.vagasDocs[n];
        linhas.push(`<tr><td style="border:1px solid #000;padding:4px">${esc(horaDaVaga(a, n))}</td>
            <td style="border:1px solid #000;padding:4px">${v ? esc(v.paciente) : ''}</td>
            <td style="border:1px solid #000;padding:4px">${v ? '#' + esc(v.protocolo) : ''}</td>
            <td style="border:1px solid #000;padding:4px;width:90px"></td></tr>`);
    }
    document.getElementById('comprovante').innerHTML = `
        <div style="text-align:center;border-bottom:2px solid #000;margin-bottom:8px"><strong style="font-size:18px">Agiliza Saúde • Lista do dia</strong><br>
        ${esc(a.servico)} • ${esc(nascimentoParaTexto(a.data))} • ${esc(a.local)}${a.profissionalNome ? ' • ' + esc(a.profissionalNome) : ''}</div>
        <table style="width:100%;border-collapse:collapse;font-size:13px">
            <tr><th style="border:1px solid #000">Hora</th><th style="border:1px solid #000">Paciente</th><th style="border:1px solid #000">Protocolo</th><th style="border:1px solid #000">Presença</th></tr>
            ${linhas.join('')}
        </table>`;
    window.print();
}

// ---------------------------------------------------------------- servidores (ADMIN)
async function carregarServidores() {
    try {
        const snap = await db.collection('servidores').get();
        servidores = snap.docs.map(d => Object.assign({ uid: d.id }, d.data()))
            .sort((a, b) => (a.aprovado - b.aprovado) || a.nome.localeCompare(b.nome));
        const pend = servidores.filter(s => !s.aprovado).length;
        const badge = document.getElementById('qtdPendentes');
        badge.textContent = pend;
        badge.classList.toggle('d-none', !pend);
        desenharServidores();
    } catch (e) {
        aviso('avisoServidores', mensagemErroAuth(e), 'danger');
    }
}

function desenharServidores() {
    const corpo = document.getElementById('corpoServidores');
    if (!servidores.length) {
        corpo.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">Nenhum servidor.</td></tr>';
        return;
    }
    corpo.innerHTML = servidores.map(s => `
        <tr class="${s.aprovado ? '' : 'table-warning'}">
            <td>${esc(s.nome)}</td>
            <td class="small">${esc(s.email)}</td>
            <td class="small">${esc(s.matricula)}</td>
            <td class="small">${esc(dataParaTexto(s.criadoEm))}</td>
            <td>
                <select class="form-select form-select-sm" id="perfil-${s.uid}" ${s.uid === eu.uid ? 'disabled' : ''}>
                    ${Object.entries(PERFIS).map(([k, v]) => `<option value="${k}" ${s.perfil === k ? 'selected' : ''}>${v}</option>`).join('')}
                </select>
            </td>
            <td>${s.aprovado ? '<span class="badge bg-success">Aprovado</span>' : '<span class="badge bg-warning text-dark">Aguardando</span>'}</td>
            <td class="text-end text-nowrap">
                ${s.uid === eu.uid ? '<span class="small text-muted">você</span>' : `
                <button class="btn btn-sm btn-success" onclick="salvarServidor('${s.uid}', true)">${s.aprovado ? 'Salvar perfil' : 'Aprovar'}</button>
                ${s.aprovado
                    ? `<button class="btn btn-sm btn-outline-warning" onclick="salvarServidor('${s.uid}', false)">Bloquear</button>`
                    : `<button class="btn btn-sm btn-outline-danger" onclick="recusarServidor('${s.uid}')">Recusar</button>`}`}
            </td>
        </tr>`).join('');
}

async function salvarServidor(uid, aprovado) {
    try {
        await db.collection('servidores').doc(uid).update({
            perfil: document.getElementById('perfil-' + uid).value,
            aprovado, aprovadoPor: eu.uid, atualizadoEm: FieldValue.serverTimestamp()
        });
        aviso('avisoServidores', aprovado ? 'Servidor liberado.' : 'Acesso bloqueado.', 'success');
        carregarServidores();
    } catch (e) {
        aviso('avisoServidores', mensagemErroAuth(e), 'danger');
    }
}

async function recusarServidor(uid) {
    if (!confirm('Recusar este pedido de acesso?')) return;
    try {
        await db.collection('servidores').doc(uid).delete();
        carregarServidores();
    } catch (e) {
        aviso('avisoServidores', mensagemErroAuth(e), 'danger');
    }
}

// ---------------------------------------------------------------- início
function sair() {
    auth.signOut().finally(() => { window.location.href = 'index.html'; });
}

document.getElementById('filtroStatus').insertAdjacentHTML('beforeend',
    Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${esc(v.rotulo)}</option>`).join(''));
document.getElementById('filtroPrioridade').insertAdjacentHTML('beforeend',
    Object.entries(PRIORIDADES).map(([k, v]) => `<option value="${k}">${esc(v.rotulo)}</option>`).join(''));
document.getElementById('novaPrioridade').innerHTML =
    Object.entries(PRIORIDADES).map(([k, v]) => `<option value="${k}">${esc(v.rotulo)}</option>`).join('');
document.getElementById('listaMotivos').innerHTML = MOTIVOS_PRIORIDADE.map(m => `<option value="${esc(m)}">`).join('');
// agendas e profissionais: listas
const opServicos = SERVICOS.map(s => `<option value="${esc(s.id)}">${esc(s.nome)}</option>`).join('');
document.getElementById('profServico').innerHTML = opServicos;
document.getElementById('agServico').innerHTML = opServicos;
document.getElementById('listaEspecialidades').innerHTML = ESPECIALIDADES.map(e => `<option value="${esc(e)}">`).join('');
document.getElementById('profDias').innerHTML = DIAS_SEMANA.map((d, i) =>
    `<label class="form-check form-check-inline mb-0"><input class="form-check-input" type="checkbox" value="${i}" ${i === 2 || i === 4 ? 'checked' : ''}> ${d}</label>`).join('');
document.getElementById('listaLocaisAgenda').innerHTML = ['Policlínica Municipal'].concat(UBS.map(u => u.nome), HOSPITAIS_REFERENCIA)
    .map(l => `<option value="${esc(l)}">`).join('');

// atendimento presencial: listas e máscaras
document.getElementById('balServico').innerHTML = SERVICOS.map(s => `<option value="${esc(s.id)}">${esc(s.nome)}</option>`).join('');
document.getElementById('balUbs').innerHTML = UBS.map(u => `<option value="${esc(u.id)}">${esc(u.nome)}</option>`).join('');
document.getElementById('balPrioridade').innerHTML =
    Object.entries(PRIORIDADES).map(([k, v]) => `<option value="${k}" ${k === 'NORMAL' ? 'selected' : ''}>${esc(v.rotulo)}</option>`).join('');
document.getElementById('listaProcedimentos').innerHTML = PROCEDIMENTOS_CIRURGIA.map(p => `<option value="${esc(p)}">`).join('');
document.getElementById('listaHospitais').innerHTML = HOSPITAIS_REFERENCIA.map(h => `<option value="${esc(h)}">`).join('');
document.getElementById('balPreOp').innerHTML = Object.entries(ITENS_PREOP).map(([k, v]) =>
    `<label class="form-check form-check-inline mb-0"><input class="form-check-input" type="checkbox" id="balPre-${k}"> ${esc(v)}</label>`).join('');
ligarMascaraCpf(document.getElementById('balCpf'));
document.getElementById('balNasc').addEventListener('change', balcaoSugerirPrioridade);
document.getElementById('abaBalcaoBtn').addEventListener('shown.bs.tab', () => document.getElementById('balCpf').focus());

document.getElementById('relUbs').insertAdjacentHTML('beforeend',
    UBS.map(u => `<option value="${esc(u.id)}">${esc(u.nome)}</option>`).join(''));
document.getElementById('filtroUbs').insertAdjacentHTML('beforeend',
    UBS.map(u => `<option value="${esc(u.id)}">${esc(u.nome)}</option>`).join(''));
document.getElementById('listaLocais').innerHTML = UBS.map(u => `<option value="${esc(u.nome)}">`).join('');

let iniciado = false;
auth.onAuthStateChanged(async user => {
    if (!user) { window.location.href = 'index.html'; return; }
    if (iniciado) return;
    iniciado = true;
    try {
        const s = await db.collection('servidores').doc(user.uid).get();
        const motivo = motivoServidorBloqueado(s.exists ? s.data() : null);
        if (motivo) return semAcesso(s.exists ? 'Acesso ainda não liberado' : 'Acesso não autorizado', motivo);
        eu = { uid: user.uid, nome: s.get('nome'), perfil: s.get('perfil') };
    } catch (e) {
        return semAcesso('Erro', mensagemErroAuth(e));
    }
    document.getElementById('nomeUsuario').textContent = eu.nome;
    document.getElementById('perfilUsuario').textContent = PERFIS[eu.perfil] || eu.perfil;
    document.getElementById('conteudo').classList.remove('d-none');
    if (eu.perfil === 'ADMIN') {
        document.getElementById('itemAbaServidores').classList.remove('d-none');
        carregarServidores();
    }
    carregar();
});
