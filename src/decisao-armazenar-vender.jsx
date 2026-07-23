import { useState, useMemo, useEffect, useCallback } from "react";
import { buscarCotacoes } from "./services/cotacoes";
import { REGIOES, defaultsDaRegiao, carregarPerfil, atualizarPerfil } from "./services/perfil";

// ─────────────────────────────────────────────────────────────
// GrãoCerto — MVP Fase 1: Armazenar ou Vender
// Ferramenta de decisão de comercialização para o médio produtor
// Paleta: campo claro #F2F4EF · tinta #1E2A22 · milho #C99B2F ·
//         soja #3E6B4F · alerta #A4432E
// ─────────────────────────────────────────────────────────────

const CULTURAS = {
  soja: { nome: "Soja", precoHoje: 125, precoEsperado: 138, kgSaca: 60 },
  milho: { nome: "Milho", precoHoje: 58, precoEsperado: 67, kgSaca: 60 },
  trigo: { nome: "Trigo", precoHoje: 72, precoEsperado: 79, kgSaca: 60 },
};

const fmtBRL = (v, dec = 0) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });

// "2026-07-23" → "23/07/2026" (sem depender de fuso horário)
const fmtData = (iso) => {
  if (!iso) return "";
  const [a, m, d] = String(iso).split("-");
  return d && m && a ? `${d}/${m}/${a}` : String(iso);
};

function Campo({ rotulo, sufixo, valor, onChange, passo = 1, min = 0, ajuda }) {
  return (
    <label style={st.campo}>
      <span style={st.campoRotulo}>{rotulo}</span>
      <span style={st.campoLinha}>
        <input
          type="number"
          value={valor}
          step={passo}
          min={min}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          style={st.campoInput}
        />
        {sufixo && <span style={st.campoSufixo}>{sufixo}</span>}
      </span>
      {ajuda && <span style={st.campoAjuda}>{ajuda}</span>}
    </label>
  );
}

export default function App() {
  // ── Perfil persistente do produtor ────────────────────────────
  // null = primeira visita → mostra o formulário de perfil antes da
  // primeira simulação. Depois, tudo nasce pré-preenchido dele.
  const [perfil, setPerfil] = useState(() => carregarPerfil());
  const [editandoPerfil, setEditandoPerfil] = useState(false);
  const [simSalva, setSimSalva] = useState(false);

  const culturaInicial = perfil?.culturaPrincipal || "soja";
  const [cultura, setCultura] = useState(culturaInicial);
  const [sacas, setSacas] = useState(perfil?.sacas ?? 10000);
  const [precoHoje, setPrecoHoje] = useState(CULTURAS[culturaInicial].precoHoje);
  const [precoEsperado, setPrecoEsperado] = useState(CULTURAS[culturaInicial].precoEsperado);
  const [meses, setMeses] = useState(perfil?.meses ?? 6);
  const [custoArmz, setCustoArmz] = useState(perfil?.custos?.armazenagem ?? 1.2); // R$/saca/mês
  const [jurosMes, setJurosMes] = useState(perfil?.custos?.jurosMes ?? 1.1); // % a.m.
  const [perdaMes, setPerdaMes] = useState(perfil?.custos?.perdaMes ?? 0.25); // % da massa/mês

  // ── Cotação automática (CEPEA/ESALQ) ──────────────────────────
  // cotacoes: mapa { soja: {...}, milho: {...} } | null
  // statusCot: "carregando" | "ok" | "erro"
  // precoEditado: o produtor mexeu no preço → não sobrescrever
  const [cotacoes, setCotacoes] = useState(null);
  const [statusCot, setStatusCot] = useState("carregando");
  const [precoEditado, setPrecoEditado] = useState(false);

  const carregarCotacoes = useCallback(async () => {
    setStatusCot("carregando");
    try {
      const dados = await buscarCotacoes();
      setCotacoes(dados);
      setStatusCot("ok");
      return dados;
    } catch {
      setStatusCot("erro"); // fonte indisponível → segue no manual
      return null;
    }
  }, []);

  // Busca uma vez ao abrir a tela.
  useEffect(() => {
    carregarCotacoes();
  }, [carregarCotacoes]);

  // Aplica a cotação ao "preço hoje" da cultura atual, desde que o
  // produtor ainda não tenha digitado um preço manualmente.
  useEffect(() => {
    if (precoEditado || !cotacoes) return;
    const cot = cotacoes[cultura];
    if (cot && typeof cot.preco === "number") setPrecoHoje(cot.preco);
  }, [cotacoes, cultura, precoEditado]);

  const cotacaoAtual = cotacoes?.[cultura] || null;

  const trocarCultura = (c) => {
    setCultura(c);
    const cot = cotacoes?.[c];
    setPrecoHoje(cot?.preco ?? CULTURAS[c].precoHoje);
    setPrecoEsperado(CULTURAS[c].precoEsperado);
    setPrecoEditado(false);
  };

  // Marca o preço como manual quando o produtor digita no campo.
  const editarPrecoHoje = (v) => {
    setPrecoHoje(v);
    setPrecoEditado(true);
  };

  // Botão "atualizar": rebusca e reaplica a cotação, descartando a edição manual.
  const reaplicarCotacao = async () => {
    const dados = await carregarCotacoes();
    if (dados?.[cultura]) {
      setPrecoHoje(dados[cultura].preco);
      setPrecoEditado(false);
    }
  };

  // Aplica o perfil (recém-salvo ou editado) aos campos da simulação.
  const aplicarPerfil = (p) => {
    setPerfil(p);
    setEditandoPerfil(false);
    setCultura(p.culturaPrincipal);
    const cot = cotacoes?.[p.culturaPrincipal];
    setPrecoHoje(cot?.preco ?? CULTURAS[p.culturaPrincipal].precoHoje);
    setPrecoEsperado(CULTURAS[p.culturaPrincipal].precoEsperado);
    setPrecoEditado(false);
    setCustoArmz(p.custos.armazenagem);
    setJurosMes(p.custos.jurosMes);
    setPerdaMes(p.custos.perdaMes);
    if (typeof p.sacas === "number") setSacas(p.sacas);
    if (typeof p.meses === "number") setMeses(p.meses);
  };

  const salvarPerfilDoForm = (dados) => aplicarPerfil(atualizarPerfil(dados));

  const r = useMemo(() => {
    const receitaAgora = precoHoje * sacas;

    const perdaTotal = 1 - Math.pow(1 - perdaMes / 100, meses);
    const sacasFinais = sacas * (1 - perdaTotal);
    const custoArmazenagem = custoArmz * meses * sacas;
    // custo de oportunidade: o dinheiro parado no grão deixa de render (ou paga juros de dívida)
    const custoCapital = receitaAgora * (Math.pow(1 + jurosMes / 100, meses) - 1);
    const receitaFutura = precoEsperado * sacasFinais - custoArmazenagem;
    const receitaFuturaLiquida = receitaFutura - custoCapital;

    const vantagemTotal = receitaFuturaLiquida - receitaAgora;
    const vantagemPorSaca = vantagemTotal / sacas;

    // preço de empate: quanto a saca precisa valer na entressafra para compensar
    const precoEmpate =
      (receitaAgora + custoArmazenagem + custoCapital) / sacasFinais;

    return {
      receitaAgora,
      receitaFuturaLiquida,
      custoArmazenagem,
      custoCapital,
      perdaTotal,
      sacasFinais,
      vantagemTotal,
      vantagemPorSaca,
      precoEmpate,
      armazenar: vantagemTotal > 0,
    };
  }, [sacas, precoHoje, precoEsperado, meses, custoArmz, jurosMes, perdaMes]);

  const margem = Math.abs(r.vantagemPorSaca);
  const decisaoFraca = margem < 2; // menos de R$2/saca de diferença = zona cinzenta

  // Cada simulação salva atualiza o perfil: cultura, volume, horizonte e
  // custos viram o novo pré-preenchimento da próxima visita.
  const salvarSimulacao = () => {
    const novo = atualizarPerfil({
      culturaPrincipal: cultura,
      sacas,
      meses,
      custos: { armazenagem: custoArmz, jurosMes, perdaMes },
      ultimaSimulacao: {
        cultura,
        sacas,
        meses,
        precoHoje,
        precoEsperado,
        vantagemPorSaca: r.vantagemPorSaca,
        veredito: r.armazenar ? "armazenar" : "vender",
      },
    });
    setPerfil(novo);
    setSimSalva(true);
    setTimeout(() => setSimSalva(false), 2500);
  };

  return (
    <div style={st.pagina}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&family=IBM+Plex+Mono:wght@400;600&display=swap');
        * { box-sizing: border-box; }
        input:focus, button:focus-visible, select:focus { outline: 2px solid #C99B2F; outline-offset: 2px; }
        input[type=range] { accent-color: #C99B2F; }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
      `}</style>

      {/* Cabeçalho */}
      <header style={st.topo}>
        <div style={st.marca}>
          GRÃO<span style={{ color: "#C99B2F" }}>CERTO</span>
        </div>
        <div style={st.marcaSub}>decisão de comercialização · protótipo fase 1</div>
      </header>

      {perfil && !editandoPerfil && (
        <div style={st.perfilBar}>
          <span style={st.perfilBarTexto}>
            {REGIOES[perfil.regiao]?.nome || perfil.regiao}
            {perfil.capacidadeSacas > 0
              ? ` · capacidade ${fmtBRL(perfil.capacidadeSacas)} sacas`
              : ""}
          </span>
          <button type="button" style={st.perfilBarBtn} onClick={() => setEditandoPerfil(true)}>
            Editar perfil
          </button>
        </div>
      )}

      {!perfil || editandoPerfil ? (
        <main style={st.gradeUnica}>
          <FormPerfil
            inicial={perfil}
            onSalvar={salvarPerfilDoForm}
            onCancelar={perfil ? () => setEditandoPerfil(false) : null}
          />
        </main>
      ) : (
      <main style={st.grade}>
        {/* Coluna de entrada */}
        <section style={st.painel}>
          <h2 style={st.tituloSecao}>Sua safra</h2>

          <div style={st.abas} role="tablist" aria-label="Cultura">
            {Object.entries(CULTURAS).map(([k, c]) => (
              <button
                key={k}
                role="tab"
                aria-selected={cultura === k}
                onClick={() => trocarCultura(k)}
                style={{
                  ...st.aba,
                  ...(cultura === k ? st.abaAtiva : {}),
                }}
              >
                {c.nome}
              </button>
            ))}
          </div>

          <Campo rotulo="Quantidade" sufixo="sacas" valor={sacas} onChange={setSacas} passo={500} />
          {perfil?.capacidadeSacas > 0 && sacas > perfil.capacidadeSacas && (
            <div style={st.capacidadeAviso}>
              Acima da sua capacidade de armazenagem ({fmtBRL(perfil.capacidadeSacas)} sacas) —
              o excedente precisaria de armazém de terceiro.
            </div>
          )}
          <Campo
            rotulo="Preço hoje na sua região"
            sufixo="R$/saca"
            valor={precoHoje}
            onChange={editarPrecoHoje}
            passo={0.5}
            ajuda="Preço balcão que você conseguiria vendendo esta semana"
          />

          <div style={st.cotacao}>
            {statusCot === "carregando" && (
              <span style={st.cotacaoInfo}>Buscando cotação…</span>
            )}
            {statusCot === "ok" && cotacaoAtual && (
              <span style={st.cotacaoInfo}>
                <span style={st.cotacaoPonto} aria-hidden="true" />
                {cotacaoAtual.praca || "Indicador"}: R$ {fmtBRL(cotacaoAtual.preco, 2)}
                {cotacaoAtual.data ? ` · ${fmtData(cotacaoAtual.data)}` : ""}
                {cotacaoAtual.referencia ? " · referência" : ""}
                {precoEditado ? " · ajustado por você" : ""}
              </span>
            )}
            {statusCot === "ok" && !cotacaoAtual && (
              <span style={st.cotacaoInfo}>
                Sem cotação automática para {CULTURAS[cultura].nome} — informe manualmente.
              </span>
            )}
            {statusCot === "erro" && (
              <span style={st.cotacaoErro}>
                Cotação automática indisponível — informe o preço manualmente.
              </span>
            )}
            <button
              type="button"
              onClick={reaplicarCotacao}
              disabled={statusCot === "carregando"}
              style={st.cotacaoBtn}
            >
              {statusCot === "carregando" ? "…" : "Atualizar"}
            </button>
          </div>
          <Campo
            rotulo="Quanto tempo pretende segurar"
            sufixo="meses"
            valor={meses}
            onChange={setMeses}
            passo={1}
            min={1}
          />

          <h2 style={{ ...st.tituloSecao, marginTop: 28 }}>Custos de segurar o grão</h2>
          <Campo
            rotulo="Armazenagem"
            sufixo="R$/saca/mês"
            valor={custoArmz}
            onChange={setCustoArmz}
            passo={0.1}
            ajuda="Silo próprio: energia + manutenção. Terceiro: tarifa cobrada"
          />
          <Campo
            rotulo="Custo do dinheiro"
            sufixo="% a.m."
            valor={jurosMes}
            onChange={setJurosMes}
            passo={0.1}
            ajuda="Juros da sua dívida — ou quanto o dinheiro renderia aplicado"
          />
          <Campo
            rotulo="Perda técnica estimada"
            sufixo="% ao mês"
            valor={perdaMes}
            onChange={setPerdaMes}
            passo={0.05}
            ajuda="Quebra de peso, pragas e deterioração no armazém"
          />
        </section>

        {/* Coluna de resultado */}
        <section style={st.colResultado}>
          {/* Ticket de decisão — assinatura visual */}
          <div
            style={{
              ...st.ticket,
              borderColor: r.armazenar ? "#3E6B4F" : "#A4432E",
            }}
          >
            <div style={st.ticketFuro} aria-hidden="true" />
            <div style={st.ticketEyebrow}>ROMANEIO DE DECISÃO</div>
            <div
              style={{
                ...st.ticketVeredito,
                color: r.armazenar ? "#3E6B4F" : "#A4432E",
              }}
            >
              {r.armazenar ? "ARMAZENAR" : "VENDER AGORA"}
            </div>
            {decisaoFraca && (
              <div style={st.ticketAviso}>
                Diferença menor que R$ 2/saca — zona de empate. Qualquer variação de preço muda a conta.
              </div>
            )}
            <div style={st.ticketDelta}>
              <span style={st.ticketDeltaNum}>
                {r.vantagemPorSaca >= 0 ? "+" : "−"} R$ {fmtBRL(margem, 2)}
              </span>
              <span style={st.ticketDeltaRotulo}>por saca {r.armazenar ? "segurando" : "vendendo já"}</span>
            </div>
            <div style={st.ticketTotal}>
              {r.vantagemTotal >= 0 ? "+" : "−"} R$ {fmtBRL(Math.abs(r.vantagemTotal))} no total
            </div>
            <div style={st.ticketRodape}>
              {CULTURAS[cultura].nome} · {fmtBRL(sacas)} sacas · horizonte {meses} {meses === 1 ? "mês" : "meses"}
            </div>
          </div>

          <div style={st.salvarLinha}>
            <button type="button" style={st.btnSalvarSim} onClick={salvarSimulacao}>
              Salvar simulação
            </button>
            {simSalva && <span style={st.salvoFeedback}>✓ salva — seu perfil foi atualizado</span>}
          </div>

          {/* Simulador de preço esperado */}
          <div style={st.painel}>
            <h2 style={st.tituloSecao}>E se o preço na entressafra for…</h2>
            <div style={st.sliderLinha}>
              <span style={st.sliderNum}>R$ {fmtBRL(precoEsperado, 2)}</span>
              <span style={st.sliderRotulo}>/saca esperado em {meses} {meses === 1 ? "mês" : "meses"}</span>
            </div>
            <input
              type="range"
              min={Math.max(1, precoHoje * 0.8)}
              max={precoHoje * 1.35}
              step={0.5}
              value={precoEsperado}
              onChange={(e) => setPrecoEsperado(parseFloat(e.target.value))}
              style={{ width: "100%" }}
              aria-label="Preço esperado por saca"
            />
            <div style={st.empate}>
              <span style={st.empateRotulo}>Preço de empate</span>
              <span style={st.empateNum}>R$ {fmtBRL(r.precoEmpate, 2)}/saca</span>
              <span style={st.empateExpl}>
                Acima disso, segurar compensa. Abaixo, vender agora ganha.
              </span>
            </div>
          </div>

          {/* Composição da conta */}
          <div style={st.painel}>
            <h2 style={st.tituloSecao}>A conta, aberta</h2>
            <Linha rotulo="Vendendo hoje" valor={r.receitaAgora} forte />
            <Linha
              rotulo={`Vendendo em ${meses} ${meses === 1 ? "mês" : "meses"} (líquido)`}
              valor={r.receitaFuturaLiquida}
              forte
            />
            <div style={st.divisor} />
            <Linha rotulo="Custo de armazenagem" valor={-r.custoArmazenagem} />
            <Linha rotulo="Custo do dinheiro parado" valor={-r.custoCapital} />
            <Linha
              rotulo={`Perda técnica (${(r.perdaTotal * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% ≈ ${fmtBRL(sacas - r.sacasFinais)} sacas)`}
              valor={-(sacas - r.sacasFinais) * precoEsperado}
            />
          </div>

          <p style={st.aviso}>
            Protótipo para validação. O preço pode ser informado manualmente ou puxado da
            cotação de referência — a versão de produção usará cotações CEPEA/B3 e clima em
            tempo real. Indicadores: CEPEA/ESALQ (CC BY-NC 4.0). Não é recomendação de investimento.
          </p>
        </section>
      </main>
      )}
    </div>
  );
}

function Linha({ rotulo, valor, forte }) {
  return (
    <div style={st.linha}>
      <span style={{ ...st.linhaRotulo, fontWeight: forte ? 600 : 400 }}>{rotulo}</span>
      <span
        style={{
          ...st.linhaValor,
          fontWeight: forte ? 600 : 400,
          color: valor < 0 ? "#A4432E" : "#1E2A22",
        }}
      >
        {valor < 0 ? "− " : ""}R$ {fmtBRL(Math.abs(valor))}
      </span>
    </div>
  );
}

// Formulário do perfil do produtor: primeira visita (onboarding) e edição.
// Trocar a região sugere os custos regionais de referência — sempre editáveis.
function FormPerfil({ inicial, onSalvar, onCancelar }) {
  const [regiao, setRegiao] = useState(inicial?.regiao || "MT");
  const [culturaPrincipal, setCulturaPrincipal] = useState(inicial?.culturaPrincipal || "soja");
  const [capacidade, setCapacidade] = useState(inicial?.capacidadeSacas ?? 0);
  const [custos, setCustos] = useState(
    inicial?.custos || defaultsDaRegiao(inicial?.regiao || "MT"),
  );

  const trocarRegiao = (rg) => {
    setRegiao(rg);
    setCustos(defaultsDaRegiao(rg)); // sugere os defaults da região; o produtor ajusta
  };

  const setCusto = (campo) => (v) => setCustos((c) => ({ ...c, [campo]: v }));

  return (
    <section style={{ ...st.painel, maxWidth: 480, margin: "0 auto" }}>
      <h2 style={st.tituloSecao}>
        {inicial ? "Seu perfil" : "Antes da primeira simulação"}
      </h2>
      {!inicial && (
        <p style={st.formIntro}>
          Conta rapidinho como é sua operação. Nas próximas visitas tudo já vem
          preenchido — você só ajusta o que mudou.
        </p>
      )}

      <label style={st.campo}>
        <span style={st.campoRotulo}>Sua região</span>
        <select value={regiao} onChange={(e) => trocarRegiao(e.target.value)} style={st.select}>
          {Object.entries(REGIOES).map(([k, rg]) => (
            <option key={k} value={k}>
              {rg.nome}
            </option>
          ))}
        </select>
        <span style={st.campoAjuda}>Usada para sugerir custos típicos da sua praça</span>
      </label>

      <label style={st.campo}>
        <span style={st.campoRotulo}>Cultura principal</span>
        <select
          value={culturaPrincipal}
          onChange={(e) => setCulturaPrincipal(e.target.value)}
          style={st.select}
        >
          {Object.entries(CULTURAS).map(([k, c]) => (
            <option key={k} value={k}>
              {c.nome}
            </option>
          ))}
        </select>
      </label>

      <Campo
        rotulo="Capacidade de armazenagem"
        sufixo="sacas"
        valor={capacidade}
        onChange={setCapacidade}
        passo={1000}
        ajuda="Silo próprio ou espaço contratado. Deixe 0 se não tiver"
      />

      <h2 style={{ ...st.tituloSecao, marginTop: 24 }}>Seus custos de armazenagem</h2>
      <p style={st.formIntro}>
        Sugeridos para {REGIOES[regiao].nome} — ajuste se o seu número for outro.
      </p>
      <Campo
        rotulo="Armazenagem"
        sufixo="R$/saca/mês"
        valor={custos.armazenagem}
        onChange={setCusto("armazenagem")}
        passo={0.1}
      />
      <Campo
        rotulo="Custo do dinheiro"
        sufixo="% a.m."
        valor={custos.jurosMes}
        onChange={setCusto("jurosMes")}
        passo={0.1}
      />
      <Campo
        rotulo="Perda técnica estimada"
        sufixo="% ao mês"
        valor={custos.perdaMes}
        onChange={setCusto("perdaMes")}
        passo={0.05}
      />

      <div style={st.formAcoes}>
        <button
          type="button"
          style={st.btnPrimario}
          onClick={() =>
            onSalvar({ regiao, culturaPrincipal, capacidadeSacas: capacidade, custos })
          }
        >
          {inicial ? "Salvar perfil" : "Salvar e simular"}
        </button>
        {onCancelar && (
          <button type="button" style={st.btnSecundario} onClick={onCancelar}>
            Cancelar
          </button>
        )}
      </div>
    </section>
  );
}

// ── Estilos ──────────────────────────────────────────────────
const st = {
  pagina: {
    minHeight: "100vh",
    background: "#F2F4EF",
    color: "#1E2A22",
    fontFamily: "'Archivo', system-ui, sans-serif",
    padding: "0 16px 48px",
  },
  topo: {
    maxWidth: 980,
    margin: "0 auto",
    padding: "28px 0 20px",
    borderBottom: "2px solid #1E2A22",
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
  },
  marca: {
    fontSize: 26,
    fontWeight: 800,
    letterSpacing: "0.02em",
    fontStretch: "115%",
  },
  marcaSub: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: "#5A6B5D",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  grade: {
    maxWidth: 980,
    margin: "24px auto 0",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: 20,
    alignItems: "start",
  },
  painel: {
    background: "#FFFFFF",
    border: "1px solid #D8DED2",
    borderRadius: 10,
    padding: "20px 20px 12px",
    marginBottom: 20,
  },
  tituloSecao: {
    margin: "0 0 14px",
    fontSize: 13,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.09em",
    color: "#5A6B5D",
  },
  abas: { display: "flex", gap: 8, marginBottom: 18 },
  aba: {
    flex: 1,
    padding: "10px 0",
    border: "1px solid #D8DED2",
    borderRadius: 8,
    background: "#F7F8F4",
    fontFamily: "'Archivo', sans-serif",
    fontWeight: 600,
    fontSize: 14,
    color: "#5A6B5D",
    cursor: "pointer",
    transition: "all .15s",
  },
  abaAtiva: {
    background: "#1E2A22",
    color: "#F2F4EF",
    border: "1px solid #1E2A22",
  },
  campo: { display: "block", marginBottom: 16 },
  campoRotulo: { display: "block", fontSize: 14, fontWeight: 600, marginBottom: 6 },
  campoLinha: { display: "flex", alignItems: "center", gap: 8 },
  campoInput: {
    flex: 1,
    minWidth: 0,
    padding: "10px 12px",
    fontSize: 17,
    fontFamily: "'IBM Plex Mono', monospace",
    border: "1px solid #C6CFBF",
    borderRadius: 8,
    background: "#FDFDFB",
    color: "#1E2A22",
  },
  campoSufixo: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: "#5A6B5D",
    whiteSpace: "nowrap",
  },
  campoAjuda: { display: "block", fontSize: 12, color: "#7A897C", marginTop: 4 },
  cotacao: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    margin: "-8px 0 16px",
    flexWrap: "wrap",
  },
  cotacaoInfo: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: "#3E6B4F",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  },
  cotacaoPonto: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "#3E6B4F",
    flexShrink: 0,
  },
  cotacaoErro: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: "#A4432E",
  },
  cotacaoBtn: {
    border: "1px solid #C6CFBF",
    background: "#F7F8F4",
    color: "#3E6B4F",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    fontWeight: 600,
    padding: "4px 10px",
    borderRadius: 6,
    cursor: "pointer",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    whiteSpace: "nowrap",
  },
  gradeUnica: { maxWidth: 980, margin: "24px auto 0" },
  perfilBar: {
    maxWidth: 980,
    margin: "12px auto 0",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  },
  perfilBarTexto: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: "#5A6B5D",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  perfilBarBtn: {
    border: "1px solid #C6CFBF",
    background: "#F7F8F4",
    color: "#3E6B4F",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    fontWeight: 600,
    padding: "4px 10px",
    borderRadius: 6,
    cursor: "pointer",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  capacidadeAviso: {
    margin: "-8px 0 16px",
    padding: "8px 12px",
    background: "#FBF3DC",
    border: "1px solid #E4D296",
    borderRadius: 8,
    fontSize: 12,
    color: "#6E5A17",
  },
  salvarLinha: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
    flexWrap: "wrap",
  },
  btnSalvarSim: {
    border: "none",
    background: "#1E2A22",
    color: "#F2F4EF",
    fontFamily: "'Archivo', sans-serif",
    fontWeight: 700,
    fontSize: 14,
    padding: "10px 18px",
    borderRadius: 8,
    cursor: "pointer",
  },
  salvoFeedback: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: "#3E6B4F",
  },
  formIntro: {
    margin: "0 0 16px",
    fontSize: 13,
    color: "#5A6B5D",
    lineHeight: 1.5,
  },
  select: {
    width: "100%",
    padding: "10px 12px",
    fontSize: 16,
    fontFamily: "'Archivo', sans-serif",
    border: "1px solid #C6CFBF",
    borderRadius: 8,
    background: "#FDFDFB",
    color: "#1E2A22",
  },
  formAcoes: {
    display: "flex",
    gap: 10,
    marginTop: 8,
    marginBottom: 8,
    flexWrap: "wrap",
  },
  btnPrimario: {
    border: "none",
    background: "#1E2A22",
    color: "#F2F4EF",
    fontFamily: "'Archivo', sans-serif",
    fontWeight: 700,
    fontSize: 15,
    padding: "12px 22px",
    borderRadius: 8,
    cursor: "pointer",
  },
  btnSecundario: {
    border: "1px solid #C6CFBF",
    background: "#F7F8F4",
    color: "#3B473D",
    fontFamily: "'Archivo', sans-serif",
    fontWeight: 600,
    fontSize: 15,
    padding: "12px 18px",
    borderRadius: 8,
    cursor: "pointer",
  },
  colResultado: {},
  ticket: {
    position: "relative",
    background: "#FFFDF6",
    borderWidth: 2,
    borderStyle: "solid",
    borderRadius: 12,
    padding: "26px 24px 20px",
    marginBottom: 20,
    boxShadow: "0 2px 0 rgba(30,42,34,.12)",
  },
  ticketFuro: {
    position: "absolute",
    top: 16,
    right: 20,
    width: 14,
    height: 14,
    borderRadius: "50%",
    background: "#F2F4EF",
    border: "2px solid #D8DED2",
  },
  ticketEyebrow: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    letterSpacing: "0.14em",
    color: "#8A947F",
    marginBottom: 8,
  },
  ticketVeredito: {
    fontSize: "clamp(34px, 7vw, 52px)",
    fontWeight: 800,
    lineHeight: 1,
    letterSpacing: "-0.01em",
    fontStretch: "110%",
  },
  ticketAviso: {
    marginTop: 10,
    padding: "8px 12px",
    background: "#FBF3DC",
    border: "1px solid #E4D296",
    borderRadius: 8,
    fontSize: 13,
    color: "#6E5A17",
  },
  ticketDelta: { marginTop: 18, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" },
  ticketDeltaNum: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 30,
    fontWeight: 600,
  },
  ticketDeltaRotulo: { fontSize: 14, color: "#5A6B5D" },
  ticketTotal: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 15,
    marginTop: 4,
    color: "#3B473D",
  },
  ticketRodape: {
    marginTop: 16,
    paddingTop: 12,
    borderTop: "1px dashed #C6CFBF",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: "#8A947F",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  sliderLinha: { display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10, flexWrap: "wrap" },
  sliderNum: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 26, fontWeight: 600 },
  sliderRotulo: { fontSize: 13, color: "#5A6B5D" },
  empate: {
    marginTop: 16,
    marginBottom: 8,
    padding: "12px 14px",
    background: "#F4F0E3",
    borderLeft: "4px solid #C99B2F",
    borderRadius: "0 8px 8px 0",
  },
  empateRotulo: {
    display: "block",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: "#8A7A45",
    fontWeight: 700,
  },
  empateNum: {
    display: "block",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 22,
    fontWeight: 600,
    margin: "2px 0",
  },
  empateExpl: { display: "block", fontSize: 12, color: "#7A6E45" },
  linha: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    padding: "7px 0",
    fontSize: 14,
  },
  linhaRotulo: { color: "#3B473D" },
  linhaValor: { fontFamily: "'IBM Plex Mono', monospace", whiteSpace: "nowrap" },
  divisor: { borderTop: "1px dashed #C6CFBF", margin: "8px 0" },
  aviso: {
    fontSize: 12,
    color: "#7A897C",
    lineHeight: 1.5,
    maxWidth: 560,
  },
};
