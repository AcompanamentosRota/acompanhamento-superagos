/* =====================================================================
   Acompanhamento Super Agos - Escolha do visual (Clássico / Executivo)
   ---------------------------------------------------------------------
   - O visual é definido pelo atributo data-visual no <html>:
       (sem atributo)  -> Clássico  (css/estilos.css, visual original)
       "executivo"     -> Executivo (css/executivo.css por cima)
   - A escolha fica salva no navegador de cada pessoa (localStorage).
     Quem nunca escolheu abre no Clássico.
   - Este arquivo é carregado no <head>, ANTES da página ser desenhada,
     para não "piscar" o visual errado ao abrir.
   - Os botões de troca são qualquer elemento com data-visual-opcao.
   Usado pelo index.html e pelo admin.html.
   ===================================================================== */

(function(){

  var CHAVE = 'superagosVisual';
  var OPCOES = ['classico', 'executivo'];

  // Lê a escolha salva (o armazenamento pode estar bloqueado: usa o padrão)
  function lerEscolha(){
    try {
      var v = localStorage.getItem(CHAVE);
      return OPCOES.indexOf(v) !== -1 ? v : 'classico';
    } catch (e) {
      return 'classico';
    }
  }

  // Aplica o visual no <html> e marca o botão ativo
  function aplicar(visual){
    if (visual === 'executivo') document.documentElement.setAttribute('data-visual', 'executivo');
    else document.documentElement.removeAttribute('data-visual');

    var botoes = document.querySelectorAll('[data-visual-opcao]');
    for (var i = 0; i < botoes.length; i++){
      var ativo = botoes[i].getAttribute('data-visual-opcao') === visual;
      botoes[i].classList.toggle('active', ativo);
      botoes[i].setAttribute('aria-pressed', ativo ? 'true' : 'false');
    }
  }

  // 1) Aplica já, antes do <body> existir
  aplicar(lerEscolha());

  // 2) Quando a página terminar de carregar: marca o botão e liga os cliques
  document.addEventListener('DOMContentLoaded', function(){
    aplicar(lerEscolha());
    var botoes = document.querySelectorAll('[data-visual-opcao]');
    for (var i = 0; i < botoes.length; i++){
      botoes[i].addEventListener('click', function(){
        var visual = this.getAttribute('data-visual-opcao');
        try { localStorage.setItem(CHAVE, visual); } catch (e) {}
        aplicar(visual);
      });
    }
  });

})();
