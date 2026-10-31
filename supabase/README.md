# Servidor do Para-Raio Fácil (Supabase)

O site (GitHub Pages) é só a porta de entrada. O aplicativo (`app.js`) fica no armazenamento privado do Supabase (bucket `app`) e só é entregue a quem fez login. Esta pasta guarda o código do servidor para não se perder.

## Pagamentos com AbacatePay (31/10/2026)

- `migrations/20261031_abacatepay.sql`: tabelas `combos` (preços), `compras`, `pagamento_eventos` e as funções `creditar_compra` / `estornar_compra`. Só acrescenta; não altera contas, pontos nem análises.
- `functions/pagamento`: cria o checkout no AbacatePay (Pix e cartão) com o preço do servidor e confere compras pendentes. Verify JWT: ligado.
- `functions/abacatepay-webhook`: recebe os avisos do AbacatePay. **Verify JWT: desligado.** Só aceita com `?webhookSecret=` certo e só credita depois de consultar o checkout na API do AbacatePay.
- `app-patches/2026-10-31-abacatepay.js`: o que muda no `app.js` (botão Comprar, confirmação ao voltar do pagamento, compras no Admin).

### Segredos (Supabase > Edge Functions > Secrets)
- `ABACATEPAY_API_KEY`: chave da API (a de Modo Teste para testar; trocar pela de produção depois)
- `ABACATEPAY_WEBHOOK_SECRET`: senha longa, a mesma usada na URL do webhook

### Webhook no AbacatePay
URL: `https://ljcjzeapxedkxbxipudk.supabase.co/functions/v1/abacatepay-webhook?webhookSecret=<mesma senha>`
Eventos: `checkout.completed`, `checkout.refunded`.

### Preços
Os combos ficam na tabela `combos` (pontos, preco_centavos, ativo, ordem). Para mudar um preço, altere ali; o produto novo no AbacatePay é criado sozinho na próxima compra.

### Fluxo
1. Usuário clica em Comprar → função `pagamento` cria a compra (pendente) e o checkout → site abre a página do AbacatePay.
2. Pago → AbacatePay avisa o webhook e o usuário volta para o site (`#pago`). Qualquer um dos dois confere na API e credita os pontos uma única vez (`pontos_mov`, tipo `compra`).
