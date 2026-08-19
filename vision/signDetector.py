from pathlib import Path
import time

import cv2
import numpy as np
from ultralytics import YOLO


class SignDetector:
    CONF_THRESHOLD   = 0.8
    DETECT_INTERVAL  = 5     # roda YOLO a cada N frames
    STOP_WAIT_FRAMES = 90    # mantém STOP ativo ~3 s após ver a placa
    COOLDOWN_FRAMES  = 90    # espera antes de reativar STOP
    LIGHT_TIMEOUT    = 2.0   # segundos sem ver semáforo até o estado voltar pra -1

    # Mapeamento cor -> número e cor -> BGR (pra desenhar)
    LIGHT_TO_CODE = {"Vermelho": 0, "Amarelo": 1, "Verde": 2}
    LIGHT_TO_BGR  = {
        "Vermelho": (0, 0, 255),
        "Amarelo":  (0, 255, 255),
        "Verde":    (0, 255, 0),
    }

    def __init__(self, model_path: str, conf_threshold: float = 0.4):
        self._model       = None
        self._boxes: list = []
        self._counter     = 0
        self._conf        = max(0.0, min(1.0, conf_threshold))

        self.stop_timer     = 0
        self.cooldown_timer = 0
        self.stop_active    = False

        self._light_code      = -1   # -1, 0, 1 ou 2
        self._light_last_seen = 0.0  # timestamp da última vez que viu um semáforo

        try:
            p = Path(model_path)
            if p.exists():
                self._model = YOLO(str(p))
                print(f"[Sinais] Modelo carregado: {p.name}")
            else:
                print(f"[Sinais] Modelo nao encontrado: {p}")
        except ImportError:
            print("[Sinais] ultralytics nao instalado: pip install ultralytics==8.3.5")

    def update(self, frame) -> list:
        """Chame 1x por frame. Roda inferência a cada DETECT_INTERVAL frames."""

        self._counter += 1
        if self._counter >= self.DETECT_INTERVAL:
            self._counter = 0
            self._boxes = self._predict(frame) if self._model else []

            if self.stop_timer > 0:
                self.stop_timer -= 1
                if self.stop_timer == 0:
                    self.stop_active = False
                    self.cooldown_timer = self.COOLDOWN_FRAMES
                    #print("[Sinais] STOP finalizado -> cooldown iniciado")
            elif self.cooldown_timer > 0:
                self.cooldown_timer -= 1
                if self.cooldown_timer == 0:
                    #print("[Sinais] Cooldown encerrado")
                    pass

            self._update_traffic_light(frame)

        return self._boxes

    def draw(self, img) -> None:
        for x1, y1, x2, y2, label, conf in self._boxes:
            lbl = label.lower()

            if "semaforo" in lbl or "light" in lbl:
                # Colore a caixa do semáforo de acordo com a cor identificada
                color_name = self._code_to_name(self._light_code)
                box_color = self.LIGHT_TO_BGR.get(color_name, (200, 200, 200))
            else:
                box_color = (0, 165, 255)

            cv2.rectangle(img, (x1, y1), (x2, y2), box_color, 2)
            cv2.putText(img, f"{label} {conf:.2f}", (x1, max(y1 - 6, 10)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, box_color, 1)

    def _predict(self, frame) -> list:
        out = []
        for r in self._model.predict(frame, verbose=False, conf=self._conf):
            for box in r.boxes:
                x1, y1, x2, y2 = (int(v) for v in box.xyxy[0])
                label = r.names[int(box.cls[0])]
                conf  = float(box.conf[0])
                out.append((x1, y1, x2, y2, label, conf))
        return out

    # ── Semáforo ──────────────────────────────────────────────────────────

    def _find_traffic_light_box(self):
        """Retorna a caixa do semáforo com maior confiança, ou None se não houver."""
        best = None
        for x1, y1, x2, y2, label, conf in self._boxes:
            lbl = label.lower()
            if "semaforo" in lbl or "light" in lbl:
                if best is None or conf > best[5]:
                    best = (x1, y1, x2, y2, label, conf)
        return best

    def _update_traffic_light(self, frame) -> None:
        box = self._find_traffic_light_box()

        if box is not None:
            x1, y1, x2, y2, *_ = box
            x1, y1 = max(0, x1), max(0, y1)
            x2, y2 = min(frame.shape[1], x2), min(frame.shape[0], y2)
            crop = frame[y1:y2, x1:x2]

            if crop.size > 0:
                color_name = self.classify_traffic_light(crop)
                self._light_code = self.LIGHT_TO_CODE[color_name]
                self._light_last_seen = time.time()

        # Se ficou LIGHT_TIMEOUT segundos sem ver nenhum semáforo, reseta pra -1
        if time.time() - self._light_last_seen > self.LIGHT_TIMEOUT:
            self._light_code = -1

    def classify_traffic_light(self, frame) -> str:
        """Analisa o frame (recortado no semáforo) e retorna a cor ativa."""
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
        """-1 = nenhum semáforo, 0 = vermelho, 1 = amarelo, 2 = verde."""
        return self._light_code

    @staticmethod
    def _code_to_name(code: int):
        return {0: "Vermelho", 1: "Amarelo", 2: "Verde"}.get(code)

    # ── STOP ──────────────────────────────────────────────────────────────

    def get_state(self):
        raw_stop = False

        for *_, label, _ in self._boxes:
            if "pare" in label.lower():
                raw_stop = True
                break

        if raw_stop and self.stop_timer == 0 and self.cooldown_timer == 0:
            self.stop_timer = self.STOP_WAIT_FRAMES
            self.stop_active = True
            #print("[Sinais] STOP ativado!")

        return self.stop_active