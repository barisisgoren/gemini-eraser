const SUPPORTED_IMAGE_PATTERN = /^image\/(jpeg|png|webp)$/;
const MAX_FILE_SIZE = 20 * 1024 * 1024;

export function getFileSignature(file) {
    const name = typeof file?.name === 'string' ? file.name : '';
    const size = Number.isFinite(file?.size) ? file.size : 0;
    const lastModified = Number.isFinite(file?.lastModified) ? file.lastModified : 0;
    return `${name}::${size}::${lastModified}`;
}

export function isSupportedUploadFile(file) {
    if (!file) return false;
    if (!SUPPORTED_IMAGE_PATTERN.test(file.type || '')) return false;
    return Number(file.size) <= MAX_FILE_SIZE;
}

export function collectNewQueueFiles(files, existingItems = []) {
    const existingSignatures = new Set(existingItems.map((item) => item.signature));
    const nextSignatures = new Set();
    const acceptedFiles = [];
    let skippedUnsupported = 0;
    let skippedDuplicates = 0;

    for (const file of files) {
        if (!isSupportedUploadFile(file)) {
            skippedUnsupported++;
            continue;
        }

        const signature = getFileSignature(file);
        if (existingSignatures.has(signature) || nextSignatures.has(signature)) {
            skippedDuplicates++;
            continue;
        }

        nextSignatures.add(signature);
        acceptedFiles.push(file);
    }

    return {
        acceptedFiles,
        skippedUnsupported,
        skippedDuplicates
    };
}

export function createQueueItems(files, idBase = Date.now()) {
    return files.map((file, index) => ({
        id: idBase + index,
        file,
        name: file.name,
        signature: getFileSignature(file),
        status: 'pending',
        validation: null,
        originalImg: null,
        processedMeta: null,
        processedBlob: null,
        originalUrl: null,
        processedUrl: null
    }));
}
