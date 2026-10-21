/**
 * Módulo DeviceStatusManager
 * Exibe a bateria do carro (car.telemetry.battery e battery_state, via /api/dashboard)
 * no topo da tela.
 */
// car.telemetry.battery_state (mesma ordem do ctrl_panel.py)
const BATTERY_STATES = [
    { label: 'Sem corrente', kind: 'idle' },
    { label: 'Carregando', kind: 'charging' },
    { label: 'Carregada', kind: 'full' },
    { label: 'Descarregando', kind: 'discharging' },
    { label: 'Bateria baixa', kind: 'low' },
];

export class DeviceStatusManager {
    constructor() {
        this.statusEl = document.getElementById('batteryStatus');
        this.batteryValueEl = document.getElementById('batteryValue');
        this.batteryFillEl = document.getElementById('batteryFill');
    }

    async init() {
        // Estado inicial, até a primeira resposta do /api/dashboard chegar.
        this.setLevel(null);
    }

    /**
     * Atualiza a UI com o nível de bateria real do carro (0-100) e o estado do BMS,
     * vindos da telemetria. null = o Arduino ainda não mandou telemetria.
     */
    setLevel(percent, batteryState = null) {
        if (!this.batteryValueEl || !this.batteryFillEl) return;

        const info = BATTERY_STATES[batteryState] || null;
        if (this.statusEl) {
            this.statusEl.dataset.state = info ? info.kind : 'none';
            this.statusEl.title = info ? `Bateria · ${info.label}` : 'Bateria';
        }

        const level = Number(percent);
        if (percent === null || percent === undefined || !Number.isFinite(level)) {
            this.batteryValueEl.textContent = '--%';
            this.batteryFillEl.style.width = '4%';
            this.batteryFillEl.style.backgroundColor = '#8b8b8b';
            return;
        }

        const clamped = Math.max(0, Math.min(100, Math.round(level)));
        this.batteryValueEl.textContent = `${clamped}%`;
        this.batteryFillEl.style.width = `${Math.max(4, clamped)}%`;

        if (info?.kind === 'charging' || info?.kind === 'full') {
            this.batteryFillEl.style.backgroundColor = '#5ccb63';
        } else if (clamped <= 20 || info?.kind === 'low') {
            this.batteryFillEl.style.backgroundColor = '#ff3b30';
        } else if (clamped <= 50) {
            this.batteryFillEl.style.backgroundColor = '#ffd34a';
        } else {
            this.batteryFillEl.style.backgroundColor = '#5ccb63';
        }
    }

}
