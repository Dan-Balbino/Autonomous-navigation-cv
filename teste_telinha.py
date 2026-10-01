import time
import cv2
import numpy as np
import serial

# ============================================================
# CONFIGURAÇÕES
# ============================================================

PORT = "COM15"          # /dev/ttyUSB0 no Linux
BAUD = 115200
SEND_HZ = 20

SPEED_MAX = 3.0         # m/s
SPEED_STEPS = 100       # resolução da trackbar (1 passo = 0,01 m/s)

WINDOW = "Controle"


def nothing(*_):
    pass


def main():
    esp = serial.Serial(PORT, BAUD, timeout=0.1)
    time.sleep(2)  # o ESP reseta quando a porta abre

    cv2.namedWindow(WINDOW)

    cv2.createTrackbar(
        "Velocidade",
        WINDOW,
        0,
        int(SPEED_MAX * SPEED_STEPS),
        nothing
    )

    cv2.createTrackbar(
        "Angulo",
        WINDOW,
        90,
        180,
        nothing
    )

    canvas = np.zeros((120, 400, 3), dtype=np.uint8)

    period = 1.0 / SEND_HZ

    while True:
        speed = cv2.getTrackbarPos("Velocidade", WINDOW) / SPEED_STEPS
        steering = cv2.getTrackbarPos("Angulo", WINDOW)

        esp.write(f"{speed:.2f},{steering}\n".encode())

        canvas[:] = 0

        cv2.putText(
            canvas,
            f"Velocidade: {speed:.2f} m/s",
            (15, 45),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (255, 255, 255),
            2
        )

        cv2.putText(
            canvas,
            f"Angulo: {steering} graus",
            (15, 85),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (255, 255, 255),
            2
        )

        cv2.imshow(WINDOW, canvas)

        key = cv2.waitKey(int(period * 1000)) & 0xFF

        if key == ord("q"):
            break

        if key == ord(" "):
            cv2.setTrackbarPos("Velocidade", WINDOW, 0)
            cv2.setTrackbarPos("Angulo", WINDOW, 90)

    esp.write(b"0.00,90\n")

    esp.close()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()