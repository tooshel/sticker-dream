# Arduino Sketches for Sticker Dream

This folder contains Arduino sketches for adding physical hardware controls to the Sticker Dream application.

## sticker_dream_button.ino

A sketch that makes an Arduino act as a USB keyboard and sends Ctrl+Enter when a physical button is pressed. This allows you to use a physical button as a push-to-talk control for the Sticker Dream application.

### Hardware Requirements

- **Arduino Leonardo, Micro, or Pro Micro** (or any Arduino with native USB support like Due, Zero, MKR series)
- A momentary push button (tactile switch)
- Breadboard and jumper wires (optional, for prototyping)

### Wiring

Simple wiring using internal pull-up resistor:

```
Arduino Pin 2 ────┐
                  │
              [Button]
                  │
         GND ─────┘
```

The sketch uses `INPUT_PULLUP`, so no external resistor is needed!

### Configuration

1. **Change the button pin**: Edit `BUTTON_PIN` in the sketch (default is pin 2)
2. **Adjust debounce delay**: If you experience button bouncing, increase `DEBOUNCE_DELAY`

### Installation

1. Open the sketch in the Arduino IDE
2. Select your board: **Tools > Board > Arduino Leonardo** (or your board)
3. Select the correct port: **Tools > Port**
4. Upload the sketch: **Sketch > Upload**

### Usage

1. After uploading, the Arduino will act as a keyboard
2. Open the Sticker Dream web app in your browser
3. Press and hold the physical button to start recording
4. Release the button to stop recording and process the audio
5. The built-in LED will light up while the button is pressed

### Troubleshooting

- **Arduino not recognized**: Make sure you're using a board with native USB support (Leonardo, Micro, etc.)
- **Keys not working**: Check that the Keyboard library is properly initialized
- **Button bouncing**: Increase the `DEBOUNCE_DELAY` value
- **Wrong pin**: Verify your wiring matches the `BUTTON_PIN` setting

### Notes

- The sketch uses `KEY_LEFT_CTRL` and `KEY_RETURN` to send Ctrl+Enter
- The built-in LED shows recording status (on = recording, off = idle)
- Serial debug output is commented out but can be enabled for troubleshooting
- On Mac, Cmd+Enter will also work (macOS treats Ctrl as Cmd in web apps)
