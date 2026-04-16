import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectNewQueueFiles,
  createQueueItems,
  getFileSignature,
  isSupportedUploadFile,
} from '../../src/core/fileQueue.js';

function createFile({
  name = 'image.png',
  type = 'image/png',
  size = 1024,
  lastModified = 1,
} = {}) {
  return { name, type, size, lastModified };
}

test('isSupportedUploadFile should accept supported image types within size limit', () => {
  assert.equal(isSupportedUploadFile(createFile()), true);
  assert.equal(isSupportedUploadFile(createFile({ type: 'image/jpeg' })), true);
  assert.equal(isSupportedUploadFile(createFile({ type: 'image/webp' })), true);
});

test('isSupportedUploadFile should reject unsupported types and oversized files', () => {
  assert.equal(isSupportedUploadFile(createFile({ type: 'image/gif' })), false);
  assert.equal(isSupportedUploadFile(createFile({ size: 25 * 1024 * 1024 })), false);
});

test('collectNewQueueFiles should skip duplicates against existing queue and incoming batch', () => {
  const existing = createQueueItems([createFile({ name: 'a.png', lastModified: 10 })], 100);
  const duplicateExisting = createFile({ name: 'a.png', lastModified: 10 });
  const duplicateIncoming = createFile({ name: 'b.png', lastModified: 20 });
  const firstIncoming = createFile({ name: 'b.png', lastModified: 20 });
  const uniqueIncoming = createFile({ name: 'c.png', lastModified: 30 });

  const result = collectNewQueueFiles(
    [duplicateExisting, firstIncoming, duplicateIncoming, uniqueIncoming],
    existing
  );

  assert.deepEqual(
    result.acceptedFiles.map((file) => file.name),
    ['b.png', 'c.png']
  );
  assert.equal(result.skippedDuplicates, 2);
  assert.equal(result.skippedUnsupported, 0);
});

test('createQueueItems should assign signatures and preserve file metadata', () => {
  const file = createFile({ name: 'hero.webp', type: 'image/webp', lastModified: 50 });
  const [item] = createQueueItems([file], 42);

  assert.equal(item.id, 42);
  assert.equal(item.name, 'hero.webp');
  assert.equal(item.signature, getFileSignature(file));
  assert.equal(item.status, 'pending');
  assert.equal(item.processedBlob, null);
});
