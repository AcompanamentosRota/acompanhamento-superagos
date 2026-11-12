// ======================================================
// ENVIO DAS METAS PARA O GITHUB
// ======================================================
// O painel publicado (GitHub Pages) é montado pelo GitHub Actions
// a partir do que está no repositório. Por isso, quando o admin
// salva as metas aqui na API local, o arquivo dados/metas.json
// também precisa ser gravado no repositório.
//
// Como funciona:
//   1) Lê o arquivo atual no GitHub para obter o "sha" (identificador
//      da versão; o GitHub exige ele para substituir um arquivo).
//   2) Envia o conteúdo novo (API "contents" do GitHub = um commit).
//   3) O commit em dados/metas.json dispara o workflow
//      .github/workflows/atualizar-painel.yml, que consulta o SAP
//      e publica o painel em ~2 minutos.
//
// Configuração no api/.env (nunca vai para o repositório):
//   GITHUB_TOKEN=<token "fine-grained" com permissão
//                 Contents: Read and write SÓ neste repositório>
//   GITHUB_REPO=AcompanamentosRota/acompanhamento-superagos   (opcional)
//   GITHUB_BRANCH=main                                         (opcional)
//
// Sem GITHUB_TOKEN o envio é simplesmente pulado (a API continua
// funcionando só localmente, como antes).

const fs = require("fs");
const path = require("path");
const axios = require("axios");

// Carrega o .env da pasta api, de onde quer que o script seja chamado
require("dotenv").config({ path: path.join(__dirname, ".env") });

const { ARQUIVO_METAS } = require("./metas");

// Caminho do arquivo dentro do repositório
const CAMINHO_NO_REPO = "dados/metas.json";

const REPO_PADRAO = "AcompanamentosRota/acompanhamento-superagos";


// ------------------------------------------------------
// Envia o dados/metas.json local para o repositório.
// "autor" = usuário do admin que salvou (vai na mensagem do commit).
// Retorna { status: "ok" | "desativado" | "erro", mensagem }.
// Nunca lança erro: as metas já estão salvas localmente e a
// tela de admin só precisa saber se o envio deu certo.
// ------------------------------------------------------
async function enviarMetasParaGitHub(autor) {

    const token = process.env.GITHUB_TOKEN;

    if (!token) {
        return {
            status: "desativado",
            mensagem: "Envio ao GitHub desativado (GITHUB_TOKEN não configurado no api/.env). " +
                      "O painel publicado não recebeu as metas novas."
        };
    }

    const repo = process.env.GITHUB_REPO || REPO_PADRAO;
    const branch = process.env.GITHUB_BRANCH || "main";

    const url = `https://api.github.com/repos/${repo}/contents/${CAMINHO_NO_REPO}`;

    // Cabeçalhos exigidos pela API do GitHub
    const cabecalhos = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "acompanhamento-superagos-admin"
    };

    try {

        // 1) Versão atual do arquivo no GitHub (404 = ainda não existe)
        let sha;

        try {
            const atual = await axios.get(url, { headers: cabecalhos, params: { ref: branch } });
            sha = atual.data.sha;
        } catch (erro) {
            if (erro.response?.status !== 404) throw erro;
        }

        // 2) Conteúdo novo em base64 (formato exigido pela API)
        const conteudo = fs.readFileSync(ARQUIVO_METAS);

        const metas = JSON.parse(conteudo.toString("utf8"));

        await axios.put(url, {
            message: `Metas ${metas.mes}: ${metas.clientes.length} PVs (admin, por ${autor})`,
            content: conteudo.toString("base64"),
            branch,
            sha
        }, { headers: cabecalhos });

        return {
            status: "ok",
            mensagem: "Metas enviadas ao GitHub. O painel publicado é atualizado em cerca de 2 minutos."
        };

    } catch (erro) {

        // Mensagens mais comuns, traduzidas para quem usa o admin
        const codigo = erro.response?.status;

        let motivo = erro.response?.data?.message || erro.message;

        if (codigo === 401) motivo = "token inválido ou expirado (gere um novo e atualize o api/.env)";
        if (codigo === 403 || codigo === 404) motivo = "o token não tem permissão de escrita neste repositório";
        if (codigo === 409) motivo = "o arquivo mudou no GitHub ao mesmo tempo; salve novamente";

        console.error(`Erro ao enviar metas ao GitHub (${codigo || "sem resposta"}): ${erro.response?.data?.message || erro.message}`);

        return {
            status: "erro",
            mensagem: `Metas salvas aqui, mas NÃO enviadas ao GitHub: ${motivo}.`
        };
    }
}


module.exports = { enviarMetasParaGitHub };
