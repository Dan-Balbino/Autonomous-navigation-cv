import cv2
import numpy as np

track_size = 0

def laneDetectionPipeline(roi_h, roi_w, limiar, limiar_bgr, last_error=0):
    global track_size
    
    # Inicializa o centro da pista e o erro
    track_center = 0
    
    # Define a linha de referência para a detecção das faixas e o limite mínimo de pixels brancos para considerar uma faixa válida
    mid_y         = roi_h // 2
    reference_line_y = mid_y + (mid_y // 2)
    minimum_limit = (roi_h // 2) * 0.1
    
    # Detecta as faixas na imagem limiarizada e retorna a posição da faixa esquerda, da faixa direita e se cada uma é válida ou não
    left_lane, right_lane, left_valid, right_valid = detectLanes(limiar, roi_h // 2, roi_w, minimum_limit)
    
    if track_size == 0:
        track_size = right_lane - left_lane
    
    # Processa a detecção das faixas e calcula o erro de acordo com os casos possíveis
    error, limiar_bgr, lane_state =  processLane(left_lane, right_lane, left_valid, right_valid, roi_w, reference_line_y, limiar_bgr, last_error, track_size)
    
    # Desenha um círculo verde no centro da pista 
    if(track_center != 0):
        cv2.circle(limiar_bgr, (track_center, mid_y + (mid_y // 2)), 5, (0, 255, 0), -1)
    
    # Desenha um círculo vermelho no ponto de referência para o cálculo do erro
    cv2.circle(limiar_bgr, (roi_w // 2, round(roi_h * 0.9)), 5, (0, 0, 255), -1)
        
    return error, limiar_bgr, lane_state


def detectLanes(limiar, height, width, limit):
    # Conta o número de pixels brancos em cada coluna da imagem limiarizada a partir da metade inferior da ROI
    white_pixels_per_column = [cv2.countNonZero(limiar[height:, i]) for i in range(width)]

    # Encontra a posição da faixa esquerda e da faixa direita com base no número de pixels brancos em cada coluna
    left_lane = white_pixels_per_column.index(max(white_pixels_per_column[:width // 2]))
    half_right = white_pixels_per_column[width // 2:]
    right_lane = half_right.index(max(white_pixels_per_column[width // 2:])) + width // 2

    # Verifica se as faixas detectadas são válidas com base no limite mínimo de pixels brancos
    right_valid, left_valid = False, False
    if(white_pixels_per_column[left_lane] > limit):
        left_valid = True
    if(white_pixels_per_column[right_lane] > limit):
        right_valid = True

    return left_lane, right_lane, left_valid, right_valid


def processLane(left_lane, right_lane, left_valid, right_valid, roi_w, reference_line_y, limiar_bgr, last_error, track_size=0):
    # Caso 1 - Duas faixas detectadas
    if left_valid and right_valid:
        # O centro da pista é a média entre as duas faixas detectadas
        track_center = (left_lane + right_lane) // 2
        error = track_center - (roi_w // 2) 
        
        # Caso detecte as duas faixas, atualiza o tamanho da pista
        track_size = right_lane - left_lane
        
        # Desenha uma linha entre as faixas detectadas
        cv2.line(limiar_bgr, (left_lane, reference_line_y), (right_lane, reference_line_y), (100, 100, 100), 2)
        lane_state = "both"
        
    # Caso 2 - Apenas a faixa da direita detectada
    elif not left_valid and right_valid:
        # O centro da pista é diferença entre a posição da faixa direita e metade do tamanho da pista
        track_center = right_lane - (track_size // 2)
        error = track_center - (roi_w // 2)
        
        # Desenha uma linha cinza do centro da pista pra a faixa da direita e uma linha vermelha do centro da pista para onde a faixa da esquerda deveria estar
        cv2.line(limiar_bgr, (track_center - (track_size // 2), reference_line_y), (track_center + (track_size // 2), reference_line_y), (0, 0, 255), 2)
        cv2.line(limiar_bgr, (track_center, reference_line_y), (right_lane, reference_line_y), (100, 100, 100), 2)
        lane_state = "right"
        
    # Caso 3 - Apenas a faixa da esquerda detectada
    elif left_valid and not right_valid:
        # O centro da pista é a soma da posição da faixa esquerda com metade do tamanho da pista
        track_center = left_lane + (track_size // 2)
        error = track_center - (roi_w // 2)
        
        # Desenha uma linha cinza do centro da pista pra a faixa da esquerda e uma linha vermelha do centro da pista para onde a faixa da direita deveria estar
        cv2.line(limiar_bgr, (left_lane, reference_line_y), (track_center, reference_line_y), (100, 100, 100), 2)
        cv2.line(limiar_bgr, (track_center, reference_line_y), (track_center + (track_size // 2), reference_line_y), (0, 0, 255), 2)
        lane_state = "left"
        
    # Caso 4 - Nenhuma faixa detectada
    else:
        # Assume que o carro está seguindo a última trajetória conhecida, então mantém o erro anterior
        error = last_error
        lane_state = "none"

    return error, limiar_bgr, lane_state

def getFrameDimensions(frame, prop):
    height, width = round(frame.shape[0] / prop), round(frame.shape[1] / prop)
    return height, width