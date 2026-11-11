# Agiliza Saúde

Sistema de solicitações de saúde da **Secretaria Municipal de Saúde de Cidade Ocidental (GO)**.

**Acesse:** https://agiliza-saude-5ab0e.web.app

## Para o cidadão
- Pedido de **consultas especializadas, exames, transporte para tratamento (TFD) e medicamentos** pela internet, com foto da guia e documentos.
- Cadastro e login com **CPF ou e-mail**.
- **Acompanhamento pelo CPF**: status do pedido e, quando marcado, o dia, o horário, o local e quem vai atender.
- **Minha Área**: histórico dos pedidos, novidades, cancelamento e atualização do telefone.
- Funciona no celular e pode ser instalado como aplicativo.

## Para a Secretaria de Saúde (Painel CRM e Central de Regulação)
- **Fila de espera** com a data do pedido, o tempo de espera em cores e uma **prioridade interna** (Urgente, Prioritário, Normal) que o cidadão não vê.
- **Atendimento presencial** na UBS para quem não tem internet, com comprovante impresso.
- **Cirurgia eletiva** com checklist do pré-operatório.
- **Ficha do paciente** com todos os pedidos, marcações e faltas.
- **Médicos e agendas**: cadastro por especialidade, dias e horários, férias e desativação sem perder os dados.
- **Marcação** escolhendo médico, dia e horário livre; **"Preencher com a fila"** encaixa os próximos da fila nas vagas; reagendar, liberar vaga e lista do dia para impressão.
- **Aviso pelo WhatsApp**, relatórios com gráficos e exportação para planilha.
- Controle de acesso da equipe por perfil: Atendente, Regulador e Administrador.

## Tecnologias
- **Site publicado** (`firebase/`): HTML, JavaScript e Bootstrap 5 com Firebase (Hosting, Authentication e Firestore).
- **Versão Java** (`java-mysql/`): Java com Servlets no padrão MVC, JDBC e MySQL 8.

Os dados de exemplo usados nos testes são fictícios.

Projeto Integrador — UNICEPLAC.
