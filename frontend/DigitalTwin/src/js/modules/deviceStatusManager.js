/**
 * Módulo DeviceStatusManager
 * Exibe a bateria do carro (car.telemetry.battery, via /api/dashboard) no topo da tela.
 */
export class DeviceStatusManager {
    constructor() {
        this.batteryValueEl = document.getElementById('batteryValue');
        this.batteryFillEl = document.getElementById('batteryFill');
    }

    async init() {
        // Estado inicial, até a primeira resposta do /api/dashboard chegar.
        this.setLevel(null);
    }

    /** Atualiza a UI com o nível de bateria real do carro (0-100), vindo da telemetria. */
    setLevel(percent) {
        if (!this.batteryValueEl || !this.batteryFillEl) return;

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

        if (clamped <= 20) {
            this.batteryFillEl.style.backgroundColor = '#ff3b30';
        } else if (clamped <= 50) {
            this.batteryFillEl.style.backgroundColor = '#ffd34a';
        } else {
            this.batteryFillEl.style.backgroundColor = '#5ccb63';
        }
    }

}
