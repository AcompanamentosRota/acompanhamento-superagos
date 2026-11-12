// ======================================================
// FERRAMENTA DE EMERGÊNCIA: DEFINIR SENHA DE UM USUÁRIO
// ======================================================
// Uso (dentro da pasta api):   node criar-senha.js
//
// Normalmente não é preciso: os usuários são criados e as senhas
// resetadas pela tela de admin. Use este script quando ninguém
// conseguir entrar (ex.: todos esqueceram a senha).
//
// Pergunta o usuário e a nova senha (aparece como "****"). Se o
// usuário não existir, ele é criado. A senha fica gravada,
// criptografada, em api/usuarios.json e vale na hora (não precisa
// reiniciar a API).

const usuarios = require("./usuarios");


// ------------------------------------------------------
// LEITURA DO TERMINAL
// ------------------------------------------------------
// Terminal de verdade (TTY): lê tecla a tecla em "modo bruto",
// o que permite mascarar a senha com "*" e tratar Backspace.
// Entrada redirecionada (ex.: teste automático): lê linha a linha.

const filaLinhas = [];   // linhas já recebidas (entrada redirecionada)
let esperandoLinha = null;

if (!process.stdin.isTTY) {

    let resto = "";

    process.stdin.setEncoding("utf8");

    process.stdin.on("data", parte => {
        resto += parte;
        const linhas = resto.split(/\r?\n/);
        resto = linhas.pop();
        filaLinhas.push(...linhas);
        if (esperandoLinha && filaLinhas.length) {
            const entregar = esperandoLinha;
            esperandoLinha = null;
            entregar(filaLinhas.shift());
        }
    });
}

// Escreve a pergunta e devolve o que foi digitado.
// oculto = true: mostra "*" no lugar de cada caractere.
function perguntar(texto, oculto = false) {

    process.stdout.write(texto);

    // Entrada redirecionada: pega a próxima linha
    if (!process.stdin.isTTY) {
        return new Promise(resolve => {
            const entregar = linha => {
                process.stdout.write((oculto ? "*".repeat(linha.length) : linha) + "\n");
                resolve(linha);
            };
            if (filaLinhas.length) entregar(filaLinhas.shift());
            else esperandoLinha = entregar;
        });
    }

    // Terminal: tecla a tecla
    return new Promise(resolve => {

        let digitado = "";

        process.stdin.setRawMode(true);
        process.stdin.setEncoding("utf8");
        process.stdin.resume();

        function aoDigitar(teclas) {

            for (const tecla of teclas) {

                if (tecla === "\r" || tecla === "\n") {
                    // Enter: termina a pergunta
                    process.stdin.setRawMode(false);
                    process.stdin.pause();
                    process.stdin.removeListener("data", aoDigitar);
                    process.stdout.write("\n");
                    resolve(digitado);
                    return;
                }

                if (tecla === "\u0003") {
                    // Ctrl + C: cancela
                    process.stdin.setRawMode(false);
                    process.stdout.write("\nCancelado.\n");
                    process.exit(1);
                }

                if (tecla === "\u0008" || tecla === "\u007f") {
                    // Backspace: apaga o último caractere da tela também
                    if (digitado.length) {
                        digitado = digitado.slice(0, -1);
                        process.stdout.write("\b \b");
                    }
                    continue;
                }

                // Ignora teclas de controle (setas etc.)
                if (tecla < " ") continue;

                digitado += tecla;
                process.stdout.write(oculto ? "*" : tecla);
            }
        }

        process.stdin.on("data", aoDigitar);
    });
}


async function main() {

    console.log("Definir senha de usuário do admin do Acompanhamento Super Agos\n");

    // Garante que o arquivo de usuários exista (migração / usuário inicial)
    usuarios.inicializarUsuarios();

    console.log("Usuários existentes: " + usuarios.listarUsuarios().map(u => u.usuario).join(", ") + "\n");

    const usuario = usuarios.normalizarUsuario(await perguntar("Usuário: "));

    // Usuário novo: cria antes (com senha provisória, trocada logo abaixo)
    if (!usuarios.buscarUsuario(usuario)) {

        const nome = (await perguntar("Usuário novo. Nome da pessoa: ")).trim();

        const criado = usuarios.criarUsuario(usuario, nome);

        if (criado.erro) throw new Error(criado.erro);
    }

    const senha = await perguntar("Nova senha (mínimo 8 caracteres): ", true);

    if (senha.length < 8) {
        throw new Error("A senha precisa ter pelo menos 8 caracteres.");
    }

    const confirmacao = await perguntar("Repita a senha: ", true);

    if (senha !== confirmacao) {
        throw new Error("As senhas não conferem.");
    }

    // Senha definitiva (não exige troca no próximo acesso)
    const erro = usuarios.definirSenha(usuario, senha);

    if (erro) throw new Error(erro);

    console.log(`\nSenha do usuário "${usuario}" definida (vale na hora).`);
    console.log("Sessões abertas desse usuário continuam até sair ou expirar.");
}

main()
    .catch(erro => {
        console.error("\nERRO: " + erro.message);
        process.exitCode = 1;
    })
    .finally(() => process.stdin.pause()); // libera o terminal
