-- =====================================================================
-- Agiliza Saude - Cidade Ocidental (GO)
-- Banco: MySQL 8.0+
-- Execute no MySQL Workbench (ou: mysql -u root -p < agiliza_saude.sql)
-- =====================================================================

DROP DATABASE IF EXISTS agiliza_saude;
CREATE DATABASE agiliza_saude
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_0900_ai_ci;
USE agiliza_saude;

-- ---------------------------------------------------------------------
-- UBS (unidades basicas de saude)
-- ---------------------------------------------------------------------
CREATE TABLE ubs (
    id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    nome             VARCHAR(120)  NOT NULL,
    endereco         VARCHAR(200)  NULL,
    horario_abertura TIME          NOT NULL DEFAULT '07:30:00',
    horario_fechamento TIME        NOT NULL DEFAULT '17:00:00',
    ativa            TINYINT(1)    NOT NULL DEFAULT 1,
    PRIMARY KEY (id),
    UNIQUE KEY uk_ubs_nome (nome)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Servicos oferecidos ao municipe
-- ---------------------------------------------------------------------
CREATE TABLE servico (
    id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    nome       VARCHAR(120) NOT NULL,
    descricao  VARCHAR(255) NULL,
    ativo      TINYINT(1)   NOT NULL DEFAULT 1,
    somente_equipe TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = so o servidor abre (ex.: cirurgia eletiva)',
    PRIMARY KEY (id),
    UNIQUE KEY uk_servico_nome (nome)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Pacientes (municipes). CPF (11 digitos) e Cartao SUS (15 digitos) somente numeros.
-- O CPF e a forma de o municipe acompanhar os pedidos no site.
-- ---------------------------------------------------------------------
CREATE TABLE paciente (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    nome            VARCHAR(120)    NOT NULL,
    cpf             CHAR(11)        NOT NULL,
    cartao_sus      CHAR(15)        NULL COMMENT 'Pode ficar vazio no atendimento presencial',
    data_nascimento DATE            NOT NULL,
    telefone        VARCHAR(15)     NULL COMMENT 'Pode ficar vazio no atendimento presencial',
    cadastro_presencial TINYINT(1)  NOT NULL DEFAULT 0 COMMENT '1 = cadastrado pelo servidor no balcao da UBS',
    cadastrado_por  INT UNSIGNED    NULL COMMENT 'Servidor que fez o cadastro presencial',
    criado_em       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_paciente_cpf (cpf),
    UNIQUE KEY uk_paciente_sus (cartao_sus),
    CONSTRAINT ck_paciente_cpf CHECK (cpf REGEXP '^[0-9]{11}$')
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Servidores municipais (login do painel)
-- senha_hash no formato  iteracoes:salt_base64:hash_base64  (PBKDF2-SHA256)
-- ---------------------------------------------------------------------
CREATE TABLE usuario (
    id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
    nome         VARCHAR(120) NOT NULL,
    email        VARCHAR(150) NOT NULL,
    senha_hash   VARCHAR(255) NOT NULL,
    perfil       ENUM('ATENDENTE','REGULADOR','ADMIN') NOT NULL DEFAULT 'ATENDENTE',
    ativo        TINYINT(1)   NOT NULL DEFAULT 1,
    ultimo_login DATETIME     NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_usuario_email (email)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Solicitacoes de atendimento
-- ---------------------------------------------------------------------
CREATE TABLE solicitacao (
    id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    protocolo             VARCHAR(20)     NOT NULL,
    paciente_id           BIGINT UNSIGNED NOT NULL,
    ubs_id                INT UNSIGNED    NOT NULL,
    servico_id            INT UNSIGNED    NOT NULL,
    status                ENUM('RECEBIDA','EM_TRIAGEM','EM_ANALISE_REGULACAO',
                               'AGENDADA','CONCLUIDA','NEGADA','CANCELADA','FALTOU')
                          NOT NULL DEFAULT 'RECEBIDA',
    mensagem_publica      VARCHAR(500)    NULL COMMENT 'Texto exibido ao municipe na consulta',
    -- Prioridade na fila: INTERNA. A API do municipe nunca devolve estes campos.
    prioridade            ENUM('URGENTE','PRIORITARIO','NORMAL') NOT NULL DEFAULT 'NORMAL',
    prioridade_motivo     VARCHAR(200)    NULL,
    prioridade_por        INT UNSIGNED    NULL COMMENT 'Servidor que definiu a prioridade',
    prioridade_em         DATETIME        NULL,
    -- Atendimento presencial: pedido registrado pelo servidor em nome do paciente
    canal                 ENUM('SITE','BALCAO') NOT NULL DEFAULT 'SITE',
    criado_por            INT UNSIGNED    NULL COMMENT 'Servidor que registrou (canal BALCAO)',
    -- Cirurgia eletiva (servico somente_equipe): procedimento, hospital e pre-operatorio
    cirurgia_procedimento VARCHAR(160)    NULL,
    cirurgia_hospital     VARCHAR(160)    NULL,
    preop_exames          TINYINT(1)      NOT NULL DEFAULT 0,
    preop_risco           TINYINT(1)      NOT NULL DEFAULT 0,
    preop_termo           TINYINT(1)      NOT NULL DEFAULT 0,
    preop_orientado       TINYINT(1)      NOT NULL DEFAULT 0,
    anexo_arquivo         VARCHAR(80)     NULL COMMENT 'Nome do arquivo salvo em disco (UUID)',
    anexo_nome_original   VARCHAR(255)    NULL,
    anexo_tipo            VARCHAR(60)     NULL,
    consentimento_lgpd    TINYINT(1)      NOT NULL,
    data_consentimento    DATETIME        NOT NULL,
    criado_em             DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                          ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_solicitacao_protocolo (protocolo),
    KEY idx_solicitacao_status (status),
    KEY idx_solicitacao_paciente (paciente_id),
    KEY idx_solicitacao_fila (status, prioridade, criado_em),
    CONSTRAINT fk_sol_paciente FOREIGN KEY (paciente_id) REFERENCES paciente (id),
    CONSTRAINT fk_sol_prioridade_por FOREIGN KEY (prioridade_por) REFERENCES usuario (id),
    CONSTRAINT fk_sol_criado_por FOREIGN KEY (criado_por) REFERENCES usuario (id),
    CONSTRAINT fk_sol_ubs      FOREIGN KEY (ubs_id)      REFERENCES ubs (id),
    CONSTRAINT fk_sol_servico  FOREIGN KEY (servico_id)  REFERENCES servico (id),
    CONSTRAINT ck_sol_lgpd     CHECK (consentimento_lgpd = 1)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Historico de movimentacao (auditoria)
-- ---------------------------------------------------------------------
CREATE TABLE historico_solicitacao (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    solicitacao_id  BIGINT UNSIGNED NOT NULL,
    usuario_id      INT UNSIGNED    NULL COMMENT 'NULL = criado pelo proprio municipe',
    status_anterior VARCHAR(30)     NULL,
    status_novo     VARCHAR(30)     NOT NULL,
    observacao      VARCHAR(500)    NULL COMMENT 'Observacao interna (nao exibida ao municipe)',
    criado_em       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_hist_solicitacao (solicitacao_id),
    CONSTRAINT fk_hist_solicitacao FOREIGN KEY (solicitacao_id) REFERENCES solicitacao (id) ON DELETE CASCADE,
    CONSTRAINT fk_hist_usuario     FOREIGN KEY (usuario_id)     REFERENCES usuario (id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Profissionais (medicos, laboratorio...) com a agenda semanal padrao
-- dias_semana: lista "1,3" (0=domingo ... 6=sabado)
-- ---------------------------------------------------------------------
CREATE TABLE profissional (
    id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    nome          VARCHAR(120)  NOT NULL,
    especialidade VARCHAR(80)   NOT NULL,
    registro      VARCHAR(40)   NULL COMMENT 'CRM/COREN',
    servico_id    INT UNSIGNED  NOT NULL COMMENT 'Atende pedidos deste servico',
    local         VARCHAR(160)  NOT NULL,
    dias_semana   VARCHAR(20)   NOT NULL,
    hora_inicio   TIME          NOT NULL,
    hora_fim      TIME          NOT NULL,
    duracao_min   SMALLINT UNSIGNED NOT NULL,
    ativo         TINYINT(1)    NOT NULL DEFAULT 1 COMMENT '0 = nao trabalha mais (desativado; os dados ficam guardados)',
    inativo_desde DATE          NULL,
    ferias_inicio DATE          NULL COMMENT 'Ferias/afastamento: nesses dias nao gera agenda',
    ferias_fim    DATE          NULL,
    ferias_motivo VARCHAR(80)   NULL,
    criado_em     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT fk_prof_servico FOREIGN KEY (servico_id) REFERENCES servico (id),
    CONSTRAINT ck_prof_horario CHECK (hora_fim > hora_inicio AND duracao_min BETWEEN 5 AND 240),
    CONSTRAINT ck_prof_ferias CHECK ((ferias_inicio IS NULL AND ferias_fim IS NULL) OR ferias_fim >= ferias_inicio)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Agenda = um dia de atendimento com N vagas (do profissional ou avulsa/mutirao)
-- UNIQUE (profissional_id, data): "Gerar agendas" nunca duplica o mesmo dia
-- ---------------------------------------------------------------------
CREATE TABLE agenda (
    id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    servico_id      INT UNSIGNED  NOT NULL,
    profissional_id INT UNSIGNED  NULL COMMENT 'NULL = agenda avulsa (mutirao)',
    local           VARCHAR(160)  NOT NULL,
    data            DATE          NOT NULL,
    hora_inicio     TIME          NOT NULL,
    intervalo_min   SMALLINT UNSIGNED NOT NULL,
    vagas           SMALLINT UNSIGNED NOT NULL,
    orientacoes     VARCHAR(500)  NULL,
    criado_por      INT UNSIGNED  NOT NULL,
    criado_em       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uk_agenda_prof_dia (profissional_id, data),
    KEY idx_agenda_data (data),
    CONSTRAINT fk_agenda_servico FOREIGN KEY (servico_id) REFERENCES servico (id),
    CONSTRAINT fk_agenda_prof    FOREIGN KEY (profissional_id) REFERENCES profissional (id),
    CONSTRAINT fk_agenda_usuario FOREIGN KEY (criado_por) REFERENCES usuario (id),
    CONSTRAINT ck_agenda_vagas   CHECK (vagas BETWEEN 1 AND 200)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Vaga ocupada. PRIMARY KEY (agenda, numero): duas pessoas NUNCA no mesmo horario.
-- UNIQUE solicitacao_id: um pedido so ocupa uma vaga por vez.
-- horario da vaga = hora_inicio + numero * intervalo_min
-- ---------------------------------------------------------------------
CREATE TABLE agenda_vaga (
    agenda_id      INT UNSIGNED     NOT NULL,
    numero         SMALLINT UNSIGNED NOT NULL,
    solicitacao_id BIGINT UNSIGNED  NOT NULL,
    marcado_por    INT UNSIGNED     NOT NULL,
    marcado_em     DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (agenda_id, numero),
    UNIQUE KEY uk_vaga_solicitacao (solicitacao_id),
    CONSTRAINT fk_vaga_agenda      FOREIGN KEY (agenda_id) REFERENCES agenda (id) ON DELETE CASCADE,
    CONSTRAINT fk_vaga_solicitacao FOREIGN KEY (solicitacao_id) REFERENCES solicitacao (id),
    CONSTRAINT fk_vaga_usuario     FOREIGN KEY (marcado_por) REFERENCES usuario (id)
) ENGINE=InnoDB;

-- =====================================================================
-- DADOS INICIAIS
-- =====================================================================
INSERT INTO ubs (nome, endereco) VALUES
 ('UBS Família SQ 12 - Centro',          'SQ 10 QD 27 A E, S/N - Centro'),
 ('UBS Família Ocidental Park',          'Rua 32 QD 27 A E 17 - Ocidental Park'),
 ('UBS Família Friburgo A',              NULL),
 ('UBS Família Parque Araguari',         NULL),
 ('UBS Família Jardim ABC',              NULL),
 ('UBS Família Parque Estrela Dalva III','Quadra 109, Lote 09 - Estrela Dalva III');

INSERT INTO servico (nome, descricao) VALUES
 ('Consulta Médica Especializada',   'Cardiologia, ortopedia e oftalmologia.'),
 ('Exames de Imagem e Laboratório',  'Ultrassonografia, raio-X e sangue.'),
 ('Transporte Sanitário (TFD)',      'Viagens para tratamento em Goiânia/DF.'),
 ('Medicamentos da Farmácia Básica', 'Remédios de uso contínuo na farmácia.');
INSERT INTO servico (nome, descricao, somente_equipe) VALUES
 ('Cirurgia Eletiva', 'Cirurgias programadas (não urgentes). Aberta só no atendimento presencial.', 1);

-- paciente.cadastrado_por -> usuario (a tabela usuario e criada depois de paciente)
ALTER TABLE paciente ADD CONSTRAINT fk_paciente_cadastrado_por FOREIGN KEY (cadastrado_por) REFERENCES usuario (id);

-- Usuario de demonstracao: servidor@cidadeocidental.go.gov.br / saude2026
-- TROQUE a senha antes de qualquer uso real.
INSERT INTO usuario (nome, email, senha_hash, perfil) VALUES
 ('Servidor Demonstração', 'servidor@cidadeocidental.go.gov.br',
  '120000:obLD1OX2BxgpOktcbX6PkA==:bzBVRkIYTDUPqer7uvB9vGb8+hpObTqisZ4e+ysqDps=',
  'REGULADOR');

-- Pacientes de demonstracao (CPFs ficticios, mas validos)
--   Lucas: CPF 529.982.247-25   |   Maria: CPF 111.444.777-35 (idosa, 76 anos)
INSERT INTO paciente (nome, cpf, cartao_sus, data_nascimento, telefone) VALUES
 ('Lucas Ferreira Mendes',  '52998224725', '700123456789012', '1998-05-14', '61987123456'),
 ('Maria Aparecida Souza',  '11144477735', '700000000000002', '1950-03-20', '61988887777');

-- Pedidos com datas no passado para demonstrar TEMPO DE ESPERA e PRIORIDADE no painel
INSERT INTO solicitacao (protocolo, paciente_id, ubs_id, servico_id, status, mensagem_publica,
                         prioridade, prioridade_motivo, prioridade_por, prioridade_em,
                         consentimento_lgpd, data_consentimento, criado_em, atualizado_em) VALUES
 ('2026-00001', 1, 1, 1, 'EM_TRIAGEM', 'Solicitação em triagem pela equipe da UBS.',
  'URGENTE', 'Oncologia', 1, NOW() - INTERVAL 2 DAY,
  1, NOW() - INTERVAL 20 DAY, NOW() - INTERVAL 20 DAY, NOW() - INTERVAL 2 DAY),
 ('2026-00002', 1, 1, 2, 'RECEBIDA', 'Solicitação recebida. Aguardando triagem.',
  'NORMAL', NULL, NULL, NULL,
  1, NOW() - INTERVAL 3 DAY, NOW() - INTERVAL 3 DAY, NOW() - INTERVAL 3 DAY),
 ('2026-00003', 2, 2, 1, 'EM_ANALISE_REGULACAO', 'Solicitação em análise pela regulação médica.',
  'PRIORITARIO', 'Idoso 60+ (prioridade legal)', 1, NOW() - INTERVAL 40 DAY,
  1, NOW() - INTERVAL 45 DAY, NOW() - INTERVAL 45 DAY, NOW() - INTERVAL 10 DAY),
 ('2026-00004', 2, 2, 2, 'AGENDADA', 'Atendimento agendado. Aguarde contato da UBS.',
  'NORMAL', NULL, NULL, NULL,
  1, NOW() - INTERVAL 12 DAY, NOW() - INTERVAL 12 DAY, NOW() - INTERVAL 4 DAY),
 ('2026-00005', 1, 1, 4, 'CONCLUIDA', 'Atendimento concluído.',
  'NORMAL', NULL, NULL, NULL,
  1, NOW() - INTERVAL 60 DAY, NOW() - INTERVAL 60 DAY, NOW() - INTERVAL 25 DAY);

INSERT INTO historico_solicitacao (solicitacao_id, usuario_id, status_anterior, status_novo, observacao, criado_em) VALUES
 (1, NULL, NULL, 'RECEBIDA', 'Solicitação criada pelo munícipe', NOW() - INTERVAL 20 DAY),
 (1, 1, 'RECEBIDA', 'EM_TRIAGEM', 'Encaminhada para triagem', NOW() - INTERVAL 2 DAY),
 (2, NULL, NULL, 'RECEBIDA', 'Solicitação criada pelo munícipe', NOW() - INTERVAL 3 DAY),
 (3, NULL, NULL, 'RECEBIDA', 'Solicitação criada pelo munícipe', NOW() - INTERVAL 45 DAY),
 (3, 1, 'RECEBIDA', 'EM_ANALISE_REGULACAO', 'Enviada à regulação', NOW() - INTERVAL 10 DAY),
 (4, NULL, NULL, 'RECEBIDA', 'Solicitação criada pelo munícipe', NOW() - INTERVAL 12 DAY),
 (4, 1, 'RECEBIDA', 'AGENDADA', 'Marcado', NOW() - INTERVAL 4 DAY),
 (5, NULL, NULL, 'RECEBIDA', 'Solicitação criada pelo munícipe', NOW() - INTERVAL 60 DAY),
 (5, 1, 'RECEBIDA', 'CONCLUIDA', 'Medicamento entregue', NOW() - INTERVAL 25 DAY);

-- Cirurgia eletiva registrada no ATENDIMENTO PRESENCIAL (canal BALCAO) para a Maria
INSERT INTO solicitacao (protocolo, paciente_id, ubs_id, servico_id, status, mensagem_publica,
                         prioridade, prioridade_motivo, prioridade_por, prioridade_em,
                         canal, criado_por, cirurgia_procedimento, cirurgia_hospital, preop_exames, preop_risco,
                         consentimento_lgpd, data_consentimento, criado_em, atualizado_em)
VALUES ('2026-00006', 2, 2, 5, 'EM_ANALISE_REGULACAO', 'Solicitação em análise pela regulação médica.',
        'PRIORITARIO', 'Idoso 60+ (prioridade legal)', 1, NOW() - INTERVAL 30 DAY,
        'BALCAO', 1, 'Catarata - olho direito', 'Hospital Regional de Luziânia', 1, 1,
        1, NOW() - INTERVAL 30 DAY, NOW() - INTERVAL 30 DAY, NOW() - INTERVAL 6 DAY);
INSERT INTO historico_solicitacao (solicitacao_id, usuario_id, status_anterior, status_novo, observacao, criado_em) VALUES
 (6, 1, NULL, 'RECEBIDA', 'Atendimento presencial na UBS Família Ocidental Park', NOW() - INTERVAL 30 DAY),
 (6, 1, 'RECEBIDA', 'EM_ANALISE_REGULACAO', 'Pré-operatório: 2 de 4', NOW() - INTERVAL 6 DAY);

-- Profissionais e agendas de demonstracao
INSERT INTO profissional (nome, especialidade, registro, servico_id, local, dias_semana, hora_inicio, hora_fim, duracao_min) VALUES
 ('Dra. Ana Lima',        'Cardiologia', 'CRM-GO 12345', 1, 'Policlínica Municipal',      '2,4',       '07:00', '11:00', 20),
 ('Dr. João Pereira',     'Ortopedia',   'CRM-GO 23456', 1, 'Policlínica Municipal',      '1,3',       '13:00', '17:00', 20),
 ('Laboratório Municipal','Laboratório', NULL,           2, 'UBS Família SQ 12 - Centro', '1,2,3,4,5', '07:00', '09:00', 10),
 ('Dra. Carla Mendes',    'Oftalmologia',              'CRM-GO 34567', 1, 'Policlínica Municipal',      '5',   '07:00', '12:00', 15),
 ('Dra. Beatriz Rocha',   'Pediatria',                 'CRM-GO 56789', 1, 'UBS Família Ocidental Park', '1,4', '08:00', '12:00', 20),
 ('Dr. Marcos Tavares',   'Neurologia',                'CRM-GO 67890', 1, 'Policlínica Municipal',      '2',   '13:00', '17:00', 30),
 ('Dra. Juliana Castro',  'Ginecologia e Obstetrícia', 'CRM-GO 78901', 1, 'UBS Família SQ 12 - Centro', '3,5', '07:30', '11:30', 20),
 ('Dr. Renato Alves',     'Dermatologia',              'CRM-GO 89012', 1, 'Policlínica Municipal',      '4',   '13:00', '16:00', 20),
 ('Dra. Fernanda Lopes',  'Psiquiatria',               'CRM-GO 90123', 1, 'CAPS - Centro de Atenção Psicossocial', '1,3', '08:00', '12:00', 40),
 ('Dr. Ricardo Nunes',    'Endocrinologia',            'CRM-GO 01234', 1, 'Policlínica Municipal',      '5',   '13:00', '17:00', 20),
 ('Centro de Imagem Municipal', 'Ultrassonografia',    NULL,           2, 'Policlínica Municipal',      '2,4', '13:00', '16:00', 15);

-- Demonstracao: Dr. Renato com ferias marcadas e um medico que nao trabalha mais (desativado, dados guardados)
UPDATE profissional SET ferias_inicio = CURDATE() + INTERVAL 7 DAY, ferias_fim = CURDATE() + INTERVAL 20 DAY, ferias_motivo = 'Férias'
 WHERE nome = 'Dr. Renato Alves';
INSERT INTO profissional (nome, especialidade, registro, servico_id, local, dias_semana, hora_inicio, hora_fim, duracao_min, ativo, inativo_desde) VALUES
 ('Dr. Antônio Silva', 'Urologia', 'CRM-GO 11223', 1, 'Policlínica Municipal', '2', '08:00', '12:00', 20, 0, CURDATE() - INTERVAL 30 DAY);

INSERT INTO agenda (servico_id, profissional_id, local, data, hora_inicio, intervalo_min, vagas, orientacoes, criado_por) VALUES
 -- proxima terca (Dra. Ana) e proxima segunda (Dr. Joao); DAYOFWEEK: domingo=1 ... sabado=7
 (1, 1, 'Policlínica Municipal', CURDATE() + INTERVAL ((3 - DAYOFWEEK(CURDATE()) + 6) % 7 + 1) DAY, '07:00', 20, 12, NULL, 1),
 (1, 2, 'Policlínica Municipal', CURDATE() + INTERVAL ((2 - DAYOFWEEK(CURDATE()) + 6) % 7 + 1) DAY, '13:00', 20, 12, NULL, 1),
 -- mutirao (agenda avulsa) de ultrassom: bom para demonstrar "Preencher com a fila"
 (2, NULL, 'UBS Família Ocidental Park', CURDATE() + INTERVAL 4 DAY, '07:00', 15, 20, 'Mutirão de ultrassonografia. Jejum de 6 horas.', 1);

-- =====================================================================
-- VIEW da fila (bom para mostrar no Workbench: SELECT * FROM vw_fila_espera;)
-- Ordem da fila: em aberto primeiro, por prioridade e, dentro dela, quem espera ha mais tempo.
-- dias_espera: em aberto conta ate hoje; marcados/finalizados, ate a ultima atualizacao.
-- =====================================================================
CREATE VIEW vw_fila_espera AS
SELECT s.protocolo,
       p.nome                         AS paciente,
       p.cpf,
       TIMESTAMPDIFF(YEAR, p.data_nascimento, CURDATE()) AS idade,
       sv.nome                        AS servico,
       u.nome                         AS ubs,
       s.status,
       s.prioridade,
       s.prioridade_motivo,
       s.criado_em                    AS data_pedido,
       CASE WHEN s.status IN ('RECEBIDA','EM_TRIAGEM','EM_ANALISE_REGULACAO')
            THEN DATEDIFF(NOW(), s.criado_em)
            ELSE DATEDIFF(s.atualizado_em, s.criado_em) END AS dias_espera
FROM solicitacao s
JOIN paciente p ON p.id  = s.paciente_id
JOIN servico sv ON sv.id = s.servico_id
JOIN ubs u      ON u.id  = s.ubs_id
ORDER BY (s.status IN ('RECEBIDA','EM_TRIAGEM','EM_ANALISE_REGULACAO')) DESC,
         FIELD(s.prioridade, 'URGENTE', 'PRIORITARIO', 'NORMAL'),
         s.criado_em;

-- =====================================================================
-- Usuario MySQL proprio da aplicacao (nao usar root).
-- Deve bater com db.user / db.password em src/main/resources/db.properties
-- =====================================================================
DROP USER IF EXISTS 'agiliza'@'localhost';
CREATE USER 'agiliza'@'localhost' IDENTIFIED BY 'Agiliza#Dev2026';
GRANT SELECT, INSERT, UPDATE, DELETE, SHOW VIEW ON agiliza_saude.* TO 'agiliza'@'localhost';
FLUSH PRIVILEGES;
