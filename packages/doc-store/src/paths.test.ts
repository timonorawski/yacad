import { describe, expect, it } from 'vitest';
import { blobKey, docKey, listBlobsPrefix, listDocsPrefix, metaKey, parseDocId } from './paths';

describe('paths', () => {
  it('metaKey produces /docs/{id}/meta.json', () => {
    expect(metaKey('abc-123')).toBe('/docs/abc-123/meta.json');
  });

  it('docKey produces /docs/{id}/document.json', () => {
    expect(docKey('abc-123')).toBe('/docs/abc-123/document.json');
  });

  it('blobKey produces /docs/{id}/blobs/{hash}.bin', () => {
    expect(blobKey('abc-123', 'deadbeef')).toBe('/docs/abc-123/blobs/deadbeef.bin');
  });

  it('listBlobsPrefix returns /docs/{id}/blobs/', () => {
    expect(listBlobsPrefix('abc-123')).toBe('/docs/abc-123/blobs/');
  });

  it('listDocsPrefix returns /docs/', () => {
    expect(listDocsPrefix()).toBe('/docs/');
  });

  it('parseDocId pulls the id out of a meta key', () => {
    expect(parseDocId('/docs/abc-123/meta.json')).toBe('abc-123');
  });

  it('parseDocId returns undefined for non-matching keys', () => {
    expect(parseDocId('/other/foo')).toBeUndefined();
    expect(parseDocId('/docs/abc-123/blobs/deadbeef.bin')).toBeUndefined();
  });
});
