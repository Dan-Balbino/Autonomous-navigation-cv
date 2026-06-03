import os
import sys
import cv2
import numpy as np

sys.path.append(
    os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..")
    )
)

from vision.lane_detection import lane_detection_pipeline


def nothing(x):
    pass

ROI_W = 320
ROI_H = 240

#frame = cv2.imread("tests/images/pista02.png")
frame = cv2.imread("tests/images/curva_2_no_right_lane.png")
#frame = cv2.imread("tests/images/curva_2.png")

if frame is None:
    print("Imagem não encontrada")
    exit()

height, width = frame.shape[:2]

# Epelha a imagem
# frame = cv2.flip(frame, 1)

cv2.namedWindow("Controles")

cv2.createTrackbar("Linha superior", "Controles", 1280, width, nothing)
cv2.createTrackbar("Linha inferior", "Controles", 1280, width, nothing)
cv2.createTrackbar("Altura sup", "Controles", 263, height, nothing)
cv2.createTrackbar("Altura inf", "Controles", 541, height, nothing)
cv2.createTrackbar("Limiar", "Controles", 195, 255, nothing)

while True:

    img = frame.copy()

    upper = cv2.getTrackbarPos("Linha superior", "Controles")
    lower = cv2.getTrackbarPos("Linha inferior", "Controles")
    y_top = cv2.getTrackbarPos("Altura sup", "Controles")
    y_bot = cv2.getTrackbarPos("Altura inf", "Controles")
    limiar_value = cv2.getTrackbarPos("Limiar", "Controles")

    cx = width // 2

    pts_origem = np.float32([[cx - upper // 2, y_top], [cx + upper // 2, y_top], [cx + lower // 2, y_bot], [cx - lower // 2, y_bot]])
    pts_destino = np.float32([[0, 0], [ROI_W, 0], [ROI_W, ROI_H], [0, ROI_H]])

    cv2.polylines(img, [pts_origem.astype(np.int32)], True, (255, 0, 0), 2)
    M = cv2.getPerspectiveTransform(pts_origem, pts_destino)
    roi = cv2.warpPerspective(frame, M, (ROI_W, ROI_H))
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, limiar_value, 255, cv2.THRESH_BINARY)
    bird = cv2.cvtColor(thresh, cv2.COLOR_GRAY2BGR)


    erro, bird, lane_state = lane_detection_pipeline(ROI_H, ROI_W, thresh, bird, last_error=0)

    cv2.putText(bird, f"Erro: {erro}", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
    cv2.putText(bird, f"Estado da pista: {lane_state}", (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)

    cv2.imshow("Camera", img)
    cv2.imshow("Bird Eye", bird)

    key = cv2.waitKey(30)

    if key == ord('q'):
        break

cv2.destroyAllWindows()