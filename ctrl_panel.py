"""
Painel de controle — versão PySide6.

API pública mantida idêntica à versão Tkinter, para não quebrar
código externo que já depende dela:

    panel = ControlPanel(width, height, test_mode=False,
                          dashboard_url="", twin_path="", initial_cam_idx=1)
    panel.on("iniciar", callback)
    panel.log("mensagem", "info")
    valor = panel.get("ROI", "Linha superior")
    com, cam = panel.get_connection() or (None, None)
    panel.run()
"""

import json
import os
import time
import threading
import urllib.request
import webbrowser
from io import BytesIO

import qrcode

from PySide6.QtCore import Qt, QTimer, Signal, QObject
from PySide6.QtGui import QPixmap, QFont, QColor
from PySide6.QtWidgets import (
    QApplication, QWidget, QMainWindow, QLabel, QPushButton, QSlider,
    QVBoxLayout, QHBoxLayout, QGridLayout, QFrame, QScrollArea,
    QComboBox, QSpinBox, QCheckBox, QTextEdit, QDialog, QSizePolicy,
)


# ─────────────────────────────────────────────────────────────────────────
# PALETA (Catppuccin Mocha — mesma da versão anterior)
# ─────────────────────────────────────────────────────────────────────────

BG      = "#1e1e2e"
CARD    = "#313244"
BORDER  = "#45475a"
FG      = "#cdd6f4"
MUTED   = "#6c7086"
ACCENT  = "#89b4fa"

GREEN   = "#a6e3a1"
RED     = "#f38ba8"
ORANGE  = "#fab387"
PURPLE  = "#cba6f7"
TEAL    = "#94e2d5"
CONSOLE = "#11111b"

LOG_COLORS = {
    "info":  ACCENT,
    "ok":    GREEN,
    "warn":  ORANGE,
    "error": RED,
    "rx":    GREEN,
    "tx":    ACCENT,
}

QSS = f"""
QWidget {{
    background-color: {BG};
    color: {FG};
    font-family: "Cascadia Code", "Consolas", monospace;
    font-size: 11px;
}}

QLabel#Title {{
    font-size: 16px;
    font-weight: 700;
    padding: 10px 0 4px 0;
}}

QLabel#SectionHeader {{
    color: {ACCENT};
    font-weight: 700;
    font-size: 11px;
}}

QFrame#Card {{
    background-color: {CARD};
    border-radius: 8px;
}}

QFrame#Separator {{
    background-color: {BORDER};
    max-height: 1px;
    min-height: 1px;
}}

QSlider::groove:horizontal {{
    height: 4px;
    background: {BORDER};
    border-radius: 2px;
}}
QSlider::handle:horizontal {{
    background: {ACCENT};
    width: 14px;
    height: 14px;
    margin: -5px 0;
    border-radius: 7px;
}}
QSlider::sub-page:horizontal {{
    background: {ACCENT};
    border-radius: 2px;
}}

QComboBox, QSpinBox {{
    background-color: {BG};
    border: 1px solid {BORDER};
    border-radius: 4px;
    padding: 3px 6px;
}}
QComboBox::drop-down {{
    border: none;
}}

QCheckBox::indicator {{
    width: 14px;
    height: 14px;
    border-radius: 3px;
    border: 1px solid {BORDER};
    background: {BG};
}}
QCheckBox::indicator:checked {{
    background: {ACCENT};
    border: 1px solid {ACCENT};
}}

QTextEdit#Log {{
    background-color: {CONSOLE};
    border: none;
    border-radius: 6px;
    padding: 6px;
}}

QScrollArea {{
    border: none;
}}

QScrollBar:vertical {{
    background: {BG};
    width: 10px;
}}
QScrollBar::handle:vertical {{
    background: {BORDER};
    border-radius: 5px;
    min-height: 24px;
}}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{
    height: 0px;
}}
"""


def _btn(text, bg, fg="#1e1e2e", flat_dark=False):
    btn = QPushButton(text)
    fg_color = FG if flat_dark else fg
    bg_hover = QColor(bg).lighter(112).name() if not flat_dark else BORDER
    btn.setCursor(Qt.PointingHandCursor)
    btn.setMinimumHeight(34)
    btn.setStyleSheet(f"""
        QPushButton {{
            background-color: {bg};
            color: {fg_color};
            border: none;
            border-radius: 6px;
            font-weight: 700;
            padding: 6px 12px;
        }}
        QPushButton:hover {{ background-color: {bg_hover}; }}
        QPushButton:pressed {{ background-color: {bg}; }}
    """)
    return btn


class _ServerBridge(QObject):
    """Repassa respostas de threads de rede pro loop principal do Qt."""
    config_received = Signal(dict)


class ControlPanel:
    def __init__(self, width, height, test_mode=False, dashboard_url="",
                 twin_path="", initial_cam_idx=1):

        self._app = QApplication.instance() or QApplication([])

        self.config_path = "config/config.json"
        self.frame_width  = width
        self.frame_height = height
        self.running      = False
        self._initial_test_mode = test_mode
        self._dashboard_url = dashboard_url
        self._twin_path     = twin_path
        self._initial_cam_idx = initial_cam_idx

        self.vars       = {}   # key -> valor atual (int)
        self.val_labels = {}   # key -> QLabel
        self.sliders    = {}   # key -> QSlider
        self.callbacks  = {}
        self._reconnect_pending = False
        self._last_local_change = 0.0
        self._applying_server   = False

        self._bridge = _ServerBridge()
        self._bridge.config_received.connect(self._apply_config)

        self.window = QMainWindow()
        self.window.setWindowTitle("Controles")
        self.window.setStyleSheet(QSS)
        self.window.resize(1000, 780)

        self._build_ui()
        self._register_callbacks()

        if self._dashboard_url:
            self._poll_timer = QTimer()
            self._poll_timer.timeout.connect(self._poll_server)
            self._poll_timer.start(2000)

    # ─────────────────────────────────────────────────────────────────
    # AÇÕES
    # ─────────────────────────────────────────────────────────────────

    def _IsRunning(self):
        return self.running

    def _iniciar(self):
        self.running = True
        self.log("[PAINEL] Iniciando movimento", "info")
        if self._dashboard_url and not self._applying_server:
            self._push_key("running", True)

    def _parar(self):
        self.running = False
        self.log("[CONTROLE MANUAL] veículo parado pelo painel de controle", "warn")
        if self._dashboard_url and not self._applying_server:
            self._push_key("running", False)

    def _salvar(self):
        os.makedirs(os.path.dirname(self.config_path) or ".", exist_ok=True)
        with open(self.config_path, "w") as f:
            json.dump(self.vars, f, indent=4)
        self.log("[PAINEL] Configurações salvas", "info")

    def _resetar(self):
        if not os.path.exists(self.config_path):
            self.log("[PAINEL] Nenhum config.json encontrado", "error")
            return
        with open(self.config_path, "r") as f:
            config = json.load(f)
        for key, val in config.items():
            if key in self.vars:
                self._set_value(key, val)
        self.log("[PAINEL] Valores restaurados do config.json", "info")
        if self._dashboard_url and not self._applying_server:
            self._push_all(config)

    def get_connection(self):
        """Retorna (com, cam_idx) se reconexão foi pedida, senão None. com=None = modo teste."""
        if self._reconnect_pending:
            self._reconnect_pending = False
            com = None if self._test_mode_check.isChecked() else self._com_combo.currentText()
            return com, self._cam_spin.value()
        return None

    def _refresh_ports(self):
        from serial.tools import list_ports
        devices = [p.device for p in list_ports.comports()]
        self._com_combo.clear()
        self._com_combo.addItems(devices)
        if devices:
            self._com_combo.setCurrentIndex(0)
        self.log(f"[CONEXÃO] Portas atualizadas: {devices}", "info")

    def _reconectar(self):
        if not self._test_mode_check.isChecked() and not self._com_combo.currentText():
            self.log("[CONEXÃO] Selecione uma porta COM ou ative o modo teste", "warn")
            return
        self._reconnect_pending = True
        if self._test_mode_check.isChecked():
            self.log(f"[CONEXÃO] Modo teste ativado  CAM={self._cam_spin.value()}", "info")
        else:
            self.log(f"[CONEXÃO] Reconectando → COM={self._com_combo.currentText()}  "
                      f"CAM={self._cam_spin.value()}", "info")

    def _show_qrcode(self):
        qr = qrcode.QRCode(box_size=6, border=3)
        qr.add_data(self._dashboard_url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="#cdd6f4", back_color=BG)

        buf = BytesIO()
        img.save(buf, format="PNG")
        pixmap = QPixmap()
        pixmap.loadFromData(buf.getvalue())

        dlg = QDialog(self.window)
        dlg.setWindowTitle("QR Code — Dashboard")
        dlg.setStyleSheet(QSS)
        layout = QVBoxLayout(dlg)
        img_label = QLabel()
        img_label.setPixmap(pixmap)
        img_label.setAlignment(Qt.AlignCenter)
        layout.addWidget(img_label)
        url_label = QLabel(self._dashboard_url)
        url_label.setStyleSheet(f"color: {ACCENT}; font-size: 9px;")
        url_label.setAlignment(Qt.AlignCenter)
        layout.addWidget(url_label)
        dlg.exec()

    def _register_callbacks(self):
        self.on("iniciar",  self._iniciar)
        self.on("parar",    self._parar)
        self.on("resetar",  self._resetar)
        self.on("salvar",   self._salvar)

    # ─────────────────────────────────────────────────────────────────
    # CONSTRUÇÃO DA UI
    # ─────────────────────────────────────────────────────────────────

    def _build_ui(self):
        config = {}
        if os.path.exists(self.config_path):
            with open(self.config_path, "r") as f:
                config = json.load(f)

        sections = [
            ("ROI", [
                ("Linha superior", config.get("ROI_Linha superior", 1280), 0, self.frame_width),
                ("Linha inferior", config.get("ROI_Linha inferior", 1280), 0, self.frame_width),
                ("Altura sup",     config.get("ROI_Altura sup", 263),      0, self.frame_height),
                ("Altura inf",     config.get("ROI_Altura inf", 541),      0, self.frame_height),
            ]),
            ("IMAGEM", [
                ("Limiar",            config.get("IMAGEM_Limiar", 195),           0, 255),
                ("Erro de transição", config.get("IMAGEM_Erro de transição", 12), 0, 100),
            ]),
            ("RETA", [
                ("Kp", config.get("RETA_Kp", 200), 0, 1000),
                ("Ki", config.get("RETA_Ki", 0),   0, 1000),
                ("Kd", config.get("RETA_Kd", 5),   0, 1000),
            ]),
            ("CURVA", [
                ("Kp", config.get("CURVA_Kp", 650), 0, 1000),
                ("Ki", config.get("CURVA_Ki", 0),   0, 1000),
                ("Kd", config.get("CURVA_Kd", 0),   0, 1000),
            ]),
            ("PARÂMETROS DO CARRO", [
                ("PWM", config.get("PARÂMETROS DO CARRO_PWM", 40), 0, 255),
            ]),
            ("DETECTOR", [
                ("Conf STOP",     config.get("DETECTOR_Conf STOP",     40), 0, 100),
                ("Conf Verde",    config.get("DETECTOR_Conf Verde",    40), 0, 100),
                ("Conf Vermelho", config.get("DETECTOR_Conf Vermelho", 40), 0, 100),
                ("Box diagonal",  config.get("DETECTOR_Box diagonal",   0), 0, 300),
            ]),
        ]

        central = QWidget()
        outer = QVBoxLayout(central)
        outer.setContentsMargins(0, 0, 0, 0)

        title = QLabel("Painel de Controle")
        title.setObjectName("Title")
        title.setAlignment(Qt.AlignCenter)
        outer.addWidget(title)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        outer.addWidget(scroll)

        content = QWidget()
        scroll.setWidget(content)
        grid = QGridLayout(content)
        grid.setContentsMargins(10, 10, 10, 10)
        grid.setHorizontalSpacing(10)
        grid.setVerticalSpacing(12)
        grid.setColumnStretch(0, 1)
        grid.setColumnStretch(1, 1)
        grid.setColumnStretch(2, 0)

        rows = [sections[0:2], sections[2:4], sections[4:6]]
        for r, row_sections in enumerate(rows):
            for c, (name, controls) in enumerate(row_sections):
                grid.addWidget(self._build_section(name, controls), r, c, Qt.AlignTop)

        # coluna lateral: conexão + ações + mensageria
        side = QVBoxLayout()
        side.addWidget(self._build_connection_box())
        side.addWidget(self._build_actions_box())
        if self._dashboard_url:
            side.addWidget(self._build_dashboard_box())
        side.addStretch()
        side_wrap = QWidget()
        side_wrap.setLayout(side)
        grid.addWidget(side_wrap, 0, 2, len(rows), 1, Qt.AlignTop)

        # log
        grid.addWidget(self._build_log_box(), len(rows), 0, 1, 3)

        self.window.setCentralWidget(central)

    def _section_header(self, text):
        header = QHBoxLayout()
        lbl = QLabel(text)
        lbl.setObjectName("SectionHeader")
        header.addWidget(lbl)
        line = QFrame()
        line.setObjectName("Separator")
        header.addWidget(line, 1)
        wrap = QWidget()
        wrap.setLayout(header)
        return wrap

    def _build_section(self, name, controls):
        container = QVBoxLayout()
        container.setContentsMargins(0, 0, 0, 0)
        container.addWidget(self._section_header(name))

        card = QFrame()
        card.setObjectName("Card")
        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(12, 10, 12, 10)
        card_layout.setSpacing(8)

        for i, (label, default, mn, mx) in enumerate(controls):
            key = f"{name}_{label}"
            self.vars[key] = default

            row = QVBoxLayout()
            top = QHBoxLayout()
            lbl = QLabel(label)
            top.addWidget(lbl)
            top.addStretch()
            val_lbl = QLabel(str(default))
            val_lbl.setStyleSheet(f"color: {ACCENT}; font-weight: 700;")
            top.addWidget(val_lbl)
            row.addLayout(top)

            slider = QSlider(Qt.Horizontal)
            slider.setMinimum(mn)
            slider.setMaximum(mx)
            slider.setValue(default)
            slider.valueChanged.connect(
                lambda v, k=key, vl=val_lbl: self._on_slider_change(k, v, vl)
            )
            row.addWidget(slider)

            self.val_labels[key] = val_lbl
            self.sliders[key] = slider

            row_wrap = QWidget()
            row_wrap.setLayout(row)
            card_layout.addWidget(row_wrap)

            if i < len(controls) - 1:
                sep = QFrame()
                sep.setObjectName("Separator")
                card_layout.addWidget(sep)

        container.addWidget(card)
        wrap = QWidget()
        wrap.setLayout(container)
        return wrap

    def _on_slider_change(self, key, value, val_label):
        self.vars[key] = value
        val_label.setText(str(value))
        if self._dashboard_url:
            self._push_key(key, value)

    def _set_value(self, key, val):
        self.vars[key] = val
        if key in self.sliders:
            self.sliders[key].blockSignals(True)
            self.sliders[key].setValue(int(val))
            self.sliders[key].blockSignals(False)
        if key in self.val_labels:
            self.val_labels[key].setText(str(val))

    def _build_connection_box(self):
        wrap_layout = QVBoxLayout()
        wrap_layout.setContentsMargins(0, 0, 0, 0)
        wrap_layout.addWidget(self._section_header("CONEXÃO"))

        card = QFrame()
        card.setObjectName("Card")
        card_layout = QVBoxLayout(card)
        card_layout.setSpacing(8)

        com_row = QHBoxLayout()
        com_row.addWidget(QLabel("COM"))
        from serial.tools import list_ports
        ports = [p.device for p in list_ports.comports()]
        self._com_combo = QComboBox()
        self._com_combo.addItems(ports)
        com_row.addWidget(self._com_combo, 1)
        refresh_btn = QPushButton("↻")
        refresh_btn.setCursor(Qt.PointingHandCursor)
        refresh_btn.setFixedWidth(28)
        refresh_btn.setStyleSheet(f"background: transparent; color: {ACCENT}; font-weight: 700; border: none;")
        refresh_btn.clicked.connect(self._refresh_ports)
        com_row.addWidget(refresh_btn)
        card_layout.addLayout(com_row)

        cam_row = QHBoxLayout()
        cam_row.addWidget(QLabel("CAM idx"))
        self._cam_spin = QSpinBox()
        self._cam_spin.setRange(0, 5)
        self._cam_spin.setValue(self._initial_cam_idx)
        cam_row.addWidget(self._cam_spin)
        cam_row.addStretch()
        card_layout.addLayout(cam_row)

        self._test_mode_check = QCheckBox("Sem Arduino (modo teste)")
        self._test_mode_check.setChecked(self._initial_test_mode)
        card_layout.addWidget(self._test_mode_check)

        wrap_layout.addWidget(card)

        reconnect_btn = _btn("🔌 Reconectar", TEAL)
        reconnect_btn.clicked.connect(self._reconectar)
        wrap_layout.addWidget(reconnect_btn)

        wrap = QWidget()
        wrap.setLayout(wrap_layout)
        return wrap

    def _build_actions_box(self):
        layout = QVBoxLayout()
        layout.setContentsMargins(0, 12, 0, 0)
        layout.addWidget(self._section_header("AÇÕES"))

        buttons = [
            ("▶  Iniciar",  "iniciar",  GREEN),
            ("■  Parar",    "parar",    RED),
            ("↺  Resetar",  "resetar",  ORANGE),
            ("⚙  Calibrar", "calibrar", ACCENT),
            ("💾  Salvar",  "salvar",   PURPLE),
        ]
        for label, key, color in buttons:
            btn = _btn(label, color)
            btn.clicked.connect(lambda _, k=key: self._fire(k))
            layout.addWidget(btn)

        wrap = QWidget()
        wrap.setLayout(layout)
        return wrap

    def _build_dashboard_box(self):
        layout = QVBoxLayout()
        layout.setContentsMargins(0, 12, 0, 0)
        layout.addWidget(self._section_header("MENSAGERIA"))

        card = QFrame()
        card.setObjectName("Card")
        card_layout = QVBoxLayout(card)
        card_layout.setSpacing(6)

        url_lbl = QLabel(f"API: {self._dashboard_url}")
        url_lbl.setStyleSheet(f"color: {MUTED}; font-size: 8px;")
        url_lbl.setWordWrap(True)
        card_layout.addWidget(url_lbl)

        open_btn = _btn("🚗 Abrir Digital Twin", GREEN)
        open_btn.clicked.connect(lambda: webbrowser.open(self._dashboard_url))
        card_layout.addWidget(open_btn)

        copy_btn = _btn("📋 Copiar link", BORDER, flat_dark=True)

        def _copy_link():
            self._app.clipboard().setText(self._dashboard_url)
            copy_btn.setText("✔ Copiado!")
            QTimer.singleShot(1500, lambda: copy_btn.setText("📋 Copiar link"))

        copy_btn.clicked.connect(_copy_link)
        card_layout.addWidget(copy_btn)

        qr_btn = _btn("QR Code", PURPLE)
        qr_btn.clicked.connect(self._show_qrcode)
        card_layout.addWidget(qr_btn)

        layout.addWidget(card)
        wrap = QWidget()
        wrap.setLayout(layout)
        return wrap

    def _build_log_box(self):
        layout = QVBoxLayout()
        layout.setContentsMargins(0, 4, 0, 0)

        header = QHBoxLayout()
        lbl = QLabel("LOG")
        lbl.setObjectName("SectionHeader")
        header.addWidget(lbl)
        line = QFrame()
        line.setObjectName("Separator")
        header.addWidget(line, 1)
        clear_btn = QPushButton("limpar")
        clear_btn.setCursor(Qt.PointingHandCursor)
        clear_btn.setStyleSheet(f"background: transparent; color: {MUTED}; border: none;")
        clear_btn.clicked.connect(self._clear_log)
        header.addWidget(clear_btn)
        layout.addLayout(header)

        self._log_text = QTextEdit()
        self._log_text.setObjectName("Log")
        self._log_text.setReadOnly(True)
        self._log_text.setFixedHeight(140)
        layout.addWidget(self._log_text)

        wrap = QWidget()
        wrap.setLayout(layout)
        return wrap

    # ── API pública de log ───────────────────────────────────────────────
    def log(self, msg, tag="info"):
        """
        Registra uma mensagem no painel de log.
        Tags disponíveis: 'info', 'ok', 'warn', 'error', 'rx', 'tx'

        Exemplos:
            panel.log("Iniciando...", "info")
            panel.log("Conexão estabelecida", "ok")
            panel.log("[CONTROLE MANUAL] veículo parado", "warn")
            panel.log("Erro na leitura", "error")
            panel.log("RX ← dados do arduino", "rx")
            panel.log("TX → dados para o arduino", "tx")
        """
        ts = time.strftime("%H:%M:%S")
        color = LOG_COLORS.get(tag, FG)
        self._log_text.append(f'<span style="color:{MUTED}">[{ts}]</span> '
                               f'<span style="color:{color}">{msg}</span>')

    def _clear_log(self):
        self._log_text.clear()

    # ────────────────────────────────────────────────────────────────────
    def _fire(self, key):
        if key in self.callbacks:
            self.callbacks[key]()

    def on(self, key, fn):
        self.callbacks[key] = fn

    def get(self, section, label):
        return self.vars[f"{section}_{label}"]

    def _poll_server(self):
        def _fetch():
            try:
                with urllib.request.urlopen(f"{self._dashboard_url}/api/config", timeout=1) as r:
                    cfg = json.loads(r.read())
                self._bridge.config_received.emit(cfg)
            except Exception:
                pass
        threading.Thread(target=_fetch, daemon=True).start()

    def _push_key(self, key, val):
        self._push_all({key: val})

    def _push_all(self, data: dict):
        if self._applying_server:
            return
        self._last_local_change = time.time()

        def _post():
            try:
                raw = json.dumps(data).encode()
                req = urllib.request.Request(
                    f"{self._dashboard_url}/api/config",
                    data=raw,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                urllib.request.urlopen(req, timeout=1)
            except Exception:
                pass
        threading.Thread(target=_post, daemon=True).start()

    def _apply_config(self, cfg):
        if time.time() - self._last_local_change < 3.0:
            return
        self._applying_server = True
        for key, val in cfg.items():
            if key in self.vars:
                self._set_value(key, val)
        running = cfg.get("running")
        if running is True and not self.running:
            self._iniciar()
        elif running is False and self.running:
            self._parar()
        self._applying_server = False

    def run(self):
        self.window.show()
        self._app.exec()


if __name__ == "__main__":
    panel = ControlPanel(1280, 720)
    panel.run()