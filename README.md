# Fluxo AI

Assistente financeiro pessoal, privado e executado na sua própria máquina. O MVP reúne extratos CSV, uma conversa autorizada do WhatsApp, conciliação de duplicidades e análises em português com Ollama.

## O que já funciona

- Primeiro acesso e login com senha protegida por Argon2id.
- Importação com prévia de CSV do Nubank, Itaú e layouts genéricos.
- Reimportação idempotente por hash do arquivo e fingerprint do lançamento.
- Dashboard, lançamentos, tetos, metas e projeção mensal determinística.
- Inclusão manual de entradas e saídas, com busca e filtros na nova central de lançamentos.
- Exclusão lógica de lançamentos, refletida imediatamente nos totais e preservada no histórico de auditoria.
- Sugestões de conciliação por valor, janela de 48 horas, estabelecimento e método.
- Fusões auditáveis, reversíveis e sem exclusão dos registros de origem.
- GranaBot via `qwen3:8b` no Ollama, com fallback determinístico quando a IA estiver indisponível.
- WhatsApp Web com QR, sessão persistente, seleção explícita de uma única conversa e escolha entre ler a mensagem mais recente ou o histórico disponível.
- Entrada automática de salário mensal, com lançamento idempotente no dia 1 no fuso de São Paulo.
- Interface responsiva inspirada nas quatro referências do produto.

## Inicialização

1. Copie `.env.example` para `.env`.
2. Troque `POSTGRES_PASSWORD`, `SESSION_SECRET` e `INTERNAL_TOKEN` por valores aleatórios longos.
3. Para acesso por outro aparelho, defina `APP_HOST` como o nome DNS ou IP reservado da máquina.
4. Execute:

```bash
docker compose up --build
```

Esse comando funciona em CPU e não exige uma GPU visível no host. Se `/dev/dri/renderD128` existir e sua RX 6600 estiver disponível para containers, use o perfil Vulkan:

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build
```

O primeiro boot baixa `qwen3:8b` e `qwen2.5vl:7b` no volume `ollama_models`. Isso pode levar vários minutos. A aplicação já sobe e informa enquanto o modelo ainda não estiver disponível.

Abra `https://localhost` ou `https://<APP_HOST>`. Como o Caddy usa uma autoridade certificadora local, instale e confie no certificado raiz do volume `caddy_data` nos aparelhos da rede.

## RX 6600, Vulkan e fallback em CPU

O arquivo `docker-compose.gpu.yml` entrega `/dev/dri` ao Ollama e ativa `OLLAMA_VULKAN=1`. Confirme a aceleração durante uma resposta:

```bash
docker compose logs -f ollama
```

Se o dispositivo não estiver disponível, use o Compose base, que executa em CPU/RAM sem tentar montar `/dev/dri`. Os modelos ficam persistidos em disco, e `OLLAMA_KEEP_ALIVE=0` evita manter texto e visão simultaneamente nos 8 GB de VRAM.

## WhatsApp

Na tela **Metas & Fontes**, leia o QR, escolha uma única conversa e então escolha **Somente a mensagem mais recente** ou **Ler histórico inteiro**. Mensagens como `Mercado 82,50`, `Compra de 626,00 reais no Restaurante`, `Recebi 1000 reais de pagamento` e `Caiu R$ 3.700 de salário` são registradas. Entradas ficam positivas e são classificadas como **Receitas**. Depois da leitura inicial, o worker continua acompanhando novas mensagens e o dashboard é atualizado automaticamente. A integração usa `whatsapp-web.js`, que não é uma API oficial do WhatsApp e pode quebrar ou levar a restrições da conta; use uma conta/conversa dedicada e aceite esse risco conscientemente.

Para diagnóstico local, `docker compose logs -f whatsapp api` mostra as etapas do pipeline sem registrar textos, nomes, telefones ou IDs completos: evento, correspondência da conversa, parsing, persistência, duplicação e confirmação.

## Salário mensal

A API garante um lançamento de **R$ 3.700,00** em **Receitas** no dia 1 de cada mês, considerando `America/Sao_Paulo`. A verificação roda ao iniciar e periodicamente, portanto também recupera o lançamento quando a aplicação estava desligada no dia 1. O identificador mensal e o índice único no banco impedem duplicações em reinicializações. Ajuste `MONTHLY_SALARY_CENTS` e `APP_TIME_ZONE` no `.env` para alterar valor ou fuso.

## Lançamentos manuais

Na tela **Lançamentos**, use **Novo lançamento** para registrar uma entrada ou saída, informando valor, descrição, categoria, forma de pagamento e data. A lista pode ser pesquisada e filtrada por tipo ou categoria. O botão de lixeira pede confirmação antes de remover um item dos totais. A exclusão é lógica: o registro continua disponível para auditoria e não reaparece caso uma mensagem do WhatsApp ou o salário do mês seja reprocessado. Ao excluir apenas a ocorrência atual do salário, a programação dos próximos meses permanece ativa.

## Desenvolvimento e testes

O host não precisa ter Node instalado; os builds são feitos nos containers:

```bash
docker compose build api web whatsapp
docker build --target build -f apps/api/Dockerfile .
```

As tabelas são criadas de forma idempotente pela API ao iniciar. Dados, modelos e sessão do WhatsApp vivem apenas nos volumes locais do Compose.

## Limites atuais do MVP

- A importação cobre CSV; PDF e OFX ainda não entram no parser.
- Imagens de comprovantes ainda não são ingeridas pelo worker do WhatsApp.
- A leitura de histórico depende do conteúdo que o WhatsApp Web consegue disponibilizar à sessão conectada e pode levar alguns minutos em conversas muito grandes.
- Não há Open Finance, nuvem gerenciada, SQL gerado por IA ou escrita direta do modelo no banco.
