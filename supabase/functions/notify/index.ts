// ============================================================
//  Myrikaka — ฟังก์ชัน "notify" : แจ้งเตือนออเดอร์ใหม่ทาง LINE
//  วิธีคิด: แอปยิงมาแค่เลขออเดอร์ → ฟังก์ชันไปอ่านข้อมูลจริงจากตาราง
//  orders เอง (ด้วย service_role) → ป้องกันการปลอมข้อความ/สแปม
//  ลูกค้าแจ้งได้เฉพาะ "ออเดอร์ของตัวเอง" พนักงานแจ้งได้ทุกใบ
//
//  ขั้นตอนติดตั้ง (ทำครั้งเดียว — ดูคู่มือเต็มใน คู่มือ-แจ้งเตือน-LINE.md):
//  1) วางโค้ดนี้ทับใน Supabase → Edge Functions → notify → Deploy
//  2) ตั้ง Secrets: LINE_CHANNEL_ACCESS_TOKEN และ LINE_OWNER_USER_ID
//     (Supabase → Edge Functions → Secrets → Add new secret)
//  ยังไม่ตั้ง Secrets = ฟังก์ชันตอบ ok/sent:false เงียบ ๆ แอปใช้งานปกติ
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
};

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

    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ ok: false, error: 'ต้องเข้าสู่ระบบก่อน' }, 401);

    const body = await req.json().catch(() => ({}));
    const orderNo = String(body.orderNo || '').slice(0, 40);
    if (!orderNo) return json({ ok: false, error: 'ไม่มีเลขออเดอร์' }, 400);

    const token = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN');
    const to = Deno.env.get('LINE_OWNER_USER_ID');
    if (!token || !to)
      return json({ ok: true, sent: false,
        reason: 'ยังไม่ได้ตั้งค่า LINE — เพิ่ม Secrets: LINE_CHANNEL_ACCESS_TOKEN และ LINE_OWNER_USER_ID' });

    /* อ่านออเดอร์จริงจากฐานข้อมูลด้วยสิทธิ์สูง (ไม่เชื่อข้อความที่ยิงมา) */
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: row } = await admin.from('orders').select('data,owner_id').eq('no', orderNo).maybeSingle();
    if (!row) return json({ ok: false, error: 'ไม่พบออเดอร์นี้' }, 404);

    /* สิทธิ์: เจ้าของออเดอร์เท่านั้น (หรือพนักงานที่ active) */
    const { data: prof } = await sb.from('profiles').select('role,active').eq('id', user.id).maybeSingle();
    const isStaffUser = !!prof?.active;
    if (row.owner_id !== user.id && !isStaffUser) return json({ ok: false, error: 'ไม่ใช่ออเดอร์ของคุณ' }, 403);

    const d: any = row.data || {};
    const paid = (d.payments || []).reduce((s: number, p: any) => s + (+p.amount || 0), 0);
    const items = (d.items || []).map((i: any) => `  • ${i.name}${i.opt ? ` (${i.opt})` : ''} ×${i.qty}`).join('\n');
    const text =
      `🔔 มีออเดอร์ใหม่!\n` +
      `เลขออเดอร์: ${orderNo}\n` +
      `ลูกค้า: ${d.customer?.name || '-'} (${d.customer?.phone || 'ไม่มีเบอร์'})\n` +
      `ยอดชำระ: ฿${paid.toLocaleString()}\n` +
      `สินค้า:\n${items}\n` +
      `→ เปิดหลังร้านเพื่อตรวจสลิปได้เลย`;

    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to, messages: [{ type: 'text', text: text.slice(0, 2000) }] }),
    });
    if (!res.ok) return json({ ok: false, error: `LINE API ${res.status}: ${(await res.text()).slice(0, 200)}` });
    return json({ ok: true, sent: true });
  } catch (e) {
    return json({ ok: false, error: String(e && (e as Error).message || e) }, 500);
  }
});
