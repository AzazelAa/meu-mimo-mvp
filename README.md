# Meu Mimo MVP

MVP de loja propria para produtos digitais, sem WordPress e sem construtor visual.

## O que ja existe

- Home com estetica delicada inspirada na loja atual.
- Catalogo de produtos digitais.
- Pagina de produto com galeria, preco e descricao.
- Carrinho no navegador.
- Checkout MVP com criacao de pedido.
- Pix Mercado Pago quando `MERCADO_PAGO_ACCESS_TOKEN` estiver configurado.
- Painel interno com login e 2FA opcional.
- Cadastro simples de produto pelo painel.
- Endpoint de webhook para Mercado Pago.
- Dockerfile e Docker Compose.

## Rodar localmente

```bash
docker compose up --build
```

Depois abra:

```text
http://localhost:3000
```

Painel interno separado:

```text
http://localhost:3001
```

Credenciais padrao do `docker-compose.yml`:

```text
E-mail: admin@meumimo.local
Senha: troque-essa-senha
2FA local: cadastre o segredo JBSWY3DPEHPK3PXP no Google Authenticator, Authy ou 1Password.
```

Troque a senha e o segredo 2FA antes de colocar qualquer versao no ar.

## Comandos uteis

```bash
# subir em segundo plano
docker compose up --build -d

# ver logs
docker compose logs -f meu-mimo

# verificar saude do app
curl http://localhost:3000/health

# parar o container
docker compose down
```

O arquivo `.env` ja vem preenchido para rodar localmente. Para publicar,
copie os valores de `.env.example`, troque `BASE_URL`, `ADMIN_PASSWORD` e
`ADMIN_2FA_SECRET`, e adicione as credenciais reais do Mercado Pago.

## Variaveis importantes

```env
APP_PORT=3000
ADMIN_PORT=3001
PORT=3000
HOST=0.0.0.0
STORE_NAME=Meu Mimo Digital
ADMIN_EMAIL=admin@meumimo.local
ADMIN_PASSWORD=troque-essa-senha
ADMIN_2FA_REQUIRED=true
ADMIN_2FA_SECRET=gere-um-segredo-base32-unico
BASE_URL=https://seudominio.com.br
PUBLIC_STORE_URL=https://seudominio.com.br
ADMIN_PATH=/
ADMIN_HOSTS=admin.seudominio.com.br
MERCADO_PAGO_ACCESS_TOKEN=
MERCADO_PAGO_WEBHOOK_SECRET=
```

## Mercado Pago Pix

Para ativar Pix real, preencha no `.env`:

```env
MERCADO_PAGO_ACCESS_TOKEN=APP_USR-...
PUBLIC_STORE_URL=https://seudominio.com.br
```

O checkout cria um pagamento Pix via API do Mercado Pago e mostra QR Code, copia-e-cola e link de pagamento. O webhook fica em:

```text
https://seudominio.com.br/api/webhooks/mercado-pago
```

Em desenvolvimento local, o Mercado Pago nao consegue chamar `localhost`. Para testar webhook no seu PC, use um tunel publico como ngrok ou Cloudflare Tunnel e coloque essa URL em `PUBLIC_STORE_URL`.

## Proximos passos tecnicos

1. Trocar o armazenamento JSON por PostgreSQL.
2. Validar assinatura do webhook do Mercado Pago.
3. Criar area do cliente com login e "Meus downloads".
4. Enviar e-mail transacional com link do produto aprovado.
5. Armazenar arquivos digitais em Cloudflare R2 ou S3.
6. Criar backups automaticos.
7. Adicionar painel para editar banners, textos e politicas.
8. Adicionar logs, rate limit e monitoramento.

## Observacao de seguranca

Este MVP serve para validar layout, fluxo comercial e proposta. Para producao,
nao use JSON como banco principal e nao entregue produtos digitais sem confirmar
o pagamento consultando a API oficial do Mercado Pago no backend.

## PostgreSQL local

O Docker Compose sobe dois containers:

- `meu-mimo-mvp`: aplicacao Node.
- `meu-mimo-db`: banco PostgreSQL 16.

Na primeira inicializacao, o app cria as tabelas e importa os produtos de `data/store.json` como seed.

Comandos uteis:

```bash
# subir app + banco
docker compose up --build -d

# ver status
docker compose ps

# abrir SQL no banco
docker compose exec db psql -U meu_mimo -d meu_mimo

# listar produtos direto no banco
docker compose exec db psql -U meu_mimo -d meu_mimo -c "SELECT slug, name, price FROM products;"
```

Os dados do banco ficam persistidos no volume Docker `meu-mimo-mvp_postgres_data`.
