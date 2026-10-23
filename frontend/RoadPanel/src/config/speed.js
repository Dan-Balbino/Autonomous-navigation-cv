/**
 * ── Velocidade digital (ajuste aqui) ──
 *
 * Coeficiente da velocidade do carro 3D no mapa em relação à velocidade real (telemetry.speed,
 * ou a estimada pelo PWM). Vale só no modo real; a simulação não muda. O número em M/S no topo
 * da tela e o tempo estimado do GPS continuam com a velocidade real.
 *
 *   1.0  = o carro 3D anda igual ao real (2 m/s no carro -> 2 m/s no mapa)
 *   0.5  = metade                         (2 m/s no carro -> 1 m/s no mapa)
 *   0.25 = um quarto                      (2 m/s no carro -> 0,5 m/s no mapa)
 *
 * Para calibrar: cronometre uma volta do carro real e compare com a volta no mapa; se o carrinho
 * chega antes, diminua o valor na mesma proporção (ex.: chegou na metade do tempo -> divida por 2).
 * Mesmo valor do SPEED_SCALE em RoadPanel-ESP32/src/Config.h.
 */
export const SPEED_SCALE = 0.35;
