/**
 * Módulo ProximityWaves
 * Sistema profissional de sensores de proximidade para painel de carro
 */

export class ProximityWaves {
    /**
     * @param {SVGElement} svgElement - Elemento SVG onde as ondas serão desenhadas
     * @param {HTMLImageElement} carImage - Elemento da imagem do carro
     * @param {Object} config - Configurações dos sensores
     * @param {ProximityDetector} proximityDetector - Detector de proximidade
     */
    constructor(svgElement, carImage, config = null, proximityDetector = null) {
        this.svg = svgElement;
        this.carImage = carImage;
        this.waves = [];
        this.config = this.validateAndMergeConfig(config);
        this.proximityDetector = proximityDetector;
        this.showAreaVisualization = false;
        this.areaGroups = [];
        this.apiSensorDistancesCm = null;
        this.layoutScaleRefs = {
            horizontal: null,
            vertical: null
        };
        this.currentDetectedZone = null; // 'green', 'yellow', 'red', ou null
        this.isAnimating = false; // Flag para controlar animação de entrada
        this.waveStates = new Map(); // Rastreia estado anterior de cada onda para animações suaves
    }

    /**
     * Define distâncias vindas da API para cada sensor (em cm).
     * Quando presente, essas distâncias substituem a detecção por objeto simulado.
     * @param {Object|null} sensorDistancesCm - Mapa por sensorId => distância em cm
     */
    setApiSensorDistancesCm(sensorDistancesCm) {
        if (!sensorDistancesCm || typeof sensorDistancesCm !== 'object') {
            this.apiSensorDistancesCm = null;
            return;
        }

        const normalized = {};
        let hasAnyValidValue = false;

        Object.entries(sensorDistancesCm).forEach(([sensorId, rawValue]) => {
            if (rawValue === null || rawValue === undefined || rawValue === '') {
                normalized[sensorId] = null;
                return;
            }

            const parsed = Number(rawValue);
            if (!Number.isFinite(parsed) || parsed < 0) {
                normalized[sensorId] = null;
                return;
            }

            normalized[sensorId] = parsed;
            hasAnyValidValue = true;
        });

        this.apiSensorDistancesCm = hasAnyValidValue ? normalized : null;
    }

    /**
     * Converte distância real em cm para distância digital do sensor.
     * Mapeamento linear: 0..60cm -> 0..100% do alcance digital.
     * @param {string} sensorId
     * @param {number} sensorRange
     * @returns {number|null}
     */
    getApiDrivenSensorDistance(sensorId, sensorRange) {
        if (!this.apiSensorDistancesCm) return null;
        const rawCm = this.apiSensorDistancesCm[sensorId];
        if (!Number.isFinite(rawCm)) return null;

        const clampedCm = Math.max(0, Math.min(rawCm, 60));
        const normalized = clampedCm / 60; // 0..1
        return normalized * sensorRange;
    }

    /**
     * Define o detector de proximidade
     * @param {ProximityDetector} detector - Detector de proximidade
     */
    setProximityDetector(detector) {
        this.proximityDetector = detector;
    }

    /**
     * Valida e mescla a configuração fornecida com os valores padrão
     * @param {Object} config - Configuração fornecida
     * @returns {Object} - Configuração validada
     */
    validateAndMergeConfig(config) {
        const defaultConfig = this.getDefaultConfig();
        
        if (!config) {
            return defaultConfig;
        }
        
        const validated = { ...defaultConfig };
        
        // Mescla valores fornecidos
        for (const key in config) {
            if (defaultConfig.hasOwnProperty(key)) {
                const value = parseFloat(config[key]);
                if (!isNaN(value)) {
                    validated[key] = value;
                }
            }
        }
        
        return validated;
    }

    /**
     * Retorna configuração padrão
     * @returns {Object}
     */
    getDefaultConfig() {
        return {
            // Configurações gerais
            espessuraLinhas: 8,
            distanciaTravarVermelho: 18,
            escalaGlobalVertical: 1,
            // Altura do carro (px) em que as distâncias valem; 0 = altura natural da imagem
            alturaReferenciaCarro: 0,
            // Deslocamento vertical dos sensores (fração da altura do carro; negativo = para cima)
            ajusteCentroVertical: 0,
            // Sensores frontais - Ponta Superior (SFPS)
            SFPS_quantidade: 4,
            SFPS_comprimento: 75,
            SFPS_comprimentoVertical: 75,
            SFPS_alcance: 210,
            SFPS_rotacao: 14,
            SFPS_espacamento: 12,
            SFPS_espacamentoVertical: 12,
            SFPS_distancia: 95,
            SFPS_distanciaVertical: 95,
            SFPS_crescimento: 4,
            SFPS_curvatura: 60,
            SFPS_posicaoVertical: -0.34,
            SFPS_rotacaoVertical: 14,
            
            // Sensor frontal - Centro (SFCI)
            SFCI_quantidade: 5,
            SFCI_comprimento: 105,
            SFCI_comprimentoVertical: 105,
            SFCI_alcance: 320,
            SFCI_rotacao: 0,
            SFCI_espacamento: 12,
            SFCI_espacamentoVertical: 12,
            SFCI_distancia: 95,
            SFCI_distanciaVertical: 95,
            SFCI_crescimento: 4,
            SFCI_curvatura: 60,
            SFCI_posicaoVertical: 0.14,
            SFCI_rotacaoVertical: 0,
            
            // Sensores frontais - Ponta Inferior (SFPI)
            SFPI_quantidade: 4,
            SFPI_comprimento: 75,
            SFPI_comprimentoVertical: 75,
            SFPI_alcance: 210,
            SFPI_rotacao: 14,
            SFPI_espacamento: 12,
            SFPI_espacamentoVertical: 12,
            SFPI_distancia: 95,
            SFPI_distanciaVertical: 95,
            SFPI_crescimento: 4,
            SFPI_curvatura: 60,
            SFPI_posicaoVertical: 0.34,
            SFPI_rotacaoVertical: 14,
            
            // Sensor traseiro (ST)
            ST_quantidade: 5,
            ST_comprimento: 260,
            ST_comprimentoVertical: 260,
            ST_alcance: 290,
            ST_espacamento: 12,
            ST_espacamentoVertical: 12,
            ST_distancia: 95,
            ST_distanciaVertical: 95,
            ST_crescimento: 4,
            ST_curvatura: 60,
            ST_posicaoVertical: 0,
            ST_rotacaoVertical: 0
        };
    }

    /**
     * Inicializa as ondas de proximidade
     */
    init() {
        this.updateViewBox();
        this.createWaves();
        
        // Debounce otimizado para evitar muitas atualizações
        let resizeTimeout;
        const handleResize = () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                this.updateViewBox();
                this.updateWaves();
            }, 150);
        };
        
        window.addEventListener('resize', handleResize, { passive: true });
        
        // ResizeObserver com debounce para melhor performance
        if (window.ResizeObserver) {
            let observerTimeout;
            const handleObserverResize = () => {
                clearTimeout(observerTimeout);
                observerTimeout = setTimeout(() => {
                    this.updateViewBox();
            this.updateWaves();
                }, 100);
            };
            
            const resizeObserver = new ResizeObserver(handleObserverResize);
            resizeObserver.observe(this.carImage);
            resizeObserver.observe(this.svg.parentElement);
        }
        
        // Escuta evento para alternar visualização de áreas
        window.addEventListener('toggleAreaVisualization', () => {
            this.toggleAreaVisualization();
        });
    }

    /**
     * Alterna a visualização das áreas de alcance
     */
    toggleAreaVisualization() {
        this.showAreaVisualization = !this.showAreaVisualization;
        this.updateWaves();
    }

    /**
     * Calcula escala responsiva para manter proporção dos sensores em qualquer tela.
     * A referência é capturada na primeira renderização de cada modo (horizontal/vertical).
     */
    getResponsiveScale(carRect, isVerticalMode) {
        // Horizontal: os valores do JSON são pixels para o carro na altura de referência
        // (alturaReferenciaCarro, o tamanho natural da imagem). Em telas menores o carro
        // encolhe e os sensores acompanham, mantendo a mesma posição relativa.
        if (!isVerticalMode) {
            const configured = Number(this.config.alturaReferenciaCarro);
            const refHeight = configured > 0 ? configured : (this.carImage.naturalHeight || carRect.height);
            return carRect.height / refHeight;
        }

        // Escala estável e separada para vertical, baseada no viewport.
        // Evita dependência do frame intermediário da animação de rotação.
        const vw = window.innerWidth || carRect.width;
        const vh = window.innerHeight || carRect.height;
        const shortSide = Math.min(vw, vh);
        const longSide = Math.max(vw, vh);

        // Base de referência de layout (ajuste global para telas diferentes).
        const shortScale = shortSide / 760;
        const longScale = longSide / 1360;
        const responsiveBase = (shortScale * 0.7) + (longScale * 0.3);

        const verticalGlobal = Number(this.config.escalaGlobalVertical);
        const globalFactor = Number.isFinite(verticalGlobal) && verticalGlobal > 0 ? verticalGlobal : 1;

        const scaled = responsiveBase * globalFactor;
        return Math.max(0.78, Math.min(1.65, scaled));
    }

    /**
     * Atualiza o viewBox do SVG
     */
    updateViewBox() {
        const container = this.svg.parentElement;
        if (!container) return;
        
        const rect = container.getBoundingClientRect();
        this.svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
        this.svg.setAttribute('width', rect.width);
        this.svg.setAttribute('height', rect.height);
    }

    /**
     * Cria todas as ondas de proximidade
     */
    createWaves() {
        // Sensores desabilitados no modo vertical
        if (document.body.classList.contains('vertical-driving-mode')) {
            this.clearWaves();
            return;
        }
        
        this.updateViewBox();
        this.clearWaves();
        
        const container = this.svg.parentElement;
        if (!container) {
            console.error('Container não encontrado');
            return;
        }

        const containerRect = container.getBoundingClientRect();
        const carRect = this.carImage.getBoundingClientRect();
        
        if (carRect.width === 0 || carRect.height === 0) {
            return;
        }
        
        const carCenterX = carRect.left + carRect.width / 2 - containerRect.left;
        const carCenterY = carRect.top + carRect.height / 2 - containerRect.top;
        const carHeight = carRect.height;
        
        const frontEdgeX = carRect.left - containerRect.left;
        const rearEdgeX = carRect.right - containerRect.left;
        
        // Posição do objeto (se houver)
        const proximityInfo = this.proximityDetector?.getProximityInfo();
        const objectAbs = this.getObjectAbsolutePosition(proximityInfo, containerRect);
        const objectLocal = objectAbs
            ? {
                x: objectAbs.x - containerRect.left,
                y: objectAbs.y - containerRect.top
            }
            : null;
        
        // Configuração da espessura
        const thickness = Math.max(7, this.config.espessuraLinhas);
        document.documentElement.style.setProperty('--wave-stroke-width', `${thickness}px`);
        
        const isVerticalMode = document.body.classList.contains('vertical-driving-mode');
        const responsiveScale = this.getResponsiveScale(carRect, isVerticalMode);
        const scaleMetric = (value) => (Number(value) || 0) * responsiveScale;
        const pickModeValue = (normalValue, verticalValue) => {
            if (isVerticalMode && Number.isFinite(verticalValue)) {
                return verticalValue;
            }
            return normalValue;
        };
        // Centro de referência dos sensores: o carro pode não estar centralizado na imagem
        // (ajusteCentroVertical é uma fração da altura do carro; negativo = para cima).
        const sensorCenterY = carCenterY + (isVerticalMode ? 0 : carHeight * (Number(this.config.ajusteCentroVertical) || 0));
        // Sensores frontais (3 sensores: superior, centro, inferior)
        const frontSensors = [
            {
                id: 'ponta-superior',
                y: sensorCenterY + (carHeight * pickModeValue(-0.36, this.config.SFPS_posicaoVertical)),
                length: scaleMetric(pickModeValue(this.config.SFPS_comprimento, this.config.SFPS_comprimentoVertical)),
                range: scaleMetric(this.config.SFPS_alcance),
                rotation: pickModeValue(this.config.SFPS_rotacao, this.config.SFPS_rotacaoVertical),
                spacing: scaleMetric(pickModeValue(this.config.SFPS_espacamento, this.config.SFPS_espacamentoVertical)),
                waveCount: this.config.SFPS_quantidade,
                initialOffset: scaleMetric(pickModeValue(this.config.SFPS_distancia, this.config.SFPS_distanciaVertical)),
                growth: scaleMetric(this.config.SFPS_crescimento),
                curvature: this.config.SFPS_curvatura
            },
            {
                id: 'centro',
                y: sensorCenterY,
                length: scaleMetric(pickModeValue(this.config.SFCI_comprimento, this.config.SFCI_comprimentoVertical)),
                range: scaleMetric(this.config.SFCI_alcance),
                rotation: pickModeValue(this.config.SFCI_rotacao, this.config.SFCI_rotacaoVertical),
                spacing: scaleMetric(pickModeValue(this.config.SFCI_espacamento, this.config.SFCI_espacamentoVertical)),
                waveCount: this.config.SFCI_quantidade,
                initialOffset: scaleMetric(pickModeValue(this.config.SFCI_distancia, this.config.SFCI_distanciaVertical)),
                growth: scaleMetric(this.config.SFCI_crescimento),
                curvature: this.config.SFCI_curvatura
            },
            {
                id: 'ponta-inferior',
                y: sensorCenterY + (carHeight * pickModeValue(0.36, this.config.SFPI_posicaoVertical)),
                length: scaleMetric(pickModeValue(this.config.SFPI_comprimento, this.config.SFPI_comprimentoVertical)),
                range: scaleMetric(this.config.SFPI_alcance),
                rotation: -pickModeValue(this.config.SFPI_rotacao, this.config.SFPI_rotacaoVertical),
                spacing: scaleMetric(pickModeValue(this.config.SFPI_espacamento, this.config.SFPI_espacamentoVertical)),
                waveCount: this.config.SFPI_quantidade,
                initialOffset: scaleMetric(pickModeValue(this.config.SFPI_distancia, this.config.SFPI_distanciaVertical)),
                growth: scaleMetric(this.config.SFPI_crescimento),
                curvature: this.config.SFPI_curvatura
            }
        ];
        
        // Cria sensores frontais
        this.createSensorGroup({
            side: 'front',
            sideX: frontEdgeX,
            carCenterX: carCenterX,
            carCenterY: carCenterY,
            sensors: frontSensors,
            lockDistance: scaleMetric(this.config.distanciaTravarVermelho),
            objectLocal
        });
        
        // Se visualização de áreas estiver ativa, cria as áreas
        if (this.showAreaVisualization) {
            this.createAreaVisualization();
        }
    }
    
    /**
     * Cria visualização das áreas de alcance dos sensores
     */
    createAreaVisualization() {
        const container = this.svg.parentElement;
        if (!container) return;
        
        const containerRect = container.getBoundingClientRect();
        const carRect = this.carImage.getBoundingClientRect();
        
        if (carRect.width === 0 || carRect.height === 0) return;
        
        const carCenterX = carRect.left + carRect.width / 2 - containerRect.left;
        const carCenterY = carRect.top + carRect.height / 2 - containerRect.top;
        const carHeight = carRect.height;
        const frontEdgeX = carRect.left - containerRect.left;
        const rearEdgeX = carRect.right - containerRect.left;
        
        const isVerticalMode = document.body.classList.contains('vertical-driving-mode');
        const responsiveScale = this.getResponsiveScale(carRect, isVerticalMode);
        const scaleMetric = (value) => (Number(value) || 0) * responsiveScale;
        const pickModeValue = (normalValue, verticalValue) => {
            if (isVerticalMode && Number.isFinite(verticalValue)) {
                return verticalValue;
            }
            return normalValue;
        };
        // Centro de referência dos sensores: o carro pode não estar centralizado na imagem
        // (ajusteCentroVertical é uma fração da altura do carro; negativo = para cima).
        const sensorCenterY = carCenterY + (isVerticalMode ? 0 : carHeight * (Number(this.config.ajusteCentroVertical) || 0));
        // Sensores frontais (3 sensores)
        const frontSensors = [
            { id: 'ponta-superior', y: sensorCenterY + (carHeight * pickModeValue(-0.36, this.config.SFPS_posicaoVertical)), range: scaleMetric(this.config.SFPS_alcance), initialOffset: scaleMetric(pickModeValue(this.config.SFPS_distancia, this.config.SFPS_distanciaVertical)), rotation: pickModeValue(this.config.SFPS_rotacao, this.config.SFPS_rotacaoVertical) },
            { id: 'centro', y: sensorCenterY, range: scaleMetric(this.config.SFCI_alcance), initialOffset: scaleMetric(pickModeValue(this.config.SFCI_distancia, this.config.SFCI_distanciaVertical)), rotation: pickModeValue(this.config.SFCI_rotacao, this.config.SFCI_rotacaoVertical) },
            { id: 'ponta-inferior', y: sensorCenterY + (carHeight * pickModeValue(0.36, this.config.SFPI_posicaoVertical)), range: scaleMetric(this.config.SFPI_alcance), initialOffset: scaleMetric(pickModeValue(this.config.SFPI_distancia, this.config.SFPI_distanciaVertical)), rotation: -pickModeValue(this.config.SFPI_rotacao, this.config.SFPI_rotacaoVertical) }
        ];
        
        // Cria áreas frontais
        frontSensors.forEach(sensor => {
            this.createSensorArea('front', frontEdgeX, carCenterX, sensor);
        });
    }
    
    /**
     * Cria área de alcance visual para um sensor
     */
    createSensorArea(side, sideX, carCenterX, sensor) {
        const sensorAxisX = carCenterX + (side === 'front' ? -sensor.initialOffset : sensor.initialOffset);
        const sensorAxisY = sensor.y;
        const maxRange = sensor.range;
        
        // Divide em 3 zonas: risco (1/3), média (2/3), longe (3/3)
        const zoneSize = maxRange / 3;
        const riskZone = zoneSize;      // Vermelho
        const mediumZone = zoneSize * 2; // Amarelo
        const safeZone = maxRange;     // Verde claro
        
        // Cria grupo para o sensor
        const areaGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        areaGroup.setAttribute('data-sensor-id', sensor.id);
        
        // Aplica rotação se necessário
        if (sensor.rotation !== 0) {
            areaGroup.setAttribute('transform', `rotate(${sensor.rotation} ${sensorAxisX} ${sensorAxisY})`);
        }
        
        // Zona de risco (vermelho) - mais próxima
        const riskCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        riskCircle.setAttribute('cx', sensorAxisX);
        riskCircle.setAttribute('cy', sensorAxisY);
        riskCircle.setAttribute('r', riskZone);
        riskCircle.setAttribute('fill', 'rgba(134, 26, 54, 0.15)'); // Vinho transparente
        riskCircle.setAttribute('stroke', 'rgba(134, 26, 54, 0.4)');
        riskCircle.setAttribute('stroke-width', '1');
        areaGroup.appendChild(riskCircle);
        
        // Zona média (amarelo)
        const mediumCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        mediumCircle.setAttribute('cx', sensorAxisX);
        mediumCircle.setAttribute('cy', sensorAxisY);
        mediumCircle.setAttribute('r', mediumZone);
        mediumCircle.setAttribute('fill', 'rgba(255, 164, 27, 0.15)'); // Âmbar transparente
        mediumCircle.setAttribute('stroke', 'rgba(255, 164, 27, 0.4)');
        mediumCircle.setAttribute('stroke-width', '1');
        areaGroup.appendChild(mediumCircle);
        
        // Zona segura (verde claro) - mais distante
        const safeCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        safeCircle.setAttribute('cx', sensorAxisX);
        safeCircle.setAttribute('cy', sensorAxisY);
        safeCircle.setAttribute('r', safeZone);
        safeCircle.setAttribute('fill', 'rgba(141, 245, 166, 0.15)'); // Verde claro transparente
        safeCircle.setAttribute('stroke', 'rgba(141, 245, 166, 0.4)');
        safeCircle.setAttribute('stroke-width', '1');
        areaGroup.appendChild(safeCircle);
        
        this.svg.appendChild(areaGroup);
        this.areaGroups.push(areaGroup);
    }

    /**
     * Obtém a posição absoluta do objeto
     */
    getObjectAbsolutePosition(proximityInfo, containerRect) {
        if (!proximityInfo?.objectPosition) {
            return null;
        }
        return {
            x: containerRect.left + proximityInfo.objectPosition.x,
            y: containerRect.top + proximityInfo.objectPosition.y
        };
    }

    /**
     * Calcula a cor baseada na zona de distância
     */
    getSensorZoneColor(distance, maxRange) {
        const zoneSize = maxRange / 3;
        if (distance > zoneSize * 2) {
            return '#2f78d4'; // Azul meio escuro (longe, mas detectando)
        }
        if (distance > zoneSize) {
            return '#ffa41b'; // Âmbar puxado para laranja (média distância)
        }
        return '#861a36'; // Vermelho vinho (muito próximo)
    }

    /**
     * Determina a zona de proximidade baseada na distância
     * @param {number} distance - Distância do objeto
     * @param {number} maxRange - Alcance máximo do sensor
     * @returns {string|null} - 'green', 'yellow', 'red', ou null
     */
    getProximityZone(distance, maxRange) {
        const safeDistance = Number(distance);
        const safeMaxRange = Number(maxRange);
        if (!Number.isFinite(safeDistance) || !Number.isFinite(safeMaxRange) || safeMaxRange <= 0) {
            return null;
        }

        const zoneSize = maxRange / 3;
        if (safeDistance <= zoneSize) {
            return 'red'; // Muito próximo (crítico) - proximity-3
        }
        if (safeDistance <= zoneSize * 2) {
            return 'yellow'; // Média distância - proximity-2
        }
        return 'green'; // Longe, mas detectando (ok) - proximity-1
    }

    /**
     * Retorna a zona mais crítica atualmente detectada
     * @returns {string|null} - 'red', 'yellow', 'green', ou null
     */
    getCurrentDetectedZone() {
        return this.currentDetectedZone;
    }

    /**
     * Cria o path SVG para uma linha do sensor
     * Ajusta a curvatura para manter espaçamento uniforme ao longo do arco
     * distanceFromCenter: distância medida a partir do centro do carro
     */
    createSensorPath(side, sensorY, distanceFromCenter, halfLength, curvaturePx, spacing) {
        // xLine é relativo ao centro (negativo para frente, positivo para trás)
        const xLine = side === 'front' ? -distanceFromCenter : distanceFromCenter;
        const startY = sensorY - halfLength;
        const endY = sensorY + halfLength;
        
        // Ajusta a curvatura para compensar o espaçamento visual
        // Quanto maior a distância, menor a curvatura necessária para manter espaçamento uniforme
        const curvatureAdjustment = 1 + (spacing / distanceFromCenter) * 0.15;
        const adjustedCurvature = curvaturePx * curvatureAdjustment;
        
        const controlX = side === 'front' ? (xLine - adjustedCurvature) : (xLine + adjustedCurvature);
        return `M ${xLine} ${startY} Q ${controlX} ${sensorY} ${xLine} ${endY}`;
    }

    /**
     * Cria um grupo de sensores
     */
    createSensorGroup(options) {
        const {
            side,
            sideX,
            carCenterX,
            carCenterY,
            sensors,
            lockDistance,
            objectLocal
        } = options;

        const isVerticalMode = document.body.classList.contains('vertical-driving-mode');

        sensors.forEach((sensor) => {
            const sensorY = sensor.y;
            const sensorRange = sensor.range;
            const sensorBaseLength = sensor.length;
            const sensorRotation = sensor.rotation ?? 0;
            const sensorSpacing = sensor.spacing;
            const sensorWaveCount = sensor.waveCount;
            const sensorInitialOffset = sensor.initialOffset;
            const sensorGrowth = sensor.growth ?? 0;
            const sensorCurvature = sensor.curvature ?? 60;

            // Calcula o eixo do sensor (ponto de origem da primeira linha)
            const sensorAxisX = carCenterX + (side === 'front' ? -sensorInitialOffset : sensorInitialOffset);
            const sensorAxisY = sensorY;

            // Primeiro tenta usar distância vinda da API (em cm), se disponível.
            // Se não houver, faz fallback para o objeto simulado local.
            let sensorDistance = this.getApiDrivenSensorDistance(sensor.id, sensorRange);

            if (sensorDistance === null && objectLocal) {
                // No modo vertical, o carro está rotacionado 90° no sentido horário
                // Precisamos converter as coordenadas do objeto para o sistema de coordenadas do sensor
                let objectX = objectLocal.x;
                let objectY = objectLocal.y;

                if (isVerticalMode) {
                    // Converte coordenadas do objeto para o sistema local do sensor rotacionado
                    // O carro está rotacionado 90° no sentido horário, então:
                    // - O que era "frente" (topo da tela) agora é "esquerda" (lado esquerdo da tela)
                    // - O que era "traseira" (fundo da tela) agora é "direita" (lado direito da tela)
                    const relX = objectLocal.x - carCenterX;
                    const relY = objectLocal.y - carCenterY;
                    
                    // Rotação inversa: desfaz a rotação de 90° do carro
                    // Para desfazer rotação de 90° horário: (x', y') = (y, -x)
                    objectX = carCenterX - relY;  // Invertido para corrigir a direção
                    objectY = carCenterY + relX;
                }

                // Só detecta quando o objeto está no semiplano correto do sensor:
                // frente = para fora no eixo negativo local, traseira = eixo positivo local.
                const isOnSensorSide = side === 'front'
                    ? objectX <= sensorAxisX
                    : objectX >= sensorAxisX;

                if (!isOnSensorSide) {
                    sensorDistance = null;
                } else {
                    const dx = objectX - sensorAxisX;
                    const dy = objectY - sensorY;
                    sensorDistance = Math.sqrt((dx * dx) + (dy * dy));
                }
            }

            const inRange = sensorDistance !== null && sensorDistance <= sensorRange;
            const sensorColor = inRange ? this.getSensorZoneColor(sensorDistance, sensorRange) : null;
            const isLocked = inRange && sensorDistance <= lockDistance;
            
            // Rastreia a zona detectada (para alertas sonoros)
            if (inRange) {
                const zone = this.getProximityZone(sensorDistance, sensorRange);
                // Atualiza para a zona mais crítica (red > yellow > green)
                if (!this.currentDetectedZone) {
                    this.currentDetectedZone = zone;
                } else if (zone === 'red') {
                    this.currentDetectedZone = 'red';
                } else if (zone === 'yellow' && this.currentDetectedZone === 'green') {
                    this.currentDetectedZone = 'yellow';
                }
            }
            const wavesReached = inRange
                ? Math.max(
                    1,
                    Math.min(
                        sensorWaveCount,
                        Math.ceil((1 - (sensorDistance / sensorRange)) * sensorWaveCount)
                    )
                )
                : 0;

            // Cria um grupo SVG para o sensor inteiro (para rotação unificada)
            const sensorGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            sensorGroup.setAttribute('data-sensor-id', sensor.id);
            
            // Aplica rotação no grupo inteiro se necessário
            // Rotação em torno do próprio eixo do sensor (ponto de origem da primeira linha)
            if (sensorRotation !== 0) {
                sensorGroup.setAttribute('transform', `rotate(${sensorRotation} ${sensorAxisX} ${sensorAxisY})`);
            }
            
            // Cria as linhas do sensor com espaçamento uniforme
            for (let i = 0; i < sensorWaveCount; i++) {
                // Distância medida a partir do centro do carro
                const distanceFromCenter = sensorInitialOffset + (i * sensorSpacing);
                
                // Linhas crescem para fora (aumentam comprimento)
                const halfLength = (sensorBaseLength / 2) + (i * sensorGrowth);
                
                // Curvatura: 0 = reta (0px), 100 = máxima curva (pontas se encontram)
                // Para pontas se encontrarem, o ponto de controle precisa estar a ~2x halfLength
                const curvaturePx = (sensorCurvature / 100) * (halfLength * 2);

                // Cria o path da linha com ajuste de curvatura para espaçamento uniforme
                // O path é relativo ao centro (xLine negativo para frente, positivo para trás)
                const localPath = this.createSensorPath(side, sensorY, distanceFromCenter, halfLength, curvaturePx, sensorSpacing);
                
                // Converte para coordenadas do mundo (soma o centro do carro)
                const worldPath = localPath.replace(/(-?\d+\.?\d*) (-?\d+\.?\d*)/g, (match, px, py) => {
                    const x = carCenterX + parseFloat(px);
                    const y = parseFloat(py);
                    return `${x} ${y}`;
                });

                // Cada linha é um "LED": um traço mais grosso por baixo faz a borda
                // (com brilho sutil) e um traço por cima faz o miolo. Apagado, o miolo
                // tem a cor do fundo (linha só com bordas); aceso, borda e miolo
                // ganham a cor da zona com glow.
                const lineWidth = this.config.espessuraLinhas;
                const borderSize = Math.max(1.5, lineWidth * 0.22);

                // Identificador único para esta onda
                const waveKey = `${sensor.id}-${i}`;
                const previousState = this.waveStates.get(waveKey);

                // Define estado desejado baseado na detecção
                let ledColor = null;
                if (isLocked) {
                    // Muito perto: apenas primeira linha vermelha fixa
                    if (i === 0) ledColor = '#861a36';
                } else if (inRange && sensorDistance !== null && i < wavesReached) {
                    // Objeto detectado: cor baseada na distância do objeto
                    ledColor = sensorColor;
                }
                const isActive = ledColor !== null;
                // Só anima o "acender" na borda de subida (apagado -> aceso)
                const justLit = isActive && (!previousState || !previousState.isActive);

                const createLedPath = (part, width) => {
                    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    path.setAttribute('d', worldPath);
                    path.setAttribute('class', `wave wave-${part}${isActive ? ' is-active' : ''}${justLit ? ' led-on' : ''}`);
                    path.setAttribute('data-direction', side);
                    path.setAttribute('data-sensor-id', sensor.id);
                    path.setAttribute('data-index', i);
                    // Pontas arredondadas (borda e miolo são círculos concêntricos na ponta)
                    path.setAttribute('stroke-linecap', 'round');
                    path.setAttribute('stroke-linejoin', 'round');
                    path.setAttribute('stroke-width', `${width}px`);
                    path.style.opacity = '1';
                    if (isActive) {
                        path.style.setProperty('--led-color', ledColor);
                        // Linhas mais próximas (índice menor) acendem primeiro
                        path.style.setProperty('--led-delay', `${i * 50}ms`);
                    }
                    sensorGroup.appendChild(path);
                    this.waves.push(path);
                    return path;
                };

                const outline = createLedPath('outline', lineWidth + borderSize * 2);
                const core = createLedPath('core', lineWidth);

                // A ponta redonda avança meia espessura além do fim do traço. Encurtamos
                // as duas camadas pelo raio da borda, para a linha manter o comprimento
                // original (sem invadir o sensor vizinho). Com o mesmo recuo nas duas, as
                // pontas ficam concêntricas e a borda tem espessura uniforme também na curva.
                const capInset = lineWidth / 2 + borderSize;
                const totalLength = core.getTotalLength();
                if (totalLength > capInset * 3) {
                    [outline, core].forEach((path) => {
                        path.setAttribute('stroke-dasharray', `${totalLength - capInset * 2} ${totalLength}`);
                        path.setAttribute('stroke-dashoffset', `${-capInset}`);
                    });
                }

                // Salva estado atual para próxima comparação
                this.waveStates.set(waveKey, {
                    stroke: ledColor,
                    opacity: '1',
                    isActive: isActive
                });
            }
            
            // Adiciona o grupo completo do sensor ao SVG
            this.svg.appendChild(sensorGroup);
        });
    }

    /**
     * Atualiza as ondas
     */
    updateWaves() {
        // Reseta a zona detectada antes de criar novas ondas
        this.currentDetectedZone = null;
        this.createWaves();
    }

    /**
     * Remove todas as ondas
     */
    clearWaves() {
        // Remove áreas de visualização se existirem
        this.areaGroups.forEach(group => group.remove());
        this.areaGroups = [];
        this.waves.forEach(wave => wave.remove());
        this.waves = [];
        // Limpa estados anteriores para evitar referências obsoletas
        this.waveStates.clear();
    }

    /**
     * Para a animação
     */
    stop() {
        this.clearWaves();
    }

    /**
     * Anima a entrada dos sensores quando entrar na posição horizontal
     * Ordem: pontas (superior e inferior) → traseiro → centrais (superior e inferior)
     * Cada linha dentro de um sensor aparece sequencialmente
     */
    animateSensorEntrance() {
        if (this.isAnimating || this.waves.length === 0) return;
        
        this.isAnimating = true;
        const allWaves = Array.from(this.waves);
        
        if (allWaves.length === 0) {
            this.isAnimating = false;
            return;
        }
        
        // Agrupa por sensor e índice para animar "linha completa" (borda + principal) juntas.
        const wavesBySensor = {};
        allWaves.forEach(wave => {
            const sensorId = wave.getAttribute('data-sensor-id');
            const index = wave.getAttribute('data-index') || '0';
            if (!wavesBySensor[sensorId]) {
                wavesBySensor[sensorId] = {};
            }
            if (!wavesBySensor[sensorId][index]) {
                wavesBySensor[sensorId][index] = [];
            }
            wavesBySensor[sensorId][index].push(wave);
        });
        
        // Ordem dos sensores: pontas → centro
        const sensorOrder = [
            'ponta-superior',
            'ponta-inferior',
            'centro'
        ];
        
        // Filtra apenas sensores que existem
        const orderedSensors = sensorOrder.filter(id => wavesBySensor[id]);
        
        const delayPerWave = 130; // Delay entre cada linha dentro de um sensor (ms)
        const delayBetweenSensors = 260; // Delay entre sensores (ms)
        
        let currentTime = 0;
        
        // Primeira fase: anima cada sensor sequencialmente
        orderedSensors.forEach((sensorId) => {
            const sensorLines = Object.keys(wavesBySensor[sensorId])
                .map((key) => parseInt(key, 10))
                .filter((value) => !Number.isNaN(value))
                .sort((a, b) => a - b);
            
            // Anima cada linha do sensor
            sensorLines.forEach((lineIndex, waveIndex) => {
                const lineParts = wavesBySensor[sensorId][String(lineIndex)] || [];

                lineParts.forEach((wave) => {
                    // Inicia invisível
                    const originalOpacity = wave.style.opacity || '0.65';
                    wave.setAttribute('data-original-opacity', originalOpacity);
                    wave.style.opacity = '0';
                });

                // Calcula o tempo de início da animação
                const startTime = currentTime + (waveIndex * delayPerWave);

                // Anima a entrada da linha completa (borda + principal)
                setTimeout(() => {
                    lineParts.forEach((wave) => {
                        wave.style.transition = 'opacity 0.48s cubic-bezier(0.22, 1, 0.36, 1)';
                        wave.style.opacity = wave.getAttribute('data-original-opacity') || '0.65';
                    });
                }, startTime);
            });
            
            // Atualiza o tempo atual para o próximo sensor
            // Tempo do último wave deste sensor + delay entre sensores
            currentTime += (sensorLines.length * delayPerWave) + delayBetweenSensors;
        });
        
        // Calcula quando todas as linhas terminaram de aparecer
        const totalEntranceTime = currentTime + 400; // +400ms para a última animação terminar
        
        // Segunda fase: todas piscam por 2 segundos
        setTimeout(() => {
            const blinkDuration = 2000; // 2 segundos
            const blinkInterval = 800; // Intervalo entre piscadas (devagar)
            let blinkCount = 0;
            const maxBlinks = Math.floor(blinkDuration / blinkInterval);
            
            const blink = () => {
                if (blinkCount >= maxBlinks) {
                    // Termina a animação - restaura opacidade original
                    allWaves.forEach(wave => {
                        const originalOpacity = wave.getAttribute('data-original-opacity') || '0.65';
                        wave.style.transition = '';
                        wave.style.opacity = originalOpacity;
                        wave.removeAttribute('data-original-opacity');
                    });
                    this.isAnimating = false;
                    return;
                }
                
                // Pisca todas as linhas (mas mantém a cor de detecção se houver)
                allWaves.forEach(wave => {
                    const currentOpacity = parseFloat(wave.style.opacity) || 0.65;
                    const originalOpacity = wave.getAttribute('data-original-opacity') || '0.65';
                    wave.style.transition = 'opacity 0.4s ease-in-out';
                    // Durante o piscar, alterna entre opacidade baixa e original, mas mantém a cor
                    wave.style.opacity = currentOpacity > 0.3 ? '0.3' : originalOpacity;
                });
                
                blinkCount++;
                setTimeout(blink, blinkInterval);
            };
            
            blink();
        }, totalEntranceTime);
    }
}
