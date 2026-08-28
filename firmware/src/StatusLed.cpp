#include "StatusLed.h"

#include <Arduino.h>
#include <esp32-hal-rgb-led.h>

namespace farmers {
namespace {

// 这类 ESP32-S3 N16R8 双 USB-C 开发板通常把板载 WS2812 数据线接到 GPIO48。
constexpr uint8_t kStatusLedPin = 48;
constexpr uint32_t kStartupEventMs = 1500;
constexpr uint32_t kSuccessEventMs = 800;
constexpr uint32_t kErrorEventMs = 1800;
constexpr uint32_t kTriggerEventMs = 450;
constexpr uint32_t kFlashWriteIndicatorMs = 240;
bool before(uint32_t nowMs, uint32_t deadlineMs) {
  return static_cast<int32_t>(nowMs - deadlineMs) < 0;
}

}  // namespace

void StatusLed::begin() {
  const uint32_t nowMs = millis();
  baseState_ = BaseState::kIdle;
  stateStartedAtMs_ = nowMs;
  event_ = Event::kStartup;
  eventStartedAtMs_ = nowMs;
  eventUntilMs_ = nowMs + kStartupEventMs;
  flashWriteActive_ = false;
  flashWriteSuccessPending_ = false;
  show(0, 0, 0);
}

void StatusLed::setBaseState(BaseState state) {
  if (baseState_ == state) {
    return;
  }
  baseState_ = state;
  stateStartedAtMs_ = millis();
}

void StatusLed::startFlashWrite() {
  flashWriteStartedAtMs_ = millis();
  flashWriteActive_ = true;
  flashWriteSuccessPending_ = false;
  flashWriteUntilMs_ = 0;
}

void StatusLed::finishFlashWrite(bool success) {
  const uint32_t nowMs = millis();
  flashWriteActive_ = false;
  if (!success) {
    flashWriteSuccessPending_ = false;
    notifyError();
    return;
  }
  // 即使 NVS/SPIFFS 写入很快，也保留一小段黄灯时间，让用户看见写入反馈。
  flashWriteSuccessPending_ = true;
  flashWriteUntilMs_ = nowMs + kFlashWriteIndicatorMs;
}

void StatusLed::notifyError() {
  const uint32_t nowMs = millis();
  event_ = Event::kError;
  eventStartedAtMs_ = nowMs;
  eventUntilMs_ = nowMs + kErrorEventMs;
  flashWriteActive_ = false;
  flashWriteSuccessPending_ = false;
}

void StatusLed::notifyTrigger() {
  const uint32_t nowMs = millis();
  if (event_ == Event::kError && before(nowMs, eventUntilMs_)) {
    return;
  }
  event_ = Event::kTrigger;
  eventStartedAtMs_ = nowMs;
  eventUntilMs_ = nowMs + kTriggerEventMs;
}

void StatusLed::setBrightness(uint8_t brightness) {
  brightness_ = brightness;
  lastRed_ = 0xff;
  lastGreen_ = 0xff;
  lastBlue_ = 0xff;
}

uint8_t StatusLed::brightness() const {
  return brightness_;
}

uint8_t StatusLed::scaleChannel(uint8_t channel, uint8_t brightness,
                                uint8_t intensity) {
  return static_cast<uint8_t>((static_cast<uint32_t>(channel) * brightness *
                               intensity + 32512u) /
                              65025u);
}

void StatusLed::show(uint8_t red, uint8_t green, uint8_t blue) {
  if (red == lastRed_ && green == lastGreen_ && blue == lastBlue_) {
    return;
  }
  lastRed_ = red;
  lastGreen_ = green;
  lastBlue_ = blue;
  neopixelWrite(kStatusLedPin, red, green, blue);
}

void StatusLed::showScaled(uint8_t red, uint8_t green, uint8_t blue,
                           uint8_t intensity) {
  show(scaleChannel(red, brightness_, intensity),
       scaleChannel(green, brightness_, intensity),
       scaleChannel(blue, brightness_, intensity));
}

void StatusLed::renderFlashWrite(uint32_t elapsedMs) {
  const uint32_t phase = elapsedMs % 240;
  showScaled(255, 120, 0, phase < 120 ? 255 : 18);
}

void StatusLed::renderEvent(Event event, uint32_t elapsedMs) {
  switch (event) {
    case Event::kStartup:
      showScaled(255, 255, 255, 255);
      return;
    case Event::kSuccess: {
      const uint32_t phase = elapsedMs % 800;
      const bool on = phase < 140 || (phase >= 300 && phase < 440);
      showScaled(0, 255, 40, on ? 230 : 8);
      return;
    }
    case Event::kError: {
      const uint32_t phase = elapsedMs % 1800;
      const bool on = phase < 130 || (phase >= 280 && phase < 410) ||
                      (phase >= 560 && phase < 690);
      showScaled(255, 0, 0, on ? 255 : 5);
      return;
    }
    case Event::kTrigger:
      showScaled(255, 255, 255, elapsedMs < 180 ? 255 : 5);
      return;
    case Event::kNone:
      return;
  }
}

void StatusLed::renderBaseState(uint32_t elapsedMs) {
  switch (baseState_) {
    case BaseState::kIdle:
      showScaled(0, 255, 80, 255);
      return;
    case BaseState::kMacroRunning:
      showScaled(0, 220, 255, 255);
      return;
    case BaseState::kTaskRunning:
      showScaled(180, 40, 255, 255);
      return;
    case BaseState::kUploading: {
      const uint32_t phase = elapsedMs % 900;
      const bool on = phase < 120 || (phase >= 260 && phase < 380);
      showScaled(30, 100, 255, on ? 230 : 8);
      return;
    }
  }
}

void StatusLed::update(uint32_t nowMs) {
  if (event_ != Event::kNone && !before(nowMs, eventUntilMs_)) {
    event_ = Event::kNone;
  }
  if (flashWriteSuccessPending_ && !before(nowMs, flashWriteUntilMs_)) {
    flashWriteSuccessPending_ = false;
    event_ = Event::kSuccess;
    eventStartedAtMs_ = nowMs;
    eventUntilMs_ = nowMs + kSuccessEventMs;
  }

  if (flashWriteActive_ || flashWriteSuccessPending_) {
    renderFlashWrite(static_cast<uint32_t>(nowMs - flashWriteStartedAtMs_));
    return;
  }
  if (event_ != Event::kNone) {
    renderEvent(event_, static_cast<uint32_t>(nowMs - eventStartedAtMs_));
    return;
  }
  renderBaseState(static_cast<uint32_t>(nowMs - stateStartedAtMs_));
}

}  // namespace farmers
