/**
 * Módulo TestMode
 * Gerencia o modo de teste e detecção de ativação
 */

export class TestMode {
    constructor() {
        this.isActive = false;
        this.keyPresses = [];
        this.keyPressTimeout = null;
        this.requiredPresses = 5;
        this.maxTimeBetweenPresses = 500; // 500ms entre cada pressionamento
        this.lastMousePosition = null;
        
        // Contador separado para visualização de áreas (10 Q's)
        this.areaVisualizationPresses = [];
        this.areaVisualizationRequired = 10;
    }

    /**
     * Inicializa o modo de teste
     */
    init() {
        document.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() === 'q') {
                this.handleKeyPress();
            }
        });
        
        // Captura a posição do mouse continuamente
        document.addEventListener('mousemove', (e) => {
            this.lastMousePosition = { x: e.clientX, y: e.clientY };
        });
    }
    
    /**
     * Obtém a última posição conhecida do mouse
     * @returns {{x: number, y: number} | null}
     */
    getLastMousePosition() {
        return this.lastMousePosition;
    }

    /**
     * Processa o pressionamento da tecla Q
     */
    handleKeyPress() {
        const now = Date.now();
        
        // Limpa pressionamentos antigos
        this.keyPresses = this.keyPresses.filter(
            time => now - time < this.maxTimeBetweenPresses * this.requiredPresses
        );
        
        // Adiciona o novo pressionamento
        this.keyPresses.push(now);
        
        // Verifica se atingiu o número necessário para modo de teste (5 Q's)
        if (this.keyPresses.length >= this.requiredPresses) {
            this.activateTestMode();
            this.keyPresses = [];
        }
        
        // Contador separado para visualização de áreas (10 Q's)
        this.areaVisualizationPresses = this.areaVisualizationPresses.filter(
            time => now - time < this.maxTimeBetweenPresses * this.areaVisualizationRequired
        );
        this.areaVisualizationPresses.push(now);
        
        // Verifica se atingiu 10 Q's para visualização de áreas
        if (this.areaVisualizationPresses.length >= this.areaVisualizationRequired) {
            this.toggleAreaVisualization();
            this.areaVisualizationPresses = [];
        }
        
        // Limpa o timeout anterior
        if (this.keyPressTimeout) {
            clearTimeout(this.keyPressTimeout);
        }
        
        // Define timeout para limpar pressionamentos
        this.keyPressTimeout = setTimeout(() => {
            this.keyPresses = [];
            this.areaVisualizationPresses = [];
        }, this.maxTimeBetweenPresses * this.areaVisualizationRequired);
    }
    
    /**
     * Alterna a visualização das áreas de alcance
     */
    toggleAreaVisualization() {
        window.dispatchEvent(new CustomEvent('toggleAreaVisualization'));
    }

    /**
     * Ativa o modo de teste
     */
    activateTestMode() {
        if (!this.isActive) {
            this.isActive = true;
            // Modo de teste ativado
            // Dispara evento customizado
            window.dispatchEvent(new CustomEvent('testModeActivated'));
        }
    }

    /**
     * Desativa o modo de teste
     */
    deactivateTestMode() {
        this.isActive = false;
        window.dispatchEvent(new CustomEvent('testModeDeactivated'));
    }

    /**
     * Verifica se o modo de teste está ativo
     * @returns {boolean}
     */
    get active() {
        return this.isActive;
    }
}
