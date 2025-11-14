import pandas as pd
import matplotlib.pyplot as plt
import geopandas as gpd
import folium
from branca.colormap import linear
import os
import requests
import seaborn as sns
import numpy as np
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

for mes in range(1, 13):
    dias_mes = [dia for dia in medias_diarias.keys() if dias_inicio_mes[mes-1] <= dia <= dias_fim_mes[mes-1]]
    if dias_mes:
        plt.figure(figsize=(10, 6))
        dias_plot = []
        medias_plot = []
        for dia in sorted(dias_mes):
            if dia in medias_diarias:
                dias_plot.append(dia - dias_inicio_mes[mes-1] + 1)
                medias_plot.append(medias_diarias[dia])

        plt.plot(dias_plot, medias_plot, marker='o')
        plt.title(f'Média de Precipitação Diária - Mês {mes}')
        plt.xlabel('Dia do Mês')
        plt.ylabel('Precipitação Média (mm)')
        plt.grid(True)
        plt.savefig(f'precipitacao_mes_{mes}.png')
        plt.close()
        print(f"Gráfico salvo: precipitacao_mes_{mes}.png")

dias_ordenados = sorted(medias_diarias.keys())
precipitacoes = [medias_diarias[dia] for dia in dias_ordenados]

plt.figure(figsize=(15, 8))
plt.plot(dias_ordenados, precipitacoes, marker='o', markersize=2)
plt.title('Média de Precipitação por Dia do Ano (2010-2025)')
plt.xlabel('Dia do Ano')
plt.ylabel('Precipitação Média (mm)')
plt.grid(True)

dias_alto_risco = [dia for dia, prec in medias_diarias.items() if prec > 30]
plt.scatter(dias_alto_risco, [medias_diarias[dia] for dia in dias_alto_risco], color='red', label='Alto Risco (>30 mm)', zorder=5)

plt.legend()
plt.savefig('precipitacao_ano_completo.png', dpi=300)
plt.close()
print("Gráfico anual salvo: precipitacao_ano_completo.png")

precipitacao_por_regiao_por_dia = {}

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

        precipitacao_diaria = row[1:32].values

        for dia in range(31):
            if dia < len(precipitacao_diaria):
                prec = precipitacao_diaria[dia]
                if pd.notna(prec) and isinstance(prec, (int, float)):
                    dia_do_mes = dia + 1
                    dia_do_ano = calcular_dia_do_ano(mes, dia_do_mes)

                    if regiao not in precipitacao_por_regiao_por_dia:
                        precipitacao_por_regiao_por_dia[regiao] = {}
                    if dia_do_ano not in precipitacao_por_regiao_por_dia[regiao]:
                        precipitacao_por_regiao_por_dia[regiao][dia_do_ano] = []
                    precipitacao_por_regiao_por_dia[regiao][dia_do_ano].append(prec)

medias_por_regiao_por_dia = {}
for regiao, dias in precipitacao_por_regiao_por_dia.items():
    medias_por_regiao_por_dia[regiao] = {}
    for dia, precs in dias.items():
        if precs:
            medias_por_regiao_por_dia[regiao][dia] = sum(precs) / len(precs)

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

medias_por_zona_por_dia = {}
for regiao, dias in medias_por_regiao_por_dia.items():
    zona = mapeamento_zonas.get(regiao)
    if zona:
        if zona not in medias_por_zona_por_dia:
            medias_por_zona_por_dia[zona] = {}
        for dia, media in dias.items():
            if dia not in medias_por_zona_por_dia[zona]:
                medias_por_zona_por_dia[zona][dia] = []
            medias_por_zona_por_dia[zona][dia].append(media)

for zona in medias_por_zona_por_dia:
    for dia in medias_por_zona_por_dia[zona]:
        medias_por_zona_por_dia[zona][dia] = sum(medias_por_zona_por_dia[zona][dia]) / len(medias_por_zona_por_dia[zona][dia])

coordenadas_zonas = {
    'Norte': [-23.5, -46.6],
    'Sul': [-23.6, -46.6],
    'Leste': [-23.55, -46.5],
    'Oeste': [-23.55, -46.7],
    'Centro': [-23.55, -46.63]
}

m = folium.Map(location=[-23.5505, -46.6333], zoom_start=10)

all_precs = []
for zona in medias_por_zona_por_dia.values():
    for dia in zona.values():
        all_precs.append(dia)

min_prec = min(all_precs) if all_precs else 0
max_prec = max(all_precs) if all_precs else 50

colormap = linear.YlOrRd_09.scale(min_prec, max_prec)

for zona, coords in coordenadas_zonas.items():
    for dia in medias_por_zona_por_dia.get(zona, {}):
        prec = medias_por_zona_por_dia[zona][dia]
        color = colormap(prec)
        folium.CircleMarker(
            location=[coords[0], coords[1]],
            radius=10 + prec / 2,
            color=color,
            fill=True,
            fill_color=color,
            fill_opacity=0.7,
            popup=f"Zona: {zona}<br>Dia: {dia}<br>Precipitação: {prec:.2f} mm",
            className=f"dia-{dia}"
        ).add_to(m)

colormap.caption = 'Precipitação Média (mm)'
colormap.add_to(m)

control_html = """
<div style="position: fixed; top: 10px; left: 10px; z-index: 1000; background: white; padding: 10px; border: 1px solid black;">
    <label for="mes">Mês:</label>
    <select id="mes">
        <option value="1">Janeiro</option>
        <option value="2">Fevereiro</option>
        <option value="3">Março</option>
        <option value="4">Abril</option>
        <option value="5">Maio</option>
        <option value="6">Junho</option>
        <option value="7">Julho</option>
        <option value="8">Agosto</option>
        <option value="9">Setembro</option>
        <option value="10">Outubro</option>
        <option value="11">Novembro</option>
        <option value="12">Dezembro</option>
    </select>
    <label for="dia">Dia:</label>
    <select id="dia">
    </select>
    <button onclick="filtrar()">Filtrar</button>
</div>
"""

m.get_root().html.add_child(folium.Element(control_html))

js = """
<script>
function updateDias() {
    var mes = document.getElementById('mes').value;
    var diaSelect = document.getElementById('dia');
    diaSelect.innerHTML = '';
    var diasNoMes = new Date(2025, mes, 0).getDate();
    for (var i = 1; i <= diasNoMes; i++) {
        var option = document.createElement('option');
        option.value = i;
        option.text = i;
        diaSelect.appendChild(option);
    }
}

function filtrar() {
    var mes = parseInt(document.getElementById('mes').value);
    var dia = parseInt(document.getElementById('dia').value);
    var diaDoAno = 0;
    for (var m = 1; m < mes; m++) {
        diaDoAno += new Date(2025, m, 0).getDate();
    }
    diaDoAno += dia;

    var allMarkers = document.querySelectorAll('[class*="dia-"]');
    allMarkers.forEach(function(marker) {
        marker.style.display = 'none';
    });

    var selectedMarkers = document.querySelectorAll('.dia-' + diaDoAno);
    selectedMarkers.forEach(function(marker) {
        marker.style.display = 'block';
    });
}

document.getElementById('mes').addEventListener('change', updateDias);
updateDias();
</script>
"""

m.get_root().html.add_child(folium.Element(js))

m.save('mapa_geografico_calor_SP.html')
print("Mapa geográfico interativo com seleção de mês e dia salvo: mapa_geografico_calor_SP.html")

heatmap_data = np.full((12, 31), np.nan)

for dia_ano, prec in medias_diarias.items():
    for m in range(1, 13):
        if dias_inicio_mes[m-1] <= dia_ano <= dias_fim_mes[m-1]:
            dia_mes = dia_ano - dias_inicio_mes[m-1] + 1
            heatmap_data[m - 1, dia_mes - 1] = prec
            break

plt.figure(figsize=(15, 8))
sns.heatmap(heatmap_data, cmap='YlOrRd', annot=False, cbar_kws={'label': 'Precipitação Média (mm)'})
plt.title('Mapa de Calor da Precipitação Média por Mês e Dia (2010-2025)')
plt.xlabel('Dia do Mês')
plt.ylabel('Mês')
plt.xticks(ticks=np.arange(0, 31, 5), labels=np.arange(1, 32, 5))
plt.yticks(ticks=np.arange(0, 12, 1), labels=['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'], rotation=0)
plt.savefig('heatmap_precipitacao.png', dpi=300, bbox_inches='tight')
plt.close()
print("Mapa de calor salvo: heatmap_precipitacao.png")
