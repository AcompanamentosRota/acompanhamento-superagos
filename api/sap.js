// ======================================================
// CONSULTA DO REALIZADO NO SAP DATASPHERE
// ======================================================
// Lógica compartilhada por:
//   - server.js       (API /api/superagos)
//   - gerar-dados.js  (grava os números no js/dados.js do painel)
//
// Modelo "Análise Metas v2". É o modelo que reproduz o realizado
// do relatório do B.O. "Base volume SuperAgos" (validado em 30/10/2026:
// 99,2% dos pares cliente x categoria iguais; o restante era horário).

const path = require("path");
const axios = require("axios");

// Carrega o .env da pasta api, de onde quer que o script seja chamado
require("dotenv").config({
    path: path.join(__dirname, ".env"),
    quiet: true
});


// ======================================================
// CONFIGURAÇÕES DO DATASPHERE
// ======================================================

const SPACE = "DW_BND_COM_SAP";
const MODEL = "AM_FAT_BND_ANALISE_META";

// URL base de consulta analítica de um modelo do espaço
function urlBaseModelo(modelo) {
    return (
        `${process.env.SAP_DATASPHERE_URL}` +
        `/api/v1/datasphere/consumption/analytical/` +
        `${SPACE}/${modelo}/`
    );
}

// URL base do modelo do realizado
const URL_MODELO = urlBaseModelo(MODEL);

// Modelos usados para o cadastro dos clientes:
//   Base Clientes -> nome, segmento, gerência, supervisão, rota, cidade, código da rede
//   Mov. Venda    -> nome da rede (DS_KEY_ACCOUNT), que não existe na Base Clientes
const MODEL_CLIENTES = "AM_BND_BASE_CLIENTE";
const MODEL_VENDA = "AM_FAT_BND_MOV_VENDA";


// ======================================================
// OBTÉM TOKEN DO SAP
// ======================================================

async function obterTokenSAP() {
    try {

        const response = await axios.post(
            process.env.SAP_TOKEN_URL,
            null,
            {
                params: {
                    grant_type: "client_credentials"
                },

                auth: {
                    username: process.env.SAP_CLIENT_ID,
                    password: process.env.SAP_CLIENT_SECRET
                }
            }
        );

        return response.data.access_token;

    } catch (error) {

        console.error(
            "Erro ao obter token:",
            error.response?.data || error.message
        );

        throw new Error("Não foi possível autenticar no SAP.");
    }
}


// ======================================================
// DATAS DA CONSULTA
// ======================================================
// anoMes: mês de referência no formato do modelo (ex.: "202610")
// hoje:   data de hoje no formato OData (ex.: 2026-10-30)

function obterDatasConsulta() {

    const agora = new Date();

    const ano = agora.getFullYear();

    const mes = String(
        agora.getMonth() + 1
    ).padStart(2, "0");

    const dia = String(
        agora.getDate()
    ).padStart(2, "0");


    return {
        anoMes: `${ano}${mes}`,
        hoje: `${ano}-${mes}-${dia}`
    };
}


// ======================================================
// CONSULTA TODAS AS PÁGINAS DO SAP
// ======================================================
// O Datasphere devolve os dados em páginas; seguimos o
// "@odata.nextLink" até a última.
// "urlBase" é usada quando o SAP devolve o próximo link relativo
// (padrão: modelo do realizado).

async function consultarTodasPaginasSAP(urlInicial, token, urlBase = URL_MODELO) {

    let url = urlInicial;

    const todosDados = [];

    let pagina = 1;


    while (url) {

        const response = await axios.get(
            url,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: "application/json"
                }
            }
        );

        const dadosPagina =
            response.data.value || [];

        todosDados.push(
            ...dadosPagina
        );

        console.log(
            `Página ${pagina}: ${dadosPagina.length} registros`
        );


        const nextLink =
            response.data["@odata.nextLink"];

        if (!nextLink) {

            url = null;

        } else if (
            nextLink.startsWith("http://") ||
            nextLink.startsWith("https://")
        ) {

            // Caso o SAP devolva URL completa
            url = nextLink;

        } else {

            // Caso o SAP devolva caminho relativo
            url = urlBase + nextLink;
        }

        pagina++;
    }

    return todosDados;
}


// ======================================================
// MONTA A URL DE CONSULTA DO MODELO
// ======================================================
// Os campos selecionados são sempre os mesmos: o Datasphere
// já devolve VL_PADRAO somado por cliente / grupo espécie / marca.
//
// Obs.: até 12/11/2026 a consulta usava CD_ESPECIE_Produto (código
// da espécie: SDF, SDV, SUC, ISO...). Esse campo foi removido do
// modelo no SAP, por isso Sucos e Powerade passaram a ser separados
// pela marca (DS_MARCA_Produto). Validado: mesmos totais da regra antiga.

function montarUrlConsulta(filtro) {

    return (
        URL_MODELO +
        `${MODEL}` +

        `?$select=` +
        `CD_CLIENTE,` +
        `DS_GRUPO_ESPECIE_Produto,` +
        `DS_MARCA_Produto,` +
        `VL_PADRAO` +

        `&$filter=` +
        filtro
    );
}


// ======================================================
// CLASSIFICA O PRODUTO NA CATEGORIA DO PAINEL
// ======================================================
// Refrigerantes, Cerveja e Destilados vêm do Grupo Espécie.
// Sucos e Powerade estão dentro do grupo "Still" e são
// separados pela marca:
//   Sucos    = toda marca que começa com "Del Valle"
//              (Del Valle, Del Valle +, Del Valle 100%, Del Valle Frut)
//              e "Kapo"   (antigas espécies SDF, SDV e SUC)
//   Powerade = marca "Powerade"   (antiga espécie ISO)
// Demais marcas do Still (Monster, Leão Ice Tea, Ades, Reign...) ficam fora.
// Atenção: uma marca nova de suco com outro nome precisa ser incluída aqui.

function classificarCategoria(grupoEspecie, marca) {

    switch (grupoEspecie) {

        case "Refrigerantes":
            return "REFRIGERANTES";

        case "Cerveja":
            return "CERVEJAS";

        case "Destilados":
            return "DESTILADOS";

        case "Still":
            break; // separado pela marca, logo abaixo

        default:
            return null; // Água, Bomboniere, Artd, Outros...: fora do painel
    }

    marca = String(marca || "").trim();

    if (marca.startsWith("Del Valle") || marca === "Kapo") {
        return "SUCOS";
    }

    if (marca === "Powerade") {
        return "POWERADE";
    }

    return null;
}


// ======================================================
// CONSOLIDA OS DADOS POR PV
// ======================================================
// Soma o VL_PADRAO de cada cliente nas 5 categorias,
// mantendo SEPARADOS o faturado (Basis -> REAL) e a venda
// do dia (WF Online -> ONLINE). O painel mostra as duas
// colunas e calcula (Real + Online) − Meta.
//
// Formato de cada item:
// { PV, REAL: {CERVEJAS, DESTILADOS, POWERADE, REFRIGERANTES, SUCOS},
//       ONLINE: {mesmas categorias} }

// Cria o objeto de categorias zerado
function categoriasZeradas() {
    return {
        CERVEJAS: 0,
        DESTILADOS: 0,
        POWERADE: 0,
        REFRIGERANTES: 0,
        SUCOS: 0
    };
}

function consolidarPorPV(dadosBasis, dadosOnline) {

    const resultado = new Map();

    // Soma uma base dentro do campo indicado ("REAL" ou "ONLINE")
    function somarBase(dados, campo) {

        for (const item of dados) {

            const pv = String(item.CD_CLIENTE || "");

            const categoria = classificarCategoria(
                item.DS_GRUPO_ESPECIE_Produto,
                item.DS_MARCA_Produto
            );

            if (!pv || !categoria) continue;

            // Primeira vez que o PV aparece: cria REAL e ONLINE zerados
            if (!resultado.has(pv)) {
                resultado.set(pv, {
                    PV: pv,
                    REAL: categoriasZeradas(),
                    ONLINE: categoriasZeradas()
                });
            }

            resultado.get(pv)[campo][categoria] +=
                Number(item.VL_PADRAO) || 0;
        }
    }

    somarBase(dadosBasis, "REAL");
    somarBase(dadosOnline, "ONLINE");

    return Array.from(resultado.values());
}


// ======================================================
// BUSCA O REALIZADO NO SAP
// ======================================================
// Equivale a [Volume] + [Volume Entrega Total] do B.O.,
// mas devolvido em duas partes (REAL e ONLINE):
//
// 1) REAL - Basis (faturado no mês):
//    FONTE = 'Basis', mês atual, sem notas fiscais canceladas
//    (o B.O. não conta nota cancelada).
//
// 2) ONLINE - WF Online (venda do dia ainda não faturada no Basis):
//    FONTE = 'WF Online', faturamento = hoje,
//    situação 'Inc. e Exp.' e operação 'Venda'.

async function buscarRealizadoSAP() {

    const inicioProcessamento = Date.now();

    const token = await obterTokenSAP();

    const { anoMes, hoje } = obterDatasConsulta();


    const urlBasis = montarUrlConsulta(
        `ANOMES_REF eq '${anoMes}' ` +
        `and FONTE eq 'Basis' ` +
        `and NF_STATUS_Nota_Fiscal ne 'Cancelada'`
    );

    const urlOnline = montarUrlConsulta(
        `ANOMES_REF eq '${anoMes}' ` +
        `and FONTE eq 'WF Online' ` +
        `and DTA_FAT_Pedido eq ${hoje} ` +
        `and SITUACAO_Pedido eq 'Inc. e Exp.' ` +
        `and OPERACAO_Pedido eq 'Venda'`
    );


    // As duas consultas são independentes: rodam em paralelo
    const [dadosBasis, dadosOnline] = await Promise.all([
        consultarTodasPaginasSAP(urlBasis, token),
        consultarTodasPaginasSAP(urlOnline, token)
    ]);


    const dadosConsolidados = consolidarPorPV(
        dadosBasis,
        dadosOnline
    );

    const tempoSegundos = Number(
        ((Date.now() - inicioProcessamento) / 1000).toFixed(2)
    );

    console.log("========================================");
    console.log("REALIZADO ATUALIZADO DO SAP");
    console.log(`Registros Basis: ${dadosBasis.length}`);
    console.log(`Registros WF Online: ${dadosOnline.length}`);
    console.log(`PVs: ${dadosConsolidados.length}`);
    console.log(`Tempo: ${tempoSegundos}s`);
    console.log("========================================");


    return {
        referencia: {
            anoMes,
            realAte: hoje
        },

        processamento: {
            registrosBasis: dadosBasis.length,
            registrosOnline: dadosOnline.length,
            quantidadePVsSAP: dadosConsolidados.length,
            tempoSegundos
        },

        // Todos os clientes do SAP; o filtro pela lista
        // do SuperAgos é feito por quem chama
        dados: dadosConsolidados
    };
}


// ======================================================
// CADASTRO DOS CLIENTES (BASE CLIENTES)
// ======================================================
// Busca nome, segmento, gerência, supervisão, rota, cidade e
// código da rede dos PVs informados.
//
// A Base Clientes inteira tem mais de 200 mil clientes (demora
// minutos), por isso consultamos só os PVs da lista, em lotes
// de 100 códigos por requisição (3 lotes em paralelo).
// FL_CORRENTE = 'S' traz apenas o registro atual de cada cliente.
//
// Retorno: Map  código do PV (texto) -> registro do SAP

const TAMANHO_LOTE = 100;
const LOTES_EM_PARALELO = 3;

async function buscarCadastroSAP(pvs) {

    const token = await obterTokenSAP();

    const urlBase = urlBaseModelo(MODEL_CLIENTES);

    // Divide a lista de PVs em lotes de 100
    const lotes = [];

    for (let i = 0; i < pvs.length; i += TAMANHO_LOTE) {
        lotes.push(pvs.slice(i, i + TAMANHO_LOTE));
    }

    // Monta a URL de um lote: FL_CORRENTE = 'S' e (PV = a ou PV = b ...)
    function urlDoLote(lote) {

        const filtroPVs = lote
            .map(pv => `CD_CLIENTE eq '${pv}'`)
            .join(" or ");

        return (
            urlBase +
            `${MODEL_CLIENTES}` +
            `?$select=` +
            `CD_CLIENTE,NM_NOME_FANTASIA,DS_SEGMENTO,OM01_KEYACCNUM,` +
            `DS_GERENCIA_COMERCIAL_ATUAL,DS_SUPERVISOR_ATUAL,` +
            `CD_ROTA_ATUAL,NM_CIDADE` +
            `&$filter=FL_CORRENTE eq 'S' and (${filtroPVs})`
        );
    }

    const cadastro = new Map();

    // Executa os lotes em grupos de 3 por vez
    for (let i = 0; i < lotes.length; i += LOTES_EM_PARALELO) {

        const grupo = lotes.slice(i, i + LOTES_EM_PARALELO);

        const resultados = await Promise.all(
            grupo.map(lote =>
                consultarTodasPaginasSAP(urlDoLote(lote), token, urlBase)
            )
        );

        for (const registros of resultados) {
            for (const item of registros) {
                cadastro.set(String(item.CD_CLIENTE), item);
            }
        }
    }

    console.log(`Cadastro: ${cadastro.size} de ${pvs.length} PVs encontrados`);

    return cadastro;
}


// ======================================================
// NOMES DAS REDES (KEY ACCOUNT)
// ======================================================
// O nome da rede só existe no modelo de vendas. Consultamos as
// vendas desde 3 meses atrás, agrupadas por rede, para obter
// o par código -> nome (cerca de 300 redes, poucos segundos).
//
// Retorno: Map  código da rede (texto) -> nome da rede

async function buscarNomesRedesSAP() {

    const token = await obterTokenSAP();

    const urlBase = urlBaseModelo(MODEL_VENDA);

    // Primeiro dia de 3 meses atrás (ex.: hoje 12/11 -> 2026-08-01)
    const inicio = new Date();
    inicio.setDate(1);
    inicio.setMonth(inicio.getMonth() - 3);

    const dataInicial =
        `${inicio.getFullYear()}-` +
        `${String(inicio.getMonth() + 1).padStart(2, "0")}-01`;

    // Modelo com parâmetro de entrada: (P_DATA_INICIAL=...)/Set
    const url =
        urlBase +
        `${MODEL_VENDA}(P_DATA_INICIAL=${dataInicial})/Set` +
        `?$select=OM01_KEYACCNUM_Cliente,DS_KEY_ACCOUNT_Cliente,VL_PADRAO`;

    const registros = await consultarTodasPaginasSAP(url, token, urlBase);

    const nomes = new Map();

    for (const item of registros) {

        const codigo = item.OM01_KEYACCNUM_Cliente;
        const nome = item.DS_KEY_ACCOUNT_Cliente;

        // Ignora linhas sem rede ("--" / vazio)
        if (!codigo || codigo === "--" || !nome || nome === "--") continue;

        nomes.set(String(codigo), nome);
    }

    console.log(`Redes: ${nomes.size} nomes encontrados`);

    return nomes;
}


// Funções usadas de fora deste arquivo
module.exports = {
    buscarRealizadoSAP,
    buscarCadastroSAP,
    buscarNomesRedesSAP
};
