/**
 * Módulo FullscreenManager
 * Gerencia a funcionalidade de tela cheia
 */

export class FullscreenManager {
    /**
     * @param {HTMLElement} element - Elemento a ser colocado em fullscreen
     */
    constructor(element) {
        this.element = element;
        this.isFullscreen = false;
    }

    /**
     * Alterna entre modo fullscreen e normal
     */
    toggle() {
        if (this.isFullscreen) {
            this.exit();
        } else {
            this.enter();
        }
    }

    /**
     * Entra em modo fullscreen
     */
    async enter() {
        try {
            if (this.element.requestFullscreen) {
                await this.element.requestFullscreen();
            } else if (this.element.webkitRequestFullscreen) {
                await this.element.webkitRequestFullscreen();
            } else if (this.element.mozRequestFullScreen) {
                await this.element.mozRequestFullScreen();
            } else if (this.element.msRequestFullscreen) {
                await this.element.msRequestFullscreen();
            }
        } catch (error) {
            console.error('Erro ao entrar em fullscreen:', error);
        }
    }

    /**
     * Sai do modo fullscreen
     */
    async exit() {
        try {
            if (document.exitFullscreen) {
                await document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                await document.webkitExitFullscreen();
            } else if (document.mozCancelFullScreen) {
                await document.mozCancelFullScreen();
            } else if (document.msExitFullscreen) {
                await document.msExitFullscreen();
            }
        } catch (error) {
            console.error('Erro ao sair do fullscreen:', error);
        }
    }

    /**
     * Verifica se está em modo fullscreen
     * @returns {boolean}
     */
    checkFullscreen() {
        return !!(
            document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.mozFullScreenElement ||
            document.msFullscreenElement
        );
    }

    /**
     * Atualiza o estado do fullscreen
     */
    updateState() {
        this.isFullscreen = this.checkFullscreen();
    }
}
