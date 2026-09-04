/**
 * Módulo TestObject
 * Gerencia o objeto de teste (quadrado vermelho)
 */

export class TestObject {
    /**
     * @param {HTMLElement} container - Container onde o objeto será posicionado
     */
    constructor(container) {
        this.container = container;
        this.element = null;
        this.x = 0;
        this.y = 0;
        this.size = 20; // Tamanho do quadrado em pixels
        this.isVisible = false;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
    }

    /**
     * Cria o elemento do objeto de teste
     */
    create() {
        if (this.element) {
            return;
        }

        this.element = document.createElement('div');
        this.element.className = 'test-object';
        this.element.style.cssText = `
            position: absolute;
            width: ${this.size}px;
            height: ${this.size}px;
            background-color: #ff0000;
            border: 2px solid #cc0000;
            cursor: move;
            z-index: 1000;
            pointer-events: auto;
            user-select: none;
        `;

        // Posiciona no centro inicialmente
        const containerRect = this.container.getBoundingClientRect();
        this.updatePosition(containerRect.width / 2, containerRect.height / 2);

        // Adiciona eventos de arrastar
        this.element.addEventListener('mousedown', (e) => this.startDrag(e));
        document.addEventListener('mousemove', (e) => this.onDrag(e));
        document.addEventListener('mouseup', () => this.stopDrag());

        this.container.appendChild(this.element);
    }

    /**
     * Inicia o arrasto do objeto
     * @param {MouseEvent} e - Evento do mouse
     */
    startDrag(e) {
        this.isDragging = true;
        const rect = this.element.getBoundingClientRect();
        this.dragOffset.x = e.clientX - rect.left - rect.width / 2;
        this.dragOffset.y = e.clientY - rect.top - rect.height / 2;
        e.preventDefault();
    }

    /**
     * Atualiza a posição durante o arrasto
     * @param {MouseEvent} e - Evento do mouse
     */
    onDrag(e) {
        if (!this.isDragging) return;
        
        const containerRect = this.container.getBoundingClientRect();
        const x = e.clientX - containerRect.left - this.dragOffset.x;
        const y = e.clientY - containerRect.top - this.dragOffset.y;
        
        this.updatePosition(x, y);
    }

    /**
     * Para o arrasto
     */
    stopDrag() {
        this.isDragging = false;
    }

    /**
     * Atualiza a posição do objeto
     * @param {number} x - Posição X
     * @param {number} y - Posição Y
     */
    updatePosition(x, y) {
        const containerRect = this.container.getBoundingClientRect();
        const maxX = containerRect.width - this.size / 2;
        const maxY = containerRect.height - this.size / 2;
        
        this.x = Math.max(this.size / 2, Math.min(x, maxX));
        this.y = Math.max(this.size / 2, Math.min(y, maxY));
        
        if (this.element) {
            this.element.style.left = `${this.x - this.size / 2}px`;
            this.element.style.top = `${this.y - this.size / 2}px`;
        }

        // Notifica movimento para atualizar ondas somente quando necessário.
        window.dispatchEvent(new CustomEvent('testObjectMoved', {
            detail: { x: this.x, y: this.y }
        }));
    }

    /**
     * Mostra o objeto na posição do mouse
     * @param {MouseEvent|Object} e - Evento do mouse ou objeto com clientX/clientY (opcional)
     */
    show(e = null) {
        if (!this.element) {
            this.create();
        }
        
        // Se há evento do mouse ou objeto com coordenadas, posiciona o objeto na posição do mouse
        if (e && (e.clientX !== undefined && e.clientY !== undefined)) {
            const containerRect = this.container.getBoundingClientRect();
            const x = e.clientX - containerRect.left;
            const y = e.clientY - containerRect.top;
            this.updatePosition(x, y);
        }
        
        this.isVisible = true;
        if (this.element) {
            this.element.style.display = 'block';
        }
    }

    /**
     * Esconde o objeto
     */
    hide() {
        this.isVisible = false;
        if (this.element) {
            this.element.style.display = 'none';
        }
    }

    /**
     * Obtém a posição atual do objeto
     * @returns {{x: number, y: number}}
     */
    getPosition() {
        return { x: this.x, y: this.y };
    }

    /**
     * Remove o objeto
     */
    destroy() {
        if (this.element) {
            this.element.remove();
            this.element = null;
        }
    }
}
