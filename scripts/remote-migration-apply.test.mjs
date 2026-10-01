import assert from 'node:assert/strict';
import test from 'node:test';

import { planApplyOrder } from './remote-migration-apply.mjs';

test('every migration gets a step, in repository order', () => {
  const migrations = [
    { filename: '001_a.sql', version: '001' },
    { filename: '002_b.sql', version: '002' },
  ];
  assert.deepEqual(planApplyOrder(migrations), [
    { filename: '001_a.sql', version: '001', isCollisionExtra: false },
    { filename: '002_b.sql', version: '002', isCollisionExtra: false },
  ]);
});

test('the first file of a shared version is tracked; later files in the group are collision extras', () => {
  const migrations = [
    { filename: '038_x.sql', version: '038' },
    { filename: '039_drop_trigger.sql', version: '039' },
    { filename: '039_drop_indexes.sql', version: '039' },
    { filename: '040_y.sql', version: '040' },
  ];
  assert.deepEqual(planApplyOrder(migrations), [
    { filename: '038_x.sql', version: '038', isCollisionExtra: false },
    { filename: '039_drop_trigger.sql', version: '039', isCollisionExtra: false },
    { filename: '039_drop_indexes.sql', version: '039', isCollisionExtra: true },
    { filename: '040_y.sql', version: '040', isCollisionExtra: false },
  ]);
});

test('a three-way collision marks only the first file as tracked', () => {
  const migrations = [
    { filename: '042_a.sql', version: '042' },
    { filename: '042_b.sql', version: '042' },
    { filename: '042_c.sql', version: '042' },
  ];
  const plan = planApplyOrder(migrations);
  assert.equal(plan.filter((step) => !step.isCollisionExtra).length, 1);
  assert.equal(plan.filter((step) => step.isCollisionExtra).length, 2);
});

test('versions already recorded on the remote before this run are treated as collision extras from the start', () => {
  const migrations = [{ filename: '001_a.sql', version: '001' }];
  assert.deepEqual(planApplyOrder(migrations, ['001']), [
    { filename: '001_a.sql', version: '001', isCollisionExtra: true },
  ]);
});
