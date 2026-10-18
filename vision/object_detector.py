import time
from pathlib import Path

import cv2
import numpy as np

_STOP_DISTANCE_UNSET = object()


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
    MIN_STOP_AREA = 1500  # Mantido por compatibilidade; não é mais usado na validação.
    MAX_DETECTION_DISTANCE_M = 2.0
    MAX_STOP_DISTANCE_M = 2.0  # Limite comum para PARE e pontos de parada.
    # ALTURA FÍSICA DAS PLACAS (metros) — mede com régua e ajusta
    REAL_HEIGHT_STOP = 0.10
    REAL_HEIGHT_LIGHT = 0.15
    REAL_HEIGHT_DETOUR = 0.10
    REAL_HEIGHT_STOP_POINT = 0.10
    # CORES DOS SEMÁFOROS
    LIGHT_TO_CODE = {"Vermelho": 0, "Amarelo": 1, "Verde": 2}  # noqa: RUF012
    LIGHT_TO_BGR = {  # noqa: RUF012
        "Vermelho": (0, 0, 255),
        "Amarelo": (0, 255, 255),
        "Verde": (0, 255, 0),
    }
    INVALID_COLOR = (200, 200, 200)  # Branco para detecções inválidas
    STOP_VALID_COLOR = (0, 165, 255)  # Laranja forte
    PERSON_VALID_COLOR = (255, 0, 0)  # Azul
    PERSON_INVALID_COLOR = INVALID_COLOR
    RIGHT_DETOUR_VALID_COLOR = (255, 0, 180)  # Magenta
    STOP_POINT_COLORS = {  # noqa: RUF012
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

    def __init__(self, model_path: str, conf_threshold: float | None = None):
        self._traffic_signs_model = None  # Modelo customizado para sinais de trânsito
        self._standard_model_path = (
            Path(__file__).resolve().parents[1] / "model" / "yolov8n.pt"
        )
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
        self._stop_point_confidences = {
            self._normalize_label(label): self.MIN_STOP_POINT_CONF
            for label in self.STOP_POINTS_LABELS
        }
        self._min_light_confidence = 0.0
        self._min_person_diagonal = 0
        self._right_detour_frames_seen = 0
        self._right_detour_is_valid = False
        # Distância (distância focal em pixels; None = desligado)
        self._focal_px = None
        # Estado da placa STOP
        self._stop_until = 0.0
        self._cooldown_until = 0.0
        self._stop_wait_completed = False
        self.stop_active = False
        # Estado do semáforo
        self._light_code = -1
        self._light_last_seen = 0.0
        p = Path(self._traffic_signs_model_path)
        if p.exists():
            print(f"[Sinais] Modelo pronto para carregamento lazy: {p.name}")
        else:
            print(f"[Sinais] Modelo nao encontrado: {p}")

    def configure(
        self,
        *,
        stop_confidence=None,
        stop_wait_seconds=None,
        cooldown_seconds=None,
        max_stop_distance_m=None,
        detection_distance_m=None,
        light_timeout_seconds=None,
        detect_interval=None,
        light_confidence=None,
        person_confidence=None,
        min_person_diagonal=None,
        right_detour_confidence=None,
        right_detour_required_frames=None,
        stop_point_confidence=None,
        stop_point_a_confidence=None,
        stop_point_b_confidence=None,
        stop_point_c_confidence=None,
        focal_px=None,
    ):
        """Atualiza os parâmetros de detecção em tempo real.



        As atribuições são escalares e podem ser feitas pelo loop de controle

        enquanto a thread de inferência processa o próximo frame.

        """
        if stop_confidence is not None:
            self.MIN_STOP_CONF = max(0.0, min(1.0, float(stop_confidence)))
        if stop_wait_seconds is not None:
            self.STOP_WAIT_SECONDS = max(0.0, float(stop_wait_seconds))
        if cooldown_seconds is not None:
            self.COOLDOWN_SECONDS = max(0.0, float(cooldown_seconds))
        if max_stop_distance_m is not None:
            self.MAX_STOP_DISTANCE_M = max(0.0, float(max_stop_distance_m))
        if detection_distance_m is not None:
            self.MAX_DETECTION_DISTANCE_M = max(0.0, float(detection_distance_m))
        if light_timeout_seconds is not None:
            self.LIGHT_TIMEOUT = max(0.0, float(light_timeout_seconds))
        if detect_interval is not None:
            self.DETECT_INTERVAL = max(1, int(detect_interval))
        if light_confidence is not None:
            self._min_light_confidence = max(0.0, min(1.0, float(light_confidence)))
        if person_confidence is not None:
            self.PERSON_CONF_THRESHOLD = max(0.0, min(1.0, float(person_confidence)))
        if min_person_diagonal is not None:
            self._min_person_diagonal = max(0, int(min_person_diagonal))
        if right_detour_confidence is not None:
            self.MIN_RIGHT_DETOUR_CONF = max(
                0.0, min(1.0, float(right_detour_confidence))
            )
        if right_detour_required_frames is not None:
            self.RIGHT_DETOUR_REQUIRED_FRAMES = max(
                1, int(right_detour_required_frames)
            )
        if stop_point_confidence is not None:
            confidence = max(0.0, min(1.0, float(stop_point_confidence)))
            for label in self._stop_point_confidences:
                self._stop_point_confidences[label] = confidence
        if focal_px is not None:
            self._focal_px = max(1.0, float(focal_px))
        point_settings = (
            ("ponto_a", stop_point_a_confidence),
            ("ponto_b", stop_point_b_confidence),
            ("ponto_c", stop_point_c_confidence),
        )
        for label, confidence in point_settings:
            if confidence is not None:
                self._stop_point_confidences[label] = max(
                    0.0, min(1.0, float(confidence))
                )

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
        """Desenha todas as detecções: cantos reforçados + etiqueta com nome, distância e confiança."""
        for x1, y1, x2, y2, conf in self._person_boxes:
            if conf < self.DISPLAY_CONF_THRESHOLD:
                continue
            valid = self._is_valid_person(x1, y1, x2, y2, conf)
            color = self.PERSON_VALID_COLOR if valid else self.PERSON_INVALID_COLOR
            self._draw_detection(img, x1, y1, x2, y2, "PESSOA", conf, color, valid)
        for x1, y1, x2, y2, label, conf in self._boxes:
            if conf < self.DISPLAY_CONF_THRESHOLD:
                continue
            lbl = label.lower()
            name = self._display_name(label)
            if self._is_traffic_light_label(lbl):
                color_name = self._code_to_name(self._light_code)
                color = self.LIGHT_TO_BGR.get(color_name, self.INVALID_COLOR)
                valid = (
                    color_name is not None
                    and conf >= self._min_light_confidence
                    and self._is_within_detection_distance(label, y1, y2)
                )
                if valid:
                    name = f"{name} {color_name.upper()}"
            elif self._is_stop_point_label(lbl):
                valid = self._is_valid_stop_point(label, x1, y1, x2, y2, conf)
                color = (
                    self.STOP_POINT_COLORS[self._normalize_label(lbl)]
                    if valid
                    else self.INVALID_COLOR
                )
            elif self._is_stop_label(lbl):
                valid = self._is_valid_stop(label, x1, y1, x2, y2, conf)
                color = self.STOP_VALID_COLOR if valid else self.INVALID_COLOR
            elif self._is_right_detour_label(lbl):
                valid = self._is_valid_right_detour(label, x1, y1, x2, y2, conf)
                color = self.RIGHT_DETOUR_VALID_COLOR if valid else self.INVALID_COLOR
            else:
                continue
            dist = self._estimate_distance(label, y1, y2)
            self._draw_detection(img, x1, y1, x2, y2, name, conf, color, valid, dist)

    def _draw_detection(
        self, img, x1, y1, x2, y2, name, conf, color, valid=True, dist=None
    ):
        """Caixa fina + cantos grossos + etiqueta. Inválida fica cinza e mais discreta."""
        cv2.rectangle(img, (x1, y1), (x2, y2), color, 1, cv2.LINE_AA)
        self._draw_corners(img, x1, y1, x2, y2, color, 3 if valid else 2)
        text = name
        if dist is not None:
            text += f"  {dist:.2f}m"
        text += f"  {conf * 100:.0f}%"
        if not valid:
            text += "  (inv)"
        # Etiqueta em cima da caixa; se não couber, vai pra baixo
        tag_y = y1 - 4 if y1 > 26 else y2 + 22
        self._draw_tag(img, text, x1, tag_y, color, align="left")

    @staticmethod
    def _draw_corners(img, x1, y1, x2, y2, color, thickness=3):
        length = max(6, min(x2 - x1, y2 - y1) // 4)
        for px, py, dx, dy in (
            (x1, y1, 1, 1),
            (x2, y1, -1, 1),
            (x1, y2, 1, -1),
            (x2, y2, -1, -1),
        ):
            cv2.line(
                img, (px, py), (px + dx * length, py), color, thickness, cv2.LINE_AA
            )
            cv2.line(
                img, (px, py), (px, py + dy * length), color, thickness, cv2.LINE_AA
            )

    @staticmethod
    def _draw_tag(img, text, x, y, color, align="center", scale=0.45):
        """Etiqueta pequena com fundo escuro e borda colorida; (x, y) é o canto de baixo."""
        font = cv2.FONT_HERSHEY_SIMPLEX
        (tw, th), base = cv2.getTextSize(text, font, scale, 1)
        pad = 3
        box_w, box_h = tw + 2 * pad, th + base + 2 * pad
        h, w = img.shape[:2]
        x0 = x - box_w // 2 if align == "center" else x
        x0 = int(np.clip(x0, 0, max(w - box_w - 1, 0)))
        y0 = int(np.clip(y - box_h, 0, max(h - box_h - 1, 0)))
        cv2.rectangle(img, (x0, y0), (x0 + box_w, y0 + box_h), (25, 25, 25), -1)
        cv2.rectangle(img, (x0, y0), (x0 + box_w, y0 + box_h), color, 1)
        # Texto um pouco mais claro que a borda, pra ler bem até em azul/vermelho puro
        text_color = tuple(int(c * 0.6 + 255 * 0.4) for c in color)
        cv2.putText(
            img,
            text,
            (x0 + pad, y0 + pad + th),
            font,
            scale,
            text_color,
            1,
            cv2.LINE_AA,
        )

    def _display_name(self, label):
        lbl = label.lower()
        if lbl in ("person", "pessoa"):
            return "PESSOA"
        if self._is_traffic_light_label(lbl):
            return "SEMAFORO"
        if self._is_stop_point_label(lbl):
            return f"PONTO {self._normalize_label(lbl)[-1].upper()}"
        if self._is_stop_label(lbl):
            return "PARE"
        if self._is_right_detour_label(lbl):
            return "DESVIO DIR"
        return label.upper()

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
                if (
                    self._is_traffic_light_label(normalized)
                    or self._is_stop_label(normalized)
                    or self._is_right_detour_label(normalized)
                    or self._is_stop_point_label(normalized)
                ):
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
        """Valida pessoas por confiança e diagonal mínima, sem estimar distância."""
        if conf < self.PERSON_CONF_THRESHOLD:
            return False
        width = x2 - x1
        height = y2 - y1
        diagonal = (width**2 + height**2) ** 0.5
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

    # ── DISTÂNCIA ─────────────────────────────────────────────────────────────
    def calibrate_focal(self, px_height, real_distance_m, real_height_m):
        """Define o foco (px) a partir de uma medida conhecida.



        Põe a placa a uma distância conhecida, lê a altura da caixa em pixels

        e chama: calibrate_focal(px_height, distancia_m, altura_real_m).

        """
        self._focal_px = (
            float(px_height) * float(real_distance_m) / float(real_height_m)
        )
        return self._focal_px

    def _real_height_for(self, label):
        lbl = label.lower()
        if self._is_traffic_light_label(lbl):
            return self.REAL_HEIGHT_LIGHT
        if self._is_stop_point_label(lbl):
            return self.REAL_HEIGHT_STOP_POINT
        if self._is_stop_label(lbl):
            return self.REAL_HEIGHT_STOP
        if self._is_right_detour_label(lbl):
            return self.REAL_HEIGHT_DETOUR
        return None

    def _estimate_distance(self, label, y1, y2):
        """Distância em metros (câmera → objeto) pelo modelo pinhole, ou None."""
        real_h = self._real_height_for(label)
        px_h = y2 - y1
        if self._focal_px is None or real_h is None or px_h <= 0:
            return None
        return real_h * self._focal_px / px_h

    def _is_within_detection_distance(self, label, y1, y2) -> bool:
        """Valida a distância estimada usando o limite comum de detecção."""
        distance = self._estimate_distance(label, y1, y2)
        return (
            distance is not None
            and 0.0 < distance <= self.MAX_DETECTION_DISTANCE_M
        )

    def _is_within_max_stop_distance(self, label, y1, y2) -> bool:
        distance = self._estimate_distance(label, y1, y2)
        return (
            distance is not None
            and 0.0 < distance <= self.MAX_STOP_DISTANCE_M
        )

    def _box_is_valid(self, label, x1, y1, x2, y2, conf) -> bool:
        """Valida placas por confiança e distância, sem usar área ou diagonal."""
        lbl = label.lower()
        if self._is_traffic_light_label(lbl):
            return (
                conf >= self._min_light_confidence
                and self._is_within_detection_distance(label, y1, y2)
            )
        if self._is_stop_point_label(lbl):
            return self._is_valid_stop_point(label, x1, y1, x2, y2, conf)
        if self._is_stop_label(lbl):
            return self._is_valid_stop(label, x1, y1, x2, y2, conf)
        if self._is_right_detour_label(lbl):
            return self._is_valid_right_detour(label, x1, y1, x2, y2, conf)
        return False

    def get_distances(self, only_valid=False) -> dict:
        """Retorna {label: distância_m} para todas as placas detectadas com distância estimável.

        Use only_valid=True para limitar o retorno às placas que passam pelos critérios
        de confiança e pelo limite de distância configurado.
        """
        out = {}
        for x1, y1, x2, y2, label, conf in self._boxes:
            if only_valid and not self._box_is_valid(label, x1, y1, x2, y2, conf):
                continue
            d = self._estimate_distance(label, y1, y2)
            if d is not None:
                out[label] = d
        return out

    def get_distance(self, name, only_valid=False):
        """Distância (m) de uma placa detectada; None se não detectada ou foco não calibrado.

        Com only_valid=True, considera também confiança e limite máximo de distância.
        """
        key = self._normalize_label(name)
        for x1, y1, x2, y2, label, conf in self._boxes:
            if key not in self._normalize_label(label):
                continue
            if only_valid and not self._box_is_valid(label, x1, y1, x2, y2, conf):
                continue
            d = self._estimate_distance(label, y1, y2)
            if d is not None:
                return d
        return None

    def get_stop_distance(self) -> float | None:
        """Retorna a menor distância estimável de uma placa PARE com confiança válida."""
        distances = (
            self._estimate_distance(label, y1, y2)
            for _, y1, _, y2, label, conf in self._boxes
            if self._is_stop_label(label.lower())
            and conf >= self.MIN_STOP_CONF
            and y2 > y1
        )
        return min(
            (
                distance
                for distance in distances
                if distance is not None and distance > 0
            ),
            default=None,
        )

    def is_pwm_zero_approach(
        self,
        distance_m: float | None,
        detection_distance_m: float,
    ) -> bool:
        """Indica se o objeto está entre a distância de detecção e a parada total."""
        return (
            distance_m is not None
            and self.MAX_STOP_DISTANCE_M < distance_m <= detection_distance_m
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
        distance = self.get_stop_point_distance(route_point)
        return distance is not None and distance <= self.MAX_STOP_DISTANCE_M

    def get_stop_point_distance(self, route_point) -> float | None:
        """Retorna a distância estimável do ponto da rota com confiança válida."""
        if route_point is None or not str(route_point).strip():
            return None
        expected = self._normalize_label(str(route_point))
        if not expected.startswith("ponto_"):
            expected = f"ponto_{expected}"
        for _, y1, _, y2, label, conf in self._boxes:
            if self._normalize_label(label) != expected:
                continue
            if conf < self._stop_point_confidences[expected] or y2 <= y1:
                return None
            distance = self._estimate_distance(label, y1, y2)
            return distance if distance is not None and distance > 0 else None
        return None

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
                if not self._is_within_detection_distance(label, y1, y2):
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
            np.mean(filtered_frame[int(height * i / 3) : int(height * (i + 1) / 3), :])
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
        if conf < min_confidence:
            return False
        return self._is_within_detection_distance(label, y1, y2)

    @staticmethod
    def _is_stop_label(label: str) -> bool:
        return "pare" in label or "stop" in label

    @property
    def stop_sign_suppressed(self) -> bool:
        return self._stop_wait_completed

    def _is_valid_right_detour(self, label, x1, y1, x2, y2, conf):
        if conf < self.MIN_RIGHT_DETOUR_CONF:
            return False
        return self._is_within_detection_distance(label, y1, y2)

    # ── PARE ──────────────────────────────────────────────────────────────
    def _is_valid_stop(self, label, x1, y1, x2, y2, conf):
        if conf < self.MIN_STOP_CONF:
            return False
        return self._is_within_detection_distance(label, y1, y2)

    def _update_right_detour_state(self):
        found = False
        for x1, y1, x2, y2, label, conf in self._boxes:
            lbl = label.lower()
            if not self._is_right_detour_label(lbl):
                continue
            if not self._is_valid_right_detour(label, x1, y1, x2, y2, conf):
                continue
            found = True
            break
        if found:
            self._right_detour_frames_seen += 1
        else:
            self._right_detour_frames_seen = 0
        self._right_detour_is_valid = (
            self._right_detour_frames_seen >= self.RIGHT_DETOUR_REQUIRED_FRAMES
        )

    def get_state(self, stop_distance_m=_STOP_DISTANCE_UNSET):
        now = time.time()
        if self.stop_active and now >= self._stop_until:
            self.stop_active = False
            self._cooldown_until = now + self.COOLDOWN_SECONDS
            self._stop_wait_completed = True

        if stop_distance_m is _STOP_DISTANCE_UNSET:
            stop_distances = [
                self._estimate_distance(label, y1, y2)
                for _, y1, _, y2, label, conf in self._boxes
                if self._is_stop_label(label.lower())
                and conf >= self.MIN_STOP_CONF
                and y2 > y1
            ]
            stop_detected = any(
                distance is not None and distance > 0
                for distance in stop_distances
            )
        else:
            stop_detected = stop_distance_m is not None and stop_distance_m > 0

        if (
            self._stop_wait_completed
            and not stop_detected
            and now >= self._cooldown_until
        ):
            self._stop_wait_completed = False

        # ATIVA STOP
        if (
            stop_detected
            and not self.stop_active
            and not self._stop_wait_completed
            and now >= self._cooldown_until
        ):
            self._stop_until = now + self.STOP_WAIT_SECONDS
            self.stop_active = True
            self._stop_wait_completed = False

        return self.stop_active, self._right_detour_is_valid


# ══════════════════════════════════════════════════════════════════════════════
# TESTE — é só rodar: python object_detector.py
# Ajusta os parâmetros aqui embaixo e executa.
#   c  → calibra o foco com a placa de maior confiança no frame,
#        assumindo que ela está a CALIB_DISTANCE_M da câmera
#   q  → sai
# ══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    # ── PARÂMETROS DO TESTE ──────────────────────────────────────────────────
    MODEL_PATH = "model/modelo_7.pt"  # caminho do modelo YOLO das placas
    MAX_CAMERA_INDEX = 10  # procura câmeras de 0 até este índice - 1
    FRAME_WIDTH = None  # largura pedida à câmera (None = padrão dela)
    FRAME_HEIGHT = None  # altura pedida à câmera (None = padrão dela)
    FOCAL_PX = 206.0  # foco em pixels, se você já souber (None = calibrar com 'c')
    CALIB_DISTANCE_M = 0.10  # distância real (m) da placa na hora de apertar 'c'
    TEST_DETECT_INTERVAL = 3  # roda a inferência a cada N frames
    PRINT_EVERY_SECONDS = 1.0  # de quantos em quantos segundos imprime as distâncias

    # ─────────────────────────────────────────────────────────────────────────
    def open_highest_camera(max_index):
        """Testa os índices de max_index-1 até 0 e abre o primeiro que entregar frame."""
        for idx in range(max_index - 1, -1, -1):
            cap = cv2.VideoCapture(idx)
            if cap.isOpened():
                ok, _ = cap.read()
                if ok:
                    return cap, idx
            cap.release()
        return None, None

    cap, cam_idx = open_highest_camera(MAX_CAMERA_INDEX)
    if cap is None:
        raise SystemExit("Nenhuma câmera encontrada.")
    print(f"Usando a câmera de índice {cam_idx}")
    if FRAME_WIDTH:
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_WIDTH)
    if FRAME_HEIGHT:
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_HEIGHT)
    detector = ObjectDetector(MODEL_PATH)
    detector.configure(detect_interval=TEST_DETECT_INTERVAL, focal_px=FOCAL_PX)
    print(
        f"Teclas: [c] calibrar foco com a placa a {CALIB_DISTANCE_M:.2f} m | [q] sair"
    )
    last_print = 0.0
    while True:
        ok, frame = cap.read()
        if not ok:
            print("Sem frame — câmera desconectada.")
            break
        detector.update(frame)
        view = frame.copy()
        detector.draw(view)
        if detector._focal_px:
            ObjectDetector._draw_tag(
                view,
                f"FOCO {detector._focal_px:.1f}px",
                6,
                26,
                (120, 220, 80),
                align="left",
            )
        else:
            ObjectDetector._draw_tag(
                view,
                "FOCO nao calibrado (aperte 'c')",
                6,
                26,
                (0, 165, 255),
                align="left",
            )
        stop, detour = detector.get_state()
        ObjectDetector._draw_tag(
            view,
            f"STOP {'ON' if stop else 'off'} | DESVIO {'ON' if detour else 'off'} | SEMAFORO {detector.get_light_state()}",
            6,
            52,
            (200, 200, 200),
            align="left",
        )
        now = time.time()
        if now - last_print >= PRINT_EVERY_SECONDS:
            dists = detector.get_distances()
            if dists:
                print("  ".join(f"{k}: {v:.2f} m" for k, v in dists.items()))
            last_print = now
        cv2.imshow("ObjectDetector — teste", view)
        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break
        if key == ord("c"):
            boxes = [
                b
                for b in detector._boxes
                if detector._real_height_for(b[4]) is not None
            ]
            if not boxes:
                print("Nenhuma placa detectada pra calibrar.")
                continue
            x1, y1, x2, y2, label, conf = max(boxes, key=lambda b: b[5])
            px_h = y2 - y1
            real_h = detector._real_height_for(label)
            focal = detector.calibrate_focal(px_h, CALIB_DISTANCE_M, real_h)
            print(
                f"Calibrado com '{label}': altura {px_h}px, "
                f"real {real_h} m, a {CALIB_DISTANCE_M} m → foco = {focal:.1f}px"
            )
    cap.release()
    cv2.destroyAllWindows()
