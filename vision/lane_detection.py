import time

import cv2
import numpy as np

# Largura nominal da pista na bird's eye (em pixels). MEÇA com a pista real.
# Serve só como valor inicial: depois o track_size é medido quando as duas faixas aparecem.
TRACK_NOMINAL = 150
# Zona morta (px) do indicador de direção: abaixo disso mostra "RETO"
DIRECTION_DEADZONE = 15
# Distância máxima (px) que a faixa pode "andar" de uma janela pra próxima
TRACK_MARGIN = 60
# Distância máxima (px) de uma faixa até o centro de referência do carro.
# Faixa mais longe que isso é descartada (metade da largura nominal da pista)
MAX_LANE_DISTANCE = 137
# Faixa aceita pra uma medição de largura (px, bird's eye). Só descarta leitura absurda.
TRACK_MIN_WIDTH = 80
TRACK_MAX_WIDTH = 2 * MAX_LANE_DISTANCE  # duas faixas a ≤130 px do centro: no máx. 260
# Suavização da largura: 1.0 = pega a medição direto, menor = mais estável
TRACK_SIZE_ALPHA = 0.3
# Liga o log por frame pra debugar as saídas de A/B
DEBUG = False
# Filtro EMA no erro: 1.0 = sem filtro, menor = mais suave (e mais atraso)
EMA_ALPHA = 0.45
filtered_error = None

# Remoção de manchas de luz: tira da imagem binária tudo que é "grosso" demais pra ser linha
GLARE_FILTER = True
# Tem que ser MAIOR que a espessura da linha na bird's eye e MENOR que a mancha (em px)
GLARE_KERNEL = 30
LANE_RESET_TIME = 0.6

# Paleta (BGR)
COLOR_LANE  = (255, 200, 0)    # faixa aceita
COLOR_BAD   = (60, 60, 255)    # faixa descartada
COLOR_GUIDE = (200, 200, 200)  # linha entre faixas
COLOR_EST   = (0, 165, 255)    # faixa estimada (não detectada)
COLOR_OK    = (120, 220, 80)

ARROW_SCALE = 0.6  # 1.0 = tamanho anterior; menor = seta menor

track_size = TRACK_NOMINAL
preference_lane = "neutral"  # "left", "right", "neutral"


def lane_detection_pipeline(roi_h, roi_w, limiar, limiar_bgr, last_error=0):
    global track_size, preference_lane  # noqa: PLW0602

    # Remove manchas de luz antes de procurar as faixas
    if GLARE_FILTER:
        limiar = remove_glare(limiar)

    # Inicializa o centro da pista e o erro
    track_center = 0

    # Define a linha de referência para a detecção das faixas e o limite mínimo de pixels brancos para considerar uma faixa válida
    mid_y = roi_h // 2
    reference_line_y = mid_y + (mid_y // 2)
    minimum_limit = (roi_h // 2) * 0.1

    # Realiza uma busca por janelas deslizantes para detectar as faixas na imagem limiarizada
    left_lane, right_lane, left_valid, right_valid, near_width = sliding_window_search(
        limiar, roi_h // 2, roi_w, minimum_limit, num_windows=3
    )

    # Validação: descarta faixa muito longe do centro de referência do carro
    cx = roi_w // 2
    left_found, right_found = left_valid, right_valid
    left_valid = left_found and abs(left_lane - cx) <= MAX_LANE_DISTANCE
    right_valid = right_found and abs(right_lane - cx) <= MAX_LANE_DISTANCE
    if not (left_valid and right_valid):
        near_width = None  # largura só é confiável com as duas faixas aceitas

    if track_size == 0:
        track_size = TRACK_NOMINAL

    # Processa a detecção das faixas e calcula o erro de acordo com os casos possíveis
    error, limiar_bgr, lane_state, track_size, track_center = process_lanes(
        left_lane, right_lane, left_valid, right_valid, roi_w, reference_line_y,
        limiar_bgr, last_error, track_size, preference_lane, near_width
    )

    raw_error = error
    error = apply_ema(raw_error)

    if DEBUG:
        print(f"state={lane_state} L={left_lane} R={right_lane} "
              f"Lf={left_found} Rf={right_found} Lv={left_valid} Rv={right_valid} "
              f"near_w={near_width} pref={preference_lane} center={track_center} "
              f"track_size={track_size} raw_err={raw_error} err={error}")

    # Distância de cada faixa até o centro de referência
    draw_lane_distances(limiar_bgr, cx, reference_line_y,
                        (left_lane, left_found, left_valid),
                        (right_lane, right_found, right_valid))

    # Centro da pista (verde) e ponto de referência do carro (vermelho), com contorno branco
    if track_center != 0:
        cv2.circle(limiar_bgr, (track_center, reference_line_y), 5, COLOR_OK, -1, cv2.LINE_AA)
        cv2.circle(limiar_bgr, (track_center, reference_line_y), 7, (255, 255, 255), 1, cv2.LINE_AA)

    ref = (cx, round(roi_h * 0.9))
    cv2.circle(limiar_bgr, ref, 5, (0, 0, 255), -1, cv2.LINE_AA)
    cv2.circle(limiar_bgr, ref, 7, (255, 255, 255), 1, cv2.LINE_AA)

    # Seta e texto com a direção que o carro está indo
    draw_direction(limiar_bgr, error, roi_w, roi_h, lane_state)

    return error, limiar_bgr, lane_state


def draw_tag(img, text, x, y, color, align="center", scale=0.4):
    # Etiqueta pequena com fundo escuro; (x, y) é o canto de baixo da etiqueta
    font = cv2.FONT_HERSHEY_SIMPLEX
    (tw, th), base = cv2.getTextSize(text, font, scale, 1)
    pad = 3
    box_w, box_h = tw + 2 * pad, th + base + 2 * pad
    h, w = img.shape[:2]

    x0 = x - box_w // 2 if align == "center" else x
    x0 = int(np.clip(x0, 0, max(w - box_w - 1, 0)))
    y0 = int(np.clip(y - box_h, 0, max(h - box_h - 1, 0)))

    cv2.rectangle(img, (x0, y0), (x0 + box_w, y0 + box_h), (25, 25, 25), -1)
    cv2.rectangle(img, (x0, y0), (x0 + box_w, y0 + box_h), color, 1)
    cv2.putText(img, text, (x0 + pad, y0 + pad + th), font, scale, color, 1, cv2.LINE_AA)


def draw_lane_distances(img, cx, y, left, right):
    # left/right = (posição, detectada, aceita). Aceita: marcador + distância.
    # Descartada: X vermelho + distância em vermelho.
    for pos, found, accepted in (left, right):
        if not found:
            continue
        dist = pos - cx
        if accepted:
            cv2.circle(img, (pos, y), 4, COLOR_LANE, -1, cv2.LINE_AA)
            color = COLOR_LANE
        else:
            cv2.drawMarker(img, (pos, y), COLOR_BAD, cv2.MARKER_CROSS, 10, 2, cv2.LINE_AA)
            color = COLOR_BAD
        draw_tag(img, f"{dist:+d}px", pos, y + 26, color)


def draw_direction(img, error, roi_w, roi_h, lane_state=""):
    # Seta saindo do ponto de referência (círculo vermelho) em direção ao centro da pista.
    # error > 0: centro à direita -> vira à direita; error < 0: vira à esquerda
    start = (roi_w // 2, round(roi_h * 0.9))
    dx = error * ARROW_SCALE
    dy = round(roi_h * 0.35 * ARROW_SCALE)
    end = (int(np.clip(start[0] + dx, 0, roi_w - 1)), start[1] - dy)

    if error > DIRECTION_DEADZONE:
        label, color = "DIR", (0, 165, 255)
    elif error < -DIRECTION_DEADZONE:
        label, color = "ESQ", (255, 200, 0)
    else:
        label, color = "RETO", COLOR_OK

    cv2.arrowedLine(img, start, end, color, 3, cv2.LINE_AA, 0, 0.2)

    # HUD no canto superior esquerdo
    text = f"{label} {error:+d}"
    if lane_state:
        text += f" | {lane_state.upper()}"
    draw_tag(img, text, 6, 26, color, align="left", scale=0.45)


def remove_glare(limiar):
    # Abertura morfológica com kernel grande: só sobrevive o que é mais largo que o kernel (a mancha).
    # A linha, fina, é apagada nessa etapa. Subtraindo o resultado da imagem original, sobram só as linhas.
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (GLARE_KERNEL, GLARE_KERNEL))
    blobs = cv2.morphologyEx(limiar, cv2.MORPH_OPEN, kernel)

    # Engrossa um pouco a mancha pra pegar a borda, que a abertura deixa passar
    blobs = cv2.dilate(blobs, np.ones((5, 5), np.uint8))

    return cv2.bitwise_and(limiar, cv2.bitwise_not(blobs))


def apply_ema(raw_error):
    # Média móvel exponencial: suaviza saltos do erro de um frame pro outro
    global filtered_error
    if filtered_error is None:
        filtered_error = raw_error
    else:
        filtered_error = EMA_ALPHA * raw_error + (1 - EMA_ALPHA) * filtered_error
    return round(filtered_error)


def sliding_window_search(limiar, height, width, limit, num_windows=1):
    # Realiza uma busca por janelas deslizantes para detectar as faixas na imagem limiarizada,
    # retornando a posição das faixas, se cada uma é válida e a largura medida na janela mais próxima do carro
    right_lanes_pos = []
    left_lanes_pos = []

    # "height" é a altura da região analisada (metade de baixo da ROI) e cada janela ocupa height // num_windows
    window_height = height // num_windows
    roi_h = limiar.shape[0]

    # Última posição válida de cada faixa: a próxima janela procura perto dela
    prev_left = None
    prev_right = None

    # Largura medida só na janela mais próxima do carro (a mais confiável)
    near_width = None

    # Para cada janela, de baixo (perto do carro) para cima, detecta a faixa esquerda e a direita
    for window in range(num_windows):
        end_y = roi_h - window * window_height
        start_y = end_y - window_height

        left_lane, right_lane, left_valid, right_valid = detect_lanes(
            limiar[start_y:end_y], window_height, width, limit,
            prev_left=prev_left, prev_right=prev_right, margin=TRACK_MARGIN
        )

        if left_valid:
            left_lanes_pos.append(left_lane)
            prev_left = left_lane

        if right_valid:
            right_lanes_pos.append(right_lane)
            prev_right = right_lane

        if window == 0 and left_valid and right_valid:
            near_width = right_lane - left_lane

    # Usa a mediana em vez da média: uma janela que pegou a faixa errada não puxa o resultado das outras
    return (int(np.median(left_lanes_pos)) if left_lanes_pos else 0,
            int(np.median(right_lanes_pos)) if right_lanes_pos else width,
            bool(left_lanes_pos),
            bool(right_lanes_pos),
            near_width)


def find_lane_candidates(hist, limit, min_width):
    # Agrupa colunas adjacentes acima do limite em "faixas" e retorna (centro, pico) de cada uma
    mask = (hist > limit).astype(np.int8)
    if not mask.any():
        return []

    diff = np.diff(np.concatenate(([0], mask, [0])))
    starts = np.where(diff == 1)[0]
    ends = np.where(diff == -1)[0]  # índice exclusivo

    candidates = []
    for s, e in zip(starts, ends):
        # Descarta ruído: faixa muito estreita
        if e - s < min_width:
            continue
        seg = hist[s:e]
        # Centro ponderado pela quantidade de pixels brancos
        center = round(np.sum(np.arange(s, e) * seg) / np.sum(seg))
        candidates.append((center, int(seg.max())))
    return candidates


def detect_lanes(limiar, height, width, limit, slice_image=False, min_width=2,
                 prev_left=None, prev_right=None, margin=TRACK_MARGIN):
    img = limiar[height:] if slice_image else limiar

    # Conta os pixels brancos em cada coluna (vetorizado, bem mais rápido que list comprehension)
    hist = np.count_nonzero(img, axis=0)

    candidates = find_lane_candidates(hist, limit, min_width)
    cx = width // 2

    # Primeira janela (ou sem histórico): divide pelo centro da imagem
    # Demais janelas: procura perto de onde a janela anterior achou a faixa
    if prev_left is None:
        left_cands = [c for c in candidates if c[0] < cx]
    else:
        left_cands = [c for c in candidates if abs(c[0] - prev_left) < margin]

    if prev_right is None:
        right_cands = [c for c in candidates if c[0] >= cx]
    else:
        right_cands = [c for c in candidates if abs(c[0] - prev_right) < margin]

    left_valid = bool(left_cands)
    right_valid = bool(right_cands)

    # Escolhe a candidata mais próxima da referência (centro ou posição anterior)
    ref_l = prev_left if prev_left is not None else cx
    ref_r = prev_right if prev_right is not None else cx
    left_lane = min(left_cands, key=lambda c: abs(c[0] - ref_l))[0] if left_valid else 0
    right_lane = min(right_cands, key=lambda c: abs(c[0] - ref_r))[0] if right_valid else width

    return left_lane, right_lane, left_valid, right_valid


def process_lanes(left_lane, right_lane, left_valid, right_valid, roi_w, reference_line_y,
                  limiar_bgr, last_error, track_size=0, preference_lane="neutral", near_width=None):
    track_center = 0

    if left_valid and right_valid:
        lane_state = "both"
    elif not left_valid and right_valid:
        lane_state = "right"
    elif left_valid and not right_valid:
        lane_state = "left"
    else:
        lane_state = "both"
    
    # Define a preferência de faixa com base na variável global preference_lane
    if preference_lane == "right":
        left_valid = False
    elif preference_lane == "left":
        right_valid = False
    
    # Atualiza o tamanho da pista sempre que as DUAS faixas foram detectadas e aceitas
    if left_valid and right_valid and near_width is not None:  # noqa: SIM102
        if TRACK_MIN_WIDTH < near_width < TRACK_MAX_WIDTH:
            track_size = round(TRACK_SIZE_ALPHA * near_width
                                   + (1 - TRACK_SIZE_ALPHA) * track_size)

    # Com uma faixa só, sempre usa o track_size
    lane_width = track_size
    y = reference_line_y

    # ===== Caso 1 - Duas faixas foram detectadas =====
    if left_valid and right_valid:
        # O centro da pista é a média entre as duas faixas detectadas
        track_center = (left_lane + right_lane) // 2
        error = track_center - (roi_w // 2)

        # Linha entre as faixas detectadas
        cv2.line(limiar_bgr, (left_lane, y), (right_lane, y), COLOR_GUIDE, 2, cv2.LINE_AA)

    # ===== Caso 2 - Apenas a faixa da direita foi detectada =====
    elif not left_valid and right_valid:
        # O centro da pista é a posição da faixa direita menos metade do tamanho da pista
        track_center = right_lane - (lane_width // 2)
        error = track_center - (roi_w // 2)

        # Cinza: centro até a faixa detectada. Laranja: onde a faixa esquerda deveria estar
        cv2.line(limiar_bgr, (track_center - (lane_width // 2), y), (track_center, y), COLOR_EST, 2, cv2.LINE_AA)
        cv2.line(limiar_bgr, (track_center, y), (right_lane, y), COLOR_GUIDE, 2, cv2.LINE_AA)

    # ===== Caso 3 - Apenas a faixa da esquerda foi detectada =====
    elif left_valid and not right_valid:
        # O centro da pista é a posição da faixa esquerda mais metade do tamanho da pista
        track_center = left_lane + (lane_width // 2)
        error = track_center - (roi_w // 2)

        # Cinza: faixa detectada até o centro. Laranja: onde a faixa direita deveria estar
        cv2.line(limiar_bgr, (left_lane, y), (track_center, y), COLOR_GUIDE, 2, cv2.LINE_AA)
        cv2.line(limiar_bgr, (track_center, y), (track_center + (lane_width // 2), y), COLOR_EST, 2, cv2.LINE_AA)

    # ===== Caso 4 - Nenhuma faixa foi detectada =====
    else:
        # Assume que o carro está seguindo a última trajetória conhecida, então mantém o erro anterior
        error = last_error

    return error, limiar_bgr, lane_state, track_size, track_center


def set_lane_preference(preference):
    global preference_lane
    if preference in ["left", "right", "neutral"]:
        preference_lane = preference
    else:
        raise ValueError("A preferência de faixa deve ser 'left', 'right' ou 'neutral'.")


def draw_dots(img, points, labels):
    for i, p in enumerate(points):
        x, y = int(p[0]), int(p[1])
        cv2.circle(img, (x, y), 5, (0, 255, 255), -1)
        cv2.putText(img, labels[i], (x + 6, y - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1)


def get_frame_dimensions(frame, prop):
    # Retorna as dimensões da imagem
    height, width = round(frame.shape[0] / prop), round(frame.shape[1] / prop)
    return height, width


def extract_bird_eye_view(frame, img, upper, lower, y_top, y_bot, roi_w, roi_h):
    _height, width = frame.shape[:2]
    cx = width // 2

    # ── Definição dos pontos de perspectiva ─────────────────────────────
    pts_origin = np.float32([
        [cx - upper // 2, y_top],
        [cx + upper // 2, y_top],
        [cx + lower // 2, y_bot],
        [cx - lower // 2, y_bot],
    ])

    pts_destiny = np.float32([
        [0,      0],
        [roi_w,  0],
        [roi_w,  roi_h],
        [0,      roi_h],
    ])

    # ── Visualização dos pontos e ROI ─────────────────────────────
    pts_poly = pts_origin.astype(np.int32).reshape((-1, 1, 2))
    overlay = img.copy()

    cv2.fillPoly(overlay, [pts_poly], (255, 0, 0))
    cv2.addWeighted(overlay, 0.3, img, 0.7, 0, img)
    cv2.polylines(img, [pts_poly], True, (255, 0, 0), 2)
    draw_dots(img, pts_origin, ["P1", "P2", "P3", "P4"])

    # Matriz de perspectiva
    M = cv2.getPerspectiveTransform(pts_origin, pts_destiny)

    # Bird's Eye View
    roi = cv2.warpPerspective(frame, M, (roi_w, roi_h))

    return roi, img


def reset_lane(start_time):
    global preference_lane, filtered_error
    elapsed = time.monotonic() - start_time
    if elapsed >= LANE_RESET_TIME:
        #print(f"[RESET] {elapsed:.2f}s")
        preference_lane = "neutral"
        filtered_error = None
        return True
    return False