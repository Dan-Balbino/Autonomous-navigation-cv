import pytest

from core.pid import PID


def test_proportional_only():
    pid = PID(Kp=2.0, Ki=0.0, Kd=0.0, output_limit=90.0)
    assert pid.update(5.0, dt=0.1) == 10.0


def test_zero_error_gives_zero_output():
    pid = PID(Kp=1.0, Ki=0.0, Kd=0.0, output_limit=90.0)
    assert pid.update(0.0) == 0.0


def test_output_is_clamped_by_limit():
    pid = PID(Kp=10.0, Ki=0.0, Kd=0.0, output_limit=5.0)
    assert pid.update(100.0) == 5.0
    assert pid.update(-100.0) == -5.0


def test_no_limit_does_not_clamp():
    pid = PID(Kp=1.0, Ki=0.0, Kd=0.0)
    assert pid.update(200.0) == 200.0


def test_set_values_changes_gains():
    pid = PID(Kp=1.0, Ki=0.0, Kd=0.0)
    pid.setValues(3.0, 0.5, 0.1)
    assert (pid.Kp, pid.Ki, pid.Kd) == (3.0, 0.5, 0.1)


def test_integral_accumulates_and_reset_clears():
    pid = PID(Kp=0.0, Ki=1.0, Kd=0.0)
    pid.update(2.0, dt=0.5)
    out = pid.update(2.0, dt=0.5)
    assert out == pytest.approx(2.0)  # 1*2*0.5 duas vezes
    pid.reset()
    assert pid.integral == 0 and pid.previous_error == 0


def test_derivative_uses_previous_error():
    pid = PID(Kp=0.0, Ki=0.0, Kd=1.0)
    pid.update(0.0, dt=0.1)
    assert pid.update(1.0, dt=0.1) == pytest.approx(10.0)  # (1-0)*1/0.1
