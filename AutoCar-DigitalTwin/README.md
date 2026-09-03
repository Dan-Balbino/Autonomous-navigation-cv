# AutoCar Digital Twin

Painel digital local do carro com sensores, velocimetro e estado de luz.

## Runtime local

- URL local: `http://127.0.0.1:8011`
- API consumida: `http://127.0.0.1:8000/api/dashboard`
- Nao usa endpoint remoto.

## Fonte dos dados

- Velocidade: calculada no server a partir de `rpm_rodas` reais.
- Sensores digitais: mapeados de `sensor1..sensor5` reais.
- Farol: lido de `ai_commands.light_on`.
- Rotacao do dashboard (`tabDashboard_rotate`): vem da serial/Bluetooth (Arduino). Nao vem de configuracao fixa.

## Endpoint esperado

`GET /api/dashboard`

Resposta:

```json
{
  "success": true,
  "data": {
    "tabDashboard_rpm": 123,
    "tabDashboard_speed_ms": 3.45,
    "tabDashboard_light": true,
    "tabDashboard_rotate": false,
    "tabDashboard_sensor_1": 80,
    "tabDashboard_sensor_2": 75,
    "tabDashboard_sensor_3": 60,
    "tabDashboard_sensor_4": 58,
    "tabDashboard_sensor_5": 120
  }
}
```

## Arquivos principais

- `src/js/main.js`
- `src/js/modules/speedometerManager.js`
- `src/js/modules/proximityWaves.js`
- `src/config/proximity-config.json`

## Observacoes

- O Twin e iniciado automaticamente pelo `server.py` em porta separada.
- O modo vertical/horizontal segue apenas o valor serial `tabDashboard_rotate`.
