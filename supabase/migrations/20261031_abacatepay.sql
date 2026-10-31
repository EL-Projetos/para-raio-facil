-- Para-Raio Fácil – pagamentos com AbacatePay (recarga de pontos)
-- Só ACRESCENTA tabelas e funções. Não altera perfis, análises, pontos nem logins existentes.

-- 1) Combos à venda (o preço vale no servidor; o site só mostra)
create table if not exists public.combos(
  pontos          int primary key check (pontos > 0),
  preco_centavos  int not null check (preco_centavos >= 100),
  ativo           boolean not null default true,
  ordem           int not null default 0
);
alter table public.combos enable row level security;
drop policy if exists combos_ler on public.combos;
create policy combos_ler on public.combos for select to authenticated using (ativo or public.eh_admin());
drop policy if exists combos_admin on public.combos;
create policy combos_admin on public.combos for all to authenticated using (public.eh_admin()) with check (public.eh_admin());
insert into public.combos(pontos, preco_centavos, ordem) values
  (50, 2500, 1), (100, 4500, 2), (250, 10000, 3), (500, 17500, 4)
on conflict (pontos) do nothing;

-- 2) Compras
create table if not exists public.compras(
  id              uuid primary key default gen_random_uuid(),
  perfil          uuid references public.perfis(id) on delete set null,
  pontos          int not null check (pontos > 0),
  valor_centavos  int not null check (valor_centavos > 0),
  status          text not null default 'pendente'
                  check (status in ('pendente','pago','expirado','cancelado','estornado','erro')),
  abacate_id      text unique,
  checkout_url    text,
  dev             boolean,
  criado_em       timestamptz not null default now(),
  pago_em         timestamptz,
  atualizado_em   timestamptz not null default now()
);
create index if not exists compras_perfil_idx on public.compras(perfil, criado_em desc);
alter table public.compras enable row level security;
drop policy if exists compras_ler on public.compras;
create policy compras_ler on public.compras for select to authenticated
  using (perfil = auth.uid() or public.eh_admin());
-- sem política de INSERT/UPDATE: só o servidor (funções) grava compras

-- 3) Avisos recebidos do AbacatePay (evita creditar duas vezes o mesmo aviso)
create table if not exists public.pagamento_eventos(
  id           text primary key,
  evento       text,
  abacate_id   text,
  recebido_em  timestamptz not null default now(),
  payload      jsonb
);
alter table public.pagamento_eventos enable row level security;
drop policy if exists pag_eventos_admin on public.pagamento_eventos;
create policy pag_eventos_admin on public.pagamento_eventos for select to authenticated using (public.eh_admin());

-- 4) Creditar uma compra paga (uma única vez)
create or replace function public.creditar_compra(p_compra uuid, p_abacate_id text, p_valor int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.compras%rowtype; v_pts int;
begin
  select * into c from public.compras where id = p_compra for update;
  if not found then return jsonb_build_object('ok',false,'erro','sem_compra'); end if;
  if c.status = 'pago' then return jsonb_build_object('ok',true,'ja',true); end if;
  if c.status = 'estornado' then return jsonb_build_object('ok',false,'erro','estornada'); end if;
  if c.abacate_id is distinct from p_abacate_id then return jsonb_build_object('ok',false,'erro','id_diferente'); end if;
  if coalesce(p_valor,0) < c.valor_centavos then return jsonb_build_object('ok',false,'erro','valor_menor'); end if;
  if c.perfil is null then return jsonb_build_object('ok',false,'erro','sem_perfil'); end if;
  update public.perfis set pontos = pontos + c.pontos where id = c.perfil returning pontos into v_pts;
  if v_pts is null then return jsonb_build_object('ok',false,'erro','sem_perfil'); end if;
  insert into public.pontos_mov(perfil, delta, saldo_apos, tipo, motivo, ref)
    values (c.perfil, c.pontos, v_pts, 'compra', 'Compra de '||c.pontos||' pontos (AbacatePay)', c.id::text);
  update public.compras set status = 'pago', pago_em = now(), atualizado_em = now() where id = c.id;
  insert into public.atividades(usuario_id, evento, detalhe)
    values (c.perfil, 'compra_paga', jsonb_build_object('pontos', c.pontos, 'valor', c.valor_centavos, 'compra', c.id));
  return jsonb_build_object('ok',true,'saldo',v_pts,'pontos',c.pontos);
end $$;

-- 5) Estorno: tira os pontos da compra (sem deixar saldo negativo)
create or replace function public.estornar_compra(p_compra uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.compras%rowtype; v_pts int;
begin
  select * into c from public.compras where id = p_compra for update;
  if not found then return jsonb_build_object('ok',false,'erro','sem_compra'); end if;
  if c.status <> 'pago' then
    update public.compras set status = 'estornado', atualizado_em = now() where id = c.id and status = 'pendente';
    return jsonb_build_object('ok',true,'sem_credito',true);
  end if;
  update public.perfis set pontos = greatest(0, pontos - c.pontos) where id = c.perfil returning pontos into v_pts;
  if v_pts is not null then
    insert into public.pontos_mov(perfil, delta, saldo_apos, tipo, motivo, ref)
      values (c.perfil, -c.pontos, v_pts, 'estorno', 'Estorno da compra de '||c.pontos||' pontos', c.id::text);
  end if;
  update public.compras set status = 'estornado', atualizado_em = now() where id = c.id;
  return jsonb_build_object('ok',true,'saldo',v_pts);
end $$;

-- 6) Permissões das tabelas (este projeto não libera tabelas novas automaticamente)
grant select, insert, update, delete on public.combos to authenticated;
grant select on public.compras, public.pagamento_eventos to authenticated;
grant all on public.combos, public.compras, public.pagamento_eventos to service_role;

revoke all on function public.creditar_compra(uuid,text,int) from public, anon, authenticated;
revoke all on function public.estornar_compra(uuid) from public, anon, authenticated;
grant execute on function public.creditar_compra(uuid,text,int) to service_role;
grant execute on function public.estornar_compra(uuid) to service_role;
