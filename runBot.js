const mineflayer = require('mineflayer')
const pathfinder = require('mineflayer-pathfinder')
const readline = require('readline')
const fs = require('fs')
const path = require('path')
const Vec3 = require('vec3')

const args = process.argv.slice(2)
let cliPort = null;
let botIndex = 0;
let trainingPhase = 'combat';
let isTrainer = false;

for (const arg of args) {
  if (arg.startsWith('--port=')) cliPort = parseInt(arg.split('=')[1])
  else if (arg.startsWith('--index=')) botIndex = parseInt(arg.split('=')[1])
  else if (arg.startsWith('--phase=')) trainingPhase = arg.split('=')[1]
}

isTrainer = botIndex >= 7;

const config = require('./config.json');
if (cliPort) config.serverPort = cliPort;

const GRID_SPACE = 5;
const BASE_X = -10;
const BASE_Z = -5;
const MANAGER_INDEX = 6;
const SIGNAL_FILE = '/tmp/9bot_start_signal';
const VOTE_FILE = '/tmp/9bot_votes.json';

const STATS_DIR = '/tmp/9bot_stats';

function getGridPos(index) {
  return {
    x: BASE_X + (index % 5) * GRID_SPACE,
    z: BASE_Z + Math.floor(index / 5) * GRID_SPACE
  };
}

async function askPort() {
  if (cliPort) return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question('Enter server port (default ' + config.serverPort + '): ', (answer) => {
      if (answer.trim()) config.serverPort = parseInt(answer.trim());
      rl.close();
      resolve();
    });
  });
}

let stats = { hits: 0, kills: 0, deaths: 0, damageDealt: 0, damageTaken: 0, score: 0 };
let startTime = null;
const MAX_TRAIN_TIME = 90000;
let bot = null;
let combatInterval = null;
let lastTarget = null;

function saveStats() {
  try {
    if (!fs.existsSync(STATS_DIR)) fs.mkdirSync(STATS_DIR, { recursive: true });
    const statsFile = path.join(STATS_DIR, 'bot_' + botIndex + '.json');
    fs.writeFileSync(statsFile, JSON.stringify(stats));
  } catch (e) { }
}

function setupChatCommands(bot, name) {
  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    const msg = message.toLowerCase().trim();

    if (msg.includes('build me something')) {
      handleBuildingCommand(bot, 'something');
      return; 
    }

    if (!msg.startsWith('!')) return;

    if (msg === '!help') {
      bot.chat('!help - Commands | build me something - Trigger building');
    }
  });
}

async function init() {
  await askPort();
  let name;
  if (isTrainer) name = 'Trainer_' + (botIndex - 6);
  else if (botIndex === MANAGER_INDEX) name = 'Manager';
  else name = '9Bot_' + botIndex;

  console.log('[' + name + '] Connecting to port ' + config.serverPort + '...');

  bot = mineflayer.createBot({
    host: config.serverHost || 'localhost',
    port: config.serverPort,
    username: name,
    version: config.version,
    checkVersion: false
  });

  bot.loadPlugin(pathfinder.pathfinder);

  bot.on('login', () => console.log('[' + bot.username + '] Logged in'));

  bot.on('spawn', () => {
    const grid = getGridPos(botIndex);
    console.log('[' + bot.username + '] Spawned at grid (' + grid.x + ', ' + grid.z + ') - Phase: ' + trainingPhase);

    const mcData = require('minecraft-data')(bot.version);
    const movements = new pathfinder.Movements(bot, mcData);
    movements.canBreakBlocks = true;
    movements.canPlaceBlocks = true;
    movements.allowSprinting = true;
    movements.allowParkour = true;
    bot.pathfinder.setMovements(movements);

    let lastPos = bot.entity.position.clone();
    setInterval(() => {
      if (bot.dead || !bot.entity) return;
      const currentPos = bot.entity.position;
      if (bot.pathfinder.isMoving() && lastPos.distanceTo(currentPos) < 1) {
        handleStuck(bot);
      }
      lastPos = currentPos.clone();
    }, 2000);

    if (isTrainer) runTrainer(bot);
    else if (botIndex === MANAGER_INDEX) runManager(bot);
    else if (trainingPhase === 'combat') runCombatTraining(bot, grid);
    else if (trainingPhase === 'building') runBuildingTraining(bot, grid);
    else if (trainingPhase === 'userduel') runUserDuel(bot);
  });

  if (!isTrainer && botIndex !== MANAGER_INDEX) {
    bot.on('death', () => {
      stats.deaths++;
      console.log('[' + bot.username + '] Died (' + stats.deaths + ') | Hits:' + stats.hits + ' Kills:' + stats.kills);
      saveStats();
      if (startTime && Date.now() - startTime > MAX_TRAIN_TIME) {
        finishTraining();
      }
      setTimeout(() => bot.respawn(), 1000);
    });

    let angerHits = 0;
    setInterval(() => { if (angerHits > 0) angerHits--; }, 5000);

    bot.on('entityHurt', (entity) => {
      if (entity.id === bot.entity.id) {
        stats.damageTaken++;
        angerHits++;
        if (angerHits >= 2 && trainingPhase !== 'duel') {
          bot.isAngry = true;
          setTimeout(() => { bot.isAngry = false; }, 20000);
          angerHits = 0;
        }
      }
      if (lastTarget && entity.id === lastTarget.id) {
        stats.damageDealt++;
        stats.hits++;
        stats.score += 10;
      }
    });

    bot.on('playerCollect', (collector, collected) => {
      if (collector === bot.entity) {
        setTimeout(() => autoEquip(bot), 500);
      }
    });
    bot.ignoredItems = bot.ignoredItems || new Set();
    bot.recentToss = 0;
    bot.on('entitySpawn', (e) => {
      if (e.name === 'item' && bot.recentToss && Date.now() - bot.recentToss < 1000) {
        if (e.position.distanceTo(bot.entity.position) < 2) {
          bot.ignoredItems.add(e.id);
        }
      }
    });
  }

  bot.on('error', (err) => {
    console.error('[' + (bot.username || name) + '] Error: ' + err.message);
  });

  setupChatCommands(bot, name);
}

function getEdibleItems(bot) {
  const mcData = require('minecraft-data')(bot.version);
  const items = bot.inventory.items();
  const poisonous = new Set(['rotten_flesh', 'spider_eye', 'pufferfish', 'poisonous_potato', 'chicken', 'milk_bucket']);
  const edibles = items.filter(item => {
    const itemData = mcData.items[item.type] || mcData.itemsByName[item.name];
    if (!itemData) return false;
    if (itemData.food) return true;
    if (item.name.includes('golden_apple') || item.name.includes('enchanted_golden_apple')) return true;
    return false;
  }).filter(item => !poisonous.has(item.name));

  edibles.sort((a, b) => {
    const aEG = a.name.includes('enchanted_golden_apple') ? 3 : a.name.includes('golden_apple') ? 2 : 1;
    const bEG = b.name.includes('enchanted_golden_apple') ? 3 : b.name.includes('golden_apple') ? 2 : 1;
    if (bEG !== aEG) return bEG - aEG;
    const mcA = mcData.items[a.type] || mcData.itemsByName[a.name];
    const mcB = mcData.items[b.type] || mcData.itemsByName[b.name];
    return (mcB?.food || 0) - (mcA?.food || 0);
  });

  return edibles;
}

function canSeeTarget(bot, target) {
  if (!target || !target.isValid || !target.position) return false;
  if (typeof bot.canSeeEntity === 'function') {
    return bot.canSeeEntity(target);
  }

  try {
    const start = bot.entity.position.offset(0, bot.entity.eyeHeight || 1.6, 0);
    const targetPos = target.position.offset(0, target.height * 0.8, 0);
    const direction = targetPos.minus(start).normalize();
    const distance = start.distanceTo(targetPos);
    const hit = bot.world.raycast(start, direction, distance);
    return !hit;
  } catch (e) {
    return true;
  }
}

async function tryBlockJump(bot, target) {
  if (!target || bot.entity.position.y > target.position.y + 1) return;
  if (bot._lastBlockJump && Date.now() - bot._lastBlockJump < 3000) return;

  const items = bot.inventory.items();
  const blockItem = items.find(i =>
    i.name.includes('dirt') || i.name.includes('cobblestone') ||
    i.name.includes('planks') || i.name.includes('obsidian') ||
    i.name.includes('netherrack') || i.name.includes('stone')
  );
  if (!blockItem) return;

  try {
    const pos = bot.entity.position.floored();
    const blockBelow = bot.blockAt(pos.offset(0, -1, 0));

    if (blockBelow && blockBelow.name === 'air') {
      await bot.equip(blockItem, 'hand');
      bot.lookAt(pos.offset(0.5, -0.5, 0.5), true);
      await withTimeout(bot.placeBlock(blockBelow, new Vec3(0, 1, 0)), 500);
      bot.setControlState('jump', true);
      setTimeout(() => bot.setControlState('jump', false), 200);
      bot._lastBlockJump = Date.now();
    }
  } catch (e) { }
}

function autoEquip(bot, target = null) {
  try {
    const items = bot.inventory.items();
    if (items.length === 0) return;

    const getEquipped = (dest) => {
      if (dest === 'hand') return bot.heldItem;
      const slotMap = { 'head': 5, 'torso': 6, 'legs': 7, 'feet': 8, 'off-hand': 45 };
      return bot.inventory.slots[slotMap[dest]];
    };

    const armorSlots = [
      { name: 'helmet', slot: 'head' },
      { name: 'chestplate', slot: 'torso' },
      { name: 'leggings', slot: 'legs' },
      { name: 'boots', slot: 'feet' }
    ];

    armorSlots.forEach(as => {
      const armor = items.filter(i => i.name.toLowerCase().includes(as.name));
      if (armor.length > 0) {
        armor.sort((a, b) => (b.defense || 0) - (a.defense || 0));
        const best = armor[0];
        const currentEq = getEquipped(as.slot);
        if (!currentEq || currentEq.name !== best.name) {
          console.log('[' + bot.username + '] Equipping ' + best.name + ' to ' + as.slot + ' (current: ' + (currentEq ? currentEq.name : 'none') + ')');
          bot.equip(best, as.slot).then(() => {
            console.log('[' + bot.username + '] Successfully equipped ' + best.name);
          }).catch((err) => {
            console.log('[' + bot.username + '] Failed to equip ' + best.name + ': ' + err.message);
          });
        }
      } else {
        console.log('[' + bot.username + '] No ' + as.name + ' found in inventory (' + items.map(i => i.name).join(', ') + ')');
      }
    });

    const weapons = items.filter(i => i.name.toLowerCase().includes('sword') || i.name.toLowerCase().includes('axe'));
    if (weapons.length > 0) {
      let targetHasShield = false;
      if (target && target.equipment && target.equipment.length > 1) {
        targetHasShield = target.equipment.some(item => item && item.name && item.name.includes('shield'));
      }

      let bestWeapon;
      if (targetHasShield) {
        bestWeapon = weapons.find(i => i.name.toLowerCase().includes('axe'));
      }
      if (!bestWeapon) {
        bestWeapon = weapons.find(i => i.name.toLowerCase().includes('sword'));
        if (!bestWeapon) bestWeapon = weapons[0]; 
      }

      const currentHand = getEquipped('hand');
      if (bestWeapon && (!currentHand || currentHand.name !== bestWeapon.name)) {
        bot.equip(bestWeapon, 'hand').catch(() => { });
      }

      const swords = items.filter(i => i.name.toLowerCase().includes('sword'));
      if (swords.length > 1) {
        swords.sort((a, b) => (b.attackDamage || 0) - (a.attackDamage || 0));
        for (let i = 1; i < swords.length; i++) {
          try { 
            bot.recentToss = Date.now();
            bot.tossStack(swords[i]); 
          } catch (e) { }
        }
      }
    }

    const shields = items.filter(i => i.name.toLowerCase().includes('shield'));
    const totems = items.filter(i => i.name.toLowerCase().includes('totem'));
    const currentOffhand = getEquipped('off-hand');

    const equipOffhand = (item) => {
      if (!currentOffhand || currentOffhand.name !== item.name) {
        bot.equip(item, 'off-hand').catch(() => { });
      }
    };

    if (bot.health < 6 && totems.length > 0) {
      equipOffhand(totems[0]);
    } else if (shields.length > 0) {
      equipOffhand(shields[0]);
    } else if (totems.length > 0) {
      equipOffhand(totems[0]);
    }
  } catch (e) { }
}

function finishTraining() {
  if (combatInterval) clearInterval(combatInterval);
  saveStats();
  const result = { score: stats.score, hits: stats.hits, kills: stats.kills, deaths: stats.deaths, damageDealt: stats.damageDealt, phase: trainingPhase };
  console.log(JSON.stringify(result));
  process.exit(0);
}

function runTrainer(bot) {
  const trainerNum = botIndex - 6;
  const start = trainerNum === 1 ? 0 : 4;
  const end = trainerNum === 1 ? 3 : 5;
  let patrolIdx = start;

  console.log('[' + bot.username + '] Trainer for bots ' + start + '-' + end + ' - patrolling');

  setTimeout(() => {
    let bestBot = null;
    let bestScore = -1;

    for (let i = start; i <= end; i++) {
      try {
        const statsFile = path.join(STATS_DIR, 'bot_' + i + '.json');
        if (fs.existsSync(statsFile)) {
          const data = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
          if (data.score > bestScore) {
            bestScore = data.score;
            bestBot = i;
          }
        }
      } catch (e) { }
    }

    try {
      let allVotes = { trainer1: null, trainer2: null };
      if (fs.existsSync(VOTE_FILE)) {
        allVotes = JSON.parse(fs.readFileSync(VOTE_FILE, 'utf8'));
      }
      if (trainerNum === 1) allVotes.trainer1 = bestBot;
      else allVotes.trainer2 = bestBot;
      fs.writeFileSync(VOTE_FILE, JSON.stringify(allVotes));
    } catch (e) { }

    console.log('[' + bot.username + '] Voted for 9Bot_' + bestBot + ' (score: ' + bestScore + ')');
  }, MAX_TRAIN_TIME + 5000);

  setInterval(() => {
    if (bot.dead) return;

    const grid = getGridPos(patrolIdx);
    patrolIdx++;
    if (patrolIdx > end) patrolIdx = start;

    if (!bot.pathfinder.isMoving()) {
      const offsetX = (Math.random() - 0.5) * 4;
      const offsetZ = (Math.random() - 0.5) * 4;
      bot.pathfinder.setGoal(new pathfinder.goals.GoalBlock(
        grid.x + offsetX, bot.entity.position.y, grid.z + offsetZ
      ));
    }

    const nearby = Object.values(bot.entities).filter(e =>
      e.type === 'player' && e.username && e.username.startsWith('9Bot_') &&
      parseInt(e.username.split('_')[1]) >= start &&
      parseInt(e.username.split('_')[1]) <= end &&
      e.position.distanceTo(bot.entity.position) < 10
    );

    if (nearby.length > 0) {
      const target = nearby[0];
      bot.lookAt(target.position.offset(0, target.height * 0.8, 0));
      if (Math.random() < 0.3) {
        bot.attack(target);
      }
    }
  }, 5000);
}

function runCombatTraining(bot, grid) {
  console.log('[' + bot.username + '] Combat training - waiting for signal');

  const checkStart = setInterval(() => {
    try {
      if (fs.existsSync(SIGNAL_FILE)) {
        clearInterval(checkStart);
        console.log('[' + bot.username + '] Signal received - training!');
        startCombat(bot, grid);
      }
    } catch (e) { }
  }, 500);
}

function startCombat(bot, grid) {
  startTime = Date.now();
  console.log('[' + bot.username + '] Combat training started');

  const returnToGrid = () => {
    if (bot.pathfinder.isMoving()) return;
    bot.pathfinder.setGoal(new pathfinder.goals.GoalBlock(grid.x, bot.entity.position.y, grid.z));
  };

  combatInterval = setInterval(() => {
    if (bot.dead) return;

    const distToGrid = Math.sqrt(
      Math.pow(bot.entity.position.x - grid.x, 2) +
      Math.pow(bot.entity.position.z - grid.z, 2)
    );

    if (distToGrid > 4 && !bot.isAngry) { returnToGrid(); return; }

    let target;
    if (bot.isAngry) {
      target = bot.nearestEntity(e =>
        e.type === 'player' &&
        e.username &&
        !e.username.startsWith('9Bot_') &&
        !e.username.startsWith('Trainer_') &&
        !e.username.startsWith('Manager')
      );
    } else {
      target = bot.nearestEntity(e =>
        e.type === 'player' &&
        e.username &&
        e.username.startsWith('Trainer_') &&
        e.position.distanceTo(bot.entity.position) < 6
      );
    }

    if (bot.isEating && bot._eatStarted && Date.now() - bot._eatStarted > 3000) {
      try { bot.deactivateItem(); } catch(e) {}
      bot.isEating = false;
      bot._eatStarted = null;
    }

    if (bot.health < 8 || bot.food < 8) {
      if (!bot.isEating) {
        const foods = getEdibleItems(bot);
        if (foods.length > 0) {
          bot.isEating = true;
          bot._eatStarted = Date.now();
          bot.pathfinder.stop();
          bot.clearControlStates();
          bot.equip(foods[0], 'hand').then(() => {
            try { bot.activateItem(); } catch (e) { }
            setTimeout(() => {
              try { bot.deactivateItem(); } catch(e) {}
              bot.isEating = false;
              bot._eatStarted = null;
            }, 2000);
          }).catch(() => { bot.isEating = false; bot._eatStarted = null; });
        }
      }
    } else {
      if (bot.isEating) {
        try { bot.deactivateItem(); } catch(e) {}
        bot.isEating = false;
        bot._eatStarted = null;
      }
    }

    if (!bot.isEating) autoEquip(bot, target);

    const nearbyItem = bot.nearestEntity(e => e.name === 'item' && (!bot.ignoredItems || !bot.ignoredItems.has(e.id)) && e.position.distanceTo(bot.entity.position) < 6);
    if (target && target.isValid) {

    } else if (nearbyItem) {
      bot.pathfinder.setGoal(new pathfinder.goals.GoalNear(nearbyItem.position.x, nearbyItem.position.y, nearbyItem.position.z, 0));
      return;
    }

    if (target && target.isValid) {
      lastTarget = target;

      const dist = bot.entity.position.distanceTo(target.position);

      if (dist > 3.5) {
        if (!bot.pathfinder.isMoving()) {
          bot.pathfinder.setGoal(new pathfinder.goals.GoalNear(
            target.position.x, target.position.y, target.position.z, 2
          ));
        }
        bot.lookAt(target.position.offset(0, target.height * 0.8, 0), true);
        return;
      }

      if (bot.pathfinder.isMoving()) {
        bot.pathfinder.stop();
      }

      if (dist < 4 && bot.entity.position.y <= target.position.y) {
        tryBlockJump(bot, target);
      }

      bot.setControlState('sprint', true);
      bot.setControlState('forward', dist > 2.5);

      if (!bot._strafeTimer || Date.now() - bot._strafeTimer > 800) {
        bot._strafeDir = Math.random() > 0.5 ? 'left' : 'right';
        bot._strafeTimer = Date.now();
      }
      bot.setControlState('left', bot._strafeDir === 'left');
      bot.setControlState('right', bot._strafeDir === 'right');

      bot.lookAt(target.position.offset(0, target.height * 0.8, 0), true);

      if (!bot.isEating) {

        if (Math.random() < 0.3) {
          try { bot.activateItem(true); } catch (e) { }
          setTimeout(() => bot.deactivateItem(), 400);
        }

        if (dist <= 3.5 && canSeeTarget(bot, target)) {
          if (Math.random() < 0.85) {

            bot.setControlState('jump', true);
            setTimeout(() => bot.setControlState('jump', false), 120);
            setTimeout(() => {
              if (target && target.isValid && bot.entity.position.distanceTo(target.position) <= 3.5) {
                bot.attack(target);
                stats.score += 15;
              }
            }, 300);
          } else {
            bot.attack(target);
            stats.score += 10;
          }
        }
      }

      if (dist < 1.5) {
        bot.setControlState('back', true);
        setTimeout(() => bot.setControlState('back', false), 300);
      }
    } else {

      bot.setControlState('left', false);
      bot.setControlState('right', false);
      if (!bot.pathfinder.isMoving()) {
        const offsetX = (Math.random() - 0.5) * 3;
        const offsetZ = (Math.random() - 0.5) * 3;
        bot.pathfinder.setGoal(new pathfinder.goals.GoalBlock(
          grid.x + offsetX, bot.entity.position.y, grid.z + offsetZ
        ));
      }
    }
  }, 600);

  setTimeout(finishTraining, MAX_TRAIN_TIME);
}

function startDuel(bot) {
  console.log('[' + bot.username + '] Duel started - moving to arena!');

  const arenaX = 0;
  const arenaZ = -5;
  bot.pathfinder.setGoal(new pathfinder.goals.GoalBlock(arenaX, bot.entity.position.y, arenaZ));

  setTimeout(() => {
    const findOpponent = setInterval(() => {
      const opponent = bot.nearestEntity(e =>
        e.type === 'player' &&
        e.username &&
        e.username.startsWith('9Bot_') &&
        e.username !== bot.username
      );

      if (opponent) {
        const dist = bot.entity.position.distanceTo(opponent.position);
        if (dist > 3) {

          bot.lookAt(opponent.position.offset(0, opponent.height * 0.8, 0));
          bot.pathfinder.setGoal(new pathfinder.goals.GoalNear(
            opponent.position.x, opponent.position.y, opponent.position.z, 2
          ));
        } else {
          clearInterval(findOpponent);
          startDuelCombat(bot);
        }
      } else {
        clearInterval(findOpponent);
        endDuel();
      }
    }, 500);

    setTimeout(() => clearInterval(findOpponent), 10000);
  }, 1000);
}

function startDuelCombat(bot) {
  console.log('[' + bot.username + '] Duel combat started!');

  const duelInterval = setInterval(() => {
    if (bot.dead) { clearInterval(duelInterval); endDuel(); return; }

    if (!bot.isEating) autoEquip(bot);

    const opponent = bot.nearestEntity(e =>
      e.type === 'player' &&
      e.username &&
      e.username.startsWith('9Bot_') &&
      e.username !== bot.username
    );

    if (bot.isEating && bot._eatStarted && Date.now() - bot._eatStarted > 3000) {
      try { bot.deactivateItem(); } catch(e) {}
      bot.isEating = false;
      bot._eatStarted = null;
    }

    if (bot.health < 14) {
      if (!bot.isEating) {
        const foods = getEdibleItems(bot);
        if (foods.length > 0) {
          bot.isEating = true;
          bot._eatStarted = Date.now();
          bot.pathfinder.stop();
          bot.clearControlStates();
          bot.equip(foods[0], 'hand').then(() => {
            try { bot.activateItem(); } catch (e) { }
            setTimeout(() => {
              try { bot.deactivateItem(); } catch(e) {}
              bot.isEating = false;
              bot._eatStarted = null;
            }, 2000);
          }).catch(() => { bot.isEating = false; bot._eatStarted = null; });
        }
      }
    } else {
      if (bot.isEating) {
        try { bot.deactivateItem(); } catch(e) {}
        bot.isEating = false;
        bot._eatStarted = null;
      }
    }

    if (!opponent || !opponent.isValid) {
      clearInterval(duelInterval);
      endDuel();
      return;
    }

    const dist = bot.entity.position.distanceTo(opponent.position);

    if (dist > 3.5) {
      if (!bot.pathfinder.isMoving()) {
        bot.pathfinder.setGoal(new pathfinder.goals.GoalNear(
          opponent.position.x, opponent.position.y, opponent.position.z, 2
        ));
      }
      return;
    }

    if (bot.pathfinder.isMoving()) {
      bot.pathfinder.stop();
    }

    lastTarget = opponent;

    if (dist < 4 && bot.entity.position.y <= opponent.position.y) {
      tryBlockJump(bot, opponent);
    }

    bot.setControlState('sprint', true);
    bot.setControlState('forward', dist > 2.5);

    if (!bot._strafeTimer || Date.now() - bot._strafeTimer > 800) {
      bot._strafeDir = Math.random() > 0.5 ? 'left' : 'right';
      bot._strafeTimer = Date.now();
    }
    bot.setControlState('left', bot._strafeDir === 'left');
    bot.setControlState('right', bot._strafeDir === 'right');

    bot.lookAt(opponent.position.offset(0, opponent.height * 0.8, 0), true);

    if (!bot.isEating) {

      if (Math.random() < 0.3) {
        try { bot.activateItem(true); } catch (e) { }
        setTimeout(() => bot.deactivateItem(), 400);
      }

      if (dist <= 3.5 && canSeeTarget(bot, opponent)) {
        if (Math.random() < 0.85) {

          bot.setControlState('jump', true);
          setTimeout(() => bot.setControlState('jump', false), 120);
          setTimeout(() => {
            if (opponent && opponent.isValid && bot.entity.position.distanceTo(opponent.position) <= 3.5) {
              bot.attack(opponent);
              stats.score += 15;
            }
          }, 300);
        } else {
          bot.attack(opponent);
          stats.score += 10;
        }
      }

      if (dist < 1.5) {
        bot.setControlState('back', true);
        setTimeout(() => bot.setControlState('back', false), 300);
      }
    }
  }, 600);

  setTimeout(() => {
    clearInterval(duelInterval);
    endDuel();
  }, 55000);
}

function runUserDuel(bot) {
  console.log('[' + bot.username + '] User duel mode!');

  setTimeout(() => {
    const duelInterval = setInterval(() => {
      if (bot.dead) { clearInterval(duelInterval); endDuel(); return; }

      const opponent = bot.nearestEntity(e =>
        e.type === 'player' &&
        !e.username.startsWith('9Bot_') &&
        !e.username.startsWith('Trainer_') &&
        !e.username.startsWith('Manager')
      );

      if (bot.isEating && bot._eatStarted && Date.now() - bot._eatStarted > 3000) {
        try { bot.deactivateItem(); } catch(e) {}
        bot.isEating = false;
        bot._eatStarted = null;
      }

      if (bot.health < 14) {
        if (!bot.isEating) {
          const foods = getEdibleItems(bot);
          if (foods.length > 0) {
            bot.isEating = true;
            bot._eatStarted = Date.now();
            bot.pathfinder.stop();
            bot.clearControlStates();
            bot.equip(foods[0], 'hand').then(() => {
              try { bot.activateItem(); } catch (e) { }
              setTimeout(() => {
                try { bot.deactivateItem(); } catch(e) {}
                bot.isEating = false;
                bot._eatStarted = null;
              }, 2000);
            }).catch(() => { bot.isEating = false; bot._eatStarted = null; });
          }
        }
      } else {
        if (bot.isEating) {
          try { bot.deactivateItem(); } catch(e) {}
          bot.isEating = false;
          bot._eatStarted = null;
        }
      }

      if (!opponent || !opponent.isValid) {
        clearInterval(duelInterval);
        endDuel();
        return;
      }

      const dist = bot.entity.position.distanceTo(opponent.position);

      if (dist > 3.5) {
        if (!bot.pathfinder.isMoving()) {
          bot.pathfinder.setGoal(new pathfinder.goals.GoalNear(
            opponent.position.x, opponent.position.y, opponent.position.z, 2
          ));
        }
        return;
      }

      if (bot.pathfinder.isMoving()) {
        bot.pathfinder.stop();
      }

      if (!bot.isEating) autoEquip(bot, opponent);

      if (dist < 4 && bot.entity.position.y <= opponent.position.y) {
        tryBlockJump(bot, opponent);
      }

      bot.setControlState('sprint', true);
      bot.setControlState('forward', dist > 2.5);

      if (!bot._strafeTimer || Date.now() - bot._strafeTimer > 800) {
        bot._strafeDir = Math.random() > 0.5 ? 'left' : 'right';
        bot._strafeTimer = Date.now();
      }
      bot.setControlState('left', bot._strafeDir === 'left');
      bot.setControlState('right', bot._strafeDir === 'right');

      bot.lookAt(opponent.position.offset(0, opponent.height * 0.8, 0), true);

      if (!bot.isEating) {

        if (Math.random() < 0.3) {
          try { bot.activateItem(true); } catch (e) { }
          setTimeout(() => bot.deactivateItem(), 400);
        }

        if (dist <= 3.5 && canSeeTarget(bot, opponent)) {
          if (Math.random() < 0.85) {

            bot.setControlState('jump', true);
            setTimeout(() => bot.setControlState('jump', false), 120);
            setTimeout(() => {
              if (opponent && opponent.isValid && bot.entity.position.distanceTo(opponent.position) <= 3.5) {
                bot.attack(opponent);
                stats.score += 15;
              }
            }, 300);
          } else {
            bot.attack(opponent);
            stats.score += 10;
          }
        }

        if (dist < 1.5) {
          bot.setControlState('back', true);
          setTimeout(() => bot.setControlState('back', false), 300);
        }
      }
    }, 600);

    setTimeout(() => {
      clearInterval(duelInterval);
      endDuel();
    }, 55000);
  }, 1000);
}

function endDuel() {
  saveStats();
  const result = { score: stats.score, winner: stats.kills > 0, phase: 'duel' };
  console.log(JSON.stringify(result));
  process.exit(0);
}

function runManager(bot) {
  console.log('[' + bot.username + '] Manager online');

  bot.chat('9Bot Manager online! Commands: !help, !status, !duel, !startduel');

  bot.on('chat', (username, message) => {
    if (username === bot.username) return;
    const msg = message.toLowerCase().trim();
    if (!msg.startsWith('!')) return;

    if (msg === '!help') {
      bot.chat('!help - Show commands | !status - Training status');
    } else if (msg === '!status') {
      bot.chat('Training in progress.');
    }
  });

  setInterval(() => {
    if (bot.dead) return;
    bot.chat('9Bot training active! Type !help for commands.');
  }, 30000);
}

process.on('uncaughtException', (err) => {
  console.error('[Bot] Uncaught: ' + err.message);
  process.exit(1);
});

init()

const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
]);

async function attemptCrystalPvp(bot, target) {
  bot.isCrystaling = true;
  bot.clearControlStates();

  try {
    const items = bot.inventory.items();
    const obby = items.find(i => i.name.includes('obsidian') || i.name.includes('obsidian'));
    const crystal = items.find(i => i.name.includes('end_crystal'));

    if (!crystal) { bot.isCrystaling = false; return; }

    const targetFeet = target.position.floored();
    const blockBelowTarget = bot.blockAt(targetFeet.offset(0, -1, 0));

    if (!blockBelowTarget || (!blockBelowTarget.name.includes('obsidian') && !blockBelowTarget.name.includes('bedrock'))) {
      if (!obby) { bot.isCrystaling = false; return; }

      const dist = bot.entity.position.distanceTo(target.position);
      if (dist > 3) {
        bot.pathfinder.setGoal(new pathfinder.goals.GoalNear(target.position.x, target.position.y, target.position.z, 2));
        await new Promise(r => setTimeout(r, 500));
        bot.isCrystaling = false;
        return;
      }

      try {
        await bot.equip(obby, 'hand');
        const placePos = targetFeet.offset(0, -1, 0);
        const targetBlock = bot.blockAt(placePos);
        if (targetBlock && targetBlock.name === 'air') {

          const against = bot.blockAt(placePos.offset(1, 0, 0));
          if (against && against.name !== 'air') {
            bot.lookAt(against.position.offset(0.5, 0.5, 0.5), true);
            await withTimeout(bot.placeBlock(against, new Vec3(-1, 0, 0)), 500);
          }
        }
      } catch (e) { }
    }

    const obsidianBlock = bot.blockAt(targetFeet.offset(0, -1, 0));
    if (!obsidianBlock || (!obsidianBlock.name.includes('obsidian') && !obsidianBlock.name.includes('bedrock'))) {
      bot.isCrystaling = false; return;
    }

    try {
      await bot.equip(crystal, 'hand');
      bot.lookAt(obsidianBlock.position.offset(0.5, 1, 0.5), true);
      await withTimeout(bot.placeBlock(obsidianBlock, new Vec3(0, 1, 0)), 500);
    } catch (e) { }

    await new Promise(r => setTimeout(r, 50));
    const crystalEntity = bot.nearestEntity(e =>
      e.name === 'end_crystal' &&
      e.position.distanceTo(obsidianBlock.position) < 3
    );

    if (crystalEntity) {

      if (canSeeTarget(bot, target)) {
        bot.lookAt(target.position.offset(0, target.height * 0.8, 0), true);
        bot.attack(target);
        await new Promise(r => setTimeout(r, 100));
      }

      bot.lookAt(crystalEntity.position, true);
      await new Promise(r => setTimeout(r, 50));
      bot.attack(crystalEntity);
      bot.isCrystaling = false;
      return;
    }

    bot.isCrystaling = false;
  } catch (e) {
    bot.isCrystaling = false;
  }
}

async function handleStuck(bot) {
  if (bot.dead || !bot.entity) return;
  console.log('[' + bot.username + '] Stuck, attempting escape...');  
  const pos = bot.entity.position.floored();
  const blockAtFeet = bot.blockAt(pos);
  if (blockAtFeet && blockAtFeet.name !== 'air') return;

  const adjacent = [
    pos.offset(1, 0, 0), pos.offset(-1, 0, 0),
    pos.offset(0, 0, 1), pos.offset(0, 0, -1)
  ];
  let isHole = true;
  for (const adj of adjacent) {
    const adjBlock = bot.blockAt(adj);
    if (adjBlock && adjBlock.position.y >= pos.y) {
      isHole = false;
      break;
    }
  }

  if (isHole) {

    const items = bot.inventory.items();
    const placeable = items.find(i => 
      i.name.includes('dirt') || i.name.includes('cobblestone') || 
      i.name.includes('planks') || i.name.includes('obsidian')
    );
    if (!placeable) return;

    const blockBelowPos = pos.offset(0, -1, 0);
    const blockBelow = bot.blockAt(blockBelowPos);
    if (blockBelow && blockBelow.name === 'air') {
      try {
        await bot.equip(placeable, 'hand');
        bot.lookAt(blockBelowPos.offset(0.5, 0.5, 0.5), true);
        await bot.placeBlock(blockBelow, new Vec3(0, 1, 0));
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 100);
      } catch (e) {}
    }
  } else {

    const goal = bot.pathfinder.goal?.position;
    if (goal) {
      const blockInWay = bot.blockAt(goal.floored());
      if (blockInWay && blockInWay.name !== 'air') {
        try {
          const tool = bot.inventory.items().find(i => 
            i.name.includes('pickaxe') || i.name.includes('axe') || i.name.includes('shovel')
          );
          if (tool) await bot.equip(tool, 'hand');
          await bot.dig(blockInWay);
        } catch (e) {}
      }
    }
  }
}

const { handleBuildingCommand } = require('./building_ml.js');

async function runBuildingTraining(bot, grid) {
  console.log('[' + bot.username + '] Building training phase started');

  setTimeout(async () => {
    for (let i = 0; i < 3; i++) {
      if (bot.dead) break;
      await handleBuildingCommand(bot, 'something');
      await new Promise(r => setTimeout(r, 5000));
    }
    process.exit(0);
  }, 5000);
}
