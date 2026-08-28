#include <Arduino.h>

#include <Preferences.h>

#include <stdio.h>
#include <string.h>

#include "ControllerReport.h"
#include "BuiltinMacroLibrary.h"
#include "MacroEngine.h"
#include "MacroLibrary.h"
#include "StatusLed.h"
#include "TaskPlan.h"
#include "TaskPlanStorage.h"
#include "UserMacro.h"
#include "switch_ESP32.h"

/*
 * 文件职责：固件总控入口。
 *
 * 硬件拓扑：
 *   ESP32-S3 原生 USB（GPIO19 D-、GPIO20 D+） -> Switch 底座，模拟有线手柄
 *   ESP32-S3 UART0（USB-UART 桥）             -> 浏览器/电脑，接收控制协议
 *
 * 本文件统一处理：串口命令、C++ 内置宏与 Flash 宏的选择、五项任务方案、
 * GPIO 离线触发、状态 JSON，以及最终的 HID 报告发送。原生 USB 专门留给
 * switch_ESP32；控制协议必须走 UART，二者才能同时稳定工作。
 */
#ifndef ATT_CONTROL_SERIAL
#define ATT_CONTROL_SERIAL Serial
#endif

namespace {

constexpr uint32_t kControlBaudRate = 115200;
constexpr char kFirmwareVersion[] = "SplatoonFarmers/2.0.1";
constexpr uint8_t kTriggerCount = 12;
// GPIO trigger targets use 0-11 for macro slots; 12 starts the saved task plan.
constexpr uint8_t kTaskTriggerSlot = farmers::kMacroLibrarySlotCount;
constexpr uint8_t kDefaultStopPin = 10;
constexpr uint32_t kTriggerDebounceMs = 50;
constexpr uint8_t kSafeTriggerPins[] = {
    1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21};
constexpr size_t kSafeTriggerPinCount =
    sizeof(kSafeTriggerPins) / sizeof(kSafeTriggerPins[0]);
constexpr uint32_t kTriggerConfigMagic = 0x53465431u;
#ifndef STATUS_LED_BRIGHTNESS
#define STATUS_LED_BRIGHTNESS 10
#endif

struct TriggerEntry {
  uint8_t pin;
  uint8_t slot;
  bool enabled;
};

struct TriggerConfig {
  uint32_t magic;
  TriggerEntry entries[kTriggerCount];
  uint8_t stopPin;
  uint32_t checksum;
};

// ---------- 全局运行状态 ----------
// 这些对象全部为全局静态存储，避免 ESP32 loopTask 栈承载 512 步宏缓冲区。
NSGamepad Gamepad;
farmers::MacroEngine Macro(nullptr, 0, 0, true);
farmers::MacroLibrary MacroLibrary;
farmers::TaskPlanStorage TaskStore;
farmers::StatusLed StatusLed;
farmers::TaskPlan SavedTaskPlan{};
farmers::TaskPlan StagedTaskPlan{};
bool TaskPlanAvailable = false;
bool TaskUploadActive = false;
bool StagedTaskEntryReceived[farmers::kMaxTaskPlanEntries] = {};
bool TaskActive = false;
bool TaskWaiting = false;
bool TaskWaitingBetweenRuns = false;
uint8_t TaskEntryIndex = 0;
uint16_t TaskIteration = 0;
uint32_t TaskCycle = 0;
uint32_t TaskWaitStartedAtMs = 0;
uint32_t TaskWaitDurationMs = 0;
farmers::UserMacro ActiveMacro{};
farmers::UserMacro StagedMacro{};
farmers::UserMacro ScratchMacro{};
int8_t ActiveMacroSlot = -1;
bool MacroUploadActive = false;
uint8_t StagedMacroSlot = 0;
char ActiveMacroName[farmers::kMacroLibraryNameBytes + 1] = {};
char StagedMacroName[farmers::kMacroLibraryNameBytes + 1] = {};
bool StagedStepReceived[farmers::kMaxUserMacroSteps] = {};
bool ActiveMacroBuiltin = true;
TriggerConfig TriggerSettings{};
TriggerConfig StagedTriggerSettings{};
bool TriggerUploadActive = false;
bool TriggerRawHigh[kTriggerCount] = {};
bool TriggerStableHigh[kTriggerCount] = {};
uint32_t TriggerChangedAtMs[kTriggerCount] = {};
bool StopRawHigh = true;
bool StopStableHigh = true;
uint32_t StopChangedAtMs = 0;
bool TriggerArmed = false;
uint32_t TriggerAllHighSinceMs = 0;
int8_t LastTriggerSlot = -1;
bool PendingMacroStart = false;
uint8_t PendingMacroSlot = 0;
uint8_t PendingMacroTrigger = 255;
uint32_t PendingMacroStartAtMs = 0;

char LineBuffer[128];
size_t LineLength = 0;
bool LineOverflow = false;

void flushMacroReport();
void emitState(const char* type);
void clearTaskExecution(bool stopMacro = true);
bool validateTaskSlots(const farmers::TaskPlan& plan);
bool startTaskPlan();

uint8_t clampAxis(unsigned long value) {
  return value > 255 ? 255 : static_cast<uint8_t>(value);
}

uint8_t normalizeDpad(unsigned long value) {
  if (value <= NSGAMEPAD_DPAD_UP_LEFT ||
      value == NSGAMEPAD_DPAD_CENTERED) {
    return static_cast<uint8_t>(value);
  }
  return NSGAMEPAD_DPAD_CENTERED;
}

bool isValidDpad(unsigned long value) {
  return value <= NSGAMEPAD_DPAD_UP_LEFT ||
         value == NSGAMEPAD_DPAD_CENTERED;
}

void applyReport(const farmers::ControllerReport& report) {
  Gamepad.buttons(report.buttons & 0x3fff);
  Gamepad.dPad(normalizeDpad(report.dpad));
  Gamepad.leftXAxis(report.leftX);
  Gamepad.leftYAxis(report.leftY);
  Gamepad.rightXAxis(report.rightX);
  Gamepad.rightYAxis(report.rightY);
  Gamepad.write();
}

void applyRawReport(unsigned long buttons, unsigned long dpad,
                    unsigned long leftX, unsigned long leftY,
                    unsigned long rightX, unsigned long rightY) {
  const farmers::ControllerReport report{
      static_cast<uint16_t>(buttons & 0x3fff),
      normalizeDpad(dpad),
      clampAxis(leftX),
      clampAxis(leftY),
      clampAxis(rightX),
      clampAxis(rightY),
  };
  applyReport(report);
}

const char* phaseName(farmers::MacroPhase phase) {
  switch (phase) {
    case farmers::MacroPhase::kSteps:
      return "steps";
    case farmers::MacroPhase::kStepWait:
      return "step-wait";
    case farmers::MacroPhase::kLoopGap:
      return "gap";
    default:
      return "idle";
  }
}

// 把槽位 1 内置宏复制为“默认宏”。UserMacro 约 10 KiB，不能用大对象临时赋值，
// 否则 GCC 可能在 loopTask 栈构造临时对象并触发栈保护。
void copyDefaultMacro(farmers::UserMacro* macro) {
  memset(macro, 0, sizeof(*macro));
  const farmers::BuiltinMacroDefinition* definition =
      farmers::builtinMacroForSlot(1);
  if (definition == nullptr) {
    return;
  }
  macro->stepCount = static_cast<uint16_t>(definition->stepCount);
  macro->loopGapMs = definition->loopGapMs;
  macro->repeat = true;
  for (size_t index = 0; index < macro->stepCount; ++index) {
    macro->steps[index] = definition->steps[index];
  }
}

// ---------- 宏来源与槽位选择 ----------
void setMacroName(char* destination, const char* source);

void copyBuiltinMacro(const farmers::BuiltinMacroDefinition& definition,
                      farmers::UserMacro* macro) {
  memset(macro, 0, sizeof(*macro));
  macro->stepCount = static_cast<uint16_t>(definition.stepCount);
  macro->repeat = true;
  macro->loopGapMs = definition.loopGapMs;
  for (size_t index = 0; index < definition.stepCount; ++index) {
    macro->steps[index] = definition.steps[index];
  }
}

bool loadMacroSlot(uint8_t slot, farmers::UserMacro* macro, char* name,
                   bool* builtin) {
  if (slot >= farmers::kMacroLibrarySlotCount || macro == nullptr) {
    return false;
  }
  farmers::MacroSlotInfo info{};
  if (MacroLibrary.load(slot, macro, &info)) {
    if (name != nullptr) {
      setMacroName(name, info.name);
    }
    if (builtin != nullptr) {
      *builtin = false;
    }
    return true;
  }
  const farmers::BuiltinMacroDefinition* definition =
      farmers::builtinMacroForSlot(static_cast<uint8_t>(slot + 1));
  if (definition == nullptr) {
    return false;
  }
  copyBuiltinMacro(*definition, macro);
  if (name != nullptr) {
    setMacroName(name, definition->name);
  }
  if (builtin != nullptr) {
    *builtin = true;
  }
  return true;
}

bool slotAvailable(uint8_t slot) {
  if (slot >= farmers::kMacroLibrarySlotCount) {
    return false;
  }
  return MacroLibrary.slotInfo(slot).occupied ||
         farmers::builtinMacroForSlot(static_cast<uint8_t>(slot + 1)) != nullptr;
}

bool triggerTargetAvailable(uint8_t target) {
  if (target == kTaskTriggerSlot) {
    return TaskPlanAvailable && validateTaskSlots(SavedTaskPlan);
  }
  return slotAvailable(target);
}

const char* slotSource(uint8_t slot) {
  if (slot < farmers::kMacroLibrarySlotCount &&
      MacroLibrary.slotInfo(slot).occupied) {
    return "stored";
  }
  return farmers::builtinMacroForSlot(static_cast<uint8_t>(slot + 1)) != nullptr
             ? "builtin"
             : "empty";
}

uint32_t triggerConfigChecksum(const TriggerConfig& config) {
  // ---------- GPIO 离线触发配置 ----------
  // GPIO 配置与网页 library-manager.js 使用相同字段顺序计算校验和。
  uint32_t checksum = farmers::kUserMacroChecksumOffset;
  checksum = farmers::macroChecksumUint32(checksum, config.magic);
  for (const TriggerEntry& entry : config.entries) {
    checksum = farmers::macroChecksumByte(checksum, entry.pin);
    checksum = farmers::macroChecksumByte(checksum, entry.slot);
    checksum = farmers::macroChecksumByte(checksum, entry.enabled ? 1 : 0);
  }
  checksum = farmers::macroChecksumByte(checksum, config.stopPin);
  return checksum;
}

bool isSafeTriggerPin(uint8_t pin) {
  for (uint8_t candidate : kSafeTriggerPins) {
    if (candidate == pin) {
      return true;
    }
  }
  return false;
}

bool validateTriggerConfig(const TriggerConfig& config) {
  if (config.magic != kTriggerConfigMagic ||
      !isSafeTriggerPin(config.stopPin) ||
      config.checksum != triggerConfigChecksum(config)) {
    return false;
  }
  for (size_t index = 0; index < kTriggerCount; ++index) {
    const TriggerEntry& entry = config.entries[index];
    if (!isSafeTriggerPin(entry.pin) || entry.slot > kTaskTriggerSlot ||
        (entry.enabled && !triggerTargetAvailable(entry.slot))) {
      return false;
    }
    if (entry.enabled && entry.pin == config.stopPin) {
      return false;
    }
    for (size_t other = 0; other < index; ++other) {
      if (entry.enabled && config.entries[other].enabled &&
          entry.pin == config.entries[other].pin) {
        return false;
      }
    }
  }
  return true;
}

void defaultTriggerConfig() {
  // 默认将前 4 个 GPIO 绑定到 4 个内置槽位，其余条目禁用但仍保留位置，
  // 这样网页可用一次事务上传完整 12 项配置。
  TriggerSettings = {};
  TriggerSettings.magic = kTriggerConfigMagic;
  const uint8_t defaults[kTriggerCount] = {1, 2, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14};
  for (size_t index = 0; index < kTriggerCount; ++index) {
    TriggerSettings.entries[index] = {
        defaults[index], static_cast<uint8_t>(index),
        index < farmers::kBuiltinMacroCount};
  }
  TriggerSettings.stopPin = kDefaultStopPin;
  TriggerSettings.checksum = triggerConfigChecksum(TriggerSettings);
}

void loadTriggerConfig() {
  // GPIO 配置放在 Preferences/NVS；损坏、旧版本或非法配置会回退默认值。
  Preferences preferences;
  defaultTriggerConfig();
  if (!preferences.begin("sftrigger", false)) {
    return;
  }
  TriggerConfig stored{};
  const size_t expected = preferences.getBytesLength("config");
  if (expected == sizeof(stored) &&
      preferences.getBytes("config", &stored, sizeof(stored)) == sizeof(stored) &&
      validateTriggerConfig(stored)) {
    TriggerSettings = stored;
  }
  preferences.end();
}

bool saveTriggerConfig() {
  TriggerSettings.magic = kTriggerConfigMagic;
  TriggerSettings.checksum = triggerConfigChecksum(TriggerSettings);
  if (!validateTriggerConfig(TriggerSettings)) {
    return false;
  }
  StatusLed.startFlashWrite();
  Preferences preferences;
  if (!preferences.begin("sftrigger", false)) {
    StatusLed.finishFlashWrite(false);
    return false;
  }
  const size_t written =
      preferences.putBytes("config", &TriggerSettings, sizeof(TriggerSettings));
  preferences.end();
  const bool success = written == sizeof(TriggerSettings);
  StatusLed.finishFlashWrite(success);
  return success;
}

void setupTriggerPins() {
  // 触发输入采用上拉：按下/短接到 GND 时读到 LOW。
  const uint32_t nowMs = millis();
  for (size_t index = 0; index < kTriggerCount; ++index) {
    pinMode(TriggerSettings.entries[index].pin, INPUT_PULLUP);
    const bool high = digitalRead(TriggerSettings.entries[index].pin) == HIGH;
    TriggerRawHigh[index] = high;
    TriggerStableHigh[index] = high;
    TriggerChangedAtMs[index] = nowMs;
  }
  pinMode(TriggerSettings.stopPin, INPUT_PULLUP);
  StopRawHigh = digitalRead(TriggerSettings.stopPin) == HIGH;
  StopStableHigh = StopRawHigh;
  StopChangedAtMs = nowMs;
  TriggerArmed = false;
  TriggerAllHighSinceMs = nowMs;
}

void setMacroName(char* destination, const char* source) {
  if (source == nullptr) {
    destination[0] = '\0';
    return;
  }
  strncpy(destination, source, farmers::kMacroLibraryNameBytes);
  destination[farmers::kMacroLibraryNameBytes] = '\0';
}

void configureActiveMacro() {
  Macro.configure(ActiveMacro.steps, ActiveMacro.stepCount,
                  ActiveMacro.loopGapMs, ActiveMacro.repeat);
}

void loadActiveMacro() {
  ActiveMacroSlot = -1;
  ActiveMacroBuiltin = true;
  setMacroName(ActiveMacroName, "天埠罗巢穴刷武器");

  const bool libraryReady = MacroLibrary.begin();
  if (libraryReady && MacroLibrary.activeSlot() >= 0) {
    farmers::MacroSlotInfo info{};
    const uint8_t slot = static_cast<uint8_t>(MacroLibrary.activeSlot());
    if (MacroLibrary.load(slot, &ActiveMacro, &info)) {
      ActiveMacroSlot = static_cast<int8_t>(slot);
      setMacroName(ActiveMacroName, info.name);
      ActiveMacroBuiltin = false;
      configureActiveMacro();
      return;
    }
  }

  if (!loadMacroSlot(0, &ActiveMacro, ActiveMacroName,
                     &ActiveMacroBuiltin)) {
    copyDefaultMacro(&ActiveMacro);
  }
  ActiveMacroSlot = 0;
  configureActiveMacro();
}

const char* activeMacroSource() {
  if (ActiveMacroSlot >= 0) {
    return ActiveMacroBuiltin ? "builtin" : "stored";
  }
  return "default";
}

void emitJsonString(const char* value) {
  // ---------- 串口 JSON 输出 ----------
  // 手工转义 UTF-8 字节串，避免宏名中的引号、换行破坏一行一条的 JSON 协议。
  ATT_CONTROL_SERIAL.print('"');
  for (const unsigned char* character =
           reinterpret_cast<const unsigned char*>(value == nullptr ? "" : value);
       *character != '\0'; ++character) {
    switch (*character) {
      case '"':
        ATT_CONTROL_SERIAL.print("\\\"");
        break;
      case '\\':
        ATT_CONTROL_SERIAL.print("\\\\");
        break;
      case '\b':
        ATT_CONTROL_SERIAL.print("\\b");
        break;
      case '\f':
        ATT_CONTROL_SERIAL.print("\\f");
        break;
      case '\n':
        ATT_CONTROL_SERIAL.print("\\n");
        break;
      case '\r':
        ATT_CONTROL_SERIAL.print("\\r");
        break;
      case '\t':
        ATT_CONTROL_SERIAL.print("\\t");
        break;
      default:
        if (*character < 0x20) {
          ATT_CONTROL_SERIAL.printf("\\u%04x", *character);
        } else {
          ATT_CONTROL_SERIAL.write(*character);
        }
    }
  }
  ATT_CONTROL_SERIAL.print('"');
}

void emitError(const char* message) {
  StatusLed.notifyError();
  ATT_CONTROL_SERIAL.printf(
      "{\"type\":\"error\",\"ok\":false,\"message\":\"%s\"}\n",
      message);
}

void updateStatusLed(uint32_t nowMs) {
  farmers::StatusLed::BaseState state =
      farmers::StatusLed::BaseState::kIdle;
  if (MacroUploadActive || TaskUploadActive || TriggerUploadActive) {
    state = farmers::StatusLed::BaseState::kUploading;
  } else if (TaskActive) {
    state = farmers::StatusLed::BaseState::kTaskRunning;
  } else if (Macro.running()) {
    state = farmers::StatusLed::BaseState::kMacroRunning;
  }
  StatusLed.setBaseState(state);
  StatusLed.update(nowMs);
}

void emitState(const char* type) {
  // 统一输出 INFO/STATUS；网页靠它刷新运行进度、当前步骤和任务状态。
  const uint32_t nowMs = millis();
  const size_t visibleStep =
      (Macro.phase() == farmers::MacroPhase::kSteps ||
       Macro.phase() == farmers::MacroPhase::kStepWait)
          ? Macro.stepIndex() + 1
          : 0;
  const uint32_t durationMs = farmers::userMacroDurationMs(ActiveMacro);
  const uint32_t cycleMs = durationMs + ActiveMacro.loopGapMs;
  const farmers::MacroStep* currentStep =
      visibleStep > 0 && Macro.stepIndex() < ActiveMacro.stepCount
          ? &ActiveMacro.steps[Macro.stepIndex()]
          : nullptr;
  const farmers::ControllerReport currentAction =
      currentStep == nullptr ? farmers::kNeutralReport : currentStep->report;
  ATT_CONTROL_SERIAL.printf(
      "{\"type\":\"%s\",\"ok\":true,\"firmware\":\"%s\","
      "\"routine\":\"material-farm\",\"source\":\"%s\",\"state\":\"%s\","
      "\"phase\":\"%s\",\"step\":%u,\"steps\":%u,\"cycle\":%lu,"
      "\"duration_ms\":%lu,\"loop_gap_ms\":%lu,\"cycle_ms\":%lu,"
      "\"current_buttons\":%u,\"current_dpad\":%u,"
      "\"current_left_x\":%u,\"current_left_y\":%u,"
      "\"current_right_x\":%u,\"current_right_y\":%u,"
      "\"current_hold_ms\":%lu,\"current_wait_ms\":%lu,"
      "\"current_phase_elapsed_ms\":%lu,"
      "\"current_phase_remaining_ms\":%lu,"
      "\"repeat\":%s,\"slot\":%d,\"active_slot\":%d,"
      "\"running_slot\":%d,\"last_trigger\":%d,"
      "\"trigger_state\":\"%s\",\"stop_pin\":%u,\"name\":",
      type, kFirmwareVersion, activeMacroSource(),
      (Macro.running() || TaskActive) ? "running" : "idle",
      phaseName(Macro.phase()), static_cast<unsigned int>(visibleStep),
      static_cast<unsigned int>(ActiveMacro.stepCount),
      static_cast<unsigned long>(Macro.cycleCount()),
      static_cast<unsigned long>(durationMs),
      static_cast<unsigned long>(ActiveMacro.loopGapMs),
      static_cast<unsigned long>(cycleMs),
      static_cast<unsigned int>(currentAction.buttons),
      static_cast<unsigned int>(currentAction.dpad),
      static_cast<unsigned int>(currentAction.leftX),
      static_cast<unsigned int>(currentAction.leftY),
      static_cast<unsigned int>(currentAction.rightX),
      static_cast<unsigned int>(currentAction.rightY),
      static_cast<unsigned long>(currentStep == nullptr ? 0
                                                        : currentStep->durationMs),
      static_cast<unsigned long>(currentStep == nullptr ? 0
                                                        : currentStep->waitMs),
      static_cast<unsigned long>(Macro.phaseElapsedMs(nowMs)),
      static_cast<unsigned long>(Macro.phaseRemainingMs(nowMs)),
      ActiveMacro.repeat ? "true" : "false",
      static_cast<int>(ActiveMacroSlot),
      static_cast<int>(ActiveMacroSlot),
      (Macro.running() || TaskActive)
          ? static_cast<int>(ActiveMacroSlot)
          : -1,
      static_cast<int>(LastTriggerSlot),
      TriggerArmed ? "armed" : "initializing",
      static_cast<unsigned int>(TriggerSettings.stopPin));
  emitJsonString(ActiveMacroName);
  const farmers::TaskPlanEntry* taskEntry =
      TaskActive && TaskEntryIndex < SavedTaskPlan.entryCount
          ? &SavedTaskPlan.entries[TaskEntryIndex]
          : nullptr;
  const int nextEntry =
      TaskActive && TaskEntryIndex + 1 < SavedTaskPlan.entryCount
          ? static_cast<int>(TaskEntryIndex + 1)
          : (TaskActive && SavedTaskPlan.repeat ? 0 : -1);
  const int nextSlot = nextEntry >= 0 ? SavedTaskPlan.entries[nextEntry].slot : -1;
  const uint32_t taskWaitElapsed =
      TaskWaiting ? static_cast<uint32_t>(nowMs - TaskWaitStartedAtMs) : 0;
  const uint32_t taskWaitRemaining =
      TaskWaiting && taskWaitElapsed < TaskWaitDurationMs
          ? TaskWaitDurationMs - taskWaitElapsed
          : 0;
  ATT_CONTROL_SERIAL.printf(
      ",\"task_active\":%s,\"task_entry\":%u,\"task_entries\":%u,"
      "\"task_iteration\":%u,\"task_target_iterations\":%u,"
      "\"task_cycle\":%lu,\"task_repeat\":%s,\"task_waiting\":%s,"
      "\"task_wait_remaining_ms\":%lu,\"next_slot\":%d,\"task_name\":",
      TaskActive ? "true" : "false",
      TaskActive ? static_cast<unsigned int>(TaskEntryIndex + 1) : 0,
      static_cast<unsigned int>(TaskPlanAvailable ? SavedTaskPlan.entryCount : 0),
      TaskActive ? static_cast<unsigned int>(TaskIteration + 1) : 0,
      taskEntry ? static_cast<unsigned int>(taskEntry->repeatCount) : 0,
      static_cast<unsigned long>(TaskCycle),
      TaskPlanAvailable && SavedTaskPlan.repeat ? "true" : "false",
      TaskWaiting ? "true" : "false",
      static_cast<unsigned long>(taskWaitRemaining),
      nextSlot);
  emitJsonString(TaskPlanAvailable ? SavedTaskPlan.name : "");
  ATT_CONTROL_SERIAL.print(",\"running_name\":");
  emitJsonString((Macro.running() || TaskActive) ? ActiveMacroName : "");
  ATT_CONTROL_SERIAL.print(",\"running_source\":");
  emitJsonString((Macro.running() || TaskActive)
                     ? activeMacroSource()
                     : "empty");
  ATT_CONTROL_SERIAL.print(",\"next_name\":");
  if (nextSlot >= 0) {
    const farmers::MacroSlotInfo& info = MacroLibrary.slotInfo(nextSlot);
    const farmers::BuiltinMacroDefinition* builtin =
        farmers::builtinMacroForSlot(static_cast<uint8_t>(nextSlot + 1));
    emitJsonString(info.occupied ? info.name : (builtin ? builtin->name : ""));
  } else {
    emitJsonString("");
  }
  ATT_CONTROL_SERIAL.println("}");
}

void emitMacro() {
  // 返回当前已选宏的全部步骤。512 步宏的 JSON 很长，运行中禁止调用它。
  ATT_CONTROL_SERIAL.printf(
      "{\"type\":\"macro\",\"ok\":true,\"source\":\"%s\","
      "\"slot\":%d,\"name\":",
      activeMacroSource(), static_cast<int>(ActiveMacroSlot));
  emitJsonString(ActiveMacroName);
  ATT_CONTROL_SERIAL.print(",\"steps\":[");
  for (size_t index = 0; index < ActiveMacro.stepCount; ++index) {
    const farmers::MacroStep& step = ActiveMacro.steps[index];
    if (index > 0) {
      ATT_CONTROL_SERIAL.print(',');
    }
    ATT_CONTROL_SERIAL.printf(
        "{\"duration_ms\":%lu,\"wait_ms\":%lu,\"buttons\":%u,\"dpad\":%u,"
        "\"left_x\":%u,\"left_y\":%u,\"right_x\":%u,\"right_y\":%u}",
        static_cast<unsigned long>(step.durationMs),
        static_cast<unsigned long>(step.waitMs), step.report.buttons,
        step.report.dpad, step.report.leftX, step.report.leftY,
        step.report.rightX, step.report.rightY);
  }
  ATT_CONTROL_SERIAL.printf(
      "],\"loop_gap_ms\":%lu,\"repeat\":%s,\"checksum\":%lu}",
      static_cast<unsigned long>(ActiveMacro.loopGapMs),
      ActiveMacro.repeat ? "true" : "false",
      static_cast<unsigned long>(farmers::userMacroChecksum(ActiveMacro)));
  ATT_CONTROL_SERIAL.println();
}

void emitMacroList() {
  // 返回十二个槽位摘要。Flash 保存版本优先显示，否则显示 C++ 内置版本。
  ATT_CONTROL_SERIAL.printf(
      "{\"type\":\"macro_list\",\"ok\":true,\"active_slot\":%d,"
      "\"slots\":[",
      static_cast<int>(ActiveMacroSlot));
  for (uint8_t slot = 0; slot < farmers::kMacroLibrarySlotCount; ++slot) {
    if (slot > 0) {
      ATT_CONTROL_SERIAL.print(',');
    }
    const farmers::MacroSlotInfo& info = MacroLibrary.slotInfo(slot);
    const farmers::BuiltinMacroDefinition* builtin =
        farmers::builtinMacroForSlot(static_cast<uint8_t>(slot + 1));
    const bool occupied = info.occupied || builtin != nullptr;
    ATT_CONTROL_SERIAL.printf("{\"slot\":%u,\"occupied\":%s,\"source\":",
                              static_cast<unsigned int>(slot),
                              occupied ? "true" : "false");
    emitJsonString(slotSource(slot));
    ATT_CONTROL_SERIAL.printf(",\"has_builtin\":%s,\"has_stored\":%s",
                              builtin != nullptr ? "true" : "false",
                              info.occupied ? "true" : "false");
    if (occupied) {
      ATT_CONTROL_SERIAL.print(",\"name\":");
      if (info.occupied) {
        emitJsonString(info.name);
      } else {
        emitJsonString(builtin->name);
      }
      const uint16_t steps = info.occupied
                                 ? info.stepCount
                                 : static_cast<uint16_t>(builtin->stepCount);
      const uint32_t duration = info.occupied
                                    ? info.durationMs
                                    : [&]() {
                                        uint32_t total = 0;
                                        for (size_t i = 0; i < builtin->stepCount; ++i) {
                                          total += builtin->steps[i].durationMs +
                                                   builtin->steps[i].waitMs;
                                        }
                                        return total;
                                      }();
      ATT_CONTROL_SERIAL.printf(
          ",\"steps\":%u,\"duration_ms\":%lu,\"loop_gap_ms\":%lu,"
          "\"repeat\":%s",
          static_cast<unsigned int>(steps), static_cast<unsigned long>(duration),
          static_cast<unsigned long>(info.occupied ? info.loopGapMs : 0),
          info.occupied ? (info.repeat ? "true" : "false") : "true");
    }
    ATT_CONTROL_SERIAL.print('}');
  }
  ATT_CONTROL_SERIAL.println("]}");
}

bool activateMacroSlot(uint8_t slot, uint8_t trigger) {
  // ---------- 单宏启动 ----------
  // 真正启动前先把目标宏复制进 ActiveMacro，确保 Flash 与内置宏走同一引擎。
  if (!slotAvailable(slot)) {
    emitError("macro-slot-empty");
    return false;
  }
  if (!loadMacroSlot(slot, &ScratchMacro, ActiveMacroName,
                     &ActiveMacroBuiltin)) {
    emitError("macro-slot-load-failed");
    return false;
  }
  ActiveMacro = ScratchMacro;
  ActiveMacroSlot = static_cast<int8_t>(slot);
  if (!ActiveMacroBuiltin &&
      !MacroLibrary.setActive(static_cast<int8_t>(slot))) {
    emitError("macro-select-failed");
    return false;
  }
  if (ActiveMacroBuiltin && !MacroLibrary.setActive(-1)) {
    emitError("macro-select-failed");
    return false;
  }
  LastTriggerSlot = trigger == 255 ? LastTriggerSlot : static_cast<int8_t>(slot);
  Macro.configure(ActiveMacro.steps, ActiveMacro.stepCount,
                  ActiveMacro.loopGapMs, true);
  Macro.start(millis());
  StatusLed.notifyTrigger();
  flushMacroReport();
  emitState("status");
  return true;
}

bool startMacroSlot(uint8_t slot, uint8_t trigger = 255) {
  if (!slotAvailable(slot)) {
    emitError("macro-slot-empty");
    return false;
  }
  const bool wasRunning = Macro.running() || TaskActive;
  clearTaskExecution(false);
  Macro.stop();
  flushMacroReport();
  // 启动新宏会替换任何尚未提交的网页上传，避免旧草稿在停止后继续提交。
  MacroUploadActive = false;
  PendingMacroStart = false;
  if (wasRunning) {
    PendingMacroStart = true;
    PendingMacroSlot = slot;
    PendingMacroTrigger = trigger;
    PendingMacroStartAtMs = millis();
    emitState("status");
    return true;
  }
  return activateMacroSlot(slot, trigger);
}

void emitTriggerConfig() {
  ATT_CONTROL_SERIAL.printf("{\"type\":\"trigger_config\",\"ok\":true,\"stop_pin\":%u,\"entries\":[",
                            static_cast<unsigned int>(TriggerSettings.stopPin));
  for (size_t index = 0; index < kTriggerCount; ++index) {
    if (index > 0) ATT_CONTROL_SERIAL.print(',');
    const TriggerEntry& entry = TriggerSettings.entries[index];
    ATT_CONTROL_SERIAL.printf("{\"index\":%u,\"pin\":%u,\"slot\":%u,\"action\":\"%s\",\"enabled\":%s}",
                              static_cast<unsigned int>(index),
                              static_cast<unsigned int>(entry.pin),
                              static_cast<unsigned int>(entry.slot),
                              entry.slot == kTaskTriggerSlot ? "task" : "macro",
                              entry.enabled ? "true" : "false");
  }
  ATT_CONTROL_SERIAL.println("]}");
}

bool handleTriggerCommand(char* line) {
  // GPIO 配置采用 BEGIN -> 多条 ENTRY/STOP_PIN -> COMMIT 校验的事务协议；
  // 提交失败时不会覆盖当前正在使用的配置。
  if (strcmp(line, "TRIGGER_GET") == 0) {
    emitTriggerConfig();
    return true;
  }
  if (strcmp(line, "TRIGGER_DEFAULT") == 0) {
    const TriggerConfig previous = TriggerSettings;
    defaultTriggerConfig();
    if (!saveTriggerConfig()) {
      TriggerSettings = previous;
      emitError("trigger-save-failed");
    } else {
      setupTriggerPins();
      emitTriggerConfig();
    }
    return true;
  }
  char command[20] = {};
  unsigned long first = 0, second = 0, third = 0, fourth = 0;
  const int parsed = sscanf(line, "%19s %lu %lu %lu %lu", command, &first,
                            &second, &third, &fourth);
  if (strcmp(command, "TRIGGER_BEGIN") == 0 && parsed == 2 &&
      first == kTriggerCount) {
    StagedTriggerSettings = TriggerSettings;
    TriggerUploadActive = true;
    ATT_CONTROL_SERIAL.println("OK");
    return true;
  }
  if (strcmp(command, "TRIGGER_COMMIT") == 0 && parsed == 2 &&
      TriggerUploadActive) {
    StagedTriggerSettings.magic = kTriggerConfigMagic;
    StagedTriggerSettings.checksum =
        triggerConfigChecksum(StagedTriggerSettings);
    if (first != StagedTriggerSettings.checksum ||
        !validateTriggerConfig(StagedTriggerSettings)) {
      emitError("trigger-checksum-invalid");
    } else {
      const TriggerConfig previous = TriggerSettings;
      TriggerSettings = StagedTriggerSettings;
      if (!saveTriggerConfig()) {
        TriggerSettings = previous;
        emitError("trigger-save-failed");
      } else {
        setupTriggerPins();
        emitTriggerConfig();
      }
    }
    TriggerUploadActive = false;
    return true;
  }
  if (strcmp(command, "TRIGGER_STOP_PIN") == 0 && parsed == 2 && isSafeTriggerPin(first)) {
    if (TriggerUploadActive) {
      StagedTriggerSettings.stopPin = static_cast<uint8_t>(first);
      ATT_CONTROL_SERIAL.println("OK");
      return true;
    }
    if (first == TriggerSettings.stopPin) {
      emitError("trigger-stop-pin-unchanged");
      return true;
    }
    for (const TriggerEntry& entry : TriggerSettings.entries) {
      if (entry.enabled && entry.pin == first) {
        emitError("trigger-pin-conflict");
        return true;
      }
    }
    const TriggerConfig previous = TriggerSettings;
    TriggerSettings.stopPin = static_cast<uint8_t>(first);
    if (!saveTriggerConfig()) {
      TriggerSettings = previous;
      emitError("trigger-save-failed");
    } else {
      setupTriggerPins();
      emitTriggerConfig();
    }
    return true;
  }
  if (strcmp(command, "TRIGGER_ENTRY") == 0 && parsed == 5 &&
      first < kTriggerCount && second <= 1 && isSafeTriggerPin(third) &&
      fourth <= kTaskTriggerSlot) {
    TriggerEntry candidate{static_cast<uint8_t>(third),
                           static_cast<uint8_t>(fourth), second == 1};
    if (TriggerUploadActive) {
      StagedTriggerSettings.entries[first] = candidate;
      ATT_CONTROL_SERIAL.println("OK");
      return true;
    }
    const TriggerConfig previous = TriggerSettings;
    TriggerSettings.entries[first] = candidate;
    TriggerSettings.checksum = triggerConfigChecksum(TriggerSettings);
    if (!validateTriggerConfig(TriggerSettings)) {
      TriggerSettings = previous;
      emitError("trigger-config-invalid");
    } else if (!saveTriggerConfig()) {
      TriggerSettings = previous;
      emitError("trigger-save-failed");
    } else {
      setupTriggerPins();
      emitTriggerConfig();
    }
    return true;
  }
  return false;
}

void flushMacroReport() {
  // ---------- 网页宏上传与任务方案 ----------
  // 只有宏引擎标记报告变化时才写 HID，减少重复 USB 报告。
  if (Macro.consumeReportChanged()) {
    applyReport(Macro.report());
  }
}

void beginMacroUpload(unsigned long slot, unsigned long stepCount,
                      unsigned long loopGapMs, unsigned long repeat) {
  if (!MacroLibrary.available() || slot >= farmers::kMacroLibrarySlotCount ||
      stepCount == 0 || stepCount > farmers::kMaxUserMacroSteps ||
      loopGapMs > farmers::kMaxUserMacroLoopGapMs || repeat > 1) {
    emitError("macro-begin-invalid");
    return;
  }

  Macro.stop();
  flushMacroReport();
      memset(&StagedMacro, 0, sizeof(StagedMacro));
  StagedMacro.stepCount = static_cast<uint16_t>(stepCount);
  StagedMacro.loopGapMs = static_cast<uint32_t>(loopGapMs);
  StagedMacro.repeat = repeat == 1;
  StagedMacroSlot = static_cast<uint8_t>(slot);
  StagedMacroName[0] = '\0';
  memset(StagedStepReceived, 0, sizeof(StagedStepReceived));
  MacroUploadActive = true;
  ATT_CONTROL_SERIAL.println("OK");
}

bool hexDigit(char character, uint8_t* value) {
  if (character >= '0' && character <= '9') {
    *value = static_cast<uint8_t>(character - '0');
    return true;
  }
  if (character >= 'a' && character <= 'f') {
    *value = static_cast<uint8_t>(character - 'a' + 10);
    return true;
  }
  if (character >= 'A' && character <= 'F') {
    *value = static_cast<uint8_t>(character - 'A' + 10);
    return true;
  }
  return false;
}

bool decodeMacroName(const char* encoded, char* decoded) {
  // 宏名经过网页 encodeURIComponent 编码；这里解码并限制到固定 UTF-8 字节缓冲。
  if (encoded == nullptr || encoded[0] == '\0') {
    return false;
  }
  size_t output = 0;
  for (size_t input = 0; encoded[input] != '\0'; ++input) {
    unsigned char value = static_cast<unsigned char>(encoded[input]);
    if (value == '%') {
      uint8_t high = 0;
      uint8_t low = 0;
      if (encoded[input + 1] == '\0' || encoded[input + 2] == '\0' ||
          !hexDigit(encoded[input + 1], &high) ||
          !hexDigit(encoded[input + 2], &low)) {
        return false;
      }
      value = static_cast<uint8_t>((high << 4) | low);
      input += 2;
    }
    if (value < 0x20 || output >= farmers::kMacroLibraryNameBytes) {
      return false;
    }
    decoded[output++] = static_cast<char>(value);
  }
  decoded[output] = '\0';
  return output > 0;
}

bool validateTaskSlots(const farmers::TaskPlan& plan) {
  // TaskPlan.h 只检查数值范围；这里补充检查每个引用槽位当前确实可运行。
  if (!farmers::isTaskPlanStructValid(plan)) {
    return false;
  }
  for (size_t index = 0; index < plan.entryCount; ++index) {
    if (!slotAvailable(plan.entries[index].slot)) {
      return false;
    }
  }
  return true;
}

void emitTaskPlan() {
  ATT_CONTROL_SERIAL.print(
      "{\"type\":\"task_plan\",\"ok\":true,\"available\":");
  ATT_CONTROL_SERIAL.print(TaskPlanAvailable ? "true" : "false");
  if (TaskPlanAvailable) {
    ATT_CONTROL_SERIAL.print(",\"name\":");
    emitJsonString(SavedTaskPlan.name);
    ATT_CONTROL_SERIAL.printf(",\"repeat\":%s,\"entries\":[",
                              SavedTaskPlan.repeat ? "true" : "false");
    for (size_t index = 0; index < SavedTaskPlan.entryCount; ++index) {
      if (index > 0) {
        ATT_CONTROL_SERIAL.print(',');
      }
      const farmers::TaskPlanEntry& entry = SavedTaskPlan.entries[index];
      ATT_CONTROL_SERIAL.printf(
          "{\"index\":%u,\"slot\":%u,\"repeat_count\":%u,\"gap_ms\":%lu}",
          static_cast<unsigned int>(index),
          static_cast<unsigned int>(entry.slot),
          static_cast<unsigned int>(entry.repeatCount),
          static_cast<unsigned long>(entry.gapMs));
    }
    ATT_CONTROL_SERIAL.print(']');
  }
  ATT_CONTROL_SERIAL.println("}");
}

void clearTaskExecution(bool stopMacro) {
  // 终止任务运行态，不会删除已保存的任务方案本身。
  TaskActive = false;
  TaskWaiting = false;
  TaskWaitingBetweenRuns = false;
  TaskEntryIndex = 0;
  TaskIteration = 0;
  TaskWaitStartedAtMs = 0;
  TaskWaitDurationMs = 0;
  if (stopMacro) {
    Macro.stop();
    flushMacroReport();
  }
}

bool startCurrentTaskEntry(uint32_t nowMs) {
  // 任务中的每一次运行都把宏配置为“不循环”；重复次数由任务方案控制。
  if (!TaskActive || TaskEntryIndex >= SavedTaskPlan.entryCount) {
    return false;
  }
  const uint8_t slot = SavedTaskPlan.entries[TaskEntryIndex].slot;
  if (!loadMacroSlot(slot, &ScratchMacro, ActiveMacroName,
                     &ActiveMacroBuiltin)) {
    clearTaskExecution();
    emitError("task-slot-load-failed");
    return false;
  }
  ActiveMacro = ScratchMacro;
  ActiveMacro.repeat = false;
  ActiveMacroSlot = static_cast<int8_t>(slot);
  if (!ActiveMacroBuiltin) {
    MacroLibrary.setActive(static_cast<int8_t>(slot));
  } else {
    MacroLibrary.setActive(-1);
  }
  if (!Macro.configure(ActiveMacro.steps, ActiveMacro.stepCount, 0, false)) {
    clearTaskExecution();
    emitError("task-macro-invalid");
    return false;
  }
  TaskWaiting = false;
  TaskWaitingBetweenRuns = false;
  Macro.start(nowMs);
  flushMacroReport();
  emitState("status");
  return true;
}

void beginTaskWait(uint32_t nowMs, uint32_t durationMs, bool betweenRuns) {
  TaskWaiting = durationMs > 0;
  TaskWaitingBetweenRuns = betweenRuns;
  TaskWaitStartedAtMs = nowMs;
  TaskWaitDurationMs = durationMs;
}

void advanceTaskEntry(uint32_t nowMs) {
  ++TaskEntryIndex;
  TaskIteration = 0;
  if (TaskEntryIndex >= SavedTaskPlan.entryCount) {
    ++TaskCycle;
    if (!SavedTaskPlan.repeat) {
      clearTaskExecution(false);
      configureActiveMacro();
      Macro.consumeReportChanged();
      emitState("status");
      return;
    }
    TaskEntryIndex = 0;
  }
  startCurrentTaskEntry(nowMs);
}

void finishTaskMacroRun(uint32_t nowMs) {
  if (!TaskActive || TaskEntryIndex >= SavedTaskPlan.entryCount) {
    return;
  }
  const farmers::TaskPlanEntry& entry = SavedTaskPlan.entries[TaskEntryIndex];
  ++TaskIteration;
  if (TaskIteration < entry.repeatCount) {
    if (ActiveMacro.loopGapMs > 0) {
      beginTaskWait(nowMs, ActiveMacro.loopGapMs, true);
      emitState("status");
    } else {
      startCurrentTaskEntry(nowMs);
    }
    return;
  }
  if (entry.gapMs > 0) {
    beginTaskWait(nowMs, entry.gapMs, false);
    emitState("status");
  } else {
    advanceTaskEntry(nowMs);
  }
}

void pollTaskExecution(uint32_t nowMs) {
  // 宏引擎结束一轮后，在这里决定继续同一项、等待，或推进到下一任务项。
  if (!TaskActive || Macro.running()) {
    return;
  }
  if (!TaskWaiting) {
    finishTaskMacroRun(nowMs);
    return;
  }
  if (static_cast<uint32_t>(nowMs - TaskWaitStartedAtMs) <
      TaskWaitDurationMs) {
    return;
  }
  const bool betweenRuns = TaskWaitingBetweenRuns;
  TaskWaiting = false;
  TaskWaitingBetweenRuns = false;
  if (betweenRuns) {
    startCurrentTaskEntry(nowMs);
  } else {
    advanceTaskEntry(nowMs);
  }
}

bool startTaskPlan() {
  if (!TaskPlanAvailable || !validateTaskSlots(SavedTaskPlan)) {
    emitError("task-plan-invalid");
    return false;
  }
  PendingMacroStart = false;
  Macro.stop();
  flushMacroReport();
  TaskActive = true;
  TaskWaiting = false;
  TaskEntryIndex = 0;
  TaskIteration = 0;
  TaskCycle = 0;
  StatusLed.notifyTrigger();
  return startCurrentTaskEntry(millis());
}

bool handleTaskCommand(char* line) {
  // TASK_* 是另一套带校验和的事务上传协议，最多接收 5 个槽位引用。
  if (strcmp(line, "TASK_GET") == 0) {
    emitTaskPlan();
    return true;
  }
  if (strcmp(line, "TASK_START") == 0) {
    startTaskPlan();
    return true;
  }
  if (strcmp(line, "TASK_STOP") == 0) {
    clearTaskExecution();
    emitState("status");
    return true;
  }
  if (strcmp(line, "TASK_DELETE") == 0) {
    clearTaskExecution();
    StatusLed.startFlashWrite();
    const bool cleared = TaskStore.clear();
    StatusLed.finishFlashWrite(cleared);
    if (!cleared) {
      emitError("task-delete-failed");
    } else {
      SavedTaskPlan = {};
      TaskPlanAvailable = false;
      emitTaskPlan();
    }
    return true;
  }

  char command[20] = {};
  unsigned long first = 0, second = 0, third = 0, fourth = 0;
  const int parsed = sscanf(line, "%19s %lu %lu %lu %lu", command, &first,
                            &second, &third, &fourth);
  if (strcmp(command, "TASK_BEGIN") == 0) {
    if (parsed != 2 || first != farmers::kMaxTaskPlanEntries || TaskActive) {
      emitError("task-begin-invalid");
    } else {
      StagedTaskPlan = {};
      memset(StagedTaskEntryReceived, 0, sizeof(StagedTaskEntryReceived));
      TaskUploadActive = true;
      ATT_CONTROL_SERIAL.println("OK");
    }
    return true;
  }
  if (strncmp(line, "TASK_META ", 10) == 0) {
    char encodedName[96] = {};
    unsigned long count = 0, repeat = 0;
    if (!TaskUploadActive ||
        sscanf(line, "%19s %95s %lu %lu", command, encodedName, &count,
               &repeat) != 4 ||
        count == 0 || count > farmers::kMaxTaskPlanEntries || repeat > 1 ||
        !decodeMacroName(encodedName, StagedTaskPlan.name)) {
      emitError("task-meta-invalid");
    } else {
      StagedTaskPlan.entryCount = static_cast<uint8_t>(count);
      StagedTaskPlan.repeat = repeat == 1;
      ATT_CONTROL_SERIAL.println("OK");
    }
    return true;
  }
  if (strcmp(command, "TASK_ENTRY") == 0) {
    if (!TaskUploadActive || parsed != 5 ||
        first >= StagedTaskPlan.entryCount ||
        second >= farmers::kMacroLibrarySlotCount || third == 0 ||
        third > farmers::kMaxTaskPlanRepeatCount ||
        fourth > farmers::kMaxTaskPlanGapMs || !slotAvailable(second)) {
      emitError("task-entry-invalid");
    } else {
      StagedTaskPlan.entries[first] = {
          static_cast<uint8_t>(second), static_cast<uint16_t>(third),
          static_cast<uint32_t>(fourth)};
      StagedTaskEntryReceived[first] = true;
      ATT_CONTROL_SERIAL.println("OK");
    }
    return true;
  }
  if (strcmp(command, "TASK_COMMIT") == 0) {
    bool complete = TaskUploadActive && parsed == 2;
    for (size_t index = 0; complete && index < StagedTaskPlan.entryCount;
         ++index) {
      complete = StagedTaskEntryReceived[index];
    }
    bool stored = false;
    if (complete && validateTaskSlots(StagedTaskPlan) &&
        first == farmers::taskPlanChecksum(StagedTaskPlan)) {
      StatusLed.startFlashWrite();
      stored = TaskStore.save(StagedTaskPlan);
      StatusLed.finishFlashWrite(stored);
    }
    if (!stored) {
      emitError("task-commit-invalid");
    } else {
      SavedTaskPlan = StagedTaskPlan;
      TaskPlanAvailable = true;
      emitTaskPlan();
    }
    TaskUploadActive = false;
    return true;
  }
  return false;
}

void selectLibraryMacro(uint8_t slot) {
  // ---------- MACRO_* 命令 ----------
  // 选择不等于启动：MACRO_LOAD 仅切换当前宏，START/MACRO_START 才开始执行。
  // 运行中的宏绝不能因网页浏览或编辑页载入而被隐式停止。
  if (Macro.running()) {
    emitError("macro-running");
    return;
  }
  if (slot >= farmers::kMacroLibrarySlotCount) {
    emitError("macro-slot-invalid");
    return;
  }
  Macro.stop();
  flushMacroReport();
  if (!loadMacroSlot(slot, &ScratchMacro, ActiveMacroName,
                     &ActiveMacroBuiltin)) {
    emitError("macro-slot-empty");
    return;
  }
  if (!ActiveMacroBuiltin && !MacroLibrary.setActive(static_cast<int8_t>(slot))) {
    emitError("macro-select-failed");
    return;
  } else if (ActiveMacroBuiltin) {
    MacroLibrary.setActive(-1);
  }
  ActiveMacro = ScratchMacro;
  ActiveMacroSlot = static_cast<int8_t>(slot);
  MacroUploadActive = false;
  configureActiveMacro();
  flushMacroReport();
  emitMacro();
  emitMacroList();
  emitState("status");
}

void addMacroStep(unsigned long index, unsigned long durationMs,
                  unsigned long waitMs, unsigned long buttons, unsigned long dpad,
                  unsigned long leftX, unsigned long leftY,
                  unsigned long rightX, unsigned long rightY) {
  if (!MacroUploadActive || index >= StagedMacro.stepCount ||
      durationMs > farmers::kMaxUserMacroStepMs ||
      waitMs > farmers::kMaxUserMacroLoopGapMs || buttons > 0x3fff ||
      !isValidDpad(dpad) || leftX > 255 || leftY > 255 || rightX > 255 ||
      rightY > 255) {
    emitError("macro-step-invalid");
    return;
  }

  StagedMacro.steps[index] = {
      static_cast<uint32_t>(durationMs),
      {static_cast<uint16_t>(buttons), static_cast<uint8_t>(dpad),
       static_cast<uint8_t>(leftX), static_cast<uint8_t>(leftY),
       static_cast<uint8_t>(rightX), static_cast<uint8_t>(rightY)},
      static_cast<uint32_t>(waitMs),
  };
  StagedStepReceived[index] = true;
  ATT_CONTROL_SERIAL.println("OK");
}

void commitMacroUpload(unsigned long checksum) {
  if (!MacroUploadActive) {
    emitError("macro-upload-missing");
    return;
  }
  for (size_t index = 0; index < StagedMacro.stepCount; ++index) {
    if (!StagedStepReceived[index]) {
      emitError("macro-step-missing");
      return;
    }
  }
  if (!farmers::isUserMacroValid(StagedMacro) ||
      farmers::userMacroChecksum(StagedMacro) != checksum) {
    emitError("macro-checksum-invalid");
    return;
  }
  StatusLed.startFlashWrite();
  const bool saved = MacroLibrary.save(StagedMacroSlot, StagedMacroName,
                                       StagedMacro);
  const bool selected =
      saved && MacroLibrary.setActive(static_cast<int8_t>(StagedMacroSlot));
  StatusLed.finishFlashWrite(saved && selected);
  if (!saved || !selected) {
    emitError("macro-save-failed");
    return;
  }

  ActiveMacro = StagedMacro;
  ActiveMacroSlot = static_cast<int8_t>(StagedMacroSlot);
  ActiveMacroBuiltin = false;
  if (StagedMacroName[0] == '\0') {
    snprintf(ActiveMacroName, sizeof(ActiveMacroName), "Macro %u",
             static_cast<unsigned int>(StagedMacroSlot + 1));
  } else {
    setMacroName(ActiveMacroName, StagedMacroName);
  }
  MacroUploadActive = false;
  configureActiveMacro();
  flushMacroReport();
  emitMacro();
  emitMacroList();
  emitState("status");
}

bool handleMacroCommand(char* line) {
  if (TaskActive &&
      (strncmp(line, "MACRO_DEFAULT", 13) == 0 ||
       strncmp(line, "MACRO_START", 11) == 0 ||
       strncmp(line, "MACRO_RESTORE", 13) == 0 ||
       strncmp(line, "MACRO_BEGIN", 11) == 0 ||
       strncmp(line, "MACRO_LOAD", 10) == 0 ||
       strncmp(line, "MACRO_DELETE", 12) == 0 ||
       strncmp(line, "MACRO_RENAME", 12) == 0)) {
    emitError("task-running");
    return true;
  }
  // 除了显式启动另一宏外，配置类命令在运行期间一律拒绝。过去
  // MACRO_LOAD / MACRO_BEGIN 等命令会先调用 Macro.stop()，导致仅进入
  // 宏设置或编辑页也中断板载自动运行。
  if (Macro.running() &&
      (strncmp(line, "MACRO_DEFAULT", 13) == 0 ||
       strncmp(line, "MACRO_RESTORE", 13) == 0 ||
       strncmp(line, "MACRO_BEGIN", 11) == 0 ||
       strncmp(line, "MACRO_LOAD", 10) == 0 ||
       strncmp(line, "MACRO_DELETE", 12) == 0 ||
       strncmp(line, "MACRO_RENAME", 12) == 0 ||
       strncmp(line, "MACRO_NAME", 10) == 0 ||
       strncmp(line, "MACRO_STEP", 10) == 0 ||
       strncmp(line, "MACRO_COMMIT", 12) == 0)) {
    MacroUploadActive = false;
    emitError("macro-running");
    return true;
  }
  if (strcmp(line, "MACRO_GET") == 0) {
    // 512 步宏在 115200 baud 下输出 JSON 需要数秒；运行中禁止输出，避免串口
    // 阻塞影响板载定时动作。
    if (Macro.running()) {
      emitError("macro-running");
      return true;
    }
    emitMacro();
    return true;
  }
  if (strcmp(line, "MACRO_LIST") == 0) {
    emitMacroList();
    return true;
  }
  if (strcmp(line, "MACRO_DEFAULT") == 0) {
    Macro.stop();
    flushMacroReport();
    if (MacroLibrary.available() && !MacroLibrary.setActive(-1)) {
      emitError("macro-default-failed");
      return true;
    }
    copyDefaultMacro(&ActiveMacro);
    ActiveMacroSlot = -1;
    setMacroName(ActiveMacroName, "Default 天埠罗巢穴刷武器");
    MacroUploadActive = false;
    configureActiveMacro();
    flushMacroReport();
    emitMacro();
    emitMacroList();
    emitState("status");
    return true;
  }

  char startCommand[20] = {};
  unsigned long startSlot = 0;
  if (sscanf(line, "%19s %lu", startCommand, &startSlot) == 2 &&
      strcmp(startCommand, "MACRO_START") == 0) {
    if (startSlot >= farmers::kMacroLibrarySlotCount) {
      emitError("macro-slot-invalid");
    } else {
      startMacroSlot(static_cast<uint8_t>(startSlot));
    }
    return true;
  }
  if (sscanf(line, "%19s %lu", startCommand, &startSlot) == 2 &&
      strcmp(startCommand, "MACRO_RESTORE") == 0) {
    if (startSlot >= farmers::kMacroLibrarySlotCount ||
        !farmers::builtinMacroForSlot(static_cast<uint8_t>(startSlot + 1))) {
      emitError("macro-no-builtin");
    } else {
      StatusLed.startFlashWrite();
      const bool erased = MacroLibrary.erase(static_cast<uint8_t>(startSlot));
      StatusLed.finishFlashWrite(erased);
      if (!erased) {
        emitError("macro-restore-failed");
      } else if (ActiveMacroSlot == static_cast<int8_t>(startSlot)) {
        selectLibraryMacro(static_cast<uint8_t>(startSlot));
      } else {
        emitMacroList();
      }
    }
    return true;
  }

  if (strncmp(line, "MACRO_NAME ", 11) == 0) {
    if (!MacroUploadActive || !decodeMacroName(line + 11, StagedMacroName)) {
      emitError("macro-name-invalid");
    } else {
      ATT_CONTROL_SERIAL.println("OK");
    }
    return true;
  }

  char command[16] = {0};
  unsigned long first = 0;
  unsigned long second = 0;
  unsigned long third = 0;
  unsigned long fourth = 0;
  unsigned long fifth = 0;
  unsigned long sixth = 0;
  unsigned long seventh = 0;
  unsigned long eighth = 0;
  unsigned long ninth = 0;
  const int parsed = sscanf(line, "%15s %lu %lu %lu %lu %lu %lu %lu %lu %lu",
                            command, &first, &second, &third, &fourth, &fifth,
                            &sixth, &seventh, &eighth, &ninth);
  if (strcmp(command, "MACRO_BEGIN") == 0) {
    if (parsed == 5) {
      beginMacroUpload(first, second, third, fourth);
    } else if (parsed == 4) {
      beginMacroUpload(ActiveMacroSlot >= 0 ? ActiveMacroSlot : 0, first,
                       second, third);
    } else {
      emitError("macro-begin-invalid");
    }
    return true;
  }
  if (strcmp(command, "MACRO_LOAD") == 0) {
    if (parsed == 2 && first < farmers::kMacroLibrarySlotCount) {
      selectLibraryMacro(static_cast<uint8_t>(first));
    } else {
      emitError("macro-slot-invalid");
    }
    return true;
  }
  if (strcmp(command, "MACRO_DELETE") == 0) {
    const bool deletingActive =
        parsed == 2 && ActiveMacroSlot == static_cast<int8_t>(first);
    Macro.stop();
    flushMacroReport();
    bool erased = false;
    if (parsed == 2 && first < farmers::kMacroLibrarySlotCount) {
      StatusLed.startFlashWrite();
      erased = MacroLibrary.erase(static_cast<uint8_t>(first));
      StatusLed.finishFlashWrite(erased);
    }
    if (!erased) {
      emitError("macro-delete-failed");
      return true;
    }
    if (deletingActive) {
      const uint8_t fallbackSlot =
          farmers::builtinMacroForSlot(static_cast<uint8_t>(first + 1)) != nullptr
              ? static_cast<uint8_t>(first)
              : 0;
      selectLibraryMacro(fallbackSlot);
      return true;
    }
    emitMacroList();
    emitState("status");
    return true;
  }
  if (strcmp(command, "MACRO_RENAME") == 0) {
    char encodedName[96] = {};
    const int renamed = sscanf(line, "%15s %lu %95s", command, &first,
                               encodedName);
    if (renamed != 3 || first >= farmers::kMacroLibrarySlotCount) {
      emitError("macro-name-invalid");
      return true;
    }
    char decodedName[farmers::kMacroLibraryNameBytes + 1] = {};
    bool renameSaved = false;
    if (decodeMacroName(encodedName, decodedName) &&
        MacroLibrary.load(static_cast<uint8_t>(first), &ScratchMacro)) {
      StatusLed.startFlashWrite();
      renameSaved = MacroLibrary.save(static_cast<uint8_t>(first), decodedName,
                                      ScratchMacro);
      StatusLed.finishFlashWrite(renameSaved);
    }
    if (!renameSaved) {
      emitError("macro-rename-failed");
      return true;
    }
    if (ActiveMacroSlot == static_cast<int8_t>(first)) {
      setMacroName(ActiveMacroName, decodedName);
      emitMacro();
    }
    emitMacroList();
    return true;
  }
  if (strcmp(command, "MACRO_STEP") == 0) {
    if (parsed == 10) {
      addMacroStep(first, second, third, fourth, fifth, sixth, seventh,
                   eighth, ninth);
    } else {
      emitError("macro-step-invalid");
    }
    return true;
  }
  if (strcmp(command, "MACRO_COMMIT") == 0) {
    if (parsed == 2) {
      commitMacroUpload(first);
    } else {
      emitError("macro-checksum-invalid");
    }
    return true;
  }
  return false;
}

void handleLine(char* line) {
  // ---------- 串口命令总分发 ----------
  // 固定命令优先处理，其次是 GPIO、任务、宏三类子协议，最后才解析原始手柄报告。
  if (strncmp(line, "LED_BRIGHTNESS ", 15) == 0) {
    unsigned long brightness = 0;
    char extra = '\0';
    if (sscanf(line + 15, "%lu %c", &brightness, &extra) != 1 ||
        brightness > 255) {
      emitError("led-brightness-invalid");
    } else {
      StatusLed.setBrightness(static_cast<uint8_t>(brightness));
      ATT_CONTROL_SERIAL.println("OK");
    }
    return;
  }
  if (strcmp(line, "PING") == 0) {
    ATT_CONTROL_SERIAL.println("PONG");
    return;
  }
  if (strcmp(line, "HELLO") == 0 || strcmp(line, "INFO") == 0) {
    emitState("info");
    return;
  }
  if (strcmp(line, "STATUS") == 0) {
    emitState("status");
    return;
  }
  if (strcmp(line, "START") == 0) {
    PendingMacroStart = false;
    MacroUploadActive = false;
    clearTaskExecution(false);
    Macro.configure(ActiveMacro.steps, ActiveMacro.stepCount,
                    ActiveMacro.loopGapMs, true);
    Macro.start(millis());
    StatusLed.notifyTrigger();
    flushMacroReport();
    emitState("status");
    return;
  }
  if (strcmp(line, "STOP") == 0) {
    PendingMacroStart = false;
    MacroUploadActive = false;
    clearTaskExecution(false);
    configureActiveMacro();
    flushMacroReport();
    emitState("status");
    return;
  }
  if (handleTriggerCommand(line)) {
    return;
  }
  if (handleTaskCommand(line)) {
    return;
  }
  if (handleMacroCommand(line)) {
    return;
  }

  char command[8] = {0};
  unsigned long buttons = 0;
  unsigned long dpad = NSGAMEPAD_DPAD_CENTERED;
  unsigned long leftX = farmers::kAxisCentered;
  unsigned long leftY = farmers::kAxisCentered;
  unsigned long rightX = farmers::kAxisCentered;
  unsigned long rightY = farmers::kAxisCentered;
  const int parsed =
      sscanf(line, "%7s %lu %lu %lu %lu %lu %lu", command, &buttons, &dpad,
             &leftX, &leftY, &rightX, &rightY);

  if (parsed == 7 &&
      (strcmp(command, "R") == 0 || strcmp(command, "REPORT") == 0)) {
    // 手动输入只临时覆盖 HID 报告；板载宏时间轴仍继续，下一阶段会重新接管。
    applyRawReport(buttons, dpad, leftX, leftY, rightX, rightY);
    ATT_CONTROL_SERIAL.println("OK");
    return;
  }

  ATT_CONTROL_SERIAL.println("ERR");
}

void readControlSerial() {
  // 以换行分帧并限制单行长度；超长命令直接丢弃，避免破坏下一条命令。
  while (ATT_CONTROL_SERIAL.available() > 0) {
    const char character = static_cast<char>(ATT_CONTROL_SERIAL.read());
    if (character == '\n' || character == '\r') {
      if (LineOverflow) {
        ATT_CONTROL_SERIAL.println("ERR");
      } else if (LineLength > 0) {
        LineBuffer[LineLength] = '\0';
        handleLine(LineBuffer);
      }
      LineLength = 0;
      LineOverflow = false;
      continue;
    }

    if (LineOverflow) {
      continue;
    }
    if (LineLength < sizeof(LineBuffer) - 1) {
      LineBuffer[LineLength++] = character;
    } else {
      LineOverflow = true;
    }
  }
}

void pollTriggers(uint32_t nowMs) {
  // ---------- GPIO 轮询 ----------
  // 所有输入先经过上电稳定和 50 ms 去抖，再把 LOW 边沿解释为一次触发。
  if (!TriggerArmed) {
    bool allHigh = digitalRead(TriggerSettings.stopPin) == HIGH;
    for (size_t index = 0; index < kTriggerCount; ++index) {
      if (TriggerSettings.entries[index].enabled) {
        allHigh = allHigh &&
                  digitalRead(TriggerSettings.entries[index].pin) == HIGH;
      }
    }
    if (!allHigh) {
      TriggerAllHighSinceMs = nowMs;
    } else if (static_cast<uint32_t>(nowMs - TriggerAllHighSinceMs) >=
               kTriggerDebounceMs) {
      TriggerArmed = true;
      setupTriggerPins();
      TriggerArmed = true;
    }
    return;
  }

  const bool stopRawHigh = digitalRead(TriggerSettings.stopPin) == HIGH;
  if (stopRawHigh != StopRawHigh) {
    StopRawHigh = stopRawHigh;
    StopChangedAtMs = nowMs;
  }
  bool stopFell = false;
  if (StopStableHigh != StopRawHigh &&
      static_cast<uint32_t>(nowMs - StopChangedAtMs) >= kTriggerDebounceMs) {
    StopStableHigh = StopRawHigh;
    stopFell = !StopStableHigh;
  }
  if (stopFell) {
    PendingMacroStart = false;
    MacroUploadActive = false;
    clearTaskExecution(false);
    Macro.stop();
    flushMacroReport();
    emitState("status");
  }

  // Stop 具有最高优先级：停止脚已低或仍在去抖时，同一轮轮询不得启动新宏。
  if (!StopStableHigh || !StopRawHigh || stopFell) {
    return;
  }

  for (size_t index = 0; index < kTriggerCount; ++index) {
    const TriggerEntry& entry = TriggerSettings.entries[index];
    const bool rawHigh = digitalRead(entry.pin) == HIGH;
    if (rawHigh != TriggerRawHigh[index]) {
      TriggerRawHigh[index] = rawHigh;
      TriggerChangedAtMs[index] = nowMs;
    }
    if (TriggerStableHigh[index] != TriggerRawHigh[index] &&
        static_cast<uint32_t>(nowMs - TriggerChangedAtMs[index]) >=
            kTriggerDebounceMs) {
      TriggerStableHigh[index] = TriggerRawHigh[index];
      if (entry.enabled && !TriggerStableHigh[index] && StopStableHigh &&
          !stopFell) {
        if (entry.slot == kTaskTriggerSlot) {
          startTaskPlan();
        } else {
          startMacroSlot(entry.slot, static_cast<uint8_t>(index));
        }
        break;
      }
    }
  }

}

void pollPendingMacroStart(uint32_t nowMs) {
  // 触发到 LOW 后再延迟一个去抖周期启动，避免抖动导致重复启动。
  if (!PendingMacroStart ||
      static_cast<uint32_t>(nowMs - PendingMacroStartAtMs) <
          kTriggerDebounceMs) {
    return;
  }
  const uint8_t slot = PendingMacroSlot;
  const uint8_t trigger = PendingMacroTrigger;
  PendingMacroStart = false;
  activateMacroSlot(slot, trigger);
}

}  // namespace

void setup() {
  // ---------- Arduino 生命周期 ----------
  // 先恢复宏/任务/GPIO 配置，再初始化 HID；最后发送一份中立报告避免上电残留按键。
  StatusLed.begin();
  StatusLed.setBrightness(static_cast<uint8_t>(STATUS_LED_BRIGHTNESS));
  ATT_CONTROL_SERIAL.begin(kControlBaudRate);
  loadActiveMacro();
  TaskPlanAvailable = TaskStore.load(&SavedTaskPlan) &&
                      validateTaskSlots(SavedTaskPlan);
  loadTriggerConfig();
  setupTriggerPins();
  Gamepad.begin();
  USB.begin();
  applyReport(farmers::kNeutralReport);
}

void loop() {
  // 主循环没有 delay()：串口、GPIO、宏状态机、任务状态机与 USB HID 轮流推进。
  readControlSerial();
  const uint32_t nowMs = millis();
  pollTriggers(nowMs);
  pollPendingMacroStart(nowMs);
  Macro.tick(nowMs);
  flushMacroReport();
  pollTaskExecution(nowMs);
  Gamepad.loop();
  updateStatusLed(nowMs);
}
