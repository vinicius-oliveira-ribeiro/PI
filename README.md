# Estação meteorológica e histórico de chuva

Este projeto reúne leituras de um ESP32 com sensor BME280 e boletins históricos de pluviometria da cidade de São Paulo. A interface permite acompanhar temperatura, umidade e pressão ao longo do tempo e comparar essas medições com padrões de chuva dos arquivos do próprio projeto.

**Painel publicado:** [estacao-meteorologica-pi-omega.vercel.app](https://estacao-meteorologica-pi-omega.vercel.app/)

O objetivo de longo prazo é estudar a relação entre condições meteorológicas e enchentes. A versão atual apresenta medições e comparações descritivas. O BME280 não mede chuva, e os dados disponíveis ainda não incluem pluviometria em tempo real nem ocorrências de enchente para treinar e validar uma previsão. Por isso, o painel publicado não classifica risco imediato.

## Dados disponíveis

- **Estação atual:** temperatura (°C), umidade relativa (%), pressão atmosférica (hPa) e altitude estimada (m), fornecidas pelo BME280 conectado ao ESP32.
- **Chuva histórica:** 190 arquivos CSV em input/, com 189.377 medições de 35 estações entre 01/01/2010 e 31/10/2025. Nenhum conjunto de dados externo é baixado durante a importação.
- **Agregação da chuva:** para cada dia, o painel calcula a média das estações com registro na zona selecionada. Os valores mensais e anuais somam essas médias diárias. A quantidade de estações varia conforme a data.

## Arquitetura

~~~text
ESP32 + BME280 ── Wi-Fi /sensor ──► coletor no computador
                                      │ leitura a cada 60 s; fila local em falhas
                                      ▼
                              Supabase Edge Function ingest-sensor
                                      │ valida token da estação
                                      ▼
Boletins CSV em input/ ── importador ─► PostgreSQL no Supabase
                                      │ Data API e funções SQL de leitura
                                      ▼
                              interface estática na Vercel
~~~

O computador consulta o ESP32 em http://192.168.15.39/sensor por padrão. O coletor envia as leituras à função ingest-sensor e guarda eventos pendentes em bridge/.data/ quando a conexão falha. Cada evento tem um identificador único para evitar duplicação ao reenviar. A interface publicada consulta somente o Supabase; ela não depende de acesso à rede local do ESP32.

| Componente | Local | Responsabilidade |
| --- | --- | --- |
| Interface | web/ e Vercel | Gráficos, filtros por período e zona, última leitura e comparação histórica |
| Coletor | bridge/collector.mjs no computador | Ler /sensor, normalizar dados e enviar ou enfileirar leituras |
| Recebimento | supabase/functions/ingest-sensor/ | Autenticar a estação e gravar leituras |
| Banco | supabase/migrations/ e Supabase | Armazenar séries históricas e medições do sensor |
| Importação | tools/import-precipitation.mjs | Normalizar os CSVs de input/ e enviar os registros ao banco |

No PostgreSQL, public.precipitation_daily armazena a chuva por estação e data, public.sensor_readings armazena as leituras do ESP32, e private.device_tokens guarda apenas o hash do token da estação. A view sensor_latest e as funções dashboard_precipitation_series e dashboard_sensor_series atendem ao painel. As tabelas públicas usam Row Level Security: a interface pode ler, enquanto a escrita depende de credenciais de servidor ou do token validado pela Edge Function.

## Executar no computador

Requer Node.js 22 ou superior e npm.

~~~powershell
npm install
npm start
~~~

A interface atual fica em http://localhost:3000/web/. O servidor local também mantém as páginas do protótipo em / e /dashboard.html e oferece /api/sensor para leitura local do ESP32. Sem configuração do Supabase, /web/ usa uma prévia gerada dos CSVs existentes; essa prévia não substitui o banco da versão publicada.

Para configurar o coletor, copie bridge/.env.example para bridge/.env, preencha a URL do projeto, o token da estação e o endereço do ESP32. O arquivo .env é local e está fora do Git.

~~~powershell
if (-not (Test-Path bridge/.env)) { Copy-Item bridge/.env.example bridge/.env }
npm run bridge:check   # lê o sensor sem enviar
npm run bridge:once    # envia uma leitura
npm run bridge         # continua enviando a cada minuto
~~~

No computador da estação, a tarefa do Windows PI-Coletor-ESP32 inicia o coletor quando o usuário entra na conta. Se o coletor já estiver aberto manualmente, evite iniciar outra cópia. O computador e o ESP32 precisam permanecer ligados e conectados à rede para que novas leituras cheguem ao banco.

## Banco e publicação

- **Supabase:** a migração supabase/migrations/20261109000100_weather_data.sql cria tabelas, índices, políticas de acesso e consultas do painel. A função ingest-sensor recebe os dados do coletor. O histórico de chuva foi importado dos CSVs do repositório.
- **Vercel:** vercel.json executa npm run build e publica dist/. O build recebe SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY nos ambientes Production e Preview. A chave publicável é usada somente para leitura pelo navegador.
- **Segredos:** DEVICE_TOKEN fica em bridge/.env ou no dispositivo; o banco guarda apenas seu SHA-256. A chave secreta do Supabase é usada na importação e no serviço, nunca no código publicado pela Vercel.

Para conferir os CSVs, compilar a interface e executar os testes:

~~~powershell
node tools/import-precipitation.mjs
npm run build
npm test
~~~

O procedimento completo de configuração, importação e publicação está em [docs/IMPLANTACAO.md](docs/IMPLANTACAO.md). O contrato da função e das consultas SQL está em [supabase/README.md](supabase/README.md).

## Organização do repositório

~~~text
input/                         boletins mensais de pluviometria
web/                           interface publicada na Vercel
bridge/                        coletor do ESP32
supabase/migrations/            esquema e políticas PostgreSQL
supabase/functions/             recebimento das leituras
tools/                          importação dos CSVs
scripts/                        build da interface
tests/                          testes do coletor e da importação
docs/                           implantação e operação
server.js                       servidor local e proxy do sensor
index.html, dashboard.html      páginas do protótipo local anterior
generate_precipitation_data.py,
analisePreditiva.py             análises e gráficos exploratórios anteriores
~~~
