from pathlib import Path
import cv2


class SignDetector:
    DETECT_INTERVAL  = 5    # roda YOLO a cada N frames
    STOP_WAIT_FRAMES = 90   # mantém STOP ativo ~3 s após ver a placa

    def __init__(self, model_path: str, conf_threshold: float = 0.4):
        self._model           = None
        self._boxes: list     = []
        self._counter         = 0
        self._stop_timer      = 0
        self._conf_stop  = max(0.0, min(1.0, conf_threshold))
        self._conf_sg    = max(0.0, min(1.0, conf_threshold))
        self._conf_sv    = max(0.0, min(1.0, conf_threshold))
        self._min_diag   = 0  # px; 0 = sem filtro

        try:
            from ultralytics import YOLO
            p = Path(model_path)
            if p.exists():
                self._model = YOLO(str(p))
                print(f"[Sinais] Modelo carregado: {p.name}")
            else:
                print(f"[Sinais] Modelo nao encontrado: {p}")
                print("[Sinais] Coloque o arquivo em: model/traffic_sign_detector.pt")
        except ImportError:
            print("[Sinais] ultralytics nao instalado: pip install ultralytics==8.3.5")

    def set_conf(self, value: float) -> None:
        v = max(0.0, min(1.0, value))
        self._conf_stop = self._conf_sg = self._conf_sv = v

    def set_conf_stop(self, value: float) -> None:
        self._conf_stop = max(0.0, min(1.0, value))

    def set_conf_sg(self, value: float) -> None:
        self._conf_sg = max(0.0, min(1.0, value))

    def set_conf_sv(self, value: float) -> None:
        self._conf_sv = max(0.0, min(1.0, value))

    def set_min_diag(self, value: int) -> None:
        self._min_diag = max(0, int(value))

    # ── API pública ───────────────────────────────────────────────────────

    def update(self, frame) -> list:
        """Chame 1x por frame. Roda inferência a cada DETECT_INTERVAL frames."""
        self._counter += 1
        if self._counter >= self.DETECT_INTERVAL:
            self._counter = 0
            self._boxes   = self._predict(frame) if self._model else []
        return self._boxes

    def get_flags(self) -> tuple:
        """
        Retorna (stop, sg, sv).
          stop — placa STOP detectada (mantida por STOP_WAIT_FRAMES após sumir)
          sg   — semáforo verde  → cancela sv
          sv   — semáforo vermelho/amarelo
        """
        raw_stop = raw_sg = raw_sv = False

        for *_, label, _ in self._boxes:
            lbl = label.lower()
            if "stop" in lbl:
                raw_stop = True
            if "green" in lbl:
                raw_sg = True
            if "red" in lbl or "yellow" in lbl:
                raw_sv = True

        # Timer de STOP: mantém flag ativa por STOP_WAIT_FRAMES mesmo após placa sumir
        if raw_stop:
            self._stop_timer = self.STOP_WAIT_FRAMES
        elif self._stop_timer > 0:
            self._stop_timer -= 1
            raw_stop = True

        # Verde cancela vermelho/amarelo
        if raw_sg:
            raw_sv = False

        return raw_stop, raw_sg, raw_sv

    def draw(self, img) -> None:
        """Desenha bounding boxes das detecções no frame."""
        for x1, y1, x2, y2, label, conf in self._boxes:
            cv2.rectangle(img, (x1, y1), (x2, y2), (0, 165, 255), 2)
            cv2.putText(img, f"{label} {conf:.2f}", (x1, max(y1 - 6, 10)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 165, 255), 1)

    # ── Interno ───────────────────────────────────────────────────────────

    def _predict(self, frame) -> list:
        base_conf = min(self._conf_stop, self._conf_sg, self._conf_sv)
        out = []
        for r in self._model.predict(frame, verbose=False, conf=base_conf):
            for box in r.boxes:
                x1, y1, x2, y2 = (int(v) for v in box.xyxy[0])
                label = r.names[int(box.cls[0])]
                conf  = float(box.conf[0])
                lbl   = label.lower()

                if "stop" in lbl and conf < self._conf_stop:
                    continue
                if "green" in lbl and conf < self._conf_sg:
                    continue
                if ("red" in lbl or "yellow" in lbl) and conf < self._conf_sv:
                    continue

                if self._min_diag > 0:
                    diag = ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
                    if diag < self._min_diag:
                        continue

                out.append((x1, y1, x2, y2, label, conf))
        return out
