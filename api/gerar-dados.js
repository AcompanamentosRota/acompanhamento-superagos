// ======================================================
// GERA OS DADOS DO PAINEL (js/dados.js) A PARTIR DO SAP
// ======================================================
// Uso (dentro da pasta api):   node gerar-dados.js
// É o script que o robô roda de hora em hora.
//
// Fontes:
//   - dados/metas.json  -> PVs com acordo e metas do mês (tela de admin)
//   - SAP Base Clientes -> nome, segmento, gerência, supervisão, rota,
//                          cidade e código da rede de cada PV
//   - SAP Mov. Venda    -> nome da rede
//   - SAP Análise Metas -> REAL (Basis) e ONLINE (WF Online)  - ver sap.js
//
// Resultado: js/dados.js reescrito por completo. Basta abrir/atualizar
// o index.html.
//
// Também pode ser chamado pela API (server.js) logo depois que o
// admin salva as metas: por isso exporta a função gerarDados().

const fs = require("fs");
const path = require("path");

const {
    buscarRealizadoSAP,
    buscarCadastroSAP,
    buscarNomesRedesSAP
} = require("./sap");

const { CATEGORIAS, rotuloMes, lerMetas } = require("./metas");

// Arquivo de dados lido pelo painel
const ARQUIVO_DADOS = path.join(__dirname, "..", "js", "dados.js");

// De/para: categoria da API (SAP) -> chave usada no painel
const CATEGORIA_SAP = {
    refri: "REFRIGERANTES",
    cerv: "CERVEJAS",
    sucos: "SUCOS",
    pw: "POWERADE",
    dest: "DESTILADOS"
};

// Código de rede do SAP que significa "sem rede"
const SEM_REDE_SAP = "99999";

// Cabeçalho gravado no topo do js/dados.js
const CABECALHO = `/* =====================================================================
   Acompanhamento Super Agos - Dados do painel
   ---------------------------------------------------------------------
   ARQUIVO GERADO AUTOMATICAMENTE por api/gerar-dados.js. Não editar à mão:
   para mudar PVs ou metas use a tela de admin (admin.html).

   Estrutura de DATA:
     mesMeta   -> mês de referência da meta (ex.: "Nov/26")
     mesReal   -> mês de referência do realizado
     realAsOf  -> data/hora da consulta do realizado no SAP
     geradoEm  -> data/hora em que este arquivo foi gerado
     cols      -> lista dos campos de cada linha (apenas documentação)
     rows      -> um objeto por cliente com acordo fechado:
       cod, nome, seg (segmento), cidade
       redeCod, rede, redeKey  -> rede do cliente ("Indeterminado"/9999 = sem rede)
       ger, sup, rota          -> gerência, supervisão e rota
       meta / real / online    -> volume por categoria:
                                  refri, cerv, sucos, pw (Powerade), dest (destilados)
                                  meta   = meta do acordo (tela de admin)
                                  real   = faturado no mês (Basis)
                                  online = venda do dia ainda não faturada (WF Online)

   Obs.: é um arquivo .js (e não .json) para funcionar abrindo o
   index.html direto do disco (file://), sem servidor.
   ===================================================================== */
`;


// ------------------------------------------------------
// Lê o js/dados.js atual (se existir) para reaproveitar o cadastro
// de PVs que, por algum motivo, não vierem da Base Clientes.
// Retorna Map  cod (texto) -> linha antiga
// ------------------------------------------------------
function lerCadastroAnterior() {

    try {

        const conteudo = fs.readFileSync(ARQUIVO_DADOS, "utf8");

        const marcador = "var DATA = ";

        const json = conteudo
            .slice(conteudo.indexOf(marcador) + marcador.length)
            .trim()
            .replace(/;$/, "");

        const DATA = JSON.parse(json);

        return new Map(DATA.rows.map(r => [String(r.cod), r]));

    } catch (erro) {

        // Arquivo inexistente ou em formato antigo: segue sem ele
        return new Map();
    }
}


// ------------------------------------------------------
// Converte as categorias do SAP para o formato do painel,
// arredondando em 3 casas (o painel exibe 1 casa)
// ------------------------------------------------------
function converterCategorias(valoresSAP) {

    const resultado = {};

    for (const cat of CATEGORIAS) {

        const valor = valoresSAP ? valoresSAP[CATEGORIA_SAP[cat]] : 0;

        resultado[cat] = Math.round((valor || 0) * 1000) / 1000;
    }

    return resultado;
}


// ------------------------------------------------------
// Monta o cadastro do PV no formato do painel.
// Prioridade: Base Clientes do SAP; se o PV não estiver lá,
// usa o cadastro anterior; senão, marca como não encontrado.
// ------------------------------------------------------
function montarCadastro(pv, sap, nomesRedes, anterior) {

    if (sap) {

        let redeCod = String(sap.OM01_KEYACCNUM || "");
        let rede;

        if (!redeCod || redeCod === SEM_REDE_SAP) {

            // Sem rede: mesmo padrão do painel original
            redeCod = "9999";
            rede = "Indeterminado";

        } else {

            // Nome da rede: modelo de vendas; se a rede não teve venda
            // nos últimos meses, tenta o nome usado antes no painel
            rede =
                nomesRedes.get(redeCod) ||
                (anterior && anterior.redeCod === redeCod ? anterior.rede : null) ||
                `Rede ${redeCod}`;
        }

        return {
            cod: Number(pv),
            nome: sap.NM_NOME_FANTASIA || `PV ${pv}`,
            seg: sap.DS_SEGMENTO || "",
            redeCod,
            rede,
            redeKey: `${rede} ${redeCod}`,
            ger: sap.DS_GERENCIA_COMERCIAL_ATUAL || "",
            sup: sap.DS_SUPERVISOR_ATUAL || "",
            rota: sap.CD_ROTA_ATUAL || "",
            cidade: sap.NM_CIDADE || ""
        };
    }

    if (anterior) {

        // Copia só os campos de cadastro da linha antiga
        const { cod, nome, seg, redeCod, rede, redeKey, ger, sup, rota, cidade } = anterior;

        return { cod, nome, seg, redeCod, rede, redeKey, ger, sup, rota, cidade };
    }

    return {
        cod: Number(pv),
        nome: `PV ${pv} (não encontrado no SAP)`,
        seg: "",
        redeCod: "9999",
        rede: "Indeterminado",
        redeKey: "Indeterminado 9999",
        ger: "",
        sup: "",
        rota: "",
        cidade: ""
    };
}


// ------------------------------------------------------
// Data/hora no padrão exibido no painel: "12/11/2026 às 16:30"
// ------------------------------------------------------
function dataHoraPainel(data) {

    const dia = data.toLocaleDateString("pt-BR");

    const hora = data.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit"
    });

    return `${dia} às ${hora}`;
}


// ------------------------------------------------------
// Gera o js/dados.js. Retorna um resumo do processamento.
// ------------------------------------------------------
async function gerarDados() {

    const metas = lerMetas();

    const pvs = metas.clientes.map(c => String(c.pv));

    const anteriores = lerCadastroAnterior();

    // Momento da consulta = "Real atualizado até"
    const momentoConsulta = new Date();

    // As três consultas ao SAP são independentes: rodam em paralelo
    const [realizado, cadastro, nomesRedes] = await Promise.all([
        buscarRealizadoSAP(),
        buscarCadastroSAP(pvs),
        buscarNomesRedesSAP()
    ]);

    // Índice PV -> {REAL, ONLINE}
    const realizadoPorPV = new Map(
        realizado.dados.map(item => [item.PV, item])
    );


    let comVenda = 0;
    let comOnline = 0;
    const naoEncontrados = [];

    const rows = metas.clientes.map(cliente => {

        const pv = String(cliente.pv);

        const sap = realizadoPorPV.get(pv);

        if (!cadastro.has(pv)) naoEncontrados.push(pv);

        const linha = {
            ...montarCadastro(pv, cadastro.get(pv), nomesRedes, anteriores.get(pv)),

            // Meta vem do admin; real/online do SAP (sem venda = zero)
            meta: { ...cliente.meta },
            real: converterCategorias(sap && sap.REAL),
            online: converterCategorias(sap && sap.ONLINE)
        };

        if (sap) comVenda++;

        if (Object.values(linha.online).some(v => v > 0)) comOnline++;

        return linha;
    });


    // Mês do realizado: "202611" -> "2026-11" -> "Nov/26"
    const anoMesReal =
        `${realizado.referencia.anoMes.slice(0, 4)}-${realizado.referencia.anoMes.slice(4)}`;

    const DATA = {
        mesMeta: rotuloMes(metas.mes),
        mesReal: rotuloMes(anoMesReal),
        realAsOf: dataHoraPainel(momentoConsulta),
        geradoEm: dataHoraPainel(new Date()),
        cols: ["cod", "nome", "seg", "redeCod", "rede", "redeKey",
               "ger", "sup", "rota", "cidade", "meta", "real", "online"],
        rows
    };

    fs.writeFileSync(
        ARQUIVO_DADOS,
        CABECALHO + "var DATA = " + JSON.stringify(DATA) + ";\n"
    );


    const resumo = {
        clientes: rows.length,
        comVenda,
        comOnline,
        naoEncontradosNoCadastro: naoEncontrados,
        mesMeta: DATA.mesMeta,
        mesReal: DATA.mesReal,
        realAsOf: DATA.realAsOf
    };

    console.log("");
    console.log("========================================");
    console.log("js/dados.js ATUALIZADO");
    console.log(`Clientes no painel: ${resumo.clientes}`);
    console.log(`Com venda no mês: ${comVenda}`);
    console.log(`Com venda online hoje: ${comOnline}`);
    console.log(`Meta: ${DATA.mesMeta} | Real: ${DATA.mesReal}`);
    console.log(`Real atualizado até: ${DATA.realAsOf}`);

    if (naoEncontrados.length) {
        console.log(`PVs fora da Base Clientes: ${naoEncontrados.join(", ")}`);
    }

    // Aviso: metas de um mês e realizado de outro (ex.: virada do mês
    // antes de o admin subir as metas novas)
    if (DATA.mesMeta !== DATA.mesReal) {
        console.log("ATENÇÃO: o mês da meta é diferente do mês do realizado.");
    }

    console.log("========================================");

    return resumo;
}


module.exports = { gerarDados };


// Executado direto pelo terminal/robô (node gerar-dados.js)
if (require.main === module) {

    gerarDados().catch(error => {

        console.error("");
        console.error("ERRO AO GERAR OS DADOS");
        console.error(error.response?.data || error.message);

        // Código de saída diferente de zero: o robô entende como falha
        process.exitCode = 1;
    });
}
