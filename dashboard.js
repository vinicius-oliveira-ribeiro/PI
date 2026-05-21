// Configurações
const API_URL = '/api/sensor';
const PRECIPITATION_API_URL = '/api/precipitation';

// Estado
let sensorData = null;
let historicalData = null;

// Elementos DOM
const zones = ['Norte', 'Sul', 'Leste', 'Oeste', 'Centro'];
const monthLabels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// ============== FUNÇÕES DE CARGA ==============

async function loadSensorData() {
    try {
        const status = document.getElementById('sensor-status');
        status.textContent = 'Conectando ao sensor...';
        status.style.color = '#ffc107';

        const res = await fetch(API_URL);
        if (!res.ok) throw new Error('HTTP ' + res.status);

        const data = await res.json();
        sensorData = data;

        // Temperatura e Umidade - cards grandes
        document.querySelector('#temperature .value').textContent = `${data.temperature.toFixed(1)} °C`;
        document.querySelector('#humidity .value').textContent = `${data.humidity.toFixed(0)} %`;

        // Pressão e Altitude - cards pequenos (value-sm)
        document.querySelector('#pressure .value-sm').textContent = `${data.pressure.toFixed(0)} hPa`;
        document.querySelector('#altitude .value-sm').textContent = `${data.altitude.toFixed(0)} m`;

        status.textContent = `Sensor conectado - ${new Date().toLocaleTimeString('pt-BR')}`;
        status.style.color = '#28a745';

        updateFullRiskAnalysis();
    } catch (e) {
        console.error('Sensor error:', e);
        document.getElementById('sensor-status').textContent = 'Sensor indisponível';
        document.getElementById('sensor-status').style.color = '#dc3545';
    }
}

async function loadHistoricalData() {
    try {
        const riskSummary = document.getElementById('risk-summary');
        riskSummary.innerHTML = 'Carregando dados históricos...';

        const res = await fetch(PRECIPITATION_API_URL);
        if (!res.ok) throw new Error('HTTP ' + res.status);

        historicalData = await res.json();
        console.log('Dados históricos carregados:', historicalData.summary);

        // Carregar heatmap
        loadHeatmap();

        // Atualizar resumo quando mudar de zona
        document.getElementById('zone-select').addEventListener('change', function() {
            loadHeatmap();
            updateFullRiskAnalysis();
        });
    } catch (e) {
        console.error('Historical data error:', e);
        document.getElementById('risk-summary').innerHTML = 'Erro ao carregar dados históricos';
    }
}

// ============== HEATMAP ==============

function loadHeatmap() {
    if (!historicalData) return;

    const zone = document.getElementById('zone-select').value;
    const zoneData = historicalData.zoneData[zone];

    if (!zoneData) {
        document.getElementById('zone-heatmap-title').textContent = `Sem dados para zona ${zone}`;
        return;
    }

    const canvas = document.getElementById('zone-heatmap-chart');
    const ctx = canvas.getContext('2d');
    const tooltip = document.getElementById('zone-heatmap-tooltip');

    const W = canvas.parentElement.clientWidth - 40 || 800;
    const H = 420;
    canvas.width = W;
    canvas.height = H;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';

    ctx.clearRect(0, 0, W, H);

    const ML = 50, MT = 40, MR = 20, MB = 50;
    const GW = W - ML - MR;
    const GH = H - MT - MB;
    const CW = GW / 31;
    const CH = GH / 12;

    const heatData = [];
    let minVal = Infinity, maxVal = -Infinity;

    for (let m = 1; m <= 12; m++) {
        const monthData = zoneData[m.toString()] || {};
        const row = [];
        for (let d = 1; d <= 31; d++) {
            const v = monthData[d.toString()];
            row.push(v);
            if (v !== null && v !== undefined) {
                if (v < minVal) minVal = v;
                if (v > maxVal) maxVal = v;
            }
        }
        heatData.push(row);
    }

    if (minVal === Infinity) minVal = 0;
    if (maxVal === -Infinity) maxVal = 1;

    function getColor(v) {
        if (v === null || v === undefined) return '#f0f0f0';
        const n = (v - minVal) / (maxVal - minVal);
        // Escala azul: do claro (#e3f2fd) ao escuro (#0d47a1)
        const r = Math.round(227 - n * (227 - 13));
        const g = Math.round(242 - n * (242 - 71));
        const b = Math.round(253 - n * (253 - 161));
        return `rgb(${r},${g},${b})`;
    }

    for (let m = 0; m < 12; m++) {
        for (let d = 0; d < 31; d++) {
            const v = heatData[m][d];
            const x = ML + d * CW;
            const y = MT + m * CH;
            ctx.fillStyle = getColor(v);
            ctx.fillRect(x, y, Math.max(CW - 0.5, 1), Math.max(CH - 0.5, 1));
        }
    }

    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 0.5;
    for (let m = 0; m <= 12; m++) {
        ctx.beginPath();
        ctx.moveTo(ML, MT + m * CH);
        ctx.lineTo(ML + GW, MT + m * CH);
        ctx.stroke();
    }
    for (let d = 0; d <= 31; d++) {
        ctx.beginPath();
        ctx.moveTo(ML + d * CW, MT);
        ctx.lineTo(ML + d * CW, MT + GH);
        ctx.stroke();
    }

    ctx.fillStyle = '#333';
    ctx.font = '11px Arial';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let m = 0; m < 12; m++) {
        ctx.fillText(monthLabels[m], ML - 6, MT + m * CH + CH / 2);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let d = 0; d < 31; d += 5) {
        ctx.fillText(String(d + 1), ML + d * CW + CW / 2, MT + GH + 4);
    }

    ctx.fillStyle = '#333';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    document.getElementById('zone-heatmap-title').textContent = `Precipitação Média (mm) - Zona ${zone}`;

    // Legenda - escala azul
    const legX = W - 220, legY = H - 20, legW = 160, legH = 12;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '10px Arial';
    ctx.fillStyle = '#333';
    ctx.fillText(`${minVal.toFixed(1)}`, legX - 32, legY);
    ctx.textAlign = 'right';
    ctx.fillText(`${maxVal.toFixed(1)}`, legX + legW + 5, legY);

    const grad = ctx.createLinearGradient(legX, 0, legX + legW, 0);
    grad.addColorStop(0, '#e3f2fd');
    grad.addColorStop(0.25, '#90caf9');
    grad.addColorStop(0.5, '#42a5f5');
    grad.addColorStop(0.75, '#1565c0');
    grad.addColorStop(1, '#0d47a1');
    ctx.fillStyle = grad;
    ctx.fillRect(legX, legY, legW, legH);
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(legX, legY, legW, legH);

    canvas.onmousemove = function(e) {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const col = Math.floor((mx - ML) / CW);
        const row = Math.floor((my - MT) / CH);
        if (col >= 0 && col < 31 && row >= 0 && row < 12) {
            const v = heatData[row][col];
            const text = v !== null && v !== undefined ? `${v.toFixed(2)} mm` : 'Sem dados';
            tooltip.innerHTML = `<strong>${monthLabels[row]}, Dia ${col + 1}:</strong> ${text}`;
            tooltip.style.display = 'block';
            tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
            tooltip.style.top = (e.clientY - rect.top - 36) + 'px';
        } else {
            tooltip.style.display = 'none';
        }
    };
    canvas.onmouseleave = function() {
        tooltip.style.display = 'none';
    };
}

// ============== ANÁLISE COMPLETA DE RISCOS ==============

function updateFullRiskAnalysis() {
    const zone = document.getElementById('zone-select').value;
    updateZoneHistoricalRisk(zone);
    updateCurrentRiskAnalysis(zone);
}

function updateZoneHistoricalRisk(zone) {
    const riskSummary = document.getElementById('risk-summary');

    if (!historicalData || !historicalData.zoneData[zone]) {
        riskSummary.innerHTML = 'Dados históricos indisponíveis';
        return;
    }

    const zoneData = historicalData.zoneData[zone];

    const allPrecip = [];
    for (let m = 1; m <= 12; m++) {
        const monthData = zoneData[m.toString()] || {};
        for (let d = 1; d <= 31; d++) {
            const v = monthData[d.toString()];
            if (v !== null && v !== undefined) allPrecip.push(v);
        }
    }

    if (allPrecip.length === 0) {
        riskSummary.innerHTML = 'Sem dados de precipitação para esta zona';
        return;
    }

    const avgPrecip = allPrecip.reduce((a, b) => a + b, 0) / allPrecip.length;
    const maxPrecip = Math.max(...allPrecip);
    const highRiskDays = allPrecip.filter(v => v > 30).length;
    const mediumRiskDays = allPrecip.filter(v => v > 15 && v <= 30).length;

    let floodRisk = 'baixo';
    let floodColor = '#28a745';
    let floodDescription = '';

    if (maxPrecip > 40) {
        floodRisk = 'ALTO';
        floodColor = '#dc3545';
        floodDescription = 'Histórico de precipitações extremas. Risco significativo de enchentes em períodos chuvosos.';
    } else if (maxPrecip > 25) {
        floodRisk = 'MÉDIO';
        floodColor = '#ffc107';
        floodDescription = 'Histórico com precipitações moderadas a fortes. Possibilidade de alagamentos localizados.';
    } else {
        floodRisk = 'BAIXO';
        floodColor = '#28a745';
        floodDescription = 'Histórico de precipitações dentro da normalidade. Baixo risco de enchentes.';
    }

    if (highRiskDays > 0) {
        floodRisk = 'ALTO';
        floodColor = '#dc3545';
        floodDescription = `Existem ${highRiskDays} dias com registro de precipitação acima de 30mm. Risco elevado de alagamentos e enchentes.`;
    }

    riskSummary.innerHTML = `
        <div class="risk-level" style="background:${floodColor};color:white;">
            ⚠ RISCO DE ENCHENTE: ${floodRisk}
        </div>
        <p>${floodDescription}</p>
        <hr style="margin:12px 0;border:0;border-top:1px solid #eee;">
        <p><strong>📊 Estatísticas da Zona ${zone}:</strong></p>
        <p>🌧 Precipitação média: <strong>${avgPrecip.toFixed(2)} mm</strong></p>
        <p>🔴 Máxima histórica: <strong>${maxPrecip.toFixed(2)} mm</strong></p>
        <p>⚠ Dias de chuva forte (>30mm): <strong>${highRiskDays}</strong></p>
        <p>⚠ Dias de chuva moderada (15-30mm): <strong>${mediumRiskDays}</strong></p>
        <p>📅 Total de medições: <strong>${allPrecip.length}</strong></p>
    `;
}

function updateCurrentRiskAnalysis(zone) {
    const el = document.getElementById('current-conditions-analysis');

    if (!sensorData) {
        el.innerHTML = '<p>Aguardando dados do sensor...</p>';
        return;
    }

    if (!historicalData || !historicalData.zoneData[zone]) {
        el.innerHTML = '<p>Dados históricos indisponíveis para comparação</p>';
        return;
    }

    const zoneData = historicalData.zoneData[zone];

    const allPrecip = [];
    for (let m = 1; m <= 12; m++) {
        const monthData = zoneData[m.toString()] || {};
        for (let d = 1; d <= 31; d++) {
            const v = monthData[d.toString()];
            if (v !== null && v !== undefined) allPrecip.push(v);
        }
    }
    const historicalAvg = allPrecip.length > 0 ? allPrecip.reduce((a, b) => a + b, 0) / allPrecip.length : 0;
    const historicalMax = allPrecip.length > 0 ? Math.max(...allPrecip) : 0;
    const highRiskCount = allPrecip.filter(v => v > 30).length;

    let risk = 'baixo';
    let riskColor = '#28a745';
    let riskMessage = '';
    let recommendations = [];

    const tempLow = sensorData.temperature < 18;
    const tempHigh = sensorData.temperature > 30;
    const humidityHigh = sensorData.humidity > 80;
    const humidityVeryHigh = sensorData.humidity > 90;
    const pressureLow = sensorData.pressure < 1000;
    const pressureVeryLow = sensorData.pressure < 990;
    const historicalHighRisk = highRiskCount > 10;
    const historicalVeryHigh = historicalMax > 50;

    let score = 0;

    if (humidityVeryHigh) score += 3;
    else if (humidityHigh) score += 2;
    else if (sensorData.humidity > 70) score += 1;

    if (pressureVeryLow) score += 3;
    else if (pressureLow) score += 2;

    if (historicalVeryHigh) score += 3;
    else if (historicalMax > 30) score += 2;

    if (tempLow) score += 1;

    if (score >= 6) {
        risk = 'CRÍTICO';
        riskColor = '#dc3545';
        riskMessage = '🚨 Condições ALTAMENTE FAVORÁVEIS para chuvas pesadas e enchentes!';
        recommendations.push('Evitar áreas de risco de alagamento');
        recommendations.push('Ficar atento a alertas da Defesa Civil');
        recommendations.push('Não transitar por ruas alagadas');
    } else if (score >= 4) {
        risk = 'ALTO';
        riskColor = '#fd7e14';
        riskMessage = '⚠️ Condições favoráveis para chuvas fortes. Risco de alagamentos.';
        recommendations.push('Monitorar níveis de água em áreas baixas');
        recommendations.push('Evitar regiões com histórico de enchentes');
        recommendations.push('Não estacionar em locais sujeitos a alagamento');
    } else if (score >= 2) {
        risk = 'MÉDIO';
        riskColor = '#ffc107';
        riskMessage = '⚡ Possibilidade de chuvas moderadas. Fique atento.';
        recommendations.push('Acompanhar a evolução do clima');
        recommendations.push('Verificar previsão do tempo');
    } else {
        risk = 'BAIXO';
        riskColor = '#28a745';
        riskMessage = '✅ Condições atmosféricas estáveis. Baixa probabilidade de chuvas fortes.';
        recommendations.push('Sem riscos imediatos identificados');
    }

    let historicalContext = '';
    if (historicalAvg > 5) {
        historicalContext = `<p style="margin-top:8px;"><strong>Contexto histórico da zona ${zone}:</strong> precipitação média de ${historicalAvg.toFixed(2)}mm/dia. ${highRiskCount} dias com registros acima de 30mm.</p>`;
    }

    el.innerHTML = `
        <div class="risk-level" style="background:${riskColor};color:white;padding:15px;border-radius:8px;margin-bottom:15px;text-align:center;">
            <strong>${riskMessage}</strong>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
            <div style="background:#f8f9fa;padding:10px;border-radius:6px;border-left:4px solid #007bff;">
                <small style="color:#666;">Temperatura</small><br>
                <strong>${sensorData.temperature.toFixed(1)}°C</strong>
                ${tempLow ? '<br><small style="color:#dc3545;">⬇ Abaixo da média</small>' : tempHigh ? '<br><small style="color:#dc3545;">⬆ Acima da média</small>' : ''}
            </div>
            <div style="background:#f8f9fa;padding:10px;border-radius:6px;border-left:4px solid #28a745;">
                <small style="color:#666;">Umidade</small><br>
                <strong>${sensorData.humidity.toFixed(0)}%</strong>
                ${humidityVeryHigh ? '<br><small style="color:#dc3545;">🚨 Muito elevada</small>' : humidityHigh ? '<br><small style="color:#fd7e14;">⬆ Elevada</small>' : ''}
            </div>
            <div style="background:#f8f9fa;padding:10px;border-radius:6px;border-left:4px solid #ffc107;">
                <small style="color:#666;">Pressão</small><br>
                <strong>${sensorData.pressure.toFixed(0)} hPa</strong>
                ${pressureVeryLow ? '<br><small style="color:#dc3545;">🚨 Muito baixa</small>' : pressureLow ? '<br><small style="color:#fd7e14;">⬇ Baixa</small>' : '<br><small style="color:#28a745;">✅ Normal</small>'}
            </div>
            <div style="background:#f8f9fa;padding:10px;border-radius:6px;border-left:4px solid #6f42c1;">
                <small style="color:#666;">Zona Selecionada</small><br>
                <strong>${zone}</strong><br>
                <small>Média histórica: ${historicalAvg.toFixed(1)}mm</small>
            </div>
        </div>
        ${historicalContext}
        <hr style="margin:10px 0;border:0;border-top:1px solid #eee;">
        <div style="margin-top:8px;">
            <strong>📋 Recomendações:</strong>
            <ul style="margin:5px 0 0 15px;">
                ${recommendations.map(r => `<li>${r}</li>`).join('')}
            </ul>
        </div>
    `;
}

// ============== INICIALIZAÇÃO ==============

document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('load-heatmap-btn').addEventListener('click', function() {
        loadHeatmap();
        updateFullRiskAnalysis();
    });

    loadHistoricalData();
    loadSensorData();
    setInterval(loadSensorData, 10000);
});