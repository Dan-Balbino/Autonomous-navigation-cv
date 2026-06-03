import tkinter as tk
from tkinter import ttk
import json
import os
import time

class ControlPanel:
    def __init__(self, width, height):
        self.config_path = "config/config.json"
        self.root = tk.Tk()
        self.root.title("Controles")
        self.root.configure(bg="#1e1e2e")
        self.root.geometry("900x750")
        self.root.resizable(True, True)
        
        self.frame_width  = width
        self.frame_height = height
        self.running      = False

        self.vars       = {}
        self.val_labels = {}
        self.callbacks  = {}
        self._build_ui()
        self._register_callbacks()

    def _IsRunning(self):
        return self.running

    def _iniciar(self):
        self.running = True
        self.log("[PAINEL] Iniciando movimento", "info")

    def _parar(self):
        self.running = False
        self.log("[CONTROLE MANUAL] veículo parado pelo painel de controle", "warn")

    def _salvar(self):
        with open(self.config_path, "w") as f:
            json.dump({k: var.get() for k, var in self.vars.items()}, f, indent=4)
        self.log("[PAINEL] Configurações salvas", "info")

    def _resetar(self):
        config_path = self.config_path
        if not os.path.exists(config_path):
            self.log("[PAINEL] Nenhum config.json encontrado", "error")
            return
        with open(config_path, "r") as f:
            config = json.load(f)
        for key, var in self.vars.items():
            if key in config:
                var.set(config[key])
                if key in self.val_labels:
                    self.val_labels[key].config(text=str(config[key]))
        self.log("[PAINEL] Valores restaurados do config.json", "info")

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
            [sections[4]],
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

                    def make_cmd(vl):
                        return lambda val: vl.config(text=str(int(float(val))))

                    slider = ttk.Scale(row_frame, from_=mn, to=mx, orient="horizontal",
                                       variable=var, command=make_cmd(val_label),
                                       length=180)
                    slider.pack(fill="x", pady=(2, 0))

                    if i < len(controls) - 1:
                        tk.Frame(card, bg="#45475a", height=1).pack(fill="x", padx=12)

        # ── Botões ──────────────────────────────────────────────────────
        btn_frame = tk.Frame(root_frame, bg=BG)
        btn_frame.grid(row=0, column=2, rowspan=len(rows), sticky="n", padx=(8, 10), pady=(12, 0))

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

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    panel = ControlPanel(1280, 720)
    panel.run()