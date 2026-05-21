# Estação Meteorológica - Monitoramento e Análise de Precipitação

Este projeto integra um **monitor de sensor ambiental em tempo real** com **dados históricos de precipitação** do estado de São Paulo, oferecendo uma interface web para visualização e análise de riscos.

## Páginas do Sistema

### 1. Monitor do Sensor - index.html
Página principal que exibe em tempo real os dados do sensor IoT:
- Temperatura
- Pressão atmosférica
- Umidade relativa do ar
- Altitude

Acessível em: `http://localhost:3000` (ou `http://localhost:3000/index.html`)

### 2. Estação Meteorológica - dashboard.html
Dashboard completo com análise cruzada entre dados do sensor e precipitação histórica, contendo:
- Dados do sensor em tempo real
- Resumo de riscos com análise de enchente por zona
- Mapa de calor da precipitação média por zona

Acessível em: `http://localhost:3000/dashboard.html`

---

## Funcionalidades

### Monitor do Sensor
- Monitoramento em tempo real de temperatura, pressão, umidade e altitude
- Atualização automática a cada 5 segundos
- Servidor proxy local para resolver CORS com dispositivo IoT
- Indicadores visuais de status de conexão

### Estação Meteorológica (Dashboard)
- **Dados do Sensor**: Temperatura (grande) + Pressão (pequeno) | Umidade (grande) + Altitude (pequeno)
- **Resumo de Riscos**:
  - Risco de enchente por zona (ALTO/MÉDIO/BAIXO)
  - Estatísticas históricas da zona selecionada
  - Análise combinada (sensor + histórico) com recomendações
  - Classificação em 4 níveis: BAIXO, MÉDIO, ALTO, CRÍTICO
- **Mapa de Calor**: Precipitação média por dia e mês, por zona selecionável, com escala azul (claro → escuro) e tooltip interativo

### Análise de Precipitação (Python)
- Processa múltiplos arquivos CSV de dados de pluviometria da CGESP
- Calcula médias diárias de precipitação agregadas por dia do ano
- Gera gráficos de precipitação para cada mês e anual
- Cria mapa geográfico interativo com marcadores filtráveis
- Gera mapa de calor mensal

---

## Requisitos

### Para o servidor web e dashboard:
- Node.js (versão 14 ou superior)
- npm

### Para processamento de dados históricos:
- Python 3.x
- Bibliotecas: pandas, matplotlib, geopandas, folium, seaborn, numpy

---

## Instalação

### 1. Instalar dependências Python (para processar dados CSV)
```bash
pip install pandas matplotlib geopandas folium seaborn numpy
```

### 2. Baixar shapefile dos municípios de SP (opcional)
- Acesse o GeoSampa: https://geosampa.prefeitura.sp.gov.br/
- Baixe o shapefile dos municípios em formato SHP
- Descompacte o arquivo ZIP na pasta raiz do projeto

### 3. Instalar dependências Node.js
```bash
npm install
```

---

## Como Usar

### 1. Processar dados históricos de precipitação
```bash
python generate_precipitation_data.py
```
Este comando processa todos os arquivos CSV da pasta `input/` (190+ arquivos de 2010 a 2025) e gera:
- `precipitation_data.json` - dados processados para o dashboard

### 2. Iniciar o servidor
```bash
npm start
```
O servidor inicia em `http://localhost:3000`

### 3. Acessar as páginas
- **Monitor do Sensor**: `http://localhost:3000`
- **Estação Meteorológica**: `http://localhost:3000/dashboard.html`

---

## Estrutura do Projeto

```
/
├── server.js                          # Servidor Express (proxy sensor + API dados)
├── package.json                       # Dependências Node.js
├── index.html                         # Monitor do sensor
├── dashboard.html                     # Estação Meteorológica
├── script.js                          # Lógica frontend do monitor
├── dashboard.js                       # Lógica frontend do dashboard
├── style.css                          # Estilos compartilhados
├── generate_precipitation_data.py     # Processa CSV → JSON
├── analisePreditiva.py                # Script completo de análise (gráficos, mapas)
├── precipitation_data.json            # Dados históricos processados (gerado)
├── input/                             # Arquivos CSV de pluviometria
│   ├── 2010-01-PLUVIOMETRIA-CGESP.csv
│   ├── ...
│   └── 2024-12-PLUVIOMETRIA-CGESP.csv
├── README.md
├── precipitacao_mes_1.png ... 12.png  # Gráficos mensais (gerados)
├── precipitacao_ano_completo.png      # Gráfico anual (gerado)
├── mapa_geografico_calor_SP.html      # Mapa interativo (gerado)
├── heatmap_precipitacao.png           # Mapa de calor (gerado)
└── SP_Municipios_2020/                # Shapefile (opcional)
```

---

## Configuração do Dispositivo Sensor

O servidor faz proxy para o sensor no endereço `http://192.168.15.39/sensor`. Para alterar:
1. Edite o arquivo `server.js`
2. Localize a linha: `const response = await fetch('http://192.168.15.39/sensor', {`
3. Substitua pelo IP correto do seu dispositivo

---

## Análise de Risco de Enchente

O sistema calcula o risco de enchente combinando:

**Fatores do sensor atual:**
- Umidade > 80% (+2 pontos), > 90% (+3 pontos)
- Pressão < 1000 hPa (+2 pontos), < 990 hPa (+3 pontos)
- Temperatura < 18°C (+1 ponto)

**Fatores históricos da zona:**
- Precipitação máxima > 50mm (+3 pontos)
- Precipitação máxima > 30mm (+2 pontos)

**Classificação:**
- 0-1 ponto: BAIXO ✅
- 2-3 pontos: MÉDIO ⚡
- 4-5 pontos: ALTO ⚠️
- 6+ pontos: CRÍTICO 🚨

---

## Mapeamento de Zonas

| Zona | Regiões |
|------|---------|
| **Norte** | Casa Verde, Freguesia do Ó, Jaçanã/Tremembé, Vila Maria/Guilherme, Pirituba/Jaraguá, Perus, Santana |
| **Leste** | Aricanduva/Vila Formosa, Ermelino Matarazo, Guaianazes, Itaquera, Itaim Paulista, Móoca, São Miguel Paulista, Penha, São Mateus, Cidade Tiradentes, Vila Prudente |
| **Sul** | Campo Limpo, Capela do Socorro, Ipiranga, Jabaquara, Santo Amaro, Vila Mariana, Parelheiros |
| **Oeste** | Butantã, Lapa, Pinheiros |
| **Centro** | Bom Retiro, Consolação, Sé |

---

## Resolução de Problemas

### Interface não carrega dados após reiniciar o computador
- **Causa**: O servidor Node.js para após o reinício
- **Solução**: Execute `npm start` novamente

### Erro de conexão com o sensor
- Verifique se o dispositivo está ligado e na mesma rede
- Teste a conectividade: acesse `http://192.168.15.39/sensor` no navegador
- Se o IP mudou, atualize em `server.js`

### Dados históricos não carregam
- Execute `python generate_precipitation_data.py` para gerar os dados

### Porta 3000 ocupada
- Altere `const PORT = 3000;` em `server.js` para outra porta (ex: 3001)

---

## Formato dos Dados CSV

Os arquivos CSV da CGESP seguem o formato:
- Primeira coluna: Nome da região/zona (ex.: "CV - Casa Verde")
- Colunas subsequentes: Precipitação diária em mm para cada dia do mês
- Linhas iniciais podem conter metadados (ignoradas se começarem com "PREFEITURA", "SIURB", etc.)

---

## Atualização de Dados

Para atualizar os dados históricos:
1. Adicione novos arquivos CSV na pasta `input/`
2. Execute: `python generate_precipitation_data.py`
3. Reinicie o servidor se necessário