/**
 * Módulo para comunicação com a API de emoções
 */

import { API_BASE_URL } from "./apiConfig.js";

/**
 * Faz uma requisição GET para verificar o estado de uma emoção
 * @param {string} emotion - Nome da emoção (surprise, squint, search, fright, accelerate)
 * @returns {Promise<boolean>} - Retorna true se a emoção está ativa, false caso contrário
 */
export async function getEmotion(emotion) {
  try {
    // Mapeia os nomes das animações para os endpoints da API
    const endpointMap = {
      surprise: "surprise",
      squint: "squint",
      search: "search",
      fright: "frigh", // Note: a API usa "frigh" não "fright"
      accelerate: "accelerate"
    };

    const endpoint = endpointMap[emotion];
    if (!endpoint) {
      console.warn(`Emoção desconhecida: ${emotion}`);
      return false;
    }

    const response = await fetch(`${API_BASE_URL}/${endpoint}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error(`Erro ao buscar emoção ${emotion}:`, response.statusText);
      return false;
    }

    const data = await response.json();
    // A API pode retornar um booleano diretamente ou um objeto com propriedades
    // Verifica diferentes formatos possíveis
    if (typeof data === 'boolean') {
      return data;
    }
    if (typeof data === 'object' && data !== null) {
      return data.value === true || data.active === true || data.enabled === true || data[emotion] === true;
    }
    return false;
  } catch (error) {
    console.error(`Erro ao buscar emoção ${emotion}:`, error);
    return false;
  }
}

/**
 * Faz uma requisição PUT para atualizar o estado de uma emoção para false
 * @param {string} emotion - Nome da emoção (surprise, squint, search, fright)
 * @returns {Promise<boolean>} - Retorna true se a atualização foi bem-sucedida
 */
export async function setEmotionFalse(emotion) {
  try {
    // Mapeia os nomes das animações para os endpoints da API
    const endpointMap = {
      surprise: "surprise",
      squint: "squint",
      search: "search",
      fright: "frigh", // Note: a API usa "frigh" não "fright"
      // accelerate não deve usar PUT, apenas GET
    };

    const endpoint = endpointMap[emotion];
    if (!endpoint) {
      console.warn(`Emoção desconhecida ou não permitida para PUT: ${emotion}`);
      return false;
    }

    const response = await fetch(`${API_BASE_URL}/${endpoint}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(false), // Envia false diretamente
    });

    if (!response.ok) {
      console.error(`Erro ao atualizar emoção ${emotion}:`, response.statusText);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`Erro ao atualizar emoção ${emotion}:`, error);
    return false;
  }
}

/**
 * Busca o estado de todas as emoções de uma vez com um único GET
 * Retorna toda a tabela de emoções
 * @returns {Promise<{data: Object, error: string|null}>} - Objeto com os dados e código de erro (429 para Too Many Requests)
 */
export async function getAllEmotions() {
  try {
    // Faz um único GET que retorna toda a tabela de emoções
    const response = await fetch(`${API_BASE_URL}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      // Se for erro 429 (Too Many Requests), retorna erro específico
      if (response.status === 429) {
        console.warn("Erro 429 (Too Many Requests) - aguardando antes de tentar novamente");
        return {
          data: {
            surprise: false,
            squint: false,
            search: false,
            fright: false,
            accelerate: false,
          },
          error: "429"
        };
      }
      
      console.error("Erro ao buscar tabela de emoções:", response.statusText);
      return {
        data: {
          surprise: false,
          squint: false,
          search: false,
          fright: false,
          accelerate: false,
        },
        error: null
      };
    }

    const data = await response.json();
    
    // A API pode retornar a tabela em diferentes formatos
    // Tenta diferentes estruturas possíveis
    let emotionsData = {
      surprise: false,
      squint: false,
      search: false,
      fright: false,
      accelerate: false,
    };
    
    if (typeof data === 'object' && data !== null) {
      // Se retorna um objeto com as emoções como propriedades
      emotionsData = {
        surprise: data.surprise === true || data.emotions_surprise === true,
        squint: data.squint === true || data.emotions_squint === true,
        search: data.search === true || data.emotions_search === true,
        fright: data.fright === true || data.frigh === true || data.emotions_frigh === true,
        accelerate: data.accelerate === true || data.emotions_accelerate === true,
      };
    }
    
    return {
      data: emotionsData,
      error: null
    };
  } catch (error) {
    console.error("Erro ao buscar tabela de emoções:", error);
    return {
      data: {
        surprise: false,
        squint: false,
        search: false,
        fright: false,
        accelerate: false,
      },
      error: null
    };
  }
}

