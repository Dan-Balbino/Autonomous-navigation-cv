#ifndef HBRIDGECONTROLLER_H
#define HBRIDGECONTROLLER_H

class HBridgeController {
    private:
        int _rpwm, _lpwm;
        int _enR, _enL;

        int _vel;
        int _targetVel;

        bool _isAccelerationEnable;

        int _accStep;
        unsigned long _lastUpdate;

        /**
         * @brief Apply PWM signals to the motor driver.
         * 
         * @param vel Signed speed value (-255 to 255).
         *            Positive = forward, Negative = reverse. 
         */
        void applyPWM(int vel);

    public:
        // CONSTRUCTOR

        /**
         * @brief Construct a new MotorController object.
         * 
         * @param rpwm Pin for right PWM
         * @param lpwm Pin for left PWM
         * @param enR  Enable pin right (optional, default = 0)
         * @param enL  Enable pin left (optional, default = 0)
         */
        HBridgeController(int rpwm, int lpwm, int enR = 0, int enL = 0);

        // ======= SETUP METHODS =======

        /**
         * @brief Initialize motor pins and set safe initial state.
         * 
         * Configures PWM pins as OUTPUT and enables the H-bridge
         * if enable pins are provided.
         */
        void begin();

        /**
         * @brief Enable or disable acceleration mode.
         * 
         * @param value True to enable acceleration, false for immediate response.
         */
        void enableAcceleration(bool value);

        /**
         * @brief Set acceleration step value.
         * 
         * Defines how fast the motor speed changes.
         * Smaller values = smoother acceleration.
         * 
         * @param step Increment step (e.g., 1–50)
         */
        void setAcceleration(int step);

        // ======= OPERATING METHODS =======

        /**
         * @brief Set motor target speed.
         * 
         * If acceleration is disabled, speed is applied immediately.
         * Otherwise, it will gradually reach the target.
         * 
         * @param vel Speed value (-255 to 255)
         */
        void move(int vel);

        /**
         * @brief Update motor speed (non-blocking).
         * 
         * Must be called repeatedly in the main loop when
         * acceleration is enabled.
         */
        void update();

        /**
         * @brief Stop the motor immediately.
         * 
         * Sets speed to zero and disables movement.
         */
        void stop();

        // ======= INFO METHODS =======

        /**
         * @brief Get current motor speed.
         * 
         * @return int Current speed (-255 to 255)
         */
        int getSpeed();
};

#endif 