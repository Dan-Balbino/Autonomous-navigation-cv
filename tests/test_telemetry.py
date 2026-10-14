import unittest

from core.telemetry import CarTelemetry


class CarTelemetryTest(unittest.TestCase):
    def test_run_button_accepts_serialized_aliases(self):
        self.assertTrue(CarTelemetry.from_dict({"run_btn": True}).run_button)
        self.assertTrue(CarTelemetry.from_dict({"run_button": True}).run_button)
        self.assertFalse(CarTelemetry.from_dict({"run_btn": False}).run_button)


if __name__ == "__main__":
    unittest.main()
