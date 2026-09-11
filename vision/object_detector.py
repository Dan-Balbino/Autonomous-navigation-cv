from pathlib import Path
import time

import cv2
import numpy as np


class ObjectDetector:
    # CONFIGURAÇÕES
    """Detecta sinais de trânsito, semáforos e pessoas em frames da câmera."""

    CONF_THRESHOLD = 0.1
    DISPLAY_CONF_THRESHOLD = 0.1
    PERSON_CONF_THRESHOLD = 0.5
    PERSON_INFERENCE_CONF_THRESHOLD = 0.01
    PERSON_CLASS_ID = 0  # Classe person no modelo COCO
    DETECT_INTERVAL = 5
    STOP_WAIT_SECONDS = 3.0
    COOLDOWN_SECONDS = 3.0
    LIGHT_TIMEOUT = 2.0

    MIN_STOP_CONF = 0.8
    MIN_STOP_AREA = 1500

    # CORES DOS SEMÁFOROS
    LIGHT_TO_CODE = {"Vermelho": 0, "Amarelo": 1, "Verde": 2}
    LIGHT_TO_BGR = {
        "Vermelho": (0, 0, 255),
        "Amarelo": (0, 255, 255),
        "Verde": (0, 255, 0),
    }

    INVALID_COLOR = (200, 200, 200)         # Branco para detecções inválidas
    STOP_VALID_COLOR = (0, 165, 255)       # Laranja forte
    PERSON_VALID_COLOR = (255, 0, 0)       # Azul
    PERSON_INVALID_COLOR = INVALID_COLOR
    RIGHT_DETOUR_VALID_COLOR = (153, 255, 180) # Verde claro para placa de desvio válida
    TRAFFIC_LIGHT_LABELS = ("semaforo", "semáforo", "light")
    RIGHT_DETOUR_LABELS = ("desvio_direita",)

    MIN_RIGHT_DETOUR_CONF = 0.1
    RIGHT_DETOUR_REQUIRED_FRAMES = 3


    def __init__(self, model_path: str, conf_threshold: float = None):
        self._traffic_signs_model = None                # Modelo customizado para sinais de trânsito
        self._standard_model_path = Path(__file__).resolve().parents[1] / "model" / "yolov8n.pt"
        self._yolo_standard_model = None
        self._traffic_signs_model_path = str(model_path)
        self._boxes = []
        self._person_boxes = []
        self._counter = 0

        # Se não passar confiança, usa CONF_THRESHOLD
        if conf_threshold is None:
            conf_threshold = self.CONF_THRESHOLD
        self._conf = max(0.0, min(1.0, conf_threshold))
        self._min_stop_diagonal = 0
        self._min_light_diagonal = 0
        self._min_light_confidence = 0.0
        self._min_person_diagonal = 0
        self._min_right_detour_diagonal = 0
        self._right_detour_frames_seen = 0
        self._right_detour_is_valid = False

        # Estado da placa STOP
        self._stop_until = 0.0
        self._cooldown_until = 0.0
        self.stop_active = False

        # Estado do semáforo
        self._light_code = -1
        self._light_last_seen = 0.0

        p = Path(self._traffic_signs_model_path)
        if p.exists():
            print(f"[Sinais] Modelo pronto para carregamento lazy: {p.name}")
        else:
            print(f"[Sinais] Modelo nao encontrado: {p}")

    def configure(self, *, stop_confidence=None, min_stop_diagonal=None,
                  stop_wait_seconds=None, cooldown_seconds=None,
                  light_timeout_seconds=None, detect_interval=None,
                  min_light_diagonal=None, light_confidence=None,
                  person_confidence=None, min_person_diagonal=None,
                  right_detour_confidence=None,
                  min_right_detour_diagonal=None,
                  right_detour_required_frames=None):
        """Atualiza os parâmetros de detecção em tempo real.

        As atribuições são escalares e podem ser feitas pelo loop de controle
        enquanto a thread de inferência processa o próximo frame.
        """
        if stop_confidence is not None:
            self.MIN_STOP_CONF = max(0.0, min(1.0, float(stop_confidence)))
        if min_stop_diagonal is not None:
            self._min_stop_diagonal = max(0, int(min_stop_diagonal))
        if stop_wait_seconds is not None:
            self.STOP_WAIT_SECONDS = max(0.0, float(stop_wait_seconds))
        if cooldown_seconds is not None:
            self.COOLDOWN_SECONDS = max(0.0, float(cooldown_seconds))
        if light_timeout_seconds is not None:
            self.LIGHT_TIMEOUT = max(0.0, float(light_timeout_seconds))
        if detect_interval is not None:
            self.DETECT_INTERVAL = max(1, int(detect_interval))
        if min_light_diagonal is not None:
            self._min_light_diagonal = max(0, int(min_light_diagonal))
        if light_confidence is not None:
            self._min_light_confidence = max(0.0, min(1.0, float(light_confidence)))
        if person_confidence is not None:
            self.PERSON_CONF_THRESHOLD = max(0.0, min(1.0, float(person_confidence)))
        if min_person_diagonal is not None:
            self._min_person_diagonal = max(0, int(min_person_diagonal))
        if right_detour_confidence is not None:
            self.MIN_RIGHT_DETOUR_CONF = max(0.0, min(1.0, float(right_detour_confidence)))
        if min_right_detour_diagonal is not None:
            self._min_right_detour_diagonal = max(0, int(min_right_detour_diagonal))
        if right_detour_required_frames is not None:
            self.RIGHT_DETOUR_REQUIRED_FRAMES = max(1, int(right_detour_required_frames))


    def update(self, frame) -> list:
        """Atualiza as detecções; a inferência ocorre a cada N frames."""
        self._counter += 1
        if self._counter < self.DETECT_INTERVAL:
            return self._boxes

        self._counter = 0
        self._boxes = self._predict(frame)
        self._person_boxes = self._predict_people(frame)
        self._update_traffic_light(frame)
        self._update_right_detour_state()

        return self._boxes


    def draw(self, img) -> None:
        for x1, y1, x2, y2, conf in self._person_boxes:
            if conf < self.DISPLAY_CONF_THRESHOLD:
                continue
            color = (self.PERSON_VALID_COLOR
                     if self._is_valid_person(x1, y1, x2, y2, conf)
                     else self.PERSON_INVALID_COLOR)
            self._draw_box(img, x1, y1, x2, y2, "Pessoa", conf, color)

        for x1, y1, x2, y2, label, conf in self._boxes:
            if conf < self.DISPLAY_CONF_THRESHOLD:
                continue
            lbl = label.lower()
            if self._is_traffic_light_label(lbl):
                color_name = self._code_to_name(self._light_code)
                color = self.LIGHT_TO_BGR.get(color_name, self.INVALID_COLOR)
            elif self._is_stop_label(lbl):
                color = (self.STOP_VALID_COLOR
                         if self._is_valid_stop(x1, y1, x2, y2, conf)
                         else self.INVALID_COLOR)
            elif self._is_right_detour_label(lbl):
                color = (self.RIGHT_DETOUR_VALID_COLOR
                         if self._is_valid_right_detour(x1, y1, x2, y2, conf)
                         else self.INVALID_COLOR)
            else:
                continue
            self._draw_box(img, x1, y1, x2, y2, label, conf, color)

    @staticmethod
    def _draw_box(img, x1, y1, x2, y2, label, confidence, color) -> None:
        cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
        cv2.putText(
            img,
            f"{label} {confidence:.2f}",
            (x1, max(y1 - 6, 10)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            color,
            1,
        )

    def _get_traffic_signs_model(self):
        if self._traffic_signs_model is not None:
            return self._traffic_signs_model

        try:
            from ultralytics import YOLO
        except ImportError:
            print("[Sinais] ultralytics nao instalado: pip install ultralytics")
            return None

        p = Path(self._traffic_signs_model_path)
        if not p.exists():
            print(f"[Sinais] Modelo nao encontrado: {p}")
            return None

        self._traffic_signs_model = YOLO(str(p))
        print(f"[Sinais] Modelo carregado: {p.name}")
        return self._traffic_signs_model

    def _get_standard_model(self):
        if self._yolo_standard_model is not None:
            return self._yolo_standard_model

        try:
            from ultralytics import YOLO
        except ImportError:
            print("[Sinais] ultralytics nao instalado: pip install ultralytics")
            return None

        self._yolo_standard_model = YOLO(str(self._standard_model_path))
        return self._yolo_standard_model

    # YOLO
    def _predict(self, frame) -> list:
        model = self._get_traffic_signs_model()
        if model is None:
            return []

        best_by_label = {}
        for r in model.predict(frame, verbose=False, conf=self._conf):
            for box in r.boxes:
                x1, y1, x2, y2 = (int(v) for v in box.xyxy[0])
                label = r.names[int(box.cls[0])]
                conf = float(box.conf[0])
                normalized = label.lower().strip().replace("-", "_").replace(" ", "_")
                if (self._is_traffic_light_label(normalized)
                    or self._is_stop_label(normalized)
                    or self._is_right_detour_label(normalized)):
                    key = normalized
                    current = best_by_label.get(key)
                    if current is None or conf > current[5]:
                        best_by_label[key] = (x1, y1, x2, y2, label, conf)
        return list(best_by_label.values())


    def _predict_people(self, frame) -> list:
        """Detecta somente pessoas usando o modelo YOLO padrão."""
        model = self._get_standard_model()
        if model is None:
            return []

        people = []
        for result in model.predict(
            frame,
            verbose=False,
            conf=self.PERSON_INFERENCE_CONF_THRESHOLD,
            classes=[self.PERSON_CLASS_ID],
        ):
            for box in result.boxes:
                if int(box.cls[0]) != self.PERSON_CLASS_ID:
                    continue
                x1, y1, x2, y2 = (int(value) for value in box.xyxy[0])
                conf = float(box.conf[0])
                people.append((x1, y1, x2, y2, conf))
        return people


    def _is_valid_person(self, x1, y1, x2, y2, conf) -> bool:
        """Verifica confiança e tamanho mínimo da caixa de uma pessoa."""
        if conf < self.PERSON_CONF_THRESHOLD:
            return False
        diagonal = ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
        return diagonal >= self._min_person_diagonal


    def get_person_boxes(self) -> list:
        """Retorna as caixas de pessoas da última inferência."""
        return list(self._person_boxes)


    # ── SEMÁFORO ──────────────────────────────────────────────────────────────
    def _find_traffic_light_box(self):
        """
        Retorna a caixa do semáforo
        com maior confiança.
        """
        best = None
        for x1, y1, x2, y2, label, conf in self._boxes:
            lbl = label.lower()
            if self._is_traffic_light_label(lbl):
                if conf < self._min_light_confidence:
                    continue
                diagonal = ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
                if diagonal < self._min_light_diagonal:
                    continue
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

    @classmethod
    def _is_traffic_light_label(cls, label: str) -> bool:
        return any(name in label for name in cls.TRAFFIC_LIGHT_LABELS)

    @classmethod
    def _is_right_detour_label(cls, label: str) -> bool:
        normalized = label.lower().strip().replace("-", "_").replace(" ", "_")
        return normalized in cls.RIGHT_DETOUR_LABELS

    @staticmethod
    def _is_stop_label(label: str) -> bool:
        return "pare" in label or "stop" in label

    def _is_valid_right_detour(self, x1, y1, x2, y2, conf):
        width = x2 - x1
        height = y2 - y1
        diagonal = (width ** 2 + height ** 2) ** 0.5
        if conf < self.MIN_RIGHT_DETOUR_CONF:
            return False
        if diagonal < self._min_right_detour_diagonal:
            return False
        return True

    def _update_right_detour_state(self):
        found = False
        for x1, y1, x2, y2, label, conf in self._boxes:
            lbl = label.lower()
            if not self._is_right_detour_label(lbl):
                continue
            if not self._is_valid_right_detour(x1, y1, x2, y2, conf):
                continue
            found = True
            break

        if found:
            self._right_detour_frames_seen += 1
        else:
            self._right_detour_frames_seen = 0

        self._right_detour_is_valid = self._right_detour_frames_seen >= self.RIGHT_DETOUR_REQUIRED_FRAMES


    # ── PARE ──────────────────────────────────────────────────────────────
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
        if (width ** 2 + height ** 2) ** 0.5 < self._min_stop_diagonal:
            return False
        return True

    def get_state(self):
        now = time.time()
        if self.stop_active and now >= self._stop_until:
            self.stop_active = False
            self._cooldown_until = now + self.COOLDOWN_SECONDS

        raw_stop = False
        for x1, y1, x2, y2, label, conf in self._boxes:
            if self._is_stop_label(label.lower()):
                # Verifica confiança + tamanho
                if self._is_valid_stop(x1, y1, x2, y2, conf):
                    raw_stop = True
                    break

        # ATIVA STOP
        if raw_stop and not self.stop_active and now >= self._cooldown_until:
            self._stop_until = now + self.STOP_WAIT_SECONDS
            self.stop_active = True
            # print("[Sinais] STOP ativado!")

        return self.stop_active, self._right_detour_is_valid
