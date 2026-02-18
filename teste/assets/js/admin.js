(() => {
  const $ = (s) => document.querySelector(s);
  const storeKey = 'linkgen_test_hist_v1';

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function loadHist() {
    try { return JSON.parse(localStorage.getItem(storeKey) || '[]'); }
    catch { return []; }
  }

  function saveHist(items) {
    localStorage.setItem(storeKey, JSON.stringify(items));
  }

  function esc(str){
    return String(str ?? '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'","&#039;");
  }

  function applySearch(hist) {
    const term = ($('#q')?.value || '').trim().toLowerCase();
    if (!term) return hist;
    return hist.filter(h =>
      (h.title || '').toLowerCase().includes(term) ||
      (h.rawLinks || '').toLowerCase().includes(term)
    );
  }

  function computeKpis(hist) {
    let total = 0;
    let ok = 0;
    let err = 0;

    for (const h of hist) {
      const items = h.items || [];
      total += items.length;
      for (const it of items) {
        if (it.ok) ok += 1;
        else err += 1;
      }
    }

    $('#k_total').textContent = total;
    $('#k_ok').textContent = ok;
    $('#k_err').textContent = err;
  }

  function renderList(hist) {
    const list = $('#list');
    const emptyList = $('#emptyList');

    list.innerHTML = '';

    const filtered = applySearch(hist);

    if (!filtered.length) {
      emptyList.style.display = 'block';
      return;
    }
    emptyList.style.display = 'none';

    filtered.forEach(h => {
      const items = h.items || [];
      const okCount = items.filter(x => x.ok).length;
      const errCount = items.length - okCount;

      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `
        <div>
          <div style="font-weight:700;margin-bottom:4px">${esc(h.title || '—')}</div>
          <div class="muted small">${esc(h.createdAt || '')} • ${items.length} itens • OK: ${okCount} • ERRO: ${errCount}</div>
        </div>
        <div class="actions2">
          <button class="btn small ghost" data-action="details">Detalhes</button>
          <button class="btn small ghost" data-action="del">Excluir</button>
        </div>
      `;

      row.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const action = btn.getAttribute('data-action');

        if (action === 'details') {
          const preview = items.slice(0, 6).map(it => `• ${it.ok ? 'OK' : 'ERRO'} — ${it.titulo}`).join('\n');
          alert(preview || 'Sem itens');
        }

        if (action === 'del') {
          const next = loadHist().filter(x => x.id !== h.id);
          saveHist(next);
          computeKpis(next);
          renderList(next);
          toast('Excluído');
        }
      });

      list.appendChild(row);
    });
  }

  function resetAll() {
    localStorage.removeItem(storeKey);
    computeKpis([]);
    renderList([]);
    toast('Resetado ✅');
  }

  function init() {
    const hist = loadHist();
    computeKpis(hist);
    renderList(hist);

    $('#q')?.addEventListener('input', () => {
      const h = loadHist();
      computeKpis(h);
      renderList(h);
    });

    $('#btnReset')?.addEventListener('click', resetAll);
  }

  init();
})();
