(function () {
    'use strict';

    // Configurações globais
    const CONFIG = {
        MAX_FAVOR: 500,
        RESOURCE_MARGIN: 200,
        MAX_ACTIVE_QUESTS: 3,
        MAIN_INTERVAL: 60000,
        RELOAD_MIN_TIME: 2700,
        RELOAD_MAX_TIME: 4800,
        HERO_CHECK_DELAY: 15000,
        HERO_WINDOW_DELAY: 2500,
        INITIALIZATION_DELAY: 10000
    };

    // Utilitários
    const Utils = {
        sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

        getUnsafeWindow: () => {
            return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        },

        isBlocked: () => {
            return $('.botcheck').length ||
                $('#recaptcha_window').length ||
                $('#hcaptcha_window').length;
        },

        getRandomReloadTime: () => {
            const min = CONFIG.RELOAD_MIN_TIME;
            const max = CONFIG.RELOAD_MAX_TIME;
            return (Math.floor(Math.random() * (max - min + 1)) + min) * 1000;
        }
    };

    const uw = Utils.getUnsafeWindow();

    // Sistema de recompensas e missões (Progressable)
    const RewardSystem = {
        FAVOR_REWARDS: {
            1: { favor: 60 },
            2: { favor: 80 },
            3: { favor: 100 },
            4: { favor: 125 },
            5: { favor: 150 },
            6: { favor: 180 },
            7: { favor: 280 }
        },

        getFinishedTasks: () => {
            try {
                const { Progressable } = uw.MM.getCollections();
                const { models } = Progressable[0];

                return models
                    .filter(model => model.attributes.state === "satisfied")
                    .map(model => model.attributes);
            } catch (error) {
                console.error("Erro ao obter tarefas concluídas:", error);
                return [];
            }
        },

        claimReward: (reward) => {
            const data = {
                model_url: `Progressable/${reward.id}`,
                action_name: "progressTo",
                arguments: {
                    progressable_id: reward.progressable_id,
                    state: "closed"
                }
            };
            uw.gpAjax.ajaxPost("frontend_bridge", "execute", data);
        },

        shouldClaimResourceReward: (reward, town) => {
            const { wood, iron, stone, storage } = town.resources();
            const margin = CONFIG.RESOURCE_MARGIN;

            if (reward.type !== "resources") return true;

            return (
                (reward.data.wood + wood + margin <= storage) &&
                (reward.data.iron + iron + margin <= storage) &&
                (reward.data.stone + stone + margin <= storage)
            );
        },

        processFinishedTasks: (town) => {
            const missions = RewardSystem.getFinishedTasks();

            for (const mission of missions) {
                for (const reward of mission.static_data.rewards) {
                    const { type, power_id } = reward;

                    if (type === "resources" && !RewardSystem.shouldClaimResourceReward(reward, town)) {
                        continue;
                    }

                    if (["units", "favor"].includes(type) ||
                        (type === "power" && ["population_boost", "coins_of_wisdom"].includes(power_id))) {
                        RewardSystem.claimReward(mission);
                        console.log("Recompensa reivindicada:", mission.progressable_id);
                        return;
                    }
                }
            }
        }
    };

    // Sistema de login diário
    const DailyLoginSystem = {
        checkAndClaim: (favorAmount) => {
            const expectedFavor = RewardSystem.FAVOR_REWARDS[DailyLoginSystem.getLevel()]?.favor;

            if (expectedFavor && expectedFavor + favorAmount < CONFIG.MAX_FAVOR) {
                DailyLoginSystem.claim();
            }
        },

        getLevel: () => {
            return new Promise((resolve, reject) => {
                const data = {
                    window_type: "daily_login",
                    tab_type: "index",
                    known_data: { models: [], collections: [], templates: [] }
                };

                uw.gpAjax.ajaxGet("frontend_bridge", "fetch", data, false, (responseText) => {
                    try {
                        resolve(responseText.models.DailyLoginBonus.data.level);
                    } catch (err) {
                        console.error("Erro ao obter nível de recompensa:", err);
                        reject(err);
                    }
                });
            });
        },

        claim: () => {
            const data = {
                model_url: `DailyLoginBonus/${uw.Game.player_id}`,
                action_name: "accept",
                captcha: null,
                arguments: { option: 1 }
            };
            uw.gpAjax.ajaxPost("frontend_bridge", "execute", data);
        },

        process: () => {
            if ($('#daily_login_icon').css('display') !== 'block') return;

            const town = uw.ITowns.getCurrentTown();
            const god = town.god();

            if (god) {
                const favorKey = `${god}_favor`;
                const favorAmount = uw.ITowns.player_gods.attributes[favorKey];

                if (favorAmount) {
                    DailyLoginSystem.checkAndClaim(favorAmount);
                }
            }
        }
    };

    // Sistema de deuses e feitiços
    const GodsSystem = {
        setHera: (townId) => {
            const data = {
                god_id: "hera",
                town_id: townId
            };
            uw.gpAjax.ajaxPost("building_temple", "change_god", data);
        },

        castSpell: (townId) => {
            const data = {
                model_url: "CastedPowers",
                action_name: "cast",
                arguments: {
                    power_id: "wedding",
                    target_id: townId
                }
            };
            uw.gpAjax.ajaxPost("frontend_bridge", "execute", data);
        },

        processGodActions: (town, isOnlyTown) => {
            if (!isOnlyTown) return;

            const { wood, iron, stone, storage } = town.resources();
            const { hera_favor } = uw.ITowns.player_gods.attributes;
            const margin = CONFIG.RESOURCE_MARGIN;

            // Lançar feitiço se tiver favor suficiente e recursos baixos
            if (hera_favor > 30 &&
                wood + margin < storage &&
                iron + margin < storage &&
                stone + margin < storage) {
                GodsSystem.castSpell(town.id);
            }

            // Definir Hera se não houver deus
            const buildings = town.buildings().attributes;
            if (buildings.temple > 0 && !town.god()) {
                GodsSystem.setHera(town.id);
                console.log("Deus definido para Hera");
            }
        }
    };

    // Sistema de missões da ilha
    const IslandQuestSystem = {
        initialize: () => {
            uw.modernBot.autoIslandQuests = uw.modernBot.autoIslandQuests || {
                maxActiveQuests: CONFIG.MAX_ACTIVE_QUESTS
            };
        },

        getQuests: () => {
            try {
                const islandQuests = uw.MM.getCollections().IslandQuest;
                return islandQuests?.[0]?.models || [];
            } catch (error) {
                console.error("Erro ao obter island quests:", error);
                return [];
            }
        },

        getActiveQuestsCount: (quests) => {
            return quests.filter(quest => {
                const state = quest.attributes?.state;
                return state === 'running' || state === 'satisfied';
            }).length;
        },

        canAcceptNewQuest: (quests) => {
            const activeCount = IslandQuestSystem.getActiveQuestsCount(quests);
            return activeCount < uw.modernBot.autoIslandQuests.maxActiveQuests;
        },

        isTimerQuest: (quest) => {
            return quest.attributes?.configuration?.time_to_wait;
        },

        setTownId: async (quest) => {
            const townList = uw.MM.getOnlyCollectionByName('Town').models;
            const islandId = quest.attributes.dynamic_data?.island_id;

            const town = townList.find(t => t.attributes.island_id === islandId);
            if (!town) {
                console.error("Town not found on the island:", islandId);
                return;
            }

            if (town.attributes.id != uw.Game.townId) {
                console.log("Trocando para a cidade:", town.attributes.id);
                uw.HelperTown.townSwitch(town.attributes.id);
            }
        },

        acceptQuest: async (quest) => {
            return new Promise((myResolve, myReject) => {
                const data = {
                    model_url: "IslandQuests",
                    action_name: "decide",
                    captcha: null,
                    arguments: {
                        decision: quest.attributes.static_data?.side,
                        progressable_name: quest.attributes.progressable_id
                    },
                    town_id: quest.attributes?.configuration?.town_id,
                    nl_init: true
                };

                console.log("Aceitando missão:", quest.attributes.progressable_id);
                uw.gpAjax.ajaxPost("frontend_bridge", "execute", data, false, async () => {
                    console.log("Missão aceita:", quest.attributes.progressable_id);
                    await Utils.sleep(100);
                    await IslandQuestSystem.challengeQuest(quest);
                    myResolve();
                });
            });
        },

        challengeQuest: async (quest) => {
            return new Promise((myResolve, myReject) => {
                const data = {
                    model_url: "IslandQuests",
                    action_name: "challenge",
                    captcha: null,
                    arguments: {
                        challenge: { current_town_id: true },
                        progressable_name: quest.attributes.progressable_id
                    },
                    town_id: quest.attributes?.configuration?.town_id,
                    nl_init: true
                };

                console.log("Desafiando missão:", quest.attributes.progressable_id);
                uw.gpAjax.ajaxPost("frontend_bridge", "execute", data, false, () => {
                    console.log("Missão desafiada:", quest.attributes.progressable_id);
                    myResolve()
                });
            });
        },

        claimQuestReward: async (quest) => {
            const data = {
                model_url: "IslandQuests",
                action_name: "claimReward",
                captcha: null,
                arguments: {
                    reward_action: "trash",
                    state: "closed",
                    progressable_id: quest.attributes.progressable_id
                },
                town_id: quest.attributes?.configuration?.town_id,
                nl_init: true
            };

            console.log("Reivindicando recompensa:", quest.attributes.progressable_id);
            await uw.gpAjax.ajaxPost("frontend_bridge", "execute", data);
        },

        process: async () => {
            try {
                IslandQuestSystem.initialize();
                const quests = IslandQuestSystem.getQuests();

                if (!quests.length) {
                    console.log("Nenhuma island quest encontrada");
                    return;
                }

                // Primeiro, processar recompensas
                for (const quest of quests) {
                    if (quest.attributes?.state === 'satisfied') {
                        console.log("Reivindicando recompensa:", quest.attributes.progressable_id);

                        try {
                            await IslandQuestSystem.setTownId(quest);
                            await IslandQuestSystem.claimQuestReward(quest);
                            return;
                        } catch (error) {
                            console.error("Erro ao reivindicar recompensa:", error);
                        }
                    }
                }

                // Verificar se podemos aceitar novas missões
                if (!IslandQuestSystem.canAcceptNewQuest(quests)) {
                    console.log(`Limite de ${uw.modernBot.autoIslandQuests.maxActiveQuests} missões ativas atingido`);
                    return;
                }

                // Processar missões viáveis
                const viableQuests = quests.filter(quest => quest.attributes?.state === 'viable');
                const timerQuests = viableQuests.filter(IslandQuestSystem.isTimerQuest);

                if (timerQuests.length > 0) {
                    const quest = timerQuests[0];
                    console.log("Processando missão de timer:", quest.attributes.progressable_id);

                    try {
                        await IslandQuestSystem.setTownId(quest);
                        await IslandQuestSystem.acceptQuest(quest);
                    } catch (error) {
                        console.error("Erro ao processar missão:", error);
                    }
                } else {
                    console.log("Nenhuma missão de timer disponível");
                }
            } catch (error) {
                console.error("Erro ao processar island quests:", error);
            }
        }
    };

    // Sistema de heróis
    const HeroSystem = {
        checkWisdomHero: () => {
            setTimeout(() => {
                const heroWindow = uw.HeroesWindowFactory.openHeroesRecruitingTab();

                setTimeout(() => {
                    try {
                        const heroData = heroWindow?.data?.models?.heroes_recruitment?.getHeroRecruitmentData();

                        if (heroData?.hero_of_wisdom !== 'argus') {
                            heroWindow?.close?.();
                        }
                    } catch (error) {
                        console.log("Erro ao verificar herói da sabedoria:", error);
                    }
                }, CONFIG.HERO_WINDOW_DELAY);
            }, CONFIG.HERO_CHECK_DELAY);
        }
    };

    // Sistema principal
    const BotSystem = {
        initialize: () => {
            if (!uw.modernBot || !uw.ITowns || !uw.ITowns.towns) return false;
            if (Utils.isBlocked()) return false;

            // Ativar bootcamp se não estiver ativo
            if (!uw.modernBot.autoBootcamp.enable_auto_bootcamp) {
                uw.modernBot.autoBootcamp.toggle();
            }

            if (Object.values(uw.ITowns.towns).length < 3) {
                uw.modernBot.autoRuralLevel.setRuralLevel(3);
                if (!uw.modernBot.storage.load('enable_autorural_level_active')) {
                    uw.modernBot.autoRuralLevel.toggle();
                }
            } else {
                uw.modernBot.autoRuralLevel.setRuralLevel(6);
                if (!uw.modernBot.storage.load('enable_autorural_level_active')) {
                    uw.modernBot.autoRuralLevel.toggle();
                }
            }

            uw.gpAjax.ajaxPost("notify", "delete_all", {});

            return true;
        },

        run: () => {
            if (!BotSystem.initialize()) return;

            const town = uw.ITowns.getCurrentTown();
            const isOnlyTown = Object.keys(uw.ITowns.towns).length === 1;

            // Processar sistemas (AUTOBUILD REMOVIDO)
            GodsSystem.processGodActions(town, isOnlyTown);
            DailyLoginSystem.process();
            RewardSystem.processFinishedTasks(town);
            IslandQuestSystem.process();
        },

        startReloadTimer: () => {
            setInterval(() => {
                location.reload();
            }, Utils.getRandomReloadTime());
        }
    };

    // Inicialização
    BotSystem.startReloadTimer();
    HeroSystem.checkWisdomHero();

    // Inicializar sistema principal
    setTimeout(() => {
        BotSystem.run();
        setInterval(BotSystem.run, CONFIG.MAIN_INTERVAL);
    }, CONFIG.INITIALIZATION_DELAY);

    // (Sistema de ocultação de navios colonizadores REMOVIDO)

})();
