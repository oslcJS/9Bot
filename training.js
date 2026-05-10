const readline = require('readline')
const fs = require('fs')
const path = require('path')
const { MovementTrainer, NeuralNetwork, MovementSimulation, MODELS_DIR, generateModelName } = require('./movement_ml.js')

const config = require('./config.json')

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '\x1b[36m9BotML>\x1b[0m '
})

const COLORS = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
  blue: '\x1b[34m'
}

function log(msg, color = 'white') {
  const c = COLORS[color] || ''
  console.log(`${c}${msg}${COLORS.reset}`)
}

function printBanner() {
  console.log(`${COLORS.cyan}▄▄▄▄    ▄▄▄▄▄▄`)
  console.log(`▄██▀▀██▄  ██▀▀▀▀██              ██`)
  console.log(`██    ██  ██    ██   ▄████▄   ███████`)
  console.log(`▀██▄▄███  ███████   ██▀  ▀██    ██`)
  console.log(`▀▀▀ ██  ██    ██  ██    ██    ██`)
  console.log(`█▄▄▄██   ██▄▄▄▄██  ▀██▄▄██▀    ██▄▄▄`)
  console.log(`▀▀▀▀    ▀▀▀▀▀▀▀     ▀▀▀▀       ▀▀▀▀${COLORS.reset}`)
  console.log(`${COLORS.green}══════════════════════════════════════════════════${COLORS.reset}`)
  console.log('')
}

function printHelp() {
  log('Available commands:', 'yellow')
  log('  train movement [opts]    Train a movement neural network', 'white')
  log('    --gens=N               Generations (default: 50)', 'gray')
  log('    --pop=N                Population size (default: 50)', 'gray')
  log('    --rate=N               Mutation rate (default: 0.3)', 'gray')
  log('  test <model.json>        Test a trained model visually', 'white')
  log('  list                     List saved models', 'white')
  log('  evolve                   Run genetic algorithm', 'white')
  log('  status                   Show training system info', 'white')
  log('  help                     Show this help', 'white')
  log('  quit                     Exit', 'white')
}

function listModels() {
  if (!fs.existsSync(MODELS_DIR)) {
    log('No models directory found.', 'yellow')
    return
  }
  const files = fs.readdirSync(MODELS_DIR).filter(f => f.endsWith('.json'))
  if (files.length === 0) {
    log('No trained models found.', 'yellow')
    return
  }
  log(`Models (${files.length}):`, 'cyan')
  files.sort().forEach((f, i) => {
    const stats = fs.statSync(path.join(MODELS_DIR, f))
    const size = (stats.size / 1024).toFixed(1)
    const modified = stats.mtime.toLocaleString()
    log(`  ${i + 1}. ${COLORS.green}${f}${COLORS.reset} (${size}KB, ${modified})`, 'gray')
  })
}

async function trainMovement(options) {
  const gens = options.gens || 50
  const pop = options.pop || 50
  const rate = options.rate || 0.3

  log('━━━ Movement Neural Network Training ━━━', 'magenta')
  log(`Population: ${pop} | Generations: ${gens} | Mutation Rate: ${rate}`, 'cyan')
  log('Architecture: 10 inputs → 16 → 12 → 3 outputs', 'gray')
  log('Task: Navigate from start to target avoiding obstacles', 'gray')
  log('Target: (14, 14) | Start: (2, 2)', 'gray')
  log('')

  const trainer = new MovementTrainer()
  const startTime = Date.now()

  const result = trainer.train({
    populationSize: pop,
    generations: gens,
    mutationRate: rate
  })

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

  log('', 'reset')
  log('━━━ Training Complete ━━━', 'green')
  log(`Time: ${elapsed}s | Best Score: ${result.bestScore.toFixed(1)}`, 'cyan')

  const modelName = generateModelName()
  const modelPath = path.join(MODELS_DIR, modelName + '.json')
  result.bestBrain.save(modelPath)
  log(`Model saved: ${COLORS.green}${modelName}.json${COLORS.reset}`, 'gray')

  log('', 'reset')
  log('Testing best model visualization:', 'yellow')
  const sim = new MovementSimulation()
  let done = false
  while (!done) {
    const state = sim.getState()
    const output = result.bestBrain.forward(state)
    const r = sim.step(output)
    done = r.done
  }
  console.log(sim.render())
  const finalDist = sim.distanceTo()
  log(`Steps: ${sim.stepCount} | Distance to target: ${finalDist.toFixed(2)} | Reached: ${finalDist <= 2 ? 'YES' : 'NO'} | Score: ${sim.totalReward.toFixed(1)}`, finalDist <= 2 ? 'green' : 'red')

  return result
}

async function testModel(modelFile) {
  let modelPath = modelFile
  if (!path.isAbsolute(modelPath)) {
    modelPath = path.join(MODELS_DIR, modelFile)
    if (!fs.existsSync(modelPath)) {
      modelPath = path.join(MODELS_DIR, modelFile + '.json')
    }
  }

  if (!fs.existsSync(modelPath)) {
    log(`Model not found: ${modelFile}`, 'red')
    log(`Check 'list' for available models`, 'yellow')
    return
  }

  log(`Loading model: ${path.basename(modelPath)}`, 'cyan')
  let brain
  try {
    brain = NeuralNetwork.load(modelPath)
  } catch (e) {
    log(`Failed to load model: ${e.message}`, 'red')
    return
  }

  log(`Parameters: ${brain.countParams()}`, 'gray')
  log(`Architecture: ${brain.layers.map(l => `${l.inputSize}→${l.outputSize}(${l.activation})`).join(' → ')}`, 'gray')

  log('', 'reset')
  log('Running 10 test runs:', 'yellow')

  let totalScore = 0
  let reachedCount = 0
  let totalSteps = 0

  for (let i = 0; i < 10; i++) {
    const sim = new MovementSimulation()
    let done = false
    while (!done) {
      const state = sim.getState()
      const output = brain.forward(state)
      const r = sim.step(output)
      done = r.done
    }
    totalScore += sim.totalReward
    totalSteps += sim.stepCount
    if (sim.distanceTo() <= 1.5) reachedCount++
    log(`  Run ${i + 1}: Score=${sim.totalReward.toFixed(1)} Steps=${sim.stepCount} Reached=${sim.distanceTo() <= 1.5 ? '✓' : '✗'}`, sim.distanceTo() <= 1.5 ? 'green' : 'red')
  }

  log('', 'reset')
  log(`Results: ${reachedCount}/10 reached | Avg Score: ${(totalScore / 10).toFixed(1)} | Avg Steps: ${(totalSteps / 10).toFixed(0)}`, reachedCount >= 7 ? 'green' : 'yellow')

  log('', 'reset')
  log('Visualizing best run:', 'yellow')
  const sim = new MovementSimulation()
  let done = false
  while (!done) {
    const state = sim.getState()
    const output = brain.forward(state)
    const r = sim.step(output)
    done = r.done
  }
  console.log(sim.render())
  log(`Final distance: ${sim.distanceTo().toFixed(2)}`, sim.distanceTo() <= 1.5 ? 'green' : 'red')
}

function showStatus() {
  log('━━━ 9Bot Training System Status ━━━', 'cyan')
  log(`Config: pop=${config.populationSize} mutate=${config.mutationRate} gens=${config.generations}`, 'gray')
  log('', 'reset')

  const trainer = new MovementTrainer()
  const brain = trainer.createBrain()
  log(`Movement ML Network:`, 'yellow')
  log(`  Inputs:  ${trainer.inputSize} (pos, target, obstacles, time)`, 'white')
  log(`  Hidden:  ${trainer.hiddenSizes.join(', ')} (tanh)`, 'white')
  log(`  Outputs: ${trainer.outputSize} (forward, strafe, jump)`, 'white')
  log(`  Params:  ${brain.countParams()} trainable weights`, 'white')

  log('', 'reset')
  if (fs.existsSync(MODELS_DIR)) {
    const files = fs.readdirSync(MODELS_DIR).filter(f => f.endsWith('.json'))
    log(`Saved models: ${files.length}`, files.length > 0 ? 'green' : 'yellow')
    if (files.length > 0) {
      files.sort().reverse().slice(0, 3).forEach(f => {
        const stats = fs.statSync(path.join(MODELS_DIR, f))
        log(`  ${f} (${(stats.size / 1024).toFixed(1)}KB, ${stats.mtime.toLocaleDateString()})`, 'gray')
      })
    }
  } else {
    log('No models directory (run training first)', 'yellow')
  }
}

function evolve() {
  const { generatePopulation, mutateWeights, selectTop, nextGeneration } = require('./evolve.js')

  log('━━━ Genetic Algorithm Evolution ━━━', 'magenta')
  log(`Population: ${config.populationSize} | Mutation: ${config.mutationRate}`, 'cyan')

  const population = generatePopulation(config.populationSize)
  const scores = population.map(() => Math.random() * 100)

  const top = selectTop(population, scores, 0.2)
  log(`Top 20% selected (${top.length} agents)`, 'green')

  const newPop = nextGeneration(population, scores, config)
  log(`Next generation created: ${newPop.length} agents`, 'cyan')

  const sample = newPop[0].weights
  log('Sample agent weights:', 'gray')
  for (const [key, val] of Object.entries(sample)) {
    log(`  ${key}: ${typeof val === 'number' ? val.toFixed(4) : val}`, 'gray')
  }

  log('Evolution cycle complete.', 'green')
}

function parseArgs(str) {
  const parts = str.split(/\s+/)
  const options = {}
  for (const part of parts) {
    if (part.startsWith('--')) {
      const eq = part.indexOf('=')
      if (eq > 0) {
        const key = part.slice(2, eq)
        const val = part.slice(eq + 1)
        options[key] = isNaN(val) ? val : parseFloat(val)
      }
    }
  }
  return options
}

async function handleCommand(line) {
  const parts = line.trim().split(/\s+/)
  const cmd = parts[0].toLowerCase()
  const args = parts.slice(1).join(' ')

  switch (cmd) {
    case 'train':
      const subCmd = parts[1] ? parts[1].toLowerCase() : ''
      const opts = parseArgs(parts.slice(2).join(' '))
      if (subCmd === 'movement') {
        await trainMovement(opts)
      } else {
        log('Usage: train movement [--gens=N] [--pop=N] [--rate=N]', 'yellow')
      }
      break

    case 'test':
      if (parts[1]) {
        await testModel(parts[1])
      } else {
        log('Usage: test <model_filename>', 'yellow')
        log('Tip: use list to see available models', 'gray')
      }
      break

    case 'list':
      listModels()
      break

    case 'evolve':
      evolve()
      break

    case 'status':
      showStatus()
      break

    case 'help':
      printHelp()
      break

    case 'quit':
    case 'exit':
      log('Shutting down...', 'yellow')
      rl.close()
      process.exit(0)
      break

    default:
      if (line.trim()) {
        log(`Unknown command: ${cmd}. Type 'help' for available commands.`, 'red')
      }
  }
}

printBanner()
log('Neural Training System ready.', 'green')
log('Type \x1b[33mhelp\x1b[0m for available commands.\n')

rl.prompt()

rl.on('line', async (input) => {
  await handleCommand(input.trim())
  rl.prompt()
})

rl.on('close', () => {
  process.exit(0)
})

process.on('SIGINT', () => {
  log('\nUse quit or Ctrl+D to exit', 'yellow')
  rl.prompt()
})
