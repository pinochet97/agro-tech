# GrãoCerto — Especificação da Versão Final

Documento-norte do produto. Use junto com o CLAUDE.md: este arquivo diz ONDE chegar;
o CLAUDE.md registra onde o projeto ESTÁ. Construa na ordem dos módulos — cada um
só começa quando o anterior tiver seu critério de "pronto" atingido.

Princípio do produto: o GrãoCerto responde UMA pergunta melhor que qualquer um —
"o que eu faço com o meu grão agora?" — na língua do produtor, no celular, em 30 segundos.
Toda feature que não servir a essa pergunta é candidata a corte.

---

## Módulo 1 — Decisão "Armazenar ou Vender" (núcleo)

O que já existe: calculadora com entradas manuais. A versão final precisa de:

**Dados automáticos**
- Cotações diárias CEPEA/Esalq (soja, milho, trigo) preenchendo o "preço hoje", com data da cotação visível e fallback manual quando a fonte falhar.
- Curva de futuros B3 por vencimento, sugerindo o "preço esperado" em vez de chute do usuário (usuário sempre pode sobrescrever).
- Basis regional: diferença histórica entre o preço da praça do produtor e o indicador nacional (começar com as principais praças de MT, GO, PR, RS; alimentar com dados informados pelos próprios usuários).
- Custos pré-preenchidos por perfil (silo próprio vs. terceiro, com tarifas médias regionais editáveis).

**Experiência**
- Cadastro de safra por lotes: o produtor raramente vende tudo de uma vez — permitir simular "vender 30% agora, segurar 70%".
- Cenários salvos e comparáveis lado a lado.
- Alerta de preço-alvo: "me avise quando a soja passar de R$ X na minha praça" (via WhatsApp/push).
- Histórico de decisões: o que o app recomendou, o que o produtor fez, quanto deu — isso vira o argumento de venda ("quem seguiu o GrãoCerto ganhou R$ X/saca a mais").
- Exportar simulação em PDF de 1 página (produtor mostra pro sócio, pro banco, pro consultor).

**Critério de pronto:** produtor cria conta, cadastra safra em 2 minutos, recebe recomendação com preço real do dia e compartilha o PDF — tudo pelo celular.

---

## Módulo 2 — Agente WhatsApp

O WhatsApp é onde o produtor vive; o site é secundário. O agente precisa de:

- Consulta rápida: "quanto tá a soja?" → cotação da praça dele, na hora.
- Simulação conversacional: o agente pergunta sacas, custo e horizonte, e devolve o veredito + preço de empate como o app faz.
- Áudio: produtor manda voz, agente transcreve e responde (texto ou voz).
- Alertas proativos de preço-alvo e de eventos relevantes (ex.: mudança brusca no futuro B3).
- Toda conversa vinculada à conta do usuário — o que ele faz no WhatsApp aparece no app e vice-versa.
- Tecnologia: API oficial do WhatsApp Business (via provedor tipo Meta Cloud API); LLM com as MESMAS funções de cálculo do app (nunca deixar o modelo "chutar" contas — ele chama o serviço de cálculo).

**Critério de pronto:** um produtor que nunca abriu o site consegue fazer a simulação completa só pelo WhatsApp.

---

## Módulo 3 — Marketplace de capacidade de silos (parceria MF Rural)

Só começar com a parceria formalizada OU como categoria independente se ela não sair.

- Anúncio de oferta: cerealista/cooperativa/produtor com espaço cadastra local, capacidade (t), tarifa (R$/saca/mês), serviços inclusos (secagem, limpeza), fotos e janela de disponibilidade.
- Busca por demanda: produtor busca por raio de distância, cultura e período; ranking por custo total (tarifa + frete estimado).
- Reserva com intenção firmada: proposta → aceite → contrato-padrão gerado automaticamente (modelo jurídico revisado por advogado — não improvisar).
- Pagamento garantido via gateway (MF Pago se parceria sair; senão, provedor próprio com escrow).
- Avaliações mútuas pós-contrato.
- Integração de frete (MF MOV ou cotação manual na v1).

**Critério de pronto:** primeira transação real de armazenagem fechada e paga pela plataforma.

---

## Módulo 4 — Predição de qualidade e deterioração (IA pesada)

Depende de dados de parceiros — só entra quando houver 2+ cerealistas/cooperativas fornecendo termometria.

- Ingestão de dados de termometria/umidade de silos (CSV/API dos sistemas existentes; não exigir hardware novo).
- Modelo de risco: probabilidade de bolsão quente, perda de peso projetada e risco de micotoxina por silo, com horizonte de 30/60/90 dias.
- Alertas operacionais: "airar o silo 3 esta semana", "priorizar embarque do lote X".
- Laudo de condição do lote: documento que agrega valor na venda (comprador paga mais por grão com histórico monitorado).
- O output alimenta o Módulo 1: a "perda técnica" deixa de ser estimativa e vira dado real do silo do usuário.

**Critério de pronto:** modelo com acurácia validada contra dados históricos de um parceiro e primeiro alerta que evitou perda real documentada.

---

## Módulo 5 — Dados e B2B (monetização final)

- Dashboard para cooperativas/cerealistas: visão agregada dos silos, ocupação, risco e fluxo de comercialização dos cooperados.
- API para bancos: score de comercialização do produtor (histórico de decisões, disciplina de venda, qualidade armazenada) para crédito rural.
- API para seguradoras: dados de condição de armazenagem para precificar seguro de grão armazenado.
- LGPD rigorosa: dado individual só sai com consentimento explícito e registrado do produtor; oferecer contrapartida clara (ex.: taxa melhor no banco parceiro).

**Critério de pronto:** primeiro contrato B2B assinado pagando por dados/API.

---

## Plataforma (transversal a tudo)

**Contas e acesso**
- Login por telefone + código SMS/WhatsApp (produtor não usa e-mail; senha é atrito).
- Perfis: produtor, consultor (vê múltiplos produtores — canal de distribuição via agrônomos), armazenador, admin.
- Multi-fazenda por conta.

**Monetização**
- Freemium: calculadora básica grátis (aquisição); Pro por assinatura (cotações automáticas, alertas, lotes, PDF, WhatsApp) — referência R$ 99–249/mês conforme porte; marketplace por comissão sobre transação; B2B por contrato.
- Cobrança recorrente com Pix e cartão (gateway tipo Stripe/Pagar.me/Asaas).

**Qualidade não-funcional**
- Mobile-first sempre; funcionar decente em 3G e aparelho modesto.
- Modo degradado offline: última cotação em cache com aviso de data.
- Interface 100% pt-BR, vocabulário de produtor (sacas, praça, basis, entressafra), números em padrão brasileiro.
- LGPD desde o dia 1: política de privacidade, consentimento, exclusão de conta, dados no Brasil ou com salvaguarda.
- Segurança: HTTPS, secrets fora do código, rate limiting nas APIs, backup diário do banco.
- Observabilidade: logs de erro (ex.: Sentry), monitoramento das fontes de cotação (alarme se CEPEA falhar), analytics de uso (quais telas, onde abandonam).
- Aviso legal permanente: ferramenta de apoio, não recomendação de investimento.

**Arquitetura de referência** (ajuste conforme o Claude Code sugerir, mas não complique antes da hora)
- Frontend: React/Vite (atual) → evoluir para Next.js se SEO importar; PWA para instalar no celular.
- Backend: Node/TypeScript (Fastify ou NestJS) ou Python (FastAPI) — um só serviço no começo, nada de microsserviço.
- Banco: PostgreSQL. Cache: Redis (cotações). Fila para alertas/ingestão (BullMQ ou similar).
- Serviço de cálculo isolado como biblioteca pura com testes — é o coração; WhatsApp, web e API consomem o MESMO código de cálculo.
- Deploy: Vercel (front) + Railway/Render/Fly (back) no início; repositório no GitHub com CI rodando testes a cada commit.

---

## Métricas que dizem se está funcionando

- Ativação: % de cadastros que completam a 1ª simulação (meta >60%).
- Retenção: % que volta na semana seguinte (meta >30% na fase de validação).
- WhatsApp: simulações completadas por conversa iniciada.
- Marketplace: anúncios ativos, taxa de match, GMV transacionado.
- Norte-estrela: R$/saca de vantagem capturada pelos usuários que seguiram a recomendação (documentar casos reais desde o primeiro piloto).

---

## Ordem de construção resumida

1. Módulo 1 completo (cotações → lotes → alertas → PDF) + deploy + contas.
2. Módulo 2 (WhatsApp) — antes do marketplace: é o que produtor mais usa e o que mais gera indicação.
3. Monetização (planos + cobrança) assim que houver 20+ usuários ativos pedindo mais.
4. Módulo 3 quando a parceria MF Rural definir (ou pivô para versão independente).
5. Módulo 4 quando houver parceiro de dados; Módulo 5 por último — ele nasce dos anteriores.

Regra de corte quando bater dúvida: o que aproxima a resposta de
"o que eu faço com o meu grão agora?" fica; o resto espera.
