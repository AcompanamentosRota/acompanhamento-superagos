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
   ===================================================================== */

(function(){

  // Aberto pela API (http://...): mesmo endereço. Direto do disco: API local.
  var API = location.protocol === 'file:' ? 'http://localhost:3000' : '';

  // Nome da chave de sessão no sessionStorage (o admin.js usa o mesmo)
  var CHAVE_SESSAO = 'superagosAdminChave';

  // Painel publicado no GitHub Pages (link do time comercial): lá não
  // existe API, então o admin não funciona. Esconde o botão e para aqui.
  // O admin continua acessível pela API local (http://localhost:3000).
  if (/\.github\.io$/i.test(location.hostname)) {
    // style.display (e não "hidden"): o CSS do botão define display
    document.getElementById('btnAdmin').style.display = 'none';
    return;
  }

  var modal = document.getElementById('loginModal');
  var form = document.getElementById('loginForm');
  var usuario = document.getElementById('loginUsuario');
  var senha = document.getElementById('loginSenha');
  var erro = document.getElementById('loginErro');
  var botaoEntrar = document.getElementById('loginEntrar');

  // ---------- Abrir / fechar ----------
  function abrir(){
    erro.hidden = true;
    senha.value = '';
    modal.hidden = false;
    usuario.focus();
  }
  function fechar(){
    modal.hidden = true;
  }

  // Botão "Admin": abre o modal em vez de navegar
  document.getElementById('btnAdmin').addEventListener('click', function(e){
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

  form.addEventListener('submit', function(e){
    e.preventDefault(); // não recarrega a página
    erro.hidden = true;
    botaoEntrar.disabled = true;
    botaoEntrar.textContent = 'Entrando...';

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
      .then(function(){
        botaoEntrar.disabled = false;
        botaoEntrar.textContent = 'Entrar';
      });
  });

  // ---------- Abrir automaticamente (index.html?login=1) ----------
  if (/[?&]login=1\b/.test(location.search)) abrir();

})();
