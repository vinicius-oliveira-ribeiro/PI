# Configuração da nova estação meteorológica

## O que já está preparado

O projeto contém a interface em `web/`, a migração PostgreSQL e a função de
recebimento em `supabase/`, o importador dos CSVs em `tools/` e o coletor do ESP32
em `bridge/`. A página publicada na Vercel lê o Supabase. O computador que está
ligado ao ESP32 consulta a rota `/sensor` já usada pelo projeto e envia cada
leitura à função `ingest-sensor` do Supabase.

```
ESP32/BME280 → computador → função no Supabase → PostgreSQL → interface na Vercel
                 input/*.csv ────────────────→ PostgreSQL
```

O coletor guarda leituras pendentes em `bridge/.data/pending.json` durante uma
falha de conexão e tenta enviá-las novamente. Cada leitura mantém o mesmo
`event_id`, que impede duplicação no banco.

## Conferir a interface localmente

Com Node.js 18 ou superior:

```powershell
npm install
npm start
```

Acesse `http://localhost:3000/web/`. Sem credenciais de Supabase, a página mostra
uma prévia baseada nos próprios 190 CSVs do projeto **e lê o BME280 pela mesma
rota local da interface antiga** (`/api/sensor`). Ela atualiza as medições a cada
10 segundos e mostra no gráfico as leituras desde que a página foi aberta. Essas
leituras locais só passam a ser armazenadas a longo prazo após conectar o coletor
ao Supabase. Se a porta 3000 já estiver em uso e a página abrir normalmente,
o servidor provavelmente já está rodando; não inicie uma segunda cópia.

Para conferir exatamente os arquivos que a Vercel publicará:

```powershell
npm run build
```

O resultado fica em `dist/`.

## Criar o banco no Supabase

1. No projeto Supabase, configure a integração GitHub com o repositório `PI`,
   diretório de trabalho `.` e a opção **Deploy to production** para a branch
   `main`. O `supabase/config.toml` declara apenas a função; sem um bloco
   `[remotes.main]`, os próximos envios não alteram o Auth do projeto.
   Confira no painel que a migração `20261109000100_weather_data` e a função
   `ingest-sensor` foram implantadas. Não execute manualmente a mesma migração
   se ela já aparecer como concluída.
2. Se a integração parar antes da migração, verifique o acesso ao banco e os
   bloqueios de IP conforme [supabase/README.md](../supabase/README.md).
   Aplicar o SQL diretamente no editor exige reconciliar depois o histórico
   de migrações do Supabase.
3. Configure o token da estação no banco como indicado em `supabase/README.md`.
4. Importe os CSVs existentes. Em uma janela PowerShell com a URL e a chave
   **secreta** do projeto definidas como variáveis de ambiente:

   ```powershell
   $env:SUPABASE_URL = 'https://SEU_PROJETO.supabase.co'
   $env:SUPABASE_SERVICE_ROLE_KEY = 'SUA_CHAVE_SECRETA'
   node tools/import-precipitation.mjs --upload
   ```

O importador faz upsert por estação e data; pode ser executado outra vez ao
adicionar CSVs. Também pode apenas conferir o arquivo localmente:

```powershell
node tools/import-precipitation.mjs
```

Os 190 boletins atuais contêm 189.377 medições de 2010-01-01 a 2025-10-31.
O dia 31/07/2010 está ausente no arquivo de origem. A quantidade de estações
por zona muda com o tempo; os gráficos expõem essa cobertura para contextualizar
comparações entre anos.

## Enviar as leituras do ESP32 pelo computador

Copie `bridge/.env.example` para `bridge/.env` e preencha a URL do Supabase, o
token criado em `supabase/README.md` e a rota local do ESP32. O padrão é
`http://192.168.15.39/sensor`, a mesma rota usada pelo servidor atual.

```powershell
Copy-Item bridge/.env.example bridge/.env
node --env-file=bridge/.env bridge/collector.mjs --once --dry-run
node --env-file=bridge/.env bridge/collector.mjs --once
node --env-file=bridge/.env bridge/collector.mjs
```

O primeiro comando com `--dry-run` lê o sensor e mostra os valores normalizados,
sem enviar ao banco. O segundo envia uma leitura. O terceiro mantém a coleta
contínua, a cada 60 segundos por padrão. Ele deve permanecer rodando neste
computador. Para usar o Wi-Fi do ESP32 diretamente no futuro, ele poderá enviar
o mesmo JSON e token à função `ingest-sensor`.

O token do dispositivo fica apenas no computador ou no ESP32. A chave secreta
do Supabase só é usada na importação e internamente pela função; nunca vai para
a interface.

## Publicar a interface na Vercel

Importe este repositório como projeto Vercel. `vercel.json` já define o comando
de build e a pasta `dist/`. Configure estas duas variáveis para Production e
Preview no projeto Vercel:

```text
SUPABASE_URL=https://SEU_PROJETO.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

O build só expõe a chave **publishable** na página. A importação e o coletor usam
credenciais próprias fora da Vercel. O build publicado exige as duas variáveis;
sem elas, falha para evitar uma página de demonstração apresentada como sistema
ao vivo. As consultas públicas são de leitura; o banco usa RLS para impedir
escrita pelo navegador.

## Interpretação dos resultados

O BME280 fornece temperatura, umidade e pressão. Os CSVs fornecem chuva
**histórica**, não precipitação atual. A interface permite comparar séries de
tempo e explorar padrões no passado. Uma previsão quantitativa de enchentes
requer registros de eventos de enchente para treinamento e validação,
além de uma fonte de precipitação recente.
