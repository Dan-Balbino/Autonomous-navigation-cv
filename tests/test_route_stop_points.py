import unittest
from unittest.mock import patch

from core.navigation import Navigation
from vision.object_detector import ObjectDetector


class RouteStopPointTest(unittest.TestCase):
    def setUp(self):
        self.detector = ObjectDetector("missing-test-model.pt")
        self.detector.configure(focal_px=100)

    def test_stop_and_points_share_maximum_distance(self):
        self.detector.configure(
            stop_point_confidence=0.8,
            stop_confidence=0.8,
            max_stop_distance_m=0.5,
            detection_distance_m=0.75,
        )
        self.detector._boxes = [
            (0, 0, 30, 20, "ponto_A", 0.9),
            (0, 0, 30, 10, "ponto_B", 0.9),
            (0, 0, 30, 20, "pare", 0.9),
        ]

        self.assertTrue(self.detector.has_valid_stop_point("A"))
        self.assertFalse(self.detector.has_valid_stop_point("B"))
        self.assertTrue(self.detector._is_valid_stop("pare", 0, 0, 30, 20, 0.9))

        self.detector.configure(detection_distance_m=1.0)
        self.assertTrue(
            self.detector._is_valid_stop_point("ponto_B", 0, 0, 30, 10, 0.9)
        )

    def test_stops_are_valid_from_detection_distance_not_farther(self):
        self.detector.configure(
            max_stop_distance_m=0.2,
            detection_distance_m=0.5,
            stop_point_confidence=0.5,
            stop_confidence=0.5,
        )
        self.detector._boxes = [
            (0, 0, 30, 20, "pare", 0.9),
            (0, 0, 40, 20, "ponto_A", 0.9),
        ]

        self.assertTrue(self.detector._is_valid_stop("pare", 0, 0, 30, 20, 0.9))
        self.assertTrue(self.detector._is_valid_stop_point("ponto_A", 0, 0, 40, 20, 0.9))
        self.detector.configure(detection_distance_m=0.4)
        self.assertFalse(self.detector._is_valid_stop("pare", 0, 0, 30, 20, 0.9))
        self.assertFalse(self.detector._is_valid_stop_point("ponto_A", 0, 0, 40, 20, 0.9))

    def test_traffic_light_and_right_detour_use_detection_distance(self):
        self.detector.configure(
            detection_distance_m=0.5,
            light_confidence=0.5,
            right_detour_confidence=0.5,
        )

        self.assertTrue(
            self.detector._box_is_valid("semaforo", 0, 0, 30, 30, 0.9)
        )
        self.assertTrue(
            self.detector._is_valid_right_detour(
                "desvio_direita", 0, 0, 30, 20, 0.9
            )
        )
        self.assertFalse(
            self.detector._box_is_valid("semaforo", 0, 0, 30, 29, 0.9)
        )
        self.assertFalse(
            self.detector._is_valid_right_detour(
                "desvio_direita", 0, 0, 30, 19, 0.9
            )
        )

    def test_get_stop_distance_returns_nearest_valid_stop_sign(self):
        self.detector.configure(
            stop_confidence=0.8,
            max_stop_distance_m=0.75,
        )
        self.detector._boxes = [
            (0, 0, 30, 20, "pare", 0.9),
            (0, 0, 30, 10, "stop", 0.9),
            (0, 0, 30, 20, "pare", 0.7),
        ]

        self.assertEqual(self.detector.get_stop_distance(), 0.5)

    def test_stop_distance_remains_available_outside_hard_stop_limit(self):
        self.detector.configure(
            stop_confidence=0.8,
            max_stop_distance_m=0.25,
            detection_distance_m=0.25,
        )
        self.detector._boxes = [(0, 0, 30, 20, "pare", 0.9)]

        self.assertEqual(self.detector.get_stop_distance(), 0.5)
        self.assertFalse(self.detector._is_valid_stop("pare", 0, 0, 30, 20, 0.9))

    def test_stop_wait_starts_on_detection_and_full_cooldown_follows_stop(self):
        self.detector.configure(
            stop_wait_seconds=2,
            cooldown_seconds=5,
            max_stop_distance_m=0.5,
        )

        with patch(
            "vision.object_detector.time.time",
            side_effect=[100, 101, 102.1, 104.9, 107.0, 107.2, 107.3],
        ):
            self.assertTrue(self.detector.get_state(stop_distance_m=0.6)[0])
            self.assertEqual(self.detector._stop_until, 102)
            self.assertEqual(self.detector._cooldown_until, 0)

            self.assertTrue(self.detector.get_state(stop_distance_m=0.6)[0])
            self.assertFalse(self.detector.get_state(stop_distance_m=0.6)[0])
            self.assertEqual(self.detector._cooldown_until, 107.1)
            self.assertTrue(self.detector.stop_sign_suppressed)

            self.assertFalse(self.detector.get_state(stop_distance_m=None)[0])
            self.assertTrue(self.detector.stop_sign_suppressed)
            self.assertFalse(self.detector.get_state(stop_distance_m=None)[0])
            self.assertTrue(self.detector.stop_sign_suppressed)
            self.assertFalse(self.detector.get_state(stop_distance_m=None)[0])
            self.assertFalse(self.detector.stop_sign_suppressed)
            self.assertTrue(self.detector.get_state(stop_distance_m=0.6)[0])

    def test_default_stop_state_starts_when_valid_sign_is_detected(self):
        self.detector.configure(
            stop_confidence=0.5,
            max_stop_distance_m=0.2,
            detection_distance_m=0.5,
        )
        self.detector._boxes = [(0, 0, 30, 20, "pare", 0.9)]

        self.assertTrue(self.detector.get_state()[0])

    def test_stop_wait_releases_without_restarting_on_still_visible_sign(self):
        self.detector.configure(
            stop_confidence=0.5,
            stop_wait_seconds=1,
            cooldown_seconds=0,
            max_stop_distance_m=0.5,
        )
        self.detector._boxes = [(0, 0, 30, 20, "pare", 0.9)]

        with patch("vision.object_detector.time.time", side_effect=[100, 101.1, 101.2]):
            self.assertTrue(self.detector.get_state(stop_distance_m=0.5)[0])
            self.assertFalse(self.detector.get_state(stop_distance_m=0.5)[0])
            self.assertFalse(self.detector.get_state(stop_distance_m=0.5)[0])

    def test_stop_rearms_after_sign_is_no_longer_detected(self):
        self.detector.configure(
            stop_confidence=0.5,
            stop_wait_seconds=1,
            cooldown_seconds=0,
            max_stop_distance_m=0.5,
        )

        with patch(
            "vision.object_detector.time.time",
            side_effect=[100, 101.1, 101.2, 101.3],
        ):
            self.assertTrue(self.detector.get_state(stop_distance_m=0.5)[0])
            self.assertFalse(self.detector.get_state(stop_distance_m=0.5)[0])
            self.assertFalse(self.detector.get_state(stop_distance_m=None)[0])
            self.assertTrue(self.detector.get_state(stop_distance_m=0.5)[0])

    def test_stop_rearm_requires_cooldown_and_sign_clear(self):
        self.detector.configure(
            stop_confidence=0.5,
            stop_wait_seconds=1,
            cooldown_seconds=2,
            max_stop_distance_m=0.5,
        )

        with patch(
            "vision.object_detector.time.time",
            side_effect=[100, 101.1, 101.2, 103.1, 103.2, 103.3],
        ):
            self.assertTrue(self.detector.get_state(stop_distance_m=0.5)[0])
            self.assertFalse(self.detector.get_state(stop_distance_m=0.5)[0])
            self.assertFalse(self.detector.get_state(stop_distance_m=None)[0])
            self.assertFalse(self.detector.get_state(stop_distance_m=0.5)[0])
            self.assertFalse(self.detector.get_state(stop_distance_m=None)[0])
            self.assertTrue(self.detector.get_state(stop_distance_m=0.5)[0])

    def test_completed_stop_suppresses_approach_until_sign_clears(self):
        self.detector.configure(
            stop_confidence=0.5,
            stop_wait_seconds=1,
            cooldown_seconds=2,
            max_stop_distance_m=0.5,
        )

        with patch(
            "vision.object_detector.time.time",
            side_effect=[100, 101.1, 101.2, 103.2],
        ):
            self.assertTrue(self.detector.get_state(stop_distance_m=0.5)[0])
            self.assertFalse(self.detector.stop_sign_suppressed)

            self.assertFalse(self.detector.get_state(stop_distance_m=0.6)[0])
            self.assertTrue(self.detector.stop_sign_suppressed)
            self.assertTrue(self.detector.is_pwm_zero_approach(0.6, 1.0))

            self.detector.get_state(stop_distance_m=0.6)
            self.assertTrue(self.detector.stop_sign_suppressed)

            self.detector.get_state(stop_distance_m=None)
            self.assertFalse(self.detector.stop_sign_suppressed)

    def test_detection_approach_is_between_detection_and_stop_distances(self):
        self.detector.configure(max_stop_distance_m=0.5)

        self.assertTrue(self.detector.is_pwm_zero_approach(1.0, 1.0))
        self.assertFalse(self.detector.is_pwm_zero_approach(0.5, 1.0))
        self.assertFalse(self.detector.is_pwm_zero_approach(0.4, 1.0))
        self.assertFalse(self.detector.is_pwm_zero_approach(1.1, 1.0))
        self.assertFalse(self.detector.is_pwm_zero_approach(None, 1.0))

    def test_only_current_route_point_triggers_stop(self):
        self.detector.configure(
            stop_point_confidence=0.5,
            max_stop_distance_m=0.2,
        )
        self.detector._boxes = [(0, 0, 40, 40, "ponto_A", 0.9)]

        self.assertFalse(self.detector.has_valid_stop_point("B"))
        self.assertFalse(self.detector.has_valid_stop_point("A"))
        self.assertEqual(self.detector.get_stop_point_distance("A"), 0.25)
        self.detector.configure(max_stop_distance_m=0.3)
        self.assertTrue(self.detector.has_valid_stop_point("A"))

    def test_route_stop_point_does_not_use_timed_stop_state(self):
        self.detector.configure(
            stop_point_confidence=0.5,
            stop_wait_seconds=3,
            cooldown_seconds=10,
        )
        self.detector._boxes = [(0, 0, 40, 40, "ponto_A", 0.9)]
        self.detector._cooldown_until = float("inf")

        stop_active, _ = self.detector.get_state()

        self.assertFalse(stop_active)
        self.assertFalse(self.detector.stop_active)

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

    def test_route_point_is_consumed_after_detection_timeout(self):
        navigation = Navigation()
        navigation.add_point("A")
        navigation.add_point("B")

        self.assertTrue(navigation.request_stop_at_current_point("A", now=10.0))
        self.assertFalse(navigation.request_stop_at_current_point("A"))
        self.assertFalse(
            navigation.should_stop_at_current_point(None, 1.0, now=11.49)
        )
        self.assertTrue(
            navigation.should_stop_at_current_point(None, 1.0, now=11.5)
        )
        self.assertTrue(navigation.confirm_current_point("A"))
        self.assertEqual(navigation.current_route, "B")
        self.assertEqual(navigation.route, ["B"])

    def test_route_point_stops_immediately_at_maximum_distance(self):
        navigation = Navigation()
        navigation.add_point("A")

        self.assertTrue(navigation.request_stop_at_current_point("A", now=1.0))
        self.assertFalse(
            navigation.should_stop_at_current_point(1.0, 1.0, now=1.1)
        )
        self.assertTrue(
            navigation.should_stop_at_current_point(0.99, 1.0, now=1.1)
        )
        self.assertTrue(navigation.confirm_current_point("A"))
        self.assertIsNone(navigation.pending_stop_point)

    def test_route_point_detection_timer_starts_before_stop_distance(self):
        navigation = Navigation()
        navigation.add_point("A")

        self.assertTrue(navigation.request_stop_at_current_point("A", now=1.0))
        self.assertFalse(
            navigation.should_stop_at_current_point(2.0, 1.0, now=2.0)
        )
        self.assertFalse(navigation.request_stop_at_current_point("A", now=2.0))
        self.assertTrue(
            navigation.should_stop_at_current_point(2.0, 1.0, now=2.5)
        )

    def test_stop_points_keep_independent_confidence_limits(self):
        self.detector.configure(
            stop_point_a_confidence=0.8,
            stop_point_b_confidence=0.7,
            stop_point_c_confidence=0.8,
        )
        self.detector._boxes = [
            (0, 0, 30, 20, "ponto_A", 0.8),
            (0, 0, 30, 20, "ponto_B", 0.69),
            (0, 0, 60, 20, "ponto_C", 0.79),
        ]

        self.assertTrue(self.detector.has_valid_stop_point("A"))
        self.assertFalse(self.detector.has_valid_stop_point("B"))
        self.assertFalse(self.detector.has_valid_stop_point("C"))

        self.detector.configure(stop_point_b_confidence=0.6)
        self.assertTrue(self.detector.has_valid_stop_point("B"))


if __name__ == "__main__":
    unittest.main()