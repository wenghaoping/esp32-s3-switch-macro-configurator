const neutral = { buttons: 0, dpad: 15, leftX: 128, leftY: 128, rightX: 128, rightY: 128 };
const step = (durationMs, waitMs, changes = {}) => ({ durationMs, waitMs, ...neutral, ...changes });

// Mirrors firmware/src/BuiltinMacroLibrary.cpp. Directions in the supplied
// screenshots are left-stick directions; RS is the right-stick press.
export const BUILTIN_MACROS = Object.freeze([
  {
    name: "天埠罗巢穴刷武器",
    macro: {
      loopGapMs: 0, repeat: true,
      steps: [
        step(200, 500, { buttons: 1 << 3 }), step(200, 200, { buttons: 1 << 2 }),
        step(200, 200, { buttons: 1 << 2 }), step(200, 200, { buttons: 1 << 2 }),
        step(5000, 4000), step(26000, 20, { buttons: 1 << 7 }),
        step(500, 20, { buttons: (1 << 7) | (1 << 11) }),
        step(8000, 3000, { buttons: 1 << 7 }), step(300, 20, { leftX: 255 }),
        step(5000, 20, { leftY: 0 }), step(1000, 20, { buttons: 1 << 7, leftX: 0 }),
        step(2000, 7000, { leftY: 255 }), step(200, 1000, { buttons: 1 << 2 }),
        step(200, 1000, { buttons: 1 << 2 }), step(200, 1000, { buttons: 1 << 2 }),
        step(200, 1000, { buttons: 1 << 2 }), step(200, 2000, { buttons: 1 << 2 }),
        step(200, 1000, { buttons: 1 << 1 }),
      ],
    },
  },
  {
    name: "杏棱巢穴刷钱",
    macro: {
      loopGapMs: 0, repeat: true,
      steps: [
        step(200, 500, { buttons: 1 << 3 }), step(200, 200, { buttons: 1 << 2 }),
        step(200, 200, { buttons: 1 << 2 }), step(200, 200, { buttons: 1 << 2 }),
        step(5000, 4000), step(1000, 20, { leftX: 255 }), step(15000, 20, { leftY: 0 }),
        step(2000, 20, { buttons: 1 << 7, leftY: 0 }), step(200, 1500, { buttons: 1 << 3 }),
        step(200, 200, { buttons: 1 << 1 }), step(200, 1000, { buttons: 1 << 1 }),
        step(200, 750, { buttons: 1 << 5 }), step(200, 750, { buttons: 1 << 5 }),
        step(1000, 1000, { buttons: 1 << 4 }), step(1000, 200, { buttons: 1 << 7 }),
        step(750, 20, { buttons: 1 << 7, leftX: 0 }), step(1200, 20, { buttons: 1 << 7, leftX: 255 }),
        step(200, 3000, { buttons: 1 << 2 }), step(150, 4000, { leftX: 0 }),
        step(5000, 5000, { leftY: 255 }), step(200, 1000, { buttons: 1 << 2 }),
        step(200, 1000, { buttons: 1 << 2 }), step(200, 1000, { buttons: 1 << 2 }),
        step(200, 1000, { buttons: 1 << 2 }), step(200, 2000, { buttons: 1 << 2 }),
        step(200, 2000, { buttons: 1 << 1 }),
      ],
    },
  },
  {
    name: "武器分解",
    macro: {
      loopGapMs: 0, repeat: true,
      steps: [
        step(200, 500, { buttons: 1 << 3 }), step(200, 200, { leftY: 255 }),
        step(200, 200, { leftY: 255 }), step(200, 200, { leftY: 255 }),
        step(200, 2000, { buttons: 1 << 2 }), step(200, 200, { leftX: 255 }),
        step(200, 2000, { buttons: 1 << 2 }), step(200, 1500, { buttons: 1 << 3 }),
        step(200, 300, { buttons: 1 << 2 }), step(200, 300, { leftX: 255 }),
        step(200, 300, { buttons: 1 << 2 }), step(200, 300, { leftX: 255 }),
        step(200, 300, { buttons: 1 << 2 }), step(200, 300, { leftX: 255 }),
        step(200, 300, { buttons: 1 << 2 }), step(200, 300, { leftY: 255 }),
        step(200, 1500, { buttons: 1 << 2 }), step(200, 1000, { buttons: 1 << 9 }),
        step(200, 200, { leftX: 255 }), step(200, 5000, { buttons: 1 << 2 }),
        step(200, 300, { buttons: 1 << 1 }), step(200, 1000, { buttons: 1 << 1 }),
        step(200, 2000, { buttons: 1 << 1 }),
      ],
    },
  },
  {
    name: "连接手柄",
    macro: { loopGapMs: 0, repeat: true, steps: [step(500, 500, { buttons: 1 << 2 })] },
  },
]);
