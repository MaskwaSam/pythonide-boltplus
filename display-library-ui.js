/* Browse built-in BOLT+ display assets without sending commands to the robot. */
(function () {
  'use strict';
  const PAGE_SIZE = 80;
  const make = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const labelControl = (label, control) => {
    const wrapper = make('label', null, 'bolt-display-field');
    wrapper.append(make('span', label), control);
    return wrapper;
  };

  class BoltDisplayBrowser {
    constructor({ onUseExample, isBusy = () => false }) {
      this.onUseExample = onUseExample;
      this.isBusy = isBusy;
      this.page = 0;
      this.selected = null;
      this.build();
    }
    build() {
      const style = make('style');
      style.textContent = `
#displayLibraryDialog{box-sizing:border-box;width:min(960px,calc(100vw - 24px));max-width:calc(100vw - 24px);max-height:85vh;padding:16px;border:1px solid var(--line,#888);border-radius:10px;background:var(--panel,#fff);color:var(--text,#222);overflow:auto}
#displayLibraryDialog::backdrop{background:rgba(0,0,0,.6)}
#displayLibraryDialog *{box-sizing:border-box}
#displayLibraryDialog .bolt-display-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}
#displayLibraryDialog h2,#displayLibraryDialog h3{margin:0}
#displayLibraryDialog .bolt-display-note{color:var(--muted,#555);font-size:.9em}
#displayLibraryDialog .bolt-display-filters{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0}
#displayLibraryDialog .bolt-display-field{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1 1 140px}
#displayLibraryDialog input,#displayLibraryDialog select,#displayLibraryDialog textarea{width:100%;min-width:0;padding:7px;border:1px solid var(--line,#888);border-radius:5px;background:var(--panel,#fff);color:var(--text,#222);font:inherit}
#displayLibraryDialog .bolt-display-layout{display:grid;grid-template-columns:minmax(0,2fr) minmax(220px,1fr);gap:16px}
#displayLibraryDialog .bolt-display-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px;max-height:36vh;overflow:auto;padding:3px}
#displayLibraryDialog .bolt-display-tile{min-width:0;display:flex;flex-direction:column;align-items:center;gap:4px;overflow-wrap:anywhere;text-align:center;font-size:.85em}
#displayLibraryDialog .bolt-display-tile[aria-pressed="true"]{outline:3px solid var(--accent,#2670d9);outline-offset:1px}
#displayLibraryDialog .bolt-display-tile img{width:64px;height:64px;object-fit:contain}
#displayLibraryDialog .bolt-display-id{font-size:.85em;color:var(--muted,#555)}
#displayLibraryDialog .bolt-display-pages{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0}
#displayLibraryDialog .bolt-display-detail{min-width:0;overflow-wrap:anywhere}
#displayLibraryDialog .bolt-display-detail img{display:block;width:96px;height:96px;object-fit:contain;margin:8px 0}
#displayLibraryDialog textarea{display:block;min-height:150px;resize:vertical;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.85em;margin:5px 0 8px}
#displayLibraryDialog button:focus-visible,#displayLibraryDialog input:focus-visible,#displayLibraryDialog select:focus-visible,#displayLibraryDialog textarea:focus-visible{outline:3px solid var(--accent,#2670d9);outline-offset:2px}
@media(max-width:600px){#displayLibraryDialog .bolt-display-layout{grid-template-columns:minmax(0,1fr)}#displayLibraryDialog .bolt-display-grid{max-height:30vh}}
`;
      document.head.append(style);
      this.button = make('button', 'Emoji + animations');
      this.button.id = 'displayLibraryButton';
      this.button.type = 'button';
      this.button.setAttribute('aria-haspopup', 'dialog');
      const open = document.getElementById('open');
      if (!open || !open.parentNode) throw new Error('Display browser requires the Open button');
      open.parentNode.insertBefore(this.button, open);
      this.dialog = make('dialog');
      this.dialog.id = 'displayLibraryDialog';
      this.dialog.setAttribute('aria-labelledby', 'boltDisplayTitle');
      const heading = make('div', null, 'bolt-display-heading');
      const title = make('h2', 'Emoji + animations');
      title.id = 'boltDisplayTitle';
      const close = make('button', 'Close');
      close.type = 'button';
      close.setAttribute('aria-label', 'Close display library');
      heading.append(title, close);
      this.dialog.append(heading, make('p', 'Built-in robot assets. Thumbnails are static; custom GIF uploads and emoji text are not supported.', 'bolt-display-note'));
      const filters = make('div', null, 'bolt-display-filters');
      this.search = make('input');
      this.search.type = 'search';
      this.search.id = 'displayAssetSearch';
      this.search.placeholder = 'Search assets';
      this.type = make('select');
      this.type.id = 'displayAssetType';
      for (const [value, name] of [['images', 'Images'], ['animations', 'Animations']]) {
        const option = make('option', name); option.value = value; this.type.append(option);
      }
      this.category = make('select');
      this.category.id = 'displayAssetCategory';
      filters.append(labelControl('Search', this.search), labelControl('Type', this.type), labelControl('Category', this.category));
      this.dialog.append(filters);
      const layout = make('div', null, 'bolt-display-layout');
      const results = make('section');
      this.count = make('p');
      this.count.setAttribute('role', 'status');
      this.grid = make('div', null, 'bolt-display-grid');
      this.grid.setAttribute('aria-label', 'Display assets');
      const pages = make('div', null, 'bolt-display-pages');
      this.previous = make('button', 'Previous'); this.previous.type = 'button';
      this.next = make('button', 'Next'); this.next.type = 'button';
      this.pageLabel = make('span');
      pages.append(this.previous, this.pageLabel, this.next);
      results.append(this.count, this.grid, pages);
      this.detail = make('section', null, 'bolt-display-detail');
      this.detail.setAttribute('aria-label', 'Selected asset');
      this.detailTitle = make('h3', 'Select an asset');
      this.preview = make('img');
      this.preview.hidden = true;
      this.metadata = make('p');
      this.code = make('textarea');
      this.code.id = 'displayAssetCode';
      this.code.readOnly = true;
      this.code.spellcheck = false;
      this.use = make('button', 'Use example');
      this.use.id = 'useDisplayAsset'; this.use.type = 'button'; this.use.disabled = true;
      this.detail.append(this.detailTitle, this.preview, this.metadata, labelControl('Python example (select and copy)', this.code), this.use);
      layout.append(results, this.detail);
      this.dialog.append(layout);
      document.body.append(this.dialog);
      this.button.addEventListener('click', () => {
        this.render();
        this.dialog.showModal();
        this.search.focus();
      });
      close.addEventListener('click', () => this.dialog.close());
      this.dialog.addEventListener('close', () => this.button.focus());
      this.search.addEventListener('input', () => { this.page = 0; this.render(); });
      this.type.addEventListener('change', () => { this.page = 0; this.selected = null; this.populateCategories(); this.render(); });
      this.category.addEventListener('change', () => { this.page = 0; this.render(); });
      this.previous.addEventListener('click', () => { this.page--; this.render(); });
      this.next.addEventListener('click', () => { this.page++; this.render(); });
      this.use.addEventListener('click', async () => {
        if (!this.selected || this.isBusy() || typeof this.onUseExample !== 'function') return;
        this.use.disabled = true;
        try {
          const filename = `display-${String(this.selected.id).replace(/[^a-zA-Z0-9_-]/g, '-')}.py`;
          if (await this.onUseExample(this.code.value, filename)) this.dialog.close();
        } finally { this.use.disabled = !this.selected || this.isBusy(); }
      });
      this.populateCategories();
      this.render();
    }
    assets() {
      const library = window.BoltDisplayLibrary || {};
      return Array.isArray(library[this.type.value]) ? library[this.type.value] : [];
    }
    populateCategories() {
      this.category.replaceChildren();
      const all = make('option', 'All categories'); all.value = ''; this.category.append(all);
      const categories = [...new Set(this.assets().map(asset => asset.category).filter(Boolean))].sort();
      for (const category of categories) {
        const option = make('option', String(category).replace(/_/g, ' ')); option.value = category; this.category.append(option);
      }
    }
    render() {
      const query = this.search.value.trim().toLowerCase();
      const matches = this.assets().filter(asset =>
        (!this.category.value || asset.category === this.category.value) &&
        [asset.id, asset.name, asset.constant, asset.category].some(value => String(value || '').toLowerCase().includes(query))
      );
      const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
      this.page = Math.max(0, Math.min(this.page, pages - 1));
      const start = this.page * PAGE_SIZE;
      const visible = matches.slice(start, start + PAGE_SIZE);
      this.count.textContent = matches.length ? `Showing ${start + 1}–${start + visible.length} of ${matches.length} assets` : 'No assets found';
      this.pageLabel.textContent = `Page ${this.page + 1} of ${pages}`;
      this.previous.disabled = this.page === 0;
      this.next.disabled = this.page >= pages - 1;
      this.grid.replaceChildren();
      for (const asset of visible) {
        const tile = make('button', null, 'bolt-display-tile'); tile.type = 'button';
        tile.setAttribute('aria-pressed', String(this.selected === asset));
        const image = make('img'); image.src = asset.thumbnail; image.alt = `${asset.name || asset.id} thumbnail`; image.loading = 'lazy';
        tile.append(image, make('span', asset.name || asset.id), make('span', asset.id, 'bolt-display-id'));
        tile.addEventListener('click', () => {
          this.selected = asset;
          for (const other of this.grid.children) other.setAttribute('aria-pressed', String(other === tile));
          this.renderDetail();
        });
        this.grid.append(tile);
      }
      this.renderDetail();
    }
    renderDetail() {
      const asset = this.selected;
      this.detailTitle.textContent = asset ? (asset.name || asset.id) : 'Select an asset';
      this.preview.hidden = !asset;
      if (asset) { this.preview.src = asset.thumbnail; this.preview.alt = `${asset.name || asset.id} thumbnail`; }
      else { this.preview.removeAttribute('src'); this.preview.alt = ''; }
      this.metadata.textContent = asset ? `ID: ${asset.id} · Category: ${asset.category} · Constant: ${asset.constant}` : '';
      // Only valid Python identifiers from the manifest can enter generated code.
      const valid = asset && /^[A-Z][A-Z0-9_]*$/.test(asset.constant);
      const animation = this.type.value === 'animations';
      const typeName = animation ? 'DisplayAnimation' : 'DisplayImage';
      const method = animation ? 'set_display_animation' : 'set_display_image';
      this.code.value = valid ? `from sphero import ${typeName}, ${method}, delay\n\nasync def start_program():\n    await ${method}(${typeName}.${asset.constant}${animation ? ', looping=True' : ''})\n    await delay(${animation ? 3 : 2})\n` : '';
      this.use.disabled = !valid || this.isBusy();
    }
  }
  window.BoltDisplayBrowser = BoltDisplayBrowser;
}());
