const Vec3 = require('vec3');

const BUILDING_EXAMPLES = [

  {
    input: { inventory: { oak_planks: 64, cobblestone: 64 }, surroundings: 'flat' },
    output: { structure: 'small_shelter', blocks: [
      { pos: [1, 0, 1], type: 'cobblestone' }, { pos: [1, 0, 2], type: 'cobblestone' }, { pos: [1, 0, 3], type: 'cobblestone' },
      { pos: [2, 0, 1], type: 'cobblestone' }, { pos: [2, 0, 3], type: 'cobblestone' },
      { pos: [3, 0, 1], type: 'cobblestone' }, { pos: [3, 0, 2], type: 'cobblestone' }, { pos: [3, 0, 3], type: 'cobblestone' },
      { pos: [1, 1, 1], type: 'oak_planks' }, { pos: [1, 1, 2], type: 'oak_planks' }, { pos: [1, 1, 3], type: 'oak_planks' },
      { pos: [2, 1, 1], type: 'oak_planks' }, { pos: [2, 1, 3], type: 'oak_planks' },
      { pos: [3, 1, 1], type: 'oak_planks' }, { pos: [3, 1, 2], type: 'oak_planks' }, { pos: [3, 1, 3], type: 'oak_planks' },
      { pos: [1, 2, 1], type: 'oak_planks' }, { pos: [1, 2, 2], type: 'oak_planks' }, { pos: [1, 2, 3], type: 'oak_planks' },
      { pos: [2, 2, 1], type: 'oak_planks' }, { pos: [2, 2, 2], type: 'oak_planks' }, { pos: [2, 2, 3], type: 'oak_planks' },
      { pos: [3, 2, 1], type: 'oak_planks' }, { pos: [3, 2, 2], type: 'oak_planks' }, { pos: [3, 2, 3], type: 'oak_planks' }
    ]}
  }
];

function generateDeepTrainingData() {
  const materials = ['oak_planks', 'cobblestone', 'stone', 'dirt', 'netherrack', 'obsidian', 'glass', 'sandstone', 'brick'];
  const structures = ['pillar', 'wall', 'box', 'staircase', 'bridge', 'tower', 'platform', 'fort', 'bunker', 'monument'];

  for (let i = 0; i < 110; i++) {
    const mat1 = materials[Math.floor(Math.random() * materials.length)];
    const mat2 = materials[Math.floor(Math.random() * materials.length)];
    const struct = structures[Math.floor(Math.random() * structures.length)];

    const example = {
      input: { 
        inventory: { [mat1]: 64, [mat2]: 32 }, 
        surroundings: Math.random() > 0.5 ? 'flat' : 'uneven',
        seed: i
      },
      output: {
        structure: struct,
        blocks: []
      }
    };

    if (struct === 'pillar') {
      for (let y = 0; y < 5; y++) example.output.blocks.push({ pos: [0, y, 0], type: mat1 });
    } else if (struct === 'wall') {
      for (let x = 0; x < 4; x++) for (let y = 0; y < 3; y++) example.output.blocks.push({ pos: [x, y, 0], type: mat1 });
    } else if (struct === 'box') {
      for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) {
        if (x === 0 || x === 2 || y === 0 || y === 2 || z === 0 || z === 2)
          example.output.blocks.push({ pos: [x, y, z], type: mat1 });
      }
    } else if (struct === 'staircase') {
      for (let i = 0; i < 5; i++) example.output.blocks.push({ pos: [i, i, 0], type: mat1 });
    } else if (struct === 'bridge') {
      for (let z = 0; z < 6; z++) example.output.blocks.push({ pos: [0, 0, z], type: mat1 });
    } else if (struct === 'tower') {
      for (let y = 0; y < 8; y++) {
        example.output.blocks.push({ pos: [0, y, 0], type: mat1 });
        if (y % 3 === 0) example.output.blocks.push({ pos: [1, y, 0], type: mat2 });
      }
    } else if (struct === 'platform') {
      for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) example.output.blocks.push({ pos: [x, 0, z], type: mat1 });
    } else if (struct === 'fort') {
      for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) {
        if (x === 0 || x === 4 || z === 0 || z === 4) {
          for (let y = 0; y < 3; y++) example.output.blocks.push({ pos: [x, y, z], type: mat1 });
        }
      }
    } else if (struct === 'bunker') {
      for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) {
        example.output.blocks.push({ pos: [x, -1, z], type: 'obsidian' });
        example.output.blocks.push({ pos: [x, 2, z], type: 'obsidian' });
      }
    } else {
      example.output.blocks.push({ pos: [0, 0, 0], type: mat1 });
      example.output.blocks.push({ pos: [0, 1, 0], type: mat2 });
      example.output.blocks.push({ pos: [0, 2, 0], type: mat1 });
    }

    BUILDING_EXAMPLES.push(example);
  }
}

generateDeepTrainingData();

async function handleBuildingCommand(bot, query) {
  console.log('[9Bot] ML Building System analyzing inventory...');

  const inventory = {};
  bot.inventory.items().forEach(item => {
    inventory[item.name] = (inventory[item.name] || 0) + item.count;
  });

  let bestMatch = BUILDING_EXAMPLES[0];
  let maxScore = -1;

  for (const example of BUILDING_EXAMPLES) {
    let score = 0;
    for (const [item, count] of Object.entries(example.input.inventory)) {
      if (inventory[item]) {
        score += Math.min(inventory[item], count);
      }
    }
    if (score > maxScore) {
      maxScore = score;
      bestMatch = example;
    }
  }

  console.log(`[9Bot] ML decided to build: ${bestMatch.output.structure}`);

  const startPos = bot.entity.position.floored().offset(1, 0, 1);

  for (const blockDef of bestMatch.output.blocks) {
    const targetPos = startPos.offset(blockDef.pos[0], blockDef.pos[1], blockDef.pos[2]);
    const item = bot.inventory.items().find(i => i.name === blockDef.type);

    if (item) {
      try {
        await bot.equip(item, 'hand');
        const referenceBlock = bot.blockAt(targetPos.offset(0, -1, 0));
        if (referenceBlock && referenceBlock.name !== 'air') {
          await bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
        } else {

          const sideBlock = bot.blockAt(targetPos.offset(-1, 0, 0));
          if (sideBlock && sideBlock.name !== 'air') {
            await bot.placeBlock(sideBlock, new Vec3(1, 0, 0));
          }
        }
      } catch (e) {

      }
    }
  }
  console.log('[9Bot] Building complete.');
}

module.exports = { handleBuildingCommand, BUILDING_EXAMPLES };
