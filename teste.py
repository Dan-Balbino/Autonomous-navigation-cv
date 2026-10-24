"""
Ponte servidor -> ESP32: lê /api/vehicle_info (o mesmo que o painel JS lê) e manda pela serial,
um JSON por linha, só com os campos que o painel usa. Não precisa mudar nada no main.py.

Tudo pelo cabo USB: o main.py e esta ponte rodam no mesmo PC (a API é lida em 127.0.0.1),
sem Wi-Fi nem outro sinal sem fio.

    pip install pyserial
    python tools/serial_bridge.py                              # acha a porta do ESP32 sozinha
    python tools/serial_bridge.py --port COM5                  # ou fixa a porta

Se preferir mandar direto do main.py, use send_vehicle_info(ser, vehicle_info) abaixo.
"""
import argparse
import json
import time
import urllib.request

import serial  # pyserial

HUD_KEYS = ('route', 'route_list', 'running', 'speed', 'servo', 'traffic_light_code', 'stop_active',
            'right_detour_active', 'control_mode')
COMMAND_KEYS = ('run', 'speed', 'servo', 'stop', 'mission_state')
TELEMETRY_KEYS = ('speed', 'battery', 'battery_state', 'run_button', 'run_button_presses',
                  'left', 'f_left', 'f_right', 'right')


def compact(info):
    """Só o que o painel usa (linha curta = cabe folgado em 115200 baud a 5 Hz)."""
    def pick(obj, keys):
        obj = obj if isinstance(obj, dict) else {}
        return {k: obj[k] for k in keys if k in obj}
    out = {
        'hud': pick(info.get('hud'), HUD_KEYS),
        'command': pick(info.get('command'), COMMAND_KEYS),
        'telemetry': pick(info.get('telemetry'), TELEMETRY_KEYS),
        'time': time.strftime('%H:%M'),
    }
    if '_ts' in info:
        out['_ts'] = info['_ts']
    if not info.get('hud'):
        del out['hud']   # sem hud = "aguardando o carro" no painel
    return out


def send_vehicle_info(ser, info):
    line = json.dumps(compact(info), ensure_ascii=False, separators=(',', ':'))
    ser.write(line.encode('utf-8') + b'\n')


# Chips USB-serial das placas ESP32: CP210x, CH340/CH9102, FTDI e o USB nativo da Espressif
ESP32_USB_VIDS = {0x10C4, 0x1A86, 0x0403, 0x303A}


def find_esp32_port():
    """Porta do ESP32 pelo chip USB (sem precisar dizer COM5). None se não achou nenhuma."""
    from serial.tools import list_ports
    ports = [p for p in list_ports.comports() if p.vid in ESP32_USB_VIDS]
    return ports[0].device if ports else None


def open_port(port, baud):
    """Abre a porta (a fixa ou a que achar); espera o cabo aparecer, sem desistir."""
    warned = False
    while True:
        device = port or find_esp32_port()
        if device:
            try:
                ser = serial.Serial(device, baud, timeout=0)
                time.sleep(2)   # o ESP32 reinicia quando a porta abre
                print(f'ESP32 em {device} @ {baud}')
                return ser
            except serial.SerialException as error:
                print(f'não abriu {device}: {error}')
        elif not warned:
            print('ESP32 não encontrado: ligue o cabo USB do painel (procurando...)')
            warned = True
        time.sleep(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--port', help='porta serial do ESP32 (COM5, /dev/ttyUSB0...); sem ela, acha sozinha')
    parser.add_argument('--baud', type=int, default=115200)
    parser.add_argument('--api', default='http://127.0.0.1:5000/api', help='base da API do carro (neste PC)')
    parser.add_argument('--hz', type=float, default=5.0, help='mensagens por segundo (o painel JS usa 5)')
    args = parser.parse_args()

    url = args.api.rstrip('/') + '/vehicle_info'
    period = 1.0 / args.hz
    ser = open_port(args.port, args.baud)
    print(f'{url} -> {ser.port} ({args.hz:g} Hz). Ctrl+C para sair.')
    while True:
        started = time.monotonic()
        try:
            try:
                with urllib.request.urlopen(url, timeout=1.5) as response:
                    send_vehicle_info(ser, json.loads(response.read().decode('utf-8')))
            except (OSError, ValueError) as error:
                if isinstance(error, serial.SerialException):
                    raise
                # main.py fora: o painel mostra "Sem sinal" sozinho depois de 3 s
                print('sem dados:', error)
            # mostra o que o ESP32 escrever (memória livre, avisos)
            incoming = ser.read(ser.in_waiting or 0)
            if incoming:
                print(incoming.decode('utf-8', 'replace'), end='')
        except serial.SerialException:
            # cabo puxado: espera ele voltar e continua
            print('cabo do ESP32 desconectado; esperando...')
            ser.close()
            ser = open_port(args.port, args.baud)
        time.sleep(max(0.0, period - (time.monotonic() - started)))


if __name__ == '__main__':
    main()