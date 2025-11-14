# Análise de Precipitação no Estado de São Paulo

Este projeto realiza uma análise detalhada dos dados de precipitação no estado de São Paulo, utilizando arquivos CSV da CGESP (Companhia de Gestão dos Recursos Hídricos). O script processa dados históricos de 2010 a 2024, calcula médias diárias e gera visualizações para auxiliar na compreensão dos padrões de chuva.

## Funcionalidades

- Processa múltiplos arquivos CSV de dados de pluviometria da CGESP.
- Calcula médias diárias de precipitação agregadas por dia do ano.
- Gera gráficos de precipitação média para cada mês do ano.
- Produz um gráfico anual completo com indicadores de alto risco (>30 mm).
- Cria um mapa geográfico interativo com marcadores para zonas de São Paulo, permitindo filtragem por mês e dia.
- Gera um mapa de calor (heatmap) da precipitação média por mês e dia.
- Confirma o número de arquivos CSV processados e salva estatísticas no console.

## Requisitos

- Python 3.x
- Bibliotecas: pandas, matplotlib, geopandas, folium, seaborn, numpy

## Instalação

1. Instale as dependências:
   ```bash
   pip install pandas matplotlib geopandas folium seaborn numpy
   ```

2. Baixe o shapefile dos municípios de São Paulo (opcional, para extensões futuras):
   - Acesse o GeoSampa: https://geosampa.prefeitura.sp.gov.br/
   - Baixe o shapefile dos municípios em formato SHP.
   - Descompacte o arquivo ZIP na pasta raiz do projeto, criando uma pasta como 'SP_Municipios_2020' com os arquivos .shp, .dbf, .prj, .shx.

## Estrutura do Projeto

```
/
├── analisePreditiva.py
├── input/
│   ├── 2010-01-PLUVIOMETRIA-CGESP.csv
│   ├── 2010-02-PLUVIOMETRIA-CGESP.csv
│   ├── ...
│   ├── 2024-12-PLUVIOMETRIA-CGESP.csv
├── SP_Municipios_2020/
│   ├── SP_Municipios_2020.shp
│   ├── SP_Municipios_2020.dbf
│   ├── SP_Municipios_2020.prj
│   ├── SP_Municipios_2020.shx
├── README.md
├── precipitacao_mes_1.png
├── precipitacao_mes_2.png
├── ...
├── precipitacao_mes_12.png
├── precipitacao_ano_completo.png
├── mapa_geografico_calor_SP.html
├── heatmap_precipitacao.png
```

## Como Usar

1. Coloque os arquivos CSV de dados de pluviometria na pasta `input/`.
2. Execute o script:
   ```bash
   python analisePreditiva.py
   ```

## Saídas

- **Console**: Informações sobre o processamento, número de arquivos processados e médias calculadas.
- **precipitacao_mes_X.png**: Gráficos de precipitação média diária para cada mês (X de 1 a 12).
- **precipitacao_ano_completo.png**: Gráfico anual da precipitação média por dia, com destaque para dias de alto risco (>30 mm).
- **mapa_geografico_calor_SP.html**: Mapa geográfico interativo de São Paulo com marcadores para zonas (Norte, Sul, Leste, Oeste, Centro), coloridos por nível de precipitação (escala branco-amarelo-laranja-vermelho) com legenda, e filtráveis por mês/dia.
- **heatmap_precipitacao.png**: Mapa de calor da precipitação média por mês e dia do ano.

## Formato dos Dados CSV

Os arquivos CSV da CGESP seguem um formato específico:
- Primeira coluna: Nome da região/zona (ex.: "CV - Casa Verde").
- Colunas subsequentes: Precipitação diária em mm para cada dia do mês (até 31 colunas).
- Linhas iniciais podem conter metadados (ignoradas se começarem com "PREFEITURA", "SIURB", etc.).

## Mapeamento de Zonas

O script agrupa as regiões em zonas de São Paulo:
- **Norte**: Casa Verde, Freguesia do Ó, Jaçanã/Tremembé, Vila Maria/Guilherme, Pirituba/Jaraguá, Perus, Santana.
- **Leste**: Aricanduva/Vila Formosa, Ermelino Matarazo, Guaianazes, Itaquera, Itaim Paulista, Móoca, São Miguel Paulista, Penha, São Mateus, Cidade Tiradentes, Vila Prudente.
- **Sul**: Campo Limpo, Capela do Socorro, Ipiranga, Jabaquara, Santo Amaro, Vila Mariana, Parelheiros.
- **Oeste**: Butantã, Lapa, Pinheiros.
- **Centro**: Bom Retiro, Consolação, Sé.

## Notas

- Arquivos CSV sem dados válidos são ignorados automaticamente.
- O mapa interativo utiliza Folium com marcadores circulares; vermelho para precipitação >30 mm, azul para menor.
- O heatmap utiliza a escala de cores YlOrRd (amarelo para vermelho).
- Dados históricos de 2010 a 2024 são agregados para calcular médias.
- O script calcula médias por zona para o mapa geográfico.
