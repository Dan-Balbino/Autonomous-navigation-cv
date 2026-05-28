import cv2
import numpy as np

def processLane(roi_h, roi_w, limiar, limiar_bgr):
    error = 0
    mid_y         = roi_h // 2
    row           = limiar[mid_y]
    left_indices  = np.where(row[:roi_w // 2] == 255)[0]
    right_indices = np.where(row[roi_w // 2:] == 255)[0]

    if len(left_indices) > 0 and len(right_indices) > 0:
        left_x  = left_indices[-1]
        right_x = right_indices[0] + (roi_w // 2)
        mid_x   = (left_x + right_x) // 2
        error    = mid_x - (roi_w // 2)

        cv2.line(limiar_bgr, (left_x, mid_y), (right_x, mid_y), (100, 100, 100), 2)
        cv2.circle(limiar_bgr, (mid_x, mid_y), 5, (0, 255, 0), -1)
        cv2.circle(limiar_bgr, (roi_w // 2, round(roi_h * 0.9)), 5, (0, 0, 255), -1)
        
    return error, limiar_bgr