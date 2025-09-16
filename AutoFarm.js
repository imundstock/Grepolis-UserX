(function () {
    'use strict';

    const uw = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    class AutoFarm {
        constructor() {
            this.timing = 1; // 1 = 5min, 2 = 10min, 3 = 20min, 4 = 40min
            this.percentual = 3; // 1 = 80%, 2 = 90%, 3 = 100%
            this.delta_time = 10000;
            this.timer = 0;
            this.lastTime = Date.now();
            this.active = true;
            this.polislist = this.generateList();
            setInterval(this.main.bind(this), 1000);
        }

        TIMINGS = {
            1: 300000,
            2: 600000,
            3: 1200000,
            4: 2400000,
        };

        generateList() {
            const islandsList = new Set();
            const polisList = [];
            const towns = uw.MM.getOnlyCollectionByName('Town').models;
            for (const town of towns) {
                const { on_small_island, island_id, id } = town.attributes;
                if (!on_small_island && !islandsList.has(island_id)) {
                    islandsList.add(island_id);
                    polisList.push(id);
                }
            }
            return polisList;
        }

        getTotalResources() {
            let total = { wood: 0, stone: 0, iron: 0, storage: 0 };
            for (let town_id of this.polislist) {
                const town = uw.ITowns.towns[town_id];
                if (!town) continue;
                const { wood, stone, iron, storage } = town.resources();
                total.wood += wood;
                total.stone += stone;
                total.iron += iron;
                total.storage += storage;
            }
            return total;
        }

        async main() {
            const now = Date.now();
            this.timer -= now - this.lastTime;
            this.lastTime = now;

            if (this.timer > 0) return;

            const { wood, stone, iron, storage } = this.getTotalResources();
            const min = Math.min(wood, stone, iron);
            const ratio = min / storage;

            if ((this.percentual === 3 && ratio > 0.99) ||
                (this.percentual === 2 && ratio > 0.9) ||
                (this.percentual === 1 && ratio > 0.8)) {
                this.timer = 30000;
                return;
            }

            const isCaptain = uw.GameDataPremium.isAdvisorActivated('captain');
            if (isCaptain) {
                await this.claimMultiple();
            } else {
                await this.claimSingleAll();
            }

            const rand = Math.floor(Math.random() * this.delta_time);
            this.timer = this.TIMINGS[this.timing] + rand;
        }

        async claimSingleAll() {
            const player_relations = uw.MM.getOnlyCollectionByName('FarmTownPlayerRelation').models;
            const farmtowns = uw.MM.getOnlyCollectionByName('FarmTown').models;
            const now = Math.floor(Date.now() / 1000);
            for (let town_id of this.polislist) {
                const town = uw.ITowns.towns[town_id];
                const x = town.getIslandCoordinateX(), y = town.getIslandCoordinateY();
                for (let ft of farmtowns) {
                    if (ft.attributes.island_x !== x || ft.attributes.island_y !== y) continue;
                    for (let rel of player_relations) {
                        if (rel.attributes.farm_town_id !== ft.attributes.id) continue;
                        if (rel.attributes.relation_status !== 1) continue;
                        if (rel.attributes.lootable_at && now < rel.attributes.lootable_at) continue;
                        this.claimSingle(town_id, ft.attributes.id, rel.id);
                        await this.sleep(500);
                    }
                }
            }
        }

        claimSingle(town_id, farm_town_id, relation_id, option = 1) {
            const data = {
                model_url: `FarmTownPlayerRelation/${relation_id}`,
                action_name: 'claim',
                arguments: {
                    farm_town_id,
                    type: 'resources',
                    option
                },
                town_id
            };
            uw.gpAjax.ajaxPost('frontend_bridge', 'execute', data);
        }

        claimMultiple() {
            return new Promise(resolve => {
                uw.gpAjax.ajaxPost('farm_town_overviews', 'claim_loads_multiple', {
                    towns: this.polislist,
                    time_option_base: 300,
                    time_option_booty: 600,
                    claim_factor: 'normal'
                }, false, () => resolve());
            });
        }

        sleep(ms) {
            return new Promise(res => setTimeout(res, ms));
        }
    }

    setTimeout(() => {
        new AutoFarm();
        console.log('✅ AutoFarm iniciado');
    }, 2000);
})();
