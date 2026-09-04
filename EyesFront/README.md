# AutoCar Front (Olhos)

Modulo visual dos "olhos" do carro, rodando localmente e integrado ao server.

## Runtime local

- URL local: `http://127.0.0.1:8010`
- API consumida: `http://127.0.0.1:8000/api/emotions`
- Nao usa endpoint remoto.

## Endpoints usados

- `GET /api/emotions` (polling do estado atual)
- `GET /api/emotions/{emotion}` (suporte individual)
- `PUT /api/emotions/{emotion}` (ACK para limpar animacao one-shot)

## Mapeamento de animacoes (telemetria -> olhos)

- `squint`: STOP ou sinal vermelho.
- `accelerate`: velocidade alta (proxima da maxima configurada).
- `surprise`: pessoa/objeto muito proximo ou colisao.
- `fright`: sensores estavam livres e detectaram obstaculo muito proximo de repente.

## Arquivos principais

- `src/core/FaceEngine.js`
- `src/utils/api.js`
- `src/utils/apiConfig.js`
- `src/config/faceConfig.json`

## Observacoes

- Polling de emocoes em tempo real (intervalo curto).
- O modulo e iniciado automaticamente pelo `server.py` junto com API e Twin.
