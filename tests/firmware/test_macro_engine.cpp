#include <assert.h>
#include <stdint.h>
#include <string.h>

#include "BuiltinMacroLibrary.h"
#include "MacroEngine.h"
#include "UserMacro.h"
#include "TaskPlan.h"

using farmers::MacroEngine;
using farmers::MacroPhase;

namespace {

constexpr farmers::ControllerReport kReportA{1u << 2, farmers::kDpadCentered,
                                             128, 128, 128, 128};
constexpr farmers::ControllerReport kReportB{1u << 1, farmers::kDpadCentered,
                                             128, 128, 128, 128};

uint32_t builtinDuration(const farmers::BuiltinMacroDefinition& macro) {
  uint32_t total = 0;
  for (size_t index = 0; index < macro.stepCount; ++index) {
    total += macro.steps[index].durationMs + macro.steps[index].waitMs;
  }
  return total;
}

void testBuiltinMacroMetadata() {
  const char* expectedNames[] = {"天埠罗巢穴刷武器", "杏棱巢穴刷钱", "武器分解", "连接手柄"};
  const size_t expectedSteps[] = {18, 26, 23, 1};
  const uint32_t expectedDurations[] = {78200, 65600, 24500, 1000};

  assert(farmers::kBuiltinMacroCount == 4);
  for (uint8_t slot = 1; slot <= farmers::kBuiltinMacroCount; ++slot) {
    const farmers::BuiltinMacroDefinition* macro = farmers::builtinMacroForSlot(slot);
    assert(macro != nullptr);
    assert(macro->slot == slot);
    assert(strcmp(macro->name, expectedNames[slot - 1]) == 0);
    assert(macro->stepCount == expectedSteps[slot - 1]);
    assert(builtinDuration(*macro) == expectedDurations[slot - 1]);
    assert(macro->loopGapMs == 0);
  }
  assert(farmers::builtinMacroForSlot(5) == nullptr);

  const farmers::BuiltinMacroDefinition* weaponFarm = farmers::builtinMacroForSlot(1);
  assert(weaponFarm->steps[0].report.buttons == (1u << 3));
  assert(weaponFarm->steps[6].report.buttons == ((1u << 7) | (1u << 11)));
  assert(weaponFarm->steps[10].report.leftX == 0);
  assert(weaponFarm->steps[10].report.buttons == (1u << 7));
}

void testBuiltinMacroProgressesThroughEveryStep() {
  const farmers::BuiltinMacroDefinition* definition = farmers::builtinMacroForSlot(1);
  assert(definition != nullptr);
  MacroEngine engine(definition->steps, definition->stepCount,
                     definition->loopGapMs, true);

  uint32_t now = 1000;
  engine.start(now);
  assert(engine.running());
  assert(engine.phase() == MacroPhase::kSteps);
  assert(engine.stepIndex() == 0);
  assert(engine.report() == definition->steps[0].report);
  assert(engine.consumeReportChanged());
  assert(!engine.consumeReportChanged());

  for (size_t index = 0; index < definition->stepCount; ++index) {
    const auto& step = definition->steps[index];
    engine.tick(now + step.durationMs - 1);
    assert(engine.phase() == MacroPhase::kSteps);
    assert(engine.stepIndex() == index);

    now += step.durationMs;
    engine.tick(now);
    if (step.waitMs > 0) {
      assert(engine.phase() == MacroPhase::kStepWait);
      assert(engine.report() == farmers::kNeutralReport);
      now += step.waitMs;
      engine.tick(now);
    }
    if (index + 1 < definition->stepCount) {
      assert(engine.phase() == MacroPhase::kSteps);
      assert(engine.stepIndex() == index + 1);
      assert(engine.report() == definition->steps[index + 1].report);
    }
  }

  assert(engine.running());
  assert(engine.phase() == MacroPhase::kSteps);
  assert(engine.stepIndex() == 0);
  assert(engine.report() == definition->steps[0].report);
  assert(engine.cycleCount() == 1);

}

void testStopAlwaysNeutralizes() {
  const farmers::BuiltinMacroDefinition* definition = farmers::builtinMacroForSlot(1);
  MacroEngine engine(definition->steps, definition->stepCount,
                     definition->loopGapMs, true);
  engine.start(42);
  engine.consumeReportChanged();
  engine.stop();

  assert(!engine.running());
  assert(engine.phase() == MacroPhase::kIdle);
  assert(engine.report() == farmers::kNeutralReport);
  assert(engine.consumeReportChanged());
}

void testStepWaitReleasesButtonsBeforeNextAction() {
  const farmers::MacroStep steps[] = {
      {100, kReportA, 50},
      {80, kReportB, 0},
  };
  MacroEngine engine(steps, 2, 0, false);
  engine.start(1000);
  assert(engine.report() == kReportA);
  assert(engine.phaseDurationMs() == 100);
  assert(engine.phaseElapsedMs(1040) == 40);
  assert(engine.phaseRemainingMs(1040) == 60);

  engine.tick(1099);
  assert(engine.phase() == MacroPhase::kSteps);
  engine.tick(1100);
  assert(engine.phase() == MacroPhase::kStepWait);
  assert(engine.report() == farmers::kNeutralReport);
  assert(engine.stepIndex() == 0);
  assert(engine.phaseDurationMs() == 50);
  assert(engine.phaseElapsedMs(1120) == 20);
  assert(engine.phaseRemainingMs(1120) == 30);

  engine.tick(1149);
  assert(engine.phase() == MacroPhase::kStepWait);
  engine.tick(1150);
  assert(engine.phase() == MacroPhase::kSteps);
  assert(engine.stepIndex() == 1);
  assert(engine.report() == kReportB);
}

void testMillisWraparound() {
  const farmers::MacroStep steps[] = {
      {20, kReportA},
      {10, farmers::kNeutralReport},
  };
  MacroEngine engine(steps, 2, 5, true);
  const uint32_t start = UINT32_MAX - 9;
  engine.start(start);
  engine.tick(10);
  assert(engine.stepIndex() == 1);
  engine.tick(20);
  assert(engine.phase() == MacroPhase::kLoopGap);
  engine.tick(25);
  assert(engine.phase() == MacroPhase::kSteps);
  assert(engine.stepIndex() == 0);
}

void testRuntimeMacroValidationAndConfiguration() {
  farmers::UserMacro macro{};
  macro.stepCount = 2;
  macro.loopGapMs = 75;
  macro.repeat = false;
  macro.steps[0] = {120, kReportA};
  macro.steps[1] = {80, farmers::kNeutralReport};

  assert(farmers::isUserMacroValid(macro));
  assert(farmers::userMacroDurationMs(macro) == 200);
  const uint32_t checksum = farmers::userMacroChecksum(macro);
  assert(checksum == farmers::userMacroChecksum(macro));

  macro.steps[0].durationMs = 9;
  assert(!farmers::isUserMacroValid(macro));
  macro.steps[0].durationMs = 120;

  const farmers::BuiltinMacroDefinition* definition = farmers::builtinMacroForSlot(1);
  MacroEngine engine(definition->steps, definition->stepCount,
                     definition->loopGapMs, true);
  engine.start(1);
  assert(engine.running());
  assert(engine.configure(macro.steps, macro.stepCount, macro.loopGapMs,
                          macro.repeat));
  assert(!engine.running());
  assert(engine.stepCount() == 2);
  assert(engine.loopGapMs() == 75);
  assert(!engine.repeat());

  engine.start(100);
  engine.tick(220);
  assert(engine.stepIndex() == 1);
  engine.tick(300);
  assert(!engine.running());
  assert(engine.report() == farmers::kNeutralReport);
}

void testFiveEntryTaskPlanValidation() {
  farmers::TaskPlan plan{};
  const char name[] = "Material cycle";
  for (size_t index = 0; index < sizeof(name); ++index) plan.name[index] = name[index];
  plan.entryCount = 3;
  plan.repeat = true;
  plan.entries[0] = {0, 100, 0};
  plan.entries[1] = {1, 20, 0};
  plan.entries[2] = {2, 1, 2000};
  assert(farmers::isTaskPlanStructValid(plan));
  assert(farmers::taskPlanChecksum(plan) == farmers::taskPlanChecksum(plan));
  plan.entryCount = 6;
  assert(!farmers::isTaskPlanStructValid(plan));
}

}  // namespace

int main() {
  testBuiltinMacroMetadata();
  testBuiltinMacroProgressesThroughEveryStep();
  testStopAlwaysNeutralizes();
  testStepWaitReleasesButtonsBeforeNextAction();
  testMillisWraparound();
  testRuntimeMacroValidationAndConfiguration();
  testFiveEntryTaskPlanValidation();
  return 0;
}
