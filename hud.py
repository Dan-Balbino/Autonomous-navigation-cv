import cv2
import numpy as np

def drawDots(img, points, labels):
    for i, p in enumerate(points):
        x, y = int(p[0]), int(p[1])
        cv2.circle(img, (x, y), 5, (0, 255, 255), -1)
        cv2.putText(img, labels[i], (x + 6, y - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1)


def addInfo(error, angle, pwm, kp_straight, ki_straight, kd_straight,
            kp_curve, ki_curve, kd_curve, last_rx, run,
            flag_stop=False, flag_sg=False, flag_sv=False):
    info = np.zeros((160, 960, 3), dtype=np.uint8)

    # ── coluna 1 — erro, servo, pwm ──
    cv2.putText(info, f"Erro:  {error}",           (20, 40),  cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
    cv2.putText(info, f"Servo: {int(angle + 90)}", (20, 80),  cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0),   2)
    cv2.putText(info, f"PWM:   {pwm}",             (20, 120), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)

    # ── coluna 2 — PID reta ──
    cv2.putText(info, "PID RETA",           (340, 25),  cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 0), 1)
    cv2.putText(info, f"Kp: {kp_straight:.2f}", (340, 55),  cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 0), 2)
    cv2.putText(info, f"Ki: {ki_straight:.3f}", (340, 85),  cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 0), 2)
    cv2.putText(info, f"Kd: {kd_straight:.2f}", (340, 115), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 0), 2)

    # ── coluna 3 — PID curva ──
    cv2.putText(info, "PID CURVA",        (580, 25),  cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 1)
    cv2.putText(info, f"Kp: {kp_curve:.2f}", (580, 55),  cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
    cv2.putText(info, f"Ki: {ki_curve:.3f}", (580, 85),  cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
    cv2.putText(info, f"Kd: {kd_curve:.2f}", (580, 115), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)

    # ── coluna 4 — sinais + status ──
    cv2.putText(info, "SINAIS",     (790, 25),  cv2.FONT_HERSHEY_SIMPLEX, 0.6, (180, 180, 180), 1)
    cv2.putText(info, "STOP", (790, 60),  cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                (0, 0, 220)   if flag_stop else (60, 60, 60), 2)
    cv2.putText(info, "SG",   (870, 60),  cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                (0, 220, 0)   if flag_sg   else (60, 60, 60), 2)
    cv2.putText(info, "SV",   (920, 60),  cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                (0, 140, 255) if flag_sv   else (60, 60, 60), 2)

    cv2.putText(info, "STATUS",  (790, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (180, 180, 180), 1)
    cv2.putText(info, "RUNNING" if run else "STOPPED", (790, 130),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                (0, 255, 128) if run else (0, 0, 255), 2)
    cv2.putText(info, last_rx[:18], (790, 155), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 255, 128), 1)

    return info