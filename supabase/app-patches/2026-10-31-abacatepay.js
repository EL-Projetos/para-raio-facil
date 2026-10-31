/* Para-Raio Fácil – alteração do app.js para a compra de pontos pelo AbacatePay (31/10/2026).
   O app.js fica no armazenamento privado do Supabase (não vai para o GitHub).
   Este arquivo registra exatamente o que foi trocado. Uso: aplicarPatch(textoDoAppJs) -> novo texto. */
function aplicarPatch(t) {
  const troca = (de, para) => {
    const n = t.split(de).length - 1;
    if (n !== 1) throw new Error("Trecho não encontrado exatamente 1 vez (" + n + "): " + de.slice(0, 80));
    t = t.replace(de, () => para);
  };

  // 1) combos vêm do banco (preço oficial no servidor) + funções de compra
  troca('const COMBOS=[[50,25],[100,45],[250,100],[500,175]];',
`let COMBOS=[[50,25],[100,45],[250,100],[500,175]];
async function carregarCombos(){try{const{data}=await sb.from("combos").select("pontos,preco_centavos,ordem").eq("ativo",true).order("ordem");if(data&&data.length)COMBOS=data.map(c=>[c.pontos,c.preco_centavos/100]);}catch(e){}}
const brl=v=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const ST_COMPRA={pendente:["Aguardando pagamento",""],pago:["Pago","ok"],expirado:["Expirado",""],cancelado:["Cancelado",""],estornado:["Estornado","bad"],erro:["Com problema – fale conosco","bad"]};
async function pagto(corpo){const{data,error}=await sb.functions.invoke("pagamento",{body:corpo});if(error){let m=error.message;try{const j=await error.context.json();if(j&&j.erro)m=j.erro;}catch(e){}throw new Error(m);}return data;}
async function comprar(pts){const m=document.getElementById("ptMsg");const bts=document.querySelectorAll("#ptModal [data-comprar]");
  bts.forEach(b=>b.disabled=true);if(m)m.textContent="Gerando o pagamento…";
  try{const r=await pagto({acao:"criar",pontos:pts});if(!r||!r.url||!/^https:\\/\\/([a-z0-9-]+\\.)*abacatepay\\.com\\//.test(r.url))throw new Error("resposta inválida");
    try{sessionStorage.setItem("prfCompra","1");}catch(e){}location.href=r.url;}
  catch(e){if(m)m.textContent="Não foi possível iniciar o pagamento: "+e.message;bts.forEach(b=>b.disabled=false);}}
async function minhasCompras(){const el=document.getElementById("ptCompras");if(!el)return;
  try{const{data}=await sb.from("compras").select("pontos,valor_centavos,status,checkout_url,criado_em").eq("perfil",eu.id).order("criado_em",{ascending:false}).limit(5);if(!data||!data.length)return;
    el.innerHTML=\`<h3 style="margin:4px 0 0">Suas últimas compras</h3><div class="tbl"><table><tbody>\${data.map(c=>{const s=ST_COMPRA[c.status]||[c.status,""];const link=c.status==="pendente"&&c.checkout_url&&/^https:\\/\\/([a-z0-9-]+\\.)*abacatepay\\.com\\//.test(c.checkout_url);
      return \`<tr><td>\${new Date(c.criado_em).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"})}</td><td class="n">\${c.pontos} pts</td><td class="n">\${brl(c.valor_centavos/100)}</td><td><span class="tag \${s[1]}">\${s[0]}</span>\${link?\` <a href="\${esc(c.checkout_url)}" style="color:var(--volt);font-weight:600">pagar</a>\`:""}</td></tr>\`;}).join("")}</tbody></table></div>\`;}catch(e){}}`);

  // 2) janela "Comprar pontos": botões de compra no lugar do aviso "entra em breve"
  troca('<th style="text-align:right">Preço</th></tr></thead><tbody>${COMBOS.map(([p,r])=>`<tr><td><b>${p} pontos</b></td><td class="n">${p/10}</td><td class="n">R$ ${r}</td></tr>`).join("")}</tbody></table></div>\n    <p class="hint" style="margin:0">A compra online por Pix entra em breve. Por enquanto, fale com o administrador para liberar os pontos.</p>',
    '<th style="text-align:right">Preço</th><th></th></tr></thead><tbody>${COMBOS.map(([p,r])=>`<tr><td><b>${p} pontos</b></td><td class="n">${p/10}</td><td class="n">${brl(r)}</td><td style="text-align:right"><button class="btn sm pri" type="button" data-comprar="${p}">Comprar</button></td></tr>`).join("")}</tbody></table></div>\n    <p class="hint" style="margin:0">Pagamento por Pix ou cartão em ambiente seguro. Os pontos entram sozinhos assim que o pagamento é confirmado.</p>\n    <span class="hint" id="ptMsg" role="alert"></span><div id="ptCompras"></div>');
  troca('document.getElementById("ptFechar").addEventListener("click",f);}',
    'document.getElementById("ptFechar").addEventListener("click",f);o.querySelectorAll("[data-comprar]").forEach(b=>b.addEventListener("click",()=>comprar(+b.dataset.comprar)));minhasCompras();}');

  // 3) ao voltar do pagamento: confere e mostra o saldo novo
  troca('$("#mComprar").addEventListener("click",()=>modalPontos(MEU.pontos));\natualizarSaldo();',
`$("#mComprar").addEventListener("click",()=>modalPontos(MEU.pontos));
atualizarSaldo();carregarCombos();
(async()=>{let volta=/^#pago/.test(location.hash);try{volta=volta||sessionStorage.getItem("prfCompra")==="1";sessionStorage.removeItem("prfCompra");}catch(e){}
  if(/^#pago/.test(location.hash))history.replaceState(null,"",location.pathname);
  if(!volta){try{const{count}=await sb.from("compras").select("id",{count:"exact",head:true}).eq("perfil",eu.id).eq("status","pendente");
      if(count){const r=await pagto({acao:"conferir"});if(r&&typeof r.saldo==="number"){MEU.pontos=r.saldo;pintarSaldo();}}}catch(e){}return;}
  toast("Conferindo o pagamento…");
  for(let i=0;i<10;i++){let r=null;try{r=await pagto({acao:"conferir"});}catch(e){}
    if(r&&typeof r.saldo==="number"){MEU.pontos=r.saldo;pintarSaldo();}
    const st=r&&r.ultima&&r.ultima.status;
    if(st==="pago"){toast("Pagamento confirmado! Saldo: "+(MEU.pontos||0)+" pts.");return;}
    if(st&&st!=="pendente"){toast("Pagamento não concluído ("+((ST_COMPRA[st]||[st])[0]).toLowerCase()+").");return;}
    await new Promise(z=>setTimeout(z,i<4?3000:8000));}
  toast("Pagamento ainda não confirmado. Assim que for, os pontos entram sozinhos.");})();`);

  // 4) Admin: histórico de compras e nome do evento
  troca('app_publicado:"Publicou nova versão do app"};', 'app_publicado:"Publicou nova versão do app",compra_paga:"Comprou pontos"};');
  troca('if(ev==="exportou")return d.arquivo||"";', 'if(ev==="compra_paga")return (d.pontos||"")+" pontos · "+brl((d.valor||0)/100);if(ev==="exportou")return d.arquivo||"";');
  troca('\n/* ---------- aba Início: dados do usuário ---------- */',
`
/* ---------- Admin: compras de pontos (AbacatePay) ---------- */
if(ehAdmin){const cc=document.createElement("div");cc.className="card";cc.id="admCompras";
  cc.innerHTML=\`<h2>Compras de pontos</h2><div class="tbl" id="admComprasLista"><p class="muted">Carregando…</p></div>\`;
  const ref=document.getElementById("admVersoes");if(ref)$("#tab-admin").insertBefore(cc,ref);else $("#tab-admin").appendChild(cc);
  async function listarCompras(){const el=$("#admComprasLista");await carregarPerfis();
    const{data,error}=await sb.from("compras").select("criado_em,perfil,pontos,valor_centavos,status,dev").order("criado_em",{ascending:false}).limit(100);
    if(error){el.innerHTML=\`<p class="muted">Não foi possível carregar: \${esc(error.message)}</p>\`;return;}
    if(!data.length){el.innerHTML='<p class="muted">Nenhuma compra ainda.</p>';return;}
    const pagas=data.filter(c=>c.status==="pago"&&!c.dev);const tot=pagas.reduce((a,c)=>a+c.valor_centavos,0)/100;
    el.innerHTML=\`<p class="hint" style="margin:0 0 8px">Pagas nesta lista (sem as de teste): <b>\${pagas.length}</b> · \${brl(tot)}</p><table><thead><tr><th>Quando</th><th>Usuário</th><th style="text-align:right">Pontos</th><th style="text-align:right">Valor</th><th>Situação</th></tr></thead><tbody>\${data.map(c=>{const s=ST_COMPRA[c.status]||[c.status,""];
      return \`<tr><td class="n">\${quando(c.criado_em)}</td><td>\${esc(nomeDe(c.perfil))}</td><td class="n">\${c.pontos}</td><td class="n">\${brl(c.valor_centavos/100)}</td><td><span class="tag \${s[1]}">\${s[0]}</span>\${c.dev?' <span class="tag ex">teste</span>':""}</td></tr>\`;}).join("")}</tbody></table>\`;}
  document.querySelector('nav.tabs button[data-tab="admin"]').addEventListener("click",listarCompras);}

/* ---------- aba Início: dados do usuário ---------- */`);
  return t;
}
if (typeof module !== "undefined") module.exports = { aplicarPatch };
