(() => {
    const CARD_SELECTOR = ".pdf-slides-card";
    const controllers = new Set();
    const controllerByCard = new WeakMap();
    let activeController = null;
    let pdfJsPromise = null;

    function loadPdfJs() {
        if (!pdfJsPromise) {
            pdfJsPromise = import("/assets/pdfjs/pdf.js")
                .then((pdfjsLib) => {
                    pdfjsLib.GlobalWorkerOptions.workerSrc =
                        "/assets/pdfjs/pdf.worker.js";
                    return pdfjsLib;
                })
                .catch((error) => {
                    pdfJsPromise = null;
                    throw error;
                });
        }
        return pdfJsPromise;
    }

    function requiredElement(card, selector) {
        const element = card.querySelector(selector);
        if (!element) {
            throw new Error(`pdf_slides markup is missing ${selector}`);
        }
        return element;
    }

    function createController(card, activate) {
        const btnToggle = requiredElement(card, ".pdf-slides-toggle");
        const viewer = requiredElement(card, ".pdf-slides-viewer");
        const canvas = requiredElement(card, ".pdf-slides-canvas");
        const status = requiredElement(card, ".pdf-slides-status");
        const statusTitle = requiredElement(card, ".pdf-slides-status__title");
        const statusText = requiredElement(card, ".pdf-slides-status__text");
        const btnPrev = requiredElement(card, '[data-pdf-action="prev"]');
        const btnNext = requiredElement(card, '[data-pdf-action="next"]');
        const info = requiredElement(card, ".pdf-slides-nav__info");
        const pdfUrl = card.dataset.pdfUrl;
        const safeTitle = card.dataset.pdfTitle;
        const ctx = canvas.getContext("2d");

        if (!pdfUrl || !safeTitle || !ctx) {
            throw new Error("pdf_slides card has incomplete data");
        }

        let pdfLoadPromise = null;
        let preloadStarted = false;
        let pdfDoc = null;
        let pageNum = 1;
        let totalPages = 1;
        let rendering = false;
        let pendingPage = null;
        let renderCache = new Map();
        let cacheContainerWidth = 0;
        let hasRenderedPage = false;

        function updateUI() {
            info.textContent = `${pageNum} / ${totalPages}`;
            btnPrev.disabled = pageNum <= 1;
            btnNext.disabled = pageNum >= totalPages;
        }

        function setStatus(state, title, text) {
            status.hidden = false;
            status.dataset.state = state;
            statusTitle.textContent = title;
            statusText.textContent = text;
            canvas.hidden = true;

            if (state === "loading") {
                info.textContent = "Загрузка…";
            } else if (state === "error") {
                info.textContent = "Ошибка";
            }

            btnPrev.disabled = true;
            btnNext.disabled = true;
            viewer.setAttribute(
                "aria-busy",
                state === "loading" ? "true" : "false"
            );
        }

        function showLoadingStatus() {
            const isTrace = /трассиров/i.test(safeTitle);
            const title = isTrace
                ? "Загружаем трассировку…"
                : `Загружаем «${safeTitle}»…`;
            const text = isTrace
                ? "Первый запуск может занять несколько секунд. После загрузки здесь появится первый кадр трассировки."
                : "Первый запуск может занять несколько секунд. После загрузки здесь появится первый слайд.";
            setStatus("loading", title, text);
        }

        function showErrorStatus() {
            setStatus(
                "error",
                "Не удалось открыть слайды",
                "Попробуйте открыть блок ещё раз или обновить страницу."
            );
        }

        function showCanvas() {
            status.hidden = true;
            canvas.hidden = false;
            viewer.setAttribute("aria-busy", "false");
        }

        function getContainerWidth() {
            const visibleContainer = canvas.parentElement;
            if (!viewer.hidden && visibleContainer.clientWidth > 0) {
                return Math.max(320, visibleContainer.clientWidth - 2);
            }

            const fallbackWidth =
                (card.clientWidth ||
                    btnToggle.clientWidth ||
                    visibleContainer.clientWidth ||
                    320) - 22;
            return Math.max(320, fallbackWidth);
        }

        function isVisible() {
            return card.getClientRects().length > 0 && card.clientWidth > 0;
        }

        function resetCacheIfNeeded() {
            const containerWidth = getContainerWidth();
            if (cacheContainerWidth !== containerWidth) {
                renderCache.clear();
                cacheContainerWidth = containerWidth;
            }
            return containerWidth;
        }

        async function getRenderedCanvas(num) {
            resetCacheIfNeeded();
            if (renderCache.has(num)) {
                return renderCache.get(num);
            }

            const renderPromise = (async () => {
                const page = await pdfDoc.getPage(num);
                const containerWidth = getContainerWidth();
                const vp0 = page.getViewport({ scale: 1 });
                const scale = containerWidth / vp0.width;
                const viewport = page.getViewport({ scale });
                const scratchCanvas = document.createElement("canvas");
                scratchCanvas.width = Math.floor(viewport.width);
                scratchCanvas.height = Math.floor(viewport.height);
                const scratchCtx = scratchCanvas.getContext("2d");

                await page.render({
                    canvasContext: scratchCtx,
                    viewport,
                }).promise;
                return scratchCanvas;
            })();

            renderCache.set(num, renderPromise);
            try {
                return await renderPromise;
            } catch (error) {
                renderCache.delete(num);
                throw error;
            }
        }

        function warmNeighbor(num) {
            if (num < 1 || num > totalPages) {
                return;
            }
            void getRenderedCanvas(num).catch(() => {
                renderCache.delete(num);
            });
        }

        async function renderPage(num) {
            rendering = true;
            try {
                const scratchCanvas = await getRenderedCanvas(num);
                if (canvas.width !== scratchCanvas.width) {
                    canvas.width = scratchCanvas.width;
                }
                if (canvas.height !== scratchCanvas.height) {
                    canvas.height = scratchCanvas.height;
                }

                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(scratchCanvas, 0, 0);
                hasRenderedPage = true;
                showCanvas();
                updateUI();
                warmNeighbor(num - 1);
                warmNeighbor(num + 1);
            } finally {
                rendering = false;
            }

            if (pendingPage !== null) {
                const next = pendingPage;
                pendingPage = null;
                queueRender(next);
            }
        }

        function queueRender(num) {
            if (rendering) {
                pendingPage = num;
                return;
            }
            void renderPage(num).catch((error) => {
                showErrorStatus();
                console.error("pdf_slides render failed", error);
            });
        }

        function goPrev() {
            if (pageNum <= 1) {
                return;
            }
            pageNum -= 1;
            updateUI();
            queueRender(pageNum);
        }

        function goNext() {
            if (pageNum >= totalPages) {
                return;
            }
            pageNum += 1;
            updateUI();
            queueRender(pageNum);
        }

        async function loadPdfIfNeeded() {
            if (pdfDoc) {
                return pdfDoc;
            }
            if (!pdfLoadPromise) {
                pdfLoadPromise = (async () => {
                    const pdfjsLib = await loadPdfJs();
                    const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
                    pdfDoc = pdf;
                    totalPages = pdf.numPages;
                    pageNum = 1;
                    updateUI();
                    return pdfDoc;
                })().catch((error) => {
                    pdfLoadPromise = null;
                    throw error;
                });
            }
            return pdfLoadPromise;
        }

        async function initIfNeeded() {
            if (hasRenderedPage) {
                showCanvas();
                updateUI();
                return;
            }

            showLoadingStatus();
            await loadPdfIfNeeded();
            resetCacheIfNeeded();
            await renderPage(pageNum);
        }

        async function preloadIfNeeded() {
            if (preloadStarted || pdfDoc) {
                return;
            }
            preloadStarted = true;
            try {
                await loadPdfIfNeeded();
                resetCacheIfNeeded();
                await getRenderedCanvas(1);
            } catch (error) {
                preloadStarted = false;
                console.error("pdf_slides preload failed", error);
            }
        }

        function schedulePreloadWhenIdle() {
            const run = () => {
                void preloadIfNeeded();
            };

            if ("requestIdleCallback" in window) {
                window.requestIdleCallback(run, { timeout: 1500 });
            } else {
                window.setTimeout(run, 150);
            }
        }

        function handleResize() {
            if (viewer.hidden || !pdfDoc || !isVisible()) {
                return;
            }
            const containerWidth = getContainerWidth();
            if (containerWidth === cacheContainerWidth) {
                return;
            }
            renderCache.clear();
            cacheContainerWidth = containerWidth;
            queueRender(pageNum);
        }

        btnPrev.addEventListener("click", () => {
            activate();
            goPrev();
        });
        btnNext.addEventListener("click", () => {
            activate();
            goNext();
        });
        btnToggle.addEventListener("click", async () => {
            activate();
            if (viewer.hidden) {
                viewer.hidden = false;
                btnToggle.setAttribute("aria-expanded", "true");
                btnToggle.title = "Скрыть слайды";
                btnToggle.setAttribute(
                    "aria-label",
                    `Скрыть слайды: ${safeTitle}`
                );
                try {
                    await initIfNeeded();
                } catch (error) {
                    showErrorStatus();
                    console.error("pdf_slides init failed", error);
                }
            } else {
                viewer.hidden = true;
                btnToggle.setAttribute("aria-expanded", "false");
                btnToggle.title = "Открыть слайды";
                btnToggle.setAttribute(
                    "aria-label",
                    `Открыть слайды: ${safeTitle}`
                );
            }
        });

        return {
            card,
            goNext,
            goPrev,
            handleResize,
            isOpen: () => !viewer.hidden,
            isVisible,
            schedulePreloadWhenIdle,
        };
    }

    function run() {
        let preloadObserver = null;
        if ("IntersectionObserver" in window) {
            preloadObserver = new IntersectionObserver(
                (entries, observer) => {
                    for (const entry of entries) {
                        if (!entry.isIntersecting) {
                            continue;
                        }
                        observer.unobserve(entry.target);
                        controllerByCard
                            .get(entry.target)
                            ?.schedulePreloadWhenIdle();
                    }
                },
                { rootMargin: "1200px 0px" }
            );
        }

        let resizeObserver = null;
        if ("ResizeObserver" in window) {
            resizeObserver = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    controllerByCard.get(entry.target)?.handleResize();
                }
            });
        }

        for (const card of document.querySelectorAll(CARD_SELECTOR)) {
            try {
                let controller = null;
                const activate = () => {
                    activeController = controller;
                };
                controller = createController(card, activate);
                controllers.add(controller);
                controllerByCard.set(card, controller);
                card.addEventListener("focusin", activate);
                card.addEventListener("pointerdown", activate);
                if (preloadObserver) {
                    preloadObserver.observe(card);
                } else {
                    controller.schedulePreloadWhenIdle();
                }
                resizeObserver?.observe(card);
            } catch (error) {
                console.error("pdf_slides setup failed", error);
            }
        }

        if (!resizeObserver) {
            window.addEventListener("resize", () => {
                for (const controller of controllers) {
                    controller.handleResize();
                }
            });
        }
    }

    document.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
            return;
        }
        if (
            event.target?.isContentEditable ||
            event.target?.closest?.("input, textarea, select")
        ) {
            return;
        }

        const controller =
            activeController?.isOpen() && activeController.isVisible()
                ? activeController
                : [...controllers].find(
                      (candidate) =>
                          candidate.isOpen() && candidate.isVisible()
                  );
        if (!controller) {
            return;
        }

        event.preventDefault();
        if (event.key === "ArrowLeft") {
            controller.goPrev();
        } else {
            controller.goNext();
        }
    });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", run, { once: true });
    } else {
        run();
    }
})();
