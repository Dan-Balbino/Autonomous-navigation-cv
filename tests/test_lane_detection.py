import os

import cv2
import numpy as np
import pytest

from vision.lane_detection import lane_detection_pipeline

ROI_W, ROI_H = 320, 240
IMAGES_DIR = os.path.join(os.path.dirname(__file__), "images")


def bird_eye(frame, upper=1280, lower=1280, y_top=263, y_bot=541, limiar=195):
    """Mesma transformação de perspectiva + limiar usada no main.py."""
    h, w = frame.shape[:2]
    cx = w // 2
    src = np.float32([
        [cx - upper // 2, y_top], [cx + upper // 2, y_top],
        [cx + lower // 2, y_bot], [cx - lower // 2, y_bot],
    ])
    dst = np.float32([[0, 0], [ROI_W, 0], [ROI_W, ROI_H], [0, ROI_H]])
    roi = cv2.warpPerspective(frame, cv2.getPerspectiveTransform(src, dst), (ROI_W, ROI_H))
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, limiar, 255, cv2.THRESH_BINARY)
    return thresh, cv2.cvtColor(thresh, cv2.COLOR_GRAY2BGR)


@pytest.mark.parametrize("name", ["pista02.png", "curva_2.png", "curva_2_no_right_lane.png"])
def test_pipeline_on_static_images(name):
    frame = cv2.imread(os.path.join(IMAGES_DIR, name))
    assert frame is not None, f"Imagem não carregada: {name}"

    thresh, bird = bird_eye(frame)
    error, bird_out, state = lane_detection_pipeline(ROI_H, ROI_W, thresh, bird, last_error=0)

    assert isinstance(error, (int, float, np.integer, np.floating))
    assert bird_out.shape == (ROI_H, ROI_W, 3)
    assert isinstance(state, str)


def test_pipeline_on_empty_image_keeps_running():
    """Sem nenhuma faixa visível o pipeline não pode quebrar."""
    thresh = np.zeros((ROI_H, ROI_W), dtype=np.uint8)
    bird = cv2.cvtColor(thresh, cv2.COLOR_GRAY2BGR)
    error, bird_out, state = lane_detection_pipeline(ROI_H, ROI_W, thresh, bird, last_error=7)

    assert isinstance(error, (int, float, np.integer, np.floating))
    assert bird_out.shape == (ROI_H, ROI_W, 3)
    assert isinstance(state, str)
