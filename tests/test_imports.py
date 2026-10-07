"""Garante que os módulos principais importam sem erro (sem precisar de câmera, serial ou YOLO)."""
import importlib

import pytest


@pytest.mark.parametrize("module", [
    "core.pid",
    "core.command",
    "core.telemetry",
    "core.navigation",
    "core.serial_protocol",
    "vision.lane_detection",
    "vision.object_detector",
    "messaging.messaging_core",
])
def test_module_imports(module):
    importlib.import_module(module)
