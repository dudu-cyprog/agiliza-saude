// =====================================================================
// Agiliza Saude - JavaScript do site do cidadao (index.html)
// Cadastro e login (CPF ou e-mail), Minha Area, novo pedido, consulta por CPF,
// acesso do servidor. Usa: js/firebase-init.js (auth, db) e js/comum.js.
// =====================================================================

const { FieldValue } = firebase.firestore;
let paciente = null;          // perfil do munícipe logado (pacientes/{uid})
let cadastrandoAgora = false; // evita corrida entre o cadastro e o onAuthStateChanged
const modalMunicipe = new bootstrap.Modal(document.getElementById('modalMunicipe'));
const modalServidor = new bootstrap.Modal(document.getElementById('modalServidor'));

function mostrarMsg(id, texto, tipo) {
    const el = document.getElementById(id);
    if (!texto) { el.classList.add('d-none'); return; }
    el.className = 'alert py-2 small alert-' + (tipo || 'danger');
    el.innerHTML = texto;
}

// ---------- 1. Acessibilidade ----------
let tamanhoFonteAtual = 16;
function alterarFonte(variacao) {
    tamanhoFonteAtual = Math.min(22, Math.max(12, tamanhoFonteAtual + variacao));
    document.documentElement.style.fontSize = tamanhoFonteAtual + 'px';
}
function alternarContraste() {
    document.body.classList.toggle('alto-contraste');
}

// ---------- 2. Catálogo (UBS e serviços) ----------
function montarCatalogo() {
    document.getElementById('ubsSelect').innerHTML = '<option value="" selected disabled>Selecione seu bairro...</option>' +
        UBS.map(u => `<option value="${esc(u.id)}">${esc(u.nome)}</option>`).join('');
    document.getElementById('tipoSelect').innerHTML = '<option value="" selected disabled>Selecione o serviço...</option>' +
        SERVICOS.filter(s => !s.somenteEquipe).map(s => `<option value="${esc(s.id)}">${esc(s.nome)}</option>`).join('');
    document.getElementById('listaUbs').innerHTML = UBS.map(u => `
        <div class="col-12 col-md-4">
            <div class="card p-3 border-0 shadow-sm h-100">
                <h6 class="fw-bold text-primary mb-1">${esc(u.nome)}</h6>
                <small class="text-muted mb-2 d-block">${esc(u.endereco || 'Endereço: informe-se na Secretaria Municipal de Saúde')}</small>
                <span class="badge bg-light text-dark border">Horário: ${esc(u.horario)}</span>
            </div>
        </div>`).join('');
}

function selecionarServico(id) {
    document.getElementById('tipoSelect').value = id;
    document.getElementById('solicitar').scrollIntoView({ behavior: 'smooth' });
}

// ---------- 3. Consulta pública (só CPF) ----------
async function verificarConsulta() {
    const box = document.getElementById('resultadoAtendimento');
    const btn = document.getElementById('btnConsultar');
    const cpf = soDigitos(document.getElementById('consCpf').value);
    box.classList.remove('d-none');
    if (!cpfValido(cpf)) {
        box.innerHTML = '<div class="alert alert-warning mb-0 small">CPF inválido. Confira os 11 números.</div>';
        return;
    }
    btn.disabled = true;
    try {
        const snap = await db.collection('consultas').doc(cpf).collection('pedidos').get();
        if (snap.empty) throw new Error('Nenhuma solicitação encontrada para este CPF.');
        const lista = snap.docs.map(d => d.data())
            .sort((a, b) => (b.atualizadoEm ? b.atualizadoEm.toMillis() : 0) - (a.atualizadoEm ? a.atualizadoEm.toMillis() : 0));
        box.innerHTML = `<div class="small text-muted mb-2">${lista.length} solicitação(ões) de <strong>${esc(lista[0].primeiroNome)}</strong>:</div>` +
            lista.map(s => `
            <div class="p-3 bg-light border rounded-3 mb-2">
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <strong class="text-primary">Protocolo #${esc(s.protocolo)}</strong>
                    ${badgeStatus(s.status)}
                </div>
                <div class="small"><strong>Serviço:</strong> ${esc(s.servico)}</div>
                <div class="small"><strong>Unidade de Referência:</strong> ${esc(s.ubs)}</div>
                <div class="small text-muted"><strong>Atualizado em:</strong> ${esc(dataParaTexto(s.atualizadoEm))}</div>
                <div class="small text-success mt-2 fw-semibold">
                    <i class="bi bi-clock-history me-1" aria-hidden="true"></i>${esc(s.mensagem)}
                </div>
                ${s.status === 'AGENDADA' ? blocoAgendamento(s.agendamento) : ''}
            </div>`).join('');
    } catch (e) {
        box.innerHTML = `<div class="alert alert-warning mb-0 small">${esc(e.code ? mensagemErroAuth(e) : e.message)}</div>`;
    } finally {
        btn.disabled = false;
    }
}

// ---------- 4. Cadastro e login do munícipe ----------
function abrirMunicipe(aba) {
    mostrarMsg('msgMunEntrar', ''); mostrarMsg('msgMunCadastrar', '');
    bootstrap.Tab.getOrCreateInstance(document.getElementById(aba === 'cadastrar' ? 'abaMunCadastrar' : 'abaMunEntrar')).show();
    modalMunicipe.show();
}

async function cadastrarMunicipe() {
    mostrarMsg('msgMunCadastrar', '');
    const nome = document.getElementById('cadNome').value.trim().replace(/\s+/g, ' ');
    const cpf = soDigitos(document.getElementById('cadCpf').value);
    const sus = soDigitos(document.getElementById('cadSus').value);
    const nascimento = document.getElementById('cadNasc').value;
    const telefone = soDigitos(document.getElementById('cadTel').value);
    const email = document.getElementById('cadEmail').value.trim();
    const senha = document.getElementById('cadSenha').value;

    let erro = null;
    if (nome.length < 3 || !nome.includes(' ')) erro = 'Informe o nome completo.';
    else if (!cpfValido(cpf)) erro = 'CPF inválido. Confira os 11 números.';
    else if (sus.length !== 15) erro = 'O Cartão SUS deve ter 15 dígitos.';
    else if (!dataNascimentoValida(nascimento)) erro = 'Data de nascimento inválida.';
    else if (telefone.length < 10 || telefone.length > 11) erro = 'Informe um telefone com DDD.';
    else if (senha.length < 8) erro = 'A senha precisa ter pelo menos 8 caracteres.';
    else if (senha !== document.getElementById('cadSenha2').value) erro = 'As senhas não conferem.';
    if (erro) { mostrarMsg('msgMunCadastrar', esc(erro)); return; }

    const btn = document.getElementById('btnCadastrar');
    btn.disabled = true;
    cadastrandoAgora = true;
    let contaNova = null;
    try {
        // CPF já usado por outra pessoa? (o registro de login existe)
        if ((await db.collection('logins').doc(cpf).get()).exists) {
            mostrarMsg('msgMunCadastrar', 'Este CPF já tem cadastro. Use a aba <strong>Entrar</strong> com o CPF e a senha.', 'warning');
            return;
        }
        let user = auth.currentUser;
        if (!user || user.email !== email) {
            user = contaNova = (await auth.createUserWithEmailAndPassword(email, senha)).user;
        }
        await user.updateProfile({ displayName: nome });
        // Perfil + login por CPF gravados juntos (as regras exigem os dois)
        const batch = db.batch();
        batch.set(db.collection('pacientes').doc(user.uid), {
            nome, cpf, sus, nascimento, telefone, email,
            consentimentoLgpd: true,
            criadoEm: FieldValue.serverTimestamp(),
            atualizadoEm: FieldValue.serverTimestamp()
        });
        batch.set(db.collection('logins').doc(cpf), Object.assign({ uid: user.uid }, await cifrarEmail(email, senha)));
        await batch.commit();
        contaNova = null;
        modalMunicipe.hide();
        await carregarMunicipe(user);
        irParaMinhaArea();
    } catch (e) {
        // não deixa conta "pela metade" se o perfil não foi gravado
        if (contaNova) await contaNova.delete().catch(() => {});
        mostrarMsg('msgMunCadastrar', esc(e.code === 'permission-denied'
            ? 'Não foi possível concluir: este CPF pode já estar cadastrado. Tente entrar pela aba Entrar.'
            : mensagemErroAuth(e)));
    } finally {
        cadastrandoAgora = false;
        btn.disabled = false;
    }
}

/** Aceita CPF ou e-mail. Com CPF, decifra o e-mail guardado em logins/{cpf} usando a senha. */
async function entrarMunicipe() {
    mostrarMsg('msgMunEntrar', '');
    const login = document.getElementById('munEmail').value.trim();
    const senha = document.getElementById('munSenha').value;
    try {
        let email = login;
        const porCpf = !login.includes('@');
        if (porCpf) {
            const cpf = soDigitos(login);
            if (!cpfValido(cpf)) { mostrarMsg('msgMunEntrar', 'CPF inválido. Confira os 11 números ou use o e-mail.'); return; }
            const reg = await db.collection('logins').doc(cpf).get();
            email = reg.exists ? await decifrarEmail(reg.data(), senha) : null;
            if (!email) {
                mostrarMsg('msgMunEntrar', 'CPF ou senha incorretos. Se você trocou a senha pelo e-mail de recuperação, entre uma vez usando o <strong>e-mail</strong>.');
                return;
            }
        }
        const { user } = await auth.signInWithEmailAndPassword(email, senha);
        const p = await db.collection('pacientes').doc(user.uid).get();
        // Entrou pelo e-mail: atualiza o login por CPF com a senha atual (ex.: depois de recuperar a senha)
        if (!porCpf && p.exists && p.get('cpf')) {
            db.collection('logins').doc(p.get('cpf')).update(await cifrarEmail(user.email, senha)).catch(() => {});
        }
        if (!p.exists) {
            // Conta sem cadastro de munícipe (ex.: servidor) -> completar cadastro
            document.getElementById('cadEmail').value = user.email;
            abrirMunicipe('cadastrar');
            mostrarMsg('msgMunCadastrar', 'Complete seus dados de munícipe para continuar. Use a mesma senha.', 'info');
            return;
        }
        modalMunicipe.hide();
        irParaMinhaArea();
    } catch (e) {
        mostrarMsg('msgMunEntrar', esc(mensagemErroAuth(e)));
    }
}

async function esqueciSenha(campoEmail, campoMsg) {
    const email = document.getElementById(campoEmail).value.trim();
    if (!email.includes('@')) { mostrarMsg(campoMsg, 'Para recuperar a senha, digite acima o <strong>e-mail</strong> do cadastro (não o CPF) e clique de novo em "Esqueci minha senha".', 'warning'); return; }
    try {
        await auth.sendPasswordResetEmail(email);
        mostrarMsg(campoMsg, 'Se houver uma conta com este e-mail, enviamos um link para criar uma nova senha.', 'success');
    } catch (e) {
        mostrarMsg(campoMsg, esc(mensagemErroAuth(e)));
    }
}

function sair() {
    auth.signOut().then(() => location.reload());
}

function irParaMinhaArea() {
    if (!paciente) { abrirMunicipe('entrar'); return false; }
    document.getElementById('minhaArea').scrollIntoView({ behavior: 'smooth' });
    return false;
}

// ---------- 5. Minha Área ----------
async function carregarMunicipe(user) {
    const p = await db.collection('pacientes').doc(user.uid).get();
    paciente = p.exists ? Object.assign({ uid: user.uid }, p.data()) : null;
    atualizarTela();
    if (paciente) await carregarMinhasSolicitacoes();
}

function atualizarTela() {
    const logado = !!paciente;
    document.getElementById('minhaArea').classList.toggle('d-none', !logado);
    document.getElementById('navMinhaArea').classList.toggle('d-none', !logado);
    document.getElementById('navEntrar').classList.toggle('d-none', !!auth.currentUser);
    document.getElementById('navSair').classList.toggle('d-none', !auth.currentUser);
    document.getElementById('btnHeroCadastro').classList.toggle('d-none', logado);
    document.getElementById('solicitarVisitante').classList.toggle('d-none', logado);
    document.getElementById('solicitarLogado').classList.toggle('d-none', !logado);
    if (!logado) return;

    document.getElementById('avisoSemCpf').classList.toggle('d-none', !!paciente.cpf);
    document.getElementById('solicitarLogado').classList.toggle('d-none', !paciente.cpf);
    document.getElementById('saudacaoNome').textContent = paciente.nome.split(' ')[0];
    document.getElementById('meusDados').innerHTML = `
        <div><strong>Nome:</strong> ${esc(paciente.nome)}</div>
        <div><strong>CPF:</strong> ${esc(mascararCpf(paciente.cpf))}</div>
        <div><strong>Cartão SUS:</strong> ${esc(mascararSus(paciente.sus))}</div>
        <div><strong>Nascimento:</strong> ${esc(nascimentoParaTexto(paciente.nascimento))}</div>
        <div><strong>Telefone:</strong> ${esc(mascararTelefone(paciente.telefone))}
            <a href="#" class="ms-1" onclick="event.preventDefault(); mostrarEdicaoTelefone(true);">alterar</a></div>
        <form id="formTelefone" class="d-none mt-1" onsubmit="event.preventDefault(); salvarTelefone();">
            <div class="input-group input-group-sm">
                <input type="tel" id="novoTelefone" class="form-control" placeholder="(61) 98712-3456" maxlength="16" required>
                <button class="btn btn-primary" type="submit">Salvar</button>
                <button class="btn btn-outline-secondary" type="button" onclick="mostrarEdicaoTelefone(false)">×</button>
            </div>
            <div id="msgTelefone" class="small mt-1"></div>
        </form>
        <div><strong>E-mail:</strong> ${esc(paciente.email)}</div>`;
    document.getElementById('resumoPaciente').innerHTML =
        `<i class="bi bi-person-check me-1"></i>Pedido em nome de <strong>${esc(paciente.nome)}</strong> • ` +
        `CPF ${esc(mascararCpf(paciente.cpf))} • SUS ${esc(mascararSus(paciente.sus))} • ${esc(mascararTelefone(paciente.telefone))}`;
}

/** Conta antiga sem CPF: grava o CPF no perfil + o registro de login por CPF. */
async function incluirCpf() {
    const cpf = soDigitos(document.getElementById('addCpf').value);
    const senha = document.getElementById('addSenha').value;
    mostrarMsg('msgAddCpf', '');
    if (!cpfValido(cpf)) { mostrarMsg('msgAddCpf', 'CPF inválido. Confira os 11 números.'); return; }
    try {
        const user = auth.currentUser;
        // confirma a senha (ela protege o e-mail no login por CPF)
        await user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, senha));
        if ((await db.collection('logins').doc(cpf).get()).exists) {
            mostrarMsg('msgAddCpf', 'Este CPF já está cadastrado em outra conta. Procure sua UBS.');
            return;
        }
        const batch = db.batch();
        batch.update(db.collection('pacientes').doc(user.uid), { cpf, atualizadoEm: FieldValue.serverTimestamp() });
        batch.set(db.collection('logins').doc(cpf), Object.assign({ uid: user.uid }, await cifrarEmail(user.email, senha)));
        await batch.commit();
        await carregarMunicipe(user);
    } catch (e) {
        mostrarMsg('msgAddCpf', esc(e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password'
            ? 'Senha incorreta.' : mensagemErroAuth(e)));
    }
}

// ----- telefone (o novo número vale para os próximos pedidos e aparece para a equipe no painel)
function mostrarEdicaoTelefone(mostrar) {
    document.getElementById('formTelefone').classList.toggle('d-none', !mostrar);
    if (mostrar) document.getElementById('novoTelefone').focus();
}

async function salvarTelefone() {
    const telefone = soDigitos(document.getElementById('novoTelefone').value);
    const msg = document.getElementById('msgTelefone');
    if (telefone.length < 10 || telefone.length > 11) { msg.className = 'small mt-1 text-danger'; msg.textContent = 'Informe um telefone com DDD.'; return; }
    try {
        await db.collection('pacientes').doc(paciente.uid).update({ telefone, atualizadoEm: FieldValue.serverTimestamp() });
        paciente.telefone = telefone;
        atualizarTela();
    } catch (e) {
        msg.className = 'small mt-1 text-danger';
        msg.textContent = mensagemErroAuth(e);
    }
}

// ----- "novidades": o que mudou desde a última visita (guardado só neste navegador)
function lerVistos() {
    try { return JSON.parse(localStorage.getItem('agiliza_vistos_' + paciente.uid)) || null; } catch (e) { return null; }
}
function gravarVistos(lista) {
    const mapa = {};
    lista.forEach(s => { mapa[s.protocolo] = s.atualizadoEm ? s.atualizadoEm.toMillis() : 0; });
    try { localStorage.setItem('agiliza_vistos_' + paciente.uid, JSON.stringify(mapa)); } catch (e) { /* navegador sem armazenamento */ }
}

async function carregarMinhasSolicitacoes() {
    const alvo = document.getElementById('minhasSolicitacoes');
    const aviso = document.getElementById('avisoNovidades');
    try {
        // pedidos da própria conta + os feitos no atendimento presencial (balcão) com o mesmo CPF e nascimento
        const [snap, snapBalcao] = await Promise.all([
            db.collection('solicitacoes').where('uid', '==', paciente.uid).get(),
            paciente.cpf
                ? db.collection('solicitacoes').where('uid', '==', 'balcao-' + paciente.cpf)
                    .where('nascimento', '==', paciente.nascimento).get().catch(() => null)
                : null
        ]);
        const lista = snap.docs.concat(snapBalcao ? snapBalcao.docs : []).map(d => d.data())
            .sort((a, b) => (b.criadoEm ? b.criadoEm.toMillis() : 0) - (a.criadoEm ? a.criadoEm.toMillis() : 0));
        if (!lista.length) {
            alvo.innerHTML = 'Você ainda não fez nenhum pedido. <a href="#solicitar">Fazer o primeiro</a>.';
            aviso.classList.add('d-none');
            return;
        }
        // compara com a última visita: o que a equipe atualizou desde então?
        const vistos = lerVistos();
        const novidade = (s) => vistos && s.atualizadoEm && s.atualizadoEm.toMillis() > (vistos[s.protocolo] || 0) &&
            s.protocolo in vistos;
        const comNovidade = lista.filter(novidade);
        aviso.classList.toggle('d-none', !comNovidade.length);
        aviso.innerHTML = comNovidade.length
            ? `<i class="bi bi-bell-fill me-1"></i><strong>${comNovidade.length} pedido(s) com novidade</strong> desde a sua última visita: ` +
              comNovidade.map(s => `#${esc(s.protocolo)} agora está <strong>${esc((STATUS[s.status] || {}).rotulo || s.status)}</strong>`).join('; ') + '.'
            : '';

        alvo.classList.remove('text-muted');
        alvo.innerHTML = lista.map(s => `
            <div class="border rounded-3 p-2 mb-2 ${novidade(s) ? 'border-warning border-2 bg-warning-subtle' : 'bg-white'}">
                <div class="d-flex justify-content-between align-items-center">
                    <strong class="text-primary">#${esc(s.protocolo)}
                        ${novidade(s) ? '<span class="badge bg-warning text-dark ms-1"><i class="bi bi-bell-fill"></i> Novidade</span>' : ''}</strong>
                    ${badgeStatus(s.status)}
                </div>
                <div>${esc(s.servico)} • ${esc(s.ubs)}</div>
                <div class="text-success">${esc(s.mensagemPublica)}</div>
                ${s.status === 'AGENDADA' ? blocoAgendamento(s.agendamento) : ''}
                <div class="text-muted">Pedido em ${esc(dataParaTexto(s.criadoEm))} • atualizado em ${esc(dataParaTexto(s.atualizadoEm))}
                    ${(s.temAnexo ? 1 : 0) + (s.qtdExtras || 0) ? ` • ${(s.temAnexo ? 1 : 0) + (s.qtdExtras || 0)} documento(s) enviado(s)` : ' • sem documentos anexados'}</div>
                ${s.canal === 'BALCAO' ? '<div class="text-muted"><i class="bi bi-building me-1"></i>Pedido feito no atendimento presencial da UBS. Para cancelar, fale com a sua UBS.</div>' : ''}
                ${s.cirurgia ? `<div class="text-primary"><i class="bi bi-hospital me-1"></i>${esc(s.cirurgia.procedimento)} • ${esc(s.cirurgia.hospital)}</div>` : ''}
                ${STATUS_ABERTOS.includes(s.status) && s.uid === paciente.uid ? `<button class="btn btn-sm btn-outline-danger mt-1" onclick="cancelarPedido('${esc(s.protocolo)}')">
                    <i class="bi bi-x-circle me-1"></i>Cancelar pedido</button>` : ''}
            </div>`).join('');
        gravarVistos(lista);
    } catch (e) {
        alvo.textContent = mensagemErroAuth(e);
    }
}

/** O cidadão desiste do pedido (só enquanto ainda não foi marcado). */
async function cancelarPedido(protocolo) {
    if (!confirm('Cancelar o pedido #' + protocolo + '? Essa ação não pode ser desfeita.')) return;
    try {
        const agora = FieldValue.serverTimestamp();
        const ref = db.collection('solicitacoes').doc(protocolo);
        const atual = (await ref.get()).data();
        const batch = db.batch();
        batch.update(ref, { status: 'CANCELADA', mensagemPublica: MSG_CANCELADO_MUNICIPE, atualizadoEm: agora });
        const refCons = db.collection('consultas').doc(paciente.cpf).collection('pedidos').doc(protocolo);
        if ((await refCons.get()).exists) {
            batch.update(refCons, { status: 'CANCELADA', mensagem: MSG_CANCELADO_MUNICIPE, atualizadoEm: agora });
        }
        batch.set(ref.collection('historico').doc(), {
            usuario: paciente.uid, usuarioNome: paciente.nome,
            statusAnterior: atual.status, statusNovo: 'CANCELADA',
            observacao: 'Cancelado pelo próprio munícipe na Minha Área', criadoEm: agora
        });
        await batch.commit();
        // a mudança foi feita pela própria pessoa: não mostrar como "novidade"
        const vistos = lerVistos() || {};
        vistos[protocolo] = Number.MAX_SAFE_INTEGER;
        try { localStorage.setItem('agiliza_vistos_' + paciente.uid, JSON.stringify(vistos)); } catch (e) { /* ignora */ }
        await carregarMinhasSolicitacoes();
    } catch (e) {
        alert(mensagemErroAuth(e));
    }
}

// ---------- 6. Nova solicitação ----------
async function cadastrarDemanda() {
    const msg = document.getElementById('msgDemanda');
    const btn = document.getElementById('btnEnviar');
    const avisar = (texto, tipo) => { msg.className = 'alert text-start alert-' + tipo; msg.innerHTML = texto; };
    if (!paciente) { abrirMunicipe('entrar'); return; }

    const ubs = UBS.find(u => u.id === document.getElementById('ubsSelect').value);
    const servico = SERVICOS.find(s => s.id === document.getElementById('tipoSelect').value);
    const arquivo = document.getElementById('guiaUpload').files[0];
    const extrasArq = Array.from(document.getElementById('extrasUpload').files);
    if (!ubs || !servico) { avisar('Selecione a UBS e o serviço.', 'danger'); return; }
    if (extrasArq.length > MAX_DOCS_EXTRAS) { avisar('Envie no máximo ' + MAX_DOCS_EXTRAS + ' documentos extras.', 'danger'); return; }

    btn.disabled = true;
    avisar('<span class="spinner-border spinner-border-sm me-2"></span>Enviando...', 'info');
    try {
        const anexo = arquivo ? await prepararAnexo(arquivo) : null; // anexo é opcional
        const extras = [];
        for (const a of extrasArq) extras.push(await prepararAnexo(a));
        let protocolo = null;
        for (let tentativa = 0; tentativa < 3 && !protocolo; tentativa++) {
            const prot = gerarProtocolo();
            const agora = FieldValue.serverTimestamp();
            const batch = db.batch();
            batch.set(db.collection('solicitacoes').doc(prot), {
                protocolo: prot,
                uid: paciente.uid,
                paciente: paciente.nome,
                cpf: paciente.cpf,
                sus: paciente.sus,
                nascimento: paciente.nascimento,
                telefone: paciente.telefone,
                ubsId: ubs.id, ubs: ubs.nome,
                servicoId: servico.id, servico: servico.nome,
                status: 'RECEBIDA',
                mensagemPublica: STATUS.RECEBIDA.mensagem,
                temAnexo: !!anexo,
                qtdExtras: extras.length,
                consentimentoLgpd: true,
                criadoEm: agora,
                atualizadoEm: agora
            });
            batch.set(db.collection('solicitacoes').doc(prot).collection('historico').doc(), {
                usuario: paciente.uid, usuarioNome: paciente.nome,
                statusAnterior: null, statusNovo: 'RECEBIDA',
                observacao: 'Solicitação criada pelo munícipe', criadoEm: agora
            });
            if (anexo) {
                batch.set(db.collection('anexos').doc(prot), {
                    uid: paciente.uid, dados: anexo.dados, tipo: anexo.tipo, nome: anexo.nome, criadoEm: agora
                });
            }
            extras.forEach((x, i) => batch.set(db.collection('anexos').doc(prot).collection('extras').doc(String(i + 1)), {
                uid: paciente.uid, dados: x.dados, tipo: x.tipo, nome: x.nome, criadoEm: agora
            }));
            batch.set(db.collection('consultas').doc(paciente.cpf).collection('pedidos').doc(prot), {
                protocolo: prot, status: 'RECEBIDA',
                primeiroNome: paciente.nome.split(' ')[0],
                servico: servico.nome, ubs: ubs.nome,
                mensagem: STATUS.RECEBIDA.mensagem, atualizadoEm: agora
            });
            try {
                await batch.commit();
                protocolo = prot;
            } catch (e) {
                // protocolo repetido (rarissimo) -> tenta outro; demais erros sobem
                if (e.code !== 'permission-denied' || tentativa === 2) throw e;
            }
        }
        avisar('✅ Solicitação cadastrada com sucesso! Seu protocolo é <strong>#' + esc(protocolo) +
            '</strong>. Acompanhe na sua Minha Área ou na consulta pelo seu CPF.', 'success');
        document.getElementById('formDemanda').reset();
        carregarMinhasSolicitacoes();
    } catch (e) {
        avisar(esc(e.code ? mensagemErroAuth(e) : e.message), 'danger');
    } finally {
        btn.disabled = false;
        msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// ---------- 7. Servidor: login e pedido de acesso ----------
function abrirServidor(aba) {
    mostrarMsg('msgSrvEntrar', ''); mostrarMsg('msgSrvSolicitar', '');
    bootstrap.Tab.getOrCreateInstance(document.getElementById(aba === 'solicitar' ? 'abaSrvSolicitar' : 'abaSrvEntrar')).show();
    modalServidor.show();
}

async function entrarServidor() {
    mostrarMsg('msgSrvEntrar', '');
    try {
        const { user } = await auth.signInWithEmailAndPassword(
            document.getElementById('srvEmail').value.trim(), document.getElementById('srvSenha').value);
        const s = await db.collection('servidores').doc(user.uid).get();
        const motivo = motivoServidorBloqueado(s.exists ? s.data() : null);
        if (motivo) {
            // sem acesso ao painel: só continua logado se também for munícipe
            const p = await db.collection('pacientes').doc(user.uid).get();
            if (!p.exists) await auth.signOut();
            mostrarMsg('msgSrvEntrar', esc(motivo), 'warning');
            return;
        }
        window.location.href = 'painel.html';
    } catch (e) {
        mostrarMsg('msgSrvEntrar', esc(mensagemErroAuth(e)));
    }
}

async function solicitarAcessoServidor() {
    const nome = document.getElementById('reqNome').value.trim().replace(/\s+/g, ' ');
    const matricula = document.getElementById('reqMatricula').value.trim();
    const email = document.getElementById('reqEmail').value.trim();
    const senha = document.getElementById('reqSenha').value;
    if (nome.length < 3) { mostrarMsg('msgSrvSolicitar', 'Informe o nome completo.'); return; }
    cadastrandoAgora = true;
    try {
        let user = auth.currentUser;
        if (!user || user.email !== email) {
            try {
                user = (await auth.createUserWithEmailAndPassword(email, senha)).user;
            } catch (e) {
                // já tem conta (ex.: também é munícipe): entra com a mesma senha
                if (e.code !== 'auth/email-already-in-use') throw e;
                user = (await auth.signInWithEmailAndPassword(email, senha)).user;
            }
        }
        if (!user.displayName) await user.updateProfile({ displayName: nome });
        const ref = db.collection('servidores').doc(user.uid);
        if ((await ref.get()).exists) {
            mostrarMsg('msgSrvSolicitar', 'Você já pediu acesso. Aguarde a aprovação de um administrador.', 'info');
            return;
        }
        await ref.set({ nome, email: user.email, matricula, perfil: 'ATENDENTE', aprovado: false, criadoEm: FieldValue.serverTimestamp() });
        if (!paciente) await auth.signOut(); // sem acesso ainda: não fica logado
        mostrarMsg('msgSrvSolicitar', '✅ Pedido enviado! Assim que um administrador aprovar, entre pela aba <strong>Entrar</strong>.', 'success');
    } catch (e) {
        mostrarMsg('msgSrvSolicitar', esc(mensagemErroAuth(e)));
    } finally {
        cadastrandoAgora = false;
    }
}

// ---------- 8. Início ----------
// máscaras simples
['consCpf', 'cadCpf', 'munEmail', 'addCpf'].forEach(id => ligarMascaraCpf(document.getElementById(id)));
document.getElementById('cadSus').addEventListener('input', function () {
    const d = this.value.replace(/\D/g, '').slice(0, 15);
    this.value = d.replace(/^(\d{3})(\d{0,4})(\d{0,4})(\d{0,4}).*/, (m, a, b, c, e) => [a, b, c, e].filter(Boolean).join('.'));
});
document.getElementById('cadTel').addEventListener('input', function () {
    const d = this.value.replace(/\D/g, '').slice(0, 11);
    this.value = d.length > 2 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, d.length > 10 ? 7 : 6) + (d.length > 6 ? '-' + d.slice(d.length > 10 ? 7 : 6) : '') : d;
});

montarCatalogo();
auth.onAuthStateChanged(async user => {
    if (cadastrandoAgora) return;
    paciente = null;
    document.getElementById('navPainel').classList.add('d-none');
    if (user) {
        try {
            await carregarMunicipe(user);
            const s = await db.collection('servidores').doc(user.uid).get();
            if (s.exists && !motivoServidorBloqueado(s.data())) document.getElementById('navPainel').classList.remove('d-none');
        } catch (e) { /* sem permissão / offline: segue como visitante */ }
    }
    atualizarTela();
});
