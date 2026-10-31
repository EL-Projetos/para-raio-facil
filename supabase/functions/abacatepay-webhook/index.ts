// Para-Raio Fácil – recebe os avisos (webhooks) do AbacatePay.
// Publicar com "Verify JWT" DESLIGADO (o AbacatePay não manda login do Supabase).
// URL a cadastrar no AbacatePay:
//   https://ljcjzeapxedkxbxipudk.supabase.co/functions/v1/abacatepay-webhook?webhookSecret=SEU_SEGREDO
// Segredos: ABACATEPAY_API_KEY, ABACATEPAY_WEBHOOK_SECRET
//
// Segurança: o aviso só é aceito com o segredo certo na URL, e mesmo assim nada é creditado
// com base no aviso: o servidor consulta o checkout direto na API do AbacatePay e só credita
// se lá estiver PAID com o valor certo. Cada compra só é creditada uma vez.
import { createClient } from "npm:@supabase/supabase-js@2";

const API = "https://api.abacatepay.com/v2";
// chave pública divulgada na documentação do AbacatePay para conferir a assinatura X-Webhook-Signature
const ABACATEPAY_PUBLIC_KEY =
  "t9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9";

const enc = new TextEncoder();
function iguais(a: string, b: string) {
  const x = enc.encode(a), y = enc.encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}
async function hmacBase64(chave: string, corpo: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(chave), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(corpo)));
  return btoa(String.fromCharCode(...s));
}
// acha o id do checkout (bill_...) em qualquer lugar do aviso
function acharBill(o: any, n = 0): string | null {
  if (!o || typeof o !== "object" || n > 5) return null;
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "string" && /^bill_/.test(v) && (k === "id" || /bill|checkout/i.test(k))) return v;
  }
  for (const v of Object.values(o)) { const r = acharBill(v, n + 1); if (r) return r; }
  return null;
}
async function abacate(caminho: string) {
  const r = await fetch(API + caminho, { headers: { "Authorization": "Bearer " + Deno.env.get("ABACATEPAY_API_KEY") } });
  const j: any = await r.json().catch(() => null);
  if (!r.ok || !j || j.error) throw new Error("AbacatePay HTTP " + r.status);
  return j.data;
}
const ok = (t = "ok", s = 200) => new Response(t, { status: s });

Deno.serve(async (req) => {
  if (req.method !== "POST") return ok("método não permitido", 405);
  const segredo = Deno.env.get("ABACATEPAY_WEBHOOK_SECRET") || "";
  const recebido = new URL(req.url).searchParams.get("webhookSecret") || "";
  if (!segredo || !iguais(recebido, segredo)) return ok("não autorizado", 401);

  const bruto = await req.text();
  const assin = req.headers.get("x-webhook-signature");
  if (assin) {
    try { if (!iguais(await hmacBase64(ABACATEPAY_PUBLIC_KEY, bruto), assin)) console.warn("assinatura do aviso não confere (seguindo, pois o pagamento é conferido na API)"); }
    catch (_) { /* ignora */ }
  }
  let ev: any;
  try { ev = JSON.parse(bruto); } catch (_) { return ok("json inválido", 400); }
  const evento = String(ev?.event || "");
  const evId = String(ev?.id || "");
  const bill = acharBill(ev?.data);

  const adm = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // guarda o aviso; se o mesmo id já foi processado, só confirma
  if (evId) {
    const { error } = await adm.from("pagamento_eventos").insert({ id: evId, evento, abacate_id: bill, payload: ev });
    if (error && error.code === "23505") {
      const { data: c } = bill ? await adm.from("compras").select("status").eq("abacate_id", bill).maybeSingle() : { data: null };
      if (!c || c.status !== "pendente") return ok("já processado");
    }
  }
  if (!evento.startsWith("checkout.") || !bill) return ok("ignorado");

  try {
    const { data: c } = await adm.from("compras").select("*").eq("abacate_id", bill).maybeSingle();
    if (!c) return ok("compra desconhecida");
    const ck = await abacate(`/checkouts/get?id=${encodeURIComponent(bill)}`);
    const st = String(ck?.status || "");
    if (st === "PAID" && c.status === "pendente") {
      const { data, error } = await adm.rpc("creditar_compra", { p_compra: c.id, p_abacate_id: bill, p_valor: Number(ck.paidAmount ?? ck.amount ?? 0) });
      if (error) throw error;
      if (!data?.ok) console.error("creditar_compra recusou", c.id, data);
    } else if (st === "REFUNDED" || evento === "checkout.refunded") {
      if (st === "REFUNDED") { const { error } = await adm.rpc("estornar_compra", { p_compra: c.id }); if (error) throw error; }
    } else if ((st === "EXPIRED" || st === "CANCELLED") && c.status === "pendente") {
      await adm.from("compras").update({ status: st === "EXPIRED" ? "expirado" : "cancelado", atualizado_em: new Date().toISOString() }).eq("id", c.id);
    }
    if (evento === "checkout.disputed" || evento === "checkout.lost") console.warn("contestação no AbacatePay", evento, c.id);
    return ok("processado");
  } catch (e) {
    console.error(e);
    if (evId) await adm.from("pagamento_eventos").delete().eq("id", evId); // deixa reprocessar na nova tentativa
    return ok("erro temporário", 500);
  }
});
