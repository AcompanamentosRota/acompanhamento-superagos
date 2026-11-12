// ======================================================
// LOGIN E SESSÕES DO ADMIN
// ======================================================
// Os usuários e as senhas (criptografadas) ficam em usuarios.js /
// usuarios.json. Este arquivo cuida de:
//   - login: confere usuário/senha e cria uma chave de sessão
//     aleatória, válida por 8 horas;
//   - bloqueio após várias senhas erradas;
//   - "middlewares" que protegem as rotas de admin.
// Usa apenas o módulo "crypto" do próprio Node.

const crypto = require("crypto");
const usuarios = require("./usuarios");

const DURACAO_SESSAO = 8 * 60 * 60 * 1000; // 8 horas

// Proteção contra tentativa e erro: 5 senhas erradas seguidas
// bloqueiam aquele computador (IP) por 5 minutos
const MAX_TENTATIVAS = 5;
const TEMPO_BLOQUEIO = 5 * 60 * 1000;


// ------------------------------------------------------
// TENTATIVAS ERRADAS POR IP
// ------------------------------------------------------

const tentativas = new Map(); // ip -> { erros, bloqueadoAte }

// Retorna quantos segundos faltam de bloqueio (0 = liberado)
function segundosBloqueado(ip) {

    const t = tentativas.get(ip);

    if (!t || !t.bloqueadoAte) return 0;

    const resta = t.bloqueadoAte - Date.now();

    if (resta <= 0) {
        tentativas.delete(ip);
        return 0;
    }

    return Math.ceil(resta / 1000);
}

function registrarErro(ip) {

    const t = tentativas.get(ip) || { erros: 0, bloqueadoAte: 0 };

    t.erros++;

    if (t.erros >= MAX_TENTATIVAS) {
        t.bloqueadoAte = Date.now() + TEMPO_BLOQUEIO;
        t.erros = 0;
    }

    tentativas.set(ip, t);
}


// ------------------------------------------------------
// SESSÕES (na memória: reiniciar a API desloga todos)
// ------------------------------------------------------

const sessoes = new Map(); // chave -> { usuario, expiraEm }

// Confere usuário e senha. Retorna { chave, expiraEm } ou null.
function fazerLogin(usuario, senha, ip) {

    const registro = usuarios.autenticar(usuario, senha);

    if (!registro) {
        registrarErro(ip);
        return null;
    }

    tentativas.delete(ip);
    usuarios.registrarAcesso(registro.usuario);

    const chave = crypto.randomBytes(32).toString("hex");
    const expiraEm = Date.now() + DURACAO_SESSAO;

    sessoes.set(chave, { usuario: registro.usuario, expiraEm });

    return { chave, expiraEm };
}

function encerrarSessao(chave) {
    sessoes.delete(chave);
}

// Encerra as sessões de um usuário (reset de senha, exclusão,
// troca de senha). "exceto" mantém a sessão de quem fez a troca.
function encerrarSessoesDoUsuario(usuario, exceto) {

    for (const [chave, sessao] of sessoes) {
        if (sessao.usuario === usuario && chave !== exceto) sessoes.delete(chave);
    }
}


// ------------------------------------------------------
// MIDDLEWARES DAS ROTAS DE ADMIN
// ------------------------------------------------------
// A tela envia o cabeçalho  Authorization: Bearer <chave>

function lerChave(req) {
    const cabecalho = req.headers.authorization || "";
    return cabecalho.startsWith("Bearer ") ? cabecalho.slice(7) : "";
}

// Exige sessão válida de um usuário que ainda exista.
// Coloca em req.usuario o cadastro de quem está logado.
function exigirLogin(req, res, next) {

    const chave = lerChave(req);
    const sessao = sessoes.get(chave);

    const registro =
        sessao && sessao.expiraEm > Date.now()
            ? usuarios.buscarUsuario(sessao.usuario)
            : null;

    if (!registro) {

        sessoes.delete(chave);

        return res.status(401).json({
            status: "erro",
            mensagem: "Sessão expirada ou inexistente. Faça login novamente."
        });
    }

    req.usuario = registro;
    req.chaveSessao = chave;

    next();
}

// Usado depois do exigirLogin: enquanto a senha for provisória
// (inicial ou resetada), só é permitido trocar a senha.
function exigirSenhaDefinitiva(req, res, next) {

    if (req.usuario.senhaProvisoria) {
        return res.status(403).json({
            status: "erro",
            trocarSenha: true,
            mensagem: "Defina uma nova senha antes de usar o admin."
        });
    }

    next();
}


module.exports = {
    segundosBloqueado,
    fazerLogin,
    encerrarSessao,
    encerrarSessoesDoUsuario,
    lerChave,
    exigirLogin,
    exigirSenhaDefinitiva
};
