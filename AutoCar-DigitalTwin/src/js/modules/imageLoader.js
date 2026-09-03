/**
 * Módulo ImageLoader
 * Responsável pelo carregamento e gerenciamento da imagem
 */

export class ImageLoader {
    /**
     * @param {HTMLImageElement} imageElement - Elemento img a ser gerenciado
     */
    constructor(imageElement) {
        this.imageElement = imageElement;
        this.isLoaded = false;
    }

    /**
     * Carrega a imagem e aplica estados de loading
     * @returns {Promise<void>}
     */
    async load() {
        return new Promise((resolve, reject) => {
            if (this.isLoaded) {
                resolve();
                return;
            }

            this.imageElement.classList.add('loading');

            const handleLoad = () => {
                this.imageElement.classList.remove('loading');
                this.imageElement.classList.add('loaded');
                this.isLoaded = true;
                resolve();
            };

            const handleError = () => {
                this.imageElement.classList.remove('loading');
                reject(new Error('Falha ao carregar a imagem'));
            };

            // Se a imagem já está carregada no cache
            if (this.imageElement.complete && this.imageElement.naturalHeight !== 0) {
                handleLoad();
                return;
            }

            this.imageElement.addEventListener('load', handleLoad, { once: true });
            this.imageElement.addEventListener('error', handleError, { once: true });
        });
    }

    /**
     * Verifica se a imagem está carregada
     * @returns {boolean}
     */
    get loaded() {
        return this.isLoaded;
    }
}
