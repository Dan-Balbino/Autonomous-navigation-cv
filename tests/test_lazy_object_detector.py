import importlib
import sys
import types
import unittest
from unittest.mock import MagicMock, patch


class LazyObjectDetectorStartupTest(unittest.TestCase):
    def test_object_detector_does_not_load_yolo_models_until_prediction(self):
        # Limpa import anterior para garantir o estado real do módulo
        sys.modules.pop("vision.object_detector", None)

        # O CI não instala o ultralytics (traz o PyTorch); um módulo falso basta,
        # pois o teste só verifica que o YOLO não é chamado na criação.
        fake_yolo = MagicMock()
        fake_ultralytics = types.ModuleType("ultralytics")
        fake_ultralytics.YOLO = fake_yolo

        with patch.dict(sys.modules, {"ultralytics": fake_ultralytics}):
            obj = importlib.import_module("vision.object_detector")
            obj.ObjectDetector("model/Modelo_4.pt")
            # A criação só guarda caminhos; os modelos de IA carregam na primeira predição.
            self.assertFalse(fake_yolo.called)


if __name__ == "__main__":
    unittest.main()
