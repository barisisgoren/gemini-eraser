import {
    WatermarkEngine,
    detectWatermarkConfig,
    calculateWatermarkPosition
} from './core/watermarkEngine.js';
import { WatermarkWorkerClient, canUseWatermarkWorker } from './core/workerClient.js';
import { resolveDisplayWatermarkInfo } from './core/watermarkDisplay.js';
import { canvasToBlob } from './core/canvasBlob.js';
import { collectNewQueueFiles, createQueueItems } from './core/fileQueue.js';
import i18n from './i18n.js';
import {
    loadImage,
    checkOriginal,
    getOriginalStatus,
    resolveOriginalValidation,
    setStatusMessage,
    showLoading,
    hideLoading
} from './utils.js';
import JSZip from 'jszip';
import mediumZoom from 'medium-zoom';

// global state
let enginePromise = null;
let workerClient = null;
let imageQueue = [];
let zoom = null;
let isQueueProcessing = false;
let shouldReprocessQueue = false;

// dom elements references
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const folderInput = document.getElementById('folderInput');
const selectFilesBtn = document.getElementById('selectFilesBtn');
const selectFolderBtn = document.getElementById('selectFolderBtn');
const clearQueueBtn = document.getElementById('clearQueueBtn');
const queueSummary = document.getElementById('queueSummary');
const singlePreview = document.getElementById('singlePreview');
const multiPreview = document.getElementById('multiPreview');
const imageList = document.getElementById('imageList');
const progressText = document.getElementById('progressText');
const downloadAllBtn = document.getElementById('downloadAllBtn');
const originalImage = document.getElementById('originalImage');
const processedImage = document.getElementById('processedImage');
const originalInfo = document.getElementById('originalInfo');
const processedInfo = document.getElementById('processedInfo');
const downloadBtn = document.getElementById('downloadBtn');
const copyBtn = document.getElementById('copyBtn');
const resetBtn = document.getElementById('resetBtn');

async function getEngine() {
    if (!enginePromise) {
        enginePromise = WatermarkEngine.create().catch((error) => {
            enginePromise = null;
            throw error;
        });
    }
    return enginePromise;
}

function getEstimatedWatermarkInfo(item) {
    if (!item?.originalImg) return null;
    const { width, height } = item.originalImg;
    const config = detectWatermarkConfig(width, height);
    const position = calculateWatermarkPosition(width, height, config);
    return {
        size: config.logoSize,
        position,
        config
    };
}

function disableWorkerClient(reason) {
    if (!workerClient) return;
    console.warn('disable worker path, fallback to main thread:', reason);
    workerClient.dispose();
    workerClient = null;
}

function getCompletedCount() {
    return imageQueue.filter((item) => item.status === 'completed').length;
}

function getPendingCount() {
    return imageQueue.filter((item) => item.status === 'pending' || item.status === 'processing').length;
}

function updateQueueSummary() {
    if (!queueSummary) return;
    if (imageQueue.length === 0) {
        queueSummary.textContent = i18n.t('queue.empty');
        return;
    }

    queueSummary.textContent = i18n.t('queue.summary', {
        count: imageQueue.length,
        pending: getPendingCount(),
        completed: getCompletedCount()
    });
}

function updateBatchControls() {
    updateQueueSummary();
    if (clearQueueBtn) {
        clearQueueBtn.style.display = imageQueue.length > 0 ? 'inline-flex' : 'none';
    }
    if (downloadAllBtn) {
        downloadAllBtn.style.display = getCompletedCount() > 0 && imageQueue.length > 1 ? 'flex' : 'none';
    }
}

function notifyBatchImport({ addedCount, skippedUnsupported, skippedDuplicates }) {
    if (addedCount === 0) {
        if (skippedUnsupported > 0 || skippedDuplicates > 0) {
            setStatusMessage(
                i18n.t('queue.no_new_files', {
                    duplicates: skippedDuplicates,
                    unsupported: skippedUnsupported
                }),
                'warn'
            );
        }
        return;
    }

    if (skippedUnsupported > 0 || skippedDuplicates > 0) {
        setStatusMessage(
            i18n.t('queue.partial', {
                added: addedCount,
                duplicates: skippedDuplicates,
                unsupported: skippedUnsupported
            }),
            'warn'
        );
        return;
    }

    if (addedCount > 1) {
        setStatusMessage(i18n.t('queue.added', { count: addedCount }), 'success');
    }
}

/**
 * initialize the application
 */
async function init() {
    try {
        await i18n.init();
        setupLanguageSwitch();
        setupDarkMode();
        showLoading(i18n.t('status.loading'));

        if (canUseWatermarkWorker()) {
            try {
                workerClient = new WatermarkWorkerClient({
                    workerUrl: './workers/watermark-worker.js'
                });
            } catch (workerError) {
                console.warn('worker unavailable, fallback to main thread:', workerError);
                workerClient = null;
            }
        }
        if (!workerClient) {
            getEngine().catch((error) => {
                console.warn('main thread engine warmup failed:', error);
            });
        }

        hideLoading();
        setupEventListeners();
        setupSlider();
        updateBatchControls();

        zoom = mediumZoom('[data-zoomable]', {
            margin: 24,
            scrollOffset: 0,
            background: 'rgba(20, 12, 8, .78)',
        })
    } catch (error) {
        hideLoading();
        console.error('initialize error:', error);
    }
}

/**
 * setup language switch
 */
function setupLanguageSwitch() {
    const select = document.getElementById('langSwitch');
    if (!select) return;
    select.value = i18n.resolveLocale(i18n.locale);
    select.addEventListener('change', async () => {
        const newLocale = i18n.resolveLocale(select.value);
        if (newLocale === i18n.locale) return;
        await i18n.switchLocale(newLocale);
        select.value = i18n.locale;
        updateDynamicTexts();
    });
}

/**
 * setup event listeners
 */
function setupEventListeners() {
    uploadArea.addEventListener('click', (event) => {
        if (event.target.closest('button')) return;
        fileInput.click();
    });
    fileInput.addEventListener('change', handleFileSelect);
    folderInput.addEventListener('change', handleFolderSelect);
    selectFilesBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        fileInput.click();
    });
    selectFolderBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        folderInput.click();
    });
    clearQueueBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        reset();
    });

    // Global drag & drop
    document.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('border-primary', 'bg-primary/10', 'dark:bg-primary/10');
    });

    document.addEventListener('dragleave', (e) => {
        if (e.clientX === 0 && e.clientY === 0) {
            uploadArea.classList.remove('border-primary', 'bg-primary/10', 'dark:bg-primary/10');
        }
    });

    document.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('border-primary', 'bg-primary/10', 'dark:bg-primary/10');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFiles(Array.from(e.dataTransfer.files));
        }
    });

    // Paste support
    document.addEventListener('paste', (e) => {
        const items = e.clipboardData.items;
        const files = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].kind === 'file' && items[i].type.startsWith('image/')) {
                files.push(items[i].getAsFile());
            }
        }
        if (files.length > 0) handleFiles(files);
    });

    downloadAllBtn.addEventListener('click', downloadAll);
    resetBtn.addEventListener('click', reset);
    window.addEventListener('beforeunload', () => {
        disableWorkerClient('beforeunload');
    });
}

function reset() {
    singlePreview.style.display = 'none';
    multiPreview.style.display = 'none';
    imageQueue.forEach(item => {
        if (item.originalUrl) URL.revokeObjectURL(item.originalUrl);
        if (item.processedUrl) URL.revokeObjectURL(item.processedUrl);
    });
    imageQueue = [];
    fileInput.value = '';
    folderInput.value = '';
    copyBtn.style.display = 'none';
    downloadBtn.style.display = 'none';
    processedInfo.style.display = 'none';
    imageList.innerHTML = '';
    setStatusMessage('');
    updateBatchControls();
    uploadArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function handleFileSelect(e) {
    handleFiles(Array.from(e.target.files));
    e.target.value = '';
}

function handleFolderSelect(e) {
    handleFiles(Array.from(e.target.files));
    e.target.value = '';
}

function switchToMultiPreview() {
    singlePreview.style.display = 'none';
    multiPreview.style.display = 'block';
    imageList.innerHTML = '';
    imageQueue.forEach(item => createImageCard(item));
    imageQueue.forEach(item => syncImageCard(item));
    updateProgress();
    updateBatchControls();
    multiPreview.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function handleFiles(files) {
    const { acceptedFiles, skippedUnsupported, skippedDuplicates } = collectNewQueueFiles(files, imageQueue);
    notifyBatchImport({
        addedCount: acceptedFiles.length,
        skippedUnsupported,
        skippedDuplicates
    });

    if (acceptedFiles.length === 0) {
        updateBatchControls();
        return;
    }

    const newItems = createQueueItems(acceptedFiles, Date.now());
    const hadSinglePreview = singlePreview.style.display !== 'none' && imageQueue.length === 1;
    imageQueue = [...imageQueue, ...newItems];

    if (imageQueue.length === 1) {
        singlePreview.style.display = 'block';
        multiPreview.style.display = 'none';
        updateBatchControls();
        processSingle(imageQueue[0]);
        return;
    }

    if (hadSinglePreview || multiPreview.style.display === 'none') {
        switchToMultiPreview();
    } else {
        newItems.forEach(item => createImageCard(item));
        newItems.forEach(item => syncImageCard(item));
        updateProgress();
        updateBatchControls();
    }

    processQueue();
}

function renderSingleImageMeta(item) {
    if (!item?.originalImg) return;

    const watermarkInfo = resolveDisplayWatermarkInfo(
        item,
        getEstimatedWatermarkInfo(item)
    );
    if (!watermarkInfo) return;

    originalInfo.innerHTML = `
        <p>${i18n.t('info.size')}: ${item.originalImg.width}×${item.originalImg.height}</p>
        <p>${i18n.t('info.watermark')}: ${watermarkInfo.size}×${watermarkInfo.size}</p>
        <p>${i18n.t('info.position')}: (${watermarkInfo.position.x},${watermarkInfo.position.y})</p>
    `;
}

function getProcessedStatusLabel(item) {
    return item?.processedMeta?.applied === false
        ? i18n.t('info.skipped')
        : i18n.t('info.removed');
}

function renderSingleProcessedMeta(item) {
    if (!item?.originalImg) return;

    const watermarkInfo = resolveDisplayWatermarkInfo(
        item,
        getEstimatedWatermarkInfo(item)
    );
    const showWatermarkInfo = watermarkInfo && item?.processedMeta?.applied !== false;

    processedInfo.innerHTML = `
        <p>${i18n.t('info.size')}: ${item.originalImg.width}×${item.originalImg.height}</p>
        ${showWatermarkInfo ? `<p>${i18n.t('info.watermark')}: ${watermarkInfo.size}×${watermarkInfo.size}</p>` : ''}
        ${showWatermarkInfo ? `<p>${i18n.t('info.position')}: (${watermarkInfo.position.x},${watermarkInfo.position.y})</p>` : ''}
        <p>${i18n.t('info.status')}: ${getProcessedStatusLabel(item)}</p>
    `;
}

function renderImageCardStatus(item) {
    if (!item) return;

    if (item.status === 'pending') {
        updateStatus(item.id, i18n.t('status.pending'));
        return;
    }

    if (item.status === 'processing') {
        updateStatus(item.id, i18n.t('status.processing'));
        return;
    }

    if (item.status === 'error') {
        updateStatus(item.id, i18n.t('status.failed'));
        return;
    }

    if (item.status !== 'completed' || !item.originalImg) return;

    const watermarkInfo = resolveDisplayWatermarkInfo(
        item,
        getEstimatedWatermarkInfo(item)
    );
    const showWatermarkInfo = watermarkInfo && item?.processedMeta?.applied !== false;

    let html = `<p>${i18n.t('info.size')}: ${item.originalImg.width}×${item.originalImg.height}</p>`;
    if (showWatermarkInfo) {
        html += `<p>${i18n.t('info.watermark')}: ${watermarkInfo.size}×${watermarkInfo.size}</p>
        <p>${i18n.t('info.position')}: (${watermarkInfo.position.x},${watermarkInfo.position.y})</p>`;
    }
    html += `<p>${i18n.t('info.status')}: ${getProcessedStatusLabel(item)}</p>`;

    if (item.validation && !item.validation.is_google) {
        html += `<p class="inline-block mt-1 text-xs md:text-sm text-warn">${getOriginalStatus(item.validation)}</p>`;
    }

    updateStatus(item.id, html, true);
}

async function processSingle(item) {
    try {
        item.status = 'processing';
        updateBatchControls();
        const img = await loadImage(item.file);
        item.originalImg = img;
        item.originalUrl = img.src;

        const validation = await checkOriginal(item.file);
        item.validation = validation;
        const status = getOriginalStatus(validation);
        setStatusMessage(status, validation.is_google ? 'success' : 'warn');

        originalImage.src = img.src;
        renderSingleImageMeta(item);

        const processed = await processImageWithBestPath(item.file, img);
        item.processedMeta = processed.meta;
        item.validation = resolveOriginalValidation(item.validation, item.processedMeta);
        const resolvedStatus = getOriginalStatus(item.validation);
        setStatusMessage(resolvedStatus, item.validation.is_google ? 'success' : 'warn');

        renderSingleImageMeta(item);
        item.processedBlob = processed.blob;

        item.processedUrl = URL.createObjectURL(processed.blob);
        item.status = 'completed';

        if (singlePreview.style.display === 'none' || imageQueue.length > 1) {
            syncImageCard(item);
            updateProgress();
            updateBatchControls();
            return;
        }

        processedImage.src = item.processedUrl;
        const overlay = document.getElementById('processedOverlay');
        const handle = document.getElementById('sliderHandle');
        overlay.style.display = 'block';
        handle.style.display = 'flex';
        processedInfo.style.display = 'block';

        copyBtn.style.display = 'flex';
        copyBtn.onclick = () => copyImage(item);

        downloadBtn.style.display = 'flex';
        downloadBtn.onclick = () => downloadImage(item);

        renderSingleProcessedMeta(item);
        updateBatchControls();

        document.getElementById('comparisonContainer').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
        item.status = 'error';
        if (singlePreview.style.display === 'none' || imageQueue.length > 1) {
            syncImageCard(item);
        }
        updateBatchControls();
        console.error(error);
    }
}

function createImageCard(item) {
    const card = document.createElement('div');
    card.id = `card-${item.id}`;
    card.className = 'overflow-hidden rounded-[1.5rem] border border-orange-200 bg-white/90 shadow-card dark:border-orange-900/40 dark:bg-stone-950/80 md:h-[156px]';
    card.innerHTML = `
        <div class="flex flex-wrap h-full">
            <div class="w-full md:w-auto h-full flex border-b border-orange-100 dark:border-orange-900/30">
                <div class="w-24 md:w-48 flex-shrink-0 bg-orange-50 p-2 flex items-center justify-center dark:bg-stone-900/70">
                    <img id="result-${item.id}" class="max-w-full max-h-24 md:max-h-full rounded" data-zoomable />
                </div>
                <div class="flex-1 p-4 flex flex-col min-w-0">
                    <h4 class="mb-2 truncate text-sm font-semibold text-stone-900 dark:text-orange-50">${item.name}</h4>
                    <div class="text-xs text-stone-500 dark:text-orange-100/65" id="status-${item.id}">${i18n.t('status.pending')}</div>
                </div>
            </div>
            <div class="w-full md:w-auto ml-auto flex-shrink-0 p-2 md:p-4 flex flex-col md:flex-row items-center justify-center gap-2">
                <button id="copy-${item.id}" class="hidden inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-xs text-white md:text-sm hover:bg-primary-hover">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m-1 10H8m4-3H8m1.5 6H8"></path></svg>
                    <span data-i18n="btn.copy">${i18n.t('btn.copy')}</span>
                </button>
                <button id="download-${item.id}" class="hidden rounded-lg bg-ink px-4 py-2 text-xs text-white md:text-sm hover:bg-secondary">
                    <span data-i18n="btn.download">${i18n.t('btn.download')}</span>
                </button>
            </div>
        </div>
    `;
    imageList.appendChild(card);
}

function syncImageCard(item) {
    const resultImage = document.getElementById(`result-${item.id}`);
    if (resultImage) {
        const previewSrc = item.processedUrl || item.originalUrl || item.originalImg?.src || '';
        if (previewSrc) {
            resultImage.src = previewSrc;
            zoom.attach(resultImage);
        }
    }

    renderImageCardStatus(item);

    const copyButton = document.getElementById(`copy-${item.id}`);
    const downloadButton = document.getElementById(`download-${item.id}`);
    if (!copyButton || !downloadButton) return;

    if (item.status === 'completed' && item.processedBlob) {
        copyButton.classList.remove('hidden');
        copyButton.onclick = () => copyImage(item, copyButton);

        downloadButton.classList.remove('hidden');
        downloadButton.onclick = () => downloadImage(item);
        return;
    }

    copyButton.classList.add('hidden');
    downloadButton.classList.add('hidden');
}

async function ensureQueueItemPreview(item) {
    if (item.originalImg && item.originalUrl) {
        syncImageCard(item);
        return;
    }

    const img = await loadImage(item.file);
    item.originalImg = img;
    item.originalUrl = img.src;
    syncImageCard(item);
}

async function processQueue() {
    if (isQueueProcessing) {
        shouldReprocessQueue = true;
        return;
    }

    isQueueProcessing = true;
    try {
        await Promise.all(imageQueue.map((item) => ensureQueueItemPreview(item)));

        const concurrency = 3;
        for (let i = 0; i < imageQueue.length; i += concurrency) {
            await Promise.all(imageQueue.slice(i, i + concurrency).map(async item => {
                if (item.status !== 'pending') return;

                item.status = 'processing';
                syncImageCard(item);

                try {
                    const processed = await processImageWithBestPath(item.file, item.originalImg);
                    item.processedMeta = processed.meta;
                    item.processedBlob = processed.blob;

                    item.processedUrl = URL.createObjectURL(processed.blob);
                    item.status = 'completed';
                    syncImageCard(item);
                    updateProgress();
                    updateBatchControls();

                    checkOriginal(item.file).then((validation) => {
                        item.validation = resolveOriginalValidation(validation, item.processedMeta);
                        syncImageCard(item);
                    }).catch(() => { });
                } catch (error) {
                    item.status = 'error';
                    syncImageCard(item);
                    console.error(error);
                }
            }));
        }
    } finally {
        isQueueProcessing = false;
        updateBatchControls();
    }

    if (shouldReprocessQueue) {
        shouldReprocessQueue = false;
        processQueue();
    }
}

async function processImageWithBestPath(file, fallbackImage, options = {}) {
    if (workerClient) {
        try {
            return await workerClient.processBlob(file, options);
        } catch (error) {
            console.warn('worker process failed, fallback to main thread:', error);
            disableWorkerClient(error);
        }
    }

    const engine = await getEngine();
    const canvas = await engine.removeWatermarkFromImage(fallbackImage, options);
    const blob = await canvasToBlob(canvas);
    return {
        blob,
        meta: canvas.__watermarkMeta || null
    };
}

function updateStatus(id, text, isHtml = false) {
    const el = document.getElementById(`status-${id}`);
    if (el) el.innerHTML = isHtml ? text : text.replace(/\n/g, '<br>');
}

function updateProgress() {
    progressText.textContent = `${i18n.t('progress.text')}: ${getCompletedCount()}/${imageQueue.length}`;
}

function updateDynamicTexts() {
    updateBatchControls();
    if (progressText.textContent || imageQueue.length > 0) {
        updateProgress();
    }

    if (imageQueue.length > 1) {
        imageQueue.forEach(item => syncImageCard(item));
    } else if (imageQueue.length > 0) {
        imageQueue.forEach(item => renderImageCardStatus(item));
    }

    if (singlePreview.style.display !== 'none' && imageQueue.length === 1) {
        const [item] = imageQueue;
        renderSingleImageMeta(item);

        if (item?.processedBlob) {
            renderSingleProcessedMeta(item);
        }

        if (item?.validation) {
            const status = getOriginalStatus(item.validation);
            setStatusMessage(status, item.validation.is_google ? 'success' : 'warn');
        }
    }
}

async function copyImage(item, targetBtn = copyBtn) {
    if (!navigator.clipboard || !window.ClipboardItem) {
        setStatusMessage(i18n.t('status.unsupported'), 'warn');
        return;
    }

    try {
        if (!item.processedBlob) return;
        const data = [new ClipboardItem({ [item.processedBlob.type]: item.processedBlob })];
        await navigator.clipboard.write(data);

        const span = targetBtn.querySelector('span');
        const svg = targetBtn.querySelector('svg');
        const originalText = span.textContent;
        const originalSvgPath = svg.innerHTML;

        span.textContent = i18n.t('status.copied');
        svg.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>';

        setTimeout(() => {
            // Restore using i18n to handle potential language switch during timeout
            span.textContent = i18n.t('btn.copy');
            svg.innerHTML = originalSvgPath;
        }, 2000);
    } catch (err) {
        console.error('Failed to copy image: ', err);
        setStatusMessage(i18n.t('status.copy_failed'), 'warn');
    }
}

function downloadImage(item) {
    const a = document.createElement('a');
    a.href = item.processedUrl;
    a.download = `unwatermarked_${item.name.replace(/\.[^.]+$/, '')}.png`;
    a.click();
}

async function downloadAll() {
    const completed = imageQueue.filter(item => item.status === 'completed');
    if (completed.length === 0) return;

    const zip = new JSZip();
    completed.forEach(item => {
        const filename = `unwatermarked_${item.name.replace(/\.[^.]+$/, '')}.png`;
        zip.file(filename, item.processedBlob);
    });

    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `unwatermarked_${Date.now()}.zip`;
    a.click();
}

function setupDarkMode() {
    const themeToggle = document.getElementById('themeToggle');
    const html = document.documentElement;

    if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        html.classList.add('dark');
    }

    themeToggle.addEventListener('click', () => {
        if (html.classList.contains('dark')) {
            html.classList.remove('dark');
            localStorage.theme = 'light';
        } else {
            html.classList.add('dark');
            localStorage.theme = 'dark';
        }
    });
}

function setupSlider() {
    const container = document.getElementById('comparisonContainer');
    const overlay = document.getElementById('processedOverlay');
    const handle = document.getElementById('sliderHandle');
    let isDown = false;

    function move(e) {
        if (!isDown) return;
        const rect = container.getBoundingClientRect();
        const clientX = e.clientX || (e.touches && e.touches[0].clientX);
        if (!clientX) return;

        const x = clientX - rect.left;
        const percent = Math.min(Math.max(x / rect.width, 0), 1) * 100;

        overlay.style.width = `${percent}%`;
        handle.style.left = `${percent}%`;
    }

    container.addEventListener('mousedown', (e) => { isDown = true; move(e); });
    window.addEventListener('mouseup', () => { isDown = false; });
    window.addEventListener('mousemove', move);

    container.addEventListener('touchstart', (e) => { isDown = true; move(e); });
    window.addEventListener('touchend', () => { isDown = false; });
    window.addEventListener('touchmove', move);
}

init();
