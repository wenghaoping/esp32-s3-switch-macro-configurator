#pragma once

#include <stdint.h>

namespace farmers {

// 板载单颗 WS2812 RGB 灯的非阻塞状态与特效控制器。
class StatusLed {
 public:
  enum class BaseState : uint8_t {
    kIdle,
    kMacroRunning,
    kTaskRunning,
    kUploading,
  };

  void begin();
  void setBaseState(BaseState state);
  void startFlashWrite();
  void finishFlashWrite(bool success);
  void notifyError();
  void notifyTrigger();
  void update(uint32_t nowMs);
  void setBrightness(uint8_t brightness);
  uint8_t brightness() const;

 private:
  enum class Event : uint8_t {
    kNone,
    kStartup,
    kSuccess,
    kError,
    kTrigger,
  };

  static uint8_t scaleChannel(uint8_t channel, uint8_t brightness,
                              uint8_t intensity);
  void show(uint8_t red, uint8_t green, uint8_t blue);
  void showScaled(uint8_t red, uint8_t green, uint8_t blue,
                  uint8_t intensity);
  void renderBaseState(uint32_t elapsedMs);
  void renderEvent(Event event, uint32_t elapsedMs);
  void renderFlashWrite(uint32_t elapsedMs);

  BaseState baseState_ = BaseState::kIdle;
  Event event_ = Event::kNone;
  uint32_t stateStartedAtMs_ = 0;
  uint32_t eventStartedAtMs_ = 0;
  uint32_t eventUntilMs_ = 0;
  uint32_t flashWriteStartedAtMs_ = 0;
  uint32_t flashWriteUntilMs_ = 0;
  bool flashWriteActive_ = false;
  bool flashWriteSuccessPending_ = false;
  uint8_t brightness_ = 10;
  uint8_t lastRed_ = 0xff;
  uint8_t lastGreen_ = 0xff;
  uint8_t lastBlue_ = 0xff;
};

}  // namespace farmers
