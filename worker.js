/**
 * kary store - Worker رئيسي (Static Assets + API)
 * =================================================
 * - أي طلب لملف عادي (index.html, صور, ...) بيتخدم من ASSETS تلقائيًا
 * - /api/load  : يرجع بيانات المتجر من KV
 * - /api/save  : يحفظ بيانات المتجر (محمي بباسورد عبر ADMIN_HASH)
 * - /api/visit : يزوّد عداد الزوار
 * - /api/visits: يرجع عدد الزوار من غير زيادة
 * - "/" مع ?product=ID: يبدّل صورة/عنوان/وصف المشاركة (Open Graph)
 *
 * الإعدادات المطلوبة في wrangler.toml (موجودة بالفعل):
 * - [assets] directory + binding = "ASSETS"
 * - kv_namespaces -> binding = "STORE_KV"
 * - Secret يتضاف من الداشبورد: ADMIN_HASH
 */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ===== تحميل بيانات المتجر =====
    if (url.pathname === '/api/load') {
      const data = await env.STORE_KV.get('store_data');
      return new Response(data || '{}', {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    // ===== حفظ بيانات المتجر (محمي بباسورد) =====
    if (url.pathname === '/api/save' && request.method === 'POST') {
      const token = request.headers.get('X-Admin-Token') || '';
      if (!env.ADMIN_HASH || token !== env.ADMIN_HASH) {
        return json({ error: 'unauthorized' }, 401);
      }
      const body = await request.text();
      try {
        JSON.parse(body);
      } catch (e) {
        return json({ error: 'invalid json' }, 400);
      }
      await env.STORE_KV.put('store_data', body);
      return json({ ok: true });
    }

    // ===== زيادة عداد الزوار =====
    if (url.pathname === '/api/visit') {
      let count = parseInt((await env.STORE_KV.get('visit_count')) || '0', 10);
      count++;
      ctx.waitUntil(env.STORE_KV.put('visit_count', String(count)));
      return json({ count });
    }

    // ===== قراءة عداد الزوار فقط =====
    if (url.pathname === '/api/visits') {
      const count = parseInt((await env.STORE_KV.get('visit_count')) || '0', 10);
      return json({ count });
    }

    // ===== الصفحة الرئيسية / رابط منتج مشارك =====
    const productId = url.searchParams.get('product');
    if ((url.pathname === '/' || url.pathname === '/index.html') && productId) {
      const assetRes = await env.ASSETS.fetch(request);
      const html = await assetRes.text();
      const htmlResponse = new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });

      const raw = await env.STORE_KV.get('store_data');
      const store = raw ? JSON.parse(raw) : null;
      const product = store && store.products
        ? store.products.find((p) => String(p.id) === String(productId))
        : null;

      if (!product) return htmlResponse;

      const priceText = `${product.price} ج.م`;
      const description = `${product.name} - ${priceText}` +
        (product.oldPrice ? ` (بدل ${product.oldPrice} ج.م)` : '') +
        ' | kary store';
      const shareUrl = url.toString();

      class MetaRewriter {
        element(el) {
          const prop = el.getAttribute('property') || el.getAttribute('name');
          if (prop === 'og:title' || prop === 'twitter:title') el.setAttribute('content', product.name);
          else if (prop === 'og:description' || prop === 'twitter:description') el.setAttribute('content', description);
          else if (prop === 'og:image' || prop === 'twitter:image') el.setAttribute('content', product.mainImg);
          else if (prop === 'og:url') el.setAttribute('content', shareUrl);
        }
      }
      class TitleRewriter {
        element(el) {
          el.setInnerContent(`${product.name} | kary store`);
        }
      }

      return new HTMLRewriter()
        .on('meta', new MetaRewriter())
        .on('title', new TitleRewriter())
        .transform(htmlResponse);
    }

    // ===== أي حاجة تانية: ملفات ثابتة عادية =====
    return env.ASSETS.fetch(request);
  },
};
