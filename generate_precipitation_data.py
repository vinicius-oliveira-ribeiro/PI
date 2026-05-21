import pandas as pd
import os
import json
from datetime import datetime

def calcular_dia_do_ano(mes, dia):
    return (datetime(2024, mes, dia) - datetime(2024, 1, 1)).days + 1

dias_inicio_mes = [calcular_dia_do_ano(m, 1) for m in range(1, 13)]
dias_fim_mes = [calcular_dia_do_ano(m, 31 if m in [1,3,5,7,8,10,12] else 30 if m in [4,6,9,11] else 29) for m in range(1, 13)]

diretorio_csv = 'input/'

arquivos_csv = [f for f in os.listdir(diretorio_csv) if f.endswith('.csv') and 'PLUVIOMETRIA' in f]

print(f"Encontrados {len(arquivos_csv)} arquivos CSV de pluviometria.")

dados_diarios = {}

for arquivo_csv in arquivos_csv:
    partes = arquivo_csv.split('-')
    if len(partes) >= 2:
        ano = int(partes[0])
        mes = int(partes[1])
    else:
        continue

    caminho_csv = os.path.join(diretorio_csv, arquivo_csv)

    print(f"Processando {arquivo_csv} (Ano: {ano}, Mês: {mes})")

    df = pd.read_csv(caminho_csv, encoding='utf-8')

    for index, row in df.iterrows():
        regiao = row[0]
        if pd.isna(regiao) or not isinstance(regiao, str) or regiao.startswith('PREFEITURA') or regiao.startswith('SIURB') or regiao.startswith('BOLETIM') or regiao.startswith('PRECIPITAÇÃO') or regiao.startswith(','):
            continue

        precipitacao_diaria = row[1:32].values

        for dia in range(31):
            if dia < len(precipitacao_diaria):
                prec = precipitacao_diaria[dia]
                if pd.notna(prec) and isinstance(prec, (int, float)):
                    dia_do_mes = dia + 1
                    dia_do_ano = calcular_dia_do_ano(mes, dia_do_mes)

                    if dia_do_ano not in dados_diarios:
                        dados_diarios[dia_do_ano] = []
                    dados_diarios[dia_do_ano].append(prec)

medias_diarias = {}
for dia, precs in dados_diarios.items():
    if precs:
        medias_diarias[dia] = sum(precs) / len(precs)

print(f"Calculadas médias para {len(medias_diarias)} dias do ano.")

# Organizar dados por mês
dados_mensais = {}
for mes in range(1, 13):
    dados_mensais[str(mes)] = {}
    dias_mes = [dia for dia in medias_diarias.keys() if dias_inicio_mes[mes-1] <= dia <= dias_fim_mes[mes-1]]
    for dia in sorted(dias_mes):
        if dia in medias_diarias:
            dia_do_mes = dia - dias_inicio_mes[mes-1] + 1
            dados_mensais[str(mes)][str(dia_do_mes)] = medias_diarias[dia]

# Dias de alto risco
dias_alto_risco = [dia for dia, prec in medias_diarias.items() if prec > 30]

# Mapeamento de zonas
mapeamento_zonas = {
    'CV - Casa Verde': 'Norte',
    'FO - Freguesia do Ó': 'Norte',
    'JT - Jaçanã / Tremembé': 'Norte',
    'MG - Vl. Maria / Guilherme': 'Norte',
    'PJ - Pirituba / Jaraguá': 'Norte',
    'PR - Perus': 'Norte',
    'ST - Santana': 'Norte',
    'AF - Aricanduva / Vl. Formosa': 'Leste',
    'EM - Ermelino Matarazo': 'Leste',
    'GU - Guaianazes': 'Leste',
    'IQ - Itaquera': 'Leste',
    'IT - Itaim Paulista': 'Leste',
    'MO - Móoca': 'Leste',
    'MP - São Miguel Paulista': 'Leste',
    'PE - Penha': 'Leste',
    'SM - São Mateus': 'Leste',
    'CT - Cidade Tiradentes': 'Leste',
    'VP - Vila Prudente': 'Leste',
    'CL - Campo Limpo': 'Sul',
    'CS - Capela do Socorro': 'Sul',
    'IP - Ipiranga': 'Sul',
    'JÁ - Jabaquara': 'Sul',
    'SA - Santo Amaro': 'Sul',
    'VM - Vila Mariana': 'Sul',
    'PA - Parelheiros': 'Sul',
    'BT - Butantã': 'Oeste',
    'LA - Lapa': 'Oeste',
    'PI - Pinheiros': 'Oeste',
    'Bom Retiro (COMDEC)': 'Centro',
    'Consolação (CGE)': 'Centro',
    'SE - Sé': 'Centro'
}

# Processar dados por zona
dados_por_zona = {}
for arquivo_csv in arquivos_csv:
    partes = arquivo_csv.split('-')
    if len(partes) >= 2:
        ano = int(partes[0])
        mes = int(partes[1])
    else:
        continue

    caminho_csv = os.path.join(diretorio_csv, arquivo_csv)

    df = pd.read_csv(caminho_csv, encoding='utf-8')

    for index, row in df.iterrows():
        regiao = row[0]
        if pd.isna(regiao) or not isinstance(regiao, str) or regiao.startswith('PREFEITURA') or regiao.startswith('SIURB') or regiao.startswith('BOLETIM') or regiao.startswith('PRECIPITAÇÃO') or regiao.startswith(','):
            continue

        zona = mapeamento_zonas.get(regiao)
        if not zona:
            continue

        precipitacao_diaria = row[1:32].values

        for dia in range(31):
            if dia < len(precipitacao_diaria):
                prec = precipitacao_diaria[dia]
                if pd.notna(prec) and isinstance(prec, (int, float)):
                    dia_do_mes = dia + 1
                    dia_do_ano = calcular_dia_do_ano(mes, dia_do_mes)

                    if zona not in dados_por_zona:
                        dados_por_zona[zona] = {}
                    if dia_do_ano not in dados_por_zona[zona]:
                        dados_por_zona[zona][dia_do_ano] = []
                    dados_por_zona[zona][dia_do_ano].append(prec)

# Calcular médias por zona
medias_por_zona = {}
for zona, dias in dados_por_zona.items():
    medias_por_zona[zona] = {}
    for dia, precs in dias.items():
        if precs:
            medias_por_zona[zona][dia] = sum(precs) / len(precs)

# Organizar dados por zona e mês
dados_zona_mensais = {}
for zona in ['Norte', 'Sul', 'Leste', 'Oeste', 'Centro']:
    dados_zona_mensais[zona] = {}
    for mes in range(1, 13):
        dados_zona_mensais[zona][str(mes)] = {}
        zona_data = medias_por_zona.get(zona, {})
        dias_mes = [dia for dia in zona_data.keys() if dias_inicio_mes[mes-1] <= dia <= dias_fim_mes[mes-1]]
        for dia in sorted(dias_mes):
            if dia in zona_data:
                dia_do_mes = dia - dias_inicio_mes[mes-1] + 1
                dados_zona_mensais[zona][str(mes)][str(dia_do_mes)] = zona_data[dia]

# Coordenadas das zonas
coordenadas_zonas = {
    'Norte': [-23.5, -46.6],
    'Sul': [-23.6, -46.6],
    'Leste': [-23.55, -46.5],
    'Oeste': [-23.55, -46.7],
    'Centro': [-23.55, -46.63]
}

# Criar estrutura de dados para JSON
dados_json = {
    "dailyAverages": medias_diarias,
    "monthlyData": dados_mensais,
    "zoneData": dados_zona_mensais,
    "zones": list(coordenadas_zonas.keys()),
    "zoneCoordinates": coordenadas_zonas,
    "highRiskDays": dias_alto_risco,
    "totalFiles": len(arquivos_csv),
    "lastUpdated": datetime.now().isoformat(),
    "summary": {
        "totalDays": len(medias_diarias),
        "highRiskCount": len(dias_alto_risco),
        "averagePrecipitation": sum(medias_diarias.values()) / len(medias_diarias) if medias_diarias else 0,
        "maxPrecipitation": max(medias_diarias.values()) if medias_diarias else 0
    }
}

# Salvar dados em JSON
with open('precipitation_data.json', 'w', encoding='utf-8') as f:
    json.dump(dados_json, f, indent=2, ensure_ascii=False)

print("Dados de precipitação salvos em precipitation_data.json")
print(f"Resumo: {len(medias_diarias)} dias analisados, {len(dias_alto_risco)} dias de alto risco")