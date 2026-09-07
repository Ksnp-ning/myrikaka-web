// ============================================================
//  Myrikaka — Edge Function "stock" · เวอร์ชัน 2 (ดึงครบทุกอย่าง)
//  ดึงข้อมูลสินค้าสด ๆ จากเว็บต้นทาง (ญี่ปุ่น/จีน) ให้หลังร้าน
//  ใหม่ใน v2: รูปสินค้า · ขนาด (มม.) · ส่วนลด % · วันปิดรับ · คำอธิบาย
//            + โหมดโหลดรูป: ส่ง { "img": "<ลิงก์รูป>" } ได้ไฟล์ base64 กลับมา
//
//  เรียกใช้:  POST /functions/v1/stock   { "urls": ["https://..."] }
//            POST /functions/v1/stock   { "img": "https://.../xxx.jpg" }
//  ต้องส่ง JWT ของพนักงานที่เปิดใช้งานแล้วมาด้วย (แอปทำให้อัตโนมัติ)
//
//  ติดตั้ง/อัปเดต: Supabase Dashboard → Edge Functions → stock
//                → แก้โค้ด → วางไฟล์นี้ทั้งไฟล์ทับของเดิม → Deploy
// ============================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
         + '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

type Result = {
  url: string; site: string; ok: boolean;
  name?: string; priceJpy?: number; priceCny?: number;
  status?: 'open' | 'closed' | 'soldout' | 'unknown';
  statusText?: string; release?: string; note?: string;
  image?: string; sizeMm?: number; discountPct?: number;
  deadline?: string; desc?: string; maker?: string;
  fullPriceJpy?: number;
  debug?: Record<string, unknown>;
};

/* ---------- ตัวช่วย ---------- */
const num = (s: string) => Number(String(s).replace(/[^\d.]/g, '')) || 0;

function siteOf(url: string): string {
  const h = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  if (/amiami/.test(h))                       return 'amiami';
  if (/hobbystock/.test(h))                   return 'hobbystock';
  if (/goodsmile/.test(h))                    return 'goodsmile';
  if (/tmall|taobao|1688|jd\.com/.test(h))    return 'taobao';
  if (/bilibili/.test(h))                     return 'bilibili';
  if (/mandarake/.test(h))                    return 'mandarake';
  if (/suruga-ya/.test(h))                    return 'surugaya';
  if (/\.jp$|rakuten|yahoo/.test(h))          return 'jp-other';
  if (/\.cn$|weidian|xianyu/.test(h))         return 'cn-other';
  return 'other';
}

async function grab(url: string, headers: Record<string,string> = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en;q=0.8,th;q=0.6',
        ...headers,
      },
    });
    return { status: r.status, body: await r.text() };
  } finally { clearTimeout(t); }
}

function decode(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
          .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));
}

/* ---------- อ่านชื่อสินค้า ---------- */
function pickName(html: string): string {
  const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html)
          || /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i.exec(html);
  if (og) return decode(og[1]).trim();
  const h1 = /<h1[^>]*>([\s\S]{1,300}?)<\/h1>/i.exec(html);
  if (h1) return decode(h1[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const t = /<title[^>]*>([\s\S]{1,300}?)<\/title>/i.exec(html);
  return t ? decode(t[1]).replace(/\s+/g, ' ').trim() : '';
}

/* ---------- อ่านราคา ---------- */
function pickPriceJpy(html: string): number {
  // 1) JSON-LD — แม่นที่สุดถ้ามี
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1].trim());
      const p = findPrice(j);
      if (p) return p;
    } catch { /* ข้าม JSON ที่พัง */ }
  }
  // 2) ★ ราคาขายจริงจากข้อความ — HobbyStock/เว็บญี่ปุ่นส่วนใหญ่มี 2 ราคา
  //    標準価格（税込） 4,950円 = ราคาปกติ · 販売価格（税込） 4,208円 = ราคาที่ขายจริง (หลังส่วนลด)
  //    ต้องเลือก 販売価格 เท่านั้น ไม่งั้นได้ราคาปกติมาแทน
  const text0 = html.replace(/<[^>]+>/g, ' ');
  const sale = /販売価格(?:（|\()[^）)]*(?:\)|）)[^\d]{0,30}([\d][\d,]{2,9})\s*円/.exec(text0);
  if (sale) return num(sale[1]);
  const special = /【?予約特別価格】?[^\d]{0,12}([\d][\d,]{2,9})\s*円/.exec(text0);
  if (special) return num(special[1]);
  // 3) meta ราคา
  const meta = /<meta[^>]+(?:property|itemprop)=["'](?:og:price:amount|product:price:amount|price)["'][^>]+content=["']([\d.,]+)["']/i.exec(html);
  if (meta) { const v = num(meta[1]); if (v) return v; }
  // 4) ข้อความราคาแบบญี่ปุ่น: ¥4,208 / 4,208円 / 税込4,208
  const text = html.replace(/<[^>]+>/g, ' ');
  const cands = [...text.matchAll(/(?:￥|¥|税込[^\d]{0,6})\s*([\d][\d,]{2,9})|([\d][\d,]{2,9})\s*円/g)]
    .map(m => num(m[1] || m[2])).filter(v => v >= 100 && v <= 5_000_000);
  return cands.length ? cands[0] : 0;
}

/* v2.2: ราคาเต็ม (標準価格) — เก็บไว้ขีดฆ่าบนหน้าสินค้า ให้ลูกค้าเห็นว่าลดจากราคาเท่าไร */
function pickFullPriceJpy(html: string): number {
  const text0 = html.replace(/<[^>]+>/g, ' ');
  const std = /標準価格(?:（|\()[^）)]*(?:\)|）)[^\d]{0,30}([\d][\d,]{2,9})\s*円/.exec(text0);
  if (std) return num(std[1]);
  // ไม่มีป้าย 標準価格 → ตัวแรกของหน้ามักเป็นราคาเต็ม (ราคาขายจะถูกเลือกด้วยป้าย 販売価格 ก่อนแล้ว)
  const cands = [...text0.matchAll(/(?:￥|¥|税込[^\d]{0,6})\s*([\d][\d,]{2,9})|([\d][\d,]{2,9})\s*円/g)]
    .map(m => num(m[1] || m[2])).filter(v => v >= 100 && v <= 5_000_000);
  return cands.length ? cands[0] : 0;
}

function findPrice(j: unknown, depth = 0): number {  if (!j || typeof j !== 'object' || depth > 6) return 0;
  const o = j as Record<string, unknown>;
  for (const k of ['price', 'lowPrice', 'highPrice']) {
    if (o[k] != null && num(String(o[k]))) return num(String(o[k]));
  }
  for (const v of Object.values(o)) {
    const p = findPrice(v, depth + 1);
    if (p) return p;
  }
  return 0;
}

/* ---------- อ่านสถานะเปิด/ปิดรับ ---------- */
const OPEN_WORDS   = ['予約受付中', '予約受付', 'ご注文受付中', '在庫あり', '販売中',
                      'preorder', 'pre-order', 'in stock', 'add to cart', '現貨', '有货'];
const CLOSED_WORDS = ['予約受付終了', '受付終了', '販売終了', '受注終了', '終了しました',
                      'preorder closed', 'closed', 'discontinued', '已结束', '已下架'];
const SOLD_WORDS   = ['売り切れ', '品切れ', '在庫なし', '完売', 'sold out', 'soldout',
                      'out of stock', '售罄', '已售完', '無庫存'];

function pickStatus(html: string): { status: Result['status']; statusText: string } {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
                   .replace(/<[^>]+>/g, ' ').toLowerCase();
  const hit = (list: string[]) => list.find(w => text.includes(w.toLowerCase()));
  const sold = hit(SOLD_WORDS);   if (sold) return { status: 'soldout', statusText: sold };
  const cls  = hit(CLOSED_WORDS); if (cls)  return { status: 'closed', statusText: cls };
  const op   = hit(OPEN_WORDS);   if (op)   return { status: 'open', statusText: op };
  return { status: 'unknown', statusText: '' };
}

/* ---------- อ่านเดือนวางจำหน่าย → MM/YYYY ---------- */
function pickRelease(html: string): string {
  const text = decode(html.replace(/<[^>]+>/g, ' '));
  let m = /(20\d{2})\s*年\s*(\d{1,2})\s*月/.exec(text);
  if (m) return `${String(+m[2]).padStart(2, '0')}/${m[1]}`;
  m = /(?:release|発売|発送)[^\d]{0,20}(20\d{2})[-/.](\d{1,2})/i.exec(text);
  if (m) return `${String(+m[2]).padStart(2, '0')}/${m[1]}`;
  m = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(20\d{2})\b/i.exec(text);
  if (m) {
    const i = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
      .indexOf(m[1].slice(0,3).toLowerCase()) + 1;
    return `${String(i).padStart(2,'0')}/${m[2]}`;
  }
  return '';
}

/* ---------- v2: อ่านรูปสินค้า ---------- */
function pickImage(html: string): string {
  const meta = (sel: string) => {
    const m = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${sel}["'][^>]+content=["']([^"']+)["']`, 'i').exec(html)
           || new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${sel}["']`, 'i').exec(html);
    return m ? decode(m[1]).trim() : '';
  };
  const u = meta('og:image') || meta('og:image:secure_url') || meta('twitter:image') || meta('image');
  if (u) return u;
  // JSON-LD image
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1].trim()) as Record<string, unknown>;
      const im = (j as { image?: unknown }).image;
      if (typeof im === 'string' && /^https?:\/\//.test(im)) return im;
      if (Array.isArray(im) && typeof im[0] === 'string') return im[0];
    } catch { /* ข้าม */ }
  }
  // ★ ไม่มี fallback "รูปแรกของหน้า" — กันหยิบรูปสินค้าอื่นในแถบแนะนำมาผิด
  return '';
}

/* ---------- v2: ขนาดที่ใหญ่ที่สุด (มม.) — 全高/高さ/サイズ ก่อน แล้ว cm แล้ว mm ใหญ่สุด ---------- */
function pickSizeMm(html: string): number {
  const text = decode(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' '));
  let best = 0;
  const push = (v: number) => { if (v >= 50 && v <= 1500 && v > best) best = v; };
  for (const m of text.matchAll(/(?:全高|高さ|全長|高(?:さ)?|height|tall|サイズ)[^\d]{0,22}(\d{2,4}(?:\.\d+)?)\s*(mm|cm)/gi)) {
    push(m[2].toLowerCase() === 'cm' ? Math.round(+m[1] * 10) : +m[1]);
  }
  if (!best) for (const m of text.matchAll(/約?\s*(\d{2,3}(?:\.\d+)?)\s*cm\b/gi)) push(Math.round(+m[1] * 10));
  if (!best) for (const m of text.matchAll(/(\d{3,4})\s*mm/gi)) push(+m[1]);
  return best;
}

/* ---------- v2: ส่วนลดตามหน้าเว็บ เช่น 20%OFF ---------- */
function pickDiscount(html: string): number {
  const text = decode(html.replace(/<[^>]+>/g, ' '));
  const m = /(\d{1,2})\s*%\s*(?:off|割引)/i.exec(text) || /(?:off|割引)[^0-9]{0,4}(\d{1,2})\s*%/i.exec(text);
  return m ? Math.min(90, +m[1]) : 0;
}

/* ---------- v2: วันปิดรับ (予約締切 / 受注締切 / deadline) → YYYY-MM-DD ---------- */
function pickDeadline(html: string): string {
  const text = decode(html.replace(/<[^>]+>/g, ' '));
  // กติกาของเจ้าของร้าน: มีวันที่ (เช่น この商品は、2026年10月12日まで早期キャンセル可能です) = ต้องได้วันปิดรับทุกครั้ง
  // ถ้าหน้าเว็บไม่มีวันที่ (เช่น 早期キャンセル締め切り日を過ぎたため…できません) = ไม่มีวันปิดรับ เว้นว่างไว้
  let m = /この商品は[^0-9]{0,12}(20\d{2})[年\/\-.](\d{1,2})[月\/\-.](\d{1,2})日?まで/.exec(text);
  if (!m) m = /(?:予約|受注|ご注文)?締切[^0-9]{0,30}(20\d{2})[年\/\-.](\d{1,2})[月\/\-.](\d{1,2})/.exec(text);
  if (!m) m = /(?:この商品は|予約)[^0-9]{0,6}(20\d{2})[年\/\-.](\d{1,2})[月\/\-.](\d{1,2})日?まで(?:早期)?(?:キャンセル|受付|注文)?/.exec(text);
  if (!m) m = /(?:deadline|order by|until)[^0-9]{0,15}(20\d{2})-(\d{2})-(\d{2})/i.exec(text);
  if (!m) return '';
  return `${m[1]}-${String(+m[2]).padStart(2, '0')}-${String(+m[3]).padStart(2, '0')}`;
}

/* ---------- v2: คำอธิบายสินค้า — เอาเฉพาะโซนสเปกสินค้า ห้ามมีคำโฆษณาของร้าน ---------- */
const SHOP_BLURB = /当店|当サイト|私たち|私ども|弊社|われわれ|多様な製品|製品の多様|郵便注文|通信販売|お問い合わせ|ご利用ガイド|プライバシー|特定商取引|お支払い方法|配送について|ホビーストックは|hobby stock は|当ショップ|各種お支払い方法/;
function pickDesc(html: string): string {
  const m = /<meta[^>]+(?:property|name)=["'](?:og:description|description)["'][^>]+content=["']([^"']{20,600})["']/i.exec(html);
  let d = m ? decode(m[1]).replace(/\s+/g, ' ').trim() : '';
  // ตัดคำโฆษณาท้ายเว็บ + บรรทัดลิขสิทธิ์ ออกให้หมด
  d = d.split(SHOP_BLURB)[0].trim();
  d = d.replace(/\s*(?:&copy;|©|&#169;|（C）|\(C\)|Copyright)[\s\S]*$/, '').trim();
  return d;
}

/* ---------- v2: ผู้ผลิต (ถ้าหาได้จาก JSON-LD brand/manufacturer) ---------- */
function pickMaker(html: string): string {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1].trim()) as Record<string, unknown>;
      const b = (j.brand ?? j.manufacturer ?? j.brandName) as unknown;
      if (typeof b === 'string' && b.trim()) return b.trim();
      if (b && typeof b === 'object' && typeof (b as {name?: unknown}).name === 'string') return ((b as {name: string}).name).trim();
    } catch { /* ข้าม */ }
  }
  return '';
}

/* ============================================================
   ตัวดึงแยกตามเว็บ
   ============================================================ */

// AmiAmi — หน้าเว็บเป็นเปลือก JavaScript ต้องคุยกับ API ตรง ๆ
async function fromAmiAmi(url: string): Promise<Result> {
  const base: Result = { url, site: 'amiami', ok: false };
  const code = (/[?&](?:gcode|scode)=([^&#]+)/i.exec(url) || [])[1];
  if (!code) return { ...base, note: 'หา gcode/scode ในลิงก์ไม่เจอ' };

  for (const key of ['gcode', 'scode']) {
    try {
      const r = await grab(`https://api.amiami.com/api/v1.0/item?${key}=${encodeURIComponent(code)}`,
        { 'X-User-Key': 'amiami_dev', 'Accept': 'application/json' });
      if (r.status !== 200) continue;
      const j = JSON.parse(r.body);
      if (!j?.RSuccess || !j?.item) continue;
      const it = j.item;
      const soldout = it.stock === 0 || it.instock_flg === 0;
      const closed  = it.order_closed_flg === 1 || it.saleitem === 0;
      const img = typeof it.imageurl === 'string' && it.imageurl
        ? (it.imageurl.startsWith('http') ? it.imageurl : 'https://img.amiami.com' + it.imageurl)
        : undefined;
      return {
        ...base, ok: true,
        name: it.gname || it.sname || '',
        priceJpy: Number(it.price ?? it.c_price_taxed ?? 0) || 0,
        fullPriceJpy: Number(it.list_price ?? 0) || undefined,
        status: soldout ? 'soldout' : closed ? 'closed' : 'open',
        statusText: soldout ? '売り切れ' : closed ? '受付終了' : '予約受付中',
        release: it.releasedate ? String(it.releasedate).replace(/^(\d{4})[-/](\d{2}).*/, '$2/$1') : '',
        image: img,
        desc: typeof it.gcomment === 'string' ? it.gcomment.replace(/<[^>]+>/g, ' ').trim().slice(0, 600) : undefined,
        note: 'จาก AmiAmi API',
      };
    } catch { /* ลองคีย์ถัดไป */ }
  }
  // API โดนบล็อก/ไม่ตอบ → สลับไปอ่านหน้าเว็บผ่านตัวอ่านอัตโนมัติ
  return await fromAmiAmiReader(url);
}

/* v2.3: AmiAmi ผ่านตัวอ่าน r.jina.ai — ใช้เมื่อ API ถูกบล็อก (เช่น 403 จากบางภูมิภาค)
   ผ่านการทดสอบกับหน้าจริง: ได้ชื่ออังกฤษ ราคา ราคาเต็ม Release สถานะ Pre-order */
function monthFromEn(s: string): string {
  const i = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
    .indexOf(s.slice(0, 3).toLowerCase());
  return i >= 0 ? String(i + 1).padStart(2, '0') : '';
}
async function fromAmiAmiReader(url: string): Promise<Result> {
  const base: Result = { url, site: 'amiami', ok: false };
  try {
    const r = await grab('https://r.jina.ai/' + url, { 'Accept': 'text/plain' });
    if (r.status !== 200) return { ...base, note: 'ตัวอ่าน AmiAmi ตอบรหัส ' + r.status };
    const t = r.body;
    const title = (/(?:^|\n)Title:\s*(.+)(?:\n|$)/.exec(t) || [])[1] || '';
    const price = /Price\s*([\d,]+)\s*JPY/.exec(t);
    const full  = /List Price\s*([\d,]+)\s*JPY/.exec(t);
    const relM  = /Release Date:?\s*([A-Z][a-z]{2})-(\d{4})/.exec(t);
    const imgM  = /https:\/\/img\.amiami\.com\/images\/product\/[^\s"\)\]]+/.exec(t);
    const low = t.toLowerCase();
    const status: Result['status'] = /sold\s*out/.test(low) ? 'soldout'
      : /(pre-?order|backorder)/.test(low) ? 'open'
      : /(closed|ended)/.test(low) ? 'closed' : 'unknown';
    const name = title.replace(/\s*\(Pre-order\)\s*$/i, '').trim();
    if (!name && !price) return { ...base, note: 'อ่านหน้า AmiAmi ผ่านตัวอ่านไม่ได้' };
    return {
      ...base, ok: !!(name || price),
      name: name || undefined,
      priceJpy: price ? num(price[1]) : undefined,
      fullPriceJpy: full ? num(full[1]) : undefined,
      status,
      statusText: status === 'open' ? 'Pre-order' : status === 'soldout' ? 'Sold Out' : '',
      release: relM ? `${monthFromEn(relM[1])}/${relM[2]}` : undefined,
      image: imgM ? imgM[0] : undefined,
      note: 'จากหน้าเว็บ AmiAmi (ผ่านตัวอ่าน)',
    };
  } catch (e) {
    return { ...base, note: 'ตัวอ่าน AmiAmi ล่ม: ' + String((e as Error).message || e) };
  }
}

// เว็บทั่วไปที่ส่ง HTML มาจริง (HobbyStock, Good Smile, Mandarake, Suruga-ya, ร้านญี่ปุ่นอื่น)
async function fromHtml(url: string, site: string, debug = false): Promise<Result> {
  const base: Result = { url, site, ok: false };
  const r = await grab(url);
  if (r.status >= 400) return { ...base, note: `เว็บตอบรหัส ${r.status}` };
  const html = r.body;
  if (html.replace(/<[^>]+>/g, '').trim().length < 200) {
    return { ...base, note: 'หน้านี้สร้างด้วย JavaScript ดึงตรงไม่ได้' };
  }
  const name = pickName(html);
  const price = pickPriceJpy(html);
  const full = pickFullPriceJpy(html);
  const st = pickStatus(html);
  const sizeMm = pickSizeMm(html);
  const disc = pickDiscount(html);
  const deadline = pickDeadline(html);
  const desc = pickDesc(html);
  const maker = pickMaker(html);
  const out: Result = {
    ...base,
    ok: !!(name || price),
    name, priceJpy: price || undefined,
    fullPriceJpy: (full > price ? full : undefined),
    status: st.status, statusText: st.statusText,
    release: pickRelease(html),
    image: pickImage(html) || undefined,
    sizeMm: sizeMm || undefined,
    discountPct: disc || (price && full && full > price ? Math.round((1 - price / full) * 100) : undefined),
    deadline: deadline || undefined,
    desc: desc || undefined,
    maker: maker || undefined,
    note: price ? '' : 'อ่านชื่อได้ แต่หาราคาไม่เจอ',
  };
  // โหมดตรวจปัญหา: ส่งข้อความบางส่วนของหน้ากลับมาด้วย จะได้รู้ว่าติดตรงไหน
  if (debug) {
    out.debug = {
      bytes: html.length,
      hasJsonLd: /application\/ld\+json/i.test(html),
      hasOgTitle: /og:title/i.test(html),
      text: decode(html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
                       .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').slice(0, 800),
    };
  }
  return out;
}

// เว็บจีน — ปิดกั้นบอต ต้องผ่านบริการเสริมเท่านั้น
async function fromChina(url: string, site: string): Promise<Result> {
  const base: Result = { url, site, ok: false };
  const key = Deno.env.get('SCRAPE_KEY');
  const provider = (Deno.env.get('SCRAPE_PROVIDER') || 'scraperapi').toLowerCase();
  if (!key) {
    return { ...base, note: 'เว็บจีนบล็อกการดึงตรง — ต้องตั้งค่า SCRAPE_KEY ก่อน (ดูคู่มือ)' };
  }
  const via = provider === 'scrapingbee'
    ? `https://app.scrapingbee.com/api/v1/?api_key=${key}&render_js=true&url=${encodeURIComponent(url)}`
    : `https://api.scraperapi.com/?api_key=${key}&render=true&country_code=cn&url=${encodeURIComponent(url)}`;
  try {
    const r = await grab(via);
    if (r.status >= 400) return { ...base, note: `บริการเสริมตอบรหัส ${r.status}` };
    const html = r.body;
    const name = pickName(html);
    const st = pickStatus(html);
    const text = html.replace(/<[^>]+>/g, ' ');
    const cny = [...text.matchAll(/(?:￥|¥|CNY)\s*([\d][\d,]*\.?\d{0,2})/g)]
      .map(m => num(m[1])).filter(v => v >= 1 && v <= 500000);
    return {
      ...base, ok: !!(name || cny.length),
      name, priceCny: cny.length ? cny[0] : undefined,
      status: st.status, statusText: st.statusText,
      release: pickRelease(html),
      image: pickImage(html) || undefined,
      sizeMm: pickSizeMm(html) || undefined,
      desc: pickDesc(html) || undefined,
      note: 'ผ่านบริการเสริม',
    };
  } catch (e) {
    return { ...base, note: 'เรียกบริการเสริมไม่สำเร็จ: ' + String((e as Error).message || e) };
  }
}

async function one(url: string, debug = false): Promise<Result> {
  const site = siteOf(url);
  try {
    if (site === 'amiami') return await fromAmiAmi(url);
    if (site === 'taobao' || site === 'bilibili' || site === 'cn-other') return await fromChina(url, site);
    return await fromHtml(url, site, debug);
  } catch (e) {
    return { url, site, ok: false, note: String((e as Error).message || e) };
  }
}

/* ---------- v2: โหลดรูปจากเว็บต้นทาง → base64 (เว็บญี่ปุ่นกันการโหลดรูปข้ามโดเมน จึงต้องผ่านเซิร์ฟเวอร์) ---------- */
async function imageToDataUrl(imgUrl: string): Promise<{ ok: boolean; dataUrl?: string; error?: string }> {
  if (!/^https?:\/\//.test(imgUrl)) return { ok: false, error: 'ลิงก์รูปไม่ถูกต้อง' };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(imgUrl, {
      signal: ctl.signal, redirect: 'follow',
      headers: { 'User-Agent': UA, 'Accept': 'image/*,*/*;q=0.8', 'Referer': (() => { try { return new URL(imgUrl).origin; } catch { return ''; } })() },
    });
    if (!r.ok) return { ok: false, error: 'เว็บตอบรหัส ' + r.status };
    const type = r.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return { ok: false, error: 'ไม่ใช่ไฟล์รูป' };
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > 8_000_000) return { ok: false, error: 'รูปใหญ่เกิน 8MB' };
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) {
      bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    }
    return { ok: true, dataUrl: `data:${type};base64,${btoa(bin)}` };
  } catch (e) {
    return { ok: false, error: String((e as Error).message || e) };
  } finally { clearTimeout(t); }
}

/* ============================================================
   ตัวรับคำขอ
   ============================================================ */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

  try {
    const auth = req.headers.get('Authorization') || '';
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: auth } } },
    );

    // ต้องเป็นพนักงานที่เปิดใช้งานแล้วเท่านั้น
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ ok: false, error: 'ต้องเข้าสู่ระบบก่อน' }, 401);
    const { data: prof } = await sb.from('profiles').select('role,active').eq('id', user.id).maybeSingle();
    if (!prof?.active) return json({ ok: false, error: 'เฉพาะพนักงานที่เปิดใช้งานแล้ว' }, 403);

    const body = await req.json().catch(() => ({}));

    /* โหมดโหลดรูป: { "img": "https://..." } → base64 กลับไปให้แอปย่อเก็บ */
    if (typeof body.img === 'string' && body.img) {
      return json(await imageToDataUrl(body.img));
    }

    const urls: string[] = (Array.isArray(body.urls) ? body.urls : [body.url])
      .filter((u: unknown) => typeof u === 'string' && /^https?:\/\//.test(u))
      .slice(0, 30);
    if (!urls.length) return json({ ok: false, error: 'ไม่มีลิงก์ที่ตรวจได้' }, 400);

    // ทำทีละ 4 ลิงก์พร้อมกัน กันเว็บต้นทางบล็อก
    const debug = body.debug === true;
    const out: Result[] = [];
    for (let i = 0; i < urls.length; i += 4) {
      out.push(...await Promise.all(urls.slice(i, i + 4).map(u => one(u, debug))));
    }

    // เก็บผลไว้ในตาราง ให้หน้าจออื่นเห็นด้วย
    try {
      await sb.from('stock_cache').upsert(out.map(r => ({
        url: r.url, site: r.site, name: r.name ?? null,
        price_jpy: r.priceJpy ?? null, price_cny: r.priceCny ?? null,
        status: r.status ?? 'unknown', release: r.release ?? null,
        ok: r.ok, note: r.note ?? null, raw: r, checked_at: new Date().toISOString(),
      })));
    } catch { /* เก็บแคชไม่ได้ก็ไม่เป็นไร ยังคืนผลให้ */ }

    return json({ ok: true, results: out, at: new Date().toISOString() });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e) }, 500);
  }
});
