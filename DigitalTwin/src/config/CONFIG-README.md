# Configurações das Ondas de Proximidade

Este arquivo documenta todas as configurações disponíveis no arquivo `proximity-config.json`.

## Formato

As configurações usam duas escalas diferentes:

1. **Percentuais (0 a 100)**: Para propriedades que são percentuais
2. **Pixels**: Para propriedades de distância (cada unidade = 1px)

---

## Propriedades

### `quantidadeOndas`
**Tipo:** `number` (inteiro, >= 2)  
**Descrição:** Quantidade de ondas por direção (frente, traseira, laterais)

**Valores:**
- Número direto de ondas
- Valor mínimo: `2`
- Exemplo: `5` = exatamente 5 ondas por direção

---

### `espacamentoOndasHorizontal`
**Tipo:** `number` (pixels, >= 0)  
**Descrição:** Espaçamento entre as ondas horizontais (frente e traseira) consecutivas em **PIXELS**

**Valores:**
- Cada unidade = 1px
- Exemplo: `15` = 15 pixels de espaçamento entre cada onda horizontal

---

### `espacamentoOndasVertical`
**Tipo:** `number` (pixels, >= 0)  
**Descrição:** Espaçamento entre as ondas verticais (laterais) consecutivas em **PIXELS**

**Valores:**
- Cada unidade = 1px
- Exemplo: `15` = 15 pixels de espaçamento entre cada onda vertical

---

### `comprimentoLinhasHorizontais`
**Tipo:** `number` (pixels, >= 0)  
**Descrição:** Comprimento das linhas horizontais (frente e traseira do carro) em **PIXELS**

**Valores:**
- Cada unidade = 1px
- `0` = 0px (linha sem comprimento)
- `100` = 100px de comprimento
- Exemplo: `150` = 150 pixels de comprimento

---

### `comprimentoLinhasVerticais`
**Tipo:** `number` (pixels, >= 0)  
**Descrição:** Comprimento das linhas verticais (laterais esquerda e direita do carro) em **PIXELS**

**Valores:**
- Cada unidade = 1px
- `0` = 0px (linha sem comprimento)
- `100` = 100px de comprimento
- Exemplo: `150` = 150 pixels de comprimento

---

### `espessuraLinhas`
**Tipo:** `number` (pixels, >= 0)  
**Descrição:** Espessura das linhas das ondas em **PIXELS**

**Valores:**
- Cada unidade = 1px
- `0` = 0px (linha invisível)
- `1` = 1px
- `2` = 2px
- `4` = 4px
- Exemplo: `3` = 3 pixels de espessura

---

### `curvaturaHorizontal`
**Tipo:** `number` (>= 0, sem limite máximo)  
**Descrição:** Intensidade da curvatura das linhas horizontais (frente e traseira) em **PERCENTUAL**

**Valores:**
- `0` = linha reta (sem curvatura)
- `50` = curvatura média
- `100` = curvatura forte (quase um círculo)
- `200+` = curvatura extrema (quanto maior, mais curvado até formar um círculo completo)

**Nota:** A curvatura é linear e proporcional ao comprimento da linha. Não há limite máximo - valores maiores que 100 criam curvas ainda mais extremas.

---

### `curvaturaVertical`
**Tipo:** `number` (>= 0, sem limite máximo)  
**Descrição:** Intensidade da curvatura das linhas verticais (laterais esquerda e direita) em **PERCENTUAL**

**Valores:**
- `0` = linha reta (sem curvatura)
- `50` = curvatura média
- `100` = curvatura forte (quase um círculo)
- `200+` = curvatura extrema (quanto maior, mais curvado até formar um círculo completo)

**Nota:** A curvatura é linear e proporcional ao comprimento da linha. Não há limite máximo - valores maiores que 100 criam curvas ainda mais extremas.

---

### `coeficienteAumentoHorizontal`
**Tipo:** `number` (>= 0, sem limite máximo)  
**Descrição:** Coeficiente de aumento do comprimento das linhas horizontais (frente e traseira) em **PERCENTUAL**

**Valores:**
- `0` = mantém o mesmo tamanho para todas as linhas
- `10` = cada linha aumenta 10% em relação à anterior
- `50` = cada linha aumenta 50% em relação à anterior
- `100` = cada linha dobra de tamanho em relação à anterior

**Nota:** Usado para compensar o efeito visual de redução causado pela curvatura maior. Quanto maior a curvatura, maior deve ser este coeficiente para manter o tamanho aparente proporcional.

---

### `coeficienteAumentoVertical`
**Tipo:** `number` (>= 0, sem limite máximo)  
**Descrição:** Coeficiente de aumento do comprimento das linhas verticais (laterais) em **PERCENTUAL**

**Valores:**
- `0` = mantém o mesmo tamanho para todas as linhas
- `10` = cada linha aumenta 10% em relação à anterior
- `50` = cada linha aumenta 50% em relação à anterior
- `100` = cada linha dobra de tamanho em relação à anterior

**Nota:** Usado para compensar o efeito visual de redução causado pela curvatura maior. Quanto maior a curvatura, maior deve ser este coeficiente para manter o tamanho aparente proporcional.

---

### `distanciaInicialHorizontal`
**Tipo:** `number` (pixels, >= 0)  
**Descrição:** Distância inicial das linhas horizontais (frente e traseira) a partir do centro da imagem (ponto zero) em **PIXELS**

**Valores:**
- Cada unidade = 1px
- `0` = primeira onda começa no centro (pode sobrepor a imagem)
- `10` = aumenta 10px para cima e 10px para baixo a partir do centro
- Exemplo: `30` = primeira onda começa a 30 pixels do centro (tanto para cima quanto para baixo)

**Nota:** O centro da imagem é considerado o ponto zero. Valores baixos podem fazer as ondas aparecerem sobre a imagem.

---

### `distanciaInicialVertical`
**Tipo:** `number` (pixels, >= 0)  
**Descrição:** Distância inicial das linhas verticais (laterais esquerda e direita) a partir do centro da imagem (ponto zero) em **PIXELS**

**Valores:**
- Cada unidade = 1px
- `0` = primeira onda começa no centro (pode sobrepor a imagem)
- `10` = aumenta 10px para esquerda e 10px para direita a partir do centro
- Exemplo: `30` = primeira onda começa a 30 pixels do centro (tanto para esquerda quanto para direita)

**Nota:** O centro da imagem é considerado o ponto zero. Valores baixos podem fazer as ondas aparecerem sobre a imagem.

---

## Exemplo de Configuração

```json
{
  "quantidadeOndas": 5,
  "espacamentoOndasHorizontal": 15,
  "espacamentoOndasVertical": 15,
  "comprimentoLinhasHorizontais": 500,
  "comprimentoLinhasVerticais": 250,
  "espessuraLinhas": 3,
  "curvaturaHorizontal": 60,
  "curvaturaVertical": 70,
  "coeficienteAumentoHorizontal": 10,
  "coeficienteAumentoVertical": 10,
  "distanciaInicialHorizontal": 135,
  "distanciaInicialVertical": 260
}
```

---

## Dicas

- **Ondas mais próximas:** Use `espacamentoOndasHorizontal` e `espacamentoOndasVertical` baixos (5-15px) e `distanciaInicialHorizontal`/`distanciaInicialVertical` baixos (0-30px)
- **Ondas mais longas:** Aumente `comprimentoLinhasHorizontais` e `comprimentoLinhasVerticais` (70-100)
- **Ondas mais grossas:** Aumente `espessuraLinhas` (70-100)
- **Curvatura extrema:** Use `curvaturaHorizontal` e `curvaturaVertical` = 100

---

## Conversão da Escala Antiga (0-1) para Nova (0-100)

Se você estava usando a escala antiga, multiplique os valores por 100:
- `0.3` → `30`
- `0.5` → `50`
- `0.75` → `75`
- `1.0` → `100`

**Exceção:** Para variáveis de distância (`espacamentoOndasHorizontal`, `espacamentoOndasVertical`, `distanciaInicialHorizontal`, `distanciaInicialVertical`), agora são valores diretos em pixels, não mais percentuais.
