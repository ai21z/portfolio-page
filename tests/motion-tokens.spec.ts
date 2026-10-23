import { expect, test } from '@playwright/test';

test('the JS timers and the stylesheets share one set of motion durations', async ({ page }) => {
  // js/motion.js backs up CSS transitions with timers. If the two drifted, a fallback could fire
  // mid-transition or the governor's switch window could end before the fade does.
  await page.goto('/index.html');
  const values = await page.evaluate(async () => {
    const motion = await import('/js/motion.js');
    const root = getComputedStyle(document.documentElement);
    const ms = (value: string) => parseFloat(value) * (value.trim().endsWith('ms') ? 1 : 1000);
    const stage = document.querySelector('.stage:not(.active-section)') as HTMLElement;
    stage.classList.add('stage-leaving');
    const stageFade = ms(getComputedStyle(stage).transitionDuration.split(',')[0]);
    stage.classList.remove('stage-leaving');
    return {
      motion: { ...motion },
      cssStage: ms(root.getPropertyValue('--dur-stage')),
      cssPaper: ms(root.getPropertyValue('--dur-paper')),
      curve: root.getPropertyValue('--ease-house').trim(),
      stageFade
    };
  });
  expect(values.cssStage).toBe(values.motion.STAGE_FADE_MS);
  expect(values.stageFade).toBe(values.motion.STAGE_FADE_MS);
  expect(values.cssPaper).toBe(values.motion.PAPER_MOVE_MS);
  expect(values.motion.STAGE_LEAVE_MS).toBeGreaterThan(values.motion.STAGE_FADE_MS);
  expect(values.motion.PAPER_SETTLE_MS).toBeGreaterThan(values.motion.PAPER_MOVE_MS);
  expect(values.motion.PAPER_CLEANUP_MS).toBeGreaterThan(values.motion.PAPER_MOVE_MS);
  expect(values.motion.SECTION_SWITCH_ACTIVITY_MS).toBeGreaterThanOrEqual(values.motion.STAGE_FADE_MS);
  // The minifier may drop the leading zeros, so compare the numbers.
  expect(values.curve.match(/-?\d*\.?\d+/g)!.map(Number)).toEqual([0.16, 1, 0.3, 1]);
});
