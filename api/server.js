require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");

// Consulta do realizado no SAP Datasphere (Basis + WF Online).
// Fica em sap.js para ser usada também pelo gerar-dados.js.
const { buscarRealizadoSAP } = require("./sap");

// Arquivo de metas (dados/metas.json): ler, validar e gravar
const { lerMetas, validarMetas, salvarMetas } = require("./metas");

// Geração do js/dados.js (o mesmo script que o robô roda)
const { gerarDados } = require("./gerar-dados");

// Login e sessões do admin (sessões de 8 horas)
const {
    segundosBloqueado,
    fazerLogin,
    encerrarSessao,
    encerrarSessoesDoUsuario,
    lerChave,
    exigirLogin,
    exigirSenhaDefinitiva
} = require("./auth");

// Cadastro de usuários do admin (api/usuarios.json)
const usuarios = require("./usuarios");

// Primeira execução: migra o login antigo do .env ou cria o
// usuário inicial (admin / senha inicial, a trocar no 1º acesso)
const mensagemUsuarios = usuarios.inicializarUsuarios();
if (mensagemUsuarios) console.log(mensagemUsuarios);

const app = express();

app.use(cors());

// Limite de 5 MB: a lista de metas enviada pelo admin (~900 PVs)
// passa do limite padrão de 100 KB do Express
app.use(express.json({ limit: "5mb" }));


// ======================================================
// ARQUIVOS DO PAINEL E DA TELA DE ADMIN
// ======================================================
// Permite abrir http://localhost:3000/ (painel) e
// http://localhost:3000/admin.html (admin).
// Só as pastas do site são publicadas: a pasta "api" (que tem o
// .env com as credenciais do SAP) NUNCA é servida.

const PASTA_PROJETO = path.join(__dirname, "..");

app.use("/css", express.static(path.join(PASTA_PROJETO, "css")));
app.use("/js", express.static(path.join(PASTA_PROJETO, "js")));
app.use("/dados", express.static(path.join(PASTA_PROJETO, "dados")));

app.get(["/", "/index.html"], (req, res) => {
    res.sendFile(path.join(PASTA_PROJETO, "index.html"));
});

app.get("/admin.html", (req, res) => {
    res.sendFile(path.join(PASTA_PROJETO, "admin.html"));
});


// ======================================================
// LISTA DE CLIENTES DO SUPERAGOS
// ======================================================
// PVs do dados/metas.json (salvo pela tela de admin).
// É lido a cada requisição para que mudanças valham na hora,
// sem reiniciar o servidor.

function carregarClientes() {

    // Set de códigos em texto, para busca rápida
    return new Set(
        lerMetas().clientes.map(cliente => String(cliente.pv))
    );
}


// ======================================================
// CACHE DE 1 HORA
// ======================================================
// Evita consultar o SAP a cada acesso ao painel.
// "consultaEmAndamento" impede que vários acessos ao mesmo
// tempo disparem várias consultas ao SAP.

const TEMPO_CACHE = 60 * 60 * 1000; // 1 hora

let cache = null;
let cacheAtualizadoEm = null;
let consultaEmAndamento = null;

async function obterRealizado() {

    const cacheValido =
        cache &&
        (Date.now() - cacheAtualizadoEm) < TEMPO_CACHE;

    if (cacheValido) {
        return { ...cache, origem: "cache" };
    }

    // Já existe uma consulta rodando: aguarda a mesma
    if (!consultaEmAndamento) {

        consultaEmAndamento = buscarRealizadoSAP()
            .then(resultado => {
                cache = resultado;
                cacheAtualizadoEm = Date.now();
                return resultado;
            })
            .finally(() => {
                consultaEmAndamento = null;
            });
    }

    const resultado = await consultaEmAndamento;

    return { ...resultado, origem: "sap" };
}


// ======================================================
// STATUS DA API
// ======================================================
// (A rota "/" agora abre o painel.)

app.get("/api/status", (req, res) => {

    res.json({
        status: "online",
        projeto: "API Datasphere BAND"
    });

});


// ======================================================
// API SUPERAGOS
// REALIZADO DO MÊS (REAL) E VENDA DO DIA (ONLINE), POR PV
// ======================================================
// Devolve somente os clientes da lista do SuperAgos
// (dados/metas.json), com REAL e ONLINE separados.

app.get("/api/superagos", async (req, res) => {

    try {

        const realizado = await obterRealizado();

        const clientes = carregarClientes();

        const baseSuperAgos = realizado.dados
            .filter(item => clientes.has(item.PV))
            .sort((a, b) => a.PV.localeCompare(b.PV));


        const proximaAtualizacao =
            cacheAtualizadoEm + TEMPO_CACHE;

        res.json({

            status: "sucesso",

            referencia: realizado.referencia,

            processamento: {
                ...realizado.processamento,

                // Clientes da lista e quantos tiveram venda no mês
                quantidadeClientesLista: clientes.size,
                quantidadePVs: baseSuperAgos.length
            },

            dados: baseSuperAgos,

            atualizacao: {
                ultimaAtualizacao:
                    new Date(cacheAtualizadoEm).toLocaleString("pt-BR"),

                proximaAtualizacao:
                    new Date(proximaAtualizacao).toLocaleString("pt-BR"),

                origem: realizado.origem
            }

        });

    } catch (error) {

        console.error("");
        console.error("ERRO NA API SUPERAGOS");
        console.error(error.response?.data || error.message);

        res.status(
            error.response?.status || 500
        ).json({

            status: "erro",

            mensagem: "Erro ao gerar Base SuperAgos",

            codigoSAP: error.response?.status || null,

            detalhe: error.response?.data || error.message

        });
    }
});


// ======================================================
// LOGIN DO ADMIN
// ======================================================
// O botão "Admin" do painel abre um modal de login que chama
// estas rotas. As rotas de metas exigem a chave de sessão
// devolvida aqui (cabeçalho Authorization: Bearer <chave>).
// Por isso o admin pode ser usado de outros computadores da rede.

app.post("/api/login", (req, res) => {

    const ip = req.socket.remoteAddress || "";

    // Muitas senhas erradas seguidas: bloqueio temporário
    const bloqueio = segundosBloqueado(ip);

    if (bloqueio > 0) {
        return res.status(429).json({
            status: "erro",
            mensagem: `Muitas tentativas. Tente novamente em ${Math.ceil(bloqueio / 60)} minuto(s).`
        });
    }

    const { usuario, senha } = req.body || {};

    const sessao = fazerLogin(usuario, senha, ip);

    if (!sessao) {
        return res.status(401).json({
            status: "erro",
            mensagem: "Usuário ou senha inválidos."
        });
    }

    console.log(`Login no admin: ${usuarios.normalizarUsuario(usuario)} (${ip})`);

    res.json({ status: "sucesso", chave: sessao.chave, expiraEm: sessao.expiraEm });
});

// Sair: invalida a chave de sessão
app.post("/api/logout", (req, res) => {
    encerrarSessao(lerChave(req));
    res.json({ status: "sucesso" });
});

// Situação da sessão: a tela de admin chama ao abrir para saber quem
// está logado e se a senha provisória ainda precisa ser trocada
app.get("/api/admin/sessao", exigirLogin, (req, res) => {
    res.json({
        status: "sucesso",
        usuario: req.usuario.usuario,
        nome: req.usuario.nome,
        trocarSenha: req.usuario.senhaProvisoria
    });
});

// Alterar a própria senha (botão "Alterar senha" / primeiro acesso)
app.post("/api/admin/senha", exigirLogin, (req, res) => {

    const { senhaAtual, novaSenha } = req.body || {};

    const erro = usuarios.trocarSenha(req.usuario.usuario, senhaAtual, novaSenha);

    if (erro) {
        return res.status(400).json({ status: "erro", mensagem: erro });
    }

    // Outras sessões desse usuário (ex.: outro computador) saem
    encerrarSessoesDoUsuario(req.usuario.usuario, req.chaveSessao);

    console.log(`Senha alterada: ${req.usuario.usuario}`);

    res.json({ status: "sucesso", mensagem: "Senha alterada." });
});


// ======================================================
// ADMIN: USUÁRIOS
// ======================================================
// Todos os usuários podem gerenciar usuários. A única trava:
// ninguém reseta nem exclui o próprio usuário (para a própria
// senha existe o "Alterar senha"), então sempre sobra alguém.

// Lista (sem as senhas)
app.get("/api/admin/usuarios", exigirLogin, exigirSenhaDefinitiva, (req, res) => {
    res.json({ status: "sucesso", usuarios: usuarios.listarUsuarios() });
});

// Novo usuário: devolve a senha provisória (mostrada uma única vez)
app.post("/api/admin/usuarios", exigirLogin, exigirSenhaDefinitiva, (req, res) => {

    const { usuario, nome } = req.body || {};

    const resultado = usuarios.criarUsuario(usuario, nome);

    if (resultado.erro) {
        return res.status(400).json({ status: "erro", mensagem: resultado.erro });
    }

    console.log(`Usuário criado: ${usuarios.normalizarUsuario(usuario)} (por ${req.usuario.usuario})`);

    res.json({ status: "sucesso", senhaProvisoria: resultado.senhaProvisoria });
});

// Reset de senha: nova senha provisória e encerra as sessões do usuário
app.post("/api/admin/usuarios/:usuario/reset", exigirLogin, exigirSenhaDefinitiva, (req, res) => {

    const alvo = usuarios.normalizarUsuario(req.params.usuario);

    if (alvo === req.usuario.usuario) {
        return res.status(400).json({
            status: "erro",
            mensagem: "Para a sua própria senha use o botão \"Alterar senha\"."
        });
    }

    const resultado = usuarios.resetarSenha(alvo);

    if (resultado.erro) {
        return res.status(404).json({ status: "erro", mensagem: resultado.erro });
    }

    encerrarSessoesDoUsuario(alvo);

    console.log(`Senha resetada: ${alvo} (por ${req.usuario.usuario})`);

    res.json({ status: "sucesso", senhaProvisoria: resultado.senhaProvisoria });
});

// Excluir usuário (e encerrar as sessões dele)
app.delete("/api/admin/usuarios/:usuario", exigirLogin, exigirSenhaDefinitiva, (req, res) => {

    const alvo = usuarios.normalizarUsuario(req.params.usuario);

    if (alvo === req.usuario.usuario) {
        return res.status(400).json({
            status: "erro",
            mensagem: "Você não pode excluir o próprio usuário."
        });
    }

    const erro = usuarios.excluirUsuario(alvo);

    if (erro) {
        return res.status(400).json({ status: "erro", mensagem: erro });
    }

    encerrarSessoesDoUsuario(alvo);

    console.log(`Usuário excluído: ${alvo} (por ${req.usuario.usuario})`);

    res.json({ status: "sucesso" });
});


// ======================================================
// ADMIN: METAS E PVs
// ======================================================
// Usadas pela tela admin.html. Só funcionam com login.
// (No GitHub, a tela passará a gravar direto no repositório.)

// Devolve as metas atuais (a tela compara com a planilha nova)
app.get("/api/admin/metas", exigirLogin, exigirSenhaDefinitiva, (req, res) => {

    try {
        res.json(lerMetas());
    } catch (error) {
        res.status(500).json({ status: "erro", mensagem: error.message });
    }
});


// Recebe a lista nova, valida, grava o dados/metas.json e
// já regera o js/dados.js (painel atualizado na hora).
app.post("/api/admin/metas", exigirLogin, exigirSenhaDefinitiva, async (req, res) => {

    const erros = validarMetas(req.body);

    if (erros.length) {
        return res.status(400).json({
            status: "erro",
            mensagem: "Metas inválidas: nada foi gravado.",
            erros: erros.slice(0, 50)
        });
    }

    try {
        // Registra no arquivo quem salvou (ex.: "admin: metas_dez.xlsx (por joao)")
        salvarMetas({ ...req.body, origem: `${req.body.origem || "admin"} (por ${req.usuario.usuario})` });
    } catch (error) {
        return res.status(500).json({
            status: "erro",
            mensagem: "Não foi possível gravar o arquivo de metas.",
            detalhe: error.message
        });
    }

    console.log(`Metas salvas por ${req.usuario.usuario}: ${req.body.clientes.length} PVs (${req.body.mes})`);

    // As metas já estão salvas. Se a geração do painel falhar
    // (ex.: SAP fora do ar), o robô gera na próxima hora.
    try {

        const resumo = await gerarDados();

        res.json({
            status: "sucesso",
            mensagem: "Metas salvas e painel atualizado.",
            resumo
        });

    } catch (error) {

        console.error("Erro ao gerar o painel após salvar metas:", error.message);

        res.json({
            status: "parcial",
            mensagem:
                "Metas salvas, mas o painel não foi atualizado agora " +
                "(erro ao consultar o SAP). Ele será atualizado na próxima execução do robô.",
            detalhe: error.response?.data || error.message
        });
    }
});


// ======================================================
// INICIA SERVIDOR
// ======================================================

// Endereços IPv4 desta máquina na rede (para acesso de outros computadores)
function enderecosRede() {
    const lista = [];
    for (const interfaces of Object.values(require("os").networkInterfaces())) {
        for (const i of interfaces || []) {
            if (i.family === "IPv4" && !i.internal) lista.push(i.address);
        }
    }
    return lista;
}

const PORT =
    process.env.PORT || 3000;

app.listen(
    PORT,
    () => {

        console.log("");
        console.log("========================================");
        console.log("API Datasphere BAND");
        console.log(`Painel: http://localhost:${PORT}/`);
        console.log(`Admin:  http://localhost:${PORT}/admin.html`);
        console.log(`API:    http://localhost:${PORT}/api/superagos`);
        for (const ip of enderecosRede()) {
            console.log(`Rede:   http://${ip}:${PORT}/  (outros computadores)`);
        }
        console.log(`Usuários do admin: ${usuarios.listarUsuarios().map(u => u.usuario).join(", ")}`);
        console.log("========================================");
        console.log("");
    }
);
