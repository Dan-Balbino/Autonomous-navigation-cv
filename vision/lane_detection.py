import cv2
import numpy as np

track_size = 200
preference_lane = "neutral" # "left", "right", "neutral"

def lane_detection_pipeline(roi_h, roi_w, limiar, limiar_bgr, last_error=0):
    global track_size, preference_lane
    
    # Inicializa o centro da pista e o erro
    track_center = 0
    
    # Define a linha de referência para a detecção das faixas e o limite mínimo de pixels brancos para considerar uma faixa válida
    mid_y         = roi_h // 2
    reference_line_y = mid_y + (mid_y // 2)
    minimum_limit = (roi_h // 2) * 0.1
    
    # Realiza uma busca por janelas deslizantes para detectar as faixas na imagem limiarizada
    left_lane, right_lane, left_valid, right_valid = sliding_window_search(limiar, roi_h // 2, roi_w, minimum_limit, num_windows=3)
    
    if track_size == 0:
        track_size = right_lane - left_lane
    
    # Processa a detecção das faixas e calcula o erro de acordo com os casos possíveis
    error, limiar_bgr, lane_state, track_size, track_center =  process_lanes(left_lane, right_lane, left_valid, right_valid, roi_w, reference_line_y, limiar_bgr, last_error, track_size, preference_lane)
    
    # Desenha um círculo verde no centro da pista 
    if(track_center != 0):
        cv2.circle(limiar_bgr, (track_center, reference_line_y), 5, (0, 255, 0), -1)
    
    # Desenha um círculo vermelho no ponto de referência para o cálculo do erro
    cv2.circle(limiar_bgr, (roi_w // 2, round(roi_h * 0.9)), 5, (0, 0, 255), -1)
        
    return error, limiar_bgr, lane_state


def sliding_window_search(limiar, height, width, limit, num_windows=1):
    # Realiza uma busca por janelas deslizantes para detectar as faixas na imagem limiarizada, retornando a posição das faixas detectadas e se cada uma é válida ou não
    right_lanes_pos = []
    left_lanes_pos = []
    
    # "height" é a altura da região analisada (metade de baixo da ROI) e cada janela ocupa height // num_windows
    window_height = height // num_windows
    roi_h = limiar.shape[0]
    
    # Para cada janela, de baixo (perto do carro) para cima, detecta a faixa esquerda e a direita mais próximas do centro
    for window in range(num_windows):
        end_y = roi_h - window * window_height
        start_y = end_y - window_height
        
        left_lane, right_lane, left_valid, right_valid = detect_lanes(limiar[start_y:end_y], window_height, width, limit)
 
        if left_valid:
            left_lanes_pos.append(left_lane)
            
        if right_valid:
            right_lanes_pos.append(right_lane)

    # Usa a mediana em vez da média: uma janela que pegou a faixa errada não puxa o resultado das outras
    return (int(np.median(left_lanes_pos)) if left_lanes_pos else 0,
            int(np.median(right_lanes_pos)) if right_lanes_pos else width,
            bool(left_lanes_pos),
            bool(right_lanes_pos))


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
        center = int(round(np.sum(np.arange(s, e) * seg) / np.sum(seg)))
        candidates.append((center, int(seg.max())))
    return candidates


def detect_lanes(limiar, height, width, limit, slice_image=False, min_width=2):
    img = limiar[height:] if slice_image else limiar

    # Conta os pixels brancos em cada coluna (vetorizado, bem mais rápido que list comprehension)
    hist = np.count_nonzero(img, axis=0)

    candidates = find_lane_candidates(hist, limit, min_width)
    cx = width // 2

    left_cands  = [c for c in candidates if c[0] < cx]
    right_cands = [c for c in candidates if c[0] >= cx]

    # Escolhe a faixa válida mais próxima do centro em cada lado
    left_valid  = bool(left_cands)
    right_valid = bool(right_cands)
    left_lane   = max(left_cands,  key=lambda c: c[0])[0] if left_valid  else 0
    right_lane  = min(right_cands, key=lambda c: c[0])[0] if right_valid else width

    return left_lane, right_lane, left_valid, right_valid


def process_lanes(left_lane, right_lane, left_valid, right_valid, roi_w, reference_line_y, limiar_bgr, last_error, track_size=0, preference_lane="neutral"):
    track_center = 0
    
    # Define a preferência de faixa com base na variável global preference_lane
    if preference_lane == "right":
        left_valid = False
    elif preference_lane == "left":
        right_valid = False
    
    # ===== Caso 1 - Duas faixas foram detectadas =====
    if left_valid and right_valid:
        # O centro da pista é a média entre as duas faixas detectadas
        track_center = (left_lane + right_lane) // 2
        error = track_center - (roi_w // 2) 
        
        # Atualiza o tamanho da pista
        if right_lane - left_lane > 100:
            track_size = right_lane - left_lane
        
        # Desenha uma linha entre as faixas detectadas
        cv2.line(limiar_bgr, (left_lane, reference_line_y), (right_lane, reference_line_y), (100, 100, 100), 2)
        lane_state = "both"
        
    # ===== Caso 2 - Apenas a faixa da direita foi detectada =====
    elif not left_valid and right_valid:
        # O centro da pista é diferença entre a posição da faixa direita e metade do tamanho da pista
        track_center = right_lane - (track_size // 2)
        error = track_center - (roi_w // 2)
        
        # Desenha uma linha cinza do centro da pista para a faixa da direita e uma linha vermelha do centro da pista para onde a faixa da esquerda deveria estar
        cv2.line(limiar_bgr, (track_center - (track_size // 2), reference_line_y), (track_center + (track_size // 2), reference_line_y), (0, 0, 255), 2)
        cv2.line(limiar_bgr, (track_center, reference_line_y), (right_lane, reference_line_y), (100, 100, 100), 2)
        lane_state = "right"
        
    # ===== Caso 3 - Apenas a faixa da esquerda foi detectada =====
    elif left_valid and not right_valid:
        # O centro da pista é a soma da posição da faixa esquerda com metade do tamanho da pista
        track_center = left_lane + (track_size // 2)
        error = track_center - (roi_w // 2)
        
        # Desenha uma linha cinza do centro da pista para a faixa da esquerda e uma linha vermelha do centro da pista para onde a faixa da direita deveria estar
        cv2.line(limiar_bgr, (left_lane, reference_line_y), (track_center, reference_line_y), (100, 100, 100), 2)
        cv2.line(limiar_bgr, (track_center, reference_line_y), (track_center + (track_size // 2), reference_line_y), (0, 0, 255), 2)
        lane_state = "left"
        
    # ===== Caso 4 - Nenhuma faixa foi detectada =====
    else:
        # Assume que o carro está seguindo a última trajetória conhecida, então mantém o erro anterior
        error = last_error
        lane_state = "none"

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
    height, width = frame.shape[:2]
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

def reset_lane():
    global preference_lane
    # Se uma das faixas não for detectada, define o estado da pista como "neutral"
    preference_lane = "neutral"