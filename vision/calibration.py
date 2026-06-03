import cv2
import numpy as np

class FisheyeCorrector:

    def __init__(self, calibration_file, camera_width, camera_height, balance=0.5):

        data = np.load(calibration_file)

        K = data["K"]
        D = data["D"]

        new_K = cv2.fisheye.estimateNewCameraMatrixForUndistortRectify(
            K,
            D,
            (camera_width, camera_height),
            np.eye(3),
            balance=balance
        )

        self.map1, self.map2 = cv2.fisheye.initUndistortRectifyMap(
            K,
            D,
            np.eye(3),
            new_K,
            (camera_width, camera_height),
            cv2.CV_16SC2
        )

    def correct(self, frame):

        return cv2.remap(
            frame,
            self.map1,
            self.map2,
            interpolation=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_CONSTANT
        )