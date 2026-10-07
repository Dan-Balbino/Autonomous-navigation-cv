from pathlib import Path
import time

import cv2
import numpy as np


class ObjectDetector:
    # CONFIGURAÇÕES
    """Detecta sinais de trânsito, semáforos, pontos de parada e pessoas em frames da câmera."""

    LIGHT_MIN_MEAN_SPREAD = 10.0  # diferença mínima entre maior e menor média; abaixo disso o semáforo é inválido
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

    INVALID_COLOR = (200, 200, 200)             # Branco para detecções inválidas
    STOP_VALID_COLOR = (0, 165, 255)            # Laranja forte
    PERSON_VALID_COLOR = (255, 0, 0)            # Azul
    PERSON_INVALID_COLOR = INVALID_COLOR
    RIGHT_DETOUR_VALID_COLOR = (255, 0, 180)  # Magenta
    STOP_POINT_COLORS = {
        "ponto_a": (255, 128, 0),
        "ponto_b": (0, 200, 255),
        "ponto_c": (255, 0, 180),
    }

    TRAFFIC_LIGHT_LABELS = ("semaforo", "semáforo", "light")
    RIGHT_DETOUR_LABELS = ("desvio_direita",)
    STOP_POINTS_LABELS = ("ponto_A", "ponto_B", "ponto_C")  # nomes como foram treinados

    # Versões normalizadas (minúsculo) só pra comparação
    _RIGHT_DETOUR_NORM = frozenset(l.lower() for l in RIGHT_DETOUR_LABELS)
    _STOP_POINTS_NORM = frozenset(l.lower() for l in STOP_POINTS_LABELS)

    MIN_RIGHT_DETOUR_CONF = 0.1
    RIGHT_DETOUR_REQUIRED_FRAMES = 3

    MIN_STOP_POINT_CONF = 0.1

    def __init__(self, model_path: str, conf_threshold: float = None):
        self._traffic_signs_model = None                # Modelo customizado para sinais de trânsito
        self._standard_model_path = Path(__file__).resolve().parents[1] / "model" / "yolov8n.pt"
        self._yolo_standard_model = None
        self._traffic_signs_model_path = str(model_path)
        self._boxes = []
        self._person_boxes = []
        self._counter = 0
        self._ignored_labels = set()  # labels detectados mas ignorados (debug)

        # Se não passar confiança, usa CONF_THRESHOLD
        if conf_threshold is None:
            conf_threshold = self.CONF_THRESHOLD
        self._conf = max(0.0, min(1.0, conf_threshold))
        self._min_stop_diagonal = 0
        self._stop_point_confidences = {
            self._normalize_label(label): self.MIN_STOP_POINT_CONF
            for label in self.STOP_POINTS_LABELS
        }
        self._min_stop_point_diagonals = {
            self._normalize_label(label): 0
            for label in self.STOP_POINTS_LABELS
        }
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
                  right_detour_required_frames=None,
                  stop_point_confidence=None,
                  min_stop_point_diagonal=None,
                  stop_point_a_confidence=None,
                  min_stop_point_a_diagonal=None,
                  stop_point_b_confidence=None,
                  min_stop_point_b_diagonal=None,
                  stop_point_c_confidence=None,
                  min_stop_point_c_diagonal=None):
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
        if stop_point_confidence is not None:
            confidence = max(0.0, min(1.0, float(stop_point_confidence)))
            for label in self._stop_point_confidences:
                self._stop_point_confidences[label] = confidence
        if min_stop_point_diagonal is not None:
            diagonal = max(0, int(min_stop_point_diagonal))
            for label in self._min_stop_point_diagonals:
                self._min_stop_point_diagonals[label] = diagonal

        point_settings = (
            ("ponto_a", stop_point_a_confidence, min_stop_point_a_diagonal),
            ("ponto_b", stop_point_b_confidence, min_stop_point_b_diagonal),
            ("ponto_c", stop_point_c_confidence, min_stop_point_c_diagonal),
        )
        for label, confidence, diagonal in point_settings:
            if confidence is not None:
                self._stop_point_confidences[label] = max(0.0, min(1.0, float(confidence)))
            if diagonal is not None:
                self._min_stop_point_diagonals[label] = max(0, int(diagonal))

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
            elif self._is_stop_point_label(lbl):
                normalized = self._normalize_label(lbl)
                color = (self.STOP_POINT_COLORS[normalized]
                         if self._is_valid_stop_point(label, x1, y1, x2, y2, conf)
                         else self.INVALID_COLOR)
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
        print(f"[Sinais] Classes do modelo: {self._traffic_signs_model.names}")
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
                        or self._is_right_detour_label(normalized)
                        or self._is_stop_point_label(normalized)):
                    current = best_by_label.get(normalized)
                    if current is None or conf > current[5]:
                        best_by_label[normalized] = (x1, y1, x2, y2, label, conf)
                elif label not in self._ignored_labels:
                    self._ignored_labels.add(label)
                    print(f"[Sinais] Label detectado mas ignorado: '{label}'")
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

    def has_valid_person(self) -> bool:
        """Verifica se há alguma pessoa que atende aos limites configurados."""
        return any(
            self._is_valid_person(x1, y1, x2, y2, conf)
            for x1, y1, x2, y2, conf in self._person_boxes
        )

    # ── PONTOS A/B/C ──────────────────────────────────────────────────────────
    def get_stop_points(self) -> list:
        """Retorna os pontos detectados na última inferência: [(label, conf, (x1,y1,x2,y2)), ...]"""
        return [
            (label, conf, (x1, y1, x2, y2))
            for x1, y1, x2, y2, label, conf in self._boxes
            if self._is_stop_point_label(label)
            and self._is_valid_stop_point(label, x1, y1, x2, y2, conf)
        ]

    def has_valid_stop_point(self, route_point) -> bool:
        """Verifica se a placa válida corresponde ao destino atual da rota."""
        if route_point is None or not str(route_point).strip():
            return False
        expected = self._normalize_label(str(route_point))
        if not expected.startswith("ponto_"):
            expected = f"ponto_{expected}"
        for x1, y1, x2, y2, label, conf in self._boxes:
            if (self._normalize_label(label) == expected
                    and self._is_valid_stop_point(label, x1, y1, x2, y2, conf)):
                return True
        return False

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
                # None = médias muito próximas, semáforo inválido
                if color_name is not None:
                    self._light_code = self.LIGHT_TO_CODE[color_name]
                    self._light_last_seen = time.time()

        # TIMEOUT
        if time.time() - self._light_last_seen > self.LIGHT_TIMEOUT:
            self._light_code = -1

    def classify_traffic_light(self, frame):
        """
        Analisa o frame recortado no semáforo
        e retorna a cor ativa, ou None se as três
        regiões tiverem brilho parecido (semáforo inválido).
        """
        filtered_frame = self.apply_filter(frame)
        height = filtered_frame.shape[0]
        colors = ["Vermelho", "Amarelo", "Verde"]
        means = [
            np.mean(filtered_frame[int(height * i / 3):int(height * (i + 1) / 3), :])
            for i in range(3)
        ]
        if max(means) - min(means) < self.LIGHT_MIN_MEAN_SPREAD:
            return None
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
        return normalized in cls._RIGHT_DETOUR_NORM

    @classmethod
    def _is_stop_point_label(cls, label: str) -> bool:
        normalized = cls._normalize_label(label)
        return normalized in cls._STOP_POINTS_NORM

    @staticmethod
    def _normalize_label(label: str) -> str:
        return label.lower().strip().replace("-", "_").replace(" ", "_")

    def _is_valid_stop_point(self, label, x1, y1, x2, y2, conf):
        normalized = self._normalize_label(label)
        min_confidence = self._stop_point_confidences[normalized]
        min_diagonal = self._min_stop_point_diagonals[normalized]
        if conf < min_confidence:
            return False
        diagonal = ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
        return diagonal >= min_diagonal

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

    def get_state(self, current_route_point=None):
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
        if not raw_stop and self.has_valid_stop_point(current_route_point):
            raw_stop = True

        # ATIVA STOP
        if raw_stop and not self.stop_active and now >= self._cooldown_until:
            self._stop_until = now + self.STOP_WAIT_SECONDS
            self.stop_active = True

        return self.stop_active, self._right_detour_is_valid