---
version: 1
slug: "roadpanel"
primary_target: "RoadPanel"
related_targets: []
---

# RoadPanel — painel de mapa 3D

Scope: superfície inteira `RoadPanel/` (index.html + src). Mode: Operate (painel de relance, sem tarefa longa; o operador lê estado e trajetória).

Audience/job: equipe APEX acompanhando o carro na pista de competição e quem assiste à demonstração. Precisa ver, de relance, onde o carro está, para onde vai (trajetória da rota A/B/C) e o próximo evento (desvio, ponto, PARE, semáforo).

Constraints: rota A/B/C definida em tempo de execução pelo servidor (`/api/vehicle_info` → `hud.route`), que pode estar vazia, mudar no meio do percurso ou ficar fora do ar; o painel nunca quebra e sempre diz de onde vem o dado (servidor, debug, sem sinal). Three.js local, offline. Um carro (cubo até o modelo .glb do usuário). Ferramentas de debug para dirigir sem o carro.

Unresolved: posição real do carro na pista (sem localização absoluta hoje; o modo ao vivo estima por velocidade ao longo da trajetória); modelo 3D final.

## Direction contract

THESIS: a pista inteira vista como o mapa de condução de um BYD — câmera de perseguição baixa atrás do carro, a pista recuando até sumir na escuridão, e uma única fita azul luminosa que é a rota A/B/C desenhada no asfalto. Recusa o "mapa de cima com ícones" e o painel de cards ao redor.

OWN-WORLD: vazio azul-noite quase preto (#05080d → #0b1220 no horizonte), linhas de pista brancas frias com leve emissão, fita da trajetória em azul elétrico (#2f7bff) translúcida com borda mais clara e fade à frente, sinais 3D sólidos nas cores reais (PARE vinho, semáforo, desvio âmbar, pontos brancos), HUD em texto branco frio sem caixas, tipografia Saira autohospedada com algarismos tabulares.

STORY: o operador entende onde o carro está e qual ponto vem a seguir; acredita que o painel mostra a verdade (rótulo da fonte do dado sempre visível); age ajustando a rota ou abrindo o debug.

FIRST VIEWPORT: cena 3D ocupando 100% da tela; carro no terço inferior central, câmera atrás e acima; fita azul à frente. Topo: hora à esquerda, fonte do dado (AO VIVO / DEBUG / SEM SINAL) ao centro com o semáforo atual, velocidade grande à direita. Lateral esquerda: cartão de manobra ("Desvio à direita", distância) e a rota com o progresso de cada ponto. Rodapé: bateria, PWM, modo. Debug abre num painel lateral recolhível.

FORM: estilo pinned by brief (referência BYD/Tesla enviada pelo usuário); sem rolagem de conceito; caminho code-led (sem geração de imagem).

SIGNATURE MOVE: a fita da rota recalcula ao vivo quando o servidor muda a rota, varrendo da posição do carro para frente.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
