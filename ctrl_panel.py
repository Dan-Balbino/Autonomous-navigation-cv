"""
Interface de Controle — versão PySide6.

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

from core.remote_control import RemoteControl

from PySide6.QtCore import Qt, QTimer, Signal, QObject
from PySide6.QtGui import QPixmap, QColor, QImage, QTextCursor
from PySide6.QtWidgets import (
    QApplication, QWidget, QMainWindow, QLabel, QPushButton, QSlider,
    QVBoxLayout, QHBoxLayout, QGridLayout, QFrame, QScrollArea,
    QComboBox, QSpinBox, QCheckBox, QTextEdit, QDialog, QSizePolicy,
    QProgressBar,
    QTabWidget,
)


# ─────────────────────────────────────────────────────────────────────────
# PALETA (Catppuccin Mocha)
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
RIGHT_DETOUR_VALID = "#99ffb4"
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

QLabel {{
    background-color: transparent;
    background: transparent;
    border: none;
}}

QWidget#PanelContent, QWidget#PanelContent QLabel {{
    background-color: transparent;
}}

QWidget#ControlField {{
    background-color: {CARD};
}}

QWidget#SectionHeaderContainer {{
    background-color: transparent;
}}

QFrame#Card QWidget {{
    background-color: {CARD};
}}

QFrame#MetricCard QWidget {{
    background-color: {CONSOLE};
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
    border: 1px solid {BORDER};
    border-radius: 8px;
}}

QFrame#MetricCard {{
    background-color: {CONSOLE};
    border: 1px solid {BORDER};
    border-radius: 8px;
}}

QLabel#MetricValue {{
    color: {ACCENT};
    font-size: 20px;
    font-weight: 700;
}}

QLabel#MetricLabel {{
    color: {MUTED};
    font-size: 9px;
    font-weight: 700;
}}

QLabel#StateValue {{
    color: {TEAL};
    font-weight: 700;
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
    border: 2px solid {BG};
}}
QSlider::sub-page:horizontal {{
    background: {ACCENT};
    border-radius: 2px;
}}
QSlider#SpeedSlider::groove:horizontal {{
    background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
        stop:0 {RED}, stop:0.15 {RED}, stop:0.151 {BORDER}, stop:1 {BORDER});
}}
QSlider#SpeedSlider::sub-page:horizontal {{ background: transparent; }}

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

QTabWidget::pane {{ border: 1px solid {BORDER}; border-radius: 6px; }}
QTabBar::tab {{
    background: {CARD}; color: {MUTED}; border: none; padding: 9px 16px;
    margin-right: 2px; font-weight: 700;
}}
QTabBar::tab:selected {{
    color: {ACCENT}; background: {CARD}; border-bottom: 2px solid {TEAL};
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
    vehicle_info_received = Signal(dict)
    log_received = Signal(str, str)
    camera_id_received = Signal(int)
    speed_adjust_requested = Signal(float)


class ControlPanel:
    def __init__(self, width, height, test_mode=False, dashboard_url="",
                 twin_path="", camera_idx=1,
                 car=None, nav=None, remote_control=None):

        self._app = QApplication.instance() or QApplication([])

        self.config_path = "config/config.json"
        self.frame_width  = width
        self.frame_height = height
        self.running      = False
        self._initial_test_mode = test_mode
        self._dashboard_url = dashboard_url
        self._twin_path     = twin_path
        self._camera_idx = camera_idx
        self.car = car
        self.nav = nav
        self.remote_control = remote_control if remote_control is not None else RemoteControl()

        self.vars       = {}   # key -> valor atual (int)
        self.val_labels = {}   # key -> QLabel
        self.sliders    = {}   # key -> QSlider
        self.callbacks  = {}
        self._reconnect_pending = False
        self._last_local_change = 0.0
        self._applying_server   = False
        self._preview_lock = threading.Lock()
        self._latest_frames = None
        self._preview_labels = {}
        self._vehicle_labels = {}
        self._wheel_speed_bars = {}
        self._wheel_speed_labels = {}
        self._pid_labels = {}
        self._remote_status_label = None
        self._remote_feedback_label = None
        self._can_modules_signature = None
        self._stop_point_selectors = {}
        self._selected_stop_points = {"coleta": "A", "entrega": "A"}
        self._camera_id_label = None

        self._bridge = _ServerBridge()
        self._bridge.config_received.connect(self._apply_config)
        self._bridge.vehicle_info_received.connect(self._apply_vehicle_info)
        self._bridge.log_received.connect(self._append_log)
        self._bridge.camera_id_received.connect(self._apply_camera_id)
        self._bridge.speed_adjust_requested.connect(self._adjust_speed)

        self.window = QMainWindow()
        self.window.setWindowTitle("Controles")
        self.window.setStyleSheet(QSS)

        self._build_ui()
        self._register_callbacks()

        if self._dashboard_url:
            self._poll_timer = QTimer()
            self._poll_timer.timeout.connect(self._poll_server)
            self._poll_timer.start(2000)

        # A visualização usa somente o frame mais recente; ela nunca cria uma
        # fila que possa atrasar o loop de direção do veículo.
        self._preview_timer = QTimer()
        self._preview_timer.timeout.connect(self._present_latest_frames)
        self._preview_timer.start(33)  # até 30 FPS no painel

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
        self.log("[CONTROLE MANUAL] veículo parado pela interface de controle", "warn")
        if self._dashboard_url and not self._applying_server:
            self._push_key("running", False)

    def _salvar(self):
        os.makedirs(os.path.dirname(self.config_path) or ".", exist_ok=True)
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(self.vars, f, indent=4)
        self.log("[PAINEL] Configurações salvas", "info")

    def _resetar(self):
        if not os.path.exists(self.config_path):
            self.log("[PAINEL] Nenhum config.json encontrado", "error")
            return
        with open(self.config_path, "r", encoding="utf-8") as f:
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
            return com, self._camera_idx
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
            self.log(f"[CONEXÃO] Modo teste ativado  CAM={self._camera_idx}", "info")
        else:
            self.log(f"[CONEXÃO] Reconectando → COM={self._com_combo.currentText()}  "
                      f"CAM={self._camera_idx}", "info")

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
            with open(self.config_path, "r", encoding="utf-8") as f:
                config = json.load(f)
        saved_pwm = config.get("PARÂMETROS DO CARRO_PWM")
        if saved_pwm is None:
            legacy_speed = config.get("PARÂMETROS DO CARRO_Velocidade (m/s)")
            saved_pwm = round(float(legacy_speed) * 10) if legacy_speed is not None else 40
        saved_pwm = max(0, min(255, int(saved_pwm)))
        stop_wait_seconds = config.get("PARE_Tempo de parada (s)")
        if stop_wait_seconds is None:
            stop_wait_seconds = round(float(config.get("PARE_Tempo de parada (ms)", 3000)) / 1000)
        cooldown_seconds = config.get("PARE_Cooldown (s)")
        if cooldown_seconds is None:
            cooldown_seconds = round(float(config.get("PARE_Cooldown (ms)", 3000)) / 1000)
        close_curve_pid_error = config.get(
            "IMAGEM_Erro para ativar o PID de curva fechada (px)",
            config.get(
                "PID DE CURVA FECHADA_Erro para ativar o PID de curva fechada (px)",
                config.get("PID DE CURVA FECHADA_Erro para iniciar (px)", 80),
            ),
        )

        control_sections = [
            ("ROI", [
                ("Linha superior", config.get("ROI_Linha superior", 1280), 0, self.frame_width),
                ("Linha inferior", config.get("ROI_Linha inferior", 1280), 0, self.frame_width),
                ("Altura sup",     config.get("ROI_Altura sup", 263),      0, self.frame_height),
                ("Altura inf",     config.get("ROI_Altura inf", 541),      0, self.frame_height),
            ]),
            ("IMAGEM", [
                ("Limiar",            config.get("IMAGEM_Limiar", 195),           0, 255),
                ("Erro de transição", config.get("IMAGEM_Erro de transição", 12), 0, 100),
                ("Erro para ativar o PID de curva fechada (px)", close_curve_pid_error, 0, 160),
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
            ("PID DE CURVA FECHADA", [
                ("Kp", config.get("PID DE CURVA FECHADA_Kp", 650), 0, 1000),
                ("Ki", config.get("PID DE CURVA FECHADA_Ki", 0), 0, 1000),
                ("Kd", config.get("PID DE CURVA FECHADA_Kd", 0), 0, 1000),
            ]),
        ]
        signal_sections = [
            ("PARÂMETROS DO CARRO", [
                ("PWM", saved_pwm, 0, 255),
                ("Velocidade na curva (PWM)", config.get("PARÂMETROS DO CARRO_Velocidade na curva (PWM)", 70), 0, 255),
                ("Erro para iniciar velocidade na curva (px)", config.get("PARÂMETROS DO CARRO_Erro para iniciar velocidade na curva (px)", 24), 0, 160),
                ("Velocidade no amarelo (%)", config.get("PARÂMETROS DO CARRO_Velocidade no amarelo (%)", config.get("PARÂMETROS DO CARRO_PWM amarelo (%)", 50)), 0, 100),
                ("Ângulo máximo", config.get("PARÂMETROS DO CARRO_Ângulo máximo", 90), 20, 90),
                ("Intervalo comando (ms)", config.get("PARÂMETROS DO CARRO_Intervalo comando (ms)", 200), 50, 1000),
            ]),
            ("PARE", [
                ("Confiança (%)", config.get("PARE_Confiança (%)", config.get("DETECTOR_Confiança (%)", 40)), 0, 100),
                ("Diagonal mínima da caixa (px)", config.get("PARE_Diagonal mínima da caixa (px)", config.get("PARE_Box diagonal", config.get("DETECTOR_Box diagonal", 0))), 0, 1000),
                ("Tempo de parada (s)", stop_wait_seconds, 0, 15),
                ("Cooldown (s)", cooldown_seconds, 0, 15),
            ]),
            ("SEMÁFORO", [
                ("Confiança (%)", config.get("SEMÁFORO_Confiança (%)", 80), 0, 100),
                ("Diagonal mínima da caixa (px)", config.get("SEMÁFORO_Diagonal mínima da caixa (px)", config.get("SEMÁFORO_Box diagonal", 0)), 0, 1000),
                ("Timeout (ms)", config.get("SEMÁFORO_Timeout (ms)", 2000), 250, 10000),
                ("Intervalo IA (frames)", config.get("SEMÁFORO_Intervalo IA (frames)", 5), 1, 30),
            ]),
            ("DESVIO DIREITA", [
                ("Confiança (%)", config.get("DESVIO DIREITA_Confiança (%)", 80), 0, 100),
                ("Diagonal mínima da caixa (px)", config.get("DESVIO DIREITA_Diagonal mínima da caixa (px)", config.get("DESVIO DIREITA_Box diagonal", 0)), 0, 1000),
                ("Frames seguidos", config.get("DESVIO DIREITA_Frames seguidos", 3), 1, 30),
            ]),
            ("PESSOAS", [
                ("Confiança (%)", config.get("PESSOAS_Confiança (%)", 50), 0, 100),
                ("Diagonal mínima da caixa (px)", config.get("PESSOAS_Diagonal mínima da caixa (px)", config.get("PESSOAS_Box diagonal", 0)), 0, 1000),
            ]),
            ("PONTO A", [
                ("Confiança (%)", config.get("PONTO A_Confiança (%)", config.get("PONTOS A/B/C_Confiança (%)", 40)), 0, 100),
                ("Diagonal mínima da caixa (px)", config.get("PONTO A_Diagonal mínima da caixa (px)", config.get("PONTOS A/B/C_Diagonal mínima da caixa (px)", 0)), 0, 1000),
            ]),
            ("PONTO B", [
                ("Confiança (%)", config.get("PONTO B_Confiança (%)", config.get("PONTOS A/B/C_Confiança (%)", 40)), 0, 100),
                ("Diagonal mínima da caixa (px)", config.get("PONTO B_Diagonal mínima da caixa (px)", config.get("PONTOS A/B/C_Diagonal mínima da caixa (px)", 0)), 0, 1000),
            ]),
            ("PONTO C", [
                ("Confiança (%)", config.get("PONTO C_Confiança (%)", config.get("PONTOS A/B/C_Confiança (%)", 40)), 0, 100),
                ("Diagonal mínima da caixa (px)", config.get("PONTO C_Diagonal mínima da caixa (px)", config.get("PONTOS A/B/C_Diagonal mínima da caixa (px)", 0)), 0, 1000),
            ]),
        ]

        central = QWidget()
        outer = QVBoxLayout(central)
        outer.setContentsMargins(12, 8, 12, 10)

        header = QHBoxLayout()
        title = QLabel("Interface de Controle ─ APEX")
        title.setObjectName("Title")
        title.setAlignment(Qt.AlignLeft)
        header.addWidget(title)
        header.addStretch()
        for label, key, color in (
            ("▶  Iniciar", "iniciar", GREEN),
            ("■  Parar", "parar", RED),
            ("↻  Resetar", "resetar", ORANGE),
            ("Salvar", "salvar", PURPLE),
        ):
            button = _btn(label, color)
            button.clicked.connect(lambda _, action=key: self._fire(action))
            header.addWidget(button)
        close_button = _btn("✕  Fechar", BORDER, flat_dark=True)
        close_button.setToolTip("Fechar painel")
        close_button.clicked.connect(self._close_panel)
        header.addWidget(close_button)
        outer.addLayout(header)

        # A visão fica fora das abas para permanecer disponível enquanto os
        # parâmetros são ajustados na parte inferior da tela.
        outer.addWidget(self._build_camera_area(), 1)

        tabs = QTabWidget()
        tabs.addTab(self._build_sections_tab(control_sections, show_pid=True), "Pista e direção")
        tabs.addTab(self._build_sections_tab(signal_sections), "Carro e sinais")
        tabs.addTab(self._build_vehicle_tab(), "Informações do carro")
        tabs.addTab(self._build_operations_tab(), "Conexão e registros")
        outer.addWidget(tabs, 1)

        self.window.setCentralWidget(central)

    def _build_vehicle_tab(self):
        tab = QWidget()
        tab.setObjectName("PanelContent")
        layout = QVBoxLayout(tab)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(12)

        status_card = QFrame()
        status_card.setObjectName("Card")
        status_layout = QHBoxLayout(status_card)
        status_layout.setContentsMargins(14, 10, 14, 10)
        self._vehicle_status = QLabel("AGUARDANDO DADOS")
        self._vehicle_status.setStyleSheet(f"color: {ORANGE}; font-size: 14px; font-weight: 700;")
        status_layout.addWidget(self._vehicle_status)
        status_layout.addStretch()
        self._vehicle_last_update = QLabel("Sem atualização")
        self._vehicle_last_update.setStyleSheet(f"color: {MUTED};")
        status_layout.addWidget(self._vehicle_last_update)
        layout.addWidget(status_card)

        metrics = QGridLayout()
        metrics.setHorizontalSpacing(10)
        metrics.setColumnStretch(0, 1)
        metrics.setColumnStretch(1, 1)
        metrics.setColumnStretch(2, 1)
        metrics.setColumnStretch(3, 1)
        for column, (key, label) in enumerate((
            ("speed_received", "VELOCIDADE ESTIMADA"),
            ("battery", "BATERIA"),
            ("speed_applied", "PWM APLICADO"),
            ("servo", "SERVO"),
        )):
            card = (
                self._build_battery_metric_card()
                if key == "battery"
                else self._build_metric_card(key, label)
            )
            metrics.addWidget(card, 0, column)
        layout.addLayout(metrics)
        layout.addWidget(self._build_wheel_speeds_card())

        grid = QGridLayout()
        grid.setHorizontalSpacing(14)
        grid.setVerticalSpacing(12)
        grid.setColumnStretch(0, 1)
        grid.setColumnStretch(1, 1)
        grid.addWidget(self._build_vehicle_info_card("CONTROLE E HUD", [
            ("control_mode", "Modo de controle"),
            ("error", "Erro da faixa"),
            ("pid_mode", "Modo PID"),
            ("signals", "Sinais detectados"),
        ]), 0, 0)
        grid.addWidget(self._build_sensor_card(), 0, 1)
        grid.addWidget(self._build_can_card(), 1, 0, 1, 2)
        grid.addWidget(self._build_route_card(), 2, 0, 1, 2)
        layout.addLayout(grid)

        layout.addWidget(self._section_header("ÚLTIMO RETORNO DO ARDUINO"))
        raw_card = QFrame()
        raw_card.setObjectName("Card")
        raw_layout = QVBoxLayout(raw_card)
        raw_layout.setContentsMargins(12, 10, 12, 10)
        self._vehicle_raw_rx = QLabel("Nenhum retorno recebido")
        self._vehicle_raw_rx.setWordWrap(True)
        self._vehicle_raw_rx.setStyleSheet(f"color: {TEAL}; font-size: 12px;")
        raw_layout.addWidget(self._vehicle_raw_rx)
        layout.addWidget(raw_card)
        layout.addStretch()
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setWidget(tab)
        return scroll

    def _build_wheel_speeds_card(self):
        wrap = QVBoxLayout()
        wrap.setContentsMargins(0, 0, 0, 0)
        wrap.addWidget(self._section_header("VELOCIDADE DAS RODAS"))

        card = QFrame()
        card.setObjectName("Card")
        layout = QVBoxLayout(card)
        layout.setContentsMargins(14, 10, 14, 10)
        layout.setSpacing(8)

        wheel_names = (
            ("speed1", "Roda frontal esquerda"),
            ("speed2", "Roda traseira esquerda"),
            ("speed3", "Roda frontal direita"),
            ("speed4", "Roda traseira direita"),
        )
        grid = QGridLayout()
        grid.setHorizontalSpacing(16)
        grid.setVerticalSpacing(8)
        for index, (key, name) in enumerate(wheel_names):
            row = index // 2
            column = index % 2
            wheel_layout = QVBoxLayout()
            header = QHBoxLayout()
            header.addWidget(QLabel(name))
            value = QLabel("0.0 m/s")
            value.setObjectName("StateValue")
            header.addWidget(value)
            wheel_layout.addLayout(header)

            bar = QProgressBar()
            bar.setRange(0, 100)
            bar.setValue(0)
            bar.setTextVisible(False)
            bar.setFixedHeight(12)
            bar.setStyleSheet(f"""
                QProgressBar {{
                    background-color: {CONSOLE};
                    border: 1px solid {BORDER};
                    border-radius: 5px;
                }}
                QProgressBar::chunk {{
                    background-color: {ACCENT};
                    border-radius: 4px;
                }}
            """)
            wheel_layout.addWidget(bar)
            grid.addLayout(wheel_layout, row, column)
            self._wheel_speed_bars[key] = bar
            self._wheel_speed_labels[key] = value
        layout.addLayout(grid)
        wrap.addWidget(card)
        result = QWidget()
        result.setLayout(wrap)
        return result

    def _build_metric_card(self, key, label):
        card = QFrame()
        card.setObjectName("MetricCard")
        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(12, 10, 12, 10)
        value = QLabel("--")
        value.setObjectName("MetricValue")
        card_layout.addWidget(value)
        caption = QLabel(label)
        caption.setObjectName("MetricLabel")
        card_layout.addWidget(caption)
        self._vehicle_labels[key] = value
        return card

    def _build_battery_metric_card(self):
        card = QFrame()
        card.setObjectName("MetricCard")
        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(12, 10, 12, 10)
        percentage = QLabel("--%")
        percentage.setObjectName("MetricValue")
        card_layout.addWidget(percentage)
        state = QLabel("--")
        state.setStyleSheet(f"color: {TEAL}; font-size: 11px; font-weight: 700;")
        card_layout.addWidget(state)
        caption = QLabel("BATERIA")
        caption.setObjectName("MetricLabel")
        card_layout.addWidget(caption)
        self._vehicle_labels["battery"] = percentage
        self._vehicle_labels["battery_state"] = state
        return card

    def _build_sensor_card(self):
        return self._build_vehicle_info_card("ULTRASSÔNICOS", [
            ("left", "Esquerdo"),
            ("f_left", "Frontal esquerdo"),
            ("f_right", "Frontal direito"),
            ("right", "Direito"),
        ])

    def _build_route_card(self):
        wrap = QVBoxLayout()
        wrap.setContentsMargins(0, 0, 0, 0)
        wrap.addWidget(self._section_header("PONTOS DE PARADA"))

        card = QFrame()
        card.setObjectName("Card")
        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(14, 10, 14, 10)
        card_layout.setSpacing(8)

        selector_row = QHBoxLayout()
        selector_row.addWidget(QLabel("Adicionar ponto"))
        selector_row.addStretch()
        self._route_point_combo = QComboBox()
        self._route_point_combo.addItems(["A", "B", "C"])
        self._route_point_combo.setCurrentText("A")
        self._route_point_combo.setMinimumWidth(80)
        selector_row.addWidget(self._route_point_combo)

        add_btn = _btn("Adicionar", GREEN)
        add_btn.clicked.connect(self._add_route_point)
        selector_row.addWidget(add_btn)
        card_layout.addLayout(selector_row)
        
        add_btn = _btn("Resetar Rota", RED)
        add_btn.clicked.connect(self.nav._reset_route)
        selector_row.addWidget(add_btn)
        card_layout.addLayout(selector_row)
        

        route_row = QHBoxLayout()
        route_row.addWidget(QLabel("Rota atual"))
        route_row.addStretch()
        self._route_display = QLabel("Nenhum ponto")
        self._route_display.setObjectName("StateValue")
        self._route_display.setWordWrap(True)
        route_row.addWidget(self._route_display)
        card_layout.addLayout(route_row)

        wrap.addWidget(card)
        result = QWidget()
        result.setLayout(wrap)
        result.setStyleSheet(f"QFrame#Card {{ background-color: {CARD}; border: 1px solid {BORDER}; border-radius: 8px; }}")
        self._update_route_display()
        return result

    def _add_route_point(self):
        if self._route_point_combo is None:
            return
        point = self._route_point_combo.currentText().strip()
        if not point:
            return
        if self.nav is not None:
            try:
                self.nav.add_point(point)
            except Exception:
                pass
        self._update_route_display()

    def _update_route_display(self):
        if self.nav is not None and hasattr(self.nav, "route"):
            route = getattr(self.nav, "route", [])
            points = [str(item) for item in route]
            text = " → ".join(points) if points else "Nenhum ponto"
        else:
            text = "Nenhum ponto"
        if hasattr(self, "_route_display") and self._route_display is not None:
            self._route_display.setText(text)

    def _build_can_card(self):
        wrap = QVBoxLayout()
        wrap.setContentsMargins(0, 0, 0, 0)
        wrap.addWidget(self._section_header("MÓDULOS"))
        self._can_card = QFrame()
        self._can_card.setObjectName("Card")
        self._can_layout = QVBoxLayout(self._can_card)
        self._can_layout.setContentsMargins(14, 10, 14, 10)
        self._can_layout.setSpacing(7)
        self._can_layout.addWidget(QLabel("Nenhum módulo conectado"))
        wrap.addWidget(self._can_card)
        result = QWidget()
        result.setLayout(wrap)
        return result

    def _update_can_modules(self, modules):
        signature = tuple(sorted((str(name), repr(state)) for name, state in modules.items()))
        if signature == self._can_modules_signature:
            return
        self._can_modules_signature = signature

        while self._can_layout.count():
            item = self._can_layout.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.deleteLater()

        if not modules:
            self._can_layout.addWidget(QLabel("Nenhum módulo conectado"))
            return

        for name, enabled in sorted(modules.items(), key=lambda item: str(item[0])):
            row = QHBoxLayout()
            row.addWidget(QLabel(str(name)))
            row.addStretch()
            value = QLabel(self._format_module(enabled))
            value.setObjectName("StateValue")
            value.setMinimumWidth(92)
            value.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
            row.addWidget(value)
            self._can_layout.addLayout(row)

    def _build_vehicle_info_card(self, title, fields):
        wrap = QVBoxLayout()
        wrap.setContentsMargins(0, 0, 0, 0)
        wrap.addWidget(self._section_header(title))
        card = QFrame()
        card.setObjectName("Card")
        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(14, 10, 14, 10)
        card_layout.setSpacing(7)
        for key, label in fields:
            row = QHBoxLayout()
            row.addWidget(QLabel(label))
            row.addStretch()
            value = QLabel("--")
            value.setObjectName("StateValue")
            value.setMinimumWidth(92)
            value.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
            row.addWidget(value)
            card_layout.addLayout(row)
            self._vehicle_labels[key] = value
        wrap.addWidget(card)
        result = QWidget()
        result.setLayout(wrap)
        return result

    def _build_camera_area(self):
        area = QWidget()
        area.setObjectName("PanelContent")
        layout = QVBoxLayout(area)
        layout.setContentsMargins(10, 12, 10, 10)
        layout.addWidget(QLabel("Câmeras ao vivo — atualização de até 30 FPS, sem fila de frames."))

        frames = QHBoxLayout()
        frames.setSpacing(10)
        for key, title, subtitle in (
            ("road", "CÂMERA DA PISTA", "Imagem original com região de interesse"),
            ("bird", "BIRD-EYE VIEW", "Bird-eye view e detecção de faixas"),
            ("sign", "SINAIS", "Elementos detectados pelo modelo de IA"),
        ):
            camera_wrap = QVBoxLayout()
            camera_wrap.setContentsMargins(0, 0, 0, 0)
            camera_wrap.addWidget(self._section_header(title))

            card = QFrame()
            card.setObjectName("Card")
            card_layout = QVBoxLayout(card)
            card_layout.setContentsMargins(8, 8, 8, 8)
            image = QLabel("Aguardando câmera")
            image.setAlignment(Qt.AlignCenter)
            image.setMinimumSize(300, 220)
            image.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
            image.setStyleSheet(f"background: {CONSOLE}; color: {MUTED}; border-radius: 4px;")
            card_layout.addWidget(image, 1)
            description = QLabel(subtitle)
            description.setStyleSheet(f"color: {MUTED}; font-size: 9px;")
            card_layout.addWidget(description)
            self._preview_labels[key] = image
            camera_wrap.addWidget(card, 1)
            camera_widget = QWidget()
            camera_widget.setLayout(camera_wrap)
            frames.addWidget(camera_widget, 1)
        layout.addLayout(frames, 1)
        return area

    def update_camera_id(self, camera_id):
        """Atualiza o ID exibido sem acessar widgets fora do thread do Qt."""
        self._bridge.camera_id_received.emit(int(camera_id))

    def _apply_camera_id(self, camera_id):
        self._camera_idx = camera_id
        if self._camera_id_label is not None:
            self._camera_id_label.setText(str(camera_id))

    def _build_sections_tab(self, sections, show_pid=False):
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        content = QWidget()
        content.setObjectName("PanelContent")
        grid = QGridLayout(content)
        grid.setContentsMargins(12, 12, 12, 12)
        grid.setHorizontalSpacing(14)
        grid.setVerticalSpacing(16)
        grid.setColumnStretch(0, 1)
        grid.setColumnStretch(1, 1)
        row_offset = 0
        if show_pid:
            grid.addWidget(self._build_pid_info_card(), 0, 0, 1, 2, Qt.AlignTop)
            row_offset = 1
        for index, (name, controls) in enumerate(sections):
            grid.addWidget(self._build_section(name, controls), row_offset + index // 2, index % 2, Qt.AlignTop)
        grid.setRowStretch(row_offset + (len(sections) + 1) // 2, 1)
        scroll.setWidget(content)
        return scroll

    def _build_pid_info_card(self):
        wrap = QVBoxLayout()
        wrap.setContentsMargins(0, 0, 0, 0)
        wrap.addWidget(self._section_header("PID DA DIREÇÃO"))

        card = QFrame()
        card.setObjectName("Card")
        layout = QVBoxLayout(card)
        layout.setContentsMargins(12, 10, 12, 10)

        values = QGridLayout()
        values.setHorizontalSpacing(18)
        for column, prefix in enumerate(("RETA", "CURVA", "CURVA FECHADA")):
            title = QLabel(prefix)
            title.setStyleSheet(f"color: {TEAL}; font-weight: 700;")
            values.addWidget(title, 0, column)
            for row, term in enumerate(("Kp", "Ki", "Kd"), start=1):
                label = QLabel(f"{term}: --")
                label.setObjectName("StateValue")
                values.addWidget(label, row, column)
                self._pid_labels[f"{prefix}_{term}"] = label
        layout.addLayout(values)
        wrap.addWidget(card)
        result = QWidget()
        result.setLayout(wrap)
        return result

    def _build_operations_tab(self):
        tab = QWidget()
        tab.setObjectName("PanelContent")
        grid = QGridLayout(tab)
        grid.setContentsMargins(12, 12, 12, 12)
        grid.setColumnStretch(0, 1)
        grid.setColumnStretch(1, 1)
        if self._dashboard_url:
            grid.addWidget(self._build_connection_box(), 0, 0, 1, 1, Qt.AlignTop)
            grid.addWidget(self._build_dashboard_box(), 0, 1, 1, 1, Qt.AlignTop)
            grid.addWidget(self._build_remote_box(), 1, 0, 1, 1, Qt.AlignTop)
            log_row = 2
        else:
            grid.addWidget(self._build_connection_box(), 0, 0, 1, 2, Qt.AlignTop)
            grid.addWidget(self._build_remote_box(), 1, 0, 1, 2, Qt.AlignTop)
            log_row = 2
        grid.addWidget(self._build_log_box(), log_row, 0, 1, 2)
        grid.setRowStretch(log_row + 1, 1)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setWidget(tab)
        return scroll

    def _section_header(self, text):
        header = QHBoxLayout()
        lbl = QLabel(text)
        lbl.setObjectName("SectionHeader")
        header.addWidget(lbl)
        line = QFrame()
        line.setObjectName("Separator")
        header.addWidget(line, 1)
        wrap = QWidget()
        wrap.setObjectName("SectionHeaderContainer")
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
            slider_value = self._slider_value(key, default)
            value = self._control_value(key, slider_value)
            self.vars[key] = value

            row = QVBoxLayout()
            top = QHBoxLayout()
            lbl = QLabel(label)
            top.addWidget(lbl)
            top.addStretch()
            val_lbl = QLabel(self._format_control_value(key, value))
            val_lbl.setStyleSheet(f"color: {ACCENT}; font-weight: 700;")
            top.addWidget(val_lbl)
            row.addLayout(top)

            slider = QSlider(Qt.Horizontal)
            slider.setMinimum(mn)
            slider.setMaximum(mx)
            slider.setValue(slider_value)
            if self._is_speed_key(key):
                slider.setObjectName("SpeedSlider")
            slider.valueChanged.connect(
                lambda v, k=key, vl=val_lbl: self._on_slider_change(k, v, vl)
            )
            row.addWidget(slider)

            if self._is_speed_key(key):
                warning = QLabel("⚠ Valores abaixo de 30 PWM são tratados como 0 — mínimo para movimentar o carro.")
                warning.setWordWrap(True)
                warning.setStyleSheet(f"color: {RED}; font-size: 9px; font-weight: 700;")
                row.addWidget(warning)

            self.val_labels[key] = val_lbl
            self.sliders[key] = slider

            row_wrap = QWidget()
            row_wrap.setObjectName("ControlField")
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
        value = self._control_value(key, value)
        self.vars[key] = value
        val_label.setText(self._format_control_value(key, value))
        if self._dashboard_url:
            self._push_key(key, value)

    def _set_value(self, key, val):
        self.vars[key] = val
        if key in self.sliders:
            self.sliders[key].blockSignals(True)
            self.sliders[key].setValue(self._slider_value(key, val))
            self.sliders[key].blockSignals(False)
        if key in self.val_labels:
            self.val_labels[key].setText(self._format_control_value(key, val))

    @staticmethod
    def _is_speed_key(key):
        return key in (
            "PARÂMETROS DO CARRO_PWM",
            "PARÂMETROS DO CARRO_Velocidade na curva (PWM)",
        )

    def adjust_speed(self, delta):
        """Solicita um ajuste de velocidade no loop principal do Qt."""
        self._bridge.speed_adjust_requested.emit(float(delta))

    def _adjust_speed(self, delta):
        key = "PARÂMETROS DO CARRO_PWM"
        current = float(self.vars.get(key, 0.0))
        value = round(max(0.0, min(255.0, current + delta)))
        self._set_value(key, value)
        if self._dashboard_url:
            self._push_key(key, value)

    def _control_value(self, key, slider_value):
        if self._is_speed_key(key):
            return int(slider_value)
        return int(slider_value)

    def _slider_value(self, key, value):
        if self._is_speed_key(key):
            return max(0, min(255, round(float(value))))
        return int(value)

    def _format_control_value(self, key, value):
        if self._is_speed_key(key):
            return f"{int(value)} PWM"
        return str(value)

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

        camera_id_row = QHBoxLayout()
        camera_id_row.addWidget(QLabel("ID da câmera"))
        camera_id_row.addStretch()
        camera_id = QLabel(str(self._camera_idx))
        camera_id.setObjectName("StateValue")
        camera_id.setMinimumWidth(42)
        camera_id.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
        camera_id_row.addWidget(camera_id)
        self._camera_id_label = camera_id
        card_layout.addLayout(camera_id_row)

        self._test_mode_check = QCheckBox("Sem Arduino (modo teste)")
        self._test_mode_check.setChecked(self._initial_test_mode)
        card_layout.addWidget(self._test_mode_check)

        wrap_layout.addWidget(card)

        reconnect_btn = _btn("Reconectar", TEAL)
        reconnect_btn.clicked.connect(self._reconectar)
        wrap_layout.addWidget(reconnect_btn)

        wrap = QWidget()
        wrap.setLayout(wrap_layout)
        return wrap

    def _build_remote_box(self):
        layout = QVBoxLayout()
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(self._section_header("CONTROLE REMOTO"))

        card = QFrame()
        card.setObjectName("Card")
        card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(14, 10, 14, 10)
        card_layout.setSpacing(8)

        self._remote_status_label = QLabel(self.remote_control.feedback)
        self._remote_status_label.setObjectName("StateValue")
        self._remote_status_label.setWordWrap(True)
        self._remote_status_label.setStyleSheet(f"color: {TEAL}; font-size: 11px;")
        card_layout.addWidget(self._remote_status_label)

        row = QHBoxLayout()
        connect_btn = _btn("Conectar", GREEN)
        connect_btn.clicked.connect(self._connect_remote)
        disconnect_btn = _btn("Desconectar", RED)
        disconnect_btn.clicked.connect(self._disconnect_remote)
        row.addWidget(connect_btn)
        row.addWidget(disconnect_btn)
        card_layout.addLayout(row)

        layout.addWidget(card)
        wrap = QWidget()
        wrap.setLayout(layout)
        return wrap

    def _connect_remote(self):
        try:
            self.remote_control.connect()
            msg = self.remote_control.feedback
            if hasattr(self, "_remote_status_label") and self._remote_status_label is not None:
                self._remote_status_label.setText(msg)
            self.log(f"[REMOTE] {msg}", "info" if self.remote_control.connected else "warn")
        except Exception as exc:
            msg = f"Erro ao conectar ao controle remoto: {exc}"
            if hasattr(self, "_remote_status_label") and self._remote_status_label is not None:
                self._remote_status_label.setText(msg)
            self.log(f"[REMOTE] {msg}", "error")

    def _disconnect_remote(self):
        try:
            if hasattr(self.remote_control, "disconnect"):
                self.remote_control.disconnect()
            msg = self.remote_control.feedback
            if hasattr(self, "_remote_status_label") and self._remote_status_label is not None:
                self._remote_status_label.setText(msg)
            self.log(f"[REMOTE] {msg}", "info")
        except Exception as exc:
            msg = f"Erro ao desconectar do controle remoto: {exc}"
            if hasattr(self, "_remote_status_label") and self._remote_status_label is not None:
                self._remote_status_label.setText(msg)
            self.log(f"[REMOTE] {msg}", "error")

    def _build_actions_box(self):
        layout = QVBoxLayout()
        layout.setContentsMargins(0, 12, 0, 0)
        layout.addWidget(self._section_header("AÇÕES"))

        buttons = [
            ("▶  Iniciar",  "iniciar",  GREEN),
            ("■  Parar",    "parar",    RED),
            ("↺  Resetar",  "resetar",  ORANGE),
            ("Salvar",   "salvar",   PURPLE),
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
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(self._section_header("MENSAGERIA"))

        card = QFrame()
        card.setObjectName("Card")
        card_layout = QVBoxLayout(card)
        card_layout.setSpacing(6)

        url_lbl = QLabel(f"API: {self._dashboard_url}")
        url_lbl.setStyleSheet(f"color: {MUTED}; font-size: 8px;")
        url_lbl.setWordWrap(True)
        card_layout.addWidget(url_lbl)

        open_btn = _btn("Abrir Digital Twin", GREEN)
        open_btn.clicked.connect(lambda: webbrowser.open(self._dashboard_url))
        card_layout.addWidget(open_btn)

        copy_btn = _btn("Copiar link", BORDER, flat_dark=True)

        def _copy_link():
            self._app.clipboard().setText(self._dashboard_url)
            copy_btn.setText("Copiado!")
            QTimer.singleShot(1500, lambda: copy_btn.setText("Copiar link"))

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
        self._bridge.log_received.emit(str(msg), tag)

    def _append_log(self, msg, tag):
        ts = time.strftime("%H:%M:%S")
        color = LOG_COLORS.get(tag, FG)
        self._log_text.append(f'<span style="color:{MUTED}">[{ts}]</span> '
                               f'<span style="color:{color}">{msg}</span>')
        self._log_text.moveCursor(QTextCursor.MoveOperation.End)
        self._log_text.verticalScrollBar().setValue(
            self._log_text.verticalScrollBar().maximum()
        )

    def _clear_log(self):
        self._log_text.clear()

    def _close_panel(self):
        for timer_name in ("_poll_timer", "_preview_timer"):
            timer = getattr(self, timer_name, None)
            if timer is not None:
                timer.stop()
        self.running = False
        self.window.close()

    # ── Visualização de câmera ────────────────────────────────────────────
    def update_frames(self, road_frame, bird_frame, sign_frame):
        """Disponibiliza frames BGR ao painel sem bloquear a thread de visão.

        A cada chamada a amostra anterior é descartada. O Qt exibe apenas a
        última imagem disponível em seu próprio timer, sem backlog nem atraso
        no processamento que controla o carro.
        """
        with self._preview_lock:
            self._latest_frames = {
                "road": road_frame,
                "bird": bird_frame,
                "sign": sign_frame,
            }

    def update_vehicle_info(self, info):
        """Agenda no loop do Qt a atualização dos dados do veículo."""
        self._bridge.vehicle_info_received.emit(dict(info))

    def _apply_vehicle_info(self, info):
        values = info.get("hud", {})
        car_telemetry = self.car.telemetry if self.car is not None else None
        display = {
            "control_mode": str(values.get("control_mode", "--")),
            "error": str(values.get("error", "--")),
            "servo": f"{values.get('servo', '--')}°",
            "speed_received": self._format_number(
                car_telemetry.speed if car_telemetry is not None else None, " m/s"
            ),
            "battery": self._format_number(
                car_telemetry.battery if car_telemetry is not None else None, "%"
            ),
            "battery_state": self._format_battery_state(
                car_telemetry.battery_state if car_telemetry is not None else None
            ),
            "speed_applied": self._format_number(values.get("speed"), " PWM"),
            "pid_mode": str(values.get("pid_mode", "--")),
            "signals": str(values.get("signals", "--")),
            "left": self._format_sensor(
                car_telemetry.left if car_telemetry is not None else None
            ),
            "f_left": self._format_sensor(
                car_telemetry.f_left if car_telemetry is not None else None
            ),
            "f_right": self._format_sensor(
                car_telemetry.f_right if car_telemetry is not None else None
            ),
            "right": self._format_sensor(
                car_telemetry.right if car_telemetry is not None else None
            ),
        }
        for key in self._wheel_speed_bars:
            wheel_speed = getattr(car_telemetry, key, 0.0) if car_telemetry is not None else 0.0
            try:
                wheel_speed = max(0.0, float(wheel_speed))
            except (TypeError, ValueError):
                wheel_speed = 0.0
            self._wheel_speed_bars[key].setValue(min(100, round(wheel_speed * 10)))
            self._wheel_speed_labels[key].setText(f"{wheel_speed:.1f} m/s")
        for key, text in display.items():
            if key in self._vehicle_labels:
                self._vehicle_labels[key].setText(text)
        self._update_can_modules(
            car_telemetry.can if car_telemetry is not None else {}
        )
        if hasattr(self, "_route_display") and self._route_display is not None:
            route_text = str(values.get("route") or "Nenhum ponto")
            self._route_display.setText(route_text)
        for prefix, value_key in (
            ("RETA", "reta"),
            ("CURVA", "curva"),
            ("CURVA FECHADA", "curva_fechada"),
        ):
            pid_values = values.get(value_key, {})
            for term in ("Kp", "Ki", "Kd"):
                label = self._pid_labels.get(f"{prefix}_{term}")
                if label is not None:
                    label.setText(f"{term}: {pid_values.get(term.lower(), '--')}")
        running = values.get("running", False)
        self._vehicle_status.setText("EM MOVIMENTO" if running else "PARADO")
        self._vehicle_status.setStyleSheet(
            f"color: {GREEN if running else RED}; font-size: 14px; font-weight: 700;"
        )
        self._vehicle_last_update.setText(time.strftime("Atualizado às %H:%M:%S"))
        self._vehicle_raw_rx.setText(str(info.get("raw_rx") or "Nenhum retorno recebido"))

    @staticmethod
    def _format_number(value, suffix=""):
        if value is None:
            return "--"
        try:
            number = float(value)
            text = f"{number:.1f}" if not number.is_integer() else str(int(number))
            return f"{text}{suffix}"
        except (TypeError, ValueError):
            return "--"

    @staticmethod
    def _format_battery_state(value):
        labels = (
            "Sem corrente",
            "Carregando",
            "Carregada",
            "Descarregando",
            "Bateria baixa",
        )
        try:
            state = int(value)
        except (TypeError, ValueError):
            return "--"
        return labels[state] if 0 <= state < len(labels) else "--"

    @staticmethod
    def _format_sensor(value):
        labels = {
            0: ("LIVRE", GREEN),
            1: ("DISTANTE", ACCENT),
            2: ("PRÓXIMA", ORANGE),
            3: ("CRÍTICA", RED),
        }
        try:
            label, color = labels[int(value)]
        except (KeyError, TypeError, ValueError):
            return "--"
        return f'<span style="color:{color}; font-weight:700">{label}</span>'

    @staticmethod
    def _format_module(value):
        if value is True:
            return '<span style="color:#a6e3a1; font-weight:700">ATIVADO</span>'
        if value is False:
            return '<span style="color:#f38ba8; font-weight:700">DESATIVADO</span>'
        return "--"

    def _present_latest_frames(self):
        with self._preview_lock:
            frames = self._latest_frames
            self._latest_frames = None
        if not frames:
            return

        for key, frame in frames.items():
            label = self._preview_labels.get(key)
            if label is None or frame is None or getattr(frame, "size", 0) == 0:
                continue
            height, width = frame.shape[:2]
            if len(frame.shape) == 2:
                image = QImage(frame.data, width, height, frame.strides[0], QImage.Format_Grayscale8)
            else:
                image = QImage(frame.data, width, height, frame.strides[0], QImage.Format_BGR888)
            pixmap = QPixmap.fromImage(image)
            label.setPixmap(pixmap.scaled(label.size(), Qt.KeepAspectRatio, Qt.SmoothTransformation))

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
        self.window.showFullScreen()
        self._app.exec()


if __name__ == "__main__":
    panel = ControlPanel(1280, 720)
    panel.run()
