// ======================================================
// CADASTRO DE USUÁRIOS DO ADMIN (api/usuarios.json)
// ======================================================
// Todos os usuários têm o mesmo acesso: sobem PVs/metas e
// gerenciam usuários.
//
// Formato do arquivo:
// {
//   "usuarios": [
//     { "usuario": "admin", "nome": "Administrador",
//       "hash": "scrypt:...",            // senha criptografada
//       "senhaProvisoria": false,        // true = obriga a trocar no login
//       "criadoEm": "2026-11-12T...", "ultimoAcesso": "2026-11-12T..." }
//   ]
// }
//
// O arquivo fica na pasta api, que NUNCA é servida pela API,
// e não deve ir para o repositório (está no .gitignore).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ARQUIVO_USUARIOS = path.join(__dirname, "usuarios.json");
const ARQUIVO_ENV = path.join(__dirname, ".env");

// Primeiro usuário, criado se não existir nenhum.
// A senha dele é gerada aleatoriamente na primeira vez que a API
// é iniciada e aparece só no terminal (não fica escrita no código,
// que é público no GitHub). Nasce provisória: troca no 1º acesso.
const USUARIO_INICIAL = "admin";

const TAMANHO_MINIMO_SENHA = 8;


// ------------------------------------------------------
// HASH DA SENHA (scrypt com "sal" aleatório)
// ------------------------------------------------------
// Formato: scrypt:<sal em hex>:<hash em hex>

function gerarHashSenha(senha) {
    const sal = crypto.randomBytes(16);
    const hash = crypto.scryptSync(String(senha), sal, 64);
    return `scrypt:${sal.toString("hex")}:${hash.toString("hex")}`;
}

function senhaConfere(senha, hashArmazenado) {

    const partes = String(hashArmazenado || "").split(":");

    if (partes.length !== 3 || partes[0] !== "scrypt") return false;

    const sal = Buffer.from(partes[1], "hex");
    const esperado = Buffer.from(partes[2], "hex");
    const calculado = crypto.scryptSync(String(senha), sal, esperado.length);

    // Comparação em tempo constante
    return crypto.timingSafeEqual(calculado, esperado);
}

// Hash "falso" usado quando o usuário não existe: o cálculo é feito
// mesmo assim, para o tempo de resposta não revelar quem existe
const HASH_FALSO = gerarHashSenha(crypto.randomBytes(8).toString("hex"));


// ------------------------------------------------------
// SENHA PROVISÓRIA ALEATÓRIA (reset / usuário novo)
// ------------------------------------------------------
// 8 caracteres em dois grupos, ex.: "K7mp-4Qxr".
// Sem caracteres que se confundem (0/O, 1/l/I).

function gerarSenhaProvisoria() {

    const letras = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

    let s = "";

    for (let i = 0; i < 8; i++) {
        s += letras[crypto.randomInt(letras.length)];
    }

    return s.slice(0, 4) + "-" + s.slice(4);
}


// ------------------------------------------------------
// LEITURA E GRAVAÇÃO DO ARQUIVO
// ------------------------------------------------------

function lerUsuarios() {

    if (!fs.existsSync(ARQUIVO_USUARIOS)) return [];

    return JSON.parse(fs.readFileSync(ARQUIVO_USUARIOS, "utf8")).usuarios || [];
}

// Grava primeiro num arquivo temporário e depois renomeia:
// se algo falhar no meio, o arquivo original não fica corrompido
function gravarUsuarios(lista) {

    const temporario = ARQUIVO_USUARIOS + ".tmp";

    fs.writeFileSync(temporario, JSON.stringify({ usuarios: lista }, null, 2) + "\n");
    fs.renameSync(temporario, ARQUIVO_USUARIOS);
}

// Nomes de usuário são comparados sem diferenciar maiúsculas
function normalizarUsuario(usuario) {
    return String(usuario || "").trim().toLowerCase();
}

function buscarUsuario(usuario) {
    const alvo = normalizarUsuario(usuario);
    return lerUsuarios().find(u => u.usuario === alvo) || null;
}

// Altera um usuário (função recebe o registro e modifica) e grava
function atualizarUsuario(usuario, alterar) {

    const lista = lerUsuarios();
    const alvo = normalizarUsuario(usuario);
    const registro = lista.find(u => u.usuario === alvo);

    if (!registro) return false;

    alterar(registro);
    gravarUsuarios(lista);

    return true;
}


// ------------------------------------------------------
// INICIALIZAÇÃO (chamada ao iniciar a API)
// ------------------------------------------------------
// 1) Se existir o login antigo no .env (ADMIN_USUARIO / ADMIN_SENHA_HASH),
//    migra para o usuarios.json mantendo a senha e remove do .env.
// 2) Se não houver nenhum usuário, cria o "admin" com a senha inicial.
// Retorna uma mensagem do que foi feito (ou null).

function inicializarUsuarios() {

    let mensagem = null;

    const lista = lerUsuarios();

    if (!lista.length && process.env.ADMIN_USUARIO && process.env.ADMIN_SENHA_HASH) {

        lista.push({
            usuario: normalizarUsuario(process.env.ADMIN_USUARIO),
            nome: "Administrador",
            hash: process.env.ADMIN_SENHA_HASH,
            senhaProvisoria: process.env.ADMIN_SENHA_INICIAL === "1",
            criadoEm: new Date().toISOString(),
            ultimoAcesso: null
        });

        gravarUsuarios(lista);
        removerLoginAntigoDoEnv();

        mensagem = `Usuário "${lista[0].usuario}" migrado do .env para usuarios.json (senha mantida).`;
    }

    if (!lista.length) {

        // Senha aleatória, no mesmo formato do reset (ex.: "K7mp-4Qxr")
        const senhaInicial = gerarSenhaProvisoria();

        lista.push({
            usuario: USUARIO_INICIAL,
            nome: "Administrador",
            hash: gerarHashSenha(senhaInicial),
            senhaProvisoria: true,
            criadoEm: new Date().toISOString(),
            ultimoAcesso: null
        });

        gravarUsuarios(lista);

        // Mostrada uma única vez, no terminal de quem iniciou a API.
        // Se for perdida: node criar-senha.js
        mensagem =
            `Usuário inicial criado -> usuário: ${USUARIO_INICIAL}  senha provisória: ${senhaInicial}\n` +
            "Anote agora: ela não será mostrada de novo. Troque a senha no primeiro acesso.";
    }

    return mensagem;
}

// Remove as linhas ADMIN_... do .env (as credenciais do SAP ficam)
function removerLoginAntigoDoEnv() {

    if (!fs.existsSync(ARQUIVO_ENV)) return;

    const conteudo = fs.readFileSync(ARQUIVO_ENV, "utf8")
        .split(/\r?\n/)
        .filter(linha => !/^ADMIN_(USUARIO|SENHA_HASH|SENHA_INICIAL)=/.test(linha))
        .join("\n");

    fs.writeFileSync(ARQUIVO_ENV, conteudo);
}


// ------------------------------------------------------
// OPERAÇÕES DA TELA DE ADMIN
// ------------------------------------------------------

// Lista para exibir na tela (sem o hash da senha)
function listarUsuarios() {
    return lerUsuarios().map(({ hash, ...dados }) => dados);
}

// Confere usuário e senha no login. Retorna o registro ou null.
function autenticar(usuario, senha) {

    const registro = buscarUsuario(usuario);

    const ok = senhaConfere(senha || "", registro ? registro.hash : HASH_FALSO);

    return ok && registro ? registro : null;
}

function registrarAcesso(usuario) {
    atualizarUsuario(usuario, u => { u.ultimoAcesso = new Date().toISOString(); });
}

// Cria usuário com senha provisória.
// Retorna { erro } ou { senhaProvisoria }.
function criarUsuario(usuario, nome) {

    usuario = normalizarUsuario(usuario);
    nome = String(nome || "").trim();

    if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) {
        return { erro: "Usuário inválido: use de 3 a 30 letras, números, ponto, hífen ou sublinhado, sem espaços." };
    }

    if (!nome || nome.length > 60) {
        return { erro: "Informe o nome (até 60 caracteres)." };
    }

    const lista = lerUsuarios();

    if (lista.some(u => u.usuario === usuario)) {
        return { erro: `O usuário "${usuario}" já existe.` };
    }

    const senhaProvisoria = gerarSenhaProvisoria();

    lista.push({
        usuario,
        nome,
        hash: gerarHashSenha(senhaProvisoria),
        senhaProvisoria: true,
        criadoEm: new Date().toISOString(),
        ultimoAcesso: null
    });

    gravarUsuarios(lista);

    return { senhaProvisoria };
}

// Gera nova senha provisória para o usuário.
// Retorna { erro } ou { senhaProvisoria }.
function resetarSenha(usuario) {

    const senhaProvisoria = gerarSenhaProvisoria();

    const ok = atualizarUsuario(usuario, u => {
        u.hash = gerarHashSenha(senhaProvisoria);
        u.senhaProvisoria = true;
    });

    return ok ? { senhaProvisoria } : { erro: "Usuário não encontrado." };
}

// Exclui o usuário. Retorna mensagem de erro ou null.
function excluirUsuario(usuario) {

    const alvo = normalizarUsuario(usuario);
    const lista = lerUsuarios();
    const nova = lista.filter(u => u.usuario !== alvo);

    if (nova.length === lista.length) return "Usuário não encontrado.";
    if (!nova.length) return "Não é possível excluir o último usuário.";

    gravarUsuarios(nova);

    return null;
}

// Troca a senha do próprio usuário (confere a atual).
// Retorna mensagem de erro ou null.
function trocarSenha(usuario, senhaAtual, novaSenha) {

    const registro = buscarUsuario(usuario);

    if (!registro || !senhaConfere(senhaAtual || "", registro.hash)) {
        return "A senha atual não confere.";
    }

    return definirSenha(usuario, novaSenha, senhaAtual);
}

// Define a senha definitiva (usada pela troca e pelo criar-senha.js).
// Retorna mensagem de erro ou null.
function definirSenha(usuario, novaSenha, senhaAnterior) {

    novaSenha = String(novaSenha || "");

    if (novaSenha.length < TAMANHO_MINIMO_SENHA) {
        return `A nova senha precisa ter pelo menos ${TAMANHO_MINIMO_SENHA} caracteres.`;
    }

    if (senhaAnterior !== undefined && novaSenha === senhaAnterior) {
        return "A nova senha precisa ser diferente da atual.";
    }

    const ok = atualizarUsuario(usuario, u => {
        u.hash = gerarHashSenha(novaSenha);
        u.senhaProvisoria = false;
    });

    return ok ? null : "Usuário não encontrado.";
}


module.exports = {
    normalizarUsuario,
    buscarUsuario,
    inicializarUsuarios,
    listarUsuarios,
    autenticar,
    registrarAcesso,
    criarUsuario,
    resetarSenha,
    excluirUsuario,
    trocarSenha,
    definirSenha
};
