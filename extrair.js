const readline = require('readline');
const axios = require('axios');
const cheerio = require('cheerio');

function normalizarNumero(valor) {
  if (!valor) return NaN;
  return parseFloat(
    String(valor)
      .replace(/\s/g, '')
      .replace('R$', '')
      .replace(/\./g, '')
      .replace(',', '.')
      .replace(/[^\d.]/g, '')
  );
}

function formatBRLFromNumber(n) {
  if (!isFinite(n)) return '';
  return 'R$' + n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function calcularDesconto(precoDe, precoAtual) {
  const antigo = normalizarNumero(precoDe);
  const novo = normalizarNumero(precoAtual);
  if (!isFinite(antigo) || !isFinite(novo) || antigo <= 0 || novo <= 0) return null;
  if (novo >= antigo) return null;
  const perc = Math.round(((antigo - novo) / antigo) * 100);
  return `${perc}% OFF`;
}

function absolutizar(url, base) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('//')) return 'https:' + url;
  try { return new URL(url, base).toString(); } catch { return url; }
}

function pickFirstText($, selectors) {
  for (const sel of selectors) {
    const t = $(sel).first().text().trim();
    if (t) return t;
  }
  return '';
}

function pickFirstAttr($, selectors, attr, baseUrl) {
  for (const sel of selectors) {
    const v = $(sel).first().attr(attr);
    if (v && String(v).trim()) return absolutizar(String(v).trim(), baseUrl);
  }
  return '';
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function jitter(ms, pct = 0.35) {
  const delta = ms * pct;
  const min = ms - delta;
  const max = ms + delta;
  return Math.floor(min + Math.random() * (max - min));
}

// Cadência “humana” entre requests (ótimo pra 10 links)
async function politeDelay() {
  // ~4s a 8s
  await sleep(jitter(6000, 0.35));
}

function isBlockedHtml(html) {
  const h = String(html || '').toLowerCase();
  return (
    h.includes('robot check') ||
    h.includes('captcha') ||
    h.includes('automated access') ||
    h.includes('unusual traffic') ||
    h.includes('to discuss automated access') ||
    h.includes('enter the characters you see below') ||
    h.includes('sorry, we just need to make sure') ||
    (h.includes('consent') && h.includes('privacy'))
  );
}

function detectSite(link, html) {
  const l = link.toLowerCase();
  const h = String(html || '').toLowerCase();

  if (l.includes('mercadolivre.') || l.includes('mercadolibre.') || h.includes('mercadolivre') || h.includes('mercadolibre')) {
    return 'ml';
  }
  if (l.includes('amazon.') || l.includes('amzn.to') || h.includes('amazon')) {
    return 'amazon';
  }
  return 'unknown';
}

/**
 * ✅ Mantém o “motor” igual ao que funcionava (axios simples),
 * mas adiciona: delay + retries + backoff + finalUrl.
 */
async function fetchHtmlWithRetry(url, tries = 3) {
  let lastErr = null;

  for (let i = 0; i < tries; i++) {
    try {
      await politeDelay();

      const resp = await axios.get(url, {
        maxRedirects: 20,
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.7',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        }
      });

      const finalUrl =
        resp?.request?.res?.responseUrl ||
        resp?.request?.path ||
        url;

      const html = resp.data;

      // Se veio bloqueio, backoff e tenta de novo
      if (isBlockedHtml(html)) {
        lastErr = new Error('BLOCKED_HTML');
        await sleep(7000 + i * 4500); // 7s, 11.5s, 16s...
        continue;
      }

      return { html, finalUrl, status: resp.status };
    } catch (e) {
      lastErr = e;
      await sleep(1200 + i * 1800);
    }
  }

  throw lastErr;
}

// ======================= AMAZON (NÃO mexer em seletores, só baseUrl + avisos) =======================
function amazonGetPrice($) {
  let price = pickFirstText($, [
    'span.a-price.aok-align-center.reinventPricePriceToPayMargin span.a-offscreen',
    'span.apexPriceToPay span.a-offscreen',
    'span.priceToPay span.a-offscreen',
    'span.a-price span.a-offscreen',
    '#priceblock_dealprice',
    '#priceblock_ourprice',
    'span#price_inside_buybox'
  ]);
  if (price) return price;

  const whole = pickFirstText($, [
    'span.a-price-whole',
    'span.apexPriceToPay span.a-price-whole',
    'span.priceToPay span.a-price-whole'
  ]);
  const frac = pickFirstText($, [
    'span.a-price-fraction',
    'span.apexPriceToPay span.a-price-fraction',
    'span.priceToPay span.a-price-fraction'
  ]);
  if (whole) {
    const w = whole.replace(/[^\d]/g, '');
    const f = (frac || '00').replace(/[^\d]/g, '').padEnd(2, '0').slice(0, 2);
    if (w) return `R$${Number(w).toLocaleString('pt-BR')},${f}`;
  }

  const metaAmount =
    $('meta[property="product:price:amount"]').attr('content') ||
    $('meta[name="price"]').attr('content') ||
    $('meta[itemprop="price"]').attr('content') ||
    '';
  if (metaAmount && /^[0-9.]+$/.test(metaAmount.trim())) {
    const v = parseFloat(metaAmount.trim());
    if (isFinite(v)) return formatBRLFromNumber(v);
  }

  return '';
}

function amazonGetOldPrice($) {
  return pickFirstText($, [
    'span.a-price.a-text-price span.a-offscreen',
    'span.priceBlockStrikePriceString',
    'span.a-text-price span.a-offscreen'
  ]);
}

async function extrairAmazon(baseUrl, html) {
  if (isBlockedHtml(html)) {
    return {
      titulo: '❌ Amazon bloqueou a leitura (anti-bot)',
      linhaPreco: '*Preço: ❌ Não foi possível ler o preço*',
      foto: '',
      precisaGerarOutroLink: true,
      motivo: 'BLOCKED'
    };
  }

  const $ = cheerio.load(html);

  const titulo = pickFirstText($, ['#productTitle', 'h1 span.a-size-large', 'span#title']);
  const precoAtual = amazonGetPrice($);
  const precoDe = amazonGetOldPrice($);

  let foto =
    $('#landingImage').attr('data-old-hires') ||
    $('#landingImage').attr('src') ||
    $('img#landingImage').attr('src') ||
    '';

  if (!foto) {
    foto = pickFirstAttr($, ['img#imgBlkFront', 'img.a-dynamic-image', 'div#imgTagWrapperId img'], 'src', baseUrl);
  } else {
    foto = absolutizar(foto, baseUrl);
  }

  const desconto = calcularDesconto(precoDe, precoAtual);

  const falhouTitulo = !titulo;
  const falhouPreco = !precoAtual;

  let linhaPreco = `*Preço: ${precoAtual || '❌ Não foi possível ler o preço'}*`;
  if (precoDe && desconto && precoAtual) linhaPreco = `*Preço: ${precoAtual} (De: ${precoDe} | ${desconto})*`;

  const precisaGerarOutroLink = falhouTitulo || falhouPreco;

  return {
    titulo: titulo || '❌ Não foi possível ler o título',
    linhaPreco,
    foto,
    precisaGerarOutroLink,
    motivo: precisaGerarOutroLink ? 'PARSE_FAILED' : ''
  };
}

// ======================= MERCADO LIVRE (igual ao seu) =======================
function parseJsonLdProduct($) {
  const scripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length; i++) {
    const raw = $(scripts[i]).text().trim();
    if (!raw) continue;

    try {
      const data = JSON.parse(raw);
      const arr = Array.isArray(data) ? data : [data];

      for (const item of arr) {
        const found = findProductNode(item);
        if (found) return found;
      }
    } catch {}
  }
  return null;
}

function findProductNode(node) {
  if (!node || typeof node !== 'object') return null;

  if (Array.isArray(node['@graph'])) {
    for (const g of node['@graph']) {
      const found = findProductNode(g);
      if (found) return found;
    }
  }

  const type = node['@type'];
  if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) return node;

  if (node.mainEntity) {
    const found = findProductNode(node.mainEntity);
    if (found) return found;
  }

  return null;
}

async function extrairML(originalLink) {
  const { html, finalUrl } = await fetchHtmlWithRetry(originalLink, 3);

  const low = String(html).toLowerCase();
  if (low.includes('enable javascript') || low.includes('unusual traffic') || low.includes('robot')) {
    return {
      titulo: '❌ Mercado Livre bloqueou o acesso',
      linhaPreco: '*Preço: ❌ Não foi possível ler o preço*',
      foto: '',
      precisaGerarOutroLink: true,
      motivo: 'BLOCKED'
    };
  }

  const $ = cheerio.load(html);

  const product = parseJsonLdProduct($);

  let titulo = '';
  let precoAtual = '';
  let foto = '';
  let precoDe = '';

  if (product) {
    titulo = (product.name || '').trim();

    const offers = product.offers;
    const offer = Array.isArray(offers) ? offers[0] : offers;

    if (offer) {
      const price = offer.price;
      const priceNum = typeof price === 'string' ? parseFloat(price) : price;
      if (isFinite(priceNum)) precoAtual = formatBRLFromNumber(priceNum);
    }

    if (typeof product.image === 'string') foto = product.image;
    else if (Array.isArray(product.image) && product.image.length) foto = product.image[0];

    foto = absolutizar((foto || '').trim(), finalUrl);
  }

  if (!titulo) titulo = pickFirstText($, ['h1.ui-pdp-title', 'h1']);

  if (!precoAtual) {
    const currentAmount = $('span.andes-money-amount')
      .not('.andes-money-amount--previous')
      .first();
    const frac = currentAmount.find('span.andes-money-amount__fraction').first().text().trim();
    const cents = currentAmount.find('span.andes-money-amount__cents').first().text().trim();
    if (frac) precoAtual = `R$${frac}${cents ? ',' + cents : ''}`;
  }

  if (!precoDe) {
    const oldAmount = $('span.andes-money-amount--previous').first();
    const oldFrac = oldAmount.find('span.andes-money-amount__fraction').first().text().trim();
    const oldCents = oldAmount.find('span.andes-money-amount__cents').first().text().trim();
    if (oldFrac) precoDe = `R$${oldFrac}${oldCents ? ',' + oldCents : ''}`;
  }

  if (!foto) {
    foto = pickFirstAttr($, [
      'figure.ui-pdp-gallery__figure img',
      'img.ui-pdp-image',
      'img[data-testid="image"]',
      'img.ui-pdp-gallery__figure__image'
    ], 'src', finalUrl);
  }

  const desconto = calcularDesconto(precoDe, precoAtual);
  let linhaPreco = `*Preço: ${precoAtual || '❌ Não foi possível ler o preço'}*`;
  if (precoDe && desconto) linhaPreco = `*Preço: ${precoAtual} (De: ${precoDe} | ${desconto})*`;

  const precisaGerarOutroLink = !titulo || !precoAtual;

  return { titulo, linhaPreco, foto, precisaGerarOutroLink, motivo: precisaGerarOutroLink ? 'PARSE_FAILED' : '' };
}

async function extrair(link) {
  const { html, finalUrl } = await fetchHtmlWithRetry(link, 2);
  const site = detectSite(finalUrl || link, html);

  if (site === 'amazon') return await extrairAmazon(finalUrl || link, html);
  if (site === 'ml') return await extrairML(finalUrl || link);

  return {
    titulo: '❌ Site não suportado',
    linhaPreco: '*Preço: ❌ Não foi possível ler o preço*',
    foto: '',
    precisaGerarOutroLink: true,
    motivo: 'UNSUPPORTED'
  };
}

// ================= stdin -> links =================
let input = '';
const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (line) => { input += line + '\n'; });

rl.on('close', async () => {
  const links = input.split('\n').map(l => l.trim()).filter(Boolean);

  let resultado = '';
  let count = 0;

  for (const link of links) {
    count++;

    try {
      const d = await extrair(link);

      const avisoNovoLink = d.precisaGerarOutroLink
        ? '\n⚠️ Não consegui ler corretamente. Tente novamente em 1 minuto, ou use o link completo (amazon.com.br/dp/ASIN).'
        : '';

      resultado +=
`${d.titulo || '❌ Não foi possível ler o título'}
Link: ${link}
${d.linhaPreco || '*Preço: ❌ Não foi possível ler o preço*'}
${d.foto ? `Foto: ${d.foto}` : ''}${avisoNovoLink}

⚠️ Preço sujeito a alteração a qualquer momento. Garanta antes que acabe.

`;
    } catch (err) {
      // ✅ Agora mostra o motivo real (pra não ficar “cego”)
      const msg = err?.message || String(err);
      const status = err?.response?.status;
      resultado +=
`❌ Erro ao acessar:
Link: ${link}
Detalhes: ${status ? `HTTP ${status} - ` : ''}${msg}

⚠️ Preço sujeito a alteração a qualquer momento. Garanta antes que acabe.

`;
    }

    // ✅ pausa extra a cada 3 links (pra lote de 10)
    if (count % 3 === 0 && count < links.length) {
      await sleep(12000);
    }
  }

  console.log(resultado.trim());
});
