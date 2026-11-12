/* =====================================================================
   Acompanhamento Super Agos - Modal de login do admin
   ---------------------------------------------------------------------
   - O botão "Admin" do cabeçalho abre o modal (em vez de ir direto
     para admin.html).
   - Usuário e senha são enviados para a API (POST /api/login), que
     confere a senha. A página não conhece a senha.
   - Login certo: a chave de sessão é guardada na aba (sessionStorage)
     e o admin.html é aberto. Ela vale 8 horas ou até clicar em "Sair".
   - index.html?login=1 já abre com o modal (usado pelo admin.html
     quando a sessão expira).
   - No link publicado (GitHub Pages) não existe a API: o modal pede a
     chave de acesso do GitHub, conferida em js/github.js e guardada no
     navegador (localStorage).
   ===================================================================== */

(function(){

  // Aberto pela API (http://...): mesmo endereço. Direto do disco: API local.
  var API = location.protocol === 'file:' ? 'http://localhost:3000' : '';

  // Nome da chave de sessão no sessionStorage (o admin.js usa o mesmo)
  var CHAVE_SESSAO = 'superagosAdminChave';

  var modal = document.getElementById('loginModal');
  var form = document.getElementById('loginForm');
  var usuario = document.getElementById('loginUsuario');
  var senha = document.getElementById('loginSenha');
  var erro = document.getElementById('loginErro');
  var botaoEntrar = document.getElementById('loginEntrar');

  // ---------- Link publicado (GitHub Pages): login pelo GitHub ----------
  // Lá não existe a nossa API. O modal pede a chave de acesso (token)
  // do GitHub no lugar de usuário e senha (ver js/github.js).
  var GH = window.SuperAgosGitHub;
  var modoGitHub = !!(GH && GH.ativo);

  if (modoGitHub){
    // Esconde o campo "Usuário" (o GitHub já sabe quem é pela chave)
    usuario.required = false;
    usuario.closest('.field').style.display = 'none'; // (o CSS de .field define display)
    // Campo da senha vira o campo da chave
    document.querySelector('label[for="loginSenha"]').textContent = 'Chave de acesso do GitHub (token)';
    senha.autocomplete = 'off';
    senha.placeholder = 'github_pat_... ou ghp_...';
    modal.querySelector('.modal-texto').textContent =
      'Cole a sua chave de acesso do GitHub. Ela fica salva só neste navegador ' +
      'e só funciona para quem é colaborador do repositório.';
  }

  // ---------- Abrir / fechar ----------
  function abrir(){
    erro.hidden = true;
    senha.value = '';
    modal.hidden = false;
    (modoGitHub ? senha : usuario).focus();
  }
  function fechar(){
    modal.hidden = true;
  }

  // Botão "Admin": abre o modal em vez de navegar.
  // No link publicado, se a chave já está salva neste navegador,
  // vai direto (o admin confere a chave ao abrir).
  document.getElementById('btnAdmin').addEventListener('click', function(e){
    if (modoGitHub && GH.lerToken()) return; // segue o link para admin.html
    e.preventDefault();
    abrir();
  });

  document.getElementById('loginFechar').addEventListener('click', fechar);
  document.getElementById('loginCancelar').addEventListener('click', fechar);

  // Clicar fora da caixa (no fundo escuro) fecha
  modal.addEventListener('click', function(e){ if (e.target === modal) fechar(); });

  // Tecla Esc fecha
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && !modal.hidden) fechar(); });

  // ---------- Entrar ----------
  function mostrarErro(texto){
    erro.textContent = texto;
    erro.hidden = false;
  }

  // Botão volta ao normal depois de uma tentativa
  function liberarBotao(){
    botaoEntrar.disabled = false;
    botaoEntrar.textContent = 'Entrar';
  }

  form.addEventListener('submit', function(e){
    e.preventDefault(); // não recarrega a página
    erro.hidden = true;
    botaoEntrar.disabled = true;
    botaoEntrar.textContent = 'Entrando...';

    // Link publicado: confere a chave no GitHub e guarda no navegador
    if (modoGitHub){
      var token = senha.value.trim();
      GH.validarChave(token)
        .then(function(){
          GH.salvarToken(token);
          location.href = 'admin.html';
        })
        .catch(function(x){
          mostrarErro(x.message);
          senha.value = '';
          senha.focus();
        })
        .then(liberarBotao);
      return;
    }

    // API local: usuário e senha
    fetch(API + '/api/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({usuario: usuario.value, senha: senha.value})
    })
      .then(function(r){
        return r.json().then(function(corpo){
          if (!r.ok) throw new Error(corpo.mensagem || ('Erro ' + r.status));
          return corpo;
        });
      })
      .then(function(corpo){
        // Guarda a chave na aba e abre o admin
        try { sessionStorage.setItem(CHAVE_SESSAO, corpo.chave); } catch (x) {}
        location.href = 'admin.html';
      })
      .catch(function(x){
        // "Failed to fetch" = API desligada/inacessível
        var msg = /fetch|network/i.test(x.message)
          ? 'Não foi possível conectar à API. Verifique se ela está rodando (cd api, node server.js).'
          : x.message;
        mostrarErro(msg);
        senha.value = '';
        senha.focus();
      })
      .then(liberarBotao);
  });

  // ---------- Abrir automaticamente (index.html?login=1) ----------
  if (/[?&]login=1\b/.test(location.search)) abrir();

})();
