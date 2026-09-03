/**
 * Módulo ProximityDetector
 * Detecta a proximidade do objeto de teste em relação ao carro
 */

export class ProximityDetector {
    /**
     * @param {HTMLImageElement} carImage - Elemento da imagem do carro
     * @param {TestObject} testObject - Objeto de teste
     */
    constructor(carImage, testObject) {
        this.carImage = carImage;
        this.testObject = testObject;
    }

    /**
     * Calcula a distância do objeto até o centro do carro
     * @param {{x: number, y: number}} objectPos - Posição do objeto (coordenadas relativas ao container)
     * @returns {number} - Distância em pixels
     */
    getDistanceToCarCenter(objectPos) {
        const carRect = this.carImage.getBoundingClientRect();
        const containerRect = this.testObject.container.getBoundingClientRect();
        
        // Converte coordenadas relativas do objeto para coordenadas absolutas
        const objectAbsX = containerRect.left + objectPos.x;
        const objectAbsY = containerRect.top + objectPos.y;
        
        const carCenterX = carRect.left + carRect.width / 2;
        const carCenterY = carRect.top + carRect.height / 2;
        
        const dx = objectAbsX - carCenterX;
        const dy = objectAbsY - carCenterY;
        
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Determina a direção do objeto em relação ao carro usando plano cartesiano de 8 direções
     * @param {{x: number, y: number}} objectPos - Posição do objeto (coordenadas relativas ao container)
     * @returns {Array<string>} - Array com as direções afetadas: ['front'], ['right'], ['front', 'right'], etc.
     */
    getDirection(objectPos) {
        const carRect = this.carImage.getBoundingClientRect();
        const containerRect = this.testObject.container.getBoundingClientRect();
        
        // Converte coordenadas relativas do objeto para coordenadas absolutas
        const objectAbsX = containerRect.left + objectPos.x;
        const objectAbsY = containerRect.top + objectPos.y;
        
        const carCenterX = carRect.left + carRect.width / 2;
        const carCenterY = carRect.top + carRect.height / 2;
        
        const dx = objectAbsX - carCenterX;
        const dy = objectAbsY - carCenterY;
        
        // Calcula o ângulo em relação ao centro do carro
        // Math.atan2(dy, dx) retorna ângulo em radianos de -π a π
        // No sistema de coordenadas da tela:
        // dy negativo = objeto acima = FRENTE
        // dy positivo = objeto abaixo = TRASEIRA
        // dx positivo = objeto à direita = DIREITA
        // dx negativo = objeto à esquerda = ESQUERDA
        // -π/2 (-90°) = cima (frente), 0 = direita, π/2 (90°) = baixo (traseira), π (180°) = esquerda
        const angle = Math.atan2(dy, dx);
        
        // Converte para graus e normaliza para 0-360
        // -90° vira 270°, 0° fica 0°, 90° fica 90°, 180° fica 180°
        let angleDeg = (angle * 180 / Math.PI + 360) % 360;
        
        // Define os 8 setores (45 graus cada, começando da frente)
        // Frente (Y): 270° ± 22.5° = 247.5° - 292.5°
        // Frente-Direita (XY): 315° ± 22.5° = 292.5° - 337.5°
        // Direita (X): 0° ± 22.5° = 337.5° - 360° e 0° - 22.5°
        // Traseira-Direita (X-Y): 45° ± 22.5° = 22.5° - 67.5°
        // Traseira (-Y): 90° ± 22.5° = 67.5° - 112.5°
        // Traseira-Esquerda (-X-Y): 135° ± 22.5° = 112.5° - 157.5°
        // Esquerda (-X): 180° ± 22.5° = 157.5° - 202.5°
        // Frente-Esquerda (-XY): 225° ± 22.5° = 202.5° - 247.5°
        
        const directions = [];
        
        if (angleDeg >= 247.5 && angleDeg < 292.5) {
            // Frente (Y)
            directions.push('front');
        } else if (angleDeg >= 292.5 && angleDeg < 337.5) {
            // Frente-Direita (XY)
            directions.push('front');
            directions.push('right');
        } else if (angleDeg >= 337.5 || angleDeg < 22.5) {
            // Direita (X) - wrap-around
            directions.push('right');
        } else if (angleDeg >= 22.5 && angleDeg < 67.5) {
            // Traseira-Direita (X-Y)
            directions.push('rear');
            directions.push('right');
        } else if (angleDeg >= 67.5 && angleDeg < 112.5) {
            // Traseira (-Y)
            directions.push('rear');
        } else if (angleDeg >= 112.5 && angleDeg < 157.5) {
            // Traseira-Esquerda (-X-Y)
            directions.push('rear');
            directions.push('left');
        } else if (angleDeg >= 157.5 && angleDeg < 202.5) {
            // Esquerda (-X)
            directions.push('left');
        } else if (angleDeg >= 202.5 && angleDeg < 247.5) {
            // Frente-Esquerda (-XY)
            directions.push('front');
            directions.push('left');
        }
        
        // Remove duplicatas e retorna no plano cartesiano direto da tela.
        return [...new Set(directions)];
    }

    /**
     * Calcula a distância do objeto até a borda do carro na direção específica
     * @param {{x: number, y: number}} objectPos - Posição do objeto (coordenadas relativas ao container)
     * @param {string} direction - Direção: 'front', 'rear', 'left', 'right'
     * @returns {number} - Distância em pixels
     */
    getDistanceToCarEdge(objectPos, direction) {
        const carRect = this.carImage.getBoundingClientRect();
        const containerRect = this.testObject.container.getBoundingClientRect();
        
        // Converte coordenadas relativas do objeto para coordenadas absolutas
        const objectAbsX = containerRect.left + objectPos.x;
        const objectAbsY = containerRect.top + objectPos.y;
        
        let distance = 0;
        
        switch (direction) {
            case 'front':
                // Distância do objeto até a borda superior do carro
                distance = carRect.top - (objectAbsY + this.testObject.size / 2);
                break;
            case 'rear':
                // Distância do objeto até a borda inferior do carro
                distance = (objectAbsY - this.testObject.size / 2) - carRect.bottom;
                break;
            case 'left':
                // Distância do objeto até a borda esquerda do carro
                distance = carRect.left - (objectAbsX + this.testObject.size / 2);
                break;
            case 'right':
                // Distância do objeto até a borda direita do carro
                distance = (objectAbsX - this.testObject.size / 2) - carRect.right;
                break;
        }
        
        return Math.max(0, distance);
    }

    /**
     * Obtém informações de proximidade para todas as direções
     * @returns {Object} - Informações de proximidade por direção
     */
    getProximityInfo() {
        if (!this.testObject.isVisible) {
            return null;
        }

        const objectPos = this.testObject.getPosition();
        const affectedDirections = this.getDirection(objectPos);
        
        const distances = {
            front: this.getDistanceToCarEdge(objectPos, 'front'),
            rear: this.getDistanceToCarEdge(objectPos, 'rear'),
            left: this.getDistanceToCarEdge(objectPos, 'left'),
            right: this.getDistanceToCarEdge(objectPos, 'right')
        };

        return {
            affectedDirections, // Array com as direções afetadas
            distances,
            objectPosition: objectPos
        };
    }
}
