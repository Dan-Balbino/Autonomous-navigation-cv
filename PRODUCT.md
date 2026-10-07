# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

- Front-ends estáticos (HTML/CSS/JS sem build) servidos pelo Flask de `messaging/messaging_core.py` (porta 5000): Digital Twin em `/`, painel de controle em `/panel`, olhos (EyesFront) em `/eyes/`.
- RoadPanel (painel de mapa 3D): Three.js empacotado localmente dentro de `RoadPanel/` (sem CDN; o carro pode rodar sem internet). Destino: servido pelo mesmo Flask em `/road` (rota ainda não criada; por enquanto o trabalho fica só dentro de `RoadPanel/`).

## Users

- A equipe que desenvolve e testa o carro autônomo em escala (APEX) numa pista de competição de robótica: acompanha o carro durante os testes e ajusta parâmetros.
- Quem assiste às demonstrações do carro, nas telas do Digital Twin e do painel de mapa.

## Product Purpose

Carro autônomo em escala que segue faixas por visão computacional, reconhece placas (PARE, semáforo, desvio à direita, pontos A/B/C) e cumpre uma rota de pontos de parada. As telas web mostram em tempo real o estado do carro. O RoadPanel mostra a pista em 3D, no estilo do mapa de navegação dos carros BYD/Tesla, com o carro e a trajetória que ele deve percorrer.

## Operating Context

- Pista física: contorno externo com linha de largada quadriculada, semáforo, duas placas de desvio à direita, placa de PARE e três baias internas com os pontos A, B e C (referência: a imagem da pista enviada pelo usuário).
- A rota é uma sequência de pontos (A, B, C) adicionada pelo painel; `core/navigation.py` define a faixa de preferência por ponto (A: direita; B: esquerda, direita; C: esquerda, esquerda).
- Os dados do carro chegam do `main.py` pela API Flask (`/api/vehicle_info`, `/api/dashboard`). O RoadPanel deve funcionar primeiro com ferramentas de debug, sem dados do carro.

## Capabilities and Constraints

- RoadPanel: um único carro (um cubo até o modelo 3D do usuário ficar pronto) e a trajetória esperada, definida pela rota de pontos A/B/C.
- Ferramentas de debug para mover o carro pela pista virtual sem o carro real.
- Indefinido: mapeamento da posição real do carro na pista (o carro não tem localização absoluta hoje); formato final do modelo 3D (provavelmente .glb).

## Brand Commitments

- Nome do carro/sistema: APEX. O Digital Twin usa o logotipo da Mercedes e a estética "cyber" escura (ciano/neon). Nada disso é obrigatório para o RoadPanel.
- Referência explícita do usuário para o RoadPanel: painéis de mapa de navegação da BYD e da Tesla (fundo escuro, faixa da trajetória em azul, carro visto de trás e de cima).

## Evidence on Hand

- Imagem da pista (enviada no chat; não está no repositório).
- Modelo 3D do carro: em produção pelo usuário; ainda não existe.
- Não há dados reais de posição do carro na pista.

## Product Principles

- Mostrar a verdade do carro: nada pode parecer dado real quando é simulação; o modo debug fica sempre identificado.
- Legível de relance, como um painel de carro: a trajetória e o próximo ponto aparecem antes de qualquer detalhe.
- Funcionar offline e leve no hardware do carro.
- Trocas fáceis: o cubo vira o modelo real, e o debug vira dado real, sem reescrever a cena.
