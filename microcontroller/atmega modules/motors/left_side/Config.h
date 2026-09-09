// ================= CONFIGURATION CONSTANTS =================

// --- Physical Constants ---
#define CIRCUMFERENCE 1.15
#define PULSES_PER_ROT 6
#define WHEEL_BASE 0.89
#define TRACK_WIDTH 0.85
#define SIDE_LEFT 0
#define SIDE_RIGHT 1
#define SIDE SIDE_LEFT

// --- PID Control Limits ---
#define INTEGRAL_LIMIT 50.0
#define OUTPUT_LIMIT 255
#define ERROR_DEADBAND 0.03
#define PWM_DEADBAND 2
#define MAX_PWM_CHANGE 5

// --- Startup Behavior ---
#define STARTUP_PWM 50
#define STARTUP_TIME 2000