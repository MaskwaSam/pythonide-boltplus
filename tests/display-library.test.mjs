import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const context = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL('../display-library.js', import.meta.url), 'utf8'), context);
const library = context.window.BoltDisplayLibrary;
const manifest = JSON.parse(fs.readFileSync(new URL('../display-library-manifest.json', import.meta.url)));

test('complete supplied enums contain 649 images, 77 animations and their random selectors', () => {
  assert.equal(library.images.length, 663);
  assert.equal(library.animations.length, 82);
  assert.equal(library.images.filter(asset => asset.fwid !== null).length, 649);
  assert.equal(library.images.filter(asset => asset.category === 'emoji' && asset.fwid !== null).length, 58);
  assert.equal(library.animations.filter(asset => asset.fwid !== null).length, 77);
  for (const kind of ['images', 'animations']) {
    const assets = library[kind], ids = new Set(assets.map(asset => asset.id));
    assert.equal(ids.size, assets.length);
    assert.equal(new Set(assets.map(asset => asset.constant)).size, assets.length);
    for (const asset of assets) {
      assert.match(asset.constant, /^[A-Z_][A-Z0-9_]*$/);
      if (asset.choices) {
        assert.ok(asset.choices.length > 0);
        for (const id of asset.choices) {
          assert.ok(ids.has(id), `${asset.id} includes unsupported choice ${id}`);
          assert.ok(Number.isInteger(assets.find(asset => asset.id === id).fwid));
        }
      } else assert.ok(Number.isInteger(asset.fwid) && asset.fwid >= 0 && asset.fwid <= 65535);
    }
  }
  assert.equal(library.images.find(asset => asset.id === 'cat').fwid, 642);
  assert.equal(library.images.find(asset => asset.id === 'angry').fwid, 256);
  assert.equal(library.animations.find(asset => asset.id === 'fireworks').fwid, 1029);
});

test('all preview PNGs match the preserved archive extraction hashes', () => {
  assert.equal(manifest.images, library.images.length);
  assert.equal(manifest.animations, library.animations.length);
  for (const item of manifest.thumbnails) {
    assert.match(item.path, /^display_assets\/[a-z0-9_/-]+\.png$/);
    const bytes = fs.readFileSync(new URL('../' + item.path, import.meta.url));
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256, item.path);
  }
});
