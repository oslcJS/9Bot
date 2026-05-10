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

const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
  white: '\x1b[37m',
  blue: '\x1b[34m'
};

const ASCII_BANNER = `${colors.cyan}▄▄▄▄    ▄▄▄▄▄▄
▄██▀▀██▄  ██▀▀▀▀██              ██
██    ██  ██    ██   ▄████▄   ███████
▀██▄▄███  ███████   ██▀  ▀██    ██
▀▀▀ ██  ██    ██  ██    ██    ██
█▄▄▄██   ██▄▄▄▄██  ▀██▄▄██▀    ██▄▄▄
▀▀▀▀    ▀▀▀▀▀▀▀     ▀▀▀▀       ▀▀▀▀${colors.reset}
${colors.green}══════════════════════════════════════════════════${colors.reset}`;

function log(message, color = 'white') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStatus(message) {
  log(`[9Bot] ${message}`, 'blue');
}

let cliInterface;
let commandHistory = [];
let historyIndex = -1;
let bot = null;
let botName = '';
let cliInitialized = false;

function initCLI() {
  if (cliInitialized) return;
  cliInitialized = true;
  console.log(ASCII_BANNER);
  console.log(`${colors.green}9Bot CLI initialized. Type /help for commands.${colors.reset}`);
  console.log('');

  cliInterface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${colors.cyan}>>>${colors.reset} `
  });

  cliInterface.on('line', (input) => {
    const text = input.trim();
    if (text) {
      executeCommand(text);
      commandHistory.push(text);
      historyIndex = commandHistory.length;
    }
    cliInterface.prompt();
  });

  cliInterface.on('close', () => {
    process.exit(0);
  });

  process.on('SIGINT', () => {
    logStatus('Use /quit or Ctrl+D to exit');
    cliInterface.prompt();
  });

  cliInterface.prompt();
}

function executeCommand(cmd) {
  if (cmd.startsWith('/')) {
    const parts = cmd.slice(1).split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (command) {
      case 'say':
        if (!bot) {
          log('Bot not connected yet!', 'red');
        } else if (!args) {
          log('Usage: /say <message>', 'yellow');
        } else {
          bot.chat(args);
          log(`Bot said: ${args}`, 'green');
        }
        break;

      case 'help':
        log('Available commands:', 'yellow');
        log('  /say <text> - Make bot say something in chat', 'white');
        log('  /status - Show bot status', 'white');
        log('  /coords - Show bot coordinates', 'white');
        log('  /players - List nearby players', 'white');
        log('  /equip - Show equipped items', 'white');
        log('  /health - Show bot health/hunger', 'white');
        log('  /goto <x> <y> <z> - Move to coordinates', 'white');
        log('  /stop - Stop current movement', 'white');
        log('  /help - Show this help', 'white');
        log('  /quit or /exit - Exit the bot', 'white');
        break;

      case 'status':
        if (!bot) {
          log('Bot not connected!', 'red');
        } else {
          log(`Bot: ${botName}`, 'green');
          log(`State: ${bot.dead ? 'DEAD' : 'Alive'}`, bot.dead ? 'red' : 'green');
          log(`Phase: ${trainingPhase}`, 'cyan');
        }
        break;

      case 'coords':
        if (!bot || !bot.entity) {
          log('Bot not spawned yet!', 'red');
        } else {
          const pos = bot.entity.position;
          log(`Position: X=${pos.x.toFixed(2)}, Y=${pos.y.toFixed(2)}, Z=${pos.z.toFixed(2)}`, 'green');
        }
        break;

      case 'players':
        if (!bot) {
          log('Bot not connected!', 'red');
        } else {
          const players = Object.values(bot.players);
          log(`Nearby players (${players.length}):`, 'cyan');
          players.forEach(p => {
            const dist = bot.entity ? bot.entity.position.distanceTo(p.entity.position) : '?';
            log(`  ${p.username} (${p.ping}ms, dist: ${dist})`, 'white');
          });
        }
        break;

      case 'equip':
        if (!bot) {
          log('Bot not connected!', 'red');
        } else {
          const held = bot.heldItem;
          log(`Held: ${held ? held.name : 'empty'}`, 'green');
          const slots = {head: 5, torso: 6, legs: 7, feet: 8};
          for (const [slot, id] of Object.entries(slots)) {
            const item = bot.inventory.slots[id];
            log(`${slot}: ${item ? item.name : 'empty'}`, 'cyan');
          }
        }
        break;

      case 'health':
        if (!bot || !bot.entity) {
          log('Bot not spawned yet!', 'red');
        } else {
          log(`Health: ${bot.health}/20`, bot.health > 10 ? 'green' : 'red');
          log(`Food: ${bot.food}/20`, bot.food > 10 ? 'green' : 'yellow');
          log(`Score: ${stats.score}`, 'cyan');
        }
        break;

      case 'goto':
        if (!bot) {
          log('Bot not connected!', 'red');
        } else {
          const coords = args.split(' ').map(Number);
          if (coords.length < 3 || coords.some(isNaN)) {
            log('Usage: /goto <x> <y> <z>', 'yellow');
          } else {
            const goal = new pathfinder.goals.GoalBlock(coords[0], coords[1], coords[2]);
            bot.pathfinder.setGoal(goal);
            log(`Moving to ${coords[0]}, ${coords[1]}, ${coords[2]}`, 'green');
          }
        }
        break;

      case 'build':
        if (!bot) {
          log('Bot not connected!', 'red');
        } else {
          log('Manual build trigger...', 'cyan');
          handleBuildingCommand(bot, 'something');
        }
        break;

      case 'stop':
        if (!bot) {
          log('Bot not connected!', 'red');
        } else {
          bot.pathfinder.stop();
          bot.clearControlStates();
          log('Movement stopped', 'yellow');
        }
        break;

      case 'quit':
      case 'exit':
        log('Shutting down...', 'yellow');
        setTimeout(() => process.exit(0), 500);
        break;

      default:
        log(`Unknown command: ${command}. Type /help for available commands.`, 'red');
    }
  } else {
    log('Commands must start with /. Type /help for available commands.', 'yellow');
  }
}

function getGridPos(index) {
  return {
    x: BASE_X + (index % 5) * GRID_SPACE,
    z: BASE_Z + Math.floor(index / 5) * GRID_SPACE
  };
}

let stats = { hits: 0, kills: 0, deaths: 0, damageDealt: 0, damageTaken: 0, score: 0 };
let startTime = null;
const MAX_TRAIN_TIME = 90000;
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
    if (username === botName) return;
    const msg = message.toLowerCase().trim();

    if (msg.includes('build me something')) {
      log(`Building request from ${username}`, 'cyan');
      handleBuildingCommand(bot, 'something');
      return; 
    }

    if (!msg.startsWith('!')) return;

    if (msg === '!help') {
      bot.chat('!help - Commands | build me something - Trigger building');
      log(`In-game command: ${username} used !help`, 'gray');
    } else if (msg === '!ihateyou') {
      bot.permanentlyAngry = true;
      bot.chat('GRAAAAAAAAAH!');
      log(`In-game command: ${username} used !ihateyou - Bot is now permanently angry!`, 'red');
    }
  });
}

async function init() {
  initCLI();

  let name;
  if (isTrainer) name = 'Trainer_' + (botIndex - 6);
  else if (botIndex === MANAGER_INDEX) name = 'Manager';
  else name = '9Bot_' + botIndex;

  botName = name;

  log(`Connecting to ${config.serverHost || 'localhost'}:${config.serverPort} as ${name}...`, 'cyan');

  bot = mineflayer.createBot({
    host: config.serverHost || 'localhost',
    port: config.serverPort,
    username: name,
    version: config.version,
    checkVersion: false
  });

  bot.loadPlugin(pathfinder.pathfinder);

  bot.on('login', () => {
    log(`Logged in as ${name}`, 'green');
    logStatus(`Connected as ${name} | Phase: ${trainingPhase}`);
  });

  bot.on('error', (err) => {
    log(`Connection error: ${err.message}`, 'red');
  });

  bot.on('end', () => {
    log(`Connection ended`, 'yellow');
  });

  const connTimeout = setTimeout(() => {
    if (!bot.entity) {
      log(`Connection timeout after 10s - is server running on port ${config.serverPort}?`, 'red');
      process.exit(1);
    }
  }, 10000);

  bot.once('login', () => clearTimeout(connTimeout));

  bot.loadPlugin(pathfinder.pathfinder);

  bot.on('login', () => {
    log(`Logged in as ${name}`, 'green');
    logStatus(`Connected as ${name} | Phase: ${trainingPhase}`);
  });

  bot.on('error', (err) => {
    log(`Connection error: ${err.message}`, 'red');
  });

  bot.on('end', () => {
    log(`Connection ended`, 'yellow');
  });

  bot.once('spawn', () => {
    if (!bot.entity) {
      log('Entity not ready after spawn!', 'red');
      return;
    }
    const grid = getGridPos(botIndex);
    log(`Spawned at grid (${grid.x}, ${grid.z}) - Phase: ${trainingPhase}`, 'green');
    logStatus(`${name} | Spawned at (${grid.x}, ${grid.z}) | Phase: ${trainingPhase}`);

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

    if (!isTrainer && botIndex !== MANAGER_INDEX) {
      bot.on('death', () => {
        stats.deaths++;
        log(`Died (${stats.deaths}) | Hits:${stats.hits} Kills:${stats.kills}`, 'red');
        saveStats();

        setTimeout(() => bot.respawn(), 1000);
      });

      let angerHits = 0;
      setInterval(() => { if (angerHits > 0) angerHits--; }, 5000);

      bot.on('playerCollect', (collector, collected) => {
        if (collector === bot.entity) {

          if (bot.recentToss && Date.now() - bot.recentToss < 5000) {
            return;
          }
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
      log(`Error: ${err.message}`, 'red');
    });

    bot.on('chat', (username, message) => {
      if (username !== botName) {
        log(`<${username}> ${message}`, 'gray');
      }
    });

    setupChatCommands(bot, name);

    if (isTrainer) runTrainer(bot);
    else if (botIndex === MANAGER_INDEX) runManager(bot);
    else if (trainingPhase === 'combat') runCombatTraining(bot, grid);
    else if (trainingPhase === 'duel') startDuel(bot);
    else if (trainingPhase === 'userduel') runUserDuel(bot);
  });
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

function naturalLookAt(bot, target) {
  if (!target || !target.position || !bot.entity) return;

  const now = Date.now();

  if (!bot._glanceUntil || now > bot._glanceUntil) {
    if (Math.random() < 0.02) {

      bot._glanceOffset = (Math.random() - 0.5) * 1.2; 
      bot._glanceUntil = now + 200 + Math.random() * 400;
    }
  }

  if (!bot._lookJitter || now - bot._lookJitterTime > 300 + Math.random() * 400) {
    bot._lookJitter = (Math.random() - 0.5) * 0.25; 
    bot._lookJitterTime = now;
  }

  const aimPoint = target.position.offset(0, target.height * (0.75 + bot._lookJitter), 0);

  const dx = aimPoint.x - bot.entity.position.x;
  const dy = aimPoint.y - (bot.entity.position.y + (bot.entity.eyeHeight || 1.6));
  const dz = aimPoint.z - bot.entity.position.z;
  const groundDist = Math.sqrt(dx * dx + dz * dz);

  let desiredYaw = Math.atan2(-dx, dz);
  let desiredPitch = Math.atan2(-dy, groundDist);

  if (bot._glanceUntil && now < bot._glanceUntil && bot._glanceOffset) {
    desiredYaw += bot._glanceOffset;
  }

  const currentYaw = bot.entity.yaw;
  const currentPitch = bot.entity.pitch;

  let dyaw = desiredYaw - currentYaw;
  while (dyaw > Math.PI) dyaw -= 2 * Math.PI;
  while (dyaw < -Math.PI) dyaw += 2 * Math.PI;

  const dpitch = desiredPitch - currentPitch;

  const yawDist = Math.abs(dyaw);
  const lerpFactor = 0.35 + Math.min(yawDist / Math.PI, 1) * 0.45; 

  const newYaw = currentYaw + dyaw * lerpFactor;
  const newPitch = currentPitch + dpitch * lerpFactor;

  bot.look(newYaw, newPitch, false);
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
      await bot.placeBlock(blockBelow, new Vec3(0, 1, 0));
      bot.setControlState('jump', true);
      setTimeout(() => bot.setControlState('jump', false), 200);
      bot._lastBlockJump = Date.now();
    }
  } catch (e) { }
}

async function tryClimbToTarget(bot, target) {
  if (!target || !bot.entity) return;

  if (bot._climbTimer && Date.now() - bot._climbTimer < 1500) return;

  const botY = bot.entity.position.y;
  const targetY = target.position.y;
  const heightDiff = targetY - botY;

  if (heightDiff < 3) return;

  const targetFeet = target.position.floored();
  const blockUnderTarget = bot.blockAt(targetFeet.offset(0, -1, 0));
  if (!blockUnderTarget || blockUnderTarget.name === 'air') return;

  const placeableNames = [
    'cobblestone', 'dirt', 'netherrack', 'stone', 'gravel', 'sand',
    'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks',
    'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks',
    'crimson_planks', 'warped_planks', 'obsidian', 'deepslate',
    'cobbled_deepslate', 'andesite', 'diorite', 'granite'
  ];
  const blockItem = bot.inventory.items().find(i =>
  placeableNames.some(n => i.name.includes(n))
  );
  if (!blockItem) return;

  bot._climbTimer = Date.now();

  try {
    const pos = bot.entity.position.floored();
    const blockBelow = bot.blockAt(pos.offset(0, -1, 0));

    if (blockBelow) {
      bot.pathfinder.stop();
      bot.clearControlStates();
      await bot.equip(blockItem, 'hand');

      await bot.look(bot.entity.yaw, -Math.PI / 2, true);
      try {
        await bot.placeBlock(blockBelow, new Vec3(0, 1, 0));
      } catch (e) {

        const blockAtFeet = bot.blockAt(pos);
        if (blockAtFeet && blockAtFeet.name !== 'air') {
          try { await bot.placeBlock(blockAtFeet, new Vec3(0, 1, 0)); } catch (_) {}
        }
      }
      bot.setControlState('jump', true);
      setTimeout(() => bot.setControlState('jump', false), 250);
    }
  } catch (e) {}
}

function autoEquip(bot, target = null) {
  try {
    if (bot._equipTimer && Date.now() - bot._equipTimer < 2000) return;
    bot._equipTimer = Date.now();

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

        if (currentEq && currentEq.name === best.name && currentEq.type === best.type) {

          if (armor.length > 1) {
            for (let i = 1; i < armor.length; i++) {
              if (!(bot._lastToss && Date.now() - bot._lastToss < 5000)) {
                try {
                  bot._lastToss = Date.now();
                  bot.recentToss = Date.now();
                  bot.tossStack(armor[i]);
                } catch (e) { }
              }
            }
          }
          return;
        }

        if (bot._lastEquip && bot._lastEquip.name === best.name && bot._lastEquip.slot === as.slot && Date.now() - bot._lastEquip.time < 3000) {
          return;
        }

        log(`Equipping ${best.name} to ${as.slot} (current: ${currentEq ? currentEq.name : 'none'})`, 'cyan');
        bot._lastEquip = { name: best.name, slot: as.slot, time: Date.now() };
        bot.equip(best, as.slot).then(() => {
          log(`Successfully equipped ${best.name}`, 'green');

          if (armor.length > 1) {
            for (let i = 1; i < armor.length; i++) {
              if (!(bot._lastToss && Date.now() - bot._lastToss < 5000)) {
                try {
                  bot._lastToss = Date.now();
                  bot.recentToss = Date.now();
                  bot.tossStack(armor[i]);
                } catch (e) { }
              }
            }
          }
        }).catch((err) => {
          log(`Failed to equip ${best.name}: ${err.message}`, 'red');
        });
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

        if (!(bot._lastEquip && bot._lastEquip.name === bestWeapon.name && bot._lastEquip.slot === 'hand' && Date.now() - bot._lastEquip.time < 3000)) {
          bot._lastEquip = { name: bestWeapon.name, slot: 'hand', time: Date.now() };
          bot.equip(bestWeapon, 'hand').catch(() => { });
        }
      }

      if (!(bot._lastToss && Date.now() - bot._lastToss < 5000)) {
        const swords = items.filter(i => i.name.toLowerCase().includes('sword'));
        if (swords.length > 1) {
          swords.sort((a, b) => (b.attackDamage || 0) - (a.attackDamage || 0));
          for (let i = 1; i < swords.length; i++) {
            try {
              bot._lastToss = Date.now();
              bot.recentToss = Date.now();
              bot.tossStack(swords[i]);
            } catch (e) { }
          }
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
  log(`Training finished: ${JSON.stringify(result)}`, 'cyan');
  process.exit(0);
}

function runTrainer(bot) {
  const trainerNum = botIndex - 6;
  const start = trainerNum === 1 ? 0 : 4;
  const end = trainerNum === 1 ? 3 : 5;
  let patrolIdx = start;

  log(`Trainer for bots ${start}-${end} - patrolling`, 'magenta');

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

    log(`Voted for 9Bot_${bestBot} (score: ${bestScore})`, 'magenta');
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
      naturalLookAt(bot, target);
      if (Math.random() < 0.3) {
        bot.attack(target);
      }
    }
  }, 5000);
}

function runCombatTraining(bot, grid) {
  log('Combat training - waiting for signal', 'yellow');

  const checkStart = setInterval(() => {
    try {
      if (fs.existsSync(SIGNAL_FILE)) {
        clearInterval(checkStart);
        log('Signal received - training!', 'green');
        startCombat(bot, grid);
      }
    } catch (e) { }
  }, 500);
}

function startCombat(bot, grid) {
  startTime = Date.now();
  log('Combat training started', 'green');

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

    if (distToGrid > 4 && !bot.isAngry && !bot.permanentlyAngry) { returnToGrid(); return; }

    let target;
    if (bot.isAngry || bot.permanentlyAngry) {
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
        naturalLookAt(bot, target);
        return;
      }

      if (bot.pathfinder.isMoving()) {
        bot.pathfinder.stop();
      }

      if (dist < 4 && bot.entity.position.y <= target.position.y) {
        tryBlockJump(bot, target);
      }

      tryClimbToTarget(bot, target);

      bot.setControlState('sprint', true);
      bot.setControlState('forward', dist > 2.5);

      if (!bot._strafeTimer || Date.now() - bot._strafeTimer > 800) {
        bot._strafeDir = Math.random() > 0.5 ? 'left' : 'right';
        bot._strafeTimer = Date.now();
      }
      bot.setControlState('left', bot._strafeDir === 'left');
      bot.setControlState('right', bot._strafeDir === 'right');

      naturalLookAt(bot, target);

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

}

function startDuel(bot) {
  log('Duel started - moving to arena!', 'magenta');

  const arenaX = 0;
  const arenaZ = -5;
  bot.pathfinder.setGoal(new pathfinder.goals.GoalBlock(arenaX, bot.entity.position.y, arenaZ));

  setTimeout(() => {
    const findOpponent = setInterval(() => {
      const opponent = bot.nearestEntity(e =>
      e.type === 'player' &&
      e.username &&
      e.username.startsWith('9Bot_') &&
      e.username !== botName
      );

      if (opponent) {
        const dist = bot.entity.position.distanceTo(opponent.position);
        if (dist > 3) {

          naturalLookAt(bot, opponent);
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
  log('Duel combat started!', 'magenta');

  const duelInterval = setInterval(() => {
    if (bot.dead) { clearInterval(duelInterval); endDuel(); return; }

    if (!bot.isEating) autoEquip(bot);

    const opponent = bot.nearestEntity(e =>
    e.type === 'player' &&
    e.username &&
    e.username.startsWith('9Bot_') &&
    e.username !== botName
    );

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

          if (opponent && opponent.position) {
            const away = bot.entity.position.plus(bot.entity.position.minus(opponent.position).normalize().scale(8));
            bot.pathfinder.setGoal(new pathfinder.goals.GoalNear(away.x, away.y, away.z, 1));
          }
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

    tryClimbToTarget(bot, opponent);

    bot.setControlState('sprint', true);
    bot.setControlState('forward', dist > 2.5);

    if (!bot._strafeTimer || Date.now() - bot._strafeTimer > 800) {
      bot._strafeDir = Math.random() > 0.5 ? 'left' : 'right';
      bot._strafeTimer = Date.now();
    }
    bot.setControlState('left', bot._strafeDir === 'left');
    bot.setControlState('right', bot._strafeDir === 'right');

    naturalLookAt(bot, opponent);

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

}

function runUserDuel(bot) {
  log('User duel mode!', 'magenta');

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

      if (bot.health < 8) {
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

      if (!bot.isEating) autoEquip(bot, opponent);

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

      tryClimbToTarget(bot, opponent);

      bot.setControlState('sprint', true);
      bot.setControlState('forward', dist > 2.5);

      if (!bot._strafeTimer || Date.now() - bot._strafeTimer > 800) {
        bot._strafeDir = Math.random() > 0.5 ? 'left' : 'right';
        bot._strafeTimer = Date.now();
      }
      bot.setControlState('left', bot._strafeDir === 'left');
      bot.setControlState('right', bot._strafeDir === 'right');

      naturalLookAt(bot, opponent);

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

  }, 1000);
}

function endDuel() {
  saveStats();
  const result = { score: stats.score, winner: stats.kills > 0, phase: 'duel' };
  log(`Duel ended: ${JSON.stringify(result)}`, 'magenta');
  process.exit(0);
}

function runManager(bot) {
  log('Manager online', 'green');
  logStatus(`${botName} | Manager Mode`);

  bot.chat('9Bot Manager online! Commands: !help, !status, !duel, !startduel');

  bot.on('chat', (username, message) => {
    if (username === botName) return;
    const msg = message.toLowerCase().trim();
    log(`<${username}> ${message}`, 'gray');
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
  log(`Uncaught exception: ${err.message}`, 'red');
  process.exit(1);
});

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
        naturalLookAt(bot, target);
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
  log('Stuck, attempting escape...', 'yellow');
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

init().catch(err => { console.error('Init error:', err); process.exit(1); });

const { handleBuildingCommand } = require('./building_ml.js');

async function runBuildingTraining(bot, grid) {
  log('Building training phase started', 'cyan');

  bot.chat('/give @s oak_planks 64');
  bot.chat('/give @s cobblestone 64');

  setTimeout(async () => {
    for (let i = 0; i < 3; i++) {
      if (bot.dead) break;
      await handleBuildingCommand(bot, 'something');
      await new Promise(r => setTimeout(r, 5000));
    }
    finishTraining();
  }, 5000);
}
