import unittest

from core.navigation import Navigation
from vision.object_detector import ObjectDetector


class RouteStopPointTest(unittest.TestCase):
    def setUp(self):
        self.detector = ObjectDetector("missing-test-model.pt")

    def test_stop_point_requires_confidence_and_minimum_diagonal(self):
        self.detector.configure(
            stop_point_confidence=0.8,
            min_stop_point_diagonal=50,
        )
        self.detector._boxes = [
            (0, 0, 30, 40, "ponto_A", 0.9),
            (0, 0, 30, 40, "ponto_B", 0.79),
        ]

        self.assertTrue(self.detector.has_valid_stop_point("A"))
        self.assertFalse(self.detector.has_valid_stop_point("B"))

        self.detector.configure(min_stop_point_diagonal=51)
        self.assertFalse(self.detector.has_valid_stop_point("A"))

    def test_only_current_route_point_triggers_stop(self):
        self.detector.configure(stop_point_confidence=0.5)
        self.detector._boxes = [(0, 0, 40, 40, "ponto_A", 0.9)]

        self.assertFalse(self.detector.get_state("B")[0])
        self.assertTrue(self.detector.get_state("A")[0])

    def test_person_detection_requires_confidence_and_minimum_diagonal(self):
        self.detector.configure(
            person_confidence=0.8,
            min_person_diagonal=50,
        )
        self.detector._person_boxes = [
            (0, 0, 30, 40, 0.9),
            (0, 0, 30, 40, 0.79),
        ]

        self.assertTrue(self.detector.has_valid_person())

        self.detector._person_boxes = [(0, 0, 30, 40, 0.79)]
        self.assertFalse(self.detector.has_valid_person())

        self.detector._person_boxes = [(0, 0, 30, 40, 0.9)]
        self.detector.configure(min_person_diagonal=51)
        self.assertFalse(self.detector.has_valid_person())

    def test_navigation_waits_for_matching_point_confirmation(self):
        navigation = Navigation()
        navigation.add_point("A")
        navigation.add_point("B")

        self.assertEqual(navigation.update_lane(), "right")
        self.assertEqual(navigation.update_lane(), "right")
        self.assertEqual(navigation.route, ["A", "B"])
        self.assertFalse(navigation.confirm_current_point("B"))
        self.assertEqual(navigation.current_route, "A")

        self.assertTrue(navigation.confirm_current_point("A"))
        self.assertEqual(navigation.current_route, "B")
        self.assertEqual(navigation.route, ["B"])

    def test_stop_points_have_independent_confidence_and_diagonal_limits(self):
        self.detector.configure(
            stop_point_a_confidence=0.8,
            min_stop_point_a_diagonal=50,
            stop_point_b_confidence=0.7,
            min_stop_point_b_diagonal=60,
            stop_point_c_confidence=0.8,
            min_stop_point_c_diagonal=40,
        )
        self.detector._boxes = [
            (0, 0, 30, 40, "ponto_A", 0.8),
            (0, 0, 30, 40, "ponto_B", 0.9),
            (0, 0, 60, 80, "ponto_C", 0.79),
        ]

        self.assertTrue(self.detector.has_valid_stop_point("A"))
        self.assertFalse(self.detector.has_valid_stop_point("B"))
        self.assertFalse(self.detector.has_valid_stop_point("C"))

        self.detector.configure(min_stop_point_b_diagonal=50)
        self.assertTrue(self.detector.has_valid_stop_point("B"))


if __name__ == "__main__":
    unittest.main()