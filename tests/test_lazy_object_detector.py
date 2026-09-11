import importlib
import sys
import unittest
from unittest.mock import patch


class LazyObjectDetectorStartupTest(unittest.TestCase):
    def test_object_detector_does_not_load_yolo_models_until_prediction(self):
        # Limpa import anterior para garantir o estado real do módulo
        sys.modules.pop("vision.object_detector", None)

        with patch("ultralytics.YOLO") as mock_yolo:
            obj = importlib.import_module("vision.object_detector")
            detector = obj.ObjectDetector("model/Modelo_4.pt")
            # Antes da otimização, o ctor já carregava os modelos de IA.
            # Depois da otimização, a criação só guarda caminhos e não toca em YOLO.
            self.assertFalse(mock_yolo.called)


if __name__ == "__main__":
    unittest.main()
