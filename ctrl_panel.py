import tkinter as tk
from tkinter import ttk
import json
import os
import time
import qrcode
from PIL import ImageTk

class ControlPanel:
    def __init__(self, width, height, test_mode=False, dashboard_url="", twin_path="", initial_cam_idx=1):
        self.root = tk.Tk()
        self.root.title("Controles")
        self.root.configure(bg="#1e1e2e")
        self.root.geometry("900x750")
        self.root.resizable(True, True)

        self.config_path = "config/config.json"
        self.frame_width  = width
        self.frame_height = height
        self.running      = False
        self._initial_test_mode = test_mode
        self._dashboard_url = dashboard_url
        self._twin_path     = twin_path
        self._initial_cam_idx = initial_cam_idx

        self.vars               = {}
        self.val_labels         = {}
        self.callbacks          = {}
        self._last_local_change = 0.0
        self._applying_server   = False
        self._build_ui()
        self._register_callbacks()
        if self._dashboard_url:
            self.root.after(2000, self._poll_server)

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
        with open(self.config_path, "w") as f:
            json.dump({k: var.get() for k, var in self.vars.items()}, f, indent=4)
        self.log("[PAINEL] Configurações salvas", "info")

    def _resetar(self):
        if not os.path.exists(self.config_path):
            self.log("[PAINEL] Nenhum config.json encontrado", "error")
            return
        with open(self.config_path, "r") as f:
            config = json.load(f)
        for key, var in self.vars.items():
            if key in config:
                var.set(config[key])
                if key in self.val_labels:
                    self.val_labels[key].config(text=str(config[key]))
        self.log("[PAINEL] Valores restaurados do config.json", "info")
        if self._dashboard_url and not self._applying_server:
            self._push_all(config)

    def get_connection(self):
        """Retorna (com, cam_idx) se reconexão foi pedida, senão None. com=None = modo teste."""
        if getattr(self, "_reconnect_pending", False):
            self._reconnect_pending = False
            com = None if self._test_mode_var.get() else self._com_var.get()
            return com, self._cam_var.get()
        return None

    def _show_qrcode(self):
        qr = qrcode.QRCode(box_size=6, border=3)
        qr.add_data(self._dashboard_url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="#cdd6f4", back_color="#1e1e2e")
        top = tk.Toplevel(self.root)
        top.title("QR Code — Dashboard")
        top.configure(bg="#1e1e2e")
        top.resizable(False, False)
        photo = ImageTk.PhotoImage(img)
        tk.Label(top, image=photo, bg="#1e1e2e", bd=0).pack(padx=20, pady=(20, 8))
        top._qr_photo = photo
        tk.Label(top, text=self._dashboard_url, bg="#1e1e2e", fg="#89b4fa",
                 font=("Courier", 8)).pack(pady=(0, 16))

    def _push_all(self, data: dict):
        if self._applying_server:
            return
        self._last_local_change = time.time()
        import threading, urllib.request, json as _json
        def _post():
            try:
                raw = _json.dumps(data).encode()
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

    def _refresh_ports(self):
        from serial.tools import list_ports
        devices = [p.device for p in list_ports.comports()]
        self._com_combo["values"] = devices
        if devices and self._com_var.get() not in devices:
            self._com_var.set(devices[0])
        self.log(f"[CONEXÃO] Portas atualizadas: {devices}", "info")

    def _reconectar(self):
        if not self._test_mode_var.get() and not self._com_var.get():
            self.log("[CONEXÃO] Selecione uma porta COM ou ative o modo teste", "warn")
            return
        self._reconnect_pending = True
        if self._test_mode_var.get():
            self.log(f"[CONEXÃO] Modo teste ativado  CAM={self._cam_var.get()}", "info")
        else:
            self.log(f"[CONEXÃO] Reconectando → COM={self._com_var.get()}  CAM={self._cam_var.get()}", "info")

    def _register_callbacks(self):
        self.on("iniciar",  self._iniciar)
        self.on("parar",    self._parar)
        self.on("resetar",  self._resetar)
        self.on("salvar",   self._salvar)

    def _build_ui(self):
        config_path = self.config_path
        config = {}
        if os.path.exists(config_path):
            with open(config_path, "r") as f:
                config = json.load(f)

        ACCENT = "#89b4fa"
        BG     = "#1e1e2e"
        CARD   = "#313244"
        FG     = "#cdd6f4"

        style = ttk.Style()
        style.theme_use("clam")
        style.configure("TScale",
            background=CARD,
            troughcolor="#45475a",
            sliderlength=18,
            sliderrelief="flat",
        )
        style.configure("TCombobox",
            background=CARD,
            fieldbackground=BG,
            foreground=FG,
            arrowcolor=ACCENT,
            bordercolor="#45475a",
            lightcolor=CARD,
            darkcolor=CARD,
        )
        style.map("TCombobox",
            background=[("readonly", CARD)],
            fieldbackground=[("readonly", BG)],
            foreground=[("readonly", FG)],
        )

        sections = [
            ("ROI", [
                ("Linha superior", config.get("ROI_Linha superior", 1280), 0, self.frame_width),
                ("Linha inferior", config.get("ROI_Linha inferior", 1280), 0, self.frame_width),
                ("Altura sup",     config.get("ROI_Altura sup", 263),      0, self.frame_height),
                ("Altura inf",     config.get("ROI_Altura inf", 541),      0, self.frame_height),
            ]),
            ("IMAGEM", [
                ("Limiar",           config.get("IMAGEM_Limiar", 195),            0, 255),
                ("Erro de transição",config.get("IMAGEM_Erro de transição", 12),  0, 100),
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

        buttons = [
            ("▶  Iniciar",  "iniciar"),
            ("■  Parar",    "parar"),
            ("↺  Resetar",  "resetar"),
            ("⚙  Calibrar", "calibrar"),
            ("💾  Salvar",  "salvar"),
        ]

        tk.Label(
            self.root,
            text="Painel de Controle",
            bg=BG, fg=FG,
            font=("Courier", 14, "bold"),
        ).pack(pady=(12, 0))

        canvas = tk.Canvas(self.root, bg=BG, highlightthickness=0)
        v_scroll = ttk.Scrollbar(self.root, orient="vertical", command=canvas.yview)
        canvas.configure(yscrollcommand=v_scroll.set)

        v_scroll.pack(side="right", fill="y")
        canvas.pack(side="left", fill="both", expand=True)

        root_frame = tk.Frame(canvas, bg=BG)
        win = canvas.create_window((0, 0), window=root_frame, anchor="nw")

        root_frame.bind("<Configure>", lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.bind("<Configure>", lambda e: canvas.itemconfig(win, width=e.width))

        root_frame.columnconfigure(0, weight=1)
        root_frame.columnconfigure(1, weight=1)
        root_frame.columnconfigure(2, weight=0)

        rows = [
            sections[0:2],
            sections[2:4],
            sections[4:6],
        ]

        for r, row_sections in enumerate(rows):
            for c, (section_name, controls) in enumerate(row_sections):
                col_frame = tk.Frame(root_frame, bg=BG)
                col_frame.grid(row=r, column=c, sticky="nwe", padx=(10, 10), pady=(12, 0))

                header = tk.Frame(col_frame, bg=BG)
                header.pack(fill="x", pady=(0, 6))

                tk.Label(header, text=section_name,
                         bg=BG, fg=ACCENT,
                         font=("Courier", 10, "bold")).pack(side="left")

                sep = tk.Frame(header, bg="#45475a", height=1)
                sep.pack(side="left", fill="x", expand=True, padx=(8, 0), pady=6)

                card = tk.Frame(col_frame, bg=CARD)
                card.pack(fill="x")

                for i, (label, default, mn, mx) in enumerate(controls):
                    key = f"{section_name}_{label}"
                    var = tk.IntVar(value=default)
                    self.vars[key] = var

                    row_frame = tk.Frame(card, bg=CARD)
                    row_frame.pack(fill="x", padx=12, pady=6)

                    top = tk.Frame(row_frame, bg=CARD)
                    top.pack(fill="x")

                    tk.Label(top, text=label, bg=CARD, fg=FG,
                             font=("Courier", 9)).pack(side="left")

                    val_label = tk.Label(top, text=str(default),
                                         bg=CARD, fg=ACCENT,
                                         font=("Courier", 9, "bold"), width=6, anchor="e")
                    val_label.pack(side="right")
                    self.val_labels[key] = val_label

                    def make_cmd(vl, k):
                        def cmd(val):
                            vl.config(text=str(int(float(val))))
                            if self._dashboard_url:
                                self._push_key(k, int(float(val)))
                        return cmd

                    slider = ttk.Scale(row_frame, from_=mn, to=mx, orient="horizontal",
                                       variable=var, command=make_cmd(val_label, key),
                                       length=180)
                    slider.pack(fill="x", pady=(2, 0))

                    if i < len(controls) - 1:
                        tk.Frame(card, bg="#45475a", height=1).pack(fill="x", padx=12)

        # ── Botões ──────────────────────────────────────────────────────
        btn_frame = tk.Frame(root_frame, bg=BG)
        btn_frame.grid(row=0, column=2, rowspan=len(rows), sticky="n", padx=(8, 10), pady=(12, 0))

        # ── CONEXÃO ─────────────────────────────────────────────────────
        conn_header = tk.Frame(btn_frame, bg=BG)
        conn_header.pack(fill="x", pady=(0, 6))
        tk.Label(conn_header, text="CONEXÃO",
                 bg=BG, fg=ACCENT,
                 font=("Courier", 10, "bold")).pack(side="left")
        tk.Frame(conn_header, bg="#45475a", height=1).pack(
            side="left", fill="x", expand=True, padx=(8, 0), pady=6)

        conn_card = tk.Frame(btn_frame, bg=CARD)
        conn_card.pack(fill="x", pady=(0, 4))

        # COM row
        com_row = tk.Frame(conn_card, bg=CARD)
        com_row.pack(fill="x", padx=8, pady=(8, 4))
        tk.Label(com_row, text="COM", bg=CARD, fg=FG,
                 font=("Courier", 9), width=7, anchor="w").pack(side="left")
        from serial.tools import list_ports as _lp
        _ports = [p.device for p in _lp.comports()]
        self._com_var = tk.StringVar(value=_ports[0] if _ports else "")
        self._com_combo = ttk.Combobox(
            com_row, textvariable=self._com_var,
            values=_ports, width=7, state="readonly",
            font=("Courier", 9))
        self._com_combo.pack(side="left", padx=(4, 4))
        tk.Button(com_row, text="↻",
                  bg=CARD, fg=ACCENT,
                  font=("Courier", 11, "bold"), relief="flat", bd=0,
                  cursor="hand2", activebackground=CARD, activeforeground=ACCENT,
                  command=self._refresh_ports).pack(side="left")

        tk.Frame(conn_card, bg="#45475a", height=1).pack(fill="x", padx=8)

        # CAM row
        cam_row = tk.Frame(conn_card, bg=CARD)
        cam_row.pack(fill="x", padx=8, pady=(4, 0))
        tk.Label(cam_row, text="CAM idx", bg=CARD, fg=FG,
                 font=("Courier", 9), width=7, anchor="w").pack(side="left")
        self._cam_var = tk.IntVar(value=self._initial_cam_idx)
        tk.Spinbox(cam_row, from_=0, to=5,
                   textvariable=self._cam_var,
                   width=4, bg="#45475a", fg=FG,
                   buttonbackground="#45475a",
                   relief="flat", bd=0,
                   font=("Courier", 9)).pack(side="left", padx=(4, 0))

        tk.Frame(conn_card, bg="#45475a", height=1).pack(fill="x", padx=8, pady=(6, 0))

        # Sem Arduino
        self._test_mode_var = tk.BooleanVar(value=self._initial_test_mode)
        tk.Checkbutton(conn_card,
                       text="Sem Arduino (modo teste)",
                       variable=self._test_mode_var,
                       bg=CARD, fg=FG,
                       selectcolor="#45475a",
                       activebackground=CARD, activeforeground=FG,
                       font=("Courier", 8)).pack(anchor="w", padx=8, pady=(4, 8))

        tk.Button(btn_frame,
                  text="🔌 Reconectar",
                  bg="#94e2d5", fg="#1e1e2e",
                  font=("Courier", 9, "bold"),
                  relief="flat", bd=0,
                  padx=16, pady=8, width=14, cursor="hand2",
                  activebackground="#94e2d5", activeforeground="#1e1e2e",
                  command=self._reconectar).pack(fill="x", pady=(0, 4))

        tk.Frame(btn_frame, bg="#45475a", height=1).pack(fill="x", pady=(0, 10))

        # ── AÇÕES ───────────────────────────────────────────────────────
        tk.Label(btn_frame, text="AÇÕES",
                 bg=BG, fg=ACCENT,
                 font=("Courier", 10, "bold")).pack(anchor="w", pady=(0, 8))

        BTN_COLORS = {
            "iniciar":  ("#a6e3a1", "#1e1e2e"),
            "parar":    ("#f38ba8", "#1e1e2e"),
            "resetar":  ("#fab387", "#1e1e2e"),
            "calibrar": ("#89b4fa", "#1e1e2e"),
            "salvar":   ("#cba6f7", "#1e1e2e"),
        }

        for label, key in buttons:
            bg_color, fg_color = BTN_COLORS.get(key, ("#45475a", "#cdd6f4"))
            btn = tk.Button(
                btn_frame,
                text=label,
                bg=bg_color, fg=fg_color,
                font=("Courier", 9, "bold"),
                relief="flat", bd=0,
                padx=16, pady=8,
                width=14,
                cursor="hand2",
                activebackground=bg_color,
                activeforeground=fg_color,
                command=lambda k=key: self._fire(k),
            )
            btn.pack(fill="x", pady=4)

        # ── MENSAGERIA ──────────────────────────────────────────────────
        if self._dashboard_url:
            import webbrowser
            tk.Frame(btn_frame, bg="#45475a", height=1).pack(fill="x", pady=(12, 6))

            msg_header = tk.Frame(btn_frame, bg=BG)
            msg_header.pack(fill="x", pady=(0, 4))
            tk.Label(msg_header, text="MENSAGERIA",
                     bg=BG, fg=ACCENT,
                     font=("Courier", 10, "bold")).pack(side="left")
            tk.Frame(msg_header, bg="#45475a", height=1).pack(
                side="left", fill="x", expand=True, padx=(8, 0), pady=6)

            msg_card = tk.Frame(btn_frame, bg=CARD)
            msg_card.pack(fill="x")

            tk.Label(msg_card,
                     text=f"API: {self._dashboard_url}",
                     bg=CARD, fg="#6c7086",
                     font=("Courier", 7),
                     wraplength=170).pack(padx=8, pady=(6, 2))

            tk.Button(msg_card,
                      text="🚗 Abrir Digital Twin",
                      bg="#a6e3a1", fg="#1e1e2e",
                      font=("Courier", 8, "bold"),
                      relief="flat", bd=0,
                      padx=8, pady=6,
                      cursor="hand2",
                      activebackground="#a6e3a1", activeforeground="#1e1e2e",
                      command=lambda: webbrowser.open(self._dashboard_url)
                      ).pack(fill="x", padx=8, pady=(0, 4))

            _copy_btn = tk.Button(msg_card,
                      text="📋 Copiar link",
                      bg="#45475a", fg="#cdd6f4",
                      font=("Courier", 8, "bold"),
                      relief="flat", bd=0,
                      padx=8, pady=6,
                      cursor="hand2",
                      activebackground="#45475a", activeforeground="#cdd6f4")
            _copy_btn.pack(fill="x", padx=8, pady=(0, 4))

            def _copy_link(btn=_copy_btn):
                self.root.clipboard_clear()
                self.root.clipboard_append(self._dashboard_url)
                btn.config(text="✔ Copiado!")
                self.root.after(1500, lambda: btn.config(text="📋 Copiar link"))

            _copy_btn.config(command=_copy_link)

            tk.Button(msg_card,
                      text="QR Code",
                      bg="#cba6f7", fg="#1e1e2e",
                      font=("Courier", 8, "bold"),
                      relief="flat", bd=0,
                      padx=8, pady=6,
                      cursor="hand2",
                      activebackground="#cba6f7", activeforeground="#1e1e2e",
                      command=self._show_qrcode).pack(fill="x", padx=8, pady=(0, 8))

        # ── Log ─────────────────────────────────────────────────────────
        log_outer = tk.Frame(root_frame, bg=BG)
        log_outer.grid(row=len(rows), column=0, columnspan=3,
                       sticky="we", padx=10, pady=(16, 12))

        log_header = tk.Frame(log_outer, bg=BG)
        log_header.pack(fill="x", pady=(0, 4))

        tk.Label(log_header, text="LOG",
                 bg=BG, fg=ACCENT,
                 font=("Courier", 10, "bold")).pack(side="left")

        sep = tk.Frame(log_header, bg="#45475a", height=1)
        sep.pack(side="left", fill="x", expand=True, padx=(8, 0), pady=6)

        tk.Button(log_header, text="limpar",
                  bg=BG, fg="#45475a",
                  font=("Courier", 8),
                  relief="flat", bd=0, cursor="hand2",
                  command=self._clear_log).pack(side="right")

        log_card = tk.Frame(log_outer, bg="#11111b")
        log_card.pack(fill="both")

        self._log_text = tk.Text(
            log_card, height=7, font=("Courier", 8),
            bg="#11111b", fg="#cdd6f4",
            insertbackground="#cdd6f4",
            relief="flat", bd=0,
            state="disabled",
            highlightthickness=0,
        )
        self._log_text.pack(side="left", fill="both", expand=True, padx=8, pady=6)

        sb = tk.Scrollbar(log_card, command=self._log_text.yview,
                          bg="#1e1e2e", troughcolor="#1e1e2e",
                          activebackground=ACCENT)
        sb.pack(side="right", fill="y")
        self._log_text.configure(yscrollcommand=sb.set)

        # tags de cor
        self._log_text.tag_config("info",  foreground="#89b4fa")
        self._log_text.tag_config("ok",    foreground="#a6e3a1")
        self._log_text.tag_config("warn",  foreground="#fab387")
        self._log_text.tag_config("error", foreground="#f38ba8")
        self._log_text.tag_config("rx",    foreground="#a6e3a1")
        self._log_text.tag_config("tx",    foreground="#89b4fa")

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
        self._log_text.configure(state="normal")
        self._log_text.insert("end", f"[{ts}] {msg}\n", tag)
        self._log_text.configure(state="disabled")
        self._log_text.see("end")

    def _clear_log(self):
        self._log_text.configure(state="normal")
        self._log_text.delete("1.0", "end")
        self._log_text.configure(state="disabled")

    # ────────────────────────────────────────────────────────────────────
    def _fire(self, key):
        if key in self.callbacks:
            self.callbacks[key]()

    def on(self, key, fn):
        self.callbacks[key] = fn

    def get(self, section, label):
        return self.vars[f"{section}_{label}"].get()

    def _poll_server(self):
        import threading, urllib.request, json as _json
        def _fetch():
            try:
                with urllib.request.urlopen(
                    f"{self._dashboard_url}/api/config", timeout=1
                ) as r:
                    cfg = _json.loads(r.read())
                self.root.after(0, lambda: self._apply_config(cfg))
            except Exception:
                pass
        threading.Thread(target=_fetch, daemon=True).start()
        self.root.after(2000, self._poll_server)

    def _push_key(self, key, val):
        if self._applying_server:
            return
        self._last_local_change = time.time()
        import threading, urllib.request, json as _json
        def _post():
            try:
                data = _json.dumps({key: val}).encode()
                req = urllib.request.Request(
                    f"{self._dashboard_url}/api/config",
                    data=data,
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
        for key, var in self.vars.items():
            if key in cfg:
                val = cfg[key]
                var.set(val)
                if key in self.val_labels:
                    self.val_labels[key].config(text=str(val))
        running = cfg.get("running")
        if running is True and not self.running:
            self._iniciar()
        elif running is False and self.running:
            self._parar()
        self._applying_server = False

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    panel = ControlPanel(1280, 720)
    panel.run()