// ======================================================
// ARQUIVO DE METAS DO SUPERAGOS (dados/metas.json)
// ======================================================
// Lista de PVs com acordo fechado e a meta mensal de cada
// categoria. É preenchido pela tela de admin (admin.html)
// e lido pelo gerar-dados.js e pela API.
//
// Formato:
// {
//   "mes": "2026-11",                      // mês da meta (AAAA-MM)
//   "atualizadoEm": "2026-11-12T...",      // quando foi salvo
//   "origem": "admin: metas_nov.xlsx",     // de onde veio
//   "clientes": [
//     { "pv": "1000853", "meta": { "refri": 322.07, "cerv": 4.38,
//                                  "sucos": 15.23, "pw": 1.27, "dest": 1.94 } },
//     ...
//   ]
// }

const fs = require("fs");
const path = require("path");

const ARQUIVO_METAS = path.join(__dirname, "..", "dados", "metas.json");

// Categorias de meta (mesmas chaves do painel)
const CATEGORIAS = ["refri", "cerv", "sucos", "pw", "dest"];

// Nomes dos meses para o rótulo do painel ("Nov/26")
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
               "Jul", "Ago", "Set", "Out", "Nov", "Dez"];


// ------------------------------------------------------
// Converte "2026-11" em "Nov/26" (formato dos selos do painel)
// ------------------------------------------------------
function rotuloMes(anoMes) {

    const [ano, mes] = String(anoMes).split("-");

    return `${MESES[Number(mes) - 1]}/${ano.slice(2)}`;
}


// ------------------------------------------------------
// Lê o dados/metas.json
// ------------------------------------------------------
function lerMetas() {
    return JSON.parse(fs.readFileSync(ARQUIVO_METAS, "utf8"));
}


// ------------------------------------------------------
// Valida o conteúdo recebido da tela de admin.
// Retorna a lista de erros (vazia = válido).
// A tela já valida antes de enviar; aqui é a segunda checagem,
// para nunca gravar um arquivo inválido.
// ------------------------------------------------------
function validarMetas(dados) {

    const erros = [];

    if (!dados || typeof dados !== "object") {
        return ["Conteúdo vazio ou inválido."];
    }

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(dados.mes || ""))) {
        erros.push("Mês da meta inválido (esperado AAAA-MM).");
    }

    if (!Array.isArray(dados.clientes) || dados.clientes.length === 0) {
        erros.push("A lista de clientes está vazia.");
        return erros;
    }

    const vistos = new Set();

    dados.clientes.forEach((cliente, i) => {

        const pv = String(cliente && cliente.pv || "");

        if (!/^\d+$/.test(pv)) {
            erros.push(`Linha ${i + 1}: PV inválido ("${pv}").`);
            return;
        }

        if (vistos.has(pv)) {
            erros.push(`PV ${pv} repetido.`);
        }

        vistos.add(pv);

        for (const cat of CATEGORIAS) {

            const valor = cliente.meta && cliente.meta[cat];

            if (typeof valor !== "number" || !isFinite(valor) || valor < 0) {
                erros.push(`PV ${pv}: meta de "${cat}" inválida.`);
            }
        }
    });

    return erros;
}


// ------------------------------------------------------
// Grava o dados/metas.json.
// Um cliente por linha: fica legível e, no GitHub, o histórico
// mostra exatamente quais PVs/metas mudaram.
// ------------------------------------------------------
function salvarMetas(dados) {

    const linhas = dados.clientes.map(cliente => {

        // Mantém só os campos esperados, na ordem padrão
        const meta = {};
        for (const cat of CATEGORIAS) meta[cat] = cliente.meta[cat];

        return "    " + JSON.stringify({ pv: String(cliente.pv), meta });
    });

    const conteudo =
        "{\n" +
        `  "mes": ${JSON.stringify(dados.mes)},\n` +
        `  "atualizadoEm": ${JSON.stringify(new Date().toISOString())},\n` +
        `  "origem": ${JSON.stringify(dados.origem || "admin")},\n` +
        `  "clientes": [\n` +
        linhas.join(",\n") + "\n" +
        "  ]\n" +
        "}\n";

    fs.writeFileSync(ARQUIVO_METAS, conteudo);
}


module.exports = {
    ARQUIVO_METAS,
    CATEGORIAS,
    rotuloMes,
    lerMetas,
    validarMetas,
    salvarMetas
};
