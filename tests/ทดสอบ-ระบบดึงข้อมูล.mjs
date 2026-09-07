/* ==================================================================
   ทดสอบระบบดึงข้อมูลของ myrikaka-app.html — รันกับหน้าเว็บจริง
   ใช้:  node ทดสอบ-ระบบดึงข้อมูล.mjs
   ทุกครั้งที่แก้โค้ดดึงข้อมูล ให้รันไฟล์นี้ก่อน deploy เสมอ
   ================================================================== */
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

/* ---------- ดึงโค้ดส่วน "ดึงข้อมูลจริง" ออกจากไฟล์เว็บ (โค้ดตัวจริง ไม่ใช่สำเนา) ---------- */
const secStart = html.indexOf('ดึงข้อมูลสินค้าจริงจากลิงก์ต้นทาง');
const secEndMark = 'ตัวเลือกสินค้า 2 ระดับ';
const secStartAnchor = html.lastIndexOf('/* ====================', secStart);
const secEndAnchor = html.indexOf('/* ==================== ' + secEndMark);
if (secStart < 0 || secEndAnchor < 0) { console.error('❌ หาขอบเขตโค้ดไม่เจอ — โครงสร้างไฟล์เปลี่ยนไป'); process.exit(1); }
const section = html.slice(secStartAnchor, secEndAnchor);

/* บล็อกสูตรราคาช้อปปี้ (โค้ดตัวจริง) */
const feeStart = html.indexOf('let CFG = {cnyRate');
const feeEnd = html.indexOf('const money2');
if (feeStart < 0 || feeEnd < 0) { console.error('❌ หาบล็อกสูตรราคาไม่เจอ'); process.exit(1); }
const feeSection = html.slice(feeStart, feeEnd);

/* ---------- สิ่งแวดล้อมจำลองที่โค้ดส่วนนี้ต้องใช้ ---------- */
const RATE = 0.255;
const BLANK = {nameJp:'', nameTh:'', series:'', category:'Others', line:'', type:'', maker:'', scale:'',
  priceJpy:0, emoji:'📦', stock:'in', loc:'preorder', lot:'jp', release:'', cancelDeadline:'',
  discountPct:0, deposit:0, cratePrice:0, descJp:'', descTh:'', options:[], sold:0};
const siteOf = u => { u = String(u).toLowerCase();
  if (u.includes('hobbystock')) return 'hobbystock';
  if (u.includes('amiami.com')) return 'amiami_en';
  if (u.includes('amiami')) return 'amiami_jp';
  return 'unknown'; };
const codeOf = u => { const m = String(u).match(/view\/([A-Za-z0-9_-]+)/) || String(u).match(/(?:gcode|scode)=([A-Za-z0-9_-]+)/);
  return m ? m[1] : String(u).slice(-16); };
const HAS_KANA = /[぀-ゟ゠-ヿ]/;
const MK = { isStaff: () => false, checkStock: async () => ({ok:false}), fetchImage: async () => ({ok:false}) };
const dec = s => s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
  .replace(/&quot;/g,'"').replace(/&#0?39;|&apos;/g,"'").replace(/&nbsp;/g,' ');
/* DOMParser จำลอง (อ่าน meta/ให้ body.textContent พอสำหรับโค้ดจริง) */
class FakeEl { constructor(c){ this.c = c; } getAttribute(){ return this.c; } get textContent(){ return this.c; } }
globalThis.DOMParser = class {
  parseFromString(page){
    return {
      title: (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(page)||[])[1]?.replace(/\s+/g,' ').trim() || '',
      body: { textContent: dec(page.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<[^>]+>/g,' ')) },
      querySelector: sel => {
        const k = /(?:property|name|itemprop)=["']([^"']+)["']/.exec(sel);
        if (k){
          const re = new RegExp(`<meta[^>]*(?:property|name|itemprop)=["']${k[1]}["'][^>]*content=["']([^"']*)["']`, 'i');
          const mm = re.exec(page);
          if (mm) return new FakeEl(dec(mm[1]));
        }
        return null;
      },
    };
  }
};

/* ---------- รันโค้ดตัวจริง ---------- */
let scrapeParse, cleanName, pickSeries, pickSizeMm, pickDiscount, pickDeadline, spList, spFeeRate, spMul, spFixed, SITE_WORD_RE, dFromStock;
(function(){
  eval(section + '\n' + feeSection +
    ';globalThis.__T = {scrapeParse, cleanName, pickSeries, pickSizeMm, pickDiscount, pickDeadline, spList, spFeeRate, spMul, spFixed, SITE_WORD_RE, dFromStock};');
  ({scrapeParse, cleanName, pickSeries, pickSizeMm, pickDiscount, pickDeadline, spList, spFeeRate, spMul, spFixed, SITE_WORD_RE, dFromStock} = globalThis.__T);
})();

/* ---------- ดึงหน้าเว็บจริง ---------- */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const URL_TEST = 'https://www.hobbystock.jp/item/view/hby-icf-00008572';
const res = await fetch(URL_TEST, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja,en;q=0.8' } });
const page = await res.text();
console.log('หน้าเว็บจริง:', URL_TEST, '→ HTTP', res.status, `(${(page.length/1024).toFixed(0)}KB)\n`);

let pass = 0, fail = 0;
const check = (label, cond, detail='') => {
  console.log(`${cond?'✓':'✗'} ${label}${detail?` — ${detail}`:''}`);
  cond ? pass++ : fail++;
};

const d = scrapeParse(URL_TEST, page);

console.log('--- ตัวอ่านหน้าเว็บ (โค้ดตัวจริงใน myrikaka-app.html) ---');
check('เจอข้อมูลสินค้า', d.found === true);
check('ชื่อไม่ติดชื่อเว็บ (ホビーストック/hobby stock)', !/ホビーストック|hobby ?stock/i.test(d.nameJp||''), String(d.nameJp).slice(0,60));
check('ชื่อยังมีชื่อสินค้าครบ', /ニャンコ|夏油傑/.test(d.nameJp||''));
const se = d.series || pickSeries((d.nameJp||'')+' '+(d.nameTh||''));
check('ชื่อเรื่องเป็นอังกฤษจากตาราง', se === 'Jujutsu Kaisen', 'ได้: '+se);
check('ขนาด = 110mm (全長：約110mm)', d.scale === '110mm', 'ได้: '+d.scale);
check('ส่วนลด = 15% (15%OFF ตามเว็บ)', +d.discountPct === 15, 'ได้: '+d.discountPct+'%');
check('วันปิดรับ = 2026-09-14 (この商品は、2026年9月14日まで)', d.cancelDeadline === '2026-09-14', 'ได้: '+d.cancelDeadline);
check('คำอธิบายไม่มีบรรทัดลิขสิทธิ์ ©', !(d.desc||'').includes('©'), (d.desc||'').slice(0,50)+'…');
check('คำอธิบายมีเนื้อสเปกสินค้า', /彩色済み|全長/.test(d.desc||''));

console.log('\n--- โมเดลราคาเต็ม + ส่วนลดของเว็บ (แสดงขีดฆ่าให้ลูกค้า) ---');
check('priceJpy (ดิบ) = ราคาที่ลดแล้ว 4,208 จาก 販売価格', +d.priceJpy === 4208, 'ได้: '+d.priceJpy);
check('fullPriceJpy = ราคาเต็ม 4,950 จาก 標準価格', +d.fullPriceJpy === 4950, 'ได้: '+d.fullPriceJpy);
const ds = dFromStock(URL_TEST, {ok:true, name:'ホビーストック | テスト', priceJpy:4208, fullPriceJpy:4950,
  discountPct:15, release:'01/2027', sizeMm:110, image:'https://x/y.jpg', deadline:'2026-09-14'});
check('ตอนเพิ่มสินค้า: ราคาหลัก = ราคาขายจริง 4,208 (ห้ามใช้ราคาเงา 4,950)', +ds.priceJpy === 4208, 'ได้: '+ds.priceJpy);
check('ตอนเพิ่มสินค้า: ราคาเต็ม 4,950 แยกไว้ fullPriceJpy ไว้ขีดฆ่า', +ds.fullPriceJpy === 4950, 'ได้: '+ds.fullPriceJpy);
check('ตอนเพิ่มสินค้า: ส่วนลดของเว็บติดมาด้วย (เก็บไว้ดู)', +ds.discountPct === 15, 'ได้: '+ds.discountPct+'%');
check('ชื่อจากผลเซิร์ฟเวอร์ถูกตัดชื่อเว็บ', !SITE_WORD_RE.test(ds.nameJp||''), ds.nameJp);
/* กัน regression: ราคาหลัก = ราคาขายจริง — ราคาเต็มไปเติมช่อง f-listprice (ขีดฆ่า)
   ห้ามเติม f-disc จากส่วนลดเว็บ เพราะราคาหลักลดมาแล้ว — เติมต่อ = ลดสองชั้น */
check('เติมช่องราคาขีดฆ่า f-listprice จากราคาเต็มอัตโนมัติ', /getElementById\('f-listprice'\)\.value\s*=\s*first\.fullPriceJpy/.test(html));
check('ไม่เติม f-disc จากส่วนลดของเว็บ (กันลดซ้ำสองชั้น)', !/getElementById\('f-disc'\)\.value\s*=\s*first\.discountPct/.test(html));

console.log('\n--- ตัดชื่อเว็บ (cleanName) ---');
const t1 = cleanName('ホビーストック | 【予約特別価格】メガハウス テスト商品');
check('ชื่อเว็บนำหน้าถูกตัด', !SITE_WORD_RE.test(t1), t1);
const t2 = cleanName('ชื่อสินค้า | HOBBY STOCK');
check('ชื่อเว็บท้ายถูกตัด', !/hobby ?stock/i.test(t2), t2);
/* เคสที่เคยพัง: ชื่อสินค้ามีชื่อผู้ผลิต "GOOD SMILE COMPANY" อยู่ข้างใน (ผู้ผลิตไม่ใช่เว็บ ห้ามตัด) */
const t3 = cleanName('ホビーストック | GOOD SMILE COMPANY ウマ娘 ピスピルボンボン Mihono Bourbon');
check('ชื่อเว็บหน้าถูกตัด แต่ชื่อผู้ผลิต GOOD SMILE คงอยู่',
  !/ホビーストック|hobby ?stock/i.test(t3) && /GOOD SMILE COMPANY/i.test(t3), t3);
const t4 = cleanName('Hobby Stock | GOOD SMILE COMPANY ウマ娘');
check('ชื่อเว็บภาษาอังกฤษหน้าถูกตัดเช่นกัน', !/hobby ?stock/i.test(t4) && /GOOD SMILE COMPANY/i.test(t4), t4);

console.log('\n--- อมิอามิ ENG (ตัวอย่างจากหน้าจริง FIGURE-207990 ที่เจ้าของร้านแจ้ง) ---');
/* ปัญหาที่แจ้งมา: ได้ราคา 15,800 (ราคาเงา/ราคาเต็ม) ทั้งที่ขายจริง 14,220
   และวันวาง 09/2026 (วันที่บนหน้าเว็บ) ทั้งที่วางจำหน่ายจริง 11/2027 */
const ENG = [
  'Title: Hyper Body GODDESS OF VICTORY: NIKKE Hyper Body Viper - Toxic Rabbit Posable Figure(Pre-order)',
  '',
  'Good Smile Arts Shanghai',
  '',
  '15,800JPY 14,220 JPY Save 1,580 JPY',
  '',
  'Pre-order (Release Date: Nov-2027)',
  '',
  '## About this item',
  '',
  'Release Date Nov-2027 List Price 15,800 JPY Shop Code FIGURE-207990 JAN code 6927254800252 Brand[Good Smile Arts Shanghai]',
].join('\n');
const dE = scrapeParse('https://www.amiami.com/eng/detail/?gcode=FIGURE-207990', ENG);
check('ราคาขายจริง = 14,220 (ไม่ตกไปเป็นราคาเงา 15,800)', +dE.priceJpy === 14220, 'ได้: '+dE.priceJpy);
check('ราคาเต็ม 15,800 แยกไว้ fullPriceJpy (ขีดฆ่า)', +dE.fullPriceJpy === 15800, 'ได้: '+dE.fullPriceJpy);
check('วันวางจากป้าย Release Date = 11/2027', dE.release === '11/2027', 'ได้: '+dE.release);
check('ชื่อไม่ติดชื่อเว็บ amiami', !/amiami/i.test(dE.nameJp||''), String(dE.nameJp).slice(0,60));

console.log('\n--- กันวันที่อื่นบนหน้าเว็บดองเป็นเดือนวางจำหน่าย ---');
const dToday = scrapeParse('https://www.hobbystock.jp/item/view/hby-icf-00008572',
  '更新 2026年9月7日 (月) … この商品は、2026年9月14日まで早期キャンセル可能です');
check('2026年9月7日/14日 (มีวันที่) ไม่ถูกหยิบเป็นเดือนวางจำหน่าย', dToday.release === '', 'ได้: "'+dToday.release+'"');
const dRel = scrapeParse('https://www.hobbystock.jp/item/view/x', '発売予定日：2027年11月（予定） 販売価格 4,950円');
check('発売予定日：2027年11月 → 11/2027', dRel.release === '11/2027', 'ได้: '+dRel.release);
const dRel2 = scrapeParse('https://www.hobbystock.jp/item/view/x', '標準価格 4,950円 2027年11月中旬発売予定');
check('2027年11月中旬 (ปีเดือนล้วน) → 11/2027', dRel2.release === '11/2027', 'ได้: '+dRel2.release);

console.log('\n--- กติกาค่าส่ง/รายละเอียด (กัน regression) ---');
check('ค่าส่งนอกมาไทยเริ่มต้น 0 (ไม่ใช่ 900)', !/id="f-shipjp"[^>]*value="900"/.test(html));
check('ค่าส่งในไทยเริ่มต้น 0 (ไม่ใช่ 60)', !/id="f-shipth"[^>]*value="60"/.test(html));
check('มีตารางค่าส่งตามขนาด (shipTiers)', /shipTiers:\[\[150,500\],\[250,900\]/.test(html));
check('ราคาเว็บต่อตัวเลือกแก้เองได้ (optSetWeb)', /function optSetWeb/.test(html));
check('ตัดคำโฆษณาร้านออกจากรายละเอียด (SHOP_BLURB_RE)', /SHOP_BLURB_RE/.test(html));
check('รูปเอาเฉพาะ og:image (ไม่หยิบรูปแรกของหน้า — กันรูปคนละรายการ)',
  !html.includes('รูปแรกของหน้า') && !/const im = String\(text\)\.match/.test(html));

console.log('\n--- AmiAmi (ลิงก์จริง ผ่านตัวอ่าน — กรณี API โดนบล็อก) ---');
try {
  const rA = await fetch('https://r.jina.ai/https://www.amiami.com/eng/detail/?gcode=GOODS-04853120');
  const tA = await rA.text();
  const dA = scrapeParse('https://www.amiami.com/eng/detail/?gcode=GOODS-04853120', tA);
  check('AmiAmi: เจอข้อมูลสินค้า', dA.found === true);
  check('AmiAmi: ชื่อไม่ติด amiami', !/amiami/i.test(dA.nameJp||''), String(dA.nameJp).slice(0,60));
  /* ราคาขายจริงหลังส่วนลดหน้าเว็บ (ตอนนี้หน้าจริงลด 10% จาก 2,200 เหลือ 1,980 — ต้องได้ราคาหลังลด) */
  check('AmiAmi: ราคา = 1,980 JPY (ราคาขายจริงหลังลด 10%)', +dA.priceJpy === 1980, 'ได้: '+dA.priceJpy);
} catch(e) { console.log('⚠️ ทดสอบ AmiAmi ข้าม (เน็ต/ตัวอ่านขัดข้อง):', e.message); }

console.log('\n--- สูตรราคาช้อปปี้ (โค้ดตัวจริง: ราคาขายจริง+ส่งไทย+เอกสาร 10฿ แล้วคูณตัวคูณ) ---');
console.log(`อัตราหักรวม ${(spFeeRate()*100).toFixed(2)}% · ตัวคูณ ${spMul().toFixed(3)} · ค่าเอกสาร/คงที่ ${spFixed()}฿`);
/* โมเดลราคาตามเจ้าของร้าน (ปรับ 2026-09): ราคาหลัก = ราคาขายจริงของเว็บต้นทาง (4,208 ไม่ใช่ราคาเงา 4,950)
   → ขายหน้าเว็บบาท = ขายจริง×เรท + ส่งนอก · ขีดฆ่า = ราคาเต็ม×เรท + ส่งนอก (จาก listPriceJpy)
   → +ส่งไทย+เอกสาร 10฿ → ×1.495 */
const saleYen = 4208, fullYen = 4950, shipJp = 900, shipTh = 60;
const webNet  = Math.ceil((saleYen * RATE + shipJp)/10)*10;
const strike  = Math.ceil((fullYen * RATE + shipJp)/10)*10;
const sp = spList(webNet + shipTh);
check('ตัวคูณ ≈ 1.495', Math.abs(spMul() - 1.495) < 0.002, spMul().toFixed(4));
check('ราคาขายหน้าเว็บ = 4,208×0.255 + 900 = ฿1,980 (ต้นทุนจริงที่จ่าย)', webNet === 1980, 'ได้: ฿'+webNet.toLocaleString());
check('ราคาเต็มบาท (ขีดฆ่า) = 4,950×0.255 + 900 = ฿2,170', strike === 2170, 'ได้: ฿'+strike.toLocaleString());
check('ช้อปปี้ = (1,980 + 60 + 10) × ตัวคูณ ≈ ฿3,066',
  sp === Math.ceil((webNet + shipTh + spFixed()) * spMul()) && sp >= 3064 && sp <= 3067, 'ได้ ฿'+sp.toLocaleString());

console.log(`\n===== ผลรวม: ผ่าน ${pass} · ไม่ผ่าน ${fail} =====`);
process.exit(fail ? 1 : 0);
