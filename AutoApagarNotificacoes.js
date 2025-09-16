(function() {
    'use strict';

    // Função para clicar no botão "X" que apaga todas as notificações
    function clicarNoX() {
        const botaoFechar = document.querySelector("#delete_all_notifications");

        if (botaoFechar) {
            console.log("✅ Notificações encontradas! Clicando no 'X'...");
            botaoFechar.click();
        } else {
            console.log("⚠ Nenhum botão de apagar notificações encontrado.");
        }
    }

    // Executa a ação 10 segundos após carregar a página
    setTimeout(clicarNoX, 30000);

    // Repete a ação automaticamente a cada 10 minutos (600.000 ms)
    setInterval(clicarNoX, 400000);

})();
