/**
 * Módulo ProximityAudioManager
 * Gerencia os alertas sonoros baseados na proximidade do objeto
 */
export class ProximityAudioManager {
    constructor() {
        this.currentZone = null; // 'green', 'yellow', 'red', ou null
        this.audioElements = {
            green: null,   // proximity-1.m4a
            yellow: null,    // proximity-2.m4a
            red: null       // proximity-3.m4a
        };
        this.isEnabled = true;
        this.init();
    }

    /**
     * Inicializa os elementos de áudio
     */
    init() {
        // Cria elementos de áudio para cada zona
        this.audioElements.green = this.createAudioElement('assets/sounds/proximity-1.m4a');
        this.audioElements.yellow = this.createAudioElement('assets/sounds/proximity-2.m4a');
        this.audioElements.red = this.createAudioElement('assets/sounds/proximity-3.m4a');
    }

    /**
     * Cria um elemento de áudio com loop
     * @param {string} src - Caminho do arquivo de áudio
     * @returns {HTMLAudioElement}
     */
    createAudioElement(src) {
        const audio = new Audio(src);
        audio.loop = true;
        audio.volume = 0.6; // Volume padrão (60%)
        return audio;
    }

    /**
     * Atualiza o alerta sonoro baseado na zona de proximidade detectada
     * @param {string|null} zone - 'green', 'yellow', 'red', ou null se não há detecção
     */
    updateZone(zone) {
        // Se a zona não mudou, não faz nada
        if (zone === this.currentZone) {
            return;
        }

        // Para todos os áudios
        this.stopAll();

        // Se não há detecção, para tudo
        if (!zone) {
            this.currentZone = null;
            return;
        }

        // Atualiza a zona atual
        this.currentZone = zone;

        // Toca o áudio correspondente à zona
        const audio = this.audioElements[zone];
        if (audio && this.isEnabled) {
            audio.play().catch(error => {
                // Ignora erros de autoplay (precisa de interação do usuário)
                console.warn('Erro ao reproduzir áudio:', error);
            });
        }
    }

    /**
     * Para todos os áudios
     */
    stopAll() {
        Object.values(this.audioElements).forEach(audio => {
            if (audio) {
                audio.pause();
                audio.currentTime = 0;
            }
        });
    }

    /**
     * Habilita ou desabilita os alertas sonoros
     * @param {boolean} enabled
     */
    setEnabled(enabled) {
        this.isEnabled = enabled;
        if (!enabled) {
            this.stopAll();
            this.currentZone = null;
        }
    }

    /**
     * Ajusta o volume de todos os áudios
     * @param {number} volume - Volume de 0 a 1
     */
    setVolume(volume) {
        Object.values(this.audioElements).forEach(audio => {
            if (audio) {
                audio.volume = Math.max(0, Math.min(1, volume));
            }
        });
    }

    /**
     * Limpa recursos
     */
    destroy() {
        this.stopAll();
        Object.values(this.audioElements).forEach(audio => {
            if (audio) {
                audio.src = '';
            }
        });
        this.audioElements = { green: null, yellow: null, red: null };
    }
}
