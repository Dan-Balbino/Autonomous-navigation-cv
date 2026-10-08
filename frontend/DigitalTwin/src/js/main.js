/**
 * Módulo Principal da Aplicação
 * Gerencia a inicialização e o carregamento da imagem
 */

import { ImageLoader } from './modules/imageLoader.js';
import { AppController } from './modules/appController.js';
import { FullscreenManager } from './modules/fullscreenManager.js';
import { ProximityWaves } from './modules/proximityWaves.js';
import { TestMode } from './modules/testMode.js';
import { TestObject } from './modules/testObject.js';
import { ProximityDetector } from './modules/proximityDetector.js';
import { DeviceStatusManager } from './modules/deviceStatusManager.js';
import { SpeedometerManager } from './modules/speedometerManager.js';
import { ProximityAudioManager } from './modules/proximityAudioManager.js';
import { WheelTelemetry } from './modules/wheelTelemetry.js';
import { startDotBackground } from './modules/dotBackground.js';

// Fundo com a malha de pontos animada (independe do resto da inicialização)
startDotBackground();

/**
 * Inicializa a aplicação quando o DOM estiver pronto
 */
function init() {
    const imageElement = document.getElementById('carImage');
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const layoutModeBtn = document.getElementById('layoutModeBtn');
    const clockMainEl = document.getElementById('topClockMain');
    const clockSecondsEl = document.getElementById('topClockSeconds');
    const clockMillisecondsEl = document.getElementById('topClockMilliseconds');
    const lightIndicatorEl = document.getElementById('lightIndicator');
    const lightStatusTextEl = document.getElementById('lightStatusText');
    const wavesContainer = document.getElementById('proximityWaves');
    const appContainer = document.querySelector('.app-container');
    const proximityPanel = document.querySelector('.proximity-panel');

    if (!imageElement) {
        console.error('Elemento da imagem não encontrado');
        return;
    }

    const imageLoader = new ImageLoader(imageElement);
    const appController = new AppController(imageLoader);
    const deviceStatusManager = new DeviceStatusManager();
    deviceStatusManager.init();
    
    // Inicializa o modo de teste
    const testMode = new TestMode();
    testMode.init();
    
    // Inicializa o objeto de teste
    const testObject = new TestObject(appContainer || document.body);

    const updateClock = () => {
        if (!clockMainEl || !clockSecondsEl || !clockMillisecondsEl) return;
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        const ms = String(now.getMilliseconds()).padStart(3, '0');
        clockMainEl.textContent = `${hh}:${mm}`;
        clockSecondsEl.textContent = ss;
        clockMillisecondsEl.textContent = ms;
    };

    updateClock();
    window.setInterval(updateClock, 10); // Atualiza a cada 10ms para milissegundos suaves
    
    // Aguarda o carregamento da imagem antes de inicializar as ondas
    appController.start().then(async () => {
        // Inicializa as ondas de proximidade após a imagem carregar
        if (wavesContainer) {
            // Carrega a configuração do JSON
            let config = null;
            try {
                // Adiciona timestamp para evitar cache do navegador
                const timestamp = new Date().getTime();
                const response = await fetch(`src/config/proximity-config.json?t=${timestamp}`, {
                    cache: 'no-cache'
                });
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const text = await response.text();
                // Remove comentários de linha (//) e comentários de bloco (/* */) do JSON
                const cleanedText = text
                    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove comentários de bloco
                    .replace(/\/\/.*$/gm, ''); // Remove comentários de linha
                config = JSON.parse(cleanedText);
            } catch (error) {
                console.warn('Não foi possível carregar a configuração, usando valores padrão:', error);
            }

            const speedometer = new SpeedometerManager(config || {});
            speedometer.init();
            // O velocímetro passa a ser controlado por dados externos (API), sem desaceleração local.
            if (speedometer.decelerationTimer) {
                clearInterval(speedometer.decelerationTimer);
                speedometer.decelerationTimer = null;
            }

            // Telemetria das rodas (speed1..4); a barra enche em rodasVelocidadeMax (m/s)
            const wheelTelemetry = new WheelTelemetry(
                document.getElementById('wheelTelemetry'),
                Number(config?.rodasVelocidadeMax) || 10
            );
            wheelTelemetry.init();

            // Cache de elementos DOM para melhor performance
            const rpmValueEl = document.getElementById('rpmValue');
            const horizontalRpmValueEl = document.getElementById('horizontalRpmValue');
            const horizontalSpeedValueEl = document.getElementById('horizontalSpeedValue');
            const horizontalLightIndicatorEl = document.getElementById('horizontalLightIndicator');
            const horizontalLightStatusTextEl = document.getElementById('horizontalLightStatusText');

            const wheelDiameterCm = Number(config?.diametro_roda);
            const wheelDiameterMeters = Number.isFinite(wheelDiameterCm) && wheelDiameterCm > 0
                ? (wheelDiameterCm / 100)
                : 0.21;
            const gearRatio = (() => {
                const r = Number(config?.relacao_reducao);
                return Number.isFinite(r) && r > 0 ? r : 250;
            })();
            const maxMotorRpm = (() => {
                const r = Number(config?.motor_rpm_max);
                return Number.isFinite(r) && r > 0 ? r : 30000;
            })();
            const getParam = (name) => {
                try {
                    const value = new URLSearchParams(window.location.search).get(name);
                    return value && value.trim() ? value.trim() : null;
                } catch {
                    return null;
                }
            };
            const dashboardApiBaseUrl = (() => {
                const explicitBase = getParam('apiBase');
                if (explicitBase) {
                    return explicitBase.replace(/\/+$/, '');
                }
                const apiHost = getParam('apiHost');
                const apiPort = getParam('apiPort');
                // Servido pelo Flask do carro (messaging_core, porta 5000): a API está na mesma origem
                if (!apiHost && !apiPort && window.location.protocol.startsWith('http')) {
                    return `${window.location.origin}/api`;
                }
                return `http://${apiHost || window.location.hostname || '127.0.0.1'}:${apiPort || '5000'}/api`;
            })();
            const dashboardApiUrl = `${dashboardApiBaseUrl}/dashboard`;
            // 400 ms: rápido o bastante para a telemetria das rodas responder como painel de corrida
            const dashboardPollIntervalMs = 400;
            let dashboardPollTimer = null;
            let speedRecalcTimer = null;
            let latestRpm = 0;
            let latestPwm = 0;
            // Velocidade real, lida de car.telemetry.speed (via /api/dashboard) — não é
            // mais derivada do PWM comandado, então o velocímetro reflete o sensor do carro.
            let latestRealSpeed = 0;
            let lastRotateFromApi = null;
            let displayedSpeed = 0;
            let lastSpeedUpdateTs = performance.now();
            const speedSmoothingPerSecond = (() => {
                const configured = Number(config?.velocimetroSuavizacaoPorSegundo);
                return Number.isFinite(configured) && configured > 0 ? configured : 8;
            })();

            const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
            const parseNumber = (value) => {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? parsed : null;
            };
            const wheelCircumference = Math.PI * wheelDiameterMeters;
            // Usado apenas pela simulação de teste (tecla V) para mover o indicador de PWM;
            // o velocímetro em si é alimentado direto por latestRealSpeed (car.telemetry.speed).
            const speedToRpm = (speedMmin) => (speedMmin / wheelCircumference) * gearRatio;

            // Simulação por tecla V — limitada ao máximo físico real (PWM 255 → motor max → roda)
            let simSpeed = 0;
            const simAccelPerKey = Number(config?.debugAceleracaoPorTecla) > 0 ? Number(config.debugAceleracaoPorTecla) : 5;
            const simDecelPerSec = Number(config?.debugDesaceleracaoPorSegundo) > 0 ? Number(config.debugDesaceleracaoPorSegundo) : 8;
            const simMaxSpeed = (maxMotorRpm / gearRatio) * wheelCircumference;

            let isHeadlightOn = false;

            const updateHeadlightUI = () => {
                const lightAlt = isHeadlightOn ? 'Farol ligado' : 'Farol desligado';
                const lightText = isHeadlightOn ? 'Farol Aceso' : 'Farol Apagado';
                
                if (lightIndicatorEl) {
                    const lightOff = lightIndicatorEl.querySelector('#lightOff');
                    const lightOn = lightIndicatorEl.querySelector('#lightOn');
                    if (lightOff && lightOn) {
                        if (isHeadlightOn) {
                            lightOff.style.display = 'none';
                            lightOn.style.display = 'block';
                        } else {
                            lightOff.style.display = 'block';
                            lightOn.style.display = 'none';
                        }
                    }
                    lightIndicatorEl.setAttribute('alt', lightAlt);
                }
                if (lightStatusTextEl) {
                    // Atualiza o texto no card integrado (modo vertical)
                    lightStatusTextEl.textContent = isHeadlightOn ? 'Aceso' : 'Apagado';
                }
                
                // Atualiza também no dashboard horizontal
                if (horizontalLightIndicatorEl) {
                    const horizontalLightOff = horizontalLightIndicatorEl.querySelector('#horizontalLightOff');
                    const horizontalLightOn = horizontalLightIndicatorEl.querySelector('#horizontalLightOn');
                    if (horizontalLightOff && horizontalLightOn) {
                        if (isHeadlightOn) {
                            horizontalLightOff.style.display = 'none';
                            horizontalLightOn.style.display = 'block';
                        } else {
                            horizontalLightOff.style.display = 'block';
                            horizontalLightOn.style.display = 'none';
                        }
                    }
                    horizontalLightIndicatorEl.setAttribute('alt', lightAlt);
                }
                if (horizontalLightStatusTextEl) horizontalLightStatusTextEl.textContent = lightText;
            };

            const updateSpeedAndRpmUI = () => {
                const targetSpeed = latestRealSpeed;
                const now = performance.now();
                const deltaSeconds = Math.max(0.016, Math.min(0.25, (now - lastSpeedUpdateTs) / 1000));
                lastSpeedUpdateTs = now;

                const maxStep = speedSmoothingPerSecond * deltaSeconds;
                const delta = targetSpeed - displayedSpeed;
                if (Math.abs(delta) <= maxStep) {
                    displayedSpeed = targetSpeed;
                } else {
                    displayedSpeed += Math.sign(delta) * maxStep;
                }

                speedometer.setSpeed(displayedSpeed);
                if (horizontalSpeedValueEl) {
                    horizontalSpeedValueEl.textContent = displayedSpeed.toFixed(2);
                }

                const pwmText = String(Math.round(Math.max(0, Math.min(255, latestPwm))));
                if (rpmValueEl) rpmValueEl.textContent = pwmText;
                if (horizontalRpmValueEl) horizontalRpmValueEl.textContent = pwmText;
            };

            let setLayoutMode = () => {};

            // Placa de PARE / semáforo / desvio / veículo — mesma lógica de indicação do painel web.
            // Cada sinal existe na barra de baixo (horizontal) e no painel lateral (vertical);
            // o estado (cor) vai no item inteiro, pois ícone e valor mudam de cor juntos.
            const setSignalChip = (name, text, state) => {
                document.querySelectorAll(`[data-signal="${name}"]`).forEach((item) => {
                    const valueEl = item.querySelector('.hud-signal-value');
                    if (valueEl) valueEl.textContent = text;
                    item.classList.remove('state-green', 'state-red', 'state-yellow', 'state-muted');
                    item.classList.add(`state-${state}`);
                });
            };

            const updateSignalChips = (dashboardData) => {
                const stopRaw = dashboardData?.tabDashboard_stop_active ?? dashboardData?.tabdashboard_stop_active;
                const stopActive = typeof stopRaw === 'boolean' ? stopRaw : null;
                if (stopActive === true) setSignalChip('stop', 'ATIVA', 'red');
                else if (stopActive === false) setSignalChip('stop', 'LIVRE', 'green');
                else setSignalChip('stop', '—', 'muted');

                const lightCode = parseNumber(dashboardData?.tabDashboard_traffic_light_code ?? dashboardData?.tabdashboard_traffic_light_code);
                const lightMap = { 0: ['VERMELHO', 'red'], 1: ['AMARELO', 'yellow'], 2: ['VERDE', 'green'], '-1': ['NENHUM', 'muted'] };
                const [lightText, lightState] = lightMap[lightCode] ?? ['—', 'muted'];
                setSignalChip('light', lightText, lightState);

                const rightDetourRaw = dashboardData?.tabDashboard_right_detour_active ?? dashboardData?.tabdashboard_right_detour_active;
                const rightDetourActive = typeof rightDetourRaw === 'boolean' ? rightDetourRaw : null;
                if (rightDetourActive === true) setSignalChip('detour', 'ATIVA', 'green');
                else if (rightDetourActive === false) setSignalChip('detour', 'LIVRE', 'muted');
                else setSignalChip('detour', '—', 'muted');

                const runningRaw = dashboardData?.tabDashboard_running ?? dashboardData?.tabdashboard_running;
                const running = Boolean(runningRaw);
                let reasonText = '—', reasonState = 'muted';
                if (!running) { reasonText = 'PARADO (painel)'; reasonState = 'red'; }
                else if (stopActive) { reasonText = 'PARADO — PLACA'; reasonState = 'red'; }
                else if (lightCode === 0) { reasonText = 'PARADO — SEMÁFORO'; reasonState = 'red'; }
                else if (rightDetourActive) { reasonText = 'DESVIO — DIREITA'; reasonState = 'green'; }
                else { reasonText = 'EM MOVIMENTO'; reasonState = 'green'; }
                setSignalChip('reason', reasonText, reasonState);
            };

            const applyDashboardPayload = (dashboardData) => {
                const rpm = parseNumber(dashboardData?.tabDashboard_rpm ?? dashboardData?.tabdashboard_rpm);
                const realSpeed = parseNumber(dashboardData?.tabDashboard_speed ?? dashboardData?.tabdashboard_speed);
                const batteryLevel = parseNumber(dashboardData?.tabDashboard_battery ?? dashboardData?.tabdashboard_battery);
                const lightRaw = dashboardData?.tabDashboard_light ?? dashboardData?.tabdashboard_light;
                const rotateRaw = dashboardData?.tabDashboard_rotate ?? dashboardData?.tabdashboard_rotate;
                const light = Boolean(lightRaw);
                const rotate = typeof rotateRaw === 'boolean'
                    ? rotateRaw
                    : (rotateRaw === 'true' ? true : (rotateRaw === 'false' ? false : null));
                const sensorValuesCm = {
                    'ponta-superior': parseNumber(dashboardData?.tabDashboard_sensor_1 ?? dashboardData?.tabdashboard_sensor_1),
                    'centro':         parseNumber(dashboardData?.tabDashboard_sensor_2 ?? dashboardData?.tabdashboard_sensor_2),
                    'ponta-inferior': parseNumber(dashboardData?.tabDashboard_sensor_3 ?? dashboardData?.tabdashboard_sensor_3),
                };

                if (rpm !== null) {
                    latestPwm = Math.round(Math.max(0, Math.min(255, rpm)));
                    latestRpm = (latestPwm / 255) * maxMotorRpm;
                }
                if (realSpeed !== null) {
                    latestRealSpeed = Math.max(0, realSpeed);
                }
                updateSpeedAndRpmUI();

                deviceStatusManager.setLevel(batteryLevel);
                updateSignalChips(dashboardData);
                wheelTelemetry.update(dashboardData);

                isHeadlightOn = light;
                updateHeadlightUI();

                if (rotate !== null) {
                    // Só troca layout quando o valor atual da API for diferente do último valor recebido.
                    if (lastRotateFromApi === null || rotate !== lastRotateFromApi) {
                        lastRotateFromApi = rotate;
                        console.info('[Dashboard API] rotate alterado, aplicando layout:', rotate ? 'vertical' : 'horizontal');
                        setLayoutMode(rotate);
                    }
                } else {
                    console.warn('[Dashboard API] Campo de rotação ausente ou inválido no payload:', dashboardData);
                }

                if (proximityWaves) {
                    proximityWaves.setApiSensorDistancesCm(sensorValuesCm);
                    proximityWaves.updateWaves();
                    updateProximityAudio();
                }
            };

            const fetchDashboardData = async () => {
                try {
                    console.info('[Dashboard API] GET /api/dashboard - requisitando');
                    const response = await fetch(dashboardApiUrl, { method: 'GET', cache: 'no-cache' });
                    const payload = await response.json().catch(() => null);

                    if (!response.ok) {
                        const apiMessage = typeof payload?.message === 'string' ? ` - ${payload.message}` : '';
                        throw new Error(`Falha ao consultar dashboard: ${response.status}${apiMessage}`);
                    }

                    if (!payload || typeof payload !== 'object' || !payload.data || typeof payload.data !== 'object') {
                        throw new Error('Resposta da API sem dados válidos de dashboard');
                    }

                    applyDashboardPayload(payload.data);
                    console.info('[Dashboard API] GET /api/dashboard - sucesso', payload.data);
                } catch (error) {
                    console.warn('Erro ao atualizar dashboard via API:', error);
                }
            };

            const startDashboardPolling = () => {
                if (dashboardPollTimer) {
                    clearInterval(dashboardPollTimer);
                }
                fetchDashboardData();
                dashboardPollTimer = setInterval(fetchDashboardData, dashboardPollIntervalMs);
            };

            const startSpeedRecalculation = () => {
                if (speedRecalcTimer) {
                    clearInterval(speedRecalcTimer);
                }
                speedRecalcTimer = setInterval(() => {
                    if (simSpeed > 0) {
                        simSpeed = Math.max(0, simSpeed - simDecelPerSec * 0.1);
                        latestRpm = speedToRpm(simSpeed);
                        latestPwm = Math.min(255, Math.round((latestRpm / maxMotorRpm) * 255));
                    }
                    updateSpeedAndRpmUI();
                }, 100);
            };

            updateHeadlightUI();
            displayedSpeed = speedometer.getSpeed();
            lastSpeedUpdateTs = performance.now();
            updateSpeedAndRpmUI();
            startSpeedRecalculation();
            
            // Cria o detector de proximidade
            const proximityDetector = new ProximityDetector(imageElement, testObject);
            
            // Cria as ondas de proximidade com o detector
            const proximityWaves = new ProximityWaves(wavesContainer, imageElement, config, proximityDetector);
            
            // Inicializa o gerenciador de áudio para alertas sonoros
            const proximityAudio = new ProximityAudioManager();
            
            // Função para atualizar o áudio baseado na zona detectada
            const updateProximityAudio = () => {
                const detectedZone = proximityWaves.getCurrentDetectedZone();
                proximityAudio.updateZone(detectedZone);
            };

            // Controla o layout por estado explícito: true=vertical, false=horizontal, null=toggle.
            setLayoutMode = (targetVertical = null) => {
                const isCurrentlyVertical = document.body.classList.contains('vertical-driving-mode');
                const hasExplicitTarget = typeof targetVertical === 'boolean';
                if (hasExplicitTarget && targetVertical === isCurrentlyVertical) {
                    return;
                }
                const isEnteringVertical = hasExplicitTarget ? targetVertical : !isCurrentlyVertical;
                const horizontalDashboard = document.getElementById('horizontalDashboard');
                const sideDashboard = document.querySelector('.side-dashboard');
                
                // Animação de saída antes de mudar o modo
                if (isEnteringVertical && horizontalDashboard) {
                    // Saindo do modo horizontal - card desce
                    horizontalDashboard.classList.add('exiting');
                    horizontalDashboard.style.display = 'flex';
                    horizontalDashboard.style.animation = 'slideDownToBottom 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards';
                    setTimeout(() => {
                        horizontalDashboard.style.display = 'none';
                        horizontalDashboard.style.animation = '';
                        horizontalDashboard.classList.remove('exiting');
                        document.body.classList.add('vertical-layout-animating');

                        // Prepara o card vertical já oculto para evitar "piscar" antes da animação.
                        if (sideDashboard) {
                            sideDashboard.classList.remove('exiting');
                            sideDashboard.style.left = '50%';
                            sideDashboard.style.top = '50%';
                            sideDashboard.style.display = 'flex';
                            sideDashboard.style.transform = 'translate(calc(var(--vertical-layout-offset) + 100%), -50%)';
                            sideDashboard.style.opacity = '0';
                            sideDashboard.style.animation = '';
                        }

                        document.body.classList.add('vertical-driving-mode');
                        
                        // Executa animação de entrada sem delay para evitar flash.
                        if (sideDashboard) {
                            sideDashboard.offsetHeight;
                            sideDashboard.style.animation = 'slideInFromSide 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards';
                            setTimeout(() => {
                                sideDashboard.style.animation = '';
                                sideDashboard.style.opacity = '';
                                sideDashboard.style.transform = '';
                            }, 600);
                        }
                    }, 650);
                } else if (!isEnteringVertical && sideDashboard) {
                    // Saindo do modo vertical - card sai pela lateral
                    sideDashboard.classList.add('exiting');
                    // Remove qualquer animação anterior
                    sideDashboard.style.animation = '';
                    sideDashboard.style.display = 'flex';
                    // Garante que está na posição correta antes da animação
                    sideDashboard.style.left = '50%';
                    sideDashboard.style.top = '50%';
                    // Remove transform anterior
                    sideDashboard.style.transform = '';
                    sideDashboard.style.opacity = '';
                    // Força reflow
                    sideDashboard.offsetHeight;
                    // Define estado inicial da animação
                    sideDashboard.style.transform = `translate(calc(var(--vertical-layout-offset)), -50%)`;
                    sideDashboard.style.opacity = '1';
                    // Força outro reflow
                    sideDashboard.offsetHeight;
                    // Aplica a animação de saída
                    sideDashboard.style.animation = 'slideOutToSide 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards';
                    setTimeout(() => {
                        sideDashboard.style.display = 'none';
                        sideDashboard.style.animation = '';
                        sideDashboard.style.opacity = '';
                        sideDashboard.style.transform = '';
                        sideDashboard.classList.remove('exiting');
                        document.body.classList.add('vertical-layout-animating');
                        document.body.classList.remove('vertical-driving-mode');
                        
                        // Mostra o card horizontal com animação de subida após um pequeno delay
                        setTimeout(() => {
                            if (horizontalDashboard) {
                                horizontalDashboard.classList.remove('exiting');
                                horizontalDashboard.style.display = 'flex';
                                horizontalDashboard.style.animation = 'slideUpFromBottom 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards';
                                setTimeout(() => {
                                    horizontalDashboard.style.animation = '';
                                }, 600);
                            }
                        }, 50);
                    }, 650);
                } else {
                    // Entrando no modo - animação normal
                    document.body.classList.add('vertical-layout-animating');
                    document.body.classList.toggle('vertical-driving-mode');
                    
                    // Se está entrando no modo horizontal, mostra o card com animação
                    if (!document.body.classList.contains('vertical-driving-mode') && horizontalDashboard) {
                        horizontalDashboard.style.display = 'flex';
                        horizontalDashboard.style.animation = 'slideUpFromBottom 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards';
                        setTimeout(() => {
                            horizontalDashboard.style.animation = '';
                        }, 600);
                    }
                }

                // Recalcula novamente no final da transição para garantir retorno ao padrão
                let hasRefreshed = false;
                // Usa a intenção da troca (e não o estado atual do DOM) para saber o layout de destino.
                const isEnteringHorizontal = !isEnteringVertical;
                const finishRefresh = () => {
                    if (hasRefreshed) return;
                    hasRefreshed = true;
                    proximityWaves.updateWaves();
                    
                    // Se está entrando no modo horizontal, anima os sensores
                    if (isEnteringHorizontal) {
                        proximityWaves.animateSensorEntrance();
                    }

                    updateProximityAudio();
                    document.body.classList.remove('vertical-layout-animating');
                };

                if (proximityPanel) {
                    const onTransitionEnd = (event) => {
                        if (event.propertyName !== 'transform') return;
                        proximityPanel.removeEventListener('transitionend', onTransitionEnd);
                        finishRefresh();
                    };
                    proximityPanel.addEventListener('transitionend', onTransitionEnd);
                }

                // Fallback caso transitionend não dispare
                setTimeout(finishRefresh, 1200);
            };

            // Botão de girar tela alterna entre o modo horizontal e o modo vertical
            if (layoutModeBtn) {
                layoutModeBtn.addEventListener('click', () => {
                    setLayoutMode();
                });
            }

            // Tecla R alterna entre o modo horizontal e o modo vertical (com velocímetro)
            // Tecla V aumenta a velocidade simulada
            window.addEventListener('keydown', (e) => {
                if (e.key === 'r' || e.key === 'R') {
                    setLayoutMode();
                }
                if (e.key === 'v' || e.key === 'V') {
                    simSpeed = Math.min(simSpeed + simAccelPerKey, simMaxSpeed);
                    latestRpm = speedToRpm(simSpeed);
                    latestPwm = Math.min(255, Math.round((latestRpm / maxMotorRpm) * 255));
                    updateSpeedAndRpmUI();
                }
            });

            startDashboardPolling();
            
            // Aguarda alguns frames para garantir que a imagem está totalmente renderizada
            setTimeout(() => {
                requestAnimationFrame(() => {
                    proximityWaves.init();
                });
            }, 100);
            
            // Event listeners para o modo de teste
            window.addEventListener('testModeActivated', () => {
                // Obtém a última posição do mouse do testMode
                const mousePos = testMode.getLastMousePosition();
                if (mousePos) {
                    // Cria um evento mock para passar a posição
                    const mockEvent = {
                        clientX: mousePos.x,
                        clientY: mousePos.y
                    };
                    testObject.show(mockEvent);
                } else {
                    // Se não houver posição do mouse, mostra no centro
                    testObject.show();
                }
                // Atualiza as ondas quando o objeto aparece
                proximityWaves.updateWaves();
                updateProximityAudio();
            });
            
            window.addEventListener('testModeDeactivated', () => {
                testObject.hide();
                // Atualiza as ondas quando o objeto desaparece
                proximityWaves.updateWaves();
                updateProximityAudio();
            });

            // Atualiza as ondas apenas quando o objeto realmente se move.
            // Isso evita reiniciar a animação em todo frame (e deixar as ondas invisíveis).
            let moveRaf = null;
            window.addEventListener('testObjectMoved', () => {
                if (!testObject.isVisible) {
                    return;
                }
                if (moveRaf) {
                    cancelAnimationFrame(moveRaf);
                }
                moveRaf = requestAnimationFrame(() => {
                    proximityWaves.updateWaves();
                    updateProximityAudio();
                    moveRaf = null;
                });
            });

        }
    });

    // Inicializa o gerenciador de fullscreen
    if (fullscreenBtn) {
        const fullscreenManager = new FullscreenManager(document.documentElement);
        
        fullscreenBtn.addEventListener('click', () => {
            fullscreenManager.toggle();
        });

        // Atualiza o estado quando o fullscreen muda
        const updateFullscreenState = () => {
            fullscreenManager.updateState();
        };

        document.addEventListener('fullscreenchange', updateFullscreenState);
        document.addEventListener('webkitfullscreenchange', updateFullscreenState);
        document.addEventListener('mozfullscreenchange', updateFullscreenState);
        document.addEventListener('MSFullscreenChange', updateFullscreenState);
    }
}

// Aguarda o carregamento completo do DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
