from pathlib import Path
import time

import cv2
import numpy as np
from ultralytics import YOLO


class TrafficSignDetector:
    # CONFIGURAÇÕES
    CONF_THRESHOLD = 0.8
    DETECT_INTERVAL = 5          # roda YOLO a cada N frames
    STOP_WAIT_SECONDS = 3.0      # mantém STOP ativo por N segundos
    COOLDOWN_SECONDS = 3.0       # espera N segundos antes de reativar STOP
    LIGHT_TIMEOUT = 2.0          # segundos sem ver semáforo

    # Critérios para considerar uma placa de PARE válida
    MIN_STOP_CONF = .8
    MIN_STOP_AREA = 1500         # pixels²

    # CORES DOS SEMÁFOROS
    LIGHT_TO_CODE = {"Vermelho": 0, "Amarelo": 1, "Verde": 2}
    LIGHT_TO_BGR = {
        "Vermelho": (0, 0, 255),
        "Amarelo": (0, 255, 255),
        "Verde": (0, 255, 0),
    }

    # Cores das placas
    STOP_VALID_COLOR = (0, 165, 255)       # laranja forte
    STOP_INVALID_COLOR = (0, 80, 150)      # laranja fraco
    OTHER_SIGN_COLOR = (0, 165, 255)


    def __init__(self, model_path: str, conf_threshold: float = None):
        self._model = None
        self._boxes = []
        self._counter = 0

        # Se não passar confiança, usa CONF_THRESHOLD
        if conf_threshold is None:
            conf_threshold = self.CONF_THRESHOLD
        self._conf = max(0.0, min(1.0, conf_threshold))

        # Estado da placa STOP
        self._stop_until = 0.0
        self._cooldown_until = 0.0
        self.stop_active = False

        # Estado do semáforo
        self._light_code = -1
        self._light_last_seen = 0.0

        try:
            p = Path(model_path)
            if p.exists():
                self._model = YOLO(str(p))
                print(f"[Sinais] Modelo carregado: {p.name}")
            else:
                print(f"[Sinais] Modelo nao encontrado: {p}")
        except ImportError:
            print("[Sinais] ultralytics nao instalado: pip install ultralytics")


    def update(self, frame) -> list:
        """
        Chame 1x por frame.
        Roda inferência a cada DETECT_INTERVAL frames.
        """
        self._counter += 1
        if self._counter >= self.DETECT_INTERVAL:
            self._counter = 0
            # Executa YOLO
            self._boxes = self._predict(frame) if self._model else []

            # TIMER DO STOP
            now = time.time()
            if self.stop_active and now >= self._stop_until:
                self.stop_active = False
                self._cooldown_until = now + self.COOLDOWN_SECONDS

            # SEMÁFORO
            self._update_traffic_light(frame)

        return self._boxes


    def draw(self, img) -> None:
        for x1, y1, x2, y2, label, conf in self._boxes:
            lbl = label.lower()

            # SEMÁFORO
            if "semaforo" in lbl or "light" in lbl:
                color_name = self._code_to_name(self._light_code)
                box_color = self.LIGHT_TO_BGR.get(color_name, (200, 200, 200))
                thickness = 2
            # PLACA DE PARE
            elif "pare" in lbl:
                valid = self._is_valid_stop(x1, y1, x2, y2, conf)
                if valid:
                    # PARE VÁLIDA
                    box_color = self.STOP_VALID_COLOR
                    thickness = 2
                else:
                    # PARE INVÁLIDA
                    box_color = self.STOP_INVALID_COLOR
                    thickness = 2
            # OUTRAS PLACAS
            else:
                box_color = self.OTHER_SIGN_COLOR
                thickness = 2

            # DESENHA CAIXA
            cv2.rectangle(img, (x1, y1), (x2, y2), box_color, thickness)
            # TEXTO
            cv2.putText(img, f"{label} {conf:.2f}", (x1, max(y1 - 6, 10)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, box_color, 1)

    # YOLO
    def _predict(self, frame) -> list:
        out = []
        for r in self._model.predict(frame, verbose=False, conf=self._conf):
            for box in r.boxes:
                x1, y1, x2, y2 = (int(v) for v in box.xyxy[0])
                label = r.names[int(box.cls[0])]
                conf = float(box.conf[0])
                out.append((x1, y1, x2, y2, label, conf))
        return out


    # ── SEMÁFORO ──────────────────────────────────────────────────────────────
    def _find_traffic_light_box(self):
        """
        Retorna a caixa do semáforo
        com maior confiança.
        """
        best = None
        for x1, y1, x2, y2, label, conf in self._boxes:
            lbl = label.lower()
            if "semaforo" in lbl or "light" in lbl:
                if best is None or conf > best[5]:
                    best = (x1, y1, x2, y2, label, conf)
        return best


    def _update_traffic_light(self, frame):
        box = self._find_traffic_light_box()
        if box is not None:
            x1, y1, x2, y2, *_ = box
            # Limita coordenadas ao frame
            x1 = max(0, x1)
            y1 = max(0, y1)
            x2 = min(frame.shape[1], x2)
            y2 = min(frame.shape[0], y2)
            crop = frame[y1:y2, x1:x2]
            if crop.size > 0:
                color_name = self.classify_traffic_light(crop)
                self._light_code = self.LIGHT_TO_CODE[color_name]
                self._light_last_seen = time.time()

        # TIMEOUT
        if time.time() - self._light_last_seen > self.LIGHT_TIMEOUT:
            self._light_code = -1


    def classify_traffic_light(self, frame) -> str:
        """
        Analisa o frame recortado no semáforo
        e retorna a cor ativa.
        """
        filtered_frame = self.apply_filter(frame)
        height = filtered_frame.shape[0]
        colors = ["Vermelho", "Amarelo", "Verde"]
        means = [
            np.mean(filtered_frame[int(height * i / 3):int(height * (i + 1) / 3), :])
            for i in range(3)
        ]
        return colors[np.argmax(means)]


    def apply_filter(self, frame, limiar=140):
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        blur = cv2.GaussianBlur(gray, (15, 15), 0)
        applied_limiar = np.zeros_like(blur)
        applied_limiar[blur > limiar] = blur[blur > limiar]
        return applied_limiar


    def get_light_state(self) -> int:
        """
        -1 = nenhum semáforo
         0 = vermelho
         1 = amarelo
         2 = verde
        """
        return self._light_code

    @staticmethod
    def _code_to_name(code: int):
        return {0: "Vermelho", 1: "Amarelo", 2: "Verde"}.get(code)


    # ── STOP ──────────────────────────────────────────────────────────────
    def _is_valid_stop(self, x1, y1, x2, y2, conf):
        width = x2 - x1
        height = y2 - y1
        area = width * height
        # Verifica confiança
        if conf < self.MIN_STOP_CONF:
            return False
        # Verifica tamanho
        if area < self.MIN_STOP_AREA:
            return False
        return True

    def get_state(self):
        raw_stop = False
        for x1, y1, x2, y2, label, conf in self._boxes:
            if "pare" in label.lower():
                # Verifica confiança + tamanho
                if self._is_valid_stop(x1, y1, x2, y2, conf):
                    raw_stop = True
                    break

        # ATIVA STOP
        now = time.time()
        if raw_stop and not self.stop_active and now >= self._cooldown_until:
            self._stop_until = now + self.STOP_WAIT_SECONDS
            self.stop_active = True
            # print("[Sinais] STOP ativado!")

        return self.stop_active