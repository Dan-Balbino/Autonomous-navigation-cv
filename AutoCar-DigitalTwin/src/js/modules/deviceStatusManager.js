/**
 * Módulo DeviceStatusManager
 * Exibe bateria local no topo da tela
 */
export class DeviceStatusManager {
    constructor() {
        this.batteryValueEl = document.getElementById('batteryValue');
        this.batteryFillEl = document.getElementById('batteryFill');
        this.battery = null;
    }

    async init() {
        this.initBattery();
    }

    async initBattery() {
        if (!this.batteryValueEl || !this.batteryFillEl) return;

        if (!navigator.getBattery) {
            this.batteryValueEl.textContent = '--%';
            this.batteryFillEl.style.width = '20%';
            this.batteryFillEl.style.backgroundColor = '#8b8b8b';
            return;
        }

        try {
            this.battery = await navigator.getBattery();
            const update = () => this.updateBatteryUI();
            this.battery.addEventListener('levelchange', update);
            this.battery.addEventListener('chargingchange', update);
            this.updateBatteryUI();
        } catch (error) {
            this.batteryValueEl.textContent = '--%';
        }
    }

    updateBatteryUI() {
        if (!this.battery || !this.batteryValueEl || !this.batteryFillEl) return;

        const level = Math.round(this.battery.level * 100);
        this.batteryValueEl.textContent = `${level}%`;
        this.batteryFillEl.style.width = `${Math.max(4, level)}%`;

        if (this.battery.charging) {
            this.batteryFillEl.style.backgroundColor = '#44c36b';
        } else if (level <= 20) {
            this.batteryFillEl.style.backgroundColor = '#ff3b30';
        } else if (level <= 50) {
            this.batteryFillEl.style.backgroundColor = '#ffd34a';
        } else {
            this.batteryFillEl.style.backgroundColor = '#5ccb63';
        }
    }

}
