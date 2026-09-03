/**
 * Módulo AppController
 * Controla o fluxo principal da aplicação
 */

export class AppController {
    /**
     * @param {ImageLoader} imageLoader - Instância do ImageLoader
     */
    constructor(imageLoader) {
        this.imageLoader = imageLoader;
    }

    /**
     * Inicia a aplicação
     * @returns {Promise<void>}
     */
    async start() {
        try {
            await this.imageLoader.load();
            this.onImageLoaded();
            return Promise.resolve();
        } catch (error) {
            this.onImageError(error);
            return Promise.reject(error);
        }
    }

    /**
     * Callback executado quando a imagem é carregada com sucesso
     */
    onImageLoaded() {
        // Imagem carregada com sucesso
    }

    /**
     * Callback executado quando ocorre erro no carregamento
     * @param {Error} error - Erro ocorrido
     */
    onImageError(error) {
        console.error('Erro ao carregar imagem:', error.message);
        // Aqui você pode adicionar tratamento de erro visual se necessário
    }
}
