/**
 * Módulo SpeedometerManager
 * Controla velocímetro lateral (m/s)
 */
export class SpeedometerManager {
    constructor(config = {}) {
        this.config = config || {};
        this.maxSpeed = 10;
        this.currentSpeed = 0;
        this.decelerationPerSecond = 1.8;
        this.lastAccelerationAt = 0;
        this.decelerationTimer = null;

        this.progressPath = document.getElementById('speedometerProgress');
        this.needle = document.getElementById('speedometerNeedle');
        this.valueEl = document.getElementById('speedometerValue');
        this.minEl = document.getElementById('speedometerMin');
        this.maxEl = document.getElementById('speedometerMax');
        this.zonesGroup = document.getElementById('speedometerZones');
        this.ticksGroup = document.getElementById('speedometerTicks');
        this.labelsGroup = document.getElementById('speedometerLabels');
        this.pathLength = 0;
        this.centerX = 110;
        this.centerY = 110;
        this.radius = 88;
        this.needleRadius = 78;
    }

    init() {
        if (!this.progressPath || !this.needle || !this.valueEl || !this.minEl || !this.maxEl) {
            return;
        }

        const configuredMax = Number(this.config.velocimetroRangeMax);
        this.maxSpeed = Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : 10;

        const configuredInitial = Number(this.config.velocimetroVelocidadeInicial);
        this.currentSpeed = Number.isFinite(configuredInitial) ? configuredInitial : 0;

        const configuredDecel = Number(this.config.debugDesaceleracaoPorSegundo);
        this.decelerationPerSecond = Number.isFinite(configuredDecel) && configuredDecel > 0
            ? configuredDecel
            : 1.8;

        this.pathLength = this.progressPath.getTotalLength();
        this.progressPath.style.strokeDasharray = `0 ${this.pathLength}`;
        this.buildDetailedGauge();

        this.minEl.textContent = '0';
        this.maxEl.textContent = `${this.maxSpeed}`;
        this.setSpeed(this.currentSpeed);
        this.startAutoDeceleration();
    }

    setSpeed(speed) {
        if (!this.progressPath || !this.needle || !this.valueEl || !this.pathLength) {
            return;
        }

        const clamped = Math.max(0, Math.min(this.maxSpeed, Number(speed) || 0));
        this.currentSpeed = clamped;

        const progress = clamped / this.maxSpeed;
        const visibleLength = this.pathLength * progress;
        this.progressPath.style.strokeDasharray = `${visibleLength} ${this.pathLength}`;
        const color = this.getSpeedColor(progress);
        this.progressPath.style.stroke = color;
        this.needle.style.stroke = color;
        this.valueEl.style.color = color;

        // Ponteiro geométrico no semicírculo superior:
        // 0 m/s = esquerda (180deg), max = direita (0deg)
        const angleRad = Math.PI * (1 - progress);
        const x2 = this.centerX + (this.needleRadius * Math.cos(angleRad));
        const y2 = this.centerY - (this.needleRadius * Math.sin(angleRad));
        this.needle.setAttribute('x1', `${this.centerX}`);
        this.needle.setAttribute('y1', `${this.centerY}`);
        this.needle.setAttribute('x2', `${x2.toFixed(2)}`);
        this.needle.setAttribute('y2', `${y2.toFixed(2)}`);

        this.valueEl.textContent = clamped.toFixed(1);
    }

    increaseSpeed(delta = 1) {
        this.lastAccelerationAt = Date.now();
        this.setSpeed(this.currentSpeed + delta);
    }

    getSpeed() {
        return this.currentSpeed;
    }

    getSpeedColor(progress) {
        if (progress >= 0.8) return '#e03030'; // vermelho — quase no máximo
        if (progress >= 0.5) return '#d4a020'; // amarelo — meio
        return '#39c87a';                       // verde — início
    }

    startAutoDeceleration() {
        if (this.decelerationTimer) {
            clearInterval(this.decelerationTimer);
        }

        this.decelerationTimer = setInterval(() => {
            if (this.currentSpeed <= 0) return;

            // Pequeno atraso após cada aceleração para sensação natural.
            const elapsed = Date.now() - this.lastAccelerationAt;
            if (elapsed < 220) return;

            const step = this.decelerationPerSecond * 0.08; // tick de 80ms
            this.setSpeed(this.currentSpeed - step);
        }, 80);
    }

    buildDetailedGauge() {
        if (!this.zonesGroup || !this.ticksGroup || !this.labelsGroup) return;

        this.zonesGroup.innerHTML = '';
        this.ticksGroup.innerHTML = '';
        this.labelsGroup.innerHTML = '';

        const zoneDefs = [
            { start: 0, end: 0.6, cls: 'zone-low' },
            { start: 0.6, end: 0.85, cls: 'zone-mid' },
            { start: 0.85, end: 1, cls: 'zone-high' }
        ];

        zoneDefs.forEach((zone) => {
            const arc = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            arc.setAttribute('d', this.arcPath(zone.start, zone.end, this.radius - 14));
            arc.setAttribute('class', `speed-zone ${zone.cls}`);
            this.zonesGroup.appendChild(arc);
        });

        const minorCount = Math.max(10, Math.round(this.maxSpeed));
        const majorStep = this.maxSpeed <= 20 ? 2 : Math.round(this.maxSpeed / 5);

        for (let i = 0; i <= minorCount; i++) {
            const progress = i / minorCount;
            const angle = Math.PI * (1 - progress);
            const isMajor = (i % majorStep) === 0;

            const outer = this.radius + 2;
            const inner = isMajor ? this.radius - 10 : this.radius - 6;
            const x1 = this.centerX + outer * Math.cos(angle);
            const y1 = this.centerY - outer * Math.sin(angle);
            const x2 = this.centerX + inner * Math.cos(angle);
            const y2 = this.centerY - inner * Math.sin(angle);

            const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            tick.setAttribute('x1', x1.toFixed(2));
            tick.setAttribute('y1', y1.toFixed(2));
            tick.setAttribute('x2', x2.toFixed(2));
            tick.setAttribute('y2', y2.toFixed(2));
            tick.setAttribute('class', `speedometer-tick ${isMajor ? 'major' : 'minor'}`);
            this.ticksGroup.appendChild(tick);

            if (isMajor) {
                const value = Math.round(progress * this.maxSpeed);
                const displayValue = value === 0 ? 10 : value;
                const labelRadius = this.radius + 16;
                const lx = this.centerX + labelRadius * Math.cos(angle);
                const ly = this.centerY - labelRadius * Math.sin(angle);
                const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                label.setAttribute('x', lx.toFixed(2));
                label.setAttribute('y', ly.toFixed(2));
                label.setAttribute('class', 'speedometer-label');
                label.setAttribute('text-anchor', 'middle');
                label.setAttribute('dominant-baseline', 'middle');
                label.textContent = `${displayValue}`;
                this.labelsGroup.appendChild(label);
            }
        }
    }

    arcPath(startProgress, endProgress, radius) {
        const start = Math.PI * (1 - startProgress);
        const end = Math.PI * (1 - endProgress);
        const sx = this.centerX + radius * Math.cos(start);
        const sy = this.centerY - radius * Math.sin(start);
        const ex = this.centerX + radius * Math.cos(end);
        const ey = this.centerY - radius * Math.sin(end);
        return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${radius} ${radius} 0 0 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
    }
}
