// Para-Raio Fácil – cria o pagamento no AbacatePay e confere compras pendentes.
// Chamado pelo site com o login do usuário (verify_jwt ligado).
// Segredos (Supabase > Edge Functions > Secrets):
//   ABACATEPAY_API_KEY  – chave da API do AbacatePay (a de Dev para testar, a de produção depois)
//   SITE_URL            – opcional; padrão https://el-projetos.github.io/para-raio-facil/
import { createClient } from "npm:@supabase/supabase-js@2";

const API = "https://api.abacatepay.com/v2";
const SITE = Deno.env.get("SITE_URL") || "https://el-projetos.github.io/para-raio-facil/";
const ORIGENS = [new URL(SITE).origin, "https://pararaiofacil.com.br", "https://www.pararaiofacil.com.br"];

function cors(req: Request) {
  const o = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGENS.includes(o) ? o : ORIGENS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const resp = (req: Request, corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

async function abacate(caminho: string, init: RequestInit = {}) {
  const chave = Deno.env.get("ABACATEPAY_API_KEY");
  if (!chave) throw new Error("Pagamento ainda não configurado (falta a chave do AbacatePay).");
  const r = await fetch(API + caminho, {
    ...init,
    headers: { "Authorization": "Bearer " + chave, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  let j: any = null;
  try { j = await r.json(); } catch (_) { /* sem corpo */ }
  if (!r.ok || !j || j.success === false || j.error) {
    const msg = (j && (j.error?.message || j.error || j.message)) || ("HTTP " + r.status);
    throw new Error("AbacatePay: " + (typeof msg === "string" ? msg : JSON.stringify(msg)));
  }
  return j.data;
}

// produto do combo no AbacatePay (procura pelo externalId; cria se não existir)
async function produtoDoCombo(pontos: number, preco: number) {
  const ext = `prf-${pontos}pts-${preco}`;
  const lista = await abacate(`/products/list?externalId=${encodeURIComponent(ext)}&status=ACTIVE`);
  const achado = Array.isArray(lista) ? lista.find((p: any) => p.externalId === ext) : null;
  if (achado) return achado.id as string;
  const novo = await abacate("/products/create", {
    method: "POST",
    body: JSON.stringify({
      externalId: ext,
      name: `Para-Raio Fácil – ${pontos} pontos`,
      description: `Recarga de ${pontos} pontos (${pontos / 10} análises) no Para-Raio Fácil`,
      price: preco,
      currency: "BRL",
    }),
  });
  return novo.id as string;
}

// confere no AbacatePay e credita/atualiza uma compra
async function conferir(adm: any, c: any) {
  if (!c.abacate_id || c.status !== "pendente") return c.status;
  const ck = await abacate(`/checkouts/get?id=${encodeURIComponent(c.abacate_id)}`);
  const st = String(ck?.status || "");
  if (st === "PAID") {
    const valor = Number(ck.paidAmount ?? ck.amount ?? 0);
    const { data, error } = await adm.rpc("creditar_compra", { p_compra: c.id, p_abacate_id: c.abacate_id, p_valor: valor });
    if (error) throw error;
    if (data && data.ok) return "pago";
    await adm.from("compras").update({ status: "erro", atualizado_em: new Date().toISOString() }).eq("id", c.id).eq("status", "pendente");
    console.error("creditar_compra recusou", c.id, data);
    return "erro";
  }
  if (st === "EXPIRED" || st === "CANCELLED") {
    const novo = st === "EXPIRED" ? "expirado" : "cancelado";
    await adm.from("compras").update({ status: novo, atualizado_em: new Date().toISOString() }).eq("id", c.id).eq("status", "pendente");
    return novo;
  }
  return "pendente";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return resp(req, { erro: "Método não permitido" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const auth = req.headers.get("Authorization") || "";
    const cli = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await cli.auth.getUser();
    if (!u || !u.user) return resp(req, { erro: "Faça login novamente." }, 401);
    const uid = u.user.id;
    const adm = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: perfil } = await adm.from("perfis").select("id,ativo,nome,usuario").eq("id", uid).maybeSingle();
    if (!perfil || !perfil.ativo) return resp(req, { erro: "Acesso desativado." }, 403);

    const corpo = await req.json().catch(() => ({}));
    const acao = String(corpo.acao || "");

    if (acao === "criar") {
      const pontos = Number(corpo.pontos);
      const { data: combo } = await adm.from("combos").select("pontos,preco_centavos").eq("pontos", pontos).eq("ativo", true).maybeSingle();
      if (!combo) return resp(req, { erro: "Combo inválido." }, 400);
      // limite contra abuso: no máximo 5 pagamentos abertos na última hora
      const umaHora = new Date(Date.now() - 3600e3).toISOString();
      const { count } = await adm.from("compras").select("id", { count: "exact", head: true })
        .eq("perfil", uid).eq("status", "pendente").gte("criado_em", umaHora);
      if ((count || 0) >= 5) return resp(req, { erro: "Muitos pagamentos em aberto. Conclua um deles ou aguarde alguns minutos." }, 429);

      const prod = await produtoDoCombo(combo.pontos, combo.preco_centavos);
      const { data: compra, error: e1 } = await adm.from("compras")
        .insert({ perfil: uid, pontos: combo.pontos, valor_centavos: combo.preco_centavos })
        .select("id").single();
      if (e1) throw e1;
      let ck: any;
      try {
        ck = await abacate("/checkouts/create", {
          method: "POST",
          body: JSON.stringify({
            items: [{ id: prod, quantity: 1 }],
            methods: ["PIX", "CARD"],
            externalId: compra.id,
            returnUrl: SITE,
            completionUrl: SITE + "#pago",
            metadata: { compra: compra.id, perfil: uid, pontos: combo.pontos },
          }),
        });
      } catch (e) {
        await adm.from("compras").update({ status: "erro", atualizado_em: new Date().toISOString() }).eq("id", compra.id);
        throw e;
      }
      if (Number(ck.amount) && Number(ck.amount) !== combo.preco_centavos) console.warn("valor do checkout difere do combo", ck.amount, combo.preco_centavos);
      await adm.from("compras").update({ abacate_id: ck.id, checkout_url: ck.url, dev: !!ck.devMode, atualizado_em: new Date().toISOString() }).eq("id", compra.id);
      return resp(req, { ok: true, url: ck.url, compra: compra.id });
    }

    if (acao === "conferir") {
      // confere as compras pendentes do usuário (últimas 48 h) – garante os pontos mesmo se o aviso do AbacatePay atrasar
      const desde = new Date(Date.now() - 48 * 3600e3).toISOString();
      const { data: pend } = await adm.from("compras").select("*").eq("perfil", uid).eq("status", "pendente")
        .not("abacate_id", "is", null).gte("criado_em", desde).order("criado_em", { ascending: false }).limit(5);
      const res: Record<string, string> = {};
      for (const c of pend || []) {
        try { res[c.id] = await conferir(adm, c); } catch (e) { console.error("conferir", c.id, e); res[c.id] = "pendente"; }
      }
      const { data: p2 } = await adm.from("perfis").select("pontos").eq("id", uid).maybeSingle();
      const { data: ult } = await adm.from("compras").select("id,status,pontos,criado_em").eq("perfil", uid)
        .order("criado_em", { ascending: false }).limit(1).maybeSingle();
      return resp(req, { ok: true, compras: res, saldo: p2?.pontos ?? null, ultima: ult || null });
    }

    return resp(req, { erro: "Ação inválida." }, 400);
  } catch (e) {
    console.error(e);
    return resp(req, { erro: (e as Error).message || "Erro no pagamento." }, 500);
  }
});
