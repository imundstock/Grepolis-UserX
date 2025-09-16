(function () {
    'use strict';

    const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    function unlock(polisID, farmTownPlayerID, ruralID, onDone) {
        const data = {
            model_url: 'FarmTownPlayerRelation/' + farmTownPlayerID,
            action_name: 'unlock',
            arguments: { farm_town_id: ruralID },
            town_id: polisID
        };
        uw.gpAjax.ajaxPost('frontend_bridge', 'execute', data, () => {
            console.log(`✅ Desbloqueada aldeia ${ruralID} (cidade ${polisID})`);
            if (typeof onDone === 'function') onDone();
        });
    }

    // upgrade padrão do ModernBot: sobe 1 estágio (1→2)
    function upgrade(polisID, farmTownPlayerID, ruralID) {
        const data = {
            model_url: 'FarmTownPlayerRelation/' + farmTownPlayerID,
            action_name: 'upgrade',
            arguments: { farm_town_id: ruralID },
            town_id: polisID
        };
        uw.gpAjax.ajaxPost('frontend_bridge', 'execute', data, () => {
            console.log(`⬆️  Upgrade pedido para aldeia ${ruralID} → nível 2 (cidade ${polisID})`);
        });
    }

    function desbloquearEAumentarAldeiasDaIlhaAtual() {
        const polisID = uw.Game.townId;
        const islandX = uw.ITowns.towns[polisID].getIslandCoordinateX();
        const islandY = uw.ITowns.towns[polisID].getIslandCoordinateY();

        const aldeias = uw.MM.getCollections().FarmTown[0].models;
        const relacoes = uw.MM.getCollections().FarmTownPlayerRelation[0].models;

        for (let i = 0; i < aldeias.length; i++) {
            const aldeia = aldeias[i];
            if (aldeia.attributes.island_x !== islandX || aldeia.attributes.island_y !== islandY) continue;

            const ruralID = aldeia.id;

            for (let j = 0; j < relacoes.length; j++) {
                const rel = relacoes[j];
                if (ruralID !== rel.getFarmTownId()) continue;

                const farmTownPlayerID = rel.id;

                // 0 = bloqueada; desbloqueia e depois upa 1x (1->2)
                if (rel.attributes.relation_status === 0) {
                    unlock(polisID, farmTownPlayerID, ruralID, () => {
                        // dá um respiro curto pro backend registrar o unlock
                        setTimeout(() => upgrade(polisID, farmTownPlayerID, ruralID), 500);
                    });
                } else {
                    // já desbloqueada: se ainda estiver no nível 1, tenta subir para 2
                    const stage = rel.attributes.expansion_stage || 1; // fallback seguro
                    if (stage < 2) {
                        upgrade(polisID, farmTownPlayerID, ruralID);
                    }
                }
            }
        }
    }

    const waitUntilReady = setInterval(() => {
        if (
            uw.Game?.townId &&
            uw.ITowns?.towns &&
            uw.MM?.getCollections()?.FarmTown?.[0]?.models?.length &&
            uw.MM?.getCollections()?.FarmTownPlayerRelation?.[0]?.models?.length
        ) {
            clearInterval(waitUntilReady);
            console.log("🚀 Desbloqueando e upando aldeias da ilha da cidade atual para o nível 2...");
            desbloquearEAumentarAldeiasDaIlhaAtual();
        }
    }, 1000);
})();
