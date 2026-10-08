/**
 * Malha de pontos "semi viva" no fundo (mesmo efeito do mapa da pista, RoadPanel):
 * pontos apagados em grade e faixas de luz passando por eles em três direções.
 * Um único shader em tela cheia (WebGL), desenhado a ~30 FPS e com resolução limitada;
 * sem WebGL ou com movimento reduzido, fica a malha estática em CSS.
 */
const SPACING_PX = 22;        // distância entre pontos (px CSS)
const DOT_RADIUS_PX = 1.25;
const FRAME_MS = 33;

const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAGMENT = `
precision mediump float;
uniform vec2 uSize;      // px do canvas
uniform float uScale;    // px do canvas por px CSS
uniform float uTime;
uniform vec3 uDot;
void main() {
  vec2 css = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y) / uScale;
  vec2 cell = mod(css, ${SPACING_PX.toFixed(1)}) - ${(SPACING_PX / 2).toFixed(1)};
  float d = length(cell);
  float dotMask = 1.0 - smoothstep(${DOT_RADIUS_PX.toFixed(2)} - 0.6, ${DOT_RADIUS_PX.toFixed(2)} + 0.6, d);
  if (dotMask <= 0.0) discard;
  // Mesmas ondas do RoadPanel (coordenadas em "unidades" de 0,46 por ponto)
  vec2 w = css / ${SPACING_PX.toFixed(1)} * 0.46;
  float w1 = smoothstep(0.82, 1.0, sin(dot(w, vec2(0.21, 0.08)) - uTime * 0.9));
  float w2 = smoothstep(0.86, 1.0, sin(dot(w, vec2(-0.06, 0.19)) - uTime * 0.6 + 1.7));
  float w3 = smoothstep(0.9, 1.0, sin(length(w - vec2(11.0, 6.0)) * 0.55 - uTime * 1.1));
  float glow = clamp(w1 + w2 * 0.8 + w3 * 0.7, 0.0, 1.0);
  float alpha = dotMask * (0.14 + 0.66 * glow);
  gl_FragColor = vec4(uDot * alpha, alpha);
}
`;

export function startDotBackground() {
  const canvas = document.createElement('canvas');
  canvas.className = 'dot-background';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl || reduced) {
    canvas.remove();
    document.body.classList.add('dot-background-static');
    return;
  }

  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    canvas.remove();
    document.body.classList.add('dot-background-static');
    return;
  }
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const u = {
    size: gl.getUniformLocation(program, 'uSize'),
    scale: gl.getUniformLocation(program, 'uScale'),
    time: gl.getUniformLocation(program, 'uTime'),
    dot: gl.getUniformLocation(program, 'uDot'),
  };
  gl.uniform3f(u.dot, 0.29, 0.72, 0.78);   // ciano do Digital Twin (#4ab8c8)
  gl.clearColor(0, 0, 0, 0);

  const resize = () => {
    const scale = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(window.innerWidth * scale);
    canvas.height = Math.round(window.innerHeight * scale);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(u.size, canvas.width, canvas.height);
    gl.uniform1f(u.scale, scale);
  };
  window.addEventListener('resize', resize);
  resize();

  let last = 0;
  const frame = (now) => {
    requestAnimationFrame(frame);
    if (document.hidden || now - last < FRAME_MS) return;
    last = now;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(u.time, now / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  requestAnimationFrame(frame);
}
