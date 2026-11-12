/* =====================================================================
   Acompanhamento Super Agos - Tela de admin (PVs e metas)
   ---------------------------------------------------------------------
   Fluxo:
     1) carrega as metas atuais da API (GET /api/admin/metas);
     2) o admin escolhe o mês e sobe a planilha (.xlsx);
     3) a planilha é lida no navegador (biblioteca SheetJS) e conferida:
        erros (bloqueiam), avisos, PVs que entram/saem, totais por categoria;
     4) ao salvar, envia a lista para a API (POST /api/admin/metas),
        que grava dados/metas.json e regera o painel.

   Hoje a gravação é feita pela API local (server.js). Quando o projeto
   for para o GitHub, só a função salvarMetas() muda.
   ===================================================================== */

(function(){

  // ---------- Endereço da API ----------
  // Aberta pela API (http://localhost:3000/admin.html): usa o mesmo endereço.
  // Aberta direto do disco (file://): aponta para a API local.
  var API = location.protocol === 'file:' ? 'http://localhost:3000' : '';

  // ---------- Login ----------
  // A chave de sessão é criada pelo modal de login do painel (js/login.js)
  // e guardada na aba. Sem ela, volta para o painel com o modal aberto.
  var CHAVE_SESSAO = 'superagosAdminChave';
  var chave = null;
  try { chave = sessionStorage.getItem(CHAVE_SESSAO); } catch (x) {}

  function irParaLogin(){
    try { sessionStorage.removeItem(CHAVE_SESSAO); } catch (x) {}
    location.replace('index.html?login=1');
  }
  if (!chave){ irParaLogin(); return; }

  // Cabeçalho enviado em todas as chamadas de admin
  function cabecalhos(extra){
    var h = {'Authorization': 'Bearer ' + chave};
    for (var k in (extra||{})) h[k] = extra[k];
    return h;
  }

  // Botão "Sair": invalida a chave na API e volta para o painel
  document.getElementById('btnSair').addEventListener('click', function(){
    fetch(API + '/api/logout', {method:'POST', headers: cabecalhos()})
      .catch(function(){})
      .then(function(){
        try { sessionStorage.removeItem(CHAVE_SESSAO); } catch (x) {}
        location.href = 'index.html';
      });
  });

  // ---------- Categorias de meta ----------
  // key: chave no metas.json | label: nome exibido e cabeçalho da planilha modelo
  // nomes: cabeçalhos aceitos na planilha (já normalizados: maiúsculas, sem acento)
  var CATS = [
    {key:'refri', label:'REFRIGERANTES', nomes:['REFRIGERANTES','REFRIGERANTE','REFRI']},
    {key:'cerv',  label:'CERVEJAS',      nomes:['CERVEJAS','CERVEJA','CERV']},
    {key:'sucos', label:'SUCOS',         nomes:['SUCOS','SUCO']},
    {key:'pw',    label:'POWERADE',      nomes:['POWERADE','PW']},
    {key:'dest',  label:'DESTILADOS',    nomes:['DESTILADOS','DESTILADO','DEST']}
  ];
  // Cabeçalhos aceitos para a coluna do código do cliente
  var NOMES_PV = ['PV','COD','CODIGO','CLIENTE','COD CLIENTE','CODIGO CLIENTE','CD CLIENTE'];

  var MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  // ---------- Estado da tela ----------
  var atual = null;     // conteúdo do metas.json salvo (vindo da API)
  var nova = null;      // lista lida da planilha: [{pv, meta:{...}}]
  var nomeArquivo = ''; // nome da planilha escolhida
  var erros = [];       // problemas que impedem salvar

  // Atalho para pegar elementos pelo id
  function $(id){ return document.getElementById(id); }

  // =====================================================================
  // FORMATAÇÃO
  // =====================================================================

  // Número no padrão brasileiro com 1 casa (ex.: 1.234,5)
  function fmt(n){
    return (n||0).toLocaleString('pt-BR', {minimumFractionDigits:1, maximumFractionDigits:1});
  }

  // Diferença com sinal (+/-) e cor (mesmas classes do painel)
  function fmtDiff(n){
    var v = Math.round(n*10)/10;
    var cls = v < 0 ? 'diff-neg' : 'diff-pos';
    return '<span class="'+cls+'">'+(v>0?'+':'')+fmt(v)+'</span>';
  }

  // "2026-11" -> "Nov/26"
  function rotuloMes(anoMes){
    if (!anoMes) return '—';
    var p = anoMes.split('-');
    return MESES[Number(p[1])-1] + '/' + p[0].slice(2);
  }

  // Data ISO -> "12/11/2026 09:30"
  function fmtData(iso){
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
  }

  // Evita que textos vindos da planilha virem HTML
  function esc(s){
    return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; });
  }

  // Mostra uma mensagem num bloco .admin-msg (tipo: ok, erro, aviso)
  function mensagem(el, tipo, html){
    el.className = 'admin-msg ' + tipo;
    el.innerHTML = html;
    el.hidden = false;
  }

  // =====================================================================
  // 1. LISTA ATUAL
  // =====================================================================

  function carregarAtual(){
    fetch(API + '/api/admin/metas', {headers: cabecalhos()})
      .then(function(r){
        // Sessão expirada (8 h) ou API reiniciada: pede login de novo
        if (r.status === 401){ irParaLogin(); throw null; }
        if (!r.ok) throw new Error('HTTP '+r.status);
        return r.json();
      })
      .then(function(dados){
        $('main').hidden = false; // login confirmado: mostra a tela
        atual = dados;
        $('badgeAtual').textContent = rotuloMes(dados.mes) + ' · ' + dados.clientes.length + ' PVs';
        $('infoAtual').innerHTML =
          '<b>'+dados.clientes.length+' PVs</b> com metas de <b>'+rotuloMes(dados.mes)+'</b>, ' +
          'salvos em '+fmtData(dados.atualizadoEm)+' ('+esc(dados.origem||'—')+').';
        // Se uma planilha já foi lida, refaz a conferência com a lista atual
        if (nova) conferir();
      })
      .catch(function(e){
        if (e === null) return; // já redirecionou para o login
        // API desligada ou inacessível
        $('main').hidden = false;
        $('msgApi').hidden = false;
        $('infoAtual').textContent = 'Não foi possível carregar a lista atual.';
      });
  }

  // Gera e baixa a planilha com os PVs e metas atuais (serve de modelo)
  $('btnModelo').addEventListener('click', function(){
    var linhas = [['PV'].concat(CATS.map(function(c){ return c.label; }))];
    (atual ? atual.clientes : []).forEach(function(cli){
      linhas.push([Number(cli.pv)].concat(CATS.map(function(c){ return cli.meta[c.key]; })));
    });
    var planilha = XLSX.utils.aoa_to_sheet(linhas);
    var livro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(livro, planilha, 'Metas');
    XLSX.writeFile(livro, 'metas_superagos_' + (atual ? atual.mes : 'modelo') + '.xlsx');
  });

  // =====================================================================
  // 2. LEITURA DA PLANILHA
  // =====================================================================

  // Mês padrão: mês atual
  (function(){
    var h = new Date();
    $('fMes').value = h.getFullYear() + '-' + String(h.getMonth()+1).padStart(2,'0');
  })();

  // Normaliza um cabeçalho: maiúsculas, sem acento, sem "_", sem a palavra META
  // (ex.: "Meta_Refrigerantes" -> "REFRIGERANTES", "Código Cliente" -> "CODIGO CLIENTE")
  function normalizar(txt){
    return String(txt == null ? '' : txt)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().replace(/[_.]/g, ' ')
      .replace(/\bMETA\b/g, '').replace(/\s+/g, ' ').trim();
  }

  // Converte o valor de uma célula em número.
  // Aceita número do Excel, "1.234,5" (padrão BR) e "1234.5". Vazio = 0.
  // Retorna null se não for número.
  function numero(v){
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return v;
    var s = String(v).trim();
    if (s === '') return 0;
    if (s.indexOf(',') !== -1) s = s.replace(/\./g, '').replace(',', '.');
    var n = Number(s);
    return isFinite(n) ? n : null;
  }

  // Converte o código do PV em texto só com dígitos (ex.: 1000853 ou "1000853.0")
  function codigoPV(v){
    if (typeof v === 'number') return String(Math.round(v));
    return String(v == null ? '' : v).trim().replace(/\.0+$/, '');
  }

  // Lê a planilha e devolve {lista, erros, avisos}
  function lerPlanilha(livro){
    var res = {lista: [], erros: [], avisos: []};
    var aba = livro.Sheets[livro.SheetNames[0]]; // primeira aba
    var linhas = XLSX.utils.sheet_to_json(aba, {header:1, raw:true, defval:null});

    // Procura a linha de cabeçalho (a primeira que tenha a coluna do PV);
    // assim a planilha pode ter título/linhas em branco acima
    var iCab = -1, colunas = null;
    for (var i = 0; i < linhas.length && i < 30; i++){
      var nomes = (linhas[i] || []).map(normalizar);
      var colPV = nomes.findIndex(function(n){ return NOMES_PV.indexOf(n) !== -1; });
      if (colPV !== -1){
        iCab = i;
        colunas = {pv: colPV};
        CATS.forEach(function(c){
          colunas[c.key] = nomes.findIndex(function(n){ return c.nomes.indexOf(n) !== -1; });
        });
        break;
      }
    }

    if (iCab === -1){
      res.erros.push('Cabeçalho não encontrado: a planilha precisa de uma coluna "PV".');
      return res;
    }
    CATS.forEach(function(c){
      if (colunas[c.key] === -1) res.erros.push('Coluna "'+c.label+'" não encontrada na planilha.');
    });
    if (res.erros.length) return res;

    var vistos = {};
    for (var j = iCab + 1; j < linhas.length; j++){
      var linha = linhas[j] || [];
      var nLinha = j + 1; // número da linha no Excel

      // Linha totalmente vazia: ignora
      if (!linha.some(function(v){ return v !== null && String(v).trim() !== ''; })) continue;

      var pv = codigoPV(linha[colunas.pv]);
      if (!/^\d+$/.test(pv)){
        res.erros.push('Linha '+nLinha+': PV inválido ou vazio ("'+esc(pv)+'").');
        continue;
      }
      if (vistos[pv]){
        res.erros.push('PV '+pv+' repetido (linhas '+vistos[pv]+' e '+nLinha+').');
        continue;
      }
      vistos[pv] = nLinha;

      var meta = {}, zerado = true;
      CATS.forEach(function(c){
        var v = numero(linha[colunas[c.key]]);
        if (v === null){
          res.erros.push('Linha '+nLinha+' (PV '+pv+'): valor de '+c.label+' não é número ("'+esc(linha[colunas[c.key]])+'").');
          v = 0;
        } else if (v < 0){
          res.erros.push('Linha '+nLinha+' (PV '+pv+'): meta de '+c.label+' negativa.');
        }
        meta[c.key] = Math.round(v*10000)/10000;
        if (v > 0) zerado = false;
      });
      if (zerado) res.avisos.push(pv);

      res.lista.push({pv: pv, meta: meta});
    }

    if (!res.lista.length && !res.erros.length) res.erros.push('Nenhum PV encontrado abaixo do cabeçalho.');
    return res;
  }

  // Ao escolher o arquivo: lê, guarda e confere
  $('fArquivo').addEventListener('change', function(){
    var arq = this.files[0];
    if (!arq) return;
    nomeArquivo = arq.name;
    var leitor = new FileReader();
    leitor.onload = function(e){
      var lido;
      try {
        lido = lerPlanilha(XLSX.read(new Uint8Array(e.target.result), {type:'array'}));
      } catch (err) {
        lido = {lista: [], erros: ['Não foi possível ler o arquivo: '+esc(err.message)], avisos: []};
      }
      nova = lido.lista;
      erros = lido.erros;
      avisosZerados = lido.avisos;
      conferir();
    };
    leitor.readAsArrayBuffer(arq);
  });

  var avisosZerados = []; // PVs com todas as metas zeradas (aviso, não bloqueia)

  // =====================================================================
  // 3. CONFERÊNCIA
  // =====================================================================

  var situacoes = []; // linhas da lista de conferência (novos, alterados, iguais e que saem)

  function conferir(){
    $('secConferencia').hidden = false;
    $('secSalvar').hidden = false;
    $('msgSalvar').hidden = true;

    // ---------- Erros e avisos ----------
    if (erros.length){
      mensagem($('msgErros'), 'erro', '<b>'+erros.length+' erro(s) — corrija a planilha e suba novamente:</b><ul>' +
        erros.slice(0, 30).map(function(e){ return '<li>'+e+'</li>'; }).join('') +
        (erros.length > 30 ? '<li>... e mais '+(erros.length-30)+'</li>' : '') + '</ul>');
    } else {
      $('msgErros').hidden = true;
    }
    var avisos = [];
    if (avisosZerados.length) avisos.push(avisosZerados.length+' PV(s) com todas as metas zeradas: '+avisosZerados.slice(0,20).join(', ')+(avisosZerados.length>20?'...':''));
    if (atual && $('fMes').value === atual.mes) avisos.push('O mês escolhido ('+rotuloMes(atual.mes)+') é o mesmo da lista atual: ela será substituída.');
    // (o aviso de PVs que saem é incluído logo abaixo, depois da comparação)

    // ---------- Comparação com a lista atual ----------
    var mapaAtual = {};
    (atual ? atual.clientes : []).forEach(function(c){ mapaAtual[c.pv] = c.meta; });
    var mapaNova = {};
    (nova || []).forEach(function(c){ mapaNova[c.pv] = c.meta; });

    situacoes = [];
    var qNovo = 0, qAlterado = 0, qIgual = 0, qSai = 0;
    (nova || []).forEach(function(c){
      var antes = mapaAtual[c.pv], sit;
      if (!antes){ sit = 'novo'; qNovo++; }
      else if (CATS.some(function(k){ return Math.abs((antes[k.key]||0) - c.meta[k.key]) > 0.00005; })){ sit = 'alterado'; qAlterado++; }
      else { sit = 'igual'; qIgual++; }
      situacoes.push({pv: c.pv, sit: sit, meta: c.meta, antes: antes});
    });
    Object.keys(mapaAtual).forEach(function(pv){
      if (!mapaNova[pv]){ qSai++; situacoes.push({pv: pv, sit: 'sai', meta: mapaAtual[pv]}); }
    });

    // Aviso de PVs que saem: evita apagar a lista sem querer
    // (ex.: planilha incompleta ou só com os PVs novos)
    if (qSai > 0){
      avisos.unshift('<b>'+qSai+' PV(s) da lista atual não estão na planilha e vão sair do painel.</b> ' +
        'Confira em "Situação: Saem da lista" antes de salvar.');
    }
    if (avisos.length) mensagem($('msgAvisos'), 'aviso', avisos.join('<br>')); else $('msgAvisos').hidden = true;

    // ---------- Cards de quantidades ----------
    function card(rotulo, valor, cls){
      return '<div class="summary-card"><div class="summary-label">'+rotulo+'</div><div class="summary-value '+(cls||'')+'">'+valor+'</div></div>';
    }
    $('resumoConferencia').innerHTML =
      '<div class="summary-card total"><div class="summary-label">PVs na planilha · '+rotuloMes($('fMes').value)+'</div><div class="summary-value">'+(nova||[]).length+'</div></div>' +
      card('Entram (novos)', qNovo, qNovo ? 'good' : '') +
      card('Saem da lista', qSai, qSai ? 'bad' : '') +
      card('Meta alterada', qAlterado) +
      card('Sem alteração', qIgual);

    // ---------- Totais por categoria (atual x nova) ----------
    $('tbodyTotais').innerHTML = CATS.map(function(c){
      var tA = 0, tN = 0;
      Object.keys(mapaAtual).forEach(function(pv){ tA += mapaAtual[pv][c.key]||0; });
      (nova||[]).forEach(function(x){ tN += x.meta[c.key]; });
      return '<tr><td class="name-cell"><b>'+c.label.charAt(0)+c.label.slice(1).toLowerCase()+'</b></td><td>'+fmt(tA)+'</td><td>'+fmt(tN)+'</td><td>'+fmtDiff(tN-tA)+'</td></tr>';
    }).join('');

    desenharLista();

    // Só permite salvar se a planilha não tiver erros e tiver PVs
    $('btnSalvar').disabled = erros.length > 0 || !(nova && nova.length) || !$('fMes').value;
  }

  // Tabela de PVs, com filtros de busca e situação
  var ROTULO_SIT = {novo:'Entra', alterado:'Meta alterada', igual:'Sem alteração', sai:'Sai da lista'};
  function desenharLista(){
    var busca = $('fBuscaPV').value.trim();
    var filtro = $('fSituacao').value;
    var lista = situacoes.filter(function(s){
      return (!filtro || s.sit === filtro) && (!busca || s.pv.indexOf(busca) !== -1);
    });
    $('tbodyLista').innerHTML = lista.slice(0, 500).map(function(s){
      return '<tr class="sit-'+s.sit+'"><td class="name-cell"><b>'+s.pv+'</b></td>' +
        '<td><span class="admin-tag '+s.sit+'">'+ROTULO_SIT[s.sit]+'</span></td>' +
        CATS.map(function(c){
          // Meta alterada: mostra o valor anterior abaixo do novo
          var mudou = s.sit === 'alterado' && Math.abs((s.antes[c.key]||0) - s.meta[c.key]) > 0.00005;
          return '<td>'+fmt(s.meta[c.key])+(mudou ? '<div class="admin-antes">antes '+fmt(s.antes[c.key])+'</div>' : '')+'</td>';
        }).join('') + '</tr>';
    }).join('');
    $('contagemLista').textContent = lista.length + ' PV(s)' + (lista.length > 500 ? ' (exibindo os 500 primeiros; use a busca)' : '') + '.';
  }
  $('fBuscaPV').addEventListener('input', desenharLista);
  $('fSituacao').addEventListener('change', desenharLista);
  // Trocar o mês refaz a conferência (aviso de mês igual e rótulo do card)
  $('fMes').addEventListener('change', function(){ if (nova) conferir(); });

  // =====================================================================
  // 4. SALVAR
  // =====================================================================

  // Envia a lista para a API, que grava dados/metas.json e regera o painel.
  // (No GitHub, esta função passará a gravar o arquivo no repositório.)
  function salvarMetas(conteudo){
    return fetch(API + '/api/admin/metas', {
      method: 'POST',
      headers: cabecalhos({'Content-Type': 'application/json'}),
      body: JSON.stringify(conteudo)
    }).then(function(r){
      // Sessão expirou durante o uso: avisa (a planilha precisará ser subida de novo)
      if (r.status === 401){
        alert('Sua sessão expirou. Faça login novamente e suba a planilha de novo.');
        irParaLogin();
        throw {mensagem: 'Sessão expirada.'};
      }
      return r.json().then(function(corpo){
        if (!r.ok) throw corpo;
        return corpo;
      });
    });
  }

  $('btnSalvar').addEventListener('click', function(){
    var mes = $('fMes').value;
    var texto = 'Substituir a lista atual' + (atual ? ' ('+atual.clientes.length+' PVs de '+rotuloMes(atual.mes)+')' : '') +
                ' por ' + nova.length + ' PVs com metas de ' + rotuloMes(mes) + '?';
    if (!confirm(texto)) return;

    var botao = this;
    botao.disabled = true;
    mensagem($('msgSalvar'), 'aviso', 'Salvando e atualizando o painel com os dados do SAP... aguarde.');

    salvarMetas({mes: mes, origem: 'admin: ' + nomeArquivo, clientes: nova})
      .then(function(r){
        var html = '<b>'+esc(r.mensagem)+'</b>';
        if (r.resumo){
          html += '<br>'+r.resumo.clientes+' clientes no painel · '+r.resumo.comVenda+' com venda no mês · real atualizado até '+esc(r.resumo.realAsOf)+'.';
          if (r.resumo.naoEncontradosNoCadastro.length){
            html += '<br>PVs não encontrados no cadastro do SAP (confira o código): '+r.resumo.naoEncontradosNoCadastro.join(', ');
          }
          html += '<br><a href="index.html">Abrir o painel &rarr;</a>';
        }
        mensagem($('msgSalvar'), r.status === 'sucesso' ? 'ok' : 'aviso', html);
        // Recarrega a lista atual (agora é a que acabou de ser salva)
        carregarAtual();
      })
      .catch(function(e){
        var html = '<b>Erro ao salvar:</b> ' + esc((e && e.mensagem) || (e && e.message) || 'API indisponível.');
        if (e && e.erros) html += '<ul>' + e.erros.map(function(x){ return '<li>'+esc(x)+'</li>'; }).join('') + '</ul>';
        mensagem($('msgSalvar'), 'erro', html);
        botao.disabled = false;
      });
  });

  // =====================================================================
  // ALTERAR SENHA
  // =====================================================================
  // obrigatorio = true: primeiro acesso com a senha inicial. O modal não
  // pode ser fechado e, depois da troca, a tela é liberada.
  var senhaObrigatoria = false;

  function abrirModalSenha(obrigatorio){
    senhaObrigatoria = obrigatorio;
    $('senhaForm').reset();
    $('senhaErro').hidden = true;
    $('senhaTitulo').textContent = obrigatorio ? 'Defina sua nova senha' : 'Alterar senha';
    $('senhaTexto').textContent = obrigatorio
      ? 'Sua senha é provisória: por segurança, crie a sua própria senha antes de usar o admin.'
      : 'Informe a senha atual e a nova senha.';
    // No modo obrigatório não há como fechar
    $('senhaFechar').hidden = obrigatorio;
    $('senhaCancelar').hidden = obrigatorio;
    $('senhaModal').hidden = false;
    $('senhaAtual').focus();
  }
  function fecharModalSenha(){
    if (!senhaObrigatoria) $('senhaModal').hidden = true;
  }

  $('btnSenha').addEventListener('click', function(){ abrirModalSenha(false); });
  $('senhaFechar').addEventListener('click', fecharModalSenha);
  $('senhaCancelar').addEventListener('click', fecharModalSenha);
  $('senhaModal').addEventListener('click', function(e){ if (e.target === this) fecharModalSenha(); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && !$('senhaModal').hidden) fecharModalSenha(); });

  $('senhaForm').addEventListener('submit', function(e){
    e.preventDefault();
    var erroEl = $('senhaErro');
    erroEl.hidden = true;

    // Conferência rápida na tela (a API confere de novo)
    if ($('senhaNova').value !== $('senhaRepetir').value){
      erroEl.textContent = 'A nova senha e a repetição não conferem.';
      erroEl.hidden = false;
      return;
    }

    var botao = $('senhaSalvar');
    botao.disabled = true;

    fetch(API + '/api/admin/senha', {
      method: 'POST',
      headers: cabecalhos({'Content-Type': 'application/json'}),
      body: JSON.stringify({senhaAtual: $('senhaAtual').value, novaSenha: $('senhaNova').value})
    })
      .then(function(r){
        if (r.status === 401){ irParaLogin(); throw null; }
        return r.json().then(function(corpo){
          if (!r.ok) throw new Error(corpo.mensagem || ('Erro ' + r.status));
          return corpo;
        });
      })
      .then(function(){
        var eraObrigatoria = senhaObrigatoria;
        senhaObrigatoria = false;
        $('senhaModal').hidden = true;
        if (eraObrigatoria){
          // Primeiro acesso concluído: libera a tela
          carregarAtual();
          carregarUsuarios();
        } else {
          alert('Senha alterada com sucesso.');
        }
      })
      .catch(function(x){
        if (x === null) return;
        erroEl.textContent = /fetch|network/i.test(x.message) ? 'Não foi possível conectar à API.' : x.message;
        erroEl.hidden = false;
      })
      .then(function(){ botao.disabled = false; });
  });

  // =====================================================================
  // USUÁRIOS
  // =====================================================================
  var meuUsuario = ''; // quem está logado (não pode resetar/excluir a si mesmo)

  // Chamada genérica às rotas de usuários: devolve o JSON ou lança Error(mensagem)
  function chamarApi(metodo, rota, corpo){
    return fetch(API + rota, {
      method: metodo,
      headers: cabecalhos(corpo ? {'Content-Type': 'application/json'} : {}),
      body: corpo ? JSON.stringify(corpo) : undefined
    }).then(function(r){
      if (r.status === 401){ irParaLogin(); throw new Error('Sessão expirada.'); }
      return r.json().then(function(j){
        if (!r.ok) throw new Error(j.mensagem || ('Erro ' + r.status));
        return j;
      });
    });
  }

  // Carrega e desenha a tabela de usuários
  function carregarUsuarios(){
    chamarApi('GET', '/api/admin/usuarios').then(function(r){
      $('tbodyUsuarios').innerHTML = r.usuarios.map(function(u){
        var eu = u.usuario === meuUsuario;
        var situacao = u.senhaProvisoria
          ? '<span class="admin-tag alterado">Senha provisória</span>'
          : '<span class="admin-tag novo">Ativo</span>';
        // Ações: não aparecem na linha do próprio usuário
        var acoes = eu
          ? '<span class="admin-antes">você</span>'
          : '<button class="reset-btn admin-acao" data-reset="'+esc(u.usuario)+'" type="button">Resetar senha</button> ' +
            '<button class="reset-btn admin-acao perigo" data-excluir="'+esc(u.usuario)+'" type="button">Excluir</button>';
        return '<tr><td class="name-cell"><b>'+esc(u.usuario)+'</b></td>' +
          '<td>'+esc(u.nome)+'</td><td>'+situacao+'</td>' +
          '<td>'+(u.ultimoAcesso ? fmtData(u.ultimoAcesso) : 'nunca')+'</td>' +
          '<td>'+acoes+'</td></tr>';
      }).join('');
    }).catch(function(e){
      $('tbodyUsuarios').innerHTML = '<tr><td colspan="5">'+esc(e.message)+'</td></tr>';
    });
  }

  // Mostra a senha provisória (usuário novo ou reset) uma única vez
  function mostrarProvisoria(texto, senha){
    $('provisoriaTexto').textContent = texto;
    $('provisoriaSenha').textContent = senha;
    $('provisoriaCopiar').textContent = 'Copiar';
    $('provisoriaModal').hidden = false;
  }
  $('provisoriaCopiar').addEventListener('click', function(){
    var botao = this;
    navigator.clipboard.writeText($('provisoriaSenha').textContent)
      .then(function(){ botao.textContent = 'Copiado!'; })
      .catch(function(){ botao.textContent = 'Selecione e copie manualmente'; });
  });
  $('provisoriaOk').addEventListener('click', function(){
    $('provisoriaSenha').textContent = ''; // apaga da tela
    $('provisoriaModal').hidden = true;
  });

  // Botões Resetar / Excluir de cada linha (um único "ouvinte" na tabela)
  $('tbodyUsuarios').addEventListener('click', function(e){
    var reset = e.target.getAttribute('data-reset');
    var excluir = e.target.getAttribute('data-excluir');

    if (reset){
      if (!confirm('Gerar uma nova senha provisória para "'+reset+'"?\nA senha atual dele deixa de funcionar.')) return;
      chamarApi('POST', '/api/admin/usuarios/'+encodeURIComponent(reset)+'/reset')
        .then(function(r){
          mostrarProvisoria('Nova senha provisória do usuário "'+reset+'":', r.senhaProvisoria);
          carregarUsuarios();
        })
        .catch(function(x){ alert(x.message); });
    }

    if (excluir){
      if (!confirm('Excluir o usuário "'+excluir+'"? Ele não conseguirá mais entrar no admin.')) return;
      chamarApi('DELETE', '/api/admin/usuarios/'+encodeURIComponent(excluir))
        .then(carregarUsuarios)
        .catch(function(x){ alert(x.message); });
    }
  });

  // ---------- Modal "Novo usuário" ----------
  $('btnNovoUsuario').addEventListener('click', function(){
    $('usuarioForm').reset();
    $('usuarioErro').hidden = true;
    $('usuarioModal').hidden = false;
    $('novoUsuario').focus();
  });
  // Botões com data-fechar (× e Cancelar) e clique no fundo fecham o modal
  Array.prototype.forEach.call(document.querySelectorAll('#usuarioModal [data-fechar]'), function(b){
    b.addEventListener('click', function(){ $('usuarioModal').hidden = true; });
  });
  $('usuarioModal').addEventListener('click', function(e){ if (e.target === this) this.hidden = true; });

  $('usuarioForm').addEventListener('submit', function(e){
    e.preventDefault();
    var usuario = $('novoUsuario').value.trim().toLowerCase();
    var botao = $('usuarioSalvar');
    botao.disabled = true;
    chamarApi('POST', '/api/admin/usuarios', {usuario: usuario, nome: $('novoNome').value})
      .then(function(r){
        $('usuarioModal').hidden = true;
        mostrarProvisoria('Usuário "'+usuario+'" criado. Senha provisória:', r.senhaProvisoria);
        carregarUsuarios();
      })
      .catch(function(x){
        $('usuarioErro').textContent = x.message;
        $('usuarioErro').hidden = false;
      })
      .then(function(){ botao.disabled = false; });
  });

  // =====================================================================
  // INÍCIO
  // =====================================================================
  // Confere a sessão: sem login volta ao painel; com a senha inicial
  // abre a troca obrigatória; senão carrega a lista atual.
  fetch(API + '/api/admin/sessao', {headers: cabecalhos()})
    .then(function(r){
      if (r.status === 401){ irParaLogin(); throw null; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(sessao){
      // Mostra quem está logado no cabeçalho
      // (se a API for uma versão antiga, sem esses dados, o selo fica escondido)
      meuUsuario = sessao.usuario || '';
      if (sessao.usuario){
        // Só o nome da pessoa (o login aparece apenas se o nome estiver vazio)
        $('badgeUsuarioNome').textContent = sessao.nome || sessao.usuario;
        $('badgeUsuario').hidden = false;
      }
      // Campo escondido do modal de senha: ajuda o gerenciador de senhas do navegador
      var campoUsuario = document.querySelector('#senhaForm input[name=username]');
      if (campoUsuario) campoUsuario.value = sessao.usuario;

      if (sessao.trocarSenha) abrirModalSenha(true);
      else { carregarAtual(); carregarUsuarios(); }
    })
    .catch(function(e){
      if (e === null) return;
      // API desligada ou inacessível
      $('main').hidden = false;
      $('msgApi').hidden = false;
    });

})();
