/* =====================================================================
   Acompanhamento Super Agos - Comunicação com o GitHub (admin online)
   ---------------------------------------------------------------------
   No link publicado (GitHub Pages) não existe a nossa API. Por isso o
   admin online fala direto com a API do GitHub, usando a CHAVE DE
   ACESSO (token) do GitHub de quem está usando:

     - validarChave()  -> confere a chave e devolve o nome da pessoa;
     - lerMetas()      -> lê o dados/metas.json do repositório;
     - gravarMetas()   -> grava o dados/metas.json (um commit).

   Cada gravação é um commit no repositório, e o commit dispara o
   workflow "Atualizar painel", que consulta o SAP e publica o painel
   em ~2 minutos.

   A chave fica guardada SÓ no navegador da pessoa (localStorage) e é
   enviada apenas para api.github.com. Quem não tem acesso de escrita
   ao repositório não consegue gravar nada, mesmo abrindo a tela.

   Usado por js/login.js (modal do painel) e js/admin.js.
   ===================================================================== */

var SuperAgosGitHub = (function(){

  // Repositório e arquivo de metas
  var REPO = 'AcompanamentosRota/acompanhamento-superagos';
  var BRANCH = 'main';
  var ARQUIVO_METAS = 'dados/metas.json';
  var API = 'https://api.github.com';

  // Nome da chave no localStorage do navegador
  var CHAVE_TOKEN = 'superagosGitHubToken';

  // true = página aberta pelo link publicado (GitHub Pages).
  // Nesse caso o admin usa o GitHub; na API local, usa a API.
  var ativo = /\.github\.io$/i.test(location.hostname);

  // ---------- Guardar / ler / apagar a chave ----------
  function lerToken(){
    try { return localStorage.getItem(CHAVE_TOKEN) || ''; } catch (x) { return ''; }
  }
  function salvarToken(token){
    try { localStorage.setItem(CHAVE_TOKEN, token); } catch (x) {}
  }
  function apagarToken(){
    try { localStorage.removeItem(CHAVE_TOKEN); } catch (x) {}
  }

  // ---------- Chamada à API do GitHub ----------
  // Devolve o JSON da resposta ou lança um Error com mensagem em
  // português (erro.status = código HTTP).
  function chamar(metodo, caminho, token, corpo){
    return fetch(API + caminho, {
      method: metodo,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
      cache: 'no-store' // sempre a versão mais nova (sem cache do navegador)
    }).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(json){
        if (r.ok) return json;
        var msg = {
          401: 'Chave do GitHub inválida ou expirada. Gere uma nova chave.',
          403: 'Sua chave do GitHub não tem permissão de escrita neste repositório.',
          404: 'Sua chave do GitHub não tem acesso a este repositório.',
          409: 'As metas foram alteradas por outra pessoa ao mesmo tempo. Recarregue a página e suba a planilha de novo.',
          422: 'As metas foram alteradas por outra pessoa ao mesmo tempo. Recarregue a página e suba a planilha de novo.'
        }[r.status] || ('Erro do GitHub (' + r.status + '): ' + (json.message || 'sem detalhe'));
        var erro = new Error(msg);
        erro.status = r.status;
        throw erro;
      });
    }, function(){
      // Falha de rede (sem internet, bloqueio de proxy...)
      throw new Error('Não foi possível conectar ao GitHub. Verifique a internet.');
    });
  }

  // ---------- Texto <-> base64 (com acentos, UTF-8) ----------
  // A API do GitHub envia e recebe o conteúdo dos arquivos em base64.
  function paraBase64(texto){
    var bytes = new TextEncoder().encode(texto);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function deBase64(b64){
    var bin = atob(String(b64).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // ---------- Validar a chave ----------
  // Confere se a chave funciona e se a pessoa pode gravar no repositório.
  // Devolve {login, nome}.
  function validarChave(token){
    return Promise.all([
      chamar('GET', '/user', token),
      chamar('GET', '/repos/' + REPO, token)
    ]).then(function(r){
      var usuario = r[0], repo = r[1];
      if (!repo.permissions || !repo.permissions.push){
        throw new Error('Seu usuário do GitHub (' + usuario.login + ') não tem permissão de escrita neste repositório. ' +
                        'Peça ao responsável para adicionar você como colaborador.');
      }
      return {login: usuario.login, nome: usuario.name || usuario.login};
    });
  }

  // ---------- Ler as metas ----------
  // Devolve {dados: conteúdo do metas.json, sha: versão do arquivo}.
  // O "sha" é exigido pelo GitHub para substituir o arquivo depois.
  function lerMetas(token){
    return chamar('GET', '/repos/' + REPO + '/contents/' + ARQUIVO_METAS + '?ref=' + BRANCH, token)
      .then(function(arq){
        return {dados: JSON.parse(deBase64(arq.content)), sha: arq.sha};
      });
  }

  // ---------- Montar o texto do metas.json ----------
  // Mesmo formato gravado pela API local (api/metas.js): um cliente por
  // linha, para o histórico do GitHub mostrar exatamente o que mudou.
  var CATEGORIAS = ['refri', 'cerv', 'sucos', 'pw', 'dest'];

  function montarArquivo(dados){
    var linhas = dados.clientes.map(function(c){
      var meta = {};
      CATEGORIAS.forEach(function(k){ meta[k] = c.meta[k]; });
      return '    ' + JSON.stringify({pv: String(c.pv), meta: meta});
    });
    return '{\n' +
      '  "mes": ' + JSON.stringify(dados.mes) + ',\n' +
      '  "atualizadoEm": ' + JSON.stringify(new Date().toISOString()) + ',\n' +
      '  "origem": ' + JSON.stringify(dados.origem || 'admin') + ',\n' +
      '  "clientes": [\n' +
      linhas.join(',\n') + '\n' +
      '  ]\n' +
      '}\n';
  }

  // ---------- Gravar as metas ----------
  // dados = {mes, origem, clientes}; sha = versão lida em lerMetas().
  // Se outra pessoa salvou no meio do caminho, o GitHub recusa (409/422)
  // em vez de sobrescrever.
  function gravarMetas(token, dados, sha, autor){
    return chamar('PUT', '/repos/' + REPO + '/contents/' + ARQUIVO_METAS, token, {
      message: 'Metas ' + dados.mes + ': ' + dados.clientes.length + ' PVs (admin online, por ' + autor + ')',
      content: paraBase64(montarArquivo(dados)),
      branch: BRANCH,
      sha: sha
    });
  }

  return {
    ativo: ativo,
    REPO: REPO,
    // Página de execuções do workflow (para acompanhar a atualização)
    URL_EXECUCOES: 'https://github.com/' + REPO + '/actions',
    lerToken: lerToken,
    salvarToken: salvarToken,
    apagarToken: apagarToken,
    validarChave: validarChave,
    lerMetas: lerMetas,
    gravarMetas: gravarMetas
  };

})();
