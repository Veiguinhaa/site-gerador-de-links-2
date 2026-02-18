(() => {
  const $ = (s) => document.querySelector(s);

  const storeKey = 'linkgen_test_hist_v1';
  const AVISO = '⚠️ Preço sujeito a alteração a qualquer momento. Garanta antes que acabe.';

  const btnGerar = $('#btnGerar');
  const btnSalvar = $('#btnSalvar');
  const btnLimpar = $('#btnLimpar');
  const btnNew = $('#btnNew');
  const btnExport = $('#btnExport');
  const q = $('#q');

  const linksEl = $('#links');
  const statusEl = $('#status');
  const cards = $('#cards');
  const empty = $('#empty');
  const list = $('#list');
  const emptyList = $('#emptyList');

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
  function escAttr(str){ return esc(str).replaceAll(' ', '%20'); }

  function normalizeTitleToFilename(title) {
    return (title || 'produto')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'produto';
  }

  async function baixarImagem(url, filename) {
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error('fetch failed');
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();

      setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
      toast('Foto baixada ✅');
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
      toast('Imagem aberta (salve manualmente) ⚠️');
    }
  }

  function parseTexto(texto) {
    const blocos = texto.split(AVISO).map(x => x.trim()).filter(Boolean);
    const itens = [];

    for (const bloco of blocos) {
      const linhas = bloco.split('\n').map(x => x.trim()).filter(Boolean);

      const titulo = linhas[0] || '—';
      const linkLinha = linhas.find(l => l.toLowerCase().startsWith('link:')) || '';
      const precoLinha =
        linhas.find(l => l.toLowerCase().startsWith('*preço:')) ||
        linhas.find(l => l.toLowerCase().startsWith('preço:')) || '';
      const fotoLinha = linhas.find(l => l.toLowerCase().startsWith('foto:')) || '';

      const link = linkLinha.replace(/^link:\s*/i, '').trim();
      const fotoUrl = fotoLinha.replace(/^foto:\s*/i, '').trim();

      const ok = !titulo.startsWith('❌') && precoLinha && !precoLinha.includes('❌');

      itens.push({
        id: crypto.randomUUID(),
        titulo,
        link,
        precoLinha,
        fotoUrl,
        ok,
        createdAt: new Date().toLocaleString('pt-BR')
      });
    }

    return itens;
  }

  function renderCards(itens) {
    cards.innerHTML = '';
    if (!itens.length) {
      empty.style.display = 'block';
      return;
    }

    empty.style.display = 'none';

    itens.forEach(item => {
      const badge = item.ok
        ? '<span class="badge2 ok">OK</span>'
        : '<span class="badge2 err">ERRO</span>';

      const fotoHtml = item.fotoUrl
        ? `<div class="foto">
             <a href="${escAttr(item.fotoUrl)}" target="_blank" rel="noopener noreferrer">
               <img src="${escAttr(item.fotoUrl)}" alt="Foto do produto">
             </a>
           </div>`
        : '';

      const baixarBtn = item.fotoUrl
        ? `<button class="btn small ghost" data-action="baixar" data-foto="${escAttr(item.fotoUrl)}" data-nome="${escAttr(item.titulo)}">Baixar foto</button>`
        : `<button class="btn small ghost" disabled>Sem foto</button>`;

      const el = document.createElement('div');
      el.className = 'result';
      el.innerHTML = `
        <div class="line">${badge}</div>
        <h3>${esc(item.titulo)}</h3>
        ${fotoHtml}
        <div class="line">Link: <a href="${escAttr(item.link)}" target="_blank" rel="noopener noreferrer">${esc(item.link)}</a></div>
        <div class="line">${esc(item.precoLinha || '')}</div>
        <div class="actions">
          <button class="btn small" data-action="copiar">Copiar mensagem</button>
          ${baixarBtn}
        </div>
      `;

      el.addEventListener('click', async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;

        const action = btn.getAttribute('data-action');

        if (action === 'copiar') {
          const msg = `${item.titulo}\nLink: ${item.link}\n${item.precoLinha}\n\n${AVISO}`;
          try {
            await navigator.clipboard.writeText(msg);
            toast('Mensagem copiada ✅');
          } catch {
            toast('Falhou copiar ❌');
          }
        }

        if (action === 'baixar') {
          const url = btn.getAttribute('data-foto');
          const nome = normalizeTitleToFilename(btn.getAttribute('data-nome'));
          await baixarImagem(url, `${nome}.jpg`);
        }
      });

      cards.appendChild(el);
    });
  }

  function renderList(hist) {
    list.innerHTML = '';

    const filtered = applySearch(hist);

    if (!filtered.length) {
      emptyList.style.display = 'block';
      return;
    }
    emptyList.style.display = 'none';

    filtered.forEach(h => {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `
        <div>
          <div style="font-weight:700;margin-bottom:4px">${esc(h.title || '—')}</div>
          <div class="muted small">${esc(h.createdAt || '')} • ${h.count || 0} itens</div>
        </div>
        <div class="actions2">
          <button class="btn small ghost" data-action="open">Abrir</button>
          <button class="btn small" data-action="copy">Copiar TXT</button>
          <button class="btn small ghost" data-action="del">Excluir</button>
        </div>
      `;

      row.addEventListener('click', async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;

        const action = btn.getAttribute('data-action');

        if (action === 'open') {
          renderCards(h.items || []);
          toast('Aberto ✅');
        }

        if (action === 'copy') {
          const txt = buildTxtFromItems(h.items || []);
          await navigator.clipboard.writeText(txt);
          toast('TXT copiado ✅');
        }

        if (action === 'del') {
          const next = loadHist().filter(x => x.id !== h.id);
          saveHist(next);
          renderList(next);
          toast('Excluído');
        }
      });

      list.appendChild(row);
    });
  }

  function buildTxtFromItems(items) {
    let txt = '';
    items.forEach(item => {
      txt += `${item.titulo}\nLink: ${item.link}\n${item.precoLinha}\n\n${AVISO}\n\n`;
    });
    return txt.trim();
  }

  function downloadTxt(filename, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function applySearch(hist) {
    const term = (q?.value || '').trim().toLowerCase();
    if (!term) return hist;
    return hist.filter(h =>
      (h.title || '').toLowerCase().includes(term) ||
      (h.rawLinks || '').toLowerCase().includes(term)
    );
  }

  async function onGerar() {
    const links = (linksEl.value || '').trim();
    if (!links) return toast('Cole pelo menos 1 link.');

    btnGerar.disabled = true;
    statusEl.textContent = '⏳ Processando...';

    cards.innerHTML = '';
    empty.style.display = 'block';

    try {
      const formData = new FormData();
      formData.append('links', links);

      const resp = await fetch('/processar', { method: 'POST', body: formData });
      const texto = await resp.text();

      const itens = parseTexto(texto);
      renderCards(itens);

      // stash no “resultado atual”
      window.__lastItems = itens;
      window.__lastRaw = links;

      toast('Gerado ✅');
      statusEl.textContent = 'Pronto.';
    } catch (e) {
      console.error(e);
      toast('Falha ao processar ❌');
      statusEl.textContent = 'Erro ao processar.';
    } finally {
      btnGerar.disabled = false;
    }
  }

  function onSalvar() {
    const items = window.__lastItems || [];
    const raw = window.__lastRaw || '';
    if (!items.length) return toast('Nada para salvar.');

    const hist = loadHist();
    const title = (items[0]?.titulo || 'Resultados').slice(0, 60);

    hist.unshift({
      id: crypto.randomUUID(),
      title,
      createdAt: new Date().toLocaleString('pt-BR'),
      count: items.length,
      rawLinks: raw,
      items
    });

    saveHist(hist.slice(0, 30));
    renderList(loadHist());
    toast('Salvo no histórico ✅');
  }

  function onLimpar() {
    linksEl.value = '';
    statusEl.textContent = '';
    cards.innerHTML = '';
    empty.style.display = 'block';
    window.__lastItems = [];
    window.__lastRaw = '';
    toast('Limpo ✅');
  }

  function onExport() {
    const items = window.__lastItems || [];
    if (!items.length) return toast('Nada para exportar.');

    const txt = buildTxtFromItems(items);
    downloadTxt('mensagens-teste.txt', txt);
    toast('TXT baixado ✅');
  }

  function init() {
    window.__lastItems = [];
    window.__lastRaw = '';

    btnGerar?.addEventListener('click', onGerar);
    btnSalvar?.addEventListener('click', onSalvar);
    btnLimpar?.addEventListener('click', onLimpar);

    btnNew?.addEventListener('click', () => {
      linksEl?.focus();
      toast('Cole os links e gere');
    });

    btnExport?.addEventListener('click', onExport);

    q?.addEventListener('input', () => renderList(loadHist()));

    renderList(loadHist());
  }

  init();
})();
