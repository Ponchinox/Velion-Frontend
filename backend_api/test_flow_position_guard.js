import assert from 'node:assert';
import { normalizeFlowNodes } from './src/controllers/flowController.js';

console.log('=== TEST SUITE: FLOW POSITION GUARD ===\n');

// 1. Test FLOW_WITH_VALID_POSITIONS
function testFlowWithValidPositions() {
  const inputNodes = [
    {
      id: 'node-1',
      type: 'trigger',
      position: { x: 120, y: 340 },
      data: { label: 'Keyword: hola' }
    },
    {
      id: 'node-2',
      type: 'message',
      position: { x: 450, y: 600 },
      data: { text: 'Respuesta' }
    }
  ];

  const result = normalizeFlowNodes(inputNodes);

  assert.strictEqual(result.length, 2, 'Should preserve node count');
  assert.strictEqual(result[0].position.x, 120, 'Position X should be exactly preserved');
  assert.strictEqual(result[0].position.y, 340, 'Position Y should be exactly preserved');
  assert.strictEqual(result[1].position.x, 450, 'Position X of node 2 should be exactly preserved');
  assert.strictEqual(result[1].position.y, 600, 'Position Y of node 2 should be exactly preserved');

  console.log('FLOW_WITH_VALID_POSITIONS = PASS');
}

// 2. Test FLOW_WITH_MISSING_POSITION_DOES_NOT_CRASH
function testFlowWithMissingPositionDoesNotCrash() {
  const brokenNodes = [
    {
      id: 'start',
      type: 'trigger',
      data: { label: 'Keyword: hola' }
      // missing position completely
    },
    {
      id: 'greet',
      type: 'message',
      position: null, // position is null
      data: { text: '¡Bienvenido a Velion Demo!' }
    },
    {
      id: 'step3',
      type: 'message',
      position: {}, // empty position object
      data: { text: 'Paso 3' }
    },
    {
      id: 'step4',
      type: 'message',
      position: { x: NaN, y: undefined }, // invalid numbers
      data: { text: 'Paso 4' }
    }
  ];

  // Must not throw TypeError: Cannot read properties of undefined (reading 'x')
  const result = normalizeFlowNodes(brokenNodes);

  assert.strictEqual(result.length, 4, 'Should preserve all 4 nodes');

  for (let i = 0; i < result.length; i++) {
    const node = result[i];
    assert.ok(node.position, `Node ${node.id} must have position defined`);
    assert.strictEqual(typeof node.position.x, 'number', `Node ${node.id} position.x must be a number`);
    assert.strictEqual(typeof node.position.y, 'number', `Node ${node.id} position.y must be a number`);
    assert.ok(!isNaN(node.position.x), `Node ${node.id} position.x must not be NaN`);
    assert.ok(!isNaN(node.position.y), `Node ${node.id} position.y must not be NaN`);
  }

  // Also test null or non-array input
  assert.deepStrictEqual(normalizeFlowNodes(null), []);
  assert.deepStrictEqual(normalizeFlowNodes(undefined), []);

  console.log('FLOW_WITH_MISSING_POSITION_DOES_NOT_CRASH = PASS');
}

try {
  testFlowWithValidPositions();
  testFlowWithMissingPositionDoesNotCrash();
  console.log('\n✅ ALL FLOW POSITION TESTS PASSED SUCCESSFULLY.');
} catch (error) {
  console.error('\n❌ TEST FAILED:', error);
  process.exit(1);
}
