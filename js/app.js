/* =====================================================================
   Acompanhamento Super Agos - Lógica do painel
   ---------------------------------------------------------------------
   Responsável por:
     - preencher os filtros (Gerência -> Supervisão -> Rota) em cascata;
     - criar as abas de categoria e a alternância cliente/rede;
     - calcular meta, realizado e % de atingimento;
     - desenhar os cards de resumo e a tabela.

   Toda a montagem fica dentro de iniciarPainel(DATA), que recebe os dados
   como parâmetro. Hoje os dados vêm de js/dados.js; na etapa 2 virão da API,
   bastando chamar iniciarPainel com a resposta dela.
   ===================================================================== */

/**
 * Monta o painel completo a partir dos dados recebidos.
 * @param {Object} DATA - objeto no formato descrito em js/dados.js
 *                        ({ mesMeta, mesReal, realAsOf, geradoEm, rows: [...] }).
 */
function iniciarPainel(DATA){

  // ---------- Categorias de produto ----------
  // 'key' é o nome do campo dentro de meta/real; 'label' é o texto exibido na aba.
  // 'geral' não existe nos dados: é a soma das demais categorias.
  var CATS = [
    {key:'refri', label:'Refrigerantes'},
    {key:'cerv', label:'Cervejas'},
    {key:'sucos', label:'Sucos'},
    {key:'pw', label:'Powerade'},
    {key:'dest', label:'Destilados'},
    {key:'geral', label:'Geral'}
  ];
  // Atalho para obter o nome da categoria pela chave (ex.: CATLABEL.refri -> 'Refrigerantes')
  var CATLABEL = {}; CATS.forEach(function(c){ CATLABEL[c.key]=c.label; });

  // ---------- Selos do cabeçalho e rodapé ----------
  document.getElementById('badgeMeta').textContent = DATA.mesMeta;
  document.getElementById('badgeReal').textContent = DATA.mesReal;
  // O selo "Real atualizado até" só aparece se a informação existir
  if (DATA.realAsOf){
    document.getElementById('badgeAsOfValue').textContent = DATA.realAsOf;
    document.getElementById('badgeAsOf').hidden = false;
  }
  if (DATA.geradoEm){
    document.getElementById('footGeradoEm').textContent = ' Painel republicado em ' + DATA.geradoEm + '.';
  }

  // Lista de clientes (uma linha por cliente com acordo fechado)
  var rows = DATA.rows;

  // =====================================================================
  // FUNÇÕES DE CÁLCULO E FORMATAÇÃO
  // =====================================================================

  // Formata número no padrão brasileiro com 1 casa decimal (ex.: 1.234,5).
  // Valores ausentes aparecem como travessão.
  function fmt(n){
    if (n === null || n === undefined) return '—';
    return n.toLocaleString('pt-BR', {minimumFractionDigits:1, maximumFractionDigits:1});
  }

  // Formata a diferença (Real + Online) − Meta com sinal e cor:
  // negativo (faltou volume) em vermelho; zero ou positivo em verde, com "+" se > 0.
  // Arredonda para 1 casa antes de decidir o sinal, evitando "-0,0".
  function fmtDiff(n){
    var v = Math.round(n*10)/10;
    var cls = v < 0 ? 'diff-neg' : 'diff-pos';
    var txt = (v > 0 ? '+' : '') + v.toLocaleString('pt-BR', {minimumFractionDigits:1, maximumFractionDigits:1});
    return '<span class="'+cls+'">'+txt+'</span>';
  }

  // Calcula o % de atingimento (real / meta * 100).
  // Regras quando não há meta (meta zero ou negativa):
  //   - se houve venda (real > 0)  -> null  (exibido como "sem meta");
  //   - se não houve venda         -> 100   (considerado meta atingida).
  function pct(real, meta){
    if (!meta || meta <= 0) return (real && real > 0) ? null : 100;
    return (real / meta) * 100;
  }

  // % de atingimento de um cliente/rede numa categoria.
  // Considera o volume total (Real + Online), para que a venda do dia já conte
  // no atingimento. Para 'geral', totalOf/metaOf já somam todas as categorias.
  function pctOf(r, catKey){
    return pct(totalOf(r, catKey), metaOf(r, catKey));
  }

  // Meta de um cliente/rede numa categoria ('geral' = soma de todas).
  function metaOf(r, catKey){
    if (catKey === 'geral'){
      var m=0; CATS.forEach(function(c){ if(c.key!=='geral') m += r.meta[c.key]||0; }); return m;
    }
    return r.meta[catKey]||0;
  }

  // Realizado de um cliente/rede numa categoria ('geral' = soma de todas).
  function realOf(r, catKey){
    if (catKey === 'geral'){
      var re=0; CATS.forEach(function(c){ if(c.key!=='geral') re += r.real[c.key]||0; }); return re;
    }
    return r.real[catKey]||0;
  }

  // Venda online (pedidos do dia ainda não faturados) numa categoria ('geral' = soma).
  // Se o registro não tiver o campo "online" (dados antigos), considera zero.
  function onlineOf(r, catKey){
    var on = r.online || {};
    if (catKey === 'geral'){
      var t=0; CATS.forEach(function(c){ if(c.key!=='geral') t += on[c.key]||0; }); return t;
    }
    return on[catKey]||0;
  }

  // Volume total considerado contra a meta: Real (faturado) + Online (venda do dia).
  function totalOf(r, catKey){
    return realOf(r, catKey) + onlineOf(r, catKey);
  }

  // =====================================================================
  // FILTROS (Gerência -> Supervisão -> Rota)
  // =====================================================================
  var fGer = document.getElementById('fGer'), fSup = document.getElementById('fSup'), fRota = document.getElementById('fRota');

  // Retorna os valores distintos (sem vazios), convertidos para texto e em ordem alfabética.
  function uniq(arr){ return Array.from(new Set(arr.map(function(v){return v===null||v===undefined?'':String(v);}))).filter(Boolean).sort(function(a,b){return a.localeCompare(b,'pt-BR');}); }

  // Recria as opções de um <select>. A primeira opção (valor vazio) significa "todos".
  // Se o valor selecionado antes ainda existir na nova lista, ele é mantido.
  function fillSelect(sel, values, allLabel){
    var cur = sel.value;
    sel.innerHTML = '';
    var optAll = document.createElement('option');
    optAll.value = ''; optAll.textContent = allLabel;
    sel.appendChild(optAll);
    values.forEach(function(v){
      var o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o);
    });
    if (values.indexOf(cur) !== -1) sel.value = cur; else sel.value = '';
  }

  // Compara um campo do dado com o valor do filtro, sempre como texto
  // (necessário porque algumas rotas vêm como número e outras como texto).
  function eq(v, s){ return String(v==null?'':v) === s; }

  // Atualiza as opções em cascata: Supervisão depende da Gerência escolhida,
  // e Rota depende da Gerência e da Supervisão.
  function refreshCascade(){
    var g = fGer.value;
    var supValues = uniq(rows.filter(function(r){ return !g || eq(r.ger,g); }).map(function(r){ return r.sup; }));
    fillSelect(fSup, supValues, 'Todas as supervisões');
    var s = fSup.value;
    var rotaValues = uniq(rows.filter(function(r){ return (!g || eq(r.ger,g)) && (!s || eq(r.sup,s)); }).map(function(r){ return r.rota; }));
    fillSelect(fRota, rotaValues, 'Todas as rotas');
  }

  // Carga inicial dos filtros
  fillSelect(fGer, uniq(rows.map(function(r){return r.ger;})), 'Todas as gerências');
  refreshCascade();

  // =====================================================================
  // ESTADO DA TELA
  // =====================================================================
  // cat:     categoria da aba selecionada
  // level:   'cliente' (uma linha por cliente) ou 'rede' (uma linha por rede)
  // sortKey: coluna de ordenação ('pct' ou 'nome')
  // sortDir: 'asc' (crescente) ou 'desc' (decrescente).
  //          Padrão: % crescente, ou seja, os piores resultados primeiro.
  var catTabsEl = document.getElementById('catTabs');
  var state = { cat: 'refri', level: 'cliente', sortKey: 'pct', sortDir: 'asc' };

  // ---------- Abas de categoria ----------
  // Cria um botão por categoria; ao clicar, marca a aba como ativa e redesenha.
  CATS.forEach(function(c){
    var b = document.createElement('button');
    b.className = 'cat-tab' + (c.key===state.cat ? ' active' : '');
    b.textContent = c.label; b.dataset.cat = c.key; b.type = 'button';
    b.addEventListener('click', function(){
      state.cat = c.key;
      Array.prototype.forEach.call(catTabsEl.children, function(el){ el.classList.toggle('active', el.dataset.cat===c.key); });
      render();
    });
    catTabsEl.appendChild(b);
  });

  // ---------- Alternância "Por cliente" / "Por rede" ----------
  var levelToggle = document.getElementById('levelToggle');
  Array.prototype.forEach.call(levelToggle.children, function(btn){
    btn.addEventListener('click', function(){
      state.level = btn.dataset.level;
      Array.prototype.forEach.call(levelToggle.children, function(b){ b.classList.toggle('active', b===btn); });
      render();
    });
  });

  // ---------- Eventos dos filtros ----------
  // Ao mudar Gerência ou Supervisão, recalcula as opções seguintes da cascata.
  [fGer, fSup, fRota].forEach(function(sel){
    sel.addEventListener('change', function(){ if(sel!==fRota) refreshCascade(); render(); });
  });
  // A busca redesenha a cada tecla digitada
  document.getElementById('fSearch').addEventListener('input', function(){ render(); });
  // Filtro "Status da meta" (Todos / Só abaixo da meta). É aplicado dentro do render(),
  // pois depende da categoria e da visão (cliente/rede) selecionadas.
  var fStatus = document.getElementById('fStatus');
  fStatus.addEventListener('change', function(){ render(); });
  // "Limpar filtros": zera gerência (a cascata zera supervisão e rota), a busca e o status
  document.getElementById('btnReset').addEventListener('click', function(){
    fGer.value=''; refreshCascade(); document.getElementById('fSearch').value=''; fStatus.value=''; render();
  });

  // Aplica os filtros e a busca, retornando apenas os clientes que passam.
  // A busca procura o texto no nome, no código e no nome da rede (sem diferenciar maiúsculas).
  function filteredRows(){
    var g = fGer.value, s = fSup.value, r = fRota.value;
    var q = document.getElementById('fSearch').value.trim().toLowerCase();
    return rows.filter(function(row){
      if (g && !eq(row.ger,g)) return false;
      if (s && !eq(row.sup,s)) return false;
      if (r && !eq(row.rota,r)) return false;
      if (q){
        var hay = (row.nome+' '+row.cod+' '+(row.rede||'')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  // =====================================================================
  // VISÃO POR REDE
  // =====================================================================

  // Indica se o cliente pertence a uma rede de verdade.
  // Códigos 9999/99999, "Indeterminado" e "Nao Cliente Chave" significam "sem rede".
  function isNetworkClient(r){
    return r.redeCod && r.redeCod !== '9999' && r.redeCod !== '99999' && r.rede && r.rede !== 'Indeterminado' && r.rede !== 'Nao Cliente Chave';
  }

  // Agrupa os clientes por rede, somando meta, real e online de cada categoria.
  // Clientes sem rede ficam de fora desta visão.
  function groupByRede(list){
    var map = {};
    list.forEach(function(r){
      if (!isNetworkClient(r)) return;
      var k = r.redeKey || (r.rede+'|'+r.redeCod);
      // Primeira loja da rede: cria os acumuladores zerados
      if (!map[k]) map[k] = { key:k, nome:r.rede, redeCod:r.redeCod, ger:r.ger, sup:r.sup, rota:r.rota, stores:0, meta:{refri:0,cerv:0,sucos:0,pw:0,dest:0}, real:{refri:0,cerv:0,sucos:0,pw:0,dest:0}, online:{refri:0,cerv:0,sucos:0,pw:0,dest:0}, gers:{}, sups:{} };
      var g = map[k];
      g.stores++; // quantidade de lojas da rede
      CATS.forEach(function(c){ if(c.key!=='geral'){ g.meta[c.key]+= r.meta[c.key]||0; g.real[c.key]+= r.real[c.key]||0; g.online[c.key]+= onlineOf(r, c.key); } });
      // Guarda as gerências/supervisões distintas por onde a rede passa
      g.gers[r.ger]=1; g.sups[r.sup]=1;
    });
    return Object.keys(map).map(function(k){
      var g = map[k];
      // Rede em várias gerências: lista todas separadas por vírgula
      g.gerLabel = Object.keys(g.gers).length>1 ? Object.keys(g.gers).join(', ') : Object.keys(g.gers)[0];
      // Rede em várias supervisões: mostra apenas a quantidade
      g.supLabel = Object.keys(g.sups).length>1 ? (Object.keys(g.sups).length+' supervisões') : Object.keys(g.sups)[0];
      return g;
    });
  }

  // =====================================================================
  // ORDENAÇÃO
  // =====================================================================

  // Ordena a lista pelo % de atingimento, pela diferença (Real + Online) − Meta ou pelo nome.
  // Registros "sem meta" (null) recebem -1 no %, ficando no início na ordem crescente.
  function sortRows(list, pctFn){
    var dir = state.sortDir === 'asc' ? 1 : -1;
    list.sort(function(a,b){
      if (state.sortKey === 'pct'){
        var pa = pctFn(a), pb = pctFn(b);
        pa = (pa===null?-1:pa); pb = (pb===null?-1:pb);
        return (pa-pb)*dir;
      }
      if (state.sortKey === 'nome') return (a.nome||'').localeCompare(b.nome||'','pt-BR')*dir;
      // Diferença (Real + Online) − Meta: em ordem crescente, quem mais deve volume vem primeiro
      if (state.sortKey === 'diff'){
        var da = totalOf(a, state.cat) - metaOf(a, state.cat), db = totalOf(b, state.cat) - metaOf(b, state.cat);
        return (da-db)*dir;
      }
      return 0;
    });
    return list;
  }

  // =====================================================================
  // RENDERIZAÇÃO (cards + tabela)
  // =====================================================================
  var theadRow = document.getElementById('theadRow');
  var tbody = document.getElementById('tbody');
  var summaryGrid = document.getElementById('summaryGrid');
  var emptyState = document.getElementById('emptyState');
  var resultsCount = document.getElementById('resultsCount');

  // HTML do % de atingimento: verde se >= 100%, vermelha se abaixo, cinza se sem meta.
  // Vem acompanhado de uma barra de progresso (.pct-bar), que só aparece no
  // visual Executivo; no Clássico ela fica escondida e vale só a "pílula".
  function pctPillHtml(p){
    if (p === null) return '<span class="pct-cell"><span class="pct-pill na">sem meta</span></span>';
    var cls = p >= 100 ? 'good' : 'bad';
    var largura = Math.max(0, Math.min(p, 100)); // barra limitada a 0–100%
    return '<span class="pct-cell">' +
      '<span class="pct-bar '+cls+'" aria-hidden="true"><i style="width:'+largura.toFixed(1)+'%"></i></span>' +
      '<span class="pct-pill '+cls+'">'+p.toFixed(1).replace('.',',')+'%</span>' +
    '</span>';
  }

  // Redesenha cards e tabela de acordo com filtros e estado atuais.
  // É chamada sempre que o usuário muda algo na tela.
  function render(){
    var base = filteredRows();
    var catLabel = CATLABEL[state.cat];
    var isNetwork = state.level === 'rede';
    // Visão por cliente: cópia da lista (para não alterar a ordem do array original).
    // Visão por rede: lojas agrupadas por rede.
    var list = isNetwork ? groupByRede(base) : base.slice();

    // Funções de cálculo da categoria selecionada (iguais nas duas visões,
    // pois a rede agrupada tem os mesmos campos meta/real/online do cliente)
    var pctFn    = function(r){ return pctOf(r, state.cat); };    // % sobre Real + Online
    var metaFn   = function(r){ return metaOf(r, state.cat); };
    var realFn   = function(r){ return realOf(r, state.cat); };   // faturado
    var onlineFn = function(r){ return onlineOf(r, state.cat); }; // venda do dia
    var diffFn   = function(r){ return totalOf(r, state.cat) - metaOf(r, state.cat); }; // (Real + Online) − Meta
    sortRows(list, pctFn);

    // ---------- Cards de resumo ----------
    // Soma meta, real e online de tudo que está na tela e conta quantos estão abaixo de 100%
    var totalMeta = 0, totalReal = 0, totalOnline = 0, belowCount = 0, withMeta = 0;
    list.forEach(function(r){
      totalMeta += metaFn(r); totalReal += realFn(r); totalOnline += onlineFn(r);
      var p = pctFn(r);
      if (p !== null) withMeta++;
      if (p !== null && p < 100) belowCount++;
    });
    // % consolidado = (total real + total online) / total da meta
    var totalPct = totalMeta > 0 ? ((totalReal+totalOnline)/totalMeta*100) : null;
    // Guarda o total antes do filtro de status, para o card "Abaixo da meta" mostrar "X de TOTAL"
    var totalCount = list.length;
    // Filtro "Só abaixo da meta": mantém só quem tem meta e ficou abaixo de 100%.
    // Aplicado depois dos totais, então os cards continuam mostrando o consolidado completo
    // (exceto o card da diferença, calculado logo abaixo).
    if (fStatus.value === 'below'){
      list = list.filter(function(r){ var p = pctFn(r); return p !== null && p < 100; });
    }
    // Card (Real + Online) − Meta: soma a diferença dos registros que estão NA TABELA,
    // ou seja, respeita o filtro "Só abaixo da meta" (mostra quanto falta para esses clientes).
    var diffTot = 0;
    list.forEach(function(r){ diffTot += diffFn(r); });
    var diffLabel = 'Real + Online − Meta ' + catLabel + (fStatus.value === 'below' ? ' &middot; só abaixo da meta' : '');
    summaryGrid.innerHTML =
      '<div class="summary-card total"><div class="summary-label">Meta '+catLabel+' &middot; '+DATA.mesMeta+'</div><div class="summary-value">'+fmt(totalMeta)+'</div></div>'+
      '<div class="summary-card"><div class="summary-label">Real '+catLabel+' &middot; '+DATA.mesReal+'</div><div class="summary-value">'+fmt(totalReal)+'</div></div>'+
      // Card Online: venda do dia ainda não faturada
      '<div class="summary-card"><div class="summary-label">Online '+catLabel+'</div><div class="summary-value">'+fmt(totalOnline)+'</div></div>'+
      // Card da diferença: vermelho se faltou volume, verde se superou (com "+")
      '<div class="summary-card"><div class="summary-label">'+diffLabel+'</div><div class="summary-value '+(diffTot<0?'bad':'good')+'">'+(Math.round(diffTot*10)/10>0?'+':'')+fmt(diffTot)+'</div></div>'+
      '<div class="summary-card"><div class="summary-label">% Atingimento consolidado</div><div class="summary-value '+(totalPct===null?'':(totalPct>=100?'good':'bad'))+'">'+(totalPct===null?'—':totalPct.toFixed(1).replace('.',',')+'%')+'</div></div>'+
      '<div class="summary-card"><div class="summary-label">Abaixo da meta</div><div class="summary-value '+(belowCount>0?'bad':'good')+'">'+belowCount+' de '+totalCount+'</div></div>';

    // ---------- Tabela ----------
    // Colunas com data-k ("nome", "diff" e "pct") são clicáveis para ordenar.
    if (isNetwork){
      // Visão por rede: uma linha por rede, com quantidade de lojas
      theadRow.innerHTML = '<tr><th data-k="nome">Rede</th><th>Gerência</th><th>Lojas</th><th>Meta '+catLabel+'</th><th>Real '+catLabel+'</th><th>Online '+catLabel+'</th><th data-k="diff">Real + Online − Meta</th><th data-k="pct">% Atingimento</th></tr>';
      tbody.innerHTML = list.map(function(r){
        var p = pctFn(r); var below = p!==null && p<100; // abaixo da meta -> linha avermelhada
        return '<tr class="'+(below?'below':'')+'">'+
          '<td class="name-cell"><div class="cname">'+r.nome+'</div><div class="ccode">Cód. rede '+(r.redeCod||'—')+'</div></td>'+
          '<td>'+(r.gerLabel||'—')+'</td>'+
          '<td>'+r.stores+'</td>'+
          '<td>'+fmt(metaFn(r))+'</td>'+
          '<td>'+fmt(realFn(r))+'</td>'+
          '<td>'+fmt(onlineFn(r))+'</td>'+   // venda do dia
          '<td>'+fmtDiff(diffFn(r))+'</td>'+  // (Real + Online) − Meta
          '<td>'+pctPillHtml(p)+'</td>'+
        '</tr>';
      }).join('');
    } else {
      // Visão por cliente: uma linha por cliente, com etiqueta da rede (se houver)
      theadRow.innerHTML = '<tr><th data-k="nome">Cliente</th><th>Rede</th><th>Gerência / Supervisão</th><th>Meta '+catLabel+'</th><th>Real '+catLabel+'</th><th>Online '+catLabel+'</th><th data-k="diff">Real + Online − Meta</th><th data-k="pct">% Atingimento</th></tr>';
      tbody.innerHTML = list.map(function(r){
        var p = pctFn(r); var below = p!==null && p<100; // abaixo da meta -> linha avermelhada
        var redeCell = isNetworkClient(r) ? ('<span class="tag">'+r.rede+' &middot; '+r.redeCod+'</span>') : '<span class="cmeta-line">Indeterminado</span>';
        return '<tr class="'+(below?'below':'')+'">'+
          '<td class="name-cell"><div class="cname">'+r.nome+'</div><div class="ccode">Cód. '+r.cod+'</div></td>'+
          '<td>'+redeCell+'</td>'+
          '<td class="name-cell"><div class="cmeta-line">'+(r.ger||'—')+'</div><div class="cmeta-line">'+(r.sup||'—')+'</div></td>'+
          '<td>'+fmt(metaFn(r))+'</td>'+
          '<td>'+fmt(realFn(r))+'</td>'+
          '<td>'+fmt(onlineFn(r))+'</td>'+   // venda do dia
          '<td>'+fmtDiff(diffFn(r))+'</td>'+  // (Real + Online) − Meta
          '<td>'+pctPillHtml(p)+'</td>'+
        '</tr>';
      }).join('');
    }

    // Ordenação ao clicar no cabeçalho: clicar na mesma coluna inverte a direção;
    // clicar em outra coluna passa a ordenar por ela em ordem crescente.
    // (O cabeçalho é recriado a cada render, por isso os eventos são religados aqui.)
    Array.prototype.forEach.call(theadRow.querySelectorAll('th[data-k]'), function(th){
      th.addEventListener('click', function(){
        var k = th.dataset.k;
        if (state.sortKey === k) state.sortDir = state.sortDir==='asc' ? 'desc' : 'asc';
        else { state.sortKey = k; state.sortDir = k==='pct' ? 'asc' : 'asc'; }
        render();
      });
    });

    // Mensagem de "nenhum resultado" e contador de registros
    // (com o filtro de status ativo, o texto indica "abaixo da meta de <categoria>")
    emptyState.hidden = list.length > 0;
    resultsCount.textContent = list.length + (isNetwork ? ' rede(s) encontradas' : ' cliente(s) encontrado(s)') + (fStatus.value==='below' ? ' abaixo da meta de '+catLabel : '') + ' de ' + rows.length + ' com acordo fechado.';
  }

  // Primeiro desenho da tela
  render();
}

// Ponto de entrada: monta o painel com os dados de js/dados.js.
// Na etapa 2, esta chamada será trocada pela busca dos dados na API.
iniciarPainel(DATA);
