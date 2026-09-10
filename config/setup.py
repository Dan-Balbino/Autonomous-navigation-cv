import ctypes
import cv2

try:
    ctypes.windll.kernel32.SetConsoleMode(
        ctypes.windll.kernel32.GetStdHandle(-11), 7
    )
except Exception:
    pass
_G  = "\033[92m"   # verde
_Y  = "\033[93m"   # amarelo
_C  = "\033[96m"   # ciano
_R  = "\033[91m"   # vermelho
_B  = "\033[1m"    # negrito
_RS = "\033[0m"    # reset


def scan_usb_devices() -> list[int]:
    """Imprime todos os dispositivos USB detectados (câmeras e seriais) e retorna índices de câmera."""
    from serial.tools import list_ports

    print(f"\n{_C}{_B}[USB]{_RS} Dispositivos detectados:")

    ports = list(list_ports.comports())
    for p in ports:
        desc = p.description if (p.description and p.description != p.device) else "dispositivo USB"
        mfr  = (p.manufacturer or "").lower()
        is_arduino = "arduino" in desc.lower() or "arduino" in mfr
        kind = f"{_G}Arduino{_RS}" if is_arduino else f"{_Y}Serial/USB{_RS}"
        print(f"  {kind}  {_B}{p.device}{_RS}  —  {desc}")

    cam_indices: list[int] = []
    for idx in range(3):
        c = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
        if c.isOpened() and c.read()[0]:
            cam_indices.append(idx)
            print(f"  {_G}Camera{_RS}   índice {_B}{idx}{_RS}  —  câmera de vídeo")
        c.release()

    if not ports and not cam_indices:
        print(f"  {_Y}Nenhum dispositivo USB encontrado{_RS}")
    print()
    return cam_indices


def select_com() -> str:
    from serial.tools import list_ports
    ports = list(list_ports.comports())
    if not ports:
        raw = input(f"{_Y}{_B}[COM]{_RS} Nenhuma porta detectada. Digite manualmente ou Enter para modo teste: ").strip()
        if not raw:
            print(f"{_G}{_B}[COM]{_RS} Modo teste — sem Arduino")
            return None
        return raw
    print(f"{_C}{_B}[COM]{_RS} Portas detectadas:")
    for i, p in enumerate(ports):
        desc = p.description if (p.description and p.description != p.device) else "dispositivo USB"
        print(f"  {_C}[{i}]{_RS} {_B}{p.device}{_RS}  —  {desc}")
    print(f"  {_C}[t]{_RS} Modo teste (sem Arduino)")
    raw = input(f"{_Y}{_B}[COM]{_RS} Escolha o número (0-{len(ports)-1}) ou 't': ").strip().lower()
    if raw == "t":
        print(f"{_G}{_B}[COM]{_RS} Modo teste — sem Arduino")
        return None
    try:
        chosen = ports[int(raw)].device
    except (ValueError, IndexError):
        chosen = ports[0].device
        print(f"{_Y}{_B}[COM]{_RS} Entrada inválida, usando {_G}{chosen}{_RS}")
    print(f"{_G}{_B}[COM]{_RS} Usando: {_G}{_B}{chosen}{_RS}")
    return chosen


def open_camera(cam_indices: list[int]) -> tuple[cv2.VideoCapture, int, cv2.VideoCapture, int]:
    """Abre a(s) câmera(s) disponível(is).

    - 1 câmera disponível: usada como primária e secundária (mesma instância).
    - 2 câmeras disponíveis: maior índice = primária, menor = secundária.
    - Mais de 2 câmeras: lista os índices e pede pra escolher primária e secundária.
    """
    if not cam_indices:
        print(f"{_R}{_B}[ERRO]{_RS} Nenhuma câmera disponível.")
        exit()

    def _abrir(idx: int) -> cv2.VideoCapture | None:
        c = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
        if c.isOpened() and c.read()[0]:
            return c
        c.release()
        return None

    indices_ordenados = sorted(cam_indices, reverse=True)

    # caso 1: só uma câmera existe -> retorna ela duas vezes
    if len(indices_ordenados) == 1:
        idx = indices_ordenados[0]
        cam = _abrir(idx)
        if cam is None:
            print(f"{_R}{_B}[ERRO]{_RS} Nenhuma câmera disponível.")
            exit()
        print(f"{_G}{_B}[CAM]{_RS} Única câmera disponível, aberta no índice {_G}{_B}{idx}{_RS}")
        return cam, idx, cam, idx

    # caso 2: exatamente duas câmeras, maior índice = primária
    if len(indices_ordenados) == 2:
        idx_primaria, idx_secundaria = indices_ordenados
        cam_primaria = _abrir(idx_primaria)
        cam_secundaria = _abrir(idx_secundaria)
        if cam_primaria is None:
            print(f"{_R}{_B}[ERRO]{_RS} Não foi possível abrir a câmera primária ({idx_primaria}).")
            exit()
        print(f"{_G}{_B}[CAM]{_RS} Primária: índice {_G}{_B}{idx_primaria}{_RS} | Secundária: índice {_G}{_B}{idx_secundaria}{_RS}")
        return cam_primaria, idx_primaria, cam_secundaria, idx_secundaria

    # caso 3: mais de duas câmeras, pede pra escolher
    print(f"{_G}{_B}[CAM]{_RS} {len(indices_ordenados)} câmeras detectadas:")
    for idx in indices_ordenados:
        print(f"  [{idx}]")

    def _perguntar(rotulo: str, excluir: int | None = None) -> int:
        while True:
            entrada = input(f"Escolha o índice da câmera {rotulo}: ").strip()
            if not entrada.isdigit():
                print("Digite um número válido.")
                continue
            idx = int(entrada)
            if idx not in indices_ordenados:
                print("Índice fora da lista de câmeras detectadas.")
                continue
            if idx == excluir:
                print("Essa câmera já foi escolhida como primária.")
                continue
            return idx

    idx_primaria = _perguntar("primária")
    idx_secundaria = _perguntar("secundária", excluir=idx_primaria)

    cam_primaria = _abrir(idx_primaria)
    cam_secundaria = _abrir(idx_secundaria)

    if cam_primaria is None:
        print(f"{_R}{_B}[ERRO]{_RS} Não foi possível abrir a câmera primária ({idx_primaria}).")
        exit()

    print(f"{_G}{_B}[CAM]{_RS} Primária: índice {_G}{_B}{idx_primaria}{_RS} | Secundária: índice {_G}{_B}{idx_secundaria}{_RS}")
    return cam_primaria, idx_primaria, cam_secundaria, idx_secundaria
    
    
def allow_dashboard_firewall_rule(dashboard_port):
    try:
        import subprocess
        subprocess.run([
            "netsh", "advfirewall", "firewall", "add", "rule",
            f"name=AutoCar-Dashboard-{dashboard_port}",
            "dir=in", "action=allow", "protocol=TCP",
            f"localport={dashboard_port}",
        ], capture_output=True, check=False, timeout=5)
    except Exception:
        pass