const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SENSOR_URL = process.env.SENSOR_URL || 'http://192.168.15.39/sensor';

// Middleware
app.use(cors());
app.use(express.static(path.join(__dirname, '.')));

// Rota para proxy da API do sensor (resolve CORS)
app.get('/api/sensor', async (req, res) => {
    try {
        const fetch = (await import('node-fetch')).default;

        const response = await fetch(SENSOR_URL, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Erro ao buscar dados do sensor:', error);
        res.status(500).json({ error: 'Erro ao conectar com o sensor' });
    }
});

// Rota para dados históricos de precipitação
app.get('/api/precipitation', (req, res) => {
    try {
        const dataPath = path.join(__dirname, 'precipitation_data.json');

        if (!fs.existsSync(dataPath)) {
            return res.status(404).json({
                error: 'Dados de precipitação não encontrados. Execute o script generate_precipitation_data.py primeiro.'
            });
        }

        const data = fs.readFileSync(dataPath, 'utf8');
        const precipitationData = JSON.parse(data);

        res.json(precipitationData);
    } catch (error) {
        console.error('Erro ao ler dados de precipitação:', error);
        res.status(500).json({ error: 'Erro ao processar dados de precipitação' });
    }
});

const server = app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
    console.log(`Nova interface: http://localhost:${PORT}/web/`);
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`A porta ${PORT} já está em uso. Se a página abrir em http://localhost:${PORT}/web/, o servidor já está rodando. Caso contrário, defina outra porta com PORT=3001.`);
    } else {
        console.error('Não foi possível iniciar o servidor:', error);
    }
    process.exitCode = 1;
});
