(async function () {
    'use strict';

    const uw = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
    const STORAGE_KEY = uw.Game.world_id + "_RESEARCHES";
    let currentResearchIndex = 0;
    let currentAcademyWindow = null;
    let academyObserver = null;
    let usedForMultiAccounting = true;

    if (!uw.location.pathname.includes("game")) return;

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    await sleep(3000);

    /* ---------- HELPERS P/ JANELAS (corrigem wnd.getType is not a function) ---------- */

    function getWndHandler(anyWnd) {
        if (!anyWnd) return null;

        // Já é um handler?
        if (typeof anyWnd.getID === 'function') return anyWnd;

        // Veio como { wnd: handler }
        if (anyWnd.wnd && typeof anyWnd.wnd.getID === 'function') return anyWnd.wnd;

        // Veio como id numérico
        if (typeof anyWnd === 'number') return uw.GPWindowMgr?.getWindowById?.(anyWnd) || null;

        // Veio como { id } ou { wnd_id } ou aninhado
        const id = anyWnd.wnd_id ?? anyWnd.id ?? (anyWnd.wnd && anyWnd.wnd.id);
        if (id != null) return uw.GPWindowMgr?.getWindowById?.(parseInt(id, 10)) || null;

        return null;
    }

    function wndTypeOf(anyWnd) {
        const wnd = getWndHandler(anyWnd);
        if (!wnd) return null;
        if (typeof wnd.getType === 'function') return wnd.getType();
        try { return wnd.getHandler?.().getType?.() ?? null; } catch { return null; }
    }

    function getWindowByTypeSafe(type) {
        // Tenta WM
        try {
            const list = uw.WM?.getWindowByType?.(type) || [];
            if (Array.isArray(list) && list.length) return list[0];
        } catch {}
        // Fallback GPWindowMgr
        try {
            const all = uw.GPWindowMgr?.getOpenWindows?.() || [];
            for (const w of all) {
                if (wndTypeOf(w) === type) return getWndHandler(w);
            }
        } catch {}
        return null;
    }

    /* ------------------------------------------------------------------------------- */

    function getConquestMode(research) {
        try {
            const css = uw.GameDataResearches.getResearchCssClass(research);
            return css === 'take_over_old' ? 'cerco' : 'revolta';
        } catch (e) {
            return 'desconhecido';
        }
    }

    console.log("Grepolis Academy Planner v0.1.5 ativo (com patch de janela).");

    if (usedForMultiAccounting) {
        const predefinedResearches = [
            "slinger", "town_guard", "booty_bpv", "architecture", "shipwright", "building_crane",
            "colonize_ship", "pottery",
        ];

        const allTowns = uw.ITowns.towns;
        let citiesUpdated = 0;

        $.each(allTowns, function (id, town) {
            const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
            const existingResearches = all[id] || [];

            if (existingResearches.length === 0) {
                all[id] = [...predefinedResearches];
                localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
                citiesUpdated++;
            }
        });
    }

    $("head").append(`
        <style>
            .GAP_highlight_inactive::after {
                content: '';
                position: absolute;
                width: 100%;
                height: 100%;
                background-color: rgba(0, 255, 0, 0.5);
            }
            .GAP_highlight_active {
                border: 1px solid rgba(0, 255, 0, 1);
            }
        </style>
    `);

    /* ------- OBSERVERS (usando normalização de janela) ------- */

    $.Observer(uw.GameEvents.game.load).subscribe("GAP_load", attachAjaxListener);

    $.Observer(uw.GameEvents.window.open).subscribe("GAP_window_open", (e, raw) => {
        const wnd = getWndHandler(raw);
        if (!wnd) return;

        const hasCid = wnd.cid || typeof wnd.getIdentifier === 'function';
        if (!hasCid) return;

        if (wndTypeOf(wnd) === "academy") {
            currentAcademyWindow = wnd;
            openAcademy(wnd);
        }
    });

    $.Observer(uw.GameEvents.town.town_switch).subscribe("GAP_town_switch", resetAcademy);

    $.Observer(uw.GameEvents.window.close).subscribe("GAP_window_close", (e, raw) => {
        const wnd = getWndHandler(raw);
        if (!wnd) return;

        if (wndTypeOf(wnd) === "academy") {
            currentAcademyWindow = null;
            if (academyObserver) {
                academyObserver.disconnect();
                academyObserver = null;
            }
        }
    });

    $.Observer(uw.GameEvents.game.load).subscribe("GAP_ajax_listener", function () {
        $(document).ajaxComplete(function (e, xhr, opt) {
            let urlParts = opt.url.split("?");
            let action = urlParts[0].substr(5);
            if (!urlParts[1]) return;

            const params = new URLSearchParams(urlParts[1]);
            const fbType = params.get("window_type");

            switch (action) {
                case "frontend_bridge/fetch":
                case "notify/fetch":
                    if (fbType === "academy" || currentAcademyWindow) {
                        const wnd = currentAcademyWindow || getWindowByTypeSafe("academy");
                        if (wnd) {
                            setTimeout(() => openAcademy(wnd), 100);
                        }
                    }
                    break;
            }
        });
    });

    /* roda a cada 60s tentando pesquisar conforme lista salva por cidade */
    setInterval(() => {
        const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");

        for (const [townId, researches] of Object.entries(all)) {
            if (!Array.isArray(researches) || researches.length === 0) continue;
            const index = currentResearchIndex % researches.length;
            const research = researches[index];
            tryAutoResearch(research, parseInt(townId));
        }

        currentResearchIndex++;
    }, 60000);

    function attachAjaxListener() {
        $(document).ajaxComplete((e, xhr, opt) => {
            const qs = opt.url.split("?")[1];
            if (!qs) return;
            const url = new URL("https://dummy/?" + qs);
            const action = opt.url.split("?")[0].substr(5);
            if (action === "frontend_bridge/fetch" && url.searchParams.get("window_type") === "academy") {
                const wnd = getWindowByTypeSafe("academy");
                if (wnd) {
                    currentAcademyWindow = wnd;
                    setTimeout(() => openAcademy(wnd), 100);
                }
            }
        });
    }

    function getTownId() {
        return uw.Game.townId;
    }

    function loadResearches() {
        const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
        return all[getTownId()] || [];
    }

    function saveResearches(researches) {
        const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
        all[getTownId()] = researches;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    }

    function toggleResearch(research, element, isInactive) {
        let researches = loadResearches();
        const index = researches.indexOf(research);

        if (index >= 0) {
            researches.splice(index, 1);
            removeClass(element);
        } else {
            researches.push(research);
            if (isInactive) addClassInactive(element);
            else addClassActive(element);
            tryAutoResearch(research);
        }

        saveResearches(researches);
    }

    function tryAutoResearch(research, townOverride = null) {
        const townId = townOverride || getTownId();
        const town = uw.ITowns.getTown(townId);
        const academy = town.buildings().attributes.academy;
        if (!academy || !research) return;

        const techs = town.researches().attributes;
        const researchesQueue = uw.MM.getFirstTownAgnosticCollectionByName("ResearchOrder")?.fragments[townId]?.models || [];
        const queueLimit = uw.GameDataPremium.isAdvisorActivated('curator') ? 7 : 2;
        const researchesQueueCount = researchesQueue.length;

        const isAlreadyQueued = researchesQueue.some(model => model.attributes.research_type === research);
        if (isAlreadyQueued) return;

        if (researchesQueueCount >= queueLimit) return;

        if (research.endsWith("_old")) {
            research = research.replace("_old", "");
        }
        if (research.endsWith("_bpv")) {
            research = research.replace("_bpv", "");
        }

        if (techs[research]) {
            let researches = loadResearches();
            const index = researches.indexOf(research);
            if (index >= 0) {
                researches.splice(index, 1);
                saveResearches(researches);
                if (currentAcademyWindow) {
                    const selector = "#window_" + currentAcademyWindow.getIdentifier();
                    const researchElement = $(selector).find(`.research.${research}`)[0];
                    if (researchElement) {
                        removeClass(researchElement);
                    }
                }
            }
            return;
        }

        const reqsTech = uw.GameData.researches[research];

        // Verificar se a pesquisa existe no GameData
        if (!reqsTech) {
            console.warn(`Pesquisa "${research}" não encontrada no GameData. Removendo da lista.`);
            let researches = loadResearches();
            const index = researches.indexOf(research);
            if (index >= 0) {
                researches.splice(index, 1);
                saveResearches(researches);
            }
            return;
        }

        let availablePoints = uw.ITowns.getCurrentTown().getBuildings().getBuildingLevel('academy') * GameDataResearches.getResearchPointsPerAcademyLevel();
        $.each(uw.GameData.researches, function (ind) {
            if (uw.ITowns.getCurrentTown().getResearches().get(ind)) {
                availablePoints -= uw.GameData.researches[ind].research_points;
            }
        });

        availablePoints = Math.max(0, availablePoints);

        const { wood, stone, iron } = town.resources();

        // Verificar requisitos
        if (!reqsTech.building_dependencies || !reqsTech.resources ||
            academy < reqsTech.building_dependencies.academy ||
            availablePoints < reqsTech.research_points ||
            wood < reqsTech.resources.wood ||
            stone < reqsTech.resources.stone ||
            iron < reqsTech.resources.iron) {
            return;
        }

        const data = {
            model_url: "ResearchOrder",
            action_name: "research",
            captcha: null,
            arguments: { id: research },
            town_id: townId,
            nl_init: true
        };

        uw.gpAjax.ajaxPost("frontend_bridge", "execute", data, false, (resp) => {
            if (resp && typeof resp.success === 'string' && resp.success.includes("começou")) {
                let researches = loadResearches();
                const index = researches.indexOf(research);
                if (index >= 0) {
                    researches.splice(index, 1);
                    saveResearches(researches);
                }
            }
        });
    }

    function openAcademy(wnd) {
        const selector = "#window_" + wnd.getIdentifier();
        let retries = 0;

        function tryRender() {
            const techTree = $(selector).find(".tech_tree_box");
            if (techTree.length === 0) {
                if (retries++ < 15) return setTimeout(tryRender, 200);
                return;
            }

            const saved = loadResearches();

            techTree.find("div.research").each((_, el) => {
                removeClass(el);
            });

            techTree.find("div.research").each((_, el) => {
                const $el = $(el);
                const classes = $el.attr("class").split(/\s+/);
                // .research.<nome> ... normalmente a 2ª ou 3ª classe
                const research = classes.find(c => c !== 'research' && !c.startsWith('type_')) || classes[2];
                const isInactive = $el.hasClass("inactive");

                $el.off("click.GAP").on("click.GAP", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleResearch(research, el, isInactive);
                });

                if (saved.includes(research)) {
                    if (isInactive) addClassInactive(el);
                    else addClassActive(el);
                }
            });

            setupAcademyObserver(selector);
        }

        tryRender();
    }

    function setupAcademyObserver(selector) {
        if (academyObserver) {
            academyObserver.disconnect();
        }

        const windowElement = $(selector)[0];
        if (!windowElement) return;

        academyObserver = new MutationObserver((mutations) => {
            let shouldReapply = false;

            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    const addedNodes = Array.from(mutation.addedNodes);
                    const removedNodes = Array.from(mutation.removedNodes);

                    const techTreeChanged = [...addedNodes, ...removedNodes].some(node => {
                        if (node.nodeType === 1) {
                            return node.matches && (
                                node.matches('.tech_tree_box') ||
                                (node.querySelector && node.querySelector('.tech_tree_box')) ||
                                node.matches('.research') ||
                                (node.querySelector && node.querySelector('.research'))
                            );
                        }
                        return false;
                    });

                    if (techTreeChanged) {
                        shouldReapply = true;
                    }
                }

                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    const target = mutation.target;
                    if (target.matches && (
                        target.matches('.tab_research') ||
                        target.matches('.tab_research_queue') ||
                        target.classList.contains('active')
                    )) {
                        shouldReapply = true;
                    }
                }
            });

            if (shouldReapply && currentAcademyWindow) {
                setTimeout(() => {
                    if (currentAcademyWindow && $(selector).length > 0) {
                        openAcademy(currentAcademyWindow);
                    }
                }, 150);
            }
        });

        academyObserver.observe(windowElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });
    }

    function resetAcademy() {
        if (currentAcademyWindow) {
            const selector = "#window_" + currentAcademyWindow.getIdentifier();
            $(selector).find(".tech_tree_box .research").each((_, el) => {
                removeClass(el);
            });
            setTimeout(() => openAcademy(currentAcademyWindow), 100);
        }
    }

    function addClassInactive(el) {
        $(el).addClass("GAP_highlight_inactive");
    }

    function addClassActive(el) {
        $(el).addClass("GAP_highlight_active");
    }

    function removeClass(el) {
        $(el).removeClass("GAP_highlight_inactive GAP_highlight_active");
    }
})();
