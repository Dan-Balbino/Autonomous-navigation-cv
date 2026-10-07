/**
 * Telemetria das rodas — barras segmentadas estilo painel de corrida.
 *
 * Lê tabDashboard_speed1..4 (car.telemetry.speed1..4, em m/s) do /api/dashboard.
 * Cada barra acende segmentos como LEDs (verde → amarelo → vermelho) e guarda
 * uma marca de pico que desce devagar, como nos painéis de telemetria.
 */

// Mesmos nomes do painel Python (ctrl_panel.py). A ordem segue o desenho do carro:
// ele aponta para a esquerda, então o lado direito do carro fica no topo da tela.
const WHEELS = [
    { key: 'speed3', tag: 'FD', name: 'Roda frontal direita' },
    { key: 'speed4', tag: 'TD', name: 'Roda traseira direita' },
    { key: 'speed1', tag: 'FE', name: 'Roda frontal esquerda' },
    { key: 'speed2', tag: 'TE', name: 'Roda traseira esquerda' },
];

const SEGMENTS = 20;
const PEAK_HOLD_MS = 1200;   // tempo parado no pico antes de começar a descer
const PEAK_DECAY_MS = 120;   // tempo para descer um segmento

export class WheelTelemetry {
    /**
     * @param {HTMLElement} container - Elemento .wheel-telemetry
     * @param {number} maxSpeed - Velocidade (m/s) que enche a barra
     */
    constructor(container, maxSpeed = 10) {
        this.container = container;
        this.maxSpeed = maxSpeed > 0 ? maxSpeed : 10;
        this.rows = new Map();
        this.decayTimer = null;
    }

    init() {
        if (!this.container) return;
        const list = this.container.querySelector('.wheel-telemetry-rows');
        list.innerHTML = '';

        WHEELS.forEach(({ key, tag, name }) => {
            const row = document.createElement('div');
            row.className = 'wheel-row';
            row.title = name;

            const tagEl = document.createElement('span');
            tagEl.className = 'wheel-tag';
            tagEl.textContent = tag;

            const bar = document.createElement('div');
            bar.className = 'wheel-bar';
            const segments = [];
            for (let i = 0; i < SEGMENTS; i++) {
                const seg = document.createElement('span');
                const ratio = (i + 1) / SEGMENTS;
                seg.className = `wheel-seg ${ratio <= 0.6 ? 'seg-green' : ratio <= 0.85 ? 'seg-yellow' : 'seg-red'}`;
                // Acende em cascata da esquerda para a direita
                seg.style.transitionDelay = `${i * 12}ms`;
                bar.appendChild(seg);
                segments.push(seg);
            }

            const valueEl = document.createElement('span');
            valueEl.className = 'wheel-value';
            valueEl.textContent = '0.0';

            row.append(tagEl, bar, valueEl);
            list.appendChild(row);
            this.rows.set(key, { segments, valueEl, lit: 0, peak: 0, peakAt: 0 });
        });

        this.decayTimer = setInterval(() => this.decayPeaks(), PEAK_DECAY_MS);
    }

    /**
     * Atualiza as barras com o payload do /api/dashboard.
     */
    update(dashboardData) {
        const now = performance.now();
        this.rows.forEach((row, key) => {
            const raw = Number(dashboardData?.[`tabDashboard_${key}`] ?? dashboardData?.[`tabdashboard_${key}`]);
            const speed = Number.isFinite(raw) ? Math.max(0, raw) : 0;
            const lit = Math.round(Math.min(1, speed / this.maxSpeed) * SEGMENTS);

            row.valueEl.textContent = speed.toFixed(1);
            if (lit !== row.lit) {
                row.segments.forEach((seg, i) => seg.classList.toggle('on', i < lit));
                row.lit = lit;
            }
            if (lit >= row.peak) {
                row.peak = lit;
                row.peakAt = now;
                this.renderPeak(row);
            }
        });
    }

    decayPeaks() {
        const now = performance.now();
        this.rows.forEach((row) => {
            if (row.peak > row.lit && now - row.peakAt > PEAK_HOLD_MS) {
                row.peak -= 1;
                this.renderPeak(row);
            }
        });
    }

    renderPeak(row) {
        row.segments.forEach((seg, i) => seg.classList.toggle('peak', row.peak > 0 && i === row.peak - 1));
    }
}
