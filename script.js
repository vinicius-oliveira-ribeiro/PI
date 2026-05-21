const API_URL = '/api/sensor';
const UPDATE_INTERVAL = 5000; // 5 segundos

// Elementos DOM
const temperatureCard = document.getElementById('temperature');
const pressureCard = document.getElementById('pressure');
const humidityCard = document.getElementById('humidity');
const altitudeCard = document.getElementById('altitude');
const statusIndicator = document.getElementById('status');
const lastUpdateElement = document.querySelector('.last-update');

// Função para atualizar os valores na interface
function updateSensorData(data) {
    temperatureCard.querySelector('.value').textContent = `${data.temperature.toFixed(2)} °C`;
    pressureCard.querySelector('.value').textContent = `${data.pressure.toFixed(2)} hPa`;
    humidityCard.querySelector('.value').textContent = `${data.humidity.toFixed(2)} %`;
    altitudeCard.querySelector('.value').textContent = `${data.altitude.toFixed(2)} m`;

    statusIndicator.textContent = 'Conectado';
    statusIndicator.className = 'status-indicator connected';

    const now = new Date();
    lastUpdateElement.textContent = `Última atualização: ${now.toLocaleTimeString('pt-BR')}`;
}

// Função para lidar com erros
function handleError(error) {
    console.error('Erro ao buscar dados do sensor:', error);
    statusIndicator.textContent = 'Erro de conexão';
    statusIndicator.className = 'status-indicator error';
    lastUpdateElement.textContent = 'Última atualização: --';
}

// Função para buscar dados da API
async function fetchSensorData() {
    try {
        statusIndicator.textContent = 'Atualizando...';
        statusIndicator.className = 'status-indicator connecting';

        const response = await fetch(API_URL, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        updateSensorData(data);
    } catch (error) {
        handleError(error);
    }
}

// Função para iniciar o monitoramento
function startMonitoring() {
    // Buscar dados imediatamente
    fetchSensorData();

    // Configurar intervalo para atualizações periódicas
    setInterval(fetchSensorData, UPDATE_INTERVAL);
}

// Iniciar quando a página carregar
document.addEventListener('DOMContentLoaded', startMonitoring);