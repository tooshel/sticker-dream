/*
 * Sticker Dream Physical Button
 *
 * This sketch makes an Arduino act as a USB keyboard and sends Ctrl+Enter
 * when a physical button is pressed. It works as a push-to-talk button:
 * - Hold the button down to start recording
 * - Release the button to stop recording
 *
 * Hardware Requirements:
 * - Arduino Leonardo, Micro, or any board with native USB support
 * - A momentary push button
 * - Optional: 10K ohm pull-down resistor (can use INPUT_PULLUP instead)
 *
 * Wiring:
 * - Connect one side of the button to the pin specified in BUTTON_PIN
 * - Connect the other side to GND
 * - The internal pull-up resistor will be enabled (INPUT_PULLUP)
 *
 * Configuration:
 * - Change BUTTON_PIN to match your wiring (default: pin 2)
 * - Adjust DEBOUNCE_DELAY if you experience button bouncing
 */

#include <Keyboard.h>

// Configuration
const int BUTTON_PIN = 4;           // Pin where the button is connected (change as needed)
const int DEBOUNCE_DELAY = 50;      // Debounce time in milliseconds
const int LED_PIN = LED_BUILTIN;    // Use built-in LED to show recording status

// State variables
int lastButtonState = HIGH;         // Previous button state (HIGH = not pressed with pull-up)
int buttonState = HIGH;             // Current button state
unsigned long lastDebounceTime = 0; // Last time the button state changed
bool isRecording = false;           // Track if we're currently "recording"

void setup() {
  // Initialize the button pin with internal pull-up resistor
  // With pull-up: button pressed = LOW, button released = HIGH
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  // Initialize LED pin
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // Initialize Keyboard library
  Keyboard.begin();

  // Optional: Initialize serial for debugging (comment out in production)
  // Serial.begin(9600);
  // Serial.println("Sticker Dream Button Ready!");
}

void loop() {
  // Read the current button state
  int reading = digitalRead(BUTTON_PIN);

  // Check if the button state has changed
  if (reading != lastButtonState) {
    // Reset the debounce timer
    lastDebounceTime = millis();
  }

  // Check if enough time has passed for debouncing
  if ((millis() - lastDebounceTime) > DEBOUNCE_DELAY) {
    // If the button state has changed after debouncing
    if (reading != buttonState) {
      buttonState = reading;

      // Button is pressed (LOW with pull-up resistor)
      if (buttonState == LOW && !isRecording) {
        // Start "recording" - press Ctrl+Enter
        Keyboard.press(KEY_LEFT_CTRL);
        Keyboard.press(KEY_RETURN);
        isRecording = true;
        digitalWrite(LED_PIN, HIGH); // Turn on LED

        // Debug output (uncomment if using Serial)
        // Serial.println("Recording started - Ctrl+Enter pressed");
      }
      // Button is released (HIGH with pull-up resistor)
      else if (buttonState == HIGH && isRecording) {
        // Stop "recording" - release Ctrl+Enter
        Keyboard.releaseAll();
        isRecording = false;
        digitalWrite(LED_PIN, LOW); // Turn off LED

        // Debug output (uncomment if using Serial)
        // Serial.println("Recording stopped - Keys released");
      }
    }
  }

  // Save the current reading for next iteration
  lastButtonState = reading;

  // Small delay to prevent overwhelming the USB connection
  delay(1);
}
